/**
 * Sidecar Manager —— 通用 Python sidecar 进程 + HTTP 客户端。
 *
 * 任何 AI 功能要跑本地推理：
 *   ① 在 FeatureRegistry 注册自己的 FeatureSpec
 *   ② 在 Python 端实现统一的 `/api/{status,tasks,tasks/{id},tasks/{id}/cancel,unload,shutdown}` HTTP 接口
 *   ③ 服务端响应 shape 保持 TaskStatusRaw（任务相关）；feature-specific 字段塞 result_info
 *
 * 这层负责（所有 feature 通用）：
 *   - 用 `cmd.exe /c start_<feature>.bat` 启服；进程结束钩子；窗口隐藏；utf-8 解码
 *   - 用 `/api/shutdown` graceful + `cmd /c stop_<feature>.bat` 强杀双保险
 *   - HTTP GET/POST 走 Electron net.request（避开 fetch 在主进程的环境兼容问题）
 *   - 统一 ping / submit / poll / cancel / unload
 *   - app before-quit 时停所有已注册 feature 的 server
 *
 * 不负责（feature-specific 在 ai-features/<id>.ts 里）：
 *   - 提交任务的请求体 shape
 *   - error_code → AppErrorCode 映射
 *   - feature 自己模型的额外探测
 */
import { net } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { logger } from '../logger';
import { getPortableRoot, getPythonExePath, getResourcesScaffold, isPortableRootConfigured } from './pythonRuntime';
import { getModelRegistry } from './modelRegistry';
import { killProcessTree, killProcessTreeSync } from './processKill';
import { getDb } from '../db';
import type {
  FeatureSpec,
  FeatureProbe,
  ModelProbe,
  SidecarStartResult,
  SidecarStatusResult,
  TaskStatusRaw
} from './types';

interface ManagedSidecar {
  spec: FeatureSpec;
  proc: ChildProcess | null;
  shuttingDown: boolean;
}

class SidecarManager {
  private features = new Map<string, ManagedSidecar>();

  /** 启动期注册一个 feature；同 id 重复注册会覆盖 */
  register(spec: FeatureSpec): void {
    // 端口冲突检查（同一进程内）
    for (const [otherId, m] of this.features.entries()) {
      if (otherId !== spec.id && m.spec.port === spec.port) {
        throw new Error(
          `Feature 端口冲突：${spec.id}=${spec.port} 与 ${otherId}=${m.spec.port} 相同`
        );
      }
    }
    this.features.set(spec.id, { spec, proc: null, shuttingDown: false });
    logger.info(`[ai-platform] registered feature ${spec.id} on port ${spec.port}`);
  }

  list(): FeatureSpec[] {
    return [...this.features.values()].map((m) => m.spec);
  }

  get(id: string): FeatureSpec | undefined {
    return this.features.get(id)?.spec;
  }

  private mustGet(id: string): ManagedSidecar {
    const m = this.features.get(id);
    if (!m) throw new Error(`未注册的 AI feature：${id}`);
    return m;
  }

  // ── 体检 ─────────────────────────────────────────────────

  async probe(id: string): Promise<FeatureProbe> {
    const { spec } = this.mustGet(id);
    const root = getPortableRoot();
    const pythonPath = getPythonExePath(root);
    const startBatPath = path.join(root, spec.startBat);
    const stopBatPath = path.join(root, spec.stopBat);
    const serverScaffoldPath = path.join(root, spec.serverScaffoldRelPath);

    const installBatsExist: Record<string, boolean> = {};
    for (const b of spec.installBats) {
      installBatsExist[b] = existsSync(path.join(root, b));
    }

    // 把所需模型的存在性查出来
    const reg = getModelRegistry();
    const models: Record<string, ModelProbe> = {};
    for (const modelId of spec.requiredModelIds) {
      models[modelId] = reg.probeModel(modelId);
    }

    return {
      id: spec.id,
      portablePath: root,
      portableExists: existsSync(root),
      pythonExists: existsSync(pythonPath),
      pythonPath,
      startBatExists: existsSync(startBatPath),
      stopBatExists: existsSync(stopBatPath),
      installBatsExist,
      serverScaffoldExists: existsSync(serverScaffoldPath),
      port: spec.port,
      models,
      scaffoldSource: getResourcesScaffold()
    };
  }

  // ── lifecycle ────────────────────────────────────────────

