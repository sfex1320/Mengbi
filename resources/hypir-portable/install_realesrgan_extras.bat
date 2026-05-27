@echo off
REM ===================================================================
REM  Real-ESRGAN PyTorch 推理依赖安装(Phase B,2026-05-28)
REM
REM  不装 torch —— 假设 HYPIR Portable 已有 CUDA-enabled PyTorch
REM  本脚本补:realesrgan / basicsr / facexlib / gfpgan + 必备
REM
REM  注意:basicsr 在新版 torchvision (>=0.13) 下有 import 兼容问题
REM  (rgb_to_grayscale 移到了 functional_tensor),如装完报错见 README
REM ===================================================================

setlocal EnableDelayedExpansion
cd /d "%~dp0"

set "PORTABLE_ROOT=%CD%"
set "PY_EXE=%PORTABLE_ROOT%\runtime\python\python.exe"
set "REQ_FILE=%PORTABLE_ROOT%\app\realesrgan_server\requirements_locked.txt"

if not exist "%PY_EXE%" (
    echo [realesrgan-install][FATAL] portable Python missing: %PY_EXE%
    pause
    exit /b 20
)
if not exist "%REQ_FILE%" (
    echo [realesrgan-install][FATAL] requirements file missing: %REQ_FILE%
    pause
    exit /b 21
)

echo [realesrgan-install] checking PyTorch is installed...
"%PY_EXE%" -c "import torch; print('  torch=%s, cuda=%s' % (torch.__version__, torch.cuda.is_available()))"
if errorlevel 1 (
    echo [realesrgan-install][FATAL] torch not found. Run install_or_repair.bat first.
    pause
    exit /b 22
)

echo [realesrgan-install] installing Real-ESRGAN extras (Tsinghua mirror)...
"%PY_EXE%" -m pip install -r "%REQ_FILE%" -i https://pypi.tuna.tsinghua.edu.cn/simple
if errorlevel 1 (
    echo [realesrgan-install][WARN] mirror failed, retry default PyPI...
    "%PY_EXE%" -m pip install -r "%REQ_FILE%"
    if errorlevel 1 (
        echo [realesrgan-install][FATAL] pip install failed.
        pause
        exit /b 23
    )
)

echo [realesrgan-install] applying basicsr torchvision compat shim...
REM 新版 torchvision (>=0.13) 的 functional_tensor 模块被废弃,basicsr 的
REM degradations.py 直接 import 会失败。打一个 monkey-patch 让它能加载。
"%PY_EXE%" -c "import sys; from importlib import import_module; \
import torchvision.transforms.functional as F; \
sys.modules.setdefault('torchvision.transforms.functional_tensor', F); \
print('  functional_tensor shim ok')"

echo [realesrgan-install] verifying...
"%PY_EXE%" -c "import realesrgan, basicsr, facexlib, gfpgan, fastapi, uvicorn, pydantic, PIL, numpy; print('  all imports OK')"
if errorlevel 1 (
    echo [realesrgan-install][FATAL] post-install verification failed.
    pause
    exit /b 24
)

echo [realesrgan-install] DONE.
echo                       Next:
echo                       1. 下载模型到 models\realesrgan\ (RealESRGAN_x4plus.pth 等)
echo                       2. 需要 face_enhance: 下载 GFPGANv1.4.pth 到 models\gfpgan\
echo                       3. mengbi 设置 → 工具筱 → 启用 PyTorch 后端
exit /b 0
