/**
 * 提示词自动打标签——纯启发式，零网络。
 * 抽出主体、风格、和高频关键词。把这些 merge 进用户已有 tags 就行。
 *
 * 设计原则：
 *   - 误报 < 漏报：只对明确关键词命中才打标，不会硬塞奇怪词；
 *   - 中英混排都要识别；
 *   - 输出最多 8 个标签，避免一卡爆十几个 chip。
 */

interface DictEntry {
  /** 标签输出名 */
  tag: string;
  /** 命中触发词（小写、可中文） */
  triggers: string[];
}

const SUBJECT_DICT: DictEntry[] = [
  { tag: '人像', triggers: ['人像', '人物', '肖像', '少女', '男子', '女子', 'portrait', 'person', 'character'] },
  { tag: '风景', triggers: ['风景', '山川', '森林', '草原', '湖泊', '海边', '城市天际线', 'landscape', 'mountain', 'forest'] },
  { tag: '动物', triggers: ['动物', '猫', '狗', '老虎', '狮子', '兔子', '熊猫', 'cat', 'dog', 'tiger', 'lion', 'panda', 'animal'] },
  { tag: '食物', triggers: ['食物', '美食', '蛋糕', '甜点', '咖啡', '面条', '寿司', 'food', 'cake', 'coffee', 'meal'] },
  { tag: '建筑', triggers: ['建筑', '楼房', '寺庙', '教堂', '城堡', 'architecture', 'building', 'castle', 'temple'] },
  { tag: '科幻', triggers: ['科幻', '飞船', '机甲', '机器人', 'sci-fi', 'spaceship', 'mecha', 'robot'] },
  { tag: '幻想', triggers: ['幻想', '魔法', '巨龙', '精灵', 'fantasy', 'magic', 'dragon', 'elf'] },
  { tag: '静物', triggers: ['静物', 'still life'] }
];

const STYLE_DICT: DictEntry[] = [
  { tag: '写实', triggers: ['写实', '照片', '摄影', 'photorealistic', 'realistic', 'photograph'] },
  { tag: '动漫', triggers: ['动漫', '日漫', '二次元', 'anime', 'manga'] },
  { tag: '卡通', triggers: ['卡通', 'cartoon', 'toon'] },
  { tag: '油画', triggers: ['油画', 'oil painting', 'oil paint'] },
  { tag: '水彩', triggers: ['水彩', 'watercolor', 'watercolour'] },
  { tag: '水墨', triggers: ['水墨', '国画', 'ink wash', 'chinese ink'] },
  { tag: '像素艺术', triggers: ['像素', 'pixel art', '8-bit', '16-bit'] },
  { tag: '赛博朋克', triggers: ['赛博朋克', 'cyberpunk', '霓虹'] },
  { tag: '蒸汽朋克', triggers: ['蒸汽朋克', 'steampunk'] },
  { tag: '国风', triggers: ['中国风', '国风', '汉服', '古风'] },
  { tag: '极简', triggers: ['极简', 'minimalist', 'minimal'] },
  { tag: '低多边形', triggers: ['low poly', 'lowpoly', '低多边形'] },
  { tag: '3D 渲染', triggers: ['3d 渲染', '3d render', 'octane', 'unreal engine'] }
];

/** 通用语料停用词，避免被当成关键词抽出来 */
const STOP_WORDS = new Set([
  '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一', '一个', '上', '也',
  '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好', '自己', '这', '那',
  'a', 'an', 'the', 'and', 'of', 'in', 'on', 'at', 'to', 'is', 'are', 'with', 'for',
  'by', 'from', 'as', 'be', 'or', 'this', 'that', 'it', 'its', 'his', 'her', 'their',
  'i', 'you', 'we', 'he', 'she', 'they', 'we', 'no', 'yes', 'not', 'have', 'has', 'had'
]);

function matchDict(text: string, dict: DictEntry[]): string[] {
  const lower = text.toLowerCase();
  const out: string[] = [];
  for (const d of dict) {
    for (const t of d.triggers) {
      if (lower.includes(t)) {
        out.push(d.tag);
        break;
      }
    }
  }
  return out;
}

/** 抽出 prompt 中的中英文关键词（粗暴启发式：英文单词 + 中文 2-4 字片段） */
function extractKeywords(text: string, max = 4): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  // 英文：连续字母数字组成的 token
  const enTokens = text
    .toLowerCase()
    .match(/[a-z][a-z0-9-]{2,}/g) ?? [];
  for (const tok of enTokens) {
    if (STOP_WORDS.has(tok)) continue;
    if (seen.has(tok)) continue;
    seen.add(tok);
    out.push(tok);
    if (out.length >= max) return out;
  }

  // 中文：2-4 字连续汉字
  const cnTokens = text.match(/[一-龥]{2,4}/g) ?? [];
  for (const tok of cnTokens) {
    if (STOP_WORDS.has(tok)) continue;
    if (seen.has(tok)) continue;
    seen.add(tok);
    out.push(tok);
    if (out.length >= max) return out;
  }

  return out;
}

export interface AutoTagResult {
  /** 主体 */
  subject: string[];
  /** 风格 */
  style: string[];
  /** 关键词（top N） */
  keywords: string[];
  /** 模型 */
  model: string[];
  /** 合并后去重的最终列表（最多 maxTotal 项） */
  merged: string[];
}

/**
 * 自动打标。与现有 tags 合并去重；最多返回 maxTotal 项。
 * @param text  正向提示词内容
 * @param modelHint  生成这条 prompt 所用的模型显示名（可空）
 * @param existing  现有 tags
 * @param maxTotal  合并后的最大数量
 */
export function autoTag(
  text: string,
  modelHint: string | null,
  existing: string[],
  maxTotal = 8
): AutoTagResult {
  const subject = matchDict(text, SUBJECT_DICT);
  const style = matchDict(text, STYLE_DICT);
  const keywords = extractKeywords(text, 4);
  const model = modelHint ? [modelHint] : [];

  const merged: string[] = [];
  const seen = new Set<string>();
  for (const arr of [existing, model, subject, style, keywords]) {
    for (const t of arr) {
      const norm = t.trim();
      if (!norm) continue;
      if (seen.has(norm)) continue;
      seen.add(norm);
      merged.push(norm);
      if (merged.length >= maxTotal) break;
    }
    if (merged.length >= maxTotal) break;
  }

  return { subject, style, keywords, model, merged };
}
