/**
 * Obsidian 资产库核心服务（api:vault:* 与 MCP vault_* 工具共用）。
 *
 * 库 = 用户 Obsidian vault 的本地文件夹（settings 键 obsidian_vault_path），
 * 主进程直接读写 .md，不依赖 Obsidian 插件/进程。
 *
 * 安全：所有路径操作都 resolve 后校验必须落在库目录内（防 ../ 穿越）；
 * 只读写 .md；跳过 .obsidian / .trash 等点开头目录。
 */

import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { getDb } from './db';
import { logger } from './logger';
import {
  sanitizeNoteTitle,
  buildNoteMarkdown,
  buildAppendSection,
  stripFrontmatter,
  makeExcerpt,
  localDateIso
} from './vaultNote';

const PREF_VAULT_PATH = 'obsidian_vault_path';

/** 全量扫描的护栏：最多走多少个 .md（超大库防卡死） */
const MAX_SCAN_FILES = 8000;
/** 内容检索时跳过超过此大小的文件 */
const MAX_CONTENT_BYTES = 1024 * 1024;

export function getVaultPath(): string {
  const row = getDb()
    .prepare(`SELECT value FROM settings WHERE key = ?`)
    .get(PREF_VAULT_PATH) as { value: string } | undefined;
  return (row?.value ?? '').trim();
}

