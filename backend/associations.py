"""Park identities: one shared personnel file for every image, optionally replaced per batch.

Demo assignment is explicit and never changes model decisions."""
import csv
import hashlib
import io
import json
from pathlib import PurePosixPath

from werkzeug.exceptions import BadRequest, Conflict

from .store import events, now, require_batch, uid

MAX_FILE = 20 * 1024 * 1024
MAX_ROWS = 20000
MODES = {"demo", "filename"}
ALIASES = {
    "filename": ("filename", "file", "照片文件名", "文件名"),
    "capture_id": ("capture_id", "id", "抓拍编号"),
    "person_id": ("person_id", "memberNo", "人员编号", "mbId"),
    "name": ("name", "ownerName", "姓名", "人员姓名"),
    "relationship": ("relationship", "relation", "身份关系"),
    "plate_number": ("plate_number", "plateNumber", "车牌号", "carNo"),
    "rfid_chip": ("rfid_chip", "rfidChip", "芯片编号"),
    "captured_at": ("captured_at", "alarmTime", "抓拍时间", "createTime"),
    "address": ("address", "抓拍地点"),
    "department": ("department", "departmentName", "部门"),
    "phone": ("phone", "mobile", "phoneNumber", "ownerPhone", "ownerMobile", "手机号", "联系电话"),
    "jurisdiction": ("jurisdiction", "area", "areaName", "region", "regionName", "辖区"),
    "target_vehicle_id": ("target_vehicle_id", "目标车辆标识"),
    "source_vehicle_id": ("source_vehicle_id", "vehicleRecordId", "园区车辆编号"),
}
EMPTY = {"", "null", "none", "未知", "未识别", "未提供", "无", "-", "—"}


def clean(value):
    if value is None:
        return ""
    if isinstance(value, (dict, list, bool)):
        raise BadRequest("人员资料字段须为文字或编号，不能是数组或对象")
    value = str(value).strip()
    if len(value) > 1000:
        raise BadRequest("单个资料字段不能超过 1000 字符")
    return "" if value.lower() in EMPTY else value


def basename(value):
    return PurePosixPath(value.replace("\\", "/")).name if value else ""


def parse_file(file):
    filename = basename(file.filename or "")
    suffix = PurePosixPath(filename).suffix.lower()
    if suffix not in {".csv", ".jsonl", ".json"}:
        raise BadRequest("人员资料支持 CSV、JSONL 或 JSON 文件")
    payload = file.stream.read(MAX_FILE + 1)
    if not payload or len(payload) > MAX_FILE:
        raise BadRequest("人员资料文件不能为空，且不能超过 20 MB")
    for encoding in ("utf-8-sig", "gb18030"):
        try:
            text = payload.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    else:
        raise BadRequest("人员资料须为 UTF-8 或 GB18030 编码")
    try:
        if suffix == ".csv":
            reader = csv.DictReader(io.StringIO(text, newline=""))
            fields = reader.fieldnames or []
            if not fields or len(fields) != len(set(fields)):
                raise BadRequest("CSV 表头为空或含有重复列")
            raw = []
            for line, row in enumerate(reader, 2):
                if None in row or any(value is None for value in row.values()):
                    raise BadRequest(f"CSV 第 {line} 行列数与表头不一致")
                if any(value.strip() for value in row.values()):
                    raw.append((line, row))
                if len(raw) > MAX_ROWS:
                    raise BadRequest("人员资料最多支持 20000 条记录")
        elif suffix == ".jsonl":
            raw = [(line, json.loads(value)) for line, value in enumerate(text.splitlines(), 1) if value.strip()]
        else:
            document = json.loads(text)
            rows = document.get("records") if isinstance(document, dict) else document
            if not isinstance(rows, list):
                raise BadRequest("JSON 须为记录数组，或包含 records 数组")
            raw = list(enumerate(rows, 1))
    except (ValueError, csv.Error) as exc:
        raise BadRequest("人员资料格式无效，请检查 CSV 列数或 JSON 语法") from exc
    if not raw or len(raw) > MAX_ROWS:
        raise BadRequest("人员资料须包含 1 至 20000 条记录")
    records = []
    for line, row in raw:
        if not isinstance(row, dict) or not isinstance(row.get("record", {}), dict):
            raise BadRequest(f"第 {line} 条资料须为记录对象")
        source = {**{key: value for key, value in row.items() if key != "record"}, **row.get("record", {})}
        if not any(key in source for key in (*ALIASES["name"], *ALIASES["person_id"])):
            raise BadRequest(f"第 {line} 条缺少姓名或人员编号字段，请使用人员资料模板")
        record = {key: next((clean(source[alias]) for alias in aliases if clean(source.get(alias))), "")
                  for key, aliases in ALIASES.items()}
        record["source_file"] = record["filename"]
        record["filename"] = basename(record["filename"])
        record["relationship"] = record["relationship"] or ("登记车主" if "ownerName" in source else "未核实")
        record["line"] = line
        # Keep source headers, order and values separate from display defaults and
        # model decisions. JSON response key sorting must not reorder CSV columns.
        record["source_columns"] = list(source)
        record["source_record"] = source
        records.append(record)
    return {"filename": filename, "digest": hashlib.sha256(payload).hexdigest(), "records": records}


