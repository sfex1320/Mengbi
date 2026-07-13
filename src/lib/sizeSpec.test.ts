import { describe, it, expect } from 'vitest';
import { RATIO_ASPECTS, SIZE_TIERS, ratioOutputSize, nearestTier, nearestResolution } from './sizeSpec';
import type { RatioNodeData } from '../types/smartCanvas';

function mk(p: Partial<RatioNodeData>): RatioNodeData {
  return { sizeMode: 'preset', aspect: '1:1', tier: '2K', customW: 1024, customH: 1024, emit: 'both', ...p };
}

describe('常量', () => {
  it('RATIO_ASPECTS 含 1:1 / 16:9 / 3:1 / 1:3（横竖极宽极高）', () => {
    expect(RATIO_ASPECTS).toContain('1:1');
    expect(RATIO_ASPECTS).toContain('16:9');
    expect(RATIO_ASPECTS).toContain('3:1');
    expect(RATIO_ASPECTS).toContain('1:3');
  });
  it('SIZE_TIERS 含 1K…8K（8 档）', () => {
    for (const t of ['1K', '2K', '3K', '4K', '5K', '6K', '7K', '8K']) expect(SIZE_TIERS).toContain(t);
    expect(SIZE_TIERS).toHaveLength(8);
  });
});

describe('ratioOutputSize · preset 模式（比例 + 档位 → 精确宽高）', () => {
  it('1:1 + 2K → 约 2048²（宽高 16 倍数、像素 ≤ 预算）', () => {
    const out = ratioOutputSize(mk({ aspect: '1:1', tier: '2K' }))!;
    expect(out.aspect).toBe('1:1');
    expect(out.width % 16).toBe(0);
    expect(out.height % 16).toBe(0);
    expect(out.width * out.height).toBeLessThanOrEqual(4_194_304);
    expect(out.width).toBe(out.height);
    expect(out.emit).toBe('both');
  });
  it('16:9 + 1K 比 16:9 + 4K 像素更小（档位生效）', () => {
    const a = ratioOutputSize(mk({ aspect: '16:9', tier: '1K' }))!;
    const b = ratioOutputSize(mk({ aspect: '16:9', tier: '4K' }))!;
    expect(a.width * a.height).toBeLessThan(b.width * b.height);
    expect(a.aspect).toBe('16:9');
  });
  it('非法 tier 兜底 2K，缺 aspect 兜底 1:1', () => {
    const out = ratioOutputSize(mk({ aspect: '', tier: 'ZZ' }));
    expect(out?.aspect).toBe('1:1');
  });
  it('sizeMode 缺失按 preset 处理', () => {
    // @ts-expect-error 模拟旧数据缺字段
    const out = ratioOutputSize({ aspect: '4:3', tier: '1K', emit: 'both' });
    expect(out?.aspect).toBe('4:3');
  });
});

describe('ratioOutputSize · preset 最长边约定（含 3K-8K，超 4K 不被夹）', () => {
  it('16:9 + 8K → 最长边 8192（8192×4608）', () => {
    const out = ratioOutputSize(mk({ aspect: '16:9', tier: '8K' }))!;
    expect(out.width).toBe(8192);
    expect(out.height).toBe(4608);
    expect(Math.max(out.width, out.height)).toBe(8192);
  });
  it('9:16 + 4K → 竖图，高为最长边 4096（2304×4096）', () => {
    const out = ratioOutputSize(mk({ aspect: '9:16', tier: '4K' }))!;
    expect(out.height).toBe(4096);
    expect(out.width).toBe(2304);
  });
  it('1:1 + 6K → 6144×6144（>4K）', () => {
    const out = ratioOutputSize(mk({ aspect: '1:1', tier: '6K' }))!;
    expect(out.width).toBe(6144);
    expect(out.height).toBe(6144);
  });
});

