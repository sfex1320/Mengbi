import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import type { ZodSchema } from 'zod';
import { ZodError } from 'zod';
import { logger } from '../services/logger';
import { makeError, ok, err, type Result, type AppError } from '@shared/error';

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
    try {
      const input = (schema ? schema.parse(raw) : raw) as TInput;
      const start = Date.now();
      const result = await handler(input, event);
      const ms = Date.now() - start;
      if (ms > 1000) {
        logger.debug(`ipc.${channel} took ${ms}ms`);
      }
      return result;
    } catch (e) {
      if (e instanceof ZodError) {
        logger.warn(`ipc.${channel} validation failed`, e.issues);
        return err(
          makeError('VALIDATION_FAILED', '提交的参数不合法，请检查后重试', {
            severity: 'inline',
            details: e.issues
          })
        );
      }
      const message = e instanceof Error ? e.message : String(e);
      logger.error(`ipc.${channel} threw`, e);
      return err(
        makeError('UNKNOWN', `未预期的错误：${message}`, {
          severity: 'modal',
          details: process.env.NODE_ENV !== 'production' ? message : undefined,
          hint: '请尝试重启应用，或导出诊断日志后反馈'
        })
      );
    }
  });
}

export { ok, err };
