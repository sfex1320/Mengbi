import { createPortal } from 'react-dom';
import { useSmartCanvasStore, useSmartTextStore } from '@/store/smartCanvasStore';
import { copyText } from './nodeArea';

/** 长文本放大查看：全屏读 + 复制 + 一键建提示词节点（LLM/结果文本看不全时用）。 */
export function SmartTextViewer(): JSX.Element | null {
  const text = useSmartTextStore((s) => s.text);
  const title = useSmartTextStore((s) => s.title);
  const close = useSmartTextStore((s) => s.close);
  if (text == null) return null;

  function makePromptNode(): void {
    // 不传位置 → 落当前视图正中心
    const id = useSmartCanvasStore.getState().addNode('prompt');
    useSmartCanvasStore.getState().updateNodeData(id, { text: text ?? '' });
    close();
  }

  return createPortal(
    <div className="mb-sc-textviewer-mask" onClick={close}>
      <div className="mb-sc-textviewer mb-card" onClick={(e) => e.stopPropagation()}>
        <div className="mb-sc-textviewer-head">
          <span>{title}（{text.length} 字）</span>
          <button className="mb-sc-node-x" onClick={close} title="关闭">
            ✕
          </button>
        </div>
        <textarea className="mb-textarea mb-sc-textviewer-body" readOnly value={text} />
        <div className="mb-sc-textviewer-foot">
          <button className="mb-btn mb-btn-sm mb-btn-ghost" onClick={() => copyText(text)}>
            复制全部
          </button>
          <button className="mb-btn mb-btn-sm mb-btn-primary" onClick={makePromptNode}>
            建提示词节点
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
