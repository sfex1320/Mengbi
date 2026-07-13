/**
 * 应用内自定义鼠标光标 —— 10 套 SVG 光标（每套两枚：箭头 arrow + 手型/点击 pointer）。
 *
 * 技术路线（铁律）：原生 CSS `cursor: url(data:image/svg+xml,…) x y, fallback`。
 * - 由合成器直接渲染，**零延迟跟手**；只在本应用窗口内生效；
 * - 绝不做「JS 元素跟随鼠标」那种必然拖影的方案（CursorHalo 光晕是装饰，不是指针）。
 *
 * 颜色说明（合理例外）：data URI 里的 SVG 无法引用 CSS 变量 var(--mb-*)，
 * 所以这里使用固定的主题无关颜色字面量；每枚光标都自带明暗对比
 * （白芯深边 / 深芯白边 / 霓虹双描边），保证深色与浅色背景下都清晰可见。
 *
 * 尺寸：设计坐标系 32×32，按 size 等比缩放（含热点坐标）。
 * 允许范围 20~48px（Chromium 光标图上限 128px，默认 28）。
 */

export interface CursorImage {
  /** data:image/svg+xml,... 形式的 URI，可直接进 CSS url() 或 <img src> */
  uri: string;
  /** 热点 x（像素，已按 size 缩放） */
  hx: number;
  /** 热点 y（像素，已按 size 缩放） */
  hy: number;
}

export interface CursorStyleDef {
  id: string;
  label: string;
  desc: string;
  arrow: (size: number) => CursorImage;
  pointer: (size: number) => CursorImage;
}

export const CURSOR_OFF = 'off';
export const CURSOR_SIZE_MIN = 20;
export const CURSOR_SIZE_MAX = 48;
export const CURSOR_SIZE_DEFAULT = 28;

/** clamp 到 [20,48] 的整数；非法输入回默认 28。 */
export function clampCursorSize(n: number): number {
  if (!Number.isFinite(n)) return CURSOR_SIZE_DEFAULT;
  return Math.min(CURSOR_SIZE_MAX, Math.max(CURSOR_SIZE_MIN, Math.round(n)));
}

// ─────────────────────────────────────────────────────
// 内部：SVG 组装
// ─────────────────────────────────────────────────────

/** 设计坐标系边长：所有形状画在 32×32 里，按 size 等比缩放 */
const VIEW = 32;

/** 主题无关的对比色（见文件头「颜色说明」） */
const INK = '#1b1e28';
const PAPER = '#ffffff';

function svgUri(inner: string, size: number): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${VIEW} ${VIEW}">${inner}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** 把「32×32 设计稿 + 设计热点」封装成 (size) => CursorImage */
function img(inner: string, hx: number, hy: number): (size: number) => CursorImage {
  return (size: number): CursorImage => {
    const s = clampCursorSize(size);
    const k = s / VIEW;
    return {
      uri: svgUri(inner, s),
      hx: Math.max(0, Math.min(s - 1, Math.round(hx * k))),
      hy: Math.max(0, Math.min(s - 1, Math.round(hy * k)))
    };
  };
}

/** 外圈衬底描边（提升反差用，先画在最底层） */
function halo(d: string, color: string, width: number): string {
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linejoin="round" stroke-linecap="round"/>`;
}

/** 芯体：填充 + 描边 */
function core(d: string, fill: string, edge: string, edgeW: number): string {
  return `<path d="${d}" fill="${fill}" stroke="${edge}" stroke-width="${edgeW}" stroke-linejoin="round" stroke-linecap="round"/>`;
}

/**
 * 像素风：用整块 <rect> 拼形（先画放大 1.1px 的深色衬底、再叠亮色面），
 * 免去手写阶梯 path 的出错风险，天然自带 1px 描边效果。
 */
function pixelRects(
  cells: ReadonlyArray<readonly [number, number, number, number]>,
  fill: string,
  edge: string
): string {
  const back = cells
    .map(([x, y, w, h]) => `<rect x="${x - 1.1}" y="${y - 1.1}" width="${w + 2.2}" height="${h + 2.2}" fill="${edge}"/>`)
    .join('');
  const face = cells.map(([x, y, w, h]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`).join('');
  return `<g shape-rendering="crispEdges">${back}${face}</g>`;
}

