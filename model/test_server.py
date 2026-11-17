"""Model service and backend client over real HTTP. No checkpoint needed."""
import tempfile
import threading
import unittest
from pathlib import Path

from backend.remote import RemoteDetector

from .server import make_server


class EchoDetector:
    version = "fixture"
    device = "cpu"

    def predict(self, path):
        payload = path.read_bytes()
        if payload == b"bad":
            raise ValueError("无法解码")
        self.path = path
        return dict(width=len(payload), height=1, panels=[], detections=[], note="中文")


class ServerTest(unittest.TestCase):
    def setUp(self):
        directory = self.enterContext(tempfile.TemporaryDirectory())
        self.good, self.bad = Path(directory) / "good", Path(directory) / "bad"
        self.good.write_bytes(bytes(range(256)) * 4)
        self.bad.write_bytes(b"bad")

    def serve(self, factory, token=None):
        server = make_server(port=0, factory=factory, token=token)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        return server, "http://127.0.0.1:%d" % server.server_address[1]

    def test_image_bytes_round_trip(self):
        detector = EchoDetector()
        server, url = self.serve(lambda: detector)
        result = RemoteDetector(url).predict(self.good)
        self.assertEqual((result["width"], result["note"]), (1024, "中文"))
        self.assertFalse(detector.path.exists())
        ready = {"status": "ready", "error": None, "model_version": "fixture", "device": "cpu"}
        self.assertEqual(server.runtime.health(), ready)
        self.assertEqual(RemoteDetector(url).health(), ready)

    def test_failures_reach_the_backend_as_errors(self):
        _, url = self.serve(EchoDetector, token="secret")
        with self.assertRaisesRegex(RuntimeError, "HTTP 401"):
            RemoteDetector(url, token="wrong").predict(self.good)
        with self.assertLogs("model.server", level="ERROR"):
            with self.assertRaisesRegex(RuntimeError, "HTTP 500：ValueError: 无法解码"):
                RemoteDetector(url, token="secret").predict(self.bad)
        self.assertEqual(RemoteDetector(url, token="secret").predict(self.good)["height"], 1)

        def broken():
            raise FileNotFoundError("缺少权重")
        with self.assertLogs("model.server", level="ERROR"):
            server, url = self.serve(broken)
            with self.assertRaisesRegex(RuntimeError, "HTTP 503：.*缺少权重"):
                RemoteDetector(url).predict(self.good)
        self.assertEqual(server.runtime.health()["status"], "error")
        self.assertEqual(RemoteDetector(url).health()["status"], "error")
        with self.assertRaisesRegex(RuntimeError, "无法访问"):
            RemoteDetector("http://127.0.0.1:9", timeout=5).predict(self.good)
        offline = RemoteDetector("http://127.0.0.1:9").health()
        self.assertEqual((offline["status"], offline["device"]), ("offline", None))


if __name__ == "__main__":
    unittest.main()
