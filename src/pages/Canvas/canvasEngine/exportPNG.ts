import type { CanvasProject, Layer, BrushStroke } from '../types';
import { layerDisplaySrc } from '@/store/canvasStore';
import { applyAdjustToImageData, adjustParamsFromLayer, hasAnyAdjust } from './adjust';

/**
 * 把整个 CanvasProject 离屏合成成一张 PNG Blob。
 *
 * 数据流：
 *   1. 创建 project.width × project.height 的离屏 canvas
 *   2. 按 layers 顺序遍历可见图层
 *   3. 对每个图层渲染：
 *      - 图像图层：image + 蒙版
 *      - 笔刷图层：strokes
 *   4. canvas.toBlob('image/png')
 */
export async function exportProjectAsPNG(project: CanvasProject): Promise<Blob> {
  const canvas = await renderLayersToCanvas(project, project.layers, true);
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('canvas.toBlob returned null'));
    }, 'image/png');
  });
}

/**
 * 把给定图层子集（按传入顺序）合成到一张画板尺寸的离屏 canvas。
 * withBackground=true 时绘制工程背景色（合并图层时传 false 以保持透明）。
 * 供导出 / 合并图层 / 发送到 PS 复用。
 */
export async function renderLayersToCanvas(
  project: CanvasProject,
  layers: Layer[],
  withBackground = false
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  canvas.width = project.width;
  canvas.height = project.height;
  const ctx = canvas.getContext('2d')!;

  if (withBackground && project.background && project.background !== 'transparent') {
    ctx.fillStyle = project.background;
    ctx.fillRect(0, 0, project.width, project.height);
  }

  for (const layer of layers) {
    if (!layer.visible) continue;
    if (layer.isGroup) continue;
    if (!isAncestorChainVisible(project.layers, layer)) continue;
    if (layer.isBrush) await drawBrushLayer(ctx, layer);
    else if (layer.isText) drawTextLayer(ctx, layer);
    else if (layer.shapeKind) drawShapeLayer(ctx, layer);
    else await drawImageLayer(ctx, layer);
  }
  return canvas;
}

function isAncestorChainVisible(layers: Layer[], l: Layer): boolean {
  let cur: Layer | undefined = l;
  while (cur) {
    if (!cur.visible) return false;
    if (!cur.parentId) break;
    cur = layers.find((x) => x.id === cur!.parentId);
  }
  return true;
}

async function drawImageLayer(ctx: CanvasRenderingContext2D, layer: Layer): Promise<void> {
  const src = layerDisplaySrc(layer);
  if (!src) return;
  const img = await loadImage(src);

  // 如果有蒙版：用一个临时 canvas 把图像 + 蒙版合成成单张图，再以变换贴到主 canvas
  let composed: HTMLCanvasElement | HTMLImageElement = img;
  if (layer.maskStrokes && layer.maskStrokes.length > 0) {
    composed = composeWithMask(img, layer);
  }

  // 调色 / 模糊：与画布预览保持一致（详见 canvasEngine/adjust.ts）
  const adjParams = adjustParamsFromLayer(layer);
  const adjBlur = layer.adjBlur ?? 0;
  if (hasAnyAdjust(adjParams) || adjBlur > 0) {
    composed = applyAdjustAndBlur(composed, adjParams, adjBlur);
  }

  ctx.save();
  ctx.globalAlpha = layer.opacity;
  ctx.globalCompositeOperation = layer.blendMode;
  ctx.translate(layer.x, layer.y);
  ctx.rotate(layer.rotation);
  ctx.scale(layer.scaleX, layer.scaleY);
  if (layer.skewX || layer.skewY) {
    ctx.transform(1, layer.skewY, layer.skewX, 1, 0, 0);
  }

  if (layer.crop) {
    ctx.drawImage(
      composed,
      layer.crop.x,
      layer.crop.y,
      layer.crop.width,
      layer.crop.height,
      0,
      0,
      layer.crop.width,
      layer.crop.height
    );
  } else {
    ctx.drawImage(composed, 0, 0);
  }
  ctx.restore();
}

/** 离屏应用调色 + 模糊，返回一张同尺寸 canvas（导出与预览算法一致） */
function applyAdjustAndBlur(
  source: HTMLCanvasElement | HTMLImageElement,
  params: ReturnType<typeof adjustParamsFromLayer>,
  blur: number
): HTMLCanvasElement {
  const w = source instanceof HTMLImageElement ? source.naturalWidth : source.width;
  const h = source instanceof HTMLImageElement ? source.naturalHeight : source.height;
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  const cx = c.getContext('2d')!;
  if (blur > 0) cx.filter = `blur(${blur}px)`;
  cx.drawImage(source, 0, 0, c.width, c.height);
  cx.filter = 'none';
  if (hasAnyAdjust(params)) {
    const data = cx.getImageData(0, 0, c.width, c.height);
    applyAdjustToImageData(data, params);
    cx.putImageData(data, 0, 0);
  }
  return c;
}

function composeWithMask(img: HTMLImageElement, layer: Layer): HTMLCanvasElement {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  // 蒙版描边按顺序应用
  for (const s of layer.maskStrokes ?? []) {
    drawStrokeOnContext(ctx, s, true);
  }
  return c;
}

