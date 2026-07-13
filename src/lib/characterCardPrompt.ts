/**
 * 角色卡节点提示词（纯函数，配 characterCardPrompt.test.ts）。
 *
 * 两步流水（runner 的 runCharacterCardNode 调用）：
 * ① characterAnalysisSystem(subject)：视觉模型分析照片 → 极详细外观分析
 *   （人物：五官/发色发型/衣着/妆容/配饰；动物：品种/毛色花纹/头部特征/尾巴四肢/配饰，越细越好）；
 * ② characterSheetSystem(sheetType, cardStyle, subject)：对话模型把「外观分析 + 用户简述」组装成
 *   指定输出类型的生图提示词——完整设定卡（card，按 cardStyle 版面）/ 三视图（turnaround）/
 *   面部特写（face）/ 表情九宫格（expressions）/ 身材比例（body）/ 动作姿势（pose）
 *   → 交给下游生图模型出图。人物 / 动物（subject）各有适配版面文案。
 */
import type { CharacterCardStyle, CharacterSheetType, CharacterSubjectType } from '@shared/smartCanvas';

/** 版面风格选项（仅 sheetType='card' 生效；value 持久化进节点，label 展示，hint 悬停说明）。 */
export const CARD_STYLES: Array<{ value: CharacterCardStyle; label: string; hint: string }> = [
  { value: 'magazine', label: '时尚杂志', hint: '白底衬线大标题、三视图 + 表情九宫格 + 服装拆解 + 色板，杂志编排感' },
  { value: 'journal', label: '手账拼贴', hint: '米色纸张质感、胶带贴纸手写注记，表情 / 姿势 / 随身物品拼贴' },
  { value: 'photoset', label: '写真设定集', hint: '高密度写实照片网格：姿势探索 / 五官比例 / 妆造变化 / 材质氛围' },
  { value: 'minimal', label: '简约设计稿', hint: '干净留白的设定稿版式：三视图 / 表情 / 色板等核心区块' }
];

/** 输出类型选项（导出什么图的提示词）。 */
export const SHEET_TYPES: Array<{ value: CharacterSheetType; label: string; hint: string }> = [
  { value: 'card', label: '设定卡', hint: '完整角色设定卡版面（三视图/表情/拆解/色板…，可选下方版面风格）' },
  { value: 'turnaround', label: '三视图', hint: '正面/侧面/背面 全身三视图，浅色影棚底，建模/多视角参考' },
  { value: 'face', label: '面部特写', hint: '大幅正面特写 + 45°/正侧 + 眼唇局部放大，五官细节参考' },
  { value: 'expressions', label: '表情九宫', hint: '3×3 九宫格：同一角色九种表情/神态，构图一致' },
  { value: 'body', label: '身材比例', hint: '正面+侧面全身立姿，头身比/比例参考线，体型参考' },
  { value: 'pose', label: '动作姿势', hint: '6-9 个全身动作姿势网格：站/走/跑/坐/回眸…' }
];

/** 主体类型选项。 */
export const SUBJECT_TYPES: Array<{ value: CharacterSubjectType; label: string; hint: string }> = [
  { value: 'person', label: '人物', hint: '真人/人形角色：五官、发型、衣着、妆容、配饰' },
  { value: 'animal', label: '动物', hint: '宠物/生物角色：品种、毛色花纹、头部特征、尾巴四肢' }
];

/** style value → 中文名；未知/空回退「时尚杂志」。 */
export function cardStyleLabel(v?: string): string {
  return CARD_STYLES.find((s) => s.value === (v ?? '').trim())?.label ?? CARD_STYLES[0].label;
}

/** sheetType value → 中文名；未知/空回退「设定卡」。 */
export function sheetTypeLabel(v?: string): string {
  return SHEET_TYPES.find((s) => s.value === (v ?? '').trim())?.label ?? SHEET_TYPES[0].label;
}

