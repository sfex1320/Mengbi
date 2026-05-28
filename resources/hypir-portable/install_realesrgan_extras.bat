@echo off
REM ===================================================================
REM  Real-ESRGAN PyTorch deps installer (2026-05-28, Phase B)
REM
REM  ASCII-only on purpose (Chinese Windows cmd.exe default codepage is
REM  GBK; UTF-8 chinese chars in bat = garbled commands).
REM
REM  Does NOT install torch -- assumes HYPIR Portable already has
REM  CUDA-enabled PyTorch. This script only adds:
REM    realesrgan / basicsr / facexlib / gfpgan + fastapi + uvicorn + pydantic
REM
REM  Note: basicsr has a known torchvision >= 0.13 incompatibility
REM  (rgb_to_grayscale moved). install applies a shim afterwards.
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
"%PY_EXE%" -c "import torch; print('  torch=%%s, cuda=%%s' %% (torch.__version__, torch.cuda.is_available()))"
if errorlevel 1 (
    echo [realesrgan-install][FATAL] torch not found. Run install_or_repair.bat first.
    pause
    exit /b 22
)

echo [realesrgan-install] step 1/2: real deps (opencv / lmdb / addict / future / numba / filterpy / fastapi / uvicorn / pydantic)...
REM Install runtime deps first so realesrgan+basicsr+gfpgan --no-deps later
REM can find everything they actually import.
"%PY_EXE%" -m pip install opencv-python lmdb addict future yapf numba filterpy "numpy<2.0.0" "Pillow>=10.0.0" "fastapi>=0.115.0" "uvicorn[standard]>=0.32.0" "pydantic>=2.7.0" -i https://pypi.tuna.tsinghua.edu.cn/simple
if errorlevel 1 (
    echo [realesrgan-install][WARN] mirror failed for deps, retry default PyPI...
    "%PY_EXE%" -m pip install opencv-python lmdb addict future yapf numba filterpy "numpy<2.0.0" "Pillow>=10.0.0" "fastapi>=0.115.0" "uvicorn[standard]>=0.32.0" "pydantic>=2.7.0"
    if errorlevel 1 (
        echo [realesrgan-install][FATAL] dep install failed.
        pause
        exit /b 23
    )
)

echo [realesrgan-install] step 2/2: realesrgan + basicsr + facexlib + gfpgan (--no-deps to skip broken tb-nightly)...
REM basicsr 1.4.2, gfpgan 1.3.8, and realesrgan 0.3.0 setup.py all declare
REM tb-nightly as required, but tb-nightly is not on PyPI/Tsinghua mirror
REM (it's PyTorch nightly index). Skip all 4 with --no-deps; runtime deps
REM are already installed above.
"%PY_EXE%" -m pip install realesrgan==0.3.0 basicsr==1.4.2 facexlib==0.3.0 gfpgan==1.3.8 --no-deps -i https://pypi.tuna.tsinghua.edu.cn/simple
if errorlevel 1 (
    "%PY_EXE%" -m pip install realesrgan==0.3.0 basicsr==1.4.2 facexlib==0.3.0 gfpgan==1.3.8 --no-deps
    if errorlevel 1 (
        echo [realesrgan-install][FATAL] realesrgan/basicsr/facexlib/gfpgan install failed.
        pause
        exit /b 24
    )
)

echo [realesrgan-install] patching basicsr degradations.py for new torchvision...
REM basicsr/data/degradations.py line 8: from torchvision.transforms.functional_tensor import rgb_to_grayscale
REM In newer torchvision (>=0.13), rgb_to_grayscale lives in torchvision.transforms.functional.
REM Static import = no runtime shim helps. Edit the source line in place.
REM Use importlib.util.find_spec (metadata only) to find path WITHOUT triggering basicsr's broken __init__.
REM Note: avoid `!=` (cmd EnableDelayedExpansion eats the `!`). Use `not equal` via flip-if.
"%PY_EXE%" -c "from importlib.util import find_spec; import pathlib; spec=find_spec('basicsr'); root=pathlib.Path(spec.submodule_search_locations[0]); p=root/'data'/'degradations.py'; t=p.read_text(encoding='utf-8'); n=t.replace('from torchvision.transforms.functional_tensor import rgb_to_grayscale','from torchvision.transforms.functional import rgb_to_grayscale'); p.write_text(n, encoding='utf-8'); print('  already patched' if n==t else '  patched')"

echo [realesrgan-install] verifying...
"%PY_EXE%" -c "import realesrgan, basicsr, facexlib, gfpgan, fastapi, uvicorn, pydantic, PIL, numpy; print('  all imports OK')"
if errorlevel 1 (
    echo [realesrgan-install][FATAL] post-install verification failed.
    pause
    exit /b 24
)

echo [realesrgan-install] DONE.
echo                       Next:
echo                       1. Download .pth models to models\realesrgan\ (RealESRGAN_x4plus.pth etc.)
echo                       2. For face_enhance: download GFPGANv1.4.pth to models\gfpgan\
echo                       3. mengbi Settings - Toolbox - enable PyTorch backend
exit /b 0
