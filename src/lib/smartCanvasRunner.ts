/**
 * 智能画布运行引擎（canvasRunner）：收集上游图片/提示词 → 按 provider 分发执行 → 写回结果。
 *  - provider='mengbi' + 真实工作类型（生成/编辑/风格/扩图）→ 复用 api:image:generate + image:done
 *  - provider='mengbi' + 放大/视频/批量 → 暂无真实接口，走 mock（留 TODO 接缝）
 *  - provider='mock'（Local Mock）→ 始终 mock，产出清晰的占位结果
 * 以后接更多真实后端（api:upscale / 视频 / ComfyUI）只改本文件的分发层，不动 UI。
 */
import type { Node, Edge } from '@xyflow/react';
import { useSmartCanvasStore, useSmartRunStore, useSmartResultStore } from '@/store/smartCanvasStore';
import { useSmartDocsStore } from '@/store/smartDocsStore';
import { readDocDoc, patchDocNodes } from '@/lib/smartDocStorage';
import { useSettingsStore } from '@/store/settingsStore';
import { diagnoseChatModel } from './modelMapping';
import { toast } from '@/store/toastStore';
import { localPathToImageUrl } from '@/lib/imageUrl';
import {
  REAL_WORK_TYPES,
  WORK_TYPE_LABELS,
  RUN_MODE_LABELS,
  PROVIDER_LABELS,
  LLM_OP_LABELS,
  type WorkNodeData,
  type ImageNodeData,
  type PromptNodeData,
  type ResultNodeData,
  type WorkResult,
  type InputRef,
  type LlmNodeData,
  type LlmOp,
  type ComfyNodeData,
  type AnglePromptNodeData,
  type ScaleNodeData,
  type ChatMsg,
  type SmartNodeData
} from '@shared/smartCanvas';
import type { OutputFile, InputControl } from '@shared/comfyui';

/** 第一个可用绘画模型显示名（复用 settingsStore 配置；排除 ComfyUI） */
export function firstImageModel(): string {
  const { configs } = useSettingsStore.getState();
  for (const c of configs) {
    if (c.type !== 'image' || c.image_kind === 'comfyui') continue;
    const names = Object.keys(c.model_mapping);
    if (names.length) return names[0];
  }
  return '';
}

interface CollectedInputs {
  images: string[];
  prompts: string[];
  refs: InputRef[];
}

/**
 * 沿连线向上游收集图片(src)与提示词(text)；group 节点透传其上游；附带 inputRefs 快照。
 * 纯函数（传入 nodes/edges），既给运行用，也给工作节点「实时预览上游」用。
 */
/**
 * 收集「某节点自身的产出」（图片/文本）到 images/prompts/refs，不沿连线遍历。
 * 用于分组子节点的内容识别：分组能识别归入其中的 图片/提示词/LLM/视角/缩放/生成/ComfyUI/结果 节点的内容。
 */
function collectOwnOutput(n: Node, images: string[], prompts: string[], refs: InputRef[]): void {
  const pushText = (t: string | undefined, from: string): void => {
    const tt = t?.trim();
    if (tt) {
      prompts.push(tt);
      refs.push({ kind: 'prompt', from, preview: tt.slice(0, 40) });
    }
  };
  switch (n.type) {
    case 'image': {
      const im = n.data as unknown as ImageNodeData;
      if (im.src) {
        images.push(im.src);
        refs.push({ kind: 'image', from: n.id, preview: im.name ?? '图片' });
      }
      break;
    }
    case 'prompt':
      pushText((n.data as unknown as PromptNodeData).text, n.id);
      break;
    case 'llm':
      pushText((n.data as unknown as LlmNodeData).resultText, n.id);
      break;
    case 'angle-prompt':
      pushText((n.data as unknown as AnglePromptNodeData).generatedPrompt, n.id);
      break;
    case 'scale': {
      const out = (n.data as unknown as ScaleNodeData).outputImage;
      if (out) {
        images.push(out);
        refs.push({ kind: 'image', from: n.id, preview: '缩放图' });
      }
      break;
    }
    case 'work':
    case 'comfy':
    case 'result': {
      const r = (n.data as unknown as { result?: WorkResult }).result;
      if (r?.images?.length) {
        images.push(...r.images);
        refs.push({ kind: 'result', from: n.id, preview: r.summary?.slice(0, 40) });
      }
      if (r?.texts?.length) for (const t of r.texts) pushText(t, n.id);
      break;
    }
  }
}

export function computeUpstream(nodes: Node[], edges: Edge[], workId: string): CollectedInputs {
  const images: string[] = [];
  const prompts: string[] = [];
  const refs: InputRef[] = [];
  const visited = new Set<string>();
  const walk = (targetId: string): void => {
    for (const e of edges.filter((x) => x.target === targetId)) {
      const sid = e.source;
      if (visited.has(sid)) continue;
      visited.add(sid);
      const n = nodes.find((x) => x.id === sid);
      if (!n) continue;
      if (n.type === 'image') {
        const im = n.data as unknown as ImageNodeData;
        if (im.src) {
          images.push(im.src);
          refs.push({ kind: 'image', from: n.id, preview: im.name ?? '图片' });
        }
      } else if (n.type === 'prompt') {
        const t = (n.data as unknown as PromptNodeData).text?.trim();
        if (t) {
          prompts.push(t);
          refs.push({ kind: 'prompt', from: n.id, preview: t.slice(0, 40) });
        }
      } else if (n.type === 'group') {
        walk(n.id); // 透传分组的「连线上游」
        // 分组容器化：归入该分组的子节点按「卡片顺序」（上→下、左→右）依次结合为前段→后段
        const children = nodes
          .filter((c) => c.parentId === n.id)
          .slice()
          .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
        // 归入分组的子节点：识别每个子节点自身的产出（含结果/生成/ComfyUI/LLM/视角/缩放的内容）
        for (const child of children) collectOwnOutput(child, images, prompts, refs);
      } else if (n.type === 'result') {
        // 结果节点现在也能作上游来源：图片喂图、文本喂提示词（统一集合的最近一次结果）
        const r = (n.data as unknown as ResultNodeData).result;
        if (r?.images?.length) {
          images.push(...r.images);
          refs.push({ kind: 'result', from: n.id, preview: r.summary?.slice(0, 40) });
        }
        if (r?.texts?.length) {
          for (const t of r.texts) {
            const tt = t.trim();
            if (tt) {
              prompts.push(tt);
              refs.push({ kind: 'prompt', from: n.id, preview: tt.slice(0, 40) });
            }
          }
        }
      } else if (n.type === 'work') {
        const r = (n.data as unknown as WorkNodeData).result;
        if (r?.images?.length) {
          images.push(...r.images);
          refs.push({ kind: 'result', from: n.id, preview: r.summary?.slice(0, 40) });
        }
      } else if (n.type === 'llm') {
        // LLM 节点的文本输出当作上游提示词
        const t = (n.data as unknown as LlmNodeData).resultText?.trim();
        if (t) {
          prompts.push(t);
          refs.push({ kind: 'prompt', from: n.id, preview: t.slice(0, 40) });
        }
      } else if (n.type === 'angle-prompt') {
        // 视角提示词节点的输出当作上游提示词
        const t = (n.data as unknown as AnglePromptNodeData).generatedPrompt?.trim();
        if (t) {
          prompts.push(t);
          refs.push({ kind: 'prompt', from: n.id, preview: t.slice(0, 40) });
        }
      } else if (n.type === 'comfy') {
        const r = (n.data as unknown as ComfyNodeData).result;
        if (r?.images?.length) {
          images.push(...r.images);
          refs.push({ kind: 'result', from: n.id, preview: r.summary?.slice(0, 40) });
        }
        // ComfyUI 工作流的文本输出（ShowText/string 等）当作上游提示词
        if (r?.texts?.length) {
          for (const t of r.texts) {
            const tt = t.trim();
            if (tt) {
              prompts.push(tt);
              refs.push({ kind: 'prompt', from: n.id, preview: tt.slice(0, 40) });
            }
          }
        }
      } else if (n.type === 'scale') {
        // 缩放节点输出（预处理后的图）当作上游图片
        const out = (n.data as unknown as ScaleNodeData).outputImage;
        if (out) {
          images.push(out);
          refs.push({ kind: 'image', from: n.id, preview: '缩放图' });
        }
      }
    }
  };
  walk(workId);
  return { images, prompts, refs };
}

