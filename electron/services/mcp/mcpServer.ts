/**
 * 梦笔 MCP 服务器（供 Hermes Studio 等智能体客户端接入）。
 *
 * 传输层实现两套，最大化兼容不同 MCP 客户端：
 *   1. Streamable HTTP（2025-03 规范）：POST /mcp，JSON 回包
 *   2. 旧版 HTTP+SSE（2024-11 规范）：GET /sse 建流 + POST /messages?sessionId= 发消息
 *
 * 安全：只绑 127.0.0.1；可选 Bearer token（settings 键 mcp_token）；
 * 协议分发是纯函数（mcpRpc.ts），工具执行在 mcpTools.ts。
 */

import http from 'node:http';
import crypto from 'node:crypto';
import { app } from 'electron';
import { logger } from '../logger';
import { handleMcpBody } from './mcpRpc';
import type { McpDispatchContext } from './mcpRpc';
import { ALL_MCP_TOOLS, callMcpTool } from './mcpTools';

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const SSE_KEEPALIVE_MS = 25_000;

let server: http.Server | null = null;
let currentPort = 0;
let currentToken = '';

/** 旧版 SSE 会话：sessionId → 响应流 */
const sseSessions = new Map<string, http.ServerResponse>();

function dispatchCtx(): McpDispatchContext {
  return {
    serverName: 'mengbi',
    serverVersion: app.getVersion(),
    tools: ALL_MCP_TOOLS,
    callTool: callMcpTool
  };
}

function authorized(req: http.IncomingMessage): boolean {
  if (!currentToken) return true;
  const h = req.headers.authorization ?? '';
  return h === `Bearer ${currentToken}`;
}

function writeJson(res: http.ServerResponse, status: number, body: unknown): void {
  const s = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(s)
  });
  res.end(s);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function handleStreamableHttp(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  let parsed: unknown;
  try {
    const raw = await readBody(req);
    parsed = JSON.parse(raw);
  } catch {
    writeJson(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    return;
  }
  const out = await handleMcpBody(parsed, dispatchCtx());
  if (out === null) {
    res.writeHead(202);
    res.end();
    return;
  }
  writeJson(res, 200, out);
}

function handleSseOpen(req: http.IncomingMessage, res: http.ServerResponse): void {
  const sessionId = crypto.randomUUID();
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive'
  });
  res.write(`event: endpoint\ndata: /messages?sessionId=${sessionId}\n\n`);
  sseSessions.set(sessionId, res);
  const keepalive = setInterval(() => {
    if (res.writableEnded) return;
    res.write(': ping\n\n');
  }, SSE_KEEPALIVE_MS);
  req.on('close', () => {
    clearInterval(keepalive);
    sseSessions.delete(sessionId);
  });
  logger.info('[mcp] sse session opened', { sessionId });
}

async function handleSseMessage(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL
): Promise<void> {
  const sessionId = url.searchParams.get('sessionId') ?? '';
  const stream = sseSessions.get(sessionId);
  if (!stream || stream.writableEnded) {
    writeJson(res, 404, { error: 'unknown or closed sessionId' });
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readBody(req));
  } catch {
    writeJson(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    return;
  }
  // 旧版传输：先回 202，再把响应从 SSE 流推回去
  res.writeHead(202);
  res.end('Accepted');
  const out = await handleMcpBody(parsed, dispatchCtx());
  if (out === null || stream.writableEnded) return;
  const messages = Array.isArray(out) ? out : [out];
  for (const m of messages) {
    stream.write(`event: message\ndata: ${JSON.stringify(m)}\n\n`);
  }
}

export interface McpRuntimeStatus {
  running: boolean;
  port: number;
  sseSessions: number;
}

export function getMcpRuntimeStatus(): McpRuntimeStatus {
  return { running: server !== null, port: currentPort, sseSessions: sseSessions.size };
}

export async function startMcpServer(port: number, token: string): Promise<void> {
  await stopMcpServer();
  currentToken = token;
  const srv = http.createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${currentPort}`);
      // 预检直接放行（本地客户端一般不发，但兜住）
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, Mcp-Session-Id, MCP-Protocol-Version'
        });
        res.end();
        return;
      }
      if (!authorized(req)) {
        writeJson(res, 401, { error: 'unauthorized：需要 Authorization: Bearer <token>' });
        return;
      }
      if (url.pathname === '/mcp') {
        if (req.method === 'POST') return handleStreamableHttp(req, res);
        if (req.method === 'DELETE') {
          // 无状态实现：会话终止直接确认
          res.writeHead(200);
          res.end();
          return;
        }
        res.writeHead(405, { Allow: 'POST, DELETE' });
        res.end();
        return;
      }
      if (url.pathname === '/sse' && req.method === 'GET') {
        handleSseOpen(req, res);
        return;
      }
      if (url.pathname === '/messages' && req.method === 'POST') {
        return handleSseMessage(req, res, url);
      }
      if (url.pathname === '/' && req.method === 'GET') {
        writeJson(res, 200, {
          name: 'mengbi-mcp',
          version: app.getVersion(),
          endpoints: { streamableHttp: '/mcp', sse: '/sse' },
          tools: ALL_MCP_TOOLS.length
        });
        return;
      }
      res.writeHead(404);
      res.end();
    })().catch((e) => {
      logger.warn('[mcp] request handler error', e);
      if (!res.headersSent) writeJson(res, 500, { error: 'internal error' });
    });
  });

  await new Promise<void>((resolve, reject) => {
    srv.once('error', (e) => reject(e));
    srv.listen(port, '127.0.0.1', () => {
      srv.removeAllListeners('error');
      srv.on('error', (e) => logger.warn('[mcp] server error', e));
      resolve();
    });
  });
  server = srv;
  currentPort = port;
  logger.info('[mcp] server started', { port });
}

export async function stopMcpServer(): Promise<void> {
  if (!server) return;
  const srv = server;
  server = null;
  currentPort = 0;
  for (const [id, res] of sseSessions) {
    try {
      res.end();
    } catch {
      /* ignore */
    }
    sseSessions.delete(id);
  }
  await new Promise<void>((resolve) => srv.close(() => resolve()));
  logger.info('[mcp] server stopped');
}

app.on('before-quit', () => {
  void stopMcpServer();
});
