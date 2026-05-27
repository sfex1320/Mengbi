@echo off
REM ===================================================================
REM  StarVector Portable launcher (port 7867)
REM
REM  Shares Python runtime + cache with HYPIR / SUPIR Portable.
REM  Engine-specific: app/starvector_server/, models/starvector-1b-im2svg/
REM
REM  Model path can be overridden via env var MENGBI_STARVECTOR_MODEL_PATH
REM  (mengbi 在 start 时通过 spawn env 传入用户设置里的绝对路径)
REM ===================================================================

setlocal EnableDelayedExpansion
cd /d "%~dp0"

set "PORTABLE_ROOT=%CD%"
set "PY_HOME=%PORTABLE_ROOT%\runtime\python"
set "PY_EXE=%PY_HOME%\python.exe"
set "LOGS_DIR=%PORTABLE_ROOT%\logs"
set "LOG_FILE=%LOGS_DIR%\starvector.log"

if not exist "%LOGS_DIR%" mkdir "%LOGS_DIR%"

set "HF_HOME=%PORTABLE_ROOT%\cache\huggingface"
set "TRANSFORMERS_CACHE=%HF_HOME%\transformers"
set "HF_DATASETS_CACHE=%HF_HOME%\datasets"
set "HF_HUB_CACHE=%HF_HOME%\hub"
set "TORCH_HOME=%PORTABLE_ROOT%\cache\torch"
set "HF_HUB_OFFLINE=1"
set "TRANSFORMERS_OFFLINE=1"
set "PYTHONIOENCODING=utf-8"
set "PYTHONPATH=%PORTABLE_ROOT%;%PYTHONPATH%"

echo [starvector] preflight checks...

if not exist "%PY_EXE%" (
    echo [starvector][FATAL] portable Python missing: %PY_EXE%
    echo                     Install HYPIR Portable first - StarVector shares its Python runtime.
    pause
    exit /b 20
)

REM 验证 torch + transformers 装齐(可选;失败给出明确提示)
"%PY_EXE%" -c "import torch, transformers; print('[starvector] torch=%s transformers=%s' % (torch.__version__, transformers.__version__))"
if errorlevel 1 (
    echo [starvector][FATAL] torch or transformers missing. Run install_starvector_extras.bat
    pause
    exit /b 25
)

REM 模型路径检查 — 优先用环境变量传入的绝对路径
if not "%MENGBI_STARVECTOR_MODEL_PATH%"=="" (
    set "MODEL_DIR=%MENGBI_STARVECTOR_MODEL_PATH%"
) else (
    set "MODEL_DIR=%PORTABLE_ROOT%\models\starvector-1b-im2svg"
)
if not exist "!MODEL_DIR!" (
    echo [starvector][FATAL] model dir not found: !MODEL_DIR!
    echo                     Set vec_starvector_path in mengbi settings,
    echo                     or download to models\starvector-1b-im2svg\
    pause
    exit /b 21
)

REM 端口占用检查
"%PY_EXE%" -c "import socket; s=socket.socket(); r=s.connect_ex(('127.0.0.1',7867)); s.close(); exit(0 if r else 26)"
if errorlevel 26 (
    echo [starvector][FATAL] port 127.0.0.1:7867 already in use.
    pause
    exit /b 26
)

echo [starvector] preflight OK. model=!MODEL_DIR!
echo [starvector] launching server, log -^> %LOG_FILE%

"%PY_EXE%" "%PORTABLE_ROOT%\run_starvector_server.py" >> "%LOG_FILE%" 2>&1
exit /b %errorlevel%
