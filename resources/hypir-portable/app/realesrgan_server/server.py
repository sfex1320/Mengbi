"""Real-ESRGAN PyTorch Portable HTTP server (端口 7869)。"""
from __future__ import annotations

import logging
import socket
import sys
import traceback

from .config import load_config, apply_offline_env, portable_root


def _setup_logging(logs_dir) -> None:
    logs_dir.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s | %(message)s",
        handlers=[logging.StreamHandler(sys.stdout)],
    )


def _port_in_use(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        try:
            s.bind((host, port))
            return False
        except OSError:
            return True


def main():
    try:
        cfg = load_config()
    except Exception as e:
        print(f"[realesrgan] config load failed: {e}", file=sys.stderr)
        sys.exit(2)

    _setup_logging(cfg.logs_abs)
    log = logging.getLogger("realesrgan.server")
    log.info("portable_root=%s", portable_root())
    log.info("config: host=%s port=%s realesrgan_models=%s gfpgan_models=%s",
             cfg.host, cfg.port, cfg.realesrgan_models_abs, cfg.gfpgan_models_abs)

    try:
        from app._common.parent_watchdog import start_parent_watchdog  # type: ignore
        start_parent_watchdog("realesrgan")
    except Exception as e:
        log.warning("parent watchdog 启动失败(不致命): %s", e)

    apply_offline_env(cfg)

    if _port_in_use(cfg.host, cfg.port):
        log.error("port %s:%s in use", cfg.host, cfg.port)
        sys.exit(3)

    try:
        from .api import create_app
        app = create_app(cfg)
    except Exception:
        log.exception("FastAPI app construction failed")
        print(traceback.format_exc(), file=sys.stderr)
        sys.exit(4)

    try:
        import uvicorn
    except ImportError:
        log.error("uvicorn not installed")
        sys.exit(5)

    log.info("Real-ESRGAN PyTorch server starting at http://%s:%s", cfg.host, cfg.port)
    uvicorn.run(app, host=cfg.host, port=cfg.port, log_level="info", access_log=False)


if __name__ == "__main__":
    main()
