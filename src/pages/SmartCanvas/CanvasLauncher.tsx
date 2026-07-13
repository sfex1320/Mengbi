import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useReactFlow } from '@xyflow/react';
import type { SmartNodeData } from '@shared/smartCanvas';
import { useSmartDocsStore } from '@/store/smartDocsStore';
import { useSmartCanvasStore } from '@/store/smartCanvasStore';
import { useSmartTemplateStore, type SmartTemplate } from '@/store/smartTemplateStore';
import { readDocContent, removeDocContent, duplicateDoc, exportDocsBundle, importDocsFromText, writeDocContent } from '@/lib/smartDocStorage';
import { CANVAS_SCENARIOS, validateScenario, type CanvasScenario } from '@/lib/canvasScenarios';
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
 * 把「已建好内容的工作缓冲区」落盘成新文档并打开。
 *
 * 时序为什么是「先建图 → 手动落盘 → 再 setActive」：CanvasWorkspace 挂载时**不**从存储 load、
 * 只信任缓冲区（openDoc 的既有约定），且挂载后的自动保存只订阅「变化」——建图发生在挂载前，
 * 不会触发订阅；不先手动 writeDocContent 的话，用户建完立刻关闭应用就会丢这张画布的内容。
 */
function persistBufferAndOpen(docId: string): void {
  const cur = useSmartCanvasStore.getState();
  writeDocContent(docId, cur.nodes, cur.edges, cur.viewport);
  const ds = useSmartDocsStore.getState();
  ds.touch(docId, cur.nodes.length);
  ds.setActive(docId);
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
  const templates = useSmartTemplateStore((s) => s.templates);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [tick, setTick] = useState(0); // 「刷新」强制重渲染（多窗口/外部改动后对齐）
  const fileRef = useRef<HTMLInputElement>(null);
  // fitView 来自 ReactFlowProvider（index.tsx 包在最外层）——启动页阶段 ReactFlow 尚未挂载，
  // 捕获到的函数绑定在 provider 的持久 store 上，等工作区挂载后再调即可生效。
  const { fitView } = useReactFlow();

  // 「从我的模板新建」需要模板清单；loadFromDisk 幂等（已加载直接 return），挂载时拉一次。
  useEffect(() => {
    void useSmartTemplateStore.getState().loadFromDisk();
  }, []);

  /** 工作区挂载后（两帧，同 SmartInboxBridge 的等待手法）把整套工作流收进视野。 */
  function fitAfterMount(): void {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        try {
          void fitView({ padding: 0.25, duration: 200 });
        } catch {
          /* ReactFlow 未就绪则维持默认视口（节点铺在原点附近，仍可见） */
        }
      })
    );
  }

  /** 场景快速开始：新建画布（画布名=场景名）→ 在缓冲区铺好节点与连线 → 落盘并打开。 */
  function startScenario(sc: CanvasScenario): void {
    // 蓝图有 vitest 锁定，这里再兜一道：万一规则改了而场景没跟上，宁可拦下也不给用户一张断线画布
    const problems = validateScenario(sc);
    if (problems.length) {
      toast.error('该场景暂不可用', problems[0]);
      return;
    }
    const docId = createDoc(sc.name);
    const st = useSmartCanvasStore.getState();
    st.reset();
    // 依次建节点（addNode 返回 id，蓝图连线用索引 → 这里映射成真实 id）
    const ids: string[] = [];
    for (const n of sc.nodes) {
      const nid = st.addNode(n.kind, { x: n.pos.x, y: n.pos.y });
      if (n.data) st.updateNodeData(nid, n.data as unknown as Partial<SmartNodeData>);
      ids.push(nid);
    }
    for (const e of sc.edges) {
      // 全部节点都是单输入/默认输出口（分镜的默认口 'out' 即分镜提示词），统一 out→in
      st.onConnect({ source: ids[e.from], target: ids[e.to], sourceHandle: 'out', targetHandle: 'in' });
    }
    // 选中首节点（通常是提示词/图片输入口）：用户进来直接开始填内容
    if (ids[0]) st.selectOnly(ids[0]);
    persistBufferAndOpen(docId);
    toast.success(`已创建「${sc.name}」画布`, '节点已连好线，填上内容点「运行」即可');
    fitAfterMount();
  }

  /** 从我的节点模板新建画布：insertNodes 自带 id 重映射 + 平移到指定点 + 选中。 */
  function startFromTemplate(tpl: SmartTemplate): void {
    const docId = createDoc(tpl.name);
    const st = useSmartCanvasStore.getState();
    st.reset();
    st.insertNodes(tpl.nodes, tpl.edges, { x: 0, y: 0 });
    persistBufferAndOpen(docId);
    toast.success(`已从模板「${tpl.name}」新建画布`);
    fitAfterMount();
  }

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

      {/* 场景快速开始：一键新建一张已连好线的工作流画布（降低从零搭节点的门槛） */}
      <div className="mb-sc-scenario-sec">
        <div className="mb-sc-scenario-title">场景快速开始</div>
        <div className="mb-sc-scenario-row">
          {CANVAS_SCENARIOS.map((sc) => (
            <button
              key={sc.id}
              type="button"
              className="mb-sc-scenario-card"
              title={sc.desc}
              onClick={() => startScenario(sc)}
            >
              <span className="mb-sc-scenario-icon" aria-hidden>
                {sc.icon}
              </span>
              <span className="mb-sc-scenario-name">{sc.name}</span>
              <span className="mb-sc-scenario-desc">{sc.desc}</span>
            </button>
          ))}
        </div>
        {templates.length > 0 && (
          <div className="mb-sc-scenario-tpls">
            <span className="mb-sc-scenario-tpls-label">从我的模板新建：</span>
            {templates.map((t) => (
              <button
                key={t.id}
                type="button"
                className="mb-sc-scenario-tpl"
                title={t.notes || `${t.count} 个节点`}
                onClick={() => startFromTemplate(t)}
              >
                ⊞ {t.name}
                <span className="mb-sc-scenario-tpl-count">{t.count}</span>
              </button>
            ))}
          </div>
        )}
        <p className="mb-sc-scenario-hint">也可从节点模板插入：画布内工具栏 ⊞（把选中节点存成模板复用）</p>
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
