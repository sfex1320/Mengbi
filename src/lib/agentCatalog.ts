/**
 * 智能体「节点能力目录」—— 单一真相，喂给 planner 的系统提示词、也供 builder 校验。
 * 设计原则（CLAUDE 铁律 / 复用优先）：
 *  - 连线规则不在这里重述，统一从 @/lib/canvasConnectRules 推导（canConsumeFrom/canProduceTo）。
 *  - 枚举值（workType / llmOp / 比例 / 档位 / 反推类型）从既有常量导入，不手抄，杜绝漂移。
 *  - CATALOG 类型为 Record<SmartNodeKind, …> → 新增第 N 类节点漏配目录则 tsc 直接报错（编译期完整性）。
 */
import type { SmartNodeKind } from '@shared/smartCanvas';
import { WORK_TYPE_LABELS, LLM_OP_LABELS, REVERSE_TYPE_LABELS, VIDEO_MODE_LABELS } from '@shared/smartCanvas';
import { canConnectKinds, PRODUCERS, CONSUMERS } from '@/lib/canvasConnectRules';
import { RATIO_ASPECTS, SIZE_TIERS } from '@/lib/sizeSpec';

/** 节点某个「LLM 可设参数」的描述（含枚举 / 取值范围说明，直接渲染进系统提示词）。 */
export interface AgentParamSpec {
  key: string;
  desc: string;
}

export interface AgentNodeSpec {
  /** 中文节点名（与 UI 一致；目录是 planner 的「字典」，名称放这里合适，不算规则重述） */
  label: string;
  /** 分层：core=优先引导 LLM 使用；extended=进阶（仅明确需要时用） */
  tier: 'core' | 'extended';
  /** 一句话用途 */
  purpose: string;
  /** 需要的模型类型（builder 自动注入 modelId，LLM 不写） */
  needsModel?: 'image' | 'text' | 'video';
  /** LLM 可设参数（builder 只接受这些 key，其余忽略） */
  params: AgentParamSpec[];
}

const WORK_TYPES = Object.keys(WORK_TYPE_LABELS).join(' / ');
const LLM_OPS = Object.keys(LLM_OP_LABELS).join(' / ');
const REVERSE_TYPES = Object.keys(REVERSE_TYPE_LABELS).join(' / ');
const VIDEO_MODES = Object.keys(VIDEO_MODE_LABELS).join(' / ');

/**
 * 完整目录。Record<SmartNodeKind, …> 保证编译期覆盖全部节点类型。
 * params 的 key 必须与 @shared/smartCanvas 的各 *NodeData 字段名一致（builder 直接 updateNodeData）。
 */
