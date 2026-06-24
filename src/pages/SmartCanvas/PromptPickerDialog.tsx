import { useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';
import { useSmartCanvasStore } from '@/store/smartCanvasStore';
import { toast } from '@/store/toastStore';
import { useDragScroll } from '@/lib/useDragScroll';
import { useBackdropClose } from './nodeArea';

/** 提示词库选择：哪个提示词节点在等选词（null = 不显示）。在 SmartCanvasPage 顶层挂一个 Dialog 消费。 */
interface PromptPickerState {
  targetNodeId: string | null;
  /** 列表模式时插入到第几条（追加到 items[listIndex]，等于 items.length 则新增一条）；null = 写入单条 text */
  targetListIndex: number | null;
  open: (nodeId: string, listIndex?: number) => void;
  close: () => void;
}
export const usePromptPickerStore = create<PromptPickerState>((set) => ({
  targetNodeId: null,
  targetListIndex: null,
  open: (targetNodeId, listIndex) => set({ targetNodeId, targetListIndex: listIndex ?? null }),
  close: () => set({ targetNodeId: null, targetListIndex: null })
}));

interface PromptRow {
  id: number;
  title: string;
  text: string;
  negative_text?: string | null;
  tags?: string | null;
  notes?: string | null;
  category_id?: number | null;
}
interface CategoryRow {
  id: number;
  name: string;
  slug: string;
}

/** 从提示词库挑一条提示词，点击后插入提示词节点的输入框（已有内容则换行追加）。复用 api:prompt:list。 */
export function PromptPickerDialog(): JSX.Element | null {
  const targetNodeId = usePromptPickerStore((s) => s.targetNodeId);
  const targetListIndex = usePromptPickerStore((s) => s.targetListIndex);
  const close = usePromptPickerStore((s) => s.close);
  const [rows, setRows] = useState<PromptRow[]>([]);
  const [cats, setCats] = useState<CategoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<number | 'all'>('all');
  const backdrop = useBackdropClose(close);
  const listRef = useDragScroll<HTMLDivElement>();

  useEffect(() => {
    if (!targetNodeId) return;
    setLoading(true);
    setQ('');
    setCat('all');
    void Promise.all([window.electronAPI.prompt.list({}), window.electronAPI.prompt.categoryList()])
      .then(([pr, cr]) => {
        if (pr.ok) setRows(pr.data as unknown as PromptRow[]);
        else toast.error(pr.error.message, pr.error.hint);
        if (cr.ok) setCats(cr.data as unknown as CategoryRow[]);
      })
      .finally(() => setLoading(false));
  }, [targetNodeId]);

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (cat !== 'all' && r.category_id !== cat) return false;
      if (!kw) return true;
      return (r.title || '').toLowerCase().includes(kw) || (r.text || '').toLowerCase().includes(kw);
    });
  }, [rows, q, cat]);

  if (!targetNodeId) return null;

  function pick(row: PromptRow): void {
    const st = useSmartCanvasStore.getState();
    const node = st.nodes.find((n) => n.id === targetNodeId);
    if (targetListIndex != null) {
      // 列表模式：插入到第 targetListIndex 条（已有内容则换行追加；越界 = 新增一条）
      const cur = ((node?.data as { items?: string[] } | undefined)?.items ?? []).slice();
      const prevVal = (cur[targetListIndex] ?? '').trim();
      cur[targetListIndex] = prevVal ? `${prevVal}\n${row.text}` : row.text;
      st.updateNodeData(targetNodeId as string, { items: cur });
    } else {
      const prev = ((node?.data as { text?: string } | undefined)?.text ?? '').trim();
      st.updateNodeData(targetNodeId as string, { text: prev ? `${prev}\n${row.text}` : row.text });
    }
    close();
    toast.success('已插入提示词');
  }

  // 仅显示「确有提示词归属」的分类，避免一堆空分类
  const usedCatIds = new Set(rows.map((r) => r.category_id).filter((x): x is number => typeof x === 'number'));
  const shownCats = cats.filter((c) => usedCatIds.has(c.id));

  return (
    <div className="mb-modal-backdrop" {...backdrop}>
      <div className="mb-modal mb-sc-ppick" onClick={(e) => e.stopPropagation()}>
        <div className="mb-sc-ppick-head">
          <h3>选择提示词</h3>
          <button className="mb-sc-node-x" onClick={close} title="关闭">
            ✕
          </button>
        </div>
        <div className="mb-sc-ppick-bar">
          <input
            className="mb-input mb-sc-ppick-search"
            placeholder="搜索标题 / 内容…"
            value={q}
            autoFocus
            onChange={(e) => setQ(e.target.value)}
          />
          {shownCats.length > 0 && (
            <div className="mb-sc-ppick-cats">
              <button className={`mb-sc-ppick-cat ${cat === 'all' ? 'is-active' : ''}`} onClick={() => setCat('all')}>
                全部
              </button>
              {shownCats.map((c) => (
                <button
                  key={c.id}
                  className={`mb-sc-ppick-cat ${cat === c.id ? 'is-active' : ''}`}
                  onClick={() => setCat(c.id)}
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}
        </div>
        {loading ? (
          <div className="mb-sc-empty">加载中…</div>
        ) : rows.length === 0 ? (
          <div className="mb-sc-empty">提示词库还没有内容。可在「资产库 / 提示词」相关入口积累后再来选取。</div>
        ) : filtered.length === 0 ? (
          <div className="mb-sc-empty">没有匹配的提示词。</div>
        ) : (
          <div className="mb-sc-ppick-list mb-dragscroll" ref={listRef}>
            {filtered.map((row) => (
              <button key={row.id} className="mb-sc-ppick-item" title={row.text} onClick={() => pick(row)}>
                <div className="mb-sc-ppick-title">{row.title || '(无标题)'}</div>
                <div className="mb-sc-ppick-text">{row.text}</div>
              </button>
            ))}
          </div>
        )}
        <div className="mb-sc-ppick-hint">滚轮 / 右侧滑杆 / 卡片上长按拖动 都可上下滚动 · 点击卡片插入提示词</div>
      </div>
    </div>
  );
}
