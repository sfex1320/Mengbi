import { describe, it, expect } from 'vitest';
import {
  sanitizeNoteTitle,
  buildNoteMarkdown,
  buildAppendSection,
  stripFrontmatter,
  makeExcerpt,
  localDateIso
} from './vaultNote';

describe('sanitizeNoteTitle', () => {
  it('剥文件名非法字符 + 折叠空白', () => {
    expect(sanitizeNoteTitle('角色卡: Luna/月见 <v2>')).toBe('角色卡 Luna 月见 v2');
    expect(sanitizeNoteTitle('a#b^c[d]e|f')).toBe('a b c d e f');
  });
  it('超长截断到 60、空标题兜底', () => {
    expect(sanitizeNoteTitle('x'.repeat(100))).toHaveLength(60);
    expect(sanitizeNoteTitle('  ')).toBe('未命名笔记');
    expect(sanitizeNoteTitle('###')).toBe('未命名笔记');
  });
});

describe('buildNoteMarkdown', () => {
  it('frontmatter 含 tags / description / 创建日期，正文带 # 标题', () => {
    const md = buildNoteMarkdown({
      title: '林夏角色设定',
      content: '一段外观分析。',
      tags: ['角色设定', '#剧本'],
      description: '梦笔导出的角色卡',
      dateIso: '2026-07-12'
    });
    expect(md.startsWith('---\n')).toBe(true);
    expect(md).toContain('tags:');
    expect(md).toContain('  - 角色设定');
    expect(md).toContain('  - 剧本'); // #前缀被剥掉
    expect(md).toContain('description: "梦笔导出的角色卡"');
    expect(md).toContain('创建日期: 2026-07-12');
    expect(md).toContain('# 林夏角色设定');
    expect(md).toContain('一段外观分析。');
  });

  it('description 含引号/冒号安全转义；无 tags 不输出 tags 段', () => {
    const md = buildNoteMarkdown({
      title: 't',
      content: 'c',
      description: 'he said: "hi"',
      dateIso: '2026-07-12'
    });
    expect(md).toContain('description: "he said: \\"hi\\""');
    expect(md).not.toContain('tags:');
  });
});

describe('buildAppendSection / stripFrontmatter', () => {
  it('追加小节带分隔线与补充日期', () => {
    const s = buildAppendSection('新增内容', '2026-07-12');
    expect(s).toContain('---');
    expect(s).toContain('## 补充 · 2026-07-12');
    expect(s).toContain('新增内容');
  });

  it('stripFrontmatter：剥掉 frontmatter 只留正文；无 frontmatter 原样返回', () => {
    const md = buildNoteMarkdown({ title: 't', content: '正文', dateIso: '2026-07-12' });
    const body = stripFrontmatter(md);
    expect(body.startsWith('# t')).toBe(true);
    expect(body).not.toContain('创建日期');
    expect(stripFrontmatter('普通文本')).toBe('普通文本');
  });
});

describe('makeExcerpt', () => {
  it('围绕命中词截取并加省略号', () => {
    const content = `${'前'.repeat(200)}命中词${'后'.repeat(200)}`;
    const ex = makeExcerpt(content, '命中词');
    expect(ex).toContain('命中词');
    expect(ex.startsWith('…')).toBe(true);
    expect(ex.endsWith('…')).toBe(true);
  });
  it('未命中 / 空 query 取开头；先剥 frontmatter', () => {
    const md = buildNoteMarkdown({ title: '标题', content: '正文内容', dateIso: '2026-07-12' });
    const ex = makeExcerpt(md, '');
    expect(ex).toContain('# 标题');
    expect(ex).not.toContain('---');
  });
});

describe('localDateIso', () => {
  it('本地时区 YYYY-MM-DD', () => {
    expect(localDateIso(new Date(2026, 6, 12, 3, 4, 5))).toBe('2026-07-12');
    expect(localDateIso(new Date(2026, 0, 2))).toBe('2026-01-02');
  });
});
