import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { NotificationAppendPayload } from '@shared/ipc';

/**
 * 通知中心：常驻的"操作日志"——把瞬时 toast 留不住的失败保存下来供回看。
 *
 * 设计要点：
 * - 仅记"写动作"类操作（提交绘图、保存设置、删除等），读类不进入。
 * - 容量上限 MAX_ENTRIES，FIFO 丢弃最旧。理由：localStorage quota 安全。
 * - lastOpenedAt 用来计算"未读失败计数"作为铃铛 badge 数字。
 *   这里"未读"指 ts > lastOpenedAt 的 failure 条目，不维护单条已读标记。
 * - 不做"一条记录的扩展详情" — 面板里直接展示完整信息（标签 + 错误码 + 消息 + hint）。
 */

const MAX_ENTRIES = 200;
const STORAGE_KEY = 'mb-notifications';

export type NotificationEntry = NotificationAppendPayload;

interface NotificationState {
  entries: NotificationEntry[];
  /** 最近一次"打开面板"的时间戳。用于计算未读失败数。 */
  lastOpenedAt: number;

  append: (entry: NotificationEntry) => void;
  markAllRead: () => void;
  clear: () => void;
}

export const useNotificationStore = create<NotificationState>()(
  persist(
    (set) => ({
      entries: [],
      lastOpenedAt: 0,
      append: (entry) =>
        set((s) => {
          const next = [entry, ...s.entries];
          if (next.length > MAX_ENTRIES) next.length = MAX_ENTRIES;
          return { entries: next };
        }),
      markAllRead: () => set({ lastOpenedAt: Date.now() }),
      clear: () => set({ entries: [], lastOpenedAt: Date.now() })
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage)
    }
  )
);

/**
 * 派生量：未读失败条数（用于铃铛 badge）。
 * 只算 kind === 'failure' 且 ts > lastOpenedAt 的条目。
 */
export function selectUnreadFailureCount(s: NotificationState): number {
  let n = 0;
  for (const e of s.entries) {
    if (e.kind === 'failure' && e.ts > s.lastOpenedAt) n++;
  }
  return n;
}
