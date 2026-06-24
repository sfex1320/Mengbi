/**
 * 通用 zip 引擎安装工具 —— 从 realesrganEngine.ts 的解压/防穿越/拍平逻辑泛化提取。
 *
 * - 解压走系统自带工具（Windows: PowerShell Expand-Archive / macOS+Linux: unzip），零新 npm 依赖
 * - assertZipEntriesSafe：解压前校验 ZipSlip 路径穿越（列不出条目时降级放行——解压也靠同一工具，
 *   不存在"能解压却列不了"的情形，不因校验工具不可用挡住正常安装）
 * - flattenExtractedDir：release zip 解压后通常带一层壳目录，按"哪个目录里有 exe"拍平到根
 *
 * 注：realesrganEngine.ts 内仍保留它自己的一份（避免回归），后续可统一迁移到这里。
 */
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { logger } from './logger';

/** 跨平台解压 zip 到目录（系统工具，不引新依赖）。 */
export async function extractZip(zipPath: string, destDir: string): Promise<void> {
  await fs.mkdir(destDir, { recursive: true });
  if (process.platform === 'win32') {
    await runCmd('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`
    ]);
  } else {
    await runCmd('unzip', ['-o', zipPath, '-d', destDir]);
  }
}

/** 解压前校验 zip 条目安全：绝对路径 / `..` 回溯段一律拒绝（ZipSlip）；列不出条目时降级放行。 */
export async function assertZipEntriesSafe(zipPath: string): Promise<void> {
  let entries: string[];
  try {
    entries = await listZipEntries(zipPath);
  } catch (e) {
    logger.warn(`[zipInstall] 跳过 zip 安全校验（列条目失败）：${(e as Error).message}`);
    return;
  }
  const bad = entries.find(isUnsafeZipEntry);
  if (bad) {
    throw new Error(`压缩包含非法路径条目「${bad}」，疑似路径穿越，已拒绝安装`);
  }
}

/**
 * 把解压出的壳目录拍平到 root：BFS（最多 3 层）找到含 exeName 的目录，把其内容全部搬到 root。
 * exe 已经在 root 时为空操作。
 */
export async function flattenExtractedDir(root: string, exeName: string): Promise<void> {
  if (existsSync(path.join(root, exeName))) return;
  const found = await findExeDir(root, exeName, 3);
  if (!found) {
    logger.warn(`[zipInstall] flatten: 没找到 ${exeName}，目录结构可能与预期不同`);
    return;
  }
  if (found === root) return;
  await moveAllInto(found, root);
  let cur = found;
  while (cur !== root) {
    await fs.rmdir(cur).catch(() => undefined);
    const parent = path.dirname(cur);
    if (parent === cur || parent === root) break;
    cur = parent;
  }
}

// ─── 内部工具 ──────────────────────────────────────────────

function runCmd(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (b: Buffer) => {
      stderr += b.toString();
    });
    proc.on('error', (e) => reject(e));
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited ${code}: ${stderr.slice(0, 400)}`));
    });
  });
}

function runCmdCapture(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (b: Buffer) => {
      stdout += b.toString();
    });
    proc.stderr.on('data', (b: Buffer) => {
      stderr += b.toString();
    });
    proc.on('error', (e) => reject(e));
    proc.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${cmd} exited ${code}: ${stderr.slice(0, 400)}`));
    });
  });
}

function isUnsafeZipEntry(name: string): boolean {
  const n = name.replace(/\\/g, '/').trim();
  if (!n) return false;
  if (n.startsWith('/') || /^[A-Za-z]:/.test(n)) return true;
  return n.split('/').some((seg) => seg === '..');
}

async function listZipEntries(zipPath: string): Promise<string[]> {
  let out: string;
  if (process.platform === 'win32') {
    const esc = zipPath.replace(/'/g, "''");
    out = await runCmdCapture('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Add-Type -AssemblyName System.IO.Compression.FileSystem; $z=[System.IO.Compression.ZipFile]::OpenRead('${esc}'); try { $z.Entries | ForEach-Object { $_.FullName } } finally { $z.Dispose() }`
    ]);
  } else {
    out = await runCmdCapture('unzip', ['-Z1', zipPath]);
  }
  return out
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function findExeDir(start: string, exeName: string, maxDepth: number): Promise<string | null> {
  const queue: Array<{ dir: string; depth: number }> = [{ dir: start, depth: 0 }];
  while (queue.length > 0) {
    const { dir, depth } = queue.shift()!;
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    if (entries.some((e) => e.isFile() && e.name === exeName)) return dir;
    if (depth >= maxDepth) continue;
    for (const e of entries) {
      if (e.isDirectory()) queue.push({ dir: path.join(dir, e.name), depth: depth + 1 });
    }
  }
  return null;
}

async function moveAllInto(src: string, dst: string): Promise<void> {
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const from = path.join(src, e.name);
    const to = path.join(dst, e.name);
    if (e.isDirectory() && existsSync(to)) {
      const subs = await fs.readdir(from, { withFileTypes: true });
      for (const s of subs) {
        const sFrom = path.join(from, s.name);
        const sTo = path.join(to, s.name);
        if (s.isDirectory() && existsSync(sTo)) {
          await moveAllInto(sFrom, sTo);
          await fs.rmdir(sFrom).catch(() => undefined);
        } else {
          await fs.rename(sFrom, sTo).catch(async () => {
            await fs.copyFile(sFrom, sTo);
            await fs.unlink(sFrom);
          });
        }
      }
      await fs.rmdir(from).catch(() => undefined);
    } else {
      await fs.rename(from, to).catch(async () => {
        await fs.copyFile(from, to);
        await fs.unlink(from);
      });
    }
  }
}
