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
  /** 智能画布连线流动色；'' = 跟随主题强调色 */
  flowColor: string;
  setAtmosphere: (a: Atmosphere) => void;
  setPalette: (p: Palette) => void;
  setFlowColor: (c: string) => void;
}

/** 把流动连线色写到 CSS 变量（空 = 移除 → CSS 里回退 var(--mb-accent)）。 */
function applyFlowColor(c: string): void {
  if (c) document.documentElement.style.setProperty('--mb-sc-flow', c);
  else document.documentElement.style.removeProperty('--mb-sc-flow');
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      atmosphere: DEFAULT_ATMOSPHERE,
      palette: DEFAULT_PALETTE,
      flowColor: '',
      setAtmosphere: (atmosphere) => {
        if (!ATMOSPHERES.includes(atmosphere)) return;
        document.documentElement.dataset.atmosphere = atmosphere;
        set({ atmosphere });
      },
      setPalette: (palette) => {
        if (!PALETTES.includes(palette)) return;
        document.documentElement.dataset.palette = palette;
        set({ palette });
      },
      setFlowColor: (flowColor) => {
        applyFlowColor(flowColor);
        set({ flowColor });
      }
    }),
    {
      name: 'mengbi-theme',
      onRehydrateStorage: () => (state) => {
        if (state) {
          document.documentElement.dataset.atmosphere = state.atmosphere;
          document.documentElement.dataset.palette = state.palette;
          applyFlowColor(state.flowColor ?? '');
        }
      }
    }
  )
);

/** 应用启动时调用：把当前 store 状态写入 HTML 根属性 */
export function applyThemeToDocument(): void {
  const { atmosphere, palette, flowColor } = useThemeStore.getState();
  document.documentElement.dataset.atmosphere = atmosphere;
  document.documentElement.dataset.palette = palette;
  applyFlowColor(flowColor);
}
