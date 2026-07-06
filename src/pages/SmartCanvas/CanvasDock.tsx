import { useSmartCanvasStore, useSmartCanvasUiStore, useSmartKeybindStore } from '@/store/smartCanvasStore';
import type { SmartNodeKind } from '@shared/smartCanvas';
import { NODE_ICONS, CursorIcon } from './icons';
import { prettyCombo } from '@/lib/keyCombo';

/** 创建工具坞分组（按用途分段，段间用分隔线）：
 *  输入素材 / 分析改写 / 预处理 / 生成 / 汇总 / 容器。
 *  约定：图片与视频上传同段（素材来源）；图像反推、视频反推与 LLM 同段（接素材出文本）。 */
const GROUPS: Array<Array<[SmartNodeKind, string]>> = [
  // 输入素材：图片 / 文件夹输入 / 视频上传（媒体来源）+ 提示词 / 文字（文本来源）
  [
    ['image', '图片'],
    ['folder-input', '文件夹输入'],
    ['video-source', '视频上传'],
    ['prompt', '提示词'],
    ['text', '文字']
  ],
  // 分析改写（接素材 → 出文本）：LLM + 提示词商城 + 智能分镜 + 图像反推 / 视频反推 + 视角 / 光源
  [
    ['llm', 'LLM'],
    ['prompt-mall', '提示词商城'],
    ['storyboard', '分镜'],
    ['image-reverse', '图像反推'],
    ['video-reverse', '视频反推'],
    ['segment', '切分工具'],
    ['proof', '对稿'],
    ['angle-prompt', '镜头'],
    ['light', '光源'],
    ['palette', '配色']
  ],
  // 预处理 / 控制
  [
    ['scale', '缩放'],
    ['upscale', '保真放大'],
    ['vectorize', '图像转矢量'],
    ['frame-interp', '插帧'],
    ['video-clip', '视频剪辑'],
    ['ratio', '尺寸'],
    ['loop', '循环']
  ],
  // 生成
  [
    ['work', '生图'],
    ['comfy', 'ComfyUI'],
    ['video', '视频']
  ],
  // 汇总输出
  [
    ['result', '结果'],
    ['folder-output', '文件夹输出'],
    ['compare', '对比']
  ],
  // 容器
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
  const bindings = useSmartKeybindStore((s) => s.bindings);
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
            // 该类型若有绑定快捷键（add-<kind>），在 tooltip 末尾提示
            const combo = bindings[`add-${k}`];
            const kb = combo ? ` · ${prettyCombo(combo)}` : '';
            return (
              <button
                key={k}
                className={`mb-sc-dock-btn ${active ? 'is-active' : ''}`}
                title={
                  k === 'group'
                    ? `选中多个节点后点此＝把它们成组；未选则点画布落位一个空分组${kb}`
                    : `添加「${label}」节点 · 点画布落位（Esc 取消）${kb}`
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
