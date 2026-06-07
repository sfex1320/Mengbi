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
  /** 整窗界面缩放系数（1=100%）；持久化，启动时套用到 webFrame */
  appZoom: number;
  setAtmosphere: (a: Atmosphere) => void;
  setPalette: (p: Palette) => void;
  setFlowColor: (c: string) => void;
  /** 设置整窗界面缩放（clamp [0.5, 2]）：套用到 webFrame + 持久化 */
  setAppZoom: (z: number) => void;
}

/** 把流动连线色写到 CSS 变量（空 = 移除 → CSS 里回退 var(--mb-accent)）。 */
function applyFlowColor(c: string): void {
  if (c) document.documentElement.style.setProperty('--mb-sc-flow', c);
  else document.documentElement.style.removeProperty('--mb-sc-flow');
}

const MIN_APP_ZOOM = 0.5;
const MAX_APP_ZOOM = 2;
/** clamp + 两位小数（避免浮点漂移）。 */
export function clampAppZoom(z: number): number {
  if (!Number.isFinite(z)) return 1;
  return Math.min(MAX_APP_ZOOM, Math.max(MIN_APP_ZOOM, Math.round(z * 100) / 100));
}
/** 把界面缩放套用到整窗（webFrame，经 preload 暴露）。electronAPI 尚未就绪时静默跳过。 */
function applyAppZoom(z: number): void {
  try {
    window.electronAPI?.window?.setZoom?.(clampAppZoom(z));
  } catch {
    /* preload 未就绪 / 非 electron 环境：忽略 */
  }
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      atmosphere: DEFAULT_ATMOSPHERE,
      palette: DEFAULT_PALETTE,
      flowColor: '',
      appZoom: 1,
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
      },
      setAppZoom: (z) => {
        const appZoom = clampAppZoom(z);
        applyAppZoom(appZoom);
        set({ appZoom });
      }
    }),
    {
      name: 'mengbi-theme',
      onRehydrateStorage: () => (state) => {
        if (state) {
          document.documentElement.dataset.atmosphere = state.atmosphere;
          document.documentElement.dataset.palette = state.palette;
          applyFlowColor(state.flowColor ?? '');
          applyAppZoom(state.appZoom ?? 1);
        }
      }
    }
  )
);

/** 应用启动时调用：把当前 store 状态写入 HTML 根属性 + 套用界面缩放 */
export function applyThemeToDocument(): void {
  const { atmosphere, palette, flowColor, appZoom } = useThemeStore.getState();
  document.documentElement.dataset.atmosphere = atmosphere;
  document.documentElement.dataset.palette = palette;
  applyFlowColor(flowColor);
  applyAppZoom(appZoom);
}
