// 智能画布「连线规则」单一真相（single source of truth）。
// 这些集合 + 校验函数原先内联在 CanvasViewport.tsx，只供手画连线校验用。
// 抽到这里导出后，被三方共用：① CanvasViewport 手画/落点校验；② 智能体节点目录（agentCatalog）推导消费/产出；
// ③ 智能体建图器（agentBuilder）连线前自校验（onConnect 本身不校验）。改规则只改这一处，杜绝漂移。

// 能产出（可作连线起点）/ 能接收（可作连线终点）的节点类型。
// result/scale 也是 producer：结果（图/文）、缩放（图）可继续连到下游节点。
export const PRODUCERS = new Set(['image', 'prompt', 'llm', 'work', 'comfy', 'group', 'angle-prompt', 'light', 'palette', 'result', 'scale', 'video', 'image-reverse', 'video-source', 'frame-interp', 'video-clip', 'ratio', 'storyboard', 'character-card', 'prompt-mall', 'loop', 'folder-input', 'upscale', 'vectorize', 'segment', 'proof']);
export const CONSUMERS = new Set(['work', 'comfy', 'result', 'llm', 'group', 'angle-prompt', 'light', 'palette', 'scale', 'ratio', 'compare', 'video', 'image-reverse', 'frame-interp', 'video-clip', 'storyboard', 'character-card', 'prompt-mall', 'folder-output', 'upscale', 'vectorize', 'segment', 'proof']);
// 纯文本产出来源（输出是一段文本，可作提示词/素材）：分镜/角色卡/反推/商城/对稿 的文字素材入口共用
export const TEXT_SOURCES = new Set(['prompt', 'llm', 'image-reverse', 'group', 'result', 'prompt-mall', 'proof', 'storyboard', 'character-card']);
// 智能分镜（2026-07-12 重做；2026-07-14 增参考图）：输入接 文本来源（角色描述 + 简短故事）
// 或 图片来源（人物形象图 / 分镜片段参考图，运行时经视觉模型读图并入素材）；
// 输出（一整段时间轴分镜脚本）只给 视频/生图/ComfyUI/LLM/分组/结果。
// 注：IMAGE_SOURCES 在下方定义，模块求值顺序上不能直接展开引用，故用字面量并集（成员保持一致）。
export const STORYBOARD_SOURCES = new Set([...TEXT_SOURCES, 'image', 'work', 'comfy', 'scale', 'folder-input', 'upscale', 'segment']);
export const STORYBOARD_TARGETS = new Set(['work', 'comfy', 'video', 'llm', 'group', 'result']);
// 角色卡（2026-07-12）：输入接 图片来源（人物照片）或 文本来源（简单描述）；
// 输出（角色卡生图提示词）给 生图/ComfyUI/视频/LLM/分镜/商城/分组/结果
export const CHARACTER_CARD_TARGETS = new Set(['work', 'comfy', 'video', 'llm', 'storyboard', 'prompt-mall', 'group', 'result']);
// 图片来源：图片/分组/生成/ComfyUI/结果/缩放/文件夹输入/保真放大 产出的图
// 注意：vectorize 产出是 SVG（终端产物），不在图片来源里（不喂栅格管线，只连 结果/文件夹输出）
export const IMAGE_SOURCES = new Set(['image', 'group', 'work', 'comfy', 'result', 'scale', 'folder-input', 'upscale', 'segment']);
// 视频来源：视频上传/视频生成/结果/缩放(可输出视频)/插帧/视频处理/视频合并/文件夹输入(扫描含视频)/分组
export const VIDEO_SOURCES = new Set(['video-source', 'video', 'result', 'scale', 'frame-interp', 'video-clip', 'folder-input', 'group']);
// 只吃图片来源做输入的节点（视角 / 光源 / 配色 / 比例分析 / 对比 / 保真放大 / 图像转矢量）。
// 缩放 与 反推(image-reverse) = 图或视频双通道，单独判定（不进本集合，否则另一路来源会被误拒）。
export const IMAGE_INPUT_ONLY = new Set(['angle-prompt', 'light', 'palette', 'ratio', 'compare', 'upscale', 'vectorize', 'segment', 'proof']);
// 只吃视频来源做输入的节点（插帧 / 视频剪辑）。反推已合并为图/视频双通道，不再只吃视频。
export const VIDEO_INPUT_ONLY = new Set(['frame-interp', 'video-clip']);
// 产出是视频的节点（其输出只能连给视频消费节点）。注意 scale 不在内（它可输出图或视频，目标更宽）。
export const VIDEO_OUTPUT_KINDS = new Set(['video-source', 'video', 'frame-interp', 'video-clip']);
// 视频消费节点（可接收视频输出）。反推（image-reverse）合并后可接视频（自动抽帧）。
export const VIDEO_CONSUMER_TARGETS = new Set(['image-reverse', 'scale', 'frame-interp', 'video-clip', 'result']);
// 能连进结果节点的来源：生成/ComfyUI/LLM/反推 写运行结果；图片/提示词/分组/缩放/视角/光源/视频=组合「实时预览」。
export const RESULT_SOURCES = new Set(['work', 'comfy', 'llm', 'group', 'prompt', 'image', 'scale', 'angle-prompt', 'light', 'palette', 'video', 'image-reverse', 'video-source', 'frame-interp', 'video-clip', 'ratio', 'storyboard', 'character-card', 'prompt-mall', 'loop', 'folder-input', 'upscale', 'vectorize', 'segment', 'proof']);
// 提示词商城：可选接 文本来源（提示词/LLM/反推/角色卡/对稿报告/分组/结果）作为额外片段并入购物车（纯文本，不接图片/视频）
export const PROMPT_MALL_SOURCES = new Set(['prompt', 'llm', 'image-reverse', 'character-card', 'group', 'result', 'proof']);
// 循环：输出只连 生图/ComfyUI/视频/结果（工作流控制节点）
export const LOOP_TARGETS = new Set(['work', 'comfy', 'video', 'result']);
// 文件夹输出：只接产图/产视频/产 SVG 的来源
export const FOLDER_OUTPUT_SOURCES = new Set(['work', 'comfy', 'video', 'scale', 'frame-interp', 'video-clip', 'result', 'group', 'upscale', 'vectorize', 'segment']);

