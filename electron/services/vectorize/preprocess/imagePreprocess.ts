/**
 * ImagePreprocess —— 按模式做特定预处理(2 模式,2026-05-28 最终态)。
 *
 * VTracer: passthrough(VTracer 自带颜色量化)
 * Potrace: 转灰度 + 自动对比度
 *
 * 所有预处理结果写到 userData/vec-debug/<ts>/input_preprocessed.png(由 debugWriter copy),
 * 这里仅返回临时文件路径。
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import { getSharp } from '../../sharpLazy';
import { app } from 'electron';
import type { VecMode } from '../types';

export interface PreprocessResult {
  outputPath: string;
  width: number;
  height: number;
  mode: string;
}

export interface PreprocessOptions {
  /** 强制最大边长(0 = 不限) */
  maxDimension?: number;
}

/** 主入口:给定原图路径 + 目标模式,产出预处理后图的临时路径。 */
export async function preprocessForMode(
  inputPath: string,
  mode: VecMode,
  opts: PreprocessOptions = {}
): Promise<PreprocessResult> {
  const tempBase = path.join(app.getPath('userData'), 'vec-debug', '_tmp');
  await fs.mkdir(tempBase, { recursive: true });
  const ts = Date.now();
  const out = path.join(tempBase, `pp-${mode}-${ts}.png`);

  const sharp = await getSharp();
  let pipeline = sharp(inputPath);

  // 通用:强制最大边长
  if (opts.maxDimension && opts.maxDimension > 0) {
    pipeline = pipeline.resize(opts.maxDimension, opts.maxDimension, { fit: 'inside', withoutEnlargement: true });
  }

  switch (mode) {
    case 'vtracer':
      // 不动:VTracer 自带 colorPrecision 量化
      break;
    case 'potrace':
      // 转灰度 + 对比度增强(便于阈值化)
      pipeline = pipeline.grayscale().normalise();
      break;
  }

  const meta = await pipeline.png().toFile(out);
  return {
    outputPath: out,
    width: meta.width,
    height: meta.height,
    mode: meta.channels === 4 ? 'RGBA' : 'RGB'
  };
}

/** 清理临时预处理文件(任务完成后) */
export async function cleanupPreprocessTemp(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch {
    /* 已删 / 不存在 */
  }
}
