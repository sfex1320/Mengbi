import { useMemo } from 'react';
import { NodeResizer, type NodeProps } from '@xyflow/react';
import { useSmartCanvasStore, useSmartPreviewStore, useSmartResultStore, useSmartTextStore } from '@/store/smartCanvasStore';
import { computeUpstream } from '@/lib/smartCanvasRunner';
import { localPathToImageUrl } from '@/lib/imageUrl';
import { providerLabel, type ResultNodeData } from '@shared/smartCanvas';
import { NodeShell } from './NodeShell';
import { MeasuredThumb } from '../MeasuredThumb';
import { areaMenu, copyImage, copyText, imageSaveAs, fmtDur } from '../nodeArea';

function mediaUrl(src: string): string {
  return src.startsWith('data:') ? src : localPathToImageUrl(src);
}

/** 把结果项写进拖拽载荷：拖到画布空白即落成对应节点（图→图片节点 / 文本→提示词节点）。 */
function dragImage(e: React.DragEvent, src: string): void {
  e.dataTransfer.setData('application/mengbi-sc-node', JSON.stringify({ kind: 'image', src, name: '结果图' }));
  e.dataTransfer.effectAllowed = 'copy';
}
function dragText(e: React.DragEvent, text: string): void {
  e.dataTransfer.setData('application/mengbi-sc-node', JSON.stringify({ kind: 'prompt', text }));
  e.dataTransfer.effectAllowed = 'copy';
}

/**
 * 结果节点（统一集合）：每次生成的结果都累积排布在此，未重启一直保留、重启清空。
 * 支持图片 / 文本 / 视频；每项可拖出成对应节点；本节点带输出口，可继续连到下游节点。
 * 累积存内存 useSmartResultStore（不进文档）。点图放大；右键/检查器有入图库/另存/作参考图。
 */
