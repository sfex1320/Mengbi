"""Real-ESRGAN PyTorch adapter —— 加载 .pth + RealESRGANer 推理 + GFPGAN 人脸修复。

模型加载策略:
  - 按 model_id → 文件路径 + 网络结构(RRDBNet / SRVGGNetCompact) 的查表
  - 切模型时 unload 旧 + 加载新(GPU 上慢一点但简单)
  - GFPGAN(face_enhance=True 时)用独立的 GFPGANer,共享底层 Real-ESRGAN 作 bg_upsampler

依赖(install_realesrgan_extras.bat 装):
  - realesrgan(自带 RealESRGANer 封装)
  - basicsr(RRDBNet 等结构)
  - facexlib(GFPGAN 用,人脸检测)
  - gfpgan(faceEnhance=True 时)
"""
from __future__ import annotations

import gc
import logging
import time
from pathlib import Path
from typing import Any, Callable, Dict, Optional

from PIL import Image
import numpy as np

from .config import RealEsrganConfig
from .errors import (
    RealEsrganError,
    E_MODEL_NOT_FOUND,
    E_MODEL_LOAD_FAILED,
    E_INPUT_NOT_FOUND,
    E_INPUT_INVALID_FORMAT,
    E_OUTPUT_NOT_WRITABLE,
    E_INFERENCE_FAILED,
    E_MISSING_REALESRGAN,
    E_MISSING_GFPGAN,
    E_VRAM_INSUFFICIENT,
)

log = logging.getLogger("realesrgan.adapter")


# 模型档案:id → { file, arch, scale_native, num_block, num_feat }
# arch: 'RRDBNet'(big anime/photo 模型) / 'SRVGGNetCompact'(general-x4v3/animevideo,小快)
MODEL_REGISTRY: Dict[str, Dict[str, Any]] = {
    'realesrgan-x4plus': {
        'file': 'RealESRGAN_x4plus.pth',
        'arch': 'RRDBNet',
        'scale_native': 4,
        'num_block': 23,
        'num_feat': 64,
        'num_in_ch': 3,
        'num_out_ch': 3,
    },
    'realesrgan-x4plus-anime-6B': {
        'file': 'RealESRGAN_x4plus_anime_6B.pth',
        'arch': 'RRDBNet',
        'scale_native': 4,
        'num_block': 6,
        'num_feat': 64,
        'num_in_ch': 3,
        'num_out_ch': 3,
    },
    'realesr-general-x4v3': {
        'file': 'realesr-general-x4v3.pth',
        'arch': 'SRVGGNetCompact',
        'scale_native': 4,
        'num_block': 32,
        'num_feat': 64,
        'num_in_ch': 3,
        'num_out_ch': 3,
        'supports_denoise_strength': True,
        'wdn_file': 'realesr-general-wdn-x4v3.pth',
    },
    'realesr-animevideov3': {
        'file': 'realesr-animevideov3.pth',
        'arch': 'SRVGGNetCompact',
        'scale_native': 4,
        'num_block': 16,
        'num_feat': 64,
        'num_in_ch': 3,
        'num_out_ch': 3,
    },
    # 社区 .pth (RRDBNet 23-block 同 x4plus)
    '4x-ultrasharp': {
        'file': '4x-UltraSharp.pth',
        'arch': 'RRDBNet',
        'scale_native': 4,
        'num_block': 23,
        'num_feat': 64,
        'num_in_ch': 3,
        'num_out_ch': 3,
    },
    '4x-remacri': {
        'file': '4x_foolhardy_Remacri.pth',
        'arch': 'RRDBNet',
        'scale_native': 4,
        'num_block': 23,
        'num_feat': 64,
        'num_in_ch': 3,
        'num_out_ch': 3,
    },
}


