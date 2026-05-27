/**
 * Real-ESRGAN PyTorch FeatureSpec —— 接入通用 AI 平台底座(端口 7869)。
 *
 * 当前 ncnn 引擎(v0.2.0)只能跑 4 个内置模型。需要 anime_6B / general-x4v3 /
 * UltraSharp / Remacri / GFPGAN 等社区模型时,走这条 PyTorch 通道。
 *
 * 与 HYPIR / SUPIR 完全一致的接入模式:FeatureSpec + ModelSpec[] + buildBody + errorMap
 *
 * 端口分配:
 *   7865 HYPIR  /  7866 SUPIR  /  7869 Real-ESRGAN PyTorch
 *   (7867 / 7868 历史 vec sidecar 占用过,留空避免冲突)
 */
import type { AppErrorCode } from '@shared/error';
import type { FeatureSpec, ModelSpec } from '../ai-platform/types';
import { getSidecarManager } from '../ai-platform/sidecarManager';
import { getModelRegistry } from '../ai-platform/modelRegistry';

export const REALESRGAN_PYTORCH_FEATURE_ID = 'realesrgan-pytorch';

export interface RealEsrganPytorchSubmitInput {
  inputPath: string;
  outputPath?: string;
  /** 内部模型名,跟 ModelSpec.id 一致 */
  modelId: string;
  /** 放大倍率;不同模型支持的倍率不同(通常 2/3/4) */
  scale: 2 | 3 | 4;
  /** 0..1,只有 general-x4v3 支持 */
  denoiseStrength?: number;
  /** 是否启用 GFPGAN 人脸修复 */
  faceEnhance?: boolean;
  /** Tile 分块,0 = 不分 */
  tile?: number;
  /** TTA(8 倍耗时) */
  tta?: boolean;
}

/** 内置 + 社区主流模型清单 */
const PYTORCH_MODELS: ModelSpec[] = [
  {
    id: 'realesrgan-x4plus',
    displayName: 'Real-ESRGAN x4+ (官方,通用真实)',
    licenseNote: 'Apache 2.0',
    relPath: 'models/realesrgan/RealESRGAN_x4plus.pth',
    isDirectory: false,
    expectedBytes: 67_040_000,
    sources: [
      {
        name: 'github',
        url: 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth'
      }
    ],
    usedBy: [REALESRGAN_PYTORCH_FEATURE_ID]
  },
  {
    id: 'realesrgan-x4plus-anime-6B',
    displayName: 'Real-ESRGAN x4+ Anime 6B (动漫专精)',
    licenseNote: 'Apache 2.0 · 6B 参数版,锐利度优于 ncnn anime',
    relPath: 'models/realesrgan/RealESRGAN_x4plus_anime_6B.pth',
    isDirectory: false,
    expectedBytes: 17_938_799,
    sources: [
      {
        name: 'github',
        url: 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.2.4/RealESRGAN_x4plus_anime_6B.pth'
      }
    ],
    usedBy: [REALESRGAN_PYTORCH_FEATURE_ID]
  },
  {
    id: 'realesr-general-x4v3',
    displayName: 'realesr-general-x4v3 (通用,支持 denoise)',
    licenseNote: 'Apache 2.0 · 自带 denoise_strength 参数,体积小速度快',
    relPath: 'models/realesrgan/realesr-general-x4v3.pth',
    isDirectory: false,
    expectedBytes: 4_775_000,
    sources: [
      {
        name: 'github',
        url: 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesr-general-x4v3.pth'
      }
    ],
    usedBy: [REALESRGAN_PYTORCH_FEATURE_ID]
  },
  {
    id: 'realesr-general-wdn-x4v3',
    displayName: 'realesr-general-wdn-x4v3 (general-x4v3 配套强降噪权重)',
    licenseNote: 'Apache 2.0 · 与 general-x4v3 配对,denoise_strength 内插用',
    relPath: 'models/realesrgan/realesr-general-wdn-x4v3.pth',
    isDirectory: false,
    expectedBytes: 4_775_000,
    sources: [
      {
        name: 'github',
        url: 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesr-general-wdn-x4v3.pth'
      }
    ],
    usedBy: [REALESRGAN_PYTORCH_FEATURE_ID]
  },
  {
    id: 'realesr-animevideov3',
    displayName: 'realesr-animevideov3 (动漫视频帧)',
    licenseNote: 'Apache 2.0',
    relPath: 'models/realesrgan/realesr-animevideov3.pth',
    isDirectory: false,
    expectedBytes: 2_390_000,
    sources: [
      {
        name: 'github',
        url: 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesr-animevideov3.pth'
      }
    ],
    usedBy: [REALESRGAN_PYTORCH_FEATURE_ID]
  },
  {
    id: 'gfpgan-1.4',
    displayName: 'GFPGAN 1.4 (人脸增强)',
    licenseNote: 'Apache 2.0 · faceEnhance 开关启用时调用',
    relPath: 'models/gfpgan/GFPGANv1.4.pth',
    isDirectory: false,
    expectedBytes: 348_000_000,
    sources: [
      {
        name: 'github',
        url: 'https://github.com/TencentARC/GFPGAN/releases/download/v1.3.0/GFPGANv1.4.pth'
      }
    ],
    usedBy: [REALESRGAN_PYTORCH_FEATURE_ID]
  },
  // ── 社区强化模型(不在 xinntao 官方 repo,但 chaiNNer / IOPaint 等都收纳) ──
  {
    id: '4x-ultrasharp',
    displayName: '4x-UltraSharp (社区强化,锐化向)',
    licenseNote: 'CC BY-NC-SA 4.0 · 个人/非商用',
    relPath: 'models/realesrgan/4x-UltraSharp.pth',
    isDirectory: false,
    expectedBytes: 67_000_000,
    sources: [
      {
        name: 'huggingface',
        url: 'https://huggingface.co/Kim2091/UltraSharp/resolve/main/4x-UltraSharp.pth'
      }
    ],
    usedBy: [REALESRGAN_PYTORCH_FEATURE_ID]
  },
  {
    id: '4x-remacri',
    displayName: '4x-Remacri (社区强化,细节向)',
    licenseNote: 'CC BY-NC-SA · 非商用',
    relPath: 'models/realesrgan/4x_foolhardy_Remacri.pth',
    isDirectory: false,
    expectedBytes: 67_000_000,
    sources: [
      {
        name: 'huggingface',
        url: 'https://huggingface.co/utnah/esrgan/resolve/main/4x_foolhardy_Remacri.pth'
      }
    ],
    usedBy: [REALESRGAN_PYTORCH_FEATURE_ID]
  }
];

