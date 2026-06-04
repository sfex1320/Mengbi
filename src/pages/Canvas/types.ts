/**
 * 画板模块共享类型。
 *
 * 一份 CanvasProject 包含若干 Layer。
 * 每个 Layer：
 *   - sourcePath / sourceDataUri 二选一（path 走 mengbi-image://；dataUri 用于抠图后的临时图）
 *   - 仿射变换（x/y/scaleX/scaleY/rotation/skewX/skewY）由 Konva.Transformer 直接驱动
 *   - perspective：四角点坐标，只有进入透视模式后才有；退出时把 warp 结果烘焙到 cookedDataUri
 *   - crop：相对原图坐标系的矩形，由 Konva 原生 cropX/cropY/cropWidth/cropHeight 直接消费
 */

export type BlendMode =
  | 'source-over'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity';

export const BLEND_MODE_LABEL: Record<BlendMode, string> = {
  'source-over': '正常',
  multiply: '正片叠底',
  screen: '滤色',
  overlay: '叠加',
  darken: '变暗',
  lighten: '变亮',
  'color-dodge': '颜色减淡',
  'color-burn': '颜色加深',
  'hard-light': '强光',
  'soft-light': '柔光',
  difference: '差值',
  exclusion: '排除',
  hue: '色相',
  saturation: '饱和度',
  color: '颜色',
  luminosity: '明度'
};

export interface PerspectiveCorners {
  /** 全部相对原图坐标系，(0,0) 是左上 */
  tl: [number, number];
  tr: [number, number];
  br: [number, number];
  bl: [number, number];
}

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 笔刷描边：以图层局部坐标系记录路径点，实时绘制 / 输出走 Konva.Line。
 * tool='paint' = 用 color 涂；tool='erase' = 把已有 paint 抠掉（destination-out）。
 * 用于：
 *   - 笔刷图层（isBrush=true）
 *   - 图像图层的蒙版（maskStrokes）
 */
export interface BrushStroke {
  id: string;
  tool: 'paint' | 'erase';
  /** [x1,y1,x2,y2,...] 局部坐标 */
  points: number[];
  color: string;
  size: number;
  opacity: number;
}

export interface Layer {
  id: string;
  name: string;
  /** 原始本地路径（mengbi-image:// 用），抠图前默认从这里读 */
  sourcePath: string | null;
  /** 抠图 / 透视烘焙后的临时图（dataUri / objectURL），优先级高于 sourcePath；不持久化 */
  cookedDataUri: string | null;
  /** 原图自然尺寸（变换前） */
  width: number;
  height: number;
  visible: boolean;
  locked: boolean;
  opacity: number;
  blendMode: BlendMode;
  // 仿射变换（Konva 原生）
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  skewX: number;
  skewY: number;
  // 透视：null 表示未进入过透视编辑
  perspective: PerspectiveCorners | null;
  // 裁切：null 表示未裁切
  crop: CropRect | null;
  // ─── 图层组（B2） ───
  /** null = 顶级；否则指向一个 isGroup=true 的图层 id */
  parentId?: string | null;
  /** true 表示这一层是分组容器（无图像），children 通过 parentId 关联 */
  isGroup?: boolean;
  /** 分组在面板里是否折叠（仅对 isGroup 有意义） */
  collapsed?: boolean;
  // ─── 笔刷图层（C4c） ───
  /** true 表示这一层是笔刷图层（无图像），strokes 是绘画内容 */
  isBrush?: boolean;
  /** 笔刷图层的描边集合 */
  strokes?: BrushStroke[];
  // ─── 蒙版（C1） ───
  /** 图像图层的蒙版描边：paint = 显示，erase = 隐藏；为空 = 无蒙版（全可见） */
  maskStrokes?: BrushStroke[];
  // ─── 文本图层（C4a） ───
  isText?: boolean;
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: 'normal' | 'bold';
  fontStyle?: 'normal' | 'italic';
  align?: 'left' | 'center' | 'right';
  fillColor?: string;       // 文本 / 形状的填充色
  // ─── 矢量形状（C4b） ───
  /** 'rect' | 'ellipse' */
  shapeKind?: 'rect' | 'ellipse';
  strokeColor?: string;
  strokeWidth?: number;
  // ─── 调整（C3 + AI 后处理增强） ───
  /** 仅图像图层有效：亮度（-1~1）、对比度（-1~1）、饱和度（-1~1）、色相（-180~180 度） */
  adjBrightness?: number;
  adjContrast?: number;
  adjSaturation?: number;
  adjHue?: number;
  /** 色温（-1~1，正=暖）、曝光（-1~1）、锐化（0~1）、模糊（0~40px）、降噪（0~1） */
  adjTemperature?: number;
  adjExposure?: number;
  adjSharpen?: number;
  adjBlur?: number;
  adjDenoise?: number;
  /** 黑白 / 反色开关 */
  adjGrayscale?: boolean;
  adjInvert?: boolean;
  // ─── 文本增强（C4a+） ───
  textUnderline?: boolean;
  /** 文本 / 形状阴影 */
  shadowColor?: string;
  shadowBlur?: number;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
}

