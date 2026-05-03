/**
 * 图片落盘文件名模板。
 * 模板由 parts（token 数组） + separator（分隔符）组成。
 * tokens 见 FILENAME_TOKENS。例如：
 *   parts = ['datetime', 'aspect', 'resolution', 'model']
 *   separator = '_'
 *   → "2026-05-03_16-9_2048x1152_gpt-image-2.png"
 */

export type FilenameTokenKey =
  | 'datetime'
  | 'date'
  | 'time'
  | 'resolution'
  | 'aspect'
  | 'desc'
  | 'model'
  | 'taskId'
  | 'seq';

export interface FilenameTokenDef {
  key: FilenameTokenKey;
  label: string;
  /** 在 UI tip 里告诉用户这个 token 长什么样 */
  example: string;
}

export const FILENAME_TOKENS: FilenameTokenDef[] = [
  { key: 'datetime', label: '日期时间', example: '20260503-153045' },
  { key: 'date', label: '日期', example: '20260503' },
  { key: 'time', label: '时间', example: '153045' },
  { key: 'resolution', label: '分辨率', example: '2048x1152' },
  { key: 'aspect', label: '比例', example: '16-9' },
  { key: 'desc', label: '提示词缩略', example: 'orange-cat-sunset' },
  { key: 'model', label: '模型', example: 'gpt-image-2' },
  { key: 'taskId', label: '任务 ID', example: '00042' },
  { key: 'seq', label: '序号', example: '01' }
];

export interface FilenameTemplate {
  parts: FilenameTokenKey[];
  separator: string;
}

export const DEFAULT_FILENAME_TEMPLATE: FilenameTemplate = {
  parts: ['date', 'taskId', 'seq'],
  separator: '-'
};

export function parseFilenameTemplate(json: string | undefined | null): FilenameTemplate {
  if (!json) return { ...DEFAULT_FILENAME_TEMPLATE };
  try {
    const obj = JSON.parse(json) as Partial<FilenameTemplate>;
    const parts = Array.isArray(obj.parts) && obj.parts.length > 0
      ? (obj.parts.filter((p) =>
          FILENAME_TOKENS.some((t) => t.key === p)
        ) as FilenameTokenKey[])
      : DEFAULT_FILENAME_TEMPLATE.parts;
    const separator = typeof obj.separator === 'string' ? obj.separator : '-';
    return { parts, separator };
  } catch {
    return { ...DEFAULT_FILENAME_TEMPLATE };
  }
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
  createdAt?: Date;
}

/** 把任意提示词压成 ASCII safe 的短文件名片段 */
function slugifyDesc(s: string): string {
  if (!s) return 'untitled';
  // 取前 60 字，扣掉非 ASCII 标点 / 空白合并成 -
  return s
    .slice(0, 60)
    .replace(/[\\/:*?"<>|]+/g, '')
    .replace(/[\s　\-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'untitled';
}

function pad(n: number, w: number): string {
  return n.toString().padStart(w, '0');
}

function buildToken(key: FilenameTokenKey, ctx: FilenameContext): string {
  const d = ctx.createdAt ?? new Date();
  switch (key) {
    case 'datetime':
      return `${d.getFullYear()}${pad(d.getMonth() + 1, 2)}${pad(d.getDate(), 2)}-${pad(d.getHours(), 2)}${pad(d.getMinutes(), 2)}${pad(d.getSeconds(), 2)}`;
    case 'date':
      return `${d.getFullYear()}${pad(d.getMonth() + 1, 2)}${pad(d.getDate(), 2)}`;
    case 'time':
      return `${pad(d.getHours(), 2)}${pad(d.getMinutes(), 2)}${pad(d.getSeconds(), 2)}`;
    case 'resolution':
      return `${ctx.width}x${ctx.height}`;
    case 'aspect':
      return (ctx.aspect ?? `${ctx.width}-${ctx.height}`).replace(':', '-');
    case 'desc':
      return slugifyDesc(ctx.prompt ?? '');
    case 'model':
      return slugifyDesc(ctx.model ?? '').slice(0, 24);
    case 'taskId':
      return pad(ctx.taskId, 5);
    case 'seq':
      return pad(ctx.seq, 2);
  }
}

/** 根据模板算最终文件名（不含扩展名） */
export function applyFilenameTemplate(
  template: FilenameTemplate,
  ctx: FilenameContext
): string {
  const sep = template.separator || '-';
  const parts = template.parts.map((k) => buildToken(k, ctx)).filter(Boolean);
  if (parts.length === 0) return `${pad(ctx.taskId, 5)}-${pad(ctx.seq, 2)}`;
  return parts.join(sep);
}
