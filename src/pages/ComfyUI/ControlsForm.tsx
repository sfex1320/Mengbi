import { useRef, useState } from 'react';
import { useComfyuiStore } from '@/store/comfyuiStore';
import { CustomSelect } from '@/components/CustomSelect';
import { confirmDialog } from '@/components/ConfirmDialog';
import { toast } from '@/store/toastStore';
import { nodeNameZh } from './nodeLabels';
import type { InputControl } from '@shared/comfyui';

/**
 * 参数面板：按「绑定的节点」分组成卡片，一行 3 张（响应式）。
 * 每个控件标题可重命名；可一键移除（解绑）。
 */
export function ControlsForm(): JSX.Element {
  const {
    activeControls,
    activeBindings,
    activeGraph,
    controlValues,
    cardOrder,
    setControlValue,
    renameControl,
    removeControl,
    moveCard
  } = useComfyuiStore();
  const [dragNid, setDragNid] = useState<string | null>(null);

  if (activeControls.length === 0) {
    return (
      <div className="mb-cfy-form-empty">
        导入工作流后，这里会自动按节点列出可调参数（也可在节点图里手动绑定）。
      </div>
    );
  }

  // 控件 → 所属节点 id
  const nodeOf = new Map<string, string>();
  for (const b of activeBindings) {
    if (b.mode === 'parameter' || b.mode === 'file_upload') nodeOf.set(b.controlId, b.nodeId);
  }
  // 按节点分组（保持控件原顺序）
  const order: string[] = [];
  const groups = new Map<string, InputControl[]>();
  for (const c of activeControls) {
    const nid = nodeOf.get(c.id) ?? '__other__';
    if (!groups.has(nid)) {
      groups.set(nid, []);
      order.push(nid);
    }
    groups.get(nid)!.push(c);
  }

  const cardTitle = (nid: string): string => {
    if (nid === '__other__') return '其它';
    const node = activeGraph?.nodes.find((n) => n.id === nid);
    return node ? `${nodeNameZh(node.classType)} · #${nid}` : `节点 #${nid}`;
  };

  // 展示顺序：cardOrder 里有的按其序在前，其余新分组按自然顺序补后面
  const displayOrder = [
    ...cardOrder.filter((n) => order.includes(n)),
    ...order.filter((n) => !cardOrder.includes(n))
  ];

  return (
    <div className="mb-cfy-cards">
      {displayOrder.map((nid) => (
        <div
          key={nid}
          className={`mb-cfy-card ${dragNid === nid ? 'is-dragging' : ''}`}
          onDragOver={(e) => {
            if (dragNid && dragNid !== nid) e.preventDefault();
          }}
          onDrop={() => {
            if (dragNid && dragNid !== nid) moveCard(dragNid, nid);
            setDragNid(null);
          }}
        >
          <div
            className="mb-cfy-card-title"
            draggable
            onDragStart={() => setDragNid(nid)}
            onDragEnd={() => setDragNid(null)}
            title="按住标题拖动可调整卡片顺序"
          >
            <span className="mb-cfy-card-grip">⠿</span>
            {cardTitle(nid)}
          </div>
          {groups.get(nid)!.map((c) => (
            <div key={c.id} className="mb-cfy-card-field">
              <div className="mb-cfy-card-fieldhead">
                <input
                  className="mb-cfy-label-edit"
                  value={c.label}
                  onChange={(e) => renameControl(c.id, e.target.value)}
                  title="点这里可重命名该控件"
                />
                <button
                  className="mb-cfy-field-remove"
                  onClick={async () => {
                    if (await confirmDialog({ message: `移除控件「${c.label}」（解绑该字段）？`, danger: true }))
                      removeControl(c.id);
                  }}
                  title="移除该控件（解绑）"
                >
                  ✕
                </button>
              </div>
              <ControlWidget
                control={c}
                value={controlValues[c.id]}
                onChange={(v) => setControlValue(c.id, v)}
              />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** 只渲染输入控件本体（标题/重命名由外层卡片负责）。 */
function ControlWidget({
  control: c,
  value,
  onChange
}: {
  control: InputControl;
  value: unknown;
  onChange: (v: unknown) => void;
}): JSX.Element {
  const str = value == null ? '' : String(value);

  if (c.type === 'image' || c.type === 'mask' || c.type === 'multi_image' || c.type === 'video' || c.type === 'audio' || c.type === 'file') {
    return <FileControlField kind={c.type} value={value} onChange={onChange} />;
  }

  if (c.type === 'prompt' || c.type === 'textarea') {
    return (
      <textarea className="mb-textarea mb-cfy-prompt" value={str} onChange={(e) => onChange(e.target.value)} />
    );
  }

  if (c.type === 'slider') {
    const num = Number(value ?? c.default ?? 0);
    return (
      <div className="mb-cfy-slider-row">
        <input
          type="range"
          className="mb-cfy-slider"
          min={c.min ?? 0}
          max={c.max ?? 100}
          step={c.step ?? 1}
          value={num}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <span className="mb-cfy-slider-val">{num}</span>
      </div>
    );
  }

  if (c.type === 'number') {
    return (
      <input
        type="number"
        className="mb-input"
        min={c.min}
        max={c.max}
        step={c.step}
        value={str}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    );
  }

  if (c.type === 'seed') {
    return (
      <div className="mb-cfy-seed-row">
        <input type="number" className="mb-input" value={str} onChange={(e) => onChange(Number(e.target.value))} />
        <button type="button" className="mb-btn mb-btn-sm mb-btn-ghost" onClick={() => onChange(-1)}>
          随机
        </button>
      </div>
    );
  }

  if (c.type === 'switch') {
    return (
      <label className="mb-cfy-field-switch">
        <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
        <span className="mb-label">开 / 关</span>
      </label>
    );
  }

  if (c.type === 'select' && c.options) {
    return (
      <CustomSelect value={str} onChange={(v) => onChange(v)} options={c.options} placeholder="选择…" />
    );
  }

  return <input className="mb-input" value={str} onChange={(e) => onChange(e.target.value)} />;
}

const ACCEPT: Record<string, string> = {
  image: 'image/*',
  mask: 'image/*',
  multi_image: 'image/*',
  video: 'video/*',
  audio: 'audio/*',
  file: '.psd,.tiff,.tif,application/octet-stream,*/*'
};

function FileControlField({
  kind,
  value,
  onChange
}: {
  kind: string;
  value: unknown;
  onChange: (v: unknown) => void;
}): JSX.Element {
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const dataUri = typeof value === 'string' && value.startsWith('data:') ? value : null;
  const isImg = kind === 'image' || kind === 'mask' || kind === 'multi_image';

  function load(file: File | null | undefined): void {
    if (!file) return;
    if (isImg && !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => onChange(reader.result as string);
    reader.onerror = () => toast.error('文件读取失败', file.name); // 原先无 onerror → 大文件/无权限时界面无反应
    reader.readAsDataURL(file);
  }
  // 拖入
  function onDrop(e: React.DragEvent): void {
    e.preventDefault();
    setDragOver(false);
    load(e.dataTransfer.files?.[0]);
  }
  // 粘贴（作用域内：聚焦本控件后 Ctrl+V，避免多个图片控件被同一次粘贴同时填充）
  function onPaste(e: React.ClipboardEvent): void {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const it of Array.from(items)) {
      if (it.kind === 'file' && (!isImg || it.type.startsWith('image/'))) {
        load(it.getAsFile());
        e.preventDefault();
        return;
      }
    }
  }

  const pickLabel =
    kind === 'video' ? '选择视频' : kind === 'audio' ? '选择音频' : kind === 'file' ? '选择文件(PSD等)' : '选择图片';

  return (
    <div className="mb-cfy-image-ctrl">
      {dataUri ? (
        <div className="mb-cfy-image-preview">
          {isImg ? (
            <img src={dataUri} alt="" />
          ) : kind === 'video' ? (
            <video src={dataUri} className="mb-cfy-file-preview" />
          ) : kind === 'audio' ? (
            <audio src={dataUri} controls className="mb-cfy-file-preview" />
          ) : (
            <div className="mb-cfy-file-chip">已选择文件</div>
          )}
          <button type="button" className="mb-cfy-image-clear" onClick={() => onChange('')}>
            ✕
          </button>
        </div>
      ) : (
        <div
          className={`mb-cfy-droparea ${dragOver ? 'is-over' : ''}`}
          tabIndex={0}
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onPaste={onPaste}
          title="点击选择 · 拖入文件 · 选中此处后 Ctrl+V 粘贴"
        >
          <span className="mb-cfy-droparea-main">{pickLabel}</span>
          <span className="mb-cfy-droparea-sub">拖入 / 点击{isImg ? ' / 粘贴' : ''}</span>
        </div>
      )}
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT[kind] ?? '*/*'}
        style={{ display: 'none' }}
        onChange={(e) => {
          load(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </div>
  );
}
