"""
StarVector Portable launcher(对应 HYPIR 的 run_server.py / SUPIR 的 run_supir_server.py)。

embed Python 忽略 PYTHONPATH,需要 sys.path.insert(0, portable_root) 后才 import 'app'。
"""
import os
import sys
from pathlib import Path

PORTABLE_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(PORTABLE_ROOT))
os.chdir(str(PORTABLE_ROOT))

from app.starvector_server.server import main  # noqa: E402

if __name__ == "__main__":
    main()
