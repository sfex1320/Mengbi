/**
 * 镜头提示词生成（纯函数）。把 模式 + 相机/光圈/视角 或 运镜/焦距/构图 拼成中文镜头语言描述，
 * 作文本输出喂下游（生成 / LLM）。视角（水平/垂直/距离）逻辑沿用 anglePrompt 思路。
 */
import type {
  CameraMode,
  CameraType,
  ApertureSetting,
  CameraMovement,
  FocalLength,
  ShotComposition
} from '@shared/smartCanvas';

const CAMERA_TYPE_PHRASE: Record<CameraType, string> = {
  none: '',
  dslr: '单反相机拍摄，画质锐利细节丰富',
  mirrorless: '微单相机拍摄，通透干净',
  film35: '35mm 胶片质感，颗粒与暖调',
  mediumformat: '中画幅相机，极高解析力与立体感',
  polaroid: '拍立得即影质感，复古边框与偏色',
  phone: '手机摄影风格，自然随手感',
  cinema: '电影摄影机拍摄，宽幅电影感与高动态',
  drone: '无人机航拍，大场景俯瞰视角',
  action: '运动相机拍摄，广角畸变与沉浸第一人称'
};
const APERTURE_PHRASE: Record<ApertureSetting, string> = {
  none: '',
  'f1.4': '大光圈 f/1.4，背景强烈虚化、奶油般焦外散景',
  'f2.8': '光圈 f/2.8，浅景深、主体清晰背景柔化',
  f4: '光圈 f/4，适中景深',
  f8: '光圈 f/8，前后景较清晰',
  f16: '小光圈 f/16，全画面清晰、大景深'
};
const MOVEMENT_PHRASE: Record<CameraMovement, string> = {
  none: '',
  push: '镜头缓缓推近（推镜），逐渐放大主体',
  pull: '镜头缓缓拉远（拉镜），逐渐展开环境',
  panleft: '镜头向左摇移（左摇）',
  panright: '镜头向右摇移（右摇）',
  tiltup: '镜头向上摇起（上摇）',
  tiltdown: '镜头向下俯摇（下摇）',
  truck: '镜头水平横移（移镜）',
  orbit: '镜头环绕主体旋转（环绕运镜）',
  handheld: '手持跟随，轻微晃动的纪实感',
  crane: '摇臂升降运动，视点高度变化',
  dollyzoom: '滑动变焦（希区柯克变焦），背景透视压缩',
  tracking: '镜头跟拍移动的主体',
  static: '固定机位，稳定不动'
};
const FOCAL_PHRASE: Record<FocalLength, string> = {
  none: '',
  ultrawide: '超广角镜头，强透视张力与广阔视野',
  wide: '广角镜头，开阔的环境交代',
  standard: '标准镜头（约 50mm），接近人眼的自然视角',
  tele: '长焦镜头，压缩空间、突出主体',
  macro: '微距镜头，极近距离放大细节'
};
const COMPOSITION_PHRASE: Record<ShotComposition, string> = {
  none: '',
  thirds: '三分法构图，主体置于黄金分割线',
  centered: '中心对称构图，主体居中',
  symmetry: '对称构图，画面均衡',
  diagonal: '对角线构图，富有动势',
  leadinglines: '引导线构图，视线被引向主体',
  frameinframe: '框中框构图，用前景框住主体',
  golden: '黄金螺旋构图，自然流动的视觉引导',
  fill: '主体充满画面，强冲击力特写',
  negative: '大量留白构图，意境与呼吸感'
};

/** 视角（水平/垂直/距离）→ 短句数组（与 anglePrompt 同规则）。 */
function anglePhraseParts(h: number, v: number, distance: number): string[] {
  const parts: string[] = [];
  if (h > 0) parts.push(`将相机向右旋转${Math.abs(h)}度`);
  else if (h < 0) parts.push(`将相机向左旋转${Math.abs(h)}度`);
  if (v > 0) parts.push(`俯视${Math.abs(v)}度`);
  else if (v < 0) parts.push(`仰视${Math.abs(v)}度`);
  if (distance > 4) parts.push('使用广角镜头');
  else if (distance < 4) parts.push('使用特写镜头');
  return parts;
}

export interface CameraPromptInput {
  camMode?: CameraMode;
  horizontalAngle: number;
  verticalAngle: number;
  distance: number;
  cameraType?: CameraType;
  aperture?: ApertureSetting;
  movement?: CameraMovement;
  focal?: FocalLength;
  composition?: ShotComposition;
  appendConsistencyInstruction: boolean;
}

export function buildCameraPrompt(d: CameraPromptInput): string {
  const mode = d.camMode ?? 'photo';
  const parts: string[] = [];

  if (mode === 'photo') {
    if (d.cameraType && d.cameraType !== 'none') parts.push(CAMERA_TYPE_PHRASE[d.cameraType]);
    if (d.aperture && d.aperture !== 'none') parts.push(APERTURE_PHRASE[d.aperture]);
    parts.push(...anglePhraseParts(d.horizontalAngle, d.verticalAngle, d.distance));
    if (d.composition && d.composition !== 'none') parts.push(COMPOSITION_PHRASE[d.composition]);
  } else {
    if (d.movement && d.movement !== 'none') parts.push(MOVEMENT_PHRASE[d.movement]);
    if (d.focal && d.focal !== 'none') parts.push(FOCAL_PHRASE[d.focal]);
    if (d.composition && d.composition !== 'none') parts.push(COMPOSITION_PHRASE[d.composition]);
    parts.push(...anglePhraseParts(d.horizontalAngle, d.verticalAngle, d.distance));
  }

  const body = parts.filter(Boolean);
  let prompt = body.length ? body.join('，') : mode === 'photo' ? '保持原始拍摄方式' : '固定镜头，无特殊运镜';

  if (d.appendConsistencyInstruction) {
    prompt +=
      mode === 'photo'
        ? '。保持主体身份、服装、材质、场景风格一致，只改变拍摄方式。'
        : '。保持主体身份与场景一致，只改变运镜与镜头语言。';
  }
  return prompt;
}
