/**
 * 单次执行引擎：clone 原始 workflow → (第一阶段)占位符替换 → 提交 → 跟踪进度 → 读输出。
 * 不污染模板：每次 structuredClone。失败抛 Error（消息已本地化），由队列层落库 + 推送。
 *
 * 第二阶段会把"占位符替换"换成 applyBindings 的字段级写入；这里先保留占位符通道，
 * 让用户用 {{prompt}}/{{seed}}/... 也能驱动。
 */
import fs from 'node:fs';
import path from 'node:path';
import { substitutePlaceholders } from './parser';
import { applyBindings, applyBypass } from './bindings';
import { submitPrompt, getHistory, uploadImage } from './client';
import { trackProgress } from './wsTracker';
import { readOutputs } from './outputReader';
import { addImagesToGallery } from './gallerySync';
import type { ComfyApiWorkflow, OutputFile, InputControl, Binding } from '@shared/comfyui';

/** 解析 data:URI → Buffer + 扩展名 */
function dataUriToBuffer(uri: string): { buf: Buffer; mime: string; ext: string } | null {
  const m = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(uri);
  if (!m) return null;
  const mime = m[1] || 'image/png';
  const isB64 = !!m[2];
  const data = m[3];
  // 坏 base64 / 畸形百分号编码会让 decodeURIComponent 抛 URIError；当作无法解析返回 null，
  // 调用方走既有的 null 分支，不把异常冒泡成整个 run 崩溃。
  let buf: Buffer;
  try {
    buf = isB64 ? Buffer.from(data, 'base64') : Buffer.from(decodeURIComponent(data), 'utf8');
  } catch {
    return null;
  }
  const ext = (mime.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '') || 'png';
  return { buf, mime, ext };
}

export interface RunIterationParams {
  host: string;
  token?: string | null;
  clientId: string;
  /** 原始 API workflow JSON 字符串（绝不被修改，这里 clone 后处理） */
  workflowJson: string;
  /** 输入控件值（控件 id → 值），经 applyBindings 写入真实节点字段 */
  controlValues: Record<string, unknown>;
  /** 输入控件定义（提供类型，用于强转/种子随机） */
  controls?: InputControl[];
  /** 绑定（parameter 等），把控件值写进节点字段 */
  bindings?: Binding[];
  /** 输出限定：只读这些节点 id 的输出（空/未传 = 全部） */
  outputNodeIds?: string[];
  fileTaskId: number;
  /** true=不把输出图同步进资产库（提示词商城缩略图生成走 ComfyUI 时用，避免缩略图污染图库） */
  skipGallery?: boolean;
  /** 入库分组名（资产库文件夹）——智能画布出图归入以画布名命名的文件夹 */
  galleryGroup?: string | null;
  signal: AbortSignal;
  onPromptId?: (promptId: string) => void;
  onUploaded?: (map: Record<string, string>) => void;
  onProgress: (p: {
    phase: string;
    percent: number;
    currentNode?: string | null;
    perNode?: Record<string, { value: number; max: number }>;
    queueRemaining?: number;
  }) => void;
}

