/**
 * 局部重绘 / 扩图「合成贴回」（主进程 sharp）。
 *
 * gpt-image 等模型的 `/v1/images/edits` 是「整张重画」——遮罩只是软提示，非遮罩区会漂色/掉细节/动主体，
 * 且返回尺寸/比例不可控。这里在拿到模型结果后做客户端合成：**以底图（用户授权的画布）尺寸为准输出**，
 * 编辑区采用模型结果、未遮罩区原样保留底图像素。一次性修掉「中间被改」和「比例乱跳」两个问题。
 *
 * 遮罩约定（与 canvasEngine/maskEngine.ts:maskToEditAlphaPng 一致，发给 OpenAI 的形式）：
 *   透明(alpha=0)=编辑区 / 不透明(alpha=255)=保留区。
 */
import { getSharp } from '../services/sharpLazy';
import { logger } from '../services/logger';

/**
 * @param resultBuf 模型 edits 结果（任意尺寸）
 * @param baseBuf   底图（原图，可能带扩图透明边；尺寸=授权画布）
 * @param maskBuf   OpenAI 遮罩 PNG（透明=编辑区）
 * @returns 合成后的 PNG buffer（底图尺寸）；任何异常都回退原始结果，绝不阻断保存。
 */
export async function compositeInpaintResult(resultBuf: Buffer, baseBuf: Buffer, maskBuf: Buffer): Promise<Buffer> {
  try {
    const sharp = await getSharp();
    const meta = await sharp(baseBuf).metadata();
    const W = meta.width ?? 0;
    const H = meta.height ?? 0;
    if (!W || !H) return resultBuf;

    // editAlpha：编辑区=255 / 保留区=0（对 OpenAI 遮罩 alpha 取反），轻羽化软化接缝。
    const editAlpha = await sharp(maskBuf)
      .resize(W, H, { fit: 'fill' })
      .ensureAlpha()
      .extractChannel('alpha')
      .negate()
      .blur(1.2)
      .raw()
      .toBuffer();

    // 模型结果缩放到底图尺寸（RGB），挂 editAlpha 作 alpha → 仅编辑区不透明。
    const resultRgb = await sharp(resultBuf).resize(W, H, { fit: 'fill' }).removeAlpha().toBuffer();
    const resultMasked = await sharp(resultRgb)
      .joinChannel(editAlpha, { raw: { width: W, height: H, channels: 1 } })
      .png()
      .toBuffer();

    // 底图作画布（去 alpha：扩图透明区落在编辑区会被结果盖住，保留区是原图不透明），结果按 editAlpha 叠上。
    return await sharp(baseBuf)
      .resize(W, H, { fit: 'fill' })
      .removeAlpha()
      .composite([{ input: resultMasked, blend: 'over' }])
      .png()
      .toBuffer();
  } catch (e) {
    logger.warn('inpaint composite failed, fallback to raw result', { err: (e as Error).message });
    return resultBuf;
  }
}
