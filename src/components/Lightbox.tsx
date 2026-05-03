import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { XIcon } from './Icon';
import './Lightbox.css';

interface LightboxProps {
  open: boolean;
  src: string;
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
 * 全屏图片预览（lightbox）：
 *   - 整屏黑色不透明遮罩，把后面 UI 全挡掉
 *   - 滚轮缩放（以鼠标位置为中心）
 *   - 鼠标按下拖动平移
 *   - 双击重置 1×
 *   - Esc / 点空白 / 右上角 X 关闭
 */
export function Lightbox({ open, src, alt, onClose }: LightboxProps): JSX.Element {
  const [t, setT] = useState<Transform>({ scale: 1, x: 0, y: 0 });
  const draggingRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(
    null
  );
  const stageRef = useRef<HTMLDivElement>(null);

  // 每次打开重置位置
  useEffect(() => {
    if (open) setT({ scale: 1, x: 0, y: 0 });
  }, [open, src]);

  // Esc 关闭
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  function onWheel(e: React.WheelEvent<HTMLDivElement>): void {
    e.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const cx = e.clientX - rect.left - rect.width / 2;
    const cy = e.clientY - rect.top - rect.height / 2;
    const factor = Math.exp(-e.deltaY * WHEEL_FACTOR);
    setT((cur) => {
      const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, cur.scale * factor));
      const ratio = next / cur.scale;
      // 围绕鼠标位置缩放：保持鼠标指向的图像点不动
      const nx = (cur.x - cx) * ratio + cx;
      const ny = (cur.y - cy) * ratio + cy;
      return { scale: next, x: nx, y: ny };
    });
  }

  function onMouseDown(e: React.MouseEvent<HTMLDivElement>): void {
    if (e.button !== 0) return;
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
    setT((cur) => ({
      ...cur,
      x: d.baseX + (e.clientX - d.startX),
      y: d.baseY + (e.clientY - d.startY)
    }));
  }
  function endDrag(): void {
    draggingRef.current = null;
  }
  function onDoubleClick(): void {
    setT({ scale: 1, x: 0, y: 0 });
  }
  function onBackdropClick(e: React.MouseEvent<HTMLDivElement>): void {
    // 只有点到背景本身才算"点击空白"，点到图片不触发
    if (e.target === e.currentTarget) onClose();
  }

  return (
    <AnimatePresence>
      {open && (
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

          <img
            className="mb-lightbox-img"
            src={src}
            alt={alt}
            draggable={false}
            onClick={(e) => e.stopPropagation()}
            style={{
              transform: `translate(${t.x}px, ${t.y}px) scale(${t.scale})`,
              cursor: draggingRef.current ? 'grabbing' : 'grab'
            }}
          />

          <div className="mb-lightbox-hint" onClick={(e) => e.stopPropagation()}>
            滚轮缩放 · 拖动平移 · 双击复位 · Esc 关闭
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
