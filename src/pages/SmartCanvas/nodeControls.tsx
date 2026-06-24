/**
 * 节点内可复用的「带图标」控件（智能画布通用）。
 * - IconChoiceGrid：图标 + 文字的按钮网格（单选高亮），替代又丑又难用的原生 <select>。
 * - AspectGlyph：按比例画一个小方框示意图（自带内联样式，任意页面可用），让用户直观看到「这个比例大概什么样」。
 * 样式见 SmartCanvas.css（前缀 mb-sc-iconchoice*）；AspectGlyph 全内联样式无需外部 CSS。
 */
import type { ReactNode, CSSProperties } from 'react';

export interface IconChoiceOption<T extends string> {
  value: T;
  label: string;
  /** emoji 字符串或自定义 ReactNode（如 AspectGlyph / SVG） */
  icon?: ReactNode;
  /** 次级说明（如分辨率括号里的像素） */
  sub?: string;
  title?: string;
  disabled?: boolean;
}

export function IconChoiceGrid<T extends string>({
  value,
  options,
  onChange,
  columns,
  compact,
  className
}: {
  value: T;
  options: IconChoiceOption<T>[];
  onChange: (v: T) => void;
  /** 固定列数；不传则按内容自动换行（auto-fill） */
  columns?: number;
  compact?: boolean;
  className?: string;
}): JSX.Element {
  const style: CSSProperties | undefined = columns
    ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }
    : undefined;
  return (
    <div className={`mb-sc-iconchoice ${compact ? 'is-compact' : ''} ${className ?? ''}`} role="group" style={style}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={`mb-sc-iconchoice-btn ${value === o.value ? 'is-active' : ''} ${o.disabled ? 'is-disabled' : ''}`}
          title={o.title ?? o.label}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
        >
          {o.icon != null ? <span className="mb-sc-iconchoice-ico">{o.icon}</span> : null}
          <span className="mb-sc-iconchoice-lbl">{o.label}</span>
          {o.sub ? <em className="mb-sc-iconchoice-sub">{o.sub}</em> : null}
        </button>
      ))}
    </div>
  );
}

/** 构图参考线 / 取景框示意图（覆盖在预览框上，实时反映当前构图选择）。镜头控制台与镜头卡片共用。 */
export function CompositionOverlay({ composition }: { composition: string }): JSX.Element | null {
  if (!composition || composition === 'none') return null;
  const stroke = 'rgba(255,255,255,0.55)';
  const common = { fill: 'none', stroke, strokeWidth: 1.2, vectorEffect: 'non-scaling-stroke' as const };
  let body: JSX.Element | null = null;
  switch (composition) {
    case 'thirds':
      body = (
        <>
          <line x1={33.3} y1={0} x2={33.3} y2={100} {...common} />
          <line x1={66.6} y1={0} x2={66.6} y2={100} {...common} />
          <line x1={0} y1={33.3} x2={100} y2={33.3} {...common} />
          <line x1={0} y1={66.6} x2={100} y2={66.6} {...common} />
        </>
      );
      break;
    case 'centered':
      body = (
        <>
          <line x1={50} y1={0} x2={50} y2={100} {...common} />
          <line x1={0} y1={50} x2={100} y2={50} {...common} />
        </>
      );
      break;
    case 'symmetry':
      body = <line x1={50} y1={0} x2={50} y2={100} {...common} />;
      break;
    case 'diagonal':
      body = <line x1={0} y1={0} x2={100} y2={100} {...common} />;
      break;
    case 'leadinglines':
      body = (
        <>
          <line x1={0} y1={100} x2={50} y2={42} {...common} />
          <line x1={100} y1={100} x2={50} y2={42} {...common} />
        </>
      );
      break;
    case 'frameinframe':
      body = <rect x={16} y={16} width={68} height={68} rx={3} {...common} />;
      break;
    case 'golden':
      body = <path d="M2 98 A 96 96 0 0 1 98 2" {...common} />;
      break;
    case 'fill':
      body = <rect x={3} y={3} width={94} height={94} rx={2} {...common} strokeDasharray="4 3" />;
      break;
    case 'negative':
      body = <rect x={58} y={58} width={34} height={34} rx={3} {...common} />;
      break;
    default:
      body = null;
  }
  return (
    <svg className="mb-sc-comp-overlay" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
      {body}
    </svg>
  );
}

/** 解析 "16:9" / "16：9" / "16x9" / "16×9" → {w,h}；解析不出回退 1:1。 */
export function parseAspect(ratio: string | { w: number; h: number }): { w: number; h: number } {
  if (typeof ratio !== 'string') {
    return ratio.w > 0 && ratio.h > 0 ? { w: ratio.w, h: ratio.h } : { w: 1, h: 1 };
  }
  const m = ratio.match(/^\s*(\d+(?:\.\d+)?)\s*[:：xX×*]\s*(\d+(?:\.\d+)?)\s*$/);
  if (m) {
    const w = parseFloat(m[1]);
    const h = parseFloat(m[2]);
    if (w > 0 && h > 0) return { w, h };
  }
  return { w: 1, h: 1 };
}

/**
 * 比例示意图：按 w:h 画一个等比小方框（长边=size）。自带内联样式，任意页面可直接用。
 * 让「16:9 / 9:16 / 1:1 …」一眼看出形状，配合尺寸/比例按钮使用。
 */
export function AspectGlyph({
  ratio,
  size = 22,
  className
}: {
  ratio: string | { w: number; h: number };
  size?: number;
  className?: string;
}): JSX.Element {
  const { w, h } = parseAspect(ratio);
  const max = Math.max(w, h);
  const bw = Math.max(4, Math.round((w / max) * size));
  const bh = Math.max(4, Math.round((h / max) * size));
  return (
    <span
      className={className}
      aria-hidden
      style={{
        width: size,
        height: size,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0
      }}
    >
      <span
        style={{
          width: bw,
          height: bh,
          borderRadius: 2,
          border: '1.6px solid currentColor',
          background: 'transparent',
          boxSizing: 'border-box'
        }}
      />
    </span>
  );
}
