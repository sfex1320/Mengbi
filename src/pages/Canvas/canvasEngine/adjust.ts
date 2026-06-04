/**
 * 图像调整核心（亮度 / 对比度 / 饱和度 / 色相 / 色温 / 曝光 / 锐化 / 降噪 / 黑白 / 反色）。
 *
 * 同一份像素算法被两处复用：
 *   - 画布实时预览：包成一个 Konva 自定义滤镜（读 node 上的 mb* attr）
 *   - 导出 / 合并：直接对离屏 ImageData 调用 applyAdjustToImageData
 *
 * 模糊（adjBlur）不在这里：预览走 Konva.Filters.Blur，导出走 ctx.filter='blur()'。
 */

import type Konva from 'konva';

export interface AdjustParams {
  brightness: number; // -1..1（加性）
  contrast: number; // -1..1
  saturation: number; // -1..1
  hue: number; // -180..180 度
  temperature: number; // -1..1（正=暖）
  exposure: number; // -1..1（乘性）
  sharpen: number; // 0..1
  denoise: number; // 0..1
  grayscale: boolean;
  invert: boolean;
}

export function hasAnyAdjust(p: Partial<AdjustParams>): boolean {
  return (
    !!p.brightness ||
    !!p.contrast ||
    !!p.saturation ||
    !!p.hue ||
    !!p.temperature ||
    !!p.exposure ||
    !!p.sharpen ||
    !!p.denoise ||
    !!p.grayscale ||
    !!p.invert
  );
}

/** 超过该像素量时跳过卷积（锐化/降噪），避免 4K 图实时预览卡顿 */
const CONVOLUTION_PIXEL_CAP = 4_000_000;

export function applyAdjustToImageData(img: ImageData, p: AdjustParams): void {
  const d = img.data;
  const n = d.length;

  const expMul = 1 + clamp(p.exposure, -1, 1); // 曝光：乘性
  const brAdd = clamp(p.brightness, -1, 1) * 255; // 亮度：加性
  const contrast = clamp(p.contrast, -1, 1);
  const cFactor = (259 * (contrast * 255 + 255)) / (255 * (259 - contrast * 255));
  const sat = clamp(p.saturation, -1, 1);
  const temp = clamp(p.temperature, -1, 1) * 35;
  const hueDeg = p.hue || 0;

  const hueCos = Math.cos((hueDeg * Math.PI) / 180);
  const hueSin = Math.sin((hueDeg * Math.PI) / 180);

  for (let i = 0; i < n; i += 4) {
    let r = d[i];
    let g = d[i + 1];
    let b = d[i + 2];

    // 曝光（乘）→ 亮度（加）
    r = r * expMul + brAdd;
    g = g * expMul + brAdd;
    b = b * expMul + brAdd;

    // 色温：暖 = 加红减蓝
    r += temp;
    b -= temp;

    // 对比度
    r = cFactor * (r - 128) + 128;
    g = cFactor * (g - 128) + 128;
    b = cFactor * (b - 128) + 128;

    // 色相旋转（YIQ 近似矩阵）
    if (hueDeg !== 0) {
      const rr = r * (0.299 + 0.701 * hueCos + 0.168 * hueSin);
      const gg = r * (0.299 - 0.299 * hueCos - 0.328 * hueSin);
      const bb = r * (0.299 - 0.3 * hueCos + 1.25 * hueSin);
      const rr2 = g * (0.587 - 0.587 * hueCos + 0.33 * hueSin);
      const gg2 = g * (0.587 + 0.413 * hueCos + 0.035 * hueSin);
      const bb2 = g * (0.587 - 0.588 * hueCos - 1.05 * hueSin);
      const rr3 = b * (0.114 - 0.114 * hueCos - 0.497 * hueSin);
      const gg3 = b * (0.114 - 0.114 * hueCos + 0.292 * hueSin);
      const bb3 = b * (0.114 + 0.886 * hueCos - 0.203 * hueSin);
      r = rr + rr2 + rr3;
      g = gg + gg2 + gg3;
      b = bb + bb2 + bb3;
    }

    // 饱和度（朝亮度方向缩放）
    if (sat !== 0) {
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const s = 1 + sat;
      r = lum + (r - lum) * s;
      g = lum + (g - lum) * s;
      b = lum + (b - lum) * s;
    }

    // 黑白
    if (p.grayscale) {
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      r = g = b = lum;
    }

    // 反色
    if (p.invert) {
      r = 255 - r;
      g = 255 - g;
      b = 255 - b;
    }

    d[i] = clamp(r, 0, 255);
    d[i + 1] = clamp(g, 0, 255);
    d[i + 2] = clamp(b, 0, 255);
  }

  // 卷积：降噪（3×3 盒模糊）→ 锐化（unsharp 近似）
  const px = img.width * img.height;
  if (px <= CONVOLUTION_PIXEL_CAP) {
    if (p.denoise > 0) boxBlur3(img, p.denoise);
    if (p.sharpen > 0) sharpen3(img, p.sharpen);
  }
}

