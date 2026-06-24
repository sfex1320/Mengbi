/**
 * 软件产物统一入库（2026-06-12）。
 *
 * 规则：软件产生的一切资料文件（插帧/缩放后的视频、矢量化 SVG、放大/修复后的图片…）
 * 全部 INSERT 进 images 表（资产库），与生成类产物（生图/视频生成）同等待遇。
 *
 * - file_path 存绝对路径、引用实际落盘位置（不复制文件——upscale/vec 输出在用户自选目录，
 *   复制会双占磁盘；资产库读取本就按绝对路径解析）
 * - kind=image → 同步生成缩略图；video/svg → thumbnail NULL
 *   （视频封面由渲染端 captureVideoPoster 抓帧后经 api:video:save-thumbnail 补；SVG 渲染端原生显示）
 * - 入库后向所有窗口推轻量信号 `gallery:changed`（300ms 去抖防批量刷库风暴），
 *   Manager 资产库与便携资产库监听它自动刷新
 *
 * 失败安全：入库失败只记日志，绝不让产物主流程（插帧/放大/矢量化）连坐失败。
 */
import { BrowserWindow } from 'electron';
import { getDb } from './db';
import { ensureThumbnail } from './thumbnail';
import { logger } from './logger';

export interface ProducedMediaInput {
  /** 产物文件的绝对路径（已落盘） */
  filePath: string;
  kind: 'image' | 'video' | 'svg';
  /** 资产库备注标记，如 `[interp] 24→60fps` / `[vec:vtracer]` */
  notes: string;
  /** 可选：写进 params_json 的对象（内部 JSON.stringify） */
  params?: Record<string, unknown>;
  /** 可选：提示词（如放大前源图的提示词，通常为空） */
  prompt?: string;
  /** 可选：模型/引擎名（如 realesrgan-x4plus / rife-v4.6） */
  model?: string;
}

let galleryChangedTimer: NodeJS.Timeout | null = null;

/** 向所有窗口广播「资产库内容有变」（300ms 去抖，批量产出只刷一次）。 */
export function broadcastGalleryChanged(): void {
  if (galleryChangedTimer) return;
  galleryChangedTimer = setTimeout(() => {
    galleryChangedTimer = null;
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send('gallery:changed');
    }
  }, 300);
}

/**
 * 把一个软件产物写进资产库。返回 imageId；失败返回 null（已记日志，不抛）。
 */
export async function insertProducedMedia(input: ProducedMediaInput): Promise<number | null> {
  try {
    let thumbPath: string | null = null;
    if (input.kind === 'image') {
      try {
        thumbPath = await ensureThumbnail(input.filePath);
      } catch {
        thumbPath = null; // 缩略图失败回退原图渲染，不挡入库
      }
    }
    const r = getDb()
      .prepare(
        `INSERT INTO images(task_id, file_path, thumbnail_path, prompt_positive, prompt_negative, model_used, params_json, notes, created_at)
         VALUES(NULL, ?, ?, ?, NULL, ?, ?, ?, ?)`
      )
      .run(
        input.filePath,
        thumbPath,
        input.prompt ?? '',
        input.model ?? null,
        input.params ? JSON.stringify(input.params) : null,
        input.notes,
        new Date().toISOString()
      );
    broadcastGalleryChanged();
    return Number(r.lastInsertRowid);
  } catch (e) {
    logger.warn(`[producedMedia] gallery insert failed (${input.filePath}): ${(e as Error).message}`);
    return null;
  }
}
