/**
 * 放大模型元数据 —— 给 Real-ESRGAN ncnn 模型按用途分类 + 推荐场景。
 *
 * 设计:
 *   - 已知模型(官方 4 个 + 主流社区移植):name → metadata 精确匹配
 *   - 用户导入的未知名:走 inferFromName() 用名字关键词模糊匹配
 *   - 实在认不出 → 'custom' 分类
 *
 * 加新已知模型只改 KNOWN_MODELS 一处。
 */

export type UpscaleModelCategory =
  | 'general' // 通用 — 真实照片
  | 'anime' // 动漫 / 插画
  | 'video' // 动漫视频帧
  | 'sharp' // 锐化(细节增强)
  | 'face' // 人像 / 人脸
  | 'lineart' // 线稿 / 黑白
  | 'custom'; // 未知

export interface UpscaleModelMeta {
  category: UpscaleModelCategory;
  /** 中文短标签(chip 展示用,2-4 字) */
  label: string;
  /** 一句话描述(用于 tooltip / 下拉描述) */
  description: string;
}

const KNOWN_MODELS: Record<string, UpscaleModelMeta> = {
  // ── 官方 v0.2.0 ncnn release 自带 4 个 ──────────────────
  'realesrgan-x4plus': {
    category: 'general',
    label: '通用',
    description: '真实照片 4×,通用首选。细节强、对比鲜明,可能轻微塑料感。'
  },
  'realesrgan-x4plus-anime': {
    category: 'anime',
    label: '动漫',
    description: '动漫/插画 4×,锐利无伪影。默认推荐用于二次元、漫画、扁平插画。'
  },
  'realesrnet-x4plus': {
    category: 'general',
    label: '保守',
    description: '真实照片 4×,纹理更柔、更保守。适合人像照片避免过度锐化。'
  },
  'realesr-animevideov3': {
    category: 'video',
    label: '动漫视频',
    description: '动漫视频帧 4×,体积最小、速度最快。适合一致风格的连续帧。'
  },

  // ── 官方 animevideov3 多倍率变体(chaiNNer 等转出的版本) ──
  'realesr-animevideov3-x2': {
    category: 'video',
    label: '动漫视频',
    description: '动漫视频帧 2×,轻量快速,适合连续帧。'
  },
  'realesr-animevideov3-x3': {
    category: 'video',
    label: '动漫视频',
    description: '动漫视频帧 3×,轻量快速,适合连续帧。'
  },
  'realesr-animevideov3-x4': {
    category: 'video',
    label: '动漫视频',
    description: '动漫视频帧 4×,轻量快速,适合连续帧。'
  },

  // ── 官方 general-x4v3 系(SRVGGNetCompact 轻量,常以多种命名出现) ──
  'realesr-general-x4v3': {
    category: 'general',
    label: '通用·轻量',
    description: 'realesr-general-x4v3,SRVGGNetCompact 4×,4.87 MB 极轻量,速度优先。'
  },
  'realesr-general-wdn-x4v3': {
    category: 'general',
    label: '通用·轻量',
    description: 'general-x4v3 的强降噪配套权重(wdn),与主权重做 dni 双权重插值。'
  },
  'RealESRGAN_General_x4_v3': {
    category: 'general',
    label: '通用·轻量',
    description: 'realesr-general-x4v3 的官方原名,SRVGGNetCompact 4× 轻量。'
  },
  'RealESRGAN_General_WDN_x4_v3': {
    category: 'general',
    label: '通用·轻量',
    description: 'general-x4v3 配套强降噪权重(WDN)。'
  },

  // ── 社区主流(参考 COMMUNITY_REFERENCE) ───────────────
  '4xHFA2k': {
    category: 'anime',
    label: '动漫',
    description: '社区 4× 动漫模型(Phips),HFA2k 数据集训练,锐利线条 + 干净色块。'
  },
  '4xLSDIR': {
    category: 'general',
    label: '写实',
    description: '社区 4× 写实模型(Helaman),LSDIR 数据集,细节细腻。'
  },
  '4xLSDIRplusC': {
    category: 'general',
    label: '写实',
    description: '社区 4× 写实模型(Helaman),LSDIR + 轻度压缩修复,适合 JPEG 老图。'
  },
  '4xLSDIRCompactC3': {
    category: 'general',
    label: '通用·轻量',
    description: '社区 4× 轻量写实(Helaman),Compact 架构 ~1.25 MB,速度优先。'
  },
  '4xNomos8kSC': {
    category: 'sharp',
    label: '修复',
    description: '社区 4× 照片修复模型(Phips),Nomos8k + SC 架构,适合老照片修复。'
  },
  '4x_NMKD-Siax_200k': {
    category: 'sharp',
    label: '锐化',
    description: '社区 4× 通用锐化(NMKD,Siax 200k),通用纹理 + 中等模糊修复。'
  },
  '4x_NMKD-Superscale-SP_178000_G': {
    category: 'sharp',
    label: '锐化',
    description: '社区 4× NMKD Superscale,锐化向,适合 logo / 文字 / 商品。'
  },

  // ── 修复类(uniscale 系) ──────────────────────────────
  uniscale_restore: {
    category: 'general',
    label: '修复',
    description: '社区修复型 4× 模型,泛通用,适合中等噪点 / 压缩图。'
  }
};

