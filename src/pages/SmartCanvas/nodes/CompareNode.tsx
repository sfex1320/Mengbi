import { useMemo, useRef } from 'react';
import { NodeResizer, type NodeProps } from '@xyflow/react';
import { useSmartCanvasStore, useSmartPreviewStore } from '@/store/smartCanvasStore';
import { computeUpstream } from '@/lib/smartCanvasRunner';
import { localPathToImageUrl } from '@/lib/imageUrl';
import type { CompareNodeData, SmartNodeData } from '@shared/smartCanvas';
import { NodeShell } from './NodeShell';

function imgUrl(src?: string): string | null {
  if (!src) return null;
  return src.startsWith('data:') ? src : localPathToImageUrl(src);
}

/**
 * 对比节点：左右两图 + 可拖动 wipe 分隔线，查看两图差异。
 * 两图优先取上游图片（A=上游第 1 张 / B=第 2 张）——把「参考图」与「生成结果」连进来即可对比；
 * 也可往左/右半区拖入图片手动指定（srcA/srcB 覆盖上游）。纯查看，不生成、不输出。
 */
export function CompareNode({ id, data }: NodeProps): JSX.Element {
  const nodes = useSmartCanvasStore((s) => s.nodes);
  const edges = useSmartCanvasStore((s) => s.edges);
  const update = useSmartCanvasStore((s) => s.updateNodeData);
  const remove = useSmartCanvasStore((s) => s.removeNode);
  const openPreview = useSmartPreviewStore((s) => s.open);
  const d = data as unknown as CompareNodeData;
  const stageRef = useRef<HTMLDivElement>(null);

  const up = useMemo(() => computeUpstream(nodes, edges, id), [nodes, edges, id]);
  const a = d.srcA ?? up.images[0];
  const b = d.srcB ?? up.images[1];
  const ua = imgUrl(a);
  const ub = imgUrl(b);
  const slider = d.slider ?? 50;

  function setSlider(clientX: number): void {
    const el = stageRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const pct = Math.max(0, Math.min(100, ((clientX - r.left) / r.width) * 100));
    update(id, { slider: Math.round(pct) } as Partial<SmartNodeData>);
  }

  function loadToSlot(file: File | undefined, slot: 'A' | 'B'): void {
    if (!file || !file.type.startsWith('image/')) return;
    const fr = new FileReader();
    fr.onload = () =>
      update(id, (slot === 'A' ? { srcA: String(fr.result) } : { srcB: String(fr.result) }) as Partial<SmartNodeData>);
    fr.readAsDataURL(file);
  }

  return (
    <>
      <NodeResizer isVisible minWidth={220} minHeight={200} />
      <NodeShell title="对比" accent="is-compare" inputs fill onDelete={() => remove(id)}>
        {ua && ub ? (
          <div
            ref={stageRef}
            className="mb-sc-cmp nodrag"
            onPointerDown={(e) => {
              (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
              setSlider(e.clientX);
            }}
            onPointerMove={(e) => {
              if (e.buttons) setSlider(e.clientX);
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const r = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
              loadToSlot(e.dataTransfer.files?.[0], e.clientX - r.left < r.width / 2 ? 'A' : 'B');
            }}
            onDoubleClick={() => ub && openPreview(ub)}
            title="拖分隔线对比两图 · 双击放大 B · 往左/右半区拖图替换 A/B"
          >
            <img className="mb-sc-cmp-img" src={ub} alt="B" draggable={false} />
            <img
              className="mb-sc-cmp-img mb-sc-cmp-a"
              src={ua}
              alt="A"
              draggable={false}
              style={{ clipPath: `inset(0 ${100 - slider}% 0 0)` }}
            />
            <div className="mb-sc-cmp-divider" style={{ left: `${slider}%` }}>
              <span className="mb-sc-cmp-knob">⇆</span>
            </div>
            <span className="mb-sc-cmp-tag is-a">A</span>
            <span className="mb-sc-cmp-tag is-b">B</span>
          </div>
        ) : (
          <div
            className="mb-sc-cmp-empty nodrag"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              loadToSlot(e.dataTransfer.files?.[0], a ? 'B' : 'A');
            }}
          >
            连两张图进来（A = 上游第 1 张 / B = 第 2 张），或把图片拖到这里。
            <div className="mb-sc-cmp-have">{a ? '已有 A，还缺 B' : '缺 A / B'}</div>
          </div>
        )}
        {(d.srcA || d.srcB) && (
          <button
            className="mb-btn mb-btn-sm mb-btn-ghost nodrag"
            onClick={() => update(id, { srcA: undefined, srcB: undefined } as Partial<SmartNodeData>)}
            title="清除手动指定，恢复用上游图片"
          >
            恢复用上游图
          </button>
        )}
      </NodeShell>
    </>
  );
}
