import { useEffect, useState } from 'react';
import { useCanvasStore, layerDisplaySrc, isEffectivelyVisible, isEffectivelyLocked } from '@/store/canvasStore';
import { makeLayerThumbnail } from './canvasEngine/thumbnail';
import { EyeIcon, EyeOffIcon, KeyIcon, TrashIcon, FolderIcon, PlusIcon } from '@/components/Icon';
import type { Layer } from './types';
import { makeShapeLayer } from './types';
import { mergeLayers } from './canvasEngine/layerOps';
import { openLayerContextMenu, type CanvasMenuHandlers } from './contextMenu';
import { confirmDialog } from '@/components/ConfirmDialog';
import { toast } from '@/store/toastStore';

/** EyeDropper 浏览器 API（Chromium/Electron 支持，但未进 TS lib）的最小类型 */
interface EyeDropperResult {
  sRGBHex: string;
}
interface EyeDropperCtor {
  new (): { open(): Promise<EyeDropperResult> };
}

/**
 * 图层面板支持：
 *   - 缩略图、显隐、锁定、双击重命名
 *   - 拖拽重排（before/after，支持把图层拖入组）
 *   - 多选（Shift+click）
 *   - 图层组（折叠 / 展开 / 解散）
 *
 * 顶层显示顺序：z 高（数组末尾）在视觉上方。
 * 组内 child 按 parent 顺序显示在 parent 下方（缩进）。
 */
const MAX_CANVAS_SIZE = 4096;

interface LayerPanelProps {
  menuHandlers: CanvasMenuHandlers;
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomTo100: () => void;
  onFitScreen: () => void;
  lockToSelected: boolean;
  onToggleLockToSelected: () => void;
  onCanvasProps: () => void;
}