export function setVaultPath(p: string): void {
  getDb()
    .prepare(
      `INSERT INTO settings(key, value) VALUES(?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(PREF_VAULT_PATH, p.trim());
}

export function vaultReady(): boolean {
  const p = getVaultPath();
  return p !== '' && existsSync(p);
}

/** 相对路径 → 库内绝对路径；越界抛错 */
function resolveInVault(rel: string): string {
  const root = getVaultPath();
  if (!root) throw new Error('尚未设置 Obsidian 库路径');
  const abs = path.resolve(root, rel);
  const normRoot = path.resolve(root);
  if (abs !== normRoot && !abs.startsWith(normRoot + path.sep)) {
    throw new Error('路径超出库目录');
  }
  return abs;
}

function isSkippedDir(name: string): boolean {
  return name.startsWith('.');
}

/** 递归列出库内文件夹（相对路径，深度 ≤ maxDepth），用于导出时选分类 */
export async function listVaultFolders(maxDepth = 3): Promise<string[]> {
  const root = getVaultPath();
  if (!root || !existsSync(root)) return [];
  const out: string[] = [];
  async function walk(dirAbs: string, rel: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = await fs.readdir(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory() || isSkippedDir(e.name)) continue;
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      out.push(childRel);
      await walk(path.join(dirAbs, e.name), childRel, depth + 1);
    }
  }
  await walk(root, '', 1);
  return out.sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
}

interface MdFileRef {
  abs: string;
  /** 库内相对路径（/ 分隔） */
  rel: string;
  mtimeMs: number;
  size: number;
}

/** 遍历库内全部 .md（带数量护栏） */
async function walkMdFiles(): Promise<MdFileRef[]> {
  const root = getVaultPath();
  if (!root || !existsSync(root)) return [];
  const files: MdFileRef[] = [];
  async function walk(dirAbs: string, rel: string): Promise<void> {
    if (files.length >= MAX_SCAN_FILES) return;
    let entries;
    try {
      entries = await fs.readdir(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (files.length >= MAX_SCAN_FILES) return;
      const childAbs = path.join(dirAbs, e.name);
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!isSkippedDir(e.name)) await walk(childAbs, childRel);
        continue;
      }
      if (!e.isFile() || !e.name.toLowerCase().endsWith('.md')) continue;
      try {
        const st = await fs.stat(childAbs);
        files.push({ abs: childAbs, rel: childRel, mtimeMs: st.mtimeMs, size: st.size });
      } catch {
        /* 单文件 stat 失败跳过 */
      }
    }
  }
  await walk(root, '');
  return files;
}

export interface VaultNoteHit {
  /** 库内相对路径 */
  path: string;
  /** 文件名（不含 .md） */
  title: string;
  excerpt: string;
  mtimeMs: number;
}

/** 文件名 + 全文检索（大小写不敏感；文件名命中优先），query 为空 = 按修改时间列最近笔记 */
export async function searchVault(query: string, limit = 30): Promise<VaultNoteHit[]> {
  const files = await walkMdFiles();
  const q = query.trim().toLowerCase();
  const titleOf = (rel: string): string => path.basename(rel, path.extname(rel));

  if (!q) {
    return files
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, limit)
      .map((f) => ({ path: f.rel, title: titleOf(f.rel), excerpt: '', mtimeMs: f.mtimeMs }));
  }

  const nameHits: VaultNoteHit[] = [];
  const contentCandidates: MdFileRef[] = [];
  for (const f of files) {
    if (titleOf(f.rel).toLowerCase().includes(q) || f.rel.toLowerCase().includes(q)) {
      nameHits.push({ path: f.rel, title: titleOf(f.rel), excerpt: '', mtimeMs: f.mtimeMs });
    } else if (f.size <= MAX_CONTENT_BYTES) {
      contentCandidates.push(f);
    }
  }
  nameHits.sort((a, b) => b.mtimeMs - a.mtimeMs);

  const contentHits: VaultNoteHit[] = [];
  // 文件名命中已够 limit 时跳过全文扫描；否则按修改时间从新到旧读，凑满即停
  if (nameHits.length < limit) {
    contentCandidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
    for (const f of contentCandidates) {
      if (nameHits.length + contentHits.length >= limit) break;
      let text: string;
      try {
        text = await fs.readFile(f.abs, 'utf8');
      } catch {
        continue;
      }
      if (!text.toLowerCase().includes(q)) continue;
      contentHits.push({
        path: f.rel,
        title: titleOf(f.rel),
        excerpt: makeExcerpt(text, query),
        mtimeMs: f.mtimeMs
      });
    }
  }
  // 补上文件名命中的摘要（取开头一段），保持展示统一
  for (const h of nameHits) {
    if (h.excerpt) continue;
    try {
      const text = await fs.readFile(resolveInVault(h.path), 'utf8');
      h.excerpt = makeExcerpt(text, '');
    } catch {
      /* 摘要可缺省 */
    }
  }
  return [...nameHits, ...contentHits].slice(0, limit);
}

export interface VaultNoteContent {
  path: string;
  title: string;
  /** 原始全文（含 frontmatter） */
  raw: string;
  /** 剥掉 frontmatter 的正文 */
  body: string;
}

export async function readVaultNote(rel: string): Promise<VaultNoteContent> {
  if (!rel.toLowerCase().endsWith('.md')) throw new Error('只能读取 .md 笔记');
  const abs = resolveInVault(rel);
  const raw = await fs.readFile(abs, 'utf8');
  return {
    path: rel,
    title: path.basename(rel, path.extname(rel)),
    raw,
    body: stripFrontmatter(raw)
  };
}

export interface VaultExportInput {
  title: string;
  content: string;
  /** 库内相对文件夹（如「设计参考」）；空 = 库根 */
  folder?: string;
  tags?: string[];
  description?: string;
}

export interface VaultExportResult {
  /** 库内相对路径 */
  path: string;
  action: 'created' | 'appended';
}

/**
 * 导出笔记：先全库查重（同名 .md）——已有就追加「## 补充 · 日期」小节，
 * 没有才在指定文件夹新建（frontmatter：tags/description/创建日期）。
 */
export async function exportVaultNote(input: VaultExportInput): Promise<VaultExportResult> {
  if (!vaultReady()) throw new Error('Obsidian 库路径未设置或不可访问');
  const title = sanitizeNoteTitle(input.title);
  const dateIso = localDateIso(new Date());

  // 查重：全库找同名笔记（Obsidian 里 wikilink 按文件名解析，同名即同主题）
  const files = await walkMdFiles();
  const dupe = files.find(
    (f) => path.basename(f.rel, path.extname(f.rel)).toLowerCase() === title.toLowerCase()
  );
  if (dupe) {
    const abs = resolveInVault(dupe.rel);
    await fs.appendFile(abs, buildAppendSection(input.content, dateIso), 'utf8');
    logger.info('[vault] appended note', { path: dupe.rel });
    return { path: dupe.rel, action: 'appended' };
  }

  const folder = (input.folder ?? '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const rel = folder ? `${folder}/${title}.md` : `${title}.md`;
  const abs = resolveInVault(rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  const md = buildNoteMarkdown({
    title,
    content: input.content,
    tags: input.tags,
    description: input.description,
    dateIso
  });
  await fs.writeFile(abs, md, 'utf8');
  logger.info('[vault] created note', { path: rel });
  return { path: rel, action: 'created' };
}
