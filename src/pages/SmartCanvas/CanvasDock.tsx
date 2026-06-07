import { useSmartCanvasStore, useSmartCanvasUiStore } from '@/store/smartCanvasStore';
import type { SmartNodeKind } from '@shared/smartCanvas';
import { NODE_ICONS, CursorIcon } from './icons';

/** 创建工具坞分组（按用途分段，段间用分隔线）：输入 / 预处理 / 生成 / 输出 / 容器。 */
const GROUPS: Array<Array<[SmartNodeKind, string]>> = [
  [
    ['image', '图片'],
    ['prompt', '提示词'],
    ['text', '文字'],
    ['llm', 'LLM'],
    ['angle-prompt', '视角'],
    ['light', '光源']
  ],
  [
    ['scale', '缩放'],
    ['ratio', '尺寸']
  ],
  [
    ['work', '生成'],
    ['comfy', 'ComfyUI'],
    ['video', '视频']
  ],
  [
    ['result', '结果'],
    ['compare', '对比']
  ],
  [['group', '分组']]
];

/**
 * 底部中央「创建工具坞」（仿无限画布工作台）：左首是「选择」默认态，其后按用途分组的节点创建工具。
 * 点工具 → 武装该类型（高亮）→ 点画布落位；再点同一个或「选择」取消武装。图标统一、悬停出名。
 */
export function CanvasDock(): JSX.Element {
  const pendingKind = useSmartCanvasUiStore((s) => s.pendingKind);
  const setPendingKind = useSmartCanvasUiStore((s) => s.setPendingKind);
  const groupSelection = useSmartCanvasStore((s) => s.groupSelection);
  // 可被群组的选中节点数（顶层、非分组）——≥2 时「分组」按钮直接把它们成组
  const groupableCount = useSmartCanvasStore(
    (s) => s.nodes.filter((n) => n.selected && n.type !== 'group' && !n.parentId).length
  );

  return (
    <div className="mb-sc-dock mb-card">
      <button
        className={`mb-sc-dock-btn ${pendingKind === null ? 'is-active' : ''}`}
        title="选择 / 移动（取消放置）"
        onClick={() => setPendingKind(null)}
      >
        <CursorIcon size={20} />
        <span className="mb-sc-dock-label">选择</span>
      </button>
      {GROUPS.map((group, gi) => (
        <div className="mb-sc-dock-group" key={gi}>
          <span className="mb-sc-dock-sep" aria-hidden />
          {group.map(([k, label]) => {
            const Ico = NODE_ICONS[k];
            const active = pendingKind === k;
            // 「分组」：选中 ≥2 个节点时点它＝直接把选中的成组；否则照旧（武装放置一个空分组）
            const isGroupAction = k === 'group' && groupableCount >= 2;
            return (
              <button
                key={k}
                className={`mb-sc-dock-btn ${active ? 'is-active' : ''}`}
                title={
                  k === 'group'
                    ? '选中多个节点后点此＝把它们成组；未选则点画布落位一个空分组'
                    : `添加「${label}」节点 · 点画布落位（Esc 取消）`
                }
                onClick={() => {
                  if (isGroupAction) {
                    groupSelection();
                    return;
                  }
                  setPendingKind(active ? null : k);
                }}
              >
                <Ico size={20} />
                <span className="mb-sc-dock-label">{label}</span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
