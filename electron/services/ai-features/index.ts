/**
 * 内置 AI 功能注册入口。
 *
 * mengbi 启动时(main.ts / ipc/index.ts)调一次 registerBuiltinAiFeatures(),
 * 把 HYPIR、SUPIR 这些"自带功能"挂到 SidecarManager + ModelRegistry。
 *
 * 加新 AI 功能 = 在这里多 import 一个 register*Feature() 调用。
 *
 * 2026-05-28: StarVector(矢量化 AI 精准模式)整体砍除 ——
 *   实测效果与 OmniSVG 同质化失败。
 */
import { logger } from '../logger';
import { registerHypirFeature } from './hypir';
import { registerSupirFeature } from './supir';
import { registerRealEsrganPytorchFeature } from './realesrgan-pytorch';

let registered = false;

export function registerBuiltinAiFeatures(): void {
  if (registered) return;
  registered = true;
  registerHypirFeature();
  registerSupirFeature();
  registerRealEsrganPytorchFeature();
  logger.info('[ai-platform] builtin features registered: hypir, supir, realesrgan-pytorch');
}

export { HYPIR_FEATURE_ID, buildHypirSubmitBody, mapHypirErrorCode } from './hypir';
export type { HypirSubmitInput } from './hypir';
export { SUPIR_FEATURE_ID, buildSupirSubmitBody, mapSupirErrorCode } from './supir';
export type { SupirSubmitInput } from './supir';
export {
  REALESRGAN_PYTORCH_FEATURE_ID,
  buildRealEsrganPytorchSubmitBody,
  mapRealEsrganPytorchErrorCode
} from './realesrgan-pytorch';
export type { RealEsrganPytorchSubmitInput } from './realesrgan-pytorch';
