import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from '@/store/toastStore';
import { confirmDialog } from '@/components/ConfirmDialog';
import { openContextMenu } from '@/components/ContextMenu';
import { localPathToImageUrl } from '@/lib/imageUrl';
import { useComfyuiStore } from '@/store/comfyuiStore';
import { useComfyuiRunStore } from '@/store/comfyuiRunStore';
import { useSmartInboxStore } from '@/store/smartInboxStore';
import type { ComfyRunSummary } from '@shared/comfyui';

const STATUS_TEXT: Record<string, string> = {
  pending: '等待',
  running: '运行中',
  done: '成功',
  failed: '失败',
  cancelled: '已取消'
};

export function RunRecords(): JSX.Element {
  const [runs, setRuns] = useState<ComfyRunSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expandedErr, setExpandedErr] = useState<Set<string>>(new Set());
  const running = useComfyuiRunStore((s) => s.running);
  const queue = useComfyuiRunStore((s) => s.queue);
  const { setControlValue, setLeftTab } = useComfyuiStore();
  const navigate = useNavigate();

  const refresh = useCallback(async () => {
    const r = await window.electronAPI.comfyui.resultsList({ limit: 100 });
    if (r.ok) setRuns(r.data);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (!running) void refresh();
  }, [running, refresh]);

  function toggle(runId: string): void {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(runId)) n.delete(runId);
      else n.add(runId);
      return n;
    });
  }
  function toggleErr(runId: string): void {
    setExpandedErr((s) => {
      const n = new Set(s);
      if (n.has(runId)) n.delete(runId);
      else n.add(runId);
      return n;
    });
  }

  async function restore(runId: string): Promise<void> {
    setBusy(true);
    const r = await window.electronAPI.comfyui.resultsRestore({ runId });
    setBusy(false);
    if (!r.ok) {
      toast.error(r.error.message);
      return;
    }
    for (const [k, v] of Object.entries(r.data.controlValues)) setControlValue(k, v);
    setLeftTab('params');
    toast.success('已恢复该轮参数到面板');
  }

  // 一键重跑：恢复该轮参数 → 直接用当前工作流再跑一次
  async function rerun(runId: string): Promise<void> {
    const st = useComfyuiStore.getState();
    if (!st.activeWorkflowId && !st.activeWorkflowJson) {
      toast.error('请先导入/加载对应的工作流再重跑');
      return;
    }
    // 该记录来自另一个模板 → 参数键与当前控件对不上，先让用户加载对应模板
    const rec = runs.find((x) => x.runId === runId);
    if (rec?.templateId && rec.templateId !== st.activeWorkflowId) {
      toast.error('该记录来自另一个工作流', '请先在上方「加载已存模板」选到对应工作流再重跑');
      return;
    }
    setBusy(true);
    const rr = await window.electronAPI.comfyui.resultsRestore({ runId });
    if (!rr.ok) {
      setBusy(false);
      toast.error(rr.error.message);
      return;
    }
    const r = await window.electronAPI.comfyui.runSingle({
      workflowId: st.activeWorkflowId ?? undefined,
      workflowJson: st.activeWorkflowId ? undefined : (st.activeWorkflowJson ?? undefined),
      controlValues: rr.data.controlValues,
      controls: st.activeControls,
      bindings: st.activeBindings
    });
    setBusy(false);
    if (!r.ok) {
      toast.error(r.error.message, r.error.hint);
      return;
    }
    useComfyuiRunStore.getState().startRun(r.data.runId, r.data.batchId);
    toast.info('已用该轮参数重跑');
  }

  async function del(runId: string): Promise<void> {
    if (!(await confirmDialog({ message: '删除这条运行记录？', danger: true }))) return;
    await window.electronAPI.comfyui.resultsDelete({ runId });
    setSelected((s) => {
      const n = new Set(s);
      n.delete(runId);
      return n;
    });
    void refresh();
  }

  async function exportSelected(): Promise<void> {
    const ids = [...selected];
    if (ids.length === 0) return;
    const dir = await window.electronAPI.storage.selectFolder();
    if (!dir.ok || !dir.data) return;
    setBusy(true);
    const r = await window.electronAPI.comfyui.resultsExport({ runIds: ids, outputDir: dir.data.path });
    setBusy(false);
    if (!r.ok) toast.error(r.error.message);
    else toast.success('已导出', `复制了 ${r.data.copied} 个文件`);
  }

  async function toGallery(): Promise<void> {
    const ids = [...selected];
    if (ids.length === 0) return;
    setBusy(true);
    const r = await window.electronAPI.comfyui.resultsToGallery({ runIds: ids });
    setBusy(false);
    if (!r.ok) toast.error(r.error.message);
    else toast.success('已加入图库', `${r.data.added} 张`);
  }

  async function delSelected(): Promise<void> {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (!(await confirmDialog({ message: `删除选中的 ${ids.length} 条记录？`, danger: true }))) return;
    setBusy(true);
    for (const id of ids) await window.electronAPI.comfyui.resultsDelete({ runId: id });
    setBusy(false);
    setSelected(new Set());
    void refresh();
  }

  function firstImage(r: ComfyRunSummary): string | null {
    const f = r.outputFiles?.find((o) => o.path && (o.kind === 'image' || !o.kind));
    return f?.path ? localPathToImageUrl(f.path) : null;
  }

  // 单条记录的图库/导出（按钮区只有多选版，右键补单条快捷）
  async function toGalleryOne(runId: string): Promise<void> {
    setBusy(true);
    const r = await window.electronAPI.comfyui.resultsToGallery({ runIds: [runId] });
    setBusy(false);
    if (!r.ok) toast.error(r.error.message);
    else toast.success('已加入图库', `${r.data.added} 张`);
  }
  async function exportOne(runId: string): Promise<void> {
    const dir = await window.electronAPI.storage.selectFolder();
    if (!dir.ok || !dir.data) return;
    setBusy(true);
    const r = await window.electronAPI.comfyui.resultsExport({ runIds: [runId], outputDir: dir.data.path });
    setBusy(false);
    if (!r.ok) toast.error(r.error.message);
    else toast.success('已导出', `复制了 ${r.data.copied} 个文件`);
  }

  function rowMenu(e: React.MouseEvent, r: ComfyRunSummary): void {
    e.preventDefault();
    const items = [
      { label: '重跑', onClick: () => void rerun(r.runId) },
      { label: '恢复参数到面板', onClick: () => void restore(r.runId) },
      { label: '加入图库', onClick: () => void toGalleryOne(r.runId) },
      { label: '复制到文件夹…', onClick: () => void exportOne(r.runId) }
    ];
    const imgPaths = (r.outputFiles ?? [])
      .filter((o) => o.path && (o.kind === 'image' || !o.kind))
      .map((o) => o.path as string);
    if (imgPaths.length) {
      items.push({
        label: '发送到智能画布',
        onClick: () => {
          useSmartInboxStore.getState().push(imgPaths.map((p) => ({ src: p, name: 'ComfyUI 输出' })));
          navigate('/smart-canvas');
          toast.success('已发送到智能画布');
        }
      });
    }
    const fp = r.outputFiles?.find((o) => o.path)?.path;
    if (fp) items.push({ label: '打开所在文件夹', onClick: () => void window.electronAPI.storage.showInFolder(fp) });
    items.push({ label: '删除', onClick: () => void del(r.runId) });
    openContextMenu({ x: e.clientX, y: e.clientY, items });
  }

  return (
    <section className="mb-cfy-records mb-card">
      <div className="mb-cfy-records-head">
        <span className="mb-cfy-section-title">运行记录</span>
        <div className="mb-cfy-records-headright">
          {running && queue && queue.total > 1 && (
            <span className="mb-cfy-live-badge">
              运行中 {queue.done + queue.failed}/{queue.total}
              {queue.failed > 0 && <span className="mb-cfy-live-failed"> · 失败 {queue.failed}</span>}
            </span>
          )}
          <button className="mb-btn mb-btn-sm mb-btn-ghost" onClick={() => void refresh()} disabled={busy}>
            刷新
          </button>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="mb-cfy-records-bar">
          <span>已选 {selected.size}</span>
          <button className="mb-btn mb-btn-sm" onClick={() => void exportSelected()} disabled={busy}>
            复制到文件夹
          </button>
          <button className="mb-btn mb-btn-sm" onClick={() => void toGallery()} disabled={busy}>
            加入图库
          </button>
          <button className="mb-btn mb-btn-sm mb-btn-danger" onClick={() => void delSelected()} disabled={busy}>
            删除选中
          </button>
          <button className="mb-btn mb-btn-sm mb-btn-ghost" onClick={() => setSelected(new Set())}>
            取消选择
          </button>
        </div>
      )}

      {runs.length === 0 ? (
        <div className="mb-cfy-form-empty">还没有运行记录。</div>
      ) : (
        <div className="mb-cfy-records-list">
          {runs.map((r) => {
            const thumb = firstImage(r);
            const params = r.parameterSnapshot ?? {};
            const paramStr = Object.entries(params)
              .map(([k, v]) => `${k}=${String(v)}`)
              .join(' · ');
            const errExpanded = expandedErr.has(r.runId);
            return (
              <div
                key={r.runId}
                className={`mb-cfy-record is-${r.status} ${selected.has(r.runId) ? 'is-selected' : ''}`}
                onContextMenu={(e) => rowMenu(e, r)}
              >
                <input
                  type="checkbox"
                  className="mb-cfy-record-check"
                  checked={selected.has(r.runId)}
                  onChange={() => toggle(r.runId)}
                />
                <div className="mb-cfy-record-thumb">
                  {thumb ? <img src={thumb} alt="" /> : <span className="mb-cfy-record-nothumb">—</span>}
                </div>
                <div className="mb-cfy-record-body">
                  <div className="mb-cfy-record-line1">
                    <span className={`mb-cfy-record-status is-${r.status}`}>{STATUS_TEXT[r.status] ?? r.status}</span>
                    <span className="mb-cfy-record-meta">
                      #{r.iterationIndex}
                      {r.durationMs ? ` · ${(r.durationMs / 1000).toFixed(1)}s` : ''}
                    </span>
                  </div>
                  {paramStr && <div className="mb-cfy-record-params">{paramStr}</div>}
                  {r.errorMessage && (
                    <div
                      className={`mb-cfy-record-err ${errExpanded ? 'is-expanded' : ''}`}
                      onClick={() => toggleErr(r.runId)}
                      title="点击展开/收起"
                    >
                      {r.errorMessage}
                    </div>
                  )}
                </div>
                <div className="mb-cfy-record-actions">
                  <button className="mb-btn mb-btn-sm" onClick={() => void rerun(r.runId)} disabled={busy}>
                    重跑
                  </button>
                  <button className="mb-btn mb-btn-sm mb-btn-ghost" onClick={() => void restore(r.runId)} disabled={busy}>
                    恢复参数
                  </button>
                  <button className="mb-btn mb-btn-sm mb-btn-ghost" onClick={() => void del(r.runId)} disabled={busy}>
                    删除
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
