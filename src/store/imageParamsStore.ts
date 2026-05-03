import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

/**
 * 跨组件共享的"绘图参数"：
 *   - 比例 / 自定义宽高 / 分辨率档位 / 质量
 *   - 张数
 *   - 参考图（最多 10 张，data URI 用于回显，path 提交后端）
 *   - 优化开关：聊天侧"生图"是否先经 LLM 改写提示词
 *
 * 这样右侧生图面板和聊天侧"生图模式"读同一份配置。
 */

export type SizeMode = 'aspect' | 'custom';

export interface RefImage {
  path: string;
  dataUri: string;
  /** 真实长宽（onLoad 后填）—— auto 模式下用第一张参考图的比例 */
  width?: number;
  height?: number;
}

const STANDARD_ASPECTS: Array<{ value: string; ratio: number }> = [
  { value: '1:1', ratio: 1 },
  { value: '4:5', ratio: 4 / 5 },
  { value: '5:4', ratio: 5 / 4 },
  { value: '3:4', ratio: 3 / 4 },
  { value: '4:3', ratio: 4 / 3 },
  { value: '2:3', ratio: 2 / 3 },
  { value: '3:2', ratio: 3 / 2 },
  { value: '9:16', ratio: 9 / 16 },
  { value: '16:9', ratio: 16 / 9 },
  { value: '21:9', ratio: 21 / 9 },
  { value: '9:21', ratio: 9 / 21 },
  { value: '4:1', ratio: 4 },
  { value: '1:4', ratio: 1 / 4 },
  { value: '8:1', ratio: 8 },
  { value: '1:8', ratio: 1 / 8 }
];

function pickClosestAspect(w: number, h: number): string {
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return '16:9';
  const ratio = w / h;
  let best = STANDARD_ASPECTS[0];
  let bestDiff = Math.abs(ratio - best.ratio);
  for (const c of STANDARD_ASPECTS) {
    const d = Math.abs(ratio - c.ratio);
    if (d < bestDiff) {
      best = c;
      bestDiff = d;
    }
  }
  return best.value;
}

interface ImageParamsState {
  imageModelId: string;
  sizeMode: SizeMode;
  aspect: string;
  customW: number;
  customH: number;
  imageSize: '' | '1K' | '2K' | '4K';
  quality: '' | 'standard' | 'high';
  n: 1 | 2 | 3 | 4;
  refs: RefImage[];
  /** 左侧聊天 / 生图输入框的草稿，跨组件共享（右侧"AI 优化"按钮要能改写它） */
  chatDraft: string;
  /** 选中的优化预设 key（来自 optimizePresets.ts） */
  optimizePresetKey: string;

  setImageModelId: (id: string) => void;
  setChatDraft: (s: string) => void;
  setOptimizePresetKey: (k: string) => void;

  setSizeMode: (m: SizeMode) => void;
  setAspect: (a: string) => void;
  setCustomW: (w: number) => void;
  setCustomH: (h: number) => void;
  setImageSize: (s: ImageParamsState['imageSize']) => void;
  setQuality: (q: ImageParamsState['quality']) => void;
  setN: (n: ImageParamsState['n']) => void;

  addRefs: (next: RefImage[]) => void;
  removeRefAt: (idx: number) => void;
  clearRefs: () => void;

  /** 把当前 chatDraft 给"AI 优化按钮"读，是否有内容可优化 */
  hasOptimizableDraft: () => boolean;

  /** 序列化为后端 image.generate 接口的 params 对象 */
  buildParams: () => Record<string, unknown>;
  /** 当前参考图本地路径数组（用于 image.generate 提交） */
  refPaths: () => string[];
}

const REF_LIMIT = 10;

export const useImageParamsStore = create<ImageParamsState>()(
  persist(
    (set, get) => ({
  imageModelId: '',
  sizeMode: 'aspect',
  aspect: 'auto',
  customW: 1024,
  customH: 1024,
  imageSize: '',
  quality: '',
  n: 1,
  refs: [],
  chatDraft: '',
  optimizePresetKey: 'general',

  setImageModelId: (id) => set({ imageModelId: id }),
  setChatDraft: (s) => set({ chatDraft: s }),
  setOptimizePresetKey: (k) => set({ optimizePresetKey: k }),

  setSizeMode: (m) => set({ sizeMode: m }),
  setAspect: (a) => set({ aspect: a }),
  setCustomW: (w) => set({ customW: w }),
  setCustomH: (h) => set({ customH: h }),
  setImageSize: (s) => set({ imageSize: s }),
  setQuality: (q) => set({ quality: q }),
  setN: (n) => set({ n }),

  addRefs: (next) => {
    const merged = [...get().refs, ...next].slice(0, REF_LIMIT);
    set({ refs: merged });
  },
  removeRefAt: (idx) => {
    const arr = [...get().refs];
    arr.splice(idx, 1);
    set({ refs: arr });
  },
  clearRefs: () => set({ refs: [] }),

  hasOptimizableDraft: () => get().chatDraft.trim().length > 0,

  buildParams: () => {
    const s = get();
    const p: Record<string, unknown> = { n: s.n };
    if (s.sizeMode === 'custom') {
      p.width = s.customW;
      p.height = s.customH;
    } else {
      let aspect = s.aspect;
      // "auto"：有参考图就跟第一张的比例（取最近的标准比例），没有就 16:9
      if (aspect === 'auto') {
        const first = s.refs.find((r) => r.width && r.height);
        aspect =
          first && first.width && first.height
            ? pickClosestAspect(first.width, first.height)
            : '16:9';
      }
      p.aspect = aspect;
      if (s.imageSize) p.image_size = s.imageSize;
    }
    if (s.quality) p.quality = s.quality;
    return p;
  },

  refPaths: () => get().refs.map((r) => r.path)
    }),
    {
      name: 'mengbi-image-params',
      storage: createJSONStorage(() => localStorage),
      // refs 是 dataUri，体积大且每次会话有不同的临时文件——不持久化
      partialize: (state) => ({
        imageModelId: state.imageModelId,
        sizeMode: state.sizeMode,
        aspect: state.aspect,
        customW: state.customW,
        customH: state.customH,
        imageSize: state.imageSize,
        quality: state.quality,
        n: state.n,
        chatDraft: state.chatDraft,
        optimizePresetKey: state.optimizePresetKey
      })
    }
  )
);
