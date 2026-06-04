import type { UpscaleModelCategory } from './upscaleModelMeta';
import { getUpscaleModelMeta } from './upscaleModelMeta';

/**
 * 放大模式系统 —— 用户友好的模式选择(2026-05-28 ONNX 切换)。
 *
 * 设计原则:
 *   - 普通用户看「模式」(智能推荐 / 通用高清 / 动漫插画 / ...);
 *     从不直接选模型名,除非展开"高级"。
 *   - 每个模式声明它"在 ncnn 后端能用什么(idealNcnn + altNcnn)"
 *     与"在 ONNX 后端能用什么(onnxIdealId + onnxAlternativeIds)"。
 *   - resolveModelForMode 解出最终用哪个后端 + 哪个模型:
 *       优先 ONNX ideal(已下载 .onnx) — 因为 .onnx 模型质量普遍更高,
 *       其次 ncnn ideal(已装),
 *       再 ncnn alt 链(回退),
 *       最后 ONNX alt 链(回退)。
 *
 * 加新模型 / 改映射 → 改本文件 MODES 一处。
 *
 * 砍掉的字段(2026-05-28):
 *   - pytorch* → 重命名 onnx*
 *   - denoiseLevelToFloat() —— 不再支持 dni_weight 双权重插值
 *   - faceEnhance —— GFPGAN 跟 PyTorch 一起去掉
 */

export type UpscaleModeId =
  | 'smart' // 智能推荐(默认)
  | 'general-hd' // 通用高清
  | 'general-fast' // 通用快速
  | 'anime-illust' // 动漫插画
  | 'anime-video' // 动漫视频
  | 'sharpen' // 清晰增强
  | 'custom'; // 自定义模型

export type DetailLevel = 'soft' | 'standard' | 'sharp';
export type DenoiseLevel = 'low' | 'mid' | 'high';
export type OutputFormat = 'png' | 'jpg' | 'webp';
export type UpscaleBackend = 'ncnn' | 'onnx';

/** 后端能力 */
export interface BackendCapabilities {
  /** ncnn-vulkan(轻量,GPU 跨厂商) */
  ncnn: boolean;
  /** ONNX(onnxruntime-node 主进程内推理,DirectML / CoreML / CUDA / CPU) */
  onnx: boolean;
}

export interface UpscaleModeConfig {
  id: UpscaleModeId;
  label: string;
  tagline: string;
  description: string;
  /** ⚠ 警告(清晰增强专用 — 假细节风险) */
  warning?: string;
  /** "理想模型名" — UI 高级面板展示(用户友好显示名) */
  idealModel: string;
  /** ncnn 后端的理想模型名(小写 short id);只有 ncnn 也提供该模型时填 */
  ncnnIdealName?: string;
  /** ncnn 替代链 */
  ncnnAlternativeNames?: string[];
  /** ONNX 后端的理想模型 id(对应 OnnxModelSpec.id) */
  onnxIdealId?: string;
  /** ONNX 替代链 */
  onnxAlternativeIds?: string[];
  /** 是否能作为"智能推荐"自动选 */
  smartEligible: boolean;
  /** 视觉分类(色块/图标对照) */
  category: 'general' | 'anime' | 'sharp' | 'custom';
}

/**
 * 7 个用户可见的模式 + 各模式的候选 .onnx 模型(由 OnnxModelSpec.id 引用)。
 *
 * onnxIdealId    = 该分类下"默认最优模型"(优先选)
 * onnxAlternativeIds = 同分类其它备选(顺序 = 回退顺序)
 *
 * 加新候选 → 改本文件 + electron/services/realesrganOnnxModels.ts(加 OnnxModelSpec)。
 *
 * 用户「自传」的 .onnx 不在这里枚举 —— 走 onnxList custom + modeHint 路径,
 * resolveModelForMode 接收 customByMode 参数补到回退链末尾(见下方)。
 */
