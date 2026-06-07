import { useEffect, useId, useRef, useState } from 'react';
import './nodePanel.css';

/**
 * 横向控制台用的可复用基础控件：
 * - SegmentedControl：按钮组（单选高亮）
 * - StepperInput：数字步进器（− 值 +）
 * - ColorTagPicker：颜色分类色块 + 添加
 * - SearchableModelSelect：可搜索的下拉（左缩略标签、刷新、管理）
 * 这些控件无业务逻辑、纯受控，便于其它节点类型复用。样式见 nodePanel.css（前缀 mb-np-*）。
 */

export interface SegOption<T extends string> {
  value: T;
  label: string;
  /** 次级说明（如分辨率括号里的像素） */
  sub?: string;
  title?: string;
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  size = 'md'
}: {
  value: T;
  options: SegOption<T>[];
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
}): JSX.Element {
  return (
    <div className={`mb-np-seg ${size === 'sm' ? 'is-sm' : ''}`} role="group">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={`mb-np-seg-btn ${value === o.value ? 'is-active' : ''}`}
          title={o.title ?? o.label}
          onClick={() => onChange(o.value)}
        >
          <span>{o.label}</span>
          {o.sub ? <em className="mb-np-seg-sub">{o.sub}</em> : null}
        </button>
      ))}
    </div>
  );
}

export function StepperInput({
  value,
  min = 1,
  max = 99,
  onChange
}: {
  value: number;
  min?: number;
  max?: number;
  onChange: (v: number) => void;
}): JSX.Element {
  const clamp = (n: number): number => Math.max(min, Math.min(max, Math.round(n)));
  return (
    <div className="mb-np-stepper">
      <button
        type="button"
        className="mb-np-stepper-btn"
        title="减少"
        disabled={value <= min}
        onClick={() => onChange(clamp(value - 1))}
      >
        −
      </button>
      <input
        className="mb-np-stepper-val"
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(clamp(Number(e.target.value) || min))}
      />
      <button
        type="button"
        className="mb-np-stepper-btn"
        title="增加"
        disabled={value >= max}
        onClick={() => onChange(clamp(value + 1))}
      >
        +
      </button>
    </div>
  );
}

export function ColorTagPicker({
  value,
  colors,
  onChange
}: {
  value?: string;
  colors: string[];
  onChange: (c: string) => void;
}): JSX.Element {
  return (
    <div className="mb-np-tags">
      {colors.map((c) => (
        <button
          key={c}
          type="button"
          className={`mb-np-tag ${value === c ? 'is-active' : ''}`}
          style={{ background: c }}
          title="颜色分类"
          onClick={() => onChange(value === c ? '' : c)}
        />
      ))}
    </div>
  );
}

export function SearchableModelSelect({
  value,
  options,
  placeholder = '（选择模型）',
  badge,
  onChange,
  onRefresh,
  onManage
}: {
  value: string;
  options: string[];
  placeholder?: string;
  /** 当前选中项右侧的小标签（如模型类型） */
  badge?: string;
  onChange: (v: string) => void;
  onRefresh?: () => void;
  onManage?: () => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listId = useId();
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDoc);
    return () => window.removeEventListener('mousedown', onDoc);
  }, [open]);
  const filtered = q.trim() ? options.filter((o) => o.toLowerCase().includes(q.trim().toLowerCase())) : options;
  return (
    <div className="mb-np-modelsel" ref={rootRef}>
      <div className="mb-np-modelsel-row">
        <button
          type="button"
          className="mb-np-modelsel-field"
          onClick={() => setOpen((v) => !v)}
          title={value || placeholder}
        >
          <span className="mb-np-modelsel-cur">{value || placeholder}</span>
          {badge ? <em className="mb-np-modelsel-badge">{badge}</em> : null}
          <span className="mb-np-modelsel-caret">▾</span>
        </button>
        {onManage ? (
          <button type="button" className="mb-btn mb-btn-sm mb-btn-ghost mb-np-modelsel-manage" onClick={onManage}>
            模型管理
          </button>
        ) : null}
      </div>
      {open ? (
        <div className="mb-np-modelsel-pop" role="listbox" aria-label="模型列表" id={listId}>
          <div className="mb-np-modelsel-search">
            <input
              autoFocus
              className="mb-input"
              placeholder="搜索模型…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            {onRefresh ? (
              <button type="button" className="mb-btn mb-btn-sm mb-btn-ghost" title="刷新模型列表" onClick={onRefresh}>
                ⟳
              </button>
            ) : null}
          </div>
          <div className="mb-np-modelsel-list">
            {filtered.length === 0 ? (
              <div className="mb-np-modelsel-empty">无匹配模型</div>
            ) : (
              filtered.map((o) => (
                <button
                  key={o}
                  type="button"
                  className={`mb-np-modelsel-opt ${o === value ? 'is-active' : ''}`}
                  onClick={() => {
                    onChange(o);
                    setOpen(false);
                    setQ('');
                  }}
                >
                  {o}
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
