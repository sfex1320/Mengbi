import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { useSmartCanvasStore } from '@/store/smartCanvasStore';
import type { SmartNodeData } from '@shared/smartCanvas';
import { srcToUrl } from '@/lib/imageScale';
import { paintSegment, createMaskCanvas, clearMask, maskHasCoverage, maskToEditAlphaPng, maskToVisualRedPng, makeOutpaintMask } from '@/pages/Canvas/canvasEngine/maskEngine';
import { blobToDataUri } from '@/pages/Canvas/canvasEngine/exportPNG';
import { applyAdjustToImageData, hasAnyAdjust, type AdjustParams } from '@/pages/Canvas/canvasEngine/adjust';
import { useSettingsStore } from '@/store/settingsStore';
import { listMappedModels } from '@/lib/modelMapping';
import { extractJsonBlock } from '@/lib/jsonPrompt';
import { toast } from '@/store/toastStore';

/** 把中文编辑指令解析成结构化编辑动作（参数类编辑：扩图/调色/裁切比例/画笔；空间区域类仍需手动指点）。 */
const EDIT_CMD_SYSTEM = [
  '你是图片编辑指令解析器。把用户的中文编辑指令解析成一个 JSON 指令对象，只输出 JSON，不要解释、不要代码围栏。',
  '可用字段（都可选，只填指令涉及的）：',
  '- tool: "brush"|"eraser"|"mask"|"crop"|"outpaint"|"adjust"（要切换到的工具）',
  '- outpaint: {top,right,bottom,left（各方向扩展像素，整数）, fill:"transparent"|"color", color:"#RRGGBB", feather（羽化像素 0-200）}',
  '- adjust: {brightness,contrast,saturation,exposure,temperature（均为 -100..100 整数）, grayscale:布尔, invert:布尔}',
  '- crop: {ratio:"1:1"|"4:3"|"3:4"|"16:9"|"9:16"|"3:2"|"2:3"|"free"}',
  '- brush: {color:"#RRGGBB", size（像素 2-300）}',
  '示例：「向四周各扩100像素，白色填充，羽化20」→ {"tool":"outpaint","outpaint":{"top":100,"right":100,"bottom":100,"left":100,"fill":"color","color":"#ffffff","feather":20}}',
  '示例：「调亮一点，提高对比度」→ {"tool":"adjust","adjust":{"brightness":25,"contrast":20}}',
  '示例：「裁成16:9」→ {"tool":"crop","crop":{"ratio":"16:9"}}',
  '示例：「画笔换成红色，粗一点」→ {"tool":"brush","brush":{"color":"#ff0000","size":60}}'
].join('\n');

function clampNum(v: unknown, lo: number, hi: number, dflt: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

/** 图片编辑器开关：哪个图片节点在编辑（nodeId=null 不显示）+ 初始图源。 */
interface ImageEditorState {
  nodeId: string | null;
  src: string | null;
  open: (nodeId: string, src: string) => void;
  close: () => void;
}
export const useImageEditorStore = create<ImageEditorState>((set) => ({
  nodeId: null,
  src: null,
  open: (nodeId, src) => set({ nodeId, src }),
  close: () => set({ nodeId: null, src: null })
}));

type Tool = 'brush' | 'eraser' | 'mask' | 'mark' | 'crop' | 'outpaint' | 'adjust';
const HISTORY_CAP = 12;
const MAX_EDIT_SIZE = 8192;

const BLANK_ADJUST: AdjustParams = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  hue: 0,
  temperature: 0,
  exposure: 0,
  sharpen: 0,
  denoise: 0,
  grayscale: false,
  invert: false
};

function cloneCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  c.getContext('2d')?.drawImage(src, 0, 0);
  return c;
}

/** 透明区棋盘格底。 */
function drawChecker(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const cell = 10;
  for (let y = 0; y < h; y += cell) {
    for (let x = 0; x < w; x += cell) {
      ctx.fillStyle = ((x / cell + y / cell) & 1) === 0 ? '#3a3a42' : '#2a2a30';
      ctx.fillRect(x, y, cell, cell);
    }
  }
}

type Sides = { top: boolean; right: boolean; bottom: boolean; left: boolean };

/** 在已绘好图像的画布上，对「有扩展的方向」边缘做羽化淡出（destination-out 渐变），用于扩图接缝过渡。 */
function featherEdges(ctx: CanvasRenderingContext2D, w: number, h: number, f: number, sides: Sides): void {
  if (f <= 0) return;
  const ff = Math.max(1, Math.min(f, Math.floor(Math.min(w, h) / 2)));
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  const fade = (x0: number, y0: number, x1: number, y1: number, rx: number, ry: number, rw: number, rh: number): void => {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(rx, ry, rw, rh);
  };
  if (sides.left) fade(0, 0, ff, 0, 0, 0, ff, h);
  if (sides.right) fade(w, 0, w - ff, 0, w - ff, 0, ff, h);
  if (sides.top) fade(0, 0, 0, ff, 0, 0, w, ff);
  if (sides.bottom) fade(0, h, 0, h - ff, 0, h - ff, w, ff);
  ctx.restore();
}

/**
 * 加载图片并设 crossOrigin='anonymous'——本地 mengbi-image:// 协议图若不设此项，
 * 绘到 canvas 会污染（tainted），后续 toDataURL 保存会抛 SecurityError。
 * 与 /canvas 的 exportPNG.loadImage 同款（已验证可导出本地图）。
 */
function loadImageCors(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image load failed'));
    img.src = srcToUrl(src);
  });
}

/**
 * 图片节点的就地编辑器（自带 HTML5 canvas，单图层，复用 /canvas 的纯笔触 / 调色引擎）：
 * 画笔 / 橡皮 / 蒙版抠图 / 裁切 / 扩图 / 调色 + 撤销重做（快照栈）+ 重置 + 保存回节点。
 * 性能：图片只解码一次进 workCanvas，所有编辑就地改 workCanvas；调色预览只在小视图上算。
 */
