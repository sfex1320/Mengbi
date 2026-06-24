import { describe, it, expect } from 'vitest';
import { quantizePixels } from './paletteExtract';

/** 构造 RGBA 像素数组：每个 [r,g,b] 重复 n 次。 */
function px(colors: Array<[number, number, number, number?]>, repeat = 1): number[] {
  const out: number[] = [];
  for (let i = 0; i < repeat; i++) {
    for (const [r, g, b, a] of colors) out.push(r, g, b, a ?? 255);
  }
  return out;
}

describe('quantizePixels（中位切分取色）', () => {
  it('一半红一半蓝 → 两色各约 50%', () => {
    const data = px([[255, 0, 0], [0, 0, 255]], 200);
    const out = quantizePixels(data, 2);
    expect(out).toHaveLength(2);
    const hexes = out.map((c) => c.hex).sort();
    expect(hexes).toEqual(['#0000FF', '#FF0000']);
    for (const c of out) expect(Math.round(c.pct ?? 0)).toBe(50);
  });

  it('占比按像素数排序（主色在前）', () => {
    const data = [...px([[255, 0, 0]], 300), ...px([[0, 255, 0]], 100)];
    const out = quantizePixels(data, 2);
    expect(out[0].hex).toBe('#FF0000');
    expect(out[0].pct).toBeGreaterThan(out[1].pct ?? 0);
  });

  it('纯色图劈不动 → 合并为一色 100%', () => {
    const out = quantizePixels(px([[10, 20, 30]], 64), 6);
    expect(out).toHaveLength(1);
    expect(out[0].hex).toBe('#0A141E');
    expect(Math.round(out[0].pct ?? 0)).toBe(100);
  });

  it('透明像素不参与统计', () => {
    const data = [...px([[255, 0, 0]], 50), ...px([[0, 255, 0, 0]], 500)];
    const out = quantizePixels(data, 2);
    expect(out[0].hex).toBe('#FF0000');
    expect(Math.round(out[0].pct ?? 0)).toBe(100);
  });

  it('空输入返回 []', () => {
    expect(quantizePixels([], 4)).toEqual([]);
  });

  it('count 钳制到 2-12', () => {
    const data = px(
      Array.from({ length: 16 }, (_, i) => [i * 16, 255 - i * 16, (i * 64) % 255] as [number, number, number]),
      8
    );
    expect(quantizePixels(data, 99).length).toBeLessThanOrEqual(12);
    expect(quantizePixels(data, 1).length).toBeGreaterThanOrEqual(2);
  });

  it('四色图提取 4 色（每色都被找回）', () => {
    const data = px([[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0]], 100);
    const out = quantizePixels(data, 4);
    expect(out).toHaveLength(4);
    const hexes = out.map((c) => c.hex).sort();
    expect(hexes).toEqual(['#0000FF', '#00FF00', '#FF0000', '#FFFF00']);
  });
});
