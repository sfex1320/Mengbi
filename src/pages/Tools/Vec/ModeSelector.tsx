/**
 * 矢量化模式选择器(2 模式最终态,2026-05-28)。
 *
 *   - Fast (VTracer):彩色图 / logo / 扁平插画
 *   - Crisp (Potrace):单色线稿 / 黑白 logo / 广告字
 *
 * 砍除历史:Pro(AutoTrace 上游打包 bug) + AI(StarVector 实测差) + Lab(投入产出比低)
 */
import { useVecStore } from '@/store/vecStore';
import type { VecMode } from '@/types/ipc';
import { ZapIcon, PencilIcon } from '@/components/Icon';

interface ModeInfo {
  key: VecMode;
  label: string;
  shortLabel: string;
  hint: string;
  icon: typeof ZapIcon;
}

const MODES: ModeInfo[] = [
  {
    key: 'vtracer',
    label: 'Fast',
    shortLabel: 'Fast',
    hint: 'VTracer · CPU 毫秒级 · 适合彩色 logo / 扁平插画 / 文化墙',
    icon: ZapIcon
  },
  {
    key: 'potrace',
    label: 'Crisp',
    shortLabel: 'Crisp',
    hint: 'Potrace · CPU 毫秒级 · 适合单色线稿 / 黑白 logo / 广告字',
    icon: PencilIcon
  }
];

export function VecModeSelector(): JSX.Element {
  const selected = useVecStore((s) => s.selectedMode);
  const setSelected = useVecStore((s) => s.setSelectedMode);

  return (
    <div className="mb-vec-mode-pillrow" role="tablist" aria-label="矢量化模式">
      {MODES.map((m) => {
        const Icon = m.icon;
        const active = m.key === selected;
        return (
          <button
            key={m.key}
            type="button"
            role="tab"
            aria-selected={active}
            className={`mb-vec-mode-pill ${active ? 'is-active' : ''}`}
            onClick={() => setSelected(m.key)}
            title={m.hint}
          >
            <Icon size={13} />
            <span className="mb-vec-mode-pill-label">{m.shortLabel}</span>
          </button>
        );
      })}
    </div>
  );
}
