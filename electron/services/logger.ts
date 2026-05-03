import log from 'electron-log/main.js';

/**
 * 日志策略详见 ENVIRONMENT.md §五。
 * - 通过 MENGBI_LOG_LEVEL 环境变量控制级别
 * - dev 默认 debug，prod 默认 info
 * - API Key / 用户图片永不记录
 */

const envLevel = (process.env.MENGBI_LOG_LEVEL ?? '').toLowerCase();
const isDev = !!process.env.ELECTRON_RENDERER_URL;

// electron-log 支持的级别。文档中"trace"会自动映射为"verbose"。
const validLevels = ['error', 'warn', 'info', 'verbose', 'debug', 'silly'] as const;
type LevelName = (typeof validLevels)[number];

const inputLevel = envLevel === 'trace' ? 'verbose' : envLevel;
const level: LevelName = validLevels.includes(inputLevel as LevelName)
  ? (inputLevel as LevelName)
  : isDev
  ? 'debug'
  : 'info';

log.transports.file.level = level;
log.transports.console.level = level;
log.transports.file.maxSize = 5 * 1024 * 1024;
log.transports.file.format =
  '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] [{processType}] {text}';

log.initialize();

/** 脱敏 API Key（仅显示前后 4 位）用于日志。 */
export function maskKey(key: string | null | undefined): string {
  if (!key) return '(empty)';
  if (key.length <= 8) return '*'.repeat(key.length);
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

export const logger = log;