function collectInputs(workId: string): CollectedInputs {
  const st = useSmartCanvasStore.getState();
  return computeUpstream(st.nodes, st.edges, workId);
}

// 常用比例（label, 数值宽高比）；图片编辑「自动」比例时把输入图比例吸附到最近一个
const COMMON_ASPECTS: Array<[string, number]> = [
  ['1:1', 1],
  ['3:2', 1.5],
  ['2:3', 2 / 3],
  ['4:3', 4 / 3],
  ['3:4', 3 / 4],
  ['16:9', 16 / 9],
  ['9:16', 9 / 16],
  ['21:9', 21 / 9]
];
/** 量一张图的自然比例 → 最近的常用比例字符串（对数距离更贴近感知）。失败返回 undefined。 */
function measureAspect(src: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      if (!img.naturalWidth || !img.naturalHeight) return resolve(undefined);
      const ratio = img.naturalWidth / img.naturalHeight;
      let best = COMMON_ASPECTS[0][0];
      let bestD = Infinity;
      for (const [label, r] of COMMON_ASPECTS) {
        const d = Math.abs(Math.log(ratio / r));
        if (d < bestD) {
          bestD = d;
          best = label;
        }
      }
      resolve(best);
    };
    img.onerror = () => resolve(undefined);
    img.src = src.startsWith('data:') ? src : localPathToImageUrl(src);
  });
}

function effectivePrompt(d: WorkNodeData, prompts: string[]): string {
  const merged = [d.prompt.trim(), ...prompts].filter(Boolean).join('\n');
  if (merged) return merged;
  if (d.workType === 'style-transfer') return '迁移参考图的风格，保持主体结构';
  if (d.workType === 'outpainting') return '把画面向外自然延伸，无缝衔接';
  if (d.workType === 'image-edit') return '按参考图微调画面';
  return '';
}

/** Local Mock / 暂无真实后端的工作类型：产出清晰可读的模拟结果（占位图 + 日志 + 参数回显）。 */
function mockRunWorkNode(d: WorkNodeData, inputs: CollectedInputs, note?: string): WorkResult {
  const wl = WORK_TYPE_LABELS[d.workType];
  const model = d.provider === 'mock' ? 'Local Mock' : d.modelId || '(未选模型)';
  const logs = [
    `[模拟] 工作类型=${wl} · 运行方式=${RUN_MODE_LABELS[d.runMode]} · provider=${PROVIDER_LABELS[d.provider]} · 模型=${model}`,
    `[模拟] 上游输入：图片 ${inputs.images.length} 张 · 提示词 ${inputs.prompts.length} 条`,
    d.prompt.trim() ? `[模拟] 提示词：${d.prompt.trim().slice(0, 80)}` : '[模拟] 无显式提示词',
    note ?? '[模拟] Local Mock 占位结果'
  ];
  // 放大：把上游图原样回显作占位；其余无图
  const out = d.workType === 'upscale' ? inputs.images.slice(0, 1) : [];
  return {
    ok: true,
    summary: `[模拟] ${wl} 完成（占位结果，未调用真实后端）。`,
    images: out,
    logs,
    workType: d.workType,
    runMode: d.runMode,
    provider: d.provider,
    model,
    simulated: true
  };
}

// 进行中：image taskId → resolver（awaitable 单次生成，支持真实 batch/loop 多轮）
const pendingWork = new Map<number, (p: ImageDonePayload) => void>();
// 被用户取消的工作节点 id：runWorkNode 在生成返回后据此提前收尾，不写结果（cancelWork 已把节点重置 idle）
const cancelledWork = new Set<string>();
interface ImageDonePayload {
  taskId: number;
  paths?: string[];
  cancelled?: boolean;
  error?: string;
}

function setWork(id: string, patch: Partial<WorkNodeData>): void {
  useSmartCanvasStore.getState().updateNodeData(id, patch as Partial<SmartNodeData>);
}

function isCascade(d: WorkNodeData): boolean {
  return d.runMode === 'continue-from-connections' || d.runMode === 'serial';
}

function clampN(x: number | undefined): number {
  return Math.max(1, Math.min(4, x || 1));
}

/** 单次生成：提交 + 等 image:done（awaitable）。结果只回该次 taskId 的图。
 *  onTask：拿到任务 id 后回调（把 taskId 记到节点上，让用户能「取消」释放队列槽）。 */
function generateOnce(
  modelId: string,
  prompt: string,
  params: Record<string, unknown>,
  refs: string[],
  negativePrompt?: string,
  onTask?: (taskId: number) => void
): Promise<{ images: string[]; error?: string }> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: { images: string[]; error?: string }): void => {
      if (done) return;
      done = true;
      resolve(v);
    };
    void window.electronAPI.image
      .generate({
        modelId,
        positivePrompt: prompt || ' ',
        negativePrompt: negativePrompt || undefined,
        params,
        referenceImages: refs.length ? refs : undefined
      })
      .then((r) => {
        if (!r.ok) {
          finish({ images: [], error: r.error.message });
          return;
        }
        const taskId = r.data.taskId;
        onTask?.(taskId);
        // 超时兜底：320s 还没等到 image:done 就放弃，清理 pending，避免节点永远卡 running
        // （拥挤模型出图慢，曾出现 180s 超时后后台才回结果被丢弃，故放宽到 320s）
        const timer = setTimeout(() => {
          if (pendingWork.has(taskId)) {
            pendingWork.delete(taskId);
            finish({ images: [], error: '生成超时（320s 未返回），请重试或检查模型/网络' });
          }
        }, 320_000);
        pendingWork.set(taskId, (p) => {
          clearTimeout(timer);
          if (p.cancelled) finish({ images: [] });
          else if (p.error) finish({ images: [], error: p.error });
          else finish({ images: p.paths ?? [] });
        });
      })
      // IPC 本身 reject（主进程崩溃 / 通道异常）时也要收尾，否则节点永远卡 running
      .catch((err) => finish({ images: [], error: err instanceof Error ? err.message : String(err) }));
  });
}

