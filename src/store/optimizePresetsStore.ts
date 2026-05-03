import { create } from 'zustand';
import { OPTIMIZE_PRESETS, type OptimizePreset } from '@/data/optimizePresets';

/**
 * 优化预设：内置 + 用户自定义。
 * 用户自定义部分序列化为 JSON 存进 settings 表（key = `user_optimize_presets`），
 * 启动时由 useSettingsStore.load 顺带带回来，再灌入这个 store。
 *
 * 内置不可改不可删；用户的能编辑能删。
 */

export interface UserPreset extends OptimizePreset {
  builtin?: false;
}

interface OptimizePresetsState {
  userPresets: UserPreset[];
  loaded: boolean;

  setUserPresetsRaw: (json: string | null | undefined) => void;
  /** 内置 + 用户合并后的全集 */
  all: () => OptimizePreset[];
  /** 按 key 找 preset */
  byKey: (key: string) => OptimizePreset | null;
  /** 添加 / 更新一条用户 preset，返回是否成功 */
  upsertUser: (preset: UserPreset) => Promise<boolean>;
  /** 删除一条用户 preset */
  removeUser: (key: string) => Promise<boolean>;
}

async function persistToBackend(presets: UserPreset[]): Promise<void> {
  const json = JSON.stringify(presets);
  await window.electronAPI.settings.save({
    prefs: { user_optimize_presets: json }
  });
}

export const useOptimizePresetsStore = create<OptimizePresetsState>((set, get) => ({
  userPresets: [],
  loaded: false,

  setUserPresetsRaw: (json) => {
    if (!json) {
      set({ userPresets: [], loaded: true });
      return;
    }
    try {
      const arr = JSON.parse(json) as UserPreset[];
      if (Array.isArray(arr)) {
        set({ userPresets: arr.filter((p) => p && p.key && p.name && p.system), loaded: true });
        return;
      }
    } catch {
      /* ignore */
    }
    set({ userPresets: [], loaded: true });
  },

  all: () => {
    const builtin = OPTIMIZE_PRESETS.map((p) => ({ ...p, builtin: true } as OptimizePreset & { builtin: true }));
    return [...builtin, ...get().userPresets];
  },

  byKey: (key) => {
    return get().all().find((p) => p.key === key) ?? null;
  },

  upsertUser: async (preset) => {
    const cur = get().userPresets;
    // 不允许覆盖内置 key
    if (OPTIMIZE_PRESETS.some((b) => b.key === preset.key)) return false;
    const idx = cur.findIndex((p) => p.key === preset.key);
    const next = idx >= 0 ? cur.map((p, i) => (i === idx ? preset : p)) : [...cur, preset];
    set({ userPresets: next });
    try {
      await persistToBackend(next);
      return true;
    } catch {
      return false;
    }
  },

  removeUser: async (key) => {
    const next = get().userPresets.filter((p) => p.key !== key);
    set({ userPresets: next });
    try {
      await persistToBackend(next);
      return true;
    } catch {
      return false;
    }
  }
}));
