import { createPortal } from 'react-dom';
import { useSmartCanvasStore, useSmartCanvasUiStore } from '@/store/smartCanvasStore';
import type { SmartNodeKind } from '@shared/smartCanvas';
import { NODE_ICONS } from './icons';

const ITEMS: Array<[SmartNodeKind, string]> = [
  ['image', '图片'],
  ['prompt', '提示词'],
  ['llm', 'LLM'],
  ['angle-prompt', '视角'],
  ['light', '光源'],
  ['scale', '缩放'],
  ['ratio', '尺寸分析'],
  ['work', '生成'],
  ['comfy', 'ComfyUI'],
  ['video', '视频'],
  ['result', '结果'],
  ['compare', '对比'],
  ['group', '分组']
];

/** 从「输出口」拖出 → 能接到哪些下游节点（图片/提示词无输入口，不作目标；结果/缩放可作来源继续往下连）。 */
const DOWNSTREAM: Record<SmartNodeKind, SmartNodeKind[]> = {
  image: ['work', 'comfy', 'video', 'llm', 'group', 'angle-prompt', 'light', 'scale', 'ratio', 'result', 'compare'],
  prompt: ['work', 'comfy', 'video', 'llm', 'group', 'result'],
  llm: ['work', 'comfy', 'video', 'llm', 'group', 'result'],
  'angle-prompt': ['work', 'comfy', 'video', 'llm', 'group', 'result'],
  light: ['work', 'comfy', 'video', 'llm', 'group', 'result'],
  work: ['result', 'work', 'comfy', 'video', 'llm', 'angle-prompt', 'light', 'scale', 'ratio', 'compare'],
  comfy: ['result', 'work', 'comfy', 'video', 'llm', 'angle-prompt', 'light', 'scale', 'ratio', 'compare'],
  group: ['work', 'comfy', 'video', 'llm', 'angle-prompt', 'light', 'scale', 'ratio', 'result', 'compare'],
  result: ['work', 'comfy', 'video', 'llm', 'group', 'angle-prompt', 'light', 'scale', 'ratio', 'compare'],
  scale: ['work', 'comfy', 'video', 'llm', 'group', 'angle-prompt', 'light', 'scale', 'ratio', 'result', 'compare'],
  ratio: [],
  text: [],
  compare: [],
  video: ['result']
};

/** 从「输入口」拖出 → 能建哪些上游节点（谁能喂进本节点；结果只接 生成/ComfyUI/LLM；视角/光源/缩放/比例只接图片来源）。 */
const UPSTREAM: Record<SmartNodeKind, SmartNodeKind[]> = {
  work: ['image', 'prompt', 'llm', 'angle-prompt', 'light', 'work', 'comfy', 'group', 'result', 'scale'],
  comfy: ['image', 'prompt', 'llm', 'angle-prompt', 'light', 'work', 'comfy', 'group', 'result', 'scale'],
  llm: ['image', 'prompt', 'llm', 'angle-prompt', 'light', 'work', 'comfy', 'group', 'result', 'scale'],
  group: ['image', 'prompt', 'llm', 'angle-prompt', 'light', 'work', 'comfy', 'group', 'result', 'scale'],
  'angle-prompt': ['image', 'group', 'work', 'comfy', 'result', 'scale'],
  light: ['image', 'group', 'work', 'comfy', 'result', 'scale'],
  scale: ['image', 'group', 'work', 'comfy', 'result', 'scale'],
  ratio: ['image', 'group', 'work', 'comfy', 'result', 'scale'],
  result: ['work', 'comfy', 'llm', 'group', 'prompt', 'image', 'angle-prompt', 'light', 'scale', 'video'],
  compare: ['image', 'group', 'work', 'comfy', 'result', 'scale'],
  video: ['image', 'prompt', 'llm', 'angle-prompt', 'light', 'work', 'comfy', 'group', 'result', 'scale'],
  image: [],
  prompt: [],
  text: []
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
      // up=新节点作上游连入锚点；down=锚点连出到新节点
      if (m.dir === 'up') onConnect({ source: id, target: m.anchorId, sourceHandle: 'out', targetHandle: 'in' });
      else onConnect({ source: m.anchorId, target: id, sourceHandle: 'out', targetHandle: 'in' });
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
