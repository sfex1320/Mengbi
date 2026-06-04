/**
 * ComfyUI 工作流 IPC：导入校验（API 格式判定）+ 模板 CRUD。
 */
import { randomUUID } from 'node:crypto';
import { register, ok, err } from './helpers';
import { makeError } from '@shared/error';
import { detectFormat, parseApiWorkflow } from '../services/comfyui/parser';
import { recommendControls } from '../services/comfyui/autoRecommend';
import { getObjectInfo } from '../services/comfyui/client';
import { resolveComfyConnection } from './comfyuiConnection';
import { listTemplates, getTemplate, upsertTemplate, deleteTemplate } from '../services/comfyui/store';
import {
  ComfyuiImportSchema,
  ComfyuiTemplateUpsertSchema,
  ComfyuiWorkflowIdSchema
} from './schemas';
import type {
  ComfyApiWorkflow,
  ImportResult,
  WorkflowTemplate,
  InputControl,
  OutputControl,
  Binding,
  LoopConfig,
  UiLayout
} from '@shared/comfyui';

const NOT_API_MSG =
  '这不是 API 格式的工作流。请在 ComfyUI 中通过「保存（API 格式）」/ Save (API Format) 导出后再导入。';

// /object_info 较大（可能 MB 级），按 host 缓存一份；导入时尽力拉取（超时/未连接则跳过）。
// 加 2 小时 TTL：用户中途装了自定义节点 / 升级 ComfyUI 后，缓存过期会自动重拉；也可手动刷新。
const OBJECT_INFO_TTL = 2 * 60 * 60 * 1000;
let _objectInfoCache: { host: string; data: Record<string, unknown>; ts: number } | null = null;
async function getCachedObjectInfo(
  host: string,
  token: string | null
): Promise<Record<string, unknown> | null> {
  if (
    _objectInfoCache &&
    _objectInfoCache.host === host &&
    Date.now() - _objectInfoCache.ts < OBJECT_INFO_TTL
  ) {
    return _objectInfoCache.data;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const oi = await getObjectInfo(host, token, ctrl.signal);
    _objectInfoCache = { host, data: oi, ts: Date.now() };
    return oi;
  } catch {
    return null; // 未连接 / 超时 → 控件回退到文本，不阻塞导入
  } finally {
    clearTimeout(timer);
  }
}

export function registerComfyuiWorkflowHandlers(): void {
  register('api:comfyui:import', ComfyuiImportSchema, async (input) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(input.json);
    } catch (e) {
      return err(
        makeError('CONFIG_INVALID', `工作流 JSON 解析失败：${(e as Error).message}`, {
          severity: 'inline',
          hint: '检查是否复制了完整的 JSON'
        })
      );
    }
    const format = detectFormat(parsed);
    if (format === 'ui') {
      return err(
        makeError('CONFIG_INVALID', NOT_API_MSG, {
          severity: 'modal',
          hint: '需在 ComfyUI 设置里开启开发者模式（Dev Mode），才会出现「保存（API 格式）」导出项'
        })
      );
    }
    if (format === 'unknown') {
      return err(
        makeError('CONFIG_INVALID', '无法识别的工作流格式（既不是 API 格式，也不是常见 UI 格式）', {
          severity: 'modal',
          hint: '请确认导出的是 ComfyUI 的 API Format Workflow'
        })
      );
    }
    const workflow = parsed as ComfyApiWorkflow;
    const { host, token } = resolveComfyConnection();
    const objectInfo = await getCachedObjectInfo(host, token);
    const known = objectInfo ? new Set(Object.keys(objectInfo)) : undefined;
    const graph = parseApiWorkflow(workflow, known);
    const warnings: string[] = [];
    if (graph.nodes.length === 0) warnings.push('工作流里没有解析到任何节点');
    const unknownCount = graph.nodes.filter((n) => n.unknown).length;
    if (objectInfo && unknownCount > 0)
      warnings.push(`有 ${unknownCount} 个节点在当前 ComfyUI 里找不到（自定义/缺失节点），已标 ⚠`);
    const result: ImportResult = {
      format: 'api',
      graph,
      warnings,
      recommended: recommendControls(workflow, objectInfo)
    };
    return ok(result);
  });

  // 手动清 object_info 缓存（装了新自定义节点 / 升级 ComfyUI 后用）
  register('api:comfyui:refresh-object-info', null, async () => {
    _objectInfoCache = null;
    const { host, token } = resolveComfyConnection();
    const oi = await getCachedObjectInfo(host, token);
    return ok({ refreshed: !!oi, nodeTypes: oi ? Object.keys(oi).length : 0 });
  });

  register('api:comfyui:template:list', null, async () => ok(listTemplates()));

  register('api:comfyui:template:get', ComfyuiWorkflowIdSchema, async (input) => {
    const t = getTemplate(input.workflowId);
    if (!t)
      return err(makeError('FILE_NOT_FOUND', '工作流模板不存在', { severity: 'toast' }));
    return ok(t);
  });

  register('api:comfyui:template:upsert', ComfyuiTemplateUpsertSchema, async (input) => {
    // 校验内嵌的 workflow JSON 仍是 API 格式（防止存进坏数据）
    try {
      const parsed = JSON.parse(input.originalApiWorkflowJson);
      if (detectFormat(parsed) !== 'api') {
        return err(makeError('CONFIG_INVALID', NOT_API_MSG, { severity: 'modal' }));
      }
    } catch (e) {
      return err(
        makeError('CONFIG_INVALID', `workflow JSON 无效：${(e as Error).message}`, {
          severity: 'inline'
        })
      );
    }
    const now = new Date().toISOString();
    const existing = input.workflowId ? getTemplate(input.workflowId) : null;
    const tpl: WorkflowTemplate = {
      workflowId: input.workflowId ?? randomUUID(),
      name: input.name,
      typeTags: input.typeTags ?? [],
      originalApiWorkflowJson: input.originalApiWorkflowJson,
      objectInfoSnapshot: input.objectInfoSnapshot ?? existing?.objectInfoSnapshot ?? null,
      inputControls: (input.inputControls as InputControl[] | undefined) ?? existing?.inputControls ?? [],
      outputControls:
        (input.outputControls as OutputControl[] | undefined) ?? existing?.outputControls ?? [],
      bindings: (input.bindings as Binding[] | undefined) ?? existing?.bindings ?? [],
      loopConfig: (input.loopConfig as LoopConfig | null | undefined) ?? existing?.loopConfig ?? null,
      uiLayout: (input.uiLayout as UiLayout | null | undefined) ?? existing?.uiLayout ?? null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    upsertTemplate(tpl);
    return ok({ workflowId: tpl.workflowId });
  });

  register('api:comfyui:template:delete', ComfyuiWorkflowIdSchema, async (input) => {
    deleteTemplate(input.workflowId);
    return ok({ deleted: true });
  });
}
