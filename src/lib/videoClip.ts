/**
 * 视频剪辑节点的渲染端纯函数（vitest 覆盖）：上游视频 → 片段 reconcile、时间轴布局、时码、单段输出时长。
 * 与 electron 端 clipGraph.ts 分工：这里只管 UI 层的片段编排/布局，真正的 ffmpeg 合成在主进程。
 */
import type { VideoClipSegment } from '@shared/smartCanvas';

/** 新片段默认值（一段刚连入的上游视频）。 */
export function defaultSegment(src: string): VideoClipSegment {
  return {
    src,
    trimStart: 0,
    trimEnd: 0,
    speed: 1,
    volume: 1,
    muted: false,
    fadeIn: 0,
    fadeOut: 0,
    transition: 'none',
    transitionDur: 0.5
  };
}

/**
 * 用当前上游视频列表 reconcile 已存片段：
 * - 保留仍在上游的片段（维持用户排好的顺序与剪辑参数）
 * - 上游新增、片段里还没有的 → 按上游顺序追加（默认参数）
 * - 上游已断开的 → 丢弃
 */
export function reconcileSegments(upstreamSrcs: string[], existing: VideoClipSegment[]): VideoClipSegment[] {
  const up = new Set(upstreamSrcs);
  const kept = existing.filter((s) => up.has(s.src));
  const keptSrcs = new Set(kept.map((s) => s.src));
  const added = upstreamSrcs.filter((s) => !keptSrcs.has(s)).map(defaultSegment);
  return [...kept, ...added];
}

/** 两个片段列表的「结构」是否一致（src 序列相同）——用于 reconcile 后判断是否需要写回，避免渲染循环。 */
export function sameSegmentSrcs(a: VideoClipSegment[], b: VideoClipSegment[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i].src !== b[i].src) return false;
  return true;
}

/** 单段裁切+变速后的输出时长（秒）；naturalDuration<=0（未测到）时按 trimEnd 估，再不行回退 0。 */
export function segmentOutDuration(seg: VideoClipSegment, naturalDuration: number): number {
  const s = Math.max(0, seg.trimStart || 0);
  const end = seg.trimEnd > 0 ? seg.trimEnd : naturalDuration > 0 ? naturalDuration : 0;
  if (end <= s) return 0;
  const spd = Math.max(0.5, Math.min(2, seg.speed || 1));
  return (end - s) / spd;
}

/** 成片总时长（含转场重叠扣减）。durations: 与 segments 同序的每段输出时长。 */
export function totalTimelineDuration(segments: VideoClipSegment[], durations: number[]): number {
  let total = 0;
  segments.forEach((seg, i) => {
    const d = durations[i] || 0;
    if (i === 0) {
      total += d;
      return;
    }
    const overlap = seg.transition !== 'none' ? Math.min(seg.transitionDur || 0, Math.min(durations[i - 1] || 0, d) * 0.9) : 0;
    total += d - overlap;
  });
  return Math.max(0, total);
}

/** 时间轴布局：每段在轨道上的起点/宽度比例（0~1）+ 总时长。用于节点/工作台画片段块。 */
export interface ClipLayoutItem {
  src: string;
  startPct: number;
  widthPct: number;
  durationSec: number;
}
export function layoutSegments(segments: VideoClipSegment[], durations: number[]): { items: ClipLayoutItem[]; total: number } {
  const total = totalTimelineDuration(segments, durations);
  const items: ClipLayoutItem[] = [];
  let cursor = 0;
  segments.forEach((seg, i) => {
    const d = durations[i] || 0;
    const overlap = i > 0 && seg.transition !== 'none' ? Math.min(seg.transitionDur || 0, Math.min(durations[i - 1] || 0, d) * 0.9) : 0;
    const start = Math.max(0, cursor - overlap);
    items.push({
      src: seg.src,
      startPct: total > 0 ? (start / total) * 100 : 0,
      widthPct: total > 0 ? (d / total) * 100 : 0,
      durationSec: d
    });
    cursor = start + d;
  });
  return { items, total };
}

/** 秒 → m:ss.s 时码。 */
export function formatTimecode(s: number): string {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return `${m}:${sec.toFixed(1).padStart(4, '0')}`;
}
