@echo off
REM ===================================================================
REM  HYPIR Portable dependency installer / repairer
REM
REM  ASCII-only on purpose (see start_hypir.bat header for why).
REM  Installs PyTorch CUDA build + other deps into portable Python.
REM  Pre-req: runtime\python\python.exe must exist, pip must be bootstrapped.
REM ===================================================================

setlocal EnableDelayedExpansion
cd /d "%~dp0"

set "PORTABLE_ROOT=%CD%"
set "PY_HOME=%PORTABLE_ROOT%\runtime\python"
set "PY_EXE=%PY_HOME%\python.exe"
set "REQ=%PORTABLE_ROOT%\app\hypir_server\requirements_locked.txt"

REM PyTorch CUDA wheels (must come from PyTorch index, NOT PyPI)
REM cu128 build is required for Blackwell (RTX 50-series, sm_120).
REM cu121 only supports up to sm_90 - 5090 will fail with "no kernel image".
set "TORCH_INDEX=https://download.pytorch.org/whl/cu128"
set "TORCH_VERSION=torch torchvision"

REM PyPI mirror (uncomment for China users)
REM set "PYPI_INDEX=-i https://pypi.tuna.tsinghua.edu.cn/simple"
set "PYPI_INDEX="

if not exist "%PY_EXE%" (
    echo [FATAL] portable Python missing: %PY_EXE%
    echo         Unzip embeddable Python into runtime\python\ first. See README.
    pause
    exit /b 1
)

REM Verify pip is bootstrapped
"%PY_EXE%" -m pip --version >nul 2>&1
if errorlevel 1 (
    echo [hypir] pip not found, attempting ensurepip...
    "%PY_EXE%" -m ensurepip --upgrade 2>nul
    if errorlevel 1 (
        echo [FATAL] ensurepip failed. Embeddable Python needs get-pip.py bootstrap.
        echo         See README section 3.
        pause
        exit /b 2
    )
)

echo [hypir] upgrading pip / wheel...
"%PY_EXE%" -m pip install -U pip wheel %PYPI_INDEX%

echo.
echo [hypir] installing PyTorch CUDA build from %TORCH_INDEX% ...
"%PY_EXE%" -m pip install --index-url %TORCH_INDEX% %TORCH_VERSION%
if errorlevel 1 (
    echo [FATAL] PyTorch install failed. Check network.
    pause
    exit /b 3
)

echo.
echo [hypir] installing other deps from %REQ% ...
"%PY_EXE%" -m pip install -r "%REQ%" %PYPI_INDEX%
if errorlevel 1 (
    echo [FATAL] requirements install failed.
    pause
    exit /b 4
)

echo.
REM ─── triton-windows: torch.compile UNet 加速的前置依赖 ─────────────
REM 没装的话 compile_helper.is_compile_available() 会 silently 返回 False,
REM Python 端 compile_attr 跳过编译,torch.compile 加速失效。
REM Windows 上 triton 必须用 triton-windows 这个 fork(pip 包名),不是 triton。
echo [hypir] installing triton-windows (for torch.compile UNet acceleration) ...
"%PY_EXE%" -m pip install triton-windows %PYPI_INDEX%
if errorlevel 1 (
    echo [hypir][WARN] triton-windows install failed. torch.compile will silently fall back to eager mode.
    REM 不 exit,因为 HYPIR 没 compile 也能跑,只是少 15-30%% 加速
)

echo.
echo [hypir] verifying install...
"%PY_EXE%" -c "import torch; print('torch', torch.__version__, 'cuda', torch.cuda.is_available())"
"%PY_EXE%" -c "import triton; print('triton', triton.__version__)" 2>nul || echo [hypir][INFO] triton not available, torch.compile will be skipped

echo.
echo [hypir] install complete. Run test_env.bat for full self-check.
pause
exit /b 0
