/**
 * 放大模式系统 —— 用户友好的模式选择 + 高级模型选择(2026-05-28)。
 *
 * 设计原则:
 *   - 普通用户看「模式」(智能推荐 / 通用高清 / 动漫插画 / ...);
 *     从不直接选模型名,除非展开"高级"。
 *   - 每个模式声明它"理想用什么模型"(ideal) + "当前 ncnn 引擎能用什么"(available)。
 *   - 模型不可用时,UI 把模式标"需 PyTorch 后端 / 需扩展模型"并允许用户回退到能跑的近似模型。
 *
 * 加新模型 / 改映射 → 改本文件 MODES + MODEL_AVAILABILITY 一处。
 *
 * 当前后端能力(ncnn-vulkan v0.2.0 + 用户可导入 .bin/.param):
 *   - 官方自带 4 个:realesrgan-x4plus / realesrgan-x4plus-anime /
 *     realesrnet-x4plus / realesr-animevideov3
 *   - 不支持:.pth / face_enhance / denoise_strength(模型本身得是 general-x4v3 才支持)
 *   - 自定义:用户可手动导入 .bin/.param 对
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

/** 后端能力 —— 决定模式 / 高级参数是否可用 */
export interface BackendCapabilities {
  /** ncnn-vulkan(轻量,GPU 跨厂商) */
  ncnn: boolean;
  /** PyTorch sidecar(本地 Python,支持 .pth / face_enhance / denoise_strength) */
  pytorch: boolean;
}

export interface UpscaleModeConfig {
  id: UpscaleModeId;
  /** 友好名称 */
  label: string;
  /** 一句话提示 */
  tagline: string;
  /** 详细描述(展开高级时显示) */
  description: string;
  /** ⚠ 警告(清晰增强专用 — 假细节风险) */
  warning?: string;
  /** "理想模型名" — 用于高级面板展示真实模型 */
  idealModel: string;
  /** "可选替代模型名"(同语义,但当前后端能跑的) */
  alternativeModels?: string[];
  /** 需要哪种后端 */
  requires: BackendCapabilities;
  /** 是否能作为"智能推荐"自动选 */
  smartEligible: boolean;
  /** 视觉分类(色块/图标对照) */
  category: 'general' | 'anime' | 'sharp' | 'custom';
}

/** 7 个用户可见的模式 */
export const MODES: UpscaleModeConfig[] = [
  {
    id: 'smart',
    label: '智能推荐',
    tagline: '默认 · 根据图片自动选择',
    description:
      '拖入图片后,根据图片类型自动选最优模式:照片走通用高清 / 动漫走动漫插画 / 大图压缩走通用快速 / 噪点重走通用快速 + 中等降噪。',
    idealModel: '(自动)',
    requires: { ncnn: true, pytorch: false },
    smartEligible: false, // 自身就是聚合
    category: 'general'
  },
  {
    id: 'general-hd',
    label: '通用高清',
    tagline: '照片 / 商品图 / 设计稿首选',
    description:
      'RealESRGAN_x4plus 的高质量通用模型。细节强、对比鲜明,适合普通照片、商品图、海报、设计稿等真实风格图。',
    idealModel: 'RealESRGAN_x4plus',
    alternativeModels: ['realesrgan-x4plus'],
    requires: { ncnn: true, pytorch: false },
    smartEligible: true,
    category: 'general'
  },
  {
    id: 'general-fast',
    label: '通用快速',
    tagline: '批量 / 低配置 / 快速预览',
    description:
      'realesr-general-x4v3,体积小、速度快,支持 denoise_strength 参数。适合批量处理 / 低配电脑 / 快速预览。',
    idealModel: 'realesr-general-x4v3',
    // ncnn 0.2.0 不带 general-x4v3;用 realesrnet-x4plus 做近似(也是更保守的真实风模型)
    alternativeModels: ['realesrnet-x4plus'],
    requires: { ncnn: false, pytorch: true },
    smartEligible: true,
    category: 'general'
  },
  {
    id: 'anime-illust',
    label: '动漫插画',
    tagline: '二次元 / 漫画 / AI 绘画 / 线稿',
    description:
      'RealESRGAN_x4plus_anime_6B,锐利线条 + 干净色块。适合二次元、漫画、AI 绘画、插画、线稿。不建议用于真实照片和人像。',
    idealModel: 'RealESRGAN_x4plus_anime_6B',
    // ncnn 没有 anime_6B,用 realesrgan-x4plus-anime(原版,效果接近)
    alternativeModels: ['realesrgan-x4plus-anime'],
    requires: { ncnn: true, pytorch: false },
    smartEligible: true,
    category: 'anime'
  },
  {
    id: 'anime-video',
    label: '动漫视频',
    tagline: '视频帧 / 连续帧 / 截图批量',
    description:
      'RealESRGANv2-animevideo-xsx2/xsx4 或 AnimeVideo-v3。专为动漫视频帧设计,速度优先。适合连续帧、动漫截图批量放大。',
    idealModel: 'AnimeVideo-v3',
    alternativeModels: ['realesr-animevideov3'],
    requires: { ncnn: true, pytorch: false },
    smartEligible: false, // 视频用途 — 不强制推荐普通照片用
    category: 'anime'
  },
  {
    id: 'sharpen',
    label: '清晰增强',
    tagline: '模糊图 / 老图 / 纹理图',
    description:
      'Remacri / 4x-UltraSharp / Ultramix Balanced 等社区强化模型。适合模糊图、纹理图、老图。',
    warning:
      '⚠ 该模式可能产生假细节、过度锐化、颗粒感。不建议用于皮肤、人像、文字边缘。',
    idealModel: '4x-UltraSharp / Remacri / Ultramix',
    // 这些都是 .pth,ncnn 没移植;用 realesrgan-x4plus 做不完美 fallback
    alternativeModels: [],
    requires: { ncnn: false, pytorch: true },
    smartEligible: false, // 用户清单 §4 — 清晰增强不能作默认
    category: 'sharp'
  },
  {
    id: 'custom',
    label: '自定义模型',
    tagline: '导入自己的 ESRGAN / Real-ESRGAN 模型',
    description:
      '支持 ncnn-vulkan 的 .bin + .param 对(同名成对)。PyTorch .pth 模型需启用 PyTorch 后端。导入后在下面"自定义模型路径"选择具体一个。',
    idealModel: '(用户导入)',
    requires: { ncnn: true, pytorch: false },
    smartEligible: false,
    category: 'custom'
  }
];

