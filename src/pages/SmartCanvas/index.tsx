import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { ReactFlowProvider, useReactFlow } from '@xyflow/react';
import { useSmartCanvasStore, useSmartPreviewStore, useSmartTextStore } from '@/store/smartCanvasStore';
import { useSmartDocsStore } from '@/store/smartDocsStore';
import { useSmartInboxStore } from '@/store/smartInboxStore';
import { toast } from '@/store/toastStore';
import { migrateLegacyIfNeeded } from '@/lib/smartDocStorage';
import { Lightbox } from '@/components/Lightbox';
import { CanvasToolbar } from './CanvasToolbar';
import { CanvasWorkspace } from './CanvasWorkspace';
import { CanvasLauncher } from './CanvasLauncher';
import { SmartTextViewer } from './SmartTextViewer';
import { GalleryPickerDialog, useGalleryPickerStore } from './GalleryPickerDialog';
import { PromptPickerDialog, usePromptPickerStore } from './PromptPickerDialog';
import { SmartGalleryPanel, useSmartGalleryPanelStore } from './SmartGalleryPanel';
import { AgentPanel, useAgentPanelStore } from './AgentPanel';
import { ImageEditorModal, useImageEditorStore } from './ImageEditorModal';
import { PromptMallStudio, usePromptMallStudioStore } from './PromptMallStudio';
import { StoryboardStudio, useStoryboardStudioStore } from './StoryboardStudio';
import { VideoClipStudio, useVideoClipStudioStore } from './VideoClipStudio';
import { SegmentStudio, useSegmentStudioStore } from './SegmentStudio';
import { ProofStudio, useProofStudioStore } from './ProofStudio';
import './SmartCanvas.css';

/**
 * 收件箱桥（必须在 ReactFlowProvider 内，才能用 useReactFlow 取「当前视图中心」）：
 * 别的模块「发送到智能画布」过来的内容 → 落在当前视图正中心（避免被丢在远处找不到）。
 * 没打开画布时先建一张「导入素材」再落（等 ReactFlow 挂载后两帧再取中心）。
 */
function SmartInboxBridge(): null {
  const inboxItems = useSmartInboxStore((s) => s.items);
  const { screenToFlowPosition } = useReactFlow();
  useEffect(() => {
    if (!inboxItems.length) return;
    const items = useSmartInboxStore.getState().consume();
    if (!items.length) return;
    const ds = useSmartDocsStore.getState();
    let createdNew = false;
    if (!ds.activeDocId) {
      const docId = ds.createDoc('导入素材');
      useSmartCanvasStore.getState().reset();
      ds.setActive(docId);
      createdNew = true;
    }
    const place = (): void => {
      // 当前视图正中心（flow 坐标）：取 ReactFlow 容器中心屏幕坐标 → screenToFlowPosition
      const el = document.querySelector('.mb-sc-root .react-flow') as HTMLElement | null;
      let center = { x: 200, y: 160 };
      if (el) {
        const r = el.getBoundingClientRect();
        center = screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
      }
      const store = useSmartCanvasStore.getState();
      items.forEach((it, i) => {
        // 在中心附近轻微错开，避免多项完全重叠
        const pos = { x: center.x - 120 + (i % 4) * 64, y: center.y - 90 + Math.floor(i / 4) * 64 };
        if (it.kind === 'prompt') {
          const id = store.addNode('prompt', pos);
          store.updateNodeData(id, { text: it.text ?? '' });
        } else if (it.src) {
          const id = store.addNode('image', pos);
          store.updateNodeData(id, { src: it.src, name: it.name ?? '导入图' });
        }
      });
      const imgN = items.filter((it) => it.kind !== 'prompt' && it.src).length;
      const promptN = items.filter((it) => it.kind === 'prompt').length;
      const parts: string[] = [];
      if (imgN) parts.push(`${imgN} 张图`);
      if (promptN) parts.push(`${promptN} 条提示词`);
      toast.success(`已导入 ${parts.join(' + ') || `${items.length} 项`}到智能画布`);
    };
    // 新建画布后等 ReactFlow 挂载完成（两帧）再取中心；已有画布直接落
    if (createdNew) requestAnimationFrame(() => requestAnimationFrame(place));
    else place();
  }, [inboxItems, screenToFlowPosition]);
  return null;
}

/** 智能画布（AI 创作节点画布）：进入先到「选择画布」启动页，打开某画布后进入工作区。 */
export default function SmartCanvasPage(): JSX.Element {
  const activeDocId = useSmartDocsStore((s) => s.activeDocId);
  const previewItems = useSmartPreviewStore((s) => s.items);
  const previewIndex = useSmartPreviewStore((s) => s.index);
  const closePreview = useSmartPreviewStore((s) => s.close);

  // 旧单文档一次性迁移成卡片。注意：不再在进入时 setActive(null) ——
  // 切到别的功能再回来要停在当前画布（activeDocId 内存态保留，重启才归 null 回启动页）。
  useEffect(() => {
    migrateLegacyIfNeeded();
  }, []);

  // 离开智能画布时复位所有弹窗 / 浮层单例（它们是模块级 store，open 态会跨路由残留）：
  // 防止残留的弹窗 / 遮罩 portal 跨页面盖住别的功能页、阻断交互（白屏式「所有功能无法使用」的常见成因）。
  useEffect(() => {
    return () => {
      usePromptPickerStore.getState().close();
      useGalleryPickerStore.getState().close();
      useSmartGalleryPanelStore.getState().close();
      useAgentPanelStore.getState().close();
      useImageEditorStore.getState().close();
      usePromptMallStudioStore.getState().close();
      useStoryboardStudioStore.getState().close();
      useVideoClipStudioStore.getState().close();
      useSegmentStudioStore.getState().close();
      useProofStudioStore.getState().close();
      useSmartPreviewStore.getState().close();
      useSmartTextStore.getState().close();
    };
  }, []);

  // 任务推送监听（image:done / comfyui:run-done / video:* / chat:* / 资产库删除同步）
  // 已上移到 App 级全局注册（registerSmartRunnerListeners）——切页任务不丢路由，本页只展示状态。

  return (
    <ReactFlowProvider>
      <SmartInboxBridge />
      <motion.div
        className="mb-sc-root"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.2 }}
      >
        {activeDocId == null ? (
          <CanvasLauncher />
        ) : (
          <>
            <CanvasToolbar />
            <CanvasWorkspace key={activeDocId} docId={activeDocId} />
          </>
        )}
      </motion.div>
      <Lightbox open={previewItems.length > 0} items={previewItems} index={previewIndex} onClose={closePreview} />
      <SmartTextViewer />
      <GalleryPickerDialog />
      <PromptPickerDialog />
      {/* 提示词商城 / 分镜 工作台弹窗（节点卡精简，进一步设置在弹窗里；portal 到 body） */}
      <PromptMallStudio />
      <StoryboardStudio />
      <VideoClipStudio />
      {/* 切分 / 对稿 工作台弹窗（视觉元素分析 + 框编辑；portal 到 body） */}
      <SegmentStudio />
      <ProofStudio />
      {/* 便携资产库（非模态中心悬浮窗）：portal 到 body，躲开路由级 transform */}
      <SmartGalleryPanel />
      {/* AI 智能体（一句话 → 自动建图 / 生成）：portal 到 body */}
      <AgentPanel />
      {/* 图片节点就地编辑器（扩图 / 画笔 / 裁切 / 蒙版 / 调色）：portal 到 body */}
      <ImageEditorModal />
    </ReactFlowProvider>
  );
}
