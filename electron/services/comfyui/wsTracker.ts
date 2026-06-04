/**
 * 执行进度跟踪：优先 ws://host/ws?clientId=...（实时 per-node + 队列），
 * 2s 内开不起或中途出错 → 回退 GET /history 轮询。
 * 串行执行：同一时刻只有一个 prompt，所以消息里缺 prompt_id 时按"就是当前这个"处理。
 */
import WebSocket from 'ws';
import { normalizeHost, getHistory } from './client';
import { logger } from '../logger';

export interface TrackOptions {
  host: string;
  token?: string | null;
  clientId: string;
  promptId: string;
  signal: AbortSignal;
  onProgress: (p: {
    phase: string;
    percent: number;
    currentNode?: string | null;
    perNode?: Record<string, { value: number; max: number }>;
    queueRemaining?: number;
  }) => void;
  timeoutMs?: number;
}

interface ComfyWsMessage {
  type: string;
  data?: {
    prompt_id?: string;
    node?: string | null;
    value?: number;
    max?: number;
    status?: { exec_info?: { queue_remaining?: number } };
    exception_message?: string;
    node_type?: string;
  };
}

/** 阻塞直到该 prompt 执行完成；执行出错则 reject。 */
export async function trackProgress(opts: TrackOptions): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 5 * 60 * 1000;
  const viaWs = await tryTrackViaWs(opts, timeoutMs).catch((e) => {
    if (e instanceof ExecutionError || e instanceof AbortedError) throw e;
    logger.warn(`[comfyui] ws track failed, fallback to polling: ${e}`);
    return false;
  });
  if (viaWs === true) return;
  await pollHistory(opts, timeoutMs);
}

class ExecutionError extends Error {}
class AbortedError extends Error {}

/** 返回 true=经 ws 正常完成；抛 false-ish(reject) 让上层回退轮询。 */
function tryTrackViaWs(opts: TrackOptions, timeoutMs: number): Promise<boolean> {
  const { ws } = normalizeHost(opts.host);
  const url = `${ws}/ws?clientId=${encodeURIComponent(opts.clientId)}`;

  return new Promise<boolean>((resolve, reject) => {
    let opened = false;
    let settled = false;
    const perNode: Record<string, { value: number; max: number }> = {};

    const headers: Record<string, string> = {};
    if (opts.token && opts.token.trim()) headers['Authorization'] = `Bearer ${opts.token.trim()}`;
    const sock = new WebSocket(url, { headers });

    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(openTimer);
      clearTimeout(maxTimer);
      opts.signal.removeEventListener('abort', onAbort);
      try {
        sock.close();
      } catch {
        /* noop */
      }
      fn();
    };

    const onAbort = (): void => finish(() => reject(new AbortedError('aborted')));
    if (opts.signal.aborted) {
      onAbort();
      return;
    }
    opts.signal.addEventListener('abort', onAbort);

    // 2s 内没 open → 让上层回退轮询
    const openTimer = setTimeout(() => {
      if (!opened) finish(() => reject(new Error('ws-open-timeout')));
    }, 2000);
    const maxTimer = setTimeout(() => finish(() => reject(new Error('ws-max-timeout'))), timeoutMs);

    sock.on('open', () => {
      opened = true;
      clearTimeout(openTimer);
      opts.onProgress({ phase: 'queued', percent: 8 });
    });

    sock.on('message', (raw: WebSocket.RawData) => {
      let msg: ComfyWsMessage;
      try {
        msg = JSON.parse(raw.toString()) as ComfyWsMessage;
      } catch {
        return;
      }
      const d = msg.data ?? {};
      // 串行：缺 prompt_id 视为当前 prompt；带了就必须匹配
      const mine = !d.prompt_id || d.prompt_id === opts.promptId;
      if (!mine && msg.type !== 'status') return;

      switch (msg.type) {
        case 'status': {
          const qr = d.status?.exec_info?.queue_remaining;
          opts.onProgress({ phase: 'queued', percent: 8, queueRemaining: qr });
          break;
        }
        case 'execution_start':
          opts.onProgress({ phase: 'executing', percent: 12 });
          break;
        case 'progress': {
          const node = d.node ?? '';
          if (node && typeof d.value === 'number' && typeof d.max === 'number') {
            perNode[node] = { value: d.value, max: d.max };
            const pct = d.max > 0 ? Math.round((d.value / d.max) * 100) : 0;
            opts.onProgress({
              phase: 'executing',
              percent: Math.min(90, 12 + Math.round(pct * 0.78)),
              currentNode: node,
              perNode: { ...perNode }
            });
          }
          break;
        }
        case 'executing': {
          // node === null 且是当前 prompt → 整个 prompt 执行完成
          if (d.node === null || d.node === undefined) {
            finish(() => resolve(true));
          } else {
            opts.onProgress({ phase: 'executing', percent: 40, currentNode: d.node });
          }
          break;
        }
        case 'execution_success':
          finish(() => resolve(true));
          break;
        case 'execution_error':
          finish(() =>
            reject(
              new ExecutionError(
                `节点执行出错${d.node_type ? `（${d.node_type}）` : ''}：${d.exception_message ?? '未知'}`
              )
            )
          );
          break;
        default:
          break;
      }
    });

    sock.on('error', (e: Error) => {
      if (!opened) finish(() => reject(e)); // 没连上 → 回退轮询
      // 已连上后出错：交给 maxTimer / 上层轮询兜底
    });
    sock.on('close', () => {
      if (!settled && opened) finish(() => reject(new Error('ws-closed')));
    });
  });
}

/** /history 轮询兜底：1.5s 一次，估算百分比。 */
async function pollHistory(opts: TrackOptions, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  opts.onProgress({ phase: 'queued', percent: 10 });
  while (Date.now() - startedAt < timeoutMs) {
    if (opts.signal.aborted) throw new AbortedError('aborted');
    await new Promise((r) => setTimeout(r, 1500));
    const entry = await getHistory(opts.host, opts.promptId, opts.token, opts.signal).catch(
      () => null
    );
    if (entry?.status?.completed) {
      opts.onProgress({ phase: 'downloading', percent: 92 });
      return;
    }
    const elapsed = Date.now() - startedAt;
    const pct = Math.min(90, 10 + Math.round((elapsed / 30_000) * 80));
    opts.onProgress({ phase: 'executing', percent: pct });
  }
  throw new Error('run-timeout');
}
