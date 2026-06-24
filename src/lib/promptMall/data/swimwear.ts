import type { PromptMallCard } from '../cardTypes';

// 泳衣。
export const SWIMWEAR_CARDS: PromptMallCard[] = [
  { id: 'swimwear.one-piece.classic', cat: 'swimwear', sub: 'one-piece', zh: '经典连体泳衣', en: 'classic one-piece', genPrompt: 'a person wearing a classic one-piece swimsuit, full body, smooth fitted silhouette' },
  { id: 'swimwear.one-piece.high-cut-leg', cat: 'swimwear', sub: 'one-piece', zh: '高叉连体泳衣', en: 'high-cut one-piece', genPrompt: 'a person wearing a high-cut leg one-piece swimsuit, full body, elongated leg line' },
  { id: 'swimwear.one-piece.scoop-back', cat: 'swimwear', sub: 'one-piece', zh: '低背连体泳衣', en: 'scoop-back one-piece', genPrompt: 'a person wearing a scoop-back one-piece swimsuit, full body, open rounded back' },
  { id: 'swimwear.one-piece.ruched', cat: 'swimwear', sub: 'one-piece', zh: '褶皱连体泳衣', en: 'ruched one-piece', genPrompt: 'a person wearing a ruched one-piece swimsuit, full body, gathered fabric along the waist' },
  { id: 'swimwear.one-piece.color-block', cat: 'swimwear', sub: 'one-piece', zh: '撞色连体泳衣', en: 'color-block one-piece', genPrompt: 'a person wearing a color-block one-piece swimsuit, full body, contrasting panels of color' },

  { id: 'swimwear.bikini.triangle', cat: 'swimwear', sub: 'bikini', zh: '三角比基尼', en: 'triangle bikini', genPrompt: 'a person wearing a triangle bikini, full body, slim adjustable string ties' },
  { id: 'swimwear.bikini.bandeau', cat: 'swimwear', sub: 'bikini', zh: '抹胸比基尼', en: 'bandeau bikini', genPrompt: 'a person wearing a bandeau bikini, full body, strapless straight neckline top' },
  { id: 'swimwear.bikini.halter', cat: 'swimwear', sub: 'bikini', zh: '挂脖比基尼', en: 'halter bikini', genPrompt: 'a person wearing a halter bikini, full body, neck-tie supported top' },
  { id: 'swimwear.bikini.high-waist', cat: 'swimwear', sub: 'bikini', zh: '高腰比基尼', en: 'high-waist bikini', genPrompt: 'a person wearing a high-waist bikini, full body, bottoms rising above the navel' },
  { id: 'swimwear.bikini.string', cat: 'swimwear', sub: 'bikini', zh: '系带比基尼', en: 'string bikini', genPrompt: 'a person wearing a string bikini, full body, side-tie knotted bottoms' },

  { id: 'swimwear.tankini.set', cat: 'swimwear', sub: 'tankini', zh: '坦基尼套装', en: 'tankini set', genPrompt: 'a person wearing a tankini set, full body, longline tank top over briefs' },
  { id: 'swimwear.tankini.top-with-shorts', cat: 'swimwear', sub: 'tankini', zh: '泳衣配短裤', en: 'swim top with shorts', genPrompt: 'a person wearing a swim top with shorts, full body, sporty fitted shorts paired below' },
  { id: 'swimwear.tankini.crop-top', cat: 'swimwear', sub: 'tankini', zh: '短款泳衣上衣', en: 'crop swim top', genPrompt: 'a person wearing a crop swim top, full body, midriff-baring cropped hem' },
  { id: 'swimwear.tankini.skirted', cat: 'swimwear', sub: 'tankini', zh: '裙式分体泳衣', en: 'skirted two-piece', genPrompt: 'a person wearing a skirted two-piece swimsuit, full body, soft swim skirt bottom' },
  { id: 'swimwear.tankini.ruffle', cat: 'swimwear', sub: 'tankini', zh: '荷叶边分体泳衣', en: 'ruffle two-piece', genPrompt: 'a person wearing a ruffle two-piece swimsuit, full body, layered frilled trim accents' },

  { id: 'swimwear.sporty.racerback', cat: 'swimwear', sub: 'sporty', zh: '工字背运动泳衣', en: 'racerback sport swimsuit', genPrompt: 'a person wearing a racerback sport swimsuit, full body, narrow straps meeting at center back' },
  { id: 'swimwear.sporty.zip-front', cat: 'swimwear', sub: 'sporty', zh: '拉链运动泳衣', en: 'zip-front swimsuit', genPrompt: 'a person wearing a zip-front swimsuit, full body, front zipper running up the chest' },
  { id: 'swimwear.sporty.athletic-two-piece', cat: 'swimwear', sub: 'sporty', zh: '运动两件套泳衣', en: 'athletic two-piece', genPrompt: 'a person wearing an athletic two-piece swimsuit, full body, supportive sports-style top' },
  { id: 'swimwear.sporty.rash-guard-set', cat: 'swimwear', sub: 'sporty', zh: '防晒衣套装', en: 'rash guard set', genPrompt: 'a person wearing a rash guard set, full body, long-sleeve fitted top with matching bottoms' },
  { id: 'swimwear.sporty.competition', cat: 'swimwear', sub: 'sporty', zh: '竞技泳衣', en: 'competition swimsuit', genPrompt: 'a person wearing a competition swimsuit, full body, streamlined high-compression cut' },

  { id: 'swimwear.men.briefs', cat: 'swimwear', sub: 'men', zh: '三角泳裤', en: 'swim briefs', genPrompt: 'a man wearing swim briefs, full body, snug low-rise fitted cut' },
  { id: 'swimwear.men.trunks', cat: 'swimwear', sub: 'men', zh: '平角泳裤', en: 'swim trunks', genPrompt: 'a man wearing swim trunks, full body, mid-thigh elasticated waistband' },
  { id: 'swimwear.men.board-shorts', cat: 'swimwear', sub: 'men', zh: '冲浪短裤', en: 'board shorts', genPrompt: 'a man wearing board shorts, full body, long knee-length surf shorts' },
  { id: 'swimwear.men.jammers', cat: 'swimwear', sub: 'men', zh: '及膝泳裤', en: 'jammers', genPrompt: 'a man wearing jammers, full body, knee-length tight racing shorts' },
  { id: 'swimwear.men.square-leg', cat: 'swimwear', sub: 'men', zh: '四角泳裤', en: 'square-leg swim shorts', genPrompt: 'a man wearing square-leg swim shorts, full body, short fitted square-cut legs' },

  { id: 'swimwear.vintage.retro-high-waist', cat: 'swimwear', sub: 'vintage', zh: '复古高腰泳装', en: 'retro high-waist swimsuit', genPrompt: 'a person wearing a retro high-waist swimsuit, full body, classic raised waistline' },
  { id: 'swimwear.vintage.pin-up-1950s', cat: 'swimwear', sub: 'vintage', zh: '五十年代复古泳装', en: '1950s pin-up swimsuit', genPrompt: 'a person wearing a 1950s pin-up swimsuit, full body, sweetheart neckline and structured cups' },
  { id: 'swimwear.vintage.polka-dot-two-piece', cat: 'swimwear', sub: 'vintage', zh: '波点复古分体泳装', en: 'polka-dot vintage two-piece', genPrompt: 'a person wearing a polka-dot vintage two-piece swimsuit, full body, classic dotted print' },
  { id: 'swimwear.vintage.halter-retro-one-piece', cat: 'swimwear', sub: 'vintage', zh: '挂脖复古连体泳装', en: 'halter retro one-piece', genPrompt: 'a person wearing a halter retro one-piece swimsuit, full body, neck-tied vintage silhouette' },
  { id: 'swimwear.vintage.ruched-vintage', cat: 'swimwear', sub: 'vintage', zh: '褶皱复古泳装', en: 'ruched vintage swimsuit', genPrompt: 'a person wearing a ruched vintage swimsuit, full body, gathered retro side draping' },
];
