/**
 * 跨平台进程树杀器 —— 解决 Windows 上"杀爷爷不杀孙子"问题。
 *
 * Windows:
 *   - mengbi.exe (爷爷) → cmd.exe (爸爸) → python.exe (孙子, 烧 GPU)
 *   - Node 的 child_process `.kill()` 只杀直接子进程，孙子留下当孤儿
 *   - 解法: `taskkill /F /T /PID <pid>` —— /T 标志递归整棵树
 *
 * Linux/macOS:
 *   - 用 process.kill(-pid, SIGTERM) 信号送给整个 process group
 *   - 前提是 spawn 时用了 detached: true（mengbi 目前没用，但 SIGKILL 个 -pid 在多数情况下仍管用）
 */
import { spawn, spawnSync } from 'node:child_process';

/** 异步杀进程树。失败也 resolve（best-effort）。 */
export function killProcessTree(pid: number, timeoutMs = 3000): Promise<void> {
  if (!pid || pid <= 0) return Promise.resolve();
  if (process.platform !== 'win32') {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      try {
        process.kill(pid, 'SIGKILL');
      } catch { /* ignore */ }
    }
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const p = spawn('taskkill', ['/F', '/T', '/PID', String(pid)], {
      windowsHide: true,
      stdio: 'ignore'
    });
    const timer = setTimeout(() => {
      try { p.kill(); } catch { /* ignore */ }
      finish();
    }, timeoutMs);
    p.on('exit', finish);
    p.on('error', finish);
  });
}

/** 同步版 —— 给 before-quit 这种"快进快出"场景用。 */
export function killProcessTreeSync(pid: number, timeoutMs = 1500): void {
  if (!pid || pid <= 0) return;
  if (process.platform !== 'win32') {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      try {
        process.kill(pid, 'SIGKILL');
      } catch { /* ignore */ }
    }
    return;
  }
  try {
    spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)], {
      windowsHide: true,
      stdio: 'ignore',
      timeout: timeoutMs
    });
  } catch { /* ignore */ }
}

/** 检查 PID 是否还活着（不发实际信号）。 */
export function isProcessAlive(pid: number): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0); // signal 0 = 仅存在性检查
    return true;
  } catch {
    return false;
  }
}
