/**
 * Obsidian 资产库笔记的纯函数部分（无 electron / fs 依赖，vitest 可测）。
 *
 * 笔记格式与用户库内现有笔记一致：
 *   frontmatter：tags / description / 创建日期（YYYY-MM-DD）
 *   已存在同名笔记 → 追加「## 补充 · 日期」小节（保留原内容，注明补充日期）
 */

/** 文件名非法字符 → 空格；折叠空白；截断；空标题兜底 */
export function sanitizeNoteTitle(raw: string): string {
  const cleaned = (raw ?? '')
    .replace(/[\\/:*?"<>|#^[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
    .trim();
  return cleaned || '未命名笔记';
}

/** YAML 单行字符串：始终双引号包裹并转义，避免冒号/井号破坏 frontmatter */
function yamlQuote(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export interface NoteBuildInput {
  title: string;
  content: string;
  /** 已清洗的标签（不带 #） */
  tags?: string[];
  description?: string;
  /** YYYY-MM-DD */
  dateIso: string;
}

/** 新建笔记全文：frontmatter + 正文 */
export function buildNoteMarkdown(input: NoteBuildInput): string {
  const tags = (input.tags ?? [])
    .map((t) => t.replace(/^#/, '').trim())
    .filter((t) => t.length > 0);
  const lines: string[] = ['---'];
  if (tags.length > 0) {
    lines.push('tags:');
    for (const t of tags) lines.push(`  - ${t}`);
  }
  if (input.description && input.description.trim()) {
    lines.push(`description: ${yamlQuote(input.description.trim().slice(0, 200))}`);
  }
  lines.push(`创建日期: ${input.dateIso}`);
  lines.push('---');
  lines.push('');
  lines.push(`# ${input.title}`);
  lines.push('');
  lines.push(input.content.trim());
  lines.push('');
  return lines.join('\n');
}

/** 追加小节（保留原内容，注明补充日期） */
export function buildAppendSection(content: string, dateIso: string): string {
  return `\n\n---\n\n## 补充 · ${dateIso}\n\n${content.trim()}\n`;
}

/** 去掉 frontmatter，返回正文（用于预览 / 摘要 / 插入画布） */
export function stripFrontmatter(md: string): string {
  const m = md.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return (m ? md.slice(m[0].length) : md).trim();
}

/** 围绕命中词截取摘要；未命中取开头。单行化，长度受控 */
export function makeExcerpt(content: string, query: string, radius = 60): string {
  const flat = stripFrontmatter(content).replace(/\s+/g, ' ').trim();
  if (!flat) return '';
  const q = query.trim().toLowerCase();
  let start = 0;
  if (q) {
    const idx = flat.toLowerCase().indexOf(q);
    if (idx > radius) start = idx - radius;
  }
  const slice = flat.slice(start, start + radius * 2 + q.length);
  return `${start > 0 ? '…' : ''}${slice}${start + slice.length < flat.length ? '…' : ''}`;
}

/** 本地时区 YYYY-MM-DD */
export function localDateIso(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