export const CATALOG: Record<SmartNodeKind, AgentNodeSpec> = {
  // ───── 核心（最常用，planner 首选）─────
  prompt: {
    label: '提示词',
    tier: 'core',
    purpose: '提供一条（或多条）已优化好的绘图提示词文本，喂给下游生图 / 视频 / ComfyUI。',
    params: [{ key: 'text', desc: '提示词正文（你负责把用户需求扩写润色成高质量提示词，中文或英文均可）' }]
  },
  image: {
    label: '图片',
    tier: 'core',
    purpose: '提供图片输入（改图 / 参考 / 反推等的素材来源）。图片通过 imageBindings 绑定，不在 params 里写。',
    params: []
  },
  work: {
    label: '生图',
    tier: 'core',
    purpose: '调用绘画模型生成 / 编辑图片。上游连提示词（文本）与可选参考图，输出图片。',
    needsModel: 'image',
    params: [
      { key: 'workType', desc: `工作类型，枚举：${WORK_TYPES}（纯文字出图=image-generation；基于已有图改图=image-edit；风格迁移=style-transfer；扩展画面=outpainting）` },
      { key: 'aspect', desc: '画面比例，如 1:1 / 16:9 / 9:16 / 4:3（系统会按所选模型支持范围自动校正）' },
      { key: 'imageSize', desc: '分辨率档，枚举：1K / 2K / 4K（系统按模型支持自动校正）' },
      { key: 'quality', desc: '质量，如 standard / high（部分模型支持，不支持时自动忽略）' },
      { key: 'strength', desc: '重绘强度 0–1（图生图/局部重绘时；部分后端支持）' },
      { key: 'n', desc: '生成张数，1–4 的整数' },
      { key: 'negativePrompt', desc: '负向提示词（不想要的内容），可空' }
    ]
  },
  result: {
    label: '结果',
    tier: 'core',
    purpose: '汇总并展示上游产出（生图 / 视频 / 文本）。生图节点会自动补一个结果节点，一般无需手动加。',
    params: []
  },
  llm: {
    label: 'LLM',
    tier: 'core',
    purpose: '文本模型处理：优化提示词 / 翻译 / 扩写 / 反推等。上游连文本（或反推用的图片），输出文本。',
    needsModel: 'text',
    params: [
      { key: 'op', desc: `操作类型，枚举：${LLM_OPS}` },
      { key: 'instruction', desc: '额外指令（可空），追加到系统提示词' }
    ]
  },
  ratio: {
    label: '尺寸',
    tier: 'core',
    purpose: '统一驱动下游 生图 / 视频 / ComfyUI 的尺寸（输出比例 + 精确像素）。',
    params: [
      { key: 'aspect', desc: `比例，枚举之一：${RATIO_ASPECTS.join(' / ')}` },
      { key: 'tier', desc: `分辨率档，枚举之一：${SIZE_TIERS.join(' / ')}（最长边约定）` },
      { key: 'emit', desc: '输出意图：both=比例+尺寸 / aspect=只比例 / resolution=只尺寸' }
    ]
  },
  scale: {
    label: '缩放',
    tier: 'core',
    purpose: '对上游图片（或视频）做缩小 / 放大预处理（非高清化）。',
    params: [
      { key: 'mode', desc: '缩放模式：factor 倍数 / longest 最长边 / shortest 最短边 / width 按宽 / height 按高 / fit 限制框 / pixels 总像素 / exact 精确尺寸' },
      { key: 'factor', desc: 'factor 模式的倍数 0.1–8' },
      { key: 'edge', desc: 'longest/shortest/width/height 模式的单边像素' },
      { key: 'fitW', desc: 'fit/exact 模式的宽（px）' },
      { key: 'fitH', desc: 'fit/exact 模式的高（px）' },
      { key: 'keepAspect', desc: '是否等比（exact 模式 false=强制拉伸）' },
      { key: 'noUpscale', desc: '仅缩小不放大（true/false）' },
      { key: 'format', desc: '输出格式 png / jpeg / webp' }
    ]
  },
  upscale: {
    label: '保真放大',
    tier: 'extended',
    purpose: '对上游图片做本地 Real-ESRGAN 保真放大（2/3/4× 无损提分辨率，不烧中转站）。需先在节点上安装放大引擎。',
    params: [
      { key: 'scale', desc: '放大倍数：2 / 3 / 4' },
      { key: 'format', desc: '输出格式 png / jpg / webp' }
    ]
  },
  vectorize: {
    label: '图像转矢量',
    tier: 'extended',
    purpose: '把上游图片转成 SVG 矢量（vtracer 彩色 / potrace 单色）。SVG 是终端产物，只能连 结果 / 文件夹输出。',
    params: [{ key: 'vmode', desc: '模式：vtracer 彩色 / potrace 单色' }]
  },
  'angle-prompt': {
    label: '镜头',
    tier: 'core',
    purpose: '接一张图 → 镜头语言（相机 / 光圈 / 运镜 / 焦距 / 构图）→ 输出镜头提示词文本喂下游。',
    params: [
      { key: 'camMode', desc: '镜头模式：photo 拍照 / video 视频' },
      { key: 'cameraType', desc: '相机机型(拍照)：dslr 单反 / mirrorless 微单 / cinema 电影机 / phone 手机 / drone 航拍 等（none=不指定）' },
      { key: 'aperture', desc: '光圈(拍照)：f1.4 / f2.8 / f4 / f8 / f16（none=不指定）' },
      { key: 'movement', desc: '运镜(视频)：push 推 / pull 拉 / orbit 环绕 / tracking 跟拍 等（none=不指定）' },
      { key: 'focal', desc: '焦距(视频)：ultrawide 超广角 / wide 广角 / standard 标准 / tele 长焦 / macro 微距（none=不指定）' },
      { key: 'composition', desc: '构图：thirds 三分 / centered 中心 / symmetry 对称 / golden 黄金 等（none=不指定）' }
    ]
  },
  light: {
    label: '光源',
    tier: 'core',
    purpose: '接一张图 → 光照设定（光源类型 / 方位 / 强度 / 色温 / 遮挡 / 光效）→ 输出光照提示词文本喂下游。',
    params: [
      { key: 'sourceType', desc: '光源类型：sunlight 阳光 / sunset 夕阳 / goldenhour 黄金时刻 / studio 影棚 / moonlight 月光 / neon 霓虹 等（none=不指定）' },
      { key: 'occlusion', desc: '遮挡：leaves 树叶光斑 / window 窗格 / blinds 百叶窗 / curtain 薄纱 等（none=无遮挡）' },
      { key: 'effect', desc: '光效：tyndall 丁达尔 / godrays 上帝之光 / backlight 逆光 / flare 镜头光晕 / bokeh 散景 等（none=无）' },
      { key: 'intensity', desc: '强度 0–100' },
      { key: 'warmth', desc: '色温 -100(冷)~100(暖)' }
    ]
  },
  palette: {
    label: '配色工具',
    tier: 'core',
    purpose: '接一张图提取主色，或按基准色推导配色方案 → 输出配色提示词文本喂下游。',
    params: [
      { key: 'mode', desc: 'extract 提取配色 / scheme 调色方案' },
      { key: 'scheme', desc: 'scheme 模式方案：complementary 互补 / contrast 对比 / analogous 邻近 / split 分裂互补 / tetradic 四角 / monochrome 单色' },
      { key: 'count', desc: '取色数 2–12' },
      { key: 'baseHex', desc: 'scheme 模式的基准色，如 #E8734A' }
    ]
  },
  'image-reverse': {
    label: '图像反推',
    tier: 'core',
    purpose: '接一张图 → 视觉模型反推出 描述 / 标签 / 风格 文本喂下游（需带视觉能力的文本模型）。',
    needsModel: 'text',
    params: [{ key: 'reverseType', desc: `反推类型，枚举：${REVERSE_TYPES}` }]
  },
  compare: {
    label: '对比',
    tier: 'core',
    purpose: '并排对比两张图（带可拖滑块）。接两张图片（A=上游第 1 张 / B=第 2 张），纯查看不输出。',
    params: []
  },
  group: {
    label: '分组',
    tier: 'core',
    purpose: '容器：把多个节点归到一个分组里，整组作为下游输入。',
    params: [{ key: 'title', desc: '分组标题' }]
  },
  text: {
    label: '文字',
    tier: 'core',
    purpose: '画布上的自由文字注释（标题 / 备注）。不参与生成、无连线口。',
    params: [{ key: 'text', desc: '注释文字' }]
  },

  // ───── 进阶（仅用户需求明确需要时使用）─────
  comfy: {
    label: 'ComfyUI',
    tier: 'extended',
    purpose: '运行用户已配置好的 ComfyUI 工作流模板。从下方「可用 ComfyUI 模板」里按名称选一个，并可设其内部控件参数。上游图片/提示词会自动喂入对应输入位。',
    params: [
      { key: 'template', desc: '要使用的模板名称（必须是「可用 ComfyUI 模板」列表里的某个名称；没有列表则不要用本节点）' },
      { key: 'controls', desc: '对象：键=该模板的控件名称（见列表里每个模板的控件），值=要设的值；只写你需要改的控件，其余用模板默认。图片类控件不要在这里设（由上游喂入）' }
    ]
  },
  video: {
    label: '视频',
    tier: 'extended',
    purpose: '调用视频模型生成视频（异步）。上游连提示词，可选图片作首帧（图生视频）。',
    needsModel: 'video',
    params: [
      { key: 'prompt', desc: '视频提示词正文' },
      { key: 'mode', desc: `视频模式，枚举：${VIDEO_MODES}` },
      { key: 'duration', desc: '时长秒，如 5 / 10（字符串）' },
      { key: 'aspect', desc: '画幅，如 16:9 / 9:16 / adaptive' },
      { key: 'resolution', desc: '分辨率，如 480p / 720p / 1080p' }
    ]
  },
  'video-source': {
    label: '视频上传',
    tier: 'extended',
    purpose: '提供视频输入来源（需用户后续指定本地视频 / URL）。',
    params: []
  },
  'video-reverse': {
    label: '视频反推',
    tier: 'extended',
    purpose: '接一个视频 → 抽帧 → 视觉模型反推文本喂下游。',
    needsModel: 'text',
    params: [
      { key: 'reverseType', desc: `反推类型，枚举：${REVERSE_TYPES}` },
      { key: 'frameCount', desc: '抽帧数量，默认 6' }
    ]
  },
  'frame-interp': {
    label: '插帧',
    tier: 'extended',
    purpose: '接一个视频 → 本地 AI 运动插帧（提高帧率，更流畅）→ 输出视频喂下游。',
    params: [{ key: 'targetFps', desc: '目标帧率（需高于源帧率），如 30 / 48 / 60' }]
  },
  'video-clip': {
    label: '视频剪辑',
    tier: 'extended',
    purpose: '时间轴式视频剪辑（多段裁切 / 转场 / 调色 / 文字）。接多个上游视频，需用户后续在剪辑台调。',
    params: []
  },
  storyboard: {
    label: '智能分镜',
    tier: 'extended',
    purpose: '把一个故事 / 短句 → 拆成 N 条按时间顺序的图像提示词，按序喂下游生图。',
    needsModel: 'text',
    params: [
      { key: 'input', desc: '故事素材 / 短句（也可由上游提示词连入）' },
      { key: 'shotCount', desc: '分镜数量 2–20' }
    ]
  },
  'prompt-mall': {
    label: '提示词商城',
    tier: 'extended',
    purpose: '从内置提示词片段库挑选（画风/场景/光线/构图/人物/服饰…）组成购物车 → 合成一条提示词喂下游生图。lang 控制中/英输出。',
    needsModel: 'text',
    params: [
      { key: 'lang', desc: '输出语言：zh 中文 / en 英文' },
      { key: 'optimize', desc: '是否交给对话模型合并优化（true/false）' }
    ]
  },
  loop: {
    label: '循环',
    tier: 'extended',
    purpose: '工作流控制：对一组项逐项驱动下游生图 / 视频。会多次出图，谨慎使用（费用 × 项数）。',
    params: [
      { key: 'sourceType', desc: '来源：count 固定次数 / prompts 提示词列表 / sizes 尺寸列表 / range 数值范围' },
      { key: 'count', desc: 'count 模式的次数' },
      { key: 'promptLines', desc: 'prompts 模式：多行文本，每行一条' }
    ]
  },
  'folder-input': {
    label: '文件夹输入',
    tier: 'extended',
    purpose: '扫描一个文件夹里的图片 / 视频作批量来源（需用户后续指定文件夹）。',
    params: []
  },
  'folder-output': {
    label: '文件夹输出',
    tier: 'extended',
    purpose: '把上游产出的图片 / 视频自动落盘到一个文件夹（需用户后续指定文件夹）。',
    params: [{ key: 'prefix', desc: '文件名前缀（前缀+序号命名时用）' }]
  },
  segment: {
    label: '切分工具',
    tier: 'extended',
    purpose: '接整图 → 视觉模型识别画面元素 → 逐元素反推 + 统一风格重绘 → 按原位 1:1 拼回整图（局部修复/重做元素）。识别+重绘在工作台里，参数较少。',
    needsModel: 'text',
    params: [{ key: 'stylePrompt', desc: '统一风格约束（拼进每个元素的重绘提示词，保证风格一致）' }]
  },
  proof: {
    label: '对稿',
    tier: 'extended',
    purpose: '接海报/设计图 → 多模态模型逐元素检错（字体/元素/Logo/形态错误，如手只有4指、Logo 画崩、错别字）→ 输出审稿报告文本。',
    needsModel: 'text',
    params: []
  }
};