/** 真实放大：复用工具箱 Real-ESRGAN（api:upscale:run-single，同步返回 outputPath）。 */
async function runUpscaleOnce(image: string): Promise<{ images: string[]; error?: string }> {
  const s = await window.electronAPI.upscale.status();
  if (!s.ok) return { images: [], error: s.error.message };
  if (!s.data.hasAnyModel || s.data.models.length === 0) {
    return { images: [], error: '未安装放大模型（去工具箱 Ctrl+5 装 Real-ESRGAN 引擎与模型）' };
  }
  const isData = image.startsWith('data:');
  const r = await window.electronAPI.upscale.runSingle({
    inputDataUri: isData ? image : undefined,
    inputPath: isData ? undefined : image,
    modelName: s.data.models[0].name,
    scale: 4,
    format: 'png',
    tile: 0,
    gpuId: 'auto',
    tta: false,
    backend: 'ncnn'
  });
  if (!r.ok) return { images: [], error: r.error.message };
  return { images: [r.data.outputPath] };
}

function imgResult(d: WorkNodeData, images: string[], extraLogs: string[]): WorkResult {
  const model = d.workType === 'upscale' ? 'Real-ESRGAN' : d.modelId || firstImageModel();
  return {
    ok: true,
    summary: `${WORK_TYPE_LABELS[d.workType]} 完成：${images.length} 张`,
    images,
    logs: [`provider=${PROVIDER_LABELS[d.provider]} · 模型=${model}`, ...extraLogs, `输出 ${images.length} 张`],
    workType: d.workType,
    runMode: d.runMode,
    provider: d.provider,
    model,
    simulated: false
  };
}

/** 当前打开的文档 id（用于判断在途任务结果该落到当前 store 还是回灌某个非当前文档）。 */
function currentDocId(): string | null {
  return useSmartDocsStore.getState().activeDocId;
}

/**
 * 把终态结果回灌到「非当前」文档（用户在生成途中切走了画布）：直接改该文档的持久化内容，
 * 包括源节点 + 其下游结果节点，落盘一次。不做 cascade（不在后台文档自动跑下游工作节点）。
 */
function placeResultInBackgroundDoc(docId: string, srcId: string, result: WorkResult): void {
  const doc = readDocDoc(docId);
  if (!doc) return;
  const patches: Array<{ nodeId: string; patch: Record<string, unknown> }> = [
    {
      nodeId: srcId,
      patch: {
        status: result.ok ? 'success' : 'error',
        result,
        logs: result.logs,
        error: result.error ?? null,
        taskId: undefined,
        runId: undefined
      }
    }
  ];
  patchDocNodes(docId, patches);
  // 下游结果节点：累积到内存结果库（按节点 id），不写进文档（重启才清）
  for (const c of doc.connections.filter((x) => x.source === srcId)) {
    const tgt = doc.nodes.find((n) => n.id === c.target);
    if (tgt?.type === 'result') useSmartResultStore.getState().push(tgt.id, result);
  }
}

/** 写结果到工作节点（含 logs/error 显式字段）+ 推给下游结果节点；cascade 时继续跑下游工作节点。
 *  docId = 提交时所在文档；若已切走（!== 当前）→ 把终态回灌到那个文档的存储，避免结果丢失。 */
function placeWorkResult(
  workId: string,
  result: WorkResult,
  cascade: boolean,
  visited: Set<string>,
  docId: string | null
): void {
  if (docId && docId !== currentDocId()) {
    placeResultInBackgroundDoc(docId, workId, result);
    return;
  }
  const st = useSmartCanvasStore.getState();
  setWork(workId, {
    status: result.ok ? 'success' : 'error',
    result,
    logs: result.logs,
    error: result.error ?? null,
    taskId: undefined
  });
  for (const e of st.edges.filter((x) => x.source === workId)) {
    const tgt = st.nodes.find((n) => n.id === e.target);
    if (tgt?.type === 'result') {
      // 累积到内存结果库（结果节点 = 统一集合，重启才清）；data.result 同步为最新供 computeUpstream
      useSmartResultStore.getState().push(tgt.id, result);
      st.updateNodeData(tgt.id, { result } as Partial<SmartNodeData>);
    }
  }
  if (cascade && result.ok) {
    for (const e of st.edges.filter((x) => x.source === workId)) {
      const tgt = st.nodes.find((n) => n.id === e.target);
      if (tgt?.type === 'work') void runWorkNode(tgt.id, visited);
    }
  }
}

