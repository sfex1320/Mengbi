import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { XIcon } from './Icon';
import { openContextMenu, type ContextMenuItem, type ContextMenuEntry } from './ContextMenu';
import {
  copyText,
  copyImage,
  imageSaveAs,
  showInFolder,
  imageAsCreateRef,
  imageToSmartCanvas,
  buildShortcutSendMenuItems
} from '@/lib/mediaActions';
import './Lightbox.css';

/**
 * 统一预览项（全应用放大预览的标准数据结构）：
 * 所有具备放大预览能力的内容（资产库 / 生图结果 / 智能画布 / ComfyUI 输出 / 视频封面…）
 * 一律组装成 PreviewItem 列表传入 Lightbox —— 自动获得 上一张/下一张 + 键盘 + 右键菜单。
 */
export interface PreviewItem {
  src: string;
  /** 资源类型；默认 image。video 用 <video controls> 展示（不参与缩放/平移） */
  type?: 'image' | 'video';
  alt?: string;
  /** 资源元信息：有什么就给什么，右键菜单按可用性出对应项 */
  meta?: {
    /** 提示词（出「复制提示词」项） */
    prompt?: string;
    /** 本地文件路径（出「打开文件所在目录 / 复制路径」项） */
    filePath?: string;
    /** 生成模型（信息展示用） */
    modelId?: string;
    createdAt?: number;
  };
  /** 调用方追加的菜单项（如资产库的「删除」「查看信息」），排在默认项之后 */
  extraMenu?: ContextMenuItem[];
}

interface LightboxProps {
  open: boolean;
  /** 新 API：预览列表 + 起始下标（自动获得左右切换） */
  items?: PreviewItem[];
  index?: number;
  onIndexChange?: (i: number) => void;
  /** 旧 API（兼容）：单张 src；与 items 二选一 */
  src?: string;
  alt?: string;
  onClose: () => void;
}

interface Transform {
  scale: number;
  x: number;
  y: number;
}

const MIN_SCALE = 0.2;
const MAX_SCALE = 8;
const WHEEL_FACTOR = 0.0015;

/**
 * 全屏统一预览（lightbox）：
 *   - 整屏黑色不透明遮罩；滚轮缩放（鼠标为中心）+ 拖动平移 + 双击复位
 *   - 多张时左右箭头 / 键盘 ←→ 切换（边界禁用不循环，切换重置缩放）+ N/total 计数
 *   - 右键菜单（按资源 meta 出操作：复制 / 另存 / 打开位置 / 复制提示词 / 发送到生图、智能画布…）
 *   - 视频项用 <video controls> 播放
 *   - Esc / 点空白 / 右上角 X 关闭
 */
