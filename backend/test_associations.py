"""Identity imports, target scoping, audit revisions and immutable inference regressions."""
import io
import json
import tempfile
import time
import unittest
from pathlib import Path

from werkzeug.datastructures import FileStorage

from .app import create_app
from .associations import Matcher, parse_file
from .test_backend import FixtureDetector, photo


def parsed(text, filename="people.csv", encoding="utf-8-sig"):
    return parse_file(FileStorage(stream=io.BytesIO(text.encode(encoding)), filename=filename))


class AssociationTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.detector = FixtureDetector()
        original = self.detector.predict

        def one_vehicle(path):
            result = original(path)
            result["detections"] = [d for d in result["detections"] if d["id"] != "empty"]
            return result

        self.detector.predict = one_vehicle
        self.start()
        self.batch = self.upload("first.jpg", "second.jpg")

    def start(self):
        self.app = create_app(self.root / "data", lambda: self.detector)
        self.service = self.app.extensions["helmet_service"]
        self.client = self.app.test_client()

    def tearDown(self):
        self.detector.gate.set()
        self.service.close()
        self.temp.cleanup()

    def upload(self, *names):
        response = self.client.post("/api/batches", data={"name": "关联测试", "files":
                                   [(io.BytesIO(photo()), name) for name in names]})
        self.assertEqual(response.status_code, 201)
        return response.json

    def run_batch(self, batch=None):
        batch = batch or self.batch
        self.client.post(f"/api/batches/{batch['id']}/run", json={})
        for _ in range(300):
            result = self.client.get(f"/api/batches/{batch['id']}").json
            if result["status"] != "running":
                self.assertEqual(result["done"], result["total"])
                return result
            time.sleep(.01)
        self.fail("worker did not finish")

    def endpoint(self, batch=None):
        return f"/api/batches/{(batch or self.batch)['id']}/associations"

    def import_file(self, text, mode="demo", revision=0, preview=False, batch=None, filename="people.csv"):
        return self.client.post(self.endpoint(batch) + ("/preview" if preview else ""), data={
            "file": (io.BytesIO(text.encode("utf-8-sig")), filename), "mode": mode, "revision": str(revision)})

    def test_formats_and_identifiers_preserve_leading_zeroes(self):
        csv = 'file,ownerName,memberNo,plateNumber,rfidChip,alarmTime,id,vehicleRecordId\nday/first.jpg,演示甲,0012,0007,CHIP1,2026-11-16 08:00:00,0009,0020\n'
        record = parsed(csv)["records"][0]
        self.assertEqual((record["filename"], record["person_id"], record["plate_number"]), ("first.jpg", "0012", "0007"))
        self.assertEqual((record["capture_id"], record["source_vehicle_id"], record["relationship"]), ("0009", "0020", "登记车主"))
        raw = {"file": "day/first.jpg", "record": {"ownerName": "演示甲", "memberNo": "0012", "plateNumber": "0007"}}
        for filename, document in [("records.jsonl", json.dumps(raw)), ("records.json", json.dumps([raw])),
                                   ("records.json", json.dumps({"records": [raw]}))]:
            item = parsed(document, filename)["records"][0]
            self.assertEqual((item["name"], item["person_id"]), ("演示甲", "0012"))
        self.assertEqual(parsed('照片文件名,人员编号,姓名\nfirst.jpg,001,演示乙\n', encoding="gb18030")["records"][0]["name"], "演示乙")

    def test_preview_is_read_only_and_pending_batches_can_import(self):
        csv = 'filename,person_id,name,plate_number\nfirst.jpg,001,演示甲,P001\nsecond.jpg,,,P002\n'
        preview = self.import_file(csv, "filename", preview=True)
        self.assertEqual(preview.status_code, 200)
        self.assertEqual((preview.json["summary"]["matched"], preview.json["summary"]["unrecognized"]), (1, 1))
        self.assertEqual(self.client.get(self.endpoint()).json["revision"], 0)
        saved = self.import_file(csv, "filename")
        self.assertEqual((saved.status_code, saved.json["revision"]), (200, 1))
        self.assertEqual(saved.json["summary"]["pending_images"], 2)
        self.run_batch()
        rows = self.client.get('/api/violations', query_string={"batch_id": self.batch["id"]}).json
        self.assertEqual([r["identity"]["name"] for r in rows], ["演示甲", "未识别"])
        self.assertEqual(rows[1]["identity"]["plate_number"], "P002")
        self.assertEqual(rows[0]["identity"]["method"], "filename")

    def test_source_columns_values_and_empty_fields_survive_matching(self):
        text = ('file,ownerName,memberNo,speed,phone,departmentName,status,reviewer\n'
                'day/first.jpg,演示甲,0012,0,0013800000000,,2,\n')
        record = parsed(text)["records"][0]
        self.assertEqual(record["source_columns"], text.splitlines()[0].split(','))
        self.assertEqual(record["source_record"]["file"], "day/first.jpg")
        self.assertEqual(record["source_record"]["departmentName"], "")
        self.assertEqual(record["source_record"]["speed"], "0")
        self.assertEqual(record["source_record"]["memberNo"], "0012")
        self.run_batch()
        self.assertEqual(self.import_file(text, "filename").status_code, 200)
        event = self.client.get('/api/events/' + self.client.get('/api/violations').json[0]["id"]).json
        self.assertEqual(event["source"], "model")
        self.assertEqual(event["identity"]["source_record"], record["source_record"])
        self.assertEqual(event["identity"]["source_columns"], record["source_columns"])

    def test_same_file_backfills_old_import_without_revising_identities(self):
        text = 'filename,person_id,name,phone,speed\nfirst.jpg,001,演示甲,00138,0\n'
        self.assertEqual(self.import_file(text, "filename").json["revision"], 1)
        with self.service.store.transaction(write=True) as con:
            row = con.execute('SELECT id,records_json FROM association_imports').fetchone()
            records = json.loads(row["records_json"])
            for record in records:
                record.pop("source_record")
                record.pop("source_columns")
            before = json.loads(json.dumps(records))
            con.execute('UPDATE association_imports SET records_json=? WHERE id=?',
                        (json.dumps(records), row["id"]))
        saved = self.import_file(text, "filename", revision=1)
        self.assertEqual(saved.json["revision"], 1)
        with self.service.store.transaction() as con:
            after = json.loads(con.execute('SELECT records_json FROM association_imports').fetchone()[0])
            self.assertEqual(con.execute('SELECT count(*) FROM association_imports').fetchone()[0], 1)
        self.assertEqual(after[0]["source_record"]["speed"], "0")
        for record in after:
            record.pop("source_record")
            record.pop("source_columns")
        self.assertEqual(after, before)

    def test_demo_is_stable_idempotent_batch_scoped_and_survives_restart(self):
        self.run_batch()
        other = self.upload("first.jpg")
        self.run_batch(other)
        csv = 'filename,person_id,name\nelsewhere.jpg,001,演示甲\nother.jpg,002,演示乙\n'
        saved = self.import_file(csv)
        self.assertEqual(saved.status_code, 200)
        rows = self.client.get('/api/violations', query_string={"batch_id": self.batch["id"]}).json
        identities = [r["identity"] for r in rows]
        self.assertTrue(all(i["is_demo"] and i["method"] == "demo" and not i["verified"] for i in identities))
        self.assertEqual(self.import_file(csv).json["revision"], 1)
        unrelated = self.client.get('/api/violations', query_string={"batch_id": other["id"]}).json
        self.assertTrue(all(r["identity"]["name"] == "未识别" for r in unrelated))
        self.service.close()
        self.start()
        after = self.client.get('/api/violations', query_string={"batch_id": self.batch["id"]}).json
        self.assertEqual([r["identity"] for r in after], identities)
        meta = self.client.get('/api/batches/' + self.batch["id"]).json["association"]
        self.assertEqual((meta["revision"], meta["record_count"]), (1, 2))

    def test_replacement_audit_and_revision_conflicts_do_not_change_inference(self):
        self.run_batch()
        image_id = self.batch["images"][0]["id"]
        before = self.client.get('/api/images/' + image_id).json["model_result"]
        first = 'filename,person_id,name\nfirst.jpg,001,演示甲\n'
        second = 'filename,person_id,name\nfirst.jpg,002,演示乙\n'
        self.assertEqual(self.import_file(first).status_code, 200)
        self.assertEqual(self.import_file(second, revision=0).status_code, 409)
        updated = self.import_file(second, revision=1)
        self.assertEqual(updated.json["revision"], 2)
        self.assertEqual([h["revision"] for h in updated.json["history"]], [2, 1])
        self.assertEqual(self.client.get('/api/images/' + image_id).json["model_result"], before)
        self.assertTrue(all(r["source"] == "model" and r["revision"] == 0 for r in self.client.get('/api/violations').json))
        event = self.client.get('/api/violations').json[0]
        self.assertEqual(self.client.post('/api/reviews/' + event["id"], json={"decision": "clear", "revision": 0}).status_code, 409)
        self.assertEqual(self.client.get('/api/events/' + event["id"]).json["identity"]["name"], "演示乙")

    def test_conflicts_and_multiple_targets_are_not_misattributed(self):
        records = parsed('filename,person_id,name\nfirst.jpg,001,演示甲\nfirst.jpg,002,演示乙\n')["records"]
        event = {"filename": "first.jpg", "vehicle_id": "bike-a", "position": 0}
        self.assertEqual(Matcher(records, "demo").match(event)["status"], "conflict")
        record = records[:1]
        self.assertEqual(Matcher(record, "filename").match(event, 2)["name"], "未识别")
        record[0]["target_vehicle_id"] = "bike-a"
        self.assertEqual(Matcher(record, "filename").match(event, 2)["name"], "演示甲")
        self.assertEqual(Matcher(record, "filename").match({**event, "vehicle_id": "bike-b"}, 2)["name"], "未识别")

    def test_bad_files_are_atomic_and_template_is_downloadable(self):
        for text, filename in [('filename,prediction\nfirst.jpg,helmet\n', 'labels.csv'),
                               ('name,name\nA,B\n', 'duplicate.csv'), ('{broken', 'records.jsonl'),
                               ('name\nA,B\n', 'bad.csv'), ('[]', 'empty.json'), ('name\nA\n', 'bad.exe')]:
            self.assertEqual(self.import_file(text, filename=filename).status_code, 400)
            self.assertEqual(self.client.get(self.endpoint()).json["revision"], 0)
        response = self.client.get('/api/association-template.csv')
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data.startswith(b'\xef\xbb\xbf'))
        self.assertEqual(len(parsed(response.data.decode('utf-8-sig'))["records"]), 2)
        self.assertEqual(self.client.get('/api/batches/missing/associations').status_code, 404)


if __name__ == '__main__':
    unittest.main()