const NAME_PATTERN_RULES: Array<{
  re: RegExp;
  meta: UpscaleModelMeta;
}> = [
  // 动漫视频(优先于 anime,避免 animevideo 误进 anime)
  {
    re: /animevideo|anime[-_ ]?video|videov\d/i,
    meta: {
      category: 'video',
      label: '动漫视频',
      description: '动漫视频帧模型,速度优先,适合一致风格的连续帧。'
    }
  },
  // 锐化系 / 通用锐化(覆盖 UltraSharp / Remacri / NMKD-Siax / Superscale 等)
  {
    re: /ultrasharp|remacri|nmkd[-_ ]?siax|nmkd[-_ ]?superscale|nmkd[-_ ]?sharp/i,
    meta: {
      category: 'sharp',
      label: '锐化',
      description: '社区锐化模型,细节增强 + 边缘清晰。适合 logo / 截图 / 文字图。'
    }
  },
  // 修复 / 老图(Nomos8k / SC 架构 / restore / repair)
  {
    re: /nomos|^.*restore|repair|denoise|degradation/i,
    meta: {
      category: 'sharp',
      label: '修复',
      description: '修复型模型,适合压缩 / 噪点 / 老图的纹理还原。'
    }
  },
  // 人像 / 脸
  {
    re: /gfpgan|codeformer|restoreformer|face/i,
    meta: {
      category: 'face',
      label: '人脸',
      description: '人脸修复模型,适合人像照片的脸部细节恢复。'
    }
  },
  // 动漫 / 插画(放 video 之后)
  {
    re: /anime|waifu|illust|hfa2k|toon|cartoon|manga(?![-_ ]?109)/i,
    meta: {
      category: 'anime',
      label: '动漫',
      description: '动漫 / 插画模型,锐利线条 + 干净色块。'
    }
  },
  // 线稿
  {
    re: /lineart|sketch|manga109/i,
    meta: {
      category: 'lineart',
      label: '线稿',
      description: '线稿 / 漫画模型,适合黑白手绘 / 单色 logo。'
    }
  },
  // 写实 / 通用照片(LSDIR / DIV2K / 真实数据集名)
  {
    re: /lsdir|div2k|nomos8k(?!sc)|nomos2|reality|realistic/i,
    meta: {
      category: 'general',
      label: '写实',
      description: '社区写实数据集训练,适合普通照片 / 商品图 / 设计稿。'
    }
  },
  // 轻量通用(Compact / SRVGG / fast)
  {
    re: /compact|srvgg|x4[-_ ]?v3|fast|tiny|small/i,
    meta: {
      category: 'general',
      label: '通用·轻量',
      description: '轻量架构(SRVGGNetCompact),速度优先,适合批量 / 低配。'
    }
  },
  // 真实照片通用(photo / film / portrait / natural)
  {
    re: /photo|film|portrait|natural|real(?!esrgan)/i,
    meta: {
      category: 'general',
      label: '真实',
      description: '真实照片模型,通用纹理 + 适度细节。'
    }
  }
];

const CATEGORY_DISPLAY: Record<UpscaleModelCategory, { label: string; cssClass: string }> = {
  general: { label: '通用', cssClass: 'is-cat-general' },
  anime: { label: '动漫', cssClass: 'is-cat-anime' },
  video: { label: '视频', cssClass: 'is-cat-video' },
  sharp: { label: '锐化', cssClass: 'is-cat-sharp' },
  face: { label: '人脸', cssClass: 'is-cat-face' },
  lineart: { label: '线稿', cssClass: 'is-cat-lineart' },
  custom: { label: '自定义', cssClass: 'is-cat-custom' }
};

/** 主入口:模型名 → 元数据。未知名走名字模糊匹配,再不行归 custom。 */
export function getUpscaleModelMeta(modelName: string): UpscaleModelMeta {
  const exact = KNOWN_MODELS[modelName];
  if (exact) return exact;
  for (const rule of NAME_PATTERN_RULES) {
    if (rule.re.test(modelName)) return rule.meta;
  }
  return {
    category: 'custom',
    label: '自定义',
    description: '用户导入的自定义模型,无内置说明。把 .bin/.param 放进 models 目录就能用。'
  };
}

export function getCategoryDisplay(c: UpscaleModelCategory) {
  return CATEGORY_DISPLAY[c];
}

/**
 * 按分类分组模型 —— 用于设置页 / 面板按类显示。
 * 返回顺序遵循 CATEGORY_DISPLAY 的键顺序(通用 → 动漫 → 视频 → 锐化 → 人脸 → 线稿 → 自定义)。
 */
export function groupModelsByCategory<T extends { name: string }>(
  models: readonly T[]
): Array<{ category: UpscaleModelCategory; label: string; items: T[] }> {
  const groups = new Map<UpscaleModelCategory, T[]>();
  for (const m of models) {
    const cat = getUpscaleModelMeta(m.name).category;
    const list = groups.get(cat) ?? [];
    list.push(m);
    groups.set(cat, list);
  }
  const order: UpscaleModelCategory[] = ['general', 'anime', 'video', 'sharp', 'face', 'lineart', 'custom'];
  const out: Array<{ category: UpscaleModelCategory; label: string; items: T[] }> = [];
  for (const c of order) {
    const items = groups.get(c);
    if (items && items.length > 0) {
      out.push({ category: c, label: CATEGORY_DISPLAY[c].label, items });
    }
  }
  return out;
}
