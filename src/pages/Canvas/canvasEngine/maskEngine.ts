/**
 * 局部重绘蒙版的纯栅格引擎。
 *
 * 蒙版以一张 **画板对齐**（project.width × project.height）的 HTMLCanvasElement 表示：
 *   - 已涂区域 = 不透明（RGB 用展示色，alpha = 覆盖强度）
 *   - 未涂区域 = 透明
 *
 * 统一规则（内部唯一真相，详见需求四节）：
 *   **白色 = 需要 AI 处理；黑色 = 保持不变。**
 * 导出黑白 PNG 时按此规则把“已涂区域”渲染成白。若某模型用相反规则，
 * 在调用模型前再做一次反相（不在本引擎做）。
 *
 * 所有几何操作（羽化 / 扩展 / 收缩 / 模糊边缘）都作用在 alpha 通道上。
 */

export function createMaskCanvas(width: number, height: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(width));
  c.height = Math.max(1, Math.round(height));
  return c;
}

export function cloneMaskCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = createMaskCanvas(src.width, src.height);
  c.getContext('2d')!.drawImage(src, 0, 0);
  return c;
}

/** 调整蒙版画布尺寸（扩图时把旧蒙版按锚点偏移贴进新尺寸） */
export function resizeMaskCanvas(
  src: HTMLCanvasElement,
  newWidth: number,
  newHeight: number,
  offsetX: number,
  offsetY: number
): HTMLCanvasElement {
  const c = createMaskCanvas(newWidth, newHeight);
  c.getContext('2d')!.drawImage(src, Math.round(offsetX), Math.round(offsetY));
  return c;
}

export interface BrushOpts {
  size: number;
  /** 0–1，1 = 硬边，越小越柔 */
  hardness: number;
  /** 展示色（#rrggbb） */
  color: string;
  /** 0–1 */
  opacity: number;
  erase: boolean;
}

/**
 * 画一段笔触（从 (x0,y0) 到 (x1,y1)）。硬笔走 Line + 圆头（快）；软笔沿线段贴径向渐变圆点。
 * 坐标均为画板坐标系。
 */
