import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useReactFlow } from '@xyflow/react';
import { useSmartCanvasStore } from '@/store/smartCanvasStore';
import { useSmartTemplateStore, type SmartTemplate } from '@/store/smartTemplateStore';
import { toast } from '@/store/toastStore';
import { TrashIcon } from './icons';

/** 节点模板弹窗：把当前选区存为模板 + 一键插入已存模板（跨画布复用常用节点组合）。 */
export function TemplatePanel({ onClose }: { onClose: () => void }): JSX.Element {
  const templates = useSmartTemplateStore((s) => s.templates);
  const save = useSmartTemplateStore((s) => s.save);
  const remove = useSmartTemplateStore((s) => s.remove);
  const { screenToFlowPosition } = useReactFlow();
  const [name, setName] = useState('');

  function saveCurrent(): void {
    const cap = useSmartCanvasStore.getState().captureSelection();
    if (!cap) {
      toast.error('先在画布上选中要存为模板的节点');
      return;
    }
    save(name.trim() || `模板 ${templates.length + 1}`, cap.nodes, cap.edges);
    setName('');
    toast.success(`已存为模板（${cap.nodes.length} 节点）`);
  }

  function insert(t: SmartTemplate): void {
    const pos = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    useSmartCanvasStore.getState().insertNodes(t.nodes, t.edges, pos);
    toast.success(`已插入模板「${t.name}」`);
    onClose();
  }

  return createPortal(
    <>
      <div className="mb-sc-menu-backdrop" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <div
        className="mb-sc-templates mb-card"
        style={{ position: 'fixed', zIndex: 60, left: '50%', top: 64, transform: 'translateX(-50%)' }}
      >
        <div className="mb-sc-viewprefs-title">节点模板</div>
        <div className="mb-sc-templates-save">
          <input
            className="mb-input"
            placeholder="模板名（先选中节点）"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveCurrent();
            }}
          />
          <button className="mb-btn mb-btn-sm mb-btn-primary" onClick={saveCurrent}>
            存为模板
          </button>
        </div>
        <div className="mb-sc-templates-list">
          {templates.length === 0 ? (
            <div className="mb-sc-empty">还没有模板。选中若干节点 → 命名 → 「存为模板」，之后可一键插入任意画布。</div>
          ) : (
            templates.map((t) => (
              <div key={t.id} className="mb-sc-template-row">
                <button className="mb-sc-template-insert" title="插入到画布中心" onClick={() => insert(t)}>
                  <span className="mb-sc-template-name">{t.name}</span>
                  <span className="mb-sc-template-count">{t.count} 节点</span>
                </button>
                <button className="mb-sc-node-x nodrag" title="删除模板" onClick={() => remove(t.id)}>
                  <TrashIcon size={13} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </>,
    document.body
  );
}