export const MODES: UpscaleModeConfig[] = [
  {
    id: 'smart',
    label: '智能推荐',
    tagline: '默认 · 根据图片自动选择',
    description:
      '拖入图片后,根据图片类型自动选最优模式:照片走通用高清 / 动漫走动漫插画 / 大图压缩走通用快速 / 噪点重走通用快速。',
    idealModel: '(自动)',
    smartEligible: false,
    category: 'general'
  },
  {
    id: 'general-hd',
    label: '通用高清',
    tagline: '照片 / 商品图 / 设计稿首选',
    description:
      '默认 RealESRGAN_x4plus(官方,通用真实风)。细节强、对比鲜明,适合普通照片、商品图、海报、设计稿。',
    idealModel: 'RealESRGAN_x4plus',
    ncnnIdealName: 'realesrgan-x4plus',
    ncnnAlternativeNames: ['realesrnet-x4plus'],
    onnxIdealId: 'realesrgan-x4plus',
    smartEligible: true,
    category: 'general'
  },
  {
    id: 'general-fast',
    label: '通用快速',
    tagline: '批量 / 低配置 / 快速预览',
    description:
      '默认 realesr-general-x4v3(官方,4.87 MB SRVGGNetCompact 轻量)。适合批量 / 低配电脑 / 快速预览。',
    idealModel: 'realesr-general-x4v3',
    ncnnAlternativeNames: ['realesrnet-x4plus'],
    onnxIdealId: 'realesr-general-x4v3',
    onnxAlternativeIds: ['realesrgan-x4plus'],
    smartEligible: true,
    category: 'general'
  },
  {
    id: 'anime-illust',
    label: '动漫插画',
    tagline: '二次元 / 漫画 / AI 绘画 / 线稿',
    description:
      '默认 ncnn realesrgan-x4plus-anime(自带,锐利线条 + 干净色块)。适合二次元、漫画、AI 绘画、线稿。不建议用于真实照片和人像。',
    idealModel: 'realesrgan-x4plus-anime',
    ncnnIdealName: 'realesrgan-x4plus-anime',
    onnxAlternativeIds: ['realesrgan-x4plus'],
    smartEligible: true,
    category: 'anime'
  },
  {
    id: 'anime-video',
    label: '动漫视频',
    tagline: '视频帧 / 连续帧 / 截图批量',
    description:
      '默认 ncnn realesr-animevideov3(官方,为动漫视频帧设计,速度优先)。当前 ONNX 暂无公开 animevideov3,降级时用 realesr-general-x4v3(同 SRVGGNetCompact)。',
    idealModel: 'realesr-animevideov3',
    ncnnIdealName: 'realesr-animevideov3',
    ncnnAlternativeNames: ['realesrgan-x4plus-anime'],
    onnxAlternativeIds: ['realesr-general-x4v3'],
    smartEligible: false,
    category: 'anime'
  },
  {
    id: 'sharpen',
    label: '清晰增强',
    tagline: '模糊图 / 老图 / 纹理图',
    description:
      '默认 4x-UltraSharp(社区锐化向)。备选 4x-Remacri(细节向)、4x_NMKD-Siax_200k(通用锐化)。适合模糊图、纹理图、老图。',
    warning:
      '⚠ 该模式可能产生假细节、过度锐化、颗粒感。不建议用于皮肤、人像、文字边缘。',
    idealModel: '4x-UltraSharp',
    onnxIdealId: '4x-ultrasharp',
    onnxAlternativeIds: ['4x-remacri', '4x-nmkd-siax', 'realesrgan-x4plus'],
    smartEligible: false,
    category: 'sharp'
  },
  {
    id: 'custom',
    label: '自定义模型',
    tagline: '导入自己的 ESRGAN / Real-ESRGAN 模型',
    description:
      '面板里支持 ncnn-vulkan 的 .bin + .param 对(同名成对)。.onnx 模型(包括 chaiNNer / spandrel 自转的社区模型)走 设置 → 工具箱 → ONNX 模型库 自由导入,指定分类后即可在对应模式或本模式选用。',
    idealModel: '(用户导入)',
    smartEligible: false,
    category: 'custom'
  }
];

/**
 * 社区常用 .onnx 模型分类参考表(2026-05-29)。
 *
 * 用户在自定义模式下,可参考此表把自己用 chaiNNer / spandrel 从 .pth/.safetensors
 * 转换得到的 .onnx 文件,在"自由导入"时挑对应分类挂上去。
 *
 * 这些模型软件**未内置**(它们只发 .pth/.safetensors,需自行转 .onnx)。
 * 引用为「分类与归属」的事实说明,不是下载源。
 */
