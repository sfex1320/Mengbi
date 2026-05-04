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


/** GPT Image 2 的 4K 预算 = 8.3 MP；超过这个值多数兼容代理会拒绝。 */
const GI2_PIXEL_BUDGET = 8_294_400;

/**
 * 给定比例分子分母 + 总像素预算，反推 W×H：
 *   - 严格 ≤ budget；
 *   - 严格 16 的倍数；
 *   - 单边硬上限 3840（与后端 snapDown16 对齐）。
 * 同时被 buildParams 的 "auto" 路径和"自定义尺寸计算器"复用。
 */
export function sizeUnderBudget(
  aw: number,
  ah: number,
  budget: number
): { w: number; h: number } {
  if (!Number.isFinite(aw) || !Number.isFinite(ah) || aw <= 0 || ah <= 0) {
    const side = Math.floor(Math.sqrt(budget) / 16) * 16;
    return { w: Math.min(3840, side), h: Math.min(3840, side) };
  }
  const hExact = Math.sqrt((budget * ah) / aw);
  const wExact = (hExact * aw) / ah;
  let w = Math.max(256, Math.min(3840, Math.floor(wExact / 16) * 16));
  let h = Math.max(256, Math.min(3840, Math.floor(hExact / 16) * 16));
  while (w * h > budget && (w > 256 || h > 256)) {
    if (w >= h && w > 256) w -= 16;
    else if (h > 256) h -= 16;
    else break;
  }
  return { w, h };
}

/** 用户自定义的"自定义尺寸预设"（builtin 走代码常量） */
export interface UserSizePreset {
  key: string;
  label: string;
  w: number;
  h: number;
}

interface ImageParamsState {
  imageModelId: string;
  sizeMode: SizeMode;
  aspect: string;
  customW: number;
  customH: number;
  /** 自定义尺寸的"自动计算"开关：on 时改一边自动算另一边；off 时两个独立输入 */
  autoCalcCustomSize: boolean;
  imageSize: '' | '1K' | '2K' | '4K';
  quality: '' | 'standard' | 'high';
  n: 1 | 2 | 3 | 4;
  refs: RefImage[];
  /** 用户自己加的自定义尺寸预设 */
  userSizePresets: UserSizePreset[];
  /** 左侧聊天 / 生图输入框的草稿，跨组件共享（右侧"AI 优化"按钮要能改写它） */
  chatDraft: string;
  /** 选中的优化预设 key（来自 optimizePresets.ts） */
  optimizePresetKey: string;

  addUserSizePreset: (p: UserSizePreset) => void;
  removeUserSizePreset: (key: string) => void;
  updateUserSizePreset: (key: string, patch: Partial<UserSizePreset>) => void;

  setImageModelId: (id: string) => void;
  setChatDraft: (s: string) => void;
  setOptimizePresetKey: (k: string) => void;

  setSizeMode: (m: SizeMode) => void;
  setAspect: (a: string) => void;
  setCustomW: (w: number) => void;
  setCustomH: (h: number) => void;
  setAutoCalcCustomSize: (b: boolean) => void;
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
  autoCalcCustomSize: true,
  imageSize: '',
  quality: '',
  n: 1,
  refs: [],
  userSizePresets: [],
  chatDraft: '',
  optimizePresetKey: 'general',

  addUserSizePreset: (p) =>
    set((s) => ({
      userSizePresets: [...s.userSizePresets.filter((x) => x.key !== p.key), p]
    })),
  removeUserSizePreset: (key) =>
    set((s) => ({
      userSizePresets: s.userSizePresets.filter((p) => p.key !== key)
    })),
  updateUserSizePreset: (key, patch) =>
    set((s) => ({
      userSizePresets: s.userSizePresets.map((p) =>
        p.key === key ? { ...p, ...patch } : p
      )
    })),

  setImageModelId: (id) => set({ imageModelId: id }),
  setChatDraft: (s) => set({ chatDraft: s }),
  setOptimizePresetKey: (k) => set({ optimizePresetKey: k }),

  setSizeMode: (m) => set({ sizeMode: m }),
  setAspect: (a) => set({ aspect: a }),
  setCustomW: (w) => set({ customW: w }),
  setCustomH: (h) => set({ customH: h }),
  setAutoCalcCustomSize: (b) => set({ autoCalcCustomSize: b }),
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
      // "auto" 重定义：用第一张参考图的"真实比例"（不是预设档），
      //   并且把 W×H 控制在 8.3MP 以下；
      //   没有参考图时回退到 16:9 + 4K 预算（≈ 3840×2160）。
      if (aspect === 'auto') {
        const first = s.refs.find((r) => r.width && r.height);
        if (first?.width && first?.height) {
          const { w, h } = sizeUnderBudget(first.width, first.height, GI2_PIXEL_BUDGET);
          p.width = w;
          p.height = h;
        } else {
          // 无参考图：默认 16:9 @ 4K（3840×2160）
          const { w, h } = sizeUnderBudget(16, 9, GI2_PIXEL_BUDGET);
          p.width = w;
          p.height = h;
        }
      } else {
        p.aspect = aspect;
        if (s.imageSize) p.image_size = s.imageSize;
      }
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
        autoCalcCustomSize: state.autoCalcCustomSize,
        imageSize: state.imageSize,
        quality: state.quality,
        n: state.n,
        userSizePresets: state.userSizePresets,
        chatDraft: state.chatDraft,
        optimizePresetKey: state.optimizePresetKey
      })
    }
  )
);