export async function runIteration(params: RunIterationParams): Promise<OutputFile[]> {
  let workflow: ComfyApiWorkflow;
  try {
    workflow = JSON.parse(params.workflowJson) as ComfyApiWorkflow;
  } catch (e) {
    throw new Error(`workflow JSON 解析失败：${(e as Error).message}`);
  }

  const cv = params.controlValues ?? {};
  const controls = params.controls ?? [];
  const bindings = params.bindings ?? [];

  // 0) 先上传 file_upload 绑定的图片/遮罩，拿到 ComfyUI 的文件名
  const uploadedFileMap: Record<string, string> = {};
  const fileBindings = bindings.filter((b) => b.mode === 'file_upload');
  if (fileBindings.length > 0) {
    params.onProgress({ phase: 'submitting', percent: 3 });
    for (const b of fileBindings) {
      if (b.mode !== 'file_upload') continue;
      const raw = cv[b.controlId];
      const val = Array.isArray(raw) ? raw[0] : raw; // 第一阶段单图；多图后续
      if (typeof val !== 'string' || !val) continue;
      const safeId = b.controlId.replace(/[^a-z0-9]/gi, '_');
      if (val.startsWith('data:')) {
        const dec = dataUriToBuffer(val);
        if (!dec) continue;
        const up = await uploadImage(
          params.host,
          dec.buf,
          `mengbi_${safeId}.${dec.ext}`,
          { type: 'input', overwrite: true, mime: dec.mime },
          params.token,
          params.signal
        );
        uploadedFileMap[b.controlId] = up.name;
      } else if (/[\\/]/.test(val) && fs.existsSync(val)) {
        // 本地文件路径（如 feedback 回灌的上一轮输出）→ 读盘上传
        const buf = await fs.promises.readFile(val);
        const ext = (path.extname(val).slice(1) || 'png').toLowerCase();
        const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png';
        const up = await uploadImage(
          params.host,
          buf,
          `mengbi_${safeId}.${ext}`,
          { type: 'input', overwrite: true, mime },
          params.token,
          params.signal
        );
        uploadedFileMap[b.controlId] = up.name;
      } else {
        // 已经是 ComfyUI input 目录里的文件名，直接用
        uploadedFileMap[b.controlId] = val;
      }
    }
    if (Object.keys(uploadedFileMap).length > 0) params.onUploaded?.(uploadedFileMap);
  }

  // 1) 字段级绑定写入（提示词/种子/步数… + 上传后的文件名）。applyBindings 内部 structuredClone。
  const bound = applyBindings(workflow, controls, bindings, cv, uploadedFileMap);

  // 2) 占位符兜底：若工作流里还写了 {{prompt}}/{{seed}} 等，一并替换（向后兼容）
  const seedRaw =
    typeof cv.seed === 'number' && cv.seed >= 0
      ? (cv.seed as number)
      : Math.floor(Math.random() * 2_000_000_000);
  const variables: Record<string, string | number> = {
    prompt: typeof cv.prompt === 'string' ? cv.prompt : '',
    negative_prompt: typeof cv.negative === 'string' ? (cv.negative as string) : '',
    seed: seedRaw,
    batch_size: typeof cv.batch_size === 'number' ? cv.batch_size : 1,
    width: typeof cv.width === 'number' ? cv.width : 1024,
    height: typeof cv.height === 'number' ? cv.height : 1024
  };
  const filled = substitutePlaceholders(bound, variables) as ComfyApiWorkflow;

  // 3) 节点忽略/绕过：把 bypass 绑定的节点从执行图摘除（passthrough 到下游）
  const bypassIds = new Set(
    bindings.filter((b): b is Extract<Binding, { mode: 'bypass' }> => b.mode === 'bypass').map((b) => b.nodeId)
  );
  const finalWorkflow = applyBypass(filled, bypassIds);

  params.onProgress({ phase: 'submitting', percent: 5 });
  const { promptId } = await submitPrompt(
    params.host,
    finalWorkflow,
    params.clientId,
    params.token,
    params.signal
  );
  params.onPromptId?.(promptId);

  await trackProgress({
    host: params.host,
    token: params.token,
    clientId: params.clientId,
    promptId,
    signal: params.signal,
    onProgress: params.onProgress
  });

  // 权威结果以 /history 为准
  const entry = await getHistory(params.host, promptId, params.token, params.signal);
  if (!entry) throw new Error('执行完成但拿不到 /history 记录（promptId 未在历史中）');

  params.onProgress({ phase: 'downloading', percent: 94 });
  const outputs = await readOutputs(entry, {
    host: params.host,
    token: params.token,
    signal: params.signal,
    fileTaskId: params.fileTaskId,
    prompt: variables.prompt as string,
    outputNodeIds: params.outputNodeIds
  });
  if (outputs.length === 0) {
    if (params.outputNodeIds && params.outputNodeIds.length) {
      throw new Error(
        `工作流执行完成，但你限定的输出节点（#${params.outputNodeIds.join('、#')}）没有产出文件。请确认所选节点是输出节点（如 SaveImage），或取消输出限定`
      );
    }
    throw new Error('工作流执行完成但没有任何输出节点产出文件，请检查输出节点（如 SaveImage）是否在工作流里');
  }

  // 自动同步输出图到资产库（params 里剔除 data:URI，避免把大图塞进 params_json）。
  // skipGallery=true（提示词商城缩略图生成）则不入库——缩略图不进资产库。
  if (!params.skipGallery) {
    try {
      const slim: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(cv)) {
        if (!(typeof v === 'string' && v.startsWith('data:'))) slim[k] = v;
      }
      await addImagesToGallery(outputs, {
        prompt: (variables.prompt as string) || null,
        paramsJson: JSON.stringify(slim),
        groupName: params.galleryGroup ?? null
      });
    } catch {
      /* 入库失败不影响出图返回 */
    }
  }

  params.onProgress({ phase: 'done', percent: 100 });
  return outputs;
}
