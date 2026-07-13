/**
 * Obsidian 资产库桥（api:vault:*）。
 *
 * 库 = 本地 Obsidian vault 文件夹（settings 键 obsidian_vault_path）。
 * 核心 fs 逻辑在 services/vaultStore.ts（与 MCP vault_* 工具共用），本文件只做
 * zod 校验 + Result 包装。「在 Obsidian 中打开」优先走 obsidian:// URI，
 * 未装 Obsidian 时回退系统默认程序。
 */

import { z } from 'zod';
import { shell } from 'electron';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { register, ok, err } from './helpers';
import { makeError } from '@shared/error';
import {
  getVaultPath,
  setVaultPath,
  vaultReady,
  listVaultFolders,
  searchVault,
  readVaultNote,
  exportVaultNote
} from '../services/vaultStore';

function vaultErr(e: unknown): ReturnType<typeof err> {
  return err(makeError('FILE_PERMISSION', (e as Error).message || 'Obsidian 库操作失败', { severity: 'toast' }));
}

export function registerVaultHandlers(): void {
  // 当前库状态
  register('api:vault:status', null, async () => {
    const vaultPath = getVaultPath();
    return ok({ vaultPath, exists: vaultPath !== '' && existsSync(vaultPath) });
  });

  // 设置库路径（选到不存在的目录直接报错，不静默收下）
  register(
    'api:vault:set-config',
    z.object({ vaultPath: z.string() }),
    async (input) => {
      const p = input.vaultPath.trim();
      if (p !== '' && !existsSync(p)) {
        return err(
          makeError('FILE_NOT_FOUND', `目录不存在或不可访问：${p}`, {
            severity: 'toast',
            hint: '确认盘符已挂载（如 S: 盘），再重新选择'
          })
        );
      }
      setVaultPath(p);
      return ok({ vaultPath: p, exists: p !== '' && existsSync(p) });
    }
  );

  // 库内文件夹列表（导出时选分类用）
  register('api:vault:folders', null, async () => {
    if (!vaultReady()) {
      return err(makeError('VALIDATION_FAILED', 'Obsidian 库路径未设置或不可访问', { severity: 'toast', hint: '到 设置 → 存储与系统 里选择库文件夹' }));
    }
    try {
      return ok({ folders: await listVaultFolders() });
    } catch (e) {
      return vaultErr(e);
    }
  });

  // 检索（query 空 = 最近修改的笔记）
  register(
    'api:vault:search',
    z.object({ query: z.string().max(200), limit: z.number().int().min(1).max(100).optional() }),
    async (input) => {
      if (!vaultReady()) {
        return err(makeError('VALIDATION_FAILED', 'Obsidian 库路径未设置或不可访问', { severity: 'toast', hint: '到 设置 → 存储与系统 里选择库文件夹' }));
      }
      try {
        return ok({ notes: await searchVault(input.query, input.limit ?? 30) });
      } catch (e) {
        return vaultErr(e);
      }
    }
  );

  // 读单篇笔记（raw 全文 + 剥 frontmatter 的正文）
  register(
    'api:vault:read',
    z.object({ path: z.string().min(1).max(500) }),
    async (input) => {
      try {
        return ok(await readVaultNote(input.path));
      } catch (e) {
        return vaultErr(e);
      }
    }
  );

  // 导出笔记（全库同名查重：有 → 追加补充小节；无 → 新建）
  register(
    'api:vault:export',
    z.object({
      title: z.string().min(1).max(120),
      content: z.string().min(1).max(200_000),
      folder: z.string().max(300).optional(),
      tags: z.array(z.string().max(40)).max(20).optional(),
      description: z.string().max(300).optional()
    }),
    async (input) => {
      try {
        return ok(await exportVaultNote(input));
      } catch (e) {
        return vaultErr(e);
      }
    }
  );

  // 在 Obsidian 中打开（obsidian:// URI；失败回退系统默认程序）
  register(
    'api:vault:open-note',
    z.object({ path: z.string().min(1).max(500) }),
    async (input) => {
      const root = getVaultPath();
      if (!root) {
        return err(makeError('VALIDATION_FAILED', 'Obsidian 库路径未设置', { severity: 'toast' }));
      }
      const abs = path.resolve(root, input.path);
      if (!abs.startsWith(path.resolve(root) + path.sep) || !existsSync(abs)) {
        return err(makeError('FILE_NOT_FOUND', '笔记不存在', { severity: 'toast' }));
      }
      try {
        await shell.openExternal(`obsidian://open?path=${encodeURIComponent(abs)}`);
        return ok(true as const);
      } catch {
        const errMsg = await shell.openPath(abs);
        if (errMsg) return err(makeError('FILE_NOT_FOUND', `打开失败：${errMsg}`, { severity: 'toast' }));
        return ok(true as const);
      }
    }
  );
}
