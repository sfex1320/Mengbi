import { useEffect } from 'react';
import { useSmartCanvasStore, useSmartCanvasUiStore } from '@/store/smartCanvasStore';
import { useSmartDocsStore } from '@/store/smartDocsStore';
import { writeDocContent, externalizeImageNodes } from '@/lib/smartDocStorage';
import { resyncRunningNodesFromPending } from '@/lib/smartCanvasRunner';
import { CanvasViewport } from './CanvasViewport';
import { CanvasDock } from './CanvasDock';
import { NodeInspector } from './NodeInspector';
import { NodeWorkConsole } from './nodePanel/NodeWorkConsole';
import { NodeVideoConsole } from './nodePanel/NodeVideoConsole';
import { NodeCameraConsole } from './nodePanel/NodeCameraConsole';
import { NodeLightConsole } from './nodePanel/NodeLightConsole';

/** 这些节点的全部内容直接在节点卡上调（预览 / 拖拽 / 卡内编辑），不弹属性面板。
 *  提示词/图片=卡内直接编辑文本 / 上传图；分组=卡内改分组名；
 *  结果=纯展示（图/文本/视频 + 拖出 + 右键都在卡上，弹窗作用不大反而干扰）。
 *  注意：镜头(angle-prompt) 用 NodeCameraConsole 弹窗、光源(light) 用 NodeLightConsole 弹窗（卡片只放基础调整）。 */
const ON_NODE_TYPES = new Set(['palette', 'prompt', 'image', 'group', 'compare', 'image-reverse', 'video-source', 'video-reverse', 'frame-interp', 'video-clip', 'ratio', 'result', 'storyboard', 'prompt-mall', 'loop', 'upscale', 'vectorize', 'folder-input', 'folder-output', 'segment', 'proof']);

/** 点在这些元素上视为「操作卡上控件」：选中节点但不弹属性面板（设定已完成，弹窗只会拖慢+干扰）。 */
const CONTROL_SELECTOR = 'button, select, input, textarea, a, video, img, [role="slider"], .mb-np-seg, .mb-sc-runbtn';

