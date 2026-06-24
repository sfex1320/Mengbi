import { describe, it, expect } from 'vitest';
import { VEC_PRESETS, getVecPreset } from './vecPresets';

// 与 electron/ipc/vec.ts 的 zod schema range 对齐，锁住预设数值合法
const VTRACER_RANGE: Record<string, [number, number]> = {
  filterSpeckle: [0, 20],
  colorPrecision: [1, 10],
  layerDifference: [0, 128],
  cornerThreshold: [0, 180],
  lengthThreshold: [0, 50],
  maxIterations: [1, 50],
  spliceThreshold: [0, 180],
  pathPrecision: [0, 10],
  maxPaths: [1, 100000],
  colorMergeDelta: [0, 255]
};
const POTRACE_RANGE: Record<string, [number, number]> = {
  threshold: [0, 255],
  turdSize: [0, 100],
  alphaMax: [0, 1.34],
  optTolerance: [0, 2]
};

describe('VEC_PRESETS —— 行业预设', () => {
  it('恰 4 个、id 唯一', () => {
    expect(VEC_PRESETS).toHaveLength(4);
    expect(new Set(VEC_PRESETS.map((p) => p.id)).size).toBe(4);
  });

  it('mode 合法（vtracer / potrace）', () => {
    for (const p of VEC_PRESETS) expect(['vtracer', 'potrace']).toContain(p.mode);
  });

  it('每个预设的数值参数都落在对应 schema range 内', () => {
    for (const p of VEC_PRESETS) {
      const ranges = p.mode === 'vtracer' ? VTRACER_RANGE : POTRACE_RANGE;
      const entries = Object.entries(p.params as Record<string, unknown>);
      for (const [k, v] of entries) {
        if (typeof v !== 'number') continue;
        const r = ranges[k];
        if (!r) continue;
        expect(v, `${p.id}.${k}`).toBeGreaterThanOrEqual(r[0]);
        expect(v, `${p.id}.${k}`).toBeLessThanOrEqual(r[1]);
      }
    }
  });

  it('pathMode 仅出现在 vtracer 预设；color/background 仅在 potrace', () => {
    for (const p of VEC_PRESETS) {
      const keys = Object.keys(p.params as Record<string, unknown>);
      if (p.mode === 'potrace') expect(keys).not.toContain('pathMode');
      if (p.mode === 'vtracer') {
        expect(keys).not.toContain('color');
        expect(keys).not.toContain('background');
      }
    }
  });

  it('getVecPreset 命中 / 未命中', () => {
    expect(getVecPreset('logo-color')?.mode).toBe('vtracer');
    expect(getVecPreset('lineart-mono')?.mode).toBe('potrace');
    expect(getVecPreset('nope')).toBeUndefined();
  });
});
