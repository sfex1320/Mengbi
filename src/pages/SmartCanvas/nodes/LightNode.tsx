import { useEffect, useMemo, useRef, useState } from 'react';
import { NodeResizer, type NodeProps } from '@xyflow/react';
import { useSmartCanvasStore } from '@/store/smartCanvasStore';
import { computeUpstream } from '@/lib/smartCanvasRunner';
import { buildLightPrompt } from '@/lib/lightPrompt';
import { localPathToImageUrl } from '@/lib/imageUrl';
import type { LightNodeData, SmartNodeData } from '@shared/smartCanvas';
import { NodeShell } from './NodeShell';
import { CopyButton, ToPromptButton, copyText, areaMenu, makePromptNodeFrom, useFitNodeToContent } from '../nodeArea';

function imgUrl(src?: string): string | null {
  if (!src) return null;
  return src.startsWith('data:') ? src : localPathToImageUrl(src);
}
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
/** 色温 → 光晕 RGB（暖→金、冷→蓝）。 */
function glowRGB(warmth: number): string {
  const t = clamp(warmth, -100, 100) / 100;
  if (t >= 0) return `255, ${Math.round(238 - t * 60)}, ${Math.round(210 - t * 120)}`;
  return `${Math.round(220 + t * 60)}, ${Math.round(232 + t * 28)}, 255`;
}
/** 方位角 → 正面 / 侧面 / 背面（逆光）。 */
function frontBackWord(az: number): string {
  const a0 = ((az % 360) + 360) % 360;
  const a = a0 > 180 ? 360 - a0 : a0;
  if (a <= 60) return '正面光';
  if (a >= 120) return '背面光（逆光）';
  return '侧面光';
}

/**
 * 光源节点（卡片=基础调整）：接入一张图 → 在图上拖光点摆位 + 强度 / 色温 → 实时光照提示词喂下游。
 * 高级调整（光位预设 / 光源类型 / 遮挡 / 光效 / 一致性）在 NodeLightConsole 弹窗里（选中节点弹出）。
 */
