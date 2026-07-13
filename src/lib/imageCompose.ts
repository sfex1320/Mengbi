/**
 * 切分 / 对稿 用到的 canvas 图像操作（渲染端）：crossOrigin 安全加载 + 子矩形裁剪 + 按框 1:1 合成 + 问题框标注。
 * 统一用 crossOrigin='anonymous' 加载（mengbi-image:// 是 standard+secure 协议，配合它 canvas 不会被污染，
 * toDataURL/getImageData 不抛 SecurityError）——不要用 imageScale.loadImage（它不带 crossOrigin）。
 */
import { srcToUrl } from '@/lib/imageScale';
import type { ElementRect } from '@shared/smartCanvas';

export function loadImageCors(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = srcToUrl(src);
  });
}

type ImgFormat = 'png' | 'jpeg' | 'webp';
const mimeOf = (f: ImgFormat): string => (f === 'png' ? 'image/png' : `image/${f}`);

/** 识别用图的分辨率下限：vision 模型多按 512px tile 切图，图太小时小元素（小图标/小字/角标）直接被吃掉。 */
export const DETECT_MIN_EDGE = 1536;
/** 识别用图的分辨率上限：超大图 base64 过长，易被上游截断/拒收，且对框检测没有增益。 */
export const DETECT_MAX_EDGE = 3072;

/**
 * 识别用图预处理（切分/对稿的视觉检测调用前）：
 * - 最长边 <1536 → 等比放大到 1536（提高小元素检出率）；
 * - 最长边 >3072 → 等比缩小到 3072（防 base64 爆长）；
 * - 区间内 → scaledUri=null，调用方直接发原图字节（不重编码不损质量）。
 * 返回「实际发送尺寸 w/h + 源图尺寸 origW/origH」——坐标解析必须按发送尺寸做（模型若回像素坐标，参照系是
 * 它看到的那张图），再由 parseSegElementsScaled 等比换算回源图像素。
 */
export async function prepareDetectImage(
  src: string
): Promise<{ scaledUri: string | null; w: number; h: number; origW: number; origH: number }> {
  const img = await loadImageCors(src);
  const origW = Math.max(1, img.naturalWidth);
  const origH = Math.max(1, img.naturalHeight);
  const longest = Math.max(origW, origH);
  if (longest >= DETECT_MIN_EDGE && longest <= DETECT_MAX_EDGE) {
    return { scaledUri: null, w: origW, h: origH, origW, origH };
  }
  const k = (longest < DETECT_MIN_EDGE ? DETECT_MIN_EDGE : DETECT_MAX_EDGE) / longest;
  const w = Math.max(1, Math.round(origW * k));
  const h = Math.max(1, Math.round(origH * k));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) return { scaledUri: null, w: origW, h: origH, origW, origH };
  // JPEG 无透明通道：先铺白底（检测只看构图与元素，不需要 alpha），再高质量等比缩放
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  return { scaledUri: c.toDataURL('image/jpeg', 0.92), w, h, origW, origH };
}

/** 从已加载图里裁出一个子矩形（源图像素坐标）→ dataURI。 */
export function cropToDataUri(img: HTMLImageElement, box: ElementRect, format: ImgFormat = 'png'): string {
  const w = Math.max(1, Math.round(box.w));
  const h = Math.max(1, Math.round(box.h));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) return '';
  ctx.drawImage(img, box.x, box.y, box.w, box.h, 0, 0, w, h);
  return c.toDataURL(mimeOf(format));
}

/** 把多张元素图按各自的框 1:1 合成到 outW×outH 画布（先铺底图，再逐个覆盖到原位）。返回 dataURI。 */
export async function compositeAtBoxes(
  baseSrc: string | null,
  outW: number,
  outH: number,
  pieces: Array<{ src: string; box: ElementRect }>,
  format: ImgFormat = 'png'
): Promise<string> {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(outW));
  c.height = Math.max(1, Math.round(outH));
  const ctx = c.getContext('2d');
  if (!ctx) return '';
  if (baseSrc) {
    try {
      const base = await loadImageCors(baseSrc);
      ctx.drawImage(base, 0, 0, c.width, c.height);
    } catch {
      /* 没底图就透明底，只铺元素 */
    }
  }
  for (const p of pieces) {
    if (!p.src) continue;
    try {
      const im = await loadImageCors(p.src);
      ctx.drawImage(im, 0, 0, im.naturalWidth, im.naturalHeight, p.box.x, p.box.y, p.box.w, p.box.h);
    } catch {
      /* 跳过加载失败的元素，不中断合成 */
    }
  }
  return c.toDataURL(mimeOf(format));
}

/** 把问题框画在海报上 → 标注图 dataURI（对稿导出/输出用）。 */
export async function drawAnnotated(
  baseSrc: string,
  imgW: number,
  imgH: number,
  boxes: Array<{ box: ElementRect; color: string; label: string }>
): Promise<string> {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(imgW));
  c.height = Math.max(1, Math.round(imgH));
  const ctx = c.getContext('2d');
  if (!ctx) return '';
  try {
    const base = await loadImageCors(baseSrc);
    ctx.drawImage(base, 0, 0, c.width, c.height);
  } catch {
    return '';
  }
  const lw = Math.max(2, Math.round(Math.min(imgW, imgH) / 300));
  const fs = Math.max(12, Math.round(Math.min(imgW, imgH) / 42));
  ctx.lineWidth = lw;
  ctx.font = `bold ${fs}px sans-serif`;
  ctx.textBaseline = 'top';
  boxes.forEach((b, i) => {
    ctx.strokeStyle = b.color;
    ctx.strokeRect(b.box.x, b.box.y, b.box.w, b.box.h);
    const tag = `${i + 1}. ${b.label}`;
    const tw = ctx.measureText(tag).width + 10;
    const ty = Math.max(0, b.box.y - fs - 6);
    ctx.fillStyle = b.color;
    ctx.fillRect(b.box.x, ty, tw, fs + 6);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(tag, b.box.x + 5, ty + 3);
  });
  return c.toDataURL('image/png');
}
