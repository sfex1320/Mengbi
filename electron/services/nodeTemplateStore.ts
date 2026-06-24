/**
 * 智能画布「节点模板」文件存储（2026-06-22）。
 *
 * 按用户要求：节点模板存在「和软件一样的配置文件夹下」——即 userData/node-templates/，
 * 每个模板一个独立 .json 文件（便于单独查看 / 备份 / 分享一个模板）。
 * 取代原先的 localStorage 持久化（受配额限制、不可见、难分享）。
 *
 * 文件内容 = 渲染端 SmartTemplate 的整体快照（id / name / createdAt / count / nodes / edges）。
 * 主进程把它当不透明 JSON 处理，只认 id（文件名）与 name（重命名时改）。
 */
import { app } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';

export interface StoredTemplate {
  id: string;
  name: string;
  createdAt: string;
  count: number;
  nodes: unknown[];
  edges: unknown[];
  [k: string]: unknown;
}

export function getNodeTemplatesDir(): string {
  return path.join(app.getPath('userData'), 'node-templates');
}

/** 把模板 id 归一成安全文件名（与 list/remove/rename 一致，保证可寻址）。 */
function fileFor(id: string): string {
  const safe = id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'tpl';
  return `${safe}.json`;
}

export async function listNodeTemplates(): Promise<StoredTemplate[]> {
  const dir = getNodeTemplatesDir();
  let names: string[] = [];
  try {
    names = await fs.readdir(dir);
  } catch {
    return []; // 目录还没建 = 还没有模板
  }
  const out: StoredTemplate[] = [];
  for (const n of names) {
    if (!n.toLowerCase().endsWith('.json')) continue;
    try {
      const raw = await fs.readFile(path.join(dir, n), 'utf-8');
      const t = JSON.parse(raw) as StoredTemplate;
      if (t && typeof t.id === 'string') out.push(t);
    } catch {
      /* 跳过损坏文件 */
    }
  }
  // 新建在前（按 createdAt 倒序）
  out.sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
  return out;
}

export async function saveNodeTemplate(t: StoredTemplate): Promise<void> {
  const dir = getNodeTemplatesDir();
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, fileFor(t.id)), JSON.stringify(t, null, 2), 'utf-8');
}

export async function removeNodeTemplate(id: string): Promise<void> {
  try {
    await fs.unlink(path.join(getNodeTemplatesDir(), fileFor(id)));
  } catch {
    /* 文件不存在 = 视为已删除 */
  }
}

export async function renameNodeTemplate(id: string, name: string): Promise<void> {
  const fp = path.join(getNodeTemplatesDir(), fileFor(id));
  try {
    const raw = await fs.readFile(fp, 'utf-8');
    const t = JSON.parse(raw) as StoredTemplate;
    t.name = name.trim() || t.name;
    await fs.writeFile(fp, JSON.stringify(t, null, 2), 'utf-8');
  } catch {
    /* 文件不存在则忽略 */
  }
}

/**
 * 批量导入节点模板（配置导入用）。
 * - merge：跳过 id 已存在的模板（不覆盖现有）。
 * - overwrite：先清空 node-templates 目录里的 .json，再全量写入。
 * 返回实际写入条数。
 */
export async function importNodeTemplates(
  items: StoredTemplate[],
  strategy: 'merge' | 'overwrite'
): Promise<number> {
  const dir = getNodeTemplatesDir();
  await fs.mkdir(dir, { recursive: true });

  if (strategy === 'overwrite') {
    let names: string[] = [];
    try {
      names = await fs.readdir(dir);
    } catch {
      names = [];
    }
    for (const n of names) {
      if (n.toLowerCase().endsWith('.json')) {
        try {
          await fs.unlink(path.join(dir, n));
        } catch {
          /* ignore */
        }
      }
    }
  }

  const existing = new Set((await listNodeTemplates()).map((t) => t.id));
  let written = 0;
  for (const t of items) {
    if (!t || typeof t.id !== 'string') continue;
    if (strategy === 'merge' && existing.has(t.id)) continue;
    try {
      await saveNodeTemplate(t);
      existing.add(t.id);
      written++;
    } catch {
      /* 单条失败不中断 */
    }
  }
  return written;
}
