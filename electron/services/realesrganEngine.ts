/**
 * Real-ESRGAN ncnn Vulkan 引擎安装 / 模型管理。
 *
 * 设计：
 * - 二进制不打进安装包（×10MB+，且需 Vulkan 运行时分发）。首次使用时下载 zip 解压到 userData/engines/realesrgan/
 * - GitHub release 直链 + 国内镜像（gh-proxy）双源；用户可选 auto / github / mirror
 * - 解压用 yauzl（已在 electron-builder 依赖里），避免再引一个 zip 库 —— 实际上 Electron 自带 require('original-fs')，
 *   我们用纯 Node 'node:fs' + 'node:zlib' 通过 yauzl 或简单实现。为了零新依赖，这里走系统 PowerShell `Expand-Archive`（Windows）/ `unzip`（macOS+Linux）解压。
 * - 仅"放大"用途；不混入 HYPIR 路径
 */

import { app, net } from 'electron';
import fs from 'node:fs/promises';
import { createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { logger } from './logger';

// ─── 版本与下载源 ──────────────────────────────────────────

/**
 * 上游官方 release tag。
 * 注意 tag 名（URL 路径段）和 asset 文件名里都带 'v' 前缀，与上游 release 完全一致：
 *   https://github.com/xinntao/Real-ESRGAN-ncnn-vulkan/releases/tag/v0.2.0
 *   asset: realesrgan-ncnn-vulkan-v0.2.0-{windows,macos,ubuntu}.zip
 * 升级时改这一个常量即可。
 */
const REALESRGAN_VERSION = 'v0.2.0';

const GITHUB_BASE = `https://github.com/xinntao/Real-ESRGAN-ncnn-vulkan/releases/download/${REALESRGAN_VERSION}`;

/**
 * 国内常用的 GitHub 加速镜像前缀列表 —— 任意一家挂掉会自动切下一家。
 * 这些镜像都是社区维护的反代，命中率随时间漂移，所以保留多家。
 * 用户自行加镜像：传 prefix（包含末尾斜杠）即可。
 */
const MIRROR_PREFIXES: string[] = [
  'https://mirror.ghproxy.com/',
  'https://gh-proxy.com/',
  'https://github.moeyy.xyz/',
  'https://ghps.cc/',
  'https://hub.gitmirror.com/',
  'https://ghproxy.net/'
];

/** 'kkgithub.com' 是把 github.com 整个域换掉的镜像（不是前缀型） */
const HOST_SWAP_MIRRORS: string[] = ['kkgithub.com'];

/**
 * 各平台 zip 包名（与官方 release asset 完全一致）。
 * v0.2.0 的命名带 'v' 前缀：realesrgan-ncnn-vulkan-v0.2.0-windows.zip
 */
function archiveName(): string | null {
  if (process.platform === 'win32') return `realesrgan-ncnn-vulkan-${REALESRGAN_VERSION}-windows.zip`;
  if (process.platform === 'darwin') return `realesrgan-ncnn-vulkan-${REALESRGAN_VERSION}-macos.zip`;
  if (process.platform === 'linux') return `realesrgan-ncnn-vulkan-${REALESRGAN_VERSION}-ubuntu.zip`;
  return null;
}

/** 可执行文件名 */
function execName(): string {
  return process.platform === 'win32'
    ? 'realesrgan-ncnn-vulkan.exe'
    : 'realesrgan-ncnn-vulkan';
}

// ─── 安装目录 ──────────────────────────────────────────────

export function engineRoot(): string {
  return path.join(app.getPath('userData'), 'engines', 'realesrgan');
}

export function modelsDir(): string {
  return path.join(engineRoot(), 'models');
}

export function execPath(): string {
  return path.join(engineRoot(), execName());
}

// ─── 引擎状态 ──────────────────────────────────────────────

export interface EngineStatus {
  installed: boolean;
  /** 上游版本号 */
  version: string;
  execPath: string | null;
  enginePath: string;
  /** models 子目录的绝对路径（不一定存在 —— 用 modelsDirExists 判断） */
  modelsPath: string;
  modelsDirExists: boolean;
  /** 是否找到了至少一个 .bin/.param 模型对 */
  hasAnyModel: boolean;
  /** 已扫到的模型列表（不带扩展名） */
  models: Array<{ name: string; sizeBytes: number }>;
  /** 引擎根目录顶层文件清单（用于"装好了但模型为空"时给用户看到底有啥） */
  engineRootListing: Array<{ name: string; sizeBytes: number; isDir: boolean }>;
  /** Vulkan 是否可用——通过 dry-run 看 -h 输出探测 */
  vulkanProbe: 'ok' | 'unknown' | 'unsupported';
  /** 当前平台名（windows/macos/linux/unsupported） */
  platform: 'windows' | 'macos' | 'linux' | 'unsupported';
}

export async function getEngineStatus(): Promise<EngineStatus> {
  const platform =
    process.platform === 'win32'
      ? 'windows'
      : process.platform === 'darwin'
        ? 'macos'
        : process.platform === 'linux'
          ? 'linux'
          : 'unsupported';

  const exe = execPath();
  const installed = existsSync(exe);

  let models: Array<{ name: string; sizeBytes: number }> = [];
  let hasAnyModel = false;
  if (existsSync(modelsDir())) {
    try {
      const entries = await fs.readdir(modelsDir());
      const bins = entries.filter((e) => e.toLowerCase().endsWith('.bin'));
      const paramSet = new Set(
        entries.filter((e) => e.toLowerCase().endsWith('.param')).map((e) => e.replace(/\.param$/i, ''))
      );
      models = bins
        .map((b) => b.replace(/\.bin$/i, ''))
        .filter((name) => paramSet.has(name))
        .map((name) => {
          let size = 0;
          try {
            size = statSync(path.join(modelsDir(), `${name}.bin`)).size;
          } catch {
            /* ignore */
          }
          return { name, sizeBytes: size };
        });
      hasAnyModel = models.length > 0;
    } catch {
      /* dir 读不出，按未安装算 */
    }
  }

  // 顶层目录清单 —— 给 UI 做诊断用
  const engineRootListing: EngineStatus['engineRootListing'] = [];
  if (existsSync(engineRoot())) {
    try {
      const top = await fs.readdir(engineRoot(), { withFileTypes: true });
      for (const e of top) {
        const fp = path.join(engineRoot(), e.name);
        let size = 0;
        try {
          const st = statSync(fp);
          size = e.isDirectory() ? 0 : st.size;
        } catch {
          /* ignore */
        }
        engineRootListing.push({ name: e.name, sizeBytes: size, isDir: e.isDirectory() });
      }
    } catch {
      /* ignore */
    }
  }

  return {
    installed,
    version: REALESRGAN_VERSION,
    execPath: installed ? exe : null,
    enginePath: engineRoot(),
    modelsPath: modelsDir(),
    modelsDirExists: existsSync(modelsDir()),
    hasAnyModel,
    models,
    engineRootListing,
    vulkanProbe: 'unknown',
    platform: platform as EngineStatus['platform']
  };
}

// ─── 下载（直链 + 镜像） ───────────────────────────────────

export interface DownloadProgressEvent {
  component: string;
  received: number;
  total: number;
}

export type DownloadSource = 'github' | 'mirror' | 'auto';

/**
 * 构造 URL 候选列表 ——
 *   - github：仅直链
 *   - mirror：依次试每家国内镜像（host-swap 优先，因为更稳定）
 *   - auto：直链一次 + 全部镜像兜底
 */
function urlsFor(asset: string, source: DownloadSource): string[] {
  const direct = `${GITHUB_BASE}/${asset}`;
  const mirrorPrefixed = MIRROR_PREFIXES.map((prefix) => `${prefix}${direct}`);
  const mirrorHostSwap = HOST_SWAP_MIRRORS.map(
    (host) => `https://${host}/xinntao/Real-ESRGAN-ncnn-vulkan/releases/download/${REALESRGAN_VERSION}/${asset}`
  );
  const allMirrors = [...mirrorHostSwap, ...mirrorPrefixed];
  if (source === 'github') return [direct];
  if (source === 'mirror') return allMirrors;
  return [direct, ...allMirrors];
}

/**
 * 下载 URL 到本地路径。失败时清掉半截文件并抛错。
 * - 用浏览器风 UA，部分 CDN 会拒掉默认的 Electron UA
 * - 30s 起 socket 心跳超时（首字节未到立刻判失败，避免镜像挂掉时卡几分钟）
 * - 支持进度回调（received/total），用于 IPC 推 'upscale:install-progress'
 */
async function downloadTo(
  url: string,
  destPath: string,
  component: string,
  onProgress?: (e: DownloadProgressEvent) => void
): Promise<void> {
  const tmp = destPath + '.partial';
  await new Promise<void>((resolve, reject) => {
    const req = net.request({ method: 'GET', url, redirect: 'follow' });
    req.setHeader(
      'User-Agent',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );
    req.setHeader('Accept', '*/*');
    req.setHeader('Accept-Encoding', 'identity');

    let stream: ReturnType<typeof createWriteStream> | null = null;
    let received = 0;
    let total = 0;
    let settled = false;
    /** 首字节未到的超时；收到首块后清掉 */
    let firstByteTimer: NodeJS.Timeout | null = setTimeout(() => {
      fail(new Error('连接 30s 内未拿到首字节，镜像可能不可达'));
    }, 30_000);

    const fail = (e: unknown): void => {
      if (settled) return;
      settled = true;
      if (firstByteTimer) {
        clearTimeout(firstByteTimer);
        firstByteTimer = null;
      }
      try {
        stream?.destroy();
        req.abort();
      } catch {
        /* ignore */
      }
      reject(e);
    };

    req.on('response', (res) => {
      const status = res.statusCode;
      if (status < 200 || status >= 400) {
        fail(new Error(`HTTP ${status} ${res.statusMessage ?? ''}`));
        return;
      }
      total = Number(res.headers['content-length'] ?? 0);
      stream = createWriteStream(tmp);
      stream.on('error', fail);
      res.on('data', (chunk) => {
        if (!stream) return;
        if (firstByteTimer) {
          clearTimeout(firstByteTimer);
          firstByteTimer = null;
        }
        const ok = stream.write(chunk);
        received += chunk.length;
        onProgress?.({ component, received, total });
        if (!ok) {
          const r = res as unknown as { pause(): void; resume(): void };
          r.pause?.();
          stream.once('drain', () => r.resume?.());
        }
      });
      res.on('end', () => {
        if (!stream || settled) return;
        stream.end(() => {
          settled = true;
          resolve();
        });
      });
      res.on('error', fail);
    });
    req.on('error', fail);
    req.end();
  }).then(async () => {
    const st = await fs.stat(tmp);
    if (st.size < 1024) {
      await fs.unlink(tmp).catch(() => undefined);
      throw new Error(`下载内容过小（${st.size}B），URL 可能返回错误页`);
    }
    // 嗅探开头：如果是 HTML（404 / 反爬 / 镜像登录页），按失败处理
    const fh = await fs.open(tmp, 'r');
    const head = Buffer.alloc(64);
    await fh.read(head, 0, 64, 0);
    await fh.close();
    const sniff = head.toString('utf8').toLowerCase();
    if (sniff.startsWith('<!doctype') || sniff.startsWith('<html')) {
      await fs.unlink(tmp).catch(() => undefined);
      throw new Error('返回的是 HTML 页（镜像挂了 / 限流 / URL 失效）');
    }
    await fs.rename(tmp, destPath);
  }).catch(async (e) => {
    await fs.unlink(tmp).catch(() => undefined);
    throw e;
  });
}

/**
 * 尝试从一组 URL 顺序下载，第一个成功即返回。
 * 失败时抛出的错误信息把每条 URL + 它的具体失败原因都列出来——
 * 这样用户在 UI 里能直接看出"是 GitHub 直连被墙、还是某家镜像挂了"。
 */
async function downloadFromAny(
  urls: string[],
  destPath: string,
  component: string,
  onProgress?: (e: DownloadProgressEvent) => void
): Promise<{ usedUrl: string }> {
  const errors: string[] = [];
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const label = sourceLabel(url);
    // 进度推送把 component 替换成 "engine · 第 N/M 个源（label）"，
    // 让 UI 能展示当前尝试的源
    const wrap = onProgress
      ? (e: DownloadProgressEvent) => onProgress({ ...e, component: `${component} · ${label}` })
      : undefined;
    try {
      await downloadTo(url, destPath, component, wrap);
      return { usedUrl: url };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`#${i + 1} ${label} — ${msg}`);
      logger.warn(`[realesrgan] download failed from ${url}: ${msg}`);
    }
  }
  throw new Error(
    `全部 ${urls.length} 个源都失败：\n${errors.join('\n')}\n\n` +
      `兜底方案：手动下载 zip 后用「导入本地 zip」按钮安装。GitHub 仓库：` +
      `https://github.com/xinntao/Real-ESRGAN-ncnn-vulkan/releases/tag/${REALESRGAN_VERSION}`
  );
}

