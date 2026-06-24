/**
 * 把数组里 fromIdx 的项移动到 toIdx（纯函数，便于单测）。
 * 越界或 from===to 时原样返回一份浅拷贝。用于侧栏快捷方式拖拽重排等。
 */
export function reorderArray<T>(arr: readonly T[], fromIdx: number, toIdx: number): T[] {
  const n = arr.length;
  if (fromIdx === toIdx || fromIdx < 0 || fromIdx >= n || toIdx < 0 || toIdx >= n) {
    return arr.slice();
  }
  const next = arr.slice();
  const [moved] = next.splice(fromIdx, 1);
  next.splice(toIdx, 0, moved);
  return next;
}
