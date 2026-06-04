/**
 * Photoshop 联动桥（api:ps:*）。
 *
 * 这是画板模块第一个拥有主进程 IPC 的子系统（详见 CLAUDE.md §4.8 的架构变更说明）。
 * 职责：
 *   1. 把画板当前合成（dataUri）写到临时目录的 PNG 文件
 *   2. 用用户设置的 Photoshop 可执行文件打开它（未设置则交给系统默认程序）
 *   3. 用 fs.watchFile 轮询该临时文件的 mtime；用户在 PS 里 Ctrl+S 后推 `ps:file-changed`
 *   4. 渲染进程确认导回 → api:ps:read-back 把磁盘文件读回 dataUri
 *
 * 安全：read-back 只允许读“本桥自己创建并仍在跟踪”的临时路径，避免变成任意文件读取通道。
 *
 * 第一阶段仅支持 PNG 发送/导回（PS 可直接编辑 PNG 并 Ctrl+S 覆盖保存）。
 * TIFF / PSD 发送与 PSD 合成预览导回留待后续。
 */

import { z } from 'zod';
import { app, shell } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { existsSync, statSync, watchFile, unwatchFile } from 'node:fs';
import path from 'node:path';
import type { WebContents } from 'electron';
import { register, ok, err } from './helpers';
import { getDb } from '../services/db';
import { logger } from '../services/logger';
import { makeError } from '@shared/error';

// ─── 设置读写（复用 settings 表，不另起存储） ────────────────

const PREF_PS_PATH = 'photoshop_path';
const PREF_PS_TEMP_DIR = 'ps_temp_dir';
const PREF_PS_KEEP_TEMP = 'ps_keep_temp';

