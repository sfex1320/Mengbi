/**
 * StarVector FeatureSpec —— 把 starvector-1b-im2svg 接入通用 AI 平台底座。
 *
 * v3 重构 Phase 3(2026-05-27):
 *   - 端口 7867(原 OmniSVG 占的,已腾出)
 *   - 模型默认 starvector/starvector-1b-im2svg(必须 1B 跑通后再升 8B)
 *   - 走 SidecarManager.submitTask + polling,本文件只声明
 *
 * 与 HYPIR / SUPIR 完全一致的接入模式:
 *   FeatureSpec + ModelSpec[] + buildBody + errorCodeMap
 */
import type { AppErrorCode } from '@shared/error';
import type { FeatureSpec, ModelSpec } from '../ai-platform/types';
import { getSidecarManager } from '../ai-platform/sidecarManager';
import { getModelRegistry } from '../ai-platform/modelRegistry';

export const STARVECTOR_FEATURE_ID = 'starvector';

/** StarVector 推理请求参数(对外抽象) */
export interface StarVectorSubmitInput {
  inputPath: string;
  /** 最大生成 token 数,默认 8192 */
  maxNewTokens?: number;
  /** 温度,默认 0.1 */
  temperature?: number;
  /** 是否采样,默认 false = greedy */
  doSample?: boolean;
}

const STARVECTOR_MODELS: ModelSpec[] = [
  {
    id: 'starvector-1b-im2svg',
    displayName: 'StarVector 1B(im2svg)',
    licenseNote:
      'Apache 2.0(StarVector 官方仓库:github.com/joanrod/star-vector)。SVG 生成模型,~4 GB。',
    relPath: 'models/starvector-1b-im2svg',
    isDirectory: true,
    expectedBytes: 0, // 目录,probe 看 config.json 存在
    sources: [
      {
        name: 'huggingface',
        url: 'https://huggingface.co/starvector/starvector-1b-im2svg'
      },
      {
        name: 'hf-mirror',
        url: 'https://hf-mirror.com/starvector/starvector-1b-im2svg',
        mirror: true
      },
      {
        name: 'modelscope',
        url: 'https://www.modelscope.cn/models/starvector/starvector-1b-im2svg',
        mirror: true
      }
    ],
    usedBy: [STARVECTOR_FEATURE_ID]
  }
];

const STARVECTOR_FEATURE: FeatureSpec = {
  id: STARVECTOR_FEATURE_ID,
  displayName: 'StarVector · AI 精准矢量化',
  description:
    '本地 StarVector-1B 模型,图标 / 简单 logo / UI 图形效果好。Python sidecar(端口 7867)。失败自动回退 VTracer,UI 显式标注。',
  category: 'image-to-svg',
  port: 7867,
  startBat: 'start_starvector.bat',
  stopBat: 'stop_starvector.bat',
  installBats: ['install_starvector_extras.bat'],
  serverScaffoldRelPath: 'app/starvector_server/server.py',
  requiredModelIds: STARVECTOR_MODELS.map((m) => m.id),
  errorCodeMap: {
    // 用户清单 §6 末尾 15 类错误码,核心 11 类先映射
    MODEL_PATH_NOT_CONFIGURED: 'CONFIG_MISSING',
    MODEL_PATH_NOT_FOUND: 'FILE_NOT_FOUND',
    MODEL_LOAD_FAILED: 'CONFIG_INVALID',
    INFERENCE_FAILED: 'API_FAILED',
    OUTPUT_TRUNCATED: 'API_FAILED',
    OUTPUT_NO_SVG_TAG: 'API_FAILED',
    OUTPUT_NO_VISIBLE_ELEMENTS: 'API_FAILED',
    INPUT_NOT_FOUND: 'FILE_NOT_FOUND',
    INPUT_INVALID_FORMAT: 'VALIDATION_FAILED',
    VRAM_INSUFFICIENT: 'API_FAILED',
    MISSING_TRANSFORMERS: 'CONFIG_INVALID',
    MISSING_TORCH: 'CONFIG_INVALID',
    PORT_OCCUPIED: 'NETWORK_OFFLINE',
    TASK_NOT_FOUND: 'VALIDATION_FAILED',
    CANCELLED: 'CANCELLED'
  }
};

/** mengbi 抽象层 input → StarVector server 期望的 snake_case body */
export function buildStarVectorSubmitBody(
  input: StarVectorSubmitInput
): Record<string, unknown> {
  return {
    input_path: input.inputPath,
    max_new_tokens: input.maxNewTokens ?? 8192,
    temperature: input.temperature ?? 0.1,
    do_sample: input.doSample ?? false
  };
}

export function mapStarVectorErrorCode(code: string | null): AppErrorCode {
  if (!code) return 'UNKNOWN';
  return STARVECTOR_FEATURE.errorCodeMap?.[code] ?? 'UNKNOWN';
}

/** 启动期注册到通用底座;幂等 */
export function registerStarVectorFeature(): void {
  getSidecarManager().register(STARVECTOR_FEATURE);
  getModelRegistry().registerMany(STARVECTOR_MODELS);
}