export function ResultNode({ id, data }: NodeProps): JSX.Element {
  const d = data as unknown as ResultNodeData;
  const remove = useSmartCanvasStore((s) => s.removeNode);
  const updateNodeData = useSmartCanvasStore((s) => s.updateNodeData);
  const nodes = useSmartCanvasStore((s) => s.nodes);
  const edges = useSmartCanvasStore((s) => s.edges);
  const openPreview = useSmartPreviewStore((s) => s.open);
  const openText = useSmartTextStore((s) => s.open);
  const results = useSmartResultStore((s) => s.accum[id] ?? []);
  const clearStore = useSmartResultStore((s) => s.clear);
  // 清空累积同时清掉 data.result（下游 computeUpstream 的桥），避免清空后下游仍读到旧结果
  const clearAccum = (nodeId: string): void => {
    clearStore(nodeId);
    updateNodeData(nodeId, { result: null });
  };

  const images = results.flatMap((r) => r.images);
  const texts = results.flatMap((r) => r.texts ?? []);
  const videos = results.flatMap((r) => r.videos ?? []);
  const total = images.length + texts.length + videos.length;
  const last = results[results.length - 1];

  const metaParts: string[] = [];
  if (images.length) metaParts.push(`${images.length} 图`);
  if (texts.length) metaParts.push(`${texts.length} 文本`);
  if (videos.length) metaParts.push(`${videos.length} 视频`);

  // 上游「组合预览」：连进来的 分组/提示词/图片 等的实时组合内容（看多段提示词/图如何组成）。
  // 图片预览仅在还没有累积运行结果时显示，避免和「运行结果」重复（生成节点跑完后其图已在下方累积区）。
  const up = useMemo(() => computeUpstream(nodes, edges, id), [nodes, edges, id]);
  const combined = up.prompts.join('\n\n');
  const showImgPreview = up.images.length > 0 && images.length === 0;
  const hasPreview = up.prompts.length > 0 || showImgPreview;

  return (
    <>
      <NodeResizer isVisible minWidth={180} minHeight={140} />
      <NodeShell
        title="结果"
        accent="is-result"
        inputs
        outputs
        fill
        onDelete={() => remove(id)}
        label={d.label}
        labelColor={d.labelColor}
        headRight={
          total ? (
            <button className="mb-sc-node-x nodrag" title="清空累积结果" onClick={() => clearAccum(id)}>
              清空
            </button>
          ) : undefined
        }
      >
        {hasPreview && (
          <div className="mb-sc-result-preview nodrag">
            <div className="mb-sc-result-meta">
              上游组合预览 · {up.images.length} 图 / {up.prompts.length} 段词（按连线/卡片顺序组合）
            </div>
            {combined && (
              <div className="mb-sc-result-text" title="点击放大查看组合全文" onClick={() => openText(combined, '上游组合预览')}>
                {combined}
              </div>
            )}
            {showImgPreview && (
              <div className="mb-sc-result-grid">
                {up.images.slice(0, 6).map((p, i) => (
                  <MeasuredThumb key={`pv-${i}`} src={mediaUrl(p)} alt={`预览 ${i + 1}`} onClick={() => openPreview(mediaUrl(p))} />
                ))}
              </div>
            )}
          </div>
        )}
        {total === 0 ? (
          hasPreview ? null : (
            <div className="mb-sc-empty">
              把 生成 / ComfyUI 的图、或 LLM 的文本连到这里，运行后结果会累积显示（重启清空）。也可把 分组/提示词/图片 连进来预览组合。
            </div>
          )
        ) : (
          <div
            className="mb-sc-result mb-sc-arearel"
            onContextMenu={(e) =>
              areaMenu(e, [
                ...(images.length
                  ? [
                      { label: '复制首图', onClick: () => void copyImage(mediaUrl(images[0])) },
                      { label: '首图另存…', onClick: () => void imageSaveAs(images[0], 'smart-canvas-result.png') }
                    ]
                  : []),
                ...(texts.length ? [{ label: '复制全部文本', onClick: () => copyText(texts.join('\n\n')) }] : []),
                { separator: true },
                { label: '清空累积结果', variant: 'danger' as const, onClick: () => clearAccum(id) }
              ])
            }
          >
            {last?.simulated && <div className="mb-sc-sim">含模拟结果 · {providerLabel(last.provider)}</div>}
            <div className="mb-sc-result-meta">
              {metaParts.join(' / ')} · {results.length} 次生成
              {last?.durationMs != null ? ` · ${fmtDur(last.durationMs)}` : ''} · 可拖出每项成节点
            </div>
            {last?.error && <div className="mb-sc-result-err">{last.error}</div>}

            {images.length > 0 && (
              <div className="mb-sc-result-grid nodrag">
                {images.map((p, i) => (
                  <MeasuredThumb
                    key={`img-${i}`}
                    src={mediaUrl(p)}
                    alt={`结果图 ${i + 1}`}
                    title="点击放大 · 拖出成图片节点 · 角标=实际分辨率"
                    draggable
                    onDragStart={(e) => dragImage(e, p)}
                    onClick={() => openPreview(mediaUrl(p))}
                  />
                ))}
              </div>
            )}

            {texts.length > 0 && (
              <div className="mb-sc-result-texts nodrag">
                {texts.map((t, i) => (
                  <div
                    key={`txt-${i}`}
                    className="mb-sc-result-text"
                    title="点击放大查看全文 · 拖出成提示词节点 · 右键复制"
                    draggable
                    onDragStart={(e) => dragText(e, t)}
                    onClick={() => openText(t, '结果文本')}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      copyText(t);
                    }}
                  >
                    {t}
                  </div>
                ))}
              </div>
            )}

            {videos.length > 0 && (
              <div className="mb-sc-result-videos nodrag">
                {videos.map((v, i) => (
                  <video key={`vid-${i}`} className="mb-sc-result-video" src={mediaUrl(v)} controls />
                ))}
              </div>
            )}
          </div>
        )}
      </NodeShell>
    </>
  );
}
