import { useMemo, useRef } from 'react';
import { NodeResizer, type NodeProps } from '@xyflow/react';
import { useSmartCanvasStore } from '@/store/smartCanvasStore';
import { computeUpstream } from '@/lib/smartCanvasRunner';
import { buildLightPrompt } from '@/lib/lightPrompt';
import { localPathToImageUrl } from '@/lib/imageUrl';
import {
  LIGHT_OCCLUSION_LABELS,
  LIGHT_EFFECT_LABELS,
  type LightNodeData,
  type LightOcclusion,
  type LightEffect,
  type SmartNodeData
} from '@shared/smartCanvas';
import { NodeShell } from './NodeShell';
import { CopyButton, copyText, areaMenu, makePromptNodeFrom } from '../nodeArea';

const OCCLUSIONS = Object.keys(LIGHT_OCCLUSION_LABELS) as LightOcclusion[];
const EFFECTS = Object.keys(LIGHT_EFFECT_LABELS) as LightEffect[];

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

/**
 * 光源节点：接入一张图 → 圆顶预览（拖光点调光照方位/高度）+ 强度/色温/遮挡/光效 →
 * 实时生成光照提示词，文本输出喂下游（与视角节点同类，不直接生成图片）。
 */
export function LightNode({ id, data }: NodeProps): JSX.Element {
  const remove = useSmartCanvasStore((s) => s.removeNode);
  const updateNodeData = useSmartCanvasStore((s) => s.updateNodeData);
  const nodes = useSmartCanvasStore((s) => s.nodes);
  const edges = useSmartCanvasStore((s) => s.edges);
  const fileRef = useRef<HTMLInputElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const d = data as unknown as LightNodeData;

  const up = useMemo(() => computeUpstream(nodes, edges, id), [nodes, edges, id]);
  const src = up.images[0] || d.inputImage?.url;
  const url = imgUrl(src);

  function patch(p: Partial<LightNodeData>): void {
    const next = { ...d, ...p };
    next.generatedPrompt = buildLightPrompt(next);
    updateNodeData(id, next as Partial<SmartNodeData>);
  }
  function resetAll(): void {
    patch({ azimuth: 35, elevation: 55, intensity: 60, warmth: 30, occlusion: 'none', effect: 'none' });
  }
  function loadFile(file: File | null | undefined): void {
    if (!file || !file.type.startsWith('image/')) return;
    const r = new FileReader();
    r.onload = () => patch({ inputImage: { url: String(r.result), name: file.name } });
    r.readAsDataURL(file);
  }

  // 拖光点：以圆心为原点，半径=高度（中心=头顶 90°，边缘=地平线 0°），角度=方位
  function setFromPointer(e: React.PointerEvent): void {
    const el = stageRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const dx = e.clientX - (rect.left + rect.width / 2);
    const dy = e.clientY - (rect.top + rect.height / 2);
    const maxR = (Math.min(rect.width, rect.height) / 2) * 0.84;
    const r = Math.min(1, Math.hypot(dx, dy) / Math.max(1, maxR));
    const elevation = Math.round(clamp(90 - r * 90, 0, 90));
    const azimuth = Math.round((Math.atan2(dx, dy) * 180) / Math.PI);
    if (azimuth !== d.azimuth || elevation !== d.elevation) patch({ azimuth, elevation });
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

  // 光点在预览里的位置（%）：方位绕圆、高度=离心距
  const rFrac = (1 - clamp(d.elevation, 0, 90) / 90) * 0.42;
  const azR = (d.azimuth * Math.PI) / 180;
  const sunX = 50 + Math.sin(azR) * rFrac * 100;
  const sunY = 50 + Math.cos(azR) * rFrac * 100;
  const rgb = glowRGB(d.warmth);
  const glowOp = 0.28 + (clamp(d.intensity, 0, 100) / 100) * 0.55;
  const glowStyle = {
    background: `radial-gradient(circle at ${sunX}% ${sunY}%, rgba(${rgb}, ${glowOp}) 0%, rgba(${rgb}, 0) 56%)`
  };

  const warmHint = d.warmth >= 50 ? '暖' : d.warmth <= -50 ? '冷' : '中';

  return (
    <>
      <NodeResizer isVisible minWidth={260} minHeight={400} />
      <NodeShell title="光源" accent="is-light" inputs outputs fill onDelete={() => remove(id)} label={d.label} labelColor={d.labelColor}>
        <div
          ref={stageRef}
          className="mb-sc-light-stage nodrag"
          title="在预览上拖动光点调光照方向（中心=顶光，边缘=接近地平线）"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        >
          <div className="mb-sc-light-img" style={url ? { backgroundImage: `url(${url})` } : undefined}>
            {!url && <span className="mb-sc-light-ph">接入图片或上传</span>}
          </div>
          <div className="mb-sc-light-glow" style={glowStyle} />
          <div className="mb-sc-light-ring" />
          <div className="mb-sc-light-sun" style={{ left: `${sunX}%`, top: `${sunY}%` }} />
        </div>

        <div className="mb-sc-angle-uploadrow">
          <button className="mb-btn mb-btn-sm mb-btn-ghost nodrag" onClick={() => fileRef.current?.click()}>
            {url ? '换图' : '上传图片'}
          </button>
          {up.images[0] && <span className="mb-sc-angle-srcnote">上游图片（实时）</span>}
        </div>

        <div className="mb-sc-light-ctl nodrag">
          <div className="mb-sc-light-ctl-head">
            <span>方位 {d.azimuth}°</span>
            <span>高度 {d.elevation}°</span>
          </div>
        </div>
        <LightSlider label={`强度 ${d.intensity}`} min={0} max={100} step={1} value={d.intensity} onChange={(v) => patch({ intensity: v })} />
        <LightSlider label={`色温 ${warmHint}（${d.warmth}）`} min={-100} max={100} step={1} value={d.warmth} onChange={(v) => patch({ warmth: v })} />

        <div className="mb-sc-light-selrow nodrag">
          <label className="mb-sc-flabel">遮挡</label>
          <select className="mb-select" value={d.occlusion} onChange={(e) => patch({ occlusion: e.target.value as LightOcclusion })}>
            {OCCLUSIONS.map((o) => (
              <option key={o} value={o}>
                {LIGHT_OCCLUSION_LABELS[o]}
              </option>
            ))}
          </select>
        </div>
        <div className="mb-sc-light-selrow nodrag">
          <label className="mb-sc-flabel">光效</label>
          <select className="mb-select" value={d.effect} onChange={(e) => patch({ effect: e.target.value as LightEffect })}>
            {EFFECTS.map((o) => (
              <option key={o} value={o}>
                {LIGHT_EFFECT_LABELS[o]}
              </option>
            ))}
          </select>
        </div>

        <div className="mb-sc-angle-actions nodrag">
          <button className="mb-btn mb-btn-sm mb-btn-ghost" onClick={resetAll}>
            全部重置
          </button>
          <label className="mb-sc-switch-row">
            <input type="checkbox" checked={d.appendConsistencyInstruction} onChange={(e) => patch({ appendConsistencyInstruction: e.target.checked })} />
            一致性约束
          </label>
        </div>

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
          <button
            className="mb-btn mb-btn-sm mb-btn-ghost nodrag mb-sc-toprompt"
            title="把这段光照提示词导入一个下游提示词节点"
            onClick={() => makePromptNodeFrom(id, d.generatedPrompt)}
          >
            → 提示词节点
          </button>
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
