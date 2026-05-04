/**
 * 图片落盘文件名模板。
 * 模板由 parts（token 配置数组） + separator（分隔符）组成。
 *
 * 比之前更灵活：
 *   - 分辨率 token 强制用 `x` 分隔（1024x1024）
 *   - 比例 token 强制用 `:` 分隔（16:9）
 *   - 日期时间 token 可选格式（年月日 / 月日 / 20260604 / 0604 / 时间戳 等）
 *   - parts 数组顺序决定文件名顺序，前端可拖拽重排
 */

export type FilenameTokenKey =
  | 'datetime'   // 综合日期时间，可选 format
  | 'resolution' // {w}x{h}
  | 'aspect'     // {n}:{m}
  | 'desc'       // 提示词缩略 slug
  | 'model'      // 模型名 slug
  | 'taskId'     // 任务 ID
  | 'seq'        // 单任务序号
  | 'planName'   // 方案名
  | 'kind'       // 协议类型
  | 'fixed';     // 固定文本（用户填）

export interface FilenameTokenDef {
  key: FilenameTokenKey;
  label: string;
  example: string;
}

export const FILENAME_TOKENS: FilenameTokenDef[] = [
  { key: 'datetime', label: '日期/时间', example: '20260604-153045' },
  { key: 'resolution', label: '分辨率', example: '2048x1152' },
  { key: 'aspect', label: '比例', example: '16:9' },
  { key: 'desc', label: '提示词缩略', example: 'orange-cat-sunset' },
  { key: 'model', label: '模型', example: 'gpt-image-2' },
  { key: 'taskId', label: '任务 ID', example: '00042' },
  { key: 'seq', label: '序号', example: '01' },
  { key: 'planName', label: '方案名', example: 'work' },
  { key: 'kind', label: '协议类型', example: 'openai' },
  { key: 'fixed', label: '固定文本', example: 'mengbi' }
];

/** 日期时间格式选项 */
export const DATETIME_FORMATS = [
  { value: 'yyyymmdd-hhmmss', label: '年月日-时分秒（20260604-153045）', example: '20260604-153045' },
  { value: 'yyyymmdd', label: '年月日（20260604）', example: '20260604' },
  { value: 'mmdd', label: '月日（0604）', example: '0604' },
  { value: 'yyyy-mm-dd', label: '年-月-日（2026-06-04）', example: '2026-06-04' },
  { value: 'yyyy-mm-dd-hh-mm-ss', label: '年-月-日-时-分-秒', example: '2026-06-04-15-30-45' },
  { value: 'yyyymmdd_hhmm', label: '年月日_时分（20260604_1530）', example: '20260604_1530' },
  { value: 'unix', label: 'UNIX 时间戳（秒）', example: '1748956245' },
  { value: 'date-only-cn', label: '中文日期（2026年6月4日）', example: '2026年6月4日' }
] as const;

export type DatetimeFormat = typeof DATETIME_FORMATS[number]['value'];

export interface FilenamePartConfig {
  key: FilenameTokenKey;
  /** datetime 用的格式 */
  format?: DatetimeFormat;
  /** fixed token 的值 */
  text?: string;
}

export interface FilenameTemplate {
  parts: FilenamePartConfig[];
  separator: string;
}

export const DEFAULT_FILENAME_TEMPLATE: FilenameTemplate = {
  parts: [
    { key: 'datetime', format: 'yyyymmdd-hhmmss' },
    { key: 'taskId' },
    { key: 'seq' }
  ],
  separator: '-'
};

export function parseFilenameTemplate(json: string | undefined | null): FilenameTemplate {
  if (!json) return JSON.parse(JSON.stringify(DEFAULT_FILENAME_TEMPLATE));
  try {
    const obj = JSON.parse(json) as Partial<FilenameTemplate>;
    let parts: FilenamePartConfig[];
    if (Array.isArray(obj.parts) && obj.parts.length > 0) {
      parts = obj.parts
        .map((p) => normalizePart(p))
        .filter((p): p is FilenamePartConfig => p !== null);
      if (parts.length === 0) parts = DEFAULT_FILENAME_TEMPLATE.parts;
    } else {
      parts = DEFAULT_FILENAME_TEMPLATE.parts;
    }
    const separator = typeof obj.separator === 'string' ? obj.separator : '-';
    return { parts, separator };
  } catch {
    return JSON.parse(JSON.stringify(DEFAULT_FILENAME_TEMPLATE));
  }
}

