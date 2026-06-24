import { useEffect, useMemo } from 'react';
import { NodeResizer, type NodeProps } from '@xyflow/react';
import { useSmartCanvasStore } from '@/store/smartCanvasStore';
import { useSettingsStore } from '@/store/settingsStore';
import { computeUpstream, runVideoReverseNode } from '@/lib/smartCanvasRunner';
import { REVERSE_TYPE_LABELS, type VideoReverseNodeData, type ReverseType, type SmartNodeData } from '@shared/smartCanvas';
import { NodeShell } from './NodeShell';
import { SegmentedControl, ClampNumberInput, SearchableModelSelect } from '../nodePanel/consoleControls';
import { CopyButton, ToPromptButton, copyText, areaMenu, makePromptNodeFrom, autoGrowNode } from '../nodeArea';

const STATUS_TEXT: Record<string, string> = { idle: '待运行', running: '反推中…', success: '已完成', error: '失败' };

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

/** 视频反推节点：接一个视频 → 渲染端抽帧 → 多图反推 → 文本，喂下游。复用 api:lab:reverse。 */
export function VideoReverseNode({ id, data }: NodeProps): JSX.Element {
  const update = useSmartCanvasStore((s) => s.updateNodeData);
  const remove = useSmartCanvasStore((s) => s.removeNode);
  const nodes = useSmartCanvasStore((s) => s.nodes);
  const edges = useSmartCanvasStore((s) => s.edges);
  const d = data as unknown as VideoReverseNodeData;
  const models = useTextModels();
  const setF = (p: Partial<VideoReverseNodeData>): void => update(id, p as Partial<SmartNodeData>);
  const up = useMemo(() => computeUpstream(nodes, edges, id), [nodes, edges, id]);
  const running = d.status === 'running';
  const hasVideo = up.videos.length > 0;

  useEffect(() => {
    // 输出在 .mb-sc-llm-out 内最高 110px 滚动，按可见高度估、双向贴合（避免空白）
    autoGrowNode(id, 210 + (d.resultText?.trim() ? 120 : 0));
  }, [id, d.resultText]);

  return (
    <>
      <NodeResizer isVisible minWidth={220} minHeight={170} />
      <NodeShell
        title="视频反推"
        accent="is-video-reverse"
        inputs
        outputs
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
          <SearchableModelSelect
            value={d.modelId}
            options={models}
            placeholder="（选视觉对话模型）"
            onChange={(v) => setF({ modelId: v })}
          />
          <SegmentedControl
            value={d.reverseType}
            size="sm"
            options={(Object.keys(REVERSE_TYPE_LABELS) as ReverseType[]).map((k) => ({ value: k, label: REVERSE_TYPE_LABELS[k] }))}
            onChange={(v) => setF({ reverseType: v as ReverseType })}
          />
          <label className="mb-sc-revrow">
            抽帧数
            <ClampNumberInput min={1} max={12} value={d.frameCount ?? 6} onCommit={(v) => setF({ frameCount: v })} />
          </label>
          {hasVideo ? (
            <div className="mb-sc-fromup is-fed">视频由上游输入（{up.videos.length} 个），抽帧反推</div>
          ) : (
            <div className="mb-sc-empty">连一个「视频上传 / 视频生成」节点进来</div>
          )}
        </div>
        <button className="mb-btn mb-btn-sm mb-btn-primary nodrag" disabled={running || !d.modelId || !hasVideo} onClick={() => void runVideoReverseNode(id)}>
          {running ? '反推中…' : '运行反推'}
        </button>
        {d.error && <div className="mb-sc-result-err nodrag">{d.error}</div>}
        {d.resultText?.trim() && (
          <div className="mb-sc-arearel">
            <CopyButton onClick={() => copyText(d.resultText ?? '')} />
            <pre
              className="mb-sc-llm-out nodrag nowheel"
              onContextMenu={(e) =>
                areaMenu(e, [
                  { label: '复制', onClick: () => copyText(d.resultText ?? '') },
                  { label: '用输出建提示词节点', onClick: () => makePromptNodeFrom(id, d.resultText ?? '') }
                ])
              }
            >
              {d.resultText.trim()}
            </pre>
            <ToPromptButton onClick={() => makePromptNodeFrom(id, d.resultText ?? '')} />
          </div>
        )}
      </NodeShell>
    </>
  );
}
