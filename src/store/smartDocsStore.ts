/**
 * 智能画布「文档库」：管理多个智能画布工程的元数据 + 当前打开的文档 id。
 * 每个文档的图内容（nodes/edges/viewport）单独存 localStorage（见 lib/smartDocStorage.ts），
 * 本 store 只持久化轻量元数据（key `mengbi.smartCanvas.docs.v1`），避免把所有大图塞进一个键爆配额。
 * 与 /canvas（画板）物理隔离：这里只管智能画布文档。
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface SmartDocMeta {
  id: string;
  title: string;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  nodeCount: number;
}

function rid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `doc-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
  }
}
function nowIso(): string {
  return new Date().toISOString();
}

interface SmartDocsState {
  docs: SmartDocMeta[];
  /** 当前打开的文档；null = 显示「选择画布」启动页 */
  activeDocId: string | null;
  /** 已打开成标签页的文档 id（会话态、不持久化）；setActive 自动加入，closeTab 移除 */
  openIds: string[];
  /** 旧单文档（mengbi.smartCanvas.v1）是否已迁移；防删空后又把旧数据迁回 */
  migrated: boolean;
  createDoc: (title?: string) => string;
  renameDoc: (id: string, title: string) => void;
  deleteDoc: (id: string) => void;
  /** 自动保存时更新文档元数据（节点数 + 修改时间） */
  touch: (id: string, nodeCount: number) => void;
  setActive: (id: string | null) => void;
  /** 关闭一个标签页（不删除文档）；若关的是当前页，切到相邻标签或启动页（仅改 openIds/active，内容载入见 lib/smartDocStorage.closeDocTab） */
  closeTab: (id: string) => void;
  markMigrated: () => void;
}

export const useSmartDocsStore = create<SmartDocsState>()(
  persist(
    (set) => ({
      docs: [],
      activeDocId: null,
      openIds: [],
      migrated: false,

      createDoc: (title) => {
        const id = rid();
        const meta: SmartDocMeta = {
          id,
          title: title?.trim() || '未命名画布',
          createdAt: nowIso(),
          updatedAt: nowIso(),
          nodeCount: 0
        };
        set((s) => ({ docs: [meta, ...s.docs] }));
        return id;
      },

      renameDoc: (id, title) =>
        set((s) => ({
          docs: s.docs.map((d) => (d.id === id ? { ...d, title: title.trim() || d.title, updatedAt: nowIso() } : d))
        })),

      deleteDoc: (id) =>
        set((s) => ({
          docs: s.docs.filter((d) => d.id !== id),
          openIds: s.openIds.filter((x) => x !== id),
          activeDocId: s.activeDocId === id ? null : s.activeDocId
        })),

      touch: (id, nodeCount) =>
        set((s) => ({
          docs: s.docs.map((d) => (d.id === id ? { ...d, nodeCount, updatedAt: nowIso() } : d))
        })),

      setActive: (activeDocId) =>
        set((s) => ({
          activeDocId,
          openIds: activeDocId && !s.openIds.includes(activeDocId) ? [...s.openIds, activeDocId] : s.openIds
        })),

      closeTab: (id) =>
        set((s) => {
          const openIds = s.openIds.filter((x) => x !== id);
          let activeDocId = s.activeDocId;
          if (activeDocId === id) {
            const idx = s.openIds.indexOf(id);
            // 优先右邻、否则左邻、否则启动页
            activeDocId = openIds[idx] ?? openIds[idx - 1] ?? null;
          }
          return { openIds, activeDocId };
        }),

      markMigrated: () => set({ migrated: true })
    }),
    {
      name: 'mengbi.smartCanvas.docs.v1',
      // activeDocId 不持久化：切到其它功能再回来仍停在当前画布（store 内存态保留），
      // 但重启软件后归 null → 回到「选择画布」启动页。
      partialize: (s) => ({ docs: s.docs, migrated: s.migrated })
    }
  )
);
