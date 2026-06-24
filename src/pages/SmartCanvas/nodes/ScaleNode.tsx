import { useEffect, useMemo, useRef } from 'react';
import { NodeResizer, type NodeProps } from '@xyflow/react';
import { useSmartCanvasStore, useSmartPreviewStore } from '@/store/smartCanvasStore';
import { computeUpstream, runScaleVideo } from '@/lib/smartCanvasRunner';
import { loadImage, computeScaleTarget, resizeToDataUri } from '@/lib/imageScale';
import { localPathToImageUrl } from '@/lib/imageUrl';
import { SCALE_MODE_LABELS, type ScaleNodeData, type SmartNodeData } from '@shared/smartCanvas';
import { NodeShell } from './NodeShell';
import { MeasuredThumb } from '../MeasuredThumb';
import { areaMenu, imageSaveAs, showInFolder, openVideoPreview, hoverPreviewProps } from '../nodeArea';

function vidUrl(src?: string): string | null {
  if (!src) return null;
  return src.startsWith('data:') || src.startsWith('http') ? src : localPathToImageUrl(src);
}

/** 模式参数的一句话摘要（节点上展示）。 */
function summary(d: ScaleNodeData): string {
  switch (d.mode) {
    case 'factor':
      return `×${d.factor}`;
    case 'longest':
      return `最长边 ${d.edge}px`;
    case 'shortest':
      return `最短边 ${d.edge}px`;
    case 'width':
      return `宽 ${d.edge}px`;
    case 'height':
      return `高 ${d.edge}px`;
    case 'fit':
      return `限制 ${d.fitW}×${d.fitH}`;
    case 'pixels':
      return `${d.megapixels}MP`;
    case 'exact':
      return `${d.fitW}×${d.fitH}${d.keepAspect ? '(等比)' : ''}`;
  }
}

/**
 * 缩放/预处理节点：对上游图片做几何缩小/放大（非高清化），输出新图喂下游。参数在弹出检查器里调。
 * 实时计算（canvas）：解决「输入图过大模型不收」与「图太小达不到效果」。
 */
