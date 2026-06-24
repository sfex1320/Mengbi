import { useEffect, useMemo } from 'react';
import { NodeResizer, type NodeProps } from '@xyflow/react';
import { useSmartCanvasStore, useSmartTextStore } from '@/store/smartCanvasStore';
import { useSettingsStore } from '@/store/settingsStore';
import { computeUpstream, runStoryboardNode } from '@/lib/smartCanvasRunner';
import { useStoryboardStudioStore } from '../StoryboardStudio';
import type { StoryboardNodeData, SmartNodeData } from '@shared/smartCanvas';
import { NodeShell } from './NodeShell';
import { StepperInput } from '../nodePanel/consoleControls';
import { autoGrowNode } from '../nodeArea';

const STATUS_TEXT: Record<string, string> = { idle: '待运行', running: '生成中…', success: '已完成', error: '失败' };

/** 当前方案的对话(text)模型显示名。 */
function useTextModels(): string[] {
  const configs = useSettingsStore((s) => s.configs);
  return useMemo(() => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const c of configs) {
      if (c.type !== 'text') continue;
      for (const n of Object.keys(c.model_mapping ?? {})) if (!seen.has(n)) { seen.add(n); out.push(n); }
    }
    return out;
  }, [configs]);
}

/**
 * 智能分镜节点（精简卡片）：模型 + 数量 + 素材 + 运行 + 摘要。
 * 固定约束 / 故事 / 分镜列表 / 转场列表 等全部在「分镜工作台」弹窗里（useStoryboardStudioStore）。
 * 双输出口不变：右上 out=分镜提示词、右下 out-trans=镜头转场提示词，按口喂下游。
 */
export function StoryboardNode({ id, data }: NodeProps): JSX.Element {
  const update = useSmartCanvasStore((s) => s.updateNodeData);
  const remove = useSmartCanvasStore((s) => s.removeNode);
  const nodes = useSmartCanvasStore((s) => s.nodes);
  const edges = useSmartCanvasStore((s) => s.edges);
  const openText = useSmartTextStore((s) => s.open);
  const openStudio = useStoryboardStudioStore((s) => s.open);
  const d = data as unknown as StoryboardNodeData;
  const models = useTextModels();
  const setF = (p: Partial<StoryboardNodeData>): void => update(id, p as Partial<SmartNodeData>);
  const up = useMemo(() => computeUpstream(nodes, edges, id), [nodes, edges, id]);
  const running = d.status === 'running';
  const shots = d.shots ?? [];
  const transitions = d.transitions ?? [];
  const upFed = up.prompts.length > 0;
  const upImgs = up.images.length;

  useEffect(() => {
    let need = 270;
    if (upImgs) need += 28;
    if (d.story?.trim() || shots.length) need += 30;
    autoGrowNode(id, need, 480);
  }, [id, d.story, shots.length, upImgs]);

  const summary = [d.story?.trim() ? '故事 ✓' : null, shots.length ? `${shots.length} 分镜` : null, transitions.length ? `${transitions.length} 转场` : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <>
      <NodeResizer isVisible minWidth={250} minHeight={230} />
      <NodeShell
        title="智能分镜"
        accent="is-storyboard"
        inputs
        outputs={[
          { id: 'out', title: '分镜提示词（上口）：每条分镜按序喂下游' },
          { id: 'out-trans', title: '镜头转场提示词（下口）：分镜之间的运动轨迹/运镜/场景过渡' }
        ]}
        fill
        onDelete={() => remove(id)}
        headRight={
          <span className={`mb-sc-status is-${d.status}`}>
            {running && <span className="mb-sc-spinner" aria-hidden />}
            {STATUS_TEXT[d.status] ?? d.status}
          </span>
        }
      >
        <div className="mb-sc-revctl nodrag">
          <select className="mb-select" value={d.modelId} onChange={(e) => setF({ modelId: e.target.value })}>
            <option value="">（选对话模型）</option>
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <div className="mb-sc-sb-row">
            <span className="mb-sc-sb-lbl">分镜数量</span>
            <StepperInput value={Math.max(2, Math.min(20, d.shotCount || 4))} min={2} max={20} onChange={(v) => setF({ shotCount: v })} />
          </div>
          {upImgs > 0 && <div className="mb-sc-fromup is-fed">参考图 {upImgs} 张（运行时自动分析并入素材）</div>}
          {upFed ? (
            <div className="mb-sc-fromup is-fed">故事素材由上游输入（{up.prompts.length} 条，运行时自动合并）</div>
          ) : (
            <textarea
              className="mb-sc-input mb-sc-sb-ta"
              rows={3}
              value={d.input}
              placeholder={upImgs ? '可补充文字素材（与参考图分析合并）' : '输入一篇故事或一个短句（先扩成完整故事，再拆分镜+转场）'}
              onChange={(e) => setF({ input: e.target.value })}
            />
          )}
          <button className="mb-btn mb-btn-sm mb-btn-primary mb-sc-studio-openbtn" title="固定约束 / 完整故事 / 分镜与转场列表 都在工作台里" onClick={() => openStudio(id)}>
            🎛 打开分镜工作台
          </button>
        </div>

        <div className="mb-sc-sb-runrow nodrag">
          <button className="mb-btn mb-btn-sm" disabled={running || !d.modelId} onClick={() => void runStoryboardNode(id)}>
            {running ? '生成中…' : shots.length ? '重新生成分镜' : '生成分镜'}
          </button>
        </div>

        {d.error && <div className="mb-sc-result-err nodrag">{d.error}</div>}
        {!d.error && running && d.logs?.length ? <div className="mb-sc-work-dur nodrag">{d.logs[d.logs.length - 1]}</div> : null}

        {summary && (
          <div
            className="mb-sc-note nodrag"
            style={{ cursor: 'pointer' }}
            title="点击查看完整故事；分镜/转场逐条在工作台里"
            onClick={() => (d.story?.trim() ? openText(d.story, '完整故事') : openStudio(id))}
          >
            {summary} · 右上口=分镜 / 右下口=转场 · 详情进工作台
          </div>
        )}
      </NodeShell>
    </>
  );
}