export function getMode(id: UpscaleModeId): UpscaleModeConfig {
  return MODES.find((m) => m.id === id) ?? MODES[0];
}

/**
 * 解析模式 → 当前后端能用的具体模型名。
 *
 * @param mode  用户选的模式
 * @param caps  当前后端能力
 * @param availableNcnnModels 用户机器上已装的 ncnn 模型清单
 * @param customModel  custom 模式下用户具体选了哪个 .bin
 *
 * 返回 null 时表示该模式当前后端跑不起来(UI 应灰显或提示)。
 */
export function resolveModelForMode(
  mode: UpscaleModeConfig,
  caps: BackendCapabilities,
  availableNcnnModels: readonly string[],
  customModel: string | null = null
): { model: string; usedFallback: boolean; reason?: string } | null {
  if (mode.id === 'custom') {
    if (!customModel) return null;
    return { model: customModel, usedFallback: false };
  }
  // 优先理想模型:如果是 ncnn 名 + 已装,直接用
  if (caps.ncnn && availableNcnnModels.includes(mode.idealModel.toLowerCase())) {
    return { model: mode.idealModel, usedFallback: false };
  }
  // 其次替代模型链
  for (const alt of mode.alternativeModels ?? []) {
    if (caps.ncnn && availableNcnnModels.includes(alt.toLowerCase())) {
      return {
        model: alt,
        usedFallback: alt !== mode.idealModel,
        reason:
          alt !== mode.idealModel
            ? `当前后端不支持理想模型 ${mode.idealModel},用近似模型 ${alt} 代替`
            : undefined
      };
    }
  }
  // 需要 PyTorch 后端但没启用
  if (mode.requires.pytorch && !caps.pytorch) {
    return null;
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
  // 大图 → 通用快速(节约时间)
  if ((input.longestSide ?? 0) > 2048) {
    return { modeId: 'general-fast', reason: '图片较大(>2K),走通用快速节约时间' };
  }
  // 动漫 / 插画特征 → 动漫插画
  if (
    input.tag === 'flat-illustration' ||
    input.tag === 'color-logo' ||
    input.tag === 'mono-logo' ||
    input.tag === 'icon' ||
    (input.distinctColors !== undefined && input.distinctColors < 200 && (input.edgeDensity ?? 0) > 0.03)
  ) {
    return { modeId: 'anime-illust', reason: '识别为扁平/动漫风,走动漫插画模型' };
  }
  // 黑白线稿 → 动漫插画(线条锐化好)
  if (input.isMostlyBW || input.tag === 'bw-lineart') {
    return { modeId: 'anime-illust', reason: '黑白线稿,动漫插画模型对线条最锐利' };
  }
  // 默认 → 通用高清
  return { modeId: 'general-hd', reason: '常规照片,走通用高清模型(默认)' };
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
