/**
 * AutoTrace 引擎 —— 实现 EngineRunner 接口。
 *
 * 通过 spawn autotrace.exe 把图片矢量化。
 *
 * exe 路径解析优先级:
 *   1. settings `vec_autotrace_path`  —— 用户在设置里指定的绝对路径
 *   2. userData/engines/autotrace/autotrace.exe  —— 一键下载安装的位置(预留)
 *   3. resources/autotrace-portable/autotrace.exe  —— 安装包内置(electron-builder extraResources)
 *   4. 找不到 → isAvailable=false,run() 返回 AUTOTRACE_EXE_MISSING
 *
 * 命令行参数映射(用户清单 §3):
 *   autotrace.exe -output-file out.svg -output-format svg
 *     -color-count <colorCount, 默认 8>
 *     -corner-threshold <cornerThreshold, 默认 60>
 *     -despeckle-level <despeckleLevel, 默认 2>
 *     -line-threshold <lineThreshold, 默认 1.0>
 *     -remove-adjacent-corners
 *     <input>
 *
 * 不再写盘到 user outputPath —— 写临时 SVG,读字符串,传给上层 postprocess。
 */
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { app } from 'electron';
import type {
  EngineRunner,
  EngineRunInput,
  EngineResult,
  EngineAvailability,
  AutotraceParams,
  VecMode
} from '../types';
import { getDb } from '../../db';
import { logger } from '../../logger';

const ID: VecMode = 'autotrace';

function execName(): string {
  return process.platform === 'win32' ? 'autotrace.exe' : 'autotrace';
}

/** 找 resources 目录(dev + packaged 都兼顾) */
function getResourcePath(...rel: string[]): string | null {
  const roots = [
    process.resourcesPath,
    path.resolve(__dirname, '..', '..'),
    path.resolve(__dirname, '..', '..', '..')
  ];
  for (const root of roots) {
    if (!root) continue;
    const p = path.join(root, 'resources', ...rel);
    if (existsSync(p)) return p;
  }
  return null;
}

/** 读用户在设置里配置的 autotrace 路径(空字符串 = 用默认) */
function readUserAutotracePath(): string {
  try {
    const row = getDb()
      .prepare(`SELECT value FROM settings WHERE key = 'vec_autotrace_path'`)
      .get() as { value: string } | undefined;
    return (row?.value ?? '').trim();
  } catch {
    return '';
  }
}

/** 解析 autotrace exe 路径;null = 不可用 */
export function resolveAutotracePath(): string | null {
  // 1. 用户设置
  const userPath = readUserAutotracePath();
  if (userPath && existsSync(userPath)) return userPath;

  // 2. userData 安装位置
  const userDataExe = path.join(
    app.getPath('userData'),
    'engines',
    'autotrace',
    execName()
  );
  if (existsSync(userDataExe)) return userDataExe;

  // 3. 安装包内置 resources/autotrace-portable/
  const bundled = getResourcePath('autotrace-portable', execName());
  if (bundled) return bundled;

  return null;
}

export class AutotraceEngine implements EngineRunner {
  readonly id = ID;

  async isAvailable(): Promise<EngineAvailability> {
    const exe = resolveAutotracePath();
    if (!exe) {
      return {
        available: false,
        reason:
          'AutoTrace 未安装。请将 autotrace.exe 放到 resources/autotrace-portable/ 或在设置里指定路径。'
      };
    }
    return { available: true };
  }

  async run(input: EngineRunInput, signal?: AbortSignal): Promise<EngineResult> {
    const t0 = Date.now();
    const params = (input.params || {}) as AutotraceParams;
    const exe = resolveAutotracePath();
    if (!exe) {
      return {
        ok: false,
        errorCode: 'CONFIG_MISSING',
        errorTag: 'AUTOTRACE_EXE_MISSING',
        errorMessageZh: 'AutoTrace 未安装',
        errorHint:
          '将 autotrace.exe 放到 resources/autotrace-portable/,或在设置里填入 vec_autotrace_path。',
        rawError: 'autotrace exe not found',
        durationMs: Date.now() - t0
      };
    }

    // 临时输出 SVG
    const tempDir = path.join(app.getPath('userData'), 'vec-debug', '_tmp');
    await fs.mkdir(tempDir, { recursive: true });
    const outSvg = path.join(tempDir, `autotrace-${Date.now()}-${Math.floor(Math.random() * 1e6)}.svg`);

    const args = [
      '-output-file', outSvg,
      '-output-format', 'svg',
      '-color-count', String(params.colorCount ?? 8),
      '-corner-threshold', String(params.cornerThreshold ?? 60),
      '-despeckle-level', String(params.despeckleLevel ?? 2),
      '-line-threshold', String(params.lineThreshold ?? 1.0),
      '-remove-adjacent-corners',
      input.preprocessedPath
    ];

    let stdoutBuf = '';
    let stderrBuf = '';

    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(exe, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        const onAbort = () => {
          try { child.kill('SIGTERM'); } catch { /* */ }
        };
        signal?.addEventListener('abort', onAbort, { once: true });

        child.stdout.on('data', (d) => { stdoutBuf += d.toString('utf-8'); });
        child.stderr.on('data', (d) => { stderrBuf += d.toString('utf-8'); });

        child.on('error', (e) => {
          signal?.removeEventListener('abort', onAbort);
          reject(e);
        });
        child.on('close', (code) => {
          signal?.removeEventListener('abort', onAbort);
          if (code === 0) resolve();
          else reject(new Error(`autotrace exit ${code}: ${stderrBuf.trim() || stdoutBuf.trim()}`));
        });
      });

      // 读输出 SVG
      let svg = '';
      try {
        svg = await fs.readFile(outSvg, 'utf-8');
      } catch (e) {
        return {
          ok: false,
          errorCode: 'API_FAILED',
          errorTag: 'AUTOTRACE_OUTPUT_MISSING',
          errorMessageZh: 'AutoTrace 未生成输出文件',
          errorHint: `stderr: ${stderrBuf.trim() || '(空)'}`,
          rawError: (e as Error).message,
          durationMs: Date.now() - t0
        };
      } finally {
        void fs.unlink(outSvg).catch(() => {});
      }

      if (!svg || !svg.trim().startsWith('<')) {
        return {
          ok: false,
          errorCode: 'API_FAILED',
          errorTag: 'AUTOTRACE_OUTPUT_INVALID',
          errorMessageZh: 'AutoTrace 输出不是合法 SVG',
          errorHint: '检查输入图是否过暗 / 单色;调高 colorCount 重试。',
          rawError: stderrBuf.trim() || 'invalid svg',
          durationMs: Date.now() - t0
        };
      }

      return {
        ok: true,
        svg,
        durationMs: Date.now() - t0,
        meta: { exePath: exe, args, stderr: stderrBuf.trim() || undefined }
      };
    } catch (e) {
      const err = e as Error;
      logger.warn('[vec.autotrace] failed', err);
      return {
        ok: false,
        errorCode: 'API_FAILED',
        errorTag: 'AUTOTRACE_SPAWN_FAILED',
        errorMessageZh: `AutoTrace 执行失败: ${err.message}`,
        errorHint:
          '可能 exe 损坏 / 缺 DLL / 不被系统识别;重新下载 autotrace 0.31.x Windows static build。',
        rawError: err.message,
        durationMs: Date.now() - t0
      };
    }
  }
}

let _instance: AutotraceEngine | null = null;
export function getAutotraceEngine(): AutotraceEngine {
  if (!_instance) _instance = new AutotraceEngine();
  return _instance;
}