/** 第 ① 步：照片 → 极详细外观分析（视觉模型 systemPrompt；人物 / 动物 各一套）。 */
export function characterAnalysisSystem(subject: CharacterSubjectType = 'person'): string {
  if (subject === 'animal') {
    return (
      '你是资深动物角色设定师。给定一张动物照片（可能附带用户的文字补充），输出一段极其详细的中文动物外观分析，依次覆盖：' +
      '①物种与品种（或最接近的品种特征）；' +
      '②体型与身形：体长/肩高体感、胖瘦、肌肉或绒感；' +
      '③毛色与花纹：底色、斑纹分布与走向、渐变（可给近似色值），毛发质感（长短/卷直/蓬松/顺滑）；' +
      '④头部特征：眼睛（颜色/形状/神态）、耳朵（形状/立垂）、口鼻、胡须；' +
      '⑤尾巴与四肢：长度、形态、爪部特征；' +
      '⑥配饰与随身物（项圈/铃铛/牵绳/衣物等，若有）；' +
      '⑦神态气质关键词。' +
      '描述要具体到可以据此稳定复现同一只动物。只输出分析文本本身，不要解说、不要 Markdown、不要列表符号。'
    );
  }
  return (
    '你是资深角色设定师与形象分析师。给定一张人物照片（可能附带用户的文字补充），输出一段极其详细的中文人物外貌分析，依次覆盖：' +
    '①脸型与五官：脸型轮廓、眉形、眼型与眼神、鼻、唇形与唇色、眉宇间的气质；' +
    '②发色与发型：颜色、长度、卷直、刘海与层次；' +
    '③肤色与质感；' +
    '④体型与比例：身高体感、身材线条；' +
    '⑤衣着：每件单品的款式、材质、颜色、剪裁细节与层次搭配；' +
    '⑥妆容：底妆、眼妆、腮红、唇妆；' +
    '⑦配饰：首饰、发饰、包袋、鞋履等；' +
    '⑧整体配色（主要颜色，可给近似色值）与气质关键词。' +
    '描述要具体到可以据此稳定复现同一个角色。只输出分析文本本身，不要解说、不要 Markdown、不要列表符号。'
  );
}

/** 各版面风格的画面描述段（sheetType='card' 时拼进第 ② 步系统提示词）。 */
const STYLE_BLOCKS: Record<CharacterCardStyle, string> = {
  magazine:
    '版面风格为时尚杂志角色档案页：纯白或浅色底、顶部大号衬线字体角色名 + 「CHARACTER PROFILE」小字与编号，排版克制高级。' +
    '分区包含：左栏基本信息（角色名/职业/年龄/身高/生日/星座/外貌特征/气质关键词，中英混排小字）；' +
    '中部全身三视图（正面/侧面/背面并排站立，FRONT/SIDE/BACK 标注）；右侧表情九宫格（平静/微笑/眨眼/认真/惊讶/思考等，每格下有中英标注）；' +
    '下方横排：服装拆解（单品平铺 OUTFIT BREAKDOWN）、配饰（ACCESSORIES）、细节特写（眼妆/唇妆/衣料 DETAIL CLOSE-UP）、色板（COLOR PALETTE 色块附 HEX 色值）；' +
    '底部角色介绍短文 + 关键词标签 + 手写体签名（SIGNATURE）。',
  journal:
    '版面风格为米白纸张质感的手账拼贴角色设定图：左上大幅人物半身照，手写体角色名（中英），装饰性胶带、贴纸、蝴蝶结与星星涂鸦。' +
    '分区包含：角色表情网格（开心/生气/困倦/惊讶/思考/难过/害羞/平静，每格下方中文小字标注）；' +
    '撕边便签纸上的角色简介（姓名/年龄/生日/职业/身高/性格关键词与性格介绍）；' +
    '动作姿势区（奔跑/蹲下逗猫/玩耍等全身小图并标注）；随身物品区（速写本/相机/饮品/耳机/包袋等贴纸式小图标并标注）；' +
    '配色方案色块（附 HEX 色值）；气质关键词胶囊标签；底部一句角色语录。',
  photoset:
    '版面风格为高密度写实人物写真设定集（CHARACTER REFERENCE）：整版由大量同一人物的写实照片网格拼成，光线与色调统一。' +
    '分区包含：左上标题与 PROFILE 信息（年龄/身高/体重/风格/性格/CONCEPT 一句话）；全身三视图（front/side/back）；' +
    '姿势探索网格（POSE EXPLORATION 多种坐卧站姿）；面部多角度（正面/45°/侧颜）；身体细节局部（腰线/手/脚踝/背肩 BODY DETAILS）；' +
    '面部比例线稿（FACE PROPORTION）；眼部与唇部特写（附色阶小色板）；妆容变化四连（MAKEUP VARIATIONS）；发型设计三连（HAIRSTYLE DESIGN）；' +
    '服装拆解与材质小样（OUTFIT BREAKDOWN / FABRIC & TEXTURE）；氛围小图（MOOD & ATMOSPHERE）。',
  minimal:
    '版面风格为干净留白的简约角色设定稿：浅色底、细线分区、信息层级清晰。' +
    '分区包含：角色名与一句话简介；全身三视图（正/侧/背）；6-9 格表情；服装与配饰平铺拆解；配色色板（附 HEX 色值）；气质关键词标签。'
};