/** 3×3 盒模糊，amount 0..1 控制与原图混合比例（降噪近似） */
function boxBlur3(img: ImageData, amount: number): void {
  const { width: w, height: h, data } = img;
  const src = new Uint8ClampedArray(data);
  const a = clamp01(amount);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        let cnt = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            sum += src[(ny * w + nx) * 4 + c];
            cnt++;
          }
        }
        const idx = (y * w + x) * 4 + c;
        const avg = sum / cnt;
        data[idx] = src[idx] * (1 - a) + avg * a;
      }
    }
  }
}

/** unsharp mask 近似锐化 */
function sharpen3(img: ImageData, amount: number): void {
  const { width: w, height: h, data } = img;
  const src = new Uint8ClampedArray(data);
  const a = clamp01(amount) * 1.2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) continue;
      for (let c = 0; c < 3; c++) {
        const idx = (y * w + x) * 4 + c;
        const center = src[idx];
        const neighbors =
          src[((y - 1) * w + x) * 4 + c] +
          src[((y + 1) * w + x) * 4 + c] +
          src[(y * w + (x - 1)) * 4 + c] +
          src[(y * w + (x + 1)) * 4 + c];
        const lap = center * 4 - neighbors; // 拉普拉斯
        data[idx] = clamp(center + lap * a * 0.25, 0, 255);
      }
    }
  }
}

/** 从一个 Layer-like 对象抽取 AdjustParams（字段名对齐 types.ts 的 adj*） */
export function adjustParamsFromLayer(l: {
  adjBrightness?: number;
  adjContrast?: number;
  adjSaturation?: number;
  adjHue?: number;
  adjTemperature?: number;
  adjExposure?: number;
  adjSharpen?: number;
  adjDenoise?: number;
  adjGrayscale?: boolean;
  adjInvert?: boolean;
}): AdjustParams {
  return {
    brightness: l.adjBrightness ?? 0,
    contrast: l.adjContrast ?? 0,
    saturation: l.adjSaturation ?? 0,
    hue: l.adjHue ?? 0,
    temperature: l.adjTemperature ?? 0,
    exposure: l.adjExposure ?? 0,
    sharpen: l.adjSharpen ?? 0,
    denoise: l.adjDenoise ?? 0,
    grayscale: !!l.adjGrayscale,
    invert: !!l.adjInvert
  };
}

/**
 * Konva 自定义滤镜：从 node 上的 mb* attr 读参数。应用前用 node.setAttrs 写入。
 * 用 function 表达式以便 `this` 绑定到 Konva node。
 */
export function mengbiAdjustFilter(this: Konva.Node, imageData: ImageData): void {
  // Konva 调用滤镜时 this = node
  const node = this as unknown as { getAttr: (k: string) => unknown };
  const p: AdjustParams = {
    brightness: numAttr(node, 'mbBrightness'),
    contrast: numAttr(node, 'mbContrast'),
    saturation: numAttr(node, 'mbSaturation'),
    hue: numAttr(node, 'mbHue'),
    temperature: numAttr(node, 'mbTemperature'),
    exposure: numAttr(node, 'mbExposure'),
    sharpen: numAttr(node, 'mbSharpen'),
    denoise: numAttr(node, 'mbDenoise'),
    grayscale: !!node.getAttr('mbGrayscale'),
    invert: !!node.getAttr('mbInvert')
  };
  applyAdjustToImageData(imageData, p);
}

function numAttr(node: { getAttr: (k: string) => unknown }, k: string): number {
  const v = node.getAttr(k);
  return typeof v === 'number' ? v : 0;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
function clamp01(v: number): number {
  return clamp(v, 0, 1);
}
