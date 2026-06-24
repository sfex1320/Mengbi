import { useEffect, useMemo, useRef } from 'react';
import { NodeResizer, type NodeProps } from '@xyflow/react';
import { useSmartCanvasStore } from '@/store/smartCanvasStore';
import { useSettingsStore } from '@/store/settingsStore';
import { computeUpstream, runImageReverseNode } from '@/lib/smartCanvasRunner';
import { REVERSE_TYPE_LABELS, type ImageReverseNodeData, type ReverseType, type SmartNodeData } from '@shared/smartCanvas';
import { NodeShell } from './NodeShell';
import { SegmentedControl, SearchableModelSelect } from '../nodePanel/consoleControls';
import { CopyButton, ToPromptButton, copyText, areaMenu, makePromptNodeFrom, autoGrowNode } from '../nodeArea';

const STATUS_TEXT: Record<string, string> = { idle: '待运行', running: '反推中…', success: '已完成', error: '失败' };

/** 当前方案的对话(text)模型显示名（图像反推需视觉/识图能力的对话模型）。 */
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

/** 图像反推节点：接一张图 → 视觉模型反推 → 描述/标签/风格 文本，喂下游。复用 api:lab:reverse。 */
export function ImageReverseNode({ id, data }: NodeProps): JSX.Element {
  const update = useSmartCanvasStore((s) => s.updateNodeData);
  const remove = useSmartCanvasStore((s) => s.removeNode);
  const nodes = useSmartCanvasStore((s) => s.nodes);
  const edges = useSmartCanvasStore((s) => s.edges);
  const d = data as unknown as ImageReverseNodeData;
  const models = useTextModels();
  const fileRef = useRef<HTMLInputElement>(null);
  const setF = (p: Partial<ImageReverseNodeData>): void => update(id, p as Partial<SmartNodeData>);
  const up = useMemo(() => computeUpstream(nodes, edges, id), [nodes, edges, id]);
  const running = d.status === 'running';
  const upImg = up.images[0];

  useEffect(() => {
    // 输出在 .mb-sc-llm-out 内最高 110px 滚动，故按可见高度估、双向贴合（避免长文本撑出大片空白）
    autoGrowNode(id, 200 + (d.resultText?.trim() ? 120 : 0));
  }, [id, d.resultText]);

  function loadFile(file?: File | null): void {
    if (!file || !file.type.startsWith('image/')) return;
    const r = new FileReader();
    r.onload = () => setF({ inputImage: { url: String(r.result), name: file.name } });
    r.readAsDataURL(file);
  }

  return (
    <>
      <NodeResizer isVisible minWidth={220} minHeight={170} />
      <NodeShell
        title="图像反推"
        accent="is-image-reverse"
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
          {upImg ? (
            <div className="mb-sc-fromup is-fed">图片由上游输入（{up.images.length} 张），无需手填</div>
          ) : (
            <button className="mb-btn mb-btn-sm mb-btn-ghost" onClick={() => fileRef.current?.click()}>
              {d.inputImage?.url ? '换图' : '上传图片'}
            </button>
          )}
        </div>
        <button className="mb-btn mb-btn-sm mb-btn-primary nodrag" disabled={running || !d.modelId} onClick={() => void runImageReverseNode(id)}>
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
        <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => { loadFile(e.target.files?.[0]); e.target.value = ''; }} />
      </NodeShell>
    </>
  );
}