/** 非 card 输出类型的版面描述段（人物版）。 */
const SHEET_BLOCKS_PERSON: Record<Exclude<CharacterSheetType, 'card'>, string> = {
  turnaround:
    '画面为角色三视图（character turnaround sheet）：同一角色的 正面、侧面、背面 三个全身立姿并排站立、间距均匀，' +
    '纯白或浅灰影棚背景，FRONT/SIDE/BACK 小字标注；三个视图的身高、体型、发型、服装完全一致，' +
    '光线均匀无强投影，全身完整入画（头到脚），轮廓与细节清晰，适合作建模与多视角绘画参考。',
  face:
    '画面为角色面部特写参考页（face close-up sheet）：左侧一幅大尺寸正面面部特写（约占半版，五官、妆容、皮肤质感、眼神细节纤毫毕现），' +
    '右侧纵向排列 45° 侧脸与正侧颜两幅特写；下方一行局部放大：眼部特写、唇部特写、发际与耳饰细节；' +
    '所有面部均为同一角色，柔和均匀的影棚光，背景素净浅色。',
  expressions:
    '画面为角色表情九宫格（expression sheet）：3×3 网格，九个同一角色的头肩部表情——平静、微笑、大笑、生气、难过、惊讶、害羞、思考、眨眼；' +
    '每格构图一致（正面头肩、同一发型与服装）、纯色浅底、格间留白均匀，每格下方带小字表情标注。',
  body:
    '画面为角色身材比例图（body proportion sheet）：同一角色的 正面全身立姿 与 侧面全身立姿 并排，' +
    '穿贴身简洁的服装以清晰呈现体型轮廓；背景带淡淡的水平比例参考线与头身比标注（如 7.5 头身）及身高标注；' +
    '光线均匀、背景中性浅色，肩腰臀比例与体型特征需与外观分析一致。',
  pose:
    '画面为角色动作姿势探索页（pose exploration sheet）：同一角色、同一服装的 6-9 个全身动作姿势排成网格——' +
    '站立、行走、奔跑、坐姿、蹲下、回眸、伸展、跳跃等（按角色气质选取）；每格全身完整、比例一致，' +
    '浅色背景，姿势自然有动感，每格可带小字动作标注。'
};

/** 非 card 输出类型的版面描述段（动物版）。 */
const SHEET_BLOCKS_ANIMAL: Record<Exclude<CharacterSheetType, 'card'>, string> = {
  turnaround:
    '画面为动物三视图（animal turnaround sheet）：同一只动物的 正面、侧面、背面 三个全身站姿并排、间距均匀，' +
    '纯白或浅灰影棚背景，FRONT/SIDE/BACK 小字标注；三个视图的体型、毛色与花纹分布完全一致，' +
    '光线均匀无强投影，全身完整入画（含尾巴），毛发质感清晰，适合作建模与多视角绘画参考。',
  face:
    '画面为动物头部特写参考页（head close-up sheet）：左侧一幅大尺寸正面头部特写（眼睛、口鼻、胡须、毛发质感纤毫毕现），' +
    '右侧纵向排列 45° 与正侧两幅头部特写；下方一行局部放大：眼部特写、口鼻特写、耳部与花纹细节；' +
    '所有头部均为同一只动物，柔和均匀光线，背景素净浅色。',
  expressions:
    '画面为动物神态九宫格（expression sheet）：3×3 网格，九个同一只动物的头颈部神态——放松、开心、好奇、警觉、困倦、撒娇、专注、惊讶、打哈欠；' +
    '每格构图一致（正面头颈、同一毛色花纹）、纯色浅底、格间留白均匀，每格下方带小字神态标注。',
  body:
    '画面为动物体型图（body proportion sheet）：同一只动物的 侧面全身站姿 与 正面全身站姿 并排，' +
    '背景带淡淡的水平比例参考线与 肩高/体长 标注；光线均匀、背景中性浅色，' +
    '体型胖瘦、四肢与尾巴形态、毛色花纹分布需与外观分析一致。',
  pose:
    '画面为动物动作姿势页（pose exploration sheet）：同一只动物的 6-9 个全身动作排成网格——' +
    '站立、行走、奔跑、坐下、趴卧、跳跃、玩耍、伸懒腰等（按物种习性选取）；每格全身完整、比例一致，' +
    '浅色背景，动作自然生动，每格可带小字动作标注。'
};

