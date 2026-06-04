/**
 * Install Script Runner —— 通用 bat 脚本运行器 + 进度回调。
 *
 * 任何 feature 的 `install_<x>.bat` 走这里跑。职责：
 *   - spawn 一个 cmd.exe /c <bat>，cwd=便携包根
 *   - utf-8 解码 stdout/stderr，每行一条 InstallProgressEvent
 *   - 抓取常见进度提示（"Downloading...", "Collecting...", "Successfully installed"）填 percent
 *   - 保留末尾 50 行日志，失败时回给 UI 给用户看
 *   - signal.aborted → kill 进程
 *
 * 解析规则保守：解析不出就让 percent 保持 undefined，UI 显示成不确定进度条。
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { logger } from '../logger';
import { getPortableRoot } from './pythonRuntime';
import type { InstallProgressEvent, InstallResult } from './types';

const LOG_TAIL_LIMIT = 50;

/**
 * 跑一个 install bat；逐行回调进度；返回 exit code + 末尾日志。
 *
 * @param batName 相对便携根的脚本名（如 'install_or_repair.bat'）
 */
export async function runInstallBat(
  batName: string,
  onProgress: (e: InstallProgressEvent) => void,
  signal?: AbortSignal
): Promise<InstallResult> {
  const root = getPortableRoot();
  const batPath = path.join(root, batName);
  if (!existsSync(batPath)) {
    throw new Error(`找不到安装脚本：${batPath}`);
  }
  const logTail: string[] = [];
  let lastPercent: number | undefined = undefined;
  const stage = batName;

  return new Promise<InstallResult>((resolve, reject) => {
    const proc = spawn('cmd.exe', ['/c', batName], {
      cwd: root,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    proc.stdout?.setEncoding('utf8');
    proc.stderr?.setEncoding('utf8');

    const onLine = (line: string, isErr: boolean): void => {
      const trimmed = line.trim();
      if (!trimmed) return;
      logTail.push((isErr ? '[err] ' : '') + trimmed);
      while (logTail.length > LOG_TAIL_LIMIT) logTail.shift();
      const pct = tryParsePercent(trimmed);
      if (pct !== undefined) lastPercent = pct;
      onProgress({ stage, message: trimmed, percent: lastPercent });
    };

    // stdout/stderr 都按行拆，因为 chcp + Python 输出经常一段两行
    const lineBuffer = { stdout: '', stderr: '' };
    const flushBuffer = (key: 'stdout' | 'stderr', isErr: boolean): void => {
      const buf = lineBuffer[key];
      if (!buf) return;
      onLine(buf, isErr);
      lineBuffer[key] = '';
    };
    const accumulate = (chunk: string, key: 'stdout' | 'stderr', isErr: boolean): void => {
      lineBuffer[key] += chunk;
      while (true) {
        const idx = lineBuffer[key].indexOf('\n');
        if (idx < 0) break;
        const line = lineBuffer[key].slice(0, idx);
        lineBuffer[key] = lineBuffer[key].slice(idx + 1);
        onLine(line, isErr);
      }
    };

    proc.stdout?.on('data', (s: string) => accumulate(s, 'stdout', false));
    proc.stderr?.on('data', (s: string) => accumulate(s, 'stderr', true));

    const onAbort = (): void => {
      try { proc.kill(); } catch { /* ignore */ }
      reject(new Error('用户取消了安装'));
    };
    // { once: true }：触发后自动摘除监听，配合下面 exit/error 的显式 remove，
    // 杜绝重复 abort 同一 signal 时监听器累积泄漏。
    signal?.addEventListener('abort', onAbort, { once: true });

    proc.on('exit', (code) => {
      signal?.removeEventListener('abort', onAbort);
      // 残留缓冲一并 flush
      flushBuffer('stdout', false);
      flushBuffer('stderr', true);
      logger.info(`[ai-platform] install ${batName} exit=${code}`);
      resolve({ success: code === 0, exitCode: code ?? -1, logTail: [...logTail] });
    });
    proc.on('error', (e) => {
      signal?.removeEventListener('abort', onAbort);
      reject(e);
    });
  });
}

/**
 * 解析常见进度行 → percent。
 *   - "Downloading: 23%"
 *   - "[==========>     ] 65%"
 *   - "23.4 MB / 100.0 MB"
 *   - pip "Collecting xxx" → 视为安装阶段，不算 percent
 * 不支持 → undefined。
 */
function tryParsePercent(line: string): number | undefined {
  // 直接百分比："xxx 23%" 或 "23 %"
  const pctMatch = line.match(/(?<![\d.])(\d{1,3})\s*%/);
  if (pctMatch) {
    const n = Number(pctMatch[1]);
    if (n >= 0 && n <= 100) return n;
  }
  // "M / N MB" 或 "M / N GB" → M/N
  const ratioMatch = line.match(/(\d+(?:\.\d+)?)\s*([KMG]?B)\s*\/\s*(\d+(?:\.\d+)?)\s*([KMG]?B)/i);
  if (ratioMatch) {
    const cur = toBytes(Number(ratioMatch[1]), ratioMatch[2]);
    const tot = toBytes(Number(ratioMatch[3]), ratioMatch[4]);
    if (tot > 0) return Math.min(100, Math.round((cur / tot) * 100));
  }
  return undefined;
}

function toBytes(n: number, unit: string): number {
  const u = unit.toUpperCase();
  if (u === 'GB') return n * 1024 * 1024 * 1024;
  if (u === 'MB') return n * 1024 * 1024;
  if (u === 'KB') return n * 1024;
  return n;
}
