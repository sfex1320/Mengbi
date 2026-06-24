import { describe, it, expect } from 'vitest';
import { simplifySvg, mergeSimilarFills } from './svgSimplifier';

const PATH = (d: string, fill: string): string => `<path d="${d}" fill="${fill}"/>`;

describe('simplifySvg —— maxPaths 裁剪（已接线到 batchQueue 的后处理参数）', () => {
  it('maxPaths=1 → 只保留 d 最长的一条', () => {
    const svg = `<svg>${PATH('M0 0 L100 100 L200 200 L300 300', '#111111')}${PATH('M0 0 L1 1', '#222222')}${PATH('M0 0 L2 2 L3 3', '#333333')}</svg>`;
    const r = simplifySvg(svg, { maxPaths: 1 });
    expect((r.final.match(/<path/g) || []).length).toBe(1);
    expect(r.final).toContain('#111111'); // 最长 d 的那条被保留
    expect(r.acted).toBe(true);
  });

  it('不传 maxPaths → 不裁剪', () => {
    const svg = `<svg>${PATH('M0 0 L1 1', '#111111')}${PATH('M0 0 L2 2', '#222222')}</svg>`;
    const r = simplifySvg(svg, {});
    expect((r.final.match(/<path/g) || []).length).toBe(2);
  });
});

describe('mergeSimilarFills —— colorMergeDelta 合并相近色', () => {
  it('相近色归一到先出现的代表色、远色保留', () => {
    const svg = `${PATH('M0 0', '#ff0000')}${PATH('M1 1', '#fe0101')}${PATH('M2 2', '#00ff00')}`;
    const out = mergeSimilarFills(svg, 8); // #fe0101 距 #ff0000 ≈1.7 < 8
    expect(out).toContain('fill="#ff0000"');
    expect(out).not.toContain('#fe0101');
    expect(out).toContain('fill="#00ff00"'); // 绿色远，保留
  });

  it('delta<=0 → 原样返回', () => {
    const svg = `${PATH('M0 0', '#ff0000')}${PATH('M1 1', '#fe0101')}`;
    expect(mergeSimilarFills(svg, 0)).toBe(svg);
  });

  it('simplifySvg 经 colorMergeDelta 触发合并', () => {
    const svg = `<svg>${PATH('M0 0 L9 9', '#ff0000')}${PATH('M1 1 L8 8', '#fd0202')}</svg>`;
    const r = simplifySvg(svg, { colorMergeDelta: 10 }); // ≈3.46 < 10
    expect(r.final).not.toContain('#fd0202');
    expect(r.acted).toBe(true);
  });
});