// ── 共享几何 ──

/** 经典箭头轮廓（尖端 (7,2.5)） */
const ARROW_D = 'M7 2.5 L7 25 L12.6 19.8 L16.2 27.6 L19.8 26 L16.2 18.3 L23.2 18.3 Z';

/** 极简箭头：更窄更修长（尖端 (8,3)） */
const SLIM_ARROW_D = 'M8 3 L8 23.5 L12.6 19.2 L15.4 26.2 L18.3 25 L15.5 18 L21.4 18 Z';

/** 指向手型（食指朝上，指尖约 (14.2,2)）——多个风格共用同一几何，各自换配色 */
const HAND_D =
  'M12 4.2 A2.2 2.2 0 0 1 16.4 4.2 L16.4 12.6 L21.8 13.4 A2.4 2.4 0 0 1 24 15.8 L24 20.6 ' +
  'A6.6 6.6 0 0 1 17.4 27.2 L14.8 27.2 A7.4 7.4 0 0 1 9.2 24.6 L5.6 20.2 A2.1 2.1 0 0 1 8.8 17.5 L12 20.4 Z';

/** 闪电（顶端尖 (13.5,2)） */
const BOLT_D = 'M13.5 2 L24.5 17.5 L18 17.5 L21 29.5 L7.5 12.5 L15.2 12.5 Z';

/** 四芒星（AI 星芒主体，中心 (16,16)） */
const STAR_D =
  'M16 3 C16.9 10.4 21.6 15.1 29 16 C21.6 16.9 16.9 21.6 16 29 C15.1 21.6 10.4 16.9 3 16 C10.4 15.1 15.1 10.4 16 3 Z';

/** 小星（星芒角标） */
const STAR_MINI_D =
  'M25 4.5 C25.3 6.4 26.2 7.3 28.1 7.6 C26.2 7.9 25.3 8.8 25 10.7 C24.7 8.8 23.8 7.9 21.9 7.6 C23.8 7.3 24.7 6.4 25 4.5 Z';

/** 毛笔笔锋（墨滴形笔尖，尖端 (4,4)） */
const BRUSH_NIB_D =
  'M4 4 C9.5 6.2 13.6 10.2 15.2 14.8 C16 17.6 14.3 19.7 11.8 19.2 C7.9 18.4 5.3 11.5 4 4 Z';

/** 十字准星四臂（中心留空） */
const CROSS_D = 'M16 3.5 V11 M16 21 V28.5 M3.5 16 H11 M21 16 H28.5';