/** 调色字段集合（用于预设批量套用 / 重置） */
export interface AdjustFields {
  adjBrightness: number;
  adjContrast: number;
  adjSaturation: number;
  adjHue: number;
  adjTemperature: number;
  adjExposure: number;
  adjSharpen: number;
  adjBlur: number;
  adjDenoise: number;
  adjGrayscale: boolean;
  adjInvert: boolean;
}

export const ZERO_ADJUST: AdjustFields = {
  adjBrightness: 0,
  adjContrast: 0,
  adjSaturation: 0,
  adjHue: 0,
  adjTemperature: 0,
  adjExposure: 0,
  adjSharpen: 0,
  adjBlur: 0,
  adjDenoise: 0,
  adjGrayscale: false,
  adjInvert: false
};

/** 调色预设（需求九节的 7 个常用预设） */
export interface AdjustPreset {
  key: string;
  label: string;
  patch: Partial<AdjustFields>;
}

export const ADJUST_PRESETS: AdjustPreset[] = [
  { key: 'product', label: '产品图增强', patch: { adjContrast: 0.15, adjSaturation: 0.2, adjSharpen: 0.5, adjBrightness: 0.05 } },
  { key: 'render-real', label: '效果图真实化', patch: { adjContrast: 0.1, adjSaturation: -0.05, adjTemperature: 0.08, adjSharpen: 0.3 } },
  { key: 'interior-bright', label: '室内图提亮', patch: { adjBrightness: 0.18, adjExposure: 0.15, adjContrast: 0.06, adjTemperature: 0.06 } },
  { key: 'poster', label: '海报色彩增强', patch: { adjSaturation: 0.35, adjContrast: 0.2, adjSharpen: 0.3 } },
  { key: 'dehaze', label: '去灰提亮', patch: { adjContrast: 0.22, adjBrightness: 0.08, adjSaturation: 0.12 } },
  { key: 'bg-blur', label: '背景虚化', patch: { adjBlur: 8 } },
  { key: 'local-sharpen', label: '局部锐化', patch: { adjSharpen: 0.8, adjContrast: 0.08 } },
  // ─── 风格化预设 ───
  { key: 'film', label: '复古胶片', patch: { adjContrast: 0.1, adjSaturation: -0.15, adjTemperature: 0.14, adjExposure: 0.05 } },
  { key: 'cool', label: '冷调', patch: { adjTemperature: -0.28, adjSaturation: 0.05, adjContrast: 0.05 } },
  { key: 'warm', label: '暖调', patch: { adjTemperature: 0.26, adjSaturation: 0.08 } },
  { key: 'cinematic', label: '电影感', patch: { adjContrast: 0.22, adjSaturation: -0.1, adjTemperature: -0.06, adjExposure: -0.04 } },
  { key: 'fresh', label: '清新', patch: { adjBrightness: 0.08, adjSaturation: 0.2, adjTemperature: 0.05 } },
  { key: 'bw-hi', label: '高对比黑白', patch: { adjGrayscale: true, adjContrast: 0.3 } },
  { key: 'cyber', label: '赛博霓虹', patch: { adjSaturation: 0.5, adjContrast: 0.16, adjHue: 14 } },
  { key: 'soft-skin', label: '柔肤', patch: { adjSaturation: -0.06, adjBrightness: 0.06, adjSharpen: 0.18, adjTemperature: 0.06 } },
  { key: 'matte', label: '低饱哑光', patch: { adjSaturation: -0.2, adjContrast: -0.08, adjBrightness: 0.05 } },
  { key: 'vivid', label: '鲜艳浓郁', patch: { adjSaturation: 0.4, adjContrast: 0.18, adjSharpen: 0.25 } }
];

