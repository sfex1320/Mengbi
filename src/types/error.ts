/**
 * 跨进程错误模型。所有 IPC handler 必须返回 Result<T, AppError>，不要 throw。
 * 详见 ARCHITECTURE.md §7.
 */

export type ErrorSeverity = 'fatal' | 'modal' | 'toast' | 'inline' | 'silent';

export type AppErrorCode =
  | 'API_FAILED'
  | 'API_KEY_INVALID'
  | 'CONFIG_INVALID'
  | 'CONFIG_MISSING'
  | 'DB_ERROR'
  | 'NETWORK_TIMEOUT'
  | 'NETWORK_OFFLINE'
  | 'FILE_NOT_FOUND'
  | 'FILE_PERMISSION'
  | 'VALIDATION_FAILED'
  | 'NOT_IMPLEMENTED'
  | 'CANCELLED'
  | 'UNKNOWN';

export interface AppError {
  code: AppErrorCode;
  severity: ErrorSeverity;
  message: string;
  details?: unknown;
  hint?: string;
}

export type Result<T, E = AppError> =
  | { ok: true; data: T }
  | { ok: false; error: E };

export const ok = <T>(data: T): Result<T, never> => ({ ok: true, data });

export const err = (error: AppError): Result<never, AppError> => ({ ok: false, error });

export const makeError = (
  code: AppErrorCode,
  message: string,
  options: { severity?: ErrorSeverity; details?: unknown; hint?: string } = {}
): AppError => ({
  code,
  severity: options.severity ?? 'toast',
  message,
  details: options.details,
  hint: options.hint
});
