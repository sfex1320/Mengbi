/**
 * 内置 AI 功能注册入口。
 *
 * mengbi 启动时(main.ts / ipc/index.ts)调一次 registerBuiltinAiFeatures(),
 * 把 HYPIR 这种"自带功能"挂到 SidecarManager + ModelRegistry。
 *
 * 加新 AI 功能 = 在这里多 import 一个 register*Feature() 调用。
 *
 * 砍除历史:
 *   2026-05-28: StarVector(矢量化 AI 精准模式)整体砍除 —— 实测效果与 OmniSVG 同质化失败。
 *   2026-05-28: realesrgan-pytorch sidecar 整体砍除 —— 改用 onnxruntime-node 主进程内推理。
 *   2026-05-29: SUPIR 整体砍除 —— 显存需求 25-30 GB 太大,常见配置带不动,
 *     需要 CLIP-G + SDXL_base + SUPIR-v0F 三个权重共 ~34 GB,跑起来风险高、价值小。
 */
import { logger } from '../logger';
import { registerHypirFeature } from './hypir';

let registered = false;

export function registerBuiltinAiFeatures(): void {
  if (registered) return;
  registered = true;
  registerHypirFeature();
  logger.info('[ai-platform] builtin features registered: hypir');
}

export { HYPIR_FEATURE_ID, buildHypirSubmitBody, mapHypirErrorCode } from './hypir';
export type { HypirSubmitInput } from './hypir';
