/**
 * MCP 工具注册表：声明 + 分发。
 *
 * 两类工具：
 *   1. 画布类（list_canvases / add_node / run_node …）——状态在渲染进程，
 *      经 canvasBridge 往返执行（渲染端实现在 src/lib/mcpCanvasBridge.ts）
 *   2. 直连类（vault_* / gallery_search）——主进程本地完成（fs / SQLite）
 *
 * 工具结果统一回 JSON 字符串文本块，方便智能体解析。
 */

import { getDb } from '../db';
import { searchVault, readVaultNote, exportVaultNote, vaultReady } from '../vaultStore';
import { requestCanvasTool } from './canvasBridge';
import type { McpToolDef, McpToolResult } from './mcpRpc';

const CANVAS_TOOLS: McpToolDef[] = [
  {
    name: 'list_node_kinds',
    description:
      '列出梦笔智能画布支持的全部节点类型（kind、名称、作用、可配参数、可接上下游）。搭建工作流前先调用它了解可用积木。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'list_canvases',
    description: '列出所有智能画布文档（id、标题、节点数、更新时间），并标出当前打开的画布。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'create_canvas',
    description: '新建一张智能画布并切换为当前画布，返回 docId。',
    inputSchema: {
      type: 'object',
      properties: { title: { type: 'string', description: '画布标题（可省略）' } },
      additionalProperties: false
    }
  },
  {
    name: 'open_canvas',
    description: '切换到指定画布（后续 add_node / run_node 等都作用于当前画布）。',
    inputSchema: {
      type: 'object',
      properties: { docId: { type: 'string' } },
      required: ['docId'],
      additionalProperties: false
    }
  },
  {
    name: 'read_canvas',
    description:
      '读取画布内容：全部节点（id、类型、关键参数、运行状态、结果文本摘要）与连线。省略 docId = 当前画布；给 docId 可读非活动画布。',
    inputSchema: {
      type: 'object',
      properties: { docId: { type: 'string' } },
      additionalProperties: false
    }
  },
  {
    name: 'add_node',
    description:
      '在当前画布新增一个节点，返回 nodeId。kind 必须来自 list_node_kinds；params 为该节点 data 的初始字段（如提示词节点 {"text":"..."}）。',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', description: '节点类型，如 prompt / work / llm / storyboard / character-card / video / result' },
        x: { type: 'number' },
        y: { type: 'number' },
        params: { type: 'object', description: '节点初始参数（浅合并进默认 data）' }
      },
      required: ['kind'],
      additionalProperties: false
    }
  },
  {
    name: 'set_node_params',
    description: '修改当前画布上某节点的参数（浅合并进节点 data），如改提示词文本、模型、尺寸等。',
    inputSchema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string' },
        params: { type: 'object' }
      },
      required: ['nodeId', 'params'],
      additionalProperties: false
    }
  },
  {
    name: 'connect_nodes',
    description:
      '在当前画布连接两个节点（上游 → 下游）。连线规则与 UI 手画一致，不合法会返回原因。多输出口节点可指定 sourceHandle（如角色卡下口 out-desc）。',
    inputSchema: {
      type: 'object',
      properties: {
        sourceId: { type: 'string' },
        targetId: { type: 'string' },
        sourceHandle: { type: 'string' },
        targetHandle: { type: 'string' }
      },
      required: ['sourceId', 'targetId'],
      additionalProperties: false
    }
  },
  {
    name: 'delete_node',
    description: '删除当前画布上的节点（连带其连线）。',
    inputSchema: {
      type: 'object',
      properties: { nodeId: { type: 'string' } },
      required: ['nodeId'],
      additionalProperties: false
    }
  },
  {
    name: 'run_node',
    description:
      '运行当前画布上的节点（自动先跑未完成的上游）。立即返回「已开始」；生图/视频等是异步任务，之后用 get_node_status 轮询结果。',
    inputSchema: {
      type: 'object',
      properties: { nodeId: { type: 'string' } },
      required: ['nodeId'],
      additionalProperties: false
    }
  },
  {
    name: 'run_all',
    description: '按拓扑序运行当前画布全部可运行节点。立即返回，之后用 read_canvas / get_node_status 查看进度。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'get_node_status',
    description: '查询当前画布上某节点的运行状态与结果（结果文本 / 产出图片数 / 错误信息）。',
    inputSchema: {
      type: 'object',
      properties: { nodeId: { type: 'string' } },
      required: ['nodeId'],
      additionalProperties: false
    }
  }
];

