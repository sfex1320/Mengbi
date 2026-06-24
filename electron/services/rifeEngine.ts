/**
 * RIFE ncnn Vulkan 插帧引擎安装 / 状态管理（仿 realesrganEngine.ts 模式）。
 *
 * - 二进制不打进安装包：首次使用时下载官方 release zip（~40MB，自带 rife-v4.6 等全部模型目录）
 *   解压到 userData/engines/rife/
 * - 下载走 netDownloader.downloadFromAny（GitHub 直链 + 国内镜像自动切换）
 * - 解压/防穿越/拍平走 zipInstall.ts 通用工具
 * - 只有 rife-v4 系模型支持 `-n 任意目标帧数`（任意倍率插帧），默认 rife-v4.6
 */
import { app } from 'electron';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { downloadFromAny, githubReleaseUrls, type DownloadProgress } from './netDownloader';
import { extractZip, assertZipEntriesSafe, flattenExtractedDir } from './zipInstall';

/** 上游官方 release tag（nihui/rife-ncnn-vulkan）。升级改这一个常量。 */
const RIFE_VERSION = '20221029';
const GITHUB_BASE = `https://github.com/nihui/rife-ncnn-vulkan/releases/download/${RIFE_VERSION}`;

function archiveName(): string | null {
  if (process.platform === 'win32') return `rife-ncnn-vulkan-${RIFE_VERSION}-windows.zip`;
  if (process.platform === 'darwin') return `rife-ncnn-vulkan-${RIFE_VERSION}-macos.zip`;
  if (process.platform === 'linux') return `rife-ncnn-vulkan-${RIFE_VERSION}-ubuntu.zip`;
  return null;
}

function execName(): string {
  return process.platform === 'win32' ? 'rife-ncnn-vulkan.exe' : 'rife-ncnn-vulkan';
}

export function engineRoot(): string {
  return path.join(app.getPath('userData'), 'engines', 'rife');
}

export function execPath(): string {
  return path.join(engineRoot(), execName());
}

export interface RifeEngineStatus {
  installed: boolean;
  version: string;
  execPath: string | null;
  enginePath: string;
  /** 扫到的模型目录名（含 flownet.bin + flownet.param 的 rife* 子目录） */
  models: string[];
  /** 推荐默认模型：rife-v4.6 > rife-v4 > 第一个（只有 v4 系支持 -n 任意目标帧数） */
  defaultModel: string | null;
  platform: 'windows' | 'macos' | 'linux' | 'unsupported';
}

export async function getEngineStatus(): Promise<RifeEngineStatus> {
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

  let models: string[] = [];
  if (existsSync(engineRoot())) {
    try {
      const entries = await fs.readdir(engineRoot(), { withFileTypes: true });
      for (const e of entries) {
        if (!e.isDirectory() || !e.name.toLowerCase().startsWith('rife')) continue;
        const dir = path.join(engineRoot(), e.name);
        if (existsSync(path.join(dir, 'flownet.bin')) && existsSync(path.join(dir, 'flownet.param'))) {
          models.push(e.name);
        }
      }
      models = models.sort();
    } catch {
      /* 读不出按无模型算 */
    }
  }

  const defaultModel = models.includes('rife-v4.6')
    ? 'rife-v4.6'
    : models.includes('rife-v4')
      ? 'rife-v4'
      : (models[0] ?? null);

  return {
    installed,
    version: RIFE_VERSION,
    execPath: installed ? exe : null,
    enginePath: engineRoot(),
    models,
    defaultModel,
    platform: platform as RifeEngineStatus['platform']
  };
}

export type RifeDownloadSource = 'auto' | 'github' | 'mirror';

/** 下载并解压 RIFE 引擎（zip 自带全部模型目录）。重复调用 = 重装覆盖。 */
export async function installEngine(
  source: RifeDownloadSource,
  onProgress?: (e: DownloadProgress) => void
): Promise<{ enginePath: string; usedUrl: string; models: string[] }> {
  const asset = archiveName();
  if (!asset) {
    throw new Error(`不支持的平台：${process.platform}（仅 Windows / macOS / Linux）`);
  }
  await fs.mkdir(engineRoot(), { recursive: true });
  const zipPath = path.join(engineRoot(), asset);
  const urls = githubReleaseUrls(`${GITHUB_BASE}/${asset}`, source);
  const { usedUrl } = await downloadFromAny(urls, zipPath, { component: 'engine', onProgress });
  // 官方/镜像直链仍做一次（降级放行的）ZipSlip 校验——防镜像被污染
  await assertZipEntriesSafe(zipPath);
  await extractZip(zipPath, engineRoot());
  await flattenExtractedDir(engineRoot(), execName());
  await fs.unlink(zipPath).catch(() => undefined);

  if (process.platform !== 'win32') {
    try {
      await fs.chmod(execPath(), 0o755);
    } catch {
      /* ignore */
    }
  }

  const status = await getEngineStatus();
  if (!status.installed) {
    throw new Error('解压后仍找不到 rife-ncnn-vulkan 可执行文件，请检查安装包是否完整');
  }
  return { enginePath: engineRoot(), usedUrl, models: status.models };
}

/** 删除整个引擎目录（含二进制与全部模型）。 */
export async function removeEngine(): Promise<void> {
  const root = engineRoot();
  if (!existsSync(root)) return;
  await fs.rm(root, { recursive: true, force: true });
}
