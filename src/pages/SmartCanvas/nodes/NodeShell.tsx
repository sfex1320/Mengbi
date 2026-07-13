import { Handle, Position } from '@xyflow/react';
import {
  ImageNodeIcon,
  PromptNodeIcon,
  LlmNodeIcon,
  WorkNodeIcon,
  ComfyNodeIcon,
  ResultNodeIcon,
  GroupNodeIcon,
  AngleNodeIcon,
  ScaleNodeIcon,
  RatioNodeIcon,
  LightNodeIcon,
  PaletteNodeIcon,
  CompareNodeIcon,
  VideoNodeIcon,
  ImageReverseNodeIcon,
  VideoSourceNodeIcon,
  FrameInterpNodeIcon,
  VideoClipNodeIcon,
  StoryboardNodeIcon,
  CharacterCardNodeIcon,
  PromptMallNodeIcon,
  LoopNodeIcon,
  UpscaleNodeIcon,
  VectorizeNodeIcon,
  FolderInputNodeIcon,
  FolderOutputNodeIcon,
  SegmentNodeIcon,
  ProofNodeIcon
} from '../icons';

type IconC = (p: { size?: number }) => JSX.Element;
/** accent class → 节点类型图标（让浮动标题带上对应图标，无需每个节点改签名）。 */
const ACCENT_ICON: Record<string, IconC> = {
  'is-image': ImageNodeIcon,
  'is-prompt': PromptNodeIcon,
  'is-llm': LlmNodeIcon,
  'is-work': WorkNodeIcon,
  'is-comfy': ComfyNodeIcon,
  'is-result': ResultNodeIcon,
  'is-group': GroupNodeIcon,
  'is-angle': AngleNodeIcon,
  'is-scale': ScaleNodeIcon,
  'is-ratio': RatioNodeIcon,
  'is-light': LightNodeIcon,
  'is-palette': PaletteNodeIcon,
  'is-compare': CompareNodeIcon,
  'is-video': VideoNodeIcon,
  'is-image-reverse': ImageReverseNodeIcon,
  'is-video-source': VideoSourceNodeIcon,
  'is-frame-interp': FrameInterpNodeIcon,
  'is-video-clip': VideoClipNodeIcon,
  'is-storyboard': StoryboardNodeIcon,
  'is-character-card': CharacterCardNodeIcon,
  'is-prompt-mall': PromptMallNodeIcon,
  'is-loop': LoopNodeIcon,
  'is-upscale': UpscaleNodeIcon,
  'is-vectorize': VectorizeNodeIcon,
  'is-folder-input': FolderInputNodeIcon,
  'is-folder-output': FolderOutputNodeIcon,
  'is-segment': SegmentNodeIcon,
  'is-proof': ProofNodeIcon
};

/**
 * 节点外壳（CanvasNode 基座）：卡内顶部标题栏（左=图标+名，右=节点自有控件 headRight + 删除 ×），
 * 标题栏下方为内容区；左输入 / 右输出为纵贯轨道连接口。
 * 交互元素需加 `nodrag` 防止拖动节点时误触。
 */
export function NodeShell({
  title,
  accent,
  inputs,
  outputs,
  fill,
  onDelete,
  headRight,
  children
}: {
  title: string;
  accent: string;
  inputs?: boolean;
  /** true=单输出口（id='out'，现状）；数组=多输出口（轨道上下分段，title 悬停提示）——首个多输出口节点：智能分镜（分镜/转场） */
  outputs?: boolean | Array<{ id: string; title: string }>;
  /** 可调尺寸节点：撑满 React Flow 节点框 */
  fill?: boolean;
  onDelete?: () => void;
  headRight?: React.ReactNode;
  /** 用户标签 / 注释（彩色小条，显示在标题条下方） */
  label?: string;
  labelColor?: string;
  children: React.ReactNode;
}): JSX.Element {
  const TitleIcon = ACCENT_ICON[accent];
  return (
    <div className={`mb-sc-nodewrap ${fill ? 'is-fill' : ''}`}>
      <div className={`mb-sc-node ${accent} ${fill ? 'is-fill' : ''}`}>
        {inputs && (
          <Handle
            id="in"
            type="target"
            position={Position.Left}
            isConnectableStart
            title="输入连接口：把上游节点拖到这里接入"
            className="mb-sc-handle mb-sc-handle-in"
          />
        )}
        {/* 卡内标题栏：左=图标+名，右=节点自有控件(headRight) + 删除 × */}
        <div className="mb-sc-node-head">
          <div className="mb-sc-node-headleft">
            {TitleIcon && <TitleIcon size={14} />}
            <span className="mb-sc-node-title">{title}</span>
          </div>
          <div className="mb-sc-node-headright">
            {headRight}
            {onDelete && (
              <button className="mb-sc-node-x nodrag" onClick={onDelete} title="删除节点">
                ✕
              </button>
            )}
          </div>
        </div>
        <div className="mb-sc-node-body">{children}</div>
        {Array.isArray(outputs)
          ? outputs.map((o, i) => (
              <Handle
                key={o.id}
                id={o.id}
                type="source"
                position={Position.Right}
                title={o.title}
                className={`mb-sc-handle mb-sc-handle-out is-split is-split-${i}`}
              />
            ))
          : outputs && (
              <Handle
                id="out"
                type="source"
                position={Position.Right}
                title="输出连接口：从这里拖出连到下游节点"
                className="mb-sc-handle mb-sc-handle-out"
              />
            )}
      </div>
    </div>
  );
}
