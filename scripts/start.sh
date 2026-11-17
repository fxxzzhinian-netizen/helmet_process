#!/bin/sh
# Starts the model service and the website. Ctrl+C stops both.
# Set HELMET_MODEL_URL to use a model service running elsewhere; then only the website starts.
set -eu
cd "$(dirname "$0")/.."
web_python=${HELMET_PYTHON:-.venv/bin/python}
has() {
    python=$1
    shift
    "$python" -c "import importlib.util as u, sys; sys.exit(any(u.find_spec(m) is None for m in sys.argv[1:]))" "$@"
}
if ! has "$web_python" flask waitress filelock PIL cv2; then
    echo '网站的 Python 环境缺少依赖，请执行 pip install -r backend/requirements.txt。' >&2
    exit 1
fi
if [ ! -f "${HELMET_FRONTEND_DIST:-frontend/dist}/index.html" ]; then
    echo '请先运行 npm --prefix frontend ci 和 npm --prefix frontend run build。' >&2
    exit 1
fi
if [ -z "${HELMET_MODEL_URL:-}" ]; then
    model_python=${HELMET_MODEL_PYTHON:-$web_python}
    model_dir=${HELMET_MODEL_DIR:-model/runtime/CoDETR_v1_epoch_2}
    model_port=${HELMET_MODEL_PORT:-8766}
    if ! has "$model_python" mmcv torch; then
        echo '请按 README 准备包含 Co-DETR 依赖的 Python 3.11 环境。' >&2
        exit 1
    fi
    if [ ! -f "$model_dir/weights/v1_epoch_2.pth" ]; then
        echo '未找到 v1_epoch_2.pth。将交付包解压到 model/runtime，或设置 HELMET_MODEL_DIR。' >&2
        exit 1
    fi
    "$model_python" -m model.server --port "$model_port" &
    model_pid=$!
    trap 'kill "$model_pid" 2>/dev/null || true' EXIT
    trap 'exit 130' INT TERM
    export HELMET_MODEL_URL="http://127.0.0.1:$model_port"
fi
"$web_python" -m backend --host "${HELMET_HOST:-127.0.0.1}" --port "${HELMET_PORT:-8765}"
