/**
 * ImageTypeHint —— 拖入图片后显示的「识别为 X,推荐 Y 模式」提示条。
 *
 * 数据来自 api:vec:detect-type(sharp + 启发式)。点推荐模式 chip
 * 可直接切换 selectedMode。
 */
import { useVecStore } from '@/store/vecStore';
import type { VecMode, ImageTypeTag } from '@/types/ipc';

const TAG_LABEL: Record<ImageTypeTag, string> = {
  'bw-lineart': '黑白线稿',
  'mono-logo': '单色 logo',
  'color-logo': '彩色 logo',
  'flat-illustration': '扁平插画',
  icon: '图标',
  'complex-photo': '复杂照片',
  'gradient-photo': '渐变/光影',
  'text-image': '文字图',
  'transparent-bg': '透明背景'
};

const MODE_LABEL: Record<VecMode, string> = {
  vtracer: 'Fast',
  potrace: 'Crisp',
  autotrace: 'Pro'
};

export function ImageTypeHint(): JSX.Element | null {
  const hint = useVecStore((s) => s.lastImageHint);
  const selectedMode = useVecStore((s) => s.selectedMode);
  const setSelectedMode = useVecStore((s) => s.setSelectedMode);
  if (!hint) return null;

  return (
    <div className="mb-vec-image-hint" role="status">
      <span className="mb-vec-image-hint-tag">{TAG_LABEL[hint.tag]}</span>
      <span className="mb-vec-image-hint-reason">{hint.reasonZh}</span>
      <div className="mb-vec-image-hint-modes">
        {hint.recommendedModes.slice(0, 3).map((m) => (
          <button
            key={m}
            type="button"
            className={`mb-vec-image-hint-mode ${selectedMode === m ? 'is-active' : ''}`}
            onClick={() => setSelectedMode(m)}
            title={`切换到 ${MODE_LABEL[m]} 模式`}
          >
            {MODE_LABEL[m]}
          </button>
        ))}
      </div>
    </div>
  );
}
