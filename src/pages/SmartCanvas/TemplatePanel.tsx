import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Node, Edge } from '@xyflow/react';
import { useSmartCanvasStore, getSmartViewCenter } from '@/store/smartCanvasStore';
import { useSmartTemplateStore, type SmartTemplate } from '@/store/smartTemplateStore';
import { useDragScroll } from '@/lib/useDragScroll';
import { toast } from '@/store/toastStore';
import type { SmartNodeKind } from '@shared/smartCanvas';
import { NODE_TYPE_LABELS } from './NodeInspector';
import { TrashIcon } from './icons';

/** 节点框尺寸（缺测量值时的兜底，仅影响缩略图观感，不影响实例化）。 */
function nodeBox(n: Node): { x: number; y: number; w: number; h: number; type: string } {
  const any = n as unknown as {
    width?: number;
    height?: number;
    measured?: { width?: number; height?: number };
  };
  const w = any.width || any.measured?.width || 200;
  const h = any.height || any.measured?.height || 130;
  return { x: n.position.x, y: n.position.y, w, h, type: (n.type ?? 'node') as string };
}

/** 给每种节点类型一个稳定可辨识的颜色（hash → HSL）。 */
function typeColor(type: string): string {
  let h = 0;
  for (let i = 0; i < type.length; i++) h = (h * 31 + type.charCodeAt(i)) % 360;
  return `hsl(${h}, 60%, 56%)`;
}

/** 模板缩略图：把节点画成彩色方块（按类型上色）+ 连线，呈现工作流的结构形状。 */
function TemplateThumb({ nodes, edges }: { nodes: Node[]; edges: Edge[] }): JSX.Element {
  const boxes = useMemo(() => nodes.map((n) => ({ id: n.id, ...nodeBox(n) })), [nodes]);
  if (boxes.length === 0) return <div className="mb-sc-tplp-thumb is-empty">空模板</div>;
  const minX = Math.min(...boxes.map((b) => b.x));
  const minY = Math.min(...boxes.map((b) => b.y));
  const maxX = Math.max(...boxes.map((b) => b.x + b.w));
  const maxY = Math.max(...boxes.map((b) => b.y + b.h));
  const W = Math.max(1, maxX - minX);
  const H = Math.max(1, maxY - minY);
  const pad = Math.max(W, H) * 0.06;
  const sw = Math.max(1.5, W / 140);
  const centerOf = (id: string): { x: number; y: number } | null => {
    const b = boxes.find((x) => x.id === id);
    return b ? { x: b.x + b.w / 2, y: b.y + b.h / 2 } : null;
  };
  return (
    <svg
      className="mb-sc-tplp-thumb"
      viewBox={`${minX - pad} ${minY - pad} ${W + pad * 2} ${H + pad * 2}`}
      preserveAspectRatio="xMidYMid meet"
    >
      {edges.map((e, i) => {
        const a = centerOf(e.source);
        const b = centerOf(e.target);
        if (!a || !b) return null;
        return (
          <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--mb-border-strong)" strokeWidth={sw} strokeLinecap="round" />
        );
      })}
      {boxes.map((b) => (
        <rect
          key={b.id}
          x={b.x}
          y={b.y}
          width={b.w}
          height={b.h}
          rx={Math.min(b.w, b.h) * 0.14}
          fill={typeColor(b.type)}
          fillOpacity={0.88}
          stroke="rgba(0,0,0,0.28)"
          strokeWidth={sw * 0.7}
        />
      ))}
    </svg>
  );
}

/** 节点类型摘要：「生图×2 · 提示词 · 结果」。 */
function summarizeTypes(nodes: Node[]): string {
  const counts = new Map<string, number>();
  for (const n of nodes) {
    const t = (n.type ?? 'node') as string;
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([t, c]) => {
      const label = NODE_TYPE_LABELS[t as SmartNodeKind] ?? t;
      return c > 1 ? `${label}×${c}` : label;
    })
    .join(' · ');
}

