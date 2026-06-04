/**
 * 跨功能「图片删除」同步总线（渲染端，无 IPC）。
 * 图库删除某些图（软删 / 物理删 + 源文件）后调 markDeleted(filePaths)，
 * 其它功能（如智能画布的结果预览）订阅 seq 变化 → 把这些路径从自己的展示里剔除，
 * 实现「图库删了，工作流等处的对应任务/预览也一并清掉」。
 */
import { create } from 'zustand';

interface DeletedMediaState {
  /** 最近一次删除的源文件绝对路径 */
  lastDeleted: string[];
  /** 自增序号：订阅者据此触发一次剪枝 */
  seq: number;
  markDeleted: (paths: string[]) => void;
}

export const useDeletedMediaStore = create<DeletedMediaState>((set) => ({
  lastDeleted: [],
  seq: 0,
  markDeleted: (paths) => {
    const clean = paths.filter(Boolean);
    if (!clean.length) return;
    set((s) => ({ lastDeleted: clean, seq: s.seq + 1 }));
  }
}));
