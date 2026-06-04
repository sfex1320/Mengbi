/**
 * ComfyUI 运行 IPC：单次运行（入串行队列）、取消、队列状态、读运行记录。
 * 运行过程经 push 通道汇报：comfyui:run-progress / run-done / queue。
 */
import { randomUUID } from 'node:crypto';
import { register, ok, err } from './helpers';
import { makeError } from '@shared/error';
import { getComfyLauncher } from '../services/comfyui/launcher';
import { getRunQueue, nextFileTaskId, type QueuedRun } from '../services/comfyui/queue';
import { createRun, getRun, getTemplate, listRunsByBatch } from '../services/comfyui/store';
import { buildIterationPlan, LoopError } from '../services/comfyui/loopEngine';
import { resolveComfyConnection } from './comfyuiConnection';
import {
  ComfyuiRunSingleSchema,
  ComfyuiRunBatchSchema,
  ComfyuiCancelSchema,
  ComfyuiBatchIdSchema,
  ComfyuiRunIdSchema
} from './schemas';
import type {
  RunSingleResult,
  RunBatchResult,
  InputControl,
  Binding,
  LoopConfig
} from '@shared/comfyui';

/** 解析 workflowJson + controls + bindings（入参优先，否则取模板）。返回 null+错误信息。 */
function resolveWorkflow(input: {
  workflowId?: string;
  workflowJson?: string;
  controls?: unknown[];
  bindings?: unknown[];
}): { workflowJson: string; controls: InputControl[]; bindings: Binding[]; templateId: string | null } | { error: string } {
  let controls = (input.controls as InputControl[] | undefined) ?? [];
  let bindings = (input.bindings as Binding[] | undefined) ?? [];
  if (input.workflowId) {
    const tpl = getTemplate(input.workflowId);
    if (!tpl) return { error: '工作流模板不存在' };
    if (!input.controls) controls = tpl.inputControls;
    if (!input.bindings) bindings = tpl.bindings;
    return { workflowJson: tpl.originalApiWorkflowJson, controls, bindings, templateId: input.workflowId };
  }
  if (input.workflowJson) return { workflowJson: input.workflowJson, controls, bindings, templateId: null };
  return { error: '没有可运行的工作流' };
}

