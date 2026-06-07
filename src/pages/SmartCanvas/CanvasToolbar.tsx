import { useRef, useState } from 'react';
import { useReactFlow, useStore } from '@xyflow/react';
import { useSmartCanvasStore, useSmartCanvasUiStore, useSmartRunStore } from '@/store/smartCanvasStore';
import { useSmartDocsStore } from '@/store/smartDocsStore';
import { exportCanvasToFile, importCanvasFromText } from '@/lib/smartCanvasApi';
import { backToLauncher } from '@/lib/smartDocStorage';
import { runAllNodes, abortRunAll } from '@/lib/smartCanvasRunner';
import { toast } from '@/store/toastStore';
import { confirmDialog } from '@/components/ConfirmDialog';
import {
  OpenIcon,
  SaveIcon,
  FitViewIcon,
  TrashIcon,
  BackIcon,
  RunAllIcon,
  StopIcon,
  TemplateIcon,
  LayoutIcon,
  SlidersIcon,
  SearchIcon,
  KeyboardIcon,
  ZoomInIcon,
  ZoomOutIcon
} from './icons';

/** 顶部工具条：左=画布菜单 + 标题；右=视图/文件/面板/运行 的图标工具条（图标统一、悬停出名）。 */
export function CanvasToolbar(): JSX.Element {
  const reset = useSmartCanvasStore((s) => s.reset);
  const count = useSmartCanvasStore((s) => s.nodes.length);
  const activeDocId = useSmartDocsStore((s) => s.activeDocId);
  const docTitle = useSmartDocsStore((s) => s.docs.find((d) => d.id === s.activeDocId)?.title ?? '智能画布');
  const renameDoc = useSmartDocsStore((s) => s.renameDoc);
  const running = useSmartRunStore((s) => s.running);
  const runDone = useSmartRunStore((s) => s.done);
  const runTotal = useSmartRunStore((s) => s.total);
  const panel = useSmartCanvasUiStore((s) => s.panel);
  const togglePanel = useSmartCanvasUiStore((s) => s.togglePanel);
  const { fitView, setViewport, zoomIn, zoomOut, zoomTo } = useReactFlow();
  const zoom = useStore((s) => s.transform[2]);
  const openRef = useRef<HTMLInputElement>(null);
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
    <div className="mb-sc-topbar">
      {/* 左：画布菜单 + 标题 */}
      <div className="mb-sc-topbar-left mb-card">
        <button className="mb-sc-ubtn" title="返回画布菜单（先自动保存当前画布）" onClick={backToLauncher}>
          <BackIcon size={16} />
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
      </div>

      {/* 右：视图 / 文件 / 面板 / 运行 */}
      <div className="mb-sc-topbar-right mb-card">
        <button className="mb-sc-ubtn" title="缩小" onClick={() => void zoomOut({ duration: 200 })}>
          <ZoomOutIcon size={16} />
        </button>
        <button className="mb-sc-ubtn mb-sc-zoomval" title="点击恢复 100%" onClick={() => void zoomTo(1, { duration: 200 })}>
          {Math.round((zoom || 1) * 100)}%
        </button>
        <button className="mb-sc-ubtn" title="放大" onClick={() => void zoomIn({ duration: 200 })}>
          <ZoomInIcon size={16} />
        </button>
        <button className="mb-sc-ubtn" title="适应全部（重置视图）" onClick={resetView}>
          <FitViewIcon size={16} />
        </button>

        <span className="mb-sc-ubar-sep" aria-hidden />
        <button className="mb-sc-ubtn" title="打开画布文件" onClick={() => openRef.current?.click()}>
          <OpenIcon size={16} />
        </button>
        <button className="mb-sc-ubtn" title="保存画布到文件" onClick={() => exportCanvasToFile()}>
          <SaveIcon size={16} />
        </button>
        <button className={`mb-sc-ubtn ${panel === 'template' ? 'is-on' : ''}`} title="节点模板" onClick={() => togglePanel('template')}>
          <TemplateIcon size={16} />
        </button>

        <span className="mb-sc-ubar-sep" aria-hidden />
        <button className={`mb-sc-ubtn ${panel === 'arrange' ? 'is-on' : ''}`} title="排布" onClick={() => togglePanel('arrange')}>
          <LayoutIcon size={16} />
        </button>
        <button className={`mb-sc-ubtn ${panel === 'viewPrefs' ? 'is-on' : ''}`} title="外观（连线 / 对齐）" onClick={() => togglePanel('viewPrefs')}>
          <SlidersIcon size={16} />
        </button>
        <button className={`mb-sc-ubtn ${panel === 'search' ? 'is-on' : ''}`} title="搜索节点（Ctrl+F）" onClick={() => togglePanel('search')}>
          <SearchIcon size={16} />
        </button>
        <button className={`mb-sc-ubtn ${panel === 'keys' ? 'is-on' : ''}`} title="快捷键" onClick={() => togglePanel('keys')}>
          <KeyboardIcon size={16} />
        </button>
        <button className="mb-sc-ubtn" title="清空画布" onClick={() => void clear()}>
          <TrashIcon size={16} />
        </button>

        <span className="mb-sc-ubar-sep" aria-hidden />
        {running ? (
          <button className="mb-sc-runbtn is-stop" onClick={abortRunAll} title="停止并立即取消正在运行的节点">
            <StopIcon size={15} />
            停止 {runDone}/{runTotal}
          </button>
        ) : (
          <button
            className="mb-sc-runbtn"
            onClick={() => void runAllNodes()}
            title="按依赖顺序运行全图的工作 / ComfyUI / LLM 节点"
          >
            <RunAllIcon size={14} />
            运行全部
          </button>
        )}
      </div>

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
