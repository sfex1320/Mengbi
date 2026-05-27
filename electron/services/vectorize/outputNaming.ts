/**
 * 输出路径决策:根据批量选项 + 输入路径 + 重名策略,算出最终落盘路径。
 */
import path from 'node:path';
import fs from 'node:fs';
import type { VecBatchOptions } from './types';

/**
 * 决定单个任务的输出 SVG 绝对路径。
 *
 * @param inputPath 输入图片绝对路径(用于派生 basename)
 * @param outputDir 批量选项里的目标目录(必传且绝对)
 * @param naming 'original' = same basename;'suffix' = basename.vec
 * @param onConflict overwrite / skip / rename
 * @returns 绝对输出路径;如果 onConflict='skip' 且文件已存在,返回 null(调用方应跳过此任务)
 */
export function resolveOutputPath(
  inputPath: string,
  outputDir: string,
  naming: VecBatchOptions['naming'],
  onConflict: VecBatchOptions['onConflict']
): string | null {
  fs.mkdirSync(outputDir, { recursive: true });
  const baseName = path.basename(inputPath, path.extname(inputPath));
  const stem = naming === 'suffix' ? `${baseName}.vec` : baseName;
  const candidate = path.join(outputDir, `${stem}.svg`);
  if (!fs.existsSync(candidate)) return candidate;

  if (onConflict === 'overwrite') return candidate;
  if (onConflict === 'skip') return null;

  // rename: stem (1).svg / stem (2).svg ...
  for (let i = 1; i < 10000; i++) {
    const alt = path.join(outputDir, `${stem} (${i}).svg`);
    if (!fs.existsSync(alt)) return alt;
  }
  // 兜底:加时间戳
  return path.join(outputDir, `${stem}-${Date.now()}.svg`);
}

/** 验证 outputDir 是绝对路径 + 可写。 */
export function validateOutputDir(outputDir: string): { ok: true } | { ok: false; reason: string } {
  if (!path.isAbsolute(outputDir)) {
    return { ok: false, reason: `输出目录必须是绝对路径: ${outputDir}` };
  }
  try {
    fs.mkdirSync(outputDir, { recursive: true });
    // 试写一个测试文件
    const probe = path.join(outputDir, `.vec-write-probe-${Date.now()}.tmp`);
    fs.writeFileSync(probe, '');
    fs.unlinkSync(probe);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: `输出目录不可写: ${(e as Error).message}` };
  }
}
