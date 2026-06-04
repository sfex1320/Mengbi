import { create } from 'zustand';
import {
  createMaskCanvas,
  resizeMaskCanvas,
  paintSegment,
  clearMask,
  fillMask,
  invertMask,
  recolorMask,
  blurMaskEdge,
  expandMask,
  contractMask,
  fillRectShape,
  fillEllipseShape,
  fillPolygonShape,
  type BrushOpts
} from '@/pages/Canvas/canvasEngine/maskEngine';

/** 蒙版/选区绘制形状：自由画笔 / 矩形 / 椭圆 / 套索 */
export type MaskShapeMode = 'brush' | 'rect' | 'ellipse' | 'lasso';

/**
 * 局部重绘蒙版的渲染端状态。
 *
 * 蒙版本体是一张画板对齐的 HTMLCanvasElement，**不持久化**（同 canvasStore 的
 * cookedDataUri 规则：MB 级栅格不进 localStorage）。重开画板蒙版会丢，需要用户先
 * 「导出黑白 PNG」留存或直接提交局部重绘。
 *
 * `version` 每次栅格变更自增，作为 React / Konva 重绘信号（canvas 对象本身引用不变）。
 */

interface InpaintMaskState {
  canvas: HTMLCanvasElement | null;
  version: number;
  /** 蒙版编辑模式（左侧工具切到「蒙版画笔」时为 true） */
  active: boolean;
  /** 蒙版笔触是涂抹(false)还是擦除(true) */
  eraseMode: boolean;
  /** 绘制形状：画笔 / 矩形 / 椭圆 / 套索（选区工具） */
  shapeMode: MaskShapeMode;
  /** 叠加层是否可见 */
  visible: boolean;
  // 画笔参数
  color: string;
  brushSize: number;
  hardness: number;
  brushOpacity: number;
  /** 叠加层整体透明度（仅影响显示，不影响导出强度） */
  maskOpacity: number;

  /** 确保蒙版画布存在且尺寸 = 画板；尺寸变了按 (offsetX,offsetY) 把旧内容贴进去 */
  ensureSize: (width: number, height: number, offsetX?: number, offsetY?: number) => void;
  /** 在已存在的画布上画一段笔触（坐标 = 画板坐标） */
  stroke: (x0: number, y0: number, x1: number, y1: number, erase: boolean) => void;
  /** 用一张现成画布替换（导入 PNG / 自动扩图蒙版用） */
  replaceCanvas: (c: HTMLCanvasElement) => void;
  /** 选区形状填充（坐标 = 画板坐标），erase 取当前 eraseMode */
  fillRect: (x: number, y: number, w: number, h: number) => void;
  fillEllipse: (cx: number, cy: number, rx: number, ry: number) => void;
  fillPolygon: (points: number[]) => void;

  clear: () => void;
  fill: () => void;
  invert: () => void;
  feather: (radius: number) => void;
  expand: (px: number) => void;
  contract: (px: number) => void;

  setActive: (b: boolean) => void;
  setEraseMode: (b: boolean) => void;
  setShapeMode: (m: MaskShapeMode) => void;
  setVisible: (b: boolean) => void;
  setColor: (c: string) => void;
  setBrushSize: (n: number) => void;
  setHardness: (n: number) => void;
  setBrushOpacity: (n: number) => void;
  setMaskOpacity: (n: number) => void;
  reset: () => void;
}

function bump(set: (fn: (s: InpaintMaskState) => Partial<InpaintMaskState>) => void): void {
  set((s) => ({ version: s.version + 1 }));
}

export const useInpaintMaskStore = create<InpaintMaskState>((set, get) => ({
  canvas: null,
  version: 0,
  active: false,
  eraseMode: false,
  shapeMode: 'brush',
  visible: true,
  color: '#fb5a3c',
  brushSize: 48,
  hardness: 0.85,
  brushOpacity: 1,
  maskOpacity: 0.5,

  ensureSize: (width, height, offsetX = 0, offsetY = 0) => {
    const cur = get().canvas;
    if (!cur) {
      set({ canvas: createMaskCanvas(width, height), version: get().version + 1 });
      return;
    }
    if (cur.width === width && cur.height === height && offsetX === 0 && offsetY === 0) return;
    const next = resizeMaskCanvas(cur, width, height, offsetX, offsetY);
    set({ canvas: next, version: get().version + 1 });
  },

  stroke: (x0, y0, x1, y1, erase) => {
    const s = get();
    if (!s.canvas) return;
    const opts: BrushOpts = {
      size: s.brushSize,
      hardness: s.hardness,
      color: s.color,
      opacity: s.brushOpacity,
      erase
    };
    paintSegment(s.canvas, x0, y0, x1, y1, opts);
    bump(set);
  },

  replaceCanvas: (c) => set((s) => ({ canvas: c, version: s.version + 1 })),

  fillRect: (x, y, w, h) => {
    const s = get();
    if (s.canvas) fillRectShape(s.canvas, x, y, w, h, s.color, s.eraseMode);
    bump(set);
  },
  fillEllipse: (cx, cy, rx, ry) => {
    const s = get();
    if (s.canvas) fillEllipseShape(s.canvas, cx, cy, rx, ry, s.color, s.eraseMode);
    bump(set);
  },
  fillPolygon: (points) => {
    const s = get();
    if (s.canvas) fillPolygonShape(s.canvas, points, s.color, s.eraseMode);
    bump(set);
  },

  clear: () => {
    const c = get().canvas;
    if (c) clearMask(c);
    bump(set);
  },
  fill: () => {
    const s = get();
    if (s.canvas) fillMask(s.canvas, s.color, 1);
    bump(set);
  },
  invert: () => {
    const s = get();
    if (s.canvas) invertMask(s.canvas, s.color);
    bump(set);
  },
  feather: (radius) => {
    const c = get().canvas;
    if (c) blurMaskEdge(c, radius);
    bump(set);
  },
  expand: (px) => {
    const c = get().canvas;
    if (c) expandMask(c, px);
    bump(set);
  },
  contract: (px) => {
    const s = get();
    if (s.canvas) contractMask(s.canvas, px, s.color);
    bump(set);
  },

  setActive: (b) => set({ active: b }),
  setEraseMode: (b) => set({ eraseMode: b }),
  setShapeMode: (m) => set({ shapeMode: m }),
  setVisible: (b) => set({ visible: b }),
  setColor: (color) => {
    const c = get().canvas;
    if (c) recolorMask(c, color);
    set((s) => ({ color, version: s.version + 1 }));
  },
  setBrushSize: (n) => set({ brushSize: Math.max(1, Math.min(800, Math.round(n))) }),
  setHardness: (n) => set({ hardness: Math.max(0, Math.min(1, n)) }),
  setBrushOpacity: (n) => set({ brushOpacity: Math.max(0.05, Math.min(1, n)) }),
  setMaskOpacity: (n) => set({ maskOpacity: Math.max(0.1, Math.min(1, n)) }),
  reset: () => set({ canvas: null, active: false, version: 0 })
}));
