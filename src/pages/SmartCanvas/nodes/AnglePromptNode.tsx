import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { NodeResizer, type NodeProps } from '@xyflow/react';
import { useSmartCanvasStore } from '@/store/smartCanvasStore';
import { computeUpstream } from '@/lib/smartCanvasRunner';
import { localPathToImageUrl } from '@/lib/imageUrl';
import {
  CAMERA_TYPE_LABELS,
  APERTURE_LABELS,
  MOVEMENT_LABELS,
  FOCAL_LABELS,
  COMPOSITION_LABELS,
  SHOT_SIZE_LABELS,
  type AnglePromptNodeData,
  type SmartNodeData
} from '@shared/smartCanvas';
import { NodeShell } from './NodeShell';
import { CompositionOverlay } from '../nodeControls';
import { optionIcon } from '../optionIcons';
import { CopyButton, ToPromptButton, copyText, areaMenu, makePromptNodeFrom, useFitNodeToContent } from '../nodeArea';

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function imgUrl(src?: string): string | null {
  if (!src) return null;
  return src.startsWith('data:') ? src : localPathToImageUrl(src);
}

/** 当前镜头设置 → 带图标的摘要标签（卡片上简洁展示，详细调参在弹窗控制台）。 */
function summaryChips(d: AnglePromptNodeData): { icon: JSX.Element | null; label: string }[] {
  const mode = d.camMode ?? 'photo';
  const out: { icon: JSX.Element | null; label: string }[] = [];
  if (d.shotSize && d.shotSize !== 'none') out.push({ icon: optionIcon('shotSize', d.shotSize, 14), label: SHOT_SIZE_LABELS[d.shotSize] });
  if (mode === 'photo') {
    if (d.cameraType && d.cameraType !== 'none') out.push({ icon: optionIcon('cameraType', d.cameraType, 14), label: CAMERA_TYPE_LABELS[d.cameraType] });
    if (d.aperture && d.aperture !== 'none') out.push({ icon: optionIcon('aperture', d.aperture, 14), label: APERTURE_LABELS[d.aperture] });
  } else {
    if (d.movement && d.movement !== 'none') out.push({ icon: optionIcon('movement', d.movement, 14), label: MOVEMENT_LABELS[d.movement] });
    if (d.focal && d.focal !== 'none') out.push({ icon: optionIcon('focal', d.focal, 14), label: FOCAL_LABELS[d.focal] });
  }
  if (d.composition && d.composition !== 'none') out.push({ icon: optionIcon('composition', d.composition, 14), label: COMPOSITION_LABELS[d.composition] });
  if (d.horizontalAngle) out.push({ icon: null, label: d.horizontalAngle > 0 ? `右 ${d.horizontalAngle}°` : `左 ${-d.horizontalAngle}°` });
  if (d.verticalAngle) out.push({ icon: null, label: d.verticalAngle > 0 ? `俯 ${d.verticalAngle}°` : `仰 ${-d.verticalAngle}°` });
  return out;
}

/**
 * 镜头节点（原「视角」升级）：卡片保持干净——预览 + 模式徽章 + 当前设置摘要 + 镜头提示词。
 * 详细调参（相机/光圈/视角/运镜/焦距/构图 + 实时 3D 示意图）在 NodeCameraConsole 弹窗里（选中节点弹出）。
 */
export function AnglePromptNode({ id, data }: NodeProps): JSX.Element {
  const remove = useSmartCanvasStore((s) => s.removeNode);
  const updateNodeData = useSmartCanvasStore((s) => s.updateNodeData);
  const nodes = useSmartCanvasStore((s) => s.nodes);
  const edges = useSmartCanvasStore((s) => s.edges);
  const fileRef = useRef<HTMLInputElement>(null);
  const fitRef = useRef<HTMLDivElement>(null);
  const d = data as unknown as AnglePromptNodeData;
  const mode = d.camMode ?? 'photo';

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

  function loadFile(file: File | null | undefined): void {
    if (!file || !file.type.startsWith('image/')) return;
    const r = new FileReader();
    r.onload = () => updateNodeData(id, { inputImage: { url: String(r.result), name: file.name } } as Partial<SmartNodeData>);
    r.readAsDataURL(file);
  }

  const chips = summaryChips(d);
  const previewStyle: CSSProperties = {
    aspectRatio: imgAspect ? Math.max(0.6, Math.min(1.8, imgAspect)) : 4 / 3
  };
  // 卡片上的实时镜头示意：图片随机位角度做轻微 3D 倾斜 + 远近缩放（只读，调参在弹窗里）
  const scale = clamp(4 / Math.max(0.1, d.distance), 0.62, 1.7);
  const imgStyle: CSSProperties = {
    ...(url ? { backgroundImage: `url(${url})` } : {}),
    transform: `perspective(440px) rotateX(${clamp(d.verticalAngle, -60, 60)}deg) rotateY(${clamp(d.horizontalAngle, -60, 60)}deg) scale(${scale})`
  };

  return (
    <>
      <NodeResizer isVisible minWidth={240} minHeight={250} />
      <NodeShell title="镜头" accent="is-angle" inputs outputs fill onDelete={() => remove(id)} label={d.label} labelColor={d.labelColor}>
        <div ref={fitRef} className="mb-sc-fit">
          <div className="mb-sc-cam-preview" style={previewStyle}>
            <div className="mb-sc-cam-preview-img" style={imgStyle} />
            {!url && <span className="mb-sc-cam-preview-ph">接入图片或上传</span>}
            <CompositionOverlay composition={d.composition ?? 'none'} />
            <span className="mb-sc-cam-modebadge">{mode === 'photo' ? '📷 拍照' : '🎥 视频'}</span>
          </div>

          {up.images[0] ? (
            <div className="mb-sc-fromup is-fed nodrag">图片由上游输入（实时）</div>
          ) : (
            <div className="mb-sc-angle-uploadrow">
              <button className="mb-btn mb-btn-sm mb-btn-ghost nodrag" onClick={() => fileRef.current?.click()}>
                {url ? '换图' : '上传图片'}
              </button>
            </div>
          )}

          <div className="mb-sc-cam-chips nodrag">
            {chips.length ? (
              chips.map((c, i) => (
                <span key={i} className="mb-sc-cam-chip" title={c.label}>
                  {c.icon && <span className="mb-sc-cam-chip-ico">{c.icon}</span>}
                  {c.label}
                </span>
              ))
            ) : (
              <span className="mb-sc-cam-chips-empty">未设置镜头 · 选中此节点打开控制台</span>
            )}
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
            <ToPromptButton onClick={() => makePromptNodeFrom(id, d.generatedPrompt)} title="把这段镜头提示词导入一个下游提示词节点" />
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
