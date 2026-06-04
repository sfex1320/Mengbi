/**
 * HYPIR FeatureSpec —— 把 HYPIR 接入通用 AI 平台底座。
 *
 * 这个文件只负责 4 件事:
 *   ① 声明 HYPIR 的 FeatureSpec（端口 / bat / 脚手架路径 / 依赖模型 / 错误码映射）
 *   ② 声明 HYPIR 用到的模型 ModelSpec（SD2.1-base + HYPIR_sd2.pth）
 *   ③ 提供 HYPIR-specific 的 submitTask 请求体构造器
 *   ④ 提供 HYPIR-specific 的 error_code → AppErrorCode 映射
 *
 * 推理 lifecycle / HTTP / 轮询 / 取消 全部走 SidecarManager。本文件**没有**任何
 * spawn / net.request / cleanup 逻辑。
 */
import type { AppErrorCode } from '@shared/error';
import type { FeatureSpec, ModelSpec } from '../ai-platform/types';
import { getSidecarManager } from '../ai-platform/sidecarManager';
import { getModelRegistry } from '../ai-platform/modelRegistry';

export const HYPIR_FEATURE_ID = 'hypir';

/** HYPIR 推理请求参数（与旧 hypirPortable.SubmitTaskInput 字段对齐） */
export interface HypirSubmitInput {
  inputPath: string;
  outputPath?: string;
  scale: number;
  prompt?: string;
  negativePrompt?: string;
  seed?: number;
  tileSize?: number;
  device?: 'cuda' | 'cpu';
  intensity?: 'conservative' | 'standard' | 'strong';
  highlightProtection?: boolean;
  disablePostsharpen?: boolean;
  /** 修复深度 50–400 */
  restorationDepth?: number;
}

const HYPIR_MODELS: ModelSpec[] = [
  {
    id: 'sd2-base',
    displayName: 'Stable Diffusion 2.1 base (diffusers)',
    licenseNote: 'CreativeML Open RAIL-M。商用受限，详见 huggingface.co/stabilityai/stable-diffusion-2-1-base',
    relPath: 'models/sd2_1_base',
    isDirectory: true,
    expectedBytes: 0, // diffusers 目录不算单文件大小
    sources: [
      { name: 'huggingface', url: 'https://huggingface.co/stabilityai/stable-diffusion-2-1-base' },
      { name: 'modelscope', url: 'https://www.modelscope.cn/models/AI-ModelScope/stable-diffusion-2-1-base', mirror: true }
    ],
    usedBy: [HYPIR_FEATURE_ID]
  },
  {
    id: 'hypir-weights',
    displayName: 'HYPIR SD2.1 微调权重',
    licenseNote: '参见 HYPIR 论文项目页',
    relPath: 'models/hypir/HYPIR_sd2.pth',
    isDirectory: false,
    expectedBytes: 2_100_000_000, // ~2 GB
    sources: [
      { name: 'huggingface', url: 'https://huggingface.co/HYPIR' }
    ],
    usedBy: [HYPIR_FEATURE_ID]
  }
];

const HYPIR_FEATURE: FeatureSpec = {
  id: HYPIR_FEATURE_ID,
  displayName: 'HYPIR · AI 高质量修复放大',
  description:
    'SD2.1 基础，适合严重退化 / 模糊照片救命，速度较快。需 Python+CUDA。独立 Python 引擎，端口 7865。',
  category: 'image-restore',
  port: 7865,
  startBat: 'start_hypir.bat',
  stopBat: 'stop_hypir.bat',
  installBats: ['install_or_repair.bat'],
  serverScaffoldRelPath: 'app/hypir_server/server.py',
  requiredModelIds: HYPIR_MODELS.map((m) => m.id),
  errorCodeMap: {
    MISSING_HYPIR_SOURCE: 'FILE_NOT_FOUND',
    MISSING_HYPIR_WEIGHTS: 'FILE_NOT_FOUND',
    MISSING_SD21_BASE: 'FILE_NOT_FOUND',
    MISSING_TORCH: 'CONFIG_INVALID',
    CUDA_UNAVAILABLE: 'CONFIG_INVALID',
    MODEL_LOAD_FAILED: 'CONFIG_INVALID',
    VRAM_INSUFFICIENT: 'API_FAILED',
    INFERENCE_FAILED: 'API_FAILED',
    PORT_OCCUPIED: 'NETWORK_OFFLINE',
    INPUT_NOT_FOUND: 'FILE_NOT_FOUND',
    OUTPUT_NOT_WRITABLE: 'FILE_PERMISSION',
    TASK_NOT_FOUND: 'VALIDATION_FAILED',
    CANCELLED: 'CANCELLED'
  }
};

/** 把 mengbi 抽象层的 input → HYPIR server 期望的 snake_case body */
export function buildHypirSubmitBody(input: HypirSubmitInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    input_path: input.inputPath,
    output_path:
      input.outputPath && input.outputPath.trim()
        ? input.outputPath
        : `out-${Date.now()}.png`,
    scale: input.scale,
    prompt: input.prompt ?? '',
    negative_prompt: input.negativePrompt ?? '',
    seed: input.seed ?? 1234,
    tile_size: input.tileSize ?? 1024,
    device: input.device ?? 'cuda',
    intensity: input.intensity ?? 'conservative',
    disable_postsharpen: input.disablePostsharpen ?? true
  };
  if (input.highlightProtection !== undefined) {
    body.highlight_protection = input.highlightProtection;
  }
  if (input.restorationDepth !== undefined) {
    body.model_t = input.restorationDepth;
    body.coeff_t = input.restorationDepth;
  }
  return body;
}

/** 把 server 端 error_code 映射回 AppErrorCode */
export function mapHypirErrorCode(code: string | null): AppErrorCode {
  if (!code) return 'UNKNOWN';
  return HYPIR_FEATURE.errorCodeMap?.[code] ?? 'UNKNOWN';
}

/** 启动期注册到通用底座；幂等 */
export function registerHypirFeature(): void {
  getSidecarManager().register(HYPIR_FEATURE);
  getModelRegistry().registerMany(HYPIR_MODELS);
}
