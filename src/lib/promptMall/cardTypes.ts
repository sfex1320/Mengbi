// 提示词商城（Prompt Mall）—— 卡片库类型 + 二级分类体系（大类 → 细分子类）。
// 卡片库是 app 自带的「只读数据」（仿 promptSeeds.ts，src/lib/promptMall/data/*.ts），不进数据库、零迁移。
// 用户新增的卡片另存 localStorage（useMallUserCardsStore）并在运行时与内置库合并。
// 每张卡是一个可组合的「提示词片段」：用户从卡片墙拖进购物车 → 自动排布 → 合成一条提示词喂下游。
// 缩略图：默认程序化 SVG（零版权、即用）；用户可用「开发模式」连 ComfyUI 节点按 genPrompt 批量生成真实缩略图，
// 按 <cardId>.png 落盘到「缩略图文件夹」后自动与卡片一一对应。

export type PromptMallLang = 'zh' | 'en';

/** 单张商城卡片（数据文件 src/lib/promptMall/data/*.ts 导出这个数组；用户卡片同形）。 */
export interface PromptMallCard {
  /** 全局唯一，小写 kebab，格式 `${cat}.${sub}.${slug}` */
  id: string;
  /** 大类 slug */
  cat: string;
  /** 子类 slug */
  sub: string;
  /** 中文片段（短的可组合短语，非整句） */
  zh: string;
  /** 英文片段（短的可组合 tag / 短语） */
  en: string;
  /** 自带的英文「生成提示词」——用于让用户自行批量生成该卡缩略图（ComfyUI / 绘画模型） */
  genPrompt: string;
  /** 用户卡片可自带缩略图 dataURI（新增卡片时拖入/粘贴/选文件，已压到 ≤256px，直接显示，无需缩略图文件夹） */
  thumb?: string;
}

/** 子类。 */
export interface PromptMallSub {
  slug: string;
  zh: string;
  en: string;
}

/** 大类（左侧分类栏），含若干子类 + 缩略图配色 + 线条图标 key。 */
export interface PromptMallCategory {
  slug: string;
  zh: string;
  en: string;
  /** 程序化缩略图渐变色（两端 hex） */
  grad: [string, string];
  /** 线条图标 key（见 PromptMallThumb 组件的内置 glyph 表） */
  glyph: string;
  subs: PromptMallSub[];
}

const S = (slug: string, zh: string, en: string): PromptMallSub => ({ slug, zh, en });

// ───────────────────────── 大类 × 细分子类（与 data/*.ts 的 cat/sub slug 严格对应）─────────────────────────

