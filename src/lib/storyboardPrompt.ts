/**
 * 智能分镜提示词结构（纯函数，配 storyboardPrompt.test.ts）。
 *
 * 设计：分镜提示词 = 「固定约束段 + 当前剧情 + 镜头变化 + 画面细节」。
 * 固定约束段（角色/风格/镜头/色彩/世界观/场景/服装）由**渲染端拼接**进每条分镜——
 * 跨分镜的一致性由代码保证，不依赖 LLM 自觉「每条重复角色特征」（历史上模型经常漏）。
 * LLM 只负责产 {scene, shot, detail} 对象数组（双兜底：字符串数组 / 编号行）。
 */
import type { StoryboardConstraints, StoryboardShotMeta } from '@shared/smartCanvas';
import { extractJsonBlock } from './jsonPrompt';

const CONSTRAINT_LABELS: Array<[keyof StoryboardConstraints, string]> = [
  ['character', '角色'],
  ['style', '风格'],
  ['camera', '镜头语言'],
  ['palette', '色彩氛围'],
  ['world', '世界观'],
  ['scene', '场景基调'],
  ['wardrobe', '服装外貌']
];

/** 把非空约束项拼成「角色：…，风格：…」固定段；全空返回 ''。 */
export function buildFixedBlock(c?: StoryboardConstraints): string {
  if (!c) return '';
  const parts: string[] = [];
  for (const [key, label] of CONSTRAINT_LABELS) {
    const v = c[key]?.trim();
    if (v) parts.push(`${label}：${v}`);
  }
  return parts.join('，');
}

/** 固定段 + 单条分镜元信息 → 成品图像提示词（可直接喂生图）。 */
export function composeShotPrompt(fixed: string, m: StoryboardShotMeta | string): string {
  const body =
    typeof m === 'string'
      ? m.trim()
      : [m.scene?.trim(), m.characters?.trim(), m.action?.trim(), m.shot?.trim(), m.detail?.trim()].filter(Boolean).join('，');
  if (!body) return fixed;
  return fixed ? `${fixed}。${body}` : body;
}

/** 拆分镜的系统提示词（电影分镜师）：要求 LLM 输出 {scene,characters,action,shot,detail} 对象数组（字符串数组为可接受备选）。 */
export function shotsSystem(n: number, hasConstraints: boolean): string {
  return (
    `你是专业电影分镜师。把用户给的故事拆成恰好 ${n} 个按时间顺序、镜头连贯的画面分镜。` +
    '每个分镜输出一个 JSON 对象：' +
    '{"scene":"场景与环境（地点/时间/天气/光线氛围）",' +
    '"characters":"出场人物或主体：关键外观特征 + 当前动作 + 表情神态（不许用「同上」「她」等指代省略，每条都完整复述）",' +
    '"action":"画面中正在发生的动作/事件/转变",' +
    '"shot":"景别+机位+运镜（如：中景，平视机位，缓慢推近）",' +
    '"detail":"画面细节（构图要素/色彩/材质/氛围）"}。' +
    '要求：① 像电影分镜脚本一样具体，每条各字段合计不少于 60 字；' +
    '② 相邻分镜在时间与空间上自然衔接（交代人物位置与动作的延续）；' +
    '③ 每条都必须完整复述核心人物特征与场景特征，保证单条可独立用于文生图。' +
    (hasConstraints
      ? '角色外观、画面风格等固定设定由系统统一附加在每条开头，但场景与人物动作仍须每条写全。'
      : '保持整组角色外观与画面风格一致。') +
    `只输出一个 JSON 数组（长度恰好 ${n}），不要解释、不要 markdown 代码围栏。` +
    '若无法输出对象数组，可输出纯字符串数组，每条为一句完整的图像提示词。'
  );
}

/** 镜头转场的系统提示词：N 条分镜 → N-1 条「镜头之间的转场动态」描述。 */
export function transitionsSystem(n: number): string {
  const want = Math.max(1, n - 1);
  return (
    `你是电影剪辑与运镜设计师。用户给你 ${n} 条按顺序的分镜描述，请为每对相邻分镜设计「镜头之间的转场动态」，共恰好 ${want} 条（第 i 条对应 分镜 i → 分镜 i+1）。` +
    '每条输出一个 JSON 对象：' +
    '{"motion":"镜头运动轨迹（画面如何从上一镜运动/切换到下一镜，如：镜头从面部特写缓缓拉远并向右横移）",' +
    '"transition":"运镜衔接 / 转场手法（如：硬切/叠化/匹配剪辑/甩镜/遮挡转场/推拉摇移跟）",' +
    '"change":"场景与时间的过渡（地点/光线/时间如何变化）",' +
    '"subject":"主体动作的延续（人物或主体从什么状态过渡到什么状态）"}。' +
    `只输出一个 JSON 数组（长度恰好 ${want}），不要解释、不要 markdown 代码围栏。` +
    '若无法输出对象数组，可输出纯字符串数组，每条为一段完整的转场描述。'
  );
}

