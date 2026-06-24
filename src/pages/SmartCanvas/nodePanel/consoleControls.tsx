import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useSettingsStore } from '@/store/settingsStore';
import './nodePanel.css';

/**
 * 浮层「再悬浮」：把下拉弹层 portal 到 body 用 position:fixed 定位到触发器下方，
 * 不再受父悬浮窗（生图/视频控制台、浮动检查器）的 overflow / 尺寸裁剪 —— 模型列表完整显示。
 * 自动夹进视口、空间不够则翻到触发器上方；点外部 / Esc 关闭；滚动/缩放跟随。
 */
export function PortalPopover({
  anchorRef,
  open,
  onClose,
  className,
  children
}: {
  anchorRef: React.RefObject<HTMLElement>;
  open: boolean;
  onClose: () => void;
  className?: string;
  children: ReactNode;
}): JSX.Element | null {
  const popRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const place = (): void => {
      const a = anchorRef.current;
      if (!a) return;
      const r = a.getBoundingClientRect();
      const pop = popRef.current;
      const pw = pop?.offsetWidth ?? Math.max(r.width, 360);
      const ph = pop?.offsetHeight ?? 0;
      let left = r.left;
      if (left + pw > window.innerWidth - 8) left = window.innerWidth - 8 - pw;
      if (left < 8) left = 8;
      let top = r.bottom + 4;
      if (ph && top + ph > window.innerHeight - 8 && r.top - ph - 4 > 8) top = r.top - ph - 4;
      setPos({ left, top });
    };
    place();
    const raf = requestAnimationFrame(place); // 首帧 popRef 尚无尺寸，第二帧量到真实宽高后纠正夹取/翻转
    const onMove = (): void => place();
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open, anchorRef]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent): void => {
      const t = e.target as Node;
      if (anchorRef.current?.contains(t) || popRef.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, anchorRef, onClose]);

  if (!open) return null;
  return createPortal(
    <div ref={popRef} className={className} style={{ position: 'fixed', left: pos?.left ?? -9999, top: pos?.top ?? -9999, zIndex: 4000 }}>
      {children}
    </div>,
    document.body
  );
}

/** 刷新模型列表：从 DB 重新拉取设置（在设置里新增/删除模型后，点开任意节点的模型选择器即可见最新）。 */
function refreshModels(): void {
  void useSettingsStore.getState().load();
}

