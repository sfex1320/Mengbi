/**
 * ImageCompareViewer —— 通用对比预览组件。
 *
 * 功能:
 *   - 3 种模式:wipe(滑条对比,默认) / before(只看原图) / after(只看结果)
 *   - 缩放:滚轮中心缩 / +/- 按钮 / 1× / 适合屏幕
 *   - 拖动:鼠标拖 pan
 *   - 滑条对比:中间拖手柄左右切原图 / 结果
 *
 * 不依赖外部库,纯 React + CSS transform。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { PlusIcon, XIcon, ChevronRightIcon } from '@/components/Icon';

type Mode = 'wipe' | 'before' | 'after';

interface Props {
  beforeUrl: string;
  afterUrl: string;
  /** 用于显示元数据 */
  beforeLabel?: string;
  afterLabel?: string;
}

export function ImageCompareViewer({
  beforeUrl,
  afterUrl,
  beforeLabel = '原图',
  afterLabel = '结果'
}: Props): JSX.Element {
  const stageRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<Mode>('wipe');
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [wipe, setWipe] = useState(0.5);
  const [dragging, setDragging] = useState<null | 'pan' | 'wipe'>(null);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0, ox: 0, oy: 0 });

  // 图片自然尺寸(用于"适合屏幕" + 居中)
  const [beforeNat, setBeforeNat] = useState<{ w: number; h: number } | null>(null);
  const [afterNat, setAfterNat] = useState<{ w: number; h: number } | null>(null);

  const fitToScreen = useCallback(() => {
    if (!stageRef.current || !afterNat) return;
    const rect = stageRef.current.getBoundingClientRect();
    const zw = rect.width / afterNat.w;
    const zh = rect.height / afterNat.h;
    const z = Math.min(zw, zh, 1) * 0.95;
    setZoom(z);
    setOffset({ x: 0, y: 0 });
  }, [afterNat]);

  // 第一次拿到 afterNat 时自动适配
  useEffect(() => {
    if (afterNat) fitToScreen();
  }, [afterNat, fitToScreen]);

  function onWheel(e: React.WheelEvent): void {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom((z) => Math.max(0.05, Math.min(20, z * factor)));
  }

  function onMouseDown(e: React.MouseEvent): void {
    if ((e.target as HTMLElement).dataset.role === 'wipe-handle') return;
    setDragging('pan');
    setDragStart({ x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y });
  }

  function onWipeMouseDown(e: React.MouseEvent): void {
    e.stopPropagation();
    setDragging('wipe');
  }

  useEffect(() => {
    if (!dragging) return;
    function onMove(e: MouseEvent): void {
      if (dragging === 'pan') {
        setOffset({
          x: dragStart.ox + (e.clientX - dragStart.x),
          y: dragStart.oy + (e.clientY - dragStart.y)
        });
      } else if (dragging === 'wipe' && stageRef.current) {
        const rect = stageRef.current.getBoundingClientRect();
        const pct = (e.clientX - rect.left) / rect.width;
        setWipe(Math.max(0, Math.min(1, pct)));
      }
    }
    function onUp(): void {
      setDragging(null);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging, dragStart]);

  return (
    <div className="mb-icv">
      <div className="mb-icv-toolbar">
        <div className="mb-icv-mode-toggle">
          <button
            type="button"
            className={mode === 'wipe' ? 'is-active' : ''}
            onClick={() => setMode('wipe')}
            title="滑条对比"
          >
            对比
          </button>
          <button
            type="button"
            className={mode === 'before' ? 'is-active' : ''}
            onClick={() => setMode('before')}
            title="仅看原图"
          >
            原图
          </button>
          <button
            type="button"
            className={mode === 'after' ? 'is-active' : ''}
            onClick={() => setMode('after')}
            title="仅看结果"
          >
            结果
          </button>
        </div>

        <div className="mb-icv-toolbar-info">
          {mode === 'wipe'
            ? `← ${beforeLabel}  |  ${afterLabel} →`
            : mode === 'before'
              ? beforeLabel
              : afterLabel}
          {afterNat && (
            <span style={{ marginLeft: 8 }}>
              · {afterNat.w}×{afterNat.h}
            </span>
          )}
        </div>

        <button
          type="button"
          className="mb-btn mb-btn-ghost mb-btn-xs"
          onClick={() => setZoom((z) => Math.max(0.05, z * 0.85))}
          title="缩小"
        >
          <XIcon size={11} />
        </button>
        <span className="mb-icv-toolbar-zoom">{Math.round(zoom * 100)}%</span>
        <button
          type="button"
          className="mb-btn mb-btn-ghost mb-btn-xs"
          onClick={() => setZoom((z) => Math.min(20, z * 1.18))}
          title="放大"
        >
          <PlusIcon size={11} />
        </button>
        <button
          type="button"
          className="mb-btn mb-btn-ghost mb-btn-xs"
          onClick={() => {
            setZoom(1);
            setOffset({ x: 0, y: 0 });
          }}
          title="原始尺寸"
        >
          1×
        </button>
        <button
          type="button"
          className="mb-btn mb-btn-ghost mb-btn-xs"
          onClick={fitToScreen}
          title="适合窗口"
        >
          适合
        </button>
      </div>

      <div
        ref={stageRef}
        className={`mb-icv-stage ${dragging === 'pan' ? 'is-dragging' : ''}`}
        onWheel={onWheel}
        onMouseDown={onMouseDown}
      >
        {/* 渲染层:原图始终在底,结果按 mode 决定 */}
        <Layer
          url={beforeUrl}
          zoom={zoom}
          offsetX={offset.x}
          offsetY={offset.y}
          natural={beforeNat}
          onLoad={(w, h) => setBeforeNat({ w, h })}
          visible={mode !== 'after'}
          /* before 显示左半:wipe=0.5 时左 0-50% */
          clip={mode === 'wipe' ? { side: 'left', pct: wipe } : null}
        />
        <Layer
          url={afterUrl}
          zoom={zoom}
          offsetX={offset.x}
          offsetY={offset.y}
          natural={afterNat}
          onLoad={(w, h) => setAfterNat({ w, h })}
          visible={mode !== 'before'}
          /* after 显示右半 */
          clip={mode === 'wipe' ? { side: 'right', pct: wipe } : null}
        />

        {/* wipe 滑条 */}
        {mode === 'wipe' && (
          <>
            <div
              className="mb-icv-wipe-line"
              style={{ left: `calc(${wipe * 100}% - 1px)` }}
            />
            <div
              className="mb-icv-wipe-handle"
              data-role="wipe-handle"
              style={{ left: `${wipe * 100}%` }}
              onMouseDown={onWipeMouseDown}
              title="拖动对比"
            >
              <ChevronRightIcon size={12} style={{ transform: 'rotate(180deg)' }} />
              <ChevronRightIcon size={12} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// 单层:image + transform + 可选 clip-path
function Layer({
  url,
  zoom,
  offsetX,
  offsetY,
  natural,
  onLoad,
  visible,
  clip
}: {
  url: string;
  zoom: number;
  offsetX: number;
  offsetY: number;
  natural: { w: number; h: number } | null;
  onLoad: (w: number, h: number) => void;
  visible: boolean;
  clip: { side: 'left' | 'right'; pct: number } | null;
}): JSX.Element {
  const w = natural?.w ?? 0;
  const h = natural?.h ?? 0;

  const wrapperStyle: React.CSSProperties = {
    transform: `translate(calc(-50% + ${offsetX}px), calc(-50% + ${offsetY}px)) scale(${zoom})`,
    width: w || undefined,
    height: h || undefined,
    visibility: visible ? 'visible' : 'hidden'
  };

  let layerStyle: React.CSSProperties = {};
  if (clip) {
    // 用 inset clip:左半显示原图 / 右半显示结果(或反之)
    if (clip.side === 'left') {
      // 显示左侧 pct% 之内
      layerStyle = { clipPath: `inset(0 ${(1 - clip.pct) * 100}% 0 0)` };
    } else {
      // 显示右侧
      layerStyle = { clipPath: `inset(0 0 0 ${clip.pct * 100}%)` };
    }
  }

  return (
    <div className="mb-icv-layer" style={layerStyle}>
      <div className="mb-icv-canvas" style={wrapperStyle}>
        <img
          src={url}
          alt=""
          className="mb-icv-img"
          onLoad={(e) => {
            const img = e.currentTarget;
            onLoad(img.naturalWidth, img.naturalHeight);
          }}
          draggable={false}
        />
      </div>
    </div>
  );
}