/** 运行一个工作节点（入口）。按 provider 分发：mock / mengbi(真实或回退 mock)。 */
export async function runWorkNode(
  workId: string,
  visited: Set<string> = new Set(),
  allowCascade = true
): Promise<void> {
  if (visited.has(workId)) return;
  visited.add(workId);
  const st = useSmartCanvasStore.getState();
  const node = st.nodes.find((n) => n.id === workId);
  if (!node || node.type !== 'work') return;
  const d = node.data as unknown as WorkNodeData;
  const inputs = collectInputs(workId);
  const cascade = allowCascade && isCascade(d);
  // 提交时所在文档：若生成途中用户切走画布，终态结果按此 id 回灌正确文档（防丢失/卡 running）
  const docId = currentDocId();

  // 记录上游输入快照（显式 inputRefs 字段）；新一轮运行清掉上次的取消标记
  cancelledWork.delete(workId);
  setWork(workId, { inputRefs: inputs.refs, status: 'running', result: null, error: null, logs: [], taskId: undefined });

  // 计时：从这里到出结果的耗时，注入到 WorkResult.durationMs（结果区显示「用时 X.Xs」）
  const t0 = Date.now();
  const place = (r: WorkResult, casc: boolean): void =>
    placeWorkResult(workId, { ...r, durationMs: Date.now() - t0 }, casc, visited, docId);

  // ── provider=mock：始终 Local Mock（可配随机延迟 + 随机失败，模拟真实运行/联调错误分支与 loading）──
  if (d.provider === 'mock') {
    const lo = Math.max(0, d.mockDelayMin ?? 200);
    const hi = Math.max(lo, d.mockDelayMax ?? 800);
    await new Promise((r) => setTimeout(r, lo + Math.random() * (hi - lo)));
    if (cancelledWork.has(workId)) return void cancelledWork.delete(workId);
    const errRate = d.mockErrorRate ?? 0;
    if (errRate > 0 && Math.random() < errRate) {
      place(errResult(d, '[模拟] 随机失败（命中 mockErrorRate，用于联调错误分支）'), false);
      return;
    }
    place(mockRunWorkNode(d, inputs), cascade);
    return;
  }

  // ── 真实放大：api:upscale ──
  if (d.workType === 'upscale') {
    if (inputs.images.length === 0) {
      setWork(workId, { status: 'idle' });
      toast.error('放大需要上游图片', '连一个图片节点（或分组）进来');
      return;
    }
    const res = await runUpscaleOnce(inputs.images[0]);
    if (cancelledWork.has(workId)) return void cancelledWork.delete(workId);
    if (res.error) {
      place(errResult(d, res.error), false);
      toast.error(res.error);
      return;
    }
    place(imgResult(d, res.images, ['Real-ESRGAN x4']), cascade);
    return;
  }

  // ── provider=mengbi 但工作类型暂无真实后端（视频/批量处理）：回退 mock + 说明 ──
  if (!REAL_WORK_TYPES.has(d.workType)) {
    await new Promise((r) => setTimeout(r, 300));
    if (cancelledWork.has(workId)) return void cancelledWork.delete(workId);
    place(mockRunWorkNode(d, inputs, '[模拟] 视频生成 v1.0 不接入；批量处理走多轮生成'), cascade);
    return;
  }

  // ── provider=mengbi + 真实工作类型：走 api:image:generate（含真实 batch/loop 多轮）──
  const modelId = d.modelId || firstImageModel();
  if (!modelId) {
    setWork(workId, { status: 'idle' });
    toast.error('请先在右侧给工作节点选一个绘画模型');
    return;
  }
  if (d.workType !== 'image-generation' && inputs.images.length === 0) {
    setWork(workId, { status: 'idle' });
    toast.error('该工作类型需要上游图片', '连一个图片节点（或分组）进来');
    return;
  }
  const prompt = effectivePrompt(d, inputs.prompts);
  if (d.workType === 'image-generation' && !prompt) {
    setWork(workId, { status: 'idle' });
    toast.error('请填写提示词');
    return;
  }
  const baseParams: Record<string, unknown> = {};
  if (d.aspect) baseParams.aspect = d.aspect;
  // 比例「自动」（d.aspect 空）+ 图片编辑类：跟随输入图片比例（量最近的常用比例）；文生图保持不发让模型自定
  else if (d.workType !== 'image-generation' && inputs.images.length) {
    const auto = await measureAspect(inputs.images[0]);
    if (auto) baseParams.aspect = auto;
  }
  if (d.imageSize) baseParams.image_size = d.imageSize;
  if (d.quality) baseParams.quality = d.quality;
  if (typeof d.strength === 'number' && d.workType !== 'image-generation') baseParams.strength = d.strength;

  // 多轮规则：loop = 跑 n 次（每次 1 张，累积）；batch/serial/continue = 一次 n 张；single = 1 张
  const rounds = d.runMode === 'loop' ? Math.max(1, Math.min(8, d.n || 1)) : 1;
  const perN = d.runMode === 'loop' ? 1 : d.runMode === 'single' ? 1 : clampN(d.n);
  const refs = inputs.images;
  const negativePrompt = d.negativePrompt?.trim() || undefined;
  // seed：null/负 = 随机（不发）；loop 模式逐轮 +i 以产生差异
  // 上限 2e9（与随机 seed 同量级）：避免接近 MAX_SAFE_INTEGER 时 seedBase + i 丢精度
  const seedBase =
    typeof d.seed === 'number' && d.seed >= 0 ? Math.min(Math.trunc(d.seed), 2_000_000_000) : null;
  const allImages: string[] = [];
  let firstErr: string | undefined;

  for (let i = 0; i < rounds; i++) {
    if (rounds > 1) {
      setWork(workId, {
        logs: [`运行中：第 ${i + 1}/${rounds} 轮（已 ${allImages.length} 张）`],
        result: allImages.length ? imgResult(d, [...allImages], [`运行中…`]) : null
      });
    }
    const roundParams: Record<string, unknown> = { ...baseParams, n: perN };
    if (seedBase != null) roundParams.seed = seedBase + i;
    const res = await generateOnce(modelId, prompt, roundParams, refs, negativePrompt, (tid) =>
      setWork(workId, { taskId: tid })
    );
    // 用户中途取消：cancelWork 已把节点重置 idle，这里直接收尾不写结果
    if (cancelledWork.has(workId)) return void cancelledWork.delete(workId);
    if (res.error) {
      firstErr = res.error;
      break;
    }
    allImages.push(...res.images);
  }

  if (firstErr && allImages.length === 0) {
    place(errResult(d, firstErr), false);
    toast.error(firstErr);
    return;
  }
  const extraLogs = rounds > 1 ? [`循环 ${rounds} 轮`] : [];
  if (firstErr) extraLogs.push(`部分失败：${firstErr}`);
  place(imgResult(d, allImages, extraLogs), cascade);
}

function errResult(d: WorkNodeData, message: string): WorkResult {
  return {
    ok: false,
    summary: '生成失败',
    images: [],
    logs: [message],
    error: message,
    workType: d.workType,
    runMode: d.runMode,
    provider: d.provider,
    model: d.modelId || firstImageModel(),
    simulated: false
  };
}

/**
 * 取消一个工作节点的进行中生成：abort 上游任务（释放队列并发槽）+ 立即把节点重置 idle，方便马上重试。
 * 解决「拥挤模型把任务挂住、并发槽占满，第二三次点运行毫无反应」的卡死 —— 取消后即可重新发起。
 */
export function cancelWork(workId: string): void {
  const st = useSmartCanvasStore.getState();
  const node = st.nodes.find((n) => n.id === workId);
  if (!node || node.type !== 'work') return;
  const d = node.data as unknown as WorkNodeData;
  cancelledWork.add(workId);
  if (typeof d.taskId === 'number') {
    void window.electronAPI.image.cancel(d.taskId);
    // 抛弃该任务的 pending resolver：唤醒 awaiting 的 generateOnce（resolve 空），并忽略迟到的 image:done
    const cb = pendingWork.get(d.taskId);
    if (cb) {
      pendingWork.delete(d.taskId);
      cb({ taskId: d.taskId, cancelled: true });
    }
  }
  setWork(workId, { status: 'idle', result: null, error: null, logs: ['已取消，可重新运行'], taskId: undefined });
}

/** 把文本结果推给下游结果节点（结果节点统一集合现已支持文本/视频）。 */
function pushTextDownstream(srcId: string, text: string, label: string): void {
  const t = text.trim();
  if (!t) return;
  const st = useSmartCanvasStore.getState();
  const result: WorkResult = {
    ok: true,
    summary: `${label}：文本输出`,
    images: [],
    texts: [t],
    logs: [label],
    workType: 'image-generation',
    runMode: 'single',
    provider: 'mengbi',
    model: label,
    simulated: false
  };
  for (const e of st.edges.filter((x) => x.source === srcId)) {
    const tgt = st.nodes.find((n) => n.id === e.target);
    if (tgt?.type === 'result') {
      useSmartResultStore.getState().push(tgt.id, result);
      st.updateNodeData(tgt.id, { result } as Partial<SmartNodeData>);
    }
  }
}

/** 统一路由 image:done → 解析对应单次生成的 promise（页面挂一个监听 → 调本函数）。 */
export function routeImageDone(payload: unknown): void {
  const dn = payload as ImageDonePayload;
  const cb = pendingWork.get(dn.taskId);
  if (!cb) return;
  pendingWork.delete(dn.taskId);
  cb(dn);
}

// ─────────────────────────────────────────────────────────────
// LLM / 对话节点：文本模型处理（优化/翻译/扩写/分解/完善/反推）
// 复用 api:chat:optimize-prompt（文本→文本）+ api:lab:reverse（图→提示词）
// ─────────────────────────────────────────────────────────────

const LLM_SYSTEM: Partial<Record<LlmOp, string>> = {
  'translate-en': '你是翻译助手。把输入忠实、自然地翻译成英文，只输出译文，不要解释、不要引号包裹。',
  'translate-zh': '你是翻译助手。把输入忠实、自然地翻译成中文，只输出译文，不要解释、不要引号包裹。',
  expand:
    '你是提示词扩写助手。在保留原意前提下，补充主体/风格/构图/镜头/光影/材质/色彩/氛围等细节，使其更具体丰富，直接输出扩写后的文本。',
  decompose:
    '你是需求拆解助手。把输入拆解为结构化要素（主体 / 场景 / 风格 / 构图 / 光影 / 色彩 / 关键细节），用简洁条目逐项列出。',
  refine: '你是对话完善助手。把输入打磨得更清晰、完整、可执行，直接输出完善后的文本，不要解释。'
  // 'optimize' 不设——用后端默认的图像提示词优化器
};

