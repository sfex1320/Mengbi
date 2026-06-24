/**
 * 视频剪辑滤镜图构造器（纯函数，vitest 覆盖）—— 把「多段时间轴剪辑」编译成单条 ffmpeg filter_complex。
 *
 * 支持：每段 裁切(trim) + 变速(setpts/atempo) + 缩放居中(scale/pad/setsar/fps 统一) + 每段音频(音量/静音/淡入淡出)；
 *       段间 硬切(concat) 或 转场(xfade + acrossfade)；整体调色(eq/hue)；文字叠加(drawtext，按时间区间 enable)。
 *
 * 设计要点：
 * - 左折叠（incremental fold）：cur=[v0]，逐段与下一段 concat 或 xfade，每步产出单一流 → 天然支持「逐边界混用 切/转场」。
 * - xfade offset = 已折叠输出时长 - 转场时长；折叠后总时长 += clipDur - d。音频 acrossfade 同步重叠 d。
 * - 音频鲁棒：静音/无音轨的段用 anullsrc 合成等长静音，保证音频折叠链不断；任一段时长未知则整体降级为纯画面输出。
 * - 纯函数：所有时长由调用方（后端 probe）传入，不在此做 IO。
 */

export type VideoTransition = 'none' | 'fade' | 'fadeblack' | 'dissolve' | 'wipeleft' | 'slideright';

/** UI 转场 → xfade transition 名（none 不走 xfade）。 */
export const XFADE_NAME: Record<Exclude<VideoTransition, 'none'>, string> = {
  fade: 'fade',
  fadeblack: 'fadeblack',
  dissolve: 'dissolve',
  wipeleft: 'wipeleft',
  slideright: 'slideright'
};

export interface ClipInput {
  /** 裁切入点（秒，>=0） */
  trimStart: number;
  /** 裁切出点（秒）；<=0 = 到自然结尾 */
  trimEnd: number;
  /** 探测到的自然时长（秒）；<=0 = 未知 */
  naturalDuration: number;
  hasAudio: boolean;
  /** 音量倍数（1=不变） */
  volume: number;
  muted: boolean;
  fadeIn: number;
  fadeOut: number;
  /** 变速（0.5~2，1=正常） */
  speed: number;
  /** 进入本段的转场（第 0 段忽略） */
  transition: VideoTransition;
  transitionDur: number;
}

export interface ClipTextOverlay {
  text: string;
  start: number;
  end: number;
  /** 0~1 相对位置（画面宽/高的比例） */
  x: number;
  y: number;
  fontSize: number;
  /** CSS 颜色（#rrggbb） */
  color: string;
}

export interface ClipGraphSpec {
  clips: ClipInput[];
  width: number;
  height: number;
  fps: number;
  color: { brightness: number; contrast: number; saturation: number; gamma: number; hue: number };
  texts: ClipTextOverlay[];
  /** drawtext 字体文件绝对路径（无则不渲染文字） */
  fontFile?: string | null;
}

export interface ClipGraphResult {
  filterComplex: string;
  mapV: string;
  /** 有音频时为音频流标签；否则 null（调用方不加 -map a） */
  mapA: string | null;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** 单段有效（裁切+变速后的）输出时长（秒）；未知返回 0。 */
export function clipOutDuration(c: ClipInput): number {
  const s = Math.max(0, c.trimStart || 0);
  const end = c.trimEnd > 0 ? c.trimEnd : c.naturalDuration > 0 ? c.naturalDuration : 0;
  if (end <= s) return 0;
  const spd = clamp(c.speed || 1, 0.5, 2);
  return (end - s) / spd;
}

/**
 * drawtext **单引号包裹**的 text 值转义。
 * ffmpeg 滤镜图里单引号是「字面量直到下一个单引号」——`: , % [ ]` 都被单引号保护，无需反斜杠转义
 * （再转义会让成片里多出反斜杠）。只需：① 反斜杠 → `\\`；② 字面单引号用「关-转义-开」`'\''`；③ 换行 → 空格。
 */
export function escapeDrawtext(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "'\\''")
    .replace(/\r?\n/g, ' ');
}
/** 字体/字幕路径转义（Windows 盘符冒号 + 反斜杠 → 正斜杠）。 */
export function escapeFontPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/:/g, '\\:');
}
/** #rrggbb → ffmpeg 颜色（0xRRGGBB），非法回退白色。 */
export function ffColor(hex: string): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec((hex || '').trim());
  return m ? `0x${m[1].toUpperCase()}` : '0xFFFFFF';
}

/**
 * 构造 filter_complex。inputs 索引与 clips 索引一一对应（调用方按 clips 顺序 -i）。
 */
