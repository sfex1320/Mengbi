import { describe, it, expect } from 'vitest';
import { reorderArray } from './arrayMove';

describe('reorderArray', () => {
  it('向后移动', () => {
    expect(reorderArray(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
  });
  it('向前移动', () => {
    expect(reorderArray(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c']);
  });
  it('from===to → 原序（浅拷贝）', () => {
    const src = ['a', 'b', 'c'];
    const out = reorderArray(src, 1, 1);
    expect(out).toEqual(src);
    expect(out).not.toBe(src);
  });
  it('越界 → 原序', () => {
    expect(reorderArray(['a', 'b'], 5, 0)).toEqual(['a', 'b']);
    expect(reorderArray(['a', 'b'], 0, -1)).toEqual(['a', 'b']);
  });
  it('不改原数组', () => {
    const src = ['a', 'b', 'c'];
    reorderArray(src, 0, 2);
    expect(src).toEqual(['a', 'b', 'c']);
  });
});