function llmSystemPrompt(op: LlmOp, instruction: string): string | undefined {
  const base = LLM_SYSTEM[op];
  const extra = instruction.trim() ? `\n额外要求：${instruction.trim()}` : '';
  if (op === 'optimize') {
    return instruction.trim() ? `把输入改写为高质量的图像生成提示词。${instruction.trim()}` : undefined;
  }
  return (base ?? '') + extra;
}

function setLlm(id: string, patch: Partial<LlmNodeData>): void {
  useSmartCanvasStore.getState().updateNodeData(id, patch as Partial<SmartNodeData>);
}

/** 从反推返回里抽出纯文本：对象取最可能的文本字段、数组用「，」连接，其余转字符串。 */
function extractReverseText(res: unknown): string {
  if (typeof res === 'string') return res;
  if (Array.isArray(res)) return res.map(extractReverseText).filter(Boolean).join('，');
  if (res && typeof res === 'object') {
    const o = res as Record<string, unknown>;
    for (const k of ['description', 'prompt', 'text', 'caption', 'content', 'result', 'tags', 'style']) {
      const v = o[k];
      if (typeof v === 'string' && v.trim()) return v;
      if (Array.isArray(v)) return v.map((x) => String(x)).join('，');
    }
    for (const v of Object.values(o)) if (typeof v === 'string' && v.trim()) return v;
    return Object.values(o)
      .map((v) => String(v))
      .join('，');
  }
  return String(res ?? '');
}

const WRAP_PAIRS: Record<string, string> = {
  '(': ')',
  '[': ']',
  '{': '}',
  '「': '」',
  '『': '』',
  '“': '”',
  '"': '"',
  "'": "'"
};
/** 整段是否恰好被一对 open/close 包裹（括号要平衡到末尾、引号中间不再出现）。 */
function wholeWrapped(s: string, open: string, close: string): boolean {
  if (open === close) return s.indexOf(open, 1) === s.length - 1;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === open) depth++;
    else if (s[i] === close) {
      depth--;
      if (depth === 0) return i === s.length - 1;
    }
  }
  return false;
}
/** 反推输出清洗：直接给提示词。去「标签：」前缀（须带冒号，免误删正文）+ 仅脱**整段**包裹的括号/引号（保留正文内合法括号如结尾 (neon)）。 */
function cleanReversePrompt(res: unknown): string {
  let s = extractReverseText(res).trim();
  s = s
    .replace(/^\s*(text|prompt|caption|description|tags?|style|提示词|描述|标签|风格)\s*[:：]\s*/i, '')
    .trim();
  let changed = true;
  while (changed && s.length >= 2) {
    changed = false;
    const open = s[0];
    if (WRAP_PAIRS[open] && wholeWrapped(s, open, WRAP_PAIRS[open])) {
      s = s.slice(1, -1).trim();
      changed = true;
    }
  }
  return s;
}

/** 运行一个 LLM 节点：收集上游文本/图片 → 调文本模型 → 写回 resultText。 */
export async function runLlmNode(llmId: string): Promise<void> {
  const st = useSmartCanvasStore.getState();
  const node = st.nodes.find((n) => n.id === llmId);
  if (!node || node.type !== 'llm') return;
  const d = node.data as unknown as LlmNodeData;
  if (!d.modelId) {
    toast.error('请先在右侧给 LLM 节点选一个对话模型');
    return;
  }
  // pre-flight：模型在当前方案不可用（实际ID空 / 在别的方案 / 是绘画模型 / 没配）就精确报错，别空跑一趟
  {
    const sset = useSettingsStore.getState();
    const why = diagnoseChatModel(sset.configs, sset.plans, sset.activePlanId, d.modelId);
    if (why) {
      setLlm(llmId, { status: 'error', error: why, logs: [why] });
      toast.error('该对话模型不可用', why);
      return;
    }
  }
  const up = computeUpstream(st.nodes, st.edges, llmId);
  setLlm(llmId, { status: 'running', error: null, logs: [] });
  const t0 = Date.now();
  const took = (): string => `用时 ${((Date.now() - t0) / 1000).toFixed(1)}s`;

  // 反推：图 → 提示词（需 vision 文本模型）
  if (d.op === 'reverse') {
    if (!up.images.length) {
      setLlm(llmId, { status: 'idle' });
      toast.error('图片反推需要上游图片', '连一个图片节点进来');
      return;
    }
    const r = await window.electronAPI.lab.reverse({
      imagePaths: [up.images[0]],
      modelId: d.modelId,
      resultType: d.reverseType ?? 'description'
    });
    if (!r.ok) {
      setLlm(llmId, { status: 'error', error: r.error.message, logs: [r.error.message] });
      toast.error(r.error.message, r.error.hint);
      return;
    }
    const res = (r.data as { result?: unknown }).result;
    const text = cleanReversePrompt(res);
    setLlm(llmId, {
      status: 'success',
      resultText: text,
      logs: [`${LLM_OP_LABELS.reverse} · ${d.modelId} · ${d.reverseType ?? 'description'} · ${took()}`]
    });
    pushTextDownstream(llmId, text, LLM_OP_LABELS.reverse);
    return;
  }

  // 文本类操作：优化 / 翻译 / 扩写 / 分解 / 完善
  const planId = useSettingsStore.getState().activePlanId;
  if (planId === null) {
    setLlm(llmId, { status: 'idle' });
    toast.error('没有可用方案', '先在设置页建一个方案并配置对话模型');
    return;
  }
  const userInput = [d.input.trim(), ...up.prompts].filter(Boolean).join('\n');
  if (!userInput) {
    setLlm(llmId, { status: 'idle' });
    toast.error('没有可处理的文本', '在节点里输入文字，或连一个提示词节点进来');
    return;
  }
  const r = await window.electronAPI.chat.optimizePrompt({
    planId,
    modelId: d.modelId,
    userInput,
    systemPrompt: llmSystemPrompt(d.op, d.instruction)
  });
  if (!r.ok) {
    setLlm(llmId, { status: 'error', error: r.error.message, logs: [r.error.message] });
    toast.error(r.error.message, r.error.hint);
    return;
  }
  if (r.data.optimizedBy === null) {
    // 模型有效性已在 pre-flight 校验过；走到这里多半是上游超时/报错/空响应被后端回退了原文
    setLlm(llmId, {
      status: 'success',
      resultText: r.data.optimized,
      logs: ['优化调用未生效（上游超时/报错/空响应），已回退原文']
    });
    pushTextDownstream(llmId, r.data.optimized, LLM_OP_LABELS[d.op]);
    toast.error('优化未生效，已回退原文', '上游可能超时或报错，稍后重试，或换个对话模型');
    return;
  }
  setLlm(llmId, {
    status: 'success',
    resultText: r.data.optimized,
    logs: [`${LLM_OP_LABELS[d.op]} · ${d.modelId} · ${took()}`]
  });
  pushTextDownstream(llmId, r.data.optimized, LLM_OP_LABELS[d.op]);
}

// ─────────────────────────────────────────────────────────────
// LLM 节点的「流式聊天」块：复用 api:chat:send + chat:chunk/chat:done
// 每个 LLM 节点一个会话（懒创建）；按 messageId 路由流式片段回该节点。
// ─────────────────────────────────────────────────────────────

const pendingChat = new Map<string, string>(); // messageId → llm 节点 id

function getLlm(id: string): LlmNodeData | null {
  const n = useSmartCanvasStore.getState().nodes.find((x) => x.id === id);
  return n && n.type === 'llm' ? (n.data as unknown as LlmNodeData) : null;
}

