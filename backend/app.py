import json
import os
import io
from pathlib import Path

from flask import Flask, jsonify, request, send_file, send_from_directory
from werkzeug.exceptions import BadRequest, HTTPException, NotFound, UnsupportedMediaType
from werkzeug.utils import safe_join

from .store import VERSION, batches, events, review
from .uploads import create_batch
from .worker import Service, load_detector
from .consensus import analyze
from .associations import association_state, parse_file, preview_import, save_import, template
from .analytics import work_analytics

PROJECT = Path(__file__).resolve().parents[1]
MAX_REQUEST = 1024 ** 3
IMAGE_FIELDS = ("id", "batch_id", "position", "filename", "width", "height", "truth", "status", "queued",
                "attempts", "error", "prediction", "model_result", "completed_at")


def create_app(data_dir=None, detector_factory=load_detector, frontend_dir=None):
    app = Flask(__name__, static_folder=None)
    app.json.ensure_ascii = False
    app.config.update(MAX_CONTENT_LENGTH=MAX_REQUEST, MAX_FORM_PARTS=505)
    service = Service(data_dir or os.getenv("HELMET_DATA_DIR") or PROJECT / "data", detector_factory)
    store = service.store
    dist = Path(frontend_dir or os.getenv("HELMET_FRONTEND_DIST") or PROJECT / "frontend/dist").resolve()
    app.extensions["helmet_service"] = service

    @app.errorhandler(HTTPException)
    def http_error(exc):
        return jsonify(error=exc.description, detail=exc.description), exc.code

    @app.after_request
    def headers(response):
        response.headers["X-Content-Type-Options"] = "nosniff"
        if request.path.startswith("/api/"):
            response.headers["Cache-Control"] = "private, no-cache"
        return response

    @app.get("/api/model")
    def model_state():
        # For display only. The queue does not consult it before sending an image.
        return jsonify(detector_factory().health())

    @app.get("/api/batches")
    def list_batches():
        with store.transaction() as con:
            return jsonify(batches(con))

    @app.post("/api/batches")
    def upload():
        if request.mimetype != "multipart/form-data":
            raise UnsupportedMediaType("请用 multipart/form-data 上传")
        batch_id = create_batch(store, service.root, request.form.get("name"), request.files.getlist("files"),
                                request.files.getlist("labels"))
        with store.transaction() as con:
            return jsonify(batches(con, batch_id)), 201

    @app.get("/api/batches/<batch_id>")
    def batch_detail(batch_id):
        with store.transaction() as con:
            return jsonify(batches(con, batch_id))

    @app.get("/api/analytics")
    def analytics():
        span = request.args.get("days", "7")
        if span not in {"7", "14", "30"}:
            raise BadRequest("统计范围支持近 7、14 或 30 天")
        batch_id = request.args.get("batch_id") or None
        with store.transaction() as con:
            return jsonify(work_analytics(con, batch_id, int(span)))

    @app.get("/api/association-template.csv")
    def association_template():
        return send_file(io.BytesIO(template()), mimetype="text/csv; charset=utf-8", as_attachment=True,
                         download_name="园区人员关联模板.csv")

    @app.get("/api/batches/<batch_id>/associations")
    def batch_associations(batch_id):
        with store.transaction() as con:
            return jsonify(association_state(con, batch_id))

    @app.post("/api/batches/<batch_id>/associations/preview")
    @app.post("/api/batches/<batch_id>/associations")
    def import_associations(batch_id):
        if request.mimetype != "multipart/form-data":
            raise UnsupportedMediaType("请用 multipart/form-data 上传人员资料")
        files = request.files.getlist("file")
        if len(files) != 1 or set(request.files) != {"file"}:
            raise BadRequest("请上传一个名为 file 的人员资料文件")
        parsed = parse_file(files[0])
        mode = request.form.get("mode", "demo")
        preview = request.path.endswith("/preview")
        if preview:
            with store.transaction() as con:
                return jsonify(preview_import(con, batch_id, parsed, mode))
        revision = request.form.get("revision", "")
        if not revision.isascii() or not revision.isdecimal() or len(revision) > 10:
            raise BadRequest("请先预览资料，并提供当前关联版本 revision")
        with store.transaction(write=True) as con:
            return jsonify(save_import(con, batch_id, parsed, mode, int(revision)))

    def json_body(optional=False):
        if optional and not request.get_data():
            return {}
        payload = request.get_json()
        if not isinstance(payload, dict):
            raise BadRequest("请求体须为 JSON 对象")
        return payload

    @app.post("/api/batches/<batch_id>/run")
    def run(batch_id):
        body = json_body(optional=True)
        ids = body.get("image_ids", [])
        if not isinstance(ids, list) or not all(isinstance(i, str) and i for i in ids):
            raise BadRequest("image_ids 须为图片 ID 数组")
        accepted = store.enqueue(batch_id, ids)
        service.wake.set()
        with store.transaction() as con:
            result = batches(con, batch_id)
        result["accepted"] = accepted
        result["message"] = (f"本次加入队列 {accepted} 张。已完成图片保留原结果；"
                             "如需重新识别已完成图片，请将其上传到新批次。")
        return jsonify(result), 202

    def find_image(con, image_id):
        row = con.execute("SELECT * FROM images WHERE id=?", (image_id,)).fetchone()
        if not row:
            raise NotFound("图片不存在")
        return dict(row)

    @app.get("/api/images/<image_id>")
    def image_detail(image_id):
        with store.transaction() as con:
            row = find_image(con, image_id)
            # Storage paths and retired columns stay out of the response.
            item = {key: row[key] for key in IMAGE_FIELDS}
            raw = json.loads(item["model_result"]) if item["model_result"] else None
            image_events = events(con, image_id=image_id)
            by_vehicle = {e["vehicle_id"]: e for e in image_events}
            vehicles = []
            for vehicle in (raw["vehicles"] if raw else []):
                current = by_vehicle.get(vehicle["id"])
                if current is None:
                    continue
                vehicles.append({**vehicle, **{k: current[k] for k in ("status", "reason", "source", "note")},
                                 "event_id": current["id"], "model_status": current["model_status"]})
            item.update(model_result=raw, model_version=(raw or {}).get("model_version", VERSION),
                        detections=raw["detections"] if raw else [], vehicles=vehicles, events=image_events,
                        analysis=analyze(raw) if raw else None)
            return jsonify(item)

    @app.get("/api/images/<image_id>/original")
    @app.get("/api/images/<image_id>/uploaded")
    def original(image_id):
        with store.transaction() as con:
            item = find_image(con, image_id)
        exact = request.path.endswith("/uploaded")
        filename = item["original_path"] if exact else item["display_path"]
        mime = item["mime"] if exact or item["original_path"] == filename else "image/png"
        path = service.root / filename
        if not path.is_file():
            raise NotFound("留存图片文件缺失")
        return send_file(path, mimetype=mime, conditional=True,
                         as_attachment=exact, download_name=item["filename"] if exact else path.name)

    @app.get("/api/reviews")
    @app.get("/api/violations")
    def event_list():
        filters = {key: request.args[key] for key in ("source", "batch_id", "image_id") if key in request.args}
        filters["status"] = "review" if request.path.endswith("/reviews") else "violation"
        with store.transaction() as con:
            return jsonify(events(con, **filters))

    @app.get("/api/events/<event_id>")
    def event_detail(event_id):
        with store.transaction() as con:
            matches = events(con, event_id=event_id)
            if not matches:
                raise NotFound("事件不存在")
            item = matches[0]
            item["history"] = [dict(r) for r in con.execute("""SELECT revision,previous_status,decision,note,
                created_at FROM decisions WHERE event_id=? ORDER BY revision""", (event_id,))]
            return jsonify(item)

    @app.post("/api/reviews/<event_id>")
    def decide(event_id):
        body = json_body()
        decision, note, revision = body.get("decision"), body.get("note", ""), body.get("revision")
        if decision not in ("violation", "clear") or not isinstance(note, str) or len(note) > 4000:
            raise BadRequest("decision 须为 violation 或 clear，note 最多 4000 字符")
        if revision is not None and (type(revision) is not int or revision < 0):
            raise BadRequest("revision 须为非负整数")
        with store.transaction(write=True) as con:
            return jsonify(review(con, event_id, decision, note.strip(), revision))

    @app.get("/")
    @app.get("/<path:resource>")
    def frontend(resource=""):
        if resource == "api" or resource.startswith("api/"):
            raise NotFound("API 不存在")
        candidate = safe_join(str(dist), resource)
        if candidate is None or not Path(candidate).resolve().is_relative_to(dist):
            raise NotFound("资源不存在")
        if resource and Path(candidate).is_file():
            return send_from_directory(dist, resource)
        if Path(resource).suffix or not (dist / "index.html").is_file():
            raise NotFound("前端资源不存在，请检查构建目录")
        return send_from_directory(dist, "index.html")

    return app