/** 全部节点类型的运行时清单（来自 CATALOG keys，编译期已保证覆盖完整）。 */
export const ALL_AGENT_KINDS = Object.keys(CATALOG) as SmartNodeKind[];

/** 是否合法节点类型（builder 丢弃 LLM 编造的未知 kind 用）。 */
export function isNodeKind(x: unknown): x is SmartNodeKind {
  return typeof x === 'string' && Object.prototype.hasOwnProperty.call(CATALOG, x);
}

const KIND_LABEL: Record<string, string> = Object.fromEntries(
  ALL_AGENT_KINDS.map((k) => [k, CATALOG[k].label])
);
function labelsOf(kinds: string[]): string {
  return kinds.length ? kinds.map((k) => KIND_LABEL[k] ?? k).join('/') : '—';
}

/** 推导某节点「可接收的来源类型」（从连线规则推导，不手抄）。 */
export function consumeKinds(kind: SmartNodeKind): SmartNodeKind[] {
  return [...PRODUCERS].filter((sk) => canConnectKinds(sk, kind)) as SmartNodeKind[];
}
/** 推导某节点「可输出到的去向类型」。 */
export function produceKinds(kind: SmartNodeKind): SmartNodeKind[] {
  return [...CONSUMERS].filter((tk) => canConnectKinds(kind, tk)) as SmartNodeKind[];
}

