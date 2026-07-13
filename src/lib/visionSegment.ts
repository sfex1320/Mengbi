/**
 * 切分 / 对稿 共享的「视觉模型 → 结构化元素」纯逻辑：
 * - 系统提示词（检测元素框 + 逐元素反推 / 海报逐元素检错）
 * - 把视觉模型返回的 JSON 容错解析成元素数组（坐标归一化兜底：0~1 / 0~1000 / 像素 / [x,y,w,h] / 角点 / box_2d）
 * - 由对稿元素拼审稿报告文本
 *
 * 纯函数，单测覆盖（visionSegment.test.ts）。坐标统一输出为「源图像素」的 ElementRect。
 */
import { extractJsonBlock } from '@/lib/jsonPrompt';
import {
  PROOF_ISSUE_LABELS,
  PROOF_SEVERITY_LABELS,
  type ElementRect,
  type ProofElement,
  type ProofIssueType,
  type ProofSeverity,
  type SegElement
} from '@shared/smartCanvas';

// ───────────────────────── 系统提示词 ─────────────────────────

/** 切分：一次性返回每个元素的 名称 + 边界框 + 重绘提示词（把检测与逐元素反推合到一个调用，省成本）。 */
export const SEGMENT_DETECT_SYSTEM = `你是版面元素检测助手。给定一张图（海报/插画/设计稿），找出画面里**独立的视觉元素**（主体、人物、文字块、Logo、图标、商品、装饰物等），逐个给出名称、边界框和「用于重绘该元素的提示词」。
严格只输出一个 JSON 数组，不要任何解释、不要 Markdown 代码围栏：
[{"label":"元素名(中文)","box":[x,y,w,h],"prompt":"重绘该元素的中文提示词，含主体/材质/颜色/风格细节"}]
坐标参照系：以**整张图**为参照，图像左上角为原点 (0,0)，向右为 x 正方向、向下为 y 正方向；x,y=元素左上角，w,h=宽高，全部用**归一化 0~1 小数**（如 0.1250）。禁止用 0~1000、禁止用像素值。
框的精确度要求：
- 框必须**紧贴元素的可见边缘**（外接矩形）：不留大边距，也不许切掉元素的任何一角
- **不要漏掉小元素**：小图标、小字、角标、点缀装饰都要单独标出
- 重叠/遮挡的元素**分别单独标注**（各给各的框，框之间允许重叠）
- 文字逐块标出（标题/副标题/正文分开），Logo 图形与 Logo 文字分开
元素数量 3~30 个，按「先大后小」排列，覆盖画面全部可见元素。`;

/** 切分·二次细化：把已识别的框列表回喂模型查漏补缺 + 修正边界（要求回显 id，便于把结果合并回已重绘的元素）。 */
export const SEGMENT_REFINE_SYSTEM = `你是版面元素检测的校对助手。给定一张图和「已识别的元素列表」（含 id / 名称 / 归一化边界框），逐项对照原图核查：
1. **修正边界**：框没贴紧元素可见边缘的，按元素真实范围修正（外接矩形，不留大边距、不切角）
2. **查漏补缺**：画面里有但列表漏掉的元素（尤其小图标、小字、角标、被遮挡的元素）补充进来
3. **剔除误检**：列表里画面中并不存在的元素删掉
严格只输出一个 JSON 数组（修正后的完整列表），不要解释、不要 Markdown 围栏：
[{"id":"保留原有元素的 id；新增元素不填","label":"元素名(中文)","box":[x,y,w,h],"prompt":"重绘该元素的中文提示词"}]
坐标参照系：以整张图为参照，左上角为原点 (0,0)；x,y=元素左上角，w,h=宽高，全部用**归一化 0~1 小数**。禁止 0~1000、禁止像素值。`;

/** 对稿：逐元素检错（字体/元素/logo/形态）。 */
export const PROOF_SYSTEM = `你是资深平面设计审稿助手。逐个检查这张海报/设计图里的每个元素，判断是否存在以下问题：
- font：字体/文字错误（错别字、缺字、乱码、字体崩坏、文字变形）
- element：元素错误（元素画崩、结构错乱、多余/缺失、拼接错误）
- logo：Logo/图标错误（知名 Logo 画错、变形、配色错误，如微信图标画崩）
- shape：形态错误（人体/物体形态异常，如手只有 4 根手指、肢体扭曲、比例失调）
逐个元素给出结论。严格只输出一个 JSON 数组，不要解释、不要 Markdown 围栏：
[{"label":"元素名","box":[x,y,w,h],"ok":false,"issue_types":["font","shape"],"severity":"high","description":"具体问题","suggestion":"修改建议"}]
坐标用**归一化 0~1**（[x,y,w,h]，左上角原点；禁止 0~1000 / 像素）。severity ∈ high|medium|low；没问题的元素 ok=true、issue_types=[]、severity="ok"。
覆盖画面主要元素，重点标出有问题的元素。`;

