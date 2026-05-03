import { safeStorage } from 'electron';
import crypto from 'node:crypto';
import { logger, maskKey } from './logger';

/**
 * API Key 存取（v2：明文模式）。
 *
 * 历史版本曾用 Electron safeStorage / dev-fallback AES-GCM 加密落库，
 * 但用户反馈："关掉重新打开还要重新输入很烦"——decrypt 失败时返回空字符串
 * 导致 Key 看起来"丢失"。
 *
 * 当前策略：
 *   - 写入：直接存原文（无前缀）。
 *   - 读取：识别历史 `safe:` / `dev:` / 裸 base64 前缀以做兼容性回退；
 *           其它情况返回原文。
 *
 * 列名仍叫 `api_key_encrypted` 以避免一次性 schema 大改；语义上现在是"原文"。
 */

let cachedDevKey: Buffer | null = null;

function getDevKey(): Buffer {
  if (cachedDevKey) return cachedDevKey;
  const env = process.env.MENGBI_DEV_KEY;
  if (env && /^[0-9a-f]{32,}$/i.test(env)) {
    cachedDevKey = Buffer.from(env.slice(0, 64), 'hex');
  } else {
    cachedDevKey = crypto.scryptSync('mengbi-dev-fallback', 'mengbi-salt', 32);
  }
  return cachedDevKey;
}

/**
 * 落库：直接存原文。
 * 若日后想重新打开加密，只需在此处替换实现，而不动 IPC 层。
 */
export function encryptString(plain: string): string {
  return plain ?? '';
}

/**
 * 读取：兼容历史的 `safe:` / `dev:` / 裸 safeStorage base64 前缀；
 * 否则视为原文直接返回。
 */
export function decryptString(stored: string): string {
  if (!stored) return '';

  // 历史 dev: AES-GCM 包格式（iv 12B + tag 16B + ciphertext）
  if (stored.startsWith('dev:')) {
    try {
      const buf = Buffer.from(stored.slice(4), 'base64');
      const iv = buf.subarray(0, 12);
      const tag = buf.subarray(12, 28);
      const enc = buf.subarray(28);
      const decipher = crypto.createDecipheriv('aes-256-gcm', getDevKey(), iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
    } catch (e) {
      logger.warn('legacy dev: decrypt failed, returning empty', maskKey(stored));
      return '';
    }
  }

  // 历史 safe: Electron safeStorage 包
  if (stored.startsWith('safe:')) {
    try {
      const buf = Buffer.from(stored.slice(5), 'base64');
      return safeStorage.decryptString(buf);
    } catch (e) {
      logger.warn('legacy safe: decrypt failed, returning empty', maskKey(stored));
      return '';
    }
  }

  // 裸 base64（更早期的格式）：尝试解码；失败就视为原文
  if (/^[A-Za-z0-9+/=]+$/.test(stored) && stored.length > 60) {
    try {
      return safeStorage.decryptString(Buffer.from(stored, 'base64'));
    } catch {
      // 落到下面"原文"分支
    }
  }

  // 默认：原文
  return stored;
}