export interface CommunityModelReference {
  /** 模型公认 id(对应 OpenModelDB / HF repo 名) */
  name: string;
  /** 用途分类(对应 UpscaleModeId) */
  category: UpscaleModeId;
  /** 主要方向(图 2 的"主要方向"列) */
  purpose: string;
  /** 作者归属 */
  author: string;
  /** 许可证 */
  license: string;
}

export const COMMUNITY_REFERENCE: CommunityModelReference[] = [
  {
    name: '4xHFA2k',
    category: 'anime-illust',
    purpose: '动漫 / 二次元放大',
    author: 'Philip Hofmann (Phips)',
    license: 'CC-BY-4.0 · 需署名'
  },
  {
    name: '4xLSDIR',
    category: 'general-hd',
    purpose: '写实照片放大',
    author: 'Helaman / Phhofm',
    license: 'CC-BY-4.0 · 需署名'
  },
  {
    name: '4xLSDIRCompactC3',
    category: 'general-fast',
    purpose: '快速写实放大 / 轻量模型',
    author: 'Helaman / Phhofm',
    license: 'CC-BY-4.0 · 需署名'
  },
  {
    name: '4xLSDIRplusC',
    category: 'general-hd',
    purpose: '写实图 + 轻微压缩修复',
    author: 'Helaman / Phhofm',
    license: 'CC-BY-4.0 · 需署名'
  },
  {
    name: '4xNomos8kSC',
    category: 'sharpen',
    purpose: '真实照片修复型放大',
    author: 'Philip Hofmann (Phips)',
    license: 'CC-BY-4.0 · 需署名'
  },
  {
    name: '4x_NMKD-Siax_200k',
    category: 'sharpen',
    purpose: '通用锐化型放大(已内置可直接下载)',
    author: 'NMKD (Nick Kunz)',
    license: '自由再分发'
  }
];

/** 按分类聚合参考表(只有出现过的分类才在 map 里) */
export function communityReferenceByCategory(): Partial<
  Record<UpscaleModeId, CommunityModelReference[]>
> {
  const out: Partial<Record<UpscaleModeId, CommunityModelReference[]>> = {};
  for (const r of COMMUNITY_REFERENCE) {
    (out[r.category] ??= []).push(r);
  }
  return out;
}

// ── 多模型候选清单(2026-05-29) ────────────────────────────

/** 模式 → 该模式接纳的 ncnn / onnx 分类集合 */
const MODE_TO_CATS: Record<UpscaleModeId, UpscaleModelCategory[]> = {
  smart: [],
  'general-hd': ['general'],
  'general-fast': ['general'],
  'anime-illust': ['anime', 'lineart'],
  'anime-video': ['video'],
  sharpen: ['sharp', 'face'],
  custom: []
};

export interface ModelCandidate {
  /** 唯一 key:ncnn 名 或 onnx id 或 onnx custom fileName */
  key: string;
  /** 跑哪个 backend */
  backend: UpscaleBackend;
  /** UI 显示名 */
  label: string;
  /** 在何处管理(用户友好) */
  source: 'ncnn' | 'onnx-builtin' | 'onnx-custom';
  /** 是否默认最优(resolver 优先返回的那个) */
  isDefault: boolean;
}

/**
 * 列出某模式下所有"已装且匹配该分类"的候选模型。
 *
 * 默认优先级(在数组里靠前):
 *   1) ncnn idealName
 *   2) onnx idealId
 *   3) ncnn alt 链
 *   4) onnx alt 链
 *   5) 其它同分类 ncnn 模型(meta.category 落在 MODE_TO_CATS[modeId])
 *   6) 其它同分类 onnx builtins(categoryHint 命中)
 *   7) onnx custom(modeHint 命中)
 */
