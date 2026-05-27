"""Real-ESRGAN PyTorch 错误码(对应 mengbi ai-features/realesrgan-pytorch.ts errorCodeMap)。"""
from __future__ import annotations

import traceback
from dataclasses import dataclass
from typing import Optional


E_MODEL_NOT_FOUND = "MODEL_NOT_FOUND"
E_MODEL_LOAD_FAILED = "MODEL_LOAD_FAILED"
E_INFERENCE_FAILED = "INFERENCE_FAILED"
E_INPUT_NOT_FOUND = "INPUT_NOT_FOUND"
E_INPUT_INVALID_FORMAT = "INPUT_INVALID_FORMAT"
E_OUTPUT_NOT_WRITABLE = "OUTPUT_NOT_WRITABLE"
E_VRAM_INSUFFICIENT = "VRAM_INSUFFICIENT"
E_MISSING_REALESRGAN = "MISSING_REALESRGAN"
E_MISSING_GFPGAN = "MISSING_GFPGAN"
E_MISSING_TORCH = "MISSING_TORCH"
E_PORT_OCCUPIED = "PORT_OCCUPIED"
E_TASK_NOT_FOUND = "TASK_NOT_FOUND"
E_CANCELLED = "CANCELLED"


@dataclass
class RealEsrganError(Exception):
    code: str
    message_zh: str
    hint: str = ""
    detail: Optional[str] = None

    def __str__(self) -> str:
        return f"[{self.code}] {self.message_zh}"


def map_runtime_exception(e: Exception) -> RealEsrganError:
    if isinstance(e, RealEsrganError):
        return e
    name = type(e).__name__
    msg = str(e) or name
    tb = traceback.format_exc()

    if "ImportError" in name or "ModuleNotFoundError" in name:
        if "realesrgan" in msg.lower():
            return RealEsrganError(
                code=E_MISSING_REALESRGAN,
                message_zh="未安装 realesrgan 包",
                hint="跑 install_realesrgan_extras.bat",
                detail=tb,
            )
        if "gfpgan" in msg.lower() or "facexlib" in msg.lower():
            return RealEsrganError(
                code=E_MISSING_GFPGAN,
                message_zh="未安装 GFPGAN / facexlib",
                hint="跑 install_realesrgan_extras.bat",
                detail=tb,
            )
        if "torch" in msg.lower():
            return RealEsrganError(
                code=E_MISSING_TORCH,
                message_zh="未安装 PyTorch",
                hint="跑 install_or_repair.bat 安装 PyTorch CUDA 版",
                detail=tb,
            )
        return RealEsrganError(
            code=E_MODEL_LOAD_FAILED,
            message_zh=f"加载所需依赖缺失: {msg}",
            hint="检查 requirements_locked.txt 装齐",
            detail=tb,
        )

    if "OutOfMemoryError" in name or "CUDA out of memory" in msg or "OOM" in msg:
        return RealEsrganError(
            code=E_VRAM_INSUFFICIENT,
            message_zh="显存不足",
            hint="降低 tile 大小(如 256) / 关闭 face_enhance",
            detail=tb,
        )

    if "FileNotFoundError" in name or "No such file" in msg:
        if "input" in msg.lower():
            return RealEsrganError(
                code=E_INPUT_NOT_FOUND,
                message_zh=f"输入文件不存在: {msg}",
                detail=tb,
            )
        return RealEsrganError(
            code=E_MODEL_NOT_FOUND,
            message_zh=f"模型文件不存在: {msg}",
            hint="到 mengbi 设置 → 工具箱 → Real-ESRGAN 模型库下载",
            detail=tb,
        )

    return RealEsrganError(
        code=E_INFERENCE_FAILED,
        message_zh=f"推理失败: {msg}",
        hint="查看 logs/realesrgan.log",
        detail=tb,
    )
