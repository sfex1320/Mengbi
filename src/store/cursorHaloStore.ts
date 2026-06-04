/**
 * 鼠标光晕样式持久化（取代旧的 mb-marquee-glow 每卡片各开一份的高耗动画方案）。
 *
 * 4 种风格：aurora（默认柔光呼吸）/ pulse（涟漪）/ prism（多色旋转）/ trail（拖影）；
 * off 完全关闭。整个 app 共用 1 个 <div class="mb-cursor-halo">，由 CursorHalo 组件维护。
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const HALO_STYLES = [
  'aurora',
  'pulse',
  'prism',
  'trail',
  'orbit',
  'ring',
  'nebula',
  'breath',
  'crosshair',
  'comet',
  'off'
] as const;
export type HaloStyle = (typeof HALO_STYLES)[number];

export const HALO_LABELS: Record<HaloStyle, string> = {
  aurora: '暖光柔晕（默认）',
  pulse: '涟漪扩散',
  prism: '多色旋转',
  trail: '拖影滑过',
  orbit: '双星环绕',
  ring: '虚实双环',
  nebula: '星云对旋',
  breath: '色相呼吸',
  crosshair: '准星十字',
  comet: '彗星拖尾',
  off: '关闭'
};

export const HALO_DESCRIPTIONS: Record<HaloStyle, string> = {
  aurora: '主题色柔和呼吸，最省 GPU',
  pulse: '同心圆从鼠标向外扩散',
  prism: 'conic 多色光斑慢速旋转（接近老版"旋转灯"但只渲一份）',
  trail: '鼠标移动时带细微的延迟尾迹',
  orbit: '两个亮点绕鼠标公转，错开速度和颜色',
  ring: '一虚一实两层环，反向慢速旋转',
  nebula: '双层 conic 反向叠加，星云感最强',
  breath: '径向光斑边呼吸边漂移色相',
  crosshair: '极简瞄准镜风格的细十字 + 中心点',
  comet: '高亮核心 + 弧形拖尾，像彗星划过',
  off: '完全关闭，性能最优'
};

interface CursorHaloState {
  style: HaloStyle;
  setStyle: (s: HaloStyle) => void;
}

export const useCursorHaloStore = create<CursorHaloState>()(
  persist(
    (set) => ({
      style: 'aurora',
      setStyle: (style) => {
        if (!HALO_STYLES.includes(style)) return;
        set({ style });
      }
    }),
    { name: 'mengbi-cursor-halo' }
  )
);
