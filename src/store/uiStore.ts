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
/** 资产库类型分拣：全部 / 图片 / 视频 / 其它（SVG/PSD/PDF/Office 等文档类） */
export type KindFilter = 'all' | 'image' | 'video' | 'other';
export type DateFilter = 'all' | 'today' | 'week' | 'month';
export type SortMode = 'newest' | 'oldest';
export type ChatPanelMode = 'chat' | 'image';
export type SettingsTab = 'plans' | 'intelligent' | 'appearance' | 'storage' | 'tools' | 'about';

interface UIState {
  // 资产库页面
  managerMode: ManagerMode;
  managerSlug: string;
  managerSearch: string;
  managerKindFilter: KindFilter;
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

  // 头像：内置 key 或 'custom'
  avatarKey: string;
  /** 用户上传的自定义头像（dataUri）；avatarKey === 'custom' 时使用 */
  customAvatarDataUri: string;
  /** 各对话的最后滚动位置（conversationId → 像素）—— 跨页面/快速切换对话各自记住 */
  chatScrollTops: Record<string, number>;
  /** 在管家中标记为"快捷"的提示词 ID —— 渲染在对话/生图发送按钮左侧 */
  shortcutPromptIds: number[];
  /** 缓存各 shortcut prompt 的 { title, text }，避免每次切页都要重新拉一次 prompt.list */
  shortcutPromptCache: Record<number, { title: string; text: string }>;

  setAvatarKey: (k: string) => void;
  setCustomAvatarDataUri: (s: string) => void;
  setChatScrollTop: (id: string, n: number) => void;
  toggleShortcutPromptId: (id: number) => void;
  setShortcutPromptIds: (ids: number[]) => void;
  setShortcutPromptCache: (cache: Record<number, { title: string; text: string }>) => void;
  upsertShortcutPromptCache: (id: number, value: { title: string; text: string }) => void;

  // setter 们
  setManagerMode: (m: ManagerMode) => void;
  setManagerSlug: (s: string) => void;
  setManagerSearch: (s: string) => void;
  setManagerKindFilter: (s: KindFilter) => void;
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
      managerKindFilter: 'all',
      managerDateFilter: 'all',
      managerModelFilter: 'all',
      managerAspectFilter: 'all',
      managerSort: 'newest',
      managerActiveTags: [],

      settingsTab: 'plans',

      chatMode: 'chat',
      chatModelId: '',

      avatarKey: 'default',
      customAvatarDataUri: '',
      chatScrollTops: {},
      shortcutPromptIds: [],
      shortcutPromptCache: {},

      setAvatarKey: (k) => set({ avatarKey: k }),
      setCustomAvatarDataUri: (s) => set({ customAvatarDataUri: s }),
      setChatScrollTop: (id, n) => set((s) => ({ chatScrollTops: { ...s.chatScrollTops, [id]: n } })),
      toggleShortcutPromptId: (id) =>
        set((s) => {
          const cur = s.shortcutPromptIds;
          const next = cur.includes(id)
            ? cur.filter((x) => x !== id)
            : [...cur, id].slice(-12); // 最多 12 个，超出则丢最早的
          // 移除时清缓存
          const nextCache = { ...s.shortcutPromptCache };
          if (cur.includes(id)) delete nextCache[id];
          return { shortcutPromptIds: next, shortcutPromptCache: nextCache };
        }),
      setShortcutPromptIds: (ids) => set({ shortcutPromptIds: ids.slice(0, 12) }),
      setShortcutPromptCache: (cache) => set({ shortcutPromptCache: cache }),
      upsertShortcutPromptCache: (id, value) =>
        set((s) => ({
          shortcutPromptCache: { ...s.shortcutPromptCache, [id]: value }
        })),

      setManagerMode: (m) => set({ managerMode: m }),
      setManagerSlug: (s) => set({ managerSlug: s }),
      setManagerSearch: (s) => set({ managerSearch: s }),
      setManagerKindFilter: (s) => set({ managerKindFilter: s }),
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