def latest_import(con, batch_id):
    return con.execute("SELECT * FROM association_imports WHERE batch_id=? ORDER BY revision DESC LIMIT 1",
                       (batch_id,)).fetchone()


def latest_shared(con):
    """The personnel file uploaded for all images. A batch with its own file uses that one instead."""
    return con.execute("SELECT * FROM shared_associations ORDER BY revision DESC LIMIT 1").fetchone()


def import_metadata(row):
    if row is None:
        return None
    return {key: row[key] for key in ("revision", "filename", "mode", "record_count", "named_count", "created_at")}


def matcher_from(row):
    return Matcher(json.loads(row["records_json"]) if row else [], row["mode"] if row else "filename")


class Matcher:
    def __init__(self, records, mode):
        self.records, self.mode = records, mode
        self.by_name = {}
        for record in records:
            if record["filename"]:
                self.by_name.setdefault(record["filename"].casefold(), []).append(record)

    def match(self, event, vehicle_count=1):
        identity = {"status": "unrecognized", "name": "未识别", "person_id": "", "method": "none",
                    "is_demo": self.mode == "demo", "verified": False, "reason": "未找到对应人员资料"}
        if not self.records:
            identity["reason"] = "尚未上传本批人员资料"  # 前端按这句原文识别“还没有资料”的状态，勿改
            return identity
        filename = basename(event["filename"])
        candidates = self.by_name.get(filename.casefold(), [])
        target = event.get("vehicle_id")
        targeted = [r for r in candidates if r["target_vehicle_id"] and r["target_vehicle_id"] == target]
        if targeted:
            candidates = targeted
        else:
            candidates = [r for r in candidates if not r["target_vehicle_id"]]
        method = "target" if targeted else "filename"
        if candidates:
            unique = {json.dumps({k: v for k, v in r.items() if k not in
                                 {"line", "source_file", "source_record", "source_columns"}}, sort_keys=True)
                      for r in candidates}
            if len(unique) > 1:
                return {**identity, "status": "conflict", "reason": "同一照片或目标对应多条不同资料，请更正后重新上传"}
            if vehicle_count > 1 and not targeted and self.mode != "demo":
                return {**identity, "reason": "多车同框且资料未指定目标车辆，暂不推断人员归属"}
            record = candidates[0]
            if vehicle_count > 1 and not targeted:
                method = "demo"
        elif self.mode == "demo":
            # Stable per target, across refreshes/restarts and duplicate uploads. No facial identification.
            key = f"{filename.casefold()}:{event.get('position', 0)}"
            index = int(hashlib.sha256(key.encode()).hexdigest(), 16) % len(self.records)
            record, method = self.records[index], "demo"
        else:
            return identity
        named = bool(record["name"])
        return {**record, "status": "matched" if named else "unrecognized",
                "name": record["name"] or "未识别", "method": method,
                "relationship": "演示关联人员" if method == "demo" else record["relationship"],
                "registered_relationship": record["relationship"],
                "is_demo": self.mode == "demo", "verified": False,
                "reason": "仅用于演示的人员配对" if named and method == "demo" else
                          "按目标车辆关联" if named and method == "target" else
                          "按照片文件名关联登记资料" if named else "对应资料未提供姓名"}


def attach_identities(con, rows):
    """Enrich one event query with one read per batch; original inference and review fields stay intact."""
    matchers = {}
    shared = None  # parsed once, however many batches fall back to it
    vehicle_counts = {}
    for row in rows:
        batch_id = row["batch_id"]
        if batch_id not in matchers:
            imported = latest_import(con, batch_id)
            if imported is None and shared is None:
                shared = matcher_from(latest_shared(con))
            matchers[batch_id] = matcher_from(imported) if imported else shared
        image_id = row["image_id"]
        if image_id not in vehicle_counts:
            vehicle_counts[image_id] = con.execute("SELECT count(*) FROM events WHERE image_id=?",
                                                  (image_id,)).fetchone()[0]
        row["identity"] = matchers[batch_id].match(row, vehicle_counts[image_id])
    return rows


def targets(con, batch_id):
    rows = [dict(r) for r in con.execute("""SELECT e.id,e.image_id,e.vehicle_id,e.position,e.status,i.filename
        FROM events e JOIN images i ON i.id=e.image_id WHERE i.batch_id=?
        ORDER BY i.position,e.position""", (batch_id,))]
    pending = [dict(r) for r in con.execute("""SELECT i.id AS image_id,i.filename,i.status,0 AS position
        FROM images i WHERE i.batch_id=? AND NOT EXISTS(SELECT 1 FROM events e WHERE e.image_id=i.id)
        ORDER BY i.position""", (batch_id,))]
    return rows + pending, len(pending)