export function registerComfyuiRunHandlers(): void {
  register('api:comfyui:run-single', ComfyuiRunSingleSchema, async (input, event) => {
    const { host, token } = resolveComfyConnection();

    // 1. 连接检查
    const reachable = await getComfyLauncher().isReachable(host, token, 2000);
    if (!reachable) {
      return err(
        makeError('NETWORK_OFFLINE', `ComfyUI 未连接（${host}）`, {
          severity: 'toast',
          hint: '先在连接页检测/启动 ComfyUI'
        })
      );
    }

    // 2. 解析 workflow 来源 + 控件/绑定（入参优先；否则取模板里存的）
    let workflowJson: string;
    let controls = (input.controls as InputControl[] | undefined) ?? [];
    let bindings = (input.bindings as Binding[] | undefined) ?? [];
    const templateId = input.workflowId ?? null;
    if (input.workflowId) {
      const tpl = getTemplate(input.workflowId);
      if (!tpl)
        return err(makeError('FILE_NOT_FOUND', '工作流模板不存在', { severity: 'toast' }));
      workflowJson = tpl.originalApiWorkflowJson;
      if (!input.controls) controls = tpl.inputControls;
      if (!input.bindings) bindings = tpl.bindings;
    } else if (input.workflowJson) {
      workflowJson = input.workflowJson;
    } else {
      return err(makeError('CONFIG_MISSING', '没有可运行的工作流', { severity: 'toast' }));
    }

    // 3. 建运行记录 + 入队
    const runId = randomUUID();
    const batchId = randomUUID();
    const clientId = randomUUID();
    const controlValues = input.controlValues ?? {};

    createRun({
      runId,
      templateId,
      batchId,
      iterationIndex: 0,
      inputSnapshot: controlValues
    });

    getRunQueue().enqueue([
      {
        runId,
        batchId,
        iterationIndex: 0,
        templateId,
        host,
        token,
        clientId,
        workflowJson,
        controlValues,
        controls,
        bindings,
        outputNodeIds: input.outputNodeIds,
        fileTaskId: nextFileTaskId(),
        sender: event.sender
      }
    ]);

    const result: RunSingleResult = { runId, batchId };
    return ok(result);
  });

  register('api:comfyui:run-batch', ComfyuiRunBatchSchema, async (input, event) => {
    const { host, token } = resolveComfyConnection();
    const reachable = await getComfyLauncher().isReachable(host, token, 2000);
    if (!reachable)
      return err(
        makeError('NETWORK_OFFLINE', `ComfyUI 未连接（${host}）`, {
          severity: 'toast',
          hint: '先在连接页检测/启动 ComfyUI'
        })
      );

    const resolved = resolveWorkflow(input);
    if ('error' in resolved)
      return err(makeError('CONFIG_MISSING', resolved.error, { severity: 'toast' }));

    const loopConfig = input.loopConfig as LoopConfig;
    const base = input.controlValues ?? {};
    let plan;
    try {
      plan = buildIterationPlan(loopConfig, base);
    } catch (e) {
      const msg = e instanceof LoopError ? e.message : `循环配置错误：${(e as Error).message}`;
      return err(makeError('VALIDATION_FAILED', msg, { severity: 'modal' }));
    }
    if (plan.overlays.length === 0)
      return err(makeError('VALIDATION_FAILED', '循环展开后没有任务', { severity: 'toast' }));

    const batchId = randomUUID();
    const items: QueuedRun[] = plan.overlays.map((overlay, i) => {
      const runId = randomUUID();
      const merged = { ...base, ...overlay };
      createRun({
        runId,
        templateId: resolved.templateId,
        batchId,
        iterationIndex: i,
        inputSnapshot: merged,
        parameterSnapshot: overlay
      });
      return {
        runId,
        batchId,
        iterationIndex: i,
        templateId: resolved.templateId,
        host,
        token,
        clientId: randomUUID(),
        workflowJson: resolved.workflowJson,
        controlValues: merged,
        controls: resolved.controls,
        bindings: resolved.bindings,
        outputNodeIds: input.outputNodeIds,
        fileTaskId: nextFileTaskId(),
        sender: event.sender,
        feedbackToControlId: plan.feedback?.toControlId
      };
    });

    getRunQueue().enqueue(items, { continueOnFail: loopConfig.continueOnFail ?? true });
    const result: RunBatchResult = { batchId, plannedCount: items.length };
    return ok(result);
  });

  register('api:comfyui:cancel', ComfyuiCancelSchema, async (input) => {
    const r = getRunQueue().cancel(input);
    return ok(r);
  });

  register('api:comfyui:skip', ComfyuiRunIdSchema, async (input) => {
    getRunQueue().skip(input.runId);
    return ok({ skipped: true });
  });

  register('api:comfyui:pause', null, async () => {
    getRunQueue().pause();
    return ok({ paused: true });
  });

  register('api:comfyui:resume', null, async () => {
    getRunQueue().resume();
    return ok({ paused: false });
  });

  register('api:comfyui:run-status', ComfyuiBatchIdSchema, async (input) => {
    const live = getRunQueue().statusOf(input.batchId);
    if (live) return ok(live);
    // 队列里已无（重启或早完成）→ 从 DB 汇总
    const runs = listRunsByBatch(input.batchId);
    const counter = {
      total: runs.length,
      pending: runs.filter((r) => r.status === 'pending').length,
      running: runs.filter((r) => r.status === 'running').length,
      done: runs.filter((r) => r.status === 'done').length,
      failed: runs.filter((r) => r.status === 'failed' || r.status === 'cancelled').length
    };
    return ok(counter);
  });

  register('api:comfyui:results:get', ComfyuiRunIdSchema, async (input) => {
    const run = getRun(input.runId);
    if (!run) return err(makeError('FILE_NOT_FOUND', '运行记录不存在', { severity: 'toast' }));
    return ok(run);
  });
}