/** 双色圆环（白衬底 + 深描边） */
function ring(cx: number, cy: number, r: number, under: string, over: string, underW: number, overW: number): string {
  return (
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${under}" stroke-width="${underW}"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${over}" stroke-width="${overW}"/>`
  );
}

// ─────────────────────────────────────────────────────
// 10 套光标样式
// ─────────────────────────────────────────────────────

/** 像素箭头拼块（2px 网格，尖端约 (8,4)） */
const PIXEL_ARROW_CELLS: ReadonlyArray<readonly [number, number, number, number]> = [
  [7, 3, 2, 2],
  [7, 5, 4, 2],
  [7, 7, 6, 2],
  [7, 9, 8, 2],
  [7, 11, 10, 2],
  [7, 13, 12, 2],
  [7, 15, 14, 2],
  [7, 17, 2, 2],
  [13, 17, 4, 2],
  [13, 19, 4, 2],
  [13, 21, 4, 2]
];

/** 像素手型拼块（指尖约 (15,3)） */
const PIXEL_HAND_CELLS: ReadonlyArray<readonly [number, number, number, number]> = [
  [13, 3, 4, 8],
  [9, 11, 14, 4],
  [7, 15, 16, 6],
  [9, 21, 12, 4]
];

export const CURSOR_STYLES: ReadonlyArray<CursorStyleDef> = [
  {
    id: 'classic',
    label: '描边经典',
    desc: '白芯深边的经典箭头 + 指向手型',
    arrow: img(core(ARROW_D, PAPER, INK, 1.7), 7, 3),
    pointer: img(core(HAND_D, PAPER, INK, 1.7), 14, 3)
  },
  {
    id: 'minimal',
    label: '极简',
    desc: '修长深色箭头，白色细边',
    arrow: img(core(SLIM_ARROW_D, '#262a36', PAPER, 1.5), 8, 3),
    pointer: img(core(HAND_D, '#262a36', PAPER, 1.5), 14, 3)
  },
  {
    id: 'digital',
    label: '数码',
    desc: '科技蓝描边 + 电路纹路',
    arrow: img(
      halo(ARROW_D, '#10131c', 3.6) +
        core(ARROW_D, PAPER, '#0e7490', 1.6) +
        `<path d="M10.2 8 L13.4 11.6 L10.2 15.2" fill="none" stroke="#06b6d4" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`,
      7,
      3
    ),
    pointer: img(
      halo(HAND_D, '#10131c', 3.6) +
        core(HAND_D, PAPER, '#0e7490', 1.6) +
        `<path d="M14.2 6.2 V11" fill="none" stroke="#06b6d4" stroke-width="1.5" stroke-linecap="round"/>`,
      14,
      3
    )
  },
  {
    id: 'pixel',
    label: '像素',
    desc: '复古游戏方块阶梯',
    arrow: img(pixelRects(PIXEL_ARROW_CELLS, PAPER, INK), 8, 4),
    pointer: img(pixelRects(PIXEL_HAND_CELLS, PAPER, INK), 15, 3)
  },
  {
    id: 'lightning',
    label: '闪电',
    desc: '亮黄色闪电，一击即中',
    arrow: img(halo(BOLT_D, PAPER, 3.4) + core(BOLT_D, '#ffd23f', '#4a3200', 1.5), 14, 2),
    pointer: img(
      ring(13.5, 3.5, 4.6, PAPER, '#4a3200', 3, 1.3) + halo(BOLT_D, PAPER, 3.4) + core(BOLT_D, '#ffb020', '#4a3200', 1.5),
      14,
      2
    )
  },
  {
    id: 'star',
    label: 'AI 星芒',
    desc: '四芒星 + 小星角标，热点在星心',
    arrow: img(
      halo(STAR_D, '#171a24', 3.2) + core(STAR_D, PAPER, '#8b5cf6', 1.5) + core(STAR_MINI_D, '#c4b5fd', '#171a24', 1),
      16,
      16
    ),
    pointer: img(
      halo(STAR_D, '#171a24', 3.2) +
        core(STAR_D, '#ede9fe', '#8b5cf6', 1.5) +
        core(STAR_MINI_D, '#c4b5fd', '#171a24', 1) +
        `<circle cx="16" cy="16" r="2.4" fill="#8b5cf6" stroke="${PAPER}" stroke-width="1"/>`,
      16,
      16
    )
  },
  {
    id: 'neon',
    label: '霓虹',
    desc: '深芯亮边的赛博双描边',
    arrow: img(
      halo(ARROW_D, 'rgba(34,211,238,0.5)', 5.4) + halo(ARROW_D, '#22d3ee', 2.2) + core(ARROW_D, '#0b0f1a', '#22d3ee', 1.2),
      7,
      3
    ),
    pointer: img(
      halo(HAND_D, 'rgba(244,114,182,0.5)', 5.4) + halo(HAND_D, '#f472b6', 2.2) + core(HAND_D, '#0b0f1a', '#f472b6', 1.2),
      14,
      3
    )
  },
  {
    id: 'dot',
    label: '圆点',
    desc: '轻巧圆环 + 中心点，精准定位',
    arrow: img(
      ring(16, 16, 7, PAPER, INK, 4, 1.8) + `<circle cx="16" cy="16" r="2" fill="${PAPER}" stroke="${INK}" stroke-width="1"/>`,
      16,
      16
    ),
    pointer: img(
      ring(16, 16, 7, PAPER, INK, 4, 1.8) + `<circle cx="16" cy="16" r="3.4" fill="${INK}" stroke="${PAPER}" stroke-width="1.6"/>`,
      16,
      16
    )
  },
  {
    id: 'crosshair',
    label: '十字准星',
    desc: '四向准线 + 中心点，指哪打哪',
    arrow: img(
      halo(CROSS_D, PAPER, 4.4) + halo(CROSS_D, INK, 1.9) + `<circle cx="16" cy="16" r="1.7" fill="${INK}" stroke="${PAPER}" stroke-width="1.2"/>`,
      16,
      16
    ),
    pointer: img(
      halo(CROSS_D, PAPER, 4.4) +
        halo(CROSS_D, INK, 1.9) +
        ring(16, 16, 6.6, PAPER, INK, 3.2, 1.4) +
        `<circle cx="16" cy="16" r="2.2" fill="${INK}" stroke="${PAPER}" stroke-width="1.2"/>`,
      16,
      16
    )
  },
  {
    id: 'brush',
    label: '毛笔',
    desc: '墨色笔锋 + 木质笔杆',
    arrow: img(
      `<path d="M15.8 15.4 L27 26.6" fill="none" stroke="${PAPER}" stroke-width="7" stroke-linecap="round"/>` +
        `<path d="M15.8 15.4 L27 26.6" fill="none" stroke="#a9713f" stroke-width="4.4" stroke-linecap="round"/>` +
        `<path d="M15.8 15.4 L27 26.6" fill="none" stroke="${INK}" stroke-width="1" stroke-linecap="round" opacity="0.35"/>` +
        halo(BRUSH_NIB_D, PAPER, 3) +
        core(BRUSH_NIB_D, '#23262f', PAPER, 1.1),
      4,
      4
    ),
    pointer: img(
      `<path d="M15.8 15.4 L27 26.6" fill="none" stroke="${PAPER}" stroke-width="7" stroke-linecap="round"/>` +
        `<path d="M15.8 15.4 L27 26.6" fill="none" stroke="#a9713f" stroke-width="4.4" stroke-linecap="round"/>` +
        halo(BRUSH_NIB_D, PAPER, 3) +
        core(BRUSH_NIB_D, '#23262f', PAPER, 1.1) +
        `<circle cx="4.6" cy="16.4" r="2.4" fill="${INK}" stroke="${PAPER}" stroke-width="1.1"/>`,
      4,
      4
    )
  }
];

/** 按 id 找样式；'off' / 未知 id 返回 undefined（= 用系统默认光标）。 */
export function getCursorStyle(id: string): CursorStyleDef | undefined {
  if (id === CURSOR_OFF) return undefined;
  return CURSOR_STYLES.find((s) => s.id === id);
}

// ─────────────────────────────────────────────────────
// CSS 生成（注入 <style id="mb-cursor-style"> 用）
// ─────────────────────────────────────────────────────

/**
 * 生成整套光标 CSS：
 * - `html[data-cursor] body`：默认箭头（cursor 是可继承属性，body 上设即全局生效）；
 * - 可点击元素：手型/点击枚 + `, pointer` 兜底（!important 压过组件里零散的 cursor:pointer）；
 * - 文本输入类显式还原 `auto`（否则会从 body 继承自定义箭头，丢失 I 形光标）；
 * - 元素自带的功能光标（grab / crosshair / resize 等显式声明）不受影响。
 */
export function buildCursorCss(def: CursorStyleDef, size: number): string {
  const a = def.arrow(size);
  const p = def.pointer(size);
  const arrowUrl = `url("${a.uri}") ${a.hx} ${a.hy}`;
  const pointerUrl = `url("${p.uri}") ${p.hx} ${p.hy}`;
  return [
    `html[data-cursor] body { cursor: ${arrowUrl}, auto; }`,
    `html[data-cursor] :is(button, a, [role="button"], select, summary, input[type="checkbox"], input[type="radio"], input[type="range"], .mb-btn, label):not(:disabled) { cursor: ${pointerUrl}, pointer !important; }`,
    `html[data-cursor] :is(input, textarea):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="button"]):not([type="submit"]):not([type="color"]):not([type="file"]) { cursor: auto; }`,
    `html[data-cursor] :is([contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]) { cursor: auto; }`
  ].join('\n');
}
