import { describe, it, expect } from 'vitest';
import { computeScaleTarget, type ScaleParams } from './imageScale';

const base: ScaleParams = {
  mode: 'factor',
  factor: 1,
  edge: 0,
  fitW: 0,
  fitH: 0,
  megapixels: 1,
  keepAspect: true,
  noUpscale: false
};

describe('computeScaleTarget 等比 clamp（大倍数不变形）', () => {
  it('factor 模式保持宽高比', () => {
    const r = computeScaleTarget({ ...base, factor: 3 }, 800, 400);
    expect(r.w / r.h).toBeCloseTo(2, 5);
  });

  it('大倍数触顶时整体等比缩进，比例不失真', () => {
    // 2000×1000（2:1），×8 → 16000×8000，长边超 8192 上限
    const r = computeScaleTarget({ ...base, factor: 8 }, 2000, 1000);
    expect(Math.max(r.w, r.h)).toBeLessThanOrEqual(8192);
    expect(r.w / r.h).toBeCloseTo(2, 2); // 仍是 2:1，而非旧版 8192:8000 的 1.02
    expect(r.w).toBe(8192);
    expect(r.h).toBe(4096);
  });

  it('极端竖图大倍数同样保持比例', () => {
    const r = computeScaleTarget({ ...base, factor: 10 }, 1000, 3000);
    expect(Math.max(r.w, r.h)).toBeLessThanOrEqual(8192);
    expect(r.h / r.w).toBeCloseTo(3, 2);
  });

  it('未触顶时按倍数精确放大', () => {
    const r = computeScaleTarget({ ...base, factor: 2 }, 1024, 768);
    expect(r).toEqual({ w: 2048, h: 1536 });
  });

  it('longest 模式按最长边等比', () => {
    const r = computeScaleTarget({ ...base, mode: 'longest', edge: 4000 }, 2000, 1000);
    expect(r).toEqual({ w: 4000, h: 2000 });
  });
});
