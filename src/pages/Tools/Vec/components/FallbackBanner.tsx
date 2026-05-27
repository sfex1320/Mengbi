/**
 * FallbackBanner —— 当前选中任务发生回退时,顶部横幅明确告知。
 *
 * 关键守则:UI 必须显式告诉用户「你点的是 X,实际跑的是 Y」,不许伪装。
 */
import type { VecMode } from '@/types/ipc';

interface Props {
  requestedMode: VecMode;
  actualEngine: VecMode | null;
  reason: string | null;
  reportDir?: string | null;
}

const LABEL: Record<VecMode, string> = {
  vtracer: 'Fast · VTracer',
  potrace: 'Crisp · Potrace',
  autotrace: 'Pro · AutoTrace',
  starvector: 'AI · StarVector',
  experimental: 'Lab · 实验精修'
};

export function FallbackBanner({
  requestedMode,
  actualEngine,
  reason,
  reportDir
}: Props): JSX.Element {
  return (
    <div className="mb-vec-fallback-banner" role="alert">
      <div className="mb-vec-fallback-banner-text">
        <strong>已回退</strong>
        <span>
          您选择了「{LABEL[requestedMode]}」,但实际由「
          {LABEL[actualEngine ?? 'vtracer']}」生成
          {reason ? ` —— ${reason}` : ''}。
        </span>
      </div>
      {reportDir && (
        <button
          type="button"
          className="mb-btn mb-btn-ghost mb-btn-xs"
          onClick={() => void window.electronAPI.vec.debugOpen({ reportDir })}
          title="打开 debug 目录"
        >
          查看调试
        </button>
      )}
    </div>
  );
}
