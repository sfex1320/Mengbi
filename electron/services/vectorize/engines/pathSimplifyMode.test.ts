import { describe, it, expect } from 'vitest';
import { resolvePathSimplifyMode } from './pathSimplifyMode';

// 模拟 @neplex/vectorizer 的 PathSimplifyMode 枚举（真实值是运行期数字）
const ENUM = { None: 0, Polygon: 1, Spline: 2 };

describe('resolvePathSimplifyMode —— pathMode → PathSimplifyMode 枚举值', () => {
  it('缺省 / spline → Spline（历史默认行为，不回归）', () => {
    expect(resolvePathSimplifyMode(undefined, ENUM)).toBe(ENUM.Spline);
    expect(resolvePathSimplifyMode('spline', ENUM)).toBe(ENUM.Spline);
  });

  it('polygon → Polygon', () => {
    expect(resolvePathSimplifyMode('polygon', ENUM)).toBe(ENUM.Polygon);
  });

  it('none → None', () => {
    expect(resolvePathSimplifyMode('none', ENUM)).toBe(ENUM.None);
  });
});
