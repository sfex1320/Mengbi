import { useEffect, useRef } from 'react';

/**
 * 标尺：顶部水平 + 左侧垂直，刻度根据 zoom 自适应间距。
 * panX/panY/zoom 改变时重绘。
 */
interface Props {
  zoom: number;
  panX: number;
  panY: number;
  width: number;
  height: number;
  cursor: { x: number; y: number } | null;
}

const RULER_SIZE = 22;

export function Rulers({ zoom, panX, panY, width, height, cursor }: Props): JSX.Element {
  const wrapRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLCanvasElement>(null);
  const leftRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(wrap);
    draw();
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, panX, panY, cursor?.x, cursor?.y]);

  function pickStep(): number {
    const screenPxPer100 = 100 * zoom;
    if (screenPxPer100 >= 80) return 50;
    if (screenPxPer100 >= 40) return 100;
    if (screenPxPer100 >= 20) return 200;
    if (screenPxPer100 >= 10) return 500;
    return 1000;
  }

  function draw(): void {
    const wrap = wrapRef.current;
    const top = topRef.current;
    const left = leftRef.current;
    if (!wrap || !top || !left) return;
    const rect = wrap.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    // 顶部
    top.width = (rect.width - RULER_SIZE) * dpr;
    top.height = RULER_SIZE * dpr;
    top.style.width = rect.width - RULER_SIZE + 'px';
    top.style.height = RULER_SIZE + 'px';
    const tctx = top.getContext('2d')!;
    tctx.scale(dpr, dpr);
    drawHorizontal(tctx, rect.width - RULER_SIZE, RULER_SIZE);

    // 左侧
    left.width = RULER_SIZE * dpr;
    left.height = (rect.height - RULER_SIZE) * dpr;
    left.style.width = RULER_SIZE + 'px';
    left.style.height = rect.height - RULER_SIZE + 'px';
    const lctx = left.getContext('2d')!;
    lctx.scale(dpr, dpr);
    drawVertical(lctx, RULER_SIZE, rect.height - RULER_SIZE);
  }

  function drawHorizontal(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = readVar('--mb-bg-card', '#222');
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = readVar('--mb-border', 'rgba(255,255,255,0.1)');
    ctx.beginPath();
    ctx.moveTo(0, h - 0.5);
    ctx.lineTo(w, h - 0.5);
    ctx.stroke();

    const step = pickStep();
    const minor = step / 5;
    const muted = readVar('--mb-text-muted', 'rgba(255,255,255,0.4)');
    const sec = readVar('--mb-text-secondary', 'rgba(255,255,255,0.7)');

    // 画布范围阴影
    const startCanvasX = -panX / zoom;
    const endCanvasX = (w - panX) / zoom;
    const x0 = Math.floor(startCanvasX / minor) * minor;
    ctx.font = '10px monospace';
    for (let cx = x0; cx <= endCanvasX; cx += minor) {
      const sx = panX + cx * zoom;
      const isMajor = Math.abs(cx % step) < 0.001;
      ctx.strokeStyle = muted;
      ctx.beginPath();
      ctx.moveTo(sx + 0.5, h);
      ctx.lineTo(sx + 0.5, h - (isMajor ? 8 : 4));
      ctx.stroke();
      if (isMajor && sx > 16 && sx < w - 16) {
        ctx.fillStyle = sec;
        ctx.fillText(String(Math.round(cx)), sx + 2, h - 9);
      }
    }
    // 画布 0 的红线
    const zeroX = panX;
    if (zeroX >= 0 && zeroX <= w) {
      ctx.strokeStyle = '#fb923c';
      ctx.beginPath();
      ctx.moveTo(zeroX + 0.5, 0);
      ctx.lineTo(zeroX + 0.5, h);
      ctx.stroke();
    }
    // 鼠标位置
    if (cursor) {
      const sx = panX + cursor.x * zoom;
      ctx.strokeStyle = readVar('--mb-accent', '#fb923c');
      ctx.beginPath();
      ctx.moveTo(sx + 0.5, 0);
      ctx.lineTo(sx + 0.5, h);
      ctx.stroke();
    }
  }

  function drawVertical(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = readVar('--mb-bg-card', '#222');
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = readVar('--mb-border', 'rgba(255,255,255,0.1)');
    ctx.beginPath();
    ctx.moveTo(w - 0.5, 0);
    ctx.lineTo(w - 0.5, h);
    ctx.stroke();

    const step = pickStep();
    const minor = step / 5;
    const muted = readVar('--mb-text-muted', 'rgba(255,255,255,0.4)');
    const sec = readVar('--mb-text-secondary', 'rgba(255,255,255,0.7)');

    const startCanvasY = -panY / zoom;
    const endCanvasY = (h - panY) / zoom;
    const y0 = Math.floor(startCanvasY / minor) * minor;
    ctx.font = '10px monospace';
    for (let cy = y0; cy <= endCanvasY; cy += minor) {
      const sy = panY + cy * zoom;
      const isMajor = Math.abs(cy % step) < 0.001;
      ctx.strokeStyle = muted;
      ctx.beginPath();
      ctx.moveTo(w, sy + 0.5);
      ctx.lineTo(w - (isMajor ? 8 : 4), sy + 0.5);
      ctx.stroke();
      if (isMajor && sy > 16 && sy < h - 16) {
        ctx.fillStyle = sec;
        ctx.save();
        ctx.translate(w - 10, sy + 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(String(Math.round(cy)), 0, 0);
        ctx.restore();
      }
    }
    const zeroY = panY;
    if (zeroY >= 0 && zeroY <= h) {
      ctx.strokeStyle = '#fb923c';
      ctx.beginPath();
      ctx.moveTo(0, zeroY + 0.5);
      ctx.lineTo(w, zeroY + 0.5);
      ctx.stroke();
    }
    if (cursor) {
      const sy = panY + cursor.y * zoom;
      ctx.strokeStyle = readVar('--mb-accent', '#fb923c');
      ctx.beginPath();
      ctx.moveTo(0, sy + 0.5);
      ctx.lineTo(w, sy + 0.5);
      ctx.stroke();
    }
  }

  return (
    <div ref={wrapRef} className="mb-canvas-rulers" style={{ width, height }}>
      <div className="mb-canvas-ruler-corner" />
      <canvas ref={topRef} className="mb-canvas-ruler-top" />
      <canvas ref={leftRef} className="mb-canvas-ruler-left" />
    </div>
  );
}

function readVar(name: string, fallback: string): string {
  if (typeof getComputedStyle !== 'function' || typeof document === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}