function drawTextLayer(ctx: CanvasRenderingContext2D, layer: Layer): void {
  if (!layer.text) return;
  ctx.save();
  ctx.globalAlpha = layer.opacity;
  ctx.globalCompositeOperation = layer.blendMode;
  ctx.translate(layer.x, layer.y);
  ctx.rotate(layer.rotation);
  ctx.scale(layer.scaleX, layer.scaleY);
  const weight = layer.fontWeight === 'bold' ? 'bold' : 'normal';
  const style = layer.fontStyle === 'italic' ? 'italic' : 'normal';
  const fontSize = layer.fontSize ?? 32;
  ctx.font = `${style} ${weight} ${fontSize}px ${layer.fontFamily ?? 'Inter'}`;
  ctx.fillStyle = layer.fillColor ?? '#ffffffff';
  ctx.textBaseline = 'top';
  ctx.textAlign = layer.align ?? 'left';
  // 阴影
  if (layer.shadowColor) {
    ctx.shadowColor = layer.shadowColor;
    ctx.shadowBlur = layer.shadowBlur ?? 0;
    ctx.shadowOffsetX = layer.shadowOffsetX ?? 0;
    ctx.shadowOffsetY = layer.shadowOffsetY ?? 0;
  }
  const lines = (layer.text ?? '').split('\n');
  const lineHeight = fontSize * 1.2;
  const offsetX =
    layer.align === 'center' ? (layer.width || 200) / 2 : layer.align === 'right' ? layer.width || 200 : 0;
  const hasStroke = !!layer.strokeColor && (layer.strokeWidth ?? 0) > 0;
  for (let i = 0; i < lines.length; i++) {
    const y = i * lineHeight;
    if (hasStroke) {
      ctx.strokeStyle = layer.strokeColor as string;
      ctx.lineWidth = layer.strokeWidth as number;
      ctx.lineJoin = 'round';
      ctx.strokeText(lines[i], offsetX, y);
    }
    ctx.fillText(lines[i], offsetX, y);
    // 下划线（阴影只画一次，下划线时关掉避免重影）
    if (layer.textUnderline) {
      ctx.shadowColor = 'transparent';
      const tw = ctx.measureText(lines[i]).width;
      const ux = layer.align === 'center' ? offsetX - tw / 2 : layer.align === 'right' ? offsetX - tw : offsetX;
      ctx.fillRect(ux, y + fontSize * 1.05, tw, Math.max(1, fontSize * 0.06));
    }
  }
  ctx.restore();
}

function drawShapeLayer(ctx: CanvasRenderingContext2D, layer: Layer): void {
  ctx.save();
  ctx.globalAlpha = layer.opacity;
  ctx.globalCompositeOperation = layer.blendMode;
  ctx.translate(layer.x, layer.y);
  ctx.rotate(layer.rotation);
  ctx.scale(layer.scaleX, layer.scaleY);
  if (layer.fillColor) {
    ctx.fillStyle = layer.fillColor;
    if (layer.shapeKind === 'rect') {
      ctx.fillRect(0, 0, layer.width, layer.height);
    } else {
      ctx.beginPath();
      ctx.ellipse(layer.width / 2, layer.height / 2, layer.width / 2, layer.height / 2, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (layer.strokeColor && (layer.strokeWidth ?? 0) > 0) {
    ctx.strokeStyle = layer.strokeColor;
    ctx.lineWidth = layer.strokeWidth ?? 0;
    if (layer.shapeKind === 'rect') {
      ctx.strokeRect(0, 0, layer.width, layer.height);
    } else {
      ctx.beginPath();
      ctx.ellipse(layer.width / 2, layer.height / 2, layer.width / 2, layer.height / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.restore();
}

async function drawBrushLayer(ctx: CanvasRenderingContext2D, layer: Layer): Promise<void> {
  // 笔刷图层：先在临时 canvas 绘制 strokes，再以 transform 贴到主 canvas
  const w = Math.max(1, layer.width);
  const h = Math.max(1, layer.height);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const sctx = c.getContext('2d')!;
  for (const s of layer.strokes ?? []) {
    drawStrokeOnContext(sctx, s, false);
  }

  ctx.save();
  ctx.globalAlpha = layer.opacity;
  ctx.globalCompositeOperation = layer.blendMode;
  ctx.translate(layer.x, layer.y);
  ctx.rotate(layer.rotation);
  ctx.scale(layer.scaleX, layer.scaleY);
  ctx.drawImage(c, 0, 0);
  ctx.restore();
}

function drawStrokeOnContext(ctx: CanvasRenderingContext2D, s: BrushStroke, asMask: boolean): void {
  if (s.points.length < 2) return;
  ctx.save();
  if (asMask) {
    // 蒙版语义：erase = destination-out（隐藏图像）；paint = 原色画上去（在已有 erase 区域上还原视觉）
    ctx.globalCompositeOperation = s.tool === 'erase' ? 'destination-out' : 'source-over';
    ctx.strokeStyle = s.tool === 'erase' ? 'rgba(0,0,0,1)' : 'rgba(255,255,255,1)';
  } else {
    ctx.globalCompositeOperation = s.tool === 'erase' ? 'destination-out' : 'source-over';
    ctx.strokeStyle = s.color;
  }
  ctx.globalAlpha = s.opacity;
  ctx.lineWidth = s.size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(s.points[0], s.points[1]);
  for (let i = 2; i < s.points.length; i += 2) {
    ctx.lineTo(s.points[i], s.points[i + 1]);
  }
  ctx.stroke();
  ctx.restore();
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load: ${src}`));
    img.src = src;
  });
}

/** 把 Blob 转成 dataUri（用于跨页面传图） */
export function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
