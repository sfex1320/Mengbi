import { useMemo, useRef, type CSSProperties } from 'react';
import { useSmartCanvasStore, absPosition } from '@/store/smartCanvasStore';
import { computeUpstream } from '@/lib/smartCanvasRunner';
import { buildCameraPrompt } from '@/lib/cameraPrompt';
import { localPathToImageUrl } from '@/lib/imageUrl';
import {
  CAMERA_TYPE_LABELS,
  APERTURE_LABELS,
  APERTURE_SUB,
  MOVEMENT_LABELS,
  FOCAL_LABELS,
  FOCAL_SUB,
  COMPOSITION_LABELS,
  SHOT_SIZE_LABELS,
  SHOT_SIZE_SUB,
  type AnglePromptNodeData,
  type CameraType,
  type ApertureSetting,
  type CameraMovement,
  type FocalLength,
  type ShotComposition,
  type ShotSize,
  type SmartNodeData
} from '@shared/smartCanvas';
import { ResizablePanelWrapper } from './ResizablePanelWrapper';
import { SegmentedControl } from './consoleControls';
import { IconChoiceGrid, CompositionOverlay, type IconChoiceOption } from '../nodeControls';
import { optionIcon } from '../optionIcons';
import { copyText, makePromptNodeFrom } from '../nodeArea';
import './nodePanel.css';

const STORAGE_KEY = 'mengbi.smartCanvas.cameraConsole.geom.v1';

const CAMERA_TYPES = Object.keys(CAMERA_TYPE_LABELS) as CameraType[];
const APERTURES = Object.keys(APERTURE_LABELS) as ApertureSetting[];
const MOVEMENTS = Object.keys(MOVEMENT_LABELS) as CameraMovement[];
const FOCALS = Object.keys(FOCAL_LABELS) as FocalLength[];
const COMPOSITIONS = Object.keys(COMPOSITION_LABELS) as ShotComposition[];
const SHOT_SIZES = Object.keys(SHOT_SIZE_LABELS) as ShotSize[];

const CAMERA_OPTS: IconChoiceOption<CameraType>[] = CAMERA_TYPES.map((v) => ({ value: v, label: CAMERA_TYPE_LABELS[v], icon: optionIcon('cameraType', v) }));
const APERTURE_OPTS: IconChoiceOption<ApertureSetting>[] = APERTURES.map((v) => ({ value: v, label: APERTURE_LABELS[v], sub: APERTURE_SUB[v], icon: optionIcon('aperture', v) }));
const MOVEMENT_OPTS: IconChoiceOption<CameraMovement>[] = MOVEMENTS.map((v) => ({ value: v, label: MOVEMENT_LABELS[v], icon: optionIcon('movement', v) }));
const FOCAL_OPTS: IconChoiceOption<FocalLength>[] = FOCALS.map((v) => ({ value: v, label: FOCAL_LABELS[v], sub: FOCAL_SUB[v], icon: optionIcon('focal', v) }));
const COMPOSITION_OPTS: IconChoiceOption<ShotComposition>[] = COMPOSITIONS.map((v) => ({ value: v, label: COMPOSITION_LABELS[v], icon: optionIcon('composition', v) }));
const SHOT_SIZE_OPTS: IconChoiceOption<ShotSize>[] = SHOT_SIZES.map((v) => ({ value: v, label: SHOT_SIZE_LABELS[v], sub: SHOT_SIZE_SUB[v], icon: optionIcon('shotSize', v) }));

function imgUrl(src?: string): string | null {
  if (!src) return null;
  return src.startsWith('data:') ? src : localPathToImageUrl(src);
}
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** 镜头节点弹窗控制台（像生图节点一样丰富，按钮 + 下拉 + 实时 3D 示意图）。 */
export function NodeCameraConsole(): JSX.Element | null {
  const sel = useSmartCanvasStore((s) => s.nodes.find((x) => x.selected && x.type === 'angle-prompt') ?? null);
  if (!sel) return null;
  const w = sel.measured?.width ?? (typeof sel.width === 'number' ? sel.width : 264);
  const h = sel.measured?.height ?? (typeof sel.height === 'number' ? sel.height : 320);
  const abs = absPosition(sel, useSmartCanvasStore.getState().nodes);
  const anchor = { x: abs.x, y: abs.y, w, h };
  return (
    <ResizablePanelWrapper storageKey={STORAGE_KEY} anchor={anchor} autoSize className="mb-np-console">
      <CameraConsoleInner key={sel.id} id={sel.id} />
    </ResizablePanelWrapper>
  );
}


