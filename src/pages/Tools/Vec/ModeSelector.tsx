/**
 * 矢量化模式选择器(v3 重设计,2026-05-27)。
 *
 * 紧凑 pill 行,单行 5 模式。
 *   - Fast / Crisp / Pro / AI:统一 pill,激活态 = 高亮底色 + 加粗
 *   - Pro / AI 未实装时:小淡灰 chip + "待上线" 角标,点击给出 toast 提示
 *   - Lab(实验精修):受 useVecStore.showExperimental 控制是否渲染
 *
 * 不再使用大块按钮 + 描述卡;描述塞 title(hover 看)。视觉权重让位给 dropzone。
 */
import { useVecStore } from '@/store/vecStore';
import { toast } from '@/store/toastStore';
import type { VecMode } from '@/types/ipc';
import { ZapIcon, PencilIcon, ToolboxIcon, SparkleIcon, FlaskIcon } from '@/components/Icon';

interface ModeInfo {
  key: VecMode;
  label: string;
  shortLabel: string;
  hint: string;
  icon: typeof ZapIcon;
  experimental?: boolean;
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
  },
  {
    key: 'starvector',
    label: 'AI',
    shortLabel: 'AI',
    hint: 'StarVector-1B · 本地 AI 推理 · 适合图标 / 简单 logo / UI 图形',
    icon: SparkleIcon
  },
  {
    key: 'experimental',
    label: 'Lab',
    shortLabel: 'Lab',
    hint: '实验精修 · 自渲染拟合 · 慢但路径少 · 需在设置开启',
    icon: FlaskIcon,
    experimental: true
  }
];

export function VecModeSelector(): JSX.Element {
  const selected = useVecStore((s) => s.selectedMode);
  const setSelected = useVecStore((s) => s.setSelectedMode);
  const showExperimental = useVecStore((s) => s.showExperimental);
  const modeAvailability = useVecStore((s) => s.modeAvailability);

  const visibleModes = MODES.filter((m) => !m.experimental || showExperimental);

  return (
    <div className="mb-vec-mode-pillrow" role="tablist" aria-label="矢量化模式">
      {visibleModes.map((m) => {
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
                toast.info(`${m.label} 模式待上线`, m.hint);
                return;
              }
              setSelected(m.key);
            }}
            title={m.hint}
          >
            <Icon size={13} />
            <span className="mb-vec-mode-pill-label">{m.shortLabel}</span>
            {disabled && <span className="mb-vec-mode-pill-soon">待上线</span>}
          </button>
        );
      })}
    </div>
  );
}
