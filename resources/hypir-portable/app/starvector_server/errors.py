"""StarVector 错误码定义(对应 mengbi ai-features/starvector.ts 的 errorCodeMap)。

15 类错误码,按 mengbi 用户清单 §6 末尾对齐。
"""
from __future__ import annotations

import traceback
from dataclasses import dataclass
from typing import Optional


# ── 错误码常量 ───────────────────────────────────────────────

E_MODEL_PATH_NOT_CONFIGURED = "MODEL_PATH_NOT_CONFIGURED"
E_MODEL_PATH_NOT_FOUND = "MODEL_PATH_NOT_FOUND"
E_MODEL_LOAD_FAILED = "MODEL_LOAD_FAILED"
E_INFERENCE_FAILED = "INFERENCE_FAILED"
E_OUTPUT_TRUNCATED = "OUTPUT_TRUNCATED"
E_OUTPUT_NO_SVG_TAG = "OUTPUT_NO_SVG_TAG"
E_OUTPUT_NO_VISIBLE_ELEMENTS = "OUTPUT_NO_VISIBLE_ELEMENTS"
E_INPUT_NOT_FOUND = "INPUT_NOT_FOUND"
E_INPUT_INVALID_FORMAT = "INPUT_INVALID_FORMAT"
E_VRAM_INSUFFICIENT = "VRAM_INSUFFICIENT"
E_MISSING_TRANSFORMERS = "MISSING_TRANSFORMERS"
E_MISSING_TORCH = "MISSING_TORCH"
E_PORT_OCCUPIED = "PORT_OCCUPIED"
E_TASK_NOT_FOUND = "TASK_NOT_FOUND"
E_CANCELLED = "CANCELLED"


@dataclass
class StarVectorError(Exception):
    code: str
    message_zh: str
    hint: str = ""
    detail: Optional[str] = None

    def __str__(self) -> str:
        return f"[{self.code}] {self.message_zh}"


def map_runtime_exception(e: Exception) -> StarVectorError:
    """把通用异常映射到 StarVectorError;不认识就归到 INFERENCE_FAILED。"""
    if isinstance(e, StarVectorError):
        return e
    name = type(e).__name__
    msg = str(e) or name
    tb = traceback.format_exc()

    if "ImportError" in name or "ModuleNotFoundError" in name:
        if "transformers" in msg:
            return StarVectorError(
                code=E_MISSING_TRANSFORMERS,
                message_zh="未安装 transformers",
                hint="跑 install_starvector_extras.bat",
                detail=tb,
            )
        if "torch" in msg:
            return StarVectorError(
                code=E_MISSING_TORCH,
                message_zh="未安装 PyTorch",
                hint="跑 install_or_repair.bat 安装 PyTorch CUDA 版",
                detail=tb,
            )
        return StarVectorError(
            code=E_MODEL_LOAD_FAILED,
            message_zh=f"模型加载所需依赖缺失: {msg}",
            hint="检查 requirements_locked.txt 装齐",
            detail=tb,
        )

    if "OutOfMemoryError" in name or "CUDA out of memory" in msg or "OOM" in msg:
        return StarVectorError(
            code=E_VRAM_INSUFFICIENT,
            message_zh="显存不足",
            hint="StarVector-1B 需 >= 4GB 显存;降低 max_new_tokens 或换 CPU 模式",
            detail=tb,
        )

    if "FileNotFoundError" in name or "No such file" in msg:
        if "input" in msg.lower():
            return StarVectorError(
                code=E_INPUT_NOT_FOUND,
                message_zh=f"输入文件不存在: {msg}",
                hint="检查路径",
                detail=tb,
            )
        return StarVectorError(
            code=E_MODEL_PATH_NOT_FOUND,
            message_zh=f"模型文件不存在: {msg}",
            hint="检查 vec_starvector_path 设置",
            detail=tb,
        )

    return StarVectorError(
        code=E_INFERENCE_FAILED,
        message_zh=f"推理失败: {msg}",
        hint="查看 logs/starvector.log",
        detail=tb,
    )
