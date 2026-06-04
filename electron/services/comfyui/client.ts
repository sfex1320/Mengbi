/**
 * ComfyUI REST 客户端：复用主进程的 chromiumFetch（长请求 + multipart + AbortSignal）。
 * 只做协议拼装，不碰业务/DB。所有方法接收 host(+token)，由调用方从 settings 解出。
 */
import { chromiumFetch } from '../httpClient';
import type { ComfyApiWorkflow } from '@shared/comfyui';

/** "127.0.0.1:8188" / "http://x:8188/" → { http, ws } 归一化（去尾斜杠、补协议）。 */
export function normalizeHost(raw: string): { http: string; ws: string } {
  let h = (raw || '').trim();
  if (!h) h = '127.0.0.1:8188';
  if (!/^https?:\/\//i.test(h)) h = `http://${h}`;
  h = h.replace(/\/+$/, '');
  const ws = h.replace(/^http/i, 'ws');
  return { http: h, ws };
}

function authHeaders(token?: string | null): Record<string, string> {
  const headers: Record<string, string> = {};
  if (token && token.trim()) headers['Authorization'] = `Bearer ${token.trim()}`;
  return headers;
}

export interface ComfyHistoryEntry {
  status?: { completed?: boolean; status_str?: string; messages?: unknown[] };
  outputs?: Record<string, Record<string, unknown>>;
}

export interface ComfyViewRef {
  filename: string;
  subfolder?: string;
  type?: string;
}

/** GET /system_stats —— 探活 + 拿版本。 */
export async function getSystemStats(
  host: string,
  token?: string | null,
  signal?: AbortSignal
): Promise<Record<string, unknown>> {
  const { http } = normalizeHost(host);
  const res = await chromiumFetch(`${http}/system_stats`, { headers: authHeaders(token), signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return JSON.parse(await res.text()) as Record<string, unknown>;
}

/** GET /object_info —— 节点类型元信息（大，可能数 MB）。 */
export async function getObjectInfo(
  host: string,
  token?: string | null,
  signal?: AbortSignal
): Promise<Record<string, unknown>> {
  const { http } = normalizeHost(host);
  const res = await chromiumFetch(`${http}/object_info`, { headers: authHeaders(token), signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return JSON.parse(await res.text()) as Record<string, unknown>;
}

/** POST /prompt —— 提交工作流，返回 prompt_id。校验失败时 ComfyUI 返回 4xx + node_errors。 */
export async function submitPrompt(
  host: string,
  workflow: ComfyApiWorkflow | Record<string, unknown>,
  clientId: string,
  token?: string | null,
  signal?: AbortSignal
): Promise<{ promptId: string }> {
  const { http } = normalizeHost(host);
  const res = await chromiumFetch(`${http}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify({ prompt: workflow, client_id: clientId }),
    signal
  });
  const text = await res.text();
  if (!res.ok) {
    // 同时给出顶层 message + 每个节点的具体校验错误（哪个节点哪个字段），便于定位
    let detail = text.slice(0, 400);
    try {
      const j = JSON.parse(text) as {
        error?: { message?: string };
        node_errors?: Record<
          string,
          { class_type?: string; errors?: Array<{ message?: string; extra_info?: { input_name?: string } }> }
        >;
      };
      const parts: string[] = [];
      if (j.error?.message) parts.push(String(j.error.message));
      if (j.node_errors && typeof j.node_errors === 'object') {
        for (const [nid, info] of Object.entries(j.node_errors)) {
          const cls = info?.class_type ? ` ${info.class_type}` : '';
          for (const e of info?.errors ?? []) {
            const field = e?.extra_info?.input_name ? `（${e.extra_info.input_name}）` : '';
            parts.push(`节点 #${nid}${cls}: ${e?.message ?? ''}${field}`);
          }
        }
      }
      if (parts.length) detail = parts.join('；').slice(0, 700);
    } catch {
      /* keep raw */
    }
    throw new Error(`POST /prompt HTTP ${res.status}: ${detail}`);
  }
  const json = JSON.parse(text) as { prompt_id?: string };
  if (!json.prompt_id) throw new Error(`ComfyUI 未返回 prompt_id：${text.slice(0, 200)}`);
  return { promptId: json.prompt_id };
}

/** GET /history/{promptId} —— 取执行结果。 */
export async function getHistory(
  host: string,
  promptId: string,
  token?: string | null,
  signal?: AbortSignal
): Promise<ComfyHistoryEntry | null> {
  const { http } = normalizeHost(host);
  const res = await chromiumFetch(`${http}/history/${promptId}`, {
    headers: authHeaders(token),
    signal
  });
  if (!res.ok) return null;
  const json = JSON.parse(await res.text()) as Record<string, ComfyHistoryEntry>;
  return json[promptId] ?? null;
}

/** GET /view —— 下载输出文件（图片/视频/音频…）为 Buffer。 */
export async function viewFile(
  host: string,
  ref: ComfyViewRef,
  token?: string | null,
  signal?: AbortSignal
): Promise<Buffer> {
  const { http } = normalizeHost(host);
  const q = new URLSearchParams({
    filename: ref.filename,
    subfolder: ref.subfolder ?? '',
    type: ref.type ?? 'output'
  });
  const res = await chromiumFetch(`${http}/view?${q.toString()}`, {
    headers: authHeaders(token),
    signal
  });
  if (!res.ok) throw new Error(`GET /view HTTP ${res.status}（${ref.filename}）`);
  return Buffer.from(await res.arrayBuffer());
}

/** POST /upload/image —— 上传图片/遮罩到 ComfyUI input 目录（第三阶段文件绑定用）。 */
export async function uploadImage(
  host: string,
  buf: Buffer,
  filename: string,
  opts?: { subfolder?: string; type?: string; overwrite?: boolean; mime?: string },
  token?: string | null,
  signal?: AbortSignal
): Promise<{ name: string; subfolder: string; type: string }> {
  const { http } = normalizeHost(host);
  const form = new FormData();
  const blob = new Blob([new Uint8Array(buf)], { type: opts?.mime ?? 'image/png' });
  (blob as Blob & { name?: string }).name = filename;
  form.append('image', blob, filename);
  if (opts?.subfolder) form.append('subfolder', opts.subfolder);
  form.append('type', opts?.type ?? 'input');
  if (opts?.overwrite) form.append('overwrite', 'true');
  const res = await chromiumFetch(`${http}/upload/image`, {
    method: 'POST',
    headers: authHeaders(token),
    body: form,
    signal
  });
  if (!res.ok) throw new Error(`POST /upload/image HTTP ${res.status}`);
  const j = JSON.parse(await res.text()) as { name?: string; subfolder?: string; type?: string };
  return { name: j.name ?? filename, subfolder: j.subfolder ?? '', type: j.type ?? 'input' };
}

/**
 * POST /free —— 通知 ComfyUI 卸载模型 / 释放缓存与显存。
 * body: { unload_models, free_memory }（ComfyUI 标准接口，置标志位，下次队列空闲时执行释放）。
 */
export async function freeMemory(
  host: string,
  opts: { unloadModels?: boolean; freeMemory?: boolean },
  token?: string | null,
  signal?: AbortSignal
): Promise<void> {
  const { http } = normalizeHost(host);
  const res = await chromiumFetch(`${http}/free`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify({ unload_models: !!opts.unloadModels, free_memory: !!opts.freeMemory }),
    signal
  });
  if (!res.ok) throw new Error(`POST /free HTTP ${res.status}`);
}