export function LayerPanel({
  menuHandlers,
  zoom,
  onZoomIn,
  onZoomOut,
  onZoomTo100,
  onFitScreen,
  lockToSelected,
  onToggleLockToSelected,
  onCanvasProps
}: LayerPanelProps): JSX.Element {
  const project = useCanvasStore((s) => s.project);
  const select = useCanvasStore((s) => s.selectLayer);
  const toggleSelect = useCanvasStore((s) => s.toggleLayerInSelection);
  const update = useCanvasStore((s) => s.updateLayer);
  const remove = useCanvasStore((s) => s.removeLayer);
  const reorder = useCanvasStore((s) => s.reorderLayers);
  const setParent = useCanvasStore((s) => s.setLayerParent);
  const toggleCollapsed = useCanvasStore((s) => s.toggleGroupCollapsed);
  const groupSelected = useCanvasStore((s) => s.groupSelectedLayers);
  const ungroup = useCanvasStore((s) => s.ungroupLayer);
  const addLayer = useCanvasStore((s) => s.addLayer);
  const createBrushLayer = useCanvasStore((s) => s.createBrushLayer);
  const removeLayers = useCanvasStore((s) => s.removeLayers);
  const fitCanvasToLayer = useCanvasStore((s) => s.fitCanvasToLayer);

  const selLayer = project.layers.find((l) => l.id === project.selectedId) ?? null;
  const canFit = !!selLayer && !selLayer.isGroup;

  const footer = (
    <div className="mb-canvas-layers-footer">
      <div className="mb-canvas-layers-footrow">
        <button type="button" className="mb-canvas-layer-foot-btn" onClick={onZoomOut} title="缩小（Ctrl + -）">
          −
        </button>
        <span className="mb-canvas-foot-zoom">{Math.round(zoom * 100)}%</span>
        <button type="button" className="mb-canvas-layer-foot-btn" onClick={onZoomIn} title="放大（Ctrl + +）">
          +
        </button>
        <button type="button" className="mb-canvas-layer-foot-btn" onClick={onZoomTo100} title="实际大小 100%（Ctrl + 0）">
          1:1
        </button>
        <button type="button" className="mb-canvas-layer-foot-btn" onClick={onFitScreen} title="适合屏幕（Z）">
          ⤢ 适合
        </button>
      </div>
      <div className="mb-canvas-layers-footrow">
        <button
          type="button"
          className="mb-canvas-layer-foot-btn"
          disabled={!canFit}
          onClick={() => selLayer && fitCanvasToLayer(selLayer.id, MAX_CANVAS_SIZE)}
          title="画布贴合选中图层：画布尺寸 1:1 改成该图层大小"
        >
          贴合
        </button>
        <button
          type="button"
          className={`mb-canvas-layer-foot-btn ${lockToSelected ? 'is-active' : ''}`}
          onClick={onToggleLockToSelected}
          title="仅移动当前图层：开启后只有选中的图层能被点击 / 拖动"
        >
          仅此层
        </button>
        <button type="button" className="mb-canvas-layer-foot-btn" onClick={onCanvasProps} title="画板：取消选中，在右侧编辑画布尺寸 / 背景">
          画板
        </button>
        <button
          type="button"
          className="mb-canvas-layer-foot-btn is-danger"
          onClick={() => void clearAllLayers()}
          title="清空所有图层"
          disabled={project.layers.length === 0}
        >
          清空
        </button>
      </div>
    </div>
  );

  function addSolidLayer(color: string): void {
    addLayer(
      makeShapeLayer({ kind: 'rect', x: 0, y: 0, width: project.width, height: project.height, fillColor: color, strokeWidth: 0 })
    );
    toast.success('已新建纯色图层');
  }

  async function clearAllLayers(): Promise<void> {
    if (project.layers.length === 0) return;
    const ok = await confirmDialog({
      title: '清空所有图层',
      message: '当前所有图层都会被移除（画布尺寸保留），可用 Ctrl+Z 撤销。',
      okText: '清空',
      danger: true
    });
    if (ok) removeLayers(project.layers.map((l) => l.id));
  }

  const [solidOpen, setSolidOpen] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; pos: 'before' | 'after' | 'inside' } | null>(null);

  // 构造可视顺序：顶级 → 自身 + 递归 children；顶级按 z 倒序（数组末尾在最上）
  const flat = flattenForDisplay(project.layers);

  function handleDrop(targetId: string, pos: 'before' | 'after' | 'inside'): void {
    if (!dragId || dragId === targetId) {
      setDragId(null);
      setDropTarget(null);
      return;
    }
    const fromReal = project.layers.findIndex((l) => l.id === dragId);
    const target = project.layers.find((l) => l.id === targetId);
    if (fromReal < 0 || !target) {
      setDragId(null);
      setDropTarget(null);
      return;
    }

    // pos === 'inside' && target 是组：把 dragId 设为 target 的 child
    if (pos === 'inside' && target.isGroup) {
      setParent(dragId, target.id);
      setDragId(null);
      setDropTarget(null);
      return;
    }

    // 否则只是排序：跟 target 同 parent，且按 before/after 决定 z
    const targetReal = project.layers.findIndex((l) => l.id === targetId);
    setParent(dragId, target.parentId ?? null);
    let toReal = pos === 'before' ? targetReal + 1 : targetReal;
    if (fromReal < toReal) toReal -= 1;
    if (toReal !== fromReal) reorder(fromReal, toReal);
    setDragId(null);
    setDropTarget(null);
  }

  const headerActions = (
    <div style={{ display: 'flex', gap: 4 }}>
      <button
        type="button"
        className="mb-canvas-layer-icon-btn"
        onClick={() => createBrushLayer('图层')}
        title="新建空白图层"
      >
        <PlusIcon size={14} />
      </button>
      <button
        type="button"
        className="mb-canvas-layer-icon-btn"
        onClick={() => setSolidOpen(true)}
        title="新建纯色图层（吸管 / 颜色值）"
      >
        ■
      </button>
    </div>
  );

  if (project.layers.length === 0) {
    return (
      <div className="mb-canvas-layers">
        <div className="mb-canvas-layers-header">
          <h3>图层</h3>
          {headerActions}
        </div>
        <div className="mb-canvas-layers-empty">
          画板为空 —<br />
          点击工具条「图片」添加，<br />
          或拖图片到画布，或新建图层
        </div>
        {footer}
        {solidOpen && <SolidColorDialog onClose={() => setSolidOpen(false)} onConfirm={addSolidLayer} />}
      </div>
    );
  }

  const selectedIds = project.selectedIds ?? [];
  const selectedCount = selectedIds.length;

  return (
    <div className="mb-canvas-layers">
      <div className="mb-canvas-layers-header">
        <h3>
          图层 · {project.layers.length}
          {selectedCount > 1 ? ` (选中 ${selectedCount})` : ''}
        </h3>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            type="button"
            className="mb-canvas-layer-icon-btn"
            onClick={() => createBrushLayer('图层')}
            title="新建空白图层"
          >
            <PlusIcon size={14} />
          </button>
          <button
            type="button"
            className="mb-canvas-layer-icon-btn"
            onClick={() => setSolidOpen(true)}
            title="新建纯色图层（吸管 / 颜色值）"
          >
            ■
          </button>
          <button
            type="button"
            className="mb-canvas-layer-icon-btn"
            onClick={() => void mergeLayers(selectedIds)}
            title="合并所选为一张图"
            disabled={selectedCount < 2}
          >
            ⬓
          </button>
          <button
            type="button"
            className="mb-canvas-layer-icon-btn"
            onClick={() => groupSelected('组')}
            title="组合所选（Ctrl+G）"
            disabled={selectedCount < 2}
          >
            <FolderIcon size={14} />
          </button>
          <button
            type="button"
            className="mb-canvas-layer-icon-btn"
            onClick={() => useCanvasStore.getState().createGroup('组')}
            title="新建空组"
          >
            ⊕
          </button>
        </div>
      </div>
      <div className="mb-canvas-layers-list">
        {flat.map((entry) => (
          <LayerRow
            key={entry.layer.id}
            layer={entry.layer}
            depth={entry.depth}
            isActive={selectedIds.includes(entry.layer.id)}
            isPrimary={entry.layer.id === project.selectedId}
            isDragging={entry.layer.id === dragId}
            dropPos={dropTarget?.id === entry.layer.id ? dropTarget.pos : null}
            allLayers={project.layers}
            onSelect={(shift) => {
              if (shift) toggleSelect(entry.layer.id);
              else select(entry.layer.id);
            }}
            onToggleVisible={() => update(entry.layer.id, { visible: !entry.layer.visible })}
            onToggleLocked={() => update(entry.layer.id, { locked: !entry.layer.locked })}
            onDelete={() => remove(entry.layer.id)}
            onUngroup={() => ungroup(entry.layer.id)}
            onToggleCollapsed={() => toggleCollapsed(entry.layer.id)}
            onDragStart={() => setDragId(entry.layer.id)}
            onDragOver={(pos) => setDropTarget({ id: entry.layer.id, pos })}
            onDragEnd={() => {
              setDragId(null);
              setDropTarget(null);
            }}
            onDrop={(pos) => handleDrop(entry.layer.id, pos)}
            onRename={(name) => update(entry.layer.id, { name })}
            onContextMenu={(e) => {
              e.preventDefault();
              openLayerContextMenu(e.clientX, e.clientY, entry.layer, menuHandlers);
            }}
          />
        ))}
      </div>
      {footer}
      {solidOpen && <SolidColorDialog onClose={() => setSolidOpen(false)} onConfirm={addSolidLayer} />}
    </div>
  );
}