export const PROMPT_MALL_CATEGORIES: PromptMallCategory[] = [
  {
    slug: 'character', zh: '人物', en: 'Character', grad: ['#f4a98c', '#d96a8a'], glyph: 'person',
    subs: [
      // 「性别年龄」与「年龄段」原本两个子分类描述同一件事，已合并为一个（age-stage 卡片在 cards.ts 重映射进此 sub）
      S('gender-age', '性别·年龄段', 'Gender & Age'),
      S('face-shape', '脸型轮廓', 'Face Shape'),
      S('eyes', '眼睛', 'Eyes'),
      S('nose-mouth', '鼻嘴', 'Nose & Mouth'),
      S('skin', '肤质肤色', 'Skin'),
      S('hair-female', '女生发型', 'Female Hairstyle'),
      S('hair-male', '男生发型', 'Male Hairstyle'),
      S('hair-color', '发色', 'Hair Color'),
      S('expression', '表情', 'Expression'),
      S('emotion', '情绪', 'Emotion'),
      S('body-female', '女性身材', 'Female Body'),
      S('body-male', '男性身材', 'Male Body'),
      S('pose-static', '静态姿势', 'Standing Pose'),
      S('pose-action', '动作姿态', 'Action Pose'),
      S('hands', '手势', 'Hands & Gesture'),
      S('occupation', '职业身份', 'Occupation'),
      S('field', '学识·专业领域', 'Field & Expertise'),
      S('race', '种族幻想', 'Race & Fantasy'),
      S('temperament', '气质', 'Temperament')
    ]
  },
  {
    slug: 'clothing', zh: '服饰', en: 'Clothing', grad: ['#b18cf4', '#6a5ad9'], glyph: 'shirt',
    subs: [
      S('style-modern', '现代风格', 'Modern Style'),
      S('style-traditional', '传统古风', 'Traditional'),
      S('style-fantasy', '幻想风格', 'Fantasy Style'),
      S('top', '上装', 'Tops'),
      S('bottom', '下装', 'Bottoms'),
      S('dress', '连衣裙袍', 'Dresses & Robes'),
      S('outerwear', '外套', 'Outerwear'),
      S('footwear', '鞋履', 'Footwear'),
      S('headwear', '头饰帽', 'Headwear'),
      S('jewelry', '首饰', 'Jewelry'),
      S('bag', '包袋', 'Bags'),
      S('accessory', '其它配饰', 'Accessories'),
      S('fabric', '面料', 'Fabric'),
      S('pattern', '图案纹样', 'Patterns'),
      S('ethnic', '民族服饰', 'Ethnic'),
      S('uniform', '制服职业装', 'Uniform'),
      S('socks', '袜子', 'Socks & Hosiery'),
      S('suit', '套装', 'Suits & Sets'),
      S('gloves', '手套', 'Gloves'),
      // 中国风女/男·泳衣·婚服 原为独立大类，现并入「服饰」作子分类（卡片在 cards.ts 重映射进这几个 sub）
      S('china-female', '中国风·女', 'Chinese Female'),
      S('china-male', '中国风·男', 'Chinese Male'),
      S('swimwear', '泳衣', 'Swimwear'),
      S('wedding', '婚服', 'Wedding Attire')
    ]
  },
  {
    slug: 'props', zh: '道具元素', en: 'Props & Objects', grad: ['#d98c6a', '#9a5a3a'], glyph: 'box',
    subs: [
      S('weapon', '武器', 'Weapons'),
      S('instrument', '乐器', 'Instruments'),
      S('food', '食物饮品', 'Food & Drink'),
      S('tech', '科技产品', 'Tech & Gadgets'),
      S('daily', '日常物品', 'Daily Objects'),
      S('fantasy-item', '奇幻道具', 'Fantasy Items'),
      S('vehicle', '载具', 'Vehicles'),
      S('sports', '运动器材', 'Sports Gear')
    ]
  },
  {
    slug: 'art-style', zh: '画风', en: 'Art Style', grad: ['#4ec5c5', '#3a8fd9'], glyph: 'brush',
    subs: [
      S('anime', '二次元动漫', 'Anime'),
      S('manga', '漫画', 'Manga'),
      S('realistic', '写实摄影', 'Photorealistic'),
      S('cinematic', '电影感', 'Cinematic'),
      S('illustration', '插画', 'Illustration'),
      S('watercolor', '水彩', 'Watercolor'),
      S('oil', '油画', 'Oil Painting'),
      S('ink', '国风水墨', 'Chinese Ink'),
      S('render-3d', '3D渲染', '3D Render'),
      S('pixel', '像素复古', 'Pixel & Retro'),
      S('lineart', '线稿', 'Line Art'),
      S('concept', '概念艺术', 'Concept Art'),
      S('flat', '扁平矢量', 'Flat & Vector'),
      S('movement', '艺术流派', 'Art Movements'),
      S('game', '游戏美术', 'Game Art')
    ]
  },
  {
    slug: 'camera', zh: '镜头构图', en: 'Camera & Composition', grad: ['#8b9bb4', '#4a5a78'], glyph: 'camera',
    subs: [
      S('shot-size', '景别', 'Shot Size'),
      S('angle', '机位角度', 'Camera Angle'),
      S('composition', '构图法则', 'Composition'),
      S('lens', '镜头类型', 'Lens Type'),
      S('dof', '景深', 'Depth of Field'),
      S('focal', '焦距', 'Focal Length'),
      S('perspective', '透视', 'Perspective'),
      S('framing', '取景', 'Framing'),
      S('movement', '运镜', 'Camera Movement')
    ]
  },
  {
    slug: 'lighting', zh: '光线', en: 'Lighting', grad: ['#f4c84a', '#f08a2a'], glyph: 'sun',
    subs: [
      S('natural', '自然光', 'Natural Light'),
      S('golden', '黄金时刻', 'Golden Hour'),
      S('studio', '影棚布光', 'Studio Lighting'),
      S('dramatic', '戏剧光', 'Dramatic Light'),
      S('soft', '柔光', 'Soft Light'),
      S('neon', '霓虹光', 'Neon Light'),
      S('backlight', '逆光', 'Backlight'),
      S('effect', '特殊光效', 'Special FX'),
      S('time', '时间氛围光', 'Time & Ambient'),
      S('color-light', '色光', 'Colored Light')
    ]
  },
  {
    slug: 'color', zh: '色彩', en: 'Color', grad: ['#e84a9a', '#f0902a'], glyph: 'palette',
    subs: [
      S('tone-warm', '暖色调', 'Warm Tone'),
      S('tone-cool', '冷色调', 'Cool Tone'),
      S('scheme', '配色方案', 'Color Scheme'),
      S('dominant', '主色调', 'Dominant Color'),
      S('named', '命名色', 'Named Palette'),
      S('grade', '调色风格', 'Color Grading'),
      S('saturation', '饱和明度', 'Saturation'),
      S('mood-color', '情绪色', 'Mood Color')
    ]
  },
  {
    slug: 'material', zh: '质感材质', en: 'Texture & Material', grad: ['#c8a06a', '#8a6a3a'], glyph: 'cube',
    subs: [
      S('metal', '金属', 'Metal'),
      S('glass', '玻璃', 'Glass'),
      S('fabric', '织物', 'Fabric'),
      S('wood-stone', '木石', 'Wood & Stone'),
      S('organic', '有机材质', 'Organic'),
      S('liquid', '液体', 'Liquid'),
      S('render', '渲染质感', 'Render Texture'),
      S('craft', '工艺质感', 'Craft'),
      S('futuristic', '未来材质', 'Futuristic')
    ]
  },
  {
    slug: 'environment', zh: '环境场景', en: 'Environment', grad: ['#6ec57a', '#2a9d6a'], glyph: 'mountain',
    subs: [
      S('nature', '自然风光', 'Nature'),
      S('water', '水景', 'Water'),
      S('forest', '森林', 'Forest'),
      S('mountain', '山地', 'Mountain'),
      S('city-modern', '现代都市', 'Modern City'),
      S('city-old', '古镇老城', 'Old Town'),
      S('interior', '室内场景', 'Interior Scene'),
      S('fantasy', '幻想场景', 'Fantasy Scene'),
      S('scifi', '科幻场景', 'Sci-Fi Scene'),
      S('weather', '天气', 'Weather'),
      S('season', '季节', 'Season'),
      S('time', '时间', 'Time of Day'),
      S('sky', '天空', 'Sky')
    ]
  },
  {
    slug: 'interior', zh: '室内设计', en: 'Interior Design', grad: ['#d9c5a0', '#b09a6a'], glyph: 'sofa',
    subs: [
      S('nordic', '北欧侘寂', 'Nordic & Wabi'),
      S('modern', '现代简约', 'Modern'),
      S('classic', '古典轻奢', 'Classic'),
      S('asian', '中式日式', 'Asian'),
      S('living', '客厅', 'Living Room'),
      S('bedroom', '卧室', 'Bedroom'),
      S('kitchen', '厨卫', 'Kitchen & Bath'),
      S('office', '办公', 'Office'),
      S('commercial', '商业空间', 'Commercial'),
      S('decor', '软装陈设', 'Decor'),
      S('light', '室内光氛', 'Interior Lighting'),
      S('material', '室内材质', 'Interior Material')
    ]
  },
  {
    slug: 'nature-arch', zh: '动植物建筑', en: 'Nature & Architecture', grad: ['#9ec84e', '#4a8a2a'], glyph: 'leaf',
    subs: [
      S('pet', '宠物动物', 'Pets'),
      S('wild', '野生动物', 'Wildlife'),
      S('bird', '鸟类', 'Birds'),
      S('sea', '海洋生物', 'Sea Creatures'),
      S('plant', '植物花卉', 'Plants & Flowers'),
      S('tree', '树木', 'Trees'),
      S('arch-modern', '现代建筑', 'Modern Architecture'),
      S('arch-classic', '古典建筑', 'Classic Architecture'),
      S('arch-asian', '中式建筑', 'Asian Architecture'),
      S('landmark', '地标', 'Landmarks'),
      S('fantasy-arch', '幻想建筑', 'Fantasy Architecture'),
      S('structure', '结构细部', 'Structures')
    ]
  },
  {
    slug: 'mood', zh: '氛围情绪', en: 'Mood & Atmosphere', grad: ['#9a6ad9', '#5a3a9a'], glyph: 'spark',
    subs: [
      S('warm', '温暖治愈', 'Warm & Healing'),
      S('cold', '冷峻孤独', 'Cold & Lonely'),
      S('epic', '史诗宏大', 'Epic'),
      S('dreamy', '梦幻', 'Dreamy'),
      S('dark', '黑暗惊悚', 'Dark'),
      S('nostalgic', '怀旧复古', 'Nostalgic'),
      S('cinematic', '电影氛围', 'Cinematic Mood'),
      S('energetic', '活力', 'Energetic'),
      S('calm', '宁静', 'Calm')
    ]
  },
  {
    slug: 'effects', zh: '特效后期', en: 'Effects & Post', grad: ['#6ad9c5', '#9a5ad9'], glyph: 'spark',
    subs: [
      S('particle', '粒子', 'Particles'),
      S('smoke', '烟雾雾气', 'Smoke & Fog'),
      S('magic', '魔法能量', 'Magic & Energy'),
      S('fire', '火焰爆炸', 'Fire & Explosion'),
      S('film', '胶片颗粒', 'Film Grain'),
      S('glitch', '故障', 'Glitch'),
      S('light-fx', '光斑光效', 'Light FX'),
      S('weather-fx', '天气特效', 'Weather FX')
    ]
  },
  {
    slug: 'quality', zh: '质量参数', en: 'Quality & Parameters', grad: ['#a0a8b4', '#586074'], glyph: 'gauge',
    subs: [
      S('enhance', '画质增强', 'Quality Boosters'),
      S('detail', '细节强化', 'Detail'),
      S('resolution', '分辨率', 'Resolution'),
      S('engine', '渲染引擎', 'Render Engine'),
      S('lighting', '光照质量', 'Lighting Quality'),
      S('style-tag', '风格标签', 'Style Tags'),
      S('negative-common', '常用负面', 'Common Negatives'),
      S('negative-anatomy', '人体负面', 'Anatomy Negatives')
    ]
  }
];

