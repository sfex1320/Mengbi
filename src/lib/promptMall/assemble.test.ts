import { describe, it, expect } from 'vitest';
import {
  assembleCart,
  assembleCartGrouped,
  cartItemText,
  stripFences,
  type AssembleItem,
  type GroupedAssembleItem,
  type AssembleGroup
} from './assemble';

const mk = (cat: string, sub: string, zh: string, en: string): AssembleItem => ({ cat, sub, zh, en });
const gi = (cat: string, sub: string, zh: string, en: string, group?: string): GroupedAssembleItem => ({ cat, sub, zh, en, group });
const G = (id: string, name: string): AssembleGroup => ({ id, name });

describe('cartItemText', () => {
  it('picks the active language', () => {
    const it = mk('character', 'hairstyle', '波浪长发', 'long wavy hair');
    expect(cartItemText(it, 'zh')).toBe('波浪长发');
    expect(cartItemText(it, 'en')).toBe('long wavy hair');
  });
  it('falls back to the other language when primary is empty', () => {
    expect(cartItemText(mk('a', 'b', '', 'only english'), 'zh')).toBe('only english');
    expect(cartItemText(mk('a', 'b', '只有中文', ''), 'en')).toBe('只有中文');
  });
});

describe('assembleCart', () => {
  it('joins fragments by language separator', () => {
    const items = [mk('character', 'gender-age', '少女', 'young woman'), mk('art-style', 'anime', '动漫风', 'anime style')];
    expect(assembleCart(items, 'zh')).toBe('少女，动漫风');
    expect(assembleCart(items, 'en')).toBe('young woman, anime style');
  });

  it('orders fragments by category assembly order regardless of insertion order', () => {
    // quality should come after character even if added first
    const items = [mk('quality', 'enhance', '高清', 'high detail'), mk('character', 'gender-age', '少女', 'young woman')];
    expect(assembleCart(items, 'zh')).toBe('少女，高清');
  });

  it('keeps insertion order within the same category', () => {
    const items = [mk('character', 'hairstyle', '长发', 'long hair'), mk('character', 'gender-age', '少女', 'young woman')];
    expect(assembleCart(items, 'zh')).toBe('长发，少女');
  });

  it('de-duplicates identical fragments (case-insensitive)', () => {
    const items = [mk('art-style', 'anime', 'Anime', 'Anime Style'), mk('art-style', 'anime', 'anime', 'anime style')];
    expect(assembleCart(items, 'en')).toBe('Anime Style');
  });

  it('routes negatives into a trailing negative line', () => {
    const items = [mk('character', 'gender-age', '少女', 'young woman'), mk('quality', 'negative', '低画质', 'low quality')];
    expect(assembleCart(items, 'zh')).toBe('少女。负面：低画质');
    expect(assembleCart(items, 'en')).toBe('young woman. Negative: low quality');
  });

  it('handles negatives only', () => {
    expect(assembleCart([mk('quality', 'negative', '模糊', 'blurry')], 'en')).toBe('Negative: blurry');
  });

  it('returns empty string for empty cart', () => {
    expect(assembleCart([], 'zh')).toBe('');
  });

  it('unknown categories sort to the end', () => {
    const items = [mk('zzz-unknown', 'x', '未知', 'unknown'), mk('character', 'gender-age', '少女', 'young woman')];
    expect(assembleCart(items, 'zh')).toBe('少女，未知');
  });
});

describe('assembleCartGrouped', () => {
  it('single default group is identical to assembleCart (back-compat)', () => {
    const items = [gi('character', 'gender-age', '少女', 'young woman', 'g1'), gi('art-style', 'anime', '动漫风', 'anime style', 'g1')];
    expect(assembleCartGrouped(items, [G('g1', '组 1')], 'zh')).toBe('少女，动漫风');
    expect(assembleCartGrouped(items, [G('g1', '组 1')], 'zh')).toBe(assembleCart(items, 'zh'));
  });

  it('joins multiple groups with a sentence break, ordered within each group', () => {
    const items = [gi('character', 'gender-age', '女孩', 'girl', 'g1'), gi('character', 'gender-age', '男孩', 'boy', 'g2')];
    expect(assembleCartGrouped(items, [G('g1', '组 1'), G('g2', '组 2')], 'zh')).toBe('女孩。男孩');
  });

  it('prefixes user-renamed groups but not default-named groups', () => {
    const items = [gi('character', 'gender-age', '女孩', 'girl', 'g1'), gi('character', 'gender-age', '男孩', 'boy', 'g2')];
    expect(assembleCartGrouped(items, [G('g1', '左边女孩'), G('g2', '右边男孩')], 'zh')).toBe('左边女孩：女孩。右边男孩：男孩');
    // mixed: one renamed, one default
    expect(assembleCartGrouped(items, [G('g1', '左边女孩'), G('g2', '组 2')], 'zh')).toBe('左边女孩：女孩。男孩');
  });

  it('collects negatives across all groups into a single trailing line', () => {
    const items = [
      gi('character', 'gender-age', '女孩', 'girl', 'g1'),
      gi('character', 'gender-age', '男孩', 'boy', 'g2'),
      gi('quality', 'negative-common', '低画质', 'low quality', 'g1')
    ];
    expect(assembleCartGrouped(items, [G('g1', '组 1'), G('g2', '组 2')], 'zh')).toBe('女孩。男孩。负面：低画质');
  });

  it('buckets items with no group into the default group', () => {
    const items = [gi('character', 'gender-age', '少女', 'young woman')];
    expect(assembleCartGrouped(items, [G('g1', '组 1'), G('g2', '组 2')], 'zh')).toBe('少女');
  });

  it('same fragment in two groups is kept (per-group dedupe, not global)', () => {
    const items = [gi('mood', 'warm', '微笑', 'smiling', 'g1'), gi('mood', 'warm', '微笑', 'smiling', 'g2')];
    expect(assembleCartGrouped(items, [G('g1', 'A'), G('g2', 'B')], 'zh')).toBe('A：微笑。B：微笑');
  });
});

describe('stripFences', () => {
  it('strips wrapping code fences', () => {
    expect(stripFences('```\nhello world\n```')).toBe('hello world');
    expect(stripFences('```text\nhello\n```')).toBe('hello');
  });
  it('leaves plain text untouched', () => {
    expect(stripFences('  just text  ')).toBe('just text');
  });
});
