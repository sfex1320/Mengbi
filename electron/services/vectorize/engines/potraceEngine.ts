/**
 * Potrace 引擎 —— 实现 EngineRunner 接口。
 * 通过 potrace npm 把单色线稿 / logo 转 SVG。纯 JS,无原生依赖。
 *
 * v3 重构:从原 potraceBridge.ts 改造为 EngineRunner。
 */
import type {
  EngineRunner,
  EngineRunInput,
  EngineResult,
  EngineAvailability,
  PotraceParams,
  VecMode
} from '../types';
import { logger } from '../../logger';

const ID: VecMode = 'potrace';

interface PotraceModule {
  trace(
    file: string,
    options: Record<string, unknown>,
    cb: (err: Error | null, svg: string) => void
  ): void;
}

export class PotraceEngine implements EngineRunner {
  readonly id = ID;

  async isAvailable(): Promise<EngineAvailability> {
    try {
      await import('potrace');
      return { available: true };
    } catch (e) {
      return {
        available: false,
        reason: `potrace 加载失败:${(e as Error).message}。请 npm install`
      };
    }
  }

  async run(input: EngineRunInput, _signal?: AbortSignal): Promise<EngineResult> {
    const t0 = Date.now();
    const params = (input.params || {}) as PotraceParams;
    try {
      const potrace = (await import('potrace')) as unknown as PotraceModule;

      const options: Record<string, unknown> = {
        threshold: params.threshold ?? 128,
        blackOnWhite: params.blackOnWhite ?? true,
        turdSize: params.turdSize ?? 2,
        alphaMax: params.alphaMax ?? 1.0,
        optCurve: params.optCurve ?? true,
        optTolerance: params.optTolerance ?? 0.2,
        color: params.color ?? 'auto',
        background: params.background ?? 'transparent'
      };

      const svg: string = await new Promise((resolve, reject) => {
        potrace.trace(input.preprocessedPath, options, (err, out) => {
          if (err) reject(err);
          else resolve(out);
        });
      });
      const durationMs = Date.now() - t0;

      if (!svg || !svg.trim().startsWith('<')) {
        return {
          ok: false,
          errorCode: 'API_FAILED',
          errorTag: 'POTRACE_OUTPUT_INVALID',
          errorMessageZh: 'Potrace 输出不是合法 SVG',
          errorHint: '可能输入图全黑/全白;调整 threshold 重试。',
          rawError: 'invalid svg output',
          durationMs
        };
      }

      return { ok: true, svg, durationMs, meta: { optionsApplied: options } };
    } catch (e) {
      const err = e as Error & { code?: string };
      logger.warn('[vec.potrace] failed', err);
      const msg = err.message || String(err);
      const durationMs = Date.now() - t0;
      if (err.code === 'ENOENT' || /no such file/i.test(msg)) {
        return {
          ok: false,
          errorCode: 'FILE_NOT_FOUND',
          errorTag: 'POTRACE_INPUT_MISSING',
          errorMessageZh: `输入文件不存在: ${input.preprocessedPath}`,
          errorHint: '检查文件路径是否正确。',
          rawError: msg,
          durationMs
        };
      }
      return {
        ok: false,
        errorCode: 'API_FAILED',
        errorTag: 'POTRACE_THREW',
        errorMessageZh: `Potrace 执行失败: ${msg}`,
        errorHint: '尝试 npm install potrace 后重启 mengbi。',
        rawError: msg,
        durationMs
      };
    }
  }
}

let _instance: PotraceEngine | null = null;
export function getPotraceEngine(): PotraceEngine {
  if (!_instance) _instance = new PotraceEngine();
  return _instance;
}