const DIRECT_TOOLS: McpToolDef[] = [
  {
    name: 'vault_search',
    description: '在用户的 Obsidian 资产库中检索笔记（文件名 + 全文），query 留空 = 最近修改的笔记。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'number', description: '默认 30，最大 100' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'vault_read',
    description: '读取 Obsidian 资产库中一篇笔记的全文（path 用 vault_search 返回的相对路径）。',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
      additionalProperties: false
    }
  },
  {
    name: 'vault_export',
    description:
      '把一段内容存入 Obsidian 资产库：全库同名查重，已有同名笔记则追加「补充」小节，否则在指定文件夹新建（自动带 frontmatter）。',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        content: { type: 'string' },
        folder: { type: 'string', description: '库内相对文件夹，如「设计参考」；省略 = 库根' },
        tags: { type: 'array', items: { type: 'string' } },
        description: { type: 'string' }
      },
      required: ['title', 'content'],
      additionalProperties: false
    }
  },
  {
    name: 'gallery_search',
    description: '检索梦笔资产库（图库）里的图片/视频：按提示词、标签、备注模糊匹配，返回路径与元数据。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'number', description: '默认 20，最大 50' }
      },
      additionalProperties: false
    }
  }
];

export const ALL_MCP_TOOLS: McpToolDef[] = [...CANVAS_TOOLS, ...DIRECT_TOOLS];

const CANVAS_TOOL_NAMES = new Set(CANVAS_TOOLS.map((t) => t.name));

function jsonResult(data: unknown): McpToolResult {
  return { text: JSON.stringify(data, null, 2) };
}

function errResult(message: string): McpToolResult {
  return { text: JSON.stringify({ error: message }), isError: true };
}

interface GalleryRow {
  id: number;
  file_path: string;
  prompt_positive: string | null;
  model_used: string | null;
  tags: string | null;
  rating: number;
  notes: string | null;
  created_at: string;
}

function gallerySearch(args: Record<string, unknown>): McpToolResult {
  const q = typeof args.query === 'string' ? args.query.trim() : '';
  const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 50);
  const like = `%${q}%`;
  const rows = (
    q
      ? getDb()
          .prepare(
            `SELECT id, file_path, prompt_positive, model_used, tags, rating, notes, created_at
             FROM images
             WHERE deleted_at IS NULL
               AND (prompt_positive LIKE ? OR tags LIKE ? OR notes LIKE ? OR model_used LIKE ?)
             ORDER BY created_at DESC LIMIT ?`
          )
          .all(like, like, like, like, limit)
      : getDb()
          .prepare(
            `SELECT id, file_path, prompt_positive, model_used, tags, rating, notes, created_at
             FROM images WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT ?`
          )
          .all(limit)
  ) as GalleryRow[];
  return jsonResult({
    total: rows.length,
    images: rows.map((r) => ({
      id: r.id,
      filePath: r.file_path,
      prompt: r.prompt_positive ?? '',
      model: r.model_used ?? '',
      tags: r.tags ? (JSON.parse(r.tags) as string[]) : [],
      rating: r.rating,
      notes: r.notes ?? '',
      createdAt: r.created_at
    }))
  });
}

/** MCP tools/call 统一入口（mcpServer 的 dispatch ctx 用） */
export async function callMcpTool(
  name: string,
  args: Record<string, unknown>
): Promise<McpToolResult> {
  // 画布类 → 渲染进程桥
  if (CANVAS_TOOL_NAMES.has(name)) {
    const r = await requestCanvasTool(name, args);
    if (r.error) return errResult(r.error);
    return jsonResult(r.result ?? { ok: true });
  }

  // 直连类
  try {
    switch (name) {
      case 'vault_search': {
        if (!vaultReady()) return errResult('Obsidian 库路径未设置或不可访问（到 梦笔设置 → 存储与系统 配置）');
        const q = typeof args.query === 'string' ? args.query : '';
        const limit = Math.min(Math.max(Number(args.limit) || 30, 1), 100);
        return jsonResult({ notes: await searchVault(q, limit) });
      }
      case 'vault_read': {
        const p = typeof args.path === 'string' ? args.path : '';
        if (!p) return errResult('缺少 path');
        return jsonResult(await readVaultNote(p));
      }
      case 'vault_export': {
        const title = typeof args.title === 'string' ? args.title : '';
        const content = typeof args.content === 'string' ? args.content : '';
        if (!title || !content) return errResult('缺少 title 或 content');
        return jsonResult(
          await exportVaultNote({
            title,
            content,
            folder: typeof args.folder === 'string' ? args.folder : undefined,
            tags: Array.isArray(args.tags) ? args.tags.filter((t): t is string => typeof t === 'string') : undefined,
            description: typeof args.description === 'string' ? args.description : undefined
          })
        );
      }
      case 'gallery_search':
        return gallerySearch(args);
      default:
        return errResult(`未知工具：${name}`);
    }
  } catch (e) {
    return errResult((e as Error).message || '工具执行失败');
  }
}
