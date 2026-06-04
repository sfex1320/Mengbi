/**
 * 视角提示词生成（纯函数）。
 * 规则：水平 >0 向右 / <0 向左；垂直 >0 俯视 / <0 仰视；距离 >4 广角 / <4 特写。
 * 三项都默认 → 「保持原始视角」。可选追加一致性约束句。
 */
export function buildAnglePrompt(
  horizontalAngle: number,
  verticalAngle: number,
  distance: number,
  appendConsistencyInstruction = true
): string {
  const parts: string[] = [];

  if (horizontalAngle > 0) {
    parts.push(`将相机向右旋转${Math.abs(horizontalAngle)}度`);
  } else if (horizontalAngle < 0) {
    parts.push(`将相机向左旋转${Math.abs(horizontalAngle)}度`);
  }

  if (verticalAngle > 0) {
    parts.push(`俯视${Math.abs(verticalAngle)}度`);
  } else if (verticalAngle < 0) {
    parts.push(`仰视${Math.abs(verticalAngle)}度`);
  }

  if (distance > 4) {
    parts.push('使用广角镜头');
  } else if (distance < 4) {
    parts.push('使用特写镜头');
  }

  let prompt = parts.length ? parts.join('，') : '保持原始视角';

  if (appendConsistencyInstruction) {
    prompt += '。保持主体身份、服装、材质、场景风格一致，只改变拍摄视角。';
  }

  return prompt;
}