/** 每类节点的「能做什么」说明（备注左段）。 */
const NODE_OPS: Record<string, string> = {
  image: '上传 / 拖入 / 粘贴图，或从资产库选图 · 右键入资产库 / 另存 · 连到 生成 / 分组 节点',
  prompt: '输入提示词文本 · 连到 生成 / LLM 节点作为提示词来源',
  llm: '节点模式：优化 / 翻译 / 扩写 / 反推 · 聊天模式：流式对话 · 文本输出喂下游',
  'angle-prompt': '镜头节点：选中弹出控制台 → 拍照(相机/光圈/视角)或视频(运镜/焦距/构图) + 实时 3D 示意图 → 输出镜头提示词喂下游',
  light: '光源节点：卡上在图片上拖光点摆位 + 强度/色温（基础）；选中弹出控制台调 光位/光源类型/遮挡/光效（高级）→ 输出光照提示词喂下游',
  palette: '接图提取 N 个主色（HEX/RGB/CMYK/HSL/HSB 可复制）或 基准色推导 互补/对比/邻近 方案 · 导出 .ase/.aco 进 PS/AI · 输出配色提示词喂下游',
  scale: '接入图片 → 按 倍数/最长边/最短边/宽高/像素/精确 缩放预处理（非高清化）→ 输出新图喂下游',
  ratio: '尺寸来源：选预设/填自定义宽高 → 输出 比例+宽高 喂 生图/ComfyUI/视频 驱动其尺寸；可选接图分析其比例',
  text: '画布自由文字（标题 / 备注）· 双击编辑 · 右侧调字体 / 字号 / 颜色 / 对齐',
  work: '选模型 / 类型 / seed → 运行 · 提示词从上游连入 · 输出连到「结果」节点',
  comfy: '选工作流模板 → 调参数 · 上游图片 / 提示词喂入输入槽 → 运行',
  video: '选视频模型 + 模式/时长/画幅 · 上游提示词→描述、上游图→图生视频首帧 · 异步生成后卡上播放（自动入资产库）',
  result: '统一集合：累积 图 / 文本 / 视频（重启清空）· 每项可拖出成节点 · 带输出口可继续连下游 · 入资产库 / 另存',
  group: '拖节点进框自动归组（智能扩容）· ▾ 折叠 · 整组连到 生成 节点一起喂入',
  compare: '接两张图（A=上游第1张 / B=第2张）· 拖分隔线 wipe 对比 · 往左/右半区拖图替换 · 双击放大',
  'image-reverse': '接入图片 → 选视觉模型 + 描述/标签/风格 → 反推出文本，喂下游（提示词 / 生图）',
  'video-source': '上传本地视频 / 填 URL → 卡上播放 → 输出视频给下游（视频反推 / 缩放 / 结果）',
  'video-reverse': '接入视频 → 自动抽帧 → 视觉模型反推出「画面 + 运动」文本，喂下游',
  'frame-interp': '接入视频 → 本地 RIFE AI 运动插帧（24fps→60fps）→ 输出更流畅的视频喂下游（首次用需装引擎约 40MB）',
  'video-clip': '时间轴剪辑（剪映/PR 式）：多段拼接/排序/裁切 + 转场 + 每段音频/变速 + 整体调色 + 文字 · 双击进剪辑工作台 · 本地 ffmpeg 合成',
  storyboard: '故事 → 电影级分镜提示词 + 镜头转场提示词 · 右上口=分镜 / 右下口=转场 · 约束/列表在「分镜工作台」弹窗',
  'prompt-mall': '逛店选购式提示词构建：左分类 / 中缩略图卡片墙 / 右购物车 · 拖卡进车自动排布 → 合成一条提示词喂下游 · 设置都在「提示词商城」弹窗 · 中/英输出可切',
  loop: '固定次数 / 数值范围 / 提示词列表 / 尺寸列表 / 文件夹图片 → 逐项驱动下游 生图/ComfyUI/视频 · 可暂停/跳过/续跑',
  upscale: '接入图片 → 本地 Real-ESRGAN 保真放大 2/3/4×（不烧中转站）→ 输出放大图喂下游（首次用需装引擎）',
  vectorize: '接入图片 → 本地 VTracer（彩色）/ Potrace（单色）转 SVG · 输出连「结果 / 文件夹输出」查看·另存',
  'folder-input': '选输入文件夹 → 扫描全部图片作多图来源 · 配合 ComfyUI「逐张图执行」做文件夹批处理',
  'folder-output': '选输出文件夹 → 上游每出一张结果自动落盘（命名规则可选）· 失败记日志不中断生成',
  segment: '切分工具：接整图 → 打开工作台 自动识别元素框（可拖拽调整位置/大小）→ 逐元素反推 + 统一风格 → 逐元素重绘 → 按原位 1:1 拼回整图喂下游',
  proof: '对稿：接海报/设计图 → 多模态模型逐元素检错（字体/元素/Logo/形态）→ 工作台叠框 + 问题清单 + 审稿报告（喂下游）+ 可导出标注图'
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
  const selectedCount = useSmartCanvasStore((s) => s.nodes.reduce((a, n) => a + (n.selected ? 1 : 0), 0));
  const boxSelecting = useSmartCanvasUiStore((s) => s.boxSelecting);
  const panelSuppressed = useSmartCanvasUiStore((s) => s.panelSuppressed);
  const onNode = selType ? ON_NODE_TYPES.has(selType) : false;
  // 框选进行中 / 选中多个节点 / 本次选中来自点击卡上控件（运行等）时，不弹单节点属性面板。
  const showPanel = !boxSelecting && selectedCount === 1 && !panelSuppressed;

  // 捕获阶段记下「这次按下是点在节点的控件上，还是节点卡空白处」：
  // 控件（运行按钮 / 下拉 / 输入框 / 缩略图…）→ 压制面板；卡空白处 → 解除压制（正常弹出）。
  // pointerdown 先于 React Flow 的选中变化，所以面板渲染条件读到的总是本次手势的意图。
  function onCanvasPointerDownCapture(e: React.PointerEvent): void {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    const nodeEl = target.closest('.react-flow__node');
    if (!nodeEl) return; // 点空白/面板自身不改变压制态（面板内操作不应让面板消失）
    const isControl = !!target.closest(CONTROL_SELECTOR);
    const cur = useSmartCanvasUiStore.getState().panelSuppressed;
    if (cur !== isControl) useSmartCanvasUiStore.getState().setPanelSuppressed(isControl);
  }

  // 切页/切档重挂时对账：把仍有在途任务（pending Map 里）的节点状态拉回 running，
  // 修「从资产库回来后节点显示待运行、后台却还在跑」（详见 resyncRunningNodesFromPending）。
  // 放在挂载后下一帧，确保此时缓冲区已是目标文档内容。
  useEffect(() => {
    const id = requestAnimationFrame(() => resyncRunningNodesFromPending());
    return () => cancelAnimationFrame(id);
  }, [docId]);

  // 自动保存：订阅画布变化 → 500ms 去抖写回本文档（去抖即避免拖动每帧 stringify 大图）。
  // 切换/卸载前再立即落一次盘，防丢最近 500ms 的改动。
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const writeNow = (): void => {
      const cur = useSmartCanvasStore.getState();
      writeDocContent(docId, cur.nodes, cur.edges, cur.viewport);
      useSmartDocsStore.getState().touch(docId, cur.nodes.length);
    };
    // 去抖落盘：先把 image 节点的大 base64 外置成磁盘路径（防撑爆 localStorage 配额丢改动），再写盘。
    const debouncedSave = async (): Promise<void> => {
      await externalizeImageNodes();
      writeNow();
    };
    const unsub = useSmartCanvasStore.subscribe(() => {
      if (t) clearTimeout(t);
      t = setTimeout(() => void debouncedSave(), 500);
    });
    return () => {
      if (t) clearTimeout(t);
      // 仅当本文档仍是当前文档时才落盘：切标签 / 关标签时缓冲区已被换成目标文档内容，
      // 此时若再 save 会把目标内容错写进本文档（switchDoc/closeDocTab 已先行落盘本文档）。
      // 卸载用同步 writeNow（多数图已被去抖外置为路径；不 await 避免阻塞卸载）。
      if (useSmartDocsStore.getState().activeDocId === docId) writeNow();
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
      <div className="mb-sc-canvas" onPointerDownCapture={onCanvasPointerDownCapture}>
        <CanvasViewport />
        <CanvasDock />
        <div className="mb-sc-help">
          <span className="mb-sc-help-left">{left}</span>
          <span className="mb-sc-help-right">{HELP_KEYS}</span>
        </div>
        {/* 弹窗式属性面板：生成 / 视频节点 → 横向控制台；其它节点 → 浮动检查器。视角/光源在节点上直接调，不弹。
            仅在「恰好选中 1 个节点且非框选中」时弹，避免 Ctrl 框选时面板乱蹦遮挡。 */}
        {showPanel && selType === 'work' && <NodeWorkConsole />}
        {showPanel && selType === 'video' && <NodeVideoConsole />}
        {showPanel && selType === 'angle-prompt' && <NodeCameraConsole />}
        {showPanel && selType === 'light' && <NodeLightConsole />}
        {showPanel &&
          selType &&
          selType !== 'work' &&
          selType !== 'video' &&
          selType !== 'angle-prompt' &&
          selType !== 'light' &&
          !onNode && <NodeInspector float />}
      </div>
    </div>
  );
}
