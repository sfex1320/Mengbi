import { useEffect } from 'react';
import { useSmartCanvasStore } from '@/store/smartCanvasStore';
import { useSmartDocsStore } from '@/store/smartDocsStore';
import { writeDocContent } from '@/lib/smartDocStorage';
import { CanvasViewport } from './CanvasViewport';
import { CanvasDock } from './CanvasDock';
import { NodeInspector } from './NodeInspector';
import { NodeWorkConsole } from './nodePanel/NodeWorkConsole';

/** 这些节点的全部内容直接在节点卡上调（预览 / 拖拽 / 卡内编辑），不弹属性面板。
 *  视角/光源=节点上拖光点调参；提示词/图片=卡内直接编辑文本 / 上传图；分组=卡内改分组名（弹窗没有更多可调项）。 */
const ON_NODE_TYPES = new Set(['angle-prompt', 'light', 'prompt', 'image', 'group', 'compare', 'video']);

/** 每类节点的「能做什么」说明（备注左段）。 */
const NODE_OPS: Record<string, string> = {
  image: '上传 / 拖入 / 粘贴图，或从图库选图 · 右键入图库 / 另存 · 连到 生成 / 分组 节点',
  prompt: '输入提示词文本 · 连到 生成 / LLM 节点作为提示词来源',
  llm: '节点模式：优化 / 翻译 / 扩写 / 反推 · 聊天模式：流式对话 · 文本输出喂下游',
  'angle-prompt': '接入图片 → 3D 预览 + 三向角度 → 实时生成「改视角」提示词，文本输出喂下游',
  light: '接入图片 → 圆顶拖光点调光照方位/高度 + 强度/色温/遮挡/光效 → 输出光照提示词喂下游',
  scale: '接入图片 → 按 倍数/最长边/最短边/宽高/像素/精确 缩放预处理（非高清化）→ 输出新图喂下游',
  ratio: '接入图片 → 显示最接近的常用比例 + 各档（1K/2K/4K）实际分辨率（纯参考）',
  text: '画布自由文字（标题 / 备注）· 双击编辑 · 右侧调字体 / 字号 / 颜色 / 对齐',
  work: '选模型 / 类型 / seed → 运行 · 提示词从上游连入 · 输出连到「结果」节点',
  comfy: '选工作流模板 → 调参数 · 上游图片 / 提示词喂入输入槽 → 运行',
  video: '选视频模型 + 模式/时长/画幅 · 上游提示词→描述、上游图→图生视频首帧 · 异步生成后卡上播放（自动入图库）',
  result: '统一集合：累积 图 / 文本 / 视频（重启清空）· 每项可拖出成节点 · 带输出口可继续连下游 · 入图库 / 另存',
  group: '拖节点进框自动归组（智能扩容）· ▾ 折叠 · 整组连到 生成 节点一起喂入',
  compare: '接两张图（A=上游第1张 / B=第2张）· 拖分隔线 wipe 对比 · 往左/右半区拖图替换 · 双击放大'
};
const HELP_KEYS = 'Ctrl+Z 撤销 · Ctrl+C/V 复制粘贴 · Ctrl+D 再制 · Ctrl+F 搜索 · Del 删除';

/**
 * 单个文档的工作区（画布 + 检查器）。由 index.tsx 用 `key={docId}` 挂载 ——
 * 切换文档即 remount，CanvasViewport 重新读 store 里已载入的 viewport/nodes。
 * 文档内容载入在 openDoc/newCanvas（启动页）里同步完成；这里只负责自动保存。
 */
export function CanvasWorkspace({ docId }: { docId: string }): JSX.Element {
  const empty = useSmartCanvasStore((s) => s.nodes.length === 0);
  const selType = useSmartCanvasStore((s) => s.nodes.find((n) => n.selected)?.type);
  const onNode = selType ? ON_NODE_TYPES.has(selType) : false;

  // 自动保存：订阅画布变化 → 500ms 去抖写回本文档（去抖即避免拖动每帧 stringify 大图）。
  // 切换/卸载前再立即落一次盘，防丢最近 500ms 的改动。
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const save = (): void => {
      const cur = useSmartCanvasStore.getState();
      writeDocContent(docId, cur.nodes, cur.edges, cur.viewport);
      useSmartDocsStore.getState().touch(docId, cur.nodes.length);
    };
    const unsub = useSmartCanvasStore.subscribe(() => {
      if (t) clearTimeout(t);
      t = setTimeout(save, 500);
    });
    return () => {
      if (t) clearTimeout(t);
      // 仅当本文档仍是当前文档时才落盘：切标签 / 关标签时缓冲区已被换成目标文档内容，
      // 此时若再 save 会把目标内容错写进本文档（switchDoc/closeDocTab 已先行落盘本文档）。
      if (useSmartDocsStore.getState().activeDocId === docId) save();
      unsub();
    };
  }, [docId]);

  // 备注：选中节点时左段显示该节点能做什么、右段显示快捷键；未选中显示通用操作。
  const ops = selType ? NODE_OPS[selType] : undefined;
  const left = ops
    ? ops
    : empty
      ? '空画布：工具栏点选类型 → 点画布落位；双击空白快捷创建；拖图片 / 文字进来自动建节点'
      : '点选类型→落位 · 双击/拖出快捷创建 · Ctrl 框选 / Shift 加减选 · 选多个右键「群组」(Ctrl+G) · 连线中点 × 删除 · 拖角调大小';

  return (
    <div className="mb-sc-main">
      <div className="mb-sc-canvas">
        <CanvasViewport />
        <CanvasDock />
        <div className="mb-sc-help">
          <span className="mb-sc-help-left">{left}</span>
          <span className="mb-sc-help-right">{HELP_KEYS}</span>
        </div>
        {/* 弹窗式属性面板：生成节点 → 横向控制台；其它节点 → 浮动检查器。视角/光源在节点上直接调，不弹。 */}
        {selType === 'work' && <NodeWorkConsole />}
        {selType && selType !== 'work' && !onNode && <NodeInspector float />}
      </div>
    </div>
  );
}
