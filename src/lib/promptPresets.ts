/**
 * HYPIR 等扩散修复模型的提示词预设。
 *
 * 设计原则：
 * - 短词组优先（与原 prompt 用逗号拼接，模型对短结构鲁棒）
 * - 分类清晰，按"主体 / 质感 / 光影 / 强度方向 / 风格"组织
 * - 每个预设都有名称 + 实际 prompt + 一句简短说明，UI 可直接显示
 * - 预设 prompt 不带末尾句号或多余空格
 *
 * 数据源参考：
 * - HYPIR 官方 README + paper 中的 prompt 示例
 * - StableSR / DiffBIR 论文 prompt 模板
 * - Civitai 上扩散模型 super-resolution workflow 的常用 prompt
 */

export interface PromptPreset {
  /** 类别 */
  category: PromptCategory;
  /** UI 标签（短，一行能放下） */
  label: string;
  /** 实际要拼进 prompt 的字符串 */
  prompt: string;
  /** tooltip 说明 */
  hint?: string;
  /** 与"sharpen 强度"相关时打 tag —— UI 可视化提醒（强锐化 / 弱锐化） */
  tone?: 'sharper' | 'softer' | 'neutral';
}

export type PromptCategory =
  | 'subject'      // 主体类别
  | 'texture'      // 质感
  | 'lighting'     // 光影
  | 'intensity'    // 强度方向（锐 / 柔 / 自然）
  | 'style'        // 风格
  | 'avoid';       // 反向（telling model 避免某种纹理）

export const PROMPT_CATEGORY_LABELS: Record<PromptCategory, string> = {
  subject: '主体',
  texture: '质感',
  lighting: '光影',
  intensity: '强度倾向',
  style: '风格',
  avoid: '反向（避免）',
};

