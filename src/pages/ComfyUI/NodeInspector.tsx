import { useComfyuiStore } from '@/store/comfyuiStore';
import { confirmDialog } from '@/components/ConfirmDialog';
import { toast } from '@/store/toastStore';
import type { InputControl, Binding } from '@shared/comfyui';

/** 选中节点详情：列出字段，可手动把任意字段「绑定」到一个输入控件（覆盖自动识别不到的字段）。 */
export function NodeInspector(): JSX.Element {
  const {
    activeGraph,
    selectedNodeId,
    activeBindings,
    outputNodeIds,
    setSelectedNode,
    addControl,
    removeControl,
    deleteNode,
    toggleOutputNode,
    toggleBypassNode
  } = useComfyuiStore();
  if (!activeGraph) {
    return <div className="mb-cfy-inspector-hint">导入工作流后可在此绑定字段。</div>;
  }
  const node = selectedNodeId ? activeGraph.nodes.find((n) => n.id === selectedNodeId) : undefined;
  if (!node) {
    return <div className="mb-cfy-inspector-hint">点选左侧节点，查看它的字段并「绑定」到参数面板。</div>;
  }

  const bindingFor = (field: string): Binding | undefined =>
    activeBindings.find(
      (b) =>
        (b.mode === 'parameter' || b.mode === 'file_upload') &&
        b.nodeId === node.id &&
        b.inputName === field
    );

  function inferType(field: string, value: unknown): InputControl['type'] {
    if (field === 'image') return 'image';
    if (field === 'mask') return 'mask';
    if (/video/.test(field)) return 'video';
    if (/audio/.test(field)) return 'audio';
    if (typeof value === 'number') return 'number';
    if (typeof value === 'boolean') return 'switch';
    if (/^(text|text_g|text_l|prompt|positive|negative)$/.test(field)) return 'prompt';
    return 'text';
  }

  function bind(field: string, value: unknown): void {
    const type = inferType(field, value);
    const id = `${node!.id}:${field}`;
    const isFile = type === 'image' || type === 'mask' || type === 'video' || type === 'audio' || type === 'file';
    const control: InputControl = {
      id,
      label: `${field} · ${node!.title ?? node!.classType}`,
      type,
      default: isFile ? undefined : (value as InputControl['default']),
      group: isFile ? '参考图' : '手动绑定'
    };
    const binding: Binding = isFile
      ? { mode: 'file_upload', controlId: id, nodeId: node!.id, inputName: field }
      : { mode: 'parameter', controlId: id, nodeId: node!.id, inputName: field };
    addControl(control, binding);
  }

  async function onDelete(): Promise<void> {
    const consumers = Array.from(
      new Set(activeGraph!.edges.filter((e) => e.fromNode === node!.id).map((e) => e.toNode))
    );
    const boundCount = activeBindings.filter((b) => 'nodeId' in b && b.nodeId === node!.id).length;
    const detailParts: string[] = [];
    if (consumers.length)
      detailParts.push(
        `${consumers.length} 个下游节点的连线将断开（#${consumers.join('、#')}），需在 ComfyUI 重连或重新导入该工作流。`
      );
    if (boundCount) detailParts.push(`绑定到该节点的 ${boundCount} 个参数控件会一并移除。`);
    const okToGo = await confirmDialog({
      title: '删除节点',
      message: `确定删除节点 #${node!.id}（${node!.title ?? node!.classType}）？`,
      detail: detailParts.join('') || undefined,
      danger: true,
      okText: '删除'
    });
    if (!okToGo) return;
    const id = node!.id;
    deleteNode(id);
    setSelectedNode(null);
    toast.success('已删除节点', consumers.length ? `${consumers.length} 个下游连线已断开` : undefined);
  }

  const isOutput = outputNodeIds.includes(node.id);
  const isBypassed = activeBindings.some((b) => b.mode === 'bypass' && b.nodeId === node.id);

  return (
    <div className="mb-cfy-inspector mb-card">
      <div className="mb-cfy-inspector-head">
        <span className="mb-cfy-section-title">
          节点 #{node.id} · {node.classType}
          {node.unknown && <span className="mb-cfy-unknown"> ⚠ 自定义/未知</span>}
        </span>
        <div className="mb-cfy-inspector-headbtns">
          <button className="mb-btn mb-btn-sm mb-btn-danger" onClick={() => void onDelete()}>
            删除节点
          </button>
          <button className="mb-btn mb-btn-sm mb-btn-ghost" onClick={() => setSelectedNode(null)}>
            关闭
          </button>
        </div>
      </div>

      <label className="mb-cfy-inspector-output">
        <input type="checkbox" checked={isOutput} onChange={() => toggleOutputNode(node.id)} />
        <span>仅读取此节点的输出</span>
        <span className="mb-cfy-inspector-output-hint">
          {outputNodeIds.length === 0 ? '（当前：收取全部输出节点）' : `（当前限定 ${outputNodeIds.length} 个）`}
        </span>
      </label>

      <label className="mb-cfy-inspector-output">
        <input type="checkbox" checked={isBypassed} onChange={() => toggleBypassNode(node.id)} />
        <span>忽略此节点（绕过）</span>
        <span className="mb-cfy-inspector-output-hint">运行时摘除，输入直接接到下游</span>
      </label>

      <div className="mb-cfy-inspector-list">
        {node.linkedInputs.map((f) => (
          <div key={`l-${f}`} className="mb-cfy-inspector-row is-linked">
            <span className="mb-cfy-inspector-field">{f}</span>
            <span className="mb-cfy-inspector-link">← 来自其它节点（连线）</span>
          </div>
        ))}
        {node.params.map((p) => {
          const b = bindingFor(p.name);
          return (
            <div key={p.name} className="mb-cfy-inspector-row">
              <span className="mb-cfy-inspector-field">{p.name}</span>
              <span className="mb-cfy-inspector-val" title={String(p.value)}>
                {String(p.value).slice(0, 40)}
              </span>
              {b ? (
                <button
                  className="mb-btn mb-btn-sm mb-btn-ghost"
                  onClick={() => {
                    if (b.mode === 'parameter' || b.mode === 'file_upload') removeControl(b.controlId);
                  }}
                >
                  解绑
                </button>
              ) : (
                <button className="mb-btn mb-btn-sm" onClick={() => bind(p.name, p.value)}>
                  绑定
                </button>
              )}
            </div>
          );
        })}
        {node.params.length === 0 && node.linkedInputs.length === 0 && (
          <div className="mb-cfy-form-empty">该节点没有可绑定的字段</div>
        )}
      </div>
    </div>
  );
}
