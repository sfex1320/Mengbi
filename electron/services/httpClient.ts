/**
 * Electron 主进程 HTTP 客户端：用 net.request 封装一个 fetch 兼容层。
 *
 * 为什么不用 globalThis.fetch / net.fetch：
 *   1. 图像生成 / ComfyUI 上游单次请求常 60–300s，Node 自带 fetch（undici）有隐式超时，
 *      会被中间代理掐断成 "fetch failed"。
 *   2. net.request 走 Chromium URLLoader，长连接更稳，并能拿到 net::ERR_* 错误码。
 *
 * 从 electron/ipc/generate.ts 抽出，供生图链路与 ComfyUI 编排器共用（不重复实现）。
 */
import { net } from 'electron';

export interface ChromiumFetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Buffer | FormData;
  signal?: AbortSignal;
  /**
   * 流式响应回调。设置后，每收到 1 个 chunk 就立刻 invoke（不再缓冲到 'end'），
   * 适合 SSE / NDJSON 这种边收边解析的协议。
   * 设置后 response.text() / arrayBuffer() 返回空（数据已经全部走了 onChunk）。
   */
  onChunk?: (chunk: Buffer) => void;
}

export interface ChromiumFetchResponse {
  status: number;
  ok: boolean;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/**
 * Chromium 网络栈抛出的错误。区别于业务错误：
 *   - code: Chromium 错误码（如 'net::ERR_SSL_PROTOCOL_ERROR'）
 *   - elapsedMs: 从发请求到失败经过了多久
 *
 * elapsedMs > 30s + 网络/SSL 类错误 ≈ "上游可能还在跑，连接被中间代理掐了"。
 */
export class ChromiumNetError extends Error {
  constructor(
    public code: string,
    public elapsedMs: number
  ) {
    super(`${code}（耗时 ${(elapsedMs / 1000).toFixed(1)}s）`);
    this.name = 'ChromiumNetError';
  }
}

export async function chromiumFetch(
  url: string,
  init: ChromiumFetchInit = {}
): Promise<ChromiumFetchResponse> {
  // body 编码：FormData 手动转 multipart；string → utf8；Buffer → 原样
  let bodyBuf: Buffer | undefined;
  let multipartContentType: string | undefined;
  if (init.body instanceof FormData) {
    const enc = await encodeFormDataMultipart(init.body);
    bodyBuf = enc.buffer;
    multipartContentType = enc.contentType;
  } else if (typeof init.body === 'string') {
    bodyBuf = Buffer.from(init.body, 'utf8');
  } else if (Buffer.isBuffer(init.body)) {
    bodyBuf = init.body;
  }

  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    let settled = false;
    const settleReject = (e: unknown): void => {
      if (settled) return;
      settled = true;
      reject(e);
    };
    const wrapNetError = (e: Error): ChromiumNetError | Error => {
      const msg = e.message ?? String(e);
      if (/^net::ERR_/.test(msg)) {
        return new ChromiumNetError(msg, Date.now() - startTime);
      }
      return e;
    };

    const req = net.request({ method: init.method ?? 'GET', url });

    if (init.headers) {
      for (const [k, v] of Object.entries(init.headers)) {
        req.setHeader(k, v);
      }
    }
    const userSetCT = !!init.headers?.['Content-Type'] || !!init.headers?.['content-type'];
    if (multipartContentType && !userSetCT) {
      req.setHeader('Content-Type', multipartContentType);
    }

    if (init.signal) {
      const sig = init.signal;
      const onAbort = (): void => {
        try {
          req.abort();
        } catch {
          /* noop */
        }
        const e = new Error('Aborted');
        (e as Error).name = 'AbortError';
        settleReject(e);
      };
      if (sig.aborted) {
        onAbort();
        return;
      }
      sig.addEventListener('abort', onAbort, { once: true });
    }

    req.on('error', (e) => settleReject(wrapNetError(e)));

    req.on('response', (response) => {
      const chunks: Buffer[] = [];
      const streaming = !!init.onChunk;
      response.on('data', (chunk: Buffer) => {
        if (streaming) {
          try {
            init.onChunk?.(chunk);
          } catch (e) {
            settleReject(e);
          }
        } else {
          chunks.push(chunk);
        }
      });
      response.on('end', () => {
        if (settled) return;
        settled = true;
        const data = streaming ? Buffer.alloc(0) : Buffer.concat(chunks);
        const status = response.statusCode;
        resolve({
          status,
          ok: status >= 200 && status < 300,
          text: async () => data.toString('utf8'),
          arrayBuffer: async () => {
            const ab = new ArrayBuffer(data.length);
            new Uint8Array(ab).set(data);
            return ab;
          }
        });
      });
      response.on('error', (e: Error) => settleReject(wrapNetError(e)));
      response.on('aborted', () =>
        settleReject(new ChromiumNetError('net::ERR_RESPONSE_ABORTED', Date.now() - startTime))
      );
    });

    if (bodyBuf) {
      req.write(bodyBuf);
    }
    req.end();
  });
}

/** 把 FormData 编成 multipart/form-data buffer + boundary。 */
export async function encodeFormDataMultipart(
  form: FormData
): Promise<{ buffer: Buffer; contentType: string }> {
  const boundary = `----mengbi${Math.random().toString(36).slice(2)}${Date.now()}`;
  const parts: Buffer[] = [];
  for (const [name, value] of form.entries()) {
    parts.push(Buffer.from(`--${boundary}\r\n`, 'utf8'));
    if (value instanceof Blob) {
      const filename = (value as Blob & { name?: string }).name ?? 'blob';
      const ctype = value.type || 'application/octet-stream';
      parts.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${name}"; filename="${filename}"\r\n` +
            `Content-Type: ${ctype}\r\n\r\n`,
          'utf8'
        )
      );
      parts.push(Buffer.from(await value.arrayBuffer()));
      parts.push(Buffer.from('\r\n', 'utf8'));
    } else {
      parts.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${name}"\r\n\r\n${String(value)}\r\n`,
          'utf8'
        )
      );
    }
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
  return {
    buffer: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`
  };
}
