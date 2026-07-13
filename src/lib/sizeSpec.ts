/**
 * 「尺寸来源」节点（ratio）的纯函数与预设清单（renderer，无副作用、可单测）。
 * 复用 imageModelFamilies 的像素预算/吸附函数与 imageScale 的精确比例，避免重复实现。
 */
import { snap16 } from '../types/imageModelFamilies';
import type { RatioNodeData, SizeSpec, RatioEmit } from '../types/smartCanvas';
import { exactRatio } from './imageScale';

/** preset 模式可选的比例（横 → 方 → 竖，含极宽 3:1 / 极高 1:3）。 */
export const RATIO_ASPECTS: string[] = [
  '21:9',
  '3:1',
  '16:9',
  '3:2',
  '4:3',
  '5:4',
  '1:1',
  '4:5',
  '3:4',
  '2:3',
  '9:16',
  '1:3',
  '9:21'
];

/** preset 模式可选的分辨率档（最长边约定：NK ≈ N×1024 px 最长边，见 RATIO_TIER_LONGEST）。 */
export const SIZE_TIERS: string[] = ['1K', '2K', '3K', '4K', '5K', '6K', '7K', '8K'];

/**
 * 分辨率档 → 最长边像素（最长边约定，直观且可线性扩到 8K）。
 * 注意：这里与 imageModelFamilies 的「像素预算」(TIER_PIXEL_BUDGET) 是两套——
 * 尺寸来源节点面向「任意下游」（含 ComfyUI 高清放大），最长边约定比面积预算更可预期。
 */
export const RATIO_TIER_LONGEST: Record<string, number> = {
  '1K': 1024,
  '2K': 2048,
  '3K': 3072,
  '4K': 4096,
  '5K': 5120,
  '6K': 6144,
  '7K': 7168,
  '8K': 8192
};

/** 尺寸来源节点允许的单边上限（支持到 8K；下游模型仍按各自能力再夹，如 OpenAI 路径电端 clamp 到 3840）。 */
const MAX_SIDE = 8192;

/** 仅夹到 [256, 8192]（保原值，不对齐 16）；用于「原尺寸」精确输出。 */
function clampSide(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 256;
  return Math.max(256, Math.min(MAX_SIDE, Math.round(v)));
}

/** 对齐 16 后夹到 [256, 8192]；用于 preset / custom（多数模型要求 16 对齐）。 */
function snapSide(v: number): number {
  return Math.max(256, Math.min(MAX_SIDE, snap16(v)));
}

function normTier(t: string | undefined): string {
  return t && RATIO_TIER_LONGEST[t] ? t : '2K';
}

/** 比例 + 最长边像素 → 精确宽高（16 对齐、夹到 [256,8192]）。比例非法时回退正方形。 */
function sizeFromAspectLongest(aspect: string, longest: number): { w: number; h: number } {
  const m = /^(\d+)\s*:\s*(\d+)$/.exec(aspect);
  const aw = m ? Number(m[1]) : 1;
  const ah = m ? Number(m[2]) : 1;
  if (!Number.isFinite(aw) || !Number.isFinite(ah) || aw <= 0 || ah <= 0) {
    return { w: snapSide(longest), h: snapSide(longest) };
  }
  let w: number;
  let h: number;
  if (aw >= ah) {
    w = longest;
    h = (longest * ah) / aw;
  } else {
    h = longest;
    w = (longest * aw) / ah;
  }
  return { w: snapSide(w), h: snapSide(h) };
}

/**
 * 把尺寸节点的 data 解析成它对下游的输出 SizeSpec（含输出意图 emit）。
 * - custom：宽高 snap16 + clamp[256,8192]，比例用 exactRatio 化简；非法（NaN/0/负）返 null。
 * - preset：比例(aspect) + 分辨率档(tier，最长边约定) → 反推精确宽高；字段缺失按默认（1:1 / 2K）兜底。
 * - original：取连接图原始 origW/origH（由 RatioNode 分析后回写）→ 原样输出（仅夹 [256,8192]）+ 精确比例；无图则返 null。
 */
export function ratioOutputSize(data: RatioNodeData): SizeSpec | null {
  const emit: RatioEmit = data?.emit ?? 'both';
  const mode = data?.sizeMode ?? 'preset';
  if (mode === 'custom') {
    const w0 = Number(data?.customW);
    const h0 = Number(data?.customH);
    if (!Number.isFinite(w0) || !Number.isFinite(h0) || w0 <= 0 || h0 <= 0) return null;
    const width = snapSide(w0);
    const height = snapSide(h0);
    return { aspect: exactRatio(width, height), width, height, emit };
  }
  if (mode === 'original') {
    const w0 = Number(data?.origW);
    const h0 = Number(data?.origH);
    if (!Number.isFinite(w0) || !Number.isFinite(h0) || w0 <= 0 || h0 <= 0) return null;
    // 比例按真实原始宽高化简；宽高保原值（仅夹 [256,8192]，不对齐 16，忠实「原尺寸」）
    return { aspect: exactRatio(Math.round(w0), Math.round(h0)), width: clampSide(w0), height: clampSide(h0), emit };
  }
  const aspect = data?.aspect || '1:1';
  const tier = normTier(data?.tier);
  const wh = sizeFromAspectLongest(aspect, RATIO_TIER_LONGEST[tier]);
  return { aspect, width: wh.w, height: wh.h, emit };
}

/**
 * 把宽高映射到最接近的档位（供 nano-banana 这类只认 image_size 档的模型用）。
 * 口径 = **最长边**（与本节点 RATIO_TIER_LONGEST 一致：1K=1024 / 2K=2048 / 4K=4096），平手取更大档。
 * 2026-07-14 修复：旧版按「总像素 vs TIER_PIXEL_BUDGET(面积预算)」最近匹配——面积口径下
 * 2K×16:9（2048×1152=2.36MP）反而更接近 1K 预算（1.05MP），出现「尺寸节点选 2K、实发 1K」的静默降档。
 */
export function nearestTier(width: number, height: number): '1K' | '2K' | '4K' {
  const longest = Math.max(Number(width) || 0, Number(height) || 0);
  const tiers: Array<['1K' | '2K' | '4K', number]> = [
    ['1K', 1024],
    ['2K', 2048],
    ['4K', 4096]
  ];
  let best = tiers[0];
  for (const t of tiers) {
    // <= 让平手向更大档（3072 介于 2K/4K 正中 → 4K，宁大勿降）
    if (Math.abs(longest - t[1]) <= Math.abs(longest - best[1])) best = t;
  }
  return best[0];
}

/**
 * 把高度映射到供应商支持的最接近分辨率档（如 720→'720p'）。
 * 仅识别 `NNNp` 形态的档；非 `NNNp`（如 kling 的 std/pro、sora 的 1280x720）跳过；
 * 全部不可解析时回退 supported[0] ?? '720p'。
 */
export function nearestResolution(height: number, supported: string[]): string {
  const cands = supported
    .map((s) => {
      const m = /^(\d+)p$/.exec(s.trim());
      return m ? { s, p: Number(m[1]) } : null;
    })
    .filter((x): x is { s: string; p: number } => x !== null);
  if (!cands.length) return supported[0] ?? '720p';
  let best = cands[0];
  for (const c of cands) {
    if (Math.abs(height - c.p) < Math.abs(height - best.p)) best = c;
  }
  return best.s;
}