function renderEntry(kind: SmartNodeKind): string {
  const s = CATALOG[kind];
  const params = s.params.length
    ? s.params.map((p) => `${p.key}（${p.desc}）`).join('；')
    : '无';
  const model = s.needsModel ? `[需${{ image: '绘画', text: '文本', video: '视频' }[s.needsModel]}模型]` : '';
  const cons = labelsOf(consumeKinds(kind));
  const prod = labelsOf(produceKinds(kind));
  return `- ${kind}｜${s.label}${model}：${s.purpose}\n    可设参数：${params}\n    可接收来源：${cons}｜可输出去向：${prod}`;
}

/** planner 看到的精简 ComfyUI 模板（名称 + 可设控件，用于让 LLM 选模板/设参数）。 */
export interface AgentComfyTemplateInfo {
  name: string;
  /** 可设控件（已剔除图片/文件类）：名称 + 类型 + 可选项 */
  controls: Array<{ label: string; type: string; options?: string[] }>;
}

/** 规划上下文：可用模型清单 + 当前可用图片来源说明 + 可用 ComfyUI 模板。 */
export interface AgentPlanContextInfo {
  imageModels: string[];
  textModels: string[];
  videoModels: string[];
  attachedCount: number;
  selectedImageCount: number;
  galleryAvailable: boolean;
  comfyTemplates?: AgentComfyTemplateInfo[];
}

