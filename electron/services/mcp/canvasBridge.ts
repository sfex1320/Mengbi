/**
 * MCP → 渲染进程 智能画布桥。
 *
 * 画布状态（nodes/edges/多文档）都活在渲染进程（zustand + localStorage），
 * 主进程收到 MCP 画布类工具调用后无法直接执行，必须往返一次：
 *   main --push 'mcp:tool-request' {id,tool,args}--> renderer（App 级监听，铁律 17）
 *   renderer --invoke 'api:mcp:respond' {id,result|error}--> main resolve
 *
 * 渲染端崩溃/未开窗/超时都会把该次调用落成明确的工具错误，不会挂死 MCP 客户端。
 */

import { BrowserWindow } from 'electron';
import { logger } from '../logger';

interface PendingEntry {
  resolve: (v: { result?: unknown; error?: string }) => void;
  timer: NodeJS.Timeout;
}

const pending = new Map<string, PendingEntry>();
let seq = 0;

const BRIDGE_TIMEOUT_MS = 20_000;

/** 渲染端经 api:mcp:respond 回话 → resolve 对应请求 */
export function resolveCanvasResponse(id: string, result?: unknown, error?: string): boolean {
  const entry = pending.get(id);
  if (!entry) return false;
  pending.delete(id);
  clearTimeout(entry.timer);
  entry.resolve({ result, error });
  return true;
}

/** 把一次画布工具调用推给渲染进程并等待回话 */
export function requestCanvasTool(
  tool: string,
  args: Record<string, unknown>
): Promise<{ result?: unknown; error?: string }> {
  const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
  if (!win) {
    return Promise.resolve({ error: '梦笔窗口未打开，无法操作画布' });
  }
  const id = `mcp-${Date.now()}-${++seq}`;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      logger.warn('[mcp] canvas bridge timeout', { tool });
      resolve({ error: `画布桥超时（${BRIDGE_TIMEOUT_MS / 1000}s）：渲染端无响应` });
    }, BRIDGE_TIMEOUT_MS);
    pending.set(id, { resolve, timer });
    try {
      win.webContents.send('mcp:tool-request', { id, tool, args });
    } catch (e) {
      pending.delete(id);
      clearTimeout(timer);
      resolve({ error: `画布桥发送失败：${(e as Error).message}` });
    }
  });
}
