import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { NodeResizer, type NodeProps } from '@xyflow/react';
import { useSmartCanvasStore } from '@/store/smartCanvasStore';
import type { TextNodeData, SmartNodeData } from '@shared/smartCanvas';

/**
 * 文字节点：画布上的自由文字（标题 / 备注 / 标注）。双击编辑内容；字体 / 字号 / 颜色 / 粗体 / 斜体 / 对齐
 * 在弹出检查器里调。无连接口（纯画布注释，不参与生成）。
 */
export function TextNode({ id, data, selected }: NodeProps): JSX.Element {
  const update = useSmartCanvasStore((s) => s.updateNodeData);
  const remove = useSmartCanvasStore((s) => s.removeNode);
  const beginEdit = useSmartCanvasStore((s) => s.beginEdit);
  const commitEdit = useSmartCanvasStore((s) => s.commitEdit);
  const setNodeSize = useSmartCanvasStore((s) => s.setNodeSize);
  const d = data as unknown as TextNodeData;
  const [editing, setEditing] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (editing && taRef.current) {
      taRef.current.focus();
      taRef.current.select();
      beginEdit();
    }
  }, [editing, beginEdit]);

  // 自适应贴合：按文字实际渲染高度（含按节点宽度换行后的高度）双向贴合节点高度；
  // 手动调过尺寸（manualSize）则让位手动。文字按 .mb-sc-textnode-view 的 width:100% 自动适应节点宽度换行。
  useEffect(() => {
    const el = editing ? taRef.current : viewRef.current;
    if (!el) return;
    const n = useSmartCanvasStore.getState().nodes.find((x) => x.id === id);
    if ((n?.data as { manualSize?: boolean } | undefined)?.manualSize) return;
    const apply = (): void => {
      const cur = useSmartCanvasStore.getState().nodes.find((x) => x.id === id);
      if (!cur || (cur.data as { manualSize?: boolean } | undefined)?.manualSize) return;
      const need = Math.ceil(el.scrollHeight) + 14;
      const curH = typeof cur.height === 'number' ? cur.height : cur.measured?.height ?? 0;
      if (Math.abs(need - curH) > 4) setNodeSize(id, { height: need });
    };
    apply();
    // 节点变宽 → 文字重排 → view 高度变 → ResizeObserver 重新贴合（解决「字体排布适应节点宽度」）
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [id, d.text, d.fontSize, d.bold, d.italic, d.align, editing, setNodeSize]);

  const style: CSSProperties = {
    fontFamily: d.fontFamily || undefined,
    fontSize: `${d.fontSize ?? 22}px`,
    color: d.color || 'var(--mb-text-primary)',
    fontWeight: d.bold ? 700 : 400,
    fontStyle: d.italic ? 'italic' : 'normal',
    textAlign: d.align ?? 'left'
  };

  return (
    <div className={`mb-sc-textnode ${selected ? 'is-sel' : ''} ${editing ? 'is-editing' : ''}`}>
      <NodeResizer isVisible={!!selected} minWidth={80} minHeight={36} />
      {selected && !editing ? (
        <button className="mb-sc-textnode-x nodrag" title="删除文字" onClick={() => remove(id)}>
          ✕
        </button>
      ) : null}
      {editing ? (
        <textarea
          ref={taRef}
          className="mb-sc-textnode-edit nodrag nowheel"
          value={d.text}
          style={style}
          placeholder="输入文字…"
          onChange={(e) => update(id, { text: e.target.value } as Partial<SmartNodeData>)}
          onBlur={() => {
            setEditing(false);
            commitEdit();
          }}
        />
      ) : (
        <div ref={viewRef} className="mb-sc-textnode-view" style={style} onDoubleClick={() => setEditing(true)} title="双击编辑">
          {d.text || '双击编辑文字'}
        </div>
      )}
    </div>
  );
}
