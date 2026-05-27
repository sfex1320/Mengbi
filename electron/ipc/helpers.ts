import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import { randomUUID } from 'node:crypto';
import type { ZodSchema } from 'zod';
import { ZodError } from 'zod';
import { logger } from '../services/logger';
import { makeError, ok, err, type Result, type AppError } from '@shared/error';
import type { NotificationAppendPayload } from '@shared/ipc';

/**
 * 写动作通道白名单——只有这些通道会被记入"通知中心"。
 * 读类（list/get/history/queue/status/...）噪音太大，一律不记。
 * 详见 plans/concurrent-soaring-puffin.md。
 */
const WRITE_CHANNELS: ReadonlySet<string> = new Set<string>([
  // chat
  'api:chat:send',
  'api:chat:create',
  'api:chat:rename',
  'api:chat:delete',
  'api:chat:clear-all',
  'api:chat:cancel',
  'api:chat:optimize-prompt',
  // image
  'api:image:generate',
  'api:image:cancel',
  'api:image:reorder',
  // gallery / prompt / album
  'api:gallery:update',
  'api:prompt:upsert',
  'api:prompt:delete',
  'api:album:upsert',
  // settings / plan
  'api:settings:save',
  'api:settings:test-connection',
  'api:plan:upsert',
  'api:plan:delete',
  'api:plan:config:delete',
  // lab
  'api:lab:reverse',
  'api:lab:translate',
  // storage / theme / export
  'api:storage:select',
  'api:storage:pick-images',
  'api:storage:save-temp-image',
  'api:storage:show-in-folder',
  'api:storage:open-path',
  'api:storage:save-as',
  'api:storage:open-url',
  'api:storage:scan-loras',
  'api:theme:save',
  'api:export:card',
  // tools box
  'api:tools:save-output',
  'api:gallery:import-from-buffer',
  // 图像转矢量(2 模式: vtracer / potrace) — AI + Pro 已于 2026-05-28 全砍除
  'api:vec:run-vtracer',
  'api:vec:run-potrace',
  'api:vec:run-batch',
  'api:vec:pause-batch',
  'api:vec:resume-batch',
  'api:vec:cancel-batch',
  'api:vec:cancel-task',
  'api:vec:history-clear',
  'api:vec:debug-open',
  // 放大引擎（Real-ESRGAN ncnn）
  'api:upscale:install-engine',
  'api:upscale:install-engine-from-zip',
  'api:upscale:remove-engine',
  'api:upscale:install-model',
  'api:upscale:import-local-model-files',
  'api:upscale:remove-model',
  'api:upscale:run-single',
  'api:upscale:run-batch',
  'api:upscale:cancel',
  // HYPIR Portable
  'api:hypir:set-portable-path',
  'api:hypir:bootstrap',
  'api:hypir:start-server',
  'api:hypir:stop-server',
  'api:hypir:submit-task',
  'api:hypir:cancel-task',
  // SUPIR Portable
  'api:supir:start-server',
  'api:supir:stop-server',
  'api:supir:submit-task',
  'api:supir:cancel-task',
  // 通用 AI 平台底座（未来新 AI 功能都用 api:ai-feature:* / api:ai-model:*）
  'api:ai-feature:bootstrap',
  'api:ai-feature:set-portable-path',
  'api:ai-feature:start',
  'api:ai-feature:stop',
  'api:ai-feature:install',
  'api:ai-feature:cancel-install',
  'api:ai-feature:unload-model',
  'api:ai-feature:cleanup-all',
  // config import / export
  'api:config:export',
  'api:config:import'
]);

/**
 * 向某个 webContents 推送一条通知中心条目。
 * - register() 包装层会在写通道命中时自动调用；
 * - 异步任务（image:done / chat:done）的旁路也用它。
 */
export function appendNotification(
  sender: WebContents,
  payload: Omit<NotificationAppendPayload, 'id' | 'ts'> & {
    id?: string;
    ts?: number;
  }
): void {
  if (sender.isDestroyed()) return;
  const full: NotificationAppendPayload = {
    id: payload.id ?? randomUUID(),
    ts: payload.ts ?? Date.now(),
    channel: payload.channel,
    kind: payload.kind,
    errorCode: payload.errorCode,
    severity: payload.severity,
    message: payload.message,
    hint: payload.hint,
    taskId: payload.taskId,
    refId: payload.refId
  };
  sender.send('notification:append', full);
}

/**
 * 包装 ipcMain.handle，让 handler 总是返回 Result<T, AppError>，
 * 不会因抛错把 IPC 调用变成 reject。
 *
 * 用法：
 *   register('api:foo:bar', InputSchema, async (input) => ok(await doStuff(input)))
 */
export function register<TInput, TOutput>(
  channel: string,
  schema: ZodSchema<TInput> | null,
  handler: (input: TInput, event: IpcMainInvokeEvent) => Promise<Result<TOutput, AppError>>
): void {
  ipcMain.handle(channel, async (event, raw): Promise<Result<TOutput, AppError>> => {
    let result: Result<TOutput, AppError>;
    try {
      const input = (schema ? schema.parse(raw) : raw) as TInput;
      const start = Date.now();
      result = await handler(input, event);
      const ms = Date.now() - start;
      if (ms > 1000) {
        logger.debug(`ipc.${channel} took ${ms}ms`);
      }
    } catch (e) {
      if (e instanceof ZodError) {
        logger.warn(`ipc.${channel} validation failed`, e.issues);
        result = err(
          makeError('VALIDATION_FAILED', '提交的参数不合法，请检查后重试', {
            severity: 'inline',
            details: e.issues
          })
        );
      } else {
        const message = e instanceof Error ? e.message : String(e);
        logger.error(`ipc.${channel} threw`, e);
        result = err(
          makeError('UNKNOWN', `未预期的错误：${message}`, {
            severity: 'modal',
            details: process.env.NODE_ENV !== 'production' ? message : undefined,
            hint: '请尝试重启应用，或导出诊断日志后反馈'
          })
        );
      }
    }

    // 仅"写动作"通道入通知中心
    if (WRITE_CHANNELS.has(channel)) {
      if (result.ok) {
        appendNotification(event.sender, {
          channel,
          kind: 'success'
        });
      } else {
        appendNotification(event.sender, {
          channel,
          kind: 'failure',
          errorCode: result.error.code,
          severity: result.error.severity,
          message: result.error.message,
          hint: result.error.hint
        });
      }
    }

    return result;
  });
}

export { ok, err };
