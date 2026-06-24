import { create } from 'zustand';
import type { UpscaleEngineStatus } from '@shared/ipc';

/**
 * 工具箱引擎状态缓存。
 *
 * 为什么需要：
 * - RealESRGAN 引擎扫描跨标签切换缓存省事，不必每次 mount 重扫。
 *
 * 策略：
 * - 状态只在首次需要时拉一次；后续来回切走缓存
 * - 单飞 promise：refresh* 多个并发调用会复用同一个进行中的 promise
 * - 显式 "重新检测" 按钮可强制重拉
 */

interface ToolsEngineState {
  upscaleStatus: UpscaleEngineStatus | null;
  upscaleStatusLoading: boolean;
  refreshUpscaleStatus: (force?: boolean) => Promise<void>;
}

let upscaleInflight: Promise<void> | null = null;

export const useToolsEngineStore = create<ToolsEngineState>((set, get) => ({
  upscaleStatus: null,
  upscaleStatusLoading: false,
  refreshUpscaleStatus: async (force = false) => {
    if (!force && get().upscaleStatus) return;
    if (upscaleInflight) return upscaleInflight;
    upscaleInflight = (async () => {
      set({ upscaleStatusLoading: true });
      try {
        const r = await window.electronAPI.upscale.status();
        if (r.ok) set({ upscaleStatus: r.data });
      } finally {
        set({ upscaleStatusLoading: false });
        upscaleInflight = null;
      }
    })();
    return upscaleInflight;
  }
}));
