"""
Real-ESRGAN PyTorch Portable launcher.
embed Python 忽略 PYTHONPATH,需 sys.path.insert(0, portable_root) 后 import 'app'。
"""
import os
import sys
from pathlib import Path

PORTABLE_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(PORTABLE_ROOT))
os.chdir(str(PORTABLE_ROOT))

from app.realesrgan_server.server import main  # noqa: E402

if __name__ == "__main__":
    main()