function getPref(key: string): string | null {
  const row = getDb().prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

function setPref(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO settings(key, value) VALUES(?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(key, value);
}

function getTempDir(): string {
  const custom = getPref(PREF_PS_TEMP_DIR);
  if (custom && custom.trim()) return custom;
  return path.join(app.getPath('userData'), 'ps-bridge');
}

function getKeepTemp(): boolean {
  return getPref(PREF_PS_KEEP_TEMP) === 'true';
}

// ─── 临时文件跟踪 + watcher 注册表 ──────────────────────────

interface WatchEntry {
  tempPath: string;
  baselineMtimeMs: number;
  sender: WebContents;
  listener: (curr: import('node:fs').Stats, prev: import('node:fs').Stats) => void;
}

const watches = new Map<string, WatchEntry>();
/** 本桥曾经创建过的临时路径（read-back 白名单） */
const knownTempPaths = new Set<string>();

const WATCH_INTERVAL_MS = 800;

function stopWatch(tempPath: string): void {
  const entry = watches.get(tempPath);
  if (!entry) return;
  unwatchFile(tempPath, entry.listener);
  watches.delete(tempPath);
}

function stopAllWatches(): void {
  for (const tempPath of [...watches.keys()]) stopWatch(tempPath);
}

/** 主进程退出 / 窗口销毁时清掉所有 watcher，避免 watchFile 拖住事件循环 */
app.on('before-quit', stopAllWatches);

// ─── dataUri 解码 ───────────────────────────────────────────

function decodePngDataUri(dataUri: string): Buffer | null {
  const m = dataUri.match(/^data:image\/[\w+.-]+;base64,(.*)$/);
  if (!m) return null;
  return Buffer.from(m[1], 'base64');
}

// ─── handlers ──────────────────────────────────────────────

export function registerPsHandlers(): void {
  // 当前桥状态：PS 路径、临时目录、是否保留临时文件、正在监听的文件
  register('api:ps:status', null, async () => {
    const psPath = getPref(PREF_PS_PATH) ?? '';
    return ok({
      photoshopPath: psPath,
      photoshopPathExists: psPath.trim() !== '' && existsSync(psPath),
      tempDir: getTempDir(),
      keepTemp: getKeepTemp(),
      watching: [...watches.keys()]
    });
  });

  // 更新桥配置（部分字段）
  register(
    'api:ps:set-config',
    z.object({
      photoshopPath: z.string().optional(),
      tempDir: z.string().optional(),
      keepTemp: z.boolean().optional()
    }),
    async (input) => {
      if (input.photoshopPath !== undefined) setPref(PREF_PS_PATH, input.photoshopPath.trim());
      if (input.tempDir !== undefined) setPref(PREF_PS_TEMP_DIR, input.tempDir.trim());
      if (input.keepTemp !== undefined) setPref(PREF_PS_KEEP_TEMP, input.keepTemp ? 'true' : 'false');
      return ok(true as const);
    }
  );

  // 发送当前画布到 Photoshop：写临时 PNG → 打开 → 开始监听
  register(
    'api:ps:send',
    z.object({
      dataUri: z.string().min(10),
      suggestedName: z.string().max(80).optional()
    }),
    async (input, event) => {
      const buf = decodePngDataUri(input.dataUri);
      if (!buf) {
        return err(makeError('VALIDATION_FAILED', '不是合法的 PNG dataUri', { severity: 'toast' }));
      }
      const dir = getTempDir();
      try {
        await fs.mkdir(dir, { recursive: true });
      } catch (e) {
        return err(
          makeError('FILE_PERMISSION', `无法创建临时目录：${(e as Error).message}`, {
            severity: 'toast'
          })
        );
      }
      const safeName = (input.suggestedName ?? 'canvas')
        .replace(/[^\w一-龥-]/g, '_')
        .slice(0, 40);
      const tempPath = path.join(dir, `${safeName}-${Date.now()}.png`);
      try {
        await fs.writeFile(tempPath, buf);
      } catch (e) {
        return err(
          makeError('FILE_PERMISSION', `写入临时文件失败：${(e as Error).message}`, {
            severity: 'toast'
          })
        );
      }

      // 打开：优先用配置的 Photoshop 可执行文件，否则交给系统默认程序
      const psPath = getPref(PREF_PS_PATH) ?? '';
      let openedWith: 'photoshop' | 'system' = 'system';
      if (psPath.trim() && existsSync(psPath)) {
        try {
          const child = spawn(psPath, [tempPath], { detached: true, stdio: 'ignore' });
          child.on('error', (e) => logger.warn('[ps] spawn photoshop error', e));
          child.unref();
          openedWith = 'photoshop';
        } catch (e) {
          logger.warn('[ps] spawn photoshop failed, fallback to system', e);
        }
      }
      if (openedWith === 'system') {
        const errMsg = await shell.openPath(tempPath);
        if (errMsg) {
          return err(
            makeError('FILE_NOT_FOUND', `打开临时文件失败：${errMsg}`, { severity: 'toast' })
          );
        }
      }

      // 启动监听（先停掉同路径旧 watcher，理论上不会重复）
      stopWatch(tempPath);
      let baselineMtimeMs = 0;
      try {
        baselineMtimeMs = statSync(tempPath).mtimeMs;
      } catch {
        /* ignore */
      }
      const sender = event.sender;
      const entry: WatchEntry = {
        tempPath,
        baselineMtimeMs,
        sender,
        listener: (curr) => {
          const e = watches.get(tempPath);
          if (!e) return;
          // 只在 mtime 真正前进且文件非空时认为是“用户保存”
          if (curr.size > 0 && curr.mtimeMs > e.baselineMtimeMs) {
            e.baselineMtimeMs = curr.mtimeMs;
            if (!sender.isDestroyed()) {
              sender.send('ps:file-changed', { tempPath, mtimeMs: curr.mtimeMs });
            }
          }
        }
      };
      watches.set(tempPath, entry);
      knownTempPaths.add(tempPath);
      watchFile(tempPath, { interval: WATCH_INTERVAL_MS }, entry.listener);

      logger.info('[ps] sent to photoshop', { tempPath, openedWith });
      return ok({ tempPath, openedWith });
    }
  );

  // 把 PS 保存后的临时文件读回 dataUri（仅限本桥跟踪过的路径）
  register(
    'api:ps:read-back',
    z.object({ tempPath: z.string().min(1) }),
    async (input) => {
      if (!knownTempPaths.has(input.tempPath)) {
        return err(
          makeError('VALIDATION_FAILED', '该文件不是由 PS 联动创建，拒绝读取', {
            severity: 'toast'
          })
        );
      }
      if (!existsSync(input.tempPath)) {
        return err(makeError('FILE_NOT_FOUND', '临时文件已不存在', { severity: 'toast' }));
      }
      try {
        const buf = await fs.readFile(input.tempPath);
        const dataUri = `data:image/png;base64,${buf.toString('base64')}`;
        return ok({ dataUri });
      } catch (e) {
        return err(
          makeError('FILE_PERMISSION', `读取失败：${(e as Error).message}`, { severity: 'toast' })
        );
      }
    }
  );

  // 停止监听（tempPath 省略 = 全部）；按设置决定是否删临时文件
  register(
    'api:ps:stop-watch',
    z.object({ tempPath: z.string().optional() }),
    async (input) => {
      const targets = input.tempPath ? [input.tempPath] : [...watches.keys()];
      for (const t of targets) {
        stopWatch(t);
        if (!getKeepTemp() && existsSync(t)) {
          try {
            await fs.unlink(t);
          } catch (e) {
            logger.warn('[ps] unlink temp failed', e);
          }
          knownTempPaths.delete(t);
        }
      }
      return ok(true as const);
    }
  );

  // 打开临时目录
  register('api:ps:open-temp-dir', null, async () => {
    const dir = getTempDir();
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch {
      /* ignore */
    }
    const errMsg = await shell.openPath(dir);
    if (errMsg) {
      return err(makeError('FILE_NOT_FOUND', `打开失败：${errMsg}`, { severity: 'toast' }));
    }
    return ok(true as const);
  });
}
