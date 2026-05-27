/**
 * EngineBadge —— 显示「用户选择 vs 实际输出」双行 chip。
 *
 * 关键守则(用户清单 §3 / §10):
 *   - actualEngine == requestedMode → 单 chip,绿色低调
 *   - actualEngine != requestedMode → 双行 chip + 红框,提示已回退
 *   - actualEngine == null(运行中)→ 只显示 requestedMode
 *
 * 不允许伪装 —— 这是 UI 层的核心承诺。
 */
import type { VecMode } from '@/types/ipc';

interface Props {
  requestedMode: VecMode;
  actualEngine: VecMode | null;
  fellBack: boolean;
  fallbackReason?: string | null;
  /** 'sm' = chip;'md' = chip + 二行文字。 */
  size?: 'sm' | 'md';
}

const SHORT: Record<VecMode, string> = {
  vtracer: 'VTracer',
  potrace: 'Potrace'
};

export function EngineBadge({
  requestedMode,
  actualEngine,
  fellBack,
  fallbackReason,
  size = 'sm'
}: Props): JSX.Element {
  if (!fellBack) {
    const m = actualEngine ?? requestedMode;
    return (
      <span className={`mb-vec-engine-badge is-${m}`} title={`引擎: ${SHORT[m]}`}>
        {SHORT[m]}
      </span>
    );
  }
  // 回退
  const inner = (
    <>
      <span className={`mb-vec-engine-badge is-fallback is-${requestedMode}`}>
        想用 {SHORT[requestedMode]}
      </span>
      <span className="mb-vec-engine-arrow">→</span>
      <span className={`mb-vec-engine-badge is-actual is-${actualEngine ?? 'vtracer'}`}>
        实际 {SHORT[actualEngine ?? 'vtracer']}
      </span>
    </>
  );
  if (size === 'md') {
    return (
      <div
        className="mb-vec-engine-badge-pair is-fellback"
        title={fallbackReason ?? '已回退到 VTracer'}
      >
        {inner}
      </div>
    );
  }
  return (
    <span className="mb-vec-engine-badge-pair is-fellback is-sm" title={fallbackReason ?? ''}>
      {inner}
    </span>
  );
}
