"""
HYPIR Portable launcher.

为什么需要这个文件而不直接 `python -m app.hypir_server.server`：
Windows 嵌入版 Python（embeddable）**忽略 PYTHONPATH 环境变量**
（官方文档明确说明），所以 bat 里设 PYTHONPATH 没用。
直接在脚本里 sys.path.insert(0, ...) 把 portable 根加进来，让 'app' 包被找到。
"""
import os
import sys
from pathlib import Path

# 本文件就在 portable 根目录，所以 __file__ 的父目录就是根
PORTABLE_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(PORTABLE_ROOT))

# 让 cwd 也是 portable 根（config.py 用 os.getcwd() 解析相对路径）
os.chdir(str(PORTABLE_ROOT))

from app.hypir_server.server import main  # noqa: E402

if __name__ == "__main__":
    main()
