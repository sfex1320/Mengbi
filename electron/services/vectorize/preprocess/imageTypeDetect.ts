/**
 * ImageTypeDetect —— 快速分析图片,给出类型 + 推荐模式。
 *
 * 不依赖 ML —— 用 sharp 提取颜色直方图 + 边缘密度,启发式分类。
 * 跑得快(几十 ms),拖入图片立刻显示"识别为彩色 logo,推荐 Fast 模式"。
 *
 * 分类策略:
 *   - distinctColors < 8 + edgeDensity > 0.05 → bw-lineart 或 mono-logo
 *   - distinctColors < 32 + sat 适中           → color-logo / icon
 *   - hasAlpha                                 → transparent-bg(透明背景)
 *   - distinctColors > 5000 + saturationStd 大 → complex-photo
 *   - 渐变图 (saturationStd 大 + edgeDensity 低) → gradient-photo
 */
import sharp from 'sharp';
import type { ImageTypeDetection, ImageTypeTag, VecMode } from '../types';

/** 主入口:接受图片路径,返回检测结果。 */
export async function detectImageType(inputPath: string): Promise<ImageTypeDetection> {
  const img = sharp(inputPath);
  const meta = await img.metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  const hasAlpha = !!meta.hasAlpha;

  // 提取统计:downsample 到 128x128 再算,加速
  const probeImg = sharp(inputPath).resize(128, 128, { fit: 'inside' });
  const { data, info } = await probeImg.raw().toBuffer({ resolveWithObject: true });
  // data 是 W*H*channels 的 raw RGB(A)

  const channels = info.channels;
  const pixelCount = info.width * info.height;

  // 1) 颜色直方图(把 RGB 量化到 5 位 = 32^3 buckets,统计 distinct)
  const buckets = new Set<number>();
  // 2) 饱和度统计 + 是否大部分黑白
  let satSum = 0;
  let satSumSq = 0;
  let bwPixels = 0;

  for (let i = 0; i < pixelCount; i++) {
    const idx = i * channels;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    const key = (r >> 3) << 10 | ((g >> 3) << 5) | (b >> 3);
    buckets.add(key);

    // 饱和度近似:max - min
    const maxC = Math.max(r, g, b);
    const minC = Math.min(r, g, b);
    const sat = maxC === 0 ? 0 : ((maxC - minC) / maxC) * 255;
    satSum += sat;
    satSumSq += sat * sat;

    // 黑白判定:三通道接近 + 接近 0 或 255
    if (Math.abs(r - g) < 10 && Math.abs(g - b) < 10) {
      bwPixels++;
    }
  }
  const satMean = satSum / pixelCount;
  const satVar = satSumSq / pixelCount - satMean * satMean;
  const satStd = Math.sqrt(Math.max(0, satVar));
  const distinctColors = buckets.size;
  const isMostlyBW = bwPixels / pixelCount > 0.95;

  // 3) 边缘密度(Sobel 简化:用 sharp 的 normalise + 阈值)
  const edgeMaskInfo = await sharp(inputPath)
    .resize(128, 128, { fit: 'inside' })
    .greyscale()
    .normalise()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const eData = edgeMaskInfo.data;
  let edgePixels = 0;
  const ew = edgeMaskInfo.info.width;
  const eh = edgeMaskInfo.info.height;
  for (let y = 1; y < eh - 1; y++) {
    for (let x = 1; x < ew - 1; x++) {
      const c = eData[y * ew + x];
      const r = eData[y * ew + (x + 1)];
      const d = eData[(y + 1) * ew + x];
      if (Math.abs(c - r) > 30 || Math.abs(c - d) > 30) edgePixels++;
    }
  }
  const edgeDensity = edgePixels / ((ew - 2) * (eh - 2));

  // ── 分类逻辑 ──
  let tag: ImageTypeTag;
  let recommendedModes: VecMode[];
  let reasonZh: string;

  if (isMostlyBW && distinctColors < 20) {
    if (edgeDensity > 0.05) {
      tag = 'bw-lineart';
      recommendedModes = ['potrace', 'vtracer'];
      reasonZh = '黑白线稿,推荐 Crisp(Potrace)';
    } else {
      tag = 'mono-logo';
      recommendedModes = ['potrace', 'vtracer'];
      reasonZh = '单色 logo,推荐 Crisp(Potrace)';
    }
  } else if (distinctColors < 64 && edgeDensity > 0.03) {
    tag = 'color-logo';
    recommendedModes = ['vtracer'];
    reasonZh = '彩色 logo,推荐 Fast(VTracer)';
  } else if (distinctColors < 200 && edgeDensity > 0.05) {
    tag = 'flat-illustration';
    recommendedModes = ['vtracer'];
    reasonZh = '扁平插画,推荐 Fast(VTracer)';
  } else if (distinctColors < 500 && edgeDensity > 0.08) {
    tag = 'icon';
    recommendedModes = ['vtracer'];
    reasonZh = '图标,推荐 Fast(VTracer)';
  } else if (satStd > 60 && edgeDensity < 0.04) {
    tag = 'gradient-photo';
    recommendedModes = ['vtracer'];
    reasonZh = '渐变/光影图,矢量化效果有限,只能用 Fast(VTracer)且节点会很多';
  } else if (distinctColors > 5000) {
    tag = 'complex-photo';
    recommendedModes = ['vtracer'];
    reasonZh = '复杂照片,矢量化会有大量节点,只能用 Fast(VTracer)';
  } else {
    tag = 'flat-illustration';
    recommendedModes = ['vtracer'];
    reasonZh = '常规图片,推荐 Fast(VTracer)';
  }

  if (hasAlpha) {
    // 透明背景图叠加在原分类上
    if (tag === 'flat-illustration' || tag === 'icon') {
      tag = 'transparent-bg';
      reasonZh = '透明背景图;' + reasonZh;
    }
  }

  return {
    tag,
    confidence: 0.7, // 启发式给固定置信度
    recommendedModes,
    reasonZh,
    features: {
      width,
      height,
      distinctColors,
      hasAlpha,
      edgeDensity,
      saturationMean: satMean,
      saturationStd: satStd,
      isMostlyBW
    }
  };
}