/** 新建纯色图层弹窗：颜色值输入 + 原生取色 + 屏幕吸管（EyeDropper API） */
function SolidColorDialog({
  onClose,
  onConfirm
}: {
  onClose: () => void;
  onConfirm: (color: string) => void;
}): JSX.Element {
  const [color, setColor] = useState('#fb923c');

  async function pickWithEyedropper(): Promise<void> {
    const Ctor = (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper;
    if (!Ctor) {
      toast.info('当前环境不支持屏幕吸管', '请直接用取色器或填颜色值');
      return;
    }
    try {
      const res = await new Ctor().open();
      setColor(res.sRGBHex);
    } catch {
      /* 用户取消 */
    }
  }

  return (
    <div className="mb-modal-backdrop" onClick={onClose}>
      <div className="mb-modal mb-solid-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>新建纯色图层</h3>
        <div className="mb-solid-row">
          <input
            type="color"
            className="mb-mask-color"
            value={/^#[0-9a-fA-F]{6}$/.test(color) ? color : '#fb923c'}
            onChange={(e) => setColor(e.target.value)}
          />
          <input
            className="mb-canvas-props-input"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            placeholder="#rrggbb"
            spellCheck={false}
          />
          <button type="button" className="mb-ps-minibtn" onClick={pickWithEyedropper}>
            吸管
          </button>
        </div>
        <div className="mb-solid-preview" style={{ background: color }} />
        <div className="mb-modal-actions">
          <button type="button" className="mb-btn" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="mb-btn mb-btn-primary"
            onClick={() => {
              onConfirm(color.length === 7 ? color + 'ff' : color);
              onClose();
            }}
          >
            创建
          </button>
        </div>
      </div>
    </div>
  );
}

interface FlatEntry {
  layer: Layer;
  depth: number;
}

/**
 * 把图层数组扁平化成显示顺序（视觉上方 = 数组前）：
 *   - 顶级图层按 z 倒序
 *   - 每个图层下方紧跟它的 children（递归），children 也按 z 倒序
 *   - 折叠的组的 children 不显示
 */
function flattenForDisplay(layers: Layer[]): FlatEntry[] {
  const byParent = new Map<string | null, Layer[]>();
  for (const l of layers) {
    const p = l.parentId ?? null;
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p)!.push(l);
  }
  // 每组内部按"数组顺序倒过来"显示（Konva 数组末尾 = z 高 = 视觉上方）
  for (const arr of byParent.values()) {
    // arr 的顺序就是 layers 中的相对顺序；要让"末尾在上"，倒序
    arr.reverse();
  }
  const out: FlatEntry[] = [];
  function walk(parent: string | null, depth: number): void {
    const list = byParent.get(parent) ?? [];
    for (const l of list) {
      out.push({ layer: l, depth });
      if (l.isGroup && !l.collapsed) walk(l.id, depth + 1);
    }
  }
  walk(null, 0);
  return out;
}

interface LayerRowProps {
  layer: Layer;
  depth: number;
  isActive: boolean;
  isPrimary: boolean;
  isDragging: boolean;
  dropPos: 'before' | 'after' | 'inside' | null;
  allLayers: Layer[];
  onSelect: (shift: boolean) => void;
  onToggleVisible: () => void;
  onToggleLocked: () => void;
  onDelete: () => void;
  onUngroup: () => void;
  onToggleCollapsed: () => void;
  onDragStart: () => void;
  onDragOver: (pos: 'before' | 'after' | 'inside') => void;
  onDragEnd: () => void;
  onDrop: (pos: 'before' | 'after' | 'inside') => void;
  onRename: (name: string) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

function LayerRow({
  layer,
  depth,
  isActive,
  isPrimary,
  isDragging,
  dropPos,
  allLayers,
  onSelect,
  onToggleVisible,
  onToggleLocked,
  onDelete,
  onUngroup,
  onToggleCollapsed,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDrop,
  onRename,
  onContextMenu
}: LayerRowProps): JSX.Element {
  const [thumb, setThumb] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(layer.name);

  useEffect(() => {
    setDraftName(layer.name);
  }, [layer.name]);

  // 缩略图：图像图层走 makeLayerThumbnail；组 / 文本 / 形状 / 笔刷 用 icon 占位
  useEffect(() => {
    if (layer.isGroup || layer.isText || layer.isBrush || layer.shapeKind) {
      setThumb(null);
      return;
    }
    let cancelled = false;
    const src = layerDisplaySrc(layer);
    if (!src) {
      setThumb(null);
      return;
    }
    makeLayerThumbnail(src, 80)
      .then((t) => !cancelled && setThumb(t))
      .catch(() => !cancelled && setThumb(null));
    return () => {
      cancelled = true;
    };
  }, [layer.id, layer.sourcePath, layer.cookedDataUri, layer.isGroup, layer.isText, layer.isBrush, layer.shapeKind]);

  const effVisible = isEffectivelyVisible(allLayers, layer.id);
  const effLocked = isEffectivelyLocked(allLayers, layer.id);

  const className = [
    'mb-canvas-layer-item',
    isActive ? 'is-active' : '',
    isPrimary ? 'is-primary' : '',
    isDragging ? 'is-dragging' : '',
    dropPos === 'before' ? 'is-drop-before' : '',
    dropPos === 'after' ? 'is-drop-after' : '',
    dropPos === 'inside' ? 'is-drop-inside' : '',
    layer.isGroup ? 'is-group' : '',
    !effVisible ? 'is-eff-hidden' : ''
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={className}
      style={{ paddingLeft: 6 + depth * 14 }}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', layer.id);
        onDragStart();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
        const y = e.clientY - rect.top;
        const h = rect.height;
        let pos: 'before' | 'after' | 'inside';
        if (layer.isGroup && y > h * 0.25 && y < h * 0.75) pos = 'inside';
        else if (y < h / 2) pos = 'before';
        else pos = 'after';
        onDragOver(pos);
      }}
      onDragEnd={onDragEnd}
      onDrop={(e) => {
        e.preventDefault();
        const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
        const y = e.clientY - rect.top;
        const h = rect.height;
        let pos: 'before' | 'after' | 'inside';
        if (layer.isGroup && y > h * 0.25 && y < h * 0.75) pos = 'inside';
        else if (y < h / 2) pos = 'before';
        else pos = 'after';
        onDrop(pos);
      }}
      onClick={(e) => onSelect(e.shiftKey || e.ctrlKey || e.metaKey)}
      onContextMenu={onContextMenu}
    >
      {layer.isGroup && (
        <button
          type="button"
          className="mb-canvas-layer-collapse"
          onClick={(e) => {
            e.stopPropagation();
            onToggleCollapsed();
          }}
          title={layer.collapsed ? '展开' : '折叠'}
        >
          {layer.collapsed ? '▶' : '▼'}
        </button>
      )}
      <div className="mb-canvas-layer-thumb">
        {layer.isGroup ? (
          <FolderIcon size={20} />
        ) : layer.isText ? (
          <span style={{ fontSize: 14, fontWeight: 'bold', color: 'var(--mb-text-primary)' }}>T</span>
        ) : layer.isBrush ? (
          <span style={{ fontSize: 14, color: 'var(--mb-text-primary)' }}>✎</span>
        ) : layer.shapeKind === 'rect' ? (
          <span style={{ fontSize: 14, color: 'var(--mb-text-primary)' }}>▭</span>
        ) : layer.shapeKind === 'ellipse' ? (
          <span style={{ fontSize: 14, color: 'var(--mb-text-primary)' }}>⬭</span>
        ) : thumb ? (
          <img src={thumb} alt={layer.name} draggable={false} />
        ) : null}
      </div>
      {editing ? (
        <input
          autoFocus
          className="mb-canvas-props-input"
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          onBlur={() => {
            if (draftName.trim()) onRename(draftName.trim());
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              if (draftName.trim()) onRename(draftName.trim());
              setEditing(false);
            } else if (e.key === 'Escape') {
              setDraftName(layer.name);
              setEditing(false);
            }
          }}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span
          className="mb-canvas-layer-name"
          onDoubleClick={(e) => {
            e.stopPropagation();
            setEditing(true);
          }}
          title={layer.name + (effLocked && !layer.locked ? '（继承自父组锁定）' : '')}
        >
          {layer.name}
        </span>
      )}
      <div className="mb-canvas-layer-actions">
        <button
          type="button"
          className={`mb-canvas-layer-icon-btn ${layer.visible ? 'is-on' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleVisible();
          }}
          title={layer.visible ? '隐藏' : '显示'}
        >
          {layer.visible ? <EyeIcon size={14} /> : <EyeOffIcon size={14} />}
        </button>
        <button
          type="button"
          className={`mb-canvas-layer-icon-btn ${layer.locked ? 'is-on' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleLocked();
          }}
          title={layer.locked ? '已锁定' : '锁定'}
        >
          <KeyIcon size={14} />
        </button>
        {layer.isGroup ? (
          <button
            type="button"
            className="mb-canvas-layer-icon-btn"
            onClick={(e) => {
              e.stopPropagation();
              onUngroup();
            }}
            title="解散组"
          >
            ⊟
          </button>
        ) : (
          <button
            type="button"
            className="mb-canvas-layer-icon-btn"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            title="删除"
          >
            <TrashIcon size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