  async start(id: string): Promise<SidecarStartResult> {
    const managed = this.mustGet(id);
    const { spec } = managed;
    const root = getPortableRoot();
    const startBatPath = path.join(root, spec.startBat);
    if (!existsSync(startBatPath)) {
      throw new Error(`找不到 ${startBatPath}`);
    }
    // 已经能 ping 通就别再 spawn
    if (await this.ping(spec.port, 1500)) {
      return { alreadyRunning: true, pid: null, port: spec.port };
    }
    if (managed.proc) {
      return { alreadyRunning: true, pid: managed.proc.pid ?? null, port: spec.port };
    }
    const proc = spawn('cmd.exe', ['/c', spec.startBat], {
      cwd: root,
      detached: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        // MENGBI_PARENT_PID 给 Python parent_watchdog.py 用
        MENGBI_PARENT_PID: String(process.pid),
        // MENGBI_TORCH_COMPILE_MODE 给 Python compile_helper.py 用
        // 默认 'off',用户可在设置里改 'reduce-overhead' / 'max-autotune' 来开启 UNet 编译加速
        MENGBI_TORCH_COMPILE_MODE: readTorchCompileMode()
      }
    });
    // utf-8 解码避免中文乱码（bat 末尾应该 chcp 65001）
    proc.stdout?.setEncoding('utf8');
    proc.stderr?.setEncoding('utf8');
    proc.stdout?.on('data', (s: string) => logger.info(`[${spec.id}][bat] ${s.trim()}`));
    proc.stderr?.on('data', (s: string) => logger.warn(`[${spec.id}][bat-err] ${s.trim()}`));
    proc.on('exit', (code, sig) => {
      logger.info(`[${spec.id}] bat exited code=${code} sig=${sig}`);
      managed.proc = null;
    });
    managed.proc = proc;
    return { alreadyRunning: false, pid: proc.pid ?? null, port: spec.port };
  }

  async stop(id: string): Promise<{ stopped: boolean }> {
    const managed = this.mustGet(id);
    const { spec } = managed;
    const root = getPortableRoot();
    managed.shuttingDown = true;
    // 1. graceful shutdown via HTTP
    try {
      await this.httpPost<unknown>(`http://127.0.0.1:${spec.port}/api/shutdown`, {}, 3000);
    } catch {
      /* server 可能已停 */
    }
    await sleep(800);
    // 2. 还活着 → 跑 stop bat
    if (await this.ping(spec.port, 800)) {
      const stopBatPath = path.join(root, spec.stopBat);
      if (existsSync(stopBatPath)) {
        await new Promise<void>((resolve) => {
          const p = spawn('cmd.exe', ['/c', spec.stopBat], {
            cwd: root,
            windowsHide: true,
            stdio: 'ignore'
          });
          p.on('exit', () => resolve());
          p.on('error', () => resolve());
        });
      }
    }
    // 3. 子进程仍在 → 杀整棵树（cmd.exe + 其下 python.exe）
    if (managed.proc?.pid && !managed.proc.killed) {
      await killProcessTree(managed.proc.pid);
    }
    managed.proc = null;
    managed.shuttingDown = false;
    const finalUp = await this.ping(spec.port, 500);
    return { stopped: !finalUp };
  }

  /** app before-quit 时调用：尽力停掉所有 sidecar */
  async stopAllOnQuit(): Promise<void> {
    await Promise.all(
      [...this.features.keys()].map((id) =>
        this.stop(id).catch(() => undefined)
      )
    );
  }

  /**
   * before-quit 钩子的同步兜底版 —— 当 app 已经在关闭流程中，async 的 stopAllOnQuit
   * 可能跑不完。这里同步 spawn `taskkill /F /T /PID`,1.5s 内完成,确保 GPU 被释放。
   * 不依赖 HTTP graceful（那要 800ms+ async 链）。
   */
  killAllSidecarsSync(): void {
    for (const m of this.features.values()) {
      if (m.proc?.pid && !m.proc.killed) {
        killProcessTreeSync(m.proc.pid);
        m.proc = null;
      }
    }
  }

  // ── HTTP ─────────────────────────────────────────────────

  async getServerStatus(id: string): Promise<SidecarStatusResult> {
    const { spec } = this.mustGet(id);
    try {
      const raw = await this.httpGet<Record<string, unknown>>(
        `http://127.0.0.1:${spec.port}/api/status`,
        2000
      );
      return { reachable: true, port: spec.port, raw };
    } catch (e) {
      return { reachable: false, port: spec.port, error: (e as Error).message };
    }
  }

  /** 通用提交任务 —— body 由 feature adapter 自己构造 */
  async submitTask<R = { task_id: string; status: string }>(
    id: string,
    body: Record<string, unknown>,
    timeoutMs = 5000
  ): Promise<R> {
    const { spec } = this.mustGet(id);
    return this.httpPost<R>(`http://127.0.0.1:${spec.port}/api/tasks`, body, timeoutMs);
  }

  async getTaskStatus(id: string, taskId: string, timeoutMs = 3000): Promise<TaskStatusRaw> {
    const { spec } = this.mustGet(id);
    return this.httpGet<TaskStatusRaw>(
      `http://127.0.0.1:${spec.port}/api/tasks/${encodeURIComponent(taskId)}`,
      timeoutMs
    );
  }

  async cancelTask(id: string, taskId: string, timeoutMs = 3000): Promise<void> {
    const { spec } = this.mustGet(id);
    await this.httpPost<unknown>(
      `http://127.0.0.1:${spec.port}/api/tasks/${encodeURIComponent(taskId)}/cancel`,
      {},
      timeoutMs
    );
  }

  /** /api/unload 从显存卸载模型；不停服务 */
  async unloadModel<R = Record<string, unknown>>(id: string, timeoutMs = 5000): Promise<R> {
    const { spec } = this.mustGet(id);
    return this.httpPost<R>(`http://127.0.0.1:${spec.port}/api/unload`, {}, timeoutMs);
  }

  /**
   * /api/cleanup 通用清理 —— 总是清 GPU cache + Python heap；
   * unloadModel=true 时额外卸载模型(更彻底,但下次推理要重新加载 30-60s)。
   * server 不可达时返回 null（feature 没启用就跳过）。
   */
  async cleanupSidecar(
    id: string,
    unloadModelOpt: boolean,
    timeoutMs = 10000
  ): Promise<{
    vram_used_mb_before: number | null;
    vram_used_mb_after: number | null;
    model_loaded: boolean;
    unloaded: boolean;
  } | null> {
    const { spec } = this.mustGet(id);
    // 先 ping 一下,服务没起来就别打 /api/cleanup(POST 一个 unreachable 端口超时很长)
    if (!(await this.ping(spec.port, 800))) return null;
    try {
      const r = await this.httpPost<{
        success: boolean;
        unloaded: boolean;
        vram_used_mb_before: number | null;
        vram_used_mb_after: number | null;
        model_loaded: boolean;
      }>(
        `http://127.0.0.1:${spec.port}/api/cleanup`,
        { unload_model: unloadModelOpt },
        timeoutMs
      );
      return {
        vram_used_mb_before: r.vram_used_mb_before ?? null,
        vram_used_mb_after: r.vram_used_mb_after ?? null,
        model_loaded: !!r.model_loaded,
        unloaded: !!r.unloaded
      };
    } catch (e) {
      logger.warn(`[ai-platform] cleanupSidecar(${id}) failed: ${(e as Error).message}`);
      return null;
    }
  }

  // ── 是否已显式配过 portable 根（settings 里有） ──
  isConfigured(): boolean {
    return isPortableRootConfigured();
  }

  // ── 内部 HTTP helpers ────────────────────────────────────

  private async ping(port: number, timeoutMs: number): Promise<boolean> {
    try {
      await this.httpGet(`http://127.0.0.1:${port}/api/status`, timeoutMs);
      return true;
    } catch {
      return false;
    }
  }

  httpGet<T = unknown>(url: string, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const req = net.request({ method: 'GET', url });
      let body = '';
      const timer = setTimeout(() => {
        req.abort();
        reject(new Error(`timeout ${timeoutMs}ms`));
      }, timeoutMs);
      req.on('response', (res) => {
        res.on('data', (b: Buffer) => (body += b.toString('utf-8')));
        res.on('end', () => {
          clearTimeout(timer);
          if ((res.statusCode ?? 0) < 200 || (res.statusCode ?? 0) >= 300) {
            reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
            return;
          }
          try {
            resolve(JSON.parse(body) as T);
          } catch (e) {
            reject(e);
          }
        });
        res.on('error', (e: Error) => {
          clearTimeout(timer);
          reject(e);
        });
      });
      req.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      req.end();
    });
  }

  httpPost<T = unknown>(url: string, body: unknown, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const req = net.request({ method: 'POST', url });
      req.setHeader('Content-Type', 'application/json');
      let out = '';
      const timer = setTimeout(() => {
        req.abort();
        reject(new Error(`timeout ${timeoutMs}ms`));
      }, timeoutMs);
      req.on('response', (res) => {
        res.on('data', (b: Buffer) => (out += b.toString('utf-8')));
        res.on('end', () => {
          clearTimeout(timer);
          if ((res.statusCode ?? 0) < 200 || (res.statusCode ?? 0) >= 300) {
            reject(new Error(`HTTP ${res.statusCode}: ${out.slice(0, 200)}`));
            return;
          }
          try {
            resolve(out ? (JSON.parse(out) as T) : ({} as T));
          } catch (e) {
            reject(e);
          }
        });
        res.on('error', (e: Error) => {
          clearTimeout(timer);
          reject(e);
        });
      });
      req.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      req.write(JSON.stringify(body ?? {}));
      req.end();
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 读 settings.ai_torch_compile_mode 决定 spawn 出去的 Python sidecar 是否启用
 * torch.compile UNet 加速。返回值会作为 MENGBI_TORCH_COMPILE_MODE 环境变量传出去。
 *
 * 合法值:
 *   'off'              - 关闭(默认),纯 eager
 *   'reduce-overhead'  - 中等编译,首次 +30-60s,后续每步快 1.5-2x
 *   'max-autotune'     - 激进编译(~70% TensorRT 效果),首次 +2-5 min,后续快 2-2.5x
 */
function readTorchCompileMode(): string {
  try {
    const row = getDb()
      .prepare(`SELECT value FROM settings WHERE key='ai_torch_compile_mode'`)
      .get() as { value: string } | undefined;
    const v = (row?.value ?? '').toLowerCase().trim();
    if (v === 'reduce-overhead' || v === 'max-autotune') return v;
    return 'off';
  } catch {
    return 'off';
  }
}

let singleton: SidecarManager | null = null;

export function getSidecarManager(): SidecarManager {
  if (!singleton) singleton = new SidecarManager();
  return singleton;
}

export type { SidecarManager };
