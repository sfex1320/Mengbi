import { describe, it, expect } from 'vitest';
import { buildThumbGenPrompt, thumbStyleOf, THUMB_SEED } from './thumbGen';

const card = (cat: string, genPrompt: string, en = '', zh = ''): { cat: string; genPrompt: string; en: string; zh: string } => ({ cat, genPrompt, en, zh });

describe('thumbStyleOf', () => {
  it('maps categories to profiles', () => {
    expect(thumbStyleOf('character')).toBe('isolated');
    expect(thumbStyleOf('clothing')).toBe('isolated');
    expect(thumbStyleOf('material')).toBe('isolated');
    expect(thumbStyleOf('environment')).toBe('scene');
    expect(thumbStyleOf('nature-arch')).toBe('scene');
    expect(thumbStyleOf('interior')).toBe('scene');
    expect(thumbStyleOf('art-style')).toBe('demo');
    expect(thumbStyleOf('lighting')).toBe('demo');
    expect(thumbStyleOf('quality')).toBe('demo');
  });
  it('falls back to isolated for unknown categories', () => {
    expect(thumbStyleOf('__unknown')).toBe('isolated');
  });
});

describe('buildThumbGenPrompt', () => {
  it('isolated profile adds the grey studio suffix', () => {
    const out = buildThumbGenPrompt(card('character', 'close-up of a young woman with monolid eyes'));
    expect(out).toContain('close-up of a young woman with monolid eyes');
    expect(out).toContain('seamless light grey studio background');
    expect(out).toContain('photorealistic');
  });

  it('scene profile keeps the scene (no grey isolation)', () => {
    const out = buildThumbGenPrompt(card('environment', 'a tall waterfall cascading over mossy rocks'));
    expect(out).toContain('a tall waterfall cascading over mossy rocks');
    expect(out).not.toContain('seamless light grey studio background');
    expect(out).toContain('professional photography');
  });

  it('demo profile uses the minimal suffix (no forced realism/background)', () => {
    const out = buildThumbGenPrompt(card('art-style', 'a young woman bust portrait in watercolor style'));
    expect(out).toContain('watercolor style');
    expect(out).not.toContain('seamless light grey studio background');
    expect(out).not.toContain('photorealistic');
    expect(out).toContain('high quality');
  });

  it('is idempotent for the isolated profile (does not double-wrap)', () => {
    const once = buildThumbGenPrompt(card('character', 'a young man portrait'));
    const twice = buildThumbGenPrompt(card('character', once));
    expect(twice).toBe(once);
  });

  it('falls back to en then zh when genPrompt is empty', () => {
    expect(buildThumbGenPrompt(card('character', '', 'red lipstick'))).toContain('red lipstick');
    expect(buildThumbGenPrompt(card('character', '', '', '红唇'))).toContain('红唇');
  });

  it('scrubs animal-idiom and shape-as-object leftovers', () => {
    expect(buildThumbGenPrompt(card('character', 'portrait with upturned feline cat eyes'))).toContain('upturned almond eyes with lifted outer corners');
    expect(buildThumbGenPrompt(card('character', 'portrait with cat eyes'))).toContain('upturned almond eyes');
    expect(buildThumbGenPrompt(card('character', 'portrait with puppy eyes'))).toContain('gentle downturned eyes');
    const heart = buildThumbGenPrompt(card('character', 'a heart-shaped face'));
    expect(heart).not.toContain('heart-shaped face');
    expect(heart).toContain('wide forehead');
  });

  it('exports a fixed seed', () => {
    expect(typeof THUMB_SEED).toBe('number');
  });
});
