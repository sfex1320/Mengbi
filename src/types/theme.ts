/**
 * 主题系统类型。详见 THEMING.md。
 */

export const ATMOSPHERES = [
  'none',
  'deep-quiet',
  'misty-fog',
  'warm-stone',
  'deep-city',
  'flowing-light',
  'dream-galaxy',
  'wave-layer',
  'warm-jade',
  'glass'
] as const;

export const ATMOSPHERE_LABELS: Record<Atmosphere, string> = {
  none: '无（关闭动效）',
  'deep-quiet': '沉稳质感',
  'misty-fog': '朦胧雾感',
  'warm-stone': '暖石金属',
  'deep-city': '固定深城',
  'flowing-light': '渐隐流光',
  'dream-galaxy': '幻梦星空',
  'wave-layer': '浪绪图层',
  'warm-jade': '暖白玉',
  glass: '光影玻璃'
};

export type Atmosphere = (typeof ATMOSPHERES)[number];

export const PALETTES = [
  'emerald',
  'purple',
  'rose',
  'ocean',
  'warm-orange',
  'slate',
  'sunset',
  'wheat',
  'coffee',
  'cyan'
] as const;

export const PALETTE_LABELS: Record<Palette, string> = {
  emerald: '翠',
  purple: '紫',
  rose: '蔷',
  ocean: '海',
  'warm-orange': '暖橘',
  slate: '灰',
  sunset: '落日橙',
  wheat: '麦黄',
  coffee: '咖啡',
  cyan: '青'
};

export type Palette = (typeof PALETTES)[number];

export const DEFAULT_ATMOSPHERE: Atmosphere = 'deep-quiet';
export const DEFAULT_PALETTE: Palette = 'warm-orange';
