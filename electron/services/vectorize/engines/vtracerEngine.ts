/**
 * VTracer 引擎 —— 实现 EngineRunner 接口。
 * 通过 @neplex/vectorizer (Rust NAPI prebuilt) 把彩色图转 SVG。
 *
 * v3 重构:从原 vtracerBridge.ts 改造为 EngineRunner。
 * 不再写盘 —— 返回 svg 字符串给上层 postprocess 流水线。
 */
import fs from 'node:fs/promises';
import type {
  EngineRunner,
  EngineRunInput,
  EngineResult,
  EngineAvailability,
  VTracerParams,
  VecMode
} from '../types';
import { logger } from '../../logger';
import { resolvePathSimplifyMode } from './pathSimplifyMode';

const ID: VecMode = 'vtracer';

export class VTracerEngine implements EngineRunner {
  readonly id = ID;

  async isAvailable(): Promise<EngineAvailability> {
    try {
      await import('@neplex/vectorizer');
      return { available: true };
    } catch (e) {
      return {
        available: false,
        reason: `@neplex/vectorizer 加载失败:${(e as Error).message}。请 npm install`
      };
    }
  }

  async run(input: EngineRunInput, _signal?: AbortSignal): Promise<EngineResult> {
    const t0 = Date.now();
    const params = (input.params || {}) as VTracerParams;
    try {
      const mod = (await import('@neplex/vectorizer')) as unknown as {
        ColorMode: { Color: number; Binary: number };
        Hierarchical: { Stacked: number; Cutout: number };
        PathSimplifyMode: { None: number; Polygon: number; Spline: number };
        vectorize: (buf: Buffer, cfg?: Record<string, unknown>) => Promise<string>;
      };

      const fileBuf = await fs.readFile(input.preprocessedPath);

      const config: Record<string, unknown> = {
        colorMode: params.colorMode === 'binary' ? mod.ColorMode.Binary : mod.ColorMode.Color,
        hierarchical: params.hierarchical === 'cutout' ? mod.Hierarchical.Cutout : mod.Hierarchical.Stacked,
        mode: resolvePathSimplifyMode(params.pathMode, mod.PathSimplifyMode),
        filterSpeckle: params.filterSpeckle ?? 4,
        colorPrecision: params.colorPrecision ?? 8,
        layerDifference: params.layerDifference ?? 16,
        cornerThreshold: params.cornerThreshold ?? 60,
        lengthThreshold: params.lengthThreshold ?? 4.0,
        maxIterations: params.maxIterations ?? 10,
        spliceThreshold: params.spliceThreshold ?? 45,
        pathPrecision: params.pathPrecision ?? 5
      };

      const svg = await mod.vectorize(fileBuf, config);
      const durationMs = Date.now() - t0;

      if (!svg || !svg.trim().startsWith('<')) {
        return {
          ok: false,
          errorCode: 'API_FAILED',
          errorTag: 'VTRACER_OUTPUT_INVALID',
          errorMessageZh: 'VTracer 输出不是合法 SVG',
          errorHint: '可能输入图损坏或参数极端;改用默认参数重试。',
          rawError: 'invalid svg output',
          durationMs
        };
      }

      return {
        ok: true,
        svg,
        durationMs,
        meta: { configApplied: config }
      };
    } catch (e) {
      const err = e as Error & { code?: string };
      logger.warn('[vec.vtracer] failed', err);
      const msg = err.message || String(err);
      const durationMs = Date.now() - t0;
      if (err.code === 'ENOENT' || /no such file/i.test(msg)) {
        return {
          ok: false,
          errorCode: 'FILE_NOT_FOUND',
          errorTag: 'VTRACER_INPUT_MISSING',
          errorMessageZh: `输入文件不存在: ${input.preprocessedPath}`,
          errorHint: '检查文件路径是否正确。',
          rawError: msg,
          durationMs
        };
      }
      return {
        ok: false,
        errorCode: 'API_FAILED',
        errorTag: 'VTRACER_THREW',
        errorMessageZh: `VTracer 执行失败: ${msg}`,
        errorHint: '尝试 npm install @neplex/vectorizer 后重启 mengbi。',
        rawError: msg,
        durationMs
      };
    }
  }
}

/** 单例 */
let _instance: VTracerEngine | null = null;
export function getVTracerEngine(): VTracerEngine {
  if (!_instance) _instance = new VTracerEngine();
  return _instance;
}
