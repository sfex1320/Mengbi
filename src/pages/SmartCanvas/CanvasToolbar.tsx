import { useRef, useState } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useSmartCanvasStore, useSmartCanvasUiStore, useSmartRunStore } from '@/store/smartCanvasStore';
import { useSmartDocsStore } from '@/store/smartDocsStore';
import { exportCanvasToFile, importCanvasFromText } from '@/lib/smartCanvasApi';
import { backToLauncher } from '@/lib/smartDocStorage';
import { runAllNodes, abortRunAll } from '@/lib/smartCanvasRunner';
import { toast } from '@/store/toastStore';
import { confirmDialog } from '@/components/ConfirmDialog';
import type { SmartNodeKind } from '@shared/smartCanvas';
import { NODE_ICONS, OpenIcon, SaveIcon, FitViewIcon, TrashIcon, BackIcon, RunAllIcon, StopIcon, TemplateIcon } from './icons';
import { TemplatePanel } from './TemplatePanel';

const ADD: Array<[SmartNodeKind, string]> = [
  ['image', '图片'],
  ['prompt', '提示词'],
  ['llm', 'LLM'],
  ['angle-prompt', '视角'],
  ['scale', '缩放'],
  ['ratio', '尺寸分析'],
  ['work', '生成'],
  ['comfy', 'ComfyUI'],
  ['result', '结果'],
  ['group', '分组']
];

/** 顶部工具栏：点选节点类型→点画布落位 + 打开/保存/重置视图/清空（均配图标）。排布在画布左下角控件。 */
export function CanvasToolbar(): JSX.Element {
  const reset = useSmartCanvasStore((s) => s.reset);
  const count = useSmartCanvasStore((s) => s.nodes.length);
  const pendingKind = useSmartCanvasUiStore((s) => s.pendingKind);
  const setPendingKind = useSmartCanvasUiStore((s) => s.setPendingKind);
  const activeDocId = useSmartDocsStore((s) => s.activeDocId);
  const docTitle = useSmartDocsStore((s) => s.docs.find((d) => d.id === s.activeDocId)?.title ?? '智能画布');
  const renameDoc = useSmartDocsStore((s) => s.renameDoc);
  const running = useSmartRunStore((s) => s.running);
  const runDone = useSmartRunStore((s) => s.done);
  const runTotal = useSmartRunStore((s) => s.total);
  const { fitView, setViewport } = useReactFlow();
  const openRef = useRef<HTMLInputElement>(null);
  const [tplOpen, setTplOpen] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');

  function commitTitle(): void {
    if (activeDocId && titleDraft.trim()) renameDoc(activeDocId, titleDraft.trim());
    setEditingTitle(false);
  }

  function openFile(file: File): void {
    void file.text().then((text) => {
      const res = importCanvasFromText(text);
      if (!res.ok) {
        toast.error('不是有效的智能画布 JSON 文件');
        return;
      }
      window.setTimeout(() => void fitView({ duration: 300 }), 60);
      toast.success('已打开画布', `${res.nodeCount} 节点`);
    });
  }

  function resetView(): void {
    if (count === 0) void setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 300 });
    else void fitView({ duration: 300 });
  }

  async function clear(): Promise<void> {
    if (count === 0) return;
    if (!(await confirmDialog({ message: '清空整块画布？（可先「保存」备份）', danger: true, okText: '清空' }))) return;
    reset();
  }

  return (
    <div className="mb-sc-toolbar mb-card">
      <button
        className="mb-btn mb-btn-sm mb-btn-ghost mb-sc-tbtn"
        title="返回画布菜单（先自动保存当前画布）"
        onClick={backToLauncher}
      >
        <BackIcon size={15} />
        画布菜单
      </button>
      {editingTitle ? (
        <input
          className="mb-sc-doctitle-input"
          autoFocus
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitTitle();
            else if (e.key === 'Escape') setEditingTitle(false);
          }}
        />
      ) : (
        <button
          className="mb-sc-doctitle"
          title="点击重命名"
          onClick={() => {
            setTitleDraft(docTitle);
            setEditingTitle(true);
          }}
        >
          {docTitle}
        </button>
      )}
      <span className="mb-sc-divider" />
      <span className="mb-sc-toolbar-label">添加节点</span>
      {ADD.map(([k, l]) => {
        const Ico = NODE_ICONS[k];
        return (
          <button
            key={k}
            className={`mb-btn mb-btn-sm mb-sc-tbtn ${pendingKind === k ? 'is-armed' : ''}`}
            onClick={() => setPendingKind(pendingKind === k ? null : k)}
          >
            <Ico size={15} />
            {l}
          </button>
        );
      })}
      {pendingKind && <span className="mb-sc-armed-hint">点画布落位 · Esc 取消</span>}

      <span className="mb-sc-divider" />
      <button className="mb-btn mb-btn-sm mb-btn-ghost mb-sc-tbtn" onClick={() => openRef.current?.click()}>
        <OpenIcon size={15} />
        打开
      </button>
      <button className="mb-btn mb-btn-sm mb-btn-ghost mb-sc-tbtn" onClick={() => exportCanvasToFile()}>
        <SaveIcon size={15} />
        保存
      </button>
      <button className="mb-btn mb-btn-sm mb-btn-ghost mb-sc-tbtn" onClick={resetView}>
        <FitViewIcon size={15} />
        重置视图
      </button>
      <button className="mb-btn mb-btn-sm mb-btn-ghost mb-sc-tbtn" onClick={() => void clear()}>
        <TrashIcon size={15} />
        清空
      </button>
      <button className="mb-btn mb-btn-sm mb-btn-ghost mb-sc-tbtn" onClick={() => setTplOpen((v) => !v)}>
        <TemplateIcon size={15} />
        模板
      </button>
      <span className="mb-sc-divider" />
      {running ? (
        <>
          <span className="mb-sc-count">
            运行中 {runDone}/{runTotal}
          </span>
          <button className="mb-btn mb-btn-sm mb-btn-danger mb-sc-tbtn" onClick={abortRunAll} title="停止并立即取消正在运行的节点">
            <StopIcon size={15} />
            停止
          </button>
        </>
      ) : (
        <button
          className="mb-btn mb-btn-sm mb-btn-primary mb-sc-tbtn"
          onClick={() => void runAllNodes()}
          title="按依赖顺序运行全图的工作 / ComfyUI / LLM 节点"
        >
          <RunAllIcon size={14} />
          运行全部
        </button>
      )}
      <span className="mb-sc-spacer" />
      <span className="mb-sc-count">{count} 节点</span>
      {tplOpen && <TemplatePanel onClose={() => setTplOpen(false)} />}
      <input
        ref={openRef}
        type="file"
        accept=".json,application/json"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) openFile(f);
          e.target.value = '';
        }}
      />
    </div>
  );
}
