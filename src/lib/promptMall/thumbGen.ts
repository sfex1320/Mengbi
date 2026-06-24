// 提示词商城缩略图「统一风格包装」：把每张卡的 genPrompt（只描述 主体 + 取景 + 区别特征）
// 包上一段按大类区分的固定风格后缀，让整本目录缩略图风格一致（用户用 ComfyUI + Z-Image 生成）。
// 三档 profile：
//  - isolated（人物/服饰/质感材质）：主体抠在无缝浅灰影棚背景 + 柔和均匀影棚光 + 写实。
//  - scene（环境/动植物建筑/室内）：保留自身场景，只统一写实画质（不强加灰底，否则瀑布会被抠到灰底上）。
//  - demo（画风/镜头构图/光线/色彩/氛围/质量）：卡片本身的变量就是主体，后缀最小化（不盖掉变量）。
// 两个生成入口（generateMallThumb / generateMallThumbViaComfy）都必须经过 buildThumbGenPrompt。

import type { PromptMallCard } from './cardTypes';

type ThumbStyle = 'isolated' | 'scene' | 'demo';

const CAT_STYLE: Record<string, ThumbStyle> = {
  character: 'isolated',
  clothing: 'isolated',
  'china-female': 'isolated',
  'china-male': 'isolated',
  swimwear: 'isolated',
  wedding: 'isolated',
  material: 'isolated',
  props: 'isolated',
  environment: 'scene',
  'nature-arch': 'scene',
  interior: 'scene',
  'art-style': 'demo',
  camera: 'demo',
  lighting: 'demo',
  color: 'demo',
  mood: 'demo',
  effects: 'demo',
  quality: 'demo'
};

const SUFFIX: Record<ThumbStyle, string> = {
  isolated:
    ', isolated on a seamless light grey studio background, soft even diffused studio lighting, photorealistic, sharp focus, high detail, centered composition',
  scene: ', photorealistic, natural lighting, sharp focus, high detail, professional photography, centered composition',
  demo: ', high quality, sharp detail, centered composition'
};

/** 幂等判重锚点（isolated 后缀含此串；export 与运行各包一次，互不叠加）。 */
const MARK = 'seamless light grey studio background';

/** 固定随机种子（仅绘画模型路径可控；ComfyUI 路径 seed 由用户工作流 KSampler 决定）。 */
export const THUMB_SEED = 20240614;

/** 安全网：即便数据重写漏网也兜底，把动物比喻 / 形状实物化的残留替换成安全表述（不替代重写，仅兜底）。 */
function scrub(s: string): string {
  return s
    .replace(/\bfeline\s+cat\s+eyes\b/gi, 'upturned almond eyes with lifted outer corners')
    .replace(/\bcat\s+eyes\b/gi, 'upturned almond eyes')
    .replace(/\bpuppy\s+eyes\b/gi, 'gentle downturned eyes')
    .replace(/\bheart-?shaped\s+face\b/gi, 'a face with a wide forehead and a narrow pointed chin');
}

/** 该大类用哪一档风格后缀（未知大类按 isolated 兜底）。 */
export function thumbStyleOf(cat: string): ThumbStyle {
  return CAT_STYLE[cat] ?? 'isolated';
}

/**
 * 组装最终缩略图提示词 = 主体描述（genPrompt，空则回退 en/zh）+ 按大类的固定风格后缀。
 * 幂等：已包含锚点串则原样返回，防双重包裹。
 */
export function buildThumbGenPrompt(card: Pick<PromptMallCard, 'genPrompt' | 'en' | 'zh' | 'cat'>): string {
  const base = scrub((card.genPrompt || card.en || card.zh || '').trim());
  const suffix = SUFFIX[thumbStyleOf(card.cat)];
  if (!base) return suffix.replace(/^,\s*/, '');
  if (base.includes(MARK)) return base; // 防双重包裹
  return base + suffix;
}
