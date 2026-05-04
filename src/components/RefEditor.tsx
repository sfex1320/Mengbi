import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { XIcon, CheckIcon, TrashIcon } from './Icon';
import { confirmDialog } from './ConfirmDialog';
import './RefEditor.css';

interface RefEditorProps {
  open: boolean;
  /** 待编辑的原图 dataUri */
  srcDataUri: string;
  onClose: () => void;
  /** 保存——回传一份带涂鸦的 PNG dataUri */
  onSave: (newDataUri: string) => void;
}

type Tool = 'brush' | 'eraser';

const PRESET_COLORS = ['#ff5252', '#ffb800', '#ffd700', '#10b981', '#3b82f6', '#a855f7', '#ffffff', '#000000'];
const MIN_SCALE = 0.2;
const MAX_SCALE = 8;
const WHEEL_FACTOR = 0.0015;

interface Stroke {
  tool: Tool;
  color: string;
  size: number;
  points: Array<{ x: number; y: number }>;
}

/**
 * 参考图编辑器 — 全屏 lightbox 风格 + 画笔 / 橡皮 + 缩放 / 平移 + 保存。
 *
 * 设计：
 *   - 原图在底层（绘 source），笔触在叠加 canvas 上
 *   - 拿到原图自然 W×H 决定 canvas 内分辨率，保证保存还原原始像素
 *   - 缩放/平移仅影响"舞台" transform，不影响绘制坐标计算
 *   - 鼠标事件按舞台逆变换映射回 canvas 坐标
 */
