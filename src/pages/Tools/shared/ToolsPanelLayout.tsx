/**
 * ToolsPanelLayout —— 3 个工具箱面板共用的左右双卡骨架。
 *
 * 用法:
 *   <ToolsPanelLayout
 *     header={<头部:标题 / 状态 chip / 全局动作>}
 *     left={<输入卡内容>}
 *     right={<输出卡内容>}
 *   />
 *
 * 视觉:跟图像转矢量(vec)面板保持一致 —— 顶栏 + 左 380 / 右 1fr 网格。
 */
import type { ReactNode } from 'react';

interface Props {
  header: ReactNode;
  left: ReactNode;
  right: ReactNode;
  /** 抽屉 / 弹窗等 floating 内容(绝对定位在卡片层级) */
  floating?: ReactNode;
}

export function ToolsPanelLayout({ header, left, right, floating }: Props): JSX.Element {
  return (
    <div className="mb-tlx">
      <header className="mb-tlx-header">{header}</header>
      <div className="mb-tlx-main">
        <section className="mb-tlx-left">{left}</section>
        <section className="mb-tlx-right">{right}</section>
      </div>
      {floating}
    </div>
  );
}

/** 输入卡片容器(可滚动) */
export function InputCardShell({ children }: { children: ReactNode }): JSX.Element {
  return <div className="mb-tlx-input-card">{children}</div>;
}

/** 输出卡片容器(可滚动) */
export function OutputCardShell({
  children,
  state
}: {
  children: ReactNode;
  state?: 'empty' | 'progress' | 'result';
}): JSX.Element {
  const stateClass = state ? `is-${state}` : '';
  return <div className={`mb-tlx-output-card ${stateClass}`}>{children}</div>;
}

/** 提示区 / 顶部 banner */
export function PanelBanner({
  tone = 'info',
  children
}: {
  tone?: 'info' | 'warn' | 'error' | 'ok';
  children: ReactNode;
}): JSX.Element {
  return <div className={`mb-tlx-banner is-${tone}`}>{children}</div>;
}

/** 一行紧凑参数 — label + 控件 */
export function Field({
  label,
  hint,
  children
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <label className="mb-tlx-field">
      <span className="mb-tlx-field-label">{label}</span>
      <div className="mb-tlx-field-body">{children}</div>
      {hint && <span className="mb-tlx-field-hint">{hint}</span>}
    </label>
  );
}

/** 多选段(SegmentedControl) — 3-5 个互斥选项的紧凑替代 */
export function Segmented<T extends string>({
  value,
  onChange,
  options
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string; hint?: string }>;
}): JSX.Element {
  return (
    <div className="mb-tlx-seg">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={`mb-tlx-seg-item ${o.value === value ? 'is-active' : ''}`}
          onClick={() => onChange(o.value)}
          title={o.hint}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
