/**
 * ComfyUI 进程生命周期：启动**用户配置的命令/目录**（不是便携 Python）。
 * 判定"是否在运行"一律以**服务地址可达**为准，不靠进程名。
 * 绝不开机自启——只有用户在编排器里点「启动」才 spawn。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { logger } from '../logger';
import { killProcessTree } from '../processKill';
import { getSystemStats } from './client';

interface LaunchConfig {
  host: string;
  command: string;
  cwd: string;
  token?: string | null;
}

class ComfyLauncher {
  private proc: ChildProcess | null = null;
  private logTail: string[] = [];

  /** 服务是否可达（探活，带超时）。 */
  async isReachable(host: string, token?: string | null, timeoutMs = 2000): Promise<boolean> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      await getSystemStats(host, token, ctrl.signal);
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  isManaged(): boolean {
    return !!this.proc && !this.proc.killed;
  }

  pid(): number | null {
    return this.proc?.pid ?? null;
  }

  recentLog(): string[] {
    return [...this.logTail];
  }

  /**
   * 启动 ComfyUI 并轮询直到可达。
   * @throws Error('launch-cwd-missing') / Error('launch-failed: ...') / Error('launch-timeout')
   */
  async start(cfg: LaunchConfig, onLog?: (line: string) => void): Promise<{ pid: number | null }> {
    // 已可达（用户自己起的或上次起的）→ 直接复用，不重复 spawn
    if (await this.isReachable(cfg.host, cfg.token, 1500)) {
      return { pid: this.proc?.pid ?? null };
    }
    if (this.proc && !this.proc.killed) {
      return { pid: this.proc.pid ?? null };
    }
    if (!cfg.command.trim()) throw new Error('launch-command-missing');
    if (!cfg.cwd.trim() || !existsSync(cfg.cwd)) throw new Error('launch-cwd-missing');

    this.logTail = [];

    // Windows cmd.exe 引号陷阱：命令含多个带空格的引号路径时（如
    // `"G:\ciomfyui AI\...\python.exe" -s "...\main.py"`），若直接 `cmd /c <command>`，
    // Node 会把整个 command 再加一层引号并把内部 " 转义成 \"，而 cmd 不认 \" → 报
    // `'\"G:\...python.exe\"' 不是内部或外部命令`。解决办法是官方文档的写法：
    // `cmd /s /c "<整条命令>"`——/s 让 cmd 只剥掉最外层首尾引号、其余原样执行；
    // 配 windowsVerbatimArguments=true 阻止 Node 再次加引号/转义。
    // 另设 PYTHONUTF8/PYTHONIOENCODING，让 ComfyUI(Python) 日志稳定输出 UTF-8、不再乱码。
    const proc = spawn('cmd.exe', ['/d', '/s', '/c', `"${cfg.command}"`], {
      cwd: cfg.cwd,
      detached: false,
      windowsHide: true,
      windowsVerbatimArguments: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }
    });
    this.proc = proc;

    const pushLog = (s: string): void => {
      const line = s.trim();
      if (!line) return;
      this.logTail.push(line);
      while (this.logTail.length > 80) this.logTail.shift();
      onLog?.(line);
    };
    proc.stdout?.setEncoding('utf8');
    proc.stderr?.setEncoding('utf8');
    proc.stdout?.on('data', (s: string) => pushLog(s));
    proc.stderr?.on('data', (s: string) => pushLog(s));

    // 用对象包一层：let 变量若只在回调里赋值，TS 控制流会把它窄化成 null。
    const exitState: { value: { code: number | null } | null } = { value: null };
    proc.on('exit', (code) => {
      logger.info(`[comfyui] launcher process exit code=${code}`);
      if (this.proc === proc) this.proc = null;
      exitState.value = { code };
    });
    proc.on('error', (e) => {
      logger.warn(`[comfyui] launcher spawn error: ${e}`);
      pushLog(`spawn error: ${e instanceof Error ? e.message : String(e)}`);
    });

    // 轮询就绪：最多 90s（ComfyUI 冷启动 + 加载节点可能很慢）
    const startedAt = Date.now();
    const TIMEOUT = 90_000;
    while (Date.now() - startedAt < TIMEOUT) {
      await new Promise((r) => setTimeout(r, 1500));
      if (exitState.value) {
        throw new Error(
          `launch-failed: 进程提前退出（code=${exitState.value.code}）。日志末尾：${this.logTail.slice(-5).join(' | ')}`
        );
      }
      if (await this.isReachable(cfg.host, cfg.token, 1500)) {
        return { pid: proc.pid ?? null };
      }
    }
    throw new Error('launch-timeout');
  }

  /** 关闭 mengbi 托管的进程（用户自起的不强杀，只是断开跟踪）。 */
  async stop(): Promise<{ stopped: boolean }> {
    const proc = this.proc;
    this.proc = null;
    if (proc?.pid && !proc.killed) {
      try {
        await killProcessTree(proc.pid);
      } catch (e) {
        logger.warn(`[comfyui] killProcessTree failed: ${e}`);
      }
    }
    return { stopped: true };
  }
}

let _launcher: ComfyLauncher | null = null;
export function getComfyLauncher(): ComfyLauncher {
  if (!_launcher) _launcher = new ComfyLauncher();
  return _launcher;
}
