@echo off
REM ===================================================================
REM  Real-ESRGAN PyTorch Portable launcher (port 7869)
REM  Shares Python runtime + cache with HYPIR / SUPIR Portable.
REM ===================================================================

setlocal EnableDelayedExpansion
cd /d "%~dp0"

set "PORTABLE_ROOT=%CD%"
set "PY_EXE=%PORTABLE_ROOT%\runtime\python\python.exe"
set "LOGS_DIR=%PORTABLE_ROOT%\logs"
set "LOG_FILE=%LOGS_DIR%\realesrgan.log"

if not exist "%LOGS_DIR%" mkdir "%LOGS_DIR%"

set "HF_HOME=%PORTABLE_ROOT%\cache\huggingface"
set "TORCH_HOME=%PORTABLE_ROOT%\cache\torch"
set "PYTHONIOENCODING=utf-8"
set "PYTHONPATH=%PORTABLE_ROOT%;%PYTHONPATH%"

echo [realesrgan] preflight checks...

if not exist "%PY_EXE%" (
    echo [realesrgan][FATAL] portable Python missing: %PY_EXE%
    echo                     Install HYPIR Portable first.
    pause
    exit /b 20
)

"%PY_EXE%" -c "import torch, realesrgan; print('  torch=%s realesrgan=%s' % (torch.__version__, realesrgan.__version__))"
if errorlevel 1 (
    echo [realesrgan][FATAL] torch or realesrgan missing. Run install_realesrgan_extras.bat
    pause
    exit /b 25
)

"%PY_EXE%" -c "import socket; s=socket.socket(); r=s.connect_ex(('127.0.0.1',7869)); s.close(); exit(0 if r else 26)"
if errorlevel 26 (
    echo [realesrgan][FATAL] port 127.0.0.1:7869 already in use.
    pause
    exit /b 26
)

echo [realesrgan] preflight OK. launching server, log -^> %LOG_FILE%

"%PY_EXE%" "%PORTABLE_ROOT%\run_realesrgan_server.py" >> "%LOG_FILE%" 2>&1
exit /b %errorlevel%
