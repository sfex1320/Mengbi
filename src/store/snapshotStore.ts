import { create } from 'zustand';
import { useCanvasStore } from '@/store/canvasStore';
import type { CanvasProject } from '@/pages/Canvas/types';

/**
 * 画板快照（需求十三节）。
 *
 * 与 index.tsx 里那套细粒度防抖撤销栈互补：
 *   - 撤销栈 = Ctrl+Z 的逐步回退（内存，不带标签）
 *   - 快照   = 带标签的命名还原点（手动保存 + AI/PS 前自动保存），可任意「回到某步」
 *
 * 快照存的是 project 引用本身——canvasStore 每次变更都新建 project 对象，所以引用即不可变快照。
 * 仅会话内有效（含 MB 级 cookedDataUri，不持久化）。上限 40 条。
 */

export interface Snapshot {
  id: string;
  label: string;
  ts: number;
  project: CanvasProject;
}

const LIMIT = 40;

interface SnapshotState {
  snapshots: Snapshot[];
  /** 保存一条快照（传 project；省略则取当前） */
  save: (label: string, project?: CanvasProject) => void;
  /** 还原到某条快照（loadProject） */
  restore: (id: string) => void;
  remove: (id: string) => void;
  clear: () => void;
}

function rid(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'snap-' + Math.random().toString(36).slice(2, 10);
}

export const useSnapshotStore = create<SnapshotState>((set, get) => ({
  snapshots: [],
  save: (label, project) => {
    const p = project ?? useCanvasStore.getState().project;
    const snap: Snapshot = { id: rid(), label, ts: Date.now(), project: p };
    set((s) => {
      const next = [snap, ...s.snapshots];
      if (next.length > LIMIT) next.length = LIMIT;
      return { snapshots: next };
    });
  },
  restore: (id) => {
    const snap = get().snapshots.find((s) => s.id === id);
    if (snap) useCanvasStore.getState().loadProject(snap.project);
  },
  remove: (id) => set((s) => ({ snapshots: s.snapshots.filter((x) => x.id !== id) })),
  clear: () => set({ snapshots: [] })
}));

/** 便捷：在执行某动作前自动存一条快照 */
export function autoSnapshot(label: string): void {
  useSnapshotStore.getState().save(label);
}