/** 纯类型级连线校验（不依赖具体节点存在；插入连线时新节点尚未建，需用类型判断）。 */
export function canConnectKinds(sk: string | undefined, tk: string | undefined): boolean {
  if (!sk || !tk) return false;
  if (!PRODUCERS.has(sk) || !CONSUMERS.has(tk)) return false;
  if (tk === 'result' && !RESULT_SOURCES.has(sk)) return false;
  if (IMAGE_INPUT_ONLY.has(tk) && !IMAGE_SOURCES.has(sk)) return false;
  if (VIDEO_INPUT_ONLY.has(tk) && !VIDEO_SOURCES.has(sk)) return false;
  // 缩放节点：接图片来源或视频来源都行（图→canvas 缩放 / 视频→ffmpeg 缩放）
  if (tk === 'scale' && !IMAGE_SOURCES.has(sk) && !VIDEO_SOURCES.has(sk)) return false;
  // 反推节点：接 图片 / 视频（抽帧）/ 文本（角色反推的角色素材）三路来源，都不是才拒
  if (tk === 'image-reverse' && !IMAGE_SOURCES.has(sk) && !VIDEO_SOURCES.has(sk) && !TEXT_SOURCES.has(sk)) return false;
  // 视频产出节点（上传/生成/插帧/视频剪辑）→ 下游只有视频消费节点能接（反推/缩放/插帧/视频剪辑/结果）；
  // folder-output 例外（视频也能落盘），放行给后面的 FOLDER_OUTPUT_SOURCES 白名单接管。
  if (VIDEO_OUTPUT_KINDS.has(sk) && tk !== 'folder-output' && !VIDEO_CONSUMER_TARGETS.has(tk)) return false;
  // 尺寸来源(ratio) 的产出是 SizeSpec → 下游只有 生图 / ComfyUI / 视频 消费，外加「结果」节点（查看输出）；白名单钳制避免误放行 ratio→llm/scale
  if (sk === 'ratio' && !(tk === 'work' || tk === 'comfy' || tk === 'video' || tk === 'result')) return false;
  // 智能分镜：输入只接文本来源（角色描述 + 简短故事）；输出按白名单连下游（主要是视频）
  if (tk === 'storyboard' && !STORYBOARD_SOURCES.has(sk)) return false;
  if (sk === 'storyboard' && !STORYBOARD_TARGETS.has(tk)) return false;
  // 角色卡：输入接 图片来源（人物照片）或 文本来源（简单描述）；输出按白名单连下游（主要是生图）
  if (tk === 'character-card' && !IMAGE_SOURCES.has(sk) && !TEXT_SOURCES.has(sk)) return false;
  if (sk === 'character-card' && !CHARACTER_CARD_TARGETS.has(tk)) return false;
  // 提示词商城：输入只接文本来源（可选）；输出（合成提示词）连 分镜/角色卡/生图/ComfyUI/视频/LLM/分组/结果
  if (tk === 'prompt-mall' && !PROMPT_MALL_SOURCES.has(sk)) return false;
  if (sk === 'prompt-mall' && !(tk === 'storyboard' || tk === 'character-card' || tk === 'work' || tk === 'comfy' || tk === 'video' || tk === 'llm' || tk === 'group' || tk === 'result')) return false;
  // 图像转矢量：产出是 SVG（终端产物）→ 只能连 结果（查看）/ 文件夹输出（另存），不喂栅格管线
  if (sk === 'vectorize' && !(tk === 'result' || tk === 'folder-output')) return false;
  // 循环：无输入口（CONSUMERS 已排除）；输出按白名单钳制
  if (sk === 'loop' && !LOOP_TARGETS.has(tk)) return false;
  // 文件夹输出：只接产图/产视频来源
  if (tk === 'folder-output' && !FOLDER_OUTPUT_SOURCES.has(sk)) return false;
  // 文件夹输入是纯图片来源：与 image 同语义（IMAGE_SOURCES 已含），无额外钳制
  return true;
}

