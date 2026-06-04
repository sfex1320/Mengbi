import { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useSmartDocsStore } from '@/store/smartDocsStore';
import { useSmartCanvasStore } from '@/store/smartCanvasStore';
import { readDocContent, removeDocContent, duplicateDoc, exportDocsBundle, importDocsFromText } from '@/lib/smartDocStorage';
import { confirmDialog } from '@/components/ConfirmDialog';
import { toast } from '@/store/toastStore';
import { SmartCanvasIcon } from '@/components/Icon';
import { PlusIcon, RefreshIcon, EditIcon, TrashIcon, CopyIcon } from './icons';

/** 把某文档的内容同步载入工作缓冲区，再标记为当前文档（先 load 后 setActive，保证 viewport 正确）。 */
export function openDoc(id: string): void {
  const content = readDocContent(id);
  const st = useSmartCanvasStore.getState();
  if (content) st.load(content.nodes, content.edges, content.viewport);
  else st.reset();
  useSmartDocsStore.getState().setActive(id);
}

/** ISO → MM/DD HH:mm（本地时间，纯手工拼避免 locale 抖动）。 */
function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * 「选择画布」启动页：智能画布文档的网格。新建 / 打开 / 重命名 / 删除 / 切换。
 * 进入 /smart-canvas 默认先到这里（launcher-first），打开某画布后才进工作区。
 */
export function CanvasLauncher(): JSX.Element {
  const docs = useSmartDocsStore((s) => s.docs);
  const createDoc = useSmartDocsStore((s) => s.createDoc);
  const renameDoc = useSmartDocsStore((s) => s.renameDoc);
  const deleteDoc = useSmartDocsStore((s) => s.deleteDoc);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [tick, setTick] = useState(0); // 「刷新」强制重渲染（多窗口/外部改动后对齐）
  const fileRef = useRef<HTMLInputElement>(null);

  // 最近修改在前
  const sorted = [...docs].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));

  function newCanvas(): void {
    const id = createDoc();
    useSmartCanvasStore.getState().reset();
    useSmartDocsStore.getState().setActive(id);
    toast.success('已新建画布');
  }

  function commitRename(id: string): void {
    const t = draft.trim();
    if (t) renameDoc(id, t);
    setRenamingId(null);
  }

  async function del(id: string, title: string): Promise<void> {
    if (!(await confirmDialog({ message: `删除画布「${title}」？此操作不可撤销。`, danger: true, okText: '删除' }))) return;
    removeDocContent(id);
    deleteDoc(id);
    toast.success('已删除画布');
  }

  /** 批量导出：把全部智能画布打包成一个 .json（可在另一台机器批量导入）。 */
  function exportAll(): void {
    const r = exportDocsBundle();
    if (r.ok) toast.success(`已导出 ${r.count} 张画布`, '一个 .json 文件，含全部画布内容');
    else toast.error('没有可导出的画布');
  }

  /** 批量导入：选若干 .json（批量包或单画布），各新建一个文档。 */
  async function onPickFiles(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ''; // 允许重复选同一文件
    if (!files.length) return;
    let created = 0;
    for (const f of files) {
      try {
        const text = await f.text();
        created += importDocsFromText(text).created;
      } catch {
        /* 跳过坏文件 */
      }
    }
    if (created) {
      setTick((v) => v + 1);
      toast.success(`已导入 ${created} 张画布`);
    } else {
      toast.error('未能导入任何画布', '请选择本工具导出的 .json（批量包或单画布）');
    }
  }

  return (
    <motion.div
      className="mb-sc-launcher mb-card"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      <div className="mb-sc-launcher-head">
        <div className="mb-sc-launcher-titlewrap">
          <h2 className="mb-sc-launcher-title">选择画布</h2>
          <span className="mb-sc-launcher-count">{docs.length} 个</span>
        </div>
        <p className="mb-sc-launcher-sub">打开已有画布，或新建一个开始创作。</p>
        <div className="mb-sc-launcher-actions">
          <button
            className="mb-btn mb-btn-sm mb-btn-ghost mb-sc-tbtn"
            title="刷新（从存储重读）"
            onClick={() => {
              void useSmartDocsStore.persist.rehydrate();
              setTick((v) => v + 1);
            }}
          >
            <RefreshIcon size={15} />
          </button>
          <button
            className="mb-btn mb-btn-sm mb-btn-ghost mb-sc-tbtn"
            title="批量导入本地画布（批量包或单画布 .json，可多选）"
            onClick={() => fileRef.current?.click()}
          >
            导入画布
          </button>
          <button
            className="mb-btn mb-btn-sm mb-btn-ghost mb-sc-tbtn"
            title="把全部智能画布打包导出为一个 .json"
            onClick={exportAll}
            disabled={docs.length === 0}
          >
            批量导出
          </button>
          <button className="mb-btn mb-btn-sm mb-btn-primary mb-sc-tbtn" onClick={newCanvas}>
            <PlusIcon size={15} />
            新建智能画布
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => void onPickFiles(e)}
          />
        </div>
      </div>

      {docs.length === 0 ? (
        <div className="mb-sc-launcher-empty">
          <SmartCanvasIcon size={40} />
          <p>还没有智能画布</p>
          <button className="mb-btn mb-btn-primary mb-sc-tbtn" onClick={newCanvas}>
            <PlusIcon size={15} />
            新建一个
          </button>
        </div>
      ) : (
        <div className="mb-sc-launcher-grid" data-tick={tick}>
          {sorted.map((d) => (
            <div
              key={d.id}
              className="mb-sc-card"
              role="button"
              tabIndex={0}
              onClick={() => renamingId !== d.id && openDoc(d.id)}
              onKeyDown={(e) => {
                if ((e.key === 'Enter' || e.key === ' ') && renamingId !== d.id) {
                  e.preventDefault();
                  openDoc(d.id);
                }
              }}
            >
              <div className="mb-sc-card-top">
                <span className="mb-sc-card-icon">
                  <SmartCanvasIcon size={18} />
                </span>
                <span className="mb-sc-card-badge">智能</span>
              </div>

              {renamingId === d.id ? (
                <input
                  className="mb-sc-card-rename"
                  autoFocus
                  value={draft}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => commitRename(d.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename(d.id);
                    else if (e.key === 'Escape') setRenamingId(null);
                  }}
                />
              ) : (
                <div className="mb-sc-card-title" title={d.title}>
                  {d.title}
                </div>
              )}

              <div className="mb-sc-card-foot">
                <span className="mb-sc-card-meta">
                  {d.nodeCount} 节点 · {fmtTime(d.updatedAt)}
                </span>
              </div>

              <div className="mb-sc-card-hover">
                <button
                  className="mb-sc-card-act"
                  title="重命名"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDraft(d.title);
                    setRenamingId(d.id);
                  }}
                >
                  <EditIcon size={14} />
                </button>
                <button
                  className="mb-sc-card-act"
                  title="复制画布"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (duplicateDoc(d.id)) toast.success('已复制画布');
                  }}
                >
                  <CopyIcon size={14} />
                </button>
                <button
                  className="mb-sc-card-act is-danger"
                  title="删除"
                  onClick={(e) => {
                    e.stopPropagation();
                    void del(d.id, d.title);
                  }}
                >
                  <TrashIcon size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}
