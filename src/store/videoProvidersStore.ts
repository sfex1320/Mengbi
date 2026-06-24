/**
 * 视频供应商 / 模型「富配置」中心（渲染端）。
 * 持久化复用现有 settings 表：读 prefs.video_providers_json、写 settings.save({prefs})。
 * 内置 APIMart Seedance 模板（@shared/videoProviders）作为默认，可一键恢复。
 * 主进程 adapter 读同一份合并结果（electron/ipc/video.ts:loadMergedVideoConfig），保证一致。
 */

import { create } from 'zustand';
import {
  BUILTIN_VIDEO_PROVIDERS,
  mergeVideoProvidersConfig,
  type VideoProvidersConfig
} from '@shared/videoProviders';

interface VideoProvidersState {
  config: VideoProvidersConfig;
  loaded: boolean;
  loading: boolean;
  /** 首次访问时按需加载（settings.get → 合并）。 */
  ensureLoaded: () => Promise<void>;
  reload: () => Promise<void>;
  /** 整体替换并持久化。 */
  save: (next: VideoProvidersConfig) => Promise<void>;
  /** 恢复出厂内置模板。 */
  resetToBuiltin: () => Promise<void>;
}

function clone(v: VideoProvidersConfig): VideoProvidersConfig {
  return JSON.parse(JSON.stringify(v)) as VideoProvidersConfig;
}

async function fetchMerged(): Promise<VideoProvidersConfig> {
  const r = await window.electronAPI.settings.get();
  const raw = r.ok ? r.data.prefs?.video_providers_json : undefined;
  return mergeVideoProvidersConfig(raw ?? null);
}

export const useVideoProvidersStore = create<VideoProvidersState>((set, get) => ({
  config: clone(BUILTIN_VIDEO_PROVIDERS),
  loaded: false,
  loading: false,

  ensureLoaded: async () => {
    if (get().loaded || get().loading) return;
    set({ loading: true });
    try {
      set({ config: await fetchMerged(), loaded: true });
    } catch {
      set({ loaded: true });
    } finally {
      set({ loading: false });
    }
  },

  reload: async () => {
    set({ loading: true });
    try {
      set({ config: await fetchMerged(), loaded: true });
    } finally {
      set({ loading: false });
    }
  },

  save: async (next) => {
    set({ config: next });
    await window.electronAPI.settings
      .save({ prefs: { video_providers_json: JSON.stringify(next) } })
      .catch(() => {
        /* 持久化失败不打断当前编辑（下次 reload 会回退） */
      });
  },

  resetToBuiltin: async () => {
    await get().save(clone(BUILTIN_VIDEO_PROVIDERS));
  }
}));