const REALESRGAN_PYTORCH_FEATURE: FeatureSpec = {
  id: REALESRGAN_PYTORCH_FEATURE_ID,
  displayName: 'Real-ESRGAN PyTorch (扩展模型)',
  description:
    'PyTorch 后端,支持 .pth 模型与 face_enhance / denoise_strength。' +
    '相比 ncnn-vulkan 多 anime_6B / general-x4v3 / UltraSharp / Remacri / GFPGAN 等模型。' +
    '需要 Python + CUDA;首次启动会跑 install_realesrgan_extras.bat 装 realesrgan + gfpgan + facexlib(~5 分钟)。',
  category: 'image-restore',
  port: 7869,
  startBat: 'start_realesrgan.bat',
  stopBat: 'stop_realesrgan.bat',
  installBats: ['install_realesrgan_extras.bat'],
  serverScaffoldRelPath: 'app/realesrgan_server/server.py',
  requiredModelIds: ['realesrgan-x4plus'], // 至少要 1 个 base 模型
  errorCodeMap: {
    MODEL_NOT_FOUND: 'FILE_NOT_FOUND',
    MODEL_LOAD_FAILED: 'CONFIG_INVALID',
    INFERENCE_FAILED: 'API_FAILED',
    INPUT_NOT_FOUND: 'FILE_NOT_FOUND',
    INPUT_INVALID_FORMAT: 'VALIDATION_FAILED',
    OUTPUT_NOT_WRITABLE: 'FILE_PERMISSION',
    VRAM_INSUFFICIENT: 'API_FAILED',
    MISSING_REALESRGAN: 'CONFIG_INVALID',
    MISSING_GFPGAN: 'CONFIG_INVALID',
    MISSING_TORCH: 'CONFIG_INVALID',
    PORT_OCCUPIED: 'NETWORK_OFFLINE',
    TASK_NOT_FOUND: 'VALIDATION_FAILED',
    CANCELLED: 'CANCELLED'
  }
};

/** mengbi 抽象 input → Real-ESRGAN PyTorch server snake_case body */
export function buildRealEsrganPytorchSubmitBody(
  input: RealEsrganPytorchSubmitInput
): Record<string, unknown> {
  return {
    input_path: input.inputPath,
    output_path:
      input.outputPath && input.outputPath.trim()
        ? input.outputPath
        : `realesrgan-pt-${Date.now()}.png`,
    model_id: input.modelId,
    scale: input.scale,
    denoise_strength: input.denoiseStrength ?? 0.5,
    face_enhance: input.faceEnhance ?? false,
    tile: input.tile ?? 0,
    tta: input.tta ?? false
  };
}

export function mapRealEsrganPytorchErrorCode(code: string | null): AppErrorCode {
  if (!code) return 'UNKNOWN';
  return REALESRGAN_PYTORCH_FEATURE.errorCodeMap?.[code] ?? 'UNKNOWN';
}

/** 启动期注册到通用底座;幂等 */
export function registerRealEsrganPytorchFeature(): void {
  getSidecarManager().register(REALESRGAN_PYTORCH_FEATURE);
  getModelRegistry().registerMany(PYTORCH_MODELS);
}

export { PYTORCH_MODELS };
