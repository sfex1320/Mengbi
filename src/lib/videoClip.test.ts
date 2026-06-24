import { describe, it, expect } from 'vitest';
import {
  defaultSegment,
  reconcileSegments,
  sameSegmentSrcs,
  segmentOutDuration,
  totalTimelineDuration,
  layoutSegments,
  formatTimecode
} from './videoClip';
import type { VideoClipSegment } from '@shared/smartCanvas';

const seg = (src: string, over: Partial<VideoClipSegment> = {}): VideoClipSegment => ({ ...defaultSegment(src), ...over });

describe('reconcileSegments', () => {
  it('新上游全部追加（默认参数）', () => {
    const out = reconcileSegments(['a', 'b'], []);
    expect(out.map((s) => s.src)).toEqual(['a', 'b']);
    expect(out[0].speed).toBe(1);
  });
  it('保留已存片段顺序与编辑参数', () => {
    const existing = [seg('b', { trimStart: 2 }), seg('a', { volume: 0.5 })];
    const out = reconcileSegments(['a', 'b'], existing);
    expect(out.map((s) => s.src)).toEqual(['b', 'a']); // 维持用户排序，不按上游序
    expect(out[0].trimStart).toBe(2);
    expect(out[1].volume).toBe(0.5);
  });
  it('断开的片段被丢弃，新增追加在后', () => {
    const existing = [seg('a'), seg('gone')];
    const out = reconcileSegments(['a', 'c'], existing);
    expect(out.map((s) => s.src)).toEqual(['a', 'c']);
  });
});

describe('sameSegmentSrcs', () => {
  it('同序同 src 为真', () => {
    expect(sameSegmentSrcs([seg('a'), seg('b')], [seg('a'), seg('b')])).toBe(true);
  });
  it('顺序不同为假', () => {
    expect(sameSegmentSrcs([seg('a'), seg('b')], [seg('b'), seg('a')])).toBe(false);
  });
  it('长度不同为假', () => {
    expect(sameSegmentSrcs([seg('a')], [seg('a'), seg('b')])).toBe(false);
  });
});

describe('segmentOutDuration', () => {
  it('全段用自然时长', () => {
    expect(segmentOutDuration(seg('a'), 5)).toBe(5);
  });
  it('裁切 + 变速', () => {
    expect(segmentOutDuration(seg('a', { trimStart: 1, trimEnd: 5, speed: 2 }), 10)).toBe(2);
  });
  it('未知自然时长且无出点 → 0', () => {
    expect(segmentOutDuration(seg('a'), 0)).toBe(0);
  });
});

describe('totalTimelineDuration / layoutSegments', () => {
  it('硬切：总时长=各段相加', () => {
    const segs = [seg('a'), seg('b')];
    expect(totalTimelineDuration(segs, [5, 3])).toBe(8);
  });
  it('转场：扣减重叠', () => {
    const segs = [seg('a'), seg('b', { transition: 'fade', transitionDur: 1 })];
    expect(totalTimelineDuration(segs, [5, 5])).toBe(9); // 5 + (5-1)
  });
  it('转场重叠被钳到相邻段 0.9', () => {
    const segs = [seg('a'), seg('b', { transition: 'fade', transitionDur: 999 })];
    // overlap = min(2,2)*0.9 = 1.8 → total = 2 + (2-1.8) = 2.2
    expect(totalTimelineDuration(segs, [2, 2])).toBeCloseTo(2.2, 5);
  });
  it('layout：起点/宽度比例随时长，硬切首段从 0 起', () => {
    const segs = [seg('a'), seg('b')];
    const { items, total } = layoutSegments(segs, [6, 6]);
    expect(total).toBe(12);
    expect(items[0].startPct).toBe(0);
    expect(items[0].widthPct).toBe(50);
    expect(items[1].startPct).toBe(50);
  });
  it('layout：转场段起点回拉重叠量', () => {
    const segs = [seg('a'), seg('b', { transition: 'fade', transitionDur: 2 })];
    const { items } = layoutSegments(segs, [10, 10]); // total = 18
    // 段1 start = cursor(10) - overlap(2) = 8 → 8/18
    expect(items[1].startPct).toBeCloseTo((8 / 18) * 100, 4);
  });
  it('空/零时长不崩', () => {
    expect(layoutSegments([], []).total).toBe(0);
    const z = layoutSegments([seg('a')], [0]);
    expect(z.items[0].widthPct).toBe(0);
  });
});

describe('formatTimecode', () => {
  it('格式化', () => {
    expect(formatTimecode(0)).toBe('0:00.0');
    expect(formatTimecode(5.5)).toBe('0:05.5');
    expect(formatTimecode(65)).toBe('1:05.0');
  });
  it('负/非法回退 0', () => {
    expect(formatTimecode(-3)).toBe('0:00.0');
    expect(formatTimecode(NaN)).toBe('0:00.0');
  });
});
