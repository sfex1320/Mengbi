/**
 * 图片/产物落盘：统一存储根目录解析、文件名模板、PNG 尺寸探测、写盘。
 *
 * 从 electron/ipc/generate.ts 抽出，供生图链路与 ComfyUI 编排器共用。
 * saveImage 在原签名基础上新增可选 ext 参数（默认 'png'），为后续视频/音频/文件输出预留。
 */
import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { getDb } from './db';
import {
  parseFilenameTemplate,
  applyFilenameTemplate,
  type FilenameContext
} from '@shared/filenameTemplate';

export interface SaveCtx {
  prompt?: string;
  model?: string;
  width?: number;
  height?: number;
  aspect?: string;
}

export function getStorageRoot(): string {
  const row = getDb()
    .prepare(`SELECT value FROM settings WHERE key='image_storage_path'`)
    .get() as { value: string } | undefined;
  if (row?.value) return row.value;
  return path.join(app.getPath('userData'), 'images');
}

function getFilenameTemplate(): ReturnType<typeof parseFilenameTemplate> {
  const row = getDb()
    .prepare(`SELECT value FROM settings WHERE key = 'image_filename_template'`)
    .get() as { value: string } | undefined;
  return parseFilenameTemplate(row?.value);
}

/** 直接读 PNG 头部 IHDR 拿宽高，避免引入 sharp 给 main 增体积 */
export function probePngSize(buf: Buffer): { w: number; h: number } | null {
  if (buf.length < 24) return null;
  if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) {
    return null;
  }
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  return { w, h };
}

/**
 * 把 buffer 按文件名模板写到 {storageRoot}/{date}/ 下，返回最终绝对路径。
 * @param ext 不含点的扩展名，默认 'png'（视频/音频输出可传 'mp4'/'webp'/'flac' 等）。
 */
export function saveImage(
  buf: Buffer,
  taskId: number,
  seq: number,
  ctx?: SaveCtx,
  ext: string = 'png'
): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const dir = path.join(getStorageRoot(), date);
  fs.mkdirSync(dir, { recursive: true });

  // 量一下图的真实尺寸（仅 PNG 能探测；其它格式由 ctx 提供或留 0）
  let realW = ctx?.width ?? 0;
  let realH = ctx?.height ?? 0;
  if ((!realW || !realH) && buf.length > 0 && ext === 'png') {
    try {
      const probed = probePngSize(buf);
      if (probed) {
        realW = probed.w;
        realH = probed.h;
      }
    } catch {
      /* ignore */
    }
  }

  const tpl = getFilenameTemplate();
  const fnCtx: FilenameContext = {
    taskId,
    seq,
    width: realW,
    height: realH,
    aspect: ctx?.aspect,
    prompt: ctx?.prompt,
    model: ctx?.model,
    createdAt: now
  };
  // 防御性兜底：把 Windows 非法文件名字符替成 _
  const base = applyFilenameTemplate(tpl, fnCtx).replace(/[\\/:*?"<>|]+/g, '_');
  const safeExt = ext.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'png';
  let final = path.join(dir, `${base}.${safeExt}`);
  let n = 2;
  while (fs.existsSync(final)) {
    final = path.join(dir, `${base}-${n++}.${safeExt}`);
    if (n > 999) break;
  }
  fs.writeFileSync(final, buf);
  return final;
}