// ───────────────────────── 坐标归一化 ─────────────────────────

/** 整框的两轴换算系数：把模型给的值乘上它得到源图像素。
 *  坐标系解释（归一化 / 0~1000 / 像素）必须**整框统一判定**——按「长边是否 >1000」判 0~1000，再分别给两轴系数。
 *  历史 bug：原先逐轴各自判定，宽图 3000×900 收到 0~1000 坐标时 x 轴按 0~1000 换算、y 轴却按像素解释 → 框整体错位。 */
function rectFactors(maxv: number, imgW: number, imgH: number): { fx: number; fy: number } {
  if (maxv <= 1.5) return { fx: imgW, fy: imgH }; // 归一化 0~1
  if (maxv <= 1000 && Math.max(imgW, imgH) > 1000) return { fx: imgW / 1000, fy: imgH / 1000 }; // 0~1000（Gemini 系）：仅当源图长边大于 1000 时才这么判，避免和像素混淆
  return { fx: 1, fy: 1 }; // 像素
}

function clampRect(r: ElementRect, imgW: number, imgH: number): ElementRect | null {
  const x = Math.max(0, Math.min(r.x, imgW - 1));
  const y = Math.max(0, Math.min(r.y, imgH - 1));
  const w = Math.max(1, Math.min(r.w, imgW - x));
  const h = Math.max(1, Math.min(r.h, imgH - y));
  if (w < 2 || h < 2) return null;
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

/** 4 个数 + 是否角点格式 → 源图像素 ElementRect（容错多种坐标系）。 */
function numsToRect(nums: number[], imgW: number, imgH: number, corners: boolean): ElementRect | null {
  if (nums.length < 4 || nums.some((n) => typeof n !== 'number' || !Number.isFinite(n))) return null;
  const a = Math.abs(nums[0]);
  const b = Math.abs(nums[1]);
  const c = Math.abs(nums[2]);
  const d = Math.abs(nums[3]);
  const maxv = Math.max(a, b, c, d);
  const { fx, fy } = rectFactors(maxv, imgW, imgH);
  let x = a * fx;
  let y = b * fy;
  let w = c * fx;
  let h = d * fy;
  if (corners) {
    // [x0,y0,x1,y1] → 宽高
    w = w - x;
    h = h - y;
  } else if ((x + w > imgW * 1.25 || y + h > imgH * 1.25) && c > a && d > b) {
    // 没声明角点，但 w/h 看起来是右下角坐标（超出且比左上大）→ 当作角点纠正
    w = w - x;
    h = h - y;
  }
  return clampRect({ x, y, w, h }, imgW, imgH);
}

/** 从一个元素对象里提取边界框数字（兼容 box / box_2d / bbox / {x,y,w,h} / {x0,y0,x1,y1}）。 */
function extractBox(obj: Record<string, unknown>, imgW: number, imgH: number): ElementRect | null {
  const arr = (v: unknown): number[] | null =>
    Array.isArray(v) && v.length >= 4 ? v.slice(0, 4).map((n) => Number(n)) : null;

  // Gemini box_2d: [ymin, xmin, ymax, xmax]（角点）→ 重排成 [xmin,ymin,xmax,ymax]
  const b2d = arr(obj.box_2d);
  if (b2d) return numsToRect([b2d[1], b2d[0], b2d[3], b2d[2]], imgW, imgH, true);

  const box = obj.box;
  if (Array.isArray(box)) {
    const n = arr(box);
    if (n) return numsToRect(n, imgW, imgH, false);
  } else if (box && typeof box === 'object') {
    const bo = box as Record<string, unknown>;
    if ('x' in bo && 'y' in bo && 'w' in bo && 'h' in bo) {
      return numsToRect([Number(bo.x), Number(bo.y), Number(bo.w), Number(bo.h)], imgW, imgH, false);
    }
  }

  const bbox = arr(obj.bbox);
  if (bbox) return numsToRect(bbox, imgW, imgH, false);

  if ('x' in obj && 'y' in obj && 'w' in obj && 'h' in obj) {
    return numsToRect([Number(obj.x), Number(obj.y), Number(obj.w), Number(obj.h)], imgW, imgH, false);
  }
  if ('x0' in obj && 'y0' in obj && 'x1' in obj && 'y1' in obj) {
    return numsToRect([Number(obj.x0), Number(obj.y0), Number(obj.x1), Number(obj.y1)], imgW, imgH, true);
  }
  return null;
}

/** 解析数组：从 LLM 原文里抽出 JSON 数组（容错围栏/前后缀）。 */
function parseArray(raw: string): Record<string, unknown>[] {
  const cleaned = extractJsonBlock(raw);
  let data: unknown;
  try {
    data = JSON.parse(cleaned);
  } catch {
    return [];
  }
  // 可能是 {elements:[...]} / {items:[...]} / 直接数组
  if (Array.isArray(data)) return data.filter((x) => x && typeof x === 'object') as Record<string, unknown>[];
  if (data && typeof data === 'object') {
    for (const k of ['elements', 'items', 'objects', 'results', 'list', 'data']) {
      const v = (data as Record<string, unknown>)[k];
      if (Array.isArray(v)) return v.filter((x) => x && typeof x === 'object') as Record<string, unknown>[];
    }
  }
  return [];
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();
}

let idSeq = 0;
function nextId(prefix: string): string {
  idSeq += 1;
  return `${prefix}-${idSeq}`;
}

// ───────────────────────── 切分元素解析 ─────────────────────────

/** 视觉模型原文 → 切分元素数组（含 label / box(源图像素) / prompt）。失败返回 []。 */
export function parseSegElements(raw: string, imgW: number, imgH: number): SegElement[] {
  const out: SegElement[] = [];
  const used = new Set<string>();
  for (const obj of parseArray(raw)) {
    const box = extractBox(obj, imgW, imgH);
    if (!box) continue;
    // 「二次细化」会把带 id 的列表回喂模型：回显的 id 保留，才能把结果合并回已重绘/已手改的元素；
    // 缺失或重复的 id 走自增，保证节点内唯一。
    const echoed = str(obj.id);
    const id = echoed && !used.has(echoed) ? echoed : nextId('seg');
    used.add(id);
    out.push({
      id,
      label: str(obj.label) || str(obj.name) || str(obj.element) || `元素 ${out.length + 1}`,
      box,
      prompt: str(obj.prompt) || str(obj.description) || str(obj.caption) || '',
      status: 'idle',
      error: null
    });
  }
  return out;
}

/** 识别用图可能被等比缩放后再发送（prepareDetectImage）：必须先按「发送尺寸」解析（这样像素坐标兜底也落在正确
 *  的参照系里），再把框等比换算回源图像素。发送尺寸 == 源图尺寸时逐字节退化为 parseSegElements。 */
export function parseSegElementsScaled(raw: string, sentW: number, sentH: number, origW: number, origH: number): SegElement[] {
  const els = parseSegElements(raw, sentW, sentH);
  if (sentW === origW && sentH === origH) return els;
  const kx = origW / Math.max(1, sentW);
  const ky = origH / Math.max(1, sentH);
  return els.map((e) => {
    const x = Math.max(0, Math.min(Math.round(e.box.x * kx), origW - 1));
    const y = Math.max(0, Math.min(Math.round(e.box.y * ky), origH - 1));
    const w = Math.max(1, Math.min(Math.round(e.box.w * kx), origW - x));
    const h = Math.max(1, Math.min(Math.round(e.box.h * ky), origH - y));
    return { ...e, box: { x, y, w, h } };
  });
}

/** 二次细化合并：细化结果为准（顺序/边界/增删），但命中原 id 的元素保留其重绘产物（regenSrc/status/error），
 *  且细化没给新 prompt 时沿用原提示词——已重绘、已手改的工作不因细化而丢失。 */
export function mergeRefinedElements(prev: SegElement[], next: SegElement[]): SegElement[] {
  const byId = new Map(prev.map((p) => [p.id, p]));
  return next.map((n) => {
    const p = byId.get(n.id);
    if (!p) return n;
    return { ...p, label: n.label || p.label, box: n.box, prompt: n.prompt?.trim() ? n.prompt : p.prompt };
  });
}

/** 二次细化的用户指令：把当前元素列表（带 id + 归一化坐标）序列化回喂模型，供其查漏补缺/修正边界。 */
export function segRefineInstruction(els: SegElement[], imgW: number, imgH: number): string {
  const w = Math.max(1, imgW);
  const h = Math.max(1, imgH);
  const r4 = (v: number): number => Math.round(v * 10000) / 10000;
  const list = els.map((e) => ({
    id: e.id,
    label: e.label,
    box: [r4(e.box.x / w), r4(e.box.y / h), r4(e.box.w / w), r4(e.box.h / h)]
  }));
  return `已识别的元素列表（归一化 0~1 坐标 [x,y,w,h]，可能有漏检、边界不准或误检）：\n${JSON.stringify(list)}\n请对照原图逐项核查，输出修正后的完整元素列表（保留原有元素的 id，新增元素不填 id）。`;
}

// ───────────────────────── 对稿元素解析 ─────────────────────────

const ISSUE_SET = new Set<ProofIssueType>(['font', 'element', 'logo', 'shape']);
const SEVERITY_SET = new Set<ProofSeverity>(['high', 'medium', 'low', 'ok']);

function normIssueTypes(v: unknown): ProofIssueType[] {
  const list = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,，;；\s]+/) : [];
  const seen = new Set<ProofIssueType>();
  for (const raw of list) {
    const t = str(raw).toLowerCase();
    if (ISSUE_SET.has(t as ProofIssueType)) seen.add(t as ProofIssueType);
  }
  return [...seen];
}

