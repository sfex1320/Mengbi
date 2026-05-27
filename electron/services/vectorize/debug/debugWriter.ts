/**
 * DebugWriter —— 每次任务在 userData/vec-debug/{ts}/ 下落盘:
 *   - input_original.png       原图(复制)
 *   - input_preprocessed.png   预处理后(如有)
 *   - engine_raw_output.svg    引擎原始 SVG
 *   - engine_raw_output.txt    引擎原始文本(AI 含 markdown)
 *   - svg_cleaned.svg          Cleaner 后
 *   - svg_repaired.svg         Repair 后
 *   - final_output.svg         simplify 后(== 落盘到用户 outputDir 的版本)
 *   - fallback_output.svg      回退后的 SVG(如发生)
 *   - report.json              30 字段完整报告
 *   - error_log.txt            engine_error_message + hint + stack
 *
 * 启动时调 sweepStaleDebugDirs() 清理过期目录。
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import { app } from 'electron';
import type { VecReport } from '../types';
import { logger } from '../../logger';

export interface DebugBundle {
  /** 任务的 debug 目录绝对路径 */
  dirPath: string;
  /** 时间戳目录名 yyyy-MM-dd-HHmmss-<short-id> */
  dirName: string;
}

/** 给定 taskId + 时间戳,准备 debug 目录;返回路径(目录已创建)。 */
export async function prepareDebugDir(taskId: string, ts: Date = new Date()): Promise<DebugBundle> {
  const base = path.join(app.getPath('userData'), 'vec-debug');
  await fs.mkdir(base, { recursive: true });
  const tsStr = formatTimestamp(ts);
  const shortId = taskId.slice(0, 8);
  const dirName = `${tsStr}-${shortId}`;
  const dirPath = path.join(base, dirName);
  await fs.mkdir(dirPath, { recursive: true });
  return { dirPath, dirName };
}

/** 把任务全过程产物写进 debug 目录。每个字段可选,空跳过。 */
export interface WriteDebugInput {
  dirPath: string;
  inputOriginalPath?: string;     // 原图绝对路径,会被 copy 进 debug/input_original.<ext>
  inputPreprocessedPath?: string; // 预处理后图绝对路径
  engineRawSvg?: string;          // 引擎产出的 raw SVG 字符串
  engineRawText?: string;         // 引擎产出的 raw 完整文本(AI)
  svgCleaned?: string;
  svgRepaired?: string;
  svgFinal?: string;              // 最终落盘的 SVG
  fallbackSvg?: string;           // 回退后的 SVG
  errorLog?: string;              // 错误堆栈 + hint
  report: VecReport;              // 必填,30 字段 JSON
}

export async function writeDebugBundle(input: WriteDebugInput): Promise<void> {
  const tasks: Array<Promise<unknown>> = [];

  if (input.inputOriginalPath) {
    const ext = path.extname(input.inputOriginalPath) || '.png';
    tasks.push(
      fs.copyFile(input.inputOriginalPath, path.join(input.dirPath, `input_original${ext}`)).catch((e) => {
        logger.warn(`[debugWriter] copy input failed: ${(e as Error).message}`);
      })
    );
  }
  if (input.inputPreprocessedPath && input.inputPreprocessedPath !== input.inputOriginalPath) {
    const ext = path.extname(input.inputPreprocessedPath) || '.png';
    tasks.push(
      fs
        .copyFile(input.inputPreprocessedPath, path.join(input.dirPath, `input_preprocessed${ext}`))
        .catch((e) => {
          logger.warn(`[debugWriter] copy preprocessed failed: ${(e as Error).message}`);
        })
    );
  }
  const writeFile = (name: string, content: string) =>
    fs.writeFile(path.join(input.dirPath, name), content, 'utf-8').catch((e) => {
      logger.warn(`[debugWriter] write ${name} failed: ${(e as Error).message}`);
    });

  if (input.engineRawSvg !== undefined) tasks.push(writeFile('engine_raw_output.svg', input.engineRawSvg));
  if (input.engineRawText !== undefined) tasks.push(writeFile('engine_raw_output.txt', input.engineRawText));
  if (input.svgCleaned !== undefined) tasks.push(writeFile('svg_cleaned.svg', input.svgCleaned));
  if (input.svgRepaired !== undefined) tasks.push(writeFile('svg_repaired.svg', input.svgRepaired));
  if (input.svgFinal !== undefined) tasks.push(writeFile('final_output.svg', input.svgFinal));
  if (input.fallbackSvg !== undefined) tasks.push(writeFile('fallback_output.svg', input.fallbackSvg));
  if (input.errorLog !== undefined) tasks.push(writeFile('error_log.txt', input.errorLog));

  tasks.push(writeFile('report.json', JSON.stringify(input.report, null, 2)));

  await Promise.all(tasks);
}

/** 启动期清理过期 debug 目录(超过 retainDays 天) */
export async function sweepStaleDebugDirs(retainDays: number): Promise<number> {
  if (retainDays <= 0) return 0;
  const base = path.join(app.getPath('userData'), 'vec-debug');
  let removed = 0;
  try {
    const entries = await fs.readdir(base, { withFileTypes: true });
    const cutoff = Date.now() - retainDays * 86400_000;
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const full = path.join(base, e.name);
      try {
        const stat = await fs.stat(full);
        if (stat.mtimeMs < cutoff) {
          await fs.rm(full, { recursive: true, force: true });
          removed++;
        }
      } catch {
        /* 单个目录失败不影响其他 */
      }
    }
  } catch {
    /* 整个 base 不存在 = 没东西要清 */
  }
  if (removed > 0) {
    logger.info(`[vec.debug] swept ${removed} stale debug dirs (>${retainDays}d)`);
  }
  return removed;
}

function formatTimestamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}