/** 第 ② 步通用包装：声明 + 版面段 + 一致性 + 画质，输出单段连续提示词。 */
function wrapSheetSystem(decl: string, block: string, consistency: string): string {
  return (
    '你是资深 AI 绘画提示词工程师，擅长角色参考图（character reference）类构图。' +
    '用户给你一段角色外观分析（可能附用户补充描述），请把它组装成一条可直接喂给绘画模型的中文生图提示词，' +
    `用于生成${decl}。要求：` +
    `①提示词开头声明画面类型；②${block}` +
    `③${consistency}` +
    '④给出整体画质与风格词（高清、细节丰富、排版精致等）。' +
    '只输出这条提示词本身：单段连续文本，不要解释、不要 Markdown、不要列表符号、不要换行。'
  );
}

/**
 * 第 ② 步：外观分析 + 用户简述 → 指定输出类型的生图提示词（对话模型 systemPrompt）。
 * sheetType='card' 走 cardStyle 版面（动物时自动把 服装拆解/妆容 等分区按物种合理化）；
 * 其余输出类型（三视图/面部特写/表情九宫格/身材比例/动作姿势）各有 人物/动物 两套版面段。
 */
export function characterSheetSystem(
  sheet: CharacterSheetType,
  style: CharacterCardStyle,
  subject: CharacterSubjectType = 'person'
): string {
  const isAnimal = subject === 'animal';
  const consistency = isAnimal
    ? '把外观分析里的动物特征（品种/体型/毛色花纹/头部特征/尾巴四肢/配饰）完整、具体地写进提示词，并强调画面内所有分区、所有格子中都是**同一只动物、外观完全一致**；'
    : '把外观分析里的角色特征（五官/发色发型/衣着/妆容/配饰/配色）完整、具体地写进提示词，并强调画面内所有分区、所有格子中的人物都是**同一个角色、外观完全一致**；';
  if (sheet === 'card' || !(sheet in SHEET_BLOCKS_PERSON)) {
    const block = STYLE_BLOCKS[style] ?? STYLE_BLOCKS.magazine;
    const animalAdapt = isAnimal
      ? '主体是动物角色：把版面中的 服装拆解 改为 配饰与随身物品（项圈/铃铛/牵绳等），妆容/发型细节 改为 毛发与花纹质感特写，人物信息栏改为 物种/品种/性格 等动物信息，其余分区同理按动物合理化。'
      : '';
    return wrapSheetSystem(
      '**一整张**角色设定卡 / 角色参考设定页（character reference sheet）的完整版面设计图',
      block + animalAdapt,
      consistency
    );
  }
  const blocks = isAnimal ? SHEET_BLOCKS_ANIMAL : SHEET_BLOCKS_PERSON;
  const label = sheetTypeLabel(sheet);
  return wrapSheetSystem(`一张角色「${label}」参考图`, blocks[sheet as Exclude<CharacterSheetType, 'card'>], consistency);
}

/** 旧签名兼容（= characterSheetSystem('card', style, subject)）；测试与外部引用可继续使用。 */
export function characterCardSystem(style: CharacterCardStyle, subject: CharacterSubjectType = 'person'): string {
  return characterSheetSystem('card', style, subject);
}