function renderComfyTemplates(tpls: AgentComfyTemplateInfo[]): string {
  if (!tpls.length) return '（无可用 ComfyUI 模板——不要使用 ComfyUI 节点）';
  return tpls
    .map((t) => {
      const ctrls = t.controls.length
        ? t.controls
            .map((c) => `${c.label}(${c.type}${c.options && c.options.length ? '：' + c.options.slice(0, 8).join('/') : ''})`)
            .join('，')
        : '无可设控件';
      return `- 「${t.name}」 控件：${ctrls}`;
    })
    .join('\n');
}

/** 组装 planner 系统提示词：节点目录 + 可用模型 + 图片清单 + 输出规范 + 规则。 */
export function buildAgentSystemPrompt(ctx: AgentPlanContextInfo): string {
  const core = ALL_AGENT_KINDS.filter((k) => CATALOG[k].tier === 'core').map(renderEntry).join('\n');
  const ext = ALL_AGENT_KINDS.filter((k) => CATALOG[k].tier === 'extended').map(renderEntry).join('\n');
  const list = (arr: string[]): string => (arr.length ? arr.join('、') : '（未配置）');
  return [
    '你是「梦笔智能画布」的工作流规划助手。用户给你一句自然语言需求，你要规划出一张「节点图」来完成它，并输出严格的 JSON 蓝图。',
    '',
    '# 可用节点类型（核心优先）',
    '## 核心节点',
    core,
    '## 进阶节点（仅当用户需求明确需要时才用）',
    ext,
    '',
    '# 可用模型（系统会自动为需要模型的节点填上 modelId，你不要写 modelId）',
    `绘画模型：${list(ctx.imageModels)}`,
    `文本模型：${list(ctx.textModels)}`,
    `视频模型：${list(ctx.videoModels)}`,
    '',
    '# 可用 ComfyUI 模板（用 comfy 节点时，template 必须取下面某个名称；controls 的键取该模板列出的控件名）',
    renderComfyTemplates(ctx.comfyTemplates ?? []),
    '',
    '# 当前可用图片',
    `上传 / 拖入：${ctx.attachedCount} 张`,
    `画布已选中：${ctx.selectedImageCount} 张`,
    `资产库：${ctx.galleryAvailable ? '可选取' : '无'}`,
    '',
    '# 输出格式（只输出 JSON，不要任何解释、不要 markdown 围栏）',
    '{',
    '  "summary": "一句话中文说明你的方案",',
    '  "nodes": [{ "id": "n1", "kind": "prompt", "params": { "text": "已优化好的提示词…" }, "rationale": "为什么需要它" }],',
    '  "edges": [{ "from": "n1", "to": "n2" }],',
    '  "imageBindings": [{ "node": "nX", "source": "attached", "indexes": [0] }]',
    '}',
    '',
    '# 规则',
    '1. 文生图最简链路：prompt → work → result。把已优化好的提示词直接写进 prompt 节点的 text（你负责把用户需求扩写润色成高质量绘图提示词）。',
    '2. 需要图片输入（改图 / 风格迁移 / 反推 / 对比 / 镜头 / 光源 / 配色等）时，必须用 imageBindings 把可用图片绑定到对应节点；来源 source 取 attached / selected / gallery，优先 attached > selected > gallery；indexes 省略表示用该来源的全部图片。',
    '3. 绝不要写 modelId / seed / provider，系统会自动填。',
    '4. 优先用核心节点；只有用户需求明确需要时才用进阶节点（视频 / 分镜 / 角色 / 循环 / 文件夹 / ComfyUI）。',
    '5. id 用 n1 / n2 / … 本地编号；edges 的 from / to 必须引用这些 id。',
    '6. 连线必须符合每个节点的「可接收来源 / 可输出去向」，否则会被系统丢弃。',
    '7. 节点尽量精简，能用一条链完成就不要堆砌多余节点。'
  ].join('\n');
}