/** 合成时的大类排序（一条合理的绘画提示词顺序：主体 → 服饰 → 场景 → 画风 → 镜头 → 光色 → 质感 → 氛围 → 质量）。 */
export const PROMPT_MALL_ASSEMBLY_ORDER: string[] = [
  'character', 'clothing', 'props',
  'nature-arch', 'environment', 'interior',
  'art-style', 'camera', 'lighting', 'color', 'material', 'mood', 'effects', 'quality'
];

/** 负面词卡片（合成时单独放到结尾的「负面：」行，不混进正向提示词）：quality 大类下 sub 以 negative 开头。 */
export function isNegativeCard(cat: string, sub: string): boolean {
  return cat === 'quality' && sub.startsWith('negative');
}

const CAT_BY_SLUG: Record<string, PromptMallCategory> = Object.fromEntries(
  PROMPT_MALL_CATEGORIES.map((c) => [c.slug, c])
);

export function promptMallCategory(slug: string): PromptMallCategory | undefined {
  return CAT_BY_SLUG[slug];
}

/** 大类显示名（按语言）。 */
export function catLabel(slug: string, lang: PromptMallLang): string {
  const c = CAT_BY_SLUG[slug];
  return c ? c[lang] : slug;
}

/** 子类显示名（按语言）。 */
export function subLabel(catSlug: string, subSlug: string, lang: PromptMallLang): string {
  const c = CAT_BY_SLUG[catSlug];
  const s = c?.subs.find((x) => x.slug === subSlug);
  return s ? s[lang] : subSlug;
}
