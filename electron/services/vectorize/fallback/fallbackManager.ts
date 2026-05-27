/**
 * FallbackManager —— 决定一个引擎调用失败后,要不要回退到哪里。
 *
 * 策略(用户清单 §12):
 *   - 用户选 vtracer:     失败 → 直接 fail(本身是兜底)
 *   - 用户选 potrace:     失败 → 回退 vtracer
 *   - 用户选 autotrace:   失败 → 回退 vtracer
 *   - 用户选 starvector:  失败 / 无效 SVG → 回退 vtracer
 *   - 用户选 experimental:失败 / 超时 → 回退 vtracer 初始化结果
 *
 * 关键守则:
 *   - 用户选了 X 但实际跑了 Y → UI 必须显示"已回退",report 必须记原因
 *   - 不允许把回退结果伪装成原模式结果(actualEngine != requestedMode 时必标红)
 */
import type { VecMode } from '../types';

/** 决定:给定 requestedMode,哪个引擎兜底? */
export function getFallbackTarget(requestedMode: VecMode): VecMode | null {
  switch (requestedMode) {
    case 'vtracer':
      return null; // 本身就是兜底,没有更兜底了
    case 'potrace':
    case 'autotrace':
    case 'starvector':
    case 'experimental':
      return 'vtracer';
    default:
      return 'vtracer';
  }
}

/** 决定:给定原引擎失败原因 + 评分,是否触发回退 */
export interface ShouldFallbackInput {
  requestedMode: VecMode;
  /** 原引擎是否成功返回了 SVG */
  engineOk: boolean;
  /** 后处理后的评分(原引擎成功的话才有) */
  qualityScore: number | null;
  /** 后处理是否得到了可见元素 */
  hasVisibleElements: boolean;
}

export interface FallbackDecision {
  fallback: boolean;
  target: VecMode | null;
  reason: string;
}

export function decideFallback(input: ShouldFallbackInput): FallbackDecision {
  const target = getFallbackTarget(input.requestedMode);
  if (target === null) {
    // vtracer 失败时不回退,直接报错
    return { fallback: false, target: null, reason: '' };
  }
  if (!input.engineOk) {
    return {
      fallback: true,
      target,
      reason: `${input.requestedMode} 引擎调用失败`
    };
  }
  if (!input.hasVisibleElements) {
    return {
      fallback: true,
      target,
      reason: `${input.requestedMode} 输出无任何可见矢量元素`
    };
  }
  if (input.qualityScore !== null && input.qualityScore < 20) {
    return {
      fallback: true,
      target,
      reason: `${input.requestedMode} 输出评分过低(${input.qualityScore}/100)`
    };
  }
  return { fallback: false, target: null, reason: '' };
}