/** 非法连线的具体原因（落在节点上但被 isValidConnection 拒绝时给用户解释）。 */
export function invalidReason(sk: string | undefined, tk: string | undefined): string {
  if (sk && tk && sk === tk) return '不能连到自己';
  if (sk && !PRODUCERS.has(sk)) return '该节点不能作为输出来源';
  if (tk && !CONSUMERS.has(tk)) return '图片 / 提示词只能作为输入来源，不能接收输入';
  if (tk === 'result' && sk && !RESULT_SOURCES.has(sk)) return '结果节点只接 生成 / ComfyUI / LLM 的输出';
  if (tk && IMAGE_INPUT_ONLY.has(tk) && sk && !IMAGE_SOURCES.has(sk)) return '该节点的输入只接图片来源（图片 / 分组 / 生成 / ComfyUI / 结果 / 缩放）';
  if (tk && VIDEO_INPUT_ONLY.has(tk) && sk && !VIDEO_SOURCES.has(sk)) return '该节点只接视频来源（视频上传 / 视频生成 / 结果 / 缩放 / 插帧）';
  if (tk === 'scale' && sk && !IMAGE_SOURCES.has(sk) && !VIDEO_SOURCES.has(sk)) return '缩放节点只接图片或视频来源';
  if (tk === 'image-reverse' && sk && !IMAGE_SOURCES.has(sk) && !VIDEO_SOURCES.has(sk) && !TEXT_SOURCES.has(sk)) return '反推节点只接 图片 / 视频 / 文本（角色素材）来源';
  if (VIDEO_OUTPUT_KINDS.has(sk ?? '') && tk !== 'folder-output' && !VIDEO_CONSUMER_TARGETS.has(tk ?? '')) return '视频的输出只能连到 反推 / 缩放 / 插帧 / 视频剪辑 / 结果 / 文件夹输出 节点';
  if (sk === 'ratio' && !(tk === 'work' || tk === 'comfy' || tk === 'video' || tk === 'result')) return '尺寸来源的输出只能连到 生图 / ComfyUI / 视频 / 结果 节点';
  if (tk === 'storyboard' && sk && !STORYBOARD_SOURCES.has(sk)) return '智能分镜接 文本来源（角色描述 + 简短故事）或 图片来源（人物形象 / 分镜片段参考图）';
  if (sk === 'storyboard' && tk && !STORYBOARD_TARGETS.has(tk)) return '分镜脚本只能连到 视频 / 生图 / ComfyUI / LLM / 分组 / 结果 节点';
  if (tk === 'character-card' && sk && !IMAGE_SOURCES.has(sk) && !TEXT_SOURCES.has(sk)) return '角色卡只接 图片来源（人物照片）或 文本来源（简单描述）';
  if (sk === 'character-card' && tk && !CHARACTER_CARD_TARGETS.has(tk)) return '角色卡提示词只能连到 生图 / ComfyUI / 视频 / LLM / 分镜 / 提示词商城 / 分组 / 结果 节点';
  if (tk === 'prompt-mall' && sk && !PROMPT_MALL_SOURCES.has(sk)) return '提示词商城只接文本来源（提示词 / LLM / 反推 / 角色卡 / 分组 / 结果）作为额外片段';
  if (sk === 'prompt-mall') return '提示词商城的输出只能连到 分镜 / 角色卡 / 生图 / ComfyUI / 视频 / LLM / 分组 / 结果 节点';
  if (sk === 'vectorize' && !(tk === 'result' || tk === 'folder-output')) return 'SVG 是终端产物，只能连到 结果 / 文件夹输出 节点';
  if (sk === 'loop') return '循环的输出只能连到 生图 / ComfyUI / 视频 / 结果 节点';
  if (tk === 'folder-output') return '文件夹输出只接 生图 / ComfyUI / 视频 / 缩放 / 结果 / 分组 的产出';
  return '这两个节点之间不允许连接';
}
