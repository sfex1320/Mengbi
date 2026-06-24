/**
 * 图像转矢量「行业预设」—— 一键套用 mode + 全参数。
 *
 * 纯数据 + 一个查找函数，便于 vitest。各数值均落在 vec.ts zod schema 的合法 range 内。
 * UI 点选预设时把 mode 与 params 原子应用（见 InputCard.applyPreset）。
 */
import type { VecMode, VecParams } from '@/types/ipc';

export interface VecPreset {
  id: 'logo-color' | 'lineart-mono' | 'illustration' | 'photo';
  label: string;
  desc: string;
  mode: VecMode;
  params: VecParams;
}

export const VEC_PRESETS: readonly VecPreset[] = [
  {
    id: 'logo-color',
    label: 'Logo（彩色）',
    desc: '少而干净的路径、保色、圆滑边缘',
    mode: 'vtracer',
    params: {
      colorMode: 'color',
      pathMode: 'spline',
      colorPrecision: 6,
      filterSpeckle: 8,
      cornerThreshold: 80,
      layerDifference: 24,
      colorMergeDelta: 8
    }
  },
  {
    id: 'lineart-mono',
    label: '线稿（单色）',
    desc: '黑白线条 / 描边，最干净锐利',
    mode: 'potrace',
    params: {
      threshold: 128,
      blackOnWhite: true,
      turdSize: 2,
      alphaMax: 1.0,
      optCurve: true,
      optTolerance: 0.2
    }
  },
  {
    id: 'illustration',
    label: '插画',
    desc: '比 Logo 更保细节、更多色层',
    mode: 'vtracer',
    params: {
      colorMode: 'color',
      pathMode: 'spline',
      colorPrecision: 8,
      filterSpeckle: 4,
      cornerThreshold: 60,
      layerDifference: 16,
      pathPrecision: 6
    }
  },
  {
    id: 'photo',
    label: '照片',
    desc: '最大保真，路径多、文件大',
    mode: 'vtracer',
    params: {
      colorMode: 'color',
      pathMode: 'spline',
      colorPrecision: 10,
      filterSpeckle: 2,
      cornerThreshold: 40,
      layerDifference: 8,
      pathPrecision: 8,
      maxPaths: 20000
    }
  }
];

export function getVecPreset(id: string): VecPreset | undefined {
  return VEC_PRESETS.find((p) => p.id === id);
}
