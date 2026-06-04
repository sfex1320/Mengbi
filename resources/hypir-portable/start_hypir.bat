@echo off
REM ===================================================================
REM  HYPIR Portable launcher
REM
REM  ASCII-only on purpose: cmd default codepage is GBK on zh-CN Windows,
REM  and UTF-8 multi-byte chars often get mis-decoded as GBK seqs that
REM  consume '(' or ')' bytes, breaking parser. Keep it ASCII.
REM ===================================================================

setlocal EnableDelayedExpansion
cd /d "%~dp0"

REM ---- path constants ----
set "PORTABLE_ROOT=%CD%"
set "PY_HOME=%PORTABLE_ROOT%\runtime\python"
set "PY_EXE=%PY_HOME%\python.exe"
set "HYPIR_SRC=%PORTABLE_ROOT%\app\HYPIR"
set "HYPIR_WEIGHTS=%PORTABLE_ROOT%\models\hypir\HYPIR_sd2.pth"
set "SD21_DIR=%PORTABLE_ROOT%\models\sd2_1_base"
set "LOGS_DIR=%PORTABLE_ROOT%\logs"
set "LOG_FILE=%LOGS_DIR%\hypir.log"

if not exist "%LOGS_DIR%" mkdir "%LOGS_DIR%"

REM ---- env isolation: all caches stay inside portable bundle ----
set "HF_HOME=%PORTABLE_ROOT%\cache\huggingface"
set "TRANSFORMERS_CACHE=%HF_HOME%\transformers"
set "HF_DATASETS_CACHE=%HF_HOME%\datasets"
set "HF_HUB_CACHE=%HF_HOME%\hub"
set "TORCH_HOME=%PORTABLE_ROOT%\cache\torch"
set "HF_HUB_OFFLINE=1"
set "TRANSFORMERS_OFFLINE=1"
set "PYTHONIOENCODING=utf-8"
REM NOTE: Embedded Python ignores PYTHONPATH (uses _pth file instead).
REM Workaround: run_server.py does sys.path.insert(0, portable_root) before importing.
REM Still set PYTHONPATH for non-embedded edge cases.
set "PYTHONPATH=%PORTABLE_ROOT%;%PYTHONPATH%"

REM ---- preflight checks ----
echo [hypir] preflight checks...

if not exist "%PY_EXE%" (
    echo [hypir][FATAL] portable Python missing: %PY_EXE%
    echo                Unzip Windows embeddable Python into runtime\python\ then run install_or_repair.bat
    pause
    exit /b 10
)

if not exist "%HYPIR_SRC%" (
    echo [hypir][FATAL] HYPIR source missing: %HYPIR_SRC%
    echo                git clone https://github.com/XPixelGroup/HYPIR "%HYPIR_SRC%"
    pause
    exit /b 11
)

if not exist "%HYPIR_WEIGHTS%" (
    echo [hypir][FATAL] HYPIR weights missing: %HYPIR_WEIGHTS%
    echo                Place HYPIR_sd2.pth under models\hypir\
    pause
    exit /b 12
)

if not exist "%SD21_DIR%" (
    echo [hypir][FATAL] SD 2.1 base missing: %SD21_DIR%
    echo                Place diffusers-format SD 2.1 base under models\sd2_1_base\
    pause
    exit /b 13
)

REM check torch CUDA
"%PY_EXE%" -c "import torch, sys; sys.exit(0 if torch.cuda.is_available() else 20)"
if errorlevel 20 (
    echo [hypir][FATAL] PyTorch sees no CUDA. Maybe CPU-only torch was installed, or NVIDIA driver issue.
    echo                Run test_env.bat for details.
    pause
    exit /b 14
)
if errorlevel 1 (
    echo [hypir][FATAL] torch import failed. Run install_or_repair.bat to reinstall deps.
    pause
    exit /b 15
)

REM port check (default 7865)
"%PY_EXE%" -c "import socket; s=socket.socket(); r=s.connect_ex(('127.0.0.1',7865)); s.close(); exit(0 if r else 16)"
if errorlevel 16 (
    echo [hypir][FATAL] port 127.0.0.1:7865 already in use. Stop the other process or change port in config\hypir_config.json
    pause
    exit /b 16
)

REM ---- launch ----
echo [hypir] preflight OK. Launching server, log -^> %LOG_FILE%
echo [hypir] press Ctrl+C in this window to stop gracefully.

"%PY_EXE%" "%PORTABLE_ROOT%\run_server.py" >> "%LOG_FILE%" 2>&1
exit /b %errorlevel%
