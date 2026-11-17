#!/bin/bash
set -euo pipefail
ROOT=/opt/helmet-review
RELEASE="$ROOT/releases/20261115-consensus-v2"
PY="$ROOT/venv/bin/python"
export PIP_DISABLE_PIP_VERSION_CHECK=1
export PIP_PROGRESS_BAR=off
INDEX=https://mirrors.cloud.tencent.com/pypi/simple

"$PY" -m pip install --index-url "$INDEX" --upgrade pip setuptools==69.5.1 numpy==1.26.4
# The Linux PyPI torch 2.1.0 wheel uses CUDA 12.1 with separately packaged NVIDIA libraries.
"$PY" -m pip install --index-url "$INDEX" torch==2.1.0 torchvision==0.16.0
"$PY" -m pip install --index-url "$INDEX" -r "$RELEASE/deploy/linux-cu121.txt" \
    -r "$RELEASE/backend/requirements.txt" \
    "$RELEASE/model/runtime/CoDETR_v1_epoch_2/env/wheels/fairscale-0.4.13-py3-none-any.whl"
"$PY" - <<'PY'
import torch
from mmcv.ops import nms
assert torch.cuda.is_available(), 'CUDA unavailable; refusing a CPU fallback'
assert torch.version.cuda == '12.1', torch.version.cuda
boxes = torch.tensor([[0., 0., 4., 4.]], device='cuda')
nms(boxes, torch.ones(1, device='cuda'), 0.5)
print('CUDA_OPS_OK', torch.__version__, torch.cuda.get_device_name(0), flush=True)
PY
