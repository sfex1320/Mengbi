import { useEffect, useRef } from 'react';
import { useCursorHaloStore } from '@/store/cursorHaloStore';

/**
 * 全局鼠标光晕：整个 app 共用 1 个 <div>。
 * 鼠标移到 .mb-card 上时 data-active=true，离开时 false（带 CSS 淡出）；
 * 位置通过 transform 跟随，不重排不重绘。
 *
 * 替代旧的 .mb-marquee-glow ——后者每张卡都有 conic-gradient + blur(28px) + 60fps 旋转，
 * 设置页 / 资产库这类多卡片页面会让 GPU 持续高占用。
 *
 * 不主动监听 mousemove —— 用 mouseover / mouseout 的 bubble 即可定位 .mb-card，
 * 进入后用 pointermove 微更新位置（事件密度被浏览器 rAF 节流，足够顺）。
 */
export function CursorHalo(): JSX.Element | null {
  const ref = useRef<HTMLDivElement>(null);
  const style = useCursorHaloStore((s) => s.style);

  useEffect(() => {
    const el = ref.current;
    if (!el || style === 'off') return;

    let active = false;
    let raf = 0;
    let pendingX = 0;
    let pendingY = 0;

    function setPos(x: number, y: number): void {
      pendingX = x;
      pendingY = y;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        // transform 直接写 px 字符串，比维护两个 CSS var 多一次解析
        if (el) {
          el.style.transform = `translate(${pendingX}px, ${pendingY}px)`;
        }
      });
    }

    function setActive(v: boolean): void {
      if (active === v || !el) return;
      active = v;
      el.dataset.active = v ? 'true' : 'false';
    }

    // 用 mouseover 而不是 mouseenter —— 后者不冒泡，需要给每张卡挂监听。
    function onOver(e: MouseEvent): void {
      const t = e.target as Element | null;
      const card = t?.closest('.mb-card');
      if (card && !card.hasAttribute('data-no-halo')) {
        setPos(e.clientX, e.clientY);
        setActive(true);
      }
    }

    function onMove(e: MouseEvent): void {
      if (!active) return;
      // 在卡片外移动也更新位置，CSS 的 opacity 过渡会让它优雅淡出
      setPos(e.clientX, e.clientY);
      const t = e.target as Element | null;
      const card = t?.closest('.mb-card');
      if (!card || card.hasAttribute('data-no-halo')) {
        setActive(false);
      }
    }

    function onLeave(): void {
      setActive(false);
    }

    document.addEventListener('mouseover', onOver, true);
    document.addEventListener('mousemove', onMove, { passive: true });
    document.addEventListener('mouseleave', onLeave);
    window.addEventListener('blur', onLeave);

    return () => {
      document.removeEventListener('mouseover', onOver, true);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseleave', onLeave);
      window.removeEventListener('blur', onLeave);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [style]);

  return <div ref={ref} className="mb-cursor-halo" data-style={style} data-active="false" />;
}