/** 老格式（直接是 ['datetime', 'taskId', 'seq']）兼容 */
function normalizePart(p: unknown): FilenamePartConfig | null {
  if (typeof p === 'string') {
    if (FILENAME_TOKENS.some((t) => t.key === p)) {
      return { key: p as FilenameTokenKey };
    }
    return null;
  }
  if (p && typeof p === 'object') {
    const obj = p as Record<string, unknown>;
    const key = obj.key as FilenameTokenKey;
    if (!FILENAME_TOKENS.some((t) => t.key === key)) return null;
    const out: FilenamePartConfig = { key };
    if (typeof obj.format === 'string') out.format = obj.format as DatetimeFormat;
    if (typeof obj.text === 'string') out.text = obj.text;
    return out;
  }
  return null;
}

export function stringifyFilenameTemplate(t: FilenameTemplate): string {
  return JSON.stringify(t);
}

export interface FilenameContext {
  taskId: number;
  seq: number;
  width: number;
  height: number;
  aspect?: string;
  prompt?: string;
  model?: string;
  planName?: string;
  kind?: string;
  createdAt?: Date;
}

function slugifyDesc(s: string): string {
  if (!s) return 'untitled';
  return (
    s
      .slice(0, 60)
      .replace(/[\\/:*?"<>|]+/g, '')
      .replace(/[\s　\-_]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'untitled'
  );
}

function pad(n: number, w: number): string {
  return n.toString().padStart(w, '0');
}

function formatDateTime(d: Date, fmt: DatetimeFormat | undefined): string {
  const yyyy = String(d.getFullYear());
  const mm = pad(d.getMonth() + 1, 2);
  const dd = pad(d.getDate(), 2);
  const hh = pad(d.getHours(), 2);
  const mi = pad(d.getMinutes(), 2);
  const ss = pad(d.getSeconds(), 2);
  switch (fmt ?? 'yyyymmdd-hhmmss') {
    case 'yyyymmdd':
      return `${yyyy}${mm}${dd}`;
    case 'mmdd':
      return `${mm}${dd}`;
    case 'yyyy-mm-dd':
      return `${yyyy}-${mm}-${dd}`;
    case 'yyyy-mm-dd-hh-mm-ss':
      return `${yyyy}-${mm}-${dd}-${hh}-${mi}-${ss}`;
    case 'yyyymmdd_hhmm':
      return `${yyyy}${mm}${dd}_${hh}${mi}`;
    case 'unix':
      return Math.floor(d.getTime() / 1000).toString();
    case 'date-only-cn':
      return `${yyyy}年${d.getMonth() + 1}月${d.getDate()}日`;
    case 'yyyymmdd-hhmmss':
    default:
      return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
  }
}

function buildToken(part: FilenamePartConfig, ctx: FilenameContext): string {
  const d = ctx.createdAt ?? new Date();
  switch (part.key) {
    case 'datetime':
      return formatDateTime(d, part.format);
    case 'resolution':
      return `${ctx.width}x${ctx.height}`;
    case 'aspect':
      return ctx.aspect ?? `${ctx.width}:${ctx.height}`;
    case 'desc':
      return slugifyDesc(ctx.prompt ?? '');
    case 'model':
      return slugifyDesc(ctx.model ?? '').slice(0, 24);
    case 'taskId':
      return pad(ctx.taskId, 5);
    case 'seq':
      return pad(ctx.seq, 2);
    case 'planName':
      return slugifyDesc(ctx.planName ?? '').slice(0, 20);
    case 'kind':
      return slugifyDesc(ctx.kind ?? '').slice(0, 16);
    case 'fixed':
      return (part.text ?? '').replace(/[\\/:*?"<>|]/g, '').slice(0, 32);
  }
}

export function applyFilenameTemplate(
  template: FilenameTemplate,
  ctx: FilenameContext
): string {
  const sep = template.separator || '-';
  const parts = template.parts.map((p) => buildToken(p, ctx)).filter((s) => s.length > 0);
  if (parts.length === 0) return `${pad(ctx.taskId, 5)}-${pad(ctx.seq, 2)}`;
  return parts.join(sep);
}
