import { useMemo, useRef } from 'react';
import { NodeResizer, type NodeProps } from '@xyflow/react';
import { useSmartCanvasStore } from '@/store/smartCanvasStore';
import { computeUpstream } from '@/lib/smartCanvasRunner';
import { buildAnglePrompt } from '@/lib/anglePrompt';
import { localPathToImageUrl } from '@/lib/imageUrl';
import type { AnglePromptNodeData, SmartNodeData } from '@shared/smartCanvas';
import { NodeShell } from './NodeShell';
import { CopyButton, copyText, areaMenu, makePromptNodeFrom } from '../nodeArea';

function imgUrl(src?: string): string | null {
  if (!src) return null;
  return src.startsWith('data:') ? src : localPathToImageUrl(src);
}
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** 单个角度控制：滑杆 + 数字 + 单项重置 + 动态方向提示。 */
function AngleControl({
  label,
  hint,
  value,
  min,
  max,
  step,
  def,
  onChange
}: {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  step: number;
  def: number;
  onChange: (v: number) => void;
}): JSX.Element {
  return (
    <div className="mb-sc-angle-ctl">
      <div className="mb-sc-angle-ctl-head">
        <span className="mb-sc-angle-ctl-label">{label}</span>
        <span className="mb-sc-angle-ctl-hint">{hint}</span>
        <button className="mb-sc-angle-reset nodrag" title="重置此项" onClick={() => onChange(def)}>
          ↺
        </button>
      </div>
      <div className="mb-sc-angle-ctl-row nodrag">
        <input
          className="mb-sc-range"
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      </div>
    </div>
  );
}

/**
 * 视角提示词节点：接入一张图 → CSS-3D 预览 + 三向角度控制 → 实时生成「改变拍摄视角」提示词，文本输出喂下游。
 * 3D 预览仅交互展示，不作最终图片输出（项目未装 Three.js，且每节点一个 WebGL 上下文易超浏览器上限，故用 CSS 3D）。
 */