export const PROMPT_PRESETS: PromptPreset[] = [
  // ── 主体类型 ─────────────────────────────────────
  { category: 'subject', label: '人像', prompt: 'portrait photo, person', hint: '人物特写，启用更柔的皮肤先验' },
  { category: 'subject', label: '皮肤特写', prompt: 'close-up skin, even skin tone, natural pores', hint: '皮肤细节，避免假塑料感' },
  { category: 'subject', label: '人物发丝', prompt: 'natural hair strands, soft highlights, defined hair', hint: '发丝清晰但不油亮' },
  { category: 'subject', label: '人物指甲', prompt: 'natural fingernails, subtle highlights, smooth manicure', hint: '指甲反光柔和' },
  { category: 'subject', label: '眼睛', prompt: 'detailed eyes, clear iris, natural catchlight', hint: '眼神更有神' },
  { category: 'subject', label: '群像 / 多人', prompt: 'multiple people, group photo, individual faces', hint: '多人不糊脸' },
  { category: 'subject', label: '衣物 / 织物', prompt: 'natural fabric, smooth cloth, soft folds', hint: '布料褶皱自然不发明纹理' },
  { category: 'subject', label: '丝绸 / 缎面', prompt: 'silk fabric, soft sheen, gentle folds', hint: '丝绸专用，少过锐' },
  { category: 'subject', label: '皮革', prompt: 'leather texture, subtle grain, soft luster', hint: '皮革纹路自然' },
  { category: 'subject', label: '风景', prompt: 'landscape photo, natural scenery, atmospheric depth', hint: '风景照通用' },
  { category: 'subject', label: '建筑', prompt: 'architecture, clean geometry, sharp edges', hint: '建筑线条干净' },
  { category: 'subject', label: '海报 / 印刷品', prompt: 'poster artwork, clean design, vector-like edges', hint: '海报印刷品边缘锐利' },
  { category: 'subject', label: '文字 / 字体', prompt: 'crisp typography, clean letters, sharp anti-aliasing', hint: '文字边缘清晰' },
  { category: 'subject', label: '渐变 / 色块', prompt: 'smooth gradient, clean color field, no banding', hint: '大面渐变不出色阶' },
  { category: 'subject', label: '产品摄影', prompt: 'product photo, studio lighting, clean background', hint: '电商图风格' },
  { category: 'subject', label: '食物', prompt: 'food photo, fresh ingredients, natural moisture', hint: '食物质感自然' },
  { category: 'subject', label: '动漫 / 插画', prompt: 'anime illustration, clean line art, flat color', hint: '二次元插画通用' },
  { category: 'subject', label: '老照片', prompt: 'vintage photograph, film grain, restored details', hint: '老照片修复，保留底色调' },

  // ── 质感 ────────────────────────────────────────
  { category: 'texture', label: '皮肤纹理', prompt: 'fine skin texture, natural pores', hint: '强化皮肤毛孔细节' },
  { category: 'texture', label: '布料纹理', prompt: 'visible fabric weave, cloth threads', hint: '强化布纹（粗布 / 麻）' },
  { category: 'texture', label: '木纹', prompt: 'wood grain, natural knots', hint: '木质纹理' },
  { category: 'texture', label: '石材', prompt: 'stone texture, mineral surface', hint: '石头表面' },
  { category: 'texture', label: '金属', prompt: 'metal surface, brushed finish, subtle reflection', hint: '金属表面反光' },
  { category: 'texture', label: '玻璃', prompt: 'glass surface, clear refraction, sharp highlights', hint: '玻璃高光' },
  { category: 'texture', label: '湿润', prompt: 'wet surface, moist details, subtle reflection', hint: '湿润 / 雨后' },
  { category: 'texture', label: '干燥粗糙', prompt: 'dry rough surface, matte texture', hint: '干燥粗糙面' },

  // ── 光影 ────────────────────────────────────────
  { category: 'lighting', label: '自然光', prompt: 'natural lighting, soft daylight', hint: '日光，最常用' },
  { category: 'lighting', label: '柔光', prompt: 'soft lighting, diffuse shadows', hint: '柔光，肤色更平滑' },
  { category: 'lighting', label: '硬光', prompt: 'hard light, defined shadows, high contrast', hint: '硬光 / 直射' },
  { category: 'lighting', label: '逆光', prompt: 'backlit, rim lighting, glow', hint: '逆光剪影边缘' },
  { category: 'lighting', label: '黄金时刻', prompt: 'golden hour, warm sunset light', hint: '黄昏金光' },
  { category: 'lighting', label: '室内光', prompt: 'indoor warm lighting, ambient glow', hint: '室内暖光' },
  { category: 'lighting', label: '冷调', prompt: 'cool tone, blue cast, cold atmosphere', hint: '冷色调' },

  // ── 强度方向（重要：直接影响过锐 / 过柔） ──────
  { category: 'intensity', label: '自然不锐化', prompt: 'natural texture, no oversharpening, authentic detail', tone: 'softer', hint: '【推荐丝绸 / 皮肤】明确告诉模型别过锐' },
  { category: 'intensity', label: '柔和细腻', prompt: 'soft details, smooth texture, subtle highlights', tone: 'softer', hint: '柔和取向' },
  { category: 'intensity', label: '保真还原', prompt: 'true to source, faithful restoration, authentic look', tone: 'softer', hint: '强调还原原貌' },
  { category: 'intensity', label: '清晰锐利', prompt: 'sharp focus, crisp details, high frequency', tone: 'sharper', hint: '想更清晰时用' },
  { category: 'intensity', label: '高清还原', prompt: 'high quality, sharp details, photograph', tone: 'sharper', hint: '通用 HQ 风' },
  { category: 'intensity', label: '极致细节', prompt: 'ultra detailed, hyper realistic, intricate', tone: 'sharper', hint: '【慎用】容易过锐' },

  // ── 风格 ───────────────────────────────────────
  { category: 'style', label: '电影感', prompt: 'cinematic, film look, color graded', hint: '电影质感' },
  { category: 'style', label: '胶片', prompt: 'film photograph, analog look, organic grain', hint: '胶片感' },
  { category: 'style', label: '数码摄影', prompt: 'digital photograph, clean sensor, modern look', hint: '数码风' },
  { category: 'style', label: 'HDR', prompt: 'high dynamic range, balanced exposure', hint: 'HDR 平衡' },
  { category: 'style', label: '黑白', prompt: 'black and white photograph, rich tonal range', hint: '黑白照' },
  { category: 'style', label: '油画', prompt: 'oil painting style, painterly brush strokes', hint: '油画风' },
  { category: 'style', label: '水彩', prompt: 'watercolor painting, soft washes', hint: '水彩风' },

  // ── 反向（避免某种纹理） ────────────────────────
  { category: 'avoid', label: '避免过锐', prompt: 'no oversharpening, no halos, no artificial edges', tone: 'softer', hint: '【推荐】明确禁止过锐' },
  { category: 'avoid', label: '避免假塑料感', prompt: 'no plastic skin, no waxy look, natural', tone: 'softer', hint: '皮肤别像塑料' },
  { category: 'avoid', label: '避免幻觉纹理', prompt: 'no invented texture, no hallucinated patterns', tone: 'softer', hint: '别凭空发明纹理' },
  { category: 'avoid', label: '避免噪点', prompt: 'no noise, no grain, clean', tone: 'neutral', hint: '降噪取向' },
  { category: 'avoid', label: '避免锯齿', prompt: 'no aliasing, smooth edges, anti-aliased', tone: 'neutral', hint: '避免锯齿' },
  { category: 'avoid', label: '避免色阶断层', prompt: 'no color banding, smooth gradient', tone: 'neutral', hint: '渐变不出色阶' },
];

/**
 * 把一段已有 prompt + 一个 preset 合并（避免重复添加 + 优雅拼接）。
 */
export function mergePrompt(current: string, preset: PromptPreset): string {
  const cur = current.trim();
  if (!cur) return preset.prompt;
  // 简单去重：已包含该 preset 的全部词组就不重复加
  if (cur.toLowerCase().includes(preset.prompt.toLowerCase())) return cur;
  // 用逗号拼
  return cur.endsWith(',') ? `${cur} ${preset.prompt}` : `${cur}, ${preset.prompt}`;
}

/**
 * 判断 prompt 是否包含某个 preset（用于 UI 高亮已选）。
 */
export function promptContains(current: string, preset: PromptPreset): boolean {
  return current.toLowerCase().includes(preset.prompt.toLowerCase());
}
