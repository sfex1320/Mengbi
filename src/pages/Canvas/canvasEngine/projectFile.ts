import type { CanvasProject, Layer } from '../types';
import { localPathToImageUrl } from '@/lib/imageUrl';
import { useInpaintMaskStore } from '@/store/inpaintMaskStore';
import { useImageParamsStore, type RefImage } from '@/store/imageParamsStore';

/**
 * .mengbi-canvas 工程文件格式（v1）：
 *   - JSON，UTF-8
 *   - 顶层 manifest：{ format, version, project, embeddedImages }
 *   - embeddedImages：{ [layerId]: dataUri }，把原图（sourcePath 指向的本地文件）
 *     和 cookedDataUri 都内联为 dataUri，保证跨设备迁移可还原
 *
 * 加载时：
 *   - 把 embeddedImages 写入对应 layer.cookedDataUri（优先级高于 sourcePath）
 *   - sourcePath 字段保留但**仅供参考**：跨电脑后路径肯定无效
 */

const FORMAT = 'mengbi-canvas';
const VERSION = 2;

interface MengbiFile {
  format: string;
  version: number;
  project: Omit<CanvasProject, 'selectedId' | 'selectedIds'>;
  embeddedImages: Record<string, string>;
  /** v2：局部重绘蒙版栅格（dataUri，PNG） */
  inpaintMask?: string | null;
  /** v2：参考图（含类型/权重/标志） */
  references?: RefImage[];
}

export interface MengbiParseResult {
  project: CanvasProject;
  inpaintMask: string | null;
  references: RefImage[];
}

export async function exportProjectAsMengbi(project: CanvasProject): Promise<Blob> {
  const embeddedImages: Record<string, string> = {};
  for (const layer of project.layers) {
    // 内联原图：cookedDataUri 优先，没有就把 sourcePath 转 dataUri
    if (layer.cookedDataUri) {
      embeddedImages[layer.id] = layer.cookedDataUri;
    } else if (layer.sourcePath) {
      try {
        const url = localPathToImageUrl(layer.sourcePath);
        const blob = await (await fetch(url)).blob();
        const dataUri = await blobToDataUri(blob);
        embeddedImages[layer.id] = dataUri;
      } catch (e) {
        console.warn('[mengbi-canvas] embed source failed', layer.id, e);
      }
    }
  }

  // 局部重绘蒙版栅格（如有）
  let inpaintMask: string | null = null;
  const maskCanvas = useInpaintMaskStore.getState().canvas;
  if (maskCanvas) {
    try {
      inpaintMask = maskCanvas.toDataURL('image/png');
    } catch {
      inpaintMask = null;
    }
  }
  const references = useImageParamsStore.getState().refs;

  const data: MengbiFile = {
    format: FORMAT,
    version: VERSION,
    project: {
      id: project.id,
      name: project.name,
      width: project.width,
      height: project.height,
      background: project.background,
      layers: project.layers.map((l) => ({ ...l, cookedDataUri: null })),
      createdAt: project.createdAt,
      updatedAt: new Date().toISOString()
    },
    embeddedImages,
    inpaintMask,
    references
  };
  return new Blob([JSON.stringify(data, null, 0)], { type: 'application/json' });
}

export function parseMengbiFile(text: string): MengbiParseResult {
  let raw: MengbiFile;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('文件不是合法 JSON');
  }
  if (raw.format !== FORMAT) {
    throw new Error(`不是 mengbi-canvas 文件（format=${raw.format}）`);
  }
  if (raw.version > VERSION) {
    throw new Error(`文件版本 ${raw.version} 高于本应用支持的 ${VERSION}`);
  }
  const layers: Layer[] = raw.project.layers.map((l) => {
    const embedded = raw.embeddedImages[l.id];
    return {
      ...l,
      cookedDataUri: embedded ?? null
    };
  });
  return {
    project: {
      ...raw.project,
      layers,
      selectedId: null,
      selectedIds: []
    },
    inpaintMask: raw.inpaintMask ?? null,
    references: raw.references ?? []
  };
}

/** 把解析出的蒙版 dataUri 还原为蒙版画布并写入 inpaintMaskStore */
export function applyInpaintMaskFromDataUri(dataUri: string, width: number, height: number): void {
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = Math.max(1, width);
    c.height = Math.max(1, height);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    useInpaintMaskStore.getState().replaceCanvas(c);
  };
  img.src = dataUri;
}

function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
