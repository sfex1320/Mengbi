/**
 * 智能分镜提示词（纯函数，配 storyboardPrompt.test.ts）。
 *
 * 2026-07-12 按「视频工作流」重做（旧「N 条分镜 + N-1 条转场」双输出方案整体删除）：
 * - 输入 = 角色描述 + 简短故事（上游文本 / 卡上素材），**一次** LLM 调用；
 * - 输出 = 一份完整的视频分镜脚本，版式（同日按用户反馈定稿）：
 *   开头一段「【定调】…」——固定整个视频的 画面风格/场景环境/主要内容物/光线色彩基调（稳定全片）；
 *   之后按时间轴「第X-Y秒：…」推进，**每个时间段独立成段（一段一段往下）**，段内写清
 *   场景有什么 / 人物做什么 / 物体如何变化 / 镜头如何运动；不用列表符号/编号标题/Markdown；
 * - 版式由代码保证（formatTimelineText：剥围栏/列表记号 + 每个时间段强制另起一段），不依赖模型自觉。
 */

/** 视频总时长预设 chips（秒 → 显示名）。 */
export const DURATION_PRESETS: Array<{ value: number; label: string }> = [
  { value: 15, label: '15s' },
  { value: 30, label: '30s' },
  { value: 60, label: '1min' },
  { value: 120, label: '2min' }
];

/** 自定义总时长的允许范围（秒）。 */
export const DURATION_MIN = 4;
export const DURATION_MAX = 600;

/** 每个时间段的秒数范围（时间轴颗粒度）。 */
export const SEC_PER_SHOT_MIN = 2;
export const SEC_PER_SHOT_MAX = 15;

const clampInt = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, Math.round(v)));

/** 时间轴规划（一切时长/段数口径的单一来源）。 */
export interface TimelinePlan {
  /** 视频总时长（秒，整数，4-600） */
  durationSec: number;
  /** 每段约几秒（2-15） */
  secPerShot: number;
  /** 预计时间段数（2-30，且不超过总秒数——保证每段 ≥1s） */
  count: number;
}

/** 由节点配置解出时间轴规划：总时长缺省 30s；段数 = 总时长 ÷ 每段秒数（四舍五入）。 */
export function resolveTimelinePlan(d: { videoDurationSec?: number; secPerShot?: number }): TimelinePlan {
  const durationSec = clampInt(d.videoDurationSec ?? 30, DURATION_MIN, DURATION_MAX);
  const secPerShot = clampInt(d.secPerShot ?? 5, SEC_PER_SHOT_MIN, SEC_PER_SHOT_MAX);
  let count = clampInt(durationSec / secPerShot, 2, 30);
  // 每段至少 1 秒：段数不超过总秒数（极短时长的护栏）
  count = Math.min(count, Math.max(2, Math.floor(durationSec)));
  return { durationSec, secPerShot, count };
}

/**
 * 分镜脚本的系统提示词（视频导演 + 分镜师，一次调用）：
 * 素材 = 角色描述 + 简短故事 → 开头【定调】段（稳定全片风格/场景/内容物）+
 * 按时间轴「第X-Y秒：…」推进的分镜段（每个时间段独立成段）。
 * 版式最终由 formatTimelineText 兜底（时间段挤成一坨时由代码拆开）。
 */
export function timelineSystem(opts: { durationSec: number; secPerShot: number; count: number; extraNote?: string }): string {
  const { durationSec, secPerShot, count, extraNote } = opts;
  const note = (extraNote ?? '').trim();
  return (
    `你是专业视频导演兼分镜师。用户素材里包含角色描述与一个简短的故事（可能分多条给出），请把它设计成一段总时长 ${durationSec} 秒的完整视频分镜脚本。输出分两部分：` +
    '第一段是定调段：以「【定调】」开头，用一段话固定整个视频的 画面风格（媒介/质感/画质）、场景与环境（地点/时代/氛围）、主要内容物与人物外观、光线与色彩基调——后续所有镜头都遵循这段定调，保证整个剧本与画面稳定统一。' +
    `之后按时间顺序输出约 ${count} 个时间段（每段约 ${secPerShot} 秒，可按叙事需要浮动）：**每个时间段独立成段（单独一行）**，以「第X-Y秒：」开头（X、Y 为秒数；第一段从 0 秒开始、最后一段到 ${durationSec} 秒结束，相邻段首尾相接、不重叠不留空），段内依次写清：` +
    '①场景与环境（地点、时间、光线氛围，场景里有什么）；' +
    '②人物在做什么（动作、表情神态、位置变化——人物外观特征必须与素材里的角色描述一致，且每一段保持一致，不许用「同上」等省略）；' +
    '③画面中物体的变化（出现/消失/移动/状态改变）；' +
    '④镜头运动（推、拉、摇、移、跟，景别与机位变化）。' +
    '格式要求：【定调】一段 + 每个时间段各占一段（段内是连续文本）；不要列表符号、不要编号标题、不要 Markdown。' +
    (note ? `额外要求：${note}。` : '') +
    '不要输出任何解释、前言或结尾，只输出脚本本身。'
  );
}

/**
 * 把 LLM 回复整理成定稿版式（由**代码**保证，不靠模型自觉）：
 * 剥 markdown 代码围栏 → 逐行剥列表/编号记号 →「【定调】」与每个「第X-Y秒：」强制另起一段
 * （模型把时间段挤成一坨时由代码拆开），段间单个换行、无空行。
 */
export function formatTimelineText(raw: string): string {
  let s = (raw ?? '').trim();
  s = s.replace(/^```[a-zA-Z]*\s*/, '').replace(/\s*```\s*$/, '');
  const lines = s
    .split(/\n+/)
    .map((l) => l.replace(/^\s*(?:[-*•·>]+|\d+\s*[.、)）])\s*/, '').trim())
    .filter(Boolean);
  let joined = lines.join('\n');
  // 每个时间段/定调段强制另起一段（「第X-Y秒：」支持 -、~、－、至、到 等区间写法）
  joined = joined.replace(/\s*(第\s*\d+\s*[-~－至到]+\s*\d+\s*秒\s*[:：])/g, '\n$1');
  joined = joined.replace(/\s*(【定调】)/g, '\n$1');
  return joined.replace(/\n{2,}/g, '\n').trim();
}
