"""Real-ESRGAN PyTorch Portable 配置(端口 7869)。"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict


def portable_root() -> Path:
    return Path(os.getcwd()).resolve()


@dataclass
class RealEsrganConfig:
    host: str = "127.0.0.1"
    port: int = 7869

    # 模型根目录 — 内置 .pth 都放这下面(对应 ModelSpec.relPath)
    realesrgan_models_dir: str = "models/realesrgan"
    gfpgan_models_dir: str = "models/gfpgan"

    # I/O 目录(与 HYPIR / SUPIR 共用)
    input_dir: str = "input"
    output_dir: str = "output"
    temp_dir: str = "temp"
    logs_dir: str = "logs"

    # 默认推理参数
    default_tile: int = 0
    default_tile_pad: int = 10
    default_half_precision: bool = True

    eager_load_models: bool = False

    huggingface_cache_dir: str = "cache/huggingface"
    torch_cache_dir: str = "cache/torch"

    extra: Dict[str, Any] = field(default_factory=dict)

    def abs(self, rel: str) -> Path:
        return (portable_root() / rel).resolve()

    @property
    def realesrgan_models_abs(self) -> Path:
        return self.abs(self.realesrgan_models_dir)

    @property
    def gfpgan_models_abs(self) -> Path:
        return self.abs(self.gfpgan_models_dir)

    @property
    def input_abs(self) -> Path:
        return self.abs(self.input_dir)

    @property
    def output_abs(self) -> Path:
        return self.abs(self.output_dir)

    @property
    def temp_abs(self) -> Path:
        return self.abs(self.temp_dir)

    @property
    def logs_abs(self) -> Path:
        return self.abs(self.logs_dir)


def load_config() -> RealEsrganConfig:
    cfg_path = portable_root() / "config" / "realesrgan_config.json"
    raw: Dict[str, Any] = {}
    if cfg_path.exists():
        try:
            raw = json.loads(cfg_path.read_text(encoding="utf-8"))
        except Exception as e:
            raise RuntimeError(f"realesrgan_config.json 解析失败:{e}")

    known = {f.name for f in RealEsrganConfig.__dataclass_fields__.values()}
    kwargs = {k: v for k, v in raw.items() if k in known}
    extra = {k: v for k, v in raw.items() if k not in known}
    cfg = RealEsrganConfig(**kwargs, extra=extra)
    for d in (cfg.input_abs, cfg.output_abs, cfg.temp_abs, cfg.logs_abs,
              cfg.realesrgan_models_abs, cfg.gfpgan_models_abs):
        d.mkdir(parents=True, exist_ok=True)
    return cfg


def apply_offline_env(cfg: RealEsrganConfig) -> None:
    hf_cache = cfg.abs(cfg.huggingface_cache_dir)
    torch_cache = cfg.abs(cfg.torch_cache_dir)
    hf_cache.mkdir(parents=True, exist_ok=True)
    torch_cache.mkdir(parents=True, exist_ok=True)
    os.environ["HF_HOME"] = str(hf_cache)
    os.environ["TRANSFORMERS_CACHE"] = str(hf_cache / "transformers")
    os.environ["TORCH_HOME"] = str(torch_cache)
    os.environ.setdefault("HF_HUB_OFFLINE", "1")