function appendAssistant(nodeId: string, delta: string): void {
  // 原子化：在 setState 回调里「读最新 → 追加」一步完成，避免高频 chunk 下读到旧快照丢字
  useSmartCanvasStore.setState((s) => ({
    nodes: s.nodes.map((n) => {
      if (n.id !== nodeId || n.type !== 'llm') return n;
      const data = n.data as unknown as LlmNodeData;
      if (!data.chatMessages.length) return n;
      const msgs = data.chatMessages.slice();
      const last = msgs[msgs.length - 1];
      if (last.role !== 'assistant') return n;
      msgs[msgs.length - 1] = { role: 'assistant', content: last.content + delta };
      return { ...n, data: { ...data, chatMessages: msgs } as unknown as Record<string, unknown> };
    })
  }));
}

function finalizeChat(nodeId: string, replaceIfEmpty?: string): void {
  const d = getLlm(nodeId);
  if (!d) return;
  const msgs = d.chatMessages.slice();
  const last = msgs[msgs.length - 1];
  if (replaceIfEmpty && last && last.role === 'assistant' && !last.content) {
    msgs[msgs.length - 1] = { role: 'assistant', content: replaceIfEmpty };
  }
  setLlm(nodeId, { chatMessages: msgs, chatStreaming: false });
}

/** 本地路径 / dataURI → dataURI（聊天附图用；chat.send 的 attachedImages 只吃 dataURI / http URL）。 */
async function toChatDataUri(src: string): Promise<string | null> {
  if (src.startsWith('data:') || src.startsWith('http')) return src;
  try {
    const res = await fetch(localPathToImageUrl(src));
    const blob = await res.blob();
    return await new Promise<string | null>((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => resolve(null);
      fr.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/** 发送一条聊天消息（LLM 节点 chat 模式）。 */
export async function sendLlmChat(nodeId: string, text: string): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;
  const d = getLlm(nodeId);
  if (!d) return;
  if (!d.modelId) {
    toast.error('请先在右侧给 LLM 节点选一个对话模型');
    return;
  }
  const sset = useSettingsStore.getState();
  // pre-flight：模型不可用就精确报错，别建会话/空发一轮
  const why = diagnoseChatModel(sset.configs, sset.plans, sset.activePlanId, d.modelId);
  if (why) {
    toast.error('该对话模型不可用', why);
    return;
  }
  const planId = sset.activePlanId;
  if (planId === null) {
    toast.error('没有可用方案', '先在设置页建方案并配置对话模型');
    return;
  }

  let conversationId = d.conversationId;
  if (!conversationId) {
    const cr = await window.electronAPI.chat.create({ title: '智能画布 LLM', planId, modelId: d.modelId });
    if (!cr.ok) {
      toast.error(cr.error.message, cr.error.hint);
      return;
    }
    conversationId = cr.data.id;
    setLlm(nodeId, { conversationId });
  }

  const msgs: ChatMsg[] = [
    ...d.chatMessages,
    { role: 'user', content: trimmed },
    { role: 'assistant', content: '' }
  ];
  setLlm(nodeId, { chatMessages: msgs, chatStreaming: true });

  // 上游图片 → 多模态附图（vision/多模态模型可识图）；本地路径转 dataURI 后传 attachedImages
  const st = useSmartCanvasStore.getState();
  const upImgs = computeUpstream(st.nodes, st.edges, nodeId).images.slice(0, 6);
  let attached: string[] | undefined;
  if (upImgs.length) {
    const conv = (await Promise.all(upImgs.map(toChatDataUri))).filter(Boolean) as string[];
    if (conv.length < upImgs.length) {
      toast.info('部分图片未能附带', `${upImgs.length - conv.length}/${upImgs.length} 张转换失败，已跳过`);
    }
    attached = conv.length ? conv : undefined;
  }

  const r = await window.electronAPI.chat.send({
    conversationId,
    content: trimmed,
    attachedImages: attached && attached.length ? attached : undefined
  });
  if (!r.ok) {
    finalizeChat(nodeId, `（出错：${r.error.message}）`);
    toast.error(r.error.message, r.error.hint);
    return;
  }
  pendingChat.set(r.data.messageId, nodeId);
}

/** 页面订阅 chat:chunk → 流式片段追加到对应 LLM 节点。 */
export function routeChatChunk(payload: unknown): void {
  const p = payload as { id: string; delta?: string };
  const nodeId = pendingChat.get(p.id);
  if (!nodeId || !p.delta) return;
  appendAssistant(nodeId, p.delta);
}

/** 页面订阅 chat:done → 收尾。 */
export function routeChatDone(payload: unknown): void {
  const p = payload as { id: string; cancelled?: boolean; error?: string };
  const nodeId = pendingChat.get(p.id);
  if (!nodeId) return;
  pendingChat.delete(p.id);
  finalizeChat(nodeId, p.error ? `（出错：${p.error}）` : undefined);
}

// ─────────────────────────────────────────────────────────────
// ComfyUI 节点：绑定「工作流」模块保存的模板 → api:comfyui:run-single
// 进度/结果走 comfyui:run-done（页面订阅 → routeComfyDone）
// ─────────────────────────────────────────────────────────────

// 进行中：comfyui runId → { comfy 节点 id, 提交时文档 id, 起始时间 }（切文档后把结果回灌正确文档 + 计时）
const pendingComfy = new Map<string, { comfyId: string; docId: string | null; startedAt: number }>();
// runId → resolver：让 runComfyNode 能 await 到「真正完成」（结果走 comfyui:run-done 异步回来）。
// 供「运行自动跑上游」用：上游 ComfyUI 出齐图后才跑下游。
const pendingComfyResolve = new Map<string, () => void>();

function setComfy(id: string, patch: Partial<ComfyNodeData>): void {
  useSmartCanvasStore.getState().updateNodeData(id, patch as Partial<SmartNodeData>);
}

const COMFY_TEXT_KINDS = new Set(['text', 'textarea', 'prompt']);
const COMFY_IMAGE_KINDS = new Set(['image', 'multi_image', 'mask']);

/** 模板里哪些控件是「可被画布喂入」的输入槽：文本（提示词）+ 图片。其余参数用工作流里调好的值。 */
export function comfyInputSlots(controls: InputControl[]): { text: InputControl[]; image: InputControl[] } {
  return {
    text: controls.filter((c) => COMFY_TEXT_KINDS.has(c.type)),
    image: controls.filter((c) => COMFY_IMAGE_KINDS.has(c.type))
  };
}

/**
 * 运行一个 ComfyUI 节点（整个工作流当黑盒）。
 * 只把画布上游喂进输入槽：上游提示词 → 第一个文本控件；上游图片 → 图片控件（按序，multi_image 给全部）。
 * 其余参数都用「工作流」页里调好的值（applyBindings 对未提供的控件保留工作流自带值）。
 * 图片控件需在模板里配 file_upload 绑定 —— 运行引擎会自动把 dataURI/路径上传给 ComfyUI。
 */
export async function runComfyNode(comfyId: string): Promise<void> {
  const st = useSmartCanvasStore.getState();
  const node = st.nodes.find((n) => n.id === comfyId);
  if (!node || node.type !== 'comfy') return;
  const d = node.data as unknown as ComfyNodeData;
  if (!d.workflowId) {
    toast.error('请先在右侧给 ComfyUI 节点选一个工作流模板');
    return;
  }
  const up = computeUpstream(st.nodes, st.edges, comfyId);
  const slots = comfyInputSlots(d.controls);
  // 先带上用户在检查器里调好的参数，再让上游提示词/图片覆盖对应输入槽
  const cv: Record<string, unknown> = { ...d.controlValues };
  // 多提示词分发到多文本控件（按顺序：第 i 个提示词 → 第 i 个文本控件；提示词比控件多时，多出的并入最后一个控件）。
  // 单文本控件时仍全部合并进它。让「分组里多段内容」对应到 ComfyUI 不同参数。
  const tslots = slots.text;
  if (tslots.length === 1) {
    if (up.prompts.length) cv[tslots[0].id] = up.prompts.join('\n');
  } else if (tslots.length > 1) {
    tslots.forEach((c, i) => {
      const part = i < tslots.length - 1 ? up.prompts[i] : up.prompts.slice(i).join('\n');
      if (part) cv[c.id] = part;
    });
  }
  // 多图分发到多图片控件（multi_image 给全部；单图控件按序，不足回退首图）
  slots.image.forEach((c, i) => {
    if (c.type === 'multi_image') {
      if (up.images.length) cv[c.id] = up.images;
    } else {
      const img = up.images[i] ?? up.images[0];
      if (img) cv[c.id] = img;
    }
  });

  const docId = currentDocId();
  setComfy(comfyId, { status: 'running', error: null, logs: [], result: null });
  const r = await window.electronAPI.comfyui.runSingle({ workflowId: d.workflowId, controlValues: cv });
  if (!r.ok) {
    setComfy(comfyId, { status: 'error', error: r.error.message, logs: [r.error.message] });
    toast.error(r.error.message, r.error.hint);
    return;
  }
  const runId = r.data.runId;
  pendingComfy.set(runId, { comfyId, docId, startedAt: Date.now() });
  setComfy(comfyId, { runId });
  // 等真正完成（comfyui:run-done → routeComfyDone）再返回；320s 兜底，避免永久挂起
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      pendingComfyResolve.delete(runId);
      resolve();
    }, 320_000);
    // 90s 仍未完成给一次温和提示（万一 run-done 丢失，用户不至于干等到 320s 才发觉异常）
    const nudge = setTimeout(() => {
      if (pendingComfyResolve.has(runId)) toast.info('ComfyUI 仍在运行中', '复杂工作流较慢，请耐心等待或点节点上的「取消」');
    }, 90_000);
    pendingComfyResolve.set(runId, () => {
      clearTimeout(timer);
      clearTimeout(nudge);
      resolve();
    });
  });
}

