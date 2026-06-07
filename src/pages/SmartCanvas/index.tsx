import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { ReactFlowProvider, useReactFlow } from '@xyflow/react';
import { useSmartCanvasStore, useSmartPreviewStore } from '@/store/smartCanvasStore';
import { useSmartDocsStore } from '@/store/smartDocsStore';
import { useSmartInboxStore } from '@/store/smartInboxStore';
import { toast } from '@/store/toastStore';
import { migrateLegacyIfNeeded } from '@/lib/smartDocStorage';
import { routeImageDone, routeComfyDone, routeChatChunk, routeChatDone, routeVideoDone, routeVideoProgress, pruneDeletedImages } from '@/lib/smartCanvasRunner';
import { useDeletedMediaStore } from '@/store/deletedMediaStore';
import { Lightbox } from '@/components/Lightbox';
import { CanvasToolbar } from './CanvasToolbar';
import { CanvasWorkspace } from './CanvasWorkspace';
import { CanvasLauncher } from './CanvasLauncher';
import { SmartTextViewer } from './SmartTextViewer';
import { GalleryPickerDialog } from './GalleryPickerDialog';
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
  const previewSrc = useSmartPreviewStore((s) => s.src);
  const closePreview = useSmartPreviewStore((s) => s.close);

  // 旧单文档一次性迁移成卡片。注意：不再在进入时 setActive(null) ——
  // 切到别的功能再回来要停在当前画布（activeDocId 内存态保留，重启才归 null 回启动页）。
  useEffect(() => {
    migrateLegacyIfNeeded();
  }, []);

  // 工作节点的真实生成走 api:image:generate，结果经 image:done 路由回对应节点
  useEffect(() => {
    const off = window.electronAPI.on('image:done', (payload) => routeImageDone(payload));
    return off;
  }, []);

  // ComfyUI 节点的运行结果经 comfyui:run-done 路由回对应节点
  useEffect(() => {
    const off = window.electronAPI.on('comfyui:run-done', (payload) => routeComfyDone(payload));
    return off;
  }, []);

  // 视频节点：异步生成进度 / 完成 经 video:progress / video:done 路由回对应节点
  useEffect(() => {
    const offProg = window.electronAPI.on('video:progress', (payload) => routeVideoProgress(payload));
    const offDone = window.electronAPI.on('video:done', (payload) => routeVideoDone(payload));
    return () => {
      offProg();
      offDone();
    };
  }, []);

  // LLM 节点流式聊天：chat:chunk / chat:done 路由回对应节点
  useEffect(() => {
    const offChunk = window.electronAPI.on('chat:chunk', (payload) => routeChatChunk(payload));
    const offDone = window.electronAPI.on('chat:done', (payload) => routeChatDone(payload));
    return () => {
      offChunk();
      offDone();
    };
  }, []);

  // 图库删除某些图 → 从智能画布的结果预览里同步剔除（跨功能同步，渲染端总线）
  useEffect(() => {
    return useDeletedMediaStore.subscribe((s, prev) => {
      if (s.seq !== prev.seq) pruneDeletedImages(s.lastDeleted);
    });
  }, []);

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
      <Lightbox open={!!previewSrc} src={previewSrc ?? ''} onClose={closePreview} />
      <SmartTextViewer />
      <GalleryPickerDialog />
    </ReactFlowProvider>
  );
}
