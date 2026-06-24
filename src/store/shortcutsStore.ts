/**
 * 侧栏自定义快捷方式（外部文件夹 / 外部软件 / 网址链接）+ 分组。
 *
 * 持久化到 localStorage（仿 themeStore）：小列表 + UI 态，无需进 DB。
 * - folder 点击 → 资源管理器打开该目录
 * - app    点击 → 启动该软件（图标取系统图标）
 * - url    点击 → 系统浏览器打开该网址（path 复用存 URL）
 *
 * 分组（group）：把若干快捷方式聚成一个按钮，点开浮窗列出成员逐个启动。
 * 顶层布局由 `order`（条目序列：item 或 group）定义；归入分组的 item 不在顶层出现，
 * 只在分组浮窗里出现。旧存档无 groups/order 时由 migrate 自动补齐（全部 item 平铺）。
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { reorderArray } from '@/lib/arrayMove';

export type ShortcutKind = 'folder' | 'app' | 'url';

export interface Shortcut {
  id: string;
  kind: ShortcutKind;
  label: string;
  /** folder/app=本地路径；url=网址（http(s):// ...） */
  path: string;
  /** app：该软件的系统图标 dataURI；folder/url / 提取失败时缺省（前端回退默认图标） */
  iconDataUri?: string;
}

export interface ShortcutGroup {
  id: string;
  name: string;
  /** 成员快捷方式 id（按浮窗里展示的顺序） */
  itemIds: string[];
}

/** 顶层布局条目：一个独立快捷方式，或一个分组。 */
export type ShortcutEntry =
  | { type: 'item'; id: string }
  | { type: 'group'; id: string };

interface ShortcutsState {
  shortcuts: Shortcut[];
  groups: ShortcutGroup[];
  /** 顶层渲染顺序（item / group 混排） */
  order: ShortcutEntry[];

  addShortcut: (s: Omit<Shortcut, 'id'>) => void;
  removeShortcut: (id: string) => void;
  renameShortcut: (id: string, label: string) => void;
  setShortcutIcon: (id: string, iconDataUri?: string) => void;

  /** 顶层条目重排：把第 fromIdx 个顶层条目移到 toIdx 位置 */
  reorderEntry: (fromIdx: number, toIdx: number) => void;

  /** 把 dragId 拖到 targetId 上 → 成组（任一为分组则并入；都是 item 则新建分组） */
  groupOnto: (dragId: string, targetId: string) => void;
  /** 把某 item 加入某分组（从顶层/原分组移出） */
  addToGroup: (groupId: string, itemId: string) => void;
  /** 把某 item 移出分组 → 回到顶层（插到该分组顶层条目之后） */
  removeFromGroup: (itemId: string) => void;
  /** 解散分组：成员回到顶层（替换该分组在 order 中的位置），删除分组 */
  ungroup: (groupId: string) => void;
  renameGroup: (groupId: string, name: string) => void;
}

function newId(prefix = 'sc'): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  }
}

/** 删除/移出某 item id 后清理 groups（空分组顺带删除），返回 {groups, order}。 */
function pruneGroups(
  groups: ShortcutGroup[],
  order: ShortcutEntry[]
): { groups: ShortcutGroup[]; order: ShortcutEntry[] } {
  const kept = groups.filter((g) => g.itemIds.length > 0);
  const keptIds = new Set(kept.map((g) => g.id));
  const nextOrder = order.filter((e) => (e.type === 'group' ? keptIds.has(e.id) : true));
  return { groups: kept, order: nextOrder };
}

/** 找出某 item 当前所在分组（若有）。 */
function groupOf(groups: ShortcutGroup[], itemId: string): ShortcutGroup | undefined {
  return groups.find((g) => g.itemIds.includes(itemId));
}

