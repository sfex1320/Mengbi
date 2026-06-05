/**
 * ComfyUI 连接管理 IPC：配置读写、探活、启动/停止、状态。
 * 判定运行与否一律以"服务地址可达"为准；启动器只在用户点「启动」时 spawn，绝不自启。
 */
import { register, ok, err } from './helpers';
import { makeError } from '@shared/error';
import { getDb } from '../services/db';
import { encryptString, decryptString } from '../services/safeStorage';
import { getComfyLauncher } from '../services/comfyui/launcher';
import { getSystemStats, freeMemory } from '../services/comfyui/client';
import { scanComfyLaunch } from '../services/comfyui/launchScanner';
import {
  ComfyuiSetConfigSchema,
  ComfyuiDetectSchema,
  ComfyuiScanLaunchSchema,
  ComfyuiFreeMemorySchema
} from './schemas';
import type { ConnectionStatus, ComfyConnectionConfig, DetectResult } from '@shared/comfyui';

const K_HOST = 'comfyui_host';
const K_CMD = 'comfyui_launch_command';
const K_CWD = 'comfyui_launch_cwd';
const K_TOKEN = 'comfyui_auth_token'; // 加密存储

const DEFAULT_HOST = '127.0.0.1:8188';

function getSetting(key: string): string | null {
  const row = getDb().prepare(`SELECT value FROM settings WHERE key=?`).get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

function setSetting(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO settings(key, value) VALUES(?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(key, value);
}

/** 给 run handler 复用：解出 host + 明文 token（仅主进程内用，永不回传渲染进程）。 */
export function resolveComfyConnection(): { host: string; token: string | null } {
  const host = getSetting(K_HOST) || DEFAULT_HOST;
  const enc = getSetting(K_TOKEN);
  let token: string | null = null;
  if (enc) {
    try {
      token = decryptString(enc);
    } catch {
      token = null;
    }
  }
  return { host, token };
}

function extractVersion(stats: Record<string, unknown>): string | undefined {
  const sys = stats?.system as Record<string, unknown> | undefined;
  const v = sys?.comfyui_version ?? (stats as Record<string, unknown>).comfyui_version;
  return typeof v === 'string' ? v : undefined;
}

export function registerComfyuiConnectionHandlers(): void {
  register('api:comfyui:get-config', null, async () => {
    const cfg: ComfyConnectionConfig = {
      host: getSetting(K_HOST) || DEFAULT_HOST,
      launchCommand: getSetting(K_CMD) || '',
      launchCwd: getSetting(K_CWD) || '',
      hasAuthToken: !!getSetting(K_TOKEN)
    };
    return ok(cfg);
  });

  register('api:comfyui:set-config', ComfyuiSetConfigSchema, async (input) => {
    if (input.host !== undefined) setSetting(K_HOST, input.host.trim() || DEFAULT_HOST);
    if (input.launchCommand !== undefined) setSetting(K_CMD, input.launchCommand);
    if (input.launchCwd !== undefined) setSetting(K_CWD, input.launchCwd);
    if (input.authToken !== undefined) {
      // null / '' → 清空；非空 → 加密存
      const t = input.authToken;
      if (!t) setSetting(K_TOKEN, '');
      else setSetting(K_TOKEN, encryptString(t));
    }
    return ok({ saved: true });
  });

  register('api:comfyui:detect', ComfyuiDetectSchema, async (input) => {
    const { host: storedHost, token } = resolveComfyConnection();
    const host = input?.host?.trim() || storedHost;
    try {
      const stats = await getSystemStats(host, token);
      const r: DetectResult = { reachable: true, version: extractVersion(stats) };
      return ok(r);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // 区分超时 vs 拒绝/离线
      if (/timeout|ETIMEDOUT|ERR_TIMED_OUT/i.test(msg)) {
        return err(
          makeError('NETWORK_TIMEOUT', `连接 ComfyUI 超时（${host}）`, {
            severity: 'toast',
            hint: '检查地址端口、防火墙，或确认 ComfyUI 已启动'
          })
        );
      }
      return err(
        makeError('NETWORK_OFFLINE', `无法连接到 ComfyUI（${host}）`, {
          severity: 'toast',
          hint: '确认 ComfyUI 已启动，或在下方点「启动 ComfyUI」'
        })
      );
    }
  });

  // 选一个 ComfyUI 文件夹 → 自动识别启动方式（纯读目录，不执行任何东西）
  register('api:comfyui:scan-launch', ComfyuiScanLaunchSchema, async (input) => {
    return ok({ candidates: scanComfyLaunch(input.dir) });
  });

  register('api:comfyui:status', null, async () => {
    const launcher = getComfyLauncher();
    const { host, token } = resolveComfyConnection();
    const reachable = await launcher.isReachable(host, token, 1500);
    const managed = launcher.isManaged();
    const status: ConnectionStatus = {
      phase: reachable ? 'connected' : 'disconnected',
      host,
      reachable,
      managed,
      pid: launcher.pid()
    };
    return ok(status);
  });

  register('api:comfyui:start', null, async (_input, event) => {
    const launcher = getComfyLauncher();
    const { host, token } = resolveComfyConnection();
    const command = getSetting(K_CMD) || '';
    const cwd = getSetting(K_CWD) || '';

    const pushStatus = (phase: ConnectionStatus['phase'], message?: string): void => {
      if (event.sender.isDestroyed()) return;
      event.sender.send('comfyui:status', {
        phase,
        host,
        reachable: phase === 'connected',
        managed: launcher.isManaged(),
        pid: launcher.pid(),
        message
      } as ConnectionStatus);
    };

    pushStatus('connecting');
    try {
      const r = await launcher.start({ host, command, cwd, token }, (line) => {
        if (!event.sender.isDestroyed()) event.sender.send('comfyui:status', {
          phase: 'connecting',
          host,
          reachable: false,
          managed: true,
          pid: launcher.pid(),
          message: line
        } as ConnectionStatus);
      });
      pushStatus('connected');
      return ok({ pid: r.pid });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      pushStatus('launch-failed', msg);
      if (msg.includes('launch-command-missing')) {
        return err(
          makeError('CONFIG_MISSING', '尚未配置 ComfyUI 启动命令', {
            severity: 'modal',
            hint: '在连接设置里填写启动命令（如 run_nvidia_gpu.bat 或 python main.py --port 8188）与 ComfyUI 目录'
          })
        );
      }
      if (msg.includes('launch-cwd-missing')) {
        return err(
          makeError('FILE_NOT_FOUND', '找不到 ComfyUI 目录', {
            severity: 'modal',
            hint: '检查「ComfyUI 目录」是否填对'
          })
        );
      }
      if (msg.includes('launch-timeout')) {
        return err(
          makeError('NETWORK_TIMEOUT', 'ComfyUI 启动后 90 秒内仍未就绪', {
            severity: 'modal',
            hint: '可能在加载大量自定义节点；可手动启动 ComfyUI 后改用「检测」连接'
          })
        );
      }
      return err(
        makeError('API_FAILED', `ComfyUI 启动失败：${msg}`, {
          severity: 'modal',
          hint: '检查启动命令是否能在该目录下手动运行'
        })
      );
    }
  });

  register('api:comfyui:free-memory', ComfyuiFreeMemorySchema, async (input) => {
    const { host, token } = resolveComfyConnection();
    const reachable = await getComfyLauncher().isReachable(host, token, 2000);
    if (!reachable) {
      return err(
        makeError('NETWORK_OFFLINE', `ComfyUI 未连接（${host}）`, {
          severity: 'toast',
          hint: '先在连接页检测/启动 ComfyUI 再清理'
        })
      );
    }
    try {
      await freeMemory(host, { unloadModels: input.unloadModels, freeMemory: input.freeMemory }, token);
      return ok({ requested: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return err(
        makeError('API_FAILED', `释放失败：${msg}`, {
          severity: 'toast',
          hint: '你的 ComfyUI 可能不支持 /free 接口，或服务异常'
        })
      );
    }
  });

  register('api:comfyui:stop', null, async (_input, event) => {
    const launcher = getComfyLauncher();
    const r = await launcher.stop();
    if (!event.sender.isDestroyed()) {
      const { host } = resolveComfyConnection();
      event.sender.send('comfyui:status', {
        phase: 'disconnected',
        host,
        reachable: false,
        managed: false,
        pid: null
      } as ConnectionStatus);
    }
    return ok(r);
  });
}