describe('ratioOutputSize · original 模式（取连接图原尺寸）', () => {
  it('有 origW/origH → 原样输出 + 精确比例', () => {
    expect(ratioOutputSize(mk({ sizeMode: 'original', origW: 1920, origH: 1080 }))).toEqual({
      aspect: '16:9',
      width: 1920,
      height: 1080,
      emit: 'both'
    });
  });
  it('保留非 16 对齐的原尺寸（忠实原图，不强行 snap16）', () => {
    expect(ratioOutputSize(mk({ sizeMode: 'original', origW: 1000, origH: 667, emit: 'resolution' }))).toMatchObject({
      width: 1000,
      height: 667,
      emit: 'resolution'
    });
  });
  it('缺 origW/origH（或为 0）→ null（需先连图分析）', () => {
    expect(ratioOutputSize(mk({ sizeMode: 'original' }))).toBeNull();
    expect(ratioOutputSize(mk({ sizeMode: 'original', origW: 0, origH: 0 }))).toBeNull();
  });
  it('原尺寸超界夹到 [256,8192]', () => {
    expect(ratioOutputSize(mk({ sizeMode: 'original', origW: 10000, origH: 10000 }))).toMatchObject({ width: 8192, height: 8192 });
    expect(ratioOutputSize(mk({ sizeMode: 'original', origW: 100, origH: 100 }))).toMatchObject({ width: 256, height: 256 });
  });
});

describe('ratioOutputSize · custom 模式', () => {
  it('snap16 + clamp 并算精确比例，带 emit', () => {
    expect(ratioOutputSize(mk({ sizeMode: 'custom', customW: 1000, customH: 1000, emit: 'resolution' }))).toEqual({
      aspect: '1:1',
      width: 992,
      height: 992,
      emit: 'resolution'
    });
  });
  it('下限 clamp 到 256 / 上限 8192', () => {
    expect(ratioOutputSize(mk({ sizeMode: 'custom', customW: 100, customH: 100 }))).toMatchObject({ width: 256, height: 256 });
    expect(ratioOutputSize(mk({ sizeMode: 'custom', customW: 9000, customH: 9000 }))).toMatchObject({ width: 8192, height: 8192 });
  });
  it('非法（0/负/NaN）返回 null', () => {
    expect(ratioOutputSize(mk({ sizeMode: 'custom', customW: 0, customH: 1024 }))).toBeNull();
    expect(ratioOutputSize(mk({ sizeMode: 'custom', customW: -10, customH: 1024 }))).toBeNull();
    expect(ratioOutputSize(mk({ sizeMode: 'custom', customW: Number.NaN, customH: 1024 }))).toBeNull();
  });
});

describe('emit 透传', () => {
  it('emit 缺失默认 both', () => {
    // @ts-expect-error 缺 emit
    expect(ratioOutputSize({ sizeMode: 'preset', aspect: '1:1', tier: '2K' })?.emit).toBe('both');
  });
  it('emit=aspect / resolution 原样透传', () => {
    expect(ratioOutputSize(mk({ emit: 'aspect' }))?.emit).toBe('aspect');
    expect(ratioOutputSize(mk({ emit: 'resolution' }))?.emit).toBe('resolution');
  });
});

describe('nearestTier（最长边口径）', () => {
  it('精确档位值命中各自档', () => {
    expect(nearestTier(1024, 1024)).toBe('1K');
    expect(nearestTier(2048, 2048)).toBe('2K');
    expect(nearestTier(4096, 4096)).toBe('4K');
  });
  it('宽/竖比例不再被面积口径降档（历史 bug：2K×16:9 曾静默发成 1K）', () => {
    expect(nearestTier(2048, 1152)).toBe('2K');
    expect(nearestTier(1152, 2048)).toBe('2K');
    expect(nearestTier(4096, 2304)).toBe('4K');
    expect(nearestTier(1024, 576)).toBe('1K');
  });
  it('档间最近取、平手向上、超 4K 封顶', () => {
    expect(nearestTier(1408, 1408)).toBe('1K');
    expect(nearestTier(3072, 3072)).toBe('4K');
    expect(nearestTier(8192, 8192)).toBe('4K');
  });
});

describe('nearestResolution', () => {
  const STD = ['480p', '720p', '1080p'];
  it('按高度吸附最近 NNNp', () => {
    expect(nearestResolution(720, STD)).toBe('720p');
    expect(nearestResolution(500, STD)).toBe('480p');
    expect(nearestResolution(2000, STD)).toBe('1080p');
  });
  it('非 NNNp 档（std/pro）跳过', () => {
    expect(nearestResolution(700, ['480p', 'std', '720p', 'pro'])).toBe('720p');
  });
  it('无可解析档时回退首项 / 空数组回退 720p', () => {
    expect(nearestResolution(720, ['std', 'pro'])).toBe('std');
    expect(nearestResolution(720, [])).toBe('720p');
  });
});