function Slider({ label, hint, value, min, max, step, def, onChange }: {
  label: string; hint: string; value: number; min: number; max: number; step: number; def: number; onChange: (v: number) => void;
}): JSX.Element {
  return (
    <div className="mb-np-cam-slider">
      <div className="mb-np-cam-slider-head">
        <span>{label}</span>
        <span className="mb-np-cam-slider-hint">{hint}</span>
        <button type="button" className="mb-np-cam-reset" title="重置此项" onClick={() => onChange(def)}>↺</button>
      </div>
      <input className="mb-sc-range" type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

function CameraConsoleInner({ id }: { id: string }): JSX.Element | null {
  const node = useSmartCanvasStore((s) => s.nodes.find((n) => n.id === id));
  const update = useSmartCanvasStore((s) => s.updateNodeData);
  const deselectAll = useSmartCanvasStore((s) => s.deselectAll);
  const nodes = useSmartCanvasStore((s) => s.nodes);
  const edges = useSmartCanvasStore((s) => s.edges);
  const dragRef = useRef<{ x: number; y: number; h: number; v: number } | null>(null);

  const up = useMemo(() => computeUpstream(nodes, edges, id), [nodes, edges, id]);
  if (!node) return null;
  const d = node.data as unknown as AnglePromptNodeData;
  const mode = d.camMode ?? 'photo';
  const src = up.images[0] || d.inputImage?.url;
  const url = imgUrl(src);

  function patch(p: Partial<AnglePromptNodeData>): void {
    const next = { ...d, ...p };
    next.generatedPrompt = buildCameraPrompt(next);
    update(id, next as Partial<SmartNodeData>);
  }
  function resetAll(): void {
    patch({ horizontalAngle: 0, verticalAngle: 0, distance: 4, cameraType: 'none', aperture: 'none', movement: 'none', focal: 'none', composition: 'none', shotSize: 'none' });
  }

  // 预览拖动调视角（右拖→向右、上拖→俯视，0.5°/px）
  function onStageDown(e: React.PointerEvent): void {
    e.stopPropagation();
    dragRef.current = { x: e.clientX, y: e.clientY, h: d.horizontalAngle, v: d.verticalAngle };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  }
  function onStageMove(e: React.PointerEvent): void {
    const s = dragRef.current;
    if (!s) return;
    const h = Math.round(clamp(s.h + (e.clientX - s.x) * 0.5, -90, 90));
    const v = Math.round(clamp(s.v - (e.clientY - s.y) * 0.5, -90, 90));
    if (h !== d.horizontalAngle || v !== d.verticalAngle) patch({ horizontalAngle: h, verticalAngle: v });
  }
  function onStageUp(e: React.PointerEvent): void {
    dragRef.current = null;
    (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
  }

  const scale = clamp(4 / Math.max(0.1, d.distance), 0.55, 2.4);
  const sceneStyle: CSSProperties = { transform: `rotateX(${d.verticalAngle}deg) rotateY(${d.horizontalAngle}deg) scale(${scale})` };
  const planeStyle: CSSProperties = url ? { backgroundImage: `url(${url})` } : {};

  const hH = d.horizontalAngle > 0 ? `向右 ${d.horizontalAngle}°` : d.horizontalAngle < 0 ? `向左 ${-d.horizontalAngle}°` : '正面';
  const hV = d.verticalAngle > 0 ? `俯视 ${d.verticalAngle}°` : d.verticalAngle < 0 ? `仰视 ${-d.verticalAngle}°` : '平视';
  const hD = d.distance > 4 ? '广角' : d.distance < 4 ? '特写' : '标准';

  return (
    <div className="mb-np-root">
      <div className="mb-np-header">
        <div className="mb-np-header-left">
          <span className="mb-np-header-ico">🎬</span>
          <span className="mb-np-header-title">镜头节点</span>
          <span className="mb-np-header-dot">·</span>
          <span className="mb-np-header-sub">{mode === 'photo' ? '拍照' : '视频'}</span>
        </div>
        <div className="mb-np-header-right">
          <button className="mb-np-hbtn mb-np-hbtn-ico" title="关闭（取消选中）" onClick={deselectAll}>✕</button>
        </div>
      </div>

      <div className="mb-np-cam">
        <div className="mb-np-cam-top">
          {/* 左：实时 3D 示意图（拖动调视角）+ 构图取景框 */}
          <div className="mb-np-cam-left">
            <div
              className="mb-sc-angle-stage mb-np-cam-stage nodrag"
              title="按住拖动调机位（右拖→向右 · 上拖→俯视）"
              onPointerDown={onStageDown}
              onPointerMove={onStageMove}
              onPointerUp={onStageUp}
              onPointerCancel={onStageUp}
            >
              <div className="mb-sc-angle-scene" style={sceneStyle}>
                <div className="mb-sc-angle-floor" />
                <div className="mb-sc-angle-plane mb-np-cam-plane" style={planeStyle}>
                  {!url && '接入图片'}
                </div>
              </div>
              <CompositionOverlay composition={d.composition ?? 'none'} />
            </div>
            <div className="mb-np-cam-mode">
              <SegmentedControl
                value={mode}
                options={[
                  { value: 'photo', label: '📷 拍照' },
                  { value: 'video', label: '🎥 视频' }
                ]}
                onChange={(v) => patch({ camMode: v })}
              />
            </div>
          </div>

          {/* 右：控制字段 */}
          <div className="mb-np-cam-fields">
            {mode === 'photo' ? (
              <>
                <CamField label="相机机型">
                  <IconChoiceGrid<CameraType> compact value={d.cameraType ?? 'none'} options={CAMERA_OPTS} onChange={(v) => patch({ cameraType: v })} />
                </CamField>
                <CamField label="光圈（景深虚化）">
                  <IconChoiceGrid<ApertureSetting> compact value={d.aperture ?? 'none'} options={APERTURE_OPTS} onChange={(v) => patch({ aperture: v })} />
                </CamField>
              </>
            ) : (
              <>
                <CamField label="运镜方式">
                  <IconChoiceGrid<CameraMovement> compact value={d.movement ?? 'none'} options={MOVEMENT_OPTS} onChange={(v) => patch({ movement: v })} />
                </CamField>
                <CamField label="焦距">
                  <IconChoiceGrid<FocalLength> compact value={d.focal ?? 'none'} options={FOCAL_OPTS} onChange={(v) => patch({ focal: v })} />
                </CamField>
              </>
            )}
            <CamField label="景别（景构）">
              <IconChoiceGrid<ShotSize> compact value={d.shotSize ?? 'none'} options={SHOT_SIZE_OPTS} onChange={(v) => patch({ shotSize: v })} />
            </CamField>
            <CamField label="构图">
              <IconChoiceGrid<ShotComposition> compact value={d.composition ?? 'none'} options={COMPOSITION_OPTS} onChange={(v) => patch({ composition: v })} />
            </CamField>
          </div>
        </div>

        {/* 视角（机位角度）三滑杆——两种模式都可微调 */}
        <div className="mb-np-cam-angles">
          <Slider label="水平旋转" hint={hH} value={d.horizontalAngle} min={-90} max={90} step={1} def={0} onChange={(v) => patch({ horizontalAngle: v })} />
          <Slider label="垂直俯仰" hint={hV} value={d.verticalAngle} min={-90} max={90} step={1} def={0} onChange={(v) => patch({ verticalAngle: v })} />
          <Slider label="镜头距离" hint={hD} value={d.distance} min={0.1} max={8} step={0.1} def={4} onChange={(v) => patch({ distance: v })} />
        </div>

        <div className="mb-np-cam-actions">
          <button className="mb-btn mb-btn-sm mb-btn-ghost" onClick={resetAll}>全部重置</button>
          <label className="mb-sc-switch-row">
            <input type="checkbox" checked={d.appendConsistencyInstruction} onChange={(e) => patch({ appendConsistencyInstruction: e.target.checked })} />
            一致性约束
          </label>
        </div>

        <div className="mb-np-cam-prompt-wrap">
          <label className="mb-np-flabel">镜头提示词（实时输出给下游）</label>
          <div className="mb-np-cam-prompt">{d.generatedPrompt}</div>
          <div className="mb-np-cam-prompt-actions">
            <button className="mb-btn mb-btn-sm mb-btn-ghost" onClick={() => copyText(d.generatedPrompt)}>复制</button>
            <button className="mb-btn mb-btn-sm mb-btn-ghost" onClick={() => makePromptNodeFrom(id, d.generatedPrompt)}>→ 提示词节点</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CamField({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="mb-np-cam-field">
      <label className="mb-np-flabel">{label}</label>
      {children}
    </div>
  );
}
