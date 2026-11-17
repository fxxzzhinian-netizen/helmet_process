"""Aggregate workbench trends without returning individual photos or identities."""
import json
from datetime import datetime, timedelta, timezone

from .consensus import analyze
from .store import events, now, require_batch

LOCAL = timezone(timedelta(hours=8))
COUNTERS = ("uploaded", "processed", "done", "failed", "helmet", "no_helmet", "unknown",
            "scored", "correct", "people", "violations", "reviews", "clear", "matched", "unmatched", "demo")


def local_day(value):
    if not value:
        return None
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return parsed.replace(tzinfo=LOCAL).date() if parsed.tzinfo is None else parsed.astimezone(LOCAL).date()


def with_rates(counts):
    def rate(part, whole):
        return round(part / whole * 100, 1) if whole else None
    return {**counts, "failure_rate": rate(counts["failed"], counts["processed"]),
            "score_rate": rate(counts["correct"], counts["scored"]),
            "match_rate": rate(counts["matched"], counts["matched"] + counts["unmatched"])}


def work_analytics(con, batch_id=None, span=7):
    if batch_id:
        require_batch(con, batch_id)
    today = datetime.now(LOCAL).date()
    dates = [today - timedelta(days=span - i - 1) for i in range(span)]
    daily = {day: dict.fromkeys(COUNTERS, 0) for day in dates}
    condition = "WHERE i.batch_id=?" if batch_id else ""
    images = con.execute(f"""SELECT i.id,i.status,i.prediction,i.truth,i.completed_at,i.model_result,
        b.created_at FROM images i JOIN batches b ON b.id=i.batch_id {condition}""",
                         (batch_id,) if batch_id else ())
    image_days = {}
    for image in images:
        uploaded = local_day(image["created_at"])
        completed = local_day(image["completed_at"]) or uploaded
        image_days[image["id"]] = completed
        if uploaded in daily:
            daily[uploaded]["uploaded"] += 1
        if image["status"] not in ("done", "error") or completed not in daily:
            continue
        bucket = daily[completed]
        bucket["processed"] += 1
        if image["status"] == "error":
            bucket["failed"] += 1
            continue
        bucket["done"] += 1
        if image["prediction"] in ("helmet", "no_helmet", "unknown"):
            bucket[image["prediction"]] += 1
        if image["truth"] is not None:
            bucket["scored"] += 1
            bucket["correct"] += image["prediction"] == image["truth"]
        raw = json.loads(image["model_result"]) if image["model_result"] else None
        if raw:
            analysis = raw.get("analysis") or analyze(raw)
            bucket["people"] += analysis["person_count"]

    # Group current event and identity states by the image's recognition date.
    # A later human decision updates that cohort instead of creating another event.
    for event in events(con, **({"batch_id": batch_id} if batch_id else {})):
        day = image_days.get(event["image_id"])
        if day not in daily:
            continue
        bucket = daily[day]
        bucket[{"violation": "violations", "review": "reviews", "clear": "clear"}[event["status"]]] += 1
        matched = event["identity"]["status"] == "matched"
        bucket["matched" if matched else "unmatched"] += 1
        bucket["demo"] += matched and event["identity"]["method"] == "demo"

    totals = {field: sum(day[field] for day in daily.values()) for field in COUNTERS}
    return {"batch_id": batch_id, "span": span, "generated_at": now(),
            "summary": with_rates(totals),
            "days": [{"date": day.isoformat(), **with_rates(daily[day])} for day in dates]}
