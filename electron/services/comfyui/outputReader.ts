/**
 * 从 /history 的 outputs 读结果。不写死 SaveImage —— 任何带 images/gifs 数组的输出节点都收。
 * 第一阶段抓图片（images）与视频/动图（gifs，按扩展名分流）。
 * 下载经 client.viewFile，落盘走 imageStore.saveImage（带 ext）。
 */
import path from 'node:path';
import { viewFile, type ComfyHistoryEntry, type ComfyViewRef } from './client';
import { saveImage } from '../imageStore';
import type { OutputFile } from '@shared/comfyui';

interface ViewItem {
  filename: string;
  subfolder?: string;
  type?: string;
}

function isViewItem(v: unknown): v is ViewItem {
  return !!v && typeof v === 'object' && typeof (v as ViewItem).filename === 'string';
}

const VIDEO_EXT = new Set(['mp4', 'webm', 'mov', 'mkv', 'avi']);
const AUDIO_EXT = new Set(['flac', 'mp3', 'wav', 'ogg', 'm4a']);

function kindForExt(ext: string): string {
  if (VIDEO_EXT.has(ext)) return 'video';
  if (AUDIO_EXT.has(ext)) return 'audio';
  return 'image';
}

export interface ReadOutputsCtx {
  host: string;
  token?: string | null;
  signal: AbortSignal;
  /** 文件名模板用的整型 id（编排器没有 generation_tasks.id，传一个稳定整数即可） */
  fileTaskId: number;
  prompt?: string;
  /** 输出限定：只读这些节点 id 的输出。空/未传 = 收取全部节点（向后兼容） */
  outputNodeIds?: string[];
}

/** 遍历 outputs，下载并落盘，返回 OutputFile[]。无任何文件产出时返回空数组（上层据此报 E13）。 */
export async function readOutputs(
  entry: ComfyHistoryEntry,
  ctx: ReadOutputsCtx
): Promise<OutputFile[]> {
  const results: OutputFile[] = [];
  const outputs = entry.outputs ?? {};
  const allowed = ctx.outputNodeIds && ctx.outputNodeIds.length ? new Set(ctx.outputNodeIds) : null;
  let seq = 1;

  for (const [nodeId, nodeOut] of Object.entries(outputs)) {
    if (allowed && !allowed.has(nodeId)) continue; // 输出限定：只收选中的节点
    if (!nodeOut || typeof nodeOut !== 'object') continue;
    for (const [key, value] of Object.entries(nodeOut)) {
      // 文本类输出（ShowText 等）：字符串数组 → 直接收文本
      if (key === 'text' || key === 'string') {
        const texts = Array.isArray(value) ? value : [value];
        for (const t of texts) {
          if (typeof t === 'string') results.push({ kind: 'text', text: t, nodeId });
        }
        continue;
      }
      // 文件类输出：images / gifs / audio / 其它带 filename 数组
      if (!Array.isArray(value)) continue;
      for (const item of value) {
        if (!isViewItem(item)) continue;
        const ref: ComfyViewRef = {
          filename: item.filename,
          subfolder: item.subfolder ?? '',
          type: item.type ?? 'output'
        };
        const buf = await viewFile(ctx.host, ref, ctx.token, ctx.signal);
        const ext = (path.extname(item.filename).slice(1) || 'png').toLowerCase();
        // kind 由扩展名决定（gif/webp/mp4 → kindForExt 内部已区分图片/动图/视频）
        const kind = kindForExt(ext);
        const fp = saveImage(
          buf,
          ctx.fileTaskId,
          seq++,
          { prompt: ctx.prompt, model: 'comfyui' },
          ext
        );
        results.push({ kind, path: fp, nodeId });
      }
    }
  }

  return results;
}