export function ImageEditorModal(): JSX.Element | null {
  const nodeId = useImageEditorStore((s) => s.nodeId);
  const src = useImageEditorStore((s) => s.src);
  const close = useImageEditorStore((s) => s.close);
  const update = useSmartCanvasStore((s) => s.updateNodeData);

  const viewRef = useRef<HTMLCanvasElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  /** 编辑器打开时的 src（首次保存时作为 originalSrc 写入；用于「重置回最初状态」） */
  const openSrcRef = useRef<string | null>(null);
  const workRef = useRef<HTMLCanvasElement | null>(null);
  const maskRef = useRef<HTMLCanvasElement | null>(null);
  const historyRef = useRef<HTMLCanvasElement[]>([]);
  const histIdxRef = useRef(0);
  const drawingRef = useRef(false);
  const lastPtRef = useRef<{ x: number; y: number } | null>(null);
  const cropRef = useRef<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const boxRef = useRef({ w: 900, h: 600 });

  const [ready, setReady] = useState(false);
  const [version, setVersion] = useState(0); // 触发按钮态/尺寸文案刷新
  const [tool, setTool] = useState<Tool>('brush');
  const [brushSize, setBrushSize] = useState(36);
  const [brushHardness, setBrushHardness] = useState(0.85);
  const [brushOpacity, setBrushOpacity] = useState(1);
  const [brushColor, setBrushColor] = useState('#ffffff');
  const [adjust, setAdjust] = useState<AdjustParams>(BLANK_ADJUST);
  // 扩图：四边各自的扩展像素 + 填充形式 + 羽化
  const [outPad, setOutPad] = useState({ top: 128, right: 128, bottom: 128, left: 128 });
  const [outFill, setOutFill] = useState<'transparent' | 'color'>('transparent');
  const [outColor, setOutColor] = useState('#ffffff');
  const [outFeather, setOutFeather] = useState(24);
  const outPadRef = useRef(outPad);
  outPadRef.current = outPad;
  const outDragRef = useRef<{ side: 'top' | 'right' | 'bottom' | 'left'; start: number; startPad: number; scale: number } | null>(null);
  // 裁切比例锁（null = 自由）
  const [cropRatio, setCropRatio] = useState<number | null>(null);
  const cropRatioRef = useRef<number | null>(null);
  cropRatioRef.current = cropRatio;
  // 标记（序号 / 文字 / 手写）：标注画到图片上，传给下游让模型按标记的位置/序号/文字精确编辑
  const [markMode, setMarkMode] = useState<'number' | 'text' | 'pen'>('number');
  const [markColor, setMarkColor] = useState('#ef4444');
  const [markSize, setMarkSize] = useState(30);
  const [markNext, setMarkNext] = useState(1);
  const [textDraft, setTextDraft] = useState<{ wx: number; wy: number; left: number; top: number; value: string } | null>(null);
  // 画笔光标圈（跟随鼠标显示笔刷实际大小）
  const cursorRef = useRef<HTMLDivElement | null>(null);
  // AI 指令（自然语言 → 参数类编辑）
  const [aiCmd, setAiCmd] = useState('');
  const [aiBusy, setAiBusy] = useState(false);

  const bump = (): void => setVersion((v) => v + 1);

  function computeBox(): void {
    boxRef.current = {
      w: Math.max(360, Math.min(window.innerWidth * 0.6, 1040)),
      h: Math.max(280, Math.min(window.innerHeight * 0.62, 660))
    };
  }

  function resizeMask(): void {
    const w = workRef.current;
    if (!w) return;
    const m = maskRef.current;
    if (!m) {
      maskRef.current = createMaskCanvas(w.width, w.height);
      return;
    }
    m.width = w.width;
    m.height = w.height;
    m.getContext('2d')?.clearRect(0, 0, m.width, m.height);
  }

  /** 扩图预览几何：扩展后画布尺寸、显示缩放、图像在预览里的位置。拖动中用固定缩放避免跳动。 */
  function outGeom(): { nw: number; nh: number; scale: number; fw: number; fh: number; ox: number; oy: number; ow: number; oh: number } | null {
    const work = workRef.current;
    const box = boxRef.current;
    if (!work) return null;
    const pad = outPadRef.current;
    const nw = work.width + pad.left + pad.right;
    const nh = work.height + pad.top + pad.bottom;
    const scale = outDragRef.current ? outDragRef.current.scale : Math.min(box.w / nw, box.h / nh);
    return {
      nw,
      nh,
      scale,
      fw: Math.max(1, Math.round(nw * scale)),
      fh: Math.max(1, Math.round(nh * scale)),
      ox: Math.round(pad.left * scale),
      oy: Math.round(pad.top * scale),
      ow: Math.max(1, Math.round(work.width * scale)),
      oh: Math.max(1, Math.round(work.height * scale))
    };
  }

  /** 扩图实时预览：扩展画布 + 填充（透明棋盘/颜色）+ 图像（含羽化）+ 接缝虚线 + 四边拖拽手柄。 */
  function drawOutpaintPreview(view: HTMLCanvasElement, work: HTMLCanvasElement): void {
    const g = outGeom();
    if (!g) return;
    if (view.width !== g.fw) view.width = g.fw;
    if (view.height !== g.fh) view.height = g.fh;
    const ctx = view.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, g.fw, g.fh);
    if (outFill === 'color') {
      ctx.fillStyle = outColor;
      ctx.fillRect(0, 0, g.fw, g.fh);
    } else {
      drawChecker(ctx, g.fw, g.fh);
    }
    const pad = outPadRef.current;
    const sides: Sides = { left: pad.left > 0, right: pad.right > 0, top: pad.top > 0, bottom: pad.bottom > 0 };
    if (outFeather > 0 && (sides.left || sides.right || sides.top || sides.bottom)) {
      const tmp = document.createElement('canvas');
      tmp.width = g.ow;
      tmp.height = g.oh;
      const tc = tmp.getContext('2d');
      if (tc) {
        tc.drawImage(work, 0, 0, g.ow, g.oh);
        featherEdges(tc, g.ow, g.oh, outFeather * g.scale, sides);
        ctx.drawImage(tmp, g.ox, g.oy);
      }
    } else {
      ctx.drawImage(work, g.ox, g.oy, g.ow, g.oh);
    }
    // 接缝（原图边界）
    ctx.save();
    ctx.strokeStyle = '#fb923c';
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1.4;
    ctx.strokeRect(g.ox + 0.5, g.oy + 0.5, Math.max(0, g.ow - 1), Math.max(0, g.oh - 1));
    ctx.restore();
    // 四边拖拽手柄（外边缘中点的短条）
    ctx.save();
    ctx.fillStyle = '#fb923c';
    const hw = 30;
    const ht = 5;
    ctx.fillRect(g.fw / 2 - hw / 2, 0, hw, ht); // 上
    ctx.fillRect(g.fw / 2 - hw / 2, g.fh - ht, hw, ht); // 下
    ctx.fillRect(0, g.fh / 2 - hw / 2, ht, hw); // 左
    ctx.fillRect(g.fw - ht, g.fh / 2 - hw / 2, ht, hw); // 右
    ctx.restore();
  }

  function redraw(): void {
    const view = viewRef.current;
    const work = workRef.current;
    if (!view || !work) return;
    if (tool === 'outpaint') {
      drawOutpaintPreview(view, work);
      return;
    }
    const box = boxRef.current;
    const scale = Math.min(box.w / work.width, box.h / work.height);
    const fw = Math.max(1, Math.round(work.width * scale));
    const fh = Math.max(1, Math.round(work.height * scale));
    if (view.width !== fw) view.width = fw;
    if (view.height !== fh) view.height = fh;
    const ctx = view.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, fw, fh);
    drawChecker(ctx, fw, fh);
    if (hasAnyAdjust(adjust)) {
      const tmp = document.createElement('canvas');
      tmp.width = fw;
      tmp.height = fh;
      const tctx = tmp.getContext('2d');
      if (tctx) {
        tctx.drawImage(work, 0, 0, fw, fh);
        const data = tctx.getImageData(0, 0, fw, fh);
        applyAdjustToImageData(data, adjust);
        tctx.putImageData(data, 0, 0);
        ctx.drawImage(tmp, 0, 0);
      }
    } else {
      ctx.drawImage(work, 0, 0, fw, fh);
    }
    // 蒙版叠加
    if (tool === 'mask' && maskRef.current) {
      ctx.save();
      ctx.globalAlpha = 0.45;
      ctx.drawImage(maskRef.current, 0, 0, fw, fh);
      ctx.restore();
    }
    // 裁切框：先快照「已渲染的基图（含调色 + 棋盘格）」，盖暗罩，再把保留区从快照盖回来（保真含调色）
    if (tool === 'crop' && cropRef.current) {
      const r = cropRef.current;
      const ix = Math.round(Math.max(0, Math.min(fw, Math.min(r.x0, r.x1) * scale)));
      const iy = Math.round(Math.max(0, Math.min(fh, Math.min(r.y0, r.y1) * scale)));
      const iw = Math.round(Math.min(fw - ix, Math.abs(r.x1 - r.x0) * scale));
      const ih = Math.round(Math.min(fh - iy, Math.abs(r.y1 - r.y0) * scale));
      const base = ctx.getImageData(0, 0, fw, fh);
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, 0, fw, fh);
      if (iw > 0 && ih > 0) ctx.putImageData(base, 0, 0, ix, iy, iw, ih);
      ctx.restore();
      ctx.strokeStyle = '#fb923c';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(ix + 0.5, iy + 0.5, Math.max(0, iw - 1), Math.max(0, ih - 1));
    }
  }

  function pushHistory(): void {
    const work = workRef.current;
    if (!work) return;
    let h = historyRef.current.slice(0, histIdxRef.current + 1);
    h.push(cloneCanvas(work));
    if (h.length > HISTORY_CAP) h = h.slice(h.length - HISTORY_CAP);
    historyRef.current = h;
    histIdxRef.current = h.length - 1;
    bump();
  }

  function restoreFromHistory(): void {
    const snap = historyRef.current[histIdxRef.current];
    const work = workRef.current;
    if (!snap || !work) return;
    work.width = snap.width;
    work.height = snap.height;
    const ctx = work.getContext('2d');
    ctx?.clearRect(0, 0, work.width, work.height);
    ctx?.drawImage(snap, 0, 0);
    resizeMask();
    setAdjust(BLANK_ADJUST);
    redraw();
    bump();
  }

  function setWork(c: HTMLCanvasElement): void {
    workRef.current = c;
    resizeMask();
  }

  // ── 加载图片（只一次）──
  useEffect(() => {
    if (!nodeId || !src) return;
    let alive = true;
    computeBox();
    setReady(false);
    openSrcRef.current = src;
    // 最初始图片：节点上记过 originalSrc 就用它作「重置」基准（即使中途保存过多次也回到最初）；
    // 没记过则当前 src 即最初。工作画布始终从当前 src 开始（继续上次编辑结果）。
    const node = useSmartCanvasStore.getState().nodes.find((n) => n.id === nodeId);
    const originalSrc = (node?.data as unknown as { originalSrc?: string } | undefined)?.originalSrc;
    loadImageCors(src)
      .then((img) => {
        if (!alive) return;
        imgRef.current = img;
        const c = document.createElement('canvas');
        c.width = img.naturalWidth || img.width;
        c.height = img.naturalHeight || img.height;
        c.getContext('2d')?.drawImage(img, 0, 0);
        workRef.current = c;
        maskRef.current = createMaskCanvas(c.width, c.height);
        historyRef.current = [cloneCanvas(c)];
        histIdxRef.current = 0;
        setAdjust(BLANK_ADJUST);
        cropRef.current = null;
        setTool('brush');
        setReady(true);
        bump();
        // 若存在与当前 src 不同的最初始图，异步加载作为「重置」基准（失败回退当前图）
        if (originalSrc && originalSrc !== src) {
          loadImageCors(originalSrc)
            .then((oimg) => {
              if (alive) imgRef.current = oimg;
            })
            .catch(() => {
              /* 最初图加载失败：退回当前图作重置基准 */
            });
        }
      })
      .catch(() => {
        toast.error('图片加载失败');
        close();
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId, src]);

  // 卸载时释放（关闭后）
  useEffect(() => {
    if (nodeId) return;
    imgRef.current = null;
    workRef.current = null;
    maskRef.current = null;
    historyRef.current = [];
  }, [nodeId]);

  // ready / 工具 / 调色 / 扩图参数 变化后重绘
  useEffect(() => {
    if (ready) redraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, tool, adjust, version, outPad, outFill, outColor, outFeather]);

  // 窗口尺寸变化 → 重算视图盒
  useEffect(() => {
    if (!nodeId) return;
    const onResize = (): void => {
      computeBox();
      redraw();
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId]);

  // Esc 关闭
  useEffect(() => {
    if (!nodeId) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close();
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId]);

  if (!nodeId) return null;

  function toWork(e: React.PointerEvent): { x: number; y: number } {
    const view = viewRef.current;
    const work = workRef.current;
    if (!view || !work) return { x: 0, y: 0 };
    // 用 getBoundingClientRect（渲染尺寸）归一化 → 乘以 work 全分辨率：与 CSS 缩放无关，恒正确。
    // clamp 防 pointer capture 给出画布外的坐标（拖到边缘外时落在边缘）。
    const rect = view.getBoundingClientRect();
    const sx = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const sy = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    return { x: sx * work.width, y: sy * work.height };
  }

  function brushOptsFor(): { size: number; hardness: number; color: string; opacity: number; erase: boolean } {
    if (tool === 'eraser') return { size: brushSize, hardness: 1, color: '#000000', opacity: 1, erase: true };
    if (tool === 'mask') return { size: brushSize, hardness: 0.9, color: '#fb923c', opacity: 1, erase: false };
    return { size: brushSize, hardness: brushHardness, color: brushColor, opacity: brushOpacity, erase: false };
  }

  /** 标记 · 序号：在 (wx,wy) 画一个带数字的实心圆（白描边），数字递增。直接烧进 workCanvas。 */
  function stampNumber(wx: number, wy: number): void {
    const work = workRef.current;
    const ctx = work?.getContext('2d');
    if (!work || !ctx) return;
    const r = markSize;
    ctx.save();
    ctx.lineWidth = Math.max(2, r * 0.12);
    ctx.fillStyle = markColor;
    ctx.strokeStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(wx, wy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${Math.round(r * 1.15)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(markNext), wx, wy);
    ctx.restore();
    setMarkNext((n) => n + 1);
    pushHistory();
    redraw();
  }

  /** 标记 · 文字：在 (wx,wy) 画一段带白描边的文字（任意底色都清晰）。直接烧进 workCanvas。 */
  function drawTextAt(wx: number, wy: number, text: string): void {
    const work = workRef.current;
    const ctx = work?.getContext('2d');
    if (!work || !ctx || !text.trim()) return;
    ctx.save();
    ctx.font = `bold ${Math.round(markSize * 1.5)}px system-ui, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(2.5, markSize * 0.18);
    ctx.strokeStyle = '#ffffff';
    ctx.strokeText(text, wx, wy);
    ctx.fillStyle = markColor;
    ctx.fillText(text, wx, wy);
    ctx.restore();
    pushHistory();
    redraw();
  }

  /** 提交文字输入框（回车 / 失焦 / 切换工具时）：非空则画到图上。 */
  function commitTextDraft(): void {
    const d = textDraft;
    setTextDraft(null);
    if (d && d.value.trim()) drawTextAt(d.wx, d.wy, d.value.trim());
  }

  /** 标记 · 手写 的画笔参数（实色硬边线，区别于带羽化的普通画笔）。 */
  function markPenOpts(): { size: number; hardness: number; color: string; opacity: number; erase: boolean } {
    return { size: markSize, hardness: 1, color: markColor, opacity: 1, erase: false };
  }

  /** 画笔光标圈：跟随鼠标显示笔刷实际大小（画笔/橡皮/蒙版 + 标记的序号/手写 才显示）。 */
  function moveCursorRing(e: React.PointerEvent): void {
    const ring = cursorRef.current;
    const view = viewRef.current;
    const work = workRef.current;
    if (!ring || !view || !work) return;
    const markRing = tool === 'mark' && (markMode === 'number' || markMode === 'pen');
    if (tool !== 'brush' && tool !== 'eraser' && tool !== 'mask' && !markRing) {
      ring.style.display = 'none';
      return;
    }
    const ringSize = tool === 'mark' ? (markMode === 'number' ? markSize * 2 : markSize) : brushSize;
    const rect = view.getBoundingClientRect();
    const d = Math.max(4, ringSize * (rect.width / work.width));
    ring.style.display = 'block';
    ring.style.width = `${d}px`;
    ring.style.height = `${d}px`;
    // 用舞台（ring 的定位父级）局部坐标定位：clientX/Y 减去舞台左上角。
    // 不依赖 position:fixed —— 弹窗若有祖先 transform/contain，fixed 会相对该祖先而非视口，导致圈与光标错位。
    const stage = ring.parentElement;
    const srect = stage ? stage.getBoundingClientRect() : ({ left: 0, top: 0 } as DOMRect);
    ring.style.left = `${e.clientX - srect.left}px`;
    ring.style.top = `${e.clientY - srect.top}px`;
  }

  function hideCursorRing(): void {
    if (cursorRef.current) cursorRef.current.style.display = 'none';
  }

  function onPointerDown(e: React.PointerEvent): void {
    if (!ready) return;
    if (tool === 'outpaint') {
      const view = viewRef.current;
      if (!view) return;
      const rect = view.getBoundingClientRect();
      const px = ((e.clientX - rect.left) / rect.width) * view.width;
      const py = ((e.clientY - rect.top) / rect.height) * view.height;
      const T = 18;
      let side: 'top' | 'right' | 'bottom' | 'left' | null = null;
      if (px <= T) side = 'left';
      else if (px >= view.width - T) side = 'right';
      else if (py <= T) side = 'top';
      else if (py >= view.height - T) side = 'bottom';
      if (side) {
        const g = outGeom();
        const startScreen = side === 'left' || side === 'right' ? e.clientX : e.clientY;
        outDragRef.current = { side, start: startScreen, startPad: outPadRef.current[side], scale: g ? g.scale : 1 };
        drawingRef.current = true;
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      }
      return;
    }
    const p = toWork(e);
    if (tool === 'crop') {
      cropRef.current = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
      drawingRef.current = true;
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      redraw();
      return;
    }
    if (tool === 'mark') {
      if (markMode === 'number') {
        stampNumber(p.x, p.y);
      } else if (markMode === 'pen') {
        drawingRef.current = true;
        lastPtRef.current = p;
        if (workRef.current) paintSegment(workRef.current, p.x, p.y, p.x, p.y, markPenOpts());
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        redraw();
      } else {
        // 文字：先把上一个未确认的文字落下，再在新位置开输入框
        if (textDraft && textDraft.value.trim()) drawTextAt(textDraft.wx, textDraft.wy, textDraft.value.trim());
        const stage = cursorRef.current?.parentElement;
        const srect = stage ? stage.getBoundingClientRect() : ({ left: 0, top: 0 } as DOMRect);
        setTextDraft({ wx: p.x, wy: p.y, left: e.clientX - srect.left, top: e.clientY - srect.top, value: '' });
      }
      return;
    }
    if (tool === 'brush' || tool === 'eraser' || tool === 'mask') {
      drawingRef.current = true;
      lastPtRef.current = p;
      const target = tool === 'mask' ? maskRef.current : workRef.current;
      if (target) paintSegment(target, p.x, p.y, p.x, p.y, brushOptsFor());
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      redraw();
    }
  }

  function onPointerMove(e: React.PointerEvent): void {
    moveCursorRing(e);
    if (!drawingRef.current) return;
    if (tool === 'outpaint' && outDragRef.current) {
      const view = viewRef.current;
      if (!view) return;
      const d = outDragRef.current;
      const rect = view.getBoundingClientRect();
      const viewPerScreen = view.width / rect.width; // 预览像素 / 屏幕像素
      let deltaScreen = 0;
      if (d.side === 'left') deltaScreen = d.start - e.clientX;
      else if (d.side === 'right') deltaScreen = e.clientX - d.start;
      else if (d.side === 'top') deltaScreen = d.start - e.clientY;
      else deltaScreen = e.clientY - d.start;
      const deltaWork = (deltaScreen * viewPerScreen) / d.scale;
      const next = Math.round(Math.max(0, Math.min(MAX_EDIT_SIZE / 2, d.startPad + deltaWork)));
      setOutPad((pad) => ({ ...pad, [d.side]: next }));
      return;
    }
    const p = toWork(e);
    if (tool === 'crop' && cropRef.current) {
      let x1 = p.x;
      let y1 = p.y;
      const ratio = cropRatioRef.current;
      if (ratio) {
        // 锁定比例：宽度跟手，高度按比例算（保留拖动方向符号）
        const c = cropRef.current;
        const dw = x1 - c.x0;
        const signY = y1 - c.y0 < 0 ? -1 : 1;
        y1 = c.y0 + (signY * Math.abs(dw)) / ratio;
      }
      cropRef.current = { ...cropRef.current, x1, y1 };
      redraw();
      return;
    }
    if (tool === 'mark' && markMode === 'pen') {
      const last = lastPtRef.current ?? p;
      if (workRef.current) paintSegment(workRef.current, last.x, last.y, p.x, p.y, markPenOpts());
      lastPtRef.current = p;
      redraw();
      return;
    }
    if (tool === 'brush' || tool === 'eraser' || tool === 'mask') {
      const last = lastPtRef.current ?? p;
      const target = tool === 'mask' ? maskRef.current : workRef.current;
      if (target) paintSegment(target, last.x, last.y, p.x, p.y, brushOptsFor());
      lastPtRef.current = p;
      redraw();
    }
  }

  function onPointerUp(): void {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    lastPtRef.current = null;
    if (outDragRef.current) {
      outDragRef.current = null;
      redraw();
      return;
    }
    if (tool === 'brush' || tool === 'eraser' || (tool === 'mark' && markMode === 'pen')) pushHistory();
    // mask / crop 不在此进栈（应用时才改 work）
  }

  function applyMask(mode: 'remove' | 'keep'): void {
    const mask = maskRef.current;
    const work = workRef.current;
    if (!mask || !work) return;
    if (!maskHasCoverage(mask)) {
      toast.info('先用蒙版画笔涂出要处理的区域');
      return;
    }
    const ctx = work.getContext('2d');
    if (!ctx) return;
    ctx.save();
    ctx.globalCompositeOperation = mode === 'remove' ? 'destination-out' : 'destination-in';
    ctx.drawImage(mask, 0, 0);
    ctx.restore();
    clearMask(mask);
    clearStoredMask(); // 抠图改了像素，旧的局部重绘遮罩作废
    pushHistory();
    redraw();
  }

  /** 清除节点上已存的局部重绘遮罩（改像素/尺寸的破坏性编辑后调用，避免遮罩与底图错位） */
  function clearStoredMask(): void {
    if (nodeId)
      update(nodeId, {
        inpaintMaskSrc: undefined,
        maskOverlaySrc: undefined,
        outpaintPad: undefined
      } as Partial<SmartNodeData>);
  }

  /** 把当前涂的蒙版「设为局部重绘遮罩」存到图片节点（不改像素）：下游生图节点据此走 /v1/images/edits 重绘 */
  async function setInpaintMaskFromBrush(): Promise<void> {
    const mask = maskRef.current;
    if (!mask || !nodeId) return;
    if (!maskHasCoverage(mask)) {
      toast.info('先用蒙版画笔涂出要重绘的区域');
      return;
    }
    try {
      const uri = await blobToDataUri(await maskToEditAlphaPng(mask));
      const overlay = await blobToDataUri(await maskToVisualRedPng(mask));
      // 画笔蒙版不是扩图 → 同时存红色可视层、清掉扩边标签
      update(nodeId, {
        inpaintMaskSrc: uri,
        maskOverlaySrc: overlay,
        outpaintPad: undefined
      } as Partial<SmartNodeData>);
      toast.success('已设为局部重绘遮罩', '连「图片 + 提示词」到生图节点，运行即按遮罩重画');
    } catch (e) {
      toast.error('设置遮罩失败', String(e));
    }
  }

  /** AI 扩图：扩画布（新区透明）+ 生成「新区=编辑区」遮罩，一并写回节点 → 下游生图填充新区 */
  async function applyOutpaintAI(): Promise<void> {
    const work = workRef.current;
    if (!work || !nodeId) return;
    const left = Math.max(0, Math.round(outPad.left));
    const right = Math.max(0, Math.round(outPad.right));
    const top = Math.max(0, Math.round(outPad.top));
    const bottom = Math.max(0, Math.round(outPad.bottom));
    if (left + right + top + bottom === 0) {
      toast.info('给至少一个方向设扩展像素');
      return;
    }
    const nw = work.width + left + right;
    const nh = work.height + top + bottom;
    if (nw > MAX_EDIT_SIZE || nh > MAX_EDIT_SIZE) {
      toast.error('扩图后超过 8192px 上限', '减小扩展像素');
      return;
    }
    try {
      // 扩后底图：新区强制透明（让模型补全），原图放在 (left, top)
      const expanded = document.createElement('canvas');
      expanded.width = nw;
      expanded.height = nh;
      expanded.getContext('2d')!.drawImage(work, left, top);
      const baseUri = expanded.toDataURL('image/png');
      // 边缘遮罩：新区=编辑区、原图区=保留（透明=编辑区，与 OpenAI 约定一致）
      const maskCanvas = makeOutpaintMask(nw, nh, { x: left, y: top, w: work.width, h: work.height }, '#ffffff');
      const maskUri = await blobToDataUri(await maskToEditAlphaPng(maskCanvas));
      const overlayUri = await blobToDataUri(await maskToVisualRedPng(maskCanvas));
      // src 与 mask 同尺寸一并写回节点；记下各边扩展像素供节点显示「扩了多少边」。
      // 同时把扩图前的「最初始图」存进 originalSrc（节点上「重置遮罩」据此还原原图原尺寸）。
      const node = useSmartCanvasStore.getState().nodes.find((n) => n.id === nodeId);
      const existingOriginal = (node?.data as unknown as { originalSrc?: string } | undefined)?.originalSrc;
      update(nodeId, {
        src: baseUri,
        inpaintMaskSrc: maskUri,
        maskOverlaySrc: overlayUri,
        outpaintPad: { top, right, bottom, left },
        naturalW: nw,
        naturalH: nh,
        ...(!existingOriginal && openSrcRef.current ? { originalSrc: openSrcRef.current } : {})
      } as Partial<SmartNodeData>);
      setWork(expanded); // 编辑器视图同步到扩后画布
      setTool('brush');
      pushHistory();
      redraw();
      toast.success('已扩图（交 AI 填充）', '连「提示词」到生图节点，运行即把新区域补全');
    } catch (e) {
      toast.error('AI 扩图失败', String(e));
    }
  }

  function applyCrop(): void {
    const r = cropRef.current;
    const work = workRef.current;
    if (!r || !work) {
      toast.info('先在图上拖出裁切框');
      return;
    }
    const x = Math.round(Math.max(0, Math.min(r.x0, r.x1)));
    const y = Math.round(Math.max(0, Math.min(r.y0, r.y1)));
    const w = Math.round(Math.min(work.width - x, Math.abs(r.x1 - r.x0)));
    const h = Math.round(Math.min(work.height - y, Math.abs(r.y1 - r.y0)));
    if (w < 4 || h < 4) {
      toast.info('裁切区域太小');
      return;
    }
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d')?.drawImage(work, -x, -y);
    setWork(c);
    clearStoredMask(); // 裁切改了尺寸，旧的局部重绘遮罩作废
    cropRef.current = null;
    pushHistory();
    redraw();
  }

  function applyOutpaint(): void {
    const work = workRef.current;
    if (!work) return;
    const left = Math.max(0, Math.round(outPad.left));
    const right = Math.max(0, Math.round(outPad.right));
    const top = Math.max(0, Math.round(outPad.top));
    const bottom = Math.max(0, Math.round(outPad.bottom));
    if (left + right + top + bottom === 0) {
      toast.info('给至少一个方向设扩展像素');
      return;
    }
    const nw = work.width + left + right;
    const nh = work.height + top + bottom;
    if (nw > MAX_EDIT_SIZE || nh > MAX_EDIT_SIZE) {
      toast.error('扩图后超过 8192px 上限', '减小扩展像素');
      return;
    }
    const c = document.createElement('canvas');
    c.width = nw;
    c.height = nh;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    if (outFill === 'color') {
      ctx.fillStyle = outColor;
      ctx.fillRect(0, 0, nw, nh);
    }
    const sides: Sides = { left: left > 0, right: right > 0, top: top > 0, bottom: bottom > 0 };
    if (outFeather > 0) {
      const tmp = document.createElement('canvas');
      tmp.width = work.width;
      tmp.height = work.height;
      const tc = tmp.getContext('2d');
      if (tc) {
        tc.drawImage(work, 0, 0);
        featherEdges(tc, work.width, work.height, outFeather, sides);
        ctx.drawImage(tmp, left, top);
      }
    } else {
      ctx.drawImage(work, left, top);
    }
    setWork(c);
    clearStoredMask(); // 本地扩图改了尺寸，旧的局部重绘遮罩作废
    setTool('brush'); // 应用后退出扩图预览，回到正常视图
    pushHistory();
    redraw();
    toast.success('已扩图', outFill === 'color' ? '新区域已填充颜色' : '新区域透明，可用画笔或连下游生图填充');
  }

  function bakeAdjust(): void {
    const work = workRef.current;
    if (!work || !hasAnyAdjust(adjust)) return;
    const ctx = work.getContext('2d');
    if (!ctx) return;
    const data = ctx.getImageData(0, 0, work.width, work.height);
    applyAdjustToImageData(data, adjust);
    ctx.putImageData(data, 0, 0);
    setAdjust(BLANK_ADJUST);
    pushHistory();
    redraw();
  }

  /** AI 指令 → 参数类编辑（扩图/调色/裁切比例/画笔）。空间区域类（蒙版/擦除/裁某块）仍需手动指点。 */
  async function runAiCommand(): Promise<void> {
    const cmd = aiCmd.trim();
    if (!cmd) return;
    const { configs, activePlanId } = useSettingsStore.getState();
    if (activePlanId == null) {
      toast.error('没有激活的方案', '去设置页选择 / 新建方案');
      return;
    }
    const models = listMappedModels(configs, activePlanId, 'text').filter((m) => m.usable);
    if (!models.length) {
      toast.error('当前方案没有可用对话模型', '去设置页配置一个对话模型');
      return;
    }
    setAiBusy(true);
    const r = await window.electronAPI.chat.optimizePrompt({
      planId: activePlanId,
      modelId: models[0].name,
      userInput: cmd,
      systemPrompt: EDIT_CMD_SYSTEM
    });
    setAiBusy(false);
    if (!r.ok || !r.data.optimizedBy) {
      toast.error('指令解析失败', (r.ok ? r.data.reason : r.error.message) || '换个说法或换模型');
      return;
    }
    let spec: Record<string, unknown>;
    try {
      spec = JSON.parse(extractJsonBlock(r.data.optimized)) as Record<string, unknown>;
    } catch {
      toast.error('指令解析失败', '模型没返回有效的编辑指令，换个说法试试');
      return;
    }
    applyEditSpec(spec);
  }

  function applyEditSpec(spec: Record<string, unknown>): void {
    const applied: string[] = [];
    const adj = spec.adjust as Record<string, unknown> | undefined;
    if (adj && typeof adj === 'object') {
      setAdjust((a) => ({
        ...a,
        brightness: adj.brightness != null ? clampNum(adj.brightness, -100, 100, 0) / 100 : a.brightness,
        contrast: adj.contrast != null ? clampNum(adj.contrast, -100, 100, 0) / 100 : a.contrast,
        saturation: adj.saturation != null ? clampNum(adj.saturation, -100, 100, 0) / 100 : a.saturation,
        exposure: adj.exposure != null ? clampNum(adj.exposure, -100, 100, 0) / 100 : a.exposure,
        temperature: adj.temperature != null ? clampNum(adj.temperature, -100, 100, 0) / 100 : a.temperature,
        grayscale: typeof adj.grayscale === 'boolean' ? adj.grayscale : a.grayscale,
        invert: typeof adj.invert === 'boolean' ? adj.invert : a.invert
      }));
      setTool('adjust');
      applied.push('调色（点「应用调色」生效）');
    }
    const op = spec.outpaint as Record<string, unknown> | undefined;
    if (op && typeof op === 'object') {
      setOutPad((p) => ({
        top: op.top != null ? clampNum(op.top, 0, MAX_EDIT_SIZE / 2, p.top) : p.top,
        right: op.right != null ? clampNum(op.right, 0, MAX_EDIT_SIZE / 2, p.right) : p.right,
        bottom: op.bottom != null ? clampNum(op.bottom, 0, MAX_EDIT_SIZE / 2, p.bottom) : p.bottom,
        left: op.left != null ? clampNum(op.left, 0, MAX_EDIT_SIZE / 2, p.left) : p.left
      }));
      if (op.fill === 'color' || op.fill === 'transparent') setOutFill(op.fill);
      if (typeof op.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(op.color)) setOutColor(op.color);
      if (op.feather != null) setOutFeather(clampNum(op.feather, 0, 200, 24));
      setTool('outpaint');
      applied.push('扩图（点「应用扩图」生效）');
    }
    const cr = spec.crop as Record<string, unknown> | undefined;
    if (cr && typeof cr.ratio === 'string') {
      const hit = CROP_RATIOS.find((c) => c.label === cr.ratio);
      if (cr.ratio === 'free') setCropRatio(null);
      else if (hit) setCropRatio(hit.v);
      setTool('crop');
      applied.push('裁切比例（在图上拖框后点「应用裁切」）');
    }
    const br = spec.brush as Record<string, unknown> | undefined;
    if (br && typeof br === 'object') {
      if (typeof br.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(br.color)) setBrushColor(br.color);
      if (br.size != null) setBrushSize(clampNum(br.size, 2, 300, 36));
      setTool('brush');
      applied.push('画笔（在图上涂画）');
    } else if (typeof spec.tool === 'string' && ['brush', 'eraser', 'mask', 'mark', 'crop', 'outpaint', 'adjust'].includes(spec.tool)) {
      setTool(spec.tool as Tool);
    }
    if (applied.length) {
      toast.success('已应用 AI 指令', applied.join(' / '));
      setAiCmd('');
    } else {
      toast.info('未识别到可执行的参数编辑', '涂某块/擦某块/裁某块这类需要手动在图上指点');
    }
  }

  function undo(): void {
    if (histIdxRef.current <= 0) return;
    histIdxRef.current -= 1;
    restoreFromHistory();
  }
  function redo(): void {
    if (histIdxRef.current >= historyRef.current.length - 1) return;
    histIdxRef.current += 1;
    restoreFromHistory();
  }

  function reset(): void {
    const img = imgRef.current;
    const work = workRef.current;
    if (!img || !work) return;
    work.width = img.naturalWidth || img.width;
    work.height = img.naturalHeight || img.height;
    const ctx = work.getContext('2d');
    ctx?.clearRect(0, 0, work.width, work.height);
    ctx?.drawImage(img, 0, 0);
    resizeMask();
    historyRef.current = [cloneCanvas(work)];
    histIdxRef.current = 0;
    setAdjust(BLANK_ADJUST);
    cropRef.current = null;
    redraw();
    bump();
    toast.info('已重置为初始图片');
  }

  function save(): void {
    const work = workRef.current;
    if (!work || !nodeId) return;
    // 保存前把未应用的调色烘焙进去
    if (hasAnyAdjust(adjust)) {
      const ctx = work.getContext('2d');
      if (ctx) {
        const data = ctx.getImageData(0, 0, work.width, work.height);
        applyAdjustToImageData(data, adjust);
        ctx.putImageData(data, 0, 0);
      }
    }
    const uri = work.toDataURL('image/png');
    // 首次保存时把「打开时的 src」记为最初始图（供「重置」回到最初状态）；已记过则不覆盖
    const node = useSmartCanvasStore.getState().nodes.find((n) => n.id === nodeId);
    const existingOriginal = (node?.data as unknown as { originalSrc?: string } | undefined)?.originalSrc;
    const patch = { src: uri, naturalW: work.width, naturalH: work.height } as Partial<SmartNodeData> & { originalSrc?: string };
    if (!existingOriginal && openSrcRef.current) patch.originalSrc = openSrcRef.current;
    update(nodeId, patch);
    close();
    toast.success('已保存到图片节点');
  }

  const canUndo = histIdxRef.current > 0;
  const canRedo = histIdxRef.current < historyRef.current.length - 1;
  const work = workRef.current;
  const isPaintTool = tool === 'brush' || tool === 'eraser' || tool === 'mask';
  const canvasInteractive = isPaintTool || tool === 'crop' || tool === 'outpaint' || tool === 'mark';
  const CROP_RATIOS: Array<{ label: string; v: number | null }> = [
    { label: '自由', v: null },
    { label: '1:1', v: 1 },
    { label: '4:3', v: 4 / 3 },
    { label: '3:4', v: 3 / 4 },
    { label: '16:9', v: 16 / 9 },
    { label: '9:16', v: 9 / 16 },
    { label: '3:2', v: 3 / 2 },
    { label: '2:3', v: 2 / 3 }
  ];

  const TOOLS: Array<{ k: Tool; label: string; icon: string }> = [
    { k: 'brush', label: '画笔', icon: '🖌️' },
    { k: 'eraser', label: '橡皮', icon: '🧽' },
    { k: 'mask', label: '蒙版', icon: '⬛' },
    { k: 'mark', label: '标记', icon: '🔖' },
    { k: 'crop', label: '裁切', icon: '✂️' },
    { k: 'outpaint', label: '扩图', icon: '⤢' },
    { k: 'adjust', label: '调色', icon: '🎚️' }
  ];
  const markRingCursor = tool === 'mark' && (markMode === 'number' || markMode === 'pen');

  return createPortal(
    <div className="mb-modal-backdrop mb-sc-imgedit-back" onMouseDown={close}>
      <div className="mb-sc-imgedit mb-card" role="dialog" aria-label="图片编辑" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-sc-imgedit-head">
          <h3>图片编辑</h3>
          <span className="mb-sc-imgedit-dim">{work ? `${work.width}×${work.height}` : ''}</span>
          <div className="mb-sc-imgedit-headact">
            <button className="mb-btn mb-btn-sm mb-btn-ghost" disabled={!canUndo} onClick={undo} title="撤销 (Ctrl+Z)">
              ↶ 撤销
            </button>
            <button className="mb-btn mb-btn-sm mb-btn-ghost" disabled={!canRedo} onClick={redo} title="重做 (Ctrl+Shift+Z)">
              ↷ 重做
            </button>
            <button className="mb-btn mb-btn-sm mb-btn-ghost" onClick={reset} title="重置为初始图片">
              重置
            </button>
            <span className="mb-sc-imgedit-sep" />
            <button className="mb-btn mb-btn-sm mb-btn-ghost" onClick={close}>
              取消
            </button>
            <button className="mb-btn mb-btn-sm mb-btn-primary" onClick={save}>
              保存
            </button>
          </div>
        </div>

        <div className="mb-sc-imgedit-aibar">
          <span className="mb-sc-imgedit-ailabel">🤖 AI 指令</span>
          <input
            className="mb-input mb-sc-imgedit-aiinput"
            placeholder="用一句话描述编辑，如：向四周各扩100px白色填充羽化20 / 调亮提高对比度 / 裁成16:9 / 画笔换红色"
            value={aiCmd}
            onChange={(e) => setAiCmd(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void runAiCommand();
            }}
          />
          <button className="mb-btn mb-btn-sm mb-btn-secondary" onClick={() => void runAiCommand()} disabled={aiBusy || !aiCmd.trim()}>
            {aiBusy ? '解析中…' : '执行'}
          </button>
          <span className="mb-sc-imgedit-aihint" title="涂某块/擦某块/裁某块这类需要在图上手动指点；AI 指令负责参数类编辑（扩图/调色/裁切比例/画笔）">
            ⓘ 参数类编辑
          </span>
        </div>

        <div className="mb-sc-imgedit-body">
          <div className="mb-sc-imgedit-tools">
            {TOOLS.map((t) => (
              <button
                key={t.k}
                className={`mb-sc-imgedit-tool ${tool === t.k ? 'is-active' : ''}`}
                onClick={() => {
                  if (maskRef.current && t.k !== 'mask') clearMask(maskRef.current);
                  if (t.k !== 'crop') cropRef.current = null;
                  if (t.k !== 'mark') commitTextDraft(); // 切走标记工具前把未确认文字落下
                  setTool(t.k);
                }}
                title={t.label}
              >
                <span className="mb-sc-imgedit-toolico">{t.icon}</span>
                <span>{t.label}</span>
              </button>
            ))}
          </div>

          <div className="mb-sc-imgedit-stage">
            {ready ? (
              <canvas
                ref={viewRef}
                className={`mb-sc-imgedit-canvas ${isPaintTool || markRingCursor ? 'is-paint' : canvasInteractive ? 'is-draw' : ''}`}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerEnter={moveCursorRing}
                onPointerLeave={() => {
                  onPointerUp();
                  hideCursorRing();
                }}
              />
            ) : (
              <div className="mb-sc-empty">加载中…</div>
            )}
            <div ref={cursorRef} className="mb-sc-imgedit-brushring" style={{ display: 'none' }} />
            {textDraft && (
              <input
                className="mb-input mb-sc-imgedit-textinput"
                autoFocus
                style={{ left: textDraft.left, top: textDraft.top }}
                value={textDraft.value}
                placeholder="输入文字后回车"
                onChange={(e) => setTextDraft((d) => (d ? { ...d, value: e.target.value } : d))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitTextDraft();
                  else if (e.key === 'Escape') setTextDraft(null);
                }}
                onBlur={commitTextDraft}
              />
            )}
          </div>

          <div className="mb-sc-imgedit-opts">
            {(tool === 'brush' || tool === 'eraser' || tool === 'mask') && (
              <>
                <Slider label="笔刷大小" value={brushSize} min={2} max={300} step={1} onChange={setBrushSize} suffix="px" />
                {tool === 'brush' && (
                  <>
                    <Slider label="硬度" value={Math.round(brushHardness * 100)} min={0} max={100} step={1} onChange={(v) => setBrushHardness(v / 100)} suffix="%" />
                    <Slider label="不透明度" value={Math.round(brushOpacity * 100)} min={5} max={100} step={1} onChange={(v) => setBrushOpacity(v / 100)} suffix="%" />
                    <label className="mb-sc-imgedit-colorrow">
                      <span>颜色</span>
                      <input type="color" value={brushColor} onChange={(e) => setBrushColor(e.target.value)} />
                    </label>
                  </>
                )}
                {tool === 'mask' && (
                  <div className="mb-sc-imgedit-maskact">
                    <div className="mb-sc-imgedit-hint">用画笔涂出区域，再选操作：</div>
                    <button className="mb-btn mb-btn-sm mb-btn-primary" onClick={setInpaintMaskFromBrush}>设为局部重绘遮罩（AI）</button>
                    <div className="mb-sc-imgedit-hint">涂的区域交给下游生图节点按提示词重画（连「图片 + 提示词」到生图节点运行）</div>
                    <div className="mb-sc-imgedit-slabel" style={{ marginTop: 4 }}>或本地抠图</div>
                    <button className="mb-btn mb-btn-sm" onClick={() => applyMask('remove')}>删除选区（变透明）</button>
                    <button className="mb-btn mb-btn-sm" onClick={() => applyMask('keep')}>抠出选区（去背景）</button>
                    <button className="mb-btn mb-btn-sm mb-btn-ghost" onClick={() => { if (maskRef.current) { clearMask(maskRef.current); redraw(); } }}>清空选区</button>
                  </div>
                )}
              </>
            )}

            {tool === 'mark' && (
              <div className="mb-sc-imgedit-markact">
                <div className="mb-sc-imgedit-slabel">标记方式</div>
                <div className="mb-sc-imgedit-markmode">
                  {([['number', '① 序号'], ['text', 'T 文字'], ['pen', '✎ 手写']] as Array<['number' | 'text' | 'pen', string]>).map(([m, label]) => (
                    <button key={m} className={`mb-sc-imgedit-markbtn ${markMode === m ? 'is-on' : ''}`} onClick={() => setMarkMode(m)}>
                      {label}
                    </button>
                  ))}
                </div>
                <Slider label="标记大小" value={markSize} min={8} max={140} step={1} onChange={setMarkSize} suffix="px" />
                <label className="mb-sc-imgedit-colorrow">
                  <span>颜色</span>
                  <input type="color" value={markColor} onChange={(e) => setMarkColor(e.target.value)} />
                </label>
                {markMode === 'number' && (
                  <div className="mb-sc-imgedit-marknum">
                    <span>下一个序号：{markNext}</span>
                    <button className="mb-btn mb-btn-sm mb-btn-ghost" onClick={() => setMarkNext(1)}>重置序号</button>
                  </div>
                )}
                <div className="mb-sc-imgedit-hint">
                  {markMode === 'number'
                    ? '点击图片放置递增序号 ①②③…（标注要处理的对象顺序）'
                    : markMode === 'text'
                      ? '点击图片放置文字，输入后回车确认（写编辑要求 / 命名）'
                      : '按住拖动在图上手写标注 / 圈画'}
                </div>
                <div className="mb-sc-imgedit-hint">
                  标记会画进图片。保存后把本图片节点连到下游生图节点 + 提示词（如「按图上标记的序号/文字处理」），让模型按标记精确编辑。
                </div>
              </div>
            )}

            {tool === 'crop' && (
              <div className="mb-sc-imgedit-cropact">
                <div className="mb-sc-imgedit-hint">先选比例（可锁定），再在图上拖出要保留的区域。</div>
                <div className="mb-sc-imgedit-slabel" style={{ marginBottom: 2 }}>裁切比例</div>
                <div className="mb-sc-imgedit-ratios">
                  {CROP_RATIOS.map((r) => (
                    <button
                      key={r.label}
                      className={`mb-sc-imgedit-ratio ${cropRatio === r.v ? 'is-on' : ''}`}
                      onClick={() => setCropRatio(r.v)}
                      title={r.v ? `锁定 ${r.label}，再拖动调整范围` : '自由裁切'}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
                {cropRatio != null && <div className="mb-sc-imgedit-hint">已锁定比例：拖动时高度按比例自动跟随。</div>}
                <button className="mb-btn mb-btn-sm mb-btn-primary" onClick={applyCrop}>应用裁切</button>
                <button className="mb-btn mb-btn-sm mb-btn-ghost" onClick={() => { cropRef.current = null; redraw(); }}>取消框选</button>
              </div>
            )}

            {tool === 'outpaint' && (
              <div className="mb-sc-imgedit-outact">
                <div className="mb-sc-imgedit-hint">四边各自设扩展像素，或在预览图上拖动四边的橙色手柄。实时预览。</div>
                <div className="mb-sc-imgedit-padgrid">
                  {(['top', 'right', 'bottom', 'left'] as const).map((s) => (
                    <label key={s} className="mb-sc-imgedit-padcell">
                      <span>{{ top: '上', right: '右', bottom: '下', left: '左' }[s]}</span>
                      <input
                        type="number"
                        min={0}
                        max={MAX_EDIT_SIZE / 2}
                        value={outPad[s]}
                        onFocus={(e) => e.currentTarget.select()}
                        onChange={(e) => {
                          const v = Math.max(0, Math.min(MAX_EDIT_SIZE / 2, Math.round(Number(e.target.value) || 0)));
                          setOutPad((p) => ({ ...p, [s]: v }));
                        }}
                      />
                    </label>
                  ))}
                </div>
                <div className="mb-sc-imgedit-outrow">
                  <button className="mb-btn mb-btn-sm mb-btn-ghost" onClick={() => setOutPad({ top: 128, right: 128, bottom: 128, left: 128 })}>四边相同(128)</button>
                  <button className="mb-btn mb-btn-sm mb-btn-ghost" onClick={() => setOutPad({ top: 0, right: 0, bottom: 0, left: 0 })}>清零</button>
                </div>
                <div className="mb-sc-imgedit-slabel" style={{ marginTop: 4 }}>填充形式</div>
                <div className="mb-sc-imgedit-fillrow">
                  <button className={`mb-sc-imgedit-ratio ${outFill === 'transparent' ? 'is-on' : ''}`} onClick={() => setOutFill('transparent')}>透明</button>
                  <button className={`mb-sc-imgedit-ratio ${outFill === 'color' ? 'is-on' : ''}`} onClick={() => setOutFill('color')}>颜色</button>
                  {outFill === 'color' && <input type="color" value={outColor} onChange={(e) => setOutColor(e.target.value)} />}
                </div>
                <Slider label="羽化" value={outFeather} min={0} max={200} step={1} onChange={setOutFeather} suffix="px" />
                <button className="mb-btn mb-btn-sm" onClick={applyOutpaint}>本地扩图（透明/颜色）</button>
                <button className="mb-btn mb-btn-sm mb-btn-primary" onClick={applyOutpaintAI}>扩图并交 AI 填充</button>
                <div className="mb-sc-imgedit-hint">AI 填充：新区透明 + 自动生成边缘遮罩 → 连「提示词」到生图节点，运行即把新区域补全</div>
              </div>
            )}

            {tool === 'adjust' && (
              <div className="mb-sc-imgedit-adj">
                <Slider label="亮度" value={Math.round(adjust.brightness * 100)} min={-100} max={100} step={1} onChange={(v) => setAdjust((a) => ({ ...a, brightness: v / 100 }))} />
                <Slider label="对比度" value={Math.round(adjust.contrast * 100)} min={-100} max={100} step={1} onChange={(v) => setAdjust((a) => ({ ...a, contrast: v / 100 }))} />
                <Slider label="饱和度" value={Math.round(adjust.saturation * 100)} min={-100} max={100} step={1} onChange={(v) => setAdjust((a) => ({ ...a, saturation: v / 100 }))} />
                <Slider label="曝光" value={Math.round(adjust.exposure * 100)} min={-100} max={100} step={1} onChange={(v) => setAdjust((a) => ({ ...a, exposure: v / 100 }))} />
                <Slider label="色温" value={Math.round(adjust.temperature * 100)} min={-100} max={100} step={1} onChange={(v) => setAdjust((a) => ({ ...a, temperature: v / 100 }))} />
                <div className="mb-sc-imgedit-toggles">
                  <button className={`mb-btn mb-btn-sm ${adjust.grayscale ? 'mb-btn-primary' : 'mb-btn-ghost'}`} onClick={() => setAdjust((a) => ({ ...a, grayscale: !a.grayscale }))}>黑白</button>
                  <button className={`mb-btn mb-btn-sm ${adjust.invert ? 'mb-btn-primary' : 'mb-btn-ghost'}`} onClick={() => setAdjust((a) => ({ ...a, invert: !a.invert }))}>反色</button>
                </div>
                <div className="mb-sc-imgedit-adjact">
                  <button className="mb-btn mb-btn-sm mb-btn-primary" onClick={bakeAdjust} disabled={!hasAnyAdjust(adjust)}>应用调色</button>
                  <button className="mb-btn mb-btn-sm mb-btn-ghost" onClick={() => setAdjust(BLANK_ADJUST)}>复位</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  suffix
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  suffix?: string;
}): JSX.Element {
  return (
    <label className="mb-sc-imgedit-slider">
      <span className="mb-sc-imgedit-slabel">
        {label}
        <em>{value}{suffix ?? ''}</em>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}