/** 唤醒等待该 runId 完成的 runComfyNode（routeComfyDone 各出口都调）。 */
function resolveComfyWait(runId: string): void {
  const f = pendingComfyResolve.get(runId);
  if (f) {
    pendingComfyResolve.delete(runId);
    f();
  }
}

/** 取消一个 ComfyUI 节点的进行中运行：abort 上游 run + 立即重置 idle + 唤醒 awaiting 的 runComfyNode。 */
export function cancelComfy(comfyId: string): void {
  const node = useSmartCanvasStore.getState().nodes.find((n) => n.id === comfyId);
  if (!node || node.type !== 'comfy') return;
  const d = node.data as unknown as ComfyNodeData;
  const runId = d.runId;
  setComfy(comfyId, { status: 'idle', runId: undefined, logs: ['已取消，可重新运行'] });
  if (runId) {
    void window.electronAPI.comfyui.cancel({ runId });
    pendingComfy.delete(runId);
    resolveComfyWait(runId); // 唤醒 awaiting 的 runComfyNode，让它立即返回
  }
}

/** 把 ComfyUI 结果写到节点 + 推给下游结果节点；切文档后回灌正确文档。 */
function placeComfyResult(comfyId: string, result: WorkResult, docId: string | null): void {
  if (docId && docId !== currentDocId()) {
    placeResultInBackgroundDoc(docId, comfyId, result);
    return;
  }
  const st = useSmartCanvasStore.getState();
  setComfy(comfyId, {
    status: result.ok ? 'success' : 'error',
    result,
    logs: result.logs,
    error: result.error ?? null,
    runId: undefined
  });
  for (const e of st.edges.filter((x) => x.source === comfyId)) {
    const tgt = st.nodes.find((n) => n.id === e.target);
    if (tgt?.type === 'result') {
      useSmartResultStore.getState().push(tgt.id, result);
      st.updateNodeData(tgt.id, { result } as Partial<SmartNodeData>);
    }
  }
}

/** 统一路由 comfyui:run-done 到对应 comfy 节点（页面订阅 → 调本函数）。 */
export function routeComfyDone(payload: unknown): void {
  const dn = payload as { runId: string; status?: string; outputFiles?: OutputFile[]; error?: string };
  const entry = pendingComfy.get(dn.runId);
  if (!entry) return;
  pendingComfy.delete(dn.runId);
  const { comfyId, docId, startedAt } = entry;
  const durationMs = Date.now() - startedAt;
  // 模板名：当前 store 里取得到就用，取不到（已切走画布）回退「工作流」
  const live = useSmartCanvasStore.getState().nodes.find((n) => n.id === comfyId);
  const name = live && live.type === 'comfy' ? (live.data as unknown as ComfyNodeData).templateName || '工作流' : '工作流';

  if (dn.status === 'failed' || dn.error) {
    placeComfyResult(
      comfyId,
      {
        ok: false,
        summary: 'ComfyUI 运行失败',
        images: [],
        logs: [dn.error ?? '运行失败'],
        error: dn.error ?? '运行失败',
        workType: 'image-generation',
        runMode: 'single',
        provider: 'comfyui',
        model: name,
        simulated: false,
        durationMs
      },
      docId
    );
    resolveComfyWait(dn.runId);
    return;
  }
  if (dn.status === 'cancelled') {
    if (!docId || docId === currentDocId()) setComfy(comfyId, { status: 'idle', runId: undefined });
    else patchDocNodes(docId, [{ nodeId: comfyId, patch: { status: 'idle', runId: undefined } }]);
    resolveComfyWait(dn.runId);
    return;
  }
  const images = (dn.outputFiles ?? [])
    .filter((f) => f.kind === 'image' && typeof f.path === 'string')
    .map((f) => f.path as string);
  // 文本类输出（ShowText / string 节点）一并收下：节点上可查看 + 「建提示词节点」+ 喂下游
  const texts = (dn.outputFiles ?? [])
    .filter((f) => f.kind === 'text' && typeof f.text === 'string' && (f.text as string).trim())
    .map((f) => (f.text as string).trim());
  const parts = [`${images.length} 张`, ...(texts.length ? [`${texts.length} 段文本`] : [])].join(' · ');
  placeComfyResult(
    comfyId,
    {
      ok: true,
      summary: `ComfyUI「${name}」完成：${parts}`,
      images,
      texts: texts.length ? texts : undefined,
      logs: [`工作流 ${name} · 输出 ${parts}`],
      workType: 'image-generation',
      runMode: 'single',
      provider: 'comfyui',
      model: name,
      simulated: false,
      durationMs
    },
    docId
  );
  resolveComfyWait(dn.runId);
}

// ─────────────────────────────────────────────────────────────
// 运行全部：按拓扑顺序串行跑全图的 work / comfy / llm 节点（上游先于下游）
// 取消=软停（abort 标记，停止启动后续节点；已发起的那次生成自然跑完）
// ─────────────────────────────────────────────────────────────

