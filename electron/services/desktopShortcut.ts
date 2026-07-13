import { app, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { logger } from './logger';

/**
 * 打包版首次启动：确保桌面有本程序的快捷方式。
 *
 * 为什么只处理一次（标记文件）：用户手动删掉快捷方式是明确意愿，
 * 若每次启动都检查会被反复重建，惹人烦。所以首启处理完（无论创建与否）
 * 就写 userData/desktop-shortcut-done.json，之后的启动直接跳过。
 */

// 与 electron-builder.yml 的 productName 保持一致（写死常量，不在运行时读 yml）
const PRODUCT_NAME = '梦笔';
const MARKER_FILE = 'desktop-shortcut-done.json';

/** 扫描桌面目录，判断是否已有指向当前 exe 的快捷方式（target 大小写不敏感比较）。 */
async function desktopHasShortcutToSelf(desktopDir: string, exeLower: string): Promise<boolean> {
  let entries: string[] = [];
  try {
    entries = await fs.promises.readdir(desktopDir);
  } catch {
    // 桌面目录读不了（重定向到离线网络盘等）→ 视为没有，走创建路径由其自行成败
    return false;
  }
  for (const name of entries) {
    if (!name.toLowerCase().endsWith('.lnk')) continue;
    try {
      // readShortcutLink 对单个损坏/异构 .lnk 会抛错——逐个 try/catch 跳过，绝不让一个坏文件中断扫描
      const link = shell.readShortcutLink(path.join(desktopDir, name));
      if (typeof link.target === 'string' && link.target.toLowerCase() === exeLower) {
        return true;
      }
    } catch {
      /* 跳过该 .lnk 继续扫 */
    }
  }
  return false;
}

/**
 * 首次启动时自动创建桌面快捷方式（仅 Windows 打包版）。
 * 在主窗口创建之后异步调用，整体 try/catch —— 快捷方式是锦上添花，任何失败都不影响启动。
 */
export async function ensureDesktopShortcutOnce(): Promise<void> {
  // dev 与非 Windows 一律跳过：dev 的 execPath 是 electron.exe，写快捷方式毫无意义还污染桌面
  if (process.platform !== 'win32' || !app.isPackaged) return;
  try {
    const markerPath = path.join(app.getPath('userData'), MARKER_FILE);
    // 标记存在 = 本机首启已处理过，之后不再检查（见文件头注释的「为什么」）
    if (fs.existsSync(markerPath)) return;

    const desktopDir = app.getPath('desktop');
    const exePath = process.execPath;
    const existed = await desktopHasShortcutToSelf(desktopDir, exePath.toLowerCase());

    let created = false;
    if (!existed) {
      const lnkPath = path.join(desktopDir, `${PRODUCT_NAME}.lnk`);
      created = shell.writeShortcutLink(lnkPath, 'create', {
        target: exePath,
        // cwd 指到 exe 所在目录：绿色版（zip 解压原地运行）依赖相对资源路径时不出岔子
        cwd: path.dirname(exePath),
        icon: exePath,
        iconIndex: 0,
        description: '梦笔（mengbi）绘画工具箱'
      });
      if (!created) {
        logger.warn('desktop-shortcut: writeShortcutLink 返回 false', lnkPath);
      }
    }

    // 无论创建与否都写标记：首启流程到此完结，后续启动零开销跳过
    await fs.promises.writeFile(
      markerPath,
      JSON.stringify({ done: true, existed, created, at: new Date().toISOString() }),
      'utf-8'
    );
  } catch (e) {
    logger.warn('desktop-shortcut: ensure failed', e instanceof Error ? e.message : String(e));
  }
}
