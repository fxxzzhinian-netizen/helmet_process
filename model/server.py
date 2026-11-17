"""Standalone inference service. Image bytes in, detection JSON out. Keeps no files or records."""
import argparse
import hmac
import json
import logging
import os
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Event, Lock, Thread

log = logging.getLogger(__name__)
MAX_BYTES = 512 * 1024 ** 2


def load_detector():
    from .adapter import Detector
    return Detector()


class Runtime:
    """Loads the detector in the background so /health answers during start-up."""

    def __init__(self, factory):
        self.detector = None
        self.error = None
        self.loaded = Event()
        self.lock = Lock()
        Thread(target=self._load, args=(factory,), name="helmet-model-load", daemon=True).start()

    def _load(self, factory):
        try:
            self.detector = factory()
        except Exception as exc:
            log.exception("Model failed to load")
            self.error = f"{type(exc).__name__}: {exc}"
        finally:
            self.loaded.set()

    def health(self):
        status = "error" if self.error else "ready" if self.loaded.is_set() else "loading"
        return {"status": status, "error": self.error,
                "model_version": getattr(self.detector, "version", None),
                "device": getattr(self.detector, "device", None)}

    def predict(self, payload):
        self.loaded.wait()
        if self.error:
            raise RuntimeError("模型加载失败：" + self.error)
        # One image at a time. The directory is removed as soon as the result is built.
        with self.lock, tempfile.TemporaryDirectory(prefix="helmet-model-") as directory:
            path = Path(directory) / "image"
            path.write_bytes(payload)
            return self.detector.predict(path)


def make_server(host="127.0.0.1", port=8766, factory=load_detector, token=None):
    runtime = Runtime(factory)

    class Handler(BaseHTTPRequestHandler):
        def reply(self, code, body):
            data = json.dumps(body, ensure_ascii=False, allow_nan=False).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            if self.path == "/health":
                self.reply(200, runtime.health())
            else:
                self.reply(404, {"error": "接口不存在"})

        def do_POST(self):
            if self.path != "/predict":
                return self.reply(404, {"error": "接口不存在"})
            length = self.headers.get("Content-Length", "")
            if not length.isdigit() or int(length) == 0:
                return self.reply(400, {"error": "请求体须为图片字节，并带 Content-Length"})
            if int(length) > MAX_BYTES:
                return self.reply(413, {"error": "图片超过 512 MiB"})
            # Read the body before any rejection so the client receives the reply, not a reset.
            payload = self.rfile.read(int(length))
            if token and not hmac.compare_digest(self.headers.get("Authorization", "").encode(),
                                                 ("Bearer " + token).encode()):
                return self.reply(401, {"error": "模型服务令牌无效"})
            if len(payload) != int(length):
                return self.reply(400, {"error": "图片传输不完整"})
            try:
                self.reply(200, runtime.predict(payload))
            except Exception as exc:
                log.exception("Inference failed")
                self.reply(503 if runtime.error else 500, {"error": f"{type(exc).__name__}: {exc}"})

        def log_message(self, format, *args):
            log.info("%s %s", self.address_string(), format % args)

    server = ThreadingHTTPServer((host, port), Handler)
    server.daemon_threads = True
    server.runtime = runtime
    return server


def main():
    parser = argparse.ArgumentParser(description="头盔识别模型服务")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=8766, type=int)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO)
    token = os.getenv("HELMET_MODEL_TOKEN")
    if args.host not in ("127.0.0.1", "localhost", "::1") and not token:
        log.warning("模型服务监听 %s 且未设置 HELMET_MODEL_TOKEN，任何能连上的人都可调用。", args.host)
    server = make_server(args.host, args.port, token=token)
    log.info("Model service on http://%s:%s", args.host, args.port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
