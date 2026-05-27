"""StarVector adapter —— 加载 starvector-1b-im2svg + 推理 + 输出验证。

StarVector 用 `transformers.AutoModelForCausalLM.from_pretrained(..., trust_remote_code=True)`
加载,模型仓库带了自己的 modeling 文件。它有一个 `model.generate_im2svg(image=...)` 风格的便捷
方法(具体 API 视 StarVector 仓库版本而定,这里按官方 README 写)。

API 不稳定时的兼容做法:先试 model.generate_im2svg,失败回退到通用 generate + processor。
"""
from __future__ import annotations

import gc
import logging
import re
import time
from pathlib import Path
from typing import Any, Callable, Dict, Optional

from PIL import Image

from .config import StarVectorConfig
from .errors import (
    StarVectorError,
    E_MODEL_PATH_NOT_CONFIGURED,
    E_MODEL_PATH_NOT_FOUND,
    E_MODEL_LOAD_FAILED,
    E_INPUT_NOT_FOUND,
    E_INPUT_INVALID_FORMAT,
    E_OUTPUT_NO_SVG_TAG,
    E_OUTPUT_NO_VISIBLE_ELEMENTS,
    E_OUTPUT_TRUNCATED,
)

log = logging.getLogger("starvector.adapter")


_VISIBLE_TAG_RE = re.compile(
    r"<(path|rect|circle|ellipse|polygon|polyline|line|text)\b", re.IGNORECASE
)
_SVG_OPEN_RE = re.compile(r"<svg\b[^>]*>", re.IGNORECASE)
_SVG_CLOSE_RE = re.compile(r"</svg>", re.IGNORECASE)