export function LightNode({ id, data }: NodeProps): JSX.Element {
  const remove = useSmartCanvasStore((s) => s.removeNode);
  const updateNodeData = useSmartCanvasStore((s) => s.updateNodeData);
  const nodes = useSmartCanvasStore((s) => s.nodes);
  const edges = useSmartCanvasStore((s) => s.edges);
  const fileRef = useRef<HTMLInputElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const d = data as unknown as LightNodeData;

  const up = useMemo(() => computeUpstream(nodes, edges, id), [nodes, edges, id]);
  const src = up.images[0] || d.inputImage?.url;
  const url = imgUrl(src);

  const [imgAspect, setImgAspect] = useState<number | null>(null);
  useEffect(() => {
    if (!url) {
      setImgAspect(null);
      return;
    }
    let alive = true;
    const im = new Image();
    im.onload = () => {
      if (alive && im.naturalWidth > 0 && im.naturalHeight > 0) setImgAspect(im.naturalWidth / im.naturalHeight);
    };
    im.src = url;
    return () => {
      alive = false;
    };
  }, [url]);

  useFitNodeToContent(id, fitRef, 46);

  function patch(p: Partial<LightNodeData>): void {
    const next = { ...d, ...p };
    next.generatedPrompt = buildLightPrompt(next);
    updateNodeData(id, next as Partial<SmartNodeData>);
  }
  function loadFile(file: File | null | undefined): void {
    if (!file || !file.type.startsWith('image/')) return;
    const r = new FileReader();
    r.onload = () => patch({ inputImage: { url: String(r.result), name: file.name } });
    r.readAsDataURL(file);
  }

  // 在图上拖光点：光点跟随落点（posX/posY，0~1），并推导 azimuth/elevation 喂提示词。
  function setFromPointer(e: React.PointerEvent): void {
    const el = stageRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = clamp((e.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
    const cy = clamp((e.clientY - rect.top) / Math.max(1, rect.height), 0, 1);
    const nx = (cx - 0.5) * 2;
    const ny = (cy - 0.5) * 2;
    const r = Math.min(1, Math.hypot(nx, ny));
    const elevation = Math.round(clamp(90 - r * 90, 0, 90));
    const azimuth = Math.round((Math.atan2(nx, -ny) * 180) / Math.PI);
    if (cx !== d.posX || cy !== d.posY) patch({ posX: cx, posY: cy, azimuth, elevation });
  }
  function onDown(e: React.PointerEvent): void {
    e.stopPropagation();
    draggingRef.current = true;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    setFromPointer(e);
  }
  function onMove(e: React.PointerEvent): void {
    if (draggingRef.current) setFromPointer(e);
  }
  function onUp(e: React.PointerEvent): void {
    draggingRef.current = false;
    (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
  }

  const pos =
    typeof d.posX === 'number' && typeof d.posY === 'number'
      ? { x: d.posX, y: d.posY }
      : (() => {
          const rr = 1 - clamp(d.elevation, 0, 90) / 90;
          const azR = (d.azimuth * Math.PI) / 180;
          return { x: clamp(0.5 + Math.sin(azR) * rr * 0.5, 0, 1), y: clamp(0.5 - Math.cos(azR) * rr * 0.5, 0, 1) };
        })();
  const sunX = pos.x * 100;
  const sunY = pos.y * 100;
  const rgb = glowRGB(d.warmth);
  const glowOp = 0.28 + (clamp(d.intensity, 0, 100) / 100) * 0.55;
  const glowStyle = { background: `radial-gradient(circle at ${sunX}% ${sunY}%, rgba(${rgb}, ${glowOp}) 0%, rgba(${rgb}, 0) 56%)` };
  const stageStyle = { aspectRatio: imgAspect ?? 4 / 3 };
  const warmHint = d.warmth >= 50 ? '暖' : d.warmth <= -50 ? '冷' : '中';

  return (
    <>
      <NodeResizer isVisible minWidth={232} minHeight={300} />
      <NodeShell title="光源" accent="is-light" inputs outputs fill onDelete={() => remove(id)} label={d.label} labelColor={d.labelColor}>
        <div ref={fitRef} className="mb-sc-fit">
          <div
            ref={stageRef}
            className="mb-sc-light-stage nodrag"
            style={stageStyle}
            title="在图片上拖动光点摆放光源位置（中心=顶光，越靠边缘越接近地平线）"
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
          >
            <div className="mb-sc-light-img" style={url ? { backgroundImage: `url(${url})` } : undefined}>
              {!url && <span className="mb-sc-light-ph">接入图片或上传</span>}
            </div>
            <div className="mb-sc-light-glow" style={glowStyle} />
            <div className="mb-sc-light-sun" style={{ left: `${sunX}%`, top: `${sunY}%` }} />
          </div>

          {up.images[0] ? (
            <div className="mb-sc-fromup is-fed nodrag">图片由上游输入（实时），本节点上传已禁用</div>
          ) : (
            <div className="mb-sc-angle-uploadrow">
              <button className="mb-btn mb-btn-sm mb-btn-ghost nodrag" onClick={() => fileRef.current?.click()}>
                {url ? '换图' : '上传图片'}
              </button>
            </div>
          )}

          <div className="mb-sc-light-ctl nodrag">
            <div className="mb-sc-light-ctl-head">
              <span>{frontBackWord(d.azimuth)} · 方位 {d.azimuth}°</span>
              <span>高度 {d.elevation}°</span>
            </div>
          </div>
          <LightSlider label={`强度 ${d.intensity}`} min={0} max={100} step={1} value={d.intensity} onChange={(v) => patch({ intensity: v })} />
          <LightSlider label={`色温 ${warmHint}（${d.warmth}）`} min={-100} max={100} step={1} value={d.warmth} onChange={(v) => patch({ warmth: v })} />

          <div className="mb-sc-light-advhint nodrag">光位 / 光源类型 / 遮挡 / 光效 等高级设置 → 选中本节点在弹窗里调</div>

          <div className="mb-sc-arearel">
            <CopyButton onClick={() => copyText(d.generatedPrompt)} title="复制提示词" />
            <div
              className="mb-sc-angle-prompt nodrag"
              title="右键：复制 / 用输出建提示词节点"
              onContextMenu={(e) =>
                areaMenu(e, [
                  { label: '复制提示词', onClick: () => copyText(d.generatedPrompt) },
                  { label: '用输出建提示词节点', onClick: () => makePromptNodeFrom(id, d.generatedPrompt) }
                ])
              }
            >
              {d.generatedPrompt}
            </div>
            <ToPromptButton onClick={() => makePromptNodeFrom(id, d.generatedPrompt)} title="把这段光照提示词导入一个下游提示词节点" />
          </div>

          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={(e) => {
              loadFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>
      </NodeShell>
    </>
  );
}

function LightSlider({
  label,
  min,
  max,
  step,
  value,
  onChange
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
}): JSX.Element {
  return (
    <div className="mb-sc-angle-ctl nodrag">
      <div className="mb-sc-angle-ctl-head">
        <span className="mb-sc-angle-ctl-label">{label}</span>
      </div>
      <input className="mb-sc-range" type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}
