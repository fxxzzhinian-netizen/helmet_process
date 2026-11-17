"""Send each image to the standalone model service and return its JSON result."""
import json
import os
import urllib.error
import urllib.request
from pathlib import Path


class RemoteDetector:
    def __init__(self, url=None, token=None, timeout=None):
        self.url = (url or os.getenv("HELMET_MODEL_URL") or "http://127.0.0.1:8766").rstrip("/")
        self.token = token or os.getenv("HELMET_MODEL_TOKEN")
        # The first request also waits for the model to load.
        self.timeout = float(timeout or os.getenv("HELMET_MODEL_TIMEOUT") or 900)

    def health(self):
        """Ask the model service for its state. Reports `offline` instead of raising."""
        try:
            with urllib.request.urlopen(self.url + "/health", timeout=3) as response:
                state = json.load(response)
            return {key: state.get(key) for key in ("status", "error", "model_version", "device")}
        except (OSError, ValueError, AttributeError) as exc:
            return {"status": "offline", "error": f"模型服务 {self.url} 无法访问：{exc}",
                    "model_version": None, "device": None}

    def predict(self, path):
        headers = {"Content-Type": "application/octet-stream"}
        if self.token:
            headers["Authorization"] = "Bearer " + self.token
        request = urllib.request.Request(self.url + "/predict", data=Path(path).read_bytes(),
                                         headers=headers, method="POST")
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                return json.load(response)
        except urllib.error.HTTPError as exc:
            body = exc.read()
            try:
                detail = json.loads(body)["error"]
            except (ValueError, KeyError, TypeError):
                detail = body[:200].decode("utf-8", "replace")
            raise RuntimeError(f"模型服务返回 HTTP {exc.code}：{detail}") from exc
        except (OSError, ValueError) as exc:
            raise RuntimeError(f"模型服务 {self.url} 无法访问或返回无效数据：{exc}") from exc
