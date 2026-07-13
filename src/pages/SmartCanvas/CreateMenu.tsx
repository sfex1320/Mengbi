import { createPortal } from 'react-dom';
import { useSmartCanvasStore, useSmartCanvasUiStore } from '@/store/smartCanvasStore';
import type { SmartNodeKind } from '@shared/smartCanvas';
import { NODE_ICONS } from './icons';

const ITEMS: Array<[SmartNodeKind, string]> = [
  ['image', '图片'],
  ['folder-input', '文件夹输入'],
  ['prompt', '提示词'],
  ['llm', 'LLM'],
  ['prompt-mall', '提示词商城'],
  ['storyboard', '智能分镜'],
  ['image-reverse', '反推'],
  ['character-card', '角色卡'],
  ['segment', '切分工具'],
  ['proof', '对稿'],
  ['angle-prompt', '镜头'],
  ['light', '光源'],
  ['palette', '配色工具'],
  ['scale', '缩放'],
  ['upscale', '保真放大'],
  ['vectorize', '图像转矢量'],
  ['ratio', '尺寸分析'],
  ['loop', '循环'],
  ['work', '生图'],
  ['comfy', 'ComfyUI'],
  ['video-source', '视频上传'],
  ['video', '视频'],
  ['frame-interp', '插帧'],
  ['video-clip', '视频剪辑'],
  ['result', '结果'],
  ['folder-output', '文件夹输出'],
  ['compare', '对比'],
  ['group', '分组']
];

/** 从「输出口」拖出 → 能接到哪些下游节点（图片/提示词无输入口，不作目标；结果/缩放可作来源继续往下连）。 */
const DOWNSTREAM: Record<SmartNodeKind, SmartNodeKind[]> = {
  image: ['work', 'comfy', 'video', 'llm', 'storyboard', 'character-card', 'group', 'angle-prompt', 'light', 'palette', 'scale', 'ratio', 'result', 'compare', 'image-reverse', 'upscale', 'vectorize', 'segment', 'proof'],
  prompt: ['work', 'comfy', 'video', 'llm', 'prompt-mall', 'storyboard', 'character-card', 'image-reverse', 'group', 'result'],
  llm: ['work', 'comfy', 'video', 'llm', 'prompt-mall', 'storyboard', 'character-card', 'image-reverse', 'group', 'result'],
  'angle-prompt': ['work', 'comfy', 'video', 'llm', 'group', 'result'],
  light: ['work', 'comfy', 'video', 'llm', 'group', 'result'],
  palette: ['work', 'comfy', 'video', 'llm', 'group', 'result'],
  work: ['result', 'folder-output', 'work', 'comfy', 'video', 'llm', 'storyboard', 'character-card', 'angle-prompt', 'light', 'palette', 'scale', 'ratio', 'compare', 'image-reverse', 'upscale', 'vectorize', 'segment', 'proof'],
  comfy: ['result', 'folder-output', 'work', 'comfy', 'video', 'llm', 'storyboard', 'character-card', 'angle-prompt', 'light', 'palette', 'scale', 'ratio', 'compare', 'image-reverse', 'upscale', 'vectorize', 'segment', 'proof'],
  group: ['work', 'comfy', 'video', 'llm', 'prompt-mall', 'storyboard', 'character-card', 'angle-prompt', 'light', 'palette', 'scale', 'ratio', 'result', 'folder-output', 'compare', 'image-reverse', 'frame-interp', 'video-clip', 'upscale', 'vectorize', 'segment', 'proof'],
  result: ['work', 'comfy', 'video', 'llm', 'prompt-mall', 'storyboard', 'character-card', 'group', 'angle-prompt', 'light', 'palette', 'scale', 'ratio', 'folder-output', 'compare', 'image-reverse', 'frame-interp', 'video-clip', 'upscale', 'vectorize', 'segment', 'proof'],
  scale: ['work', 'comfy', 'video', 'llm', 'storyboard', 'character-card', 'group', 'angle-prompt', 'light', 'palette', 'scale', 'ratio', 'result', 'folder-output', 'compare', 'image-reverse', 'frame-interp', 'video-clip', 'upscale', 'vectorize', 'segment', 'proof'],
  ratio: ['work', 'comfy', 'video', 'result'],
  text: [],
  compare: [],
  video: ['result', 'folder-output', 'image-reverse', 'scale', 'frame-interp', 'video-clip'],
  'image-reverse': ['work', 'comfy', 'video', 'llm', 'prompt-mall', 'storyboard', 'character-card', 'group', 'result'],
  'video-source': ['image-reverse', 'scale', 'frame-interp', 'video-clip', 'result'],
  'frame-interp': ['image-reverse', 'scale', 'frame-interp', 'video-clip', 'result'],
  'video-clip': ['image-reverse', 'scale', 'frame-interp', 'video-clip', 'result', 'folder-output'],
  storyboard: ['video', 'work', 'comfy', 'llm', 'group', 'result'],
  'character-card': ['work', 'comfy', 'video', 'llm', 'storyboard', 'prompt-mall', 'group', 'result'],
  'prompt-mall': ['storyboard', 'character-card', 'work', 'comfy', 'video', 'llm', 'group', 'result'],
  loop: ['work', 'comfy', 'video', 'result'],
  'folder-input': ['work', 'comfy', 'scale', 'upscale', 'vectorize', 'image-reverse', 'storyboard', 'character-card', 'frame-interp', 'video-clip', 'group', 'result', 'compare', 'ratio', 'angle-prompt', 'light', 'palette', 'segment', 'proof'],
  upscale: ['work', 'comfy', 'video', 'llm', 'storyboard', 'character-card', 'group', 'angle-prompt', 'light', 'palette', 'scale', 'upscale', 'vectorize', 'ratio', 'result', 'folder-output', 'compare', 'image-reverse', 'segment', 'proof'],
  vectorize: ['result', 'folder-output'],
  'folder-output': [],
  // 切分=图片产出（像 scale 但只产图，不接视频类下游）；对稿=文本产出（像 image-reverse）
  segment: ['work', 'comfy', 'video', 'llm', 'storyboard', 'character-card', 'group', 'angle-prompt', 'light', 'palette', 'scale', 'ratio', 'result', 'folder-output', 'compare', 'image-reverse', 'upscale', 'vectorize', 'segment', 'proof'],
  proof: ['work', 'comfy', 'video', 'llm', 'prompt-mall', 'storyboard', 'group', 'result']
};

