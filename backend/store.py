"""Persistent batch queue, immutable predictions and review audit trail."""
import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from uuid import uuid4

from werkzeug.exceptions import BadRequest, Conflict, NotFound

from .consensus import analyze
from .rules import REVIEW_MIN_RIDERS, event_decision

VERSION = "Co-DETR v1 epoch 2"


def uid():
    return uuid4().hex


def now():
    return datetime.now(timezone.utc).isoformat(timespec="microseconds")


# images.target_box is retired and no longer read or written. It stays so old and new databases share one shape.
SCHEMA = """
CREATE TABLE IF NOT EXISTS batches (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS images (
    id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES batches(id),
    position INTEGER NOT NULL, filename TEXT NOT NULL, original_path TEXT NOT NULL,
    display_path TEXT NOT NULL, mime TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL,
    truth TEXT, target_box TEXT, status TEXT NOT NULL DEFAULT 'pending', queued INTEGER NOT NULL DEFAULT 0,
    attempts INTEGER NOT NULL DEFAULT 0, error TEXT, prediction TEXT,
    model_result TEXT, completed_at TEXT, UNIQUE(batch_id, position), UNIQUE(batch_id,filename)
);
CREATE INDEX IF NOT EXISTS queue ON images(queued, status);
CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY, image_id TEXT NOT NULL REFERENCES images(id), position INTEGER NOT NULL,
    vehicle_id TEXT, model_status TEXT NOT NULL, model_reason TEXT NOT NULL,
    status TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'model', note TEXT NOT NULL DEFAULT '',
    revision INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL,
    UNIQUE(image_id,position), UNIQUE(image_id,vehicle_id)
);
CREATE INDEX IF NOT EXISTS event_status ON events(status);
CREATE TABLE IF NOT EXISTS decisions (
    event_id TEXT NOT NULL REFERENCES events(id), revision INTEGER NOT NULL,
    previous_status TEXT NOT NULL, decision TEXT NOT NULL, note TEXT NOT NULL,
    created_at TEXT NOT NULL, PRIMARY KEY(event_id, revision)
);
CREATE TABLE IF NOT EXISTS association_imports (
    id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES batches(id), revision INTEGER NOT NULL,
    filename TEXT NOT NULL, digest TEXT NOT NULL, mode TEXT NOT NULL,
    record_count INTEGER NOT NULL, named_count INTEGER NOT NULL,
    records_json TEXT NOT NULL, summary_json TEXT NOT NULL, created_at TEXT NOT NULL,
    UNIQUE(batch_id,revision)
);
"""


class Store:
    def __init__(self, directory):
        self.path = directory / "review.sqlite3"

    @contextmanager
    def transaction(self, write=False):
        con = sqlite3.connect(self.path, timeout=30, isolation_level=None)
        con.row_factory = sqlite3.Row
        try:
            con.execute("PRAGMA foreign_keys=ON")
            con.execute("BEGIN IMMEDIATE" if write else "BEGIN")
            yield con
            con.commit()
        except BaseException:
            con.rollback()
            raise
        finally:
            con.close()

    def initialize(self):
        with self.transaction() as con:
            con.commit()
            con.execute("PRAGMA journal_mode=WAL")
            con.executescript(SCHEMA)
        with self.transaction(write=True) as con:
            # Only the process holding the data-directory lock can recover running jobs.
            con.execute("UPDATE images SET status='pending', queued=1 WHERE status='running'")

    def enqueue(self, batch_id, ids):
        with self.transaction(write=True) as con:
            require_batch(con, batch_id)
            images = con.execute("SELECT id,status,queued FROM images WHERE batch_id=? ORDER BY position",
                                 (batch_id,)).fetchall()
            selected = set(ids) if ids else {row["id"] for row in images}
            if selected.difference(row["id"] for row in images):
                raise BadRequest("image_ids 含有不属于本批次的图片")
            ready = [(r["id"],) for r in images if r["id"] in selected and not r["queued"]
                     and r["status"] in ("pending", "error")]
            con.executemany("UPDATE images SET status='pending', queued=1, error=NULL WHERE id=?", ready)
            return len(ready)

    def claim(self):
        with self.transaction(write=True) as con:
            row = con.execute("""SELECT i.* FROM images i JOIN batches b ON i.batch_id=b.id
                WHERE i.queued=1 AND i.status='pending' ORDER BY b.rowid,i.position LIMIT 1""").fetchone()
            if row:
                con.execute("UPDATE images SET queued=0,status='running',attempts=attempts+1 WHERE id=?",
                            (row["id"],))
                return dict(row)

    def finish(self, image_id, result):
        timestamp = now()
        with self.transaction(write=True) as con:
            con.execute("""UPDATE images SET status='done',prediction=?,model_result=?,completed_at=?
                WHERE id=?""", (result["prediction"], json.dumps(result, ensure_ascii=False, allow_nan=False),
                                timestamp, image_id))
            # Keep an event even when there are no detections; absence of a vehicle
            # must not introduce another manual review condition.
            status, reason = event_decision(result.get("analysis") or analyze(result))
            nothing = {"id": None, "status": status, "reason": reason}
            for position, vehicle in enumerate(result["vehicles"] or [nothing]):
                con.execute("""INSERT INTO events(id,image_id,position,vehicle_id,model_status,
                    model_reason,status,updated_at) VALUES(?,?,?,?,?,?,?,?)""",
                            (uid(), image_id, position, vehicle["id"], vehicle["status"],
                             vehicle["reason"], vehicle["status"], timestamp))

    def fail(self, image_id, error):
        with self.transaction(write=True) as con:
            con.execute("UPDATE images SET status='error',error=?,completed_at=? WHERE id=?", (error, now(), image_id))


