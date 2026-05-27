"""StarVector Portable 配置(与 hypir / supir 完全独立,端口 7867)。

模型路径默认相对 portable_root,但 mengbi 通常通过设置传绝对路径覆盖。
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict


def portable_root() -> Path:
    """portable 根目录 = cwd(由 start_starvector.bat 切到)。"""
    return Path(os.getcwd()).resolve()


@dataclass
class StarVectorConfig:
    host: str = "127.0.0.1"
    port: int = 7867

    # 默认模型相对路径;mengbi 一般直接传绝对路径覆盖
    starvector_model_dir: str = "models/starvector-1b-im2svg"

    # I/O 目录(与 HYPIR / SUPIR 共用根)
    input_dir: str = "input"
    output_dir: str = "output"
    temp_dir: str = "temp"
    logs_dir: str = "logs"

    # 推理默认参数
    default_max_new_tokens: int = 8192
    default_temperature: float = 0.1
    default_do_sample: bool = False

    # 启动时是否预热模型(默认 False,避免没用 vec 模式时白吃显存)
    eager_load_models: bool = False

    # 缓存目录(与 HYPIR / SUPIR 共用)
    huggingface_cache_dir: str = "cache/huggingface"
    torch_cache_dir: str = "cache/torch"

    extra: Dict[str, Any] = field(default_factory=dict)

    # ── 派生绝对路径 ──────────────────────────────────────

    def abs(self, rel: str) -> Path:
        return (portable_root() / rel).resolve()

    @property
    def model_abs(self) -> Path:
        # 支持绝对路径(用户 mengbi 设置里传的)
        p = Path(self.starvector_model_dir)
        if p.is_absolute():
            return p.resolve()
        return self.abs(self.starvector_model_dir)

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


def load_config() -> StarVectorConfig:
    cfg_path = portable_root() / "config" / "starvector_config.json"
    if cfg_path.exists():
        try:
            raw = json.loads(cfg_path.read_text(encoding="utf-8"))
        except Exception as e:
            raise RuntimeError(f"starvector_config.json 解析失败:{e}")
    else:
        raw = {}

    # mengbi 设置里写的模型路径可经环境变量传入(优先)
    env_model_path = os.environ.get("MENGBI_STARVECTOR_MODEL_PATH", "").strip()
    if env_model_path:
        raw["starvector_model_dir"] = env_model_path

    known = {f.name for f in StarVectorConfig.__dataclass_fields__.values()}
    kwargs = {k: v for k, v in raw.items() if k in known}
    extra = {k: v for k, v in raw.items() if k not in known}
    cfg = StarVectorConfig(**kwargs, extra=extra)
    for d in (cfg.input_abs, cfg.output_abs, cfg.temp_abs, cfg.logs_abs):
        d.mkdir(parents=True, exist_ok=True)
    return cfg


def apply_offline_env(cfg: StarVectorConfig) -> None:
    """与 hypir / supir 共享同一份 HF / torch cache。"""
    hf_cache = cfg.abs(cfg.huggingface_cache_dir)
    torch_cache = cfg.abs(cfg.torch_cache_dir)
    hf_cache.mkdir(parents=True, exist_ok=True)
    torch_cache.mkdir(parents=True, exist_ok=True)
    os.environ["HF_HOME"] = str(hf_cache)
    os.environ["TRANSFORMERS_CACHE"] = str(hf_cache / "transformers")
    os.environ["HF_DATASETS_CACHE"] = str(hf_cache / "datasets")
    os.environ["HF_HUB_CACHE"] = str(hf_cache / "hub")
    os.environ["TORCH_HOME"] = str(torch_cache)
    # StarVector 加载用本地路径,不需要联网
    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
