import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

/**
 * 实验室页面跨开关持久化的状态——尤其反推：
 *   - 反推完一次想看其他页面 / 关掉弹窗、再回来还能看到上次结果；
 *   - 直到用户手动按"清空"或换一张图重推。
 *
 * imagePath 我们用绝对路径，previewUri 用 data URI——退出后回来缩略图能显示，
 * 不需要再读盘。
 */

export type ReverseResultType = 'description' | 'tags' | 'style';

interface LabState {
  reverseModelId: string;
  reverseImagePath: string;
  reversePreviewUri: string;
  reverseResultType: ReverseResultType;
  /** 原样保存：description/style 给 { text }, tags 给 { tags: string[] } */
  reverseResult: unknown;

  setReverseModelId: (s: string) => void;
  setReverseImage: (path: string, dataUri: string) => void;
  setReverseResultType: (t: ReverseResultType) => void;
  setReverseResult: (r: unknown) => void;
  clearReverse: () => void;
}

export const useLabStore = create<LabState>()(
  persist(
    (set) => ({
      reverseModelId: '',
      reverseImagePath: '',
      reversePreviewUri: '',
      reverseResultType: 'description',
      reverseResult: null,

      setReverseModelId: (s) => set({ reverseModelId: s }),
      setReverseImage: (path, dataUri) =>
        set({ reverseImagePath: path, reversePreviewUri: dataUri }),
      setReverseResultType: (t) => set({ reverseResultType: t }),
      setReverseResult: (r) => set({ reverseResult: r }),
      clearReverse: () =>
        set({
          reverseImagePath: '',
          reversePreviewUri: '',
          reverseResult: null
        })
    }),
    {
      name: 'mengbi-lab',
      storage: createJSONStorage(() => localStorage),
      // dataUri 可能很大（>1MB），别都吃进 localStorage——只持久化结果 + 路径 + 选项
      partialize: (s) => ({
        reverseModelId: s.reverseModelId,
        reverseImagePath: s.reverseImagePath,
        reversePreviewUri: s.reversePreviewUri.length < 700_000 ? s.reversePreviewUri : '',
        reverseResultType: s.reverseResultType,
        reverseResult: s.reverseResult
      })
    }
  )
);