class RealEsrganAdapter:
    def __init__(self, cfg: RealEsrganConfig):
        self.cfg = cfg
        self._upsampler = None
        self._face_enhancer = None
        self._loaded_id: Optional[str] = None
        self._loaded_with_face = False
        self.device = 'cpu'

    # ── probe ───────────────────────────────────────────

    def probe(self) -> Dict[str, Any]:
        installed = []
        for mid, info in MODEL_REGISTRY.items():
            p = self.cfg.realesrgan_models_abs / info['file']
            if p.exists():
                installed.append({'id': mid, 'path': str(p), 'size': p.stat().st_size})
        gfpgan_p = self.cfg.gfpgan_models_abs / 'GFPGANv1.4.pth'
        return {
            'installed_models': installed,
            'gfpgan_installed': gfpgan_p.exists(),
            'gfpgan_path': str(gfpgan_p) if gfpgan_p.exists() else None,
            'loaded_id': self._loaded_id,
            'device': self.device,
            'vram_used_mb': _vram_mb(),
        }

    # ── lifecycle ───────────────────────────────────────

    def ensure_loaded(self, model_id: str, face_enhance: bool, scale: int, denoise_strength: float = 0.5) -> None:
        same = (self._loaded_id == model_id) and (self._loaded_with_face == face_enhance)
        if same and self._upsampler is not None:
            return
        self.unload()

        info = MODEL_REGISTRY.get(model_id)
        if not info:
            raise RealEsrganError(
                code=E_MODEL_NOT_FOUND,
                message_zh=f"未知模型 id: {model_id}",
                hint="检查 mengbi 设置里选的模型名",
            )
        weight_path = self.cfg.realesrgan_models_abs / info['file']
        if not weight_path.exists():
            raise RealEsrganError(
                code=E_MODEL_NOT_FOUND,
                message_zh=f"模型权重不存在: {weight_path}",
                hint="到 mengbi 设置 → 工具箱 → Real-ESRGAN 模型库下载",
            )

        try:
            import torch
            from realesrgan import RealESRGANer
            from basicsr.archs.rrdbnet_arch import RRDBNet
        except ImportError as e:
            if 'realesrgan' in str(e).lower() or 'basicsr' in str(e).lower():
                raise RealEsrganError(
                    code=E_MISSING_REALESRGAN,
                    message_zh=f"未安装 realesrgan / basicsr: {e}",
                    hint="跑 install_realesrgan_extras.bat",
                )
            raise

        self.device = 'cuda' if torch.cuda.is_available() else 'cpu'
        half = self.device == 'cuda' and self.cfg.default_half_precision

        if info['arch'] == 'RRDBNet':
            model = RRDBNet(
                num_in_ch=info['num_in_ch'],
                num_out_ch=info['num_out_ch'],
                num_feat=info['num_feat'],
                num_block=info['num_block'],
                num_grow_ch=32,
                scale=info['scale_native'],
            )
        elif info['arch'] == 'SRVGGNetCompact':
            from basicsr.archs.srvgg_arch import SRVGGNetCompact
            model = SRVGGNetCompact(
                num_in_ch=info['num_in_ch'],
                num_out_ch=info['num_out_ch'],
                num_feat=info['num_feat'],
                num_conv=info['num_block'],
                upscale=info['scale_native'],
                act_type='prelu',
            )
        else:
            raise RealEsrganError(
                code=E_MODEL_LOAD_FAILED,
                message_zh=f"未知网络架构: {info['arch']}",
            )

        # general-x4v3 + denoise_strength 内插
        dni_weight = None
        weight_paths = [str(weight_path)]
        if info.get('supports_denoise_strength') and 0 < denoise_strength < 1:
            wdn = self.cfg.realesrgan_models_abs / info.get('wdn_file', '')
            if wdn.exists():
                weight_paths = [str(weight_path), str(wdn)]
                dni_weight = [denoise_strength, 1 - denoise_strength]
            else:
                log.warning("denoise_strength 中间值需要 wdn 权重,但 %s 不存在,fallback 到默认", wdn)

        try:
            self._upsampler = RealESRGANer(
                scale=info['scale_native'],
                model_path=weight_paths if len(weight_paths) > 1 else weight_paths[0],
                dni_weight=dni_weight,
                model=model,
                tile=self.cfg.default_tile,
                tile_pad=self.cfg.default_tile_pad,
                pre_pad=0,
                half=half,
                gpu_id=None,
            )
        except Exception as e:
            raise RealEsrganError(
                code=E_MODEL_LOAD_FAILED,
                message_zh=f"模型加载失败: {e}",
                detail=str(e),
            )

        if face_enhance:
            gfpgan_p = self.cfg.gfpgan_models_abs / 'GFPGANv1.4.pth'
            if not gfpgan_p.exists():
                raise RealEsrganError(
                    code=E_MISSING_GFPGAN,
                    message_zh=f"GFPGAN 权重不存在: {gfpgan_p}",
                    hint="到 mengbi 模型库下载 GFPGAN 1.4 (~340 MB)",
                )
            try:
                from gfpgan import GFPGANer
                self._face_enhancer = GFPGANer(
                    model_path=str(gfpgan_p),
                    upscale=scale,
                    arch='clean',
                    channel_multiplier=2,
                    bg_upsampler=self._upsampler,
                )
            except ImportError as e:
                raise RealEsrganError(
                    code=E_MISSING_GFPGAN,
                    message_zh=f"未安装 gfpgan / facexlib: {e}",
                    hint="跑 install_realesrgan_extras.bat",
                )

        self._loaded_id = model_id
        self._loaded_with_face = face_enhance
        log.info("loaded %s (face=%s, device=%s, half=%s)", model_id, face_enhance, self.device, half)

    def unload(self) -> bool:
        if self._upsampler is None:
            return False
        del self._upsampler
        self._upsampler = None
        if self._face_enhancer is not None:
            del self._face_enhancer
            self._face_enhancer = None
        self._loaded_id = None
        self._loaded_with_face = False
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
        info = {'vram_used_mb_after': None, 'model_loaded': self._upsampler is not None}
        try:
            import torch
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
                info['vram_used_mb_after'] = _vram_mb()
        except Exception:
            pass
        return info

    # ── inference ───────────────────────────────────────

    def upscale(
        self,
        input_path: str,
        output_path: str,
        model_id: str,
        scale: int = 4,
        denoise_strength: float = 0.5,
        face_enhance: bool = False,
        tile: int = 0,
        tta: bool = False,
        progress_cb: Optional[Callable[[int, str], None]] = None,
    ) -> Dict[str, Any]:
        ip = Path(input_path)
        if not ip.exists():
            raise RealEsrganError(
                code=E_INPUT_NOT_FOUND,
                message_zh=f"输入文件不存在: {input_path}",
            )
        try:
            img = Image.open(ip).convert('RGB')
        except Exception as e:
            raise RealEsrganError(
                code=E_INPUT_INVALID_FORMAT,
                message_zh=f"无法解析图片: {e}",
            )
        if progress_cb:
            progress_cb(5, "加载模型…")
        self.ensure_loaded(model_id, face_enhance, scale, denoise_strength)
        assert self._upsampler is not None
        # 临时 override tile
        self._upsampler.tile_size = int(tile) if tile and tile > 0 else 0

        if progress_cb:
            progress_cb(20, "推理中…")
        t0 = time.time()
        try:
            np_img = np.array(img)  # H W 3
            if self._face_enhancer is not None:
                _, _, out_img = self._face_enhancer.enhance(
                    np_img, has_aligned=False, only_center_face=False, paste_back=True
                )
            else:
                out_img, _ = self._upsampler.enhance(np_img, outscale=scale)
        except RuntimeError as e:
            msg = str(e)
            if 'out of memory' in msg.lower():
                raise RealEsrganError(
                    code=E_VRAM_INSUFFICIENT,
                    message_zh="显存不足",
                    hint="降低 tile(如 256)或关 face_enhance",
                )
            raise RealEsrganError(
                code=E_INFERENCE_FAILED,
                message_zh=f"推理失败: {msg}",
                detail=msg,
            )

        if progress_cb:
            progress_cb(85, "保存输出…")
        out_path = Path(output_path)
        if not out_path.is_absolute():
            out_path = self.cfg.output_abs / output_path
        out_path.parent.mkdir(parents=True, exist_ok=True)
        try:
            out_pil = Image.fromarray(out_img.astype(np.uint8))
            out_pil.save(out_path)
        except Exception as e:
            raise RealEsrganError(
                code=E_OUTPUT_NOT_WRITABLE,
                message_zh=f"写输出失败: {e}",
            )
        duration = round(time.time() - t0, 2)
        if progress_cb:
            progress_cb(100, "完成")

        return {
            'output_path': str(out_path),
            'input_width': img.width,
            'input_height': img.height,
            'output_width': out_pil.width,
            'output_height': out_pil.height,
            'duration_seconds': duration,
            'model_id': model_id,
            'face_enhance': face_enhance,
            'tile': tile,
        }


def _vram_mb() -> Optional[float]:
    try:
        import torch
        if torch.cuda.is_available():
            return round(torch.cuda.memory_allocated() / 1024 / 1024, 1)
    except Exception:
        pass
    return None
