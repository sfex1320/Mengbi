import { describe, it, expect } from 'vitest';
import { groupResults, type BatchDisplay } from './resultGroups';
import type { WorkResult } from '../types/smartCanvas';

function wr(p: Partial<WorkResult>): WorkResult {
  return {
    ok: true,
    summary: '',
    images: [],
    logs: [],
    workType: 'image-generation',
    runMode: 'single',
    provider: 'mengbi',
    model: 'm',
    simulated: false,
    ...p
  };
}

describe('groupResults', () => {
  it('单图结果 → 平铺单卡', () => {
    const g = groupResults([wr({ images: ['a.png'] }), wr({ images: ['b.png'] })]);
    expect(g).toHaveLength(2);
    expect(g[0]).toMatchObject({ kind: 'single', src: 'a.png' });
  });

  it('一条结果多张图（batch 模式）→ 合集卡', () => {
    const g = groupResults([wr({ images: ['a.png', 'b.png', 'c.png'] })]);
    expect(g).toHaveLength(1);
    const b = g[0] as BatchDisplay;
    expect(b.kind).toBe('batch');
    expect(b.count).toBe(3);
    expect(b.cover).toBe('a.png');
    expect(b.okCount).toBe(1);
  });

  it('同 batchId 多条（多提示词逐条）→ 合并为一个合集卡，统计成败', () => {
    const g = groupResults([
      wr({ images: ['s1.png'], batchId: 'B', shotIndex: 0, prompt: 'p1' }),
      wr({ images: [], ok: false, error: 'boom', batchId: 'B', shotIndex: 1, prompt: 'p2' }),
      wr({ images: ['s3.png'], batchId: 'B', shotIndex: 2, prompt: 'p3' })
    ]);
    expect(g).toHaveLength(1);
    const b = g[0] as BatchDisplay;
    expect(b.count).toBe(2);
    expect(b.okCount).toBe(2);
    expect(b.failCount).toBe(1);
    expect(b.items).toHaveLength(3);
    expect(b.cover).toBe('s1.png');
  });

  it('单条重试（同 batchId + 同 shotIndex）→ 替换旧条而非追加', () => {
    const g = groupResults([
      wr({ images: [], ok: false, error: 'x', batchId: 'B', shotIndex: 1 }),
      wr({ images: ['ok.png'], batchId: 'B', shotIndex: 1 })
    ]);
    const b = g[0] as BatchDisplay;
    expect(b.items).toHaveLength(1);
    expect(b.items[0].ok).toBe(true);
    expect(b.failCount).toBe(0);
  });

  it('不同 batchId 各自一卡', () => {
    const g = groupResults([
      wr({ images: ['a.png'], batchId: 'B1', shotIndex: 0 }),
      wr({ images: ['b.png'], batchId: 'B2', shotIndex: 0 })
    ]);
    expect(g).toHaveLength(2);
  });

  it('无图失败条（无批次）→ 占位合集卡（失败可见）', () => {
    const g = groupResults([wr({ images: [], ok: false, error: 'err' })]);
    expect(g).toHaveLength(1);
    expect((g[0] as BatchDisplay).failCount).toBe(1);
  });

  it('纯文本结果不进图片分组', () => {
    const g = groupResults([wr({ images: [], texts: ['hello'] })]);
    expect(g).toHaveLength(0);
  });

  it('合集内按 shotIndex 排序（并发完成顺序不定也按条序归位）', () => {
    const g = groupResults([
      wr({ images: ['c.png'], batchId: 'B', shotIndex: 2 }),
      wr({ images: ['a.png'], batchId: 'B', shotIndex: 0 }),
      wr({ images: ['b.png'], batchId: 'B', shotIndex: 1 })
    ]);
    const b = g[0] as BatchDisplay;
    expect(b.items.map((x) => x.shotIndex)).toEqual([0, 1, 2]);
  });
});