/** 转场生成的用户输入：把成品分镜编号列出。 */
export function transitionsUser(shots: string[]): string {
  return shots.map((s, i) => `分镜 ${i + 1}：${s}`).join('\n');
}

/**
 * 解析转场回复（与 parseShots 同样的健壮化）：JSON 对象数组（motion/transition/change/subject 拼接）
 * → 字符串数组 → 编号行兜底。n = 分镜数，返回最多 n-1 条。
 */
export function parseTransitions(raw: string, n: number): string[] {
  const want = Math.max(0, n - 1);
  if (!want) return [];
  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  try {
    const arr = JSON.parse(extractJsonBlock(raw)) as unknown;
    if (Array.isArray(arr)) {
      const out: string[] = [];
      for (const x of arr) {
        if (typeof x === 'string') {
          const t = x.trim();
          if (t) out.push(t);
        } else if (x && typeof x === 'object') {
          const o = x as Record<string, unknown>;
          const parts = [str(o.motion), str(o.transition), str(o.change), str(o.subject)].filter(Boolean);
          if (parts.length) out.push(parts.join('，'));
          else {
            let best = '';
            for (const v of Object.values(o)) {
              const s = str(v);
              if (s.length > best.length) best = s;
            }
            if (best) out.push(best);
          }
        }
      }
      if (out.length) return out.slice(0, want);
    }
  } catch {
    /* 非 JSON 回复 → 编号行兜底 */
  }
  const lines = raw
    .split(/\n+/)
    .map((l) => l.replace(/^\s*(?:转场|镜头|分镜)?\s*\d+(?:\s*[-→~至到]+\s*\d+)?\s*[.、:：)）\]】]\s*/, '').trim())
    .filter((l) => l.length > 4);
  return lines.slice(0, want);
}

/** 故事生成的系统提示词。 */
export const STORY_SYSTEM =
  '你是故事创作助手。把用户给的素材（短句、故事片段或参考图分析）扩展成一篇结构完整的短篇故事：' +
  '有开端、发展、高潮、结尾，画面感强、角色与场景具体（外观、服装、环境可视化描述）。' +
  '用与输入相同的语言输出，只输出故事正文，不要标题、不要解释。' +
  '若输入已是完整故事，则在保留原文情节的前提下梳理润色后输出。';

/** 从对象元素里提取分镜文本（按字段优先级；彻底消灭 "[object Object]"）。 */
function shotFromObject(o: Record<string, unknown>): { text: string; meta?: StoryboardShotMeta } {
  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  const scene = str(o.scene);
  const shot = str(o.shot ?? o.camera);
  const detail = str(o.detail);
  const characters = str(o.characters ?? o.character);
  const action = str(o.action);
  if (scene || shot || detail || characters || action) {
    return {
      text: [scene, characters, action, shot, detail].filter(Boolean).join('，'),
      meta: { scene, shot, detail, characters, action }
    };
  }
  // 常见替代字段
  for (const key of ['prompt', 'text', 'description', 'content', 'caption']) {
    const v = str(o[key]);
    if (v) return { text: v };
  }
  // 最后兜底：取值里最长的字符串（绝不输出 [object Object]）
  let best = '';
  for (const v of Object.values(o)) {
    const s = str(v);
    if (s.length > best.length) best = s;
  }
  return { text: best };
}

export interface ParsedShots {
  shots: string[];
  meta?: StoryboardShotMeta[];
}

/**
 * 解析 LLM 的分镜回复（健壮化三层兜底）：
 * ① JSON 数组：对象元素按 scene/shot/detail → prompt/text/description/content → 最长字符串值 提取；
 *    字符串元素原样。② 非 JSON：编号行拆分。返回的 shots 不含固定约束段（由调用方 compose）。
 */
export function parseShots(raw: string, n: number): ParsedShots {
  try {
    const arr = JSON.parse(extractJsonBlock(raw)) as unknown;
    if (Array.isArray(arr)) {
      const shots: string[] = [];
      const meta: StoryboardShotMeta[] = [];
      let hasMeta = false;
      for (const x of arr) {
        if (typeof x === 'string') {
          const t = x.trim();
          if (t) {
            shots.push(t);
            meta.push({});
          }
        } else if (x && typeof x === 'object') {
          const r = shotFromObject(x as Record<string, unknown>);
          if (r.text) {
            shots.push(r.text);
            meta.push(r.meta ?? {});
            if (r.meta) hasMeta = true;
          }
        } else if (x != null) {
          const t = String(x).trim();
          if (t) {
            shots.push(t);
            meta.push({});
          }
        }
      }
      if (shots.length) {
        const cap = Math.max(n, 1);
        return { shots: shots.slice(0, cap), meta: hasMeta ? meta.slice(0, cap) : undefined };
      }
    }
  } catch {
    /* 非 JSON 回复 → 编号行兜底 */
  }
  const lines = raw
    .split(/\n+/)
    .map((l) => l.replace(/^\s*(?:分镜|镜头|场景)?\s*\d+\s*[.、:：)）\]】]\s*/, '').trim())
    .filter((l) => l.length > 4);
  return { shots: lines.slice(0, Math.max(n, 1)) };
}
