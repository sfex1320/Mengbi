/**
 * 鼠标长按拖动滚动（grab-scroll）：在可滚动容器上按住并上下/左右拖动即可滚动，
 * 不必依赖滚轮或右侧滑杆。用于提示词库 / 资产库 / 节点模板等卡片列表。
 *
 * 关键实现点：
 * - 监听挂在 window 上（一次），每次 pointerdown 用 ref.current.contains(target) 判定是否在容器内 ——
 *   这样即使容器是「异步加载后才渲染」（如提示词库先 loading 再出列表），也能正常生效
 *   （早期版本把监听挂在 useEffect 里、容器还没渲染 → ref 为 null → 永不绑定，是「拖不动」的真根因）。
 * - 命中 input/textarea/select/[draggable]/img/[data-no-dragscroll] 时不接管 ——
 *   让文本选择、以及资产库「拖出图片到外部/画布」的原生拖拽照常工作。
 * - 拖动超过阈值才算「拖」，并抑制本次手势结束后误触发的 click（拖一下不会把卡片点开）。
 * - pointercancel（如原生拖拽接管）时复位，避免卡在拖动态。
 */
import { useEffect, useRef } from 'react';

const DRAG_THRESHOLD = 5;
// 跳过：输入控件 / 显式可拖拽元素（资产库拖出图片）/ 默认可拖的 img·video（draggable!=false）/ 标记免拖区。
// 注意 `img:not([draggable="false"])`：资产库缩略图默认可拖 → 跳过保留拖出；选图弹窗 img 设了 draggable={false} → 仍可拖动滚动。
const SKIP_SELECTOR =
  'input, textarea, select, [draggable="true"], img:not([draggable="false"]), video:not([draggable="false"]), [data-no-dragscroll]';

export function useDragScroll<T extends HTMLElement>(): React.RefObject<T> {
  const ref = useRef<T>(null);
  useEffect(() => {
    let down = false;
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    const onDown = (e: PointerEvent): void => {
      const el = ref.current;
      if (!el || e.button !== 0) return;
      const t = e.target as HTMLElement | null;
      if (!t || !el.contains(t)) return;
      if (t.closest(SKIP_SELECTOR)) return;
      down = true;
      dragging = false;
      startX = e.clientX;
      startY = e.clientY;
      startLeft = el.scrollLeft;
      startTop = el.scrollTop;
    };

    const onMove = (e: PointerEvent): void => {
      if (!down) return;
      const el = ref.current;
      if (!el) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!dragging && Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
      if (!dragging) {
        dragging = true;
        el.classList.add('is-dragscroll');
      }
      el.scrollTop = startTop - dy;
      el.scrollLeft = startLeft - dx;
      e.preventDefault();
    };

    const finish = (): void => {
      const el = ref.current;
      if (dragging && el) {
        el.classList.remove('is-dragscroll');
        // 抑制本次拖动后紧跟的 click（捕获阶段拦截，让卡片不被误点开）
        const suppress = (ev: Event): void => {
          ev.stopPropagation();
          ev.preventDefault();
        };
        el.addEventListener('click', suppress, { capture: true, once: true });
        window.setTimeout(() => el.removeEventListener('click', suppress, true), 0);
      }
      down = false;
      dragging = false;
    };

    window.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
    };
  }, []);

  return ref;
}