function normSeverity(v: unknown, hasIssues: boolean): ProofSeverity {
  const s = str(v).toLowerCase();
  if (SEVERITY_SET.has(s as ProofSeverity)) return s as ProofSeverity;
  return hasIssues ? 'medium' : 'ok';
}

/** 视觉模型原文 → 对稿元素数组（含问题类别/严重度/描述/建议）。失败返回 []。 */
export function parseProofElements(raw: string, imgW: number, imgH: number): ProofElement[] {
  const out: ProofElement[] = [];
  for (const obj of parseArray(raw)) {
    const box = extractBox(obj, imgW, imgH);
    if (!box) continue;
    const issueTypes = normIssueTypes(obj.issue_types ?? obj.issueTypes ?? obj.issues ?? obj.types);
    const okRaw = obj.ok;
    const ok = typeof okRaw === 'boolean' ? okRaw : issueTypes.length === 0;
    out.push({
      id: nextId('proof'),
      label: str(obj.label) || str(obj.name) || str(obj.element) || `元素 ${out.length + 1}`,
      box,
      issueTypes: ok ? [] : issueTypes,
      severity: ok ? 'ok' : normSeverity(obj.severity, issueTypes.length > 0),
      description: str(obj.description) || str(obj.issue) || str(obj.problem) || '',
      suggestion: str(obj.suggestion) || str(obj.fix) || str(obj.advice) || '',
      ok
    });
  }
  return out;
}

