/**
 * Python embed runtime —— 便携 Python 解释器的探测 + 脚手架展开。
 *
 * 设计：mengbi 用**单个共享** Python venv 给所有 AI 功能用（节省 ~2 GB 显存级别的磁盘）。
 * 不同 feature 把自己的 server 代码放在 `app/<feature>_server/`，
 * 把 pip 依赖追加进同一个 venv —— 因此这里只有"一个 portable root"概念。
 *
 * 兼容性：settings 表里 key 仍叫 `hypir_portable_path`（历史命名，沿用避免破坏老用户）。
 * 默认路径：userData/engines/HYPIR_Portable/。
 */
import { app } from 'electron';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getDb } from '../db';

const SETTINGS_KEY_PORTABLE_PATH = 'hypir_portable_path';

/**
 * 便携包根目录。优先 DB 偏好，否则默认 userData/engines/HYPIR_Portable/。
 * 所有 AI feature 共享同一个根。
 */
export function getPortableRoot(): string {
  try {
    const row = getDb()
      .prepare(`SELECT value FROM settings WHERE key=?`)
      .get(SETTINGS_KEY_PORTABLE_PATH) as { value: string } | undefined;
    if (row?.value && row.value.trim()) return row.value.trim();
  } catch {
    /* DB 还没 init 时静默回退到默认 */
  }
  return path.join(app.getPath('userData'), 'engines', 'HYPIR_Portable');
}

/** 设置便携包根（空字符串 = 清回默认） */
export function setPortableRoot(p: string): void {
  const db = getDb();
  if (!p.trim()) {
    db.prepare(`DELETE FROM settings WHERE key=?`).run(SETTINGS_KEY_PORTABLE_PATH);
  } else {
    db.prepare(
      `INSERT INTO settings(key, value) VALUES(?, ?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value`
    ).run(SETTINGS_KEY_PORTABLE_PATH, p.trim());
  }
}

/** 是否在 DB 中显式配过路径（而非默认值） */
export function isPortableRootConfigured(): boolean {
  try {
    const row = getDb()
      .prepare(`SELECT value FROM settings WHERE key=?`)
      .get(SETTINGS_KEY_PORTABLE_PATH) as { value: string } | undefined;
    return !!(row?.value && row.value.trim());
  } catch {
    return false;
  }
}

/** Python embed 的 python.exe 路径 */
export function getPythonExePath(portableRoot: string = getPortableRoot()): string {
  return path.join(portableRoot, 'runtime', 'python', 'python.exe');
}

/** 主程序内置的脚手架来源（bootstrap 拷贝源） */
export function getResourcesScaffold(): string {
  const packaged = process.resourcesPath
    ? path.join(process.resourcesPath, 'hypir-portable')
    : '';
  if (packaged && existsSync(packaged)) return packaged;
  return path.join(process.cwd(), 'resources', 'hypir-portable');
}

export interface PythonProbe {
  exists: boolean;
  path: string;
  portableRoot: string;
  portableExists: boolean;
}

export function probePython(): PythonProbe {
  const root = getPortableRoot();
  const pyPath = getPythonExePath(root);
  return {
    portableRoot: root,
    portableExists: existsSync(root),
    path: pyPath,
    exists: existsSync(pyPath)
  };
}

/**
 * 把 `resources/hypir-portable/` 递归拷贝到便携包根。
 *   - 已存在同名文件不覆盖（保护用户改过的 config）
 *   - 字节相同的也不动（省 IO）
 *   - 仅拷贝 .py / .bat / .json / 文档 等脚手架；模型权重 / venv 不在此处
 *   - 确保 input/output/temp/logs/cache 子目录存在
 */
export async function bootstrapPortable(): Promise<{
  root: string;
  copied: number;
  skipped: number;
}> {
  const root = getPortableRoot();
  const src = getResourcesScaffold();
  if (!existsSync(src)) {
    throw new Error(`找不到内置脚手架：${src}（mengbi 打包问题，请反馈）`);
  }
  await fs.mkdir(root, { recursive: true });
  let copied = 0;
  let skipped = 0;
  async function walk(s: string, d: string): Promise<void> {
    const entries = await fs.readdir(s, { withFileTypes: true });
    for (const e of entries) {
      if (e.name === '.gitkeep') continue;
      const sp = path.join(s, e.name);
      const dp = path.join(d, e.name);
      if (e.isDirectory()) {
        await fs.mkdir(dp, { recursive: true });
        await walk(sp, dp);
      } else {
        if (existsSync(dp)) {
          const [srcBuf, dstBuf] = await Promise.all([
            fs.readFile(sp),
            fs.readFile(dp).catch(() => null)
          ]);
          if (dstBuf && Buffer.compare(srcBuf, dstBuf) === 0) {
            skipped++;
            continue;
          }
        }
        await fs.copyFile(sp, dp);
        copied++;
      }
    }
  }
  await walk(src, root);
  for (const d of ['input', 'output', 'temp', 'logs', 'cache']) {
    await fs.mkdir(path.join(root, d), { recursive: true });
  }
  return { root, copied, skipped };
}
