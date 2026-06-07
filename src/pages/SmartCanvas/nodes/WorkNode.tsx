import { useEffect, useMemo } from 'react';
import { NodeResizer, type NodeProps } from '@xyflow/react';
import { useSmartCanvasStore, useSmartPreviewStore } from '@/store/smartCanvasStore';
import { runWithUpstream, computeUpstream, cancelWork } from '@/lib/smartCanvasRunner';
import { localPathToImageUrl } from '@/lib/imageUrl';
import { WORK_TYPE_LABELS, RUN_MODE_LABELS, PROVIDER_LABELS, type WorkNodeData } from '@shared/smartCanvas';
import { NodeShell } from './NodeShell';
import { MeasuredThumb } from '../MeasuredThumb';
import { estimateTextHeight, autoGrowNode, getNodeWidth, fmtDur, areaMenu, copyImage, imageToGallery, imageSaveAs } from '../nodeArea';

const STATUS_TEXT: Record<string, string> = {
  idle: '待运行',
  running: '运行中…',
  success: '成功',
  error: '失败'
};

function imgUrl(src: string): string {
  return src.startsWith('data:') ? src : localPathToImageUrl(src);
}

/** 工作（生成）节点：紧凑展示类型/后端/状态/运行 + 实时预览上游输入 + 结果缩略图（参数在弹出控制台里调）。 */
export function WorkNode({ id, data }: NodeProps): JSX.Element {
  const remove = useSmartCanvasStore((s) => s.removeNode);
  const nodes = useSmartCanvasStore((s) => s.nodes);
  const edges = useSmartCanvasStore((s) => s.edges);
  const openPreview = useSmartPreviewStore((s) => s.open);
  const d = data as unknown as WorkNodeData;
  const running = d.status === 'running';
  const backend = d.provider === 'mock' ? PROVIDER_LABELS.mock : d.modelId || '未选模型（选中后在控制台里选）';

  const up = useMemo(() => computeUpstream(nodes, edges, id), [nodes, edges, id]);
  const firstPrompt = up.prompts[0];

  const upPromptText = up.prompts.join('\n');
  const resultCount = d.result?.images?.length ?? 0;
  useEffect(() => {
    const width = getNodeWidth(id);
    let need = 150;
    if (up.images.length) need += 96;
    if (upPromptText) need += Math.min(80, 24 + estimateTextHeight(upPromptText, width));
    if (resultCount) need += 96;
    autoGrowNode(id, need);
  }, [id, up.images.length, upPromptText, resultCount]);

  return (
    <>
      <NodeResizer isVisible minWidth={220} minHeight={140} />
      <NodeShell
        title="生成"
        accent="is-work"
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
        <div className="mb-sc-work-line">
          {WORK_TYPE_LABELS[d.workType]} · {RUN_MODE_LABELS[d.runMode]}
        </div>
        <div className="mb-sc-work-model" title={backend}>
          {PROVIDER_LABELS[d.provider]}：{backend}
        </div>

        {(up.images.length > 0 || up.prompts.length > 0) && (
          <div className="mb-sc-up">
            <div className="mb-sc-up-head">上游输入 · {up.images.length} 图 / {up.prompts.length} 词</div>
            {up.images.length > 0 && (
              <div className="mb-sc-up-thumbs nodrag">
                {up.images.slice(0, 4).map((p, i) => (
                  <img key={i} src={imgUrl(p)} alt={`上游图 ${i + 1}`} draggable={false} onClick={() => openPreview(imgUrl(p))} />
                ))}
              </div>
            )}
            {firstPrompt && <div className="mb-sc-up-prompt" title={up.prompts.join('\n')}>“{firstPrompt}”</div>}
          </div>
        )}

        <div className="mb-sc-work-runrow nodrag">
          <button className="mb-btn mb-btn-sm mb-btn-primary" disabled={running} onClick={() => void runWithUpstream(id)}>
            {running ? '运行中…' : '运行'}
          </button>
          {running && (
            <button className="mb-btn mb-btn-sm mb-btn-ghost" onClick={() => cancelWork(id)} title="取消并释放队列槽，可立即重试">
              取消
            </button>
          )}
        </div>

        {d.error && <div className="mb-sc-result-err nodrag">{d.error}</div>}
        {d.result?.durationMs != null && <div className="mb-sc-work-dur">{fmtDur(d.result.durationMs)}</div>}

        {d.result?.images && d.result.images.length > 0 && (
          <div className="mb-sc-work-thumbs nodrag">
            {d.result.images.slice(0, 4).map((p, i) => (
              <MeasuredThumb
                key={i}
                src={imgUrl(p)}
                alt={`结果 ${i + 1}`}
                title="结果 · 角标=实际分辨率 · 右键复制 / 入图库 / 另存"
                onClick={() => openPreview(imgUrl(p))}
                onContextMenu={(e) =>
                  areaMenu(e, [
                    { label: '复制图片', onClick: () => void copyImage(imgUrl(p)) },
                    { label: '放大预览', onClick: () => openPreview(imgUrl(p)) },
                    { label: '入图库', onClick: () => void imageToGallery(p) },
                    { label: '另存…', onClick: () => void imageSaveAs(p, 'smart-canvas-result.png') }
                  ])
                }
              />
            ))}
          </div>
        )}
      </NodeShell>
    </>
  );
}
