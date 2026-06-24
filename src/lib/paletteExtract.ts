/**
 * 图片主配色提取：中位切分（median cut）量化。
 * quantizePixels 是纯函数（vitest 覆盖）；extractPaletteFromImage 用 createImageBitmap 把图直接缩到
 * 128×128 解码（巨图也绝不整张栅格化进内存），再取样统计。
 * 全程渲染端本地计算，零 IPC、零烧钱。
 */
import { rgbToHex } from './paletteColor';
import type { PaletteColorEntry } from '@shared/smartCanvas';

interface Box {
  /** 像素下标列表（指向采样数组，每像素 3 通道） */
  idx: number[];
}

/**
 * 对 RGBA 像素数组做中位切分量化，返回按占比降序的主色列表。
 * data: RGBA 连续数组（canvas getImageData().data 同构）；count: 目标色数 2-12。
 * 透明像素（alpha < 128）不参与统计。
 */
export function quantizePixels(data: Uint8ClampedArray | number[], count: number): PaletteColorEntry[] {
  const n = Math.max(2, Math.min(12, Math.round(count)));
  // 收集不透明像素（每像素存 r/g/b 三连）
  const px: number[] = [];
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    px.push(data[i], data[i + 1], data[i + 2]);
  }
  const total = px.length / 3;
  if (total === 0) return [];

  const allIdx: number[] = [];
  for (let i = 0; i < total; i++) allIdx.push(i);
  let boxes: Box[] = [{ idx: allIdx }];

  const channelRange = (box: Box): { ch: number; range: number } => {
    let best = 0;
    let bestRange = -1;
    for (let ch = 0; ch < 3; ch++) {
      let lo = 255;
      let hi = 0;
      for (const i of box.idx) {
        const v = px[i * 3 + ch];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      const range = hi - lo;
      if (range > bestRange) {
        bestRange = range;
        best = ch;
      }
    }
    return { ch: best, range: bestRange };
  };

  // 反复把「色彩跨度最大的箱」沿其最大通道按中位数劈成两半
  while (boxes.length < n) {
    let pick = -1;
    let pickRange = 0;
    let pickCh = 0;
    boxes.forEach((b, i) => {
      if (b.idx.length < 2) return;
      const { ch, range } = channelRange(b);
      // 用 跨度×像素数 加权，避免一直劈大箱里的微小差异
      const score = range * Math.sqrt(b.idx.length);
      if (range > 0 && score > pickRange) {
        pickRange = score;
        pick = i;
        pickCh = ch;
      }
    });
    if (pick < 0) break; // 所有箱都是纯色，劈不动了
    const box = boxes[pick];
    const sorted = [...box.idx].sort((a, b) => px[a * 3 + pickCh] - px[b * 3 + pickCh]);
    const mid = Math.floor(sorted.length / 2);
    // 按「中位值」切而不是按下标切：值相同的像素留在同一侧，避免两种纯色被切进同一箱混出浑浊色
    const medianVal = px[sorted[mid] * 3 + pickCh];
    let cut = sorted.findIndex((i) => px[i * 3 + pickCh] >= medianVal);
    if (cut <= 0 || cut >= sorted.length) cut = mid;
    boxes.splice(pick, 1, { idx: sorted.slice(0, cut) }, { idx: sorted.slice(cut) });
  }

  const out = boxes
    .filter((b) => b.idx.length > 0)
    .map((b) => {
      let r = 0;
      let g = 0;
      let bl = 0;
      for (const i of b.idx) {
        r += px[i * 3];
        g += px[i * 3 + 1];
        bl += px[i * 3 + 2];
      }
      const m = b.idx.length;
      return { hex: rgbToHex(r / m, g / m, bl / m), pct: (m / total) * 100 };
    })
    .sort((a, b) => b.pct - a.pct);

  // 合并量化后撞色的箱（极端图：纯色块劈出同色箱）
  const merged: PaletteColorEntry[] = [];
  for (const c of out) {
    const dup = merged.find((m) => m.hex === c.hex);
    if (dup) dup.pct = (dup.pct ?? 0) + (c.pct ?? 0);
    else merged.push({ ...c });
  }
  return merged;
}

/** 取样边长：配色只看颜色比例，128×128 足够，巨图也只解到这个尺寸。 */
const SAMPLE = 128;

/**
 * 从图片 URL（data: / mengbi-image:// / http）提取 count 个主色。
 *
 * 核心：用 `createImageBitmap(blob, { resizeWidth, resizeHeight })` 直接在解码阶段把图缩到
 * 128×128 —— 几万×几万的原图也**绝不会整张栅格化进内存**（这是之前 new Image() 解原图卡死的根因）。
 * 缩成正方不影响配色：均匀色块缩放后比例不变，主色占比保持。失败返回 []。
 *
 * @param url      取样用 URL（调用方应优先传缩略图 URL，data: 直接传）
 * @param count    目标色数
 * @param fallbackUrl 可选回退 URL（缩略图取样失败时再试一次，通常传原图 URL）
 */
export async function extractPaletteFromImage(url: string, count: number, fallbackUrl?: string): Promise<PaletteColorEntry[]> {
  const out = await sampleViaBitmap(url, count);
  if (out.length) return out;
  // 缩略图缺失 / 解码失败 → 用回退 URL（一般是原图）再试一次
  if (fallbackUrl && fallbackUrl !== url) {
    const out2 = await sampleViaBitmap(fallbackUrl, count);
    if (out2.length) return out2;
  }
  // 最后兜底：老的 new Image() + canvas 路径（createImageBitmap 不可用 / 抛错时）
  return sampleViaImageElement(fallbackUrl || url, count);
}

/** 用 createImageBitmap 缩解码 → 128² canvas → getImageData → 量化。8s 超时兜底。失败返回 []。 */
async function sampleViaBitmap(url: string, count: number): Promise<PaletteColorEntry[]> {
  if (typeof createImageBitmap !== 'function' || typeof fetch !== 'function') return [];
  let bmp: ImageBitmap | null = null;
  try {
    const blob = await withTimeout(fetch(url).then((r) => r.blob()), 8000);
    if (!blob || !blob.size) return [];
    bmp = await withTimeout(
      createImageBitmap(blob, { resizeWidth: SAMPLE, resizeHeight: SAMPLE, resizeQuality: 'high' }),
      8000
    );
    if (!bmp) return [];
    const canvas = document.createElement('canvas');
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return [];
    ctx.drawImage(bmp, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    return quantizePixels(data, count);
  } catch {
    return [];
  } finally {
    bmp?.close();
  }
}

/** 最后兜底：老 new Image() + canvas 缩到 ≤96px（createImageBitmap 不可用时；可能解原图，仅作保底）。 */
async function sampleViaImageElement(url: string, count: number): Promise<PaletteColorEntry[]> {
  const img = await loadImage(url);
  if (!img) return [];
  const w0 = img.naturalWidth;
  const h0 = img.naturalHeight;
  if (!w0 || !h0) return [];
  const scale = Math.min(1, 96 / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * scale));
  const h = Math.max(1, Math.round(h0 * scale));
  try {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return [];
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    return quantizePixels(data, count);
  } catch {
    return [];
  }
}

/** Promise 超时包装：超时返回 null（兜底防解码挂死）。 */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(null), ms);
    p.then(
      (v) => {
        window.clearTimeout(timer);
        resolve(v);
      },
      () => {
        window.clearTimeout(timer);
        resolve(null);
      }
    );
  });
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    const timer = window.setTimeout(() => resolve(null), 8000);
    img.onload = () => {
      window.clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      window.clearTimeout(timer);
      resolve(null);
    };
    img.src = url;
  });
}
