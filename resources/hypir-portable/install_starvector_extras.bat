@echo off
REM ===================================================================
REM  StarVector 推理依赖安装(2026-05-27,Phase 3)
REM
REM  不装 torch —— 假设 HYPIR Portable 的 install_or_repair.bat 已装好
REM  CUDA-enabled PyTorch。本脚本只补 StarVector 推理本身需要的:
REM    transformers / accelerate / safetensors / pillow / fastapi / uvicorn / pydantic
REM
REM  用国内源(清华)避免外网卡顿。
REM ===================================================================

setlocal EnableDelayedExpansion
cd /d "%~dp0"

set "PORTABLE_ROOT=%CD%"
set "PY_EXE=%PORTABLE_ROOT%\runtime\python\python.exe"
set "REQ_FILE=%PORTABLE_ROOT%\app\starvector_server\requirements_locked.txt"

if not exist "%PY_EXE%" (
    echo [starvector-install][FATAL] portable Python missing: %PY_EXE%
    echo                            Run HYPIR install_or_repair.bat first.
    pause
    exit /b 20
)

if not exist "%REQ_FILE%" (
    echo [starvector-install][FATAL] requirements file missing: %REQ_FILE%
    pause
    exit /b 21
)

echo [starvector-install] checking PyTorch is installed...
"%PY_EXE%" -c "import torch; print('  torch=%s, cuda=%s' % (torch.__version__, torch.cuda.is_available()))"
if errorlevel 1 (
    echo [starvector-install][FATAL] torch not found. Run install_or_repair.bat first.
    pause
    exit /b 22
)

echo [starvector-install] installing StarVector extras (use Tsinghua mirror)...
"%PY_EXE%" -m pip install -r "%REQ_FILE%" -i https://pypi.tuna.tsinghua.edu.cn/simple
if errorlevel 1 (
    echo [starvector-install][WARN] Tsinghua mirror failed, retrying with default PyPI...
    "%PY_EXE%" -m pip install -r "%REQ_FILE%"
    if errorlevel 1 (
        echo [starvector-install][FATAL] pip install failed.
        pause
        exit /b 23
    )
)

echo [starvector-install] verifying...
"%PY_EXE%" -c "import transformers, accelerate, safetensors, PIL, fastapi, uvicorn, pydantic; print('  all imports OK')"
if errorlevel 1 (
    echo [starvector-install][FATAL] post-install verification failed.
    pause
    exit /b 24
)

echo [starvector-install] DONE.
echo                       Next: 把 starvector-1b-im2svg 模型目录放到
echo                              models\starvector-1b-im2svg\
echo                       或在 mengbi 设置里填 vec_starvector_path = 绝对路径
exit /b 0