export function ScaleNode({ id, data }: NodeProps): JSX.Element {
  const remove = useSmartCanvasStore((s) => s.removeNode);
  const update = useSmartCanvasStore((s) => s.updateNodeData);
  const nodes = useSmartCanvasStore((s) => s.nodes);
  const edges = useSmartCanvasStore((s) => s.edges);
  const openPreview = useSmartPreviewStore((s) => s.open);
  const d = data as unknown as ScaleNodeData;

  const up = useMemo(() => computeUpstream(nodes, edges, id), [nodes, edges, id]);
  const src = up.images[0];
  const upVideo = !src ? up.videos[0] : undefined;
  const setF = (p: Partial<ScaleNodeData>): void => update(id, p as Partial<SmartNodeData>);
  const outVid = vidUrl(d.outputVideo ?? undefined);

  const imgRef = useRef<{ src: string; img: HTMLImageElement } | null>(null);

  useEffect(() => {
    if (!src) {
      imgRef.current = null;
      if (d.outputImage || d.outW) {
        update(id, { outputImage: undefined, outW: undefined, outH: undefined, inW: undefined, inH: undefined } as Partial<SmartNodeData>);
      }
      return;
    }
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const run = async (): Promise<void> => {
      let entry = imgRef.current;
      if (!entry || entry.src !== src) {
        const img = await loadImage(src).catch(() => null);
        if (!alive || !img) return;
        entry = { src, img };
        imgRef.current = entry;
      }
      const w0 = entry.img.naturalWidth;
      const h0 = entry.img.naturalHeight;
      const t = computeScaleTarget(
        { mode: d.mode, factor: d.factor, edge: d.edge, fitW: d.fitW, fitH: d.fitH, megapixels: d.megapixels, keepAspect: d.keepAspect, noUpscale: d.noUpscale },
        w0,
        h0
      );
      if (t.w !== d.outW || t.h !== d.outH || w0 !== d.inW || h0 !== d.inH) {
        update(id, { outW: t.w, outH: t.h, inW: w0, inH: h0 } as Partial<SmartNodeData>);
      }
      const img = entry.img;
      timer = setTimeout(() => {
        if (!alive) return;
        const out = resizeToDataUri(img, t.w, t.h, d.format);
        update(id, { outputImage: out } as Partial<SmartNodeData>);
      }, 220);
    };
    void run();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, src, d.mode, d.factor, d.edge, d.fitW, d.fitH, d.megapixels, d.keepAspect, d.noUpscale, d.format]);

  return (
    <>
      <NodeResizer isVisible minWidth={200} minHeight={170} />
      <NodeShell title="缩放" accent="is-scale" inputs outputs fill onDelete={() => remove(id)}>
        <div className="mb-sc-work-line">
          {SCALE_MODE_LABELS[d.mode]} · {summary(d)}
        </div>
        {src ? (
          <>
            <div className="mb-sc-work-model">
              {d.inW && d.outW ? `输入 ${d.inW}×${d.inH} → 输出 ${d.outW}×${d.outH}` : '计算中…'}
            </div>
            {d.outputImage && (
              <div className="mb-sc-work-thumbs nodrag">
                <MeasuredThumb src={d.outputImage} alt="缩放输出" title="缩放输出 · 角标=实际分辨率" onClick={() => openPreview(d.outputImage as string)} />
              </div>
            )}
          </>
        ) : upVideo ? (
          <div className="mb-sc-revctl nodrag">
            <div className="mb-sc-work-model">上游视频 · ffmpeg 缩放 / 补帧（重编码 mp4）</div>
            <div className="mb-sc-revrow">
              宽
              <input className="mb-input" type="number" min={0} placeholder="自适应" value={d.fitW || ''} onFocus={(e) => e.currentTarget.select()} onChange={(e) => setF({ fitW: Number(e.target.value) || 0 })} />
              高
              <input className="mb-input" type="number" min={0} placeholder="自适应" value={d.fitH || ''} onFocus={(e) => e.currentTarget.select()} onChange={(e) => setF({ fitH: Number(e.target.value) || 0 })} />
            </div>
            <div className="mb-sc-revrow">
              帧率
              <select
                className="mb-select"
                value={d.vidFps ?? 0}
                onChange={(e) => setF({ vidFps: Number(e.target.value) || 0 })}
                title="生成模型多为固定 24fps；补帧用运动补偿插帧（minterpolate），更流畅但处理较慢"
              >
                <option value={0}>保持原帧率</option>
                <option value={30}>补帧到 30fps</option>
                <option value={48}>补帧到 48fps（慢）</option>
                <option value={60}>补帧到 60fps（很慢）</option>
              </select>
            </div>
            <button
              className="mb-btn mb-btn-sm mb-btn-primary"
              disabled={d.vidStatus === 'running' || (!d.fitW && !d.fitH && !d.vidFps)}
              onClick={() => void runScaleVideo(id, d.fitW || null, d.fitH || null, d.vidFps || null)}
            >
              {d.vidStatus === 'running' ? '处理中…' : d.vidFps ? (d.fitW || d.fitH ? '缩放 + 补帧' : '补帧') : '缩放视频'}
            </button>
            {d.vidError && <div className="mb-sc-result-err">{d.vidError}</div>}
            {outVid && (
              <video
                className="mb-sc-video-player nodrag"
                src={outVid}
                controls
                loop
                muted
                preload="metadata"
                {...hoverPreviewProps()}
                title="悬停自动预览 · 双击放大播放 · 右键更多"
                onDoubleClick={() => openVideoPreview([d.outputVideo ?? outVid])}
                onContextMenu={(e) =>
                  areaMenu(e, [
                    { label: '放大播放', onClick: () => openVideoPreview([d.outputVideo ?? outVid]) },
                    { label: '另存视频…', onClick: () => void imageSaveAs(d.outputVideo ?? '', 'scaled.mp4') },
                    { label: '打开文件所在目录', onClick: () => void showInFolder(d.outputVideo ?? '') }
                  ])
                }
              />
            )}
          </div>
        ) : (
          <div className="mb-sc-empty">连图片来源 → 自动缩放（检查器选模式/尺寸）；连视频来源 → 填宽/高或选补帧帧率后点运行。</div>
        )}
      </NodeShell>
    </>
  );
}
