"""Single-reader model queue. SQLite is the source of truth for pending work."""
import json
import logging
import math
import shutil
from pathlib import Path
from threading import Event, Lock, Thread

from filelock import FileLock, Timeout

from .remote import RemoteDetector
from .rules import judge
from .store import Store

log = logging.getLogger(__name__)


def load_detector():
    return RemoteDetector()


def validate(result, image):
    """Check the model output before the rules read it. The model reports panels and boxes only."""
    if not isinstance(result, dict):
        raise ValueError("模型输出须为 JSON 对象")
    if (result.get("width"), result.get("height")) != (image["width"], image["height"]):
        raise ValueError("模型输出尺寸与上传图片坐标空间不一致")
    detections, panels = result.get("detections"), result.get("panels")
    if not isinstance(detections, list) or not isinstance(panels, list) or not panels:
        raise ValueError("模型未返回检测框或画面列表")
    panel_ids = [panel["id"] for panel in panels]
    if not all(isinstance(p, str) and p for p in panel_ids) or len(set(panel_ids)) != len(panel_ids):
        raise ValueError("模型画面 ID 无效或重复")

    def inside(box):
        return (isinstance(box, (tuple, list)) and len(box) == 4
                and all(isinstance(v, (int, float)) and math.isfinite(v) for v in box)
                and 0 <= box[0] < box[2] <= image["width"] and 0 <= box[1] < box[3] <= image["height"])

    for panel in panels:
        # Optional: this panel shows the `source_box` part of panel `crop_of`, enlarged.
        if "crop_of" in panel and (panel["crop_of"] not in panel_ids or panel["crop_of"] == panel["id"]
                                   or not inside(panel.get("box")) or not inside(panel.get("source_box"))):
            raise ValueError("模型画面截取关系无效")
    detection_ids = set()
    for detection in detections:
        ident, box = detection["id"], detection["box"]
        if not isinstance(ident, str) or not ident or ident in detection_ids:
            raise ValueError("模型检测框 ID 无效或重复")
        if not inside(box):
            raise ValueError("模型检测框无效或超出原图")
        if not isinstance(detection.get("label"), str) or not 0 <= detection["confidence"] <= 1:
            raise ValueError("模型检测类别或置信度无效")
        if detection["panel"] not in panel_ids:
            raise ValueError("模型检测框所属画面无效")
        detection_ids.add(ident)
    json.dumps(result, allow_nan=False)


class Service:
    def __init__(self, root, factory=load_detector):
        self.root = Path(root).expanduser().resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.store = Store(self.root)
        self.lock = FileLock(str(self.root / ".service.lock"), thread_local=False)
        self.closed = Event()
        self.wake = Event()
        self.shutdown_lock = Lock()
        self.factory = factory
        self.detector = None
        try:
            self.lock.acquire(timeout=0)
        except Timeout as exc:
            raise RuntimeError(f"已有服务使用数据目录 {self.root}") from exc
        try:
            self.store.initialize()
            self._clean_unpublished()
            self.thread = Thread(target=self._run, name="helmet-inference", daemon=True)
            self.thread.start()
        except BaseException:
            self.lock.release()
            raise

    def _clean_unpublished(self):
        uploads = self.root / "uploads"
        uploads.mkdir(exist_ok=True)
        shutil.rmtree(self.root / ".staging", ignore_errors=True)
        with self.store.transaction() as con:
            published = {row[0] for row in con.execute("SELECT id FROM batches")}
        for directory in uploads.iterdir():
            if directory.is_dir() and len(directory.name) == 32 and directory.name not in published:
                if all(c in "0123456789abcdef" for c in directory.name):
                    shutil.rmtree(directory)

    def _run(self):
        while not self.closed.is_set():
            # Clear before polling so a concurrent enqueue cannot lose a notification.
            self.wake.clear()
            if self.closed.is_set():
                break
            try:
                image = self.store.claim()
                if not image:
                    self.wake.wait()
                    continue
                try:
                    if self.detector is None:
                        self.detector = self.factory()
                    path = self.root / image["display_path"]
                    result = self.detector.predict(str(path))
                    validate(result, image)
                    self.store.finish(image["id"], judge(result, path))
                except Exception as exc:
                    log.exception("Inference failed for %s", image["id"])
                    self.store.fail(image["id"], f"{type(exc).__name__}: {exc}"[:2000])
            except Exception:
                log.exception("Queue access failed")
                self.closed.wait(1)

    def close(self):
        with self.shutdown_lock:
            self.closed.set()
            self.wake.set()
            self.thread.join()
            self.lock.release()
