import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

/**
 * 跨组件共享的"绘图参数"：
 *   - 比例 / 自定义宽高 / 分辨率档位 / 质量
 *   - 张数
 *   - 参考图（最多 16 张，data URI 用于回显，path 提交后端）
 *   - 优化开关：聊天侧"生图"是否先经 LLM 改写提示词
 *
 * 这样右侧生图面板和聊天侧"生图模式"读同一份配置。
 */

export type SizeMode = 'aspect' | 'custom';

/** 参考图类型（需求七节 8 类） */
export type RefType =
  | 'style'
  | 'structure'
  | 'character'
  | 'product'
  | 'logo'
  | 'material'
  | 'composition'
  | 'color';

export const REF_TYPE_LABEL: Record<RefType, string> = {
  style: '风格',
  structure: '结构',
  character: '人物',
  product: '产品',
  logo: 'Logo',
  material: '材质',
  composition: '构图',
  color: '颜色'
};

export interface RefImage {
  path: string;
  dataUri: string;
  /** 真实长宽（onLoad 后填）—— auto 模式下用第一张参考图的比例 */
  width?: number;
  height?: number;
  /** 显示名 */
  name?: string;
  /** 参考类型（默认 style） */
  refType?: RefType;
  /** 参考权重 0–2，默认 1 */
  weight?: number;
  /** 是否参与本次生成（默认 true） */
  enabled?: boolean;
  /** 参与图生图 / 参与局部重绘 / 仅视觉参考（语义标志，透传给后端 ref_meta） */
  forImg2img?: boolean;
  forInpaint?: boolean;
  visualOnly?: boolean;
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

/** 选中的 LoRA：name+path+权重；权重 0–2，步进 0.05 */
export interface SelectedLora {
  /** 不带后缀的文件名，注入到 prompt 用 */
  name: string;
  /** 在文件系统中的绝对路径，ComfyUI workflow 用得到 */
  path: string;
  weight: number;
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
  /** 当前 generate 任务要应用的 LoRA 列表 */
  selectedLoras: SelectedLora[];
  /**
   * 图像模型系列覆盖：'auto' = 按 actualModelId 自动嗅探（默认）；
   * 否则强制按指定 family 走 buildBody。值与 ImageFamily 类型对齐。
   */
  familyOverride: 'auto' | 'gpt-image-2' | 'nano-banana-pro' | 'nano-banana-2' | 'nano-banana-flash' | 'default';

  addUserSizePreset: (p: UserSizePreset) => void;
  removeUserSizePreset: (key: string) => void;
  updateUserSizePreset: (key: string, patch: Partial<UserSizePreset>) => void;

  setImageModelId: (id: string) => void;
  setChatDraft: (s: string) => void;
  setOptimizePresetKey: (k: string) => void;
  /** 替换或追加一条 LoRA 选择 */
  upsertLora: (l: SelectedLora) => void;
  removeLora: (name: string) => void;
  setLoraWeight: (name: string, w: number) => void;
  clearLoras: () => void;
  setFamilyOverride: (f: ImageParamsState['familyOverride']) => void;

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
  updateRefAt: (idx: number, patch: Partial<RefImage>) => void;
  /** 把第 idx 张挪到最前（auto 比例用第一张参考图的比例） */
  moveRefToFront: (idx: number) => void;
  clearRefs: () => void;

  /** 把当前 chatDraft 给"AI 优化按钮"读，是否有内容可优化 */
  hasOptimizableDraft: () => boolean;

  /** 序列化为后端 image.generate 接口的 params 对象 */
  buildParams: () => Record<string, unknown>;
  /** 参考图标识数组（fs 路径 / data URI / http(s) URL 任一种），供 image.generate 提交 */
  refPaths: () => string[];
}

const REF_LIMIT = 16;

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
  selectedLoras: [],
  familyOverride: 'auto',

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

  upsertLora: (l) =>
    set((s) => {
      const filtered = s.selectedLoras.filter((x) => x.name !== l.name);
      return { selectedLoras: [...filtered, l].slice(0, 10) };
    }),
  removeLora: (name) =>
    set((s) => ({ selectedLoras: s.selectedLoras.filter((x) => x.name !== name) })),
  setLoraWeight: (name, w) =>
    set((s) => ({
      selectedLoras: s.selectedLoras.map((x) =>
        x.name === name ? { ...x, weight: clampWeight(w) } : x
      )
    })),
  clearLoras: () => set({ selectedLoras: [] }),
  setFamilyOverride: (f) => set({ familyOverride: f }),

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
  updateRefAt: (idx, patch) =>
    set((s) => ({
      refs: s.refs.map((r, i) => (i === idx ? { ...r, ...patch } : r))
    })),
  moveRefToFront: (idx) =>
    set((s) => {
      if (idx <= 0 || idx >= s.refs.length) return s;
      const arr = [...s.refs];
      const [item] = arr.splice(idx, 1);
      arr.unshift(item);
      return { refs: arr };
    }),
  clearRefs: () => set({ refs: [] }),

  hasOptimizableDraft: () => get().chatDraft.trim().length > 0,

  buildParams: () => {
    const s = get();
    const p: Record<string, unknown> = { n: s.n };
    if (s.sizeMode === 'custom') {
      p.width = s.customW;
      p.height = s.customH;
    } else {
      const aspect = s.aspect;
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
    if (s.familyOverride && s.familyOverride !== 'auto') {
      p.family_override = s.familyOverride;
    }
    if (s.selectedLoras.length > 0) {
      // 通用注入：拼成 <lora:name:weight> 串放 params.lora，OpenAI 系兼容站在
      // generate.ts 的拼 prompt 时读取；ComfyUI workflow 用 {{lora}} 占位符也读这个。
      p.lora = s.selectedLoras
        .map((l) => `<lora:${l.name}:${l.weight.toFixed(2)}>`)
        .join(' ');
      // 同时保留结构化形式给 ComfyUI 可能的高级模板用
      p.lora_list = s.selectedLoras.map((l) => ({ name: l.name, path: l.path, weight: l.weight }));
    }
    // 参考图元数据（类型 / 权重 / 用途标志）透传，支持的后端可消费
    const activeRefs = s.refs.filter((r) => r.enabled !== false);
    if (activeRefs.some((r) => r.refType || r.weight != null || r.forImg2img || r.forInpaint || r.visualOnly)) {
      p.ref_meta = activeRefs.map((r) => ({
        type: r.refType ?? 'style',
        weight: r.weight ?? 1,
        for_img2img: !!r.forImg2img,
        for_inpaint: !!r.forInpaint,
        visual_only: !!r.visualOnly
      }));
    }
    return p;
  },

  // 拖拽 / 粘贴 / 画板导入的参考图 path 为空，只有 dataUri；后端 refsToUploadable
  // 已能识别 data:/http(s):/fs 三种形式，所以这里 fallback 到 dataUri 保证不丢图。
  // enabled === false 的参考图不参与本次生成。
  refPaths: () =>
    get()
      .refs.filter((r) => r.enabled !== false)
      .map((r) => r.path || r.dataUri)
      .filter((s) => s.length > 0)
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
        optimizePresetKey: state.optimizePresetKey,
        selectedLoras: state.selectedLoras,
        familyOverride: state.familyOverride
      })
    }
  )
);

function clampWeight(w: number): number {
  if (!Number.isFinite(w)) return 1;
  return Math.max(0, Math.min(2, w));
}