/** 从「输入口」拖出 → 能建哪些上游节点（谁能喂进本节点；结果只接 生成/ComfyUI/LLM；视角/光源/缩放/比例只接图片来源）。 */
const UPSTREAM: Record<SmartNodeKind, SmartNodeKind[]> = {
  work: ['image', 'folder-input', 'prompt', 'llm', 'prompt-mall', 'storyboard', 'character-card', 'angle-prompt', 'light', 'palette', 'work', 'comfy', 'group', 'result', 'scale', 'upscale', 'image-reverse', 'ratio', 'loop', 'segment', 'proof'],
  comfy: ['image', 'folder-input', 'prompt', 'llm', 'prompt-mall', 'storyboard', 'character-card', 'angle-prompt', 'light', 'palette', 'work', 'comfy', 'group', 'result', 'scale', 'upscale', 'image-reverse', 'ratio', 'loop', 'segment', 'proof'],
  llm: ['image', 'folder-input', 'prompt', 'llm', 'prompt-mall', 'storyboard', 'character-card', 'angle-prompt', 'light', 'palette', 'work', 'comfy', 'group', 'result', 'scale', 'upscale', 'image-reverse', 'segment', 'proof'],
  group: ['image', 'folder-input', 'prompt', 'llm', 'prompt-mall', 'storyboard', 'character-card', 'angle-prompt', 'light', 'palette', 'work', 'comfy', 'group', 'result', 'scale', 'upscale', 'image-reverse', 'segment', 'proof'],
  'angle-prompt': ['image', 'folder-input', 'group', 'work', 'comfy', 'result', 'scale', 'upscale', 'segment'],
  light: ['image', 'folder-input', 'group', 'work', 'comfy', 'result', 'scale', 'upscale', 'segment'],
  palette: ['image', 'folder-input', 'group', 'work', 'comfy', 'result', 'scale', 'upscale', 'segment'],
  scale: ['image', 'folder-input', 'group', 'work', 'comfy', 'result', 'scale', 'video-source', 'video', 'frame-interp', 'video-clip', 'segment'],
  ratio: ['image', 'folder-input', 'group', 'work', 'comfy', 'result', 'scale', 'upscale', 'segment'],
  result: ['work', 'comfy', 'llm', 'prompt-mall', 'storyboard', 'character-card', 'group', 'prompt', 'image', 'folder-input', 'angle-prompt', 'light', 'palette', 'scale', 'upscale', 'vectorize', 'video', 'image-reverse', 'video-source', 'frame-interp', 'video-clip', 'ratio', 'loop', 'segment', 'proof'],
  compare: ['image', 'folder-input', 'group', 'work', 'comfy', 'result', 'scale', 'upscale', 'segment'],
  video: ['image', 'prompt', 'llm', 'prompt-mall', 'storyboard', 'character-card', 'angle-prompt', 'light', 'palette', 'work', 'comfy', 'group', 'result', 'scale', 'upscale', 'image-reverse', 'ratio', 'loop', 'segment', 'proof'],
  image: [],
  prompt: [],
  text: [],
  // 反推：图片 / 视频（抽帧）来源 + 文本来源（角色反推的角色素材）都能作上游
  'image-reverse': ['image', 'folder-input', 'prompt', 'llm', 'group', 'work', 'comfy', 'result', 'scale', 'upscale', 'segment', 'video-source', 'video', 'frame-interp', 'video-clip'],
  'video-source': [],
  'frame-interp': ['video-source', 'video', 'result', 'scale', 'frame-interp', 'video-clip', 'folder-input', 'group'],
  'video-clip': ['video-source', 'video', 'result', 'scale', 'frame-interp', 'video-clip', 'folder-input', 'group'],
  // 智能分镜（2026-07-14 增参考图）：文本来源（角色描述 + 简短故事）+ 图片来源（人物形象/分镜片段参考图）
  storyboard: ['prompt', 'llm', 'image-reverse', 'character-card', 'prompt-mall', 'group', 'result', 'proof', 'image', 'folder-input', 'work', 'comfy', 'scale', 'upscale', 'segment'],
  // 角色卡：图片来源（人物照片）+ 文本来源（简单描述）
  'character-card': ['image', 'folder-input', 'prompt', 'llm', 'image-reverse', 'prompt-mall', 'group', 'work', 'comfy', 'result', 'scale', 'upscale', 'segment'],
  'prompt-mall': ['prompt', 'llm', 'image-reverse', 'character-card', 'group', 'result', 'proof'],
  loop: [],
  'folder-input': [],
  upscale: ['image', 'folder-input', 'group', 'work', 'comfy', 'result', 'scale', 'upscale', 'segment'],
  vectorize: ['image', 'folder-input', 'group', 'work', 'comfy', 'result', 'scale', 'upscale', 'segment'],
  'folder-output': ['work', 'comfy', 'video', 'scale', 'frame-interp', 'video-clip', 'result', 'group', 'upscale', 'vectorize', 'segment'],
  // 切分=只接图片来源；对稿=只接图片来源（反推已改图/视频/文本三通道，不再作样板）
  segment: ['image', 'folder-input', 'group', 'work', 'comfy', 'result', 'scale', 'upscale', 'segment'],
  proof: ['image', 'folder-input', 'group', 'work', 'comfy', 'result', 'scale', 'upscale', 'segment']
};