// ───────────────────────── 审稿报告文本 ─────────────────────────

/** 把对稿元素拼成一段可读的审稿报告（节点文本输出 + 工作台展示）。 */
export function buildProofReport(elements: ProofElement[]): string {
  const problems = elements.filter((e) => !e.ok);
  const lines: string[] = [];
  lines.push(`【审稿报告】共检查 ${elements.length} 个元素，发现 ${problems.length} 处问题。`);
  if (!problems.length) {
    lines.push('未发现明显的字体/元素/Logo/形态问题。');
    return lines.join('\n');
  }
  problems.forEach((e, i) => {
    const cats = e.issueTypes.map((t) => PROOF_ISSUE_LABELS[t]).join('、') || '未分类';
    lines.push('');
    lines.push(`${i + 1}. ${e.label}　[${PROOF_SEVERITY_LABELS[e.severity]}]　${cats}`);
    if (e.description) lines.push(`   问题：${e.description}`);
    if (e.suggestion) lines.push(`   建议：${e.suggestion}`);
  });
  return lines.join('\n');
}

/** 严重度 → 标注框颜色（叠框 + 清单共用）。 */
export function severityColor(sev: ProofSeverity): string {
  switch (sev) {
    case 'high':
      return '#ef4444';
    case 'medium':
      return '#f59e0b';
    case 'low':
      return '#eab308';
    default:
      return '#22c55e';
  }
}