export function candidatesForMode(
  modeId: UpscaleModeId,
  caps: BackendCapabilities,
  availableNcnnModels: ReadonlyArray<{ name: string }>,
  onnxBuiltinIds: ReadonlyArray<{ id: string; displayName: string; categoryHint: UpscaleModeId; installed: boolean }>,
  onnxCustoms: ReadonlyArray<{ fileName: string; modeHint: UpscaleModeId }>
): ModelCandidate[] {
  const mode = getMode(modeId);
  const cats = new Set(MODE_TO_CATS[modeId]);
  const result: ModelCandidate[] = [];
  const seen = new Set<string>();
  const push = (c: ModelCandidate): void => {
    const k = `${c.backend}:${c.key}`;
    if (seen.has(k)) return;
    seen.add(k);
    result.push(c);
  };

  // 1) ncnn idealName
  if (
    caps.ncnn &&
    mode.ncnnIdealName &&
    availableNcnnModels.some((m) => m.name.toLowerCase() === mode.ncnnIdealName!.toLowerCase())
  ) {
    push({
      key: mode.ncnnIdealName,
      backend: 'ncnn',
      label: mode.ncnnIdealName,
      source: 'ncnn',
      isDefault: true
    });
  }
  // 2) onnx ideal
  if (caps.onnx && mode.onnxIdealId) {
    const b = onnxBuiltinIds.find((x) => x.id === mode.onnxIdealId);
    if (b && b.installed) {
      push({
        key: b.id,
        backend: 'onnx',
        label: b.displayName,
        source: 'onnx-builtin',
        isDefault: result.length === 0
      });
    }
  }
  // 3) ncnn alt 链
  if (caps.ncnn) {
    for (const alt of mode.ncnnAlternativeNames ?? []) {
      if (availableNcnnModels.some((m) => m.name.toLowerCase() === alt.toLowerCase())) {
        push({ key: alt, backend: 'ncnn', label: alt, source: 'ncnn', isDefault: false });
      }
    }
  }
  // 4) onnx alt 链
  if (caps.onnx) {
    for (const alt of mode.onnxAlternativeIds ?? []) {
      const b = onnxBuiltinIds.find((x) => x.id === alt);
      if (b && b.installed) {
        push({
          key: b.id,
          backend: 'onnx',
          label: b.displayName,
          source: 'onnx-builtin',
          isDefault: false
        });
      }
    }
  }
  // 5) 其它同分类 ncnn(按 meta.category 命中)
  if (caps.ncnn && cats.size > 0) {
    for (const m of availableNcnnModels) {
      const cat = getUpscaleModelMeta(m.name).category;
      if (cats.has(cat)) {
        push({ key: m.name, backend: 'ncnn', label: m.name, source: 'ncnn', isDefault: false });
      }
    }
  }
  // 6) 其它同分类 onnx builtins
  if (caps.onnx) {
    for (const b of onnxBuiltinIds) {
      if (b.installed && b.categoryHint === modeId) {
        push({
          key: b.id,
          backend: 'onnx',
          label: b.displayName,
          source: 'onnx-builtin',
          isDefault: false
        });
      }
    }
  }
  // 7) onnx custom 同 modeHint
  if (caps.onnx) {
    for (const c of onnxCustoms) {
      if (c.modeHint === modeId) {
        push({
          key: c.fileName,
          backend: 'onnx',
          label: c.fileName,
          source: 'onnx-custom',
          isDefault: false
        });
      }
    }
  }

  return result;
}

export function getMode(id: UpscaleModeId): UpscaleModeConfig {
  return MODES.find((m) => m.id === id) ?? MODES[0];
}

/**
 * 解析模式 → 具体可执行的 { backend, model } 组合。
 *
 * 优先级:
 *   1) ONNX ideal(已下) → onnx(理想路径)
 *   2) ncnn ideal(已装) → ncnn(理想路径)
 *   3) ncnn alt 链 → ncnn(回退,usedFallback=true)
 *   4) ONNX alt 链 → onnx(回退,usedFallback=true)
 *
 * @param installedOnnxIds OnnxModelSpec.id 已下载的清单
 * @param customNcnnModel 自定义模式下用户选的 ncnn 模型名
 */