export function buildClipFilterGraph(spec: ClipGraphSpec): ClipGraphResult {
  const W = Math.max(2, Math.round(spec.width) & ~1);
  const H = Math.max(2, Math.round(spec.height) & ~1);
  const FPS = clamp(Math.round(spec.fps) || 30, 1, 120);
  const clips = spec.clips;
  if (!clips.length) throw new Error('no clips');

  const durs = clips.map(clipOutDuration);
  const audioEnabled = durs.every((d) => d > 0); // 任一段时长未知 → 整体降级纯画面（不做音频折叠）

  const parts: string[] = [];

  // ── 每段视频流 ──
  clips.forEach((c, i) => {
    const s = Math.max(0, c.trimStart || 0);
    const spd = clamp(c.speed || 1, 0.5, 2);
    const trim = c.trimEnd > 0 ? `trim=start=${r2(s)}:end=${r2(c.trimEnd)}` : s > 0 ? `trim=start=${r2(s)}` : null;
    const vf: string[] = [];
    if (trim) vf.push(trim);
    vf.push(`setpts=(PTS-STARTPTS)/${spd}`);
    vf.push(`scale=${W}:${H}:force_original_aspect_ratio=decrease`);
    vf.push(`pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2`);
    vf.push('setsar=1');
    vf.push(`fps=${FPS}`);
    parts.push(`[${i}:v]${vf.join(',')}[v${i}]`);
  });

  // ── 每段音频流（启用时）──
  if (audioEnabled) {
    clips.forEach((c, i) => {
      const dur = durs[i];
      if (c.hasAudio && !c.muted) {
        const s = Math.max(0, c.trimStart || 0);
        const spd = clamp(c.speed || 1, 0.5, 2);
        const af: string[] = [];
        if (c.trimEnd > 0) af.push(`atrim=start=${r2(s)}:end=${r2(c.trimEnd)}`);
        else if (s > 0) af.push(`atrim=start=${r2(s)}`);
        af.push('asetpts=PTS-STARTPTS');
        if (spd !== 1) af.push(`atempo=${r2(spd)}`);
        const vol = c.volume != null && c.volume >= 0 ? c.volume : 1;
        if (vol !== 1) af.push(`volume=${r2(vol)}`);
        if (c.fadeIn > 0) af.push(`afade=t=in:st=0:d=${r2(c.fadeIn)}`);
        if (c.fadeOut > 0) af.push(`afade=t=out:st=${r2(Math.max(0, dur - c.fadeOut))}:d=${r2(c.fadeOut)}`);
        af.push('aresample=48000');
        af.push('aformat=sample_fmts=fltp:channel_layouts=stereo');
        parts.push(`[${i}:a]${af.join(',')}[a${i}]`);
      } else {
        // 静音/无音轨：合成等长静音，保证折叠链不断
        parts.push(`anullsrc=r=48000:cl=stereo,atrim=0:${r2(dur)},asetpts=N/SR/TB[a${i}]`);
      }
    });
  }

  // ── 左折叠：逐段 concat（硬切）或 xfade（转场）──
  let curV = `[v0]`;
  let curA = `[a0]`;
  let curDur = durs[0] || 0;
  for (let i = 1; i < clips.length; i++) {
    const c = clips[i];
    const dCanKnow = audioEnabled && durs[i] > 0 && curDur > 0;
    const maxD = Math.min(curDur, durs[i]) * 0.9;
    const d = c.transition !== 'none' && dCanKnow ? clamp(c.transitionDur || 0, 0, maxD) : 0;
    if (c.transition === 'none' || d <= 0) {
      parts.push(`${curV}[v${i}]concat=n=2:v=1:a=0[vc${i}]`);
      if (audioEnabled) parts.push(`${curA}[a${i}]concat=n=2:v=0:a=1[ac${i}]`);
      curV = `[vc${i}]`;
      curA = `[ac${i}]`;
      curDur += durs[i] || 0;
    } else {
      const off = r2(Math.max(0, curDur - d));
      parts.push(`${curV}[v${i}]xfade=transition=${XFADE_NAME[c.transition]}:duration=${r2(d)}:offset=${off}[vx${i}]`);
      if (audioEnabled) parts.push(`${curA}[a${i}]acrossfade=d=${r2(d)}[ax${i}]`);
      curV = `[vx${i}]`;
      curA = `[ax${i}]`;
      curDur += (durs[i] || 0) - d;
    }
  }

  // ── 整体调色 ──
  const eq: string[] = [];
  const cl = spec.color;
  if (cl.brightness && cl.brightness !== 0) eq.push(`brightness=${r2(cl.brightness)}`);
  if (cl.contrast && cl.contrast !== 1) eq.push(`contrast=${r2(cl.contrast)}`);
  if (cl.saturation && cl.saturation !== 1) eq.push(`saturation=${r2(cl.saturation)}`);
  if (cl.gamma && cl.gamma !== 1) eq.push(`gamma=${r2(cl.gamma)}`);
  const colorFilters: string[] = [];
  if (eq.length) colorFilters.push(`eq=${eq.join(':')}`);
  if (cl.hue && cl.hue !== 0) colorFilters.push(`hue=h=${r2(cl.hue)}`);
  if (colorFilters.length) {
    parts.push(`${curV}${colorFilters.join(',')}[vcolor]`);
    curV = `[vcolor]`;
  }

  // ── 文字叠加（drawtext 链，按时间区间 enable）──
  const texts = (spec.texts || []).filter((t) => (t.text ?? '').trim().length > 0);
  if (texts.length && spec.fontFile) {
    // fontfile 用「不加引号 + 转义盘符冒号」形式（drawtext 在 Windows 最稳的写法 fontfile=C\:/...）；
    // 候选字体路径均无空格。text 与 enable 用单引号包裹，单引号内逗号/冒号无需转义。
    const font = escapeFontPath(spec.fontFile);
    texts.forEach((t, ti) => {
      const x = `(w-text_w)*${clamp(t.x ?? 0.5, 0, 1).toFixed(3)}`;
      const y = `(h-text_h)*${clamp(t.y ?? 0.85, 0, 1).toFixed(3)}`;
      const dt =
        `drawtext=fontfile=${font}:text='${escapeDrawtext(t.text)}'` +
        `:x=${x}:y=${y}:fontsize=${Math.max(8, Math.round(t.fontSize || 28))}` +
        `:fontcolor=${ffColor(t.color)}:borderw=2:bordercolor=0x000000` +
        `:enable='between(t,${r2(t.start)},${r2(t.end)})'`;
      parts.push(`${curV}${dt}[vt${ti}]`);
      curV = `[vt${ti}]`;
    });
  }

  return {
    filterComplex: parts.join(';'),
    mapV: curV,
    mapA: audioEnabled ? curA : null
  };
}
