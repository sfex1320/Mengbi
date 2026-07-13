/**
 * MCP 服务器控制（api:mcp:*）。
 *
 * settings 键：mcp_enabled（'1'=开）/ mcp_port（默认 7642）/ mcp_token（可选 Bearer）。
 * registerMcpHandlers() 时若已开启则自动拉起服务器（应用启动即恢复）。
 * api:mcp:respond 是渲染端画布桥的回话通道（配推送频道 mcp:tool-request）。
 */

import { z } from 'zod';
import { register, ok, err } from './helpers';
import { makeError } from '@shared/error';
import { getDb } from '../services/db';
import { logger } from '../services/logger';
import { startMcpServer, stopMcpServer, getMcpRuntimeStatus } from '../services/mcp/mcpServer';
import { resolveCanvasResponse } from '../services/mcp/canvasBridge';
import { ALL_MCP_TOOLS } from '../services/mcp/mcpTools';

const PREF_ENABLED = 'mcp_enabled';
const PREF_PORT = 'mcp_port';
const PREF_TOKEN = 'mcp_token';
export const MCP_DEFAULT_PORT = 7642;

function getPref(key: string): string {
  const row = getDb().prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? '';
}

function setPref(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO settings(key, value) VALUES(?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(key, value);
}

function readConfig(): { enabled: boolean; port: number; token: string } {
  const portRaw = Number(getPref(PREF_PORT));
  const port =
    Number.isInteger(portRaw) && portRaw >= 1024 && portRaw <= 65535 ? portRaw : MCP_DEFAULT_PORT;
  return { enabled: getPref(PREF_ENABLED) === '1', port, token: getPref(PREF_TOKEN) };
}

function statusPayload(): {
  enabled: boolean;
  running: boolean;
  port: number;
  hasToken: boolean;
  toolCount: number;
  urls: { streamableHttp: string; sse: string };
} {
  const cfg = readConfig();
  const rt = getMcpRuntimeStatus();
  const port = rt.running ? rt.port : cfg.port;
  return {
    enabled: cfg.enabled,
    running: rt.running,
    port,
    hasToken: cfg.token !== '',
    toolCount: ALL_MCP_TOOLS.length,
    urls: {
      streamableHttp: `http://127.0.0.1:${port}/mcp`,
      sse: `http://127.0.0.1:${port}/sse`
    }
  };
}

/** 按当前配置对齐运行态（开→启动/换端口重启；关→停止） */
async function applyConfig(): Promise<void> {
  const cfg = readConfig();
  if (!cfg.enabled) {
    await stopMcpServer();
    return;
  }
  await startMcpServer(cfg.port, cfg.token);
}

export function registerMcpHandlers(): void {
  register('api:mcp:status', null, async () => ok(statusPayload()));

  register(
    'api:mcp:set-config',
    z.object({
      enabled: z.boolean().optional(),
      port: z.number().int().min(1024).max(65535).optional(),
      token: z.string().max(120).optional()
    }),
    async (input) => {
      if (input.enabled !== undefined) setPref(PREF_ENABLED, input.enabled ? '1' : '0');
      if (input.port !== undefined) setPref(PREF_PORT, String(input.port));
      if (input.token !== undefined) setPref(PREF_TOKEN, input.token.trim());
      try {
        await applyConfig();
      } catch (e) {
        // 启动失败（多为端口被占）：回滚为关闭，把原因带给前端
        setPref(PREF_ENABLED, '0');
        return err(
          makeError('UNKNOWN', `MCP 服务器启动失败：${(e as Error).message}`, {
            severity: 'toast',
            hint: '端口可能被占用，换一个端口再开'
          })
        );
      }
      return ok(statusPayload());
    }
  );

  // 渲染端画布桥回话（配 push 频道 mcp:tool-request）
  register(
    'api:mcp:respond',
    z.object({
      id: z.string().min(1),
      result: z.unknown().optional(),
      error: z.string().optional()
    }),
    async (input) => {
      resolveCanvasResponse(input.id, input.result, input.error);
      return ok(true as const);
    }
  );

  // 应用启动：按开关自动拉起
  void applyConfig().catch((e) => logger.warn('[mcp] autostart failed', e));
}
