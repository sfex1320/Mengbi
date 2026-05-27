/**
 * 矢量化模式选择器(v3 + AI 清理,2026-05-28)。
 *
 * 紧凑 pill 行,单行 3 模式。
 *   - Fast / Crisp:CPU 算法,永远可用
 *   - Pro:AutoTrace spawn exe,需用户安装(probe 判断)
 *
 * 砍除:AI · 精准(StarVector)+ Lab · 实验精修
 * 理由:VLM 生成 SVG 实测效果差,产品价值低于工程化的 3 模式。
 */
import { useVecStore } from '@/store/vecStore';
import { toast } from '@/store/toastStore';
import type { VecMode } from '@/types/ipc';
import { ZapIcon, PencilIcon, ToolboxIcon } from '@/components/Icon';

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
  },
  {
    key: 'autotrace',
    label: 'Pro',
    shortLabel: 'Pro',
    hint: 'AutoTrace · 显式色数量化 · 适合 logo 重绘 / 印刷 EPS',
    icon: ToolboxIcon
  }
];

export function VecModeSelector(): JSX.Element {
  const selected = useVecStore((s) => s.selectedMode);
  const setSelected = useVecStore((s) => s.setSelectedMode);
  const modeAvailability = useVecStore((s) => s.modeAvailability);

  return (
    <div className="mb-vec-mode-pillrow" role="tablist" aria-label="矢量化模式">
      {MODES.map((m) => {
        const Icon = m.icon;
        const active = m.key === selected;
        const disabled = modeAvailability[m.key] !== true;
        return (
          <button
            key={m.key}
            type="button"
            role="tab"
            aria-selected={active}
            aria-disabled={disabled}
            className={`mb-vec-mode-pill ${active ? 'is-active' : ''} ${disabled ? 'is-disabled' : ''}`}
            onClick={() => {
              if (disabled) {
                toast.info(`${m.label} 未就绪`, m.hint);
                return;
              }
              setSelected(m.key);
            }}
            title={m.hint}
          >
            <Icon size={13} />
            <span className="mb-vec-mode-pill-label">{m.shortLabel}</span>
            {disabled && <span className="mb-vec-mode-pill-soon">未就绪</span>}
          </button>
        );
      })}
    </div>
  );
}
