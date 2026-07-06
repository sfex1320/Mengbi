// 提示词商城卡片库汇总：合并 12 个大类的数据文件，提供按大类/子类/id 的查询。
// 数据文件由各自的 data/*.ts 维护（只读、随 app 打包），扩库只改数据文件、无需迁移。

import type { PromptMallCard } from './cardTypes';
import { PROMPT_MALL_CATEGORIES } from './cardTypes';
import { CHARACTER_CARDS } from './data/character';
import { CLOTHING_CARDS } from './data/clothing';
import { ART_STYLE_CARDS } from './data/artStyle';
import { CAMERA_CARDS } from './data/camera';
import { LIGHTING_CARDS } from './data/lighting';
import { COLOR_CARDS } from './data/color';
import { MATERIAL_CARDS } from './data/material';
import { ENVIRONMENT_CARDS } from './data/environment';
import { INTERIOR_CARDS } from './data/interior';
import { NATURE_ARCH_CARDS } from './data/natureArch';
import { MOOD_CARDS } from './data/mood';
import { QUALITY_CARDS } from './data/quality';
// 2026-06-24 扩充：追加卡片单独成文件（不覆盖原有），+ 两个新大类 props / effects。
import { CHARACTER_EXT_CARDS } from './data/characterExt';
import { CLOTHING_EXT_CARDS } from './data/clothingExt';
import { ART_STYLE_EXT_CARDS } from './data/artStyleExt';
import { COLOR_EXT_CARDS } from './data/colorExt';
import { MATERIAL_EXT_CARDS } from './data/materialExt';
import { MOOD_EXT_CARDS } from './data/moodExt';
import { QUALITY_EXT_CARDS } from './data/qualityExt';
import { PROPS_CARDS } from './data/props';
import { PROPS_EXT_CARDS } from './data/propsExt';
import { EFFECTS_CARDS } from './data/effects';
import { EFFECTS_EXT_CARDS } from './data/effectsExt';
// 2026-06-24 续：连衣裙补充 + 四个新大类（中国风-女/男 / 泳衣 / 婚服）
import { DRESS_EXT_CARDS } from './data/dressExt';
import { CHINA_FEMALE_CARDS } from './data/chinaFemale';
import { CHINA_MALE_CARDS } from './data/chinaMale';
import { SWIMWEAR_CARDS } from './data/swimwear';
import { WEDDING_CARDS } from './data/wedding';
// 2026-06-25 扩充：静态/动作姿态（男女）补到各 ~100 + 中国古代发型（女/男）各 ~22
import { CHARACTER_EXT_POSE2 } from './data/characterExtPose2';
import { CHARACTER_EXT_HAIR_ANCIENT } from './data/characterExtHairAncient';

const RAW: PromptMallCard[] = [
  ...CHARACTER_CARDS,
  ...CLOTHING_CARDS,
  ...ART_STYLE_CARDS,
  ...CAMERA_CARDS,
  ...LIGHTING_CARDS,
  ...COLOR_CARDS,
  ...MATERIAL_CARDS,
  ...ENVIRONMENT_CARDS,
  ...INTERIOR_CARDS,
  ...NATURE_ARCH_CARDS,
  ...MOOD_CARDS,
  ...QUALITY_CARDS,
  // 追加卡片（排在原有之后；cards 按 id 去重保留首个 → 原有优先、撞 id 的新卡丢弃，绝不动原数据）
  ...CHARACTER_EXT_CARDS,
  ...CLOTHING_EXT_CARDS,
  ...ART_STYLE_EXT_CARDS,
  ...COLOR_EXT_CARDS,
  ...MATERIAL_EXT_CARDS,
  ...MOOD_EXT_CARDS,
  ...QUALITY_EXT_CARDS,
  ...PROPS_CARDS,
  ...PROPS_EXT_CARDS,
  ...EFFECTS_CARDS,
  ...EFFECTS_EXT_CARDS,
  ...DRESS_EXT_CARDS,
  ...CHINA_FEMALE_CARDS,
  ...CHINA_MALE_CARDS,
  ...SWIMWEAR_CARDS,
  ...WEDDING_CARDS,
  ...CHARACTER_EXT_POSE2,
  ...CHARACTER_EXT_HAIR_ANCIENT
];

/**
 * 分类重映射（2026-06-25）：
 *  ① 把「中国风女/男·泳衣·婚服」四个旧大类的卡片并入「服饰(clothing)」对应子分类；
 *  ② 把「年龄段(age-stage)」并入「性别·年龄段(gender-age)」。
 * 只改 cat/sub/id（旧 sub 前缀进 id 防撞），不动卡片文案；数据文件本身一律不改。
 * 旧 id 形如 `<cat>.<sub>.<slug>` → 取 `<slug>` 段，新 id = `新cat.新sub.<旧sub>-<slug>` 保证唯一。
 */
const CLOTHING_MERGE: Record<string, string> = {
  'china-female': 'china-female',
  'china-male': 'china-male',
  swimwear: 'swimwear',
  wedding: 'wedding'
};
function remapCard(c: PromptMallCard): PromptMallCard {
  const tail = c.id.split('.').slice(2).join('-') || c.sub;
  const clo = CLOTHING_MERGE[c.cat];
  if (clo) return { ...c, cat: 'clothing', sub: clo, id: `clothing.${clo}.${c.sub}-${tail}` };
  if (c.cat === 'character' && c.sub === 'age-stage') {
    return { ...c, sub: 'gender-age', id: `character.gender-age.as-${tail}` };
  }
  return c;
}

// 去重两道：① 按 id（任两个数据文件 id 撞了只留第一个）；② 按「同一(大类,子类)下中文名规范化后相同」
// 合并相同意思的提示词（如扩充时与既有卡撞了同名「盘腿坐」），原数据在前故保留首张。
const _seen = new Set<string>();
const _seenZh = new Set<string>();
const zhKey = (c: PromptMallCard): string =>
  `${c.cat}.${c.sub}.${(c.zh || '').trim().toLowerCase().replace(/\s+/g, '')}`;
export const PROMPT_MALL_CARDS: PromptMallCard[] = RAW.map(remapCard).filter((c) => {
  if (!c.id || _seen.has(c.id)) return false;
  if (c.zh && _seenZh.has(zhKey(c))) return false; // 同子类同中文名 = 相同意思，只留首张
  _seen.add(c.id);
  if (c.zh) _seenZh.add(zhKey(c));
  return true;
});

const BY_ID: Record<string, PromptMallCard> = Object.fromEntries(PROMPT_MALL_CARDS.map((c) => [c.id, c]));

export function promptMallCardById(id: string): PromptMallCard | undefined {
  return BY_ID[id];
}

/** 某大类下的全部卡片（可选限定子类）。 */
export function cardsOf(cat: string, sub?: string): PromptMallCard[] {
  return PROMPT_MALL_CARDS.filter((c) => c.cat === cat && (!sub || c.sub === sub));
}

/** 每个大类的卡片数（左侧分类栏角标用）。 */
export const PROMPT_MALL_CAT_COUNTS: Record<string, number> = (() => {
  const m: Record<string, number> = {};
  for (const cat of PROMPT_MALL_CATEGORIES) m[cat.slug] = 0;
  for (const c of PROMPT_MALL_CARDS) m[c.cat] = (m[c.cat] ?? 0) + 1;
  return m;
})();

/** 全库卡片总数。 */
export const PROMPT_MALL_TOTAL = PROMPT_MALL_CARDS.length;
