"""Backend persistence and failure regressions. No checkpoint or park photos needed."""
import io
import json
import tempfile
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from PIL import Image
from werkzeug.datastructures import MultiDict

from .app import create_app


def photo(width=20, rotation=None):
    stream = io.BytesIO()
    exif = Image.Exif()
    if rotation:
        exif[274] = rotation
    Image.new("RGB", (width, 12)).save(stream, "JPEG", exif=exif)
    return stream.getvalue()


class FixtureDetector:
    def __init__(self):
        self.calls = []
        self.gate = threading.Event()
        self.gate.set()

    def health(self):
        return dict(status="ready", error=None, model_version="fixture", device="cpu")

    def predict(self, path):
        self.gate.wait(5)
        with Image.open(path) as image:
            w, h = image.size
        self.calls.append(w)
        if w == 21 and self.calls.count(21) == 1:
            raise RuntimeError("temporary model failure")
        panels = [dict(id="full", box=[0, 0, w, h])]
        if w == 22:
            return dict(width=w, height=h, panels=panels, detections=[])
        # The rules find a bare-headed driver and an empty bike; neither reaches the crowd threshold.
        boxes = [dict(id="bike", panel="full", box=[0, 0, 8, 10], label="motorbike", confidence=.9),
                 dict(id="d1", panel="full", box=[1, 1, 6, 9], label="DNoHelmet", confidence=.9),
                 dict(id="empty", panel="full", box=[12, 0, 20, 10], label="motorbike", confidence=.9)]
        return dict(width=w, height=h, panels=panels, detections=boxes,
                    additional_metadata={"checkpoint": "fixture"})


class BackendTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / "data"
        self.dist = Path(self.temp.name) / "dist"
        self.dist.mkdir()
        (self.dist / "index.html").write_text("frontend")
        self.detector = FixtureDetector()
        self.start()

    def start(self):
        self.app = create_app(self.root, lambda: self.detector, self.dist)
        self.service = self.app.extensions["helmet_service"]
        self.client = self.app.test_client()

    def tearDown(self):
        self.detector.gate.set()
        self.service.close()
        self.temp.cleanup()

    def upload(self, files, labels=None):
        parts = MultiDict([("name", "演示")])
        for name, payload in files:
            parts.add("files", (io.BytesIO(payload), name))
        if labels is not None:
            parts.add("labels", (io.BytesIO(labels.encode("utf-8-sig")), "标签.csv"))
        return self.client.post("/api/batches", data=parts)

    def settled(self, batch):
        for _ in range(300):
            data = self.client.get("/api/batches/" + batch).json
            if data["status"] != "running":
                return data
            time.sleep(.01)
        self.fail("worker did not settle")

    def test_queue_score_ledger_and_audit(self):
        b = self.upload([("乙.jpg", photo()), ("甲.jpg", photo(21)), ("丙.jpg", photo(22))],
                        "filename,prediction\n乙.jpg,no_helmet\n丙.jpg,helmet\n").json
        ids = [x["id"] for x in b["images"]]
        run = "/api/batches/" + b["id"] + "/run"
        self.assertEqual(self.client.post(run, json={"image_ids": [ids[0], "foreign"]}).status_code, 400)
        self.detector.gate.clear()
        with ThreadPoolExecutor(4) as pool:
            def enqueue(_):
                return self.app.test_client().post(run, json={"image_ids": [ids[1], ids[0], ids[0]]}).json
            responses = list(pool.map(enqueue, range(6)))
        self.assertEqual(sum(r["accepted"] for r in responses), 2)
        self.assertEqual(self.client.get("/api/batches/" + b["id"]).json["status"], "running")
        with self.assertLogs("backend.worker", level="ERROR"):
            self.detector.gate.set()
            data = self.settled(b["id"])
        self.assertEqual(data["status"], "error")
        self.assertEqual([r["status"] for r in data["images"]], ["done", "error", "pending"])
        tasks = self.client.get('/api/tasks').json
        self.assertEqual([item['status'] for item in tasks], ['done', 'error', 'pending'])
        self.assertEqual([item['id'] for item in tasks], ids)
        self.assertEqual([event['status'] for event in tasks[0]['events']], ['violation', 'clear'])
        self.assertTrue(all('original_path' not in item and 'model_result' not in item for item in tasks))
        self.assertIn("temporary model failure", data["images"][1]["error"])
        self.assertEqual(data["score"], {"correct": 1, "total": 1})
        self.assertEqual(self.client.post(run, json={}).json["accepted"], 2)
        data = self.settled(b["id"])
        self.assertEqual((data["status"], data["processed"]), ("done", 3))
        self.assertEqual(self.detector.calls, [20, 21, 21, 22])
        self.assertEqual(data["score"], {"correct": 1, "total": 2})
        self.assertEqual(self.client.post(run, json={}).json["accepted"], 0)
        before = self.client.get("/api/images/" + ids[0]).json["model_result"]
        self.assertEqual(before["additional_metadata"]["checkpoint"], "fixture")
        review_rows = self.client.get("/api/reviews").json
        self.assertEqual(review_rows, [])
        empty = self.client.get("/api/images/" + ids[-1]).json
        self.assertEqual((empty["prediction"], [v["status"] for v in empty["vehicles"]]), ("unknown", ["clear"]))
        self.assertEqual([v["status"] for v in before["vehicles"]], ["violation", "clear"])
        e = self.client.get("/api/violations").json[0]["id"]
        self.assertEqual(self.client.post("/api/reviews/" + e, json={"decision": "clear", "revision": 0}).status_code, 409)
        self.assertEqual(len(self.client.get("/api/violations").json), 2)
        self.service.close()
        self.start()
        self.assertEqual(self.client.get("/api/images/" + ids[0]).json["model_result"], before)
        self.assertEqual(self.client.get("/api/batches/" + b["id"]).json["score"], data["score"])

    def test_crowd_count_alone_controls_review_and_human_audit(self):
        def crowd(path):
            with Image.open(path) as image:
                width, height = image.size
            self.detector.calls.append(width)
            count = width // 10
            detections = []
            for i in range(count):
                x = i * 10
                detections.extend([
                    dict(id=f"bike-{i}", panel="full", box=[x, 4, x + 8, 12], label="motorbike", confidence=.9),
                    dict(id=f"rider-{i}", panel="full", box=[x + 1, 0, x + 7, 11], label="DHelmet", confidence=.9),
                ])
            return dict(width=width, height=height, panels=[dict(id="full", box=[0, 0, width, height])], detections=detections)
        self.detector.predict = crowd
        batch = self.upload([(str(count) + '.jpg', photo(count * 10)) for count in (5, 6, 7)]).json
        self.client.post('/api/batches/' + batch['id'] + '/run', json={})
        self.assertEqual(self.settled(batch['id'])["done"], 3)
        review_rows = self.client.get('/api/reviews').json
        self.assertEqual([row['person_count'] for row in review_rows], [6, 7])
        tasks = self.client.get('/api/tasks').json
        self.assertEqual(sorted(event['person_count'] for item in tasks for event in item['events'] if event['status'] == 'review'), [6, 7])
        self.assertTrue(all(row['review_eligible'] and row['identity']['status'] == 'unrecognized' for row in review_rows))
        self.assertEqual(self.client.get('/api/analytics?days=7').json['summary']['reviews'], 2)
        e = review_rows[0]["id"]
        with ThreadPoolExecutor(3) as pool:
            def confirm(_):
                return self.app.test_client().post("/api/reviews/" + e,
                    json={"decision": "violation", "note": "人工确认", "revision": 0}).status_code
            self.assertEqual(list(pool.map(confirm, range(6))), [200] * 6)
        self.assertEqual(len(self.client.get("/api/violations").json), 1)
        self.assertEqual(len(self.client.get("/api/reviews").json), 1)
        tasks = self.client.get('/api/tasks').json
        self.assertEqual(sum(event['status'] == 'review' for item in tasks for event in item['events']), 1)
        self.assertEqual([event['source'] for item in tasks for event in item['events'] if event['id'] == e], ['human'])
        self.assertEqual([r["id"] for r in self.client.get("/api/violations?source=human").json], [e])
        self.assertEqual(self.client.post("/api/reviews/" + e, json={"decision": "clear", "revision": 0}).status_code, 409)
        self.assertEqual(self.client.post("/api/reviews/" + e, json={"decision": "clear", "revision": 1}).status_code, 200)
        self.assertEqual(len(self.client.get("/api/violations").json), 0)
        self.assertEqual(len(self.client.get("/api/events/" + e).json["history"]), 2)
        self.service.close()
        self.start()
        self.assertEqual(self.client.get("/api/events/" + e).json["revision"], 2)

    def test_legacy_review_state_uses_current_count_without_rewriting_evidence(self):
        batch = self.upload([('old.jpg', photo())]).json
        self.client.post('/api/batches/' + batch['id'] + '/run', json={})
        self.settled(batch['id'])
        image_id = batch['images'][0]['id']
        before = self.client.get('/api/images/' + image_id).json['model_result']
        with self.service.store.transaction(write=True) as con:
            con.execute("UPDATE events SET status='review',model_status='review',model_reason='old conflict' WHERE image_id=?", (image_id,))
        self.assertEqual(self.client.get('/api/reviews').json, [])
        row = self.client.get('/api/violations').json[0]
        self.assertEqual((row['person_count'],row['status'],row['review_eligible']), (1,'violation',False))
        self.assertEqual(self.client.get('/api/images/' + image_id).json['model_result'], before)
        with self.service.store.transaction() as con:
            self.assertEqual(con.execute('SELECT status FROM events WHERE id=?',(row['id'],)).fetchone()[0], 'review')

    def test_every_vehicle_gets_an_event_and_labels_take_two_columns(self):
        def multiple_bikes(path):
            # Bike a carries a bare-headed driver, bike b a helmeted one.
            boxes = [dict(id="a", box=[0, 0, 8, 10], label="motorbike", confidence=.9),
                     dict(id="ra", box=[1, 0, 7, 9], label="DNoHelmet", confidence=.9),
                     dict(id="b", box=[10, 0, 20, 10], label="motorbike", confidence=.95),
                     dict(id="rb", box=[11, 0, 19, 9], label="DHelmet", confidence=.9)]
            return dict(width=20, height=12, panels=[dict(id="full", box=[0, 0, 20, 12])],
                        detections=[dict(d, panel="full") for d in boxes])
        self.detector.predict = multiple_bikes
        files = [(name, photo()) for name in ("甲.jpg", "乙.jpg", "丙.jpg")]
        # Labels are the two columns only. Boxes that single out one vehicle are no longer accepted.
        for bad in ("filename,prediction,target_x1,target_y1,target_x2,target_y2\n甲.jpg,helmet,10,0,20,10\n",
                    "filename,target_x1,target_y1,target_x2,target_y2\n甲.jpg,10,0,20,10\n",
                    "filename,prediction,note\n甲.jpg,helmet,x\n", "filename\n甲.jpg\n"):
            response = self.upload(files, bad)
            self.assertEqual(response.status_code, 400)
            self.assertIn("表头须为 filename,prediction 两列", response.json["error"])
        self.assertEqual(self.client.get("/api/batches").json, [])
        b = self.upload(files, "filename,prediction\n甲.jpg,no_helmet\n乙.jpg,helmet\n").json
        self.client.post("/api/batches/" + b["id"] + "/run", json={})
        self.assertEqual(self.settled(b["id"])["score"], {"correct": 1, "total": 2})
        info = self.client.get("/api/images/" + b["images"][0]["id"]).json
        self.assertEqual((len(info["model_result"]["vehicles"]), len(info["vehicles"])), (2, 2))
        self.assertEqual([(e["status"], e["vehicle_id"], e["detection_ids"], e["scope"]) for e in info["events"]],
                         [("violation", "vehicle-a", ["a", "ra"], "vehicle"),
                          ("clear", "vehicle-b", ["b", "rb"], "vehicle")])
        self.assertEqual([e["filename"] for e in self.client.get("/api/violations").json],
                         ["甲.jpg", "乙.jpg", "丙.jpg"])
        self.assertEqual(self.client.get("/api/reviews").json, [])
        for item in (b["images"][0], info, info["events"][0]):
            self.assertFalse([key for key in item if key.startswith("target")])

    def test_interrupted_queue_and_single_owner(self):
        first, second = [self.upload([(str(i) + ".jpg", photo())]).json for i in range(2)]
        self.assertEqual([r["id"] for r in self.client.get("/api/batches").json], [second["id"], first["id"]])
        with self.assertRaises(RuntimeError):
            create_app(self.root)
        self.service.close()
        with self.service.store.transaction(write=True) as con:
            con.execute("UPDATE images SET status='running',attempts=1 WHERE batch_id=?", (first["id"],))
            con.execute("UPDATE images SET queued=1 WHERE batch_id=?", (second["id"],))
        self.start()
        for batch, attempts in [(first, 2), (second, 1)]:
            d = self.settled(batch["id"])
            self.assertEqual(d["status"], "done")
            self.assertEqual(d["images"][0]["attempts"], attempts)
        self.assertEqual(len(self.client.get("/api/violations").json), 2)

    def test_legacy_results_get_consensus_without_rewriting_saved_evidence(self):
        batch = self.upload([("旧结果.jpg", photo())]).json
        self.client.post("/api/batches/" + batch["id"] + "/run", json={})
        self.settled(batch["id"])
        image_id = batch["images"][0]["id"]
        path = "/api/images/" + image_id
        saved = self.client.get(path).json["model_result"]
        saved.pop("analysis", None)
        saved["detections"] = [saved["detections"][0], saved["detections"][1],
                               dict(saved["detections"][1], id="opposite", label="DHelmet", confidence=.89)]
        with self.service.store.transaction(write=True) as con:
            con.execute("UPDATE images SET model_result=? WHERE id=?", (json.dumps(saved), image_id))
        first = self.client.get(path).json
        self.assertEqual(first["model_result"], saved)
        self.assertEqual(first["prediction"], "no_helmet")  # Historical score is not silently changed.
        self.assertEqual(first["analysis"]["prediction"], "unknown")
        self.assertEqual(first["analysis"]["uncertain_count"], 1)
        self.assertEqual(first["analysis"]["person_count"], 1)
        self.assertEqual(len(first["analysis"]["detections"]), 2)
        self.assertEqual(self.client.get(path).json["analysis"], first["analysis"])
        self.assertEqual(self.detector.calls, [20])

    def test_atomic_upload_and_orientation(self):
        payload = photo(rotation=6)
        failures = [
            ([("好.jpg", payload), ("坏.jpg", b"bad")], None),
            ([("图.jpg", payload), ("图.jpg", payload)], None),
            ([("../a.jpg", payload)], None),
            ([("图.jpg", payload)], "filename,prediction\nother.jpg,helmet"),
            ([("图.jpg", payload)], "filename,prediction\n图.jpg,invalid"),
            ([("图.jpg", payload)], "filename,prediction\n图.jpg,helmet\n图.jpg,helmet"),
        ]
        for files, labels in failures:
            self.assertEqual(self.upload(files, labels).status_code, 400)
        self.assertEqual(self.client.get("/api/batches").json, [])
        self.assertEqual(list((self.root / "uploads").iterdir()), [])
        photo_info = self.upload([("旋转.jpg", payload)]).json["images"][0]
        self.assertEqual((photo_info["width"], photo_info["height"]), (12, 20))
        path = "/api/images/" + photo_info["id"]
        with self.client.get(path + "/uploaded") as response:
            self.assertEqual(response.data, payload)
        with self.client.get(path + "/original") as response:
            self.assertEqual(Image.open(io.BytesIO(response.data)).size, (12, 20))
        with self.client.get("/workspace") as response:
            self.assertEqual(response.data, b"frontend")
        self.assertEqual(self.client.get("/missing.js").status_code, 404)
        self.assertEqual(self.client.get("/api/missing").status_code, 404)
        self.assertEqual(self.client.get("/api/model").json["status"], "ready")


if __name__ == "__main__":
    unittest.main()