/** 单张模板卡：缩略图 + 可编辑标题 / 备注 + 信息 + 插入 / 删除。 */
function TemplateCard({
  t,
  onInsert,
  onRemove,
  onUpdate
}: {
  t: SmartTemplate;
  onInsert: (t: SmartTemplate) => void;
  onRemove: (id: string) => void;
  onUpdate: (id: string, patch: { name?: string; notes?: string }) => void;
}): JSX.Element {
  const [name, setName] = useState(t.name);
  const [notes, setNotes] = useState(t.notes ?? '');
  useEffect(() => {
    setName(t.name);
    setNotes(t.notes ?? '');
  }, [t.id, t.name, t.notes]);

  const summary = useMemo(() => summarizeTypes(t.nodes), [t.nodes]);
  const date = (t.createdAt || '').slice(0, 10);

  return (
    <div className="mb-sc-tplp-card">
      <button
        className="mb-sc-tplp-thumbwrap"
        title="插入到画布中心"
        onClick={() => onInsert(t)}
      >
        <TemplateThumb nodes={t.nodes} edges={t.edges} />
        <span className="mb-sc-tplp-insert">＋ 插入</span>
      </button>
      <input
        className="mb-input mb-sc-tplp-name"
        value={name}
        placeholder="模板名称"
        onChange={(e) => setName(e.target.value)}
        onBlur={() => name.trim() !== t.name && onUpdate(t.id, { name })}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
      <input
        className="mb-input mb-sc-tplp-notes"
        value={notes}
        placeholder="备注：简述用途 / 包含的工具流…"
        onChange={(e) => setNotes(e.target.value)}
        onBlur={() => (notes.trim() || '') !== (t.notes ?? '') && onUpdate(t.id, { notes })}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
      <div className="mb-sc-tplp-meta" title={summary}>
        <span className="mb-sc-tplp-count">{t.count} 节点</span>
        {summary && <span className="mb-sc-tplp-types">{summary}</span>}
      </div>
      <div className="mb-sc-tplp-cardfoot">
        {date && <span className="mb-sc-tplp-date">{date}</span>}
        <button className="mb-sc-tplp-del" title="删除模板" onClick={() => onRemove(t.id)}>
          <TrashIcon size={13} />
        </button>
      </div>
    </div>
  );
}

/**
 * 节点模板面板（像便携资产库那样的中心悬浮窗）：把当前选区存为模板（标题 + 备注），
 * 网格展示所有模板的缩略图（节点结构示意图）+ 标题 + 备注 + 类型摘要，一键插入任意画布。
 * 模板存「软件配置文件夹」磁盘文件（userData/node-templates/，见 smartTemplateStore）。
 */
export function TemplatePanel({ onClose }: { onClose: () => void }): JSX.Element {
  const templates = useSmartTemplateStore((s) => s.templates);
  const save = useSmartTemplateStore((s) => s.save);
  const remove = useSmartTemplateStore((s) => s.remove);
  const update = useSmartTemplateStore((s) => s.update);
  const loadFromDisk = useSmartTemplateStore((s) => s.loadFromDisk);
  const gridRef = useDragScroll<HTMLDivElement>();
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    void loadFromDisk();
  }, [loadFromDisk]);

  // Esc 关闭（无背板，画布保持可交互）
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function saveCurrent(): void {
    const cap = useSmartCanvasStore.getState().captureSelection();
    if (!cap) {
      toast.error('先在画布上选中要存为模板的节点');
      return;
    }
    const cnt = cap.nodes.length;
    save(name.trim() || `模板 ${templates.length + 1}`, cap.nodes, cap.edges, notes)
      .then(() => {
        setName('');
        setNotes('');
        toast.success(`已存为模板（${cnt} 节点）`, '已保存到配置文件夹');
      })
      .catch((e: unknown) => toast.error('存模板失败', (e as Error).message));
  }

  function insert(t: SmartTemplate): void {
    const pos = getSmartViewCenter();
    useSmartCanvasStore.getState().insertNodes(t.nodes, t.edges, pos);
    toast.success(`已插入模板「${t.name}」`, `${t.count} 节点`);
    onClose();
  }

  return createPortal(
    <div className="mb-sc-tplp mb-card" role="dialog" aria-label="节点模板">
      <div className="mb-sc-tplp-head">
        <h3>节点模板</h3>
        <span className="mb-sc-tplp-headcount">{templates.length} 个模板</span>
        <button className="mb-sc-node-x" onClick={onClose} title="关闭（Esc）">
          ✕
        </button>
      </div>

      <div className="mb-sc-tplp-savebar">
        <input
          className="mb-input mb-sc-tplp-saveinput"
          placeholder="模板名称（先在画布选中节点）"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') saveCurrent();
          }}
        />
        <input
          className="mb-input mb-sc-tplp-saveinput"
          placeholder="备注（可选，简述用途）"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') saveCurrent();
          }}
        />
        <button className="mb-btn mb-btn-sm mb-btn-primary" onClick={saveCurrent}>
          存为模板
        </button>
      </div>

      {templates.length === 0 ? (
        <div className="mb-sc-empty mb-sc-tplp-empty">
          还没有模板。在画布上选中若干节点（一套工具流 / 工作流）→ 命名 → 「存为模板」，之后可一键插入任意画布。
        </div>
      ) : (
        <div className="mb-sc-tplp-grid mb-dragscroll" ref={gridRef}>
          {templates.map((t) => (
            <TemplateCard key={t.id} t={t} onInsert={insert} onRemove={(id) => void remove(id)} onUpdate={(id, p) => void update(id, p)} />
          ))}
        </div>
      )}

      <div className="mb-sc-tplp-hint">
        点缩略图 = 插入到画布中心 · 标题 / 备注可直接修改 · 长按可拖动滚动 · 模板文件在配置文件夹 · Esc 关闭
      </div>
    </div>,
    document.body
  );
}
