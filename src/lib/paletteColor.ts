/**
 * 配色工具纯函数：色值转换（HEX / RGB / CMYK / HSL / HSB）+ 配色方案推导
 * （互补 / 对比(三角) / 邻近 / 分裂互补 / 四角 / 单色深浅）+ 中文色名近似 + 配色提示词生成。
 * 供智能画布「配色工具」节点使用；全部纯函数，vitest 覆盖（paletteColor.test.ts）。
 */
import type { PaletteColorEntry, PaletteScheme } from '@shared/smartCanvas';

export interface RGB {
  r: number;
  g: number;
  b: number;
}

// ───────────────────────── 色值转换 ─────────────────────────

/** '#abc' / '#aabbcc' / 'aabbcc' → RGB；非法返回 null。 */
export function hexToRgb(hex: string): RGB | null {
  const s = (hex ?? '').trim().replace(/^#/, '');
  const m3 = /^[0-9a-fA-F]{3}$/.test(s);
  const m6 = /^[0-9a-fA-F]{6}$/.test(s);
  if (!m3 && !m6) return null;
  const full = m3 ? s.split('').map((c) => c + c).join('') : s;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16)
  };
}

export function rgbToHex(r: number, g: number, b: number): string {
  const h = (v: number): string => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`.toUpperCase();
}

/** RGB(0-255) → CMYK（0-100 整数，印刷常用百分数表示）。 */
export function rgbToCmyk(r: number, g: number, b: number): { c: number; m: number; y: number; k: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const k = 1 - Math.max(rn, gn, bn);
  if (k >= 1) return { c: 0, m: 0, y: 0, k: 100 };
  const c = (1 - rn - k) / (1 - k);
  const m = (1 - gn - k) / (1 - k);
  const y = (1 - bn - k) / (1 - k);
  return { c: Math.round(c * 100), m: Math.round(m * 100), y: Math.round(y * 100), k: Math.round(k * 100) };
}

/** RGB(0-255) → HSL（h 0-360，s/l 0-100）。 */
export function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: Math.round(l * 100) };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return { h: Math.round(h * 360) % 360, s: Math.round(s * 100), l: Math.round(l * 100) };
}

/** HSL（h 0-360，s/l 0-100）→ RGB(0-255)。 */
export function hslToRgb(h: number, s: number, l: number): RGB {
  const hn = (((h % 360) + 360) % 360) / 360;
  const sn = Math.max(0, Math.min(100, s)) / 100;
  const ln = Math.max(0, Math.min(100, l)) / 100;
  if (sn === 0) {
    const v = Math.round(ln * 255);
    return { r: v, g: v, b: v };
  }
  const q = ln < 0.5 ? ln * (1 + sn) : ln + sn - ln * sn;
  const p = 2 * ln - q;
  const hue = (t0: number): number => {
    let t = t0;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return {
    r: Math.round(hue(hn + 1 / 3) * 255),
    g: Math.round(hue(hn) * 255),
    b: Math.round(hue(hn - 1 / 3) * 255)
  };
}

/** RGB(0-255) → HSB/HSV（h 0-360，s/b 0-100；PS 拾色器同款）。 */
export function rgbToHsb(r: number, g: number, b: number): { h: number; s: number; b: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h = Math.round(h * 60);
    if (h < 0) h += 360;
  }
  return { h, s: Math.round(max === 0 ? 0 : (d / max) * 100), b: Math.round(max * 100) };
}

/** 一个颜色的全部常用色值字符串（UI 表格 + 复制用）。 */
export function colorValueStrings(hex: string): Array<{ label: string; value: string }> {
  const rgb = hexToRgb(hex) ?? { r: 0, g: 0, b: 0 };
  const cmyk = rgbToCmyk(rgb.r, rgb.g, rgb.b);
  const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
  const hsb = rgbToHsb(rgb.r, rgb.g, rgb.b);
  return [
    { label: 'HEX', value: rgbToHex(rgb.r, rgb.g, rgb.b) },
    { label: 'RGB', value: `${rgb.r}, ${rgb.g}, ${rgb.b}` },
    { label: 'CMYK', value: `${cmyk.c}, ${cmyk.m}, ${cmyk.y}, ${cmyk.k}` },
    { label: 'HSL', value: `${hsl.h}, ${hsl.s}%, ${hsl.l}%` },
    { label: 'HSB', value: `${hsb.h}, ${hsb.s}%, ${hsb.b}%` }
  ];
}

// ───────────────────────── 中文色名近似 ─────────────────────────

/**
 * 按 HSL 桶给一个近似中文色名（深/浅 前缀 + 主色相），喂提示词比裸色值更可读。
 *
 * 关键修正（感知一致）：
 * - 棕色家族判定放宽到「暖色相 + 低饱和 或 偏暗的橙调」——避免把
 *   #4F3A36（h≈10/s≈19%/l≈26%，肉眼是深棕/灰褐）误判成「深红色」；
 *   而真正高饱和的暗红（如 #7A1010，s≈77%）仍归红色。
 * - 一般低饱和色（s 8~25%）走偏灰的柔和色名（灰蓝 / 灰绿…），与色块观感对齐。
 */
export function colorName(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return '未知色';
  const { h, s, l } = rgbToHsl(rgb.r, rgb.g, rgb.b);
  if (l <= 10) return '黑色';
  if (l >= 95 && s <= 25) return '白色';
  if (s <= 8) {
    if (l < 35) return '深灰色';
    if (l > 72) return '浅灰色';
    return '灰色';
  }

  const warm = h < 50 || h >= 345; // 红 / 橙 / 黄 暖色相区（含跨 360 的红）

  // 棕色家族：① 偏暗的橙调（饱和也算，如 #8B4513 鞍棕）；② 低饱和暖色（如 #4F3A36 灰褐）。
  // 真正高饱和的暗红（h<15 且 s 高）不在此列，仍归红色。
  const isMutedWarm = warm && s < 45; // 低饱和暖 → 棕/褐/米/驼
  const isDarkOrange = h >= 15 && h < 50 && l < 42; // 暗橙调 → 棕
  if (isMutedWarm || isDarkOrange) {
    if (l < 30) return '深棕色';
    if (l < 50) return '棕色';
    if (l < 68) return s < 28 ? '褐色' : '驼色';
    return s < 22 ? '米色' : '卡其色';
  }

  // 一般低饱和（非暖棕）：用偏灰的柔和色名，避免「显示鲜艳色名但色块发灰」
  if (s <= 25) {
    let muted: string;
    if (h < 65) muted = '灰黄色';
    else if (h < 150) muted = '灰绿色';
    else if (h < 250) muted = '灰蓝色';
    else muted = '灰紫色';
    if (l < 30) return `深${muted}`;
    if (l > 78) return `浅${muted}`;
    return muted;
  }

  let base: string;
  if (h < 15 || h >= 345) base = '红色';
  else if (h < 40) base = '橙色';
  else if (h < 65) base = '黄色';
  else if (h < 95) base = '黄绿色';
  else if (h < 150) base = '绿色';
  else if (h < 195) base = '青色';
  else if (h < 250) base = '蓝色';
  else if (h < 290) base = '紫色';
  else if (h < 330) base = '品红色';
  else base = '粉红色';
  if (l < 28) return `深${base}`;
  if (l > 78) return `浅${base}`;
  return base;
}

// ───────────────────────── 配色方案推导 ─────────────────────────

export const PALETTE_SCHEME_HINTS: Record<PaletteScheme, string> = {
  complementary: '基准色 + 色环对面 180° 的互补色（最强对比）',
  contrast: '三角对比：色环上相隔 120° 的三色（对比鲜明且均衡）',
  analogous: '邻近色：基准色左右各 ±30° 内取色（柔和统一）',
  split: '分裂互补：基准色 + 互补色两侧 ±30°（对比强但比互补柔和）',
  tetradic: '四角配色：色环上相隔 90° 的四色（丰富，建议一主三辅）',
  monochrome: '单色深浅：同一色相按明度分档（最稳妥）'
};

/** 由基准色推导一组配色（首位恒为基准色）。count 仅对 邻近/单色 生效（2-8）。 */
export function deriveScheme(baseHex: string, scheme: PaletteScheme, count = 5): string[] {
  const rgb = hexToRgb(baseHex);
  if (!rgb) return [];
  // 基准色用原始 RGB 归一（HSL 往返有取整误差，不能用 at(0) 代替精确基准色）
  const base = rgbToHex(rgb.r, rgb.g, rgb.b);
  const { h, s, l } = rgbToHsl(rgb.r, rgb.g, rgb.b);
  const at = (dh: number, s2 = s, l2 = l): string => {
    const c = hslToRgb(h + dh, s2, l2);
    return rgbToHex(c.r, c.g, c.b);
  };
  const n = Math.max(2, Math.min(8, Math.round(count)));
  switch (scheme) {
    case 'complementary':
      return [base, at(180)];
    case 'contrast':
      return [base, at(120), at(240)];
    case 'split':
      return [base, at(150), at(210)];
    case 'tetradic':
      return [base, at(90), at(180), at(270)];
    case 'analogous': {
      // 以基准色为中心向两侧展开（n 色覆盖 ±30° 邻近区）
      const span = 60;
      const step = span / Math.max(1, n - 1);
      const out: string[] = [base];
      for (let i = 1; i < n; i++) {
        const side = i % 2 === 1 ? 1 : -1;
        const mag = Math.ceil(i / 2) * step;
        out.push(at(side * mag));
      }
      return out;
    }
    case 'monochrome': {
      // 同色相按明度均匀分档（含基准色，从深到浅）
      const lo = 22;
      const hi = 82;
      const out: string[] = [];
      for (let i = 0; i < n; i++) {
        const li = lo + ((hi - lo) * i) / Math.max(1, n - 1);
        out.push(at(0, s, Math.round(li)));
      }
      // 找最接近基准明度的那档替换为精确基准色
      let best = 0;
      let bestDiff = Infinity;
      out.forEach((hx, i) => {
        const c = hexToRgb(hx);
        if (!c) return;
        const diff = Math.abs(rgbToHsl(c.r, c.g, c.b).l - l);
        if (diff < bestDiff) {
          bestDiff = diff;
          best = i;
        }
      });
      out[best] = base;
      return out;
    }
  }
}

// ───────────────────────── 配色提示词生成 ─────────────────────────

/**
 * 把一组颜色拼成中文配色提示词（喂下游 生图 / 视频 / ComfyUI）。
 * includeValues=true 时附 HEX 色值（指令跟随型模型如 gpt-image-2 / Nano Banana 能直接吃 HEX）。
 */
export function buildPalettePrompt(
  colors: PaletteColorEntry[],
  opts: { includeValues?: boolean; schemeLabel?: string } = {}
): string {
  const list = (colors ?? []).filter((c) => !!hexToRgb(c.hex));
  if (!list.length) return '';
  const part = (c: PaletteColorEntry): string => {
    const name = colorName(c.hex);
    const val = opts.includeValues === false ? '' : ` ${c.hex.toUpperCase()}`;
    const pct = typeof c.pct === 'number' && c.pct > 0 ? `（占比约 ${Math.round(c.pct)}%）` : '';
    return `${name}${val}${pct}`;
  };
  let s = `画面整体采用 ${list.length} 色配色方案：以${part(list[0])}为主色`;
  if (list.length > 1) s += `，辅以${list.slice(1).map(part).join('、')}`;
  if (opts.schemeLabel) s += `，色彩关系为${opts.schemeLabel}`;
  s += '。请让画面的主要颜色严格遵循以上配色，保持色调统一和谐。';
  return s;
}

/** 「复制全部色值」的文本（一行一色，含全部格式）。 */
export function paletteCopyAllText(colors: PaletteColorEntry[]): string {
  return (colors ?? [])
    .filter((c) => !!hexToRgb(c.hex))
    .map((c, i) => {
      const vals = colorValueStrings(c.hex)
        .map((v) => `${v.label}(${v.value})`)
        .join(' · ');
      const pct = typeof c.pct === 'number' && c.pct > 0 ? ` · 占比${Math.round(c.pct)}%` : '';
      return `${i + 1}. ${colorName(c.hex)} ${vals}${pct}`;
    })
    .join('\n');
}
