import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  ATMOSPHERES,
  PALETTES,
  DEFAULT_ATMOSPHERE,
  DEFAULT_PALETTE,
  type Atmosphere,
  type Palette
} from '@shared/theme';

interface ThemeState {
  atmosphere: Atmosphere;
  palette: Palette;
  setAtmosphere: (a: Atmosphere) => void;
  setPalette: (p: Palette) => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      atmosphere: DEFAULT_ATMOSPHERE,
      palette: DEFAULT_PALETTE,
      setAtmosphere: (atmosphere) => {
        if (!ATMOSPHERES.includes(atmosphere)) return;
        document.documentElement.dataset.atmosphere = atmosphere;
        set({ atmosphere });
      },
      setPalette: (palette) => {
        if (!PALETTES.includes(palette)) return;
        document.documentElement.dataset.palette = palette;
        set({ palette });
      }
    }),
    {
      name: 'mengbi-theme',
      onRehydrateStorage: () => (state) => {
        if (state) {
          document.documentElement.dataset.atmosphere = state.atmosphere;
          document.documentElement.dataset.palette = state.palette;
        }
      }
    }
  )
);

/** 应用启动时调用：把当前 store 状态写入 HTML 根属性 */
export function applyThemeToDocument(): void {
  const { atmosphere, palette } = useThemeStore.getState();
  document.documentElement.dataset.atmosphere = atmosphere;
  document.documentElement.dataset.palette = palette;
}
