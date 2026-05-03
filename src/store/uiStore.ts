import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

/**
 * 跨页面 UI 状态——切换页面再切回来要"记住上次操作在哪儿"。
 * 任何页面里曾用 useState 描述"最后一次选了哪个 tab / 筛选条件 / 模式"的，
 * 都搬到这个 store 来。
 *
 * 持久化到 localStorage，所以重启软件也保留。
 */

export type ManagerMode = 'gallery' | 'prompt';
export type DateFilter = 'all' | 'today' | 'week' | 'month';
export type SortMode = 'newest' | 'oldest';
export type ChatPanelMode = 'chat' | 'image';
export type SettingsTab = 'plans' | 'appearance' | 'storage';

interface UIState {
  // 提示词管家页面
  managerMode: ManagerMode;
  managerSlug: string;
  managerSearch: string;
  managerDateFilter: DateFilter;
  managerModelFilter: string;
  managerAspectFilter: string;
  managerSort: SortMode;
  managerActiveTags: string[];

  // 设置页
  settingsTab: SettingsTab;

  // 生图页 / 聊天面板
  chatMode: ChatPanelMode;
  chatModelId: string;

  // setter 们
  setManagerMode: (m: ManagerMode) => void;
  setManagerSlug: (s: string) => void;
  setManagerSearch: (s: string) => void;
  setManagerDateFilter: (s: DateFilter) => void;
  setManagerModelFilter: (s: string) => void;
  setManagerAspectFilter: (s: string) => void;
  setManagerSort: (s: SortMode) => void;
  setManagerActiveTags: (a: string[]) => void;

  setSettingsTab: (t: SettingsTab) => void;

  setChatMode: (m: ChatPanelMode) => void;
  setChatModelId: (id: string) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      managerMode: 'gallery',
      managerSlug: 'all',
      managerSearch: '',
      managerDateFilter: 'all',
      managerModelFilter: 'all',
      managerAspectFilter: 'all',
      managerSort: 'newest',
      managerActiveTags: [],

      settingsTab: 'plans',

      chatMode: 'chat',
      chatModelId: '',

      setManagerMode: (m) => set({ managerMode: m }),
      setManagerSlug: (s) => set({ managerSlug: s }),
      setManagerSearch: (s) => set({ managerSearch: s }),
      setManagerDateFilter: (s) => set({ managerDateFilter: s }),
      setManagerModelFilter: (s) => set({ managerModelFilter: s }),
      setManagerAspectFilter: (s) => set({ managerAspectFilter: s }),
      setManagerSort: (s) => set({ managerSort: s }),
      setManagerActiveTags: (a) => set({ managerActiveTags: a }),

      setSettingsTab: (t) => set({ settingsTab: t }),

      setChatMode: (m) => set({ chatMode: m }),
      setChatModelId: (id) => set({ chatModelId: id })
    }),
    {
      name: 'mengbi-ui',
      storage: createJSONStorage(() => localStorage)
    }
  )
);
