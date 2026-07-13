import { describe, it, expect } from 'vitest';
import { handleMcpMessage, handleMcpBody } from './mcpRpc';
import type { McpDispatchContext, JsonRpcResponse } from './mcpRpc';

function ctx(overrides?: Partial<McpDispatchContext>): McpDispatchContext {
  return {
    serverName: 'mengbi',
    serverVersion: '0.0.12',
    tools: [
      { name: 'echo', description: 'echo back', inputSchema: { type: 'object', properties: {} } }
    ],
    callTool: async (name, args) => ({ text: JSON.stringify({ name, args }) }),
    ...overrides
  };
}

describe('handleMcpMessage：核心方法', () => {
  it('initialize：回显客户端协议版本 + tools 能力 + serverInfo', async () => {
    const r = (await handleMcpMessage(
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
      ctx()
    )) as JsonRpcResponse;
    expect(r.id).toBe(1);
    const result = r.result as { protocolVersion: string; capabilities: { tools: object }; serverInfo: { name: string } };
    expect(result.protocolVersion).toBe('2025-06-18');
    expect(result.capabilities.tools).toBeDefined();
    expect(result.serverInfo.name).toBe('mengbi');
  });

  it('initialize 未带版本 → 回退基线版本', async () => {
    const r = (await handleMcpMessage({ jsonrpc: '2.0', id: 2, method: 'initialize' }, ctx())) as JsonRpcResponse;
    expect((r.result as { protocolVersion: string }).protocolVersion).toBe('2025-03-26');
  });

  it('notification（无 id）→ null 不回包', async () => {
    expect(await handleMcpMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, ctx())).toBeNull();
  });

  it('ping → 空对象；tools/list → 工具清单', async () => {
    const ping = (await handleMcpMessage({ jsonrpc: '2.0', id: 3, method: 'ping' }, ctx())) as JsonRpcResponse;
    expect(ping.result).toEqual({});
    const list = (await handleMcpMessage({ jsonrpc: '2.0', id: 4, method: 'tools/list' }, ctx())) as JsonRpcResponse;
    expect((list.result as { tools: Array<{ name: string }> }).tools[0].name).toBe('echo');
  });

  it('tools/call：转 callTool，回 text 内容块', async () => {
    const r = (await handleMcpMessage(
      { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'echo', arguments: { a: 1 } } },
      ctx()
    )) as JsonRpcResponse;
    const result = r.result as { content: Array<{ type: string; text: string }>; isError: boolean };
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.content[0].text)).toEqual({ name: 'echo', args: { a: 1 } });
  });

  it('tools/call：isError 透传；callTool 抛错 → -32603', async () => {
    const errCtx = ctx({ callTool: async () => ({ text: 'boom', isError: true }) });
    const r1 = (await handleMcpMessage(
      { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'echo', arguments: {} } },
      errCtx
    )) as JsonRpcResponse;
    expect((r1.result as { isError: boolean }).isError).toBe(true);

    const throwCtx = ctx({
      callTool: async () => {
        throw new Error('内部炸了');
      }
    });
    const r2 = (await handleMcpMessage(
      { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'echo' } },
      throwCtx
    )) as JsonRpcResponse;
    expect(r2.error?.code).toBe(-32603);
    expect(r2.error?.message).toContain('内部炸了');
  });

  it('tools/call 未知工具 / 缺 name → -32602', async () => {
    const r1 = (await handleMcpMessage(
      { jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'nope' } },
      ctx()
    )) as JsonRpcResponse;
    expect(r1.error?.code).toBe(-32602);
    const r2 = (await handleMcpMessage({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: {} }, ctx())) as JsonRpcResponse;
    expect(r2.error?.code).toBe(-32602);
  });

  it('未知方法 → -32601；未声明能力回空列表', async () => {
    const r = (await handleMcpMessage({ jsonrpc: '2.0', id: 10, method: 'wat/now' }, ctx())) as JsonRpcResponse;
    expect(r.error?.code).toBe(-32601);
    const res = (await handleMcpMessage({ jsonrpc: '2.0', id: 11, method: 'resources/list' }, ctx())) as JsonRpcResponse;
    expect((res.result as { resources: unknown[] }).resources).toEqual([]);
    const pr = (await handleMcpMessage({ jsonrpc: '2.0', id: 12, method: 'prompts/list' }, ctx())) as JsonRpcResponse;
    expect((pr.result as { prompts: unknown[] }).prompts).toEqual([]);
  });

  it('非法消息（非对象 / 有 id 无 method）→ -32600', async () => {
    const r1 = (await handleMcpMessage('nope', ctx())) as JsonRpcResponse;
    expect(r1.error?.code).toBe(-32600);
    const r2 = (await handleMcpMessage({ jsonrpc: '2.0', id: 13 }, ctx())) as JsonRpcResponse;
    expect(r2.error?.code).toBe(-32600);
  });
});

describe('handleMcpBody：单条 / 批量', () => {
  it('批量：混合请求与 notification，只回有 id 的', async () => {
    const out = (await handleMcpBody(
      [
        { jsonrpc: '2.0', id: 1, method: 'ping' },
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        { jsonrpc: '2.0', id: 2, method: 'tools/list' }
      ],
      ctx()
    )) as JsonRpcResponse[];
    expect(out).toHaveLength(2);
    expect(out.map((r) => r.id)).toEqual([1, 2]);
  });

  it('纯 notification 批量 → null（HTTP 202）；空数组 → -32600', async () => {
    expect(await handleMcpBody([{ jsonrpc: '2.0', method: 'notifications/initialized' }], ctx())).toBeNull();
    const r = (await handleMcpBody([], ctx())) as JsonRpcResponse;
    expect(r.error?.code).toBe(-32600);
  });
});
