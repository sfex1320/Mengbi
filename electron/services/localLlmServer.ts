/**
 * 内嵌 llama.cpp 服务（基于 node-llama-cpp v3）。
 *
 * 暴露一个最小 OpenAI 兼容 HTTP 服务（仅 /v1/chat/completions），
 * 让 chat.ts 既有的 `streamOpenAICompat` 能直接当成"远程站"用。
 *
 * 设计要点：
 * - 单例：同一时刻只跑一个模型；切模型先 stop 再 start。
 * - 端口：127.0.0.1:0 由系统分配，避免端口冲突。
 * - 流式：SSE 逐 token 推；和 OpenAI 一致 `data: {...}\n\n` + `data: [DONE]\n\n`。
 * - 非流式：一次性返回完整响应。
 * - app.before-quit：调用 stop() 把子上下文与模型释放。
 *
 * 依赖：`node-llama-cpp`（外部 dep，ESM only，必须 dynamic import）。
 */

import http from 'node:http';
import { logger } from './logger';

export interface LocalLlmStatus {
  running: boolean;
  modelPath: string | null;
  baseUrl: string | null;
  loading: boolean;
}

export interface LocalLlmInfo {
  baseUrl: string;
  modelPath: string;
}

interface ChatMsg {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatRequest {
  model?: string;
  messages: ChatMsg[];
  stream?: boolean;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
}

/** 本地模型加载超时：坏 gguf / 几十 GB 模型会让 loadModel 永久挂起，超时即放弃。 */
const LOAD_MODEL_TIMEOUT_MS = 120_000;

class LocalLlmServer {
  private server: http.Server | null = null;
  private llama: unknown = null;
  private model: unknown = null;
  private context: unknown = null;
  private currentModelPath: string | null = null;
  private info: LocalLlmInfo | null = null;
  private loadingPromise: Promise<LocalLlmInfo> | null = null;
  /** 加载令牌：每次 start() 自增；超时/被取代时作废，迟到的加载结果据此丢弃并释放，防 stale 赋值泄漏 */
  private loadToken = 0;
  /** node-llama-cpp 模块缓存 */
  private moduleCache: typeof import('node-llama-cpp') | null = null;

  getStatus(): LocalLlmStatus {
    return {
      running: !!this.info,
      modelPath: this.currentModelPath,
      baseUrl: this.info?.baseUrl ?? null,
      loading: !!this.loadingPromise
    };
  }

  /**
   * gpuLayers：放到 GPU 的层数（settings `local_llm_gpu_layers`）。
   * undefined = node-llama-cpp 自动；0 = 纯 CPU（推理变慢但完全不抢界面 GPU）；
   * 正整数 = 限制 offload 层数（推理与界面合成分摊显卡）。换值需先停止本地模型再发消息（重新加载生效）。
   */
  async ensureRunning(modelPath: string, gpuLayers?: number): Promise<LocalLlmInfo> {
    if (this.info && this.currentModelPath === modelPath) return this.info;
    if (this.loadingPromise) return this.loadingPromise;
    this.loadingPromise = this.start(modelPath, gpuLayers).finally(() => {
      this.loadingPromise = null;
    });
    return this.loadingPromise;
  }

  private async getModule(): Promise<typeof import('node-llama-cpp')> {
    if (!this.moduleCache) {
      this.moduleCache = await import('node-llama-cpp');
    }
    return this.moduleCache;
  }

