/**
 * 光源提示词生成（纯函数）。把光照方位 / 高度 / 强度 / 色温 / 遮挡 / 光效 拼成中文光照描述，
 * 作为文本输出喂下游（生成 / LLM）。与 anglePrompt 同思路：节点上实时重算 generatedPrompt。
 */
import type { LightOcclusion, LightEffect } from '@shared/smartCanvas';

/** 方位角 → 方向词。az: -180~180（0=正前 / 90=右 / 180=正后(逆光) / -90=左）。 */
function dirWord(az: number): string {
  const a = ((az % 360) + 360) % 360; // 0~360
  if (a < 22.5 || a >= 337.5) return '正前方';
  if (a < 67.5) return '右前方';
  if (a < 112.5) return '右侧';
  if (a < 157.5) return '右后方';
  if (a < 202.5) return '正后方（逆光）';
  if (a < 247.5) return '左后方';
  if (a < 292.5) return '左侧';
  return '左前方';
}
/** 高度角 → 高度词。elev: 0(地平线)~90(头顶)。 */
function elevWord(elev: number): string {
  if (elev >= 70) return '顶部';
  if (elev >= 40) return '高处';
  if (elev >= 15) return '中等高度';
  return '低角度（接近地平线、长投影）';
}
/** 强度 0~100 → 描述（适中省略）。 */
function intensityWord(v: number): string {
  if (v <= 33) return '柔和的散射光';
  if (v >= 67) return '强烈的直射光';
  return '';
}
/** 色温 -100(冷)~100(暖) → 描述（中性省略）。 */
function warmthWord(v: number): string {
  if (v <= -50) return '冷蓝色调（如月光 / 阴天）';
  if (v <= -15) return '偏冷色调';
  if (v >= 50) return '暖金色调（如日出 / 黄昏）';
  if (v >= 15) return '偏暖色调';
  return '';
}

export const LIGHT_OCCLUSION_PHRASE: Record<LightOcclusion, string> = {
  none: '',
  leaves: '光线透过树叶缝隙洒下，形成斑驳的树影光斑',
  window: '光线透过窗格投下方格状光影',
  blinds: '光线透过百叶窗形成平行条状光影',
  branches: '光线透过树枝间隙形成细碎光斑',
  curtain: '光线透过薄纱窗帘变得柔和弥散'
};
export const LIGHT_EFFECT_PHRASE: Record<LightEffect, string> = {
  none: '',
  tyndall: '明显的丁达尔效应，可见体积光束（光柱）',
  fog: '光线穿过雾气，形成朦胧光晕与体积感',
  godrays: '云隙光 / 上帝之光，放射状光束自上而下',
  backlight: '逆光勾勒主体轮廓，边缘发光（轮廓光）',
  flare: '镜头光晕与眩光'
};

export function buildLightPrompt(p: {
  azimuth: number;
  elevation: number;
  intensity: number;
  warmth: number;
  occlusion: LightOcclusion;
  effect: LightEffect;
  appendConsistencyInstruction: boolean;
}): string {
  const parts: string[] = [`光线从${dirWord(p.azimuth)}${elevWord(p.elevation)}照射`];
  const inten = intensityWord(p.intensity);
  if (inten) parts.push(inten);
  const warm = warmthWord(p.warmth);
  if (warm) parts.push(warm);
  const occ = LIGHT_OCCLUSION_PHRASE[p.occlusion];
  if (occ) parts.push(occ);
  const eff = LIGHT_EFFECT_PHRASE[p.effect];
  if (eff) parts.push(eff);

  let prompt = parts.join('，');
  if (p.appendConsistencyInstruction) {
    prompt += '。保持主体身份、构图与场景内容不变，只改变光照与氛围。';
  }
  return prompt;
}