export function Lightbox({ open, items, index, onIndexChange, src, alt, onClose }: LightboxProps): JSX.Element {
  const [t, setT] = useState<Transform>({ scale: 1, x: 0, y: 0 });
  const [idx, setIdx] = useState(0);
  const draggingRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(
    null
  );
  const stageRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  // 归一：items 优先；旧单 src 包装成单元素列表
  const list: PreviewItem[] = items && items.length ? items : src ? [{ src, alt }] : [];
  const total = list.length;
  const cur = list[Math.min(idx, total - 1)] ?? null;
  const isVideo = cur?.type === 'video';

  // 打开 / 外部 index 变化时同步内部下标 + 重置缩放
  useEffect(() => {
    if (open) {
      setIdx(Math.max(0, Math.min(index ?? 0, Math.max(0, (items?.length ?? 1) - 1))));
      setT({ scale: 1, x: 0, y: 0 });
    }
  }, [open, index, items, src]);

  // 切换/打开时主动 decode 当前图片，确保首帧就是「完整解码」的位图（避免首次放大用到半解码的低清帧）
  useEffect(() => {
    if (!open || isVideo) return;
    const el = imgRef.current;
    if (el && typeof el.decode === 'function') void el.decode().catch(() => undefined);
  }, [open, isVideo, cur?.src]);

  const goTo = useCallback(
    (next: number) => {
      if (next < 0 || next >= total) return;
      setIdx(next);
      setT({ scale: 1, x: 0, y: 0 });
      onIndexChange?.(next);
    },
    [total, onIndexChange]
  );

  // 键盘：Esc 关闭 / ←→ 切换（仅预览态生效，不影响其它页面操作）
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        e.stopPropagation();
        goTo(idx - 1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        e.stopPropagation();
        goTo(idx + 1);
      }
    }
    // capture：优先于页面其它快捷键（如画布的方向键微调），预览态独占方向键
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose, goTo, idx]);

  function onWheel(e: React.WheelEvent<HTMLDivElement>): void {
    if (isVideo) return;
    e.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const cx = e.clientX - rect.left - rect.width / 2;
    const cy = e.clientY - rect.top - rect.height / 2;
    const factor = Math.exp(-e.deltaY * WHEEL_FACTOR);
    setT((curT) => {
      const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, curT.scale * factor));
      const ratio = next / curT.scale;
      // 围绕鼠标位置缩放：保持鼠标指向的图像点不动
      const nx = (curT.x - cx) * ratio + cx;
      const ny = (curT.y - cy) * ratio + cy;
      return { scale: next, x: nx, y: ny };
    });
  }

  function onMouseDown(e: React.MouseEvent<HTMLDivElement>): void {
    if (e.button !== 0 || isVideo) return;
    draggingRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      baseX: t.x,
      baseY: t.y
    };
  }
  function onMouseMove(e: React.MouseEvent<HTMLDivElement>): void {
    const d = draggingRef.current;
    if (!d) return;
    setT((curT) => ({
      ...curT,
      x: d.baseX + (e.clientX - d.startX),
      y: d.baseY + (e.clientY - d.startY)
    }));
  }
  function endDrag(): void {
    draggingRef.current = null;
  }
  function onDoubleClick(): void {
    if (!isVideo) setT({ scale: 1, x: 0, y: 0 });
  }
  function onBackdropClick(e: React.MouseEvent<HTMLDivElement>): void {
    // 只有点到背景本身才算"点击空白"，点到图片/视频不触发
    if (e.target === e.currentTarget) onClose();
  }

  /** 统一右键菜单：按当前项的 meta 出操作 + 调用方注入项。 */
  function onMediaContextMenu(e: React.MouseEvent): void {
    if (!cur) return;
    e.preventDefault();
    e.stopPropagation();
    const m = cur.meta;
    const menu: ContextMenuEntry[] = [];
    if (!isVideo) {
      menu.push({ label: '复制图片', onClick: () => void copyImage(cur.src) });
      menu.push({ label: '另存…', onClick: () => void imageSaveAs(m?.filePath ?? cur.src, `preview-${Date.now()}.png`) });
    }
    if (m?.filePath) {
      menu.push({ label: '打开文件所在目录', onClick: () => void showInFolder(m.filePath as string) });
      menu.push({ label: '复制文件路径', onClick: () => copyText(m.filePath as string) });
    }
    if (m?.prompt) {
      menu.push({ separator: true });
      menu.push({ label: '复制提示词', onClick: () => copyText(m.prompt as string) });
    }
    if (!isVideo) {
      menu.push({ separator: true });
      menu.push({ label: '作参考图（发到生图页）', onClick: () => void imageAsCreateRef(m?.filePath ?? cur.src) });
      menu.push({ label: '发送到智能画布', onClick: () => void imageToSmartCanvas(m?.filePath ?? cur.src) });
    }
    const sendSrc = m?.filePath ?? cur.src;
    menu.push(
      ...buildShortcutSendMenuItems(isVideo ? { kind: 'video', src: sendSrc } : { kind: 'image', src: sendSrc })
    );
    if (cur.extraMenu?.length) {
      menu.push({ separator: true });
      menu.push(...cur.extraMenu);
    }
    if (m?.modelId || m?.createdAt) {
      menu.push({ separator: true });
      const info = [m.modelId, m.createdAt ? new Date(m.createdAt).toLocaleString() : '']
        .filter(Boolean)
        .join(' · ');
      menu.push({ label: `信息：${info}`, disabled: true, onClick: () => undefined });
    }
    openContextMenu({ x: e.clientX, y: e.clientY, items: menu });
  }

  // 用 portal 挂到 body，免得被 mb-card / mb-marquee-glow 这些有 isolation 的祖先困住
  return createPortal(
    <AnimatePresence>
      {open && cur && (
        <motion.div
          ref={stageRef}
          className="mb-lightbox"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onWheel={onWheel}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={endDrag}
          onMouseLeave={endDrag}
          onClick={onBackdropClick}
          onDoubleClick={onDoubleClick}
        >
          <button
            className="mb-lightbox-close"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            title="关闭预览 (Esc)"
            aria-label="关闭预览"
          >
            <XIcon size={14} />
          </button>

          {total > 1 && (
            <>
              <button
                className="mb-lightbox-nav is-prev"
                disabled={idx <= 0}
                onClick={(e) => {
                  e.stopPropagation();
                  goTo(idx - 1);
                }}
                title="上一张 (←)"
                aria-label="上一张"
              >
                ‹
              </button>
              <button
                className="mb-lightbox-nav is-next"
                disabled={idx >= total - 1}
                onClick={(e) => {
                  e.stopPropagation();
                  goTo(idx + 1);
                }}
                title="下一张 (→)"
                aria-label="下一张"
              >
                ›
              </button>
              <div className="mb-lightbox-count" onClick={(e) => e.stopPropagation()}>
                {idx + 1} / {total}
              </div>
            </>
          )}

          {isVideo ? (
            <video
              key={cur.src}
              className="mb-lightbox-video"
              src={cur.src}
              controls
              autoPlay
              loop
              preload="metadata"
              onClick={(e) => e.stopPropagation()}
              onContextMenu={onMediaContextMenu}
            />
          ) : (
            <img
              key={cur.src}
              ref={imgRef}
              className="mb-lightbox-img"
              src={cur.src}
              alt={cur.alt ?? alt}
              draggable={false}
              decoding="async"
              loading="eager"
              onClick={(e) => e.stopPropagation()}
              onContextMenu={onMediaContextMenu}
              style={{
                // 2D transform（非 translate3d）—— 不强制 3D 合成层，缩放时 Chromium 重新栅格化，保证清晰
                transform: `translate(${t.x}px, ${t.y}px) scale(${t.scale})`,
                cursor: draggingRef.current ? 'grabbing' : 'grab'
              }}
            />
          )}

          <div className="mb-lightbox-hint" onClick={(e) => e.stopPropagation()}>
            {total > 1 ? '← → 切换 · ' : ''}
            {isVideo ? '' : '滚轮缩放 · 拖动平移 · 双击复位 · '}右键菜单 · Esc 关闭
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