export function RefEditor({ open, srcDataUri, onClose, onSave }: RefEditorProps): JSX.Element {
  const baseRef = useRef<HTMLImageElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const [imgSize, setImgSize] = useState<{ w: number; h: number }>({ w: 1024, h: 1024 });
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);

  const [tool, setTool] = useState<Tool>('brush');
  const [color, setColor] = useState('#ff5252');
  const [size, setSize] = useState(12);

  // 光标位置（用于绘制画笔大小指示圈，stage 内绝对坐标，已经是变换后的屏幕系）
  const [cursor, setCursor] = useState<{ x: number; y: number; visible: boolean }>({
    x: 0,
    y: 0,
    visible: false
  });

  // 绘画状态：用 ref 而不是 state，避免高频触发 re-render
  const drawingRef = useRef<{ active: boolean; current: Stroke | null }>({
    active: false,
    current: null
  });
  const strokesRef = useRef<Stroke[]>([]);
  const draggingRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(
    null
  );

  // 打开时重置
  useEffect(() => {
    if (!open) return;
    setScale(1);
    setTx(0);
    setTy(0);
    strokesRef.current = [];
    drawingRef.current = { active: false, current: null };
    // 清空 overlay
    requestAnimationFrame(() => {
      const c = overlayRef.current;
      if (c) c.getContext('2d')?.clearRect(0, 0, c.width, c.height);
    });
  }, [open, srcDataUri]);

  // ESC 关闭
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
      if ((e.key === 'b' || e.key === 'B') && !drawingRef.current.active) setTool('brush');
      if ((e.key === 'e' || e.key === 'E') && !drawingRef.current.active) setTool('eraser');
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  function onImgLoad(): void {
    const im = baseRef.current;
    if (!im) return;
    const w = im.naturalWidth;
    const h = im.naturalHeight;
    setImgSize({ w, h });
    const c = overlayRef.current;
    if (c) {
      c.width = w;
      c.height = h;
      c.getContext('2d')?.clearRect(0, 0, w, h);
    }
  }

  /** 把屏幕坐标映射回 canvas 内坐标（考虑 stage transform） */
  function screenToCanvas(clientX: number, clientY: number): { x: number; y: number } {
    const c = overlayRef.current;
    if (!c) return { x: 0, y: 0 };
    const rect = c.getBoundingClientRect();
    // canvas 显示尺寸 = 自然尺寸 * scale，但通过 transform 应用
    // rect 已经是变换后的位置 + 尺寸，所以做线性映射即可
    const x = ((clientX - rect.left) / rect.width) * c.width;
    const y = ((clientY - rect.top) / rect.height) * c.height;
    return { x, y };
  }

  function redraw(): void {
    const c = overlayRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    for (const s of strokesRef.current) {
      drawStroke(ctx, s);
    }
    if (drawingRef.current.current) {
      drawStroke(ctx, drawingRef.current.current);
    }
  }

  function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke): void {
    if (s.points.length === 0) return;
    ctx.save();
    if (s.tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = '#000';
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = s.color;
    }
    ctx.lineWidth = s.size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(s.points[0].x, s.points[0].y);
    for (let i = 1; i < s.points.length; i++) {
      ctx.lineTo(s.points[i].x, s.points[i].y);
    }
    ctx.stroke();
    ctx.restore();
  }

  function onWheel(e: React.WheelEvent): void {
    e.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const cx = e.clientX - rect.left - rect.width / 2;
    const cy = e.clientY - rect.top - rect.height / 2;
    const factor = Math.exp(-e.deltaY * WHEEL_FACTOR);
    const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale * factor));
    const ratio = next / scale;
    setTx((v) => (v - cx) * ratio + cx);
    setTy((v) => (v - cy) * ratio + cy);
    setScale(next);
  }

  function onMouseDown(e: React.MouseEvent): void {
    // 中键 / 空格状态拖动；左键画
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      draggingRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        baseX: tx,
        baseY: ty
      };
      return;
    }
    if (e.button !== 0) return;
    const { x, y } = screenToCanvas(e.clientX, e.clientY);
    drawingRef.current = {
      active: true,
      current: { tool, color, size, points: [{ x, y }] }
    };
    redraw();
  }

  function onMouseMove(e: React.MouseEvent): void {
    // 更新画笔大小指示圈位置（用 stage 容器内的相对坐标，方便定位）
    const stage = stageRef.current;
    if (stage) {
      const r = stage.getBoundingClientRect();
      setCursor({ x: e.clientX - r.left, y: e.clientY - r.top, visible: true });
    }
    if (draggingRef.current) {
      setTx(draggingRef.current.baseX + (e.clientX - draggingRef.current.startX));
      setTy(draggingRef.current.baseY + (e.clientY - draggingRef.current.startY));
      return;
    }
    if (!drawingRef.current.active || !drawingRef.current.current) return;
    const { x, y } = screenToCanvas(e.clientX, e.clientY);
    drawingRef.current.current.points.push({ x, y });
    redraw();
  }

  function onMouseEnter(): void {
    setCursor((c) => ({ ...c, visible: true }));
  }

  function onMouseLeaveStage(): void {
    setCursor((c) => ({ ...c, visible: false }));
    endDraw();
  }

  function endDraw(): void {
    if (draggingRef.current) {
      draggingRef.current = null;
      return;
    }
    if (drawingRef.current.active && drawingRef.current.current) {
      strokesRef.current.push(drawingRef.current.current);
      drawingRef.current = { active: false, current: null };
      redraw();
    }
  }

  async function clearAll(): Promise<void> {
    if (strokesRef.current.length === 0) return;
    const ok = await confirmDialog({
      title: '清空涂鸦',
      message: '清空当前所有涂鸦？',
      okText: '清空',
      danger: true
    });
    if (!ok) return;
    strokesRef.current = [];
    redraw();
  }

  function undo(): void {
    if (strokesRef.current.length === 0) return;
    strokesRef.current.pop();
    redraw();
  }

  /** 把原图 + 涂鸦合并成 PNG dataUri 回写 */
  async function save(): Promise<void> {
    const im = baseRef.current;
    const overlay = overlayRef.current;
    if (!im || !overlay) return;
    const merged = document.createElement('canvas');
    merged.width = imgSize.w;
    merged.height = imgSize.h;
    const ctx = merged.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(im, 0, 0, imgSize.w, imgSize.h);
    ctx.drawImage(overlay, 0, 0);
    const out = merged.toDataURL('image/png');
    onSave(out);
  }

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="mb-refedit"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          <div
            ref={stageRef}
            className="mb-refedit-stage"
            onWheel={onWheel}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseEnter={onMouseEnter}
            onMouseUp={endDraw}
            onMouseLeave={onMouseLeaveStage}
          >
            <div
              className="mb-refedit-canvas-wrap"
              style={{
                transform: `translate(${tx}px, ${ty}px) scale(${scale})`
              }}
            >
              <img
                ref={baseRef}
                className="mb-refedit-base"
                src={srcDataUri}
                alt=""
                onLoad={onImgLoad}
                draggable={false}
              />
              <canvas
                ref={overlayRef}
                className="mb-refedit-overlay"
                width={imgSize.w}
                height={imgSize.h}
              />
            </div>
            {/* 笔刷大小指示圈：跟随鼠标，直径 = size * scale（屏幕像素） */}
            {cursor.visible && (
              <div
                className={`mb-refedit-cursor ${tool === 'eraser' ? 'is-eraser' : ''}`}
                style={{
                  left: cursor.x,
                  top: cursor.y,
                  width: Math.max(4, size * scale),
                  height: Math.max(4, size * scale),
                  borderColor: tool === 'brush' ? color : 'rgba(255,255,255,0.85)'
                }}
              />
            )}
          </div>

          {/* 顶栏 */}
          <div className="mb-refedit-topbar">
            <div className="mb-refedit-tools">
              <button
                type="button"
                className={`mb-refedit-tool ${tool === 'brush' ? 'is-active' : ''}`}
                onClick={() => setTool('brush')}
                title="画笔 (B)"
              >
                ✎ 画笔
              </button>
              <button
                type="button"
                className={`mb-refedit-tool ${tool === 'eraser' ? 'is-active' : ''}`}
                onClick={() => setTool('eraser')}
                title="橡皮擦 (E)"
              >
                ⌫ 橡皮
              </button>
            </div>
            <div className="mb-refedit-colors">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`mb-refedit-color ${color === c ? 'is-active' : ''}`}
                  style={{ background: c }}
                  onClick={() => {
                    setColor(c);
                    setTool('brush');
                  }}
                  title={c}
                />
              ))}
              <input
                type="color"
                className="mb-refedit-color-input"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                title="自定义颜色"
              />
            </div>
            <div className="mb-refedit-size">
              <label>笔粗</label>
              <input
                type="range"
                min={1}
                max={80}
                value={size}
                onChange={(e) => setSize(Number(e.target.value))}
              />
              <span className="mb-refedit-size-num">{size}px</span>
            </div>
            <div className="mb-refedit-actions">
              <button type="button" className="mb-refedit-btn" onClick={undo}>
                撤销
              </button>
              <button type="button" className="mb-refedit-btn mb-refedit-btn-danger" onClick={clearAll}>
                <TrashIcon size={11} /> 清空
              </button>
              <button type="button" className="mb-refedit-btn mb-refedit-btn-primary" onClick={save}>
                <CheckIcon size={12} /> 保存
              </button>
              <button
                type="button"
                className="mb-refedit-btn mb-refedit-btn-x"
                onClick={onClose}
                title="不保存退出"
              >
                <XIcon size={12} />
              </button>
            </div>
          </div>

          <div className="mb-refedit-hint">
            滚轮缩放 · Alt+左键 拖动平移 · 左键涂抹 · B 画笔 · E 橡皮 · Esc 退出
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
