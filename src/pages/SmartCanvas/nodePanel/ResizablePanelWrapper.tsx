import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStoreApi } from '@xyflow/react';

/**
 * 节点属性面板的浮窗外壳：**贴在所属节点的上方或下方**（按可用空间自动选、随平移/缩放跟随）。
 *
 * 关键：**渲染在 `.mb-sc-canvas`（position:relative + overflow:hidden）内、用 `position:absolute`**，
 * 与「浮动检查器」(`.mb-sc-inspector.is-float`) 完全同一套路。曾经 portal 到 body + position:fixed
 * 会让面板落到 app 的另一个层叠上下文后面 → 整块看不见。用 absolute 后坐标天然相对画布 pane，与
 * ReactFlow transform 同坐标系，无需补窗口偏移。
 *
 * 尺寸模式（铁律 20：悬浮窗尺寸记忆）：
 * - `autoSize`：默认宽高随内容自适应；**用户拖右下角手柄后转为「用户固定尺寸」并按 storageKey 持久化**
 *   （存 `{w,h,user:true}`，切画布/重启保持），手柄旁出现「⟲」可一键恢复自适应默认。
 * - 非 autoSize：固定尺寸 + 右下角拖拽缩放，尺寸记 localStorage[storageKey]。
 */

interface Size {
  w: number;
  h: number;
}
interface StoredGeom extends Size {
  /** autoSize 面板被用户手动调过尺寸 → true（恢复默认即删除该记录） */
  user?: boolean;
}
export interface Anchor {
  x: number;
  y: number;
  w: number;
  h: number;
}

const MIN_W = 360;
const MIN_H = 220;
const GAP = 12;

function defaultSize(paneW: number, paneH: number): Size {
  return { w: Math.round(paneW * 0.75), h: Math.round(Math.min(paneH * 0.7, 540)) };
}
function clampSize(s: Size, paneW: number, paneH: number): Size {
  return {
    w: Math.max(MIN_W, Math.min(s.w, Math.round(paneW - 16))),
    h: Math.max(MIN_H, Math.min(s.h, Math.round(paneH - 16)))
  };
}
function loadGeom(key: string): StoredGeom | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<StoredGeom>;
    if (typeof s.w === 'number' && typeof s.h === 'number') return { w: s.w, h: s.h, user: !!s.user };
  } catch {
    /* ignore */
  }
  return null;
}