export const useShortcutsStore = create<ShortcutsState>()(
  persist(
    (set) => ({
      shortcuts: [],
      groups: [],
      order: [],

      addShortcut: (s) =>
        set((st) => {
          const id = newId();
          return {
            shortcuts: [...st.shortcuts, { ...s, id }],
            order: [...st.order, { type: 'item', id } as ShortcutEntry]
          };
        }),

      removeShortcut: (id) =>
        set((st) => {
          const shortcuts = st.shortcuts.filter((x) => x.id !== id);
          const groups = st.groups.map((g) =>
            g.itemIds.includes(id) ? { ...g, itemIds: g.itemIds.filter((x) => x !== id) } : g
          );
          const order = st.order.filter((e) => !(e.type === 'item' && e.id === id));
          return { shortcuts, ...pruneGroups(groups, order) };
        }),

      renameShortcut: (id, label) =>
        set((st) => ({ shortcuts: st.shortcuts.map((x) => (x.id === id ? { ...x, label } : x)) })),

      setShortcutIcon: (id, iconDataUri) =>
        set((st) => ({
          shortcuts: st.shortcuts.map((x) => (x.id === id ? { ...x, iconDataUri } : x))
        })),

      reorderEntry: (fromIdx, toIdx) => set((st) => ({ order: reorderArray(st.order, fromIdx, toIdx) })),

      groupOnto: (dragId, targetId) =>
        set((st) => {
          if (dragId === targetId) return st;
          const dragIsGroup = st.groups.some((g) => g.id === dragId);
          const targetGroup = st.groups.find((g) => g.id === targetId);
          // 拖动的是分组 → 不支持把分组拖进别处（避免嵌套），忽略
          if (dragIsGroup) return st;

          // 1) 目标是分组：把 drag item 并入该分组
          if (targetGroup) {
            if (targetGroup.itemIds.includes(dragId)) return st;
            const groups = st.groups.map((g) => {
              if (g.id === targetGroup.id) return { ...g, itemIds: [...g.itemIds, dragId] };
              return g.itemIds.includes(dragId)
                ? { ...g, itemIds: g.itemIds.filter((x) => x !== dragId) }
                : g;
            });
            const order = st.order.filter((e) => !(e.type === 'item' && e.id === dragId));
            return { ...pruneGroups(groups, order) };
          }

          // 2) 目标是另一个独立 item：新建分组，把两者收进去
          const dragItem = st.shortcuts.find((x) => x.id === dragId);
          const targetItem = st.shortcuts.find((x) => x.id === targetId);
          if (!dragItem || !targetItem) return st;
          const gid = newId('grp');
          const newGroup: ShortcutGroup = { id: gid, name: '分组', itemIds: [targetId, dragId] };
          // 从旧分组里摘掉这两个 item（若它们之前在别的分组）
          const groups = st.groups
            .map((g) => ({
              ...g,
              itemIds: g.itemIds.filter((x) => x !== dragId && x !== targetId)
            }))
            .concat(newGroup);
          // order：把 target 的 item 条目替换成新分组，删掉 drag 的 item 条目
          const order: ShortcutEntry[] = [];
          for (const e of st.order) {
            if (e.type === 'item' && e.id === targetId) order.push({ type: 'group', id: gid });
            else if (e.type === 'item' && e.id === dragId) continue;
            else order.push(e);
          }
          // 若 target 不在顶层（理论上独立 item 必在顶层），兜底追加
          if (!order.some((e) => e.type === 'group' && e.id === gid)) {
            order.push({ type: 'group', id: gid });
          }
          return { ...pruneGroups(groups, order) };
        }),

      addToGroup: (groupId, itemId) =>
        set((st) => {
          const target = st.groups.find((g) => g.id === groupId);
          if (!target || target.itemIds.includes(itemId)) return st;
          const groups = st.groups.map((g) => {
            if (g.id === groupId) return { ...g, itemIds: [...g.itemIds, itemId] };
            return g.itemIds.includes(itemId)
              ? { ...g, itemIds: g.itemIds.filter((x) => x !== itemId) }
              : g;
          });
          const order = st.order.filter((e) => !(e.type === 'item' && e.id === itemId));
          return { ...pruneGroups(groups, order) };
        }),

      removeFromGroup: (itemId) =>
        set((st) => {
          const g = groupOf(st.groups, itemId);
          if (!g) return st;
          const groups = st.groups.map((x) =>
            x.id === g.id ? { ...x, itemIds: x.itemIds.filter((i) => i !== itemId) } : x
          );
          // 把 item 插到该分组在顶层的位置之后
          const gIdx = st.order.findIndex((e) => e.type === 'group' && e.id === g.id);
          const order = st.order.slice();
          const entry: ShortcutEntry = { type: 'item', id: itemId };
          if (gIdx >= 0) order.splice(gIdx + 1, 0, entry);
          else order.push(entry);
          return { ...pruneGroups(groups, order) };
        }),

      ungroup: (groupId) =>
        set((st) => {
          const g = st.groups.find((x) => x.id === groupId);
          if (!g) return st;
          const groups = st.groups.filter((x) => x.id !== groupId);
          // 在 order 里用成员 item 条目替换该分组条目
          const memberEntries: ShortcutEntry[] = g.itemIds.map((id) => ({ type: 'item', id }));
          const order: ShortcutEntry[] = [];
          for (const e of st.order) {
            if (e.type === 'group' && e.id === groupId) order.push(...memberEntries);
            else order.push(e);
          }
          return { groups, order };
        }),

      renameGroup: (groupId, name) =>
        set((st) => ({
          groups: st.groups.map((g) => (g.id === groupId ? { ...g, name } : g))
        }))
    }),
    {
      name: 'mengbi-sidebar-shortcuts',
      storage: createJSONStorage(() => localStorage),
      version: 2,
      // v1（无 groups/order，shortcuts[].kind ∈ folder|app）→ v2：补齐 groups=[]、order=全部 item 平铺。
      migrate: (persisted: unknown): ShortcutsState => {
        const s = (persisted ?? {}) as Partial<ShortcutsState>;
        const shortcuts = Array.isArray(s.shortcuts) ? s.shortcuts : [];
        const groups = Array.isArray(s.groups) ? s.groups : [];
        let order = Array.isArray(s.order) ? s.order : [];
        // order 缺失/不完整 → 重建：分组里的 item 不放顶层，其余 item 平铺。
        const grouped = new Set(groups.flatMap((g) => g.itemIds));
        if (!order.length) {
          order = shortcuts.filter((x) => !grouped.has(x.id)).map((x) => ({ type: 'item', id: x.id }));
          order = [...order, ...groups.map((g) => ({ type: 'group', id: g.id }) as ShortcutEntry)];
        }
        return { ...(s as ShortcutsState), shortcuts, groups, order };
      }
    }
  )
);
