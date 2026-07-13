/**
 * 节点内文本/图片区域的通用交互：右上角复制按钮 + 右键菜单 + 文字自适应高度。
 */
import { useEffect, useRef, type RefObject } from 'react';
import { openContextMenu, type ContextMenuEntry } from '@/components/ContextMenu';
import { toast } from '@/store/toastStore';
import { useSmartCanvasStore, useSmartPreviewStore } from '@/store/smartCanvasStore';
import { localPathToImageUrl } from '@/lib/imageUrl';
import { CopyIcon, ToPromptIcon } from './icons';
// 通用媒体操作抽到 src/lib/mediaActions.ts（与统一预览 Lightbox 共用），此处 re-export 保持既有调用点不变
import { toDataUri, copyText, copyImage, imageSaveAs, showInFolder, imageAsCreateRef } from '@/lib/mediaActions';
export { toDataUri, copyText, copyImage, imageSaveAs, showInFolder, imageAsCreateRef };

/** 把一张图（节点里的结果/图片）写入资产库。 */
export async function imageToGallery(src: string): Promise<void> {
  const du = await toDataUri(src);
  if (!du) {
    toast.error('读取图片失败');
    return;
  }
  const r = await window.electronAPI.gallery.importFromBuffer({ dataUri: du, kind: 'imported', notes: '智能画布' });
  if (r.ok) toast.success('已入资产库');
  else toast.error(r.error.message, r.error.hint);
}

/** 把运行耗时（ms）格式化成「用时 X.Xs / X分X秒」，空值返回空串。 */
export function fmtDur(ms?: number): string {
  if (ms == null || !Number.isFinite(ms)) return '';
  if (ms >= 60000) return `用时 ${Math.floor(ms / 60000)}分${Math.round((ms % 60000) / 1000)}秒`;
  return `用时 ${(ms / 1000).toFixed(1)}s`;
}

/** 导出一段文本到磁盘（运行日志导出用）：转 data:URI → 走「另存为」对话框写盘。 */
export async function exportTextFile(defaultName: string, text: string): Promise<void> {
  const dataUri = `data:text/plain;charset=utf-8;base64,${btoa(unescape(encodeURIComponent(text)))}`;
  const r = await window.electronAPI.storage.saveAs({ dataUri, defaultName });
  if (r.ok && r.data) toast.success('已导出日志', r.data.filePath);
  else if (!r.ok) toast.error(r.error.message, r.error.hint);
}

/**
 * 用一段文字在源节点右侧新建一个「提示词节点」并选中（文本输出节点—— LLM / 视角 / ComfyUI / 结果——
 * 把输出文本直接导入下游提示词节点）。返回新节点 id；文本为空则提示并返回 null。
 */
export function makePromptNodeFrom(sourceId: string, text: string): string | null {
  const t = (text ?? '').trim();
  if (!t) {
    toast.error('没有可用的文本输出');
    return null;
  }
  const st = useSmartCanvasStore.getState();
  const self = st.nodes.find((n) => n.id === sourceId);
  const pos = self ? { x: self.position.x + (self.width ?? 260) + 60, y: self.position.y } : undefined;
  const nid = st.addNode('prompt', pos);
  st.updateNodeData(nid, { text: t });
  toast.success('已生成提示词节点');
  return nid;
}

/**
 * 把一段文字存入「提示词库」（prompts 表，复用 api:prompt:upsert）。
 * 标题取首行（截断 30 字）；空内容提示并返回。给提示词节点的「选中入库 / 整段入库」右键用。
 */
export async function savePromptToLibrary(text: string): Promise<void> {
  const body = (text ?? '').trim();
  if (!body) {
    toast.error('没有可入库的内容');
    return;
  }
  const firstLine = (body.split('\n')[0] || body).trim();
  const title = firstLine.length > 30 ? `${firstLine.slice(0, 30)}…` : firstLine;
  const r = await window.electronAPI.prompt.upsert({ title, text: body, kind: 'image' });
  if (r.ok) toast.success('已存入提示词库');
  else toast.error(r.error.message, r.error.hint);
}

/**
 * 原生 OS 拖拽出应用：把节点里的图 / 视频直接拖进资源管理器、PS、聊天软件等。
 * 本地文件直接拖原文件（原尺寸原比例）；dataURI 由主进程先落临时文件再拖。
 * 必须在 dragstart 同步路径里调用（drag.ts 约定）；e.preventDefault() 把 HTML5 拖拽
 * 让位给 webContents.startDrag。拖回本画布会走画布的「文件拖入」路径自动建图片节点。
 */
