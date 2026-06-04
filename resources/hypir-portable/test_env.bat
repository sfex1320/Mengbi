@echo off
REM ===================================================================
REM  HYPIR Portable environment self-test
REM
REM  ASCII-only on purpose (see start_hypir.bat header for why).
REM  Output goes to screen + logs\env_check.txt
REM ===================================================================

setlocal EnableDelayedExpansion
cd /d "%~dp0"

set "PORTABLE_ROOT=%CD%"
set "PY_EXE=%PORTABLE_ROOT%\runtime\python\python.exe"
set "REPORT=%PORTABLE_ROOT%\logs\env_check.txt"
if not exist "%PORTABLE_ROOT%\logs" mkdir "%PORTABLE_ROOT%\logs"

REM Lock cache paths (avoid writing to user home during probe)
set "HF_HOME=%PORTABLE_ROOT%\cache\huggingface"
set "TRANSFORMERS_CACHE=%HF_HOME%\transformers"
set "TORCH_HOME=%PORTABLE_ROOT%\cache\torch"
set "PYTHONIOENCODING=utf-8"

echo ============== HYPIR Portable env check ============== > "%REPORT%"
echo time: %DATE% %TIME% >> "%REPORT%"
echo root: %PORTABLE_ROOT% >> "%REPORT%"
echo. >> "%REPORT%"

REM nvidia-smi (driver lives outside portable bundle)
echo ---- nvidia-smi ---- >> "%REPORT%"
nvidia-smi >> "%REPORT%" 2>&1
if errorlevel 1 (
    echo [WARN] nvidia-smi unavailable: no NVIDIA driver or not in PATH >> "%REPORT%"
)
echo. >> "%REPORT%"

REM Portable Python
echo ---- portable Python ---- >> "%REPORT%"
if not exist "%PY_EXE%" (
    echo [FATAL] %PY_EXE% missing >> "%REPORT%"
    type "%REPORT%"
    exit /b 1
)
"%PY_EXE%" --version >> "%REPORT%" 2>&1
echo. >> "%REPORT%"

REM Python-side full check
echo ---- python probe ---- >> "%REPORT%"
"%PY_EXE%" -c "exec(open(r'%PORTABLE_ROOT%\app\hypir_server\_check.py', 'r', encoding='utf-8').read())" >> "%REPORT%" 2>&1

type "%REPORT%"
echo.
echo report saved -^> %REPORT%
pause
exit /b 0