/** 把「中转站 / 模型名」标签拆成两段做两色展示（前缀淡色）。无 " / " 则整串作模型名。 */
function splitModelLabel(label: string): { prov: string; name: string } {
  const i = label.indexOf(' / ');
  if (i < 0) return { prov: '', name: label };
  return { prov: label.slice(0, i), name: label.slice(i + 3) };
}

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
  /** 可选示意图标（如比例小方框 AspectGlyph），放在 label 前 */
  icon?: ReactNode;
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
          {o.icon != null ? <span className="mb-np-seg-ico">{o.icon}</span> : null}
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
  // 中央输入框走本地 text 态：编辑期可删空，失焦/回车才 clamp 提交（铁律 19）
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = (): void => {
    const n = Number(text);
    if (text.trim() === '' || Number.isNaN(n)) {
      setText(String(value));
      return;
    }
    const clamped = clamp(n);
    setText(String(clamped));
    if (clamped !== value) onChange(clamped);
  };
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
        value={text}
        min={min}
        max={max}
        onChange={(e) => setText(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
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

/** 受控数字输入：编辑时自由输入，失焦/回车才 clamp 提交（解决「每次按键即 clamp」卡手）。 */
export function ClampNumberInput({
  value,
  min,
  max,
  onCommit,
  className = 'mb-input',
  decimals = 0
}: {
  value: number;
  min: number;
  max: number;
  onCommit: (v: number) => void;
  className?: string;
  /** 保留小数位数（默认 0=整数，兼容所有既有调用方）；如裁切秒数传 1 保留 0.1s 精度 */
  decimals?: number;
}): JSX.Element {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = (): void => {
    const n = Number(text);
    if (text.trim() === '' || Number.isNaN(n)) {
      setText(String(value));
      return;
    }
    const factor = Math.pow(10, Math.max(0, decimals));
    const rounded = Math.round(n * factor) / factor;
    const clamped = Math.max(min, Math.min(max, rounded));
    setText(String(clamped));
    if (clamped !== value) onCommit(clamped);
  };
  return (
    <input
      className={className}
      type="number"
      inputMode={decimals > 0 ? 'decimal' : 'numeric'}
      step={decimals > 0 ? 1 / Math.pow(10, decimals) : 1}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
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

/** 模型项：纯字符串（value=label）或带显示名（如「中转站 / 模型」）的对象。 */
export type ModelOption = string | { value: string; label: string };

/** 绘画模型按钮组项：模型显示名 + 所属中转站/官方名（作前缀展示）。 */
export interface ModelGridItem {
  name: string;
  provider: string;
  /** 复合标识（中转站 / 名），作为实际 value 存储；缺省退回 name（旧调用兼容） */
  ref?: string;
}

/** 取一项的实际 value（复合标识优先，缺省裸名）。 */
function gridItemValue(m: ModelGridItem): string {
  return m.ref ?? m.name;
}
/** 当前值是否命中该项（复合值或旧裸名都算命中，旧存量也能正确高亮）。 */
function gridItemMatches(m: ModelGridItem, value: string): boolean {
  return gridItemValue(m) === value || m.name === value;
}

/**
 * 模型按钮组（替代下拉）：每个按钮宽度随模型名自适应、往下换行；
 * 模型名前带「中转站 / 官方名」小前缀（淡色），数量多也一目了然。
 */
export function ModelButtonGroup({
  value,
  options,
  onChange,
  emptyHint = '当前方案没有可用绘画模型，去设置页配置'
}: {
  value: string;
  options: ModelGridItem[];
  onChange: (v: string) => void;
  emptyHint?: string;
}): JSX.Element {
  if (!options.length) return <div className="mb-np-modelgrid-empty">{emptyHint}</div>;
  return (
    <div className="mb-np-modelgrid">
      {options.map((m) => (
        <button
          key={gridItemValue(m)}
          type="button"
          className={`mb-np-modelbtn ${gridItemMatches(m, value) ? 'is-active' : ''}`}
          title={m.provider ? `${m.provider} / ${m.name}` : m.name}
          onClick={() => onChange(gridItemValue(m))}
        >
          {m.provider ? <span className="mb-np-modelbtn-prov">{m.provider} /</span> : null}
          <span className="mb-np-modelbtn-name">{m.name}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * 绘画模型「下拉 + 节点式按钮」选择器：默认折叠成一个紧凑下拉（不占地方），
 * 展开后弹出节点式按钮网格（每个按钮宽度随模型名自适应、带「中转站 /」前缀），
 * 模型多时顶部带搜索。兼顾「下拉省地方」与「按钮一目了然」。
 */
export function ModelDropdownButton({
  value,
  options,
  onChange,
  placeholder = '选择绘画模型',
  emptyHint = '当前方案没有绘画模型'
}: {
  value: string;
  options: ModelGridItem[];
  onChange: (v: string) => void;
  placeholder?: string;
  emptyHint?: string;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (open) refreshModels(); // 展开时从 DB 拉最新模型列表（新增/删除立即反映）；关闭/点外部由 PortalPopover 处理
  }, [open]);
  const cur = options.find((o) => gridItemMatches(o, value));
  const ql = q.trim().toLowerCase();
  const filtered = ql
    ? options.filter((o) => o.name.toLowerCase().includes(ql) || o.provider.toLowerCase().includes(ql))
    : options;
  return (
    <div className="mb-np-modelsel" ref={rootRef}>
      <button
        type="button"
        className={`mb-np-modelsel-field ${open ? 'is-open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title={cur ? `${cur.provider} / ${cur.name}` : placeholder}
      >
        <span className="mb-np-modelsel-cur">
          {cur ? (
            <>
              {cur.provider ? <span className="mb-np-modelbtn-prov">{cur.provider} /</span> : null}
              {' '}
              {cur.name}
            </>
          ) : (
            placeholder
          )}
        </span>
        <span className="mb-np-modelsel-caret">▾</span>
      </button>
      <PortalPopover anchorRef={rootRef} open={open} onClose={() => setOpen(false)} className="mb-np-modelsel-pop mb-np-modelsel-pop-grid">
        <div className="mb-np-modelsel-search">
          {options.length > 6 ? (
            <input
              autoFocus
              className="mb-input"
              placeholder="搜索模型…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          ) : (
            <span className="mb-np-modelsel-count">{options.length} 个模型</span>
          )}
          <button
            type="button"
            className="mb-btn mb-btn-sm mb-btn-ghost mb-np-modelsel-refresh"
            title="刷新模型列表（在设置里新增/删除模型后点这里）"
            onClick={refreshModels}
          >
            ⟳
          </button>
        </div>
        {options.length === 0 ? (
          <div className="mb-np-modelsel-empty">{emptyHint}</div>
        ) : filtered.length === 0 ? (
          <div className="mb-np-modelsel-empty">无匹配模型</div>
        ) : (
          <div className="mb-np-modelgrid mb-np-modelgrid-pop">
            {filtered.map((m) => (
              <button
                key={gridItemValue(m)}
                type="button"
                className={`mb-np-modelbtn ${gridItemMatches(m, value) ? 'is-active' : ''}`}
                title={m.provider ? `${m.provider} / ${m.name}` : m.name}
                onClick={() => {
                  onChange(gridItemValue(m));
                  setOpen(false);
                  setQ('');
                }}
              >
                {m.provider ? <span className="mb-np-modelbtn-prov">{m.provider} /</span> : null}
                <span className="mb-np-modelbtn-name">{m.name}</span>
              </button>
            ))}
          </div>
        )}
      </PortalPopover>
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
  options: ModelOption[];
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
    if (open) refreshModels(); // 展开时从 DB 拉最新模型列表；关闭/点外部由 PortalPopover 处理
  }, [open]);
  const norm = options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o));
  const curLabel = norm.find((o) => o.value === value)?.label ?? value;
  const ql = q.trim().toLowerCase();
  const filtered = ql ? norm.filter((o) => o.label.toLowerCase().includes(ql) || o.value.toLowerCase().includes(ql)) : norm;
  return (
    <div className="mb-np-modelsel" ref={rootRef}>
      <div className="mb-np-modelsel-row">
        <button
          type="button"
          className={`mb-np-modelsel-field ${open ? 'is-open' : ''}`}
          onClick={() => setOpen((v) => !v)}
          title={curLabel || placeholder}
        >
          <span className="mb-np-modelsel-cur">{curLabel || placeholder}</span>
          {badge ? <em className="mb-np-modelsel-badge">{badge}</em> : null}
          <span className="mb-np-modelsel-caret">▾</span>
        </button>
        {onManage ? (
          <button type="button" className="mb-btn mb-btn-sm mb-btn-ghost mb-np-modelsel-manage" onClick={onManage}>
            模型管理
          </button>
        ) : null}
      </div>
      <PortalPopover anchorRef={rootRef} open={open} onClose={() => setOpen(false)} className="mb-np-modelsel-pop mb-np-modelsel-pop-grid">
        <div role="listbox" aria-label="模型列表" id={listId} style={{ display: 'contents' }}>
          <div className="mb-np-modelsel-search">
            <input
              autoFocus
              className="mb-input"
              placeholder="搜索模型…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <button
              type="button"
              className="mb-btn mb-btn-sm mb-btn-ghost mb-np-modelsel-refresh"
              title="刷新模型列表（在设置里新增/删除模型后点这里）"
              onClick={() => (onRefresh ?? refreshModels)()}
            >
              ⟳
            </button>
          </div>
          {filtered.length === 0 ? (
            <div className="mb-np-modelsel-empty">{norm.length === 0 ? '当前方案没有可用模型' : '无匹配模型'}</div>
          ) : (
            <div className="mb-np-modelgrid mb-np-modelgrid-pop">
              {filtered.map((o) => {
                const { prov, name } = splitModelLabel(o.label);
                return (
                  <button
                    key={o.value}
                    type="button"
                    className={`mb-np-modelbtn ${o.value === value ? 'is-active' : ''}`}
                    title={o.label}
                    onClick={() => {
                      onChange(o.value);
                      setOpen(false);
                      setQ('');
                    }}
                  >
                    {prov ? <span className="mb-np-modelbtn-prov">{prov} /</span> : null}
                    <span className="mb-np-modelbtn-name">{name}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </PortalPopover>
    </div>
  );
}
