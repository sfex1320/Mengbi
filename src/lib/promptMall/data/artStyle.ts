import type { PromptMallCard } from '../cardTypes';

// 画风（art-style）卡片：PROFILE=demo —— 画风即主体，用同一参考主体「年轻女性半身像」呈现各画风，便于横向比较。
// genPrompt 描述画风本身，不写背景/布光/画质（共用风格包装在生成时补上）。全部原创片段、版权安全（用艺术流派/年代/通用描述，不点名在世艺术家或品牌/IP）。

export const ART_STYLE_CARDS: PromptMallCard[] = [
  // ── anime 二次元动漫 ──
  { id: 'art-style.anime.cel-shaded', cat: 'art-style', sub: 'anime', zh: '赛璐璐动画', en: 'cel-shaded anime', genPrompt: 'a bust portrait of a young woman in cel-shaded anime style, flat color fills, crisp ink outlines, glossy highlights' },
  { id: 'art-style.anime.modern-anime', cat: 'art-style', sub: 'anime', zh: '现代日漫', en: 'modern anime', genPrompt: 'a bust portrait of a young woman in modern anime style, clean lineart, soft gradient shading, large expressive eyes' },
  { id: 'art-style.anime.retro-90s', cat: 'art-style', sub: 'anime', zh: '九十年代动画', en: 'retro 90s anime', genPrompt: 'a bust portrait of a young woman in retro 1990s anime style, muted film grain, hand painted cels, soft analog colors' },
  { id: 'art-style.anime.moe', cat: 'art-style', sub: 'anime', zh: '萌系', en: 'moe anime', genPrompt: 'a bust portrait of a young woman in moe anime style, rounded soft features, pastel palette, big sparkling eyes' },
  { id: 'art-style.anime.shonen', cat: 'art-style', sub: 'anime', zh: '热血少年风', en: 'shonen anime', genPrompt: 'a bust portrait of a young woman in shonen anime style, bold dynamic lines, sharp angular shapes, high energy' },
  { id: 'art-style.anime.shojo', cat: 'art-style', sub: 'anime', zh: '少女漫画风', en: 'shojo anime', genPrompt: 'a bust portrait of a young woman in shojo anime style, delicate lines, floral accents, dreamy soft shading' },
  { id: 'art-style.anime.chibi', cat: 'art-style', sub: 'anime', zh: 'Q版萌', en: 'chibi', genPrompt: 'a bust portrait of a young woman in chibi style, oversized head, tiny body, huge round eyes, cute proportions' },
  { id: 'art-style.anime.semi-realistic', cat: 'art-style', sub: 'anime', zh: '半写实日系', en: 'semi-realistic anime', genPrompt: 'a bust portrait of a young woman in semi realistic anime style, anime features with detailed soft skin shading' },
  { id: 'art-style.anime.webtoon', cat: 'art-style', sub: 'anime', zh: '韩系条漫', en: 'webtoon style', genPrompt: 'a bust portrait of a young woman in korean webtoon style, smooth soft shading, clean modern lines, bright clear colors' },
  { id: 'art-style.anime.dark-anime', cat: 'art-style', sub: 'anime', zh: '暗黑系动画', en: 'dark gritty anime', genPrompt: 'a bust portrait of a young woman in dark gritty anime style, heavy shadows, desaturated palette, tense mood' },

  // ── manga 漫画 ──
  { id: 'art-style.manga.screentone', cat: 'art-style', sub: 'manga', zh: '网点漫画', en: 'screentone manga', genPrompt: 'a bust portrait of a young woman in black and white manga style, halftone screentone shading, bold ink lines' },
  { id: 'art-style.manga.shonen-manga', cat: 'art-style', sub: 'manga', zh: '少年漫画', en: 'shonen manga', genPrompt: 'a bust portrait of a young woman in shonen manga style, dynamic speed lines, bold inking, high contrast' },
  { id: 'art-style.manga.shojo-manga', cat: 'art-style', sub: 'manga', zh: '少女漫画', en: 'shojo manga', genPrompt: 'a bust portrait of a young woman in shojo manga style, delicate linework, sparkles and flowers, airy white space' },
  { id: 'art-style.manga.seinen', cat: 'art-style', sub: 'manga', zh: '青年漫画', en: 'seinen manga', genPrompt: 'a bust portrait of a young woman in seinen manga style, detailed realistic inking, mature restrained tone, fine hatching' },
  { id: 'art-style.manga.gekiga', cat: 'art-style', sub: 'manga', zh: '剧画', en: 'gekiga style', genPrompt: 'a bust portrait of a young woman in gekiga style, gritty dramatic realism, heavy cross hatching, strong ink contrast' },
  { id: 'art-style.manga.yonkoma', cat: 'art-style', sub: 'manga', zh: '四格漫画', en: 'yonkoma manga', genPrompt: 'a bust portrait of a young woman in simple yonkoma comic style, flat expressive face, clean light gag tone' },
  { id: 'art-style.manga.ink-wash-manga', cat: 'art-style', sub: 'manga', zh: '水墨漫画', en: 'ink wash manga', genPrompt: 'a bust portrait of a young woman in ink wash manga style, loose brush inking, grey wash tones, expressive strokes' },
  { id: 'art-style.manga.chibi-manga', cat: 'art-style', sub: 'manga', zh: 'Q版漫画', en: 'chibi manga', genPrompt: 'a bust portrait of a young woman in chibi manga style, super deformed proportions, simple bold lines, playful look' },
  { id: 'art-style.manga.horror-manga', cat: 'art-style', sub: 'manga', zh: '恐怖漫画', en: 'horror manga', genPrompt: 'a bust portrait of a young woman in horror manga style, dense scratchy hatching, unsettling fine detail, deep blacks' },
  { id: 'art-style.manga.sketch-manga', cat: 'art-style', sub: 'manga', zh: '草稿漫画', en: 'rough sketch manga', genPrompt: 'a bust portrait of a young woman in rough sketch manga style, loose pencil lines, unrefined energetic strokes' },

  // ── realistic 写实摄影 ──
  { id: 'art-style.realistic.studio-photo', cat: 'art-style', sub: 'realistic', zh: '影棚写真', en: 'studio photo', genPrompt: 'a photorealistic bust portrait of a young woman, studio photography look, crisp detail, lifelike skin' },
  { id: 'art-style.realistic.dslr-portrait', cat: 'art-style', sub: 'realistic', zh: '单反人像', en: 'dslr portrait', genPrompt: 'a photorealistic bust portrait of a young woman, dslr portrait look, shallow depth of field, sharp eyes' },
  { id: 'art-style.realistic.editorial', cat: 'art-style', sub: 'realistic', zh: '杂志写真', en: 'editorial photography', genPrompt: 'a photorealistic bust portrait of a young woman, fashion editorial photography look, polished and refined' },
  { id: 'art-style.realistic.analog-film', cat: 'art-style', sub: 'realistic', zh: '胶片质感', en: 'analog film', genPrompt: 'a photorealistic bust portrait of a young woman, analog film photography look, fine grain, soft faded colors' },
  { id: 'art-style.realistic.polaroid', cat: 'art-style', sub: 'realistic', zh: '拍立得', en: 'instant polaroid', genPrompt: 'a photorealistic bust portrait of a young woman, instant polaroid look, washed colors, soft vignette, casual feel' },
  { id: 'art-style.realistic.documentary', cat: 'art-style', sub: 'realistic', zh: '纪实摄影', en: 'documentary photo', genPrompt: 'a photorealistic bust portrait of a young woman, candid documentary photography look, natural and unposed' },
  { id: 'art-style.realistic.hyperreal', cat: 'art-style', sub: 'realistic', zh: '超写实', en: 'hyperrealistic', genPrompt: 'a hyperrealistic bust portrait of a young woman, ultra detailed pores and texture, lifelike rendering' },
  { id: 'art-style.realistic.black-white-photo', cat: 'art-style', sub: 'realistic', zh: '黑白摄影', en: 'black and white photo', genPrompt: 'a photorealistic black and white bust portrait of a young woman, rich tonal range, classic monochrome look' },
  { id: 'art-style.realistic.beauty-retouch', cat: 'art-style', sub: 'realistic', zh: '精修美颜', en: 'retouched beauty', genPrompt: 'a photorealistic bust portrait of a young woman, retouched beauty look, smooth flawless skin, glossy detail' },
  { id: 'art-style.realistic.vintage-photo', cat: 'art-style', sub: 'realistic', zh: '复古老照片', en: 'vintage photo', genPrompt: 'a photorealistic bust portrait of a young woman, vintage sepia photo look, aged tones, nostalgic feel' },

  // ── cinematic 电影感 ──
  { id: 'art-style.cinematic.teal-orange', cat: 'art-style', sub: 'cinematic', zh: '青橙大片', en: 'teal and orange film', genPrompt: 'a cinematic bust portrait of a young woman, teal and orange blockbuster color grade, filmic contrast' },
  { id: 'art-style.cinematic.film-noir', cat: 'art-style', sub: 'cinematic', zh: '黑色电影', en: 'film noir', genPrompt: 'a cinematic black and white bust portrait of a young woman, film noir look, hard shadows, moody high contrast' },
  { id: 'art-style.cinematic.neo-noir', cat: 'art-style', sub: 'cinematic', zh: '新黑色', en: 'neo-noir', genPrompt: 'a cinematic bust portrait of a young woman, neo noir look, neon-tinged shadows, rain-soaked moody atmosphere' },
  { id: 'art-style.cinematic.epic-fantasy', cat: 'art-style', sub: 'cinematic', zh: '史诗奇幻', en: 'epic fantasy film', genPrompt: 'a cinematic bust portrait of a young woman, epic fantasy film look, grand dramatic tone, rich painterly color' },
  { id: 'art-style.cinematic.sci-fi-film', cat: 'art-style', sub: 'cinematic', zh: '科幻电影', en: 'sci-fi film', genPrompt: 'a cinematic bust portrait of a young woman, sci fi film look, cool metallic tones, sleek futuristic mood' },
  { id: 'art-style.cinematic.technicolor', cat: 'art-style', sub: 'cinematic', zh: '复古特艺彩色', en: 'vintage technicolor', genPrompt: 'a cinematic bust portrait of a young woman, vintage technicolor look, vivid saturated hues, classic glamour' },
  { id: 'art-style.cinematic.gritty-drama', cat: 'art-style', sub: 'cinematic', zh: '写实剧情', en: 'gritty drama', genPrompt: 'a cinematic bust portrait of a young woman, gritty drama film look, desaturated naturalistic tones, raw mood' },
  { id: 'art-style.cinematic.dreamy-romance', cat: 'art-style', sub: 'cinematic', zh: '梦幻爱情片', en: 'dreamy romance film', genPrompt: 'a cinematic bust portrait of a young woman, dreamy romance film look, warm glow, soft hazy bloom' },
  { id: 'art-style.cinematic.horror-film', cat: 'art-style', sub: 'cinematic', zh: '恐怖电影', en: 'horror film', genPrompt: 'a cinematic bust portrait of a young woman, horror film look, sickly green tint, deep ominous shadows' },
  { id: 'art-style.cinematic.western-film', cat: 'art-style', sub: 'cinematic', zh: '西部片', en: 'western film', genPrompt: 'a cinematic bust portrait of a young woman, spaghetti western film look, dusty warm tones, sun-bleached grade' },

  // ── illustration 插画 ──
  { id: 'art-style.illustration.childrens-book', cat: 'art-style', sub: 'illustration', zh: '童书插画', en: 'childrens book illustration', genPrompt: 'a bust portrait of a young woman in childrens book illustration style, soft rounded shapes, gentle warm colors' },
  { id: 'art-style.illustration.storybook', cat: 'art-style', sub: 'illustration', zh: '绘本风', en: 'storybook illustration', genPrompt: 'a bust portrait of a young woman in storybook illustration style, whimsical textured brushwork, cozy palette' },
  { id: 'art-style.illustration.vintage-poster', cat: 'art-style', sub: 'illustration', zh: '复古海报', en: 'vintage poster illustration', genPrompt: 'a bust portrait of a young woman in vintage poster illustration style, bold flat shapes, limited retro palette' },
  { id: 'art-style.illustration.editorial-illustration', cat: 'art-style', sub: 'illustration', zh: '编辑插画', en: 'editorial illustration', genPrompt: 'a bust portrait of a young woman in modern editorial illustration style, stylized shapes, confident flat color' },
  { id: 'art-style.illustration.fantasy-illustration', cat: 'art-style', sub: 'illustration', zh: '奇幻插画', en: 'fantasy illustration', genPrompt: 'a bust portrait of a young woman in fantasy illustration style, painterly detail, magical rich color' },
  { id: 'art-style.illustration.retro-pulp', cat: 'art-style', sub: 'illustration', zh: '复古通俗', en: 'retro pulp illustration', genPrompt: 'a bust portrait of a young woman in retro pulp illustration style, bold inked shapes, warm aged tones' },
  { id: 'art-style.illustration.gouache', cat: 'art-style', sub: 'illustration', zh: '水粉插画', en: 'gouache illustration', genPrompt: 'a bust portrait of a young woman in gouache illustration style, matte opaque paint, visible brush texture' },
  { id: 'art-style.illustration.digital-painterly', cat: 'art-style', sub: 'illustration', zh: '数字厚涂', en: 'digital painterly', genPrompt: 'a bust portrait of a young woman in digital painterly illustration style, loose visible brush strokes, rich blending' },
  { id: 'art-style.illustration.ink-and-color', cat: 'art-style', sub: 'illustration', zh: '勾线填色', en: 'ink and color illustration', genPrompt: 'a bust portrait of a young woman in ink and color illustration style, clean ink outlines, flat bright fills' },
  { id: 'art-style.illustration.collage', cat: 'art-style', sub: 'illustration', zh: '拼贴插画', en: 'collage illustration', genPrompt: 'a bust portrait of a young woman in cut paper collage illustration style, layered textured shapes, playful look' },

  // ── watercolor 水彩 ──
  { id: 'art-style.watercolor.wet-on-wet', cat: 'art-style', sub: 'watercolor', zh: '湿画法水彩', en: 'wet-on-wet watercolor', genPrompt: 'a bust portrait of a young woman in wet on wet watercolor style, soft bleeding edges, flowing translucent washes' },
  { id: 'art-style.watercolor.detailed-watercolor', cat: 'art-style', sub: 'watercolor', zh: '精细水彩', en: 'detailed watercolor', genPrompt: 'a bust portrait of a young woman in detailed watercolor style, delicate controlled washes, fine layered glazes' },
  { id: 'art-style.watercolor.ink-watercolor', cat: 'art-style', sub: 'watercolor', zh: '钢笔淡彩', en: 'ink and watercolor', genPrompt: 'a bust portrait of a young woman in ink and watercolor style, loose pen lines over soft color washes' },
  { id: 'art-style.watercolor.pastel-watercolor', cat: 'art-style', sub: 'watercolor', zh: '粉彩水彩', en: 'pastel watercolor', genPrompt: 'a bust portrait of a young woman in pastel watercolor style, pale gentle tints, airy soft gradients' },
  { id: 'art-style.watercolor.monochrome-watercolor', cat: 'art-style', sub: 'watercolor', zh: '单色水彩', en: 'monochrome watercolor', genPrompt: 'a bust portrait of a young woman in monochrome watercolor style, single hue washes, tonal soft gradients' },
  { id: 'art-style.watercolor.splashy', cat: 'art-style', sub: 'watercolor', zh: '泼彩水彩', en: 'splashy watercolor', genPrompt: 'a bust portrait of a young woman in splashy expressive watercolor style, loose drips and splatters, vivid bleeds' },
  { id: 'art-style.watercolor.vibrant-watercolor', cat: 'art-style', sub: 'watercolor', zh: '浓郁水彩', en: 'vibrant watercolor', genPrompt: 'a bust portrait of a young woman in vibrant watercolor style, saturated bold washes, lively color contrast' },
  { id: 'art-style.watercolor.granulated', cat: 'art-style', sub: 'watercolor', zh: '颗粒水彩', en: 'granulated watercolor', genPrompt: 'a bust portrait of a young woman in granulated watercolor style, textured sediment washes, organic grainy color' },
  { id: 'art-style.watercolor.minimalist-watercolor', cat: 'art-style', sub: 'watercolor', zh: '极简水彩', en: 'minimalist watercolor', genPrompt: 'a bust portrait of a young woman in minimalist watercolor style, few simple washes, generous white space' },
  { id: 'art-style.watercolor.botanical', cat: 'art-style', sub: 'watercolor', zh: '植物水彩', en: 'botanical watercolor', genPrompt: 'a bust portrait of a young woman in botanical watercolor style, crisp delicate detail, fresh natural tints' },

  // ── oil 油画 ──
  { id: 'art-style.oil.classical-realism', cat: 'art-style', sub: 'oil', zh: '古典写实油画', en: 'classical oil realism', genPrompt: 'a bust portrait of a young woman in classical realism oil painting style, smooth blending, refined detail' },
  { id: 'art-style.oil.impasto', cat: 'art-style', sub: 'oil', zh: '厚涂油画', en: 'impasto oil', genPrompt: 'a bust portrait of a young woman in thick impasto oil painting style, heavy textured strokes, sculpted paint' },
  { id: 'art-style.oil.alla-prima', cat: 'art-style', sub: 'oil', zh: '直接画法', en: 'alla prima oil', genPrompt: 'a bust portrait of a young woman in alla prima oil painting style, loose confident wet strokes, lively edges' },
  { id: 'art-style.oil.chiaroscuro', cat: 'art-style', sub: 'oil', zh: '明暗对照油画', en: 'chiaroscuro oil', genPrompt: 'a bust portrait of a young woman in baroque chiaroscuro oil style, dramatic light against deep shadow' },
  { id: 'art-style.oil.impressionist-oil', cat: 'art-style', sub: 'oil', zh: '印象派油画', en: 'impressionist oil', genPrompt: 'a bust portrait of a young woman in impressionist oil painting style, broken color dabs, shimmering light' },
  { id: 'art-style.oil.palette-knife', cat: 'art-style', sub: 'oil', zh: '刮刀油画', en: 'palette knife oil', genPrompt: 'a bust portrait of a young woman in palette knife oil painting style, bold flat blade strokes, chunky texture' },
  { id: 'art-style.oil.glazed-luminous', cat: 'art-style', sub: 'oil', zh: '罩染油画', en: 'glazed luminous oil', genPrompt: 'a bust portrait of a young woman in glazed luminous oil painting style, deep translucent layers, glowing skin' },
  { id: 'art-style.oil.muted-earthy', cat: 'art-style', sub: 'oil', zh: '低彩土色油画', en: 'muted earthy oil', genPrompt: 'a bust portrait of a young woman in muted earthy oil painting style, restrained ochre and umber palette' },
  { id: 'art-style.oil.expressive-bold', cat: 'art-style', sub: 'oil', zh: '表现主义油画', en: 'expressive bold oil', genPrompt: 'a bust portrait of a young woman in expressive bold oil style, vigorous gestural strokes, intense color' },
  { id: 'art-style.oil.renaissance-oil', cat: 'art-style', sub: 'oil', zh: '文艺复兴油画', en: 'renaissance oil', genPrompt: 'a bust portrait of a young woman in renaissance oil painting style, soft sfumato modeling, dignified pose' },

  // ── ink 国风水墨 ──
  { id: 'art-style.ink.xieyi', cat: 'art-style', sub: 'ink', zh: '写意水墨', en: 'xieyi freehand ink', genPrompt: 'a bust portrait of a young woman in xieyi freehand chinese ink style, loose expressive brush, flowing strokes' },
  { id: 'art-style.ink.gongbi', cat: 'art-style', sub: 'ink', zh: '工笔', en: 'gongbi fine-line', genPrompt: 'a bust portrait of a young woman in gongbi fine line chinese style, meticulous thin outlines, delicate color' },
  { id: 'art-style.ink.splash-ink', cat: 'art-style', sub: 'ink', zh: '泼墨', en: 'splash ink', genPrompt: 'a bust portrait of a young woman in splash ink style, bold spontaneous ink pools, dramatic flowing tones' },
  { id: 'art-style.ink.ink-wash', cat: 'art-style', sub: 'ink', zh: '水墨渲染', en: 'ink wash', genPrompt: 'a bust portrait of a young woman in chinese ink wash style, soft graded grey tones, misty atmosphere' },
  { id: 'art-style.ink.calligraphic', cat: 'art-style', sub: 'ink', zh: '书法笔意', en: 'calligraphic brush', genPrompt: 'a bust portrait of a young woman in calligraphic brush ink style, rhythmic confident strokes, dry brush texture' },
  { id: 'art-style.ink.color-ink', cat: 'art-style', sub: 'ink', zh: '彩墨', en: 'color ink', genPrompt: 'a bust portrait of a young woman in chinese color ink style, ink lines with soft mineral color washes' },
  { id: 'art-style.ink.dunhuang', cat: 'art-style', sub: 'ink', zh: '敦煌壁画', en: 'dunhuang mural style', genPrompt: 'a bust portrait of a young woman in dunhuang mural style, earthy mineral pigments, flowing ribbons, aged texture' },
  { id: 'art-style.ink.baimiao', cat: 'art-style', sub: 'ink', zh: '白描', en: 'baimiao line ink', genPrompt: 'a bust portrait of a young woman in baimiao line ink style, pure even outline drawing, no color, elegant lines' },
  { id: 'art-style.ink.contemporary-ink', cat: 'art-style', sub: 'ink', zh: '当代水墨', en: 'contemporary ink', genPrompt: 'a bust portrait of a young woman in contemporary chinese ink style, bold abstract brushwork, modern composition' },
  { id: 'art-style.ink.landscape-ink', cat: 'art-style', sub: 'ink', zh: '山水意境', en: 'shanshui ink mood', genPrompt: 'a bust portrait of a young woman in shanshui ink mood style, layered grey washes, poetic restrained tone' },

  // ── render-3d 3D渲染 ──
  { id: 'art-style.render-3d.stylized-animation', cat: 'art-style', sub: 'render-3d', zh: '风格化3D动画', en: 'stylized 3d animation', genPrompt: 'a bust portrait of a young woman in stylized 3d animation render style, soft rounded forms, appealing big features' },
  { id: 'art-style.render-3d.realistic-render', cat: 'art-style', sub: 'render-3d', zh: '写实渲染', en: 'realistic 3d render', genPrompt: 'a bust portrait of a young woman in realistic 3d render style, accurate materials, soft global illumination' },
  { id: 'art-style.render-3d.clay', cat: 'art-style', sub: 'render-3d', zh: '黏土渲染', en: 'clay render', genPrompt: 'a bust portrait of a young woman in clay render style, matte sculpted surfaces, soft uniform shading' },
  { id: 'art-style.render-3d.low-poly', cat: 'art-style', sub: 'render-3d', zh: '低多边形', en: 'low poly', genPrompt: 'a bust portrait of a young woman in low poly 3d style, faceted geometric planes, flat color shading' },
  { id: 'art-style.render-3d.toon-shaded', cat: 'art-style', sub: 'render-3d', zh: '卡通渲染', en: 'toon shaded 3d', genPrompt: 'a bust portrait of a young woman in toon shaded 3d style, flat cel bands with crisp outlines on 3d forms' },
  { id: 'art-style.render-3d.isometric', cat: 'art-style', sub: 'render-3d', zh: '等距3D', en: 'isometric 3d', genPrompt: 'a bust portrait of a young woman in isometric 3d render style, clean geometric forms, soft even lighting' },
  { id: 'art-style.render-3d.sculpt', cat: 'art-style', sub: 'render-3d', zh: '数字雕刻', en: 'digital sculpt', genPrompt: 'a bust portrait of a young woman in detailed digital sculpt style, fine modeled surfaces, neutral clay material' },
  { id: 'art-style.render-3d.voxel', cat: 'art-style', sub: 'render-3d', zh: '体素', en: 'voxel art', genPrompt: 'a bust portrait of a young woman in voxel art style, blocky 3d cubes, playful pixelated volume' },
  { id: 'art-style.render-3d.glossy-product', cat: 'art-style', sub: 'render-3d', zh: '光泽产品渲染', en: 'glossy product render', genPrompt: 'a bust portrait of a young woman in glossy product render style, sleek reflective surfaces, polished finish' },
  { id: 'art-style.render-3d.inflatable', cat: 'art-style', sub: 'render-3d', zh: '充气质感', en: 'inflatable 3d', genPrompt: 'a bust portrait of a young woman in inflatable balloon 3d style, puffy rounded glossy forms, soft highlights' },

  // ── pixel 像素复古 ──
  { id: 'art-style.pixel.8-bit', cat: 'art-style', sub: 'pixel', zh: '8位像素', en: '8-bit pixel', genPrompt: 'a bust portrait of a young woman in 8 bit pixel art style, chunky pixels, tiny limited color palette' },
  { id: 'art-style.pixel.16-bit', cat: 'art-style', sub: 'pixel', zh: '16位像素', en: '16-bit pixel', genPrompt: 'a bust portrait of a young woman in 16 bit pixel art style, detailed pixel shading, rich retro palette' },
  { id: 'art-style.pixel.isometric-pixel', cat: 'art-style', sub: 'pixel', zh: '等距像素', en: 'isometric pixel', genPrompt: 'a bust portrait of a young woman in isometric pixel art style, neat diagonal grid pixels, crisp shapes' },
  { id: 'art-style.pixel.hi-bit', cat: 'art-style', sub: 'pixel', zh: '高位像素', en: 'hi-bit pixel', genPrompt: 'a bust portrait of a young woman in hi bit pixel art style, fine dense pixels, smooth modern shading' },
  { id: 'art-style.pixel.handheld-mono', cat: 'art-style', sub: 'pixel', zh: '掌机单色', en: 'monochrome handheld pixel', genPrompt: 'a bust portrait of a young woman in monochrome handheld pixel style, four shade green palette, dotted shading' },
  { id: 'art-style.pixel.pixel-portrait', cat: 'art-style', sub: 'pixel', zh: '像素头像', en: 'pixel portrait', genPrompt: 'a bust portrait of a young woman in pixel portrait style, careful pixel clusters, clean readable face' },
  { id: 'art-style.pixel.retro-rpg', cat: 'art-style', sub: 'pixel', zh: '复古RPG像素', en: 'retro rpg pixel', genPrompt: 'a bust portrait of a young woman in retro rpg pixel style, classic role playing game look, warm nostalgic palette' },
  { id: 'art-style.pixel.dithered', cat: 'art-style', sub: 'pixel', zh: '抖动像素', en: 'dithered pixel', genPrompt: 'a bust portrait of a young woman in dithered pixel art style, checkerboard gradients, limited blended palette' },
  { id: 'art-style.pixel.neon-pixel', cat: 'art-style', sub: 'pixel', zh: '霓虹像素', en: 'neon pixel', genPrompt: 'a bust portrait of a young woman in neon pixel art style, glowing bright pixels, dark synthwave palette' },
  { id: 'art-style.pixel.minimal-pixel', cat: 'art-style', sub: 'pixel', zh: '极简像素', en: 'minimalist pixel', genPrompt: 'a bust portrait of a young woman in minimalist pixel art style, few large pixels, bold simple shapes' },

  // ── lineart 线稿 ──
  { id: 'art-style.lineart.clean-vector', cat: 'art-style', sub: 'lineart', zh: '干净矢量线', en: 'clean vector lineart', genPrompt: 'a bust portrait of a young woman in clean vector lineart style, smooth even outlines, no fill, white ground' },
  { id: 'art-style.lineart.rough-sketch', cat: 'art-style', sub: 'lineart', zh: '草图线稿', en: 'rough sketch lineart', genPrompt: 'a bust portrait of a young woman in rough sketch lineart style, loose searching pencil lines, energetic' },
  { id: 'art-style.lineart.continuous-line', cat: 'art-style', sub: 'lineart', zh: '一笔连线', en: 'continuous one-line', genPrompt: 'a bust portrait of a young woman in continuous single line style, one unbroken flowing contour, minimal' },
  { id: 'art-style.lineart.technical-ink', cat: 'art-style', sub: 'lineart', zh: '针管笔线稿', en: 'technical ink lineart', genPrompt: 'a bust portrait of a young woman in technical ink lineart style, precise uniform pen lines, neat detail' },
  { id: 'art-style.lineart.comic-ink', cat: 'art-style', sub: 'lineart', zh: '漫画勾线', en: 'comic ink lineart', genPrompt: 'a bust portrait of a young woman in comic ink lineart style, varied weight inking, confident bold contours' },
  { id: 'art-style.lineart.hatching', cat: 'art-style', sub: 'lineart', zh: '排线素描', en: 'hatching lineart', genPrompt: 'a bust portrait of a young woman in hatching lineart style, cross hatched pen shading, fine tonal lines' },
  { id: 'art-style.lineart.woodcut', cat: 'art-style', sub: 'lineart', zh: '木刻线条', en: 'woodcut lineart', genPrompt: 'a bust portrait of a young woman in woodcut lineart style, bold carved black lines, high contrast print look' },
  { id: 'art-style.lineart.blueprint', cat: 'art-style', sub: 'lineart', zh: '蓝图线稿', en: 'blueprint lineart', genPrompt: 'a bust portrait of a young woman in blueprint lineart style, thin cyan white lines on deep blue ground' },
  { id: 'art-style.lineart.minimalist-line', cat: 'art-style', sub: 'lineart', zh: '极简线条', en: 'minimalist lineart', genPrompt: 'a bust portrait of a young woman in minimalist lineart style, a few elegant essential lines, lots of space' },
  { id: 'art-style.lineart.brush-pen', cat: 'art-style', sub: 'lineart', zh: '毛笔线稿', en: 'brush pen lineart', genPrompt: 'a bust portrait of a young woman in brush pen lineart style, expressive tapering strokes, organic ink flow' },

  // ── concept 概念艺术 ──
  { id: 'art-style.concept.character-sheet', cat: 'art-style', sub: 'concept', zh: '角色概念', en: 'character concept', genPrompt: 'a bust portrait of a young woman in character concept art style, painterly design exploration, confident strokes' },
  { id: 'art-style.concept.painterly-concept', cat: 'art-style', sub: 'concept', zh: '厚涂概念', en: 'painterly concept', genPrompt: 'a bust portrait of a young woman in painterly concept art style, bold blocked shapes, atmospheric rendering' },
  { id: 'art-style.concept.sci-fi-concept', cat: 'art-style', sub: 'concept', zh: '科幻概念', en: 'sci-fi concept art', genPrompt: 'a bust portrait of a young woman in sci fi concept art style, sleek tech detailing, cool moody palette' },
  { id: 'art-style.concept.fantasy-concept', cat: 'art-style', sub: 'concept', zh: '奇幻概念', en: 'fantasy concept art', genPrompt: 'a bust portrait of a young woman in fantasy concept art style, rich painterly detail, epic imaginative design' },
  { id: 'art-style.concept.moody-atmospheric', cat: 'art-style', sub: 'concept', zh: '氛围概念', en: 'atmospheric concept', genPrompt: 'a bust portrait of a young woman in atmospheric concept art style, soft depth haze, evocative muted color' },
  { id: 'art-style.concept.industrial-concept', cat: 'art-style', sub: 'concept', zh: '工业概念', en: 'industrial concept art', genPrompt: 'a bust portrait of a young woman in industrial concept art style, hard surface detailing, gritty utilitarian tone' },
  { id: 'art-style.concept.keyframe', cat: 'art-style', sub: 'concept', zh: '关键帧概念', en: 'keyframe concept', genPrompt: 'a bust portrait of a young woman in keyframe concept art style, cinematic staging, dramatic painterly mood' },
  { id: 'art-style.concept.sketchy-concept', cat: 'art-style', sub: 'concept', zh: '速涂概念', en: 'sketchy concept', genPrompt: 'a bust portrait of a young woman in sketchy concept art style, fast loose value blocking, raw gestural feel' },
  { id: 'art-style.concept.matte-painting', cat: 'art-style', sub: 'concept', zh: '数字绘景', en: 'matte painting style', genPrompt: 'a bust portrait of a young woman in matte painting style, photoreal painterly blend, rich layered detail' },
  { id: 'art-style.concept.tonal-study', cat: 'art-style', sub: 'concept', zh: '黑白概念', en: 'value study concept', genPrompt: 'a bust portrait of a young woman in grayscale value study concept style, bold light and shadow blocking' },

  // ── flat 扁平矢量 ──
  { id: 'art-style.flat.flat-vector', cat: 'art-style', sub: 'flat', zh: '扁平矢量', en: 'flat vector', genPrompt: 'a bust portrait of a young woman in flat vector style, simple solid color shapes, no gradients, clean look' },
  { id: 'art-style.flat.geometric-flat', cat: 'art-style', sub: 'flat', zh: '几何扁平', en: 'geometric flat', genPrompt: 'a bust portrait of a young woman in geometric flat style, bold angular shapes, tidy structured color blocks' },
  { id: 'art-style.flat.gradient-flat', cat: 'art-style', sub: 'flat', zh: '渐变扁平', en: 'gradient flat', genPrompt: 'a bust portrait of a young woman in gradient flat style, smooth two tone gradients, modern soft shapes' },
  { id: 'art-style.flat.minimal-flat', cat: 'art-style', sub: 'flat', zh: '极简扁平', en: 'minimal flat', genPrompt: 'a bust portrait of a young woman in minimal flat style, few simple shapes, restrained calm palette' },
  { id: 'art-style.flat.isometric-flat', cat: 'art-style', sub: 'flat', zh: '等距扁平', en: 'isometric flat', genPrompt: 'a bust portrait of a young woman in isometric flat style, tidy diagonal geometry, clean flat color' },
  { id: 'art-style.flat.line-and-flat', cat: 'art-style', sub: 'flat', zh: '线条扁平', en: 'line and flat color', genPrompt: 'a bust portrait of a young woman in line and flat color style, thin outlines over solid flat fills' },
  { id: 'art-style.flat.retro-flat', cat: 'art-style', sub: 'flat', zh: '复古扁平', en: 'retro flat', genPrompt: 'a bust portrait of a young woman in retro flat style, muted vintage palette, simple mid century shapes' },
  { id: 'art-style.flat.bold-block', cat: 'art-style', sub: 'flat', zh: '色块扁平', en: 'bold color block', genPrompt: 'a bust portrait of a young woman in bold color block flat style, large saturated shapes, strong contrast' },
  { id: 'art-style.flat.pastel-flat', cat: 'art-style', sub: 'flat', zh: '粉彩扁平', en: 'pastel flat', genPrompt: 'a bust portrait of a young woman in pastel flat style, soft muted tints, gentle rounded shapes' },
  { id: 'art-style.flat.grainy-flat', cat: 'art-style', sub: 'flat', zh: '颗粒扁平', en: 'grainy flat', genPrompt: 'a bust portrait of a young woman in grainy flat style, flat shapes with subtle noise texture, warm tone' },

  // ── movement 艺术流派 ──
  { id: 'art-style.movement.impressionism', cat: 'art-style', sub: 'movement', zh: '印象派', en: 'impressionism', genPrompt: 'a bust portrait of a young woman in impressionism style, broken dappled brushstrokes, luminous shifting light' },
  { id: 'art-style.movement.post-impressionism', cat: 'art-style', sub: 'movement', zh: '后印象派', en: 'post-impressionism', genPrompt: 'a bust portrait of a young woman in post impressionism style, bold expressive color, rhythmic thick strokes' },
  { id: 'art-style.movement.cubism', cat: 'art-style', sub: 'movement', zh: '立体主义', en: 'cubism', genPrompt: 'a bust portrait of a young woman in cubism style, fragmented geometric planes, multiple shifting viewpoints' },
  { id: 'art-style.movement.fauvism', cat: 'art-style', sub: 'movement', zh: '野兽派', en: 'fauvism', genPrompt: 'a bust portrait of a young woman in fauvism style, wild non natural color, bold flat expressive shapes' },
  { id: 'art-style.movement.expressionism', cat: 'art-style', sub: 'movement', zh: '表现主义', en: 'expressionism', genPrompt: 'a bust portrait of a young woman in expressionism style, distorted emotive forms, intense raw color' },
  { id: 'art-style.movement.surrealism', cat: 'art-style', sub: 'movement', zh: '超现实主义', en: 'surrealism', genPrompt: 'a bust portrait of a young woman in surrealism style, dreamlike uncanny imagery, smooth strange detail' },
  { id: 'art-style.movement.art-nouveau', cat: 'art-style', sub: 'movement', zh: '新艺术运动', en: 'art nouveau', genPrompt: 'a bust portrait of a young woman in art nouveau style, flowing organic lines, ornamental floral framing' },
  { id: 'art-style.movement.art-deco', cat: 'art-style', sub: 'movement', zh: '装饰艺术', en: 'art deco', genPrompt: 'a bust portrait of a young woman in art deco style, sleek symmetrical geometry, gold and bold elegant forms' },
  { id: 'art-style.movement.pop-art', cat: 'art-style', sub: 'movement', zh: '波普艺术', en: 'pop art', genPrompt: 'a bust portrait of a young woman in pop art style, bold flat colors, halftone dots, graphic comic punch' },
  { id: 'art-style.movement.ukiyo-e', cat: 'art-style', sub: 'movement', zh: '浮世绘', en: 'ukiyo-e', genPrompt: 'a bust portrait of a young woman in ukiyo-e woodblock style, flat color areas, bold outlines, refined patterns' },

  // ── game 游戏美术 ──
  { id: 'art-style.game.low-poly-game', cat: 'art-style', sub: 'game', zh: '低多边形游戏', en: 'low poly game art', genPrompt: 'a bust portrait of a young woman in low poly game art style, faceted stylized forms, clean flat shading' },
  { id: 'art-style.game.painterly-rpg', cat: 'art-style', sub: 'game', zh: '厚涂RPG', en: 'painterly rpg splash art', genPrompt: 'a bust portrait of a young woman in painterly rpg splash art style, rich rendered detail, heroic dramatic tone' },
  { id: 'art-style.game.moba-splash', cat: 'art-style', sub: 'game', zh: 'MOBA原画', en: 'moba splash art', genPrompt: 'a bust portrait of a young woman in moba splash art style, polished dynamic rendering, bold flashy detail' },
  { id: 'art-style.game.jrpg', cat: 'art-style', sub: 'game', zh: '日式RPG', en: 'jrpg character art', genPrompt: 'a bust portrait of a young woman in jrpg character art style, clean anime lines, glossy detailed shading' },
  { id: 'art-style.game.mobile-stylized', cat: 'art-style', sub: 'game', zh: '手游风', en: 'stylized mobile game art', genPrompt: 'a bust portrait of a young woman in stylized mobile game art style, bright appealing colors, smooth soft shapes' },
  { id: 'art-style.game.aaa-realistic', cat: 'art-style', sub: 'game', zh: '3A写实', en: 'aaa realistic game art', genPrompt: 'a bust portrait of a young woman in aaa realistic game render style, detailed materials, lifelike surfaces' },
  { id: 'art-style.game.cel-game', cat: 'art-style', sub: 'game', zh: '卡通渲染游戏', en: 'cel-shaded game art', genPrompt: 'a bust portrait of a young woman in cel shaded game art style, flat toon bands, crisp outlines, vivid color' },
  { id: 'art-style.game.hand-painted-mmo', cat: 'art-style', sub: 'game', zh: '手绘网游', en: 'hand painted mmo art', genPrompt: 'a bust portrait of a young woman in hand painted mmo art style, painted textures, warm stylized fantasy tone' },
  { id: 'art-style.game.voxel-game', cat: 'art-style', sub: 'game', zh: '体素游戏', en: 'voxel game art', genPrompt: 'a bust portrait of a young woman in voxel game art style, blocky cubic forms, bright playful palette' },
  { id: 'art-style.game.pixel-platformer', cat: 'art-style', sub: 'game', zh: '像素平台游戏', en: 'pixel platformer art', genPrompt: 'a bust portrait of a young woman in pixel platformer game art style, crisp readable pixels, lively retro color' }
];