export function dragOutNative(e: React.DragEvent, src: string, suggestedName?: string): void {
  e.preventDefault();
  e.stopPropagation();
  if (src.startsWith('data:')) window.electronAPI.drag.startFromDataUri(src, suggestedName);
  else window.electronAPI.drag.startFromPath(src);
}

/**
 * 弹窗背板「点空白处关闭」的安全实现（修「弹窗里框选文字、鼠标拖到背板外松手 → 误关闭」）。
 * 原因：当 mousedown 落在内容上、mouseup 落在背板上时，合成的 click 事件 target = 背板，
 * 于是 `onClick={close}` 被触发 → 弹窗被框选动作误关。
 * 修法：只有当 **pointerdown 与 click 都直接发生在背板自身** 时才关闭——选区拖拽起点在内容上，
 * downOnSelf=false，故不会误关。用 ref 跨重渲染保持按下目标。
 * 用法：const backdrop = useBackdropClose(close); <div className="mb-modal-backdrop" {...backdrop}>…</div>
 */
export function useBackdropClose(onClose: () => void): {
  onMouseDown: (e: React.MouseEvent) => void;
  onClick: (e: React.MouseEvent) => void;
} {
  const downOnSelf = useRef(false);
  return {
    onMouseDown: (e) => {
      downOnSelf.current = e.target === e.currentTarget;
    },
    onClick: (e) => {
      if (downOnSelf.current && e.target === e.currentTarget) onClose();
      downOnSelf.current = false;
    }
  };
}

/** 在光标处弹出区域右键菜单。 */
export function areaMenu(e: React.MouseEvent, items: ContextMenuEntry[]): void {
  e.preventDefault();
  e.stopPropagation();
  openContextMenu({ x: e.clientX, y: e.clientY, items });
}

/**
 * 统一视频放大播放：把一组视频（本地路径 / URL）丢进全局 Lightbox（type='video'，
 * 自动获得 播放控制 + ←→ 切换 + 右键 另存/打开目录）。所有画布视频节点共用此入口（铁律 18）。
 */
export function openVideoPreview(paths: string[], index = 0): void {
  // 幂等：已是可直接 fetch 的 URL（mengbi-image:// / blob: / http(s) / data:）不再二次编码——
  // 否则把已转换的 mengbi-image:// 当原始路径再 base64 一遍会得到畸形 URL（协议 404）。
  // 各调用点本应只传原始本地路径，但这里兜底使其对「误传已编码 URL」也安全（meta.filePath 仅对真实磁盘路径给值）。
  const isFetchable = (src: string): boolean => /^(mengbi-image|blob|https?|data):/i.test(src);
  const items = paths
    .filter(Boolean)
    .map((p) => ({
      src: isFetchable(p) ? p : localPathToImageUrl(p),
      type: 'video' as const,
      meta: { filePath: isFetchable(p) ? '' : p }
    }));
  if (!items.length) {
    toast.error('没有可预览的视频');
    return;
  }
  useSmartPreviewStore.getState().open(items, Math.max(0, Math.min(index, items.length - 1)));
}

/** 把节点高度自适应到内容（文字溢出时触发）。contentEl 为可滚动的文本元素。 */
export function fitNodeHeight(id: string, contentEl: HTMLElement | null): void {
  if (!contentEl) return;
  const h = Math.ceil(contentEl.scrollHeight) + 72; // 标题栏 + 内边距 + 手柄余量
  useSmartCanvasStore.getState().setNodeSize(id, { height: Math.max(140, h) });
}

/** 粗略估算一段文本在给定节点宽度下占用的高度（px），用于节点自适应增高。 */
export function estimateTextHeight(text: string, width: number, linePx = 18): number {
  if (!text) return 0;
  const perLine = Math.max(6, Math.floor((width - 30) / 8)); // ~8px/字符（中英混排取中）
  let lines = 0;
  for (const ln of text.split('\n')) lines += Math.max(1, Math.ceil(ln.length / perLine));
  return lines * linePx;
}

/** 节点是否被用户手动调整过尺寸（手动 > 自适应：true 时一切自适应让位）。 */
export function isManualSize(id: string): boolean {
  const n = useSmartCanvasStore.getState().nodes.find((x) => x.id === id);
  return !!(n?.data as { manualSize?: boolean } | undefined)?.manualSize;
}

/**
 * 自适应贴合内容高度（**双向**：内容变多变高、变少变矮；封顶 maxH；不进撤销栈）。
 * 手动调整过尺寸（manualSize）的节点一律跳过——优先级：手动 > 自适应。
 */
