/**
 * MCP（Model Context Protocol）JSON-RPC 2.0 消息分发 —— 纯函数，不碰网络/electron。
 *
 * 实现服务器侧最小闭环：initialize / notifications/initialized / ping /
 * tools/list / tools/call。资源与提示词能力不声明（capabilities 只报 tools）。
 * 传输层（Streamable HTTP / 旧版 SSE）在 mcpServer.ts。
 */

export interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/** MCP 工具声明（inputSchema 为 JSON Schema 对象） */
export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** tools/call 的执行结果（content 走 MCP text 块） */
export interface McpToolResult {
  text: string;
  isError?: boolean;
}

export interface McpDispatchContext {
  serverName: string;
  serverVersion: string;
  tools: McpToolDef[];
  callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult>;
}

/** 客户端报什么版本就回什么（都是我们能兼容的子集）；没报则回一个稳妥的基线 */
const FALLBACK_PROTOCOL_VERSION = '2025-03-26';

function rpcError(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown
): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data !== undefined ? { data } : {}) } };
}

/**
 * 处理一条 JSON-RPC 消息。
 * 返回 null 表示无需回包（notification）；否则返回 response 对象。
 */
export async function handleMcpMessage(
  msg: unknown,
  ctx: McpDispatchContext
): Promise<JsonRpcResponse | null> {
  if (typeof msg !== 'object' || msg === null || Array.isArray(msg)) {
    return rpcError(null, -32600, 'Invalid Request');
  }
  const req = msg as JsonRpcRequest;
  const method = typeof req.method === 'string' ? req.method : '';
  const hasId = req.id !== undefined && req.id !== null;
  const id = hasId ? (req.id as string | number) : null;

  // notification（无 id）：initialized / cancelled 等一律静默吸收
  if (!hasId) {
    return null;
  }
  if (!method) {
    return rpcError(id, -32600, 'Invalid Request');
  }

  try {
    switch (method) {
      case 'initialize': {
        const asked = (req.params?.protocolVersion as string | undefined) ?? '';
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: asked || FALLBACK_PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: { name: ctx.serverName, version: ctx.serverVersion },
            instructions:
              '梦笔（mengbi）绘画工具箱的 MCP 服务器。先用 list_node_kinds 了解智能画布节点类型，' +
              '再用 list_canvases / open_canvas / read_canvas 查看画布，用 add_node / connect_nodes / ' +
              'set_node_params 搭建工作流，run_node / run_all 运行，get_node_status 取结果。'
          }
        };
      }
      case 'ping':
        return { jsonrpc: '2.0', id, result: {} };
      case 'tools/list':
        return { jsonrpc: '2.0', id, result: { tools: ctx.tools } };
      case 'tools/call': {
        const name = req.params?.name;
        if (typeof name !== 'string' || !name) {
          return rpcError(id, -32602, 'tools/call 缺少 name');
        }
        if (!ctx.tools.some((t) => t.name === name)) {
          return rpcError(id, -32602, `未知工具：${name}`);
        }
        const rawArgs = req.params?.arguments;
        const args =
          typeof rawArgs === 'object' && rawArgs !== null && !Array.isArray(rawArgs)
            ? (rawArgs as Record<string, unknown>)
            : {};
        const r = await ctx.callTool(name, args);
        return {
          jsonrpc: '2.0',
          id,
          result: { content: [{ type: 'text', text: r.text }], isError: r.isError === true }
        };
      }
      // 未声明的能力：按协议回空列表比回错误对客户端更友好
      case 'resources/list':
        return { jsonrpc: '2.0', id, result: { resources: [] } };
      case 'resources/templates/list':
        return { jsonrpc: '2.0', id, result: { resourceTemplates: [] } };
      case 'prompts/list':
        return { jsonrpc: '2.0', id, result: { prompts: [] } };
      default:
        return rpcError(id, -32601, `Method not found: ${method}`);
    }
  } catch (e) {
    return rpcError(id, -32603, (e as Error).message || 'Internal error');
  }
}

/**
 * 处理一个 HTTP body 里的消息（单条或批量数组）。
 * 返回：null = 全是 notification（HTTP 202 无 body）；单对象或数组 = 回包 JSON。
 */
export async function handleMcpBody(
  body: unknown,
  ctx: McpDispatchContext
): Promise<JsonRpcResponse | JsonRpcResponse[] | null> {
  if (Array.isArray(body)) {
    if (body.length === 0) return rpcError(null, -32600, 'Invalid Request');
    const responses: JsonRpcResponse[] = [];
    for (const m of body) {
      const r = await handleMcpMessage(m, ctx);
      if (r) responses.push(r);
    }
    return responses.length > 0 ? responses : null;
  }
  return handleMcpMessage(body, ctx);
}
