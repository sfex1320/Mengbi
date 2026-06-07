import { create } from 'zustand';
import type { ApiPlan, ApiConfig } from '@shared/domain';
import { useOptimizePresetsStore } from './optimizePresetsStore';

interface SettingsState {
  loaded: boolean;
  loading: boolean;
  plans: ApiPlan[];
  configs: ApiConfig[];
  prefs: Record<string, string>;
  /** 当前激活的方案 id */
  activePlanId: number | null;

  load: () => Promise<void>;
  setActivePlanId: (id: number | null) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  loaded: false,
  loading: false,
  plans: [],
  configs: [],
  prefs: {},
  activePlanId: null,

  load: async () => {
    set({ loading: true });
    const result = await window.electronAPI.settings.get();
    if (result.ok) {
      const { plans, configs, prefs } = result.data;
      const stored = prefs.active_plan_id ? Number(prefs.active_plan_id) : null;
      const activePlanId =
        stored && plans.some((p) => p.id === stored) ? stored : plans[0]?.id ?? null;
      set({ plans, configs, prefs, activePlanId, loaded: true, loading: false });
      // 顺手把用户自定义优化预设灌进 optimizePresetsStore
      useOptimizePresetsStore.getState().setUserPresetsRaw(prefs.user_optimize_presets);
    } else {
      // 加载失败时仍标记 loaded，让 UI 跳出 loading 态
      console.error('settings.get failed', result.error);
      set({ loaded: true, loading: false });
    }
  },

  setActivePlanId: (id) => {
    set({ activePlanId: id });
    // 持久化激活方案，重启后恢复（fire-and-forget，失败不打扰主流程）
    void window.electronAPI.settings
      .save({ prefs: { active_plan_id: id == null ? '' : String(id) } })
      .catch(() => {});
  }
}));
