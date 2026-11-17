"""Run the released Co-DETR entry point and report panels and boxes in original-image pixels.

For stacked two-panel captures it also reports which part of the bottom panel the top panel shows."""
import hashlib
import importlib.util
import os
import sys
from pathlib import Path
from threading import Lock

from .crop import mark_crop

MODEL_VERSION = "Co-DETR v1 epoch 2"
WEIGHTS_SHA256 = "744b026d86affdfd04cf65076d42e4d07da36024f4c9c70eef53e238af90682e"
CONFIG_SHA256 = "989b61bb8f74203122110e5455cd3e71f1708405dfccb930cbdca2b1c7d5b0b6"
ENTRY_HASHES = {
    "infer.py": "6810567ca4c5122b6964300ede89c01f1bfe08a1d1490702b94a76ce71bdb10b",
    "infer_windows.py": "bf594c5e534d6a014caeeb9eafecb2f3080e5293861a6b879c139875ac50f9bd",
    "layouts.py": "395f0a803cebdd14b691ca08895b0f97c0470f4b2ac34163b94a5209dc9ece3f",
    "cpu_query_chunks.py": "b876c06d87755dd263f4636d2348f738bdf823f0bbb7f31b5b39ea608fe7d64d",
}


class Detector:
    version = MODEL_VERSION

    def __init__(self):
        default = Path(__file__).resolve().parent / "runtime" / "CoDETR_v1_epoch_2"
        root = Path(os.environ.get("HELMET_MODEL_DIR", default)).expanduser().resolve()
        self.device = os.environ.get("HELMET_DEVICE", "cpu")
        if self.device not in ("cpu", "cuda:0"):
            raise ValueError("HELMET_DEVICE 须为 cpu 或 cuda:0")
        portable = self.device == "cuda:0" or os.name == "nt"
        entry = "infer_windows.py" if portable else "infer.py"
        for name in (entry, "layouts.py", "cpu_query_chunks.py"):
            if not (root / name).is_file():
                raise FileNotFoundError(f"缺少模型交付文件 {root / name}，请检查 HELMET_MODEL_DIR")
            if hashlib.sha256((root / name).read_bytes()).hexdigest() != ENTRY_HASHES[name]:
                raise ValueError(f"模型交付文件校验失败 {root / name}")
        sys.path.insert(0, str(root))
        spec = importlib.util.spec_from_file_location("helmet_codetr_infer", root / entry)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        import cv2
        cv2.setNumThreads(1)
        # Both pinned entries verify the weight and config before loading the checkpoint.
        self._detect = module.detector(self.device) if portable else module.detector()
        self._infer = module.infer
        self._lock = Lock()

    def predict(self, path):
        path = Path(path)
        with self._lock:
            result = adapt(self._infer(path, self._detect), self.device)
            mark_crop(result["panels"], path)
            return result


def adapt(raw, device):
    detections, panels = [], []
    for panel in raw["panels"]:
        name = panel["view"]
        panels.append({"id": name, "box": list(panel["panel_xyxy"])})
        for index, obj in enumerate(panel["detections"]):
            box = obj["xyxy"]
            if obj["confidence"] < 0.25 or box[2] <= box[0] or box[3] <= box[1]:
                continue
            detections.append({"id": f"{name}-{index}", "box": box, "panel": name,
                               "label": obj["class_name"], "confidence": obj["confidence"]})
    # Conclusions and vehicle events are decided by the backend rules, not here.
    return {
        "model_version": MODEL_VERSION, "weights_sha256": WEIGHTS_SHA256,
        "config_sha256": CONFIG_SHA256, "device": device,
        "image_sha256": raw["image_sha256"], "width": raw["width"], "height": raw["height"],
        "panels": panels, "detections": detections,
    }
