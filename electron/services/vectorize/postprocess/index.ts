/**
 * Postprocess 流水线编排:
 *   raw → cleanSvg → statsFromSvg → repairSvg → statsFromSvg(再算) → simplifySvg → statsFromSvg(最终) → scoreSvg
 *
 * 返回 PostprocessResult,batchQueue 拿到后落盘 + 进 report.json + 决定是否回退。
 */
import type { PostprocessOptions, PostprocessResult } from '../types';
import { cleanSvg } from './svgCleaner';
import { statsFromSvg } from './svgValidator';
import { repairSvg } from './svgRepair';
import { simplifySvg } from './svgSimplifier';
import { scoreSvg } from './svgQualityScore';

export function runPostprocess(rawSvg: string, opts: PostprocessOptions = {}): PostprocessResult {
  // 1) Clean
  const cleanRes = cleanSvg(rawSvg);

  // 2) Stats on cleaned(用于决定怎么 repair)
  const intermediateStats = statsFromSvg(cleanRes.cleaned);

  // 3) Repair
  const repairRes = repairSvg(cleanRes.cleaned, intermediateStats);

  // 4) Simplify
  const simpRes = simplifySvg(repairRes.repaired, opts);

  // 5) Final stats + score
  const finalStats = statsFromSvg(simpRes.final);
  const scoreRes = scoreSvg(finalStats);

  return {
    cleaned: cleanRes.cleaned,
    repaired: repairRes.repaired,
    final: simpRes.final,
    stats: finalStats,
    score: scoreRes.score,
    tier: scoreRes.tier,
    cleanerActed: cleanRes.acted,
    repairActed: repairRes.acted,
    simplifierActed: simpRes.acted,
    scoreBreakdown: scoreRes.breakdown
  };
}

export { cleanSvg } from './svgCleaner';
export { statsFromSvg } from './svgValidator';
export { repairSvg } from './svgRepair';
export { simplifySvg } from './svgSimplifier';
export { scoreSvg, scoreToTier } from './svgQualityScore';
