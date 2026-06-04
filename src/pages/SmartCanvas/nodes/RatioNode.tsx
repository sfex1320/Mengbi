import { useEffect, useMemo, useState } from 'react';
import { NodeResizer, type NodeProps } from '@xyflow/react';
import { useSmartCanvasStore } from '@/store/smartCanvasStore';
import { computeUpstream } from '@/lib/smartCanvasRunner';
import { loadImage, nearestAspect, exactRatio } from '@/lib/imageScale';
import type { RatioNodeData } from '@shared/smartCanvas';
import { NodeShell } from './NodeShell';

interface Analysis {
  w: number;
  h: number;
  exact: string;
  nearest: string;
  tiers: Array<{ name: string; w: number; h: number }>;
  gptW: number;
  gptH: number;
}

/** 各分辨率档（按最长边等比）+ GPT Image 2 像素预算（~8.3MP，对齐 16）。 */
function analyze(w: number, h: number): Analysis {
  const longest = Math.max(w, h);
  const tiers = [
    ['1K', 1024],
    ['2K', 2048],
    ['4K', 4096]
  ].map(([name, L]) => {
    const s = (L as number) / longest;
    return { name: name as string, w: Math.round(w * s), h: Math.round(h * s) };
  });
  const s = Math.sqrt(8_300_000 / Math.max(1, w * h));
  return {
    w,
    h,
    exact: exactRatio(w, h),
    nearest: nearestAspect(w, h).label,
    tiers,
    gptW: Math.round((w * s) / 16) * 16,
    gptH: Math.round((h * s) / 16) * 16
  };
}

/**
 * 比例/分辨率分析节点：接入一张图 → 显示最接近的常用比例 + 各档（1K/2K/4K）实际分辨率 +
 * GPT Image 2 像素预算下的实际尺寸。纯参考（不输出），帮你决定生图用什么比例/分辨率。
 */
export function RatioNode({ id, data }: NodeProps): JSX.Element {
  const remove = useSmartCanvasStore((s) => s.removeNode);
  const nodes = useSmartCanvasStore((s) => s.nodes);
  const edges = useSmartCanvasStore((s) => s.edges);
  const d = data as unknown as RatioNodeData;

  const up = useMemo(() => computeUpstream(nodes, edges, id), [nodes, edges, id]);
  const src = up.images[0];
  const [info, setInfo] = useState<Analysis | null>(null);

  useEffect(() => {
    if (!src) {
      setInfo(null);
      return;
    }
    let alive = true;
    void loadImage(src)
      .then((img) => {
        if (alive) setInfo(analyze(img.naturalWidth, img.naturalHeight));
      })
      .catch(() => {
        if (alive) setInfo(null);
      });
    return () => {
      alive = false;
    };
  }, [src]);

  return (
    <>
      <NodeResizer isVisible minWidth={220} minHeight={180} />
      <NodeShell title="尺寸分析" accent="is-ratio" inputs fill onDelete={() => remove(id)} label={d.label} labelColor={d.labelColor}>
        {!src ? (
          <div className="mb-sc-empty">连一个图片来源进来 → 显示最接近的常用比例 + 各档实际分辨率。</div>
        ) : !info ? (
          <div className="mb-sc-empty">分析中…</div>
        ) : (
          <div className="mb-sc-ratio">
            <div className="mb-sc-ratio-row">
              原始 <b>{info.w}×{info.h}</b>（{info.exact}）
            </div>
            <div className="mb-sc-ratio-row">
              最接近常用比例：<b className="mb-sc-ratio-hit">{info.nearest}</b>
            </div>
            <div className="mb-sc-ratio-tiers">
              {info.tiers.map((t) => (
                <div key={t.name} className="mb-sc-ratio-tier">
                  <span>{t.name}</span>
                  <span>{t.w}×{t.h}</span>
                </div>
              ))}
              <div className="mb-sc-ratio-tier">
                <span>GPT Image 2</span>
                <span>{info.gptW}×{info.gptH}</span>
              </div>
            </div>
            <div className="mb-sc-note">各档=按最长边等比；GPT 档=按 ~8.3MP 像素预算。仅参考。</div>
          </div>
        )}
      </NodeShell>
    </>
  );
}