def plan(con, batch_id, records, mode):
    rows, pending = targets(con, batch_id)
    counts = {}
    for row in rows:
        counts[row["image_id"]] = counts.get(row["image_id"], 0) + 1
    matcher = Matcher(records, mode)
    summary = dict(total=len(rows), matched=0, exact=0, demo=0, unrecognized=0, conflicts=0,
                   pending_images=pending, records=len(records), named=sum(bool(r["name"]) for r in records))
    preview = []
    for row in rows:
        identity = matcher.match(row, counts[row["image_id"]])
        if identity["status"] == "matched":
            summary["matched"] += 1
            summary["demo" if identity["method"] == "demo" else "exact"] += 1
        else:
            summary["unrecognized"] += 1
            summary["conflicts"] += identity["status"] == "conflict"
        if len(preview) < 50:
            preview.append({**row, "identity": identity})
    return {"summary": summary, "preview": preview}


def association_state(con, batch_id):
    require_batch(con, batch_id)
    imported = latest_import(con, batch_id)
    # Count with the file that actually applies: the batch's own, otherwise the shared one.
    applied = imported or latest_shared(con)
    records = json.loads(applied["records_json"]) if applied else []
    state = plan(con, batch_id, records, applied["mode"] if applied else "filename")
    # The live ledger contains completed targets only. The import preview may also
    # contain pending images and is deliberately limited to 50 items.
    state.update(rows=events(con, batch_id=batch_id),
                 imported=import_metadata(imported), revision=imported["revision"] if imported else 0,
                 history=[{**import_metadata(row), "summary": json.loads(row["summary_json"])}
                          for row in con.execute("""SELECT revision,filename,mode,record_count,named_count,
                              created_at,summary_json FROM association_imports WHERE batch_id=? ORDER BY revision DESC""",
                                                 (batch_id,))])
    return state


def preview_import(con, batch_id, parsed, mode):
    require_batch(con, batch_id)
    if mode not in MODES:
        raise BadRequest("关联方式须为 demo 或 filename")
    current = latest_import(con, batch_id)
    return {**plan(con, batch_id, parsed["records"], mode), "filename": parsed["filename"], "mode": mode,
            "revision": current["revision"] if current else 0}


def save_import(con, batch_id, parsed, mode, revision):
    result = preview_import(con, batch_id, parsed, mode)
    current = latest_import(con, batch_id)
    if current and current["digest"] == parsed["digest"] and current["mode"] == mode:
        # Re-uploading the same file can supply raw fields omitted by older
        # versions, without changing identities or adding an audit revision.
        records = json.loads(current["records_json"])
        if any("source_record" not in record for record in records):
            originals = {record["line"]: record for record in parsed["records"]}
            for record in records:
                original = originals.get(record["line"])
                if original and "source_record" not in record:
                    record.update(source_record=original["source_record"], source_columns=original["source_columns"])
            con.execute("UPDATE association_imports SET records_json=? WHERE id=?",
                        (json.dumps(records, ensure_ascii=False), current["id"]))
        return association_state(con, batch_id)
    if revision != result["revision"]:
        raise Conflict("本批关联资料已被更新，请重新预览后保存")
    con.execute("""INSERT INTO association_imports(id,batch_id,revision,filename,digest,mode,
        record_count,named_count,records_json,summary_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
                (uid(), batch_id, revision + 1, parsed["filename"], parsed["digest"], mode,
                 len(parsed["records"]), result["summary"]["named"],
                 json.dumps(parsed["records"], ensure_ascii=False), json.dumps(result["summary"]), now()))
    return association_state(con, batch_id)


def shared_state(con):
    row = latest_shared(con)
    return {"imported": import_metadata(row), "revision": row["revision"] if row else 0}


def save_shared(con, parsed, mode):
    """Replace the personnel file used by every batch without its own. Earlier versions are kept."""
    if mode not in MODES:
        raise BadRequest("关联方式须为 demo 或 filename")
    current = latest_shared(con)
    if not (current and current["digest"] == parsed["digest"] and current["mode"] == mode):
        con.execute("""INSERT INTO shared_associations(id,revision,filename,digest,mode,
            record_count,named_count,records_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)""",
                    (uid(), (current["revision"] if current else 0) + 1, parsed["filename"], parsed["digest"], mode,
                     len(parsed["records"]), sum(bool(r["name"]) for r in parsed["records"]),
                     json.dumps(parsed["records"], ensure_ascii=False), now()))
    return shared_state(con)


def template():
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(["filename", "person_id", "name", "relationship", "plate_number", "rfid_chip",
                     "captured_at", "capture_id", "target_vehicle_id", "address", "jurisdiction", "department", "phone"])
    writer.writerow(["example.jpg", "DEMO001", "演示人员甲", "演示关联人员", "演示001", "DEMO-CHIP-001",
                     "2026-11-16 08:30:00", "DEMO-CAPTURE-001", "", "园区东门", "东区", "演示部门", ""])
    writer.writerow(["unknown.jpg", "", "", "未核实", "演示002", "", "2026-11-16 08:31:00", "DEMO-CAPTURE-002", "", "园区东门", "东区", "", ""])
    return output.getvalue().encode("utf-8-sig")
