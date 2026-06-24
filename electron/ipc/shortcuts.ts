/**
 * 侧栏「外部软件 / 文件夹」快捷方式：启动外部软件 + 取软件系统图标。
 * 文件夹打开 / 选文件夹 / 选 exe 复用 storage 既有通道（api:storage:open-path / select / pick-file）。
 */
import { z } from 'zod';
import { app, shell } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { register, ok, err } from './helpers';
import { makeError } from '@shared/error';

export function registerShortcutsHandlers(): void {
  // 启动用户在侧栏配置的外部软件（PS / Illustrator / CDR …）。spawn 分离子进程，不阻塞主进程。
  register('api:shortcuts:launch-exe', z.object({ exePath: z.string().min(1) }), async (input) => {
    if (!fs.existsSync(input.exePath)) {
      return err(
        makeError('FILE_NOT_FOUND', '软件路径不存在（可能已移动或卸载），请重新设置该快捷方式', { severity: 'toast' })
      );
    }
    const ext = path.extname(input.exePath).toLowerCase();
    try {
      // .exe/.com → 直接 spawn（分离子进程、无外壳安全提示）；
      // .lnk 桌面快捷方式 / .bat / .url / 其它 → 走系统外壳默认动作
      // （shell.openPath 会解析 .lnk 指向的真实目标并启动；spawn 跑不了 .lnk）。
      if (ext === '.exe' || ext === '.com') {
        const child = spawn(input.exePath, [], { detached: true, stdio: 'ignore', windowsHide: false });
        child.on('error', () => undefined); // 异步 error（权限/损坏）吞掉避免 unhandled
        child.unref();
        return ok(true);
      }
      const msg = await shell.openPath(input.exePath);
      if (msg) return err(makeError('UNKNOWN', `无法启动：${msg}`, { severity: 'toast' }));
      return ok(true);
    } catch (e) {
      return err(makeError('UNKNOWN', `无法启动软件：${(e as Error).message}`, { severity: 'toast' }));
    }
  });

  // 用指定软件打开一个文件（拖图/文字到软件快捷方式 → 软件里编辑）。
  // shell.openPath 只能用「默认程序」打开，要用指定软件必须 spawn 带文件参数；.lnk 先解析真实目标。
  register(
    'api:shortcuts:open-with',
    z.object({ appPath: z.string().min(1), filePath: z.string().min(1) }),
    async (input) => {
      if (!fs.existsSync(input.filePath)) {
        return err(makeError('FILE_NOT_FOUND', '要打开的文件不存在', { severity: 'toast' }));
      }
      let exe = input.appPath;
      if (path.extname(input.appPath).toLowerCase() === '.lnk') {
        try {
          const link = shell.readShortcutLink(input.appPath);
          if (link.target && fs.existsSync(link.target)) exe = link.target;
        } catch {
          /* 解析失败 → 退回对 .lnk 本身 spawn（多半失败，但不崩） */
        }
      }
      if (!fs.existsSync(exe)) {
        return err(makeError('FILE_NOT_FOUND', '软件路径不存在（可能已移动或卸载）', { severity: 'toast' }));
      }
      try {
        const child = spawn(exe, [input.filePath], { detached: true, stdio: 'ignore', windowsHide: false });
        child.on('error', () => undefined);
        child.unref();
        return ok(true);
      } catch (e) {
        return err(makeError('UNKNOWN', `无法用该软件打开：${(e as Error).message}`, { severity: 'toast' }));
      }
    }
  );

  // 取某文件（exe）的系统图标 → dataURI，用于侧栏「软件图标变成该软件自己的图标」。失败返回 null（前端回退首字母）。
  register('api:shortcuts:get-file-icon', z.object({ filePath: z.string().min(1) }), async (input) => {
    // .lnk 快捷方式：解析出真实目标，取目标图标（比 .lnk 自带的带箭头通用图标更准）
    let iconTarget = input.filePath;
    if (path.extname(input.filePath).toLowerCase() === '.lnk') {
      try {
        const link = shell.readShortcutLink(input.filePath);
        if (link.target && fs.existsSync(link.target)) iconTarget = link.target;
      } catch {
        /* 非 Windows / 解析失败 → 退回对 .lnk 本身取图标 */
      }
    }
    let dataUri: string | null = null;
    try {
      const icon = await app.getFileIcon(iconTarget, { size: 'large' });
      if (icon && !icon.isEmpty()) dataUri = icon.toDataURL();
    } catch {
      dataUri = null;
    }
    return ok({ dataUri });
  });
}
