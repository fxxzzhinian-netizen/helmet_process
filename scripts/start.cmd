@echo off
rem Windows launcher, equivalent to scripts/start.sh. Double-click or run from a terminal.
rem Starts the model service and the website in this window. Ctrl+C stops both.
rem Set HELMET_MODEL_URL to use a model service running elsewhere; then only the website starts.
rem Other overrides: HELMET_PYTHON, HELMET_MODEL_PYTHON, HELMET_MODEL_DIR, HELMET_MODEL_PORT,
rem HELMET_MODEL_TOKEN, HELMET_DEVICE, HELMET_DATA_DIR, HELMET_HOST, HELMET_PORT.
setlocal
cd /d "%~dp0.."

set "WEB_PYTHON=.venv\Scripts\python.exe"
if defined HELMET_PYTHON set "WEB_PYTHON=%HELMET_PYTHON%"
set "MODEL_PYTHON=%WEB_PYTHON%"
if defined HELMET_MODEL_PYTHON set "MODEL_PYTHON=%HELMET_MODEL_PYTHON%"
set "MODEL_DIR=model\runtime\CoDETR_v1_epoch_2"
if defined HELMET_MODEL_DIR set "MODEL_DIR=%HELMET_MODEL_DIR%"
set "DIST_DIR=frontend\dist"
if defined HELMET_FRONTEND_DIST set "DIST_DIR=%HELMET_FRONTEND_DIST%"
if not defined HELMET_HOST set "HELMET_HOST=127.0.0.1"
if not defined HELMET_PORT set "HELMET_PORT=8765"

"%WEB_PYTHON%" -c "import importlib.util as u, sys; sys.exit(any(u.find_spec(m) is None for m in ('flask', 'waitress', 'filelock', 'PIL', 'cv2')))"
if errorlevel 1 (
    echo Website Python is missing packages. Run: pip install -r backend\requirements.txt
    goto :fail
)
if not exist "%DIST_DIR%\index.html" (
    echo Frontend build not found. Run: npm --prefix frontend ci ^&^& npm --prefix frontend run build
    goto :fail
)
if defined HELMET_MODEL_URL goto :web

"%MODEL_PYTHON%" -c "import importlib.util as u, sys; sys.exit(any(u.find_spec(m) is None for m in ('mmcv', 'torch')))"
if errorlevel 1 (
    echo Model Python is missing mmcv or torch. See model\README.md for setup.
    goto :fail
)
if not exist "%MODEL_DIR%\weights\v1_epoch_2.pth" (
    echo v1_epoch_2.pth not found. Extract the release package to model\runtime or set HELMET_MODEL_DIR.
    goto :fail
)
if not defined HELMET_DEVICE set "HELMET_DEVICE=cuda:0"
if not defined HELMET_MODEL_PORT set "HELMET_MODEL_PORT=8766"
set "HELMET_MODEL_URL=http://127.0.0.1:%HELMET_MODEL_PORT%"
echo Starting model service on %HELMET_DEVICE%
start "" /b "%MODEL_PYTHON%" -X utf8 -m model.server --port %HELMET_MODEL_PORT%

:web
echo Model service: %HELMET_MODEL_URL%
echo Open http://%HELMET_HOST%:%HELMET_PORT%/ in a browser. Keep this window open, press Ctrl+C to stop.
"%WEB_PYTHON%" -X utf8 -m backend --host %HELMET_HOST% --port %HELMET_PORT%
exit /b %errorlevel%

:fail
if "%HELMET_NO_PAUSE%"=="" pause
exit /b 1