export function resolveModelForMode(
  mode: UpscaleModeConfig,
  caps: BackendCapabilities,
  availableNcnnModels: readonly string[],
  installedOnnxIds: readonly string[],
  customNcnnModel: string | null = null
): {
  model: string;
  backend: UpscaleBackend;
  usedFallback: boolean;
  reason?: string;
} | null {
  if (mode.id === 'custom') {
    if (!customNcnnModel) return null;
    return { model: customNcnnModel, backend: 'ncnn', usedFallback: false };
  }

  // 1) ONNX ideal
  if (caps.onnx && mode.onnxIdealId && installedOnnxIds.includes(mode.onnxIdealId)) {
    return { model: mode.onnxIdealId, backend: 'onnx', usedFallback: false };
  }

  // 2) ncnn ideal
  if (caps.ncnn && mode.ncnnIdealName && availableNcnnModels.includes(mode.ncnnIdealName.toLowerCase())) {
    return { model: mode.ncnnIdealName, backend: 'ncnn', usedFallback: false };
  }

  // 3) ncnn alt 链
  if (caps.ncnn) {
    for (const alt of mode.ncnnAlternativeNames ?? []) {
      if (availableNcnnModels.includes(alt.toLowerCase())) {
        return {
          model: alt,
          backend: 'ncnn',
          usedFallback: true,
          reason: `${mode.idealModel} 在当前后端缺失,用近似 ncnn 模型 ${alt} 代替`
        };
      }
    }
  }

  // 4) ONNX alt 链
  if (caps.onnx) {
    for (const alt of mode.onnxAlternativeIds ?? []) {
      if (installedOnnxIds.includes(alt)) {
        return {
          model: alt,
          backend: 'onnx',
          usedFallback: true,
          reason: `${mode.idealModel} 在当前后端缺失,用近似 ONNX 模型 ${alt} 代替`
        };
      }
    }
  }

  return null;
}

/** smart 模式根据图片特征推断目标模式 */
export function recommendModeFromImageType(input: {
  tag?: string;
  edgeDensity?: number;
  distinctColors?: number;
  isMostlyBW?: boolean;
  /** 单边像素 — 用于判断"大图快速通道" */
  longestSide?: number;
}): { modeId: UpscaleModeId; reason: string } {
  if ((input.longestSide ?? 0) > 2048) {
    return { modeId: 'general-fast', reason: '图片较大(>2K),走通用快速节约时间' };
  }
  if (
    input.tag === 'flat-illustration' ||
    input.tag === 'color-logo' ||
    input.tag === 'mono-logo' ||
    input.tag === 'icon' ||
    (input.distinctColors !== undefined && input.distinctColors < 200 && (input.edgeDensity ?? 0) > 0.03)
  ) {
    return { modeId: 'anime-illust', reason: '识别为扁平/动漫风,走动漫插画模型' };
  }
  if (input.isMostlyBW || input.tag === 'bw-lineart') {
    return { modeId: 'anime-illust', reason: '黑白线稿,动漫插画模型对线条最锐利' };
  }
  return { modeId: 'general-hd', reason: '常规照片,走通用高清模型(默认)' };
}

/** 该模式当前后端组合下是否可运行 */
export function modeRunnable(
  mode: UpscaleModeConfig,
  caps: BackendCapabilities,
  availableNcnnModels: readonly string[],
  installedOnnxIds: readonly string[]
): boolean {
  if (mode.id === 'custom') return caps.ncnn;
  return resolveModelForMode(mode, caps, availableNcnnModels, installedOnnxIds, null) !== null;
}

// ── 高级参数枚举 ────────────────────────────────────────

export const DETAIL_LEVELS: Array<{ value: DetailLevel; label: string; hint: string }> = [
  { value: 'soft', label: '柔和', hint: '细节弱化,适合皮肤 / 食物 / 人像' },
  { value: 'standard', label: '标准', hint: '默认平衡(推荐)' },
  { value: 'sharp', label: '锐利', hint: '细节强化,适合 logo / 文字 / 商品' }
];

export const DENOISE_LEVELS: Array<{ value: DenoiseLevel; label: string; hint: string }> = [
  { value: 'low', label: '低', hint: '保留细节,有噪点也认' },
  { value: 'mid', label: '中', hint: '中等降噪(默认),平衡' },
  { value: 'high', label: '高', hint: '强力降噪,可能丢失细节' }
];

export const FORMATS: Array<{ value: OutputFormat; label: string; hint: string }> = [
  { value: 'png', label: 'PNG', hint: '无损,文件较大,默认' },
  { value: 'jpg', label: 'JPG', hint: '有损,文件小' },
  { value: 'webp', label: 'WebP', hint: '更优压缩,文件最小' }
];