/** 拖出连线 / 双击画布时弹出的快捷创建菜单（fixed 定位在光标处）。 */
export function CreateMenu(): JSX.Element | null {
  const menu = useSmartCanvasUiStore((s) => s.createMenu);
  const close = useSmartCanvasUiStore((s) => s.closeCreateMenu);
  const addNode = useSmartCanvasStore((s) => s.addNode);
  const onConnect = useSmartCanvasStore((s) => s.onConnect);
  if (!menu) return null;
  const m = menu;

  const anchorKind = m.anchorId
    ? useSmartCanvasStore.getState().nodes.find((n) => n.id === m.anchorId)?.type
    : undefined;

  function create(kind: SmartNodeKind): void {
    const id = addNode(kind, { x: m.flowX, y: m.flowY });
    if (m.anchorId) {
      // up=新节点作上游连入锚点；down=锚点连出到新节点（多输出口节点保留拖出的具体口）
      if (m.dir === 'up') onConnect({ source: id, target: m.anchorId, sourceHandle: 'out', targetHandle: 'in' });
      else onConnect({ source: m.anchorId, target: id, sourceHandle: m.anchorHandle ?? 'out', targetHandle: 'in' });
    }
    close();
  }

  // 从输入/输出口拖出：按方向只列合法的上游/下游类型
  const map = m.dir === 'up' ? UPSTREAM : DOWNSTREAM;
  const allowed = m.anchorId && anchorKind ? new Set(map[anchorKind as SmartNodeKind]) : null;
  const items = ITEMS.filter(([k]) => !allowed || allowed.has(k));
  if (m.anchorId && items.length === 0) return null;

  // 开菜单的同一手势（拖出松手 / 双击）尾随的合成 click 可能立刻命中背板 → 250ms 内忽略
  const guardedClose = (): void => {
    if (m.openedAt && Date.now() - m.openedAt < 250) return;
    close();
  };

  // 注意：必须 portal 到 body —— 父级 .mb-sc-root 是 framer-motion 元素带 transform，
  // 会让 position:fixed 相对它定位（而非视口），导致菜单偏到画布外「看不见 = 没效果」。
  return createPortal(
    <>
      <div
        className="mb-sc-menu-backdrop"
        onClick={guardedClose}
        onContextMenu={(e) => {
          e.preventDefault();
          guardedClose();
        }}
      />
      {/* position/zIndex 必须内联：.mb-card{position:relative} 在 bundle 里晚于
          .mb-sc-create-menu{position:fixed} 且同特异性 → 会把菜单顶成 relative 飞到 body 末尾屏幕外。
          内联样式优先级高于任何 class 规则，确保菜单固定在光标处。 */}
      <div
        className="mb-sc-create-menu mb-card"
        // 夹住到视口内，避免贴右/下边缘时菜单出屏、项点不到
        style={{
          position: 'fixed',
          zIndex: 60,
          left: Math.max(8, Math.min(m.screenX, window.innerWidth - 220)),
          top: Math.max(8, Math.min(m.screenY, window.innerHeight - 360))
        }}
      >
        <div className="mb-sc-create-menu-head">
          {m.anchorId ? (m.dir === 'up' ? '创建上游节点' : '创建下游节点') : '在此创建'}
        </div>
        {items.map(([k, l]) => {
          const Ico = NODE_ICONS[k];
          return (
            <button key={k} className="mb-sc-create-menu-item" onClick={() => create(k)}>
              <Ico size={16} />
              {l}
            </button>
          );
        })}
      </div>
    </>,
    document.body
  );
}
