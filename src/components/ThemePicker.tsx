import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useThemeStore } from '@/store/themeStore';
import {
  ATMOSPHERES,
  ATMOSPHERE_LABELS,
  PALETTES,
  PALETTE_LABELS,
  type Atmosphere,
  type Palette
} from '@shared/theme';
import { PaletteIcon } from './Icon';
import './ThemePicker.css';

const PALETTE_PREVIEW: Record<Palette, string> = {
  emerald: 'linear-gradient(135deg, #6ee7b7, #047857)',
  purple: 'linear-gradient(135deg, #c4b5fd, #7e22ce)',
  rose: 'linear-gradient(135deg, #fda4af, #be123c)',
  ocean: 'linear-gradient(135deg, #93c5fd, #1d4ed8)',
  'warm-orange': 'linear-gradient(135deg, #fdba74, #ea580c)',
  slate: 'linear-gradient(135deg, #cbd5e1, #475569)',
  sunset: 'linear-gradient(135deg, #fcd34d, #b45309)',
  wheat: 'linear-gradient(135deg, #fde68a, #a16207)',
  coffee: 'linear-gradient(135deg, #d6b48a, #6f4e37)',
  cyan: 'linear-gradient(135deg, #67e8f9, #0e7490)'
};

export function ThemePicker(): JSX.Element {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { atmosphere, palette, setAtmosphere, setPalette } = useThemeStore();

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  return (
    <div ref={ref} className="mb-themepicker-root">
      <button
        onClick={() => setOpen((v) => !v)}
        className="mb-themepicker-trigger"
        aria-label="配置外观"
      >
        <PaletteIcon size={16} />
        <span>配置外观</span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
            className="mb-themepicker-panel mb-card-lg"
          >
            <div className="mb-themepicker-section">
              <div className="mb-themepicker-section-title">材质氛围 / 天气氛围</div>
              <div className="mb-themepicker-atmospheres">
                {ATMOSPHERES.map((a, i) => (
                  <motion.button
                    key={a}
                    onClick={() => setAtmosphere(a)}
                    className={`mb-themepicker-atmo ${atmosphere === a ? 'is-active' : ''}`}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.025 }}
                    whileHover={{ scale: 1.04 }}
                    whileTap={{ scale: 0.96 }}
                  >
                    {ATMOSPHERE_LABELS[a as Atmosphere]}
                  </motion.button>
                ))}
              </div>
            </div>

            <div className="mb-themepicker-section">
              <div className="mb-themepicker-section-title">主题配色</div>
              <div className="mb-themepicker-palettes">
                {PALETTES.map((p, i) => (
                  <motion.button
                    key={p}
                    onClick={() => setPalette(p)}
                    className={`mb-themepicker-palette ${palette === p ? 'is-active' : ''}`}
                    title={PALETTE_LABELS[p as Palette]}
                    initial={{ opacity: 0, scale: 0.6 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: i * 0.02, type: 'spring', stiffness: 300 }}
                    whileHover={{ scale: 1.12 }}
                    whileTap={{ scale: 0.94 }}
                  >
                    <span
                      className="mb-themepicker-dot"
                      style={{ background: PALETTE_PREVIEW[p as Palette] }}
                    />
                    <span className="mb-themepicker-palette-label">
                      {PALETTE_LABELS[p as Palette]}
                    </span>
                  </motion.button>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