export interface CanvasProject {
  id: string;
  name: string;
  width: number;
  height: number;
  /** CSS color；'transparent' 表示透明 */
  background: string;
  layers: Layer[]; // 索引 0 = 最底层
  /** 主选中：兼容旧字段，渲染 Transformer 用 */
  selectedId: string | null;
  /** B1 多选：所有被选中的图层 id；总是包含 selectedId（如果非空） */
  selectedIds: string[];
  createdAt: string;
  updatedAt: string;
}

/** 创建一个默认空白工程 */
export function makeEmptyProject(): CanvasProject {
  const now = new Date().toISOString();
  return {
    id: cryptoRandomId(),
    name: '未命名画板',
    width: 1024,
    height: 1024,
    background: 'transparent',
    layers: [],
    selectedId: null,
    selectedIds: [],
    createdAt: now,
    updatedAt: now
  };
}

/** 创建一个文本图层 */
export function makeTextLayer(opts: {
  text: string;
  x: number;
  y: number;
  fontSize?: number;
  fillColor?: string;
}): Layer {
  return {
    id: cryptoRandomId(),
    name: opts.text.slice(0, 20) || '文本',
    sourcePath: null,
    cookedDataUri: null,
    width: 200,
    height: opts.fontSize ?? 32,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'source-over',
    x: opts.x,
    y: opts.y,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    skewX: 0,
    skewY: 0,
    perspective: null,
    crop: null,
    parentId: null,
    isText: true,
    text: opts.text,
    fontSize: opts.fontSize ?? 32,
    fontFamily: "'Inter', system-ui, sans-serif",
    fontWeight: 'normal',
    fontStyle: 'normal',
    align: 'left',
    fillColor: opts.fillColor ?? '#ffffffff'
  };
}

/** 创建矩形 / 椭圆形状 */
export function makeShapeLayer(opts: {
  kind: 'rect' | 'ellipse';
  x: number;
  y: number;
  width: number;
  height: number;
  fillColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
}): Layer {
  return {
    id: cryptoRandomId(),
    name: opts.kind === 'rect' ? '矩形' : '椭圆',
    sourcePath: null,
    cookedDataUri: null,
    width: opts.width,
    height: opts.height,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'source-over',
    x: opts.x,
    y: opts.y,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    skewX: 0,
    skewY: 0,
    perspective: null,
    crop: null,
    parentId: null,
    shapeKind: opts.kind,
    fillColor: opts.fillColor ?? '#fb923cff',
    strokeColor: opts.strokeColor ?? '',
    strokeWidth: opts.strokeWidth ?? 0
  };
}

/** 创建一个笔刷图层容器 */
export function makeBrushLayer(canvasWidth: number, canvasHeight: number, name = '笔刷'): Layer {
  return {
    id: cryptoRandomId(),
    name,
    sourcePath: null,
    cookedDataUri: null,
    width: canvasWidth,
    height: canvasHeight,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'source-over',
    x: 0,
    y: 0,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    skewX: 0,
    skewY: 0,
    perspective: null,
    crop: null,
    parentId: null,
    isGroup: false,
    isBrush: true,
    strokes: []
  };
}

/** 创建一个图层组容器 */
export function makeGroupLayer(name = '组'): Layer {
  return {
    id: cryptoRandomId(),
    name,
    sourcePath: null,
    cookedDataUri: null,
    width: 0,
    height: 0,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'source-over',
    x: 0,
    y: 0,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    skewX: 0,
    skewY: 0,
    perspective: null,
    crop: null,
    parentId: null,
    isGroup: true,
    collapsed: false
  };
}

/** 默认透视四角 = 原图四角 */
export function defaultPerspective(w: number, h: number): PerspectiveCorners {
  return {
    tl: [0, 0],
    tr: [w, 0],
    br: [w, h],
    bl: [0, h]
  };
}

export function cryptoRandomId(): string {
  // 浏览器原生 crypto.randomUUID 在 Electron 28 已支持
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'id-' + Math.random().toString(36).slice(2, 11);
}
