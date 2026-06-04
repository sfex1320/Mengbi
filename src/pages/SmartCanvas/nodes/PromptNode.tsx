import { useEffect, useRef } from 'react';
import { NodeResizer, type NodeProps } from '@xyflow/react';
import { useSmartCanvasStore } from '@/store/smartCanvasStore';
import type { PromptNodeData } from '@shared/smartCanvas';
import { NodeShell } from './NodeShell';
import { CopyButton, areaMenu, copyText, fitNodeHeight, estimateTextHeight, autoGrowNode, getNodeWidth } from '../nodeArea';

export function PromptNode({ id, data }: NodeProps): JSX.Element {
  const update = useSmartCanvasStore((s) => s.updateNodeData);
  const remove = useSmartCanvasStore((s) => s.removeNode);
  const beginEdit = useSmartCanvasStore((s) => s.beginEdit);
  const commitEdit = useSmartCanvasStore((s) => s.commitEdit);
  const d = data as unknown as PromptNodeData;
  const taRef = useRef<HTMLTextAreaElement>(null);

  // 自适应：提示词越长节点越高，保证完整可见（只增不减；宽度即时取、不入依赖避免与缩放打架）
  useEffect(() => {
    autoGrowNode(id, 70 + estimateTextHeight(d.text ?? '', getNodeWidth(id)));
  }, [id, d.text]);

  return (
    <>
      <NodeResizer isVisible minWidth={180} minHeight={120} />
      <NodeShell title="提示词" accent="is-prompt" outputs fill onDelete={() => remove(id)} label={d.label} labelColor={d.labelColor}>
        <div className="mb-sc-area">
          <CopyButton onClick={() => copyText(d.text ?? '')} />
          <textarea
            ref={taRef}
            className="mb-sc-input mb-sc-textarea nodrag"
            value={d.text ?? ''}
            onFocus={beginEdit}
            onBlur={commitEdit}
            onChange={(e) => update(id, { text: e.target.value })}
            placeholder="输入提示词…"
            onContextMenu={(e) =>
              areaMenu(e, [
                { label: '复制', onClick: () => copyText(d.text ?? '') },
                {
                  label: '粘贴',
                  onClick: () =>
                    void navigator.clipboard.readText().then((t) => update(id, { text: (d.text ?? '') + t }))
                },
                { label: '适配高度', onClick: () => fitNodeHeight(id, taRef.current) },
                { separator: true },
                { label: '清空', variant: 'danger', onClick: () => update(id, { text: '' }) }
              ])
            }
          />
        </div>
      </NodeShell>
    </>
  );
}
