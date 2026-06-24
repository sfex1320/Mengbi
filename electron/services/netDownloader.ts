/**
 * 通用文件下载器 —— 走 Electron `net` 模块,带超时 + HTML 嗅探。
 *
 * 从 realesrganEngine.ts 提炼:任何需要"下载 URL → 落盘 + 进度推送"的场景都能用。
 */
import { net } from 'electron';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

export interface DownloadProgress {
  /** 标签(在 UI 上显示是哪个文件) */
  component: string;
  received: number;
  total: number;
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** 把 URL 下到 destPath。HTML / 过小内容会被识别为失败。 */
export async function downloadFile(
  url: string,
  destPath: string,
  opts: {
    component: string;
    onProgress?: (e: DownloadProgress) => void;
    /** 首字节超时,默认 30 秒 */
    firstByteTimeoutMs?: number;
  }
): Promise<void> {
  const { component, onProgress } = opts;
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  const tmp = destPath + '.partial';

  await new Promise<void>((resolve, reject) => {
    const req = net.request({ method: 'GET', url, redirect: 'follow' });
    req.setHeader('User-Agent', UA);
    req.setHeader('Accept', '*/*');
    req.setHeader('Accept-Encoding', 'identity');

    let stream: ReturnType<typeof createWriteStream> | null = null;
    let received = 0;
    let total = 0;
    let settled = false;
    let firstByteTimer: NodeJS.Timeout | null = setTimeout(() => {
      fail(new Error(`${opts.firstByteTimeoutMs ?? 30}s 内未拿到首字节,镜像可能不可达`));
    }, opts.firstByteTimeoutMs ?? 30_000);

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
        /* */
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
  });

  // 内容校验:过小 + HTML 嗅探都视作失败
  const st = await fs.stat(tmp).catch(() => null);
  if (!st || st.size < 1024) {
    await fs.unlink(tmp).catch(() => undefined);
    throw new Error(`下载内容过小(${st?.size ?? 0}B),URL 可能返回错误页`);
  }
  const fh = await fs.open(tmp, 'r');
  const head = Buffer.alloc(64);
  await fh.read(head, 0, 64, 0);
  await fh.close();
  const sniff = head.toString('utf8').toLowerCase();
  if (sniff.startsWith('<!doctype') || sniff.startsWith('<html')) {
    await fs.unlink(tmp).catch(() => undefined);
    throw new Error('返回的是 HTML 页(镜像挂了 / 限流 / URL 失效)');
  }
  await fs.rename(tmp, destPath);
}

/** 顺序尝试多个 URL,第一个成功即停。失败抛出汇总错误。 */
export async function downloadFromAny(
  urls: string[],
  destPath: string,
  opts: {
    component: string;
    onProgress?: (e: DownloadProgress) => void;
  }
): Promise<{ usedUrl: string }> {
  const errors: string[] = [];
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const label = labelFromUrl(url);
    const wrap = opts.onProgress
      ? (e: DownloadProgress) =>
          opts.onProgress!({ ...e, component: `${opts.component} · ${label}` })
      : undefined;
    try {
      await downloadFile(url, destPath, { component: opts.component, onProgress: wrap });
      return { usedUrl: url };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`#${i + 1} ${label}(${url}) — ${msg}`);
    }
  }
  throw new Error(
    `全部 ${urls.length} 个源都失败:\n${errors.join('\n')}\n\n` +
      '请检查网络 / 换镜像 / 手动下载后放到目标路径。'
  );
}

/** 国内常用 GitHub 加速镜像前缀（社区反代，命中率随时间漂移，保留多家自动切换）。 */
const GH_MIRROR_PREFIXES: string[] = [
  'https://mirror.ghproxy.com/',
  'https://gh-proxy.com/',
  'https://github.moeyy.xyz/',
  'https://ghps.cc/',
  'https://hub.gitmirror.com/',
  'https://ghproxy.net/'
];

/** 把 github.com 整域换掉的镜像（非前缀型）。 */
const GH_HOST_SWAP: string[] = ['kkgithub.com'];

/**
 * GitHub release 直链 → 候选 URL 列表（纯函数）：
 *   - github：仅直链；mirror：host-swap 优先 + 前缀镜像；auto：直链 + 全部镜像兜底。
 * 与 realesrganEngine.ts 的 urlsFor 同一套镜像清单（那边后续可迁移过来统一）。
 */
export function githubReleaseUrls(directUrl: string, source: 'auto' | 'github' | 'mirror' = 'auto'): string[] {
  const hostSwapped = GH_HOST_SWAP.map((host) => directUrl.replace('https://github.com/', `https://${host}/`));
  const prefixed = GH_MIRROR_PREFIXES.map((prefix) => `${prefix}${directUrl}`);
  const allMirrors = [...hostSwapped, ...prefixed];
  if (source === 'github') return [directUrl];
  if (source === 'mirror') return allMirrors;
  return [directUrl, ...allMirrors];
}

function labelFromUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname === 'github.com') return 'GitHub 直链';
    if (u.hostname === 'huggingface.co') return 'HuggingFace';
    if (u.hostname.includes('hf-mirror')) return 'hf-mirror';
    if (u.hostname.includes('modelscope')) return 'ModelScope';
    if (u.hostname.includes('mirror') || u.hostname.includes('proxy')) return u.hostname;
    return u.hostname;
  } catch {
    return url.slice(0, 40);
  }
}
