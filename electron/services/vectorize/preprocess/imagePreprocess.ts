/**
 * ImagePreprocess —— 按模式做特定预处理。
 *
 * VTracer:  passthrough(VTracer 自带颜色量化)
 * Potrace:  转灰度 + 自动对比度 + 可选二值化(potrace 内部也会二值,这里做更好的输入)
 * AutoTrace:轻度去噪 + 颜色量化(autotrace 自带 -color-count,这里给更干净的输入)
 * StarVector: resize 到 224 / 384(看模型)+ 白底
 * Experimental: 限制最大边长 512
 *
 * 所有预处理结果写到 userData/vec-debug/<ts>/input_preprocessed.png(由 debugWriter copy),
 * 这里仅返回临时文件路径。
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import sharp from 'sharp';
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
  /** 是否替换非白背景为白底(StarVector 用) */
  replaceBackground?: boolean;
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
    case 'autotrace':
      // 轻度去噪 + 中等量化(autotrace 自带 color-count,这里给中和的输入)
      pipeline = pipeline.median(3); // 3x3 median 去噪
      break;
    case 'starvector':
      // resize 到模型适合的尺寸 + 白底
      pipeline = pipeline.resize(512, 512, { fit: 'inside', withoutEnlargement: true });
      if (opts.replaceBackground !== false) {
        pipeline = pipeline.flatten({ background: { r: 255, g: 255, b: 255 } });
      }
      break;
    case 'experimental':
      // 限到 512(实验模式要快)
      pipeline = pipeline.resize(Math.min(opts.maxDimension || 512, 512), undefined, {
        fit: 'inside',
        withoutEnlargement: true
      });
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
