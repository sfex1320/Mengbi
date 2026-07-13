import { useEffect, useMemo, useRef, useState } from 'react';
import { NodeResizer, type NodeProps } from '@xyflow/react';
import { useSmartCanvasStore } from '@/store/smartCanvasStore';
import { computeUpstream } from '@/lib/smartCanvasRunner';
import { loadImage, nearestAspect, exactRatio } from '@/lib/imageScale';
import { RATIO_ASPECTS, SIZE_TIERS, ratioOutputSize, nearestTier } from '@/lib/sizeSpec';
import type { RatioNodeData, RatioSizeMode, RatioEmit, SmartNodeData } from '@shared/smartCanvas';
import { NodeShell } from './NodeShell';
import { SegmentedControl, ClampNumberInput } from '../nodePanel/consoleControls';
import { AspectGlyph } from '../nodeControls';
import { useFitNodeToContent } from '../nodeArea';

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
 * 尺寸来源节点：可选接一张图 → 分析其比例/各档分辨率；同时选「预设（比例 + 分辨率档）/ 自定义宽高」
 * + 输出意图（只比例 / 只分辨率 / 两者）→ 输出 SizeSpec 喂给 生图 / ComfyUI / 视频（也可连「结果」节点查看）。
 */
export function RatioNode({ id, data }: NodeProps): JSX.Element {
  const remove = useSmartCanvasStore((s) => s.removeNode);
  const update = useSmartCanvasStore((s) => s.updateNodeData);
  const nodes = useSmartCanvasStore((s) => s.nodes);
  const edges = useSmartCanvasStore((s) => s.edges);
  const d = data as unknown as RatioNodeData;
  const setF = (p: Partial<RatioNodeData>): void => update(id, p as Partial<SmartNodeData>);

  // 旧画布的 ratio.data 可能缺字段，全程兜底
  const sizeMode: RatioSizeMode = d.sizeMode ?? 'preset';
  const aspect = d.aspect ?? '1:1';
  const tier = d.tier ?? '2K';
  const customW = d.customW ?? 1024;
  const customH = d.customH ?? 1024;
  const emit: RatioEmit = d.emit ?? 'both';

  const up = useMemo(() => computeUpstream(nodes, edges, id), [nodes, edges, id]);
  const src = up.images[0];
  const [info, setInfo] = useState<Analysis | null>(null);

  useEffect(() => {
    if (!src) {
      setInfo(null);
      // 图断开 → 清掉原尺寸缓存，避免 original 模式继续吐旧尺寸
      if (d.origW != null || d.origH != null) setF({ origW: undefined, origH: undefined });
      return;
    }
    let alive = true;
    void loadImage(src)
      .then((img) => {
        if (!alive) return;
        const a = analyze(img.naturalWidth, img.naturalHeight);
        setInfo(a);
        // 回写原尺寸供 original 模式（computeUpstream 纯函数读 data.origW/H 喂下游）；仅在变化时写，避免循环
        if (d.origW !== a.w || d.origH !== a.h) setF({ origW: a.w, origH: a.h });
      })
      .catch(() => {
        if (alive) setInfo(null);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  // 节点高度贴合真实内容（fitwrap 实测，双向：接图展开分析变高、断图收矮；手动 > 自适应）
  const fitRef = useRef<HTMLDivElement>(null);
  useFitNodeToContent(id, fitRef, 52, 640);

  const spec = ratioOutputSize({ ...d, sizeMode, aspect, tier, customW, customH, emit });
  // original 模式优先用实时分析值显示（避免首帧 origW 尚未回写时闪「尺寸无效」）
  const echoSpec = sizeMode === 'original' && info ? { aspect: info.exact, width: info.w, height: info.h } : spec;
  const echo = !echoSpec
    ? null
    : emit === 'aspect'
      ? `比例 ${echoSpec.aspect}`
      : emit === 'resolution'
        ? `${echoSpec.width}×${echoSpec.height}`
        : `${echoSpec.aspect} · ${echoSpec.width}×${echoSpec.height}`;

  return (
    <>
      <NodeResizer isVisible minWidth={240} minHeight={260} />
      <NodeShell title="尺寸来源" accent="is-ratio" inputs outputs fill onDelete={() => remove(id)}>
        <div className="mb-sc-fitwrap nowheel" ref={fitRef}>
        {/* 上：可选接图分析（原始尺寸 + 最接近常用比例 + 各模型系列的相近尺寸，点任一行即采用） */}
        {src && info && (
          <div className="mb-sc-ratio">
            <div className="mb-sc-ratio-row">
              原始 <b>{info.w}×{info.h}</b>（{info.exact}）· 最接近 <b className="mb-sc-ratio-hit">{info.nearest}</b>
            </div>
            <button className="mb-btn mb-btn-sm mb-btn-ghost nodrag" onClick={() => setF({ sizeMode: 'custom', customW: info.w, customH: info.h })}>
              采用此尺寸（{info.w}×{info.h}）
            </button>
            <div className="mb-sc-ratio-fam nodrag">
              {info.tiers.map((t) => (
                <button
                  key={t.name}
                  className="mb-sc-ratio-famrow"
                  title={`通用 ${t.name} 档（最长边 ${t.name === '1K' ? 1024 : t.name === '2K' ? 2048 : 4096}px 等比）· 点击采用为自定义宽高`}
                  onClick={() => setF({ sizeMode: 'custom', customW: t.w, customH: t.h })}
                >
                  <span className="mb-sc-ratio-famname">{t.name} 档</span>
                  <b>
                    {t.w}×{t.h}
                  </b>
                </button>
              ))}
              <button
                className="mb-sc-ratio-famrow"
                title="GPT Image 2 走 size=宽×高（约 8.3MP 像素预算，16 对齐）· 点击采用为自定义宽高"
                onClick={() => setF({ sizeMode: 'custom', customW: info.gptW, customH: info.gptH })}
              >
                <span className="mb-sc-ratio-famname">GPT Image 2</span>
                <b>
                  {info.gptW}×{info.gptH}
                </b>
                <span className="mb-sc-ratio-famnote">8.3MP 预算</span>
              </button>
              <button
                className="mb-sc-ratio-famrow"
                title="Nano Banana 系只认 分辨率档 + 比例 · 点击采用为预设（最近档 + 最近常用比例）"
                onClick={() => setF({ sizeMode: 'preset', aspect: info.nearest, tier: nearestTier(info.w * info.h) })}
              >
                <span className="mb-sc-ratio-famname">Nano Banana</span>
                <b>
                  {nearestTier(info.w * info.h)} 档 · {info.nearest}
                </b>
              </button>
            </div>
          </div>
        )}
        {src && !info && <div className="mb-sc-empty">分析中…</div>}

        {/* 下：尺寸来源（输出给下游） */}
        <div className="mb-sc-ratio-src nodrag">
          <SegmentedControl<RatioSizeMode>
            size="sm"
            value={sizeMode}
            options={[
              { value: 'preset', label: '预设' },
              { value: 'custom', label: '自定义' },
              { value: 'original', label: '原尺寸' }
            ]}
            onChange={(v) => setF({ sizeMode: v })}
          />
          {sizeMode === 'preset' ? (
            <>
              <div className="mb-sc-ratio-lbl">比例</div>
              <SegmentedControl
                size="sm"
                value={aspect}
                options={RATIO_ASPECTS.map((a) => ({ value: a, label: a, icon: <AspectGlyph ratio={a} size={14} /> }))}
                onChange={(v) => setF({ aspect: v })}
              />
              <div className="mb-sc-ratio-lbl">分辨率</div>
              <SegmentedControl
                size="sm"
                value={tier}
                options={SIZE_TIERS.map((t) => ({ value: t, label: t }))}
                onChange={(v) => setF({ tier: v })}
              />
            </>
          ) : sizeMode === 'custom' ? (
            <div className="mb-sc-revrow">
              宽
              <ClampNumberInput value={customW} min={256} max={8192} onCommit={(v) => setF({ customW: v })} />
              高
              <ClampNumberInput value={customH} min={256} max={8192} onCommit={(v) => setF({ customH: v })} />
            </div>
          ) : (
            <div className="mb-sc-ratio-lbl">
              {src && info ? (
                <>原尺寸 <b>{info.w}×{info.h}</b>（{info.exact}）</>
              ) : (
                <span className="mb-sc-result-err">连接一张图以使用其原尺寸</span>
              )}
            </div>
          )}
          <div className="mb-sc-ratio-lbl">输出</div>
          <SegmentedControl<RatioEmit>
            size="sm"
            value={emit}
            options={[
              { value: 'both', label: '比例+分辨率' },
              { value: 'aspect', label: '只比例' },
              { value: 'resolution', label: '只分辨率' }
            ]}
            onChange={(v) => setF({ emit: v })}
          />
          <div className="mb-sc-ratio-out">{echo ? <>输出：<b>{echo}</b></> : <span className="mb-sc-result-err">尺寸无效</span>}</div>
        </div>
        </div>
      </NodeShell>
    </>
  );
}
