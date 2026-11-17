"""Validate a complete upload before publishing its batch."""
import csv
import io
import shutil
import unicodedata
import warnings
from pathlib import Path
from uuid import uuid4

from PIL import Image, ImageOps, UnidentifiedImageError
from werkzeug.exceptions import BadRequest, RequestEntityTooLarge

from .store import now, uid

MAX_FILES = 500
MAX_BYTES = 32 * 1024 * 1024
MAX_PIXELS = 64_000_000
FORMATS = {"JPEG": (".jpg", "image/jpeg"), "PNG": (".png", "image/png"),
           "WEBP": (".webp", "image/webp")}


def filename(value):
    value = unicodedata.normalize("NFC", value or "")
    if (not value.strip() or len(value) > 255 or value in (".", "..") or "/" in value
            or "\\" in value or any(ord(c) < 32 or ord(c) == 127 for c in value)):
        raise BadRequest("文件名为空或含有路径、控制字符")
    return value


def labels_from(upload, names):
    if upload is None:
        return {}
    payload = upload.stream.read(1024 * 1024 + 1)
    if len(payload) > 1024 * 1024:
        raise RequestEntityTooLarge("标签 CSV 超过 1 MiB")
    labels = {}
    try:
        rows = csv.reader(io.StringIO(payload.decode("utf-8-sig"), newline=""), strict=True)
        header = next(rows, [])
        if sorted(header) != ["filename", "prediction"]:
            raise BadRequest("标签 CSV 的表头须为 filename,prediction 两列，请删除其他列")
        for row in rows:
            if not row:
                continue
            if len(row) != len(header):
                raise BadRequest(f"标签 CSV 第 {rows.line_num} 行列数有误")
            data = dict(zip(header, row))
            name = filename(data["filename"])
            truth = data["prediction"].strip()
            if name not in names or name in labels or truth not in ("helmet", "no_helmet"):
                raise BadRequest(f"标签 CSV 第 {rows.line_num} 行文件不匹配、重复或标注无效")
            labels[name] = truth
    except (UnicodeError, csv.Error) as exc:
        raise BadRequest("标签须为 UTF-8 编码的 CSV") from exc
    return labels


def save_image(upload, directory, image_id):
    temp = directory / (image_id + ".upload")
    size = 0
    with temp.open("wb") as target:
        while chunk := upload.stream.read(256 * 1024):
            size += len(chunk)
            if size > MAX_BYTES:
                raise RequestEntityTooLarge("单图超过 32 MiB")
            target.write(chunk)
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(temp) as img:
                if img.format not in FORMATS or getattr(img, "n_frames", 1) != 1:
                    raise BadRequest("请上传单帧 JPEG、PNG 或 WebP 图片")
                if img.width * img.height > MAX_PIXELS:
                    raise RequestEntityTooLarge("图片超过 6400 万像素")
                suffix, mime = FORMATS[img.format]
                img.verify()
            original = temp.with_suffix(suffix)
            temp.rename(original)
            with Image.open(original) as img:
                img.load()
                display = original
                width, height = img.size
                if img.getexif().get(274, 1) in range(2, 9):
                    # Browsers auto-rotate EXIF. Feed inference and overlay the same pixels.
                    upright = ImageOps.exif_transpose(img).convert("RGB")
                    display = directory / (image_id + "-upright.png")
                    upright.save(display)
                    width, height = upright.size
        return original.name, display.name, mime, width, height
    except (Image.DecompressionBombWarning, Image.DecompressionBombError) as exc:
        raise RequestEntityTooLarge("图片像素过多") from exc
    except (OSError, ValueError, SyntaxError, UnidentifiedImageError) as exc:
        raise BadRequest(f"无法解码图片 {upload.filename}") from exc


def create_batch(store, root, name, files, label_files):
    if not isinstance(name, str) or not name.strip() or len(name) > 200:
        raise BadRequest("批次名称须为 1–200 个字符")
    if not files or len(files) > MAX_FILES or len(label_files) > 1:
        raise BadRequest("每批须上传 1–500 张图片，最多一份标签 CSV")
    names = [filename(f.filename) for f in files]
    if len(set(names)) != len(names):
        raise BadRequest("同一批次内文件名须唯一")
    labels = labels_from(label_files[0] if label_files else None, set(names))
    batch_id = uid()
    stage = root / ".staging" / uuid4().hex
    final = root / "uploads" / batch_id
    stage.mkdir(parents=True)
    published = False
    try:
        records = []
        for position, (photo, photo_name) in enumerate(zip(files, names)):
            image_id = uid()
            raw, display, mime, width, height = save_image(photo, stage, image_id)
            records.append((image_id, batch_id, position, photo_name, str(Path("uploads", batch_id, raw)),
                            str(Path("uploads", batch_id, display)), mime, width, height,
                            labels.get(photo_name)))
        with store.transaction(write=True) as con:
            con.execute("INSERT INTO batches VALUES(?,?,?)", (batch_id, name.strip(), now()))
            con.executemany("""INSERT INTO images(id,batch_id,position,filename,original_path,display_path,
                mime,width,height,truth) VALUES(?,?,?,?,?,?,?,?,?,?)""", records)
            stage.rename(final)
        published = True
    finally:
        if not published:
            shutil.rmtree(stage, ignore_errors=True)
            shutil.rmtree(final, ignore_errors=True)
    return batch_id