export function AnglePromptNode({ id, data }: NodeProps): JSX.Element {
  const remove = useSmartCanvasStore((s) => s.removeNode);
  const updateNodeData = useSmartCanvasStore((s) => s.updateNodeData);
  const nodes = useSmartCanvasStore((s) => s.nodes);
  const edges = useSmartCanvasStore((s) => s.edges);
  const fileRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<{ x: number; y: number; h: number; v: number } | null>(null);
  const d = data as unknown as AnglePromptNodeData;

  // 上游图片优先（实时跟随连线/上游变化）；无上游则用手动上传的图
  const up = useMemo(() => computeUpstream(nodes, edges, id), [nodes, edges, id]);
  const src = up.images[0] || d.inputImage?.url;
  const url = imgUrl(src);

  /** 改任一参数 → 合并 + 重算 generatedPrompt（输出实时同步）。 */
  function patch(p: Partial<AnglePromptNodeData>): void {
    const next = { ...d, ...p };
    next.generatedPrompt = buildAnglePrompt(
      next.horizontalAngle,
      next.verticalAngle,
      next.distance,
      next.appendConsistencyInstruction
    );
    updateNodeData(id, next as Partial<SmartNodeData>);
  }
  function resetAll(): void {
    patch({ horizontalAngle: 0, verticalAngle: 0, distance: 4 });
  }
  function loadFile(file: File | null | undefined): void {
    if (!file || !file.type.startsWith('image/')) return;
    const r = new FileReader();
    r.onload = () => patch({ inputImage: { url: String(r.result), name: file.name } });
    r.readAsDataURL(file);
  }

  // 在预览图上按住拖动调视角：右拖→向右旋、上拖→俯视（垂直方向与鼠标相反，符合环绕直觉）（0.5°/px），松手结束
  function onStageDown(e: React.PointerEvent): void {
    e.stopPropagation();
    dragRef.current = { x: e.clientX, y: e.clientY, h: d.horizontalAngle, v: d.verticalAngle };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  }
  function onStageMove(e: React.PointerEvent): void {
    const s = dragRef.current;
    if (!s) return;
    const h = Math.round(clamp(s.h + (e.clientX - s.x) * 0.5, -90, 90));
    // 垂直取负：向上拖 → 俯视（相机抬高往下看），向下拖 → 仰视。之前同号导致上下颠倒、反直觉
    const v = Math.round(clamp(s.v - (e.clientY - s.y) * 0.5, -90, 90));
    if (h !== d.horizontalAngle || v !== d.verticalAngle) patch({ horizontalAngle: h, verticalAngle: v });
  }
  function onStageUp(e: React.PointerEvent): void {
    dragRef.current = null;
    (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
  }

  // CSS-3D：scene 绕 X(俯仰)/Y(水平) 旋转模拟相机环绕；distance → 缩放（近大远小）
  const scale = clamp(4 / Math.max(0.1, d.distance), 0.55, 2.6);
  const sceneStyle = {
    transform: `rotateX(${d.verticalAngle}deg) rotateY(${d.horizontalAngle}deg) scale(${scale})`
  };

  const hH = d.horizontalAngle > 0 ? `向右 ${d.horizontalAngle}°` : d.horizontalAngle < 0 ? `向左 ${-d.horizontalAngle}°` : '正面';
  const hV = d.verticalAngle > 0 ? `俯视 ${d.verticalAngle}°` : d.verticalAngle < 0 ? `仰视 ${-d.verticalAngle}°` : '平视';
  const hD = d.distance > 4 ? '广角' : d.distance < 4 ? '特写' : '标准';

  return (
    <>
      <NodeResizer isVisible minWidth={260} minHeight={380} />
      <NodeShell title="视角" accent="is-angle" inputs outputs fill onDelete={() => remove(id)} label={d.label} labelColor={d.labelColor}>
        <div
          className="mb-sc-angle-stage nodrag"
          title="在预览上按住拖动调视角（右拖→向右 · 上拖→俯视）"
          onPointerDown={onStageDown}
          onPointerMove={onStageMove}
          onPointerUp={onStageUp}
          onPointerCancel={onStageUp}
        >
          <div className="mb-sc-angle-scene" style={sceneStyle}>
            <div className="mb-sc-angle-floor" />
            <div className="mb-sc-angle-plane" style={url ? { backgroundImage: `url(${url})` } : undefined}>
              {!url && '接入图片或上传'}
            </div>
          </div>
        </div>

        <div className="mb-sc-angle-uploadrow">
          <button className="mb-btn mb-btn-sm mb-btn-ghost nodrag" onClick={() => fileRef.current?.click()}>
            {url ? '换图' : '上传图片'}
          </button>
          {up.images[0] && <span className="mb-sc-angle-srcnote">上游图片（实时）</span>}
        </div>

        <AngleControl
          label="水平旋转"
          hint={hH}
          value={d.horizontalAngle}
          min={-90}
          max={90}
          step={1}
          def={0}
          onChange={(v) => patch({ horizontalAngle: v })}
        />
        <AngleControl
          label="垂直俯仰"
          hint={hV}
          value={d.verticalAngle}
          min={-90}
          max={90}
          step={1}
          def={0}
          onChange={(v) => patch({ verticalAngle: v })}
        />
        <AngleControl
          label="镜头距离"
          hint={hD}
          value={d.distance}
          min={0.1}
          max={8}
          step={0.1}
          def={4}
          onChange={(v) => patch({ distance: v })}
        />

        <div className="mb-sc-angle-actions nodrag">
          <button className="mb-btn mb-btn-sm mb-btn-ghost" onClick={resetAll}>
            全部重置
          </button>
          <label className="mb-sc-switch-row">
            <input
              type="checkbox"
              checked={d.appendConsistencyInstruction}
              onChange={(e) => patch({ appendConsistencyInstruction: e.target.checked })}
            />
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
            title="把这段视角提示词导入一个下游提示词节点"
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
