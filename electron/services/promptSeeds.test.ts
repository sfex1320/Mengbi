import { describe, it, expect } from 'vitest';
import { SEED_PROMPTS, SEED_PROMPTS_V17 } from './promptSeeds';

/**
 * 锁死内置提示词数量，防止迁移条数漂移（历史上 SEED_PROMPTS 误以为 28 实为 27 → 总数少 1）。
 * 任何库最终都应恰好 36 条：v16 种 SEED_PROMPTS，v17 种 SEED_PROMPTS_V17，两者无重叠。
 */
describe('内置提示词种子数量', () => {
  it('SEED_PROMPTS = 27 条', () => {
    expect(SEED_PROMPTS.length).toBe(27);
  });
  it('SEED_PROMPTS_V17 = 9 条', () => {
    expect(SEED_PROMPTS_V17.length).toBe(9);
  });
  it('合计 36 条', () => {
    expect(SEED_PROMPTS.length + SEED_PROMPTS_V17.length).toBe(36);
  });
  it('每条都有非空 title 与 text', () => {
    for (const p of [...SEED_PROMPTS, ...SEED_PROMPTS_V17]) {
      expect(p.title.trim().length).toBeGreaterThan(0);
      expect(p.text.trim().length).toBeGreaterThan(0);
    }
  });
  it('标题不重复（避免库里出现两条同名）', () => {
    const titles = [...SEED_PROMPTS, ...SEED_PROMPTS_V17].map((p) => p.title);
    expect(new Set(titles).size).toBe(titles.length);
  });
});
