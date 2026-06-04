/**
 * 图片尺寸/缩放工具（renderer，纯 canvas）：供「缩放节点」与「比例分析节点」复用。
 * 不做高清化，只做几何缩放/分析。
 */
import type { ScaleMode } from '@shared/smartCanvas';
import { localPathToImageUrl } from './imageUrl';

/** 常用比例表（label, 宽高比数值），按对数距离吸附最近。 */
export const COMMON_ASPECTS: Array<[string, number]> = [
  ['1:1', 1],
  ['5:4', 5 / 4],
  ['4:5', 4 / 5],
  ['4:3', 4 / 3],
  ['3:4', 3 / 4],
  ['3:2', 3 / 2],
  ['2:3', 2 / 3],
  ['16:9', 16 / 9],
  ['9:16', 9 / 16],
  ['21:9', 21 / 9],
  ['2:1', 2],
  ['1:2', 1 / 2]
];

/** 最接近的常用比例。 */
export function nearestAspect(w: number, h: number): { label: string; value: number } {
  const ratio = w / h;
  let best = COMMON_ASPECTS[0];
  let bestD = Infinity;
  for (const a of COMMON_ASPECTS) {
    const dd = Math.abs(Math.log(ratio / a[1]));
    if (dd < bestD) {
      bestD = dd;
      best = a;
    }
  }
  return { label: best[0], value: best[1] };
}

/** 化简的精确比例（约分），如 1920×1280 → 3:2。 */
export function exactRatio(w: number, h: number): string {
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  const wi = Math.round(w);
  const hi = Math.round(h);
  const d = gcd(wi, hi) || 1;
  return `${wi / d}:${hi / d}`;
}

export function srcToUrl(src: string): string {
  return src.startsWith('data:') || src.startsWith('http') ? src : localPathToImageUrl(src);
}

/** 加载一张图为 HTMLImageElement（拿 naturalWidth/Height + 给 canvas 绘制）。 */
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image load failed'));
    img.src = srcToUrl(src);
  });
}

const MAX_EDGE = 8192; // 安全上限，防止误填超大尺寸把渲染进程拖死

export interface ScaleParams {
  mode: ScaleMode;
  factor: number;
  edge: number;
  fitW: number;
  fitH: number;
  megapixels: number;
  keepAspect: boolean;
  noUpscale: boolean;
}

/** 按模式算出目标像素尺寸（已 clamp / 取整）。 */
export function computeScaleTarget(p: ScaleParams, w: number, h: number): { w: number; h: number } {
  let tw = w;
  let th = h;
  const longest = Math.max(w, h);
  const shortest = Math.min(w, h);
  switch (p.mode) {
    case 'factor': {
      const f = clamp(p.factor || 1, 0.05, 8);
      tw = w * f;
      th = h * f;
      break;
    }
    case 'longest': {
      const s = (p.edge || longest) / longest;
      tw = w * s;
      th = h * s;
      break;
    }
    case 'shortest': {
      const s = (p.edge || shortest) / shortest;
      tw = w * s;
      th = h * s;
      break;
    }
    case 'width': {
      const s = (p.edge || w) / w;
      tw = p.edge || w;
      th = h * s;
      break;
    }
    case 'height': {
      const s = (p.edge || h) / h;
      tw = w * s;
      th = p.edge || h;
      break;
    }
    case 'fit': {
      const s = Math.min((p.fitW || w) / w, (p.fitH || h) / h);
      tw = w * s;
      th = h * s;
      break;
    }
    case 'pixels': {
      const target = Math.max(0.01, p.megapixels || 1) * 1_000_000;
      const s = Math.sqrt(target / Math.max(1, w * h));
      tw = w * s;
      th = h * s;
      break;
    }
    case 'exact': {
      if (p.keepAspect) {
        const s = Math.min((p.fitW || w) / w, (p.fitH || h) / h);
        tw = w * s;
        th = h * s;
      } else {
        tw = p.fitW || w;
        th = p.fitH || h;
      }
      break;
    }
  }
  // 仅缩小不放大
  if (p.noUpscale && (tw > w || th > h)) {
    const s = Math.min(w / tw, h / th);
    tw *= s;
    th *= s;
  }
  tw = clamp(Math.round(tw), 1, MAX_EDGE);
  th = clamp(Math.round(th), 1, MAX_EDGE);
  return { w: tw, h: th };
}

/** 把图缩放到目标尺寸 → dataURI（canvas drawImage）。 */
export function resizeToDataUri(
  img: HTMLImageElement,
  w: number,
  h: number,
  format: 'png' | 'jpeg' | 'webp'
): string {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  const mime = format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
  return canvas.toDataURL(mime, format === 'png' ? undefined : 0.92);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