  private async start(modelPath: string, gpuLayers?: number): Promise<LocalLlmInfo> {
    if (this.info && this.currentModelPath !== modelPath) {
      await this.stop();
    }
    logger.info('localLlm.start', { modelPath, gpuLayers: gpuLayers ?? 'auto' });

    const mod = await this.getModule();
    // 加载模型 + 建上下文整体套超时：坏 gguf / 超大模型会让 loadModel /
    // createContext 永久挂起，主进程被 await 卡死、用户无法取消。超时即放弃 + 清理。
    // 关键：用 loadToken 守住「超时后迟到的加载」——它完成时若 token 已变，丢弃并释放，
    // 绝不把 stale 的 model/context 赋回 this.*（否则泄漏 + 状态不一致）。
    const token = ++this.loadToken;
    const disposeQuietly = async (x: unknown): Promise<void> => {
      try {
        await (x as { dispose?: () => Promise<void> })?.dispose?.();
      } catch {
        /* ignore */
      }
    };
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        (async (): Promise<void> => {
          if (!this.llama) {
            this.llama = await mod.getLlama();
          }
          const llama = this.llama as Awaited<ReturnType<typeof mod.getLlama>>;
          const model = await llama.loadModel(
            typeof gpuLayers === 'number' && Number.isFinite(gpuLayers) && gpuLayers >= 0
              ? { modelPath, gpuLayers: Math.trunc(gpuLayers) }
              : { modelPath }
          );
          if (this.loadToken !== token) {
            await disposeQuietly(model); // 已超时/被取代：释放，不赋值
            return;
          }
          const context = await model.createContext();
          if (this.loadToken !== token) {
            await disposeQuietly(context);
            await disposeQuietly(model);
            return;
          }
          this.model = model;
          this.context = context;
        })(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error(
                  `加载本地模型超时（>${Math.round(
                    LOAD_MODEL_TIMEOUT_MS / 1000
                  )}s）：.gguf 文件可能损坏或过大，已放弃加载`
                )
              ),
            LOAD_MODEL_TIMEOUT_MS
          );
        })
      ]);
    } catch (e) {
      this.loadToken++; // 作废本次加载：迟到完成的 loadModel 会走 dispose 分支，不再 stale 赋值
      if (timer) clearTimeout(timer);
      await this.stop().catch(() => undefined); // 清理可能半加载的资源
      throw e;
    }
    if (timer) clearTimeout(timer);

    const server = http.createServer((req, res) => {
      void this.handle(req, res, mod).catch((e) => {
        logger.error('localLlm.handle threw', e);
        try {
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({
                error: { message: (e as Error).message }
              })
            );
          } else {
            res.end();
          }
        } catch {
          /* ignore */
        }
      });
    });

    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (typeof addr === 'string' || !addr) {
          reject(new Error('listen failed'));
          return;
        }
        this.server = server;
        this.currentModelPath = modelPath;
        this.info = {
          baseUrl: `http://127.0.0.1:${addr.port}/v1`,
          modelPath
        };
        logger.info('localLlm.ready', this.info);
        resolve(this.info);
      });
    });
  }

  async stop(): Promise<void> {
    logger.info('localLlm.stop');
    if (this.server) {
      const s = this.server;
      this.server = null;
      await new Promise<void>((r) => s.close(() => r()));
    }
    if (this.context) {
      try {
        await (this.context as { dispose?: () => Promise<void> }).dispose?.();
      } catch {
        /* ignore */
      }
      this.context = null;
    }
    if (this.model) {
      try {
        await (this.model as { dispose?: () => Promise<void> }).dispose?.();
      } catch {
        /* ignore */
      }
      this.model = null;
    }
    this.info = null;
    this.currentModelPath = null;
  }

  // ──────────────────────────────────────────────
  // HTTP handler — OpenAI /v1/chat/completions 兼容
  // ──────────────────────────────────────────────
  private async handle(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    mod: typeof import('node-llama-cpp')
  ): Promise<void> {
    if (req.method === 'GET' && req.url === '/v1/models') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          object: 'list',
          data: [
            {
              id: this.modelDisplayName(),
              object: 'model',
              owned_by: 'local'
            }
          ]
        })
      );
      return;
    }

    if (req.method !== 'POST' || !req.url || !req.url.startsWith('/v1/chat/completions')) {
      res.statusCode = 404;
      res.end('not found');
      return;
    }

    const body = await readBody(req);
    let parsed: ChatRequest;
    try {
      parsed = JSON.parse(body) as ChatRequest;
    } catch (e) {
      res.statusCode = 400;
      res.end(`bad json: ${(e as Error).message}`);
      return;
    }

    const stream = !!parsed.stream;
    const messages = (parsed.messages ?? []).filter(
      (m) => m && (m.role === 'system' || m.role === 'user' || m.role === 'assistant')
    );
    if (messages.length === 0) {
      res.statusCode = 400;
      res.end('no messages');
      return;
    }

    // 提取 system prompt 与最后一条 user
    const systemPrompt = messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n');
    const lastUserIdx = lastIndex(messages, (m) => m.role === 'user');
    if (lastUserIdx < 0) {
      res.statusCode = 400;
      res.end('no user message');
      return;
    }
    const userPrompt = messages[lastUserIdx].content;
    const history = messages
      .slice(0, lastUserIdx)
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role, content: m.content }));

    const ctx = this.context as Awaited<
      ReturnType<NonNullable<typeof this.model> extends { createContext: () => infer R } ? () => R : never>
    >;
    // 取一个序列。session 在每次请求新建，避免跨请求状态污染。
    const sequence = (
      ctx as { getSequence: () => unknown }
    ).getSequence() as object;
    const session = new mod.LlamaChatSession({
      contextSequence: sequence as never,
      systemPrompt: systemPrompt || undefined
    });

    // 把历史塞进 session（最简方法：手动 setChatHistory）
    if (history.length > 0) {
      try {
        const hist: Array<
          | { type: 'system'; text: string }
          | { type: 'user'; text: string }
          | { type: 'model'; response: Array<string> }
        > = [];
        if (systemPrompt) hist.push({ type: 'system', text: systemPrompt });
        for (const m of history) {
          if (m.role === 'user') hist.push({ type: 'user', text: m.content });
          else if (m.role === 'assistant') hist.push({ type: 'model', response: [m.content] });
        }
        (session as { setChatHistory: (h: typeof hist) => void }).setChatHistory(hist);
      } catch (e) {
        logger.warn('setChatHistory failed; continuing without history', e);
      }
    }

    const id = `chatcmpl-local-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);
    const modelName = this.modelDisplayName();

    if (stream) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');

      const sendChunk = (delta: string): void => {
        const payload = {
          id,
          object: 'chat.completion.chunk',
          created,
          model: modelName,
          choices: [{ index: 0, delta: { content: delta }, finish_reason: null }]
        };
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      };

      // 先推一个 role 头部（OpenAI 协议第一条 chunk 通常带 role）
      res.write(
        `data: ${JSON.stringify({
          id,
          object: 'chat.completion.chunk',
          created,
          model: modelName,
          choices: [
            {
              index: 0,
              delta: { role: 'assistant', content: '' },
              finish_reason: null
            }
          ]
        })}\n\n`
      );

      try {
        await session.prompt(userPrompt, {
          maxTokens: parsed.max_tokens,
          temperature: parsed.temperature,
          topP: parsed.top_p,
          onTextChunk: (chunk: string) => {
            sendChunk(chunk);
          }
        });
        res.write(
          `data: ${JSON.stringify({
            id,
            object: 'chat.completion.chunk',
            created,
            model: modelName,
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
          })}\n\n`
        );
        res.write(`data: [DONE]\n\n`);
      } catch (e) {
        logger.error('localLlm prompt failed', e);
        res.write(
          `data: ${JSON.stringify({
            error: { message: (e as Error).message }
          })}\n\n`
        );
      } finally {
        res.end();
        try {
          (sequence as { dispose?: () => void }).dispose?.();
        } catch {
          /* ignore */
        }
      }
      return;
    }

    // 非流式
    try {
      const text = await session.prompt(userPrompt, {
        maxTokens: parsed.max_tokens,
        temperature: parsed.temperature,
        topP: parsed.top_p
      });
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          id,
          object: 'chat.completion',
          created,
          model: modelName,
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: text },
              finish_reason: 'stop'
            }
          ],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
        })
      );
    } finally {
      try {
        (sequence as { dispose?: () => void }).dispose?.();
      } catch {
        /* ignore */
      }
    }
  }

  private modelDisplayName(): string {
    if (!this.currentModelPath) return 'local';
    const m = /([^/\\]+?)(?:\.gguf)?$/i.exec(this.currentModelPath);
    return m?.[1] ?? 'local';
  }
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c as Buffer));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function lastIndex<T>(arr: T[], pred: (v: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (pred(arr[i])) return i;
  }
  return -1;
}

export const localLlmServer = new LocalLlmServer();
