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
          <button className="mb-sc-node-x nodrag" onClick={() => toggle(id)} title={collapsed ? '展开' : '折叠'}>
            {collapsed ? '▸' : '▾'}
          </button>
        }
      >
        {collapsed ? (
          <div className="mb-sc-group-collapsed nodrag" onClick={() => toggle(id)} title="点击展开">
            {d.title || '分组'} · {childCount} 个节点（已折叠）
          </div>
        ) : (
          // 分组名 + 节点数同一行（在子节点之上、不被自动归组的节点遮住）；去掉原说明文字
          <div className="mb-sc-group-titlerow nodrag">
            <input
              className="mb-sc-input"
              value={d.title ?? ''}
              onChange={(e) => update(id, { title: e.target.value })}
              placeholder="分组名"
            />
            <span className="mb-sc-group-count" title="组内节点数">{childCount} 项</span>
          </div>
        )}
      </NodeShell>
    </>
  );
}
