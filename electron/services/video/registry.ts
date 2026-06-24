/**
 * 视频适配器注册表：video_kind → VideoProviderAdapter 工厂。
 *
 * 已实现：seedance（APIMart Seedance 2.0）、custom（自定义中转站，基础预留）。
 * 预留：kling / veo / runway / fal —— 只需在此再注册一个工厂 + 写对应 Adapter 子类，零改画布节点。
 * 注意：legacy 的 'kling'/'sora'/'unified' 仍走 electron/ipc/video.ts 的内置简易引擎（不在本注册表内）。
 */

import type { VideoProviderAdapter, AdapterContext } from './adapter';
import { ApiMartSeedanceAdapter, CustomVideoAdapter } from './seedanceAdapter';
import { VeoAdapter, RunwayAdapter, FalAdapter } from './moreAdapters';

type AdapterFactory = (ctx: AdapterContext) => VideoProviderAdapter;

const REGISTRY: Record<string, AdapterFactory> = {
  seedance: (ctx) => new ApiMartSeedanceAdapter(ctx),
  veo: (ctx) => new VeoAdapter(ctx),
  runway: (ctx) => new RunwayAdapter(ctx),
  fal: (ctx) => new FalAdapter(ctx),
  custom: (ctx) => new CustomVideoAdapter(ctx)
  // kling/sora/unified 走 electron/ipc/video.ts 的 legacy 简易引擎（不在本注册表）。
};

/** 该 video_kind 是否走 adapter（true）还是 legacy 简易引擎（false）。 */
export function isAdapterKind(videoKind: string | null | undefined): boolean {
  return !!videoKind && videoKind in REGISTRY;
}

/** 取适配器实例；未注册返回 null（调用方回退 legacy 或报错）。 */
export function getVideoAdapter(videoKind: string, ctx: AdapterContext): VideoProviderAdapter | null {
  const factory = REGISTRY[videoKind];
  return factory ? factory(ctx) : null;
}