/** 把 URL 化成可读标签（'GitHub' / 'mirror.ghproxy.com' / ...） */
function sourceLabel(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname === 'github.com') return 'GitHub 直链';
    return u.hostname;
  } catch {
    return url.slice(0, 40);
  }
}

// ─── 解压 ──────────────────────────────────────────────────

/**
 * 跨平台解压一个 zip 到目录。优先用系统自带工具：
 *   - Windows: PowerShell Expand-Archive
 *   - macOS / Linux: 系统 unzip
 * 这样不引入新 npm 依赖（@electron/asar / yauzl 等都会额外加几 MB）。
 */
async function extractZip(zipPath: string, destDir: string): Promise<void> {
  await fs.mkdir(destDir, { recursive: true });
  if (process.platform === 'win32') {
    // PowerShell Expand-Archive 是 5.0+ 内置；Windows 10/11 默认有。
    await runCmd(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`
      ]
    );
  } else {
    await runCmd('unzip', ['-o', zipPath, '-d', destDir]);
  }
}

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

/** 同 runCmd，但捕获并返回 stdout（用于列 zip 条目名）。 */
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

/** zip 条目名是否危险（绝对路径 / 含 .. 回溯段）—— 防 ZipSlip 路径穿越。 */
function isUnsafeZipEntry(name: string): boolean {
  const n = name.replace(/\\/g, '/').trim();
  if (!n) return false;
  if (n.startsWith('/') || /^[A-Za-z]:/.test(n)) return true; // 绝对路径
  return n.split('/').some((seg) => seg === '..'); // 含 .. 回溯段
}

/** 列出 zip 内所有条目名（不解压）。 */
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

/**
 * 解压前校验 zip 内容安全：含绝对路径 / `..` 回溯段一律拒绝（ZipSlip）。
 * 失败关闭：列不出条目就拒绝解压（用于不可信的本地 zip 安装路径）。
 */
async function assertZipEntriesSafe(zipPath: string): Promise<void> {
  let entries: string[];
  try {
    entries = await listZipEntries(zipPath);
  } catch (e) {
    throw new Error(`无法校验压缩包内容安全性，已拒绝解压：${(e as Error).message}`);
  }
  const bad = entries.find(isUnsafeZipEntry);
  if (bad) {
    throw new Error(`压缩包含非法路径条目「${bad}」，疑似路径穿越，已拒绝安装`);
  }
}

// ─── 安装入口 ──────────────────────────────────────────────

/**
 * 下载并解压 Real-ESRGAN ncnn Vulkan 二进制（zip 自带默认 4 个模型）。
 * 重复调用：会覆盖已有文件，相当于"重装"。
 */
export async function installEngine(
  source: DownloadSource,
  onProgress?: (e: DownloadProgressEvent) => void
): Promise<{ enginePath: string; usedUrl: string; modelsInstalled: string[] }> {
  const asset = archiveName();
  if (!asset) {
    throw new Error(`不支持的平台：${process.platform}（仅 Windows / macOS / Linux）`);
  }
  await fs.mkdir(engineRoot(), { recursive: true });
  const zipPath = path.join(engineRoot(), asset);
  const urls = urlsFor(asset, source);
  const { usedUrl } = await downloadFromAny(urls, zipPath, 'engine', onProgress);
  await extractZip(zipPath, engineRoot());
  // zip 解压后是 realesrgan-ncnn-vulkan-XXXXXXXX-windows/{exe,models,*.dll} 一层目录；
  // 把内层文件拍平到 engineRoot/，删掉 zip 与中间目录
  await flattenExtractedDir(engineRoot());
  await fs.unlink(zipPath).catch(() => undefined);

  // 给 unix 平台的二进制加可执行位
  if (process.platform !== 'win32') {
    try {
      await fs.chmod(execPath(), 0o755);
    } catch {
      /* ignore */
    }
  }

  const status = await getEngineStatus();
  if (!status.installed) {
    throw new Error('解压后仍找不到可执行文件，请检查安装包是否完整');
  }
  return {
    enginePath: engineRoot(),
    usedUrl,
    modelsInstalled: status.models.map((m) => m.name)
  };
}

/**
 * zip 解压后通常会有 'realesrgan-ncnn-vulkan-vX.Y.Z-windows/' 这一层；
 * 但上游历史命名变过好几轮（旧版日期 tag、新版 v0.2.0 tag、社区 fork 用别的名）。
 * 所以**不**靠正则匹配目录名，而是：找到任意一个含 realesrgan-ncnn-vulkan(.exe)
 * 的目录（递归 2 层），把它的内容全部拍平到 engineRoot()。
 */
async function flattenExtractedDir(root: string): Promise<void> {
  const exeBaseName = execName();
  // 已经在 root/ 里？不用拍
  if (existsSync(path.join(root, exeBaseName))) return;

  const found = await findExeDir(root, exeBaseName, 3);
  if (!found) {
    logger.warn(`[realesrgan] flatten: 没找到 ${exeBaseName}，目录结构可能与预期不同`);
    return;
  }
  if (found === root) return;
  await moveAllInto(found, root);
  // 清掉 found 之上、引擎根之下的空中间目录
  let cur = found;
  while (cur !== root) {
    await fs.rmdir(cur).catch(() => undefined);
    const parent = path.dirname(cur);
    if (parent === cur || parent === root) break;
    cur = parent;
  }
}

/** BFS 找最浅一个含 exeName 的目录，最多下钻 maxDepth 层 */
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

/** 把 src 下的全部内容移到 dst；同名目录浅合并 */
async function moveAllInto(src: string, dst: string): Promise<void> {
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const from = path.join(src, e.name);
    const to = path.join(dst, e.name);
    if (e.isDirectory() && existsSync(to)) {
      // 浅合并：把 from 目录下每个孩子搬到 to
      const subs = await fs.readdir(from, { withFileTypes: true });
      for (const s of subs) {
        const sFrom = path.join(from, s.name);
        const sTo = path.join(to, s.name);
        // 同名文件覆盖；同名目录递归合并
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

/**
 * 用用户本地已有的 zip 安装引擎 —— 网络全断时的最终兜底。
 * 校验：zip 内必须能解出 realesrgan-ncnn-vulkan(.exe)，否则视为非法。
 */
export async function installEngineFromLocalZip(
  localZipPath: string
): Promise<{ enginePath: string; modelsInstalled: string[] }> {
  if (!existsSync(localZipPath)) {
    throw new Error(`找不到文件：${localZipPath}`);
  }
  if (!/\.zip$/i.test(localZipPath)) {
    throw new Error('只支持 .zip 文件');
  }
  await fs.mkdir(engineRoot(), { recursive: true });
  // 复制一份到引擎目录，避免直接解压用户原文件、留下副作用
  const copied = path.join(engineRoot(), path.basename(localZipPath));
  await fs.copyFile(localZipPath, copied);
  try {
    // 不可信本地 zip：解压前先校验无 ZipSlip 路径穿越，否则恶意 zip 里
    // 的 ../../ 条目会被系统 unzip / Expand-Archive 写到引擎目录之外。
    await assertZipEntriesSafe(copied);
    await extractZip(copied, engineRoot());
    await flattenExtractedDir(engineRoot());
  } finally {
    await fs.unlink(copied).catch(() => undefined);
  }
  if (process.platform !== 'win32') {
    try {
      await fs.chmod(execPath(), 0o755);
    } catch {
      /* ignore */
    }
  }
  const status = await getEngineStatus();
  if (!status.installed) {
    throw new Error(
      '解压成功但未找到 realesrgan-ncnn-vulkan 可执行文件——确认你下载的是官方 release zip'
    );
  }
  return {
    enginePath: engineRoot(),
    modelsInstalled: status.models.map((m) => m.name)
  };
}

/**
 * 删除整个引擎目录（包括二进制与所有模型）。
 */
export async function removeEngine(): Promise<void> {
  const root = engineRoot();
  if (!existsSync(root)) return;
  await fs.rm(root, { recursive: true, force: true });
}

/**
 * 单独下载某个模型的 .bin + .param 对（用户想要 archive 没自带的模型时）。
 * 模型仓库默认指向官方 release tag —— 同 archive 同一版本里都有。
 */
export async function installModel(
  modelName: string,
  source: DownloadSource,
  onProgress?: (e: DownloadProgressEvent) => void
): Promise<{ bin: string; param: string; usedUrl: string }> {
  // 防穿目录
  if (!/^[A-Za-z0-9._\-]+$/.test(modelName)) {
    throw new Error('模型名只允许字母数字 . _ -');
  }
  mkdirSync(modelsDir(), { recursive: true });
  const binDst = path.join(modelsDir(), `${modelName}.bin`);
  const paramDst = path.join(modelsDir(), `${modelName}.param`);
  const binUrls = urlsFor(`${modelName}.bin`, source);
  const paramUrls = urlsFor(`${modelName}.param`, source);
  const binRes = await downloadFromAny(binUrls, binDst, `${modelName}.bin`, onProgress);
  const paramRes = await downloadFromAny(paramUrls, paramDst, `${modelName}.param`, onProgress);
  return { bin: binDst, param: paramDst, usedUrl: `${binRes.usedUrl}\n${paramRes.usedUrl}` };
}

export async function removeModel(modelName: string): Promise<void> {
  if (!/^[A-Za-z0-9._\-]+$/.test(modelName)) {
    throw new Error('非法模型名');
  }
  await fs.unlink(path.join(modelsDir(), `${modelName}.bin`)).catch(() => undefined);
  await fs.unlink(path.join(modelsDir(), `${modelName}.param`)).catch(() => undefined);
}

/**
 * 从本地文件路径导入一对 .bin + .param。两个文件可分两次选；
 * 文件名（去掉扩展名）必须一致，否则配不成模型。
 * 也允许只补一个文件（用户之前漏装了 .param）。
 */
export async function importLocalModelFiles(
  paths: string[]
): Promise<{ imported: string[]; modelsAfter: string[] }> {
  mkdirSync(modelsDir(), { recursive: true });
  const imported: string[] = [];
  for (const src of paths) {
    const ext = path.extname(src).toLowerCase();
    if (ext !== '.bin' && ext !== '.param') {
      throw new Error(`不支持的文件类型 ${ext}（只接受 .bin / .param）`);
    }
    const base = path.basename(src);
    if (!/^[A-Za-z0-9._\-]+$/.test(base)) {
      throw new Error(`文件名含非法字符：${base}（只允许字母数字 . _ -）`);
    }
    const dest = path.join(modelsDir(), base);
    await fs.copyFile(src, dest);
    imported.push(base);
  }
  const status = await getEngineStatus();
  return { imported, modelsAfter: status.models.map((m) => m.name) };
}
