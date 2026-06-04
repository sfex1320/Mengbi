import { useEffect, useRef, useState } from 'react';
import { applyOutpaintSide } from './canvasEngine/outpaintOps';
import { autoSnapshot } from '@/store/snapshotStore';
import { toast } from '@/store/toastStore';

type Side = 'top' | 'right' | 'bottom' | 'left';

/**
 * 拖动画布边界扩图（需求六节第 7 条）。
 * 在画板纸张四边渲染可拖手柄，向外拖到松手时按该方向单边扩图并自动生成扩图蒙版。
 * 覆盖在 stage-wrap 内，坐标随 zoom/pan 实时定位。
 */
export function OutpaintHandles({
  zoom,
  panX,
  panY,
  width,
  height
}: {
  zoom: number;
  panX: number;
  panY: number;
  width: number;
  height: number;
}): JSX.Element {
  const pw = width * zoom;
  const ph = height * zoom;
  const [drag, setDrag] = useState<{ side: Side; amount: number } | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!drag) return;
    function onMove(e: MouseEvent): void {
      const s = startRef.current;
      if (!s || !drag) return;
      let amount = 0;
      if (drag.side === 'top') amount = (s.y - e.clientY) / zoom;
      else if (drag.side === 'bottom') amount = (e.clientY - s.y) / zoom;
      else if (drag.side === 'left') amount = (s.x - e.clientX) / zoom;
      else amount = (e.clientX - s.x) / zoom;
      setDrag({ side: drag.side, amount: Math.max(0, amount) });
    }
    function onUp(): void {
      const d = drag;
      startRef.current = null;
      setDrag(null);
      if (d && d.amount > 2) {
        autoSnapshot('扩图前');
        const r = applyOutpaintSide(d.side, d.amount);
        if (!r.ok) toast.error('扩图失败', r.message);
        else toast.success('已扩图', '新区域已生成蒙版，切到「蒙版」可微调');
      }
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [drag, zoom]);

  function startDrag(side: Side, e: React.MouseEvent): void {
    e.preventDefault();
    e.stopPropagation();
    startRef.current = { x: e.clientX, y: e.clientY };
    setDrag({ side, amount: 0 });
  }

  const GRIP = 12;
  const amt = drag ? drag.amount * zoom : 0;

  return (
    <>
      {/* 预览：向外扩展的虚线框 */}
      {drag && amt > 1 && (
        <div
          className="mb-outpaint-preview"
          style={{
            left: panX - (drag.side === 'left' ? amt : 0),
            top: panY - (drag.side === 'top' ? amt : 0),
            width: pw + (drag.side === 'left' || drag.side === 'right' ? amt : 0),
            height: ph + (drag.side === 'top' || drag.side === 'bottom' ? amt : 0)
          }}
        />
      )}
      {/* 四边手柄 */}
      <div
        className="mb-outpaint-grip is-h"
        style={{ left: panX, top: panY - GRIP / 2, width: pw, height: GRIP }}
        onMouseDown={(e) => startDrag('top', e)}
        title="向上拖动扩图"
      />
      <div
        className="mb-outpaint-grip is-h"
        style={{ left: panX, top: panY + ph - GRIP / 2, width: pw, height: GRIP }}
        onMouseDown={(e) => startDrag('bottom', e)}
        title="向下拖动扩图"
      />
      <div
        className="mb-outpaint-grip is-v"
        style={{ left: panX - GRIP / 2, top: panY, width: GRIP, height: ph }}
        onMouseDown={(e) => startDrag('left', e)}
        title="向左拖动扩图"
      />
      <div
        className="mb-outpaint-grip is-v"
        style={{ left: panX + pw - GRIP / 2, top: panY, width: GRIP, height: ph }}
        onMouseDown={(e) => startDrag('right', e)}
        title="向右拖动扩图"
      />
    </>
  );
}
