import { NodeResizer, type NodeProps } from '@xyflow/react';
import { useSmartCanvasStore } from '@/store/smartCanvasStore';
import type { GroupNodeData } from '@shared/smartCanvas';
import { NodeShell } from './NodeShell';

/** 分组节点（聚合器）：把若干图片/提示词节点连进来，再连到工作节点，作为一组输入透传。可折叠收起子节点。 */
export function GroupNode({ id, data }: NodeProps): JSX.Element {
  const update = useSmartCanvasStore((s) => s.updateNodeData);
  const remove = useSmartCanvasStore((s) => s.removeNode);
  const toggle = useSmartCanvasStore((s) => s.toggleGroupCollapse);
  const childCount = useSmartCanvasStore((s) => s.nodes.filter((n) => n.parentId === id).length);
  const d = data as unknown as GroupNodeData;
  const collapsed = !!d.collapsed;

  return (
    <>
      <NodeResizer isVisible minWidth={200} minHeight={collapsed ? 44 : 150} />
      <NodeShell
        title="分组"
        accent="is-group"
        inputs
        outputs
        fill
        onDelete={() => remove(id)}
        label={d.label}
        labelColor={d.labelColor}
        headRight={
          <>
            <span className="mb-sc-group-count">{childCount} 项</span>
            <button className="mb-sc-node-x nodrag" onClick={() => toggle(id)} title={collapsed ? '展开' : '折叠'}>
              {collapsed ? '▸' : '▾'}
            </button>
          </>
        }
      >
        {collapsed ? (
          <div className="mb-sc-group-collapsed nodrag" onClick={() => toggle(id)} title="点击展开">
            {d.title || '分组'} · {childCount} 个节点（已折叠）
          </div>
        ) : (
          <>
            <input
              className="mb-sc-input nodrag"
              value={d.title ?? ''}
              onChange={(e) => update(id, { title: e.target.value })}
              placeholder="分组名"
            />
            <div className="mb-sc-empty">
              {childCount > 0
                ? `已含 ${childCount} 个节点。拖更多节点进框自动归入；把分组连到生成节点即整组喂入。`
                : '把图片 / 提示词节点拖进这个框 → 自动归入；再把分组连到生成节点，整组一起喂给生成。'}
            </div>
          </>
        )}
      </NodeShell>
    </>
  );
}