def require_batch(con, batch_id):
    if not con.execute("SELECT 1 FROM batches WHERE id=?", (batch_id,)).fetchone():
        raise NotFound("批次不存在")


def batches(con, batch_id=None):
    condition = "WHERE b.id=?" if batch_id else ""
    rows = con.execute(f"""SELECT b.id,b.name,b.created_at,count(i.id) AS total,
        sum(i.status='done') AS done,sum(i.status='error') AS failed,sum(i.queued) AS queued,
        sum(i.status='running') AS running,sum(i.status='done' AND i.truth IS NOT NULL) AS labeled,
        sum(CASE WHEN i.status='done' AND i.prediction=i.truth THEN 1 ELSE 0 END) AS correct
        FROM batches b JOIN images i ON i.batch_id=b.id {condition}
        GROUP BY b.id ORDER BY b.rowid DESC""", (batch_id,) if batch_id else ()).fetchall()
    results = []
    for row in rows:
        item = dict(row)
        item["processed"] = item["done"] + item["failed"]
        if item["running"] or item["queued"]:
            item["status"] = "running"
        elif item["failed"]:
            item["status"] = "error"
        else:
            item["status"] = "done" if item["done"] == item["total"] else "pending"
        total, correct = item.pop("labeled"), item.pop("correct")
        item["score"] = {"correct": correct, "total": total} if total else None
        results.append(item)
    from .associations import import_metadata
    metadata = {row["batch_id"]: import_metadata(row) for row in con.execute("""SELECT a.batch_id,a.revision,
        a.filename,a.mode,a.record_count,a.named_count,a.created_at FROM association_imports a
        WHERE a.revision=(SELECT max(b.revision) FROM association_imports b WHERE b.batch_id=a.batch_id)""")}
    for item in results:
        item["association"] = metadata.get(item["id"])
    if batch_id:
        if not results:
            raise NotFound("批次不存在")
        results[0]["images"] = [dict(r) for r in con.execute("""SELECT id,filename,status,prediction,
            truth,width,height,error,attempts,queued FROM images WHERE batch_id=? ORDER BY position""", (batch_id,))]
        return results[0]
    return results


def events(con, **filters):
    wanted_status = filters.pop("status", None)
    fields = {"source": "e.source", "batch_id": "i.batch_id",
              "image_id": "i.id", "event_id": "e.id"}
    conditions = " AND ".join(f"{fields[key]}=?" for key in filters) or "1"
    rows = con.execute(f"""SELECT e.*,i.batch_id,i.filename,i.prediction,i.truth,i.completed_at AS recognized_at,b.name AS batch_name,
        i.model_result AS saved_result,
        CASE WHEN e.vehicle_id IS NOT NULL THEN
            json_extract(i.model_result, '$.vehicles[' || e.position || '].detection_ids') END AS detection_ids,
        CASE WHEN e.vehicle_id IS NOT NULL THEN
            coalesce(json_extract(i.model_result, '$.vehicles[' || e.position || '].scope'),'vehicle')
            ELSE 'image' END AS scope,
        coalesce(json_extract(i.model_result,'$.model_version'),?) AS model_version
        FROM events e JOIN images i ON i.id=e.image_id JOIN batches b ON b.id=i.batch_id
        WHERE {conditions} ORDER BY b.rowid DESC,i.position,e.position""", (VERSION, *filters.values()))
    output = []
    analyses = {}
    for row in rows:
        item = dict(row)
        item["detection_ids"] = json.loads(item["detection_ids"] or "[]")
        saved_result = item.pop("saved_result")
        if item["image_id"] not in analyses:
            raw = json.loads(saved_result) if saved_result else None
            analyses[item["image_id"]] = (raw.get("analysis") or analyze(raw)) if raw else dict(person_count=0, subjects=[])
        analysis = analyses[item["image_id"]]
        item["person_count"] = analysis["person_count"]
        item["review_eligible"] = item["person_count"] >= REVIEW_MIN_RIDERS
        evidence = item["detection_ids"] if item["detection_ids"] or item["scope"] == "vehicle" else None
        item["model_status"], item["model_reason"] = event_decision(analysis, evidence)
        if item["source"] == "human":
            summary = "人工确认违章" if item["status"] == "violation" else "人工已排除违章"
            item["reason"] = item["note"] or summary
        else:
            # Apply the current policy to older stored events without changing
            # original model evidence, event IDs or human audit history.
            item["status"] = item["model_status"]
            item["reason"] = item["model_reason"]
        if wanted_status is None or item["status"] == wanted_status:
            output.append(item)
    from .associations import attach_identities
    return attach_identities(con, output)


def review(con, event_id, decision, note, revision):
    result = events(con, event_id=event_id)
    if not result:
        raise NotFound("复核记录不存在")
    item = result[0]
    if not item["review_eligible"]:
        raise Conflict(f"本图识别到 {item['person_count']} 名骑乘人员，未达到 {REVIEW_MIN_RIDERS} 人及以上的人工复核条件。")
    if item["source"] == "human" and (item["status"], item["note"]) == (decision, note):
        return item
    if revision is not None and revision != item["revision"]:
        raise Conflict("记录已被修改，请刷新后复核")
    stamp = now()
    new_revision = item["revision"] + 1
    con.execute("""INSERT INTO decisions(event_id,revision,previous_status,decision,note,created_at)
        VALUES(?,?,?,?,?,?)""", (event_id, new_revision, item["status"], decision, note, stamp))
    con.execute("""UPDATE events SET status=?,source='human',note=?,revision=?,updated_at=?
        WHERE id=?""", (decision, note, new_revision, stamp, event_id))
    return events(con, event_id=event_id)[0]