class StarVectorAdapter:
    def __init__(self, cfg: StarVectorConfig):
        self.cfg = cfg
        self.model = None
        self.processor = None
        self.device = "cpu"
        self._loaded_path: Optional[str] = None

    # ── lifecycle ───────────────────────────────────────────

    def probe(self) -> Dict[str, Any]:
        info: Dict[str, Any] = {
            "model_path_configured": bool(self.cfg.starvector_model_dir),
            "model_path": str(self.cfg.model_abs),
            "model_path_exists": self.cfg.model_abs.exists(),
            "model_loaded": self.model is not None,
            "loaded_path": self._loaded_path,
            "device": self.device,
            "vram_used_mb": _read_vram_mb(),
        }
        return info

    def ensure_loaded(self) -> None:
        if self.model is not None and self._loaded_path == str(self.cfg.model_abs):
            return
        if not self.cfg.starvector_model_dir:
            raise StarVectorError(
                code=E_MODEL_PATH_NOT_CONFIGURED,
                message_zh="未配置 StarVector 模型路径",
                hint="在 mengbi 设置里填 vec_starvector_path 后重启服务",
            )
        model_path = self.cfg.model_abs
        if not model_path.exists():
            raise StarVectorError(
                code=E_MODEL_PATH_NOT_FOUND,
                message_zh=f"模型路径不存在: {model_path}",
                hint="检查目录是否完整(应包含 config.json 等)",
            )

        try:
            import torch
            from transformers import AutoModelForCausalLM, AutoProcessor
        except ImportError as e:
            raise StarVectorError(
                code=E_MODEL_LOAD_FAILED,
                message_zh=f"加载所需库缺失: {e}",
                hint="跑 install_starvector_extras.bat",
            )

        if torch.cuda.is_available():
            self.device = "cuda"
            dtype = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
        else:
            self.device = "cpu"
            dtype = torch.float32

        log.info("loading StarVector model from %s (device=%s, dtype=%s)", model_path, self.device, dtype)
        t0 = time.time()
        try:
            self.model = AutoModelForCausalLM.from_pretrained(
                str(model_path),
                trust_remote_code=True,
                torch_dtype=dtype,
                low_cpu_mem_usage=True,
            )
            self.model.to(self.device)
            self.model.eval()
        except Exception as e:
            raise StarVectorError(
                code=E_MODEL_LOAD_FAILED,
                message_zh=f"模型加载失败: {e}",
                hint="检查模型完整性 / 显存是否够",
                detail=str(e),
            )
        try:
            self.processor = AutoProcessor.from_pretrained(str(model_path), trust_remote_code=True)
        except Exception:
            self.processor = None  # 某些版本不需要 processor
        self._loaded_path = str(self.cfg.model_abs)
        log.info("StarVector loaded in %.1fs", time.time() - t0)

    def unload(self) -> bool:
        if self.model is None:
            return False
        try:
            import torch
            self.model.to("cpu")
        except Exception:
            pass
        self.model = None
        self.processor = None
        self._loaded_path = None
        gc.collect()
        try:
            import torch
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception:
            pass
        return True

    def clear_cache(self) -> Dict[str, Any]:
        gc.collect()
        info = {"vram_used_mb_after": None, "model_loaded": self.model is not None}
        try:
            import torch
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
                info["vram_used_mb_after"] = _read_vram_mb()
        except Exception:
            pass
        return info

    # ── inference ─────────────────────────────────────────────

    def vectorize(
        self,
        input_path: str,
        max_new_tokens: int = 8192,
        temperature: float = 0.1,
        do_sample: bool = False,
        progress_cb: Optional[Callable[[int, str], None]] = None,
    ) -> Dict[str, Any]:
        in_path = Path(input_path)
        if not in_path.exists():
            raise StarVectorError(
                code=E_INPUT_NOT_FOUND,
                message_zh=f"输入图片不存在: {input_path}",
                hint="检查路径",
            )
        try:
            img = Image.open(in_path).convert("RGB")
        except Exception as e:
            raise StarVectorError(
                code=E_INPUT_INVALID_FORMAT,
                message_zh=f"无法解析图片: {e}",
                hint="确保是 PNG/JPG/WebP 等合法格式",
            )

        self.ensure_loaded()
        assert self.model is not None
        if progress_cb:
            progress_cb(10, "图像预处理")

        import torch

        # 优先用 StarVector 仓库自带的 im2svg 便捷方法
        raw_text = ""
        was_truncated = False
        t0 = time.time()
        try:
            if hasattr(self.model, "generate_im2svg"):
                if progress_cb:
                    progress_cb(30, "调用 model.generate_im2svg")
                out = self.model.generate_im2svg(
                    image=img,
                    max_length=max_new_tokens,
                    temperature=temperature,
                    do_sample=do_sample,
                )
                # 仓库版本不同返回类型不同;兼容 list / str / tensor
                if isinstance(out, str):
                    raw_text = out
                elif isinstance(out, (list, tuple)) and out:
                    raw_text = out[0] if isinstance(out[0], str) else str(out[0])
                else:
                    raw_text = str(out)
            else:
                # 回退路径:用通用 generate
                if self.processor is None:
                    raise StarVectorError(
                        code=E_MODEL_LOAD_FAILED,
                        message_zh="模型未提供 generate_im2svg 且无 AutoProcessor",
                        hint="检查 StarVector 仓库版本",
                    )
                if progress_cb:
                    progress_cb(30, "通用 generate")
                inputs = self.processor(images=img, return_tensors="pt").to(self.device)
                input_len = inputs.get("input_ids").shape[1] if "input_ids" in inputs else 0
                with torch.no_grad():
                    out_ids = self.model.generate(
                        **inputs,
                        max_new_tokens=max_new_tokens,
                        do_sample=do_sample,
                        temperature=temperature,
                    )
                # 截断检测:输出长度 >= 输入 + max_new_tokens 即截断
                if out_ids.shape[1] >= input_len + max_new_tokens:
                    was_truncated = True
                raw_text = self.processor.batch_decode(out_ids, skip_special_tokens=True)[0]
        except StarVectorError:
            raise
        except torch.cuda.OutOfMemoryError as e:
            from .errors import E_VRAM_INSUFFICIENT
            raise StarVectorError(
                code=E_VRAM_INSUFFICIENT,
                message_zh="推理时显存溢出",
                hint="降低 max_new_tokens 或换更小的图",
                detail=str(e),
            )

        if progress_cb:
            progress_cb(80, "提取 SVG")

        # 从 raw_text 里提取 <svg>...</svg>
        svg = _extract_svg(raw_text)
        if not svg:
            raise StarVectorError(
                code=E_OUTPUT_NO_SVG_TAG,
                message_zh="模型输出未包含合法 <svg> 标签",
                hint="尝试更简单的图标 / 调高 max_new_tokens",
                detail=raw_text[:500],
            )

        if not _VISIBLE_TAG_RE.search(svg):
            raise StarVectorError(
                code=E_OUTPUT_NO_VISIBLE_ELEMENTS,
                message_zh="SVG 中无任何可见元素(path/rect/circle/...)",
                hint="模型对该图无法生成有效路径,建议改用 Fast(VTracer)",
                detail=svg[:500],
            )

        if was_truncated:
            # 截断但仍有可见元素 → 警告级,不报错
            log.warning("output likely truncated; visible elements still present")

        duration = round(time.time() - t0, 2)
        if progress_cb:
            progress_cb(100, "完成")
        return {
            "svg": svg,
            "raw_output": raw_text,
            "was_truncated": was_truncated,
            "model_name": "starvector-1b-im2svg",
            "model_path": str(self.cfg.model_abs),
            "duration_seconds": duration,
        }


# ── helpers ─────────────────────────────────────────────────


def _extract_svg(text: str) -> str:
    """从可能含 markdown / 解释文字的 raw 输出里捞 <svg>...</svg>。"""
    if not text:
        return ""
    open_m = _SVG_OPEN_RE.search(text)
    if not open_m:
        return ""
    close_m = _SVG_CLOSE_RE.search(text, pos=open_m.start())
    if close_m:
        return text[open_m.start() : close_m.end()]
    # 找不到 </svg> → 截断;补一个让 mengbi 后处理的 repair 接管
    return text[open_m.start() :] + "</svg>"


def _read_vram_mb() -> Optional[float]:
    try:
        import torch
        if torch.cuda.is_available():
            return round(torch.cuda.memory_allocated() / 1024 / 1024, 1)
    except Exception:
        pass
    return None