export function autoGrowNode(id: string, needed: number, maxH = 1600): void {
  const st = useSmartCanvasStore.getState();
  const n = st.nodes.find((x) => x.id === id);
  if (!n) return;
  if ((n.data as { manualSize?: boolean } | undefined)?.manualSize) return;
  const cur = typeof n.height === 'number' ? n.height : n.measured?.height ?? 0;
  const target = Math.max(60, Math.min(maxH, Math.ceil(needed)));
  if (Math.abs(target - cur) > 6) st.setNodeSize(id, { height: target });
}

/** 读节点当前宽度（非响应式，在 effect 内即时取）。
 *  不放进 effect 依赖：拖角/横向缩放会同时改 width，若依赖 width 会触发自适应把高度顶回去、互相打架。 */
export function getNodeWidth(id: string): number {
  const n = useSmartCanvasStore.getState().nodes.find((x) => x.id === id);
  return typeof n?.width === 'number' ? n.width : n?.measured?.width ?? 250;
}

/**
 * 用 ResizeObserver 把节点高度持续贴合内容（**双向**自适应，含标题栏/内边距/手柄余量；不进撤销栈）。
 * `ref` 指向一个「自然高度」的内容包裹层（建议 flex:0 0 auto）——其 scrollHeight 即所需内容高。
 * 适合预览区会随图片比例/节点宽度变化的节点（视角/光源）：拖宽→预览变高→节点跟随长高/收矮。
 * 无循环风险：设节点框高不改变包裹层的自然高度（包裹层不被拉伸）。
 * maxH 封顶：超出时节点不再长高，包裹层用 `.mb-sc-fitwrap`（max-height:100% + overflow:auto）内部滚动。
 * 这是所有「表单/配置类节点」的标准自适应姿势——**绝不要再用 autoGrowNode(id, 拍脑袋常数)**：
 * 估算高度与真实内容脱节是「节点内容互相叠压/显示不全」的历史根因（2026-07-11 分镜节点事故）。
 */
export function useFitNodeToContent(id: string, ref: RefObject<HTMLElement>, chrome = 52, maxH = 1600): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const apply = (): void => {
      const st = useSmartCanvasStore.getState();
      const n = st.nodes.find((x) => x.id === id);
      if (!n) return;
      if ((n.data as { manualSize?: boolean } | undefined)?.manualSize) return; // 手动 > 自适应
      const need = Math.min(maxH, Math.ceil(el.scrollHeight) + chrome);
      const cur = typeof n.height === 'number' ? n.height : n.measured?.height ?? 0;
      if (Math.abs(need - cur) > 6) st.setNodeSize(id, { height: need });
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [id, ref, chrome, maxH]);
}

/**
 * 视频节点悬停自动预览：鼠标移入静音从头播放，移出暂停并回到首帧。
 * 返回挂到 <video> 上的 props（与 controls 共存：悬停自动播放，仍可点 controls 手动控制）。
 * 用法：<video {...hoverPreviewProps()} ... />
 */
export function hoverPreviewProps(): {
  onMouseEnter: (e: React.MouseEvent<HTMLVideoElement>) => void;
  onMouseLeave: (e: React.MouseEvent<HTMLVideoElement>) => void;
} {
  return {
    onMouseEnter: (e) => {
      const v = e.currentTarget;
      v.muted = true; // 自动播放策略要求静音
      const p = v.play();
      if (p && typeof p.catch === 'function') p.catch(() => undefined);
    },
    onMouseLeave: (e) => {
      const v = e.currentTarget;
      try {
        v.pause();
        v.currentTime = 0;
      } catch {
        /* ignore */
      }
    }
  };
}

/** 区域右上角的小复制按钮。 */
export function CopyButton({ onClick, title = '复制' }: { onClick: () => void; title?: string }): JSX.Element {
  return (
    <button
      className="mb-sc-copy nodrag"
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <CopyIcon size={13} />
    </button>
  );
}

/** 小「ⓘ」悬停提示：把占位的说明文字收成一个图标，鼠标放上去才显示（铁律：非必要备注不占版面）。 */
export function NodeHint({ text, className }: { text: string; className?: string }): JSX.Element {
  return (
    <span className={`mb-sc-hint-i nodrag ${className ?? ''}`} title={text} aria-label={text}>
      ⓘ
    </span>
  );
}

/** 「→ 提示词节点」按钮：图标 + 文字（比纯文字好看），把文本输出建成下游提示词节点。 */
export function ToPromptButton({
  onClick,
  title = '用输出建一个下游提示词节点',
  label = '提示词节点'
}: {
  onClick: () => void;
  title?: string;
  label?: string;
}): JSX.Element {
  return (
    <button
      className="mb-sc-toprompt nodrag"
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <ToPromptIcon size={13} />
      <span>{label}</span>
    </button>
  );
}
