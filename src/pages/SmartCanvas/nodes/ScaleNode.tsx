import { useEffect, useMemo, useRef } from 'react';
import { NodeResizer, type NodeProps } from '@xyflow/react';
import { useSmartCanvasStore, useSmartPreviewStore } from '@/store/smartCanvasStore';
import { computeUpstream } from '@/lib/smartCanvasRunner';
import { loadImage, computeScaleTarget, resizeToDataUri } from '@/lib/imageScale';
import { SCALE_MODE_LABELS, type ScaleNodeData, type SmartNodeData } from '@shared/smartCanvas';
import { NodeShell } from './NodeShell';
import { MeasuredThumb } from '../MeasuredThumb';

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
        ) : (
          <div className="mb-sc-empty">连一个图片来源进来 → 自动按设定缩放输出（选中后在检查器选模式/尺寸）。</div>
        )}
      </NodeShell>
    </>
  );
}