export function ResizablePanelWrapper({
  storageKey,
  anchor,
  className,
  autoSize = false,
  children
}: {
  storageKey: string;
  anchor: Anchor | null;
  className?: string;
  /** true=宽高随内容自适应（用户拖动手柄后转用户固定尺寸并记忆）；false=固定尺寸 + 拖拽缩放 */
  autoSize?: boolean;
  children: React.ReactNode;
}): JSX.Element {
  const storeApi = useStoreApi();
  const initial = loadGeom(storageKey);
  const [size, setSize] = useState<Size>(() => initial ?? { w: 1000, h: 520 });
  // autoSize 面板：仅当用户拖过（存档带 user:true）才进固定尺寸模式
  const [userSized, setUserSized] = useState<boolean>(() => (autoSize ? !!initial?.user : false));
  const fixedMode = !autoSize || userSized;
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const fixedRef = useRef(fixedMode);
  fixedRef.current = fixedMode;
  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;
  const winRef = useRef<HTMLDivElement>(null);

  /** 画布(pane)尺寸：优先用 ReactFlow 量好的 width/height，回退到 .mb-sc-canvas 实测。 */
  const paneSize = useCallback((): { w: number; h: number } => {
    const st = storeApi.getState();
    let pw = st.width;
    let ph = st.height;
    if (!pw || !ph) {
      const cv = winRef.current?.closest('.mb-sc-canvas') as HTMLElement | null;
      if (cv) {
        const r = cv.getBoundingClientRect();
        pw = r.width;
        ph = r.height;
      }
    }
    return { w: pw || 1200, h: ph || 800 };
  }, [storeApi]);

  // 持久化尺寸（去抖）——固定尺寸模式（含 autoSize 被用户拖过的情况）
  useEffect(() => {
    if (!fixedMode) return;
    const t = setTimeout(() => {
      try {
        const geom: StoredGeom = autoSize ? { ...size, user: true } : size;
        localStorage.setItem(storageKey, JSON.stringify(geom));
      } catch {
        /* 配额超限：忽略 */
      }
    }, 200);
    return () => clearTimeout(t);
  }, [size, storageKey, fixedMode, autoSize]);

  // 首次打开（无保存几何）→ 用「画布 3/4」作默认尺寸（仅纯固定尺寸面板）
  const didInitSize = useRef(false);
  useLayoutEffect(() => {
    if (autoSize || didInitSize.current) return;
    didInitSize.current = true;
    if (loadGeom(storageKey) === null) {
      const { w, h } = paneSize();
      setSize(clampSize(defaultSize(w, h), w, h));
    }
  }, [storageKey, autoSize, paneSize]);

  // 定位：贴节点上/下方，水平以节点中心对齐，全部夹在画布内（imperative，坐标相对画布 pane）
  const reposition = useCallback(() => {
    const el = winRef.current;
    if (!el) return;
    const { w: paneW, h: paneH } = paneSize();
    let ww: number;
    let hh: number;
    if (!fixedRef.current) {
      // 宽高随内容：只夹上限，让浏览器按 max-content 量出真实尺寸再定位
      el.style.width = '';
      el.style.height = '';
      el.style.maxWidth = `${Math.round(paneW - 16)}px`;
      el.style.maxHeight = `${Math.round(paneH - 16)}px`;
      ww = el.offsetWidth;
      hh = el.offsetHeight;
    } else {
      ww = Math.max(MIN_W, Math.min(sizeRef.current.w, Math.round(paneW - 16)));
      hh = Math.max(MIN_H, Math.min(sizeRef.current.h, Math.round(paneH - 16)));
      el.style.maxWidth = '';
      el.style.maxHeight = '';
      el.style.width = `${ww}px`;
      el.style.height = `${hh}px`;
    }
    let left: number;
    let top: number;
    const a = anchorRef.current;
    if (a) {
      const [tx, ty, zoom] = storeApi.getState().transform;
      const nodeTop = a.y * zoom + ty;
      const nodeBottom = (a.y + a.h) * zoom + ty;
      const nodeCx = (a.x + a.w / 2) * zoom + tx;
      left = Math.max(8, Math.min(nodeCx - ww / 2, Math.max(8, paneW - ww - 8)));
      const roomBelow = paneH - 8 - (nodeBottom + GAP);
      const roomAbove = nodeTop - GAP - 8;
      top = hh <= roomBelow || roomBelow >= roomAbove ? nodeBottom + GAP : nodeTop - GAP - hh;
      top = Math.max(8, Math.min(top, Math.max(8, paneH - hh - 8)));
    } else {
      left = Math.max(8, Math.round((paneW - ww) / 2));
      top = Math.max(8, Math.round((paneH - hh) / 2));
    }
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }, [storeApi, paneSize]);

  // 跟随平移/缩放（订阅 RF store）+ 窗口尺寸变化
  useEffect(() => {
    let raf = 0;
    const onChange = (): void => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        reposition();
      });
    };
    const unsub = storeApi.subscribe(onChange);
    window.addEventListener('resize', onChange);
    return () => {
      unsub();
      window.removeEventListener('resize', onChange);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [storeApi, reposition]);

  // 节点切换 / 尺寸变化 / 内容变化 / 模式切换 → 立即重定位（before paint，无闪烁）
  useLayoutEffect(() => {
    reposition();
  }, [anchor, size, fixedMode, reposition, children]);

  // 自适应态：内容高度可能随交互变化（展开/收起 tab），用 ResizeObserver 跟随重定位
  useEffect(() => {
    if (fixedMode) return;
    const el = winRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => reposition());
    ro.observe(el);
    return () => ro.disconnect();
  }, [fixedMode, reposition]);

  /** 恢复默认尺寸：autoSize 面板回自适应并删档；固定面板回「画布 3/4」。 */
  const resetGeom = useCallback(() => {
    try {
      localStorage.removeItem(storageKey);
    } catch {
      /* ignore */
    }
    if (autoSize) {
      setUserSized(false);
    } else {
      const { w, h } = paneSize();
      setSize(clampSize(defaultSize(w, h), w, h));
    }
  }, [storageKey, autoSize, paneSize]);

  // 外部「重置为默认尺寸」事件（标题栏 ⤢ 触发，按 storageKey 匹配）
  useEffect(() => {
    const onReset = (e: Event): void => {
      const k = (e as CustomEvent<string>).detail;
      if (k && k !== storageKey) return;
      resetGeom();
    };
    window.addEventListener('mb-np-reset-geom', onReset as EventListener);
    return () => window.removeEventListener('mb-np-reset-geom', onReset as EventListener);
  }, [storageKey, resetGeom]);

  const onResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      // autoSize 面板首次拖动：以当前自适应实际尺寸为起点，转为用户固定尺寸（开始记忆）
      let startW = sizeRef.current.w;
      let startH = sizeRef.current.h;
      if (!fixedRef.current && winRef.current) {
        startW = winRef.current.offsetWidth;
        startH = winRef.current.offsetHeight;
        setSize({ w: startW, h: startH });
        setUserSized(true);
      }
      const start = { mx: e.clientX, my: e.clientY, w: startW, h: startH };
      const move = (ev: MouseEvent): void => {
        const { w, h } = paneSize();
        setSize(clampSize({ w: start.w + (ev.clientX - start.mx), h: start.h + (ev.clientY - start.my) }, w, h));
      };
      const up = (): void => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    },
    [paneSize]
  );

  // 渲染在 .mb-sc-canvas 内（CanvasWorkspace 已把本组件放进去），absolute 定位。
  // left/top（及固定模式的 width/height）由 reposition 在 layout 阶段 imperative 写入。
  return (
    <div ref={winRef} className={`mb-np-window mb-card ${fixedMode ? '' : 'is-autosize'} ${className ?? ''}`}>
      {children}
      {autoSize && userSized && (
        <button type="button" className="mb-np-resize-reset" title="恢复默认大小（自适应）" onClick={resetGeom}>
          ⟲
        </button>
      )}
      <div className="mb-np-resize" title="拖拽调整窗口大小（调整后自动记忆）" onMouseDown={onResizeStart} />
    </div>
  );
}