/** 拓扑排序节点 id（Kahn）；有环时把剩余节点附在末尾，保证不漏跑。 */
function topoOrder(nodes: Node[], edges: Edge[]): string[] {
  const indeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const n of nodes) {
    indeg.set(n.id, 0);
    adj.set(n.id, []);
  }
  for (const e of edges) {
    if (!indeg.has(e.source) || !indeg.has(e.target)) continue;
    adj.get(e.source)?.push(e.target);
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
  }
  const q = nodes.filter((n) => (indeg.get(n.id) ?? 0) === 0).map((n) => n.id);
  const order: string[] = [];
  const seen = new Set<string>();
  while (q.length) {
    const id = q.shift() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    order.push(id);
    for (const t of adj.get(id) ?? []) {
      indeg.set(t, (indeg.get(t) ?? 1) - 1);
      if ((indeg.get(t) ?? 0) === 0) q.push(t);
    }
  }
  for (const n of nodes) if (!seen.has(n.id)) order.push(n.id);
  return order;
}

const RUNNABLE = new Set(['work', 'comfy', 'llm']);
// 运行全部时「当前正在跑」的节点（点停止时据此终止在途任务，而非等它自然跑完）
let currentRunNode: { id: string; type: string } | null = null;

/**
 * 图库删了某些源文件后，从智能画布的结果里同步剔除这些图（内存累积库 + 当前画布节点 data.result）。
 * 由 SmartCanvasPage 订阅 useDeletedMediaStore 调用，实现「图库删除 → 工作流预览同步清掉」。
 */
export function pruneDeletedImages(paths: string[]): void {
  const del = new Set(paths.filter(Boolean));
  if (!del.size) return;
  // 1) 内存累积结果库
  const rs = useSmartResultStore.getState();
  let rChanged = false;
  const accum: Record<string, WorkResult[]> = {};
  for (const [nid, arr] of Object.entries(rs.accum)) {
    accum[nid] = arr.map((r) => {
      const imgs = r.images.filter((p) => !del.has(p));
      if (imgs.length !== r.images.length) rChanged = true;
      return imgs.length === r.images.length ? r : { ...r, images: imgs };
    });
  }
  if (rChanged) useSmartResultStore.setState({ accum });
  // 2) 当前画布节点的 data.result.images（work/comfy/result）
  const cs = useSmartCanvasStore.getState();
  let nChanged = false;
  const nodes = cs.nodes.map((n) => {
    if (n.type !== 'work' && n.type !== 'comfy' && n.type !== 'result') return n;
    const data = n.data as { result?: { images?: string[] } | null };
    const imgs = data.result?.images;
    if (!imgs?.length) return n;
    const next = imgs.filter((p) => !del.has(p));
    if (next.length === imgs.length) return n;
    nChanged = true;
    return { ...n, data: { ...n.data, result: { ...(data.result as object), images: next } } };
  });
  if (nChanged) useSmartCanvasStore.setState({ nodes });
}

/** 停止运行全部：置 abort 标记 + **立即取消当前正在跑的节点**（work→cancelWork / comfy→cancelComfy），不再傻等它跑完。 */
export function abortRunAll(): void {
  useSmartRunStore.getState().requestAbort();
  const cur = currentRunNode;
  if (!cur) return;
  if (cur.type === 'work') cancelWork(cur.id);
  else if (cur.type === 'comfy') cancelComfy(cur.id);
  // llm（node 模式的 optimizePrompt / reverse）无中断接口；会在本次返回后因 abort 停止后续
}

/** 运行全部可运行节点（work/comfy/llm），按拓扑顺序串行。进度走 useSmartRunStore，可软取消。 */
export async function runAllNodes(): Promise<void> {
  const st0 = useSmartCanvasStore.getState();
  const order = topoOrder(st0.nodes, st0.edges).filter((id) => {
    const n = st0.nodes.find((x) => x.id === id);
    return n && RUNNABLE.has(n.type ?? '');
  });
  if (!order.length) {
    toast.error('没有可运行的节点', '加工作 / ComfyUI / LLM 节点后再运行全部');
    return;
  }
  const run = useSmartRunStore.getState();
  run.start(order.length);
  // 工作节点共用一个 visited：cascade 跑过的下游不再被循环重复触发
  const visited = new Set<string>();
  for (const id of order) {
    if (useSmartRunStore.getState().abort) break;
    const n = useSmartCanvasStore.getState().nodes.find((x) => x.id === id);
    if (n) {
      currentRunNode = { id, type: n.type ?? '' };
      if (n.type === 'work') await runWorkNode(id, visited);
      else if (n.type === 'comfy') await runComfyNode(id);
      else if (n.type === 'llm') await runLlmNode(id);
      currentRunNode = null;
    }
    useSmartRunStore.getState().tick();
  }
  currentRunNode = null;
  useSmartRunStore.getState().finish();
}

// ─────────────────────────────────────────────────────────────
// 运行某节点时：自动先把上游「需要运行的」工作流节点按依赖顺序跑完，再运行本节点。
// 让用户点下游一次即可：先出齐上游输入，再跑当前节点。
// ─────────────────────────────────────────────────────────────

/** 该节点是否还需要运行：仅 work/comfy/llm 参与；按状态判断（非 running 且非 success），
 *  避免「成功但无图的 mock 节点」每次都被重复跑（不按图片数判断）。 */
function needsRun(node: Node): boolean {
  if (node.type !== 'work' && node.type !== 'comfy' && node.type !== 'llm') return false;
  const status = (node.data as unknown as { status?: string }).status;
  return status !== 'running' && status !== 'success';
}

async function runOne(node: Node, allowCascade = true): Promise<void> {
  if (node.type === 'work') await runWorkNode(node.id, new Set(), allowCascade);
  else if (node.type === 'comfy') await runComfyNode(node.id);
  else if (node.type === 'llm') await runLlmNode(node.id);
}

/** 递归把上游需要运行的工作流节点按依赖顺序（更上游优先）跑完，不含当前节点。
 *  上游用 allowCascade=false 跑：由本次显式上游遍历主导顺序，避免上游 cascade 把下游提前重复跑一遍。 */
async function ensureUpstreamRun(nodeId: string, visited: Set<string>): Promise<void> {
  const st = useSmartCanvasStore.getState();
  for (const e of st.edges.filter((x) => x.target === nodeId)) {
    const src = st.nodes.find((n) => n.id === e.source);
    if (!src || visited.has(src.id)) continue;
    visited.add(src.id);
    await ensureUpstreamRun(src.id, visited); // 先更上游（group 透传：组不运行，其上游已在此处理）
    const cur = useSmartCanvasStore.getState().nodes.find((n) => n.id === src.id);
    if (cur && needsRun(cur)) await runOne(cur, false);
  }
}

/** 运行节点（自动先跑上游）：先把上游需要运行的节点出齐结果，再运行本节点。供节点/检查器「运行」按钮用。 */
export async function runWithUpstream(nodeId: string): Promise<void> {
  await ensureUpstreamRun(nodeId, new Set());
  const node = useSmartCanvasStore.getState().nodes.find((n) => n.id === nodeId);
  if (node) await runOne(node);
}

// ── TODO 接缝（后续真实后端，仅替换本层，不动 UI）──
// async function runUpscaleWorkNode(d, inputs) { /* 走 api:upscale:run-single */ }
