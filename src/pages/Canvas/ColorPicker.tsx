import { useEffect, useRef, useState } from 'react';

/**
 * 调色板：HSV 方块 + Hue 条 + Alpha 条 + RGB / Hex 输入 + 最近用色历史。
 * 设计参考 PS / Figma。色值 = '#rrggbbaa'（含 alpha）。
 *
 * 用法：
 *   <ColorPicker value="#fb923cff" onChange={...} recent={[...]} />
 */
interface Props {
  value: string;
  onChange: (v: string) => void;
  recent?: string[];
}

interface HSVA {
  h: number; // 0-360
  s: number; // 0-1
  v: number; // 0-1
  a: number; // 0-1
}

export function ColorPicker({ value, onChange, recent = [] }: Props): JSX.Element {
  const [hsva, setHsva] = useState<HSVA>(() => parseColor(value));

  // 外部 value 改变时同步
  useEffect(() => {
    const next = parseColor(value);
    setHsva((cur) => {
      // 避免循环：与当前 hsv -> hex 比较
      if (formatColor(cur) === value) return cur;
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function commit(next: HSVA): void {
    setHsva(next);
    onChange(formatColor(next));
  }

  const sqRef = useRef<HTMLDivElement>(null);
  function onSquareDown(e: React.PointerEvent<HTMLDivElement>): void {
    const el = sqRef.current;
    if (!el) return;
    el.setPointerCapture(e.pointerId);
    function pick(ev: React.PointerEvent<HTMLDivElement> | PointerEvent): void {
      const r = el!.getBoundingClientRect();
      const x = clamp((ev.clientX - r.left) / r.width, 0, 1);
      const y = clamp((ev.clientY - r.top) / r.height, 0, 1);
      commit({ ...hsva, s: x, v: 1 - y });
    }
    pick(e);
    function move(ev: PointerEvent): void {
      pick(ev);
    }
    function up(): void {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  const hueRef = useRef<HTMLDivElement>(null);
  function onHueDown(e: React.PointerEvent<HTMLDivElement>): void {
    const el = hueRef.current;
    if (!el) return;
    el.setPointerCapture(e.pointerId);
    function pick(ev: PointerEvent | React.PointerEvent<HTMLDivElement>): void {
      const r = el!.getBoundingClientRect();
      const x = clamp((ev.clientX - r.left) / r.width, 0, 1);
      commit({ ...hsva, h: x * 360 });
    }
    pick(e);
    function move(ev: PointerEvent): void {
      pick(ev);
    }
    function up(): void {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  const alphaRef = useRef<HTMLDivElement>(null);
  function onAlphaDown(e: React.PointerEvent<HTMLDivElement>): void {
    const el = alphaRef.current;
    if (!el) return;
    el.setPointerCapture(e.pointerId);
    function pick(ev: PointerEvent | React.PointerEvent<HTMLDivElement>): void {
      const r = el!.getBoundingClientRect();
      const x = clamp((ev.clientX - r.left) / r.width, 0, 1);
      commit({ ...hsva, a: x });
    }
    pick(e);
    function move(ev: PointerEvent): void {
      pick(ev);
    }
    function up(): void {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  const rgb = hsvToRgb(hsva.h, hsva.s, hsva.v);
  const hex = formatColor(hsva).slice(0, 7);

  return (
    <div className="mb-color-picker">
      <div
        ref={sqRef}
        className="mb-color-square"
        style={{
          background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsva.h}, 100%, 50%))`
        }}
        onPointerDown={onSquareDown}
      >
        <div
          className="mb-color-square-cursor"
          style={{ left: `${hsva.s * 100}%`, top: `${(1 - hsva.v) * 100}%` }}
        />
      </div>
      <div ref={hueRef} className="mb-color-hue" onPointerDown={onHueDown}>
        <div className="mb-color-hue-cursor" style={{ left: `${(hsva.h / 360) * 100}%` }} />
      </div>
      <div
        ref={alphaRef}
        className="mb-color-alpha"
        style={{
          backgroundImage: `linear-gradient(to right, transparent, rgb(${rgb.r}, ${rgb.g}, ${rgb.b}))`
        }}
        onPointerDown={onAlphaDown}
      >
        <div className="mb-color-alpha-cursor" style={{ left: `${hsva.a * 100}%` }} />
      </div>
      <div className="mb-color-inputs">
        <input
          type="text"
          className="mb-canvas-props-input"
          value={hex.toUpperCase()}
          onChange={(e) => {
            const next = parseColor(e.target.value);
            commit(next);
          }}
          spellCheck={false}
          maxLength={9}
        />
        <input
          type="number"
          className="mb-canvas-props-input"
          value={rgb.r}
          min={0}
          max={255}
          onChange={(e) => {
            const r = clamp(+e.target.value || 0, 0, 255);
            const next = rgbToHsv(r, rgb.g, rgb.b);
            commit({ ...next, a: hsva.a });
          }}
        />
        <input
          type="number"
          className="mb-canvas-props-input"
          value={rgb.g}
          min={0}
          max={255}
          onChange={(e) => {
            const g = clamp(+e.target.value || 0, 0, 255);
            const next = rgbToHsv(rgb.r, g, rgb.b);
            commit({ ...next, a: hsva.a });
          }}
        />
        <input
          type="number"
          className="mb-canvas-props-input"
          value={rgb.b}
          min={0}
          max={255}
          onChange={(e) => {
            const b = clamp(+e.target.value || 0, 0, 255);
            const next = rgbToHsv(rgb.r, rgb.g, b);
            commit({ ...next, a: hsva.a });
          }}
        />
      </div>
      {recent.length > 0 && (
        <div className="mb-color-recent">
          {recent.slice(0, 12).map((c) => (
            <button
              key={c}
              type="button"
              className="mb-color-recent-cell"
              style={{ background: c }}
              onClick={() => onChange(c)}
              title={c}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── helpers ───
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function parseColor(input: string): HSVA {
  const s = input.trim().replace(/^#/, '');
  let r = 0, g = 0, b = 0, a = 1;
  if (s.length === 3) {
    r = parseInt(s[0] + s[0], 16);
    g = parseInt(s[1] + s[1], 16);
    b = parseInt(s[2] + s[2], 16);
  } else if (s.length === 6) {
    r = parseInt(s.slice(0, 2), 16);
    g = parseInt(s.slice(2, 4), 16);
    b = parseInt(s.slice(4, 6), 16);
  } else if (s.length === 8) {
    r = parseInt(s.slice(0, 2), 16);
    g = parseInt(s.slice(2, 4), 16);
    b = parseInt(s.slice(4, 6), 16);
    a = parseInt(s.slice(6, 8), 16) / 255;
  } else {
    // 输入不合法，返回当前默认黑
    return { h: 0, s: 0, v: 0, a: 1 };
  }
  const hsv = rgbToHsv(r, g, b);
  return { ...hsv, a };
}

export function formatColor(hsva: HSVA): string {
  const { r, g, b } = hsvToRgb(hsva.h, hsva.s, hsva.v);
  const toHex = (n: number): string => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  const ah = toHex(hsva.a * 255);
  return `#${toHex(r)}${toHex(g)}${toHex(b)}${ah}`;
}

function rgbToHsv(r: number, g: number, b: number): HSVA {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const v = max;
  const s = max === 0 ? 0 : d / max;
  return { h, s, v, a: 1 };
}

function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
  const c = v * s;
  const hp = (h % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r1 = 0, g1 = 0, b1 = 0;
  if (hp < 1) { r1 = c; g1 = x; }
  else if (hp < 2) { r1 = x; g1 = c; }
  else if (hp < 3) { g1 = c; b1 = x; }
  else if (hp < 4) { g1 = x; b1 = c; }
  else if (hp < 5) { r1 = x; b1 = c; }
  else { r1 = c; b1 = x; }
  const m = v - c;
  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255)
  };
}
