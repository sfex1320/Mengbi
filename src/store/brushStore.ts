import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

/**
 * 画板笔刷工具的全局设置：颜色、大小、不透明度、最近用色历史。
 * 用 Zustand 单独的 slice，不混进 canvasStore（笔刷设置跨工程共享）。
 */
interface BrushState {
  color: string;            // '#rrggbbaa'
  size: number;             // px（图层局部坐标）
  opacity: number;          // 0~1
  recent: string[];         // 最近用过的颜色，最多 16 个

  setColor: (c: string) => void;
  setSize: (n: number) => void;
  setOpacity: (n: number) => void;
  pushRecent: (c: string) => void;
}

export const useBrushStore = create<BrushState>()(
  persist(
    (set, get) => ({
      color: '#fb923cff',
      size: 24,
      opacity: 1,
      recent: ['#000000ff', '#ffffffff', '#fb923cff'],

      setColor: (c) => set({ color: c }),
      setSize: (n) => set({ size: Math.max(1, Math.min(400, n)) }),
      setOpacity: (n) => set({ opacity: Math.max(0, Math.min(1, n)) }),
      pushRecent: (c) => {
        const cur = get().recent;
        const next = [c, ...cur.filter((x) => x.toLowerCase() !== c.toLowerCase())].slice(0, 16);
        set({ recent: next });
      }
    }),
    {
      name: 'mengbi-brush',
      storage: createJSONStorage(() => localStorage)
    }
  )
);