export function paintSegment(
  canvas: HTMLCanvasElement,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  opts: BrushOpts
): void {
  const ctx = canvas.getContext('2d')!;
  ctx.save();
  ctx.globalCompositeOperation = opts.erase ? 'destination-out' : 'source-over';
  const r = Math.max(0.5, opts.size / 2);

  if (opts.hardness >= 0.99) {
    ctx.globalAlpha = opts.opacity;
    ctx.strokeStyle = opts.color;
    ctx.fillStyle = opts.color;
    ctx.lineWidth = opts.size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    // 端点圆点，保证单击也有痕迹
    ctx.beginPath();
    ctx.arc(x1, y1, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  // 软笔：沿线段按 r/4 间距贴径向渐变圆点
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dist = Math.hypot(dx, dy);
  const step = Math.max(1, r / 4);
  const n = Math.max(1, Math.ceil(dist / step));
  const inner = Math.max(0, Math.min(0.95, opts.hardness));
  const rgb = hexToRgb(opts.color);
  for (let i = 0; i <= n; i++) {
    const t = n === 0 ? 0 : i / n;
    const px = x0 + dx * t;
    const py = y0 + dy * t;
    const g = ctx.createRadialGradient(px, py, r * inner, px, py, r);
    g.addColorStop(0, `rgba(${rgb.r},${rgb.g},${rgb.b},${opts.opacity})`);
    g.addColorStop(1, `rgba(${rgb.r},${rgb.g},${rgb.b},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * 生成扩图蒙版：新画布范围内，原图矩形以外全部标记为 AI 处理区（白）。
 * innerRect 是原图在新画布中的位置（扩图后原图被平移到这里）。
 */
export function makeOutpaintMask(
  newWidth: number,
  newHeight: number,
  innerRect: { x: number; y: number; w: number; h: number },
  color: string
): HTMLCanvasElement {
  const c = createMaskCanvas(newWidth, newHeight);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, newWidth, newHeight);
  // 把原图区域抠空（保持不变区）
  ctx.clearRect(innerRect.x, innerRect.y, innerRect.w, innerRect.h);
  return c;
}

/** 从一张图（取其 alpha>阈值的区域）生成蒙版：用于「把图层主体转为重绘蒙版」 */
export function maskFromAlpha(
  source: HTMLCanvasElement,
  color: string
): HTMLCanvasElement {
  const c = createMaskCanvas(source.width, source.height);
  const ctx = c.getContext('2d')!;
  const sd = source.getContext('2d')!.getImageData(0, 0, source.width, source.height);
  const out = ctx.createImageData(source.width, source.height);
  const { r, g, b } = hexToRgb(color);
  for (let i = 0; i < sd.data.length; i += 4) {
    const a = sd.data[i + 3];
    out.data[i] = r;
    out.data[i + 1] = g;
    out.data[i + 2] = b;
    out.data[i + 3] = a; // 覆盖强度 = 源 alpha
  }
  ctx.putImageData(out, 0, 0);
  return c;
}

/** 清空（全透明） */
export function clearMask(canvas: HTMLCanvasElement): void {
  canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height);
}

/** 矩形选区填充（选区工具：矩形） */
export function fillRectShape(
  canvas: HTMLCanvasElement,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  erase: boolean
): void {
  const ctx = canvas.getContext('2d')!;
  ctx.save();
  ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
  ctx.fillStyle = erase ? '#000' : color;
  ctx.fillRect(Math.min(x, x + w), Math.min(y, y + h), Math.abs(w), Math.abs(h));
  ctx.restore();
}

/** 椭圆选区填充（选区工具：椭圆） */
export function fillEllipseShape(
  canvas: HTMLCanvasElement,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  color: string,
  erase: boolean
): void {
  const ctx = canvas.getContext('2d')!;
  ctx.save();
  ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
  ctx.fillStyle = erase ? '#000' : color;
  ctx.beginPath();
  ctx.ellipse(cx, cy, Math.abs(rx), Math.abs(ry), 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** 多边形 / 套索选区填充。points = [x0,y0,x1,y1,...] */
export function fillPolygonShape(
  canvas: HTMLCanvasElement,
  points: number[],
  color: string,
  erase: boolean
): void {
  if (points.length < 6) return; // 至少 3 点
  const ctx = canvas.getContext('2d')!;
  ctx.save();
  ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
  ctx.fillStyle = erase ? '#000' : color;
  ctx.beginPath();
  ctx.moveTo(points[0], points[1]);
  for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i], points[i + 1]);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** 填充整张（全部标记为 AI 处理区） */
export function fillMask(canvas: HTMLCanvasElement, color: string, opacity = 1): void {
  const ctx = canvas.getContext('2d')!;
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = opacity;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
}

/** 反选：已涂 ↔ 未涂（基于 alpha 反相，RGB 重设为 color） */
export function invertMask(canvas: HTMLCanvasElement, color: string): void {
  const ctx = canvas.getContext('2d')!;
  const { r, g, b } = hexToRgb(color);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = 255 - d[i + 3];
    d[i] = r;
    d[i + 1] = g;
    d[i + 2] = b;
    d[i + 3] = a;
  }
  ctx.putImageData(img, 0, 0);
}

/** 把已涂区域重新着色（改展示色时用，不改 alpha） */
export function recolorMask(canvas: HTMLCanvasElement, color: string): void {
  const ctx = canvas.getContext('2d')!;
  const { r, g, b } = hexToRgb(color);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] > 0) {
      d[i] = r;
      d[i + 1] = g;
      d[i + 2] = b;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** 模糊 alpha 边缘（羽化 / 模糊蒙版边缘共用）。radius 单位 px。 */
export function blurMaskEdge(canvas: HTMLCanvasElement, radius: number): void {
  if (radius <= 0) return;
  const tmp = cloneMaskCanvas(canvas);
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.filter = `blur(${radius}px)`;
  ctx.drawImage(tmp, 0, 0);
  ctx.restore();
}

/** 扩展（膨胀）：把已涂区域向四周外扩 px。用环形偏移叠绘近似形态学膨胀。 */
export function expandMask(canvas: HTMLCanvasElement, px: number): void {
  if (px <= 0) return;
  const tmp = cloneMaskCanvas(canvas);
  const ctx = canvas.getContext('2d')!;
  const steps = Math.max(8, Math.ceil(px));
  for (let i = 0; i < steps; i++) {
    const ang = (i / steps) * Math.PI * 2;
    ctx.drawImage(tmp, Math.cos(ang) * px, Math.sin(ang) * px);
  }
}

/** 收缩（腐蚀）：等价于膨胀“透明区域”再从原图里抠掉。 */
export function contractMask(canvas: HTMLCanvasElement, px: number, color: string): void {
  if (px <= 0) return;
  // 1) 构造“反相”画布：原透明处变不透明
  const inv = cloneMaskCanvas(canvas);
  invertMask(inv, color);
  // 2) 膨胀反相区域
  expandMask(inv, px);
  // 3) 从原图里把膨胀后的反相区域抠掉
  const ctx = canvas.getContext('2d')!;
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.drawImage(inv, 0, 0);
  ctx.restore();
}

/** 是否有任何已涂像素（用于提交前校验空蒙版） */
export function maskHasCoverage(canvas: HTMLCanvasElement): boolean {
  // 缩到 64×64 采样，快速判空
  const s = createMaskCanvas(Math.min(64, canvas.width), Math.min(64, canvas.height));
  s.getContext('2d')!.drawImage(canvas, 0, 0, s.width, s.height);
  const d = s.getContext('2d')!.getImageData(0, 0, s.width, s.height).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 8) return true;
  return false;
}

/**
 * 导出为黑白 PNG（白 = AI 处理区 = 已涂；黑 = 保持）。
 * 保留 alpha 软边作为灰阶，支持羽化蒙版的模型；threshold=true 时硬切纯黑白。
 */
export async function maskToBlackWhitePng(
  canvas: HTMLCanvasElement,
  opts: { threshold?: boolean } = {}
): Promise<Blob> {
  const out = createMaskCanvas(canvas.width, canvas.height);
  const octx = out.getContext('2d')!;
  // 先把覆盖强度转成白色强度（alpha → 灰阶）写到黑底
  octx.fillStyle = '#000000';
  octx.fillRect(0, 0, out.width, out.height);
  const src = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
  const img = octx.getImageData(0, 0, out.width, out.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    let v = src[i + 3]; // 覆盖 alpha → 白强度
    if (opts.threshold) v = v >= 128 ? 255 : 0;
    d[i] = v;
    d[i + 1] = v;
    d[i + 2] = v;
    d[i + 3] = 255;
  }
  octx.putImageData(img, 0, 0);
  return canvasToBlob(out);
}

/**
 * 导出为 OpenAI /images/edits 约定的蒙版：**透明处 = 编辑区（AI 处理）**，不透明处 = 保持。
 * 即把内部“白 = AI”规则转成“透明 = AI”——这是“相反规则模型”的自动转换（详见需求四节）。
 * 输出尺寸 = 蒙版画布尺寸（应与提交的底图一致）。
 */
export async function maskToEditAlphaPng(canvas: HTMLCanvasElement): Promise<Blob> {
  const out = createMaskCanvas(canvas.width, canvas.height);
  const octx = out.getContext('2d')!;
  const src = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
  const img = octx.createImageData(out.width, out.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    // 覆盖越强（越接近 AI 区）→ 越透明
    const cover = src[i + 3];
    d[i] = 0;
    d[i + 1] = 0;
    d[i + 2] = 0;
    d[i + 3] = 255 - cover;
  }
  octx.putImageData(img, 0, 0);
  return canvasToBlob(out);
}

/** 把黑白 PNG（白 = AI 区）导入为蒙版画布。invert=true 时按相反规则解释。 */
export async function blackWhitePngToMask(
  src: HTMLImageElement,
  width: number,
  height: number,
  color: string,
  opts: { invert?: boolean } = {}
): Promise<HTMLCanvasElement> {
  // 先把来源缩放到画板尺寸
  const scaled = createMaskCanvas(width, height);
  scaled.getContext('2d')!.drawImage(src, 0, 0, width, height);
  const sd = scaled.getContext('2d')!.getImageData(0, 0, width, height);
  const data = sd.data;
  const { r, g, b } = hexToRgb(color);
  for (let i = 0; i < data.length; i += 4) {
    // 亮度作为“AI 区强度”
    let lum = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
    // 若源图本身带 alpha（透明），透明处按黑处理
    lum = (lum * data[i + 3]) / 255;
    if (opts.invert) lum = 255 - lum;
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = Math.round(lum);
  }
  scaled.getContext('2d')!.putImageData(sd, 0, 0);
  return scaled;
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob null'))), 'image/png');
  });
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex);
  if (!m) return { r: 251, g: 146, b: 60 }; // 回退暖橘
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}
