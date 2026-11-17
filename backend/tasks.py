"""Read-only image tasks across upload groups, including current event decisions."""
from collections import defaultdict

from .store import events


def work_tasks(con):
    by_image = defaultdict(list)
    for event in events(con):
        by_image[event["image_id"]].append(event)
    rows = con.execute("""SELECT i.id,i.batch_id,i.filename,i.status,i.queued,i.error,
        i.prediction,i.width,i.height,i.attempts,i.completed_at,b.created_at AS uploaded_at
        FROM images i JOIN batches b ON b.id=i.batch_id ORDER BY b.rowid DESC,i.position""")
    return [{**dict(row), "events": by_image[row["id"]]} for row in rows]
