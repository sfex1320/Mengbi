/**
 * 智能画布运行引擎（canvasRunner）：收集上游图片/提示词 → 按 provider 分发执行 → 写回结果。
 *  - provider='mengbi' + 真实工作类型（生成/编辑/风格/扩图）→ 复用 api:image:generate + image:done
 *  - provider='mengbi' + 放大/视频/批量 → 暂无真实接口，走 mock（留 TODO 接缝）
 *  - provider='mock'（Local Mock）→ 始终 mock，产出清晰的占位结果
 * 以后接更多真实后端（api:upscale / 视频 / ComfyUI）只改本文件的分发层，不动 UI。
 */
import type { Node, Edge } from '@xyflow/react';
import { useSmartCanvasStore, useSmartRunStore, useSmartResultStore, useSmartPreviewStore } from '@/store/smartCanvasStore';
import { useSmartDocsStore } from '@/store/smartDocsStore';
import { useDeletedMediaStore } from '@/store/deletedMediaStore';
import { readDocDoc, patchDocNodes } from '@/lib/smartDocStorage';
import { useSettingsStore } from '@/store/settingsStore';
import { useLlmHistoryStore } from '@/store/llmHistoryStore';
import { resolveModelRef } from '@/lib/modelMapping';
import { useVideoProvidersStore } from '@/store/videoProvidersStore';
import { useVideoHistoryStore } from '@/store/videoHistoryStore';
import { diagnoseChatModel } from './modelMapping';
import { toast } from '@/store/toastStore';
import { localPathToImageUrl } from '@/lib/imageUrl';
import { captureVideoPoster, captureVideoFrames } from '@/lib/videoPoster';
import { saveVideoNodeDefaults } from '@/lib/videoNodeDefaults';
import { normalizeVideoMode } from '@shared/video';
import type { VideoGenerationRequest, VideoRequestImage, CostEstimate } from '@shared/video';
import { validateVideoRequest, estimateVideoCost, needsCostConfirm, findVideoModel } from '@shared/videoProviders';
import { normalizeVideoKind, autoCorrectVideoKind } from '@shared/domain';
import type { ApiConfig } from '@shared/domain';
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
  type LightNodeData,
  type PaletteNodeData,
  type ScaleNodeData,
  type ChatMsg,
  type VideoNodeData,
  type ImageReverseNodeData,
  type VideoReverseNodeData,
  type FrameInterpNodeData,
  type VideoClipNodeData,
  type RatioNodeData,
  type SizeSpec,
  type StoryboardNodeData,
  type StoryboardConstraints,
  type PromptMallNodeData,
  type LoopNodeData,
  type RunStatus,
  type FolderInputNodeData,
  type FolderOutputNodeData,
  type UpscaleNodeData,
  type VectorizeNodeData,
  type SegmentNodeData,
  type SegElement,
  type ProofNodeData,
  type SmartNodeData
} from '@shared/smartCanvas';
import { ratioOutputSize, nearestTier, nearestResolution } from './sizeSpec';
import { extractJsonBlock } from './jsonPrompt';
import { STORY_SYSTEM, shotsSystem, parseShots, buildFixedBlock, composeShotPrompt, transitionsSystem, transitionsUser, parseTransitions } from './storyboardPrompt';
import { buildComfyControlValues, availableComfyModes } from './comfyDispatch';
import { assembleCartGrouped, PROMPT_MALL_SYSTEM, PROMPT_MALL_PARAGRAPH_SYSTEM, stripFences } from './promptMall/assemble';
import { buildThumbGenPrompt, THUMB_SEED } from './promptMall/thumbGen';
import type { PromptMallCard } from './promptMall/cardTypes';
import { buildLoopItems, chunkImages, type LoopItem } from './loopItems';
import { buildOutputName, srcBaseName } from './folderNaming';
import { beginLocalLlmBusy } from './localLlmBusy';
import { reconcileSegments, sameSegmentSrcs } from './videoClip';
import {
  SEGMENT_DETECT_SYSTEM,
  PROOF_SYSTEM,
  parseSegElements,
  parseProofElements,
  buildProofReport,
  severityColor
} from './visionSegment';
import { loadImageCors, cropToDataUri, compositeAtBoxes, drawAnnotated } from './imageCompose';
import type { OutputFile, InputControl } from '@shared/comfyui';
import type { VideoProgressPayload, VideoDonePayload, InterpProgressPayload, VecTaskProgressPayload } from '@shared/ipc';

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
  /** 上游视频来源（视频上传 / 视频生成 / 结果 / 缩放 产出的本地路径或 URL） */
  videos: string[];
  /** 上游尺寸来源（ratio 节点输出的 比例+宽高）；下游 work/video/comfy 取 sizes[0] 应用 */
  sizes: SizeSpec[];
  /**
   * 局部重绘/扩图：上游图片节点带的遮罩（OpenAI「透明=编辑区」PNG，dataURI 或落盘路径）。
   * 单底图单遮罩，取首个命中的图片节点。runWorkNode 见此 → 强制单任务走 /v1/images/edits + mask。
   */
  inpaintMask?: string;
  /** 与 inpaintMask 配对的底图（该图片节点的 src） */
  inpaintBase?: string;
  /** 全部上游图片节点带的遮罩（喂 ComfyUI 的 mask 控件用，Flux Fill / inpaint 工作流）。 */
  masks: string[];
}

/**
 * 沿连线向上游收集图片(src)与提示词(text)；group 节点透传其上游；附带 inputRefs 快照。
 * 纯函数（传入 nodes/edges），既给运行用，也给工作节点「实时预览上游」用。
 */
/**
 * 收集「某节点自身的产出」（图片/文本）到 images/prompts/refs，不沿连线遍历。
 * 用于分组子节点的内容识别：分组能识别归入其中的 图片/提示词/LLM/视角/缩放/生成/ComfyUI/结果 节点的内容。
 */
/** 图片节点向下游输出的图列表：列表模式取 srcs（自驱逐批运行中优先取「当前批」outBatch）；单图取 src。 */
export function imageNodeOutputs(im: ImageNodeData): string[] {
  if (im.listMode) {
    // 自驱逐批运行中：只喂「当前批」outBatch；其余时刻（含完成/重载）喂全部 srcs（防旧批残留泄漏）
    if ((im.runStatus === 'running' || im.runStatus === 'paused') && Array.isArray(im.outBatch) && im.outBatch.length > 0) {
      return im.outBatch.filter(Boolean);
    }
    return (im.srcs ?? []).filter(Boolean);
  }
  return im.src ? [im.src] : [];
}

/**
 * 提示词节点向下游输出的词列表：列表模式取 items（去空）；单条取 text。
 * 「统一提示词 / 前置提示词」：若设了 unifiedPrompt，则按 unifiedPos（前/后/两侧）拼进每一条——
 * 多段提示词逐条生图时不必在每个框重复输入同样的内容，形成规范性。
 */
export function promptNodeOutputs(pd: PromptNodeData): string[] {
  const base = pd.listMode
    ? (pd.items ?? []).map((t) => (t ?? '').trim()).filter(Boolean)
    : pd.text?.trim()
      ? [pd.text.trim()]
      : [];
  const uni = pd.unifiedPrompt?.trim();
  if (!uni || !base.length) return base;
  const pos = pd.unifiedPos ?? 'prefix';
  return base.map((t) =>
    pos === 'suffix' ? `${t}, ${uni}` : pos === 'both' ? `${uni}, ${t}, ${uni}` : `${uni}, ${t}`
  );
}

function collectOwnOutput(n: Node, images: string[], prompts: string[], refs: InputRef[], videos: string[], sizes: SizeSpec[]): void {
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
      const list = imageNodeOutputs(im);
      for (const s of list) images.push(s);
      if (list.length) refs.push({ kind: 'image', from: n.id, preview: im.listMode ? `${list.length} 张` : im.name ?? '图片' });
      break;
    }
    case 'prompt':
      for (const t of promptNodeOutputs(n.data as unknown as PromptNodeData)) pushText(t, n.id);
      break;
    case 'llm':
      pushText((n.data as unknown as LlmNodeData).resultText, n.id);
      break;
    case 'image-reverse':
    case 'video-reverse':
      pushText((n.data as unknown as { resultText?: string }).resultText, n.id);
      break;
    case 'storyboard': {
      // 每个分镜各是一条提示词（顺序喂下游，配合「多条提示词逐条生图」）
      const shots = (n.data as unknown as StoryboardNodeData).shots ?? [];
      for (const s of shots) pushText(s, n.id);
      break;
    }
    case 'angle-prompt':
      pushText((n.data as unknown as AnglePromptNodeData).generatedPrompt, n.id);
      break;
    case 'light':
      pushText((n.data as unknown as LightNodeData).generatedPrompt, n.id);
      break;
    case 'palette':
      pushText((n.data as unknown as PaletteNodeData).generatedPrompt, n.id);
      break;
    case 'video-source': {
      const src = (n.data as unknown as { src?: string }).src;
      if (src) videos.push(src);
      break;
    }
    case 'video': {
      const vp = (n.data as unknown as { videoPath?: string | null }).videoPath;
      if (vp) videos.push(vp);
      break;
    }
    case 'frame-interp':
    case 'video-clip': {
      const ov = (n.data as unknown as { outputVideo?: string | null }).outputVideo;
      if (ov) videos.push(ov);
      break;
    }
    case 'scale': {
      const sd = n.data as unknown as ScaleNodeData;
      if (sd.outputImage) {
        images.push(sd.outputImage);
        refs.push({ kind: 'image', from: n.id, preview: '缩放图' });
      }
      if (sd.outputVideo) videos.push(sd.outputVideo);
      break;
    }
    case 'upscale': {
      const ud = n.data as unknown as UpscaleNodeData;
      if (ud.outputImage) {
        images.push(ud.outputImage);
        refs.push({ kind: 'image', from: n.id, preview: '放大图' });
      }
      break;
    }
    case 'vectorize': {
      // SVG 终端产物：作图片来源喂给 结果/文件夹输出（连线规则已限制只能连这两者）
      const vd = n.data as unknown as VectorizeNodeData;
      if (vd.outputSvgPath) {
        images.push(vd.outputSvgPath);
        refs.push({ kind: 'image', from: n.id, preview: 'SVG' });
      }
      break;
    }
    case 'ratio': {
      const sp = ratioOutputSize(n.data as unknown as RatioNodeData);
      if (sp) sizes.push(sp);
      break;
    }
    case 'prompt-mall': {
      // 提示词商城合成产物（assembled）作文本喂下游（纯文本，无图片）
      const pmd = n.data as unknown as PromptMallNodeData;
      pushText(pmd.assembled, n.id);
      break;
    }
    case 'loop': {
      // 循环节点的「当前项」输出（runLoopNode 逐项写入）：仅在运行/暂停中有效——
      // 完成后这些是上一项的瞬态残留，不该泄漏给手动运行的下游（与 imageNodeOutputs 同一门控）。
      const ld = n.data as unknown as LoopNodeData;
      if (ld.status !== 'running' && ld.status !== 'paused') break;
      pushText(ld.outPrompt, n.id);
      if (ld.outSize) sizes.push(ld.outSize);
      const batch = ld.outImages?.length ? ld.outImages.filter(Boolean) : ld.outImage ? [ld.outImage] : [];
      for (const img of batch) images.push(img);
      if (batch.length) refs.push({ kind: 'image', from: n.id, preview: batch.length > 1 ? `当前批 ${batch.length} 张` : '循环当前图' });
      break;
    }
    case 'folder-input': {
      const fd = n.data as unknown as FolderInputNodeData;
      if (fd.files?.length) {
        images.push(...fd.files);
        refs.push({ kind: 'image', from: n.id, preview: `文件夹 ${fd.files.length} 张` });
      }
      if (fd.videoFiles?.length) videos.push(...fd.videoFiles);
      break;
    }
    case 'segment': {
      // 切分节点：拼合后的整图作图片来源喂下游
      const sd = n.data as unknown as SegmentNodeData;
      if (sd.composedSrc) {
        images.push(sd.composedSrc);
        refs.push({ kind: 'image', from: n.id, preview: '拼合图' });
      }
      break;
    }
    case 'proof': {
      // 对稿节点：审稿报告作文本喂下游（如指导重绘）
      pushText((n.data as unknown as ProofNodeData).reportText, n.id);
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
      if (r?.videos?.length) videos.push(...r.videos);
      break;
    }
  }
}

export function computeUpstream(nodes: Node[], edges: Edge[], workId: string): CollectedInputs {
  const images: string[] = [];
  const prompts: string[] = [];
  const refs: InputRef[] = [];
  const videos: string[] = [];
  const sizes: SizeSpec[] = [];
  // 局部重绘/扩图：首个「单图模式 + 带遮罩」的上游图片节点 → 单底图单遮罩
  let inpaintMask: string | undefined;
  let inpaintBase: string | undefined;
  const masks: string[] = []; // 全部上游遮罩（ComfyUI mask 控件用）
  const visited = new Set<string>();
  // 一次性建索引：computeUpstream 被几乎所有节点在每次 nodes/edges 变化时调用，
  // 若 walk 里对每个 target 都 edges.filter、对每条边都 nodes.find，就是 O(N×E)（大画布卡顿主因之一）。
  // 预建 nodeById / edgesByTarget / childrenByParent，把整趟遍历降到 O(N+E)。
  const nodeById = new Map<string, Node>();
  for (const x of nodes) nodeById.set(x.id, x);
  const edgesByTarget = new Map<string, Edge[]>();
  for (const e of edges) {
    const arr = edgesByTarget.get(e.target);
    if (arr) arr.push(e);
    else edgesByTarget.set(e.target, [e]);
  }
  const childrenByParent = new Map<string, Node[]>();
  for (const x of nodes) {
    if (!x.parentId) continue;
    const arr = childrenByParent.get(x.parentId);
    if (arr) arr.push(x);
    else childrenByParent.set(x.parentId, [x]);
  }
  const walk = (targetId: string): void => {
    for (const e of edgesByTarget.get(targetId) ?? []) {
      const sid = e.source;
      const n = nodeById.get(sid);
      if (!n) continue;
      // 分镜节点有两个输出口（out=分镜提示词 / out-trans=镜头转场提示词），按口分别收集（同源不同口不去重）
      const vkey = n.type === 'storyboard' ? `${sid}#${e.sourceHandle === 'out-trans' ? 'trans' : 'out'}` : sid;
      if (visited.has(vkey)) continue;
      visited.add(vkey);
      if (n.type === 'image' || n.type === 'prompt') {
        // 图片/提示词节点：列表模式（多图/多条）与单值统一走 collectOwnOutput
        collectOwnOutput(n, images, prompts, refs, videos, sizes);
        // 局部重绘：单图模式且带遮罩 → 记下底图+遮罩（首个命中即用，OpenAI 路径）；
        // 同时收集所有上游遮罩进 masks（ComfyUI mask 控件用）。
        if (n.type === 'image') {
          const im = n.data as unknown as ImageNodeData;
          if (im.inpaintMaskSrc) masks.push(im.inpaintMaskSrc);
          if (!inpaintMask && !im.listMode && im.src && im.inpaintMaskSrc) {
            inpaintBase = im.src;
            inpaintMask = im.inpaintMaskSrc;
          }
        }
      } else if (n.type === 'group') {
        walk(n.id); // 透传分组的「连线上游」
        // 分组容器化：归入该分组的子节点按「卡片顺序」（上→下、左→右）依次结合为前段→后段
        const children = (childrenByParent.get(n.id) ?? [])
          .slice()
          .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
        // 归入分组的子节点：识别每个子节点自身的产出（含结果/生成/ComfyUI/LLM/视角/缩放/视频的内容）。
        // 分组内的多条提示词**组合为一条**进 prompts（与「多条提示词逐条生图」规则配套：组=一条）。
        const groupPrompts: string[] = [];
        for (const child of children) collectOwnOutput(child, images, groupPrompts, refs, videos, sizes);
        const combined = groupPrompts.filter(Boolean).join('\n');
        if (combined) prompts.push(combined);
      } else if (n.type === 'result') {
        // 结果节点现在也能作上游来源：图片喂图、文本喂提示词、视频喂视频（统一集合的最近一次结果）
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
        if (r?.videos?.length) videos.push(...r.videos);
      } else if (n.type === 'video-source') {
        const src = (n.data as unknown as { src?: string }).src;
        if (src) videos.push(src);
      } else if (n.type === 'video') {
        const vp = (n.data as unknown as { videoPath?: string | null }).videoPath;
        if (vp) videos.push(vp);
      } else if (n.type === 'frame-interp' || n.type === 'video-clip') {
        // 插帧 / 视频剪辑 节点输出：处理后的视频喂下游
        const ov = (n.data as unknown as { outputVideo?: string | null }).outputVideo;
        if (ov) videos.push(ov);
      } else if (n.type === 'image-reverse' || n.type === 'video-reverse') {
        const t = (n.data as unknown as { resultText?: string }).resultText?.trim();
        if (t) {
          prompts.push(t);
          refs.push({ kind: 'prompt', from: n.id, preview: t.slice(0, 40) });
        }
      } else if (n.type === 'storyboard') {
        // 智能分镜：按输出口路由——上口（out）= 分镜提示词、下口（out-trans）= 镜头转场提示词，
        // 各自每条一条提示词按序进 prompts（下游生图/视频逐条按序）
        const sd = n.data as unknown as StoryboardNodeData;
        const list = e.sourceHandle === 'out-trans' ? sd.transitions ?? [] : sd.shots ?? [];
        for (const s of list) {
          const t = s.trim();
          if (t) {
            prompts.push(t);
            refs.push({ kind: 'prompt', from: n.id, preview: t.slice(0, 40) });
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
      } else if (n.type === 'light') {
        // 光源节点的输出当作上游提示词
        const t = (n.data as unknown as LightNodeData).generatedPrompt?.trim();
        if (t) {
          prompts.push(t);
          refs.push({ kind: 'prompt', from: n.id, preview: t.slice(0, 40) });
        }
      } else if (n.type === 'palette') {
        // 配色工具节点的输出（配色提示词）当作上游提示词
        const t = (n.data as unknown as PaletteNodeData).generatedPrompt?.trim();
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
        // 缩放节点输出：图→上游图片；视频→上游视频
        const sd = n.data as unknown as ScaleNodeData;
        if (sd.outputImage) {
          images.push(sd.outputImage);
          refs.push({ kind: 'image', from: n.id, preview: '缩放图' });
        }
        if (sd.outputVideo) videos.push(sd.outputVideo);
      } else if (n.type === 'ratio') {
        // 尺寸来源：只取其 SizeSpec 输出，不递归它接的分析图（图不泄漏给下游当参考图）
        const sp = ratioOutputSize(n.data as unknown as RatioNodeData);
        if (sp) sizes.push(sp);
      } else if (
        n.type === 'prompt-mall' ||
        n.type === 'loop' ||
        n.type === 'folder-input' ||
        n.type === 'segment' ||
        n.type === 'proof'
      ) {
        // 提示词商城产物/循环当前项/文件夹图片/切分拼合图/对稿报告：与分组子节点同一套自身产出识别
        collectOwnOutput(n, images, prompts, refs, videos, sizes);
      }
    }
  };
  walk(workId);
  return { images, prompts, refs, videos, sizes, inpaintMask, inpaintBase, masks };
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
// 工作节点 → 本轮全部在途 taskId（多条提示词并发时同节点可有多个任务；取消要一锅端）
const activeWorkTasks = new Map<string, Set<number>>();
// 会话内「正在跑」的工作节点 id（跨文档重载存活）：切档 / 回启动页时 sanitize 会把 running 落盘成 idle，
// resync 据此把仍在跑的节点拉回 running（比 activeWorkTasks 多覆盖「提交前的构建窗口」）。
const liveRunningNodes = new Set<string>();
function endWorkRun(workId: string): void {
  activeWorkTasks.delete(workId);
  liveRunningNodes.delete(workId);
}
/**
 * 把节点终态补丁也写进「当前文档」的持久化存储。否则切档 / 回启动页重载时用 sanitize 后的 idle
 * 覆盖了内存里的 success/error → 完成的结果在重载后丢失、节点显示「待运行」（本次 bug 的根因）。
 * result 里的图是磁盘路径（非 base64），体积可控；sanitize 只清 running 态、不动 success，故可安全 round-trip。
 */
function persistActiveDocTerminal(docId: string | null, nodeId: string, patch: Record<string, unknown>): void {
  if (docId) patchDocNodes(docId, [{ nodeId, patch }]);
}
// 工作节点 → 最近一次「逐条/逐张生图」的批次快照（内存态，重启清空；合集卡「重试此条」用）
// 每个 task = 一次完整生成（一条提示词 + 一组参考图）；逐张模式下各 task 的 refs 是不同的单张图。
interface WorkBatchSnapshot {
  batchId: string;
  tasks: Array<{ prompt: string; refs: string[] }>;
  params: Record<string, unknown>;
  modelId: string;
  negativePrompt?: string;
  perN: number;
  /** loop 运行方式时每个任务的轮数（每轮 perN 张）；重试需重放全部轮次，否则张数对不上 */
  rounds: number;
  seedBase: number | null;
}
const lastBatchByWork = new Map<string, WorkBatchSnapshot>();
function addActiveTask(workId: string, taskId: number): void {
  let s = activeWorkTasks.get(workId);
  if (!s) {
    s = new Set();
    activeWorkTasks.set(workId, s);
  }
  s.add(taskId);
}
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
        // 超时兜底：15 分钟还没等到 image:done 就放弃，清理 pending，避免节点永远卡 running。
        // 与主进程轮询硬上限（POLL_TIMEOUT_MS=15min）对齐——高峰期中转站排队 300~500s 很常见，
        // 历史上 180s/320s 的兜底都出现过「后台已出图、渲染端先判死丢弃」的误杀。
        const timer = setTimeout(() => {
          if (pendingWork.has(taskId)) {
            pendingWork.delete(taskId);
            finish({ images: [], error: '生成超时（15 分钟未返回）——高峰期中转站可能仍在排队，可到生图页任务列表查看，或重试' });
          }
        }, 900_000);
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

/** 按文档 id 取画布名（资产库分组用）；后台文档（在途任务结果回灌）也能取到正确的画布名。 */
function docNameById(docId: string | null): string | null {
  if (!docId) return null;
  const doc = useSmartDocsStore.getState().docs.find((d) => d.id === docId);
  const t = doc?.title?.trim();
  return t ? t.slice(0, 120) : null;
}

/** 当前画布名（资产库分组用：生成的图归入以画布名命名的文件夹）；无活动画布/匿名则返回 null。 */
function currentDocName(): string | null {
  return docNameById(useSmartDocsStore.getState().activeDocId);
}

/**
 * 把终态结果回灌到「非当前」文档（用户在生成途中切走了画布）：直接改该文档的持久化内容，
 * 包括源节点 + 其下游结果节点，落盘一次。不做 cascade（不在后台文档自动跑下游工作节点）。
 */
function placeResultInBackgroundDoc(docId: string, srcId: string, result: WorkResult, storeResults?: WorkResult[]): void {
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
  // 下游结果节点：累积到内存结果库（按节点 id），不写进文档（重启才清）。
  // 多提示词批次：按条 push（storeResults），结果节点据 batchId 聚合成合集卡。
  for (const c of doc.connections.filter((x) => x.source === srcId)) {
    const tgt = doc.nodes.find((n) => n.id === c.target);
    // 出错的结果不进结果节点（与当前文档路径一致）
    if (tgt?.type === 'result') for (const r of (storeResults ?? [result]).filter((x) => x.ok)) useSmartResultStore.getState().push(tgt.id, r);
  }
}

/** 写结果到工作节点（含 logs/error 显式字段）+ 推给下游结果节点；cascade 时继续跑下游工作节点。
 *  docId = 提交时所在文档；若已切走（!== 当前）→ 把终态回灌到那个文档的存储，避免结果丢失。
 *  storeResults：多提示词逐条生图时按条拆开的结果（含 batchId/shotIndex/prompt），
 *  推给结果节点用它（合集卡聚合）；工作节点 data.result 仍写合并总览（节点卡 UI 不变）。 */
function placeWorkResult(
  workId: string,
  result: WorkResult,
  cascade: boolean,
  visited: Set<string>,
  docId: string | null,
  storeResults?: WorkResult[]
): void {
  // 文件夹输出：结果归位统一汇集点（当前/后台文档都在这里出结果），每条到达即落盘
  notifyFolderOutputs(workId, storeResults?.length ? storeResults : [result], docId);
  if (docId && docId !== currentDocId()) {
    placeResultInBackgroundDoc(docId, workId, result, storeResults);
    return;
  }
  const st = useSmartCanvasStore.getState();
  const termPatch = {
    status: result.ok ? 'success' : 'error',
    result,
    logs: result.logs,
    error: result.error ?? null,
    taskId: undefined
  } as const;
  setWork(workId, termPatch);
  // 终态也落盘到当前文档：防切档 / 回启动页重载时被 sanitize 后的 idle 覆盖（节点显示「待运行」）。
  persistActiveDocTerminal(docId, workId, { ...termPatch });
  for (const e of st.edges.filter((x) => x.source === workId)) {
    const tgt = st.nodes.find((n) => n.id === e.target);
    if (tgt?.type === 'result') {
      // 累积到内存结果库（结果节点 = 统一集合，重启才清）；data.result 同步为最新供 computeUpstream。
      // 出错的结果不进结果节点（用户要求：失败只在生图节点自身显示错误，不污染结果集合）。
      for (const r of (storeResults ?? [result]).filter((x) => x.ok)) useSmartResultStore.getState().push(tgt.id, r);
      if (result.ok) st.updateNodeData(tgt.id, { result } as Partial<SmartNodeData>);
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

  // 记录上游输入快照（显式 inputRefs 字段）；新一轮运行清掉上次的取消标记与在途任务记录
  cancelledWork.delete(workId);
  endWorkRun(workId);
  setWork(workId, { inputRefs: inputs.refs, status: 'running', result: null, error: null, logs: [], taskId: undefined, lastRunAt: Date.now() });

  // 计时：从这里到出结果的耗时，注入到 WorkResult.durationMs（结果区显示「用时 X.Xs」）
  const t0 = Date.now();
  const place = (r: WorkResult, casc: boolean, storeResults?: WorkResult[]): void =>
    placeWorkResult(workId, { ...r, durationMs: Date.now() - t0 }, casc, visited, docId, storeResults);

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
  // 任务列表：每项 = 一次完整生成（一条提示词 + 一组参考图）。三种来源：
  //  ① 逐张处理输入图（imageEach，非纯文生图且有上游图）：每张图各一项，refs=[该图]；
  //     提示词配对：上游词数==图数（且>1）→ 按序 zip；否则每张都用同一条（ownPrompt+合并上游）。
  //  ② 多条上游提示词：每条一项，refs=全部上游图（现状；分组内多条已在 computeUpstream 合为一条）。
  //  ③ 单条（或无上游词）：合并为一条。
  const ownPrompt = d.prompt.trim();
  const upPrompts = inputs.prompts.map((p) => p.trim()).filter(Boolean);
  const allRefs = inputs.images;
  // 局部重绘/扩图：上游图片节点带遮罩 → 单底图单遮罩，走 /v1/images/edits + mask（见下方 baseParams.inpaint_mask）
  const doInpaint = !!(inputs.inpaintMask && inputs.inpaintBase);
  interface GenTask {
    prompt: string;
    refs: string[];
    label: string;
  }
  let taskList: GenTask[];
  if (doInpaint) {
    // 强制单任务（跳过 imageEach / 多提示词 / 多张 batch）：底图=带遮罩的那张图，遮罩定义编辑区
    const p = effectivePrompt(d, inputs.prompts);
    if (!p) {
      setWork(workId, { status: 'idle' });
      toast.error('局部重绘需要提示词', '连一个提示词节点，描述遮罩区要变成什么');
      return;
    }
    taskList = [{ prompt: p, refs: [inputs.inpaintBase as string], label: '局部重绘' }];
  } else if (d.imageEach && d.workType !== 'image-generation' && allRefs.length > 0) {
    const zip = upPrompts.length === allRefs.length && upPrompts.length > 1;
    const singlePrompt = effectivePrompt(d, inputs.prompts);
    taskList = allRefs.map((img, i) => ({
      prompt: zip ? [ownPrompt, upPrompts[i]].filter(Boolean).join('\n') : singlePrompt,
      refs: [img],
      label: `第 ${i + 1}/${allRefs.length} 张`
    }));
  } else if (upPrompts.length > 1) {
    taskList = upPrompts.map((p, i) => ({
      prompt: [ownPrompt, p].filter(Boolean).join('\n'),
      refs: allRefs,
      label: `第 ${i + 1}/${upPrompts.length} 条`
    }));
  } else {
    taskList = [{ prompt: effectivePrompt(d, inputs.prompts), refs: allRefs, label: '单次' }];
  }
  const multiTask = taskList.length > 1;
  if (d.workType === 'image-generation' && !taskList[0].prompt) {
    setWork(workId, { status: 'idle' });
    toast.error('请填写提示词');
    return;
  }
  const baseParams: Record<string, unknown> = {};
  // 来源标记：智能画布与生图主面板是两条并行线——生图页的「最近任务」据此过滤掉画布任务，互不污染数据集。
  // 该字段只进 generation_tasks.params（buildBody/resolveSize/applyBodyOverrides 都不读它，对出图无影响）。
  baseParams.source = 'smart-canvas';
  // 资产库分组：智能画布生成的图自动归入「以当前画布名命名」的文件夹（generate.ts 读 gallery_group 落 group_name）。
  const docName = currentDocName();
  if (docName) baseParams.gallery_group = docName;
  if (d.aspect) baseParams.aspect = d.aspect;
  // 比例「自动」（d.aspect 空）+ 图片编辑类：跟随首张输入图比例（量最近的常用比例；
  // 扩图后 src 已是扩展后的图，故"自动比例"天然包含扩图/遮罩区域）；文生图保持不发让模型自定
  else if (d.workType !== 'image-generation' && inputs.images.length) {
    const auto = await measureAspect(inputs.images[0]);
    if (auto) baseParams.aspect = auto;
  }
  if (d.imageSize) baseParams.image_size = d.imageSize;
  if (d.quality) baseParams.quality = d.quality;
  if (typeof d.strength === 'number' && d.workType !== 'image-generation') baseParams.strength = d.strength;
  // 上游「尺寸来源」节点优先覆盖比例/尺寸：精确宽高给能用的模型（gpt-image-2/default 经 resolveSize 优先 width/height），
  // image_size 档位给 nano-banana 这类只认档+比例的模型。
  const upSize = inputs.sizes[0];
  if (upSize) {
    const e = upSize.emit ?? 'both';
    if (e !== 'resolution') baseParams.aspect = upSize.aspect;
    if (e !== 'aspect') {
      baseParams.width = upSize.width;
      baseParams.height = upSize.height;
      baseParams.image_size = nearestTier(upSize.width * upSize.height);
    }
  }
  // 「自动」比例的解析结果回写节点供展示（运行后在节点「运行」按钮旁标注）：
  // d.aspect 为空时取实际用到的比例（来自首张输入图或上游尺寸节点），否则清空。
  setWork(workId, { autoAspect: !d.aspect && typeof baseParams.aspect === 'string' ? baseParams.aspect : undefined });
  // 局部重绘：把遮罩转成可发送的 data URI 塞进 params.inpaint_mask
  //（generate.ts 据此在 /v1/images/edits 带 mask 字段；遮罩落盘后是路径，sendableUrl 转回 dataURI）
  if (doInpaint) {
    const maskUri = await sendableUrl(inputs.inpaintMask as string);
    if (!maskUri) {
      setWork(workId, { status: 'idle' });
      toast.error('遮罩读取失败', '请在图片编辑器重新「设为局部重绘遮罩」');
      return;
    }
    baseParams.inpaint_mask = maskUri;
  }

  // 标记「正在跑」：从此刻（验证已过、即将提交）到终态，resync 据此在切档重载后把节点拉回 running。
  liveRunningNodes.add(workId);

  // 多轮规则：loop = 跑 n 次（每次 1 张，累积）；batch/serial/continue = 一次 n 张；single = 1 张
  const rounds = d.runMode === 'loop' ? Math.max(1, Math.min(8, d.n || 1)) : 1;
  const perN = d.runMode === 'loop' ? 1 : d.runMode === 'single' ? 1 : clampN(d.n);
  const negativePrompt = d.negativePrompt?.trim() || undefined;
  // seed：null/负 = 随机（不发）；loop 模式逐轮 +i 以产生差异
  // 上限 2e9（与随机 seed 同量级）：避免接近 MAX_SAFE_INTEGER 时 seedBase + i 丢精度
  const seedBase =
    typeof d.seed === 'number' && d.seed >= 0 ? Math.min(Math.trunc(d.seed), 2_000_000_000) : null;
  let firstErr: string | undefined;
  // 每个任务的产出按任务序归位（并发完成顺序不定，最终结果仍按连入顺序排列）
  const perTask: string[][] = taskList.map(() => []);
  // 每个任务的终态：undefined=未运行（前序失败而中止）/ null=成功 / string=该任务错误
  const perErr: Array<string | null | undefined> = taskList.map(() => undefined);
  const doneCount = (): number => perTask.reduce((a, arr) => a + arr.length, 0);
  // 批次 id：多任务（逐条/逐张）的全部结果共享，结果节点据此聚合成合集卡 + 支持单任务重试
  const batchId = multiTask ? crypto.randomUUID() : undefined;
  if (multiTask) {
    lastBatchByWork.set(workId, {
      batchId: batchId as string,
      tasks: taskList.map((t) => ({ prompt: t.prompt, refs: t.refs })),
      params: baseParams,
      modelId,
      negativePrompt,
      perN,
      rounds,
      seedBase
    });
  }

  /** 跑一个任务的全部轮次（rounds×perN）。返回该任务的图；首个错误记入 firstErr 即止。 */
  const runOneTask = async (task: GenTask, ti: number, reportRound: boolean): Promise<string[]> => {
    const out: string[] = [];
    for (let i = 0; i < rounds; i++) {
      if (cancelledWork.has(workId) || firstErr) break;
      if (reportRound && (rounds > 1 || multiTask)) {
        const head = multiTask ? task.label : `第 ${i + 1}/${rounds} 轮`;
        setWork(workId, {
          logs: [`运行中：${head}（已 ${doneCount() + out.length} 张）`],
          result: doneCount() + out.length ? imgResult(d, [...perTask.flat(), ...out], ['运行中…']) : null
        });
      }
      const roundParams: Record<string, unknown> = { ...baseParams, n: perN };
      // 多任务时每任务 seed 间隔 1000，避免不同任务撞同 seed 出重复图
      if (seedBase != null) roundParams.seed = seedBase + i + ti * 1000;
      const res = await generateOnce(modelId, task.prompt, roundParams, task.refs, negativePrompt, (tid) => {
        addActiveTask(workId, tid);
        setWork(workId, { taskId: tid });
      });
      if (cancelledWork.has(workId)) break;
      if (res.error) {
        firstErr = firstErr ?? res.error;
        perErr[ti] = res.error;
        break;
      }
      out.push(...res.images);
    }
    if (perErr[ti] === undefined && out.length) perErr[ti] = null; // 成功
    return out;
  };

  if (multiTask && d.promptConcurrency) {
    // 中转站支持并发：全部任务同时提交（主进程队列调度），结果按任务序归位
    setWork(workId, { logs: [`并发生成 ${taskList.length} 个任务…`] });
    await Promise.all(
      taskList.map(async (t, ti) => {
        perTask[ti] = await runOneTask(t, ti, false);
      })
    );
  } else {
    // 顺序：按连入顺序逐任务（失败即止，不再烧后续任务）
    for (let ti = 0; ti < taskList.length; ti++) {
      if (cancelledWork.has(workId) || firstErr) break;
      perTask[ti] = await runOneTask(taskList[ti], ti, true);
    }
  }

  // 用户中途取消：cancelWork 已把节点重置 idle，这里直接收尾不写结果
  if (cancelledWork.has(workId)) {
    cancelledWork.delete(workId);
    endWorkRun(workId);
    return;
  }
  endWorkRun(workId);
  const allImages = perTask.flat();

  if (firstErr && allImages.length === 0) {
    place(errResult(d, firstErr), false);
    toast.error(firstErr);
    return;
  }
  const extraLogs: string[] = [];
  if (multiTask) {
    const kind = d.imageEach && d.workType !== 'image-generation' && inputs.images.length ? '逐张生图' : '逐条生图';
    extraLogs.push(`${kind} ${taskList.length} 个（${d.promptConcurrency ? '并发' : '顺序'}）`);
  }
  if (rounds > 1) extraLogs.push(`循环 ${rounds} 轮`);
  if (firstErr) extraLogs.push(`部分失败：${firstErr}`);
  const merged = imgResult(d, allImages, extraLogs);
  if (!multiTask) {
    // 单任务：照旧一条结果（补 prompt/createdAt/sourceNodeId 供合集/预览展示）
    place({ ...merged, prompt: taskList[0].prompt, createdAt: Date.now(), sourceNodeId: workId }, cascade);
    return;
  }
  // 多任务：按任务拆成独立 WorkResult 推给结果节点（同 batchId → 合集卡），
  // 失败/未运行的任务也占位（ok:false，合集卡里可「重试此条」）。
  const now = Date.now();
  const perResults: WorkResult[] = taskList.map((t, ti) => {
    const imgs = perTask[ti];
    const e = perErr[ti];
    const okFlag = imgs.length > 0 && e == null;
    const base = okFlag
      ? imgResult(d, imgs, [t.label])
      : errResult(d, e ?? '未运行（前序任务失败而中止，可在合集里单条重试）');
    return { ...base, images: imgs, prompt: t.prompt, createdAt: now, batchId, shotIndex: ti, durationMs: now - t0, sourceNodeId: workId };
  });
  place({ ...merged, batchId, createdAt: now }, cascade, perResults);
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
  // 该节点本轮的全部在途任务（多条提示词并发时不止一个）+ 节点上记录的最近 taskId，一并取消
  const ids = new Set<number>(activeWorkTasks.get(workId) ?? []);
  if (typeof d.taskId === 'number') ids.add(d.taskId);
  for (const tid of ids) {
    void window.electronAPI.image.cancel(tid);
    // 抛弃该任务的 pending resolver：唤醒 awaiting 的 generateOnce（resolve 空），并忽略迟到的 image:done
    const cb = pendingWork.get(tid);
    if (cb) {
      pendingWork.delete(tid);
      cb({ taskId: tid, cancelled: true });
    }
  }
  endWorkRun(workId);
  setWork(workId, { status: 'idle', result: null, error: null, logs: ['已取消，可重新运行'], taskId: undefined });
}

/**
 * 单条重试：重跑最近一次「多条提示词逐条生图」批次中的第 pi 条（合集卡「重试此条」入口）。
 * 结果以同 batchId + shotIndex 推给下游结果节点 → 合集卡里该条状态翻新（聚合层取同位最新）。
 */
export async function retryPromptIndex(workId: string, pi: number): Promise<void> {
  const batch = lastBatchByWork.get(workId);
  const task = batch?.tasks[pi];
  if (!batch || !task) {
    toast.error('没有可重试的批次记录', '批次快照只在本次会话内保留，重新运行该生图节点即可');
    return;
  }
  const st = useSmartCanvasStore.getState();
  const node = st.nodes.find((n) => n.id === workId);
  if (!node || node.type !== 'work') return;
  const d = node.data as unknown as WorkNodeData;
  if (d.status === 'running') {
    toast.error('该节点正在运行', '等本轮结束或先取消');
    return;
  }
  const docId = currentDocId();
  const t0 = Date.now();
  cancelledWork.delete(workId);
  liveRunningNodes.add(workId);
  setWork(workId, { status: 'running', error: null, logs: [`重试第 ${pi + 1}/${batch.tasks.length} 个任务…`] });
  // 重放该任务的全部轮次（loop 运行方式 rounds>1 时每个任务原本就出 rounds×perN 张；只跑一次会张数对不上）
  const rounds = Math.max(1, batch.rounds || 1);
  const imgs: string[] = [];
  let retryErr: string | undefined;
  for (let i = 0; i < rounds; i++) {
    if (cancelledWork.has(workId)) break;
    const params: Record<string, unknown> = { ...batch.params, n: batch.perN };
    if (batch.seedBase != null) params.seed = batch.seedBase + i + pi * 1000;
    const res = await generateOnce(batch.modelId, task.prompt, params, task.refs, batch.negativePrompt, (tid) => {
      addActiveTask(workId, tid);
      setWork(workId, { taskId: tid });
    });
    if (cancelledWork.has(workId)) break;
    if (res.error) {
      retryErr = res.error;
      break;
    }
    imgs.push(...res.images);
  }
  endWorkRun(workId);
  if (cancelledWork.has(workId)) return void cancelledWork.delete(workId);
  const now = Date.now();
  const base = retryErr && imgs.length === 0 ? errResult(d, retryErr) : imgResult(d, imgs, [`重试第 ${pi + 1} 个`]);
  const wr: WorkResult = {
    ...base,
    images: imgs,
    prompt: task.prompt,
    createdAt: now,
    batchId: batch.batchId,
    shotIndex: pi,
    durationMs: now - t0,
    sourceNodeId: workId
  };
  placeWorkResult(workId, wr, false, new Set(), docId, [wr]);
  if (retryErr && imgs.length === 0) toast.error('重试失败', retryErr);
  else toast.success(`第 ${pi + 1} 个重试完成`, `${imgs.length} 张`);
}

/** 把文本结果推给下游结果节点（结果节点统一集合现已支持文本/视频）。 */
function pushTextDownstream(srcId: string, text: string, label: string, handleId?: string): void {
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
  // handleId 指定时只推该输出口的连线（多输出口节点：分镜口/转场口各推各的）
  for (const e of st.edges.filter((x) => x.source === srcId && (handleId === undefined || (x.sourceHandle ?? 'out') === handleId))) {
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
  refine: '你是对话完善助手。把输入打磨得更清晰、完整、可执行，直接输出完善后的文本，不要解释。',
  'to-json':
    '你是「提示词结构化」助手。把用户输入的自然语言图像/视频提示词转成结构化 JSON。要求：用常用字段组织——subject(主体)/scene(场景)/composition(构图景别)/lighting(光线)/color(色调)/style(风格媒介)/mood(氛围)/camera(镜头，可嵌套 lens/angle/aperture)/quality(质感细节)/negative(负向，可选)；只输出输入里明确或可合理推断的字段，没有的不要编造、不要留空字段；值用与输入相同的语言（中文输入→中文值），保持原意；只输出合法 JSON 本身，不要解释、不要 markdown 代码围栏、不要任何前后缀文字。'
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
    useLlmHistoryStore.getState().recordOp('reverse', d.modelId, `（图片反推 · ${d.reverseType ?? 'description'}）`, text);
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
  // 「外接上游文本」开启时：上游提示词作为额外指令（注入 systemPrompt），待处理文本只取本节点 input；
  // 否则（默认）：上游提示词与本地 input 合并作为待处理文本，instruction 取本地填写。
  const fromUp = !!d.instructionFromUpstream && up.prompts.length > 0;
  const effInstruction = fromUp ? up.prompts.join('\n') : d.instruction;
  const userInput = fromUp ? d.input.trim() : [d.input.trim(), ...up.prompts].filter(Boolean).join('\n');
  if (!userInput) {
    setLlm(llmId, { status: 'idle' });
    toast.error('没有可处理的文本', fromUp ? '「外接上游文本」已把上游用作指令，请在节点里填入待处理文本' : '在节点里输入文字，或连一个提示词节点进来');
    return;
  }
  const r = await window.electronAPI.chat.optimizePrompt({
    planId,
    modelId: d.modelId,
    userInput,
    systemPrompt: llmSystemPrompt(d.op, effInstruction)
  });
  if (!r.ok) {
    setLlm(llmId, { status: 'error', error: r.error.message, logs: [r.error.message] });
    toast.error(r.error.message, r.error.hint);
    return;
  }
  // to-json：把模型回复清成纯 JSON（去 ``` 围栏 / 取首个平衡 JSON 块 / 校验美化），其它操作原样
  const outText = d.op === 'to-json' ? extractJsonBlock(r.data.optimized) : r.data.optimized;
  if (r.data.optimizedBy === null) {
    // 模型有效性已在 pre-flight 校验过；走到这里多半是上游超时/报错/空响应被后端回退了原文
    const why = r.data.reason ? `上游报错：${r.data.reason}` : '上游可能超时或报错';
    setLlm(llmId, {
      status: 'success',
      resultText: outText,
      logs: [`优化调用未生效（${why}），已回退原文`]
    });
    pushTextDownstream(llmId, outText, LLM_OP_LABELS[d.op]);
    toast.error('优化未生效，已回退原文', `${why}；稍后重试，或换个对话模型`);
    return;
  }
  setLlm(llmId, {
    status: 'success',
    resultText: r.data.optimized,
    logs: [`${LLM_OP_LABELS[d.op]} · ${d.modelId} · ${took()}`]
  });
  useLlmHistoryStore.getState().recordOp(d.op, d.modelId, userInput, r.data.optimized);
  pushTextDownstream(llmId, r.data.optimized, LLM_OP_LABELS[d.op]);
}

// ─────────────────────────────────────────────────────────────
// 智能分镜节点：故事素材（文本 + 可选参考图自动反推）→ ① LLM 生成完整故事 →
// ② 按数量拆成 N 条结构化分镜（{scene,shot,detail}）→ ③ 渲染端把固定约束段
// （角色/风格/镜头/色彩/世界观/场景/服装）拼进每条 → 成品提示词喂下游。
// 复用 api:chat:optimize-prompt + api:lab:reverse（零新 IPC）。
// 提示词结构与解析的纯函数在 src/lib/storyboardPrompt.ts（配 vitest）。
// ─────────────────────────────────────────────────────────────

function setSb(id: string, patch: Partial<StoryboardNodeData>): void {
  useSmartCanvasStore.getState().updateNodeData(id, patch as Partial<SmartNodeData>);
}

/** 合并旧 style 字段进 constraints（兼容旧画布文档）。 */
function sbConstraints(d: StoryboardNodeData): StoryboardConstraints {
  const c = { ...(d.constraints ?? {}) };
  const legacy = (d.style ?? '').trim();
  if (legacy && !c.style?.trim()) c.style = legacy;
  return c;
}

interface SbPrereq {
  d: StoryboardNodeData;
  planId: number;
}

/** 分镜运行的公共预检：节点存在 / 模型可用 / 方案可用。失败已 toast，返回 null。 */
function sbPrereq(id: string): SbPrereq | null {
  const st = useSmartCanvasStore.getState();
  const node = st.nodes.find((n) => n.id === id);
  if (!node || node.type !== 'storyboard') return null;
  const d = node.data as unknown as StoryboardNodeData;
  if (!d.modelId) {
    toast.error('请先在节点上选一个对话模型');
    return null;
  }
  const sset = useSettingsStore.getState();
  const why = diagnoseChatModel(sset.configs, sset.plans, sset.activePlanId, d.modelId);
  if (why) {
    setSb(id, { status: 'error', error: why, logs: [why] });
    toast.error('该对话模型不可用', why);
    return null;
  }
  if (sset.activePlanId === null) {
    toast.error('没有可用方案', '先在设置页建一个方案并配置对话模型');
    return null;
  }
  return { d, planId: sset.activePlanId };
}

/** 故事 → N 条分镜（拆分步，可单独重试）。成功写 shots/shotsMeta 并推下游。 */
async function sbSplitShots(id: string, planId: number, d: StoryboardNodeData, story: string, t0: number): Promise<void> {
  const count = Math.max(2, Math.min(20, d.shotCount || 4));
  const constraints = sbConstraints(d);
  const fixed = buildFixedBlock(constraints);
  const r2 = await window.electronAPI.chat.optimizePrompt({
    planId,
    modelId: d.modelId,
    userInput: story,
    systemPrompt: shotsSystem(count, !!fixed)
  });
  if (!r2.ok || r2.data.optimizedBy === null) {
    const msg = (!r2.ok ? r2.error.message : r2.data.reason) || '拆分分镜失败（上游超时/报错）';
    setSb(id, { status: 'error', error: `${msg}（故事已生成，可点「重拆分镜」只重试这一步）`, logs: [msg] });
    toast.error('拆分分镜失败', msg);
    return;
  }
  const parsed = parseShots(r2.data.optimized, count);
  if (!parsed.shots.length) {
    const msg = '未能从模型回复解析出分镜，换个对话模型或减少分镜数量再试（故事已生成，可「重拆分镜」）';
    setSb(id, { status: 'error', error: msg, logs: [msg] });
    toast.error('拆分分镜失败', msg);
    return;
  }
  // 固定约束段由代码拼进每条成品提示词（一致性不依赖模型自觉）；meta 仅作展示
  const shots = parsed.shots.map((s) => composeShotPrompt(fixed, s));
  setSb(id, {
    shots,
    shotsMeta: parsed.meta,
    lastStage: 'shots',
    error: null,
    logs: [`${shots.length} 个分镜已生成，正在生成镜头转场…`]
  });
  // 下游结果节点同步看到全部分镜文本（仅分镜口 out 的连线）
  pushTextDownstream(id, shots.map((s, i) => `【分镜 ${i + 1}】${s}`).join('\n\n'), '智能分镜', 'out');
  // ③ 分镜 → 镜头转场动态（N-1 条；失败不连坐：分镜已落，可「重生转场」单独重试）
  await sbGenTransitions(id, planId, d, shots, t0);
}

/** 分镜 → 镜头之间的转场动态提示词（N-1 条：运动轨迹/运镜衔接/场景过渡/主体延续）。
 *  失败只影响转场（分镜不回滚），节点仍置 success + toast 提示可「重生转场」。 */
async function sbGenTransitions(id: string, planId: number, d: StoryboardNodeData, shots: string[], t0: number): Promise<void> {
  const finish = (transitions: string[], note: string): void => {
    setSb(id, {
      status: 'success',
      transitions,
      logs: [`完成：${shots.length} 分镜${transitions.length ? ` + ${transitions.length} 转场` : ''} · ${d.modelId} · 用时 ${((Date.now() - t0) / 1000).toFixed(1)}s${note}`]
    });
  };
  if (shots.length < 2) {
    finish([], '');
    toast.success(`已生成 ${shots.length} 个分镜`);
    return;
  }
  const r = await window.electronAPI.chat.optimizePrompt({
    planId,
    modelId: d.modelId,
    userInput: transitionsUser(shots),
    systemPrompt: transitionsSystem(shots.length)
  });
  if (!r.ok || r.data.optimizedBy === null) {
    const msg = (!r.ok ? r.error.message : r.data.reason) || '转场生成失败（上游超时/报错）';
    finish([], '（转场生成失败，可「重生转场」）');
    toast.info('镜头转场生成失败（分镜不受影响）', `${msg}；可点「重生转场」单独重试`);
    return;
  }
  const transitions = parseTransitions(r.data.optimized, shots.length);
  finish(transitions, '');
  // 下游结果节点同步看到全部转场文本（仅转场口 out-trans 的连线）
  pushTextDownstream(id, transitions.map((s, i) => `【转场 ${i + 1}→${i + 2}】${s}`).join('\n\n'), '镜头转场', 'out-trans');
  toast.success(`已生成 ${shots.length} 个分镜 + ${transitions.length} 条镜头转场`);
}

/** 只重新生成「镜头转场」（分镜已生成时单独重试，省故事 + 拆分两次调用）。 */
export async function rerunStoryboardTransitions(id: string): Promise<void> {
  const pre = sbPrereq(id);
  if (!pre) return;
  const { d, planId } = pre;
  const shots = d.shots ?? [];
  if (shots.length < 2) {
    toast.error('分镜不足 2 条', '先生成分镜（转场是相邻分镜之间的衔接）');
    return;
  }
  setSb(id, { status: 'running', error: null, logs: [`重新生成镜头转场（${shots.length - 1} 条）…`] });
  await sbGenTransitions(id, planId, d, shots, Date.now());
}

/** 运行智能分镜节点：参考图分析（可选）→ 完整故事 → N 条分镜提示词。 */
export async function runStoryboardNode(id: string): Promise<void> {
  const pre = sbPrereq(id);
  if (!pre) return;
  const { d, planId } = pre;
  const st = useSmartCanvasStore.getState();
  const up = computeUpstream(st.nodes, st.edges, id);
  const textMaterial = [d.input.trim(), ...up.prompts].filter(Boolean).join('\n');
  const refImages = up.images.slice(0, 3); // 最多 3 张，控制成本
  if (!textMaterial && !refImages.length) {
    toast.error('没有故事素材', '在节点里输入故事/短句，或连提示词、参考图、提示词商城节点进来');
    return;
  }
  const t0 = Date.now();
  const totalSteps = refImages.length ? 3 : 2;
  setSb(id, { status: 'running', error: null, logs: [`1/${totalSteps} ${refImages.length ? '分析参考图…' : '生成完整故事…'}`], shots: [], shotsMeta: undefined, transitions: undefined, analysis: undefined });

  // ⓪ 参考图 → 视觉反推（复用 api:lab:reverse；单张失败降级继续，不整体失败）
  let analysis = '';
  if (refImages.length) {
    const visionModel = (d.analysisModelId ?? '').trim() || d.modelId;
    const parts: string[] = [];
    for (let i = 0; i < refImages.length; i++) {
      const r = await window.electronAPI.lab.reverse({
        imagePaths: [refImages[i]],
        modelId: visionModel,
        resultType: 'description'
      });
      if (r.ok) {
        const res = (r.data as { result?: unknown }).result;
        const text = typeof res === 'string' ? res.trim() : '';
        if (text) parts.push(`图${i + 1}：${text}`);
      } else {
        setSb(id, { logs: [`参考图 ${i + 1} 分析失败（${r.error.message}），跳过继续`] });
      }
    }
    if (parts.length) {
      analysis = `【参考图分析】\n${parts.join('\n')}`;
      setSb(id, { analysis });
    }
    setSb(id, { logs: [`2/${totalSteps} 生成完整故事…`] });
  }

  const material = [textMaterial, analysis].filter(Boolean).join('\n\n');
  if (!material) {
    const msg = '参考图分析全部失败且无文本素材，检查视觉模型是否可用';
    setSb(id, { status: 'error', error: msg, logs: [msg] });
    toast.error('生成故事失败', msg);
    return;
  }

  // ① 素材（文本 + 参考图分析）→ 完整故事
  const r1 = await window.electronAPI.chat.optimizePrompt({
    planId,
    modelId: d.modelId,
    userInput: material,
    systemPrompt: STORY_SYSTEM
  });
  if (!r1.ok || r1.data.optimizedBy === null) {
    const msg = (!r1.ok ? r1.error.message : r1.data.reason) || '生成故事失败（上游超时/报错）';
    setSb(id, { status: 'error', error: msg, logs: [msg] });
    toast.error('生成故事失败', msg);
    return;
  }
  const story = r1.data.optimized.trim();
  // 故事先落节点（拆分失败也保留，可「重拆分镜」省一次故事调用）
  setSb(id, { story, lastStage: 'story', logs: [`${totalSteps}/${totalSteps} 拆分 ${Math.max(2, Math.min(20, d.shotCount || 4))} 个分镜…`] });

  // ② 故事 → N 条分镜
  await sbSplitShots(id, planId, d, story, t0);
}

/** 只重试「拆分分镜」步（故事已生成时省一次故事调用 + 不重新分析参考图）。 */
export async function rerunStoryboardShots(id: string): Promise<void> {
  const pre = sbPrereq(id);
  if (!pre) return;
  const { d, planId } = pre;
  const story = (d.story ?? '').trim();
  if (!story) {
    toast.error('还没有生成故事', '先点「生成分镜」完整跑一遍');
    return;
  }
  const t0 = Date.now();
  setSb(id, { status: 'running', error: null, logs: ['重拆分镜中…'] });
  await sbSplitShots(id, planId, d, story, t0);
}

// ─────────────────────────────────────────────────────────────
// LLM 节点的「流式聊天」块：复用 api:chat:send + chat:chunk/chat:done
// 每个 LLM 节点一个会话（懒创建）；按 messageId 路由流式片段回该节点。
// ─────────────────────────────────────────────────────────────

const pendingChat = new Map<string, string>(); // messageId → llm 节点 id
// messageId → 本地推理降效（data-busy）的解除回调（非本地模型为 no-op；chat:done 时调用）
const pendingChatBusyEnd = new Map<string, () => void>();

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

  // 待发送的完整消息序列 = 既有历史 + 本轮新 user（不含流式占位的空 assistant）。
  const sendMessages: ChatMsg[] = [...d.chatMessages, { role: 'user', content: trimmed }];
  // 节点显示：再追加一条空 assistant 占位，流式片段往里追加。
  const msgs: ChatMsg[] = [...sendMessages, { role: 'assistant', content: '' }];
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

  // 本地大模型推理中 → html data-busy 降效（chat:done 解除；非本地模型为 no-op）
  const endBusy = beginLocalLlmBusy(d.modelId ?? '');
  // 无状态发送：不落 conversations/messages 表、不进生图页对话列表（与生图对话**互不互通**）；
  // 每次都带「节点当前 modelId + 完整消息序列」，模型永远跟随节点选择（修复切模型后仍报旧模型错）。
  const r = await window.electronAPI.chat.sendEphemeral({
    planId,
    modelId: d.modelId,
    messages: sendMessages,
    attachedImages: attached && attached.length ? attached : undefined
  });
  if (!r.ok) {
    endBusy();
    finalizeChat(nodeId, `（出错：${r.error.message}）`);
    toast.error(r.error.message, r.error.hint);
    return;
  }
  pendingChat.set(r.data.messageId, nodeId);
  pendingChatBusyEnd.set(r.data.messageId, endBusy);
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
  pendingChatBusyEnd.get(p.id)?.();
  pendingChatBusyEnd.delete(p.id);
  const nodeId = pendingChat.get(p.id);
  if (!nodeId) return;
  pendingChat.delete(p.id);
  finalizeChat(nodeId, p.error ? `（出错：${p.error}）` : undefined);
  // 正常完成才记入 LLM 历史（出错/中断不记）；与生图对话隔离，存 localStorage 跨重启可调用。
  if (!p.error && !p.cancelled) {
    const d = getLlm(nodeId);
    if (d) useLlmHistoryStore.getState().recordChat(nodeId, d.modelId, d.chatMessages);
  }
}

// ─────────────────────────────────────────────────────────────
// ComfyUI 节点：绑定「工作流」模块保存的模板 → api:comfyui:run-single
// 进度/结果走 comfyui:run-done（页面订阅 → routeComfyDone）
// ─────────────────────────────────────────────────────────────

// 进行中：comfyui runId → { comfy 节点 id, 提交时文档 id, 起始时间, defer }（切文档后把结果回灌正确文档 + 计时）
// defer=true（批量「逐条执行」）：routeComfyDone 不直接落节点，把 outcome 交给 resolver，由批量驱动器按条归位。
const pendingComfy = new Map<string, { comfyId: string; docId: string | null; startedAt: number; defer?: boolean }>();
// runId → resolver：让 runComfyNode 能 await 到「真正完成」（结果走 comfyui:run-done 异步回来）。
// 供「运行自动跑上游」用：上游 ComfyUI 出齐图后才跑下游。defer 模式下 resolver 收到 ComfyOutcome。
const pendingComfyResolve = new Map<string, (outcome?: ComfyOutcome) => void>();

/** 一次工作流运行的终态（批量「逐条执行」按条归位用）。 */
interface ComfyOutcome {
  ok: boolean;
  images: string[];
  texts?: string[];
  error?: string;
  cancelled?: boolean;
  durationMs: number;
}

// ComfyUI 节点批量「逐条执行」的快照（内存态；合集卡「重试此条」用，对齐 lastBatchByWork）
interface ComfyBatchSnapshot {
  batchId: string;
  mode: 'per-prompt' | 'per-image';
  items: string[];
  prompts: string[];
  images: string[];
  masks?: string[];
  size?: SizeSpec;
  controls: InputControl[];
  baseControlValues: Record<string, unknown>;
  bindings?: ComfyNodeData['inputBindings'];
  workflowId: string;
  templateName: string;
}
const lastComfyBatch = new Map<string, ComfyBatchSnapshot>();
// 批量循环的取消标记（cancelComfy/forceResetComfy 置入；批量驱动器项间检查）
const cancelledComfyBatch = new Set<string>();

function setComfy(id: string, patch: Partial<ComfyNodeData>): void {
  useSmartCanvasStore.getState().updateNodeData(id, patch as Partial<SmartNodeData>);
}

// 「上游 → 控件值」分发已抽到纯函数 src/lib/comfyDispatch.ts（配 vitest）；
// 这里 re-export 供 NodeInspector 等既有调用点继续从 runner 导入。
export { comfyInputSlots, comfySizeRole } from './comfyDispatch';

type ComfySubmitResult =
  | { kind: 'submit-error'; message: string; hint?: string }
  | { kind: 'timeout' }
  | { kind: 'done'; outcome?: ComfyOutcome };

/**
 * 提交一次工作流并等 comfyui:run-done（封装 runSingle + pendingComfy + 15 分钟兜底 + 90s 提示）。
 * defer=true 时 routeComfyDone 不落节点、把 outcome 交回这里（批量逐条归位）。
 */
async function submitComfyAndWait(
  comfyId: string,
  workflowId: string,
  cv: Record<string, unknown>,
  docId: string | null,
  defer: boolean,
  skipGallery = false
): Promise<ComfySubmitResult> {
  // 出图归入「以画布名命名」的文件夹（与生图节点一致）；skipGallery（商城缩略图）不分组。
  const galleryGroup = skipGallery ? undefined : (docNameById(docId) ?? undefined);
  const r = await window.electronAPI.comfyui.runSingle({ workflowId, controlValues: cv, skipGallery, galleryGroup });
  if (!r.ok) return { kind: 'submit-error', message: r.error.message, hint: r.error.hint };
  const runId = r.data.runId;
  pendingComfy.set(runId, { comfyId, docId, startedAt: Date.now(), defer });
  setComfy(comfyId, { runId });
  return await new Promise<ComfySubmitResult>((resolve) => {
    const timer = setTimeout(() => {
      pendingComfyResolve.delete(runId);
      pendingComfy.delete(runId);
      resolve({ kind: 'timeout' });
    }, 900_000);
    // 90s 仍未完成给一次温和提示（万一 run-done 丢失，用户不至于干等到 15 分钟才发觉异常）
    const nudge = setTimeout(() => {
      if (pendingComfyResolve.has(runId)) toast.info('ComfyUI 仍在运行中', '复杂工作流较慢，请耐心等待或点节点上的「取消」');
    }, 90_000);
    pendingComfyResolve.set(runId, (outcome) => {
      clearTimeout(timer);
      clearTimeout(nudge);
      resolve({ kind: 'done', outcome });
    });
  });
}

/**
 * 运行一个 ComfyUI 节点（整个工作流当黑盒）。
 * merge（缺省）：上游提示词/图片一次性分发进输入槽（buildComfyControlValues，与历史行为等价）。
 * per-prompt / per-image（multiMode）：逐条提示词 / 逐张图各跑一遍完整工作流（runComfyBatch）。
 * 其余参数都用「工作流」页里调好的值；图片控件需在模板里配 file_upload 绑定。
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
  const dispatchInput = { prompts: up.prompts, images: up.images, masks: up.masks, size: up.sizes[0] };

  // 批量模式：满足条件时走逐条驱动器（不满足回退 merge 并提示）
  const mode = d.multiMode ?? 'merge';
  if (mode !== 'merge') {
    if (availableComfyModes(d.controls, dispatchInput).includes(mode)) {
      await runComfyBatch(comfyId, mode, d, dispatchInput);
      return;
    }
    toast.info('逐条执行条件不满足，本次按「单次（合并分发）」运行', '需要多条提示词 / 多张图与匹配的输入控件');
  }

  const cv = buildComfyControlValues(d.controls, d.controlValues, dispatchInput, undefined, d.inputBindings);
  const docId = currentDocId();
  setComfy(comfyId, { status: 'running', error: null, logs: [], result: null });
  const r = await submitComfyAndWait(comfyId, d.workflowId, cv, docId, false);
  if (r.kind === 'submit-error') {
    setComfy(comfyId, { status: 'error', error: r.message, logs: [r.message] });
    toast.error(r.message, r.hint);
  }
  // timeout / done：与历史行为一致（done 的落节点在 routeComfyDone；timeout 留给「强制重置」救）
}

/** ComfyUI 批量逐条执行：每条/每张单独跑一遍完整工作流，失败跳过继续（可单条重试），结果按 batchId 聚合成合集卡。 */
async function runComfyBatch(
  comfyId: string,
  mode: 'per-prompt' | 'per-image',
  d: ComfyNodeData,
  input: { prompts: string[]; images: string[]; masks?: string[]; size?: SizeSpec }
): Promise<void> {
  const items = mode === 'per-prompt' ? input.prompts : input.images;
  const batchId = crypto.randomUUID();
  const docId = currentDocId();
  lastComfyBatch.set(comfyId, {
    batchId,
    mode,
    items,
    prompts: input.prompts,
    images: input.images,
    masks: input.masks,
    size: input.size,
    controls: d.controls,
    baseControlValues: d.controlValues,
    bindings: d.inputBindings,
    workflowId: d.workflowId,
    templateName: d.templateName
  });
  cancelledComfyBatch.delete(comfyId);
  setComfy(comfyId, { status: 'running', error: null, result: null, logs: [`逐条执行：共 ${items.length} 项`] });
  const t0 = Date.now();
  let okCount = 0;
  let failCount = 0;
  const allImages: string[] = [];
  const allTexts: string[] = [];
  let cancelled = false;
  for (let i = 0; i < items.length; i++) {
    if (cancelledComfyBatch.has(comfyId)) {
      cancelled = true;
      break;
    }
    setComfy(comfyId, { logs: [`第 ${i + 1}/${items.length} ${mode === 'per-prompt' ? '条提示词' : '张图'}…（成功 ${okCount} · 失败 ${failCount}）`] });
    const per = await runComfyBatchItem(comfyId, batchId, mode, i, docId);
    if (per == null) {
      cancelled = true;
      break;
    }
    if (per.ok) {
      okCount++;
      allImages.push(...per.images);
      if (per.texts) allTexts.push(...per.texts);
    } else failCount++;
  }
  if (cancelled) {
    cancelledComfyBatch.delete(comfyId);
    setComfy(comfyId, { status: 'idle', runId: undefined, logs: [`已取消（完成 ${okCount + failCount}/${items.length} 项）`] });
    return;
  }
  // 终态合并总览（结果节点的逐条结果已按条推过——传 storeResults=[] 不重复推）
  const merged: WorkResult = {
    ok: failCount === 0,
    summary: `ComfyUI 逐条执行完成：成功 ${okCount} · 失败 ${failCount}`,
    images: allImages,
    texts: allTexts.length ? allTexts : undefined,
    logs: [`逐条执行 ${items.length} 项 · 成功 ${okCount} · 失败 ${failCount}${failCount ? '（合集卡里可单条重试）' : ''}`],
    error: failCount ? `${failCount} 项失败（可在合集卡里单条重试）` : undefined,
    workType: 'image-generation',
    runMode: 'batch',
    provider: 'comfyui',
    model: d.templateName || '工作流',
    simulated: false,
    durationMs: Date.now() - t0,
    batchId,
    createdAt: Date.now(),
    sourceNodeId: comfyId
  };
  placeComfyResult(comfyId, merged, docId, []);
}

/** 跑批量中的一项并按条归位（同 batchId+shotIndex 推合集卡）。返回 null = 用户取消。 */
async function runComfyBatchItem(
  comfyId: string,
  batchId: string,
  mode: 'per-prompt' | 'per-image',
  index: number,
  docId: string | null
): Promise<WorkResult | null> {
  const snap = lastComfyBatch.get(comfyId);
  if (!snap) return null;
  const override = mode === 'per-prompt' ? { promptIndex: index } : { imageIndex: index };
  const cv = buildComfyControlValues(snap.controls, snap.baseControlValues, { prompts: snap.prompts, images: snap.images, masks: snap.masks, size: snap.size }, override, snap.bindings);
  const t0 = Date.now();
  const r = await submitComfyAndWait(comfyId, snap.workflowId, cv, docId, true);
  if (r.kind === 'done' && r.outcome?.cancelled) return null;
  const itemLabel =
    mode === 'per-prompt' ? snap.items[index] : `第 ${index + 1} 张：${snap.items[index]?.split(/[\\/]/).pop() ?? ''}`;
  const base = {
    workType: 'image-generation' as const,
    runMode: 'batch' as const,
    provider: 'comfyui',
    model: snap.templateName || '工作流',
    simulated: false,
    prompt: itemLabel,
    createdAt: Date.now(),
    batchId,
    shotIndex: index,
    sourceNodeId: comfyId,
    durationMs: Date.now() - t0
  };
  let per: WorkResult;
  if (r.kind === 'done' && r.outcome) {
    const o = r.outcome;
    per = o.ok
      ? { ...base, ok: true, summary: `第 ${index + 1} 项完成：${o.images.length} 张`, images: o.images, texts: o.texts, logs: [`第 ${index + 1} 项 · ${o.images.length} 张`], durationMs: o.durationMs }
      : { ...base, ok: false, summary: '该项运行失败', images: [], logs: [o.error ?? '运行失败'], error: o.error ?? '运行失败', durationMs: o.durationMs };
  } else if (r.kind === 'submit-error') {
    per = { ...base, ok: false, summary: '该项提交失败', images: [], logs: [r.message], error: r.message };
  } else {
    per = { ...base, ok: false, summary: '该项超时', images: [], logs: ['运行超时（15 分钟未返回）'], error: '运行超时（15 分钟未返回），可单条重试' };
  }
  pushComfyPerResult(comfyId, per, docId);
  return per;
}

/** 合集卡「重试此条」（ComfyUI 批量）：从快照单条重跑，同 batchId+shotIndex 归位翻新。 */
export async function retryComfyItem(comfyId: string, index: number): Promise<void> {
  const snap = lastComfyBatch.get(comfyId);
  if (!snap || snap.items[index] == null) {
    toast.error('没有可重试的批次记录', '批次快照只在本次会话内保留，重新运行该 ComfyUI 节点即可');
    return;
  }
  const node = useSmartCanvasStore.getState().nodes.find((n) => n.id === comfyId);
  if (!node || node.type !== 'comfy') return;
  if ((node.data as unknown as ComfyNodeData).status === 'running') {
    toast.error('该节点正在运行', '等本轮结束或先取消');
    return;
  }
  const docId = currentDocId();
  cancelledComfyBatch.delete(comfyId);
  setComfy(comfyId, { status: 'running', error: null, logs: [`重试第 ${index + 1}/${snap.items.length} 项…`] });
  const per = await runComfyBatchItem(comfyId, snap.batchId, snap.mode, index, docId);
  if (per == null) {
    setComfy(comfyId, { status: 'idle', runId: undefined });
    return;
  }
  setComfy(comfyId, {
    status: per.ok ? 'success' : 'error',
    runId: undefined,
    error: per.ok ? null : per.error ?? null,
    logs: [per.ok ? `第 ${index + 1} 项重试完成` : `第 ${index + 1} 项重试失败：${per.error ?? ''}`]
  });
  if (per.ok) toast.success(`第 ${index + 1} 项重试完成`, `${per.images.length} 张`);
  else toast.error('重试失败', per.error);
}

/** 把批量中一条结果推给下游结果节点（合集卡聚合）+ 文件夹输出；不动源节点终态（批量驱动器统一收尾）。 */
function pushComfyPerResult(comfyId: string, per: WorkResult, docId: string | null): void {
  notifyFolderOutputs(comfyId, [per], docId);
  if (docId && docId !== currentDocId()) {
    const doc = readDocDoc(docId);
    if (!doc) return;
    for (const c of doc.connections.filter((x) => x.source === comfyId)) {
      const tgt = doc.nodes.find((n) => n.id === c.target);
      if (tgt?.type === 'result') useSmartResultStore.getState().push(tgt.id, per);
    }
    return;
  }
  const st = useSmartCanvasStore.getState();
  for (const e of st.edges.filter((x) => x.source === comfyId)) {
    const tgt = st.nodes.find((n) => n.id === e.target);
    if (tgt?.type === 'result') {
      useSmartResultStore.getState().push(tgt.id, per);
      st.updateNodeData(tgt.id, { result: per } as Partial<SmartNodeData>);
    }
  }
}

/** 唤醒等待该 runId 完成的 runComfyNode / 批量驱动器（routeComfyDone 各出口都调；defer 时携带 outcome）。 */
function resolveComfyWait(runId: string, outcome?: ComfyOutcome): void {
  const f = pendingComfyResolve.get(runId);
  if (f) {
    pendingComfyResolve.delete(runId);
    f(outcome);
  }
}

/** 取消一个 ComfyUI 节点的进行中运行：abort 上游 run + 立即重置 idle + 唤醒 awaiting 的 runComfyNode。 */
export function cancelComfy(comfyId: string): void {
  const node = useSmartCanvasStore.getState().nodes.find((n) => n.id === comfyId);
  if (!node || node.type !== 'comfy') return;
  const d = node.data as unknown as ComfyNodeData;
  const runId = d.runId;
  cancelledComfyBatch.add(comfyId); // 批量逐条执行：停止后续条目
  setComfy(comfyId, { status: 'idle', runId: undefined, logs: ['已取消，可重新运行'] });
  if (runId) {
    void window.electronAPI.comfyui.cancel({ runId });
    const wasDefer = pendingComfy.get(runId)?.defer;
    pendingComfy.delete(runId);
    // 唤醒 awaiting 的 runComfyNode / 批量驱动器（defer 时给 cancelled outcome 让循环立即 break）
    resolveComfyWait(runId, wasDefer ? { ok: false, images: [], cancelled: true, durationMs: 0 } : undefined);
  }
}

/**
 * 强制重置一个 ComfyUI 节点的「界面状态」——用于「点取消没反应、后台又查不到任务」的卡死：
 * 不依赖后端响应，直接把节点状态拉回 idle，并清掉所有指向它的在途记录 / 唤醒所有等待，
 * 释放被占住的并发槽。best-effort 通知后端取消（成不成都不影响界面恢复）。
 */
export function forceResetComfy(comfyId: string): void {
  const node = useSmartCanvasStore.getState().nodes.find((n) => n.id === comfyId);
  if (!node || node.type !== 'comfy') return;
  const d = node.data as unknown as ComfyNodeData;
  cancelledComfyBatch.add(comfyId); // 批量逐条执行：停止后续条目
  // 清掉所有指向该节点的在途记录（即使 runId 对不上也清），并唤醒各自的等待
  for (const [rid, p] of pendingComfy) {
    if (p.comfyId === comfyId) {
      const wasDefer = p.defer;
      pendingComfy.delete(rid);
      resolveComfyWait(rid, wasDefer ? { ok: false, images: [], cancelled: true, durationMs: 0 } : undefined);
    }
  }
  if (d.runId) {
    void window.electronAPI.comfyui.cancel({ runId: d.runId });
    pendingComfy.delete(d.runId);
    resolveComfyWait(d.runId);
  }
  setComfy(comfyId, { status: 'idle', runId: undefined, error: null, logs: ['已强制重置界面状态'] });
}

/** 把 ComfyUI 结果写到节点 + 推给下游结果节点；切文档后回灌正确文档。
 *  storeResults：批量逐条执行时各条已按条推过 → 传 [] 防重复；缺省推 result 本身。 */
function placeComfyResult(comfyId: string, result: WorkResult, docId: string | null, storeResults?: WorkResult[]): void {
  // 文件夹输出（批量逐条已在 pushComfyPerResult 通知过；storeResults=[] 时这里不重复）
  notifyFolderOutputs(comfyId, storeResults ?? [result], docId);
  if (docId && docId !== currentDocId()) {
    placeResultInBackgroundDoc(docId, comfyId, result, storeResults);
    return;
  }
  const st = useSmartCanvasStore.getState();
  const termPatch = {
    status: result.ok ? 'success' : 'error',
    result,
    logs: result.logs,
    error: result.error ?? null,
    runId: undefined
  } as const;
  setComfy(comfyId, termPatch);
  // 终态落盘当前文档：防切档 / 回启动页重载时被 sanitize 后的 idle 覆盖。
  persistActiveDocTerminal(docId, comfyId, { ...termPatch });
  for (const e of st.edges.filter((x) => x.source === comfyId)) {
    const tgt = st.nodes.find((n) => n.id === e.target);
    if (tgt?.type === 'result') {
      for (const r of storeResults ?? [result]) useSmartResultStore.getState().push(tgt.id, r);
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
  const { comfyId, docId, startedAt, defer } = entry;
  const durationMs = Date.now() - startedAt;
  // 模板名：当前 store 里取得到就用，取不到（已切走画布）回退「工作流」
  const live = useSmartCanvasStore.getState().nodes.find((n) => n.id === comfyId);
  const name = live && live.type === 'comfy' ? (live.data as unknown as ComfyNodeData).templateName || '工作流' : '工作流';

  if (dn.status === 'failed' || dn.error) {
    if (defer) {
      // 批量逐条：outcome 交给驱动器按条归位，不落节点终态
      resolveComfyWait(dn.runId, { ok: false, images: [], error: dn.error ?? '运行失败', durationMs });
      return;
    }
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
    if (defer) {
      resolveComfyWait(dn.runId, { ok: false, images: [], cancelled: true, durationMs });
      return;
    }
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
  if (defer) {
    resolveComfyWait(dn.runId, { ok: true, images, texts: texts.length ? texts : undefined, durationMs });
    return;
  }
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
// 文件夹输入 / 输出节点（folder-input / folder-output）
// folder-input：api:storage:list-images 扫描 → files 持久化 → computeUpstream 当多图来源。
// folder-output：所有结果归位的统一汇集点（placeWorkResult / placeComfyResult /
// pushComfyPerResult / routeVideoDone）调 notifyFolderOutputs → 每条结果到达即落盘
//（api:storage:copy-into），失败记日志不中断生成主流程。
// ─────────────────────────────────────────────────────────────

/** 扫描 folder-input 节点的文件夹，把图片清单写回节点。 */
export async function refreshFolderInput(nodeId: string): Promise<void> {
  const st = useSmartCanvasStore.getState();
  const node = st.nodes.find((n) => n.id === nodeId);
  if (!node || node.type !== 'folder-input') return;
  const d = node.data as unknown as FolderInputNodeData;
  if (!d.dir) {
    toast.error('先选择输入文件夹');
    return;
  }
  const r = await window.electronAPI.storage.listImages({ dir: d.dir, kinds: ['image', 'video'] });
  if (!r.ok) {
    st.updateNodeData(nodeId, { error: r.error.message } as Partial<SmartNodeData>);
    toast.error(r.error.message, r.error.hint);
    return;
  }
  const imgs = r.data.files.filter((f) => f.kind !== 'video').map((f) => f.path);
  const vids = r.data.files.filter((f) => f.kind === 'video').map((f) => f.path);
  st.updateNodeData(nodeId, {
    files: imgs,
    videoFiles: vids,
    scannedAt: Date.now(),
    error: null
  } as Partial<SmartNodeData>);
  toast.success(`扫描到 ${imgs.length} 张图片${vids.length ? `、${vids.length} 个视频` : ''}`);
}

// folder-output 去重：节点 id → 已落盘过的源（路径/dataUri），防同一结果被合并总览重复保存（内存态）
const savedByFolderNode = new Map<string, Set<string>>();

/** 把一批新结果（成功条目的图片/视频）落盘到 srcId 直接下游的 folder-output 节点。旁路操作，永不抛。 */
function notifyFolderOutputs(srcId: string, results: WorkResult[], docId: string | null): void {
  try {
    const media = results.filter((r) => r.ok).flatMap((r) => [...(r.images ?? []), ...(r.videos ?? [])]);
    if (!media.length) return;
    const bg = !!docId && docId !== currentDocId();
    let targetIds: string[] = [];
    if (bg) {
      const doc = readDocDoc(docId as string);
      if (!doc) return;
      targetIds = doc.connections
        .filter((c) => c.source === srcId)
        .map((c) => doc.nodes.find((n) => n.id === c.target))
        .filter((n) => n?.type === 'folder-output')
        .map((n) => (n as { id: string }).id);
    } else {
      const st = useSmartCanvasStore.getState();
      targetIds = st.edges
        .filter((e) => e.source === srcId)
        .map((e) => st.nodes.find((n) => n.id === e.target))
        .filter((n) => n?.type === 'folder-output')
        .map((n) => (n as Node).id);
    }
    for (const tid of targetIds) void saveResultToFolder(tid, media, docId);
  } catch {
    /* 旁路：文件夹输出绝不影响生成主流程 */
  }
}

/** 读 folder-output 节点数据（当前 store 或后台文档）。 */
function readFolderOutputData(nodeId: string, docId: string | null): FolderOutputNodeData | null {
  const bg = !!docId && docId !== currentDocId();
  if (bg) {
    const doc = readDocDoc(docId as string);
    const n = doc?.nodes.find((x) => x.id === nodeId);
    return n?.type === 'folder-output' ? (n.data as unknown as FolderOutputNodeData) : null;
  }
  const n = useSmartCanvasStore.getState().nodes.find((x) => x.id === nodeId);
  return n?.type === 'folder-output' ? (n.data as unknown as FolderOutputNodeData) : null;
}

async function saveResultToFolder(folderNodeId: string, media: string[], docId: string | null): Promise<void> {
  const d = readFolderOutputData(folderNodeId, docId);
  if (!d || d.enabled === false) return;
  if (!d.dir) return; // 未配置输出文件夹：静默跳过（节点卡上有提示）
  let seen = savedByFolderNode.get(folderNodeId);
  if (!seen) {
    seen = new Set();
    savedByFolderNode.set(folderNodeId, seen);
  }
  const fresh = media.filter((m) => !seen!.has(m));
  if (!fresh.length) return;
  for (const m of fresh) seen.add(m);
  const rule = d.nameRule ?? 'original';
  const taken = new Set<string>();
  let seq = d.seq ?? 1;
  const items = fresh.map((src) => {
    const destName = buildOutputName(rule, d.prefix ?? 'output', seq, srcBaseName(src), taken);
    if (rule === 'prefix-seq') seq++;
    return { src, destName };
  });
  const r = await window.electronAPI.storage.copyInto({ targetDir: d.dir, items });
  const bg = !!docId && docId !== currentDocId();
  let patch: Record<string, unknown>;
  if (r.ok) {
    const failedLogs = r.data.failed.slice(0, 3).map((f) => `保存失败：${f.src.slice(0, 60)} → ${f.error}`);
    patch = {
      seq,
      savedCount: (d.savedCount ?? 0) + r.data.saved.length,
      failCount: (d.failCount ?? 0) + r.data.failed.length,
      logs: [`已保存 ${r.data.saved.length} 张到 ${d.dir}`, ...failedLogs],
      error: r.data.failed.length ? `${r.data.failed.length} 张保存失败` : null
    };
    if (r.data.failed.length) toast.error(`文件夹输出：${r.data.failed.length} 张失败`, r.data.failed[0]?.error);
  } else {
    // 整批失败：从去重集回滚，下次结果到达可重试
    for (const m of fresh) seen.delete(m);
    patch = { failCount: (d.failCount ?? 0) + fresh.length, error: r.error.message, logs: [r.error.message] };
    toast.error('文件夹输出失败', r.error.message);
  }
  if (bg) patchDocNodes(docId as string, [{ nodeId: folderNodeId, patch }]);
  else useSmartCanvasStore.getState().updateNodeData(folderNodeId, patch as Partial<SmartNodeData>);
}

// ─────────────────────────────────────────────────────────────
// 提示词商城节点（prompt-mall）：购物车片段 → 纯函数按大类排布拼接 →（勾「优化」时）对话模型
// 合并去重成一条 → assembled 喂下游。上游文本（提示词/LLM/反推/分组/结果）可作额外片段并入。
// 中/英切换控制输出语言。零新 IPC（复用 api:chat:optimize-prompt）。
// ─────────────────────────────────────────────────────────────

function setMall(id: string, patch: Partial<PromptMallNodeData>): void {
  useSmartCanvasStore.getState().updateNodeData(id, patch as Partial<SmartNodeData>);
}

/** 运行提示词商城节点：购物车 → 原始拼接 →（勾「优化」时）对话模型合并优化 → assembled 喂下游。 */
export async function runPromptMallNode(id: string): Promise<void> {
  const st = useSmartCanvasStore.getState();
  const node = st.nodes.find((n) => n.id === id);
  if (!node || node.type !== 'prompt-mall') return;
  const d = node.data as unknown as PromptMallNodeData;
  const lang = d.lang === 'en' ? 'en' : 'zh';
  if (d.lockOutput && d.assembled?.trim()) {
    toast.info('合成结果已锁定', '解除「锁定」后才会重新合成');
    return;
  }
  // 上游文本片段（提示词/LLM/反推/分组/结果）作额外片段并入购物车（cat 未知 → 排到末尾，不当负面）
  const up = collectInputs(id);
  const upstreamItems = up.prompts
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => ({ cat: '_upstream', sub: '', zh: t, en: t }));
  const cartItems = (d.cart ?? []).map((it) => ({ cat: it.cat, sub: it.sub, zh: it.zh, en: it.en, group: it.group }));
  const items = [...cartItems, ...upstreamItems];
  if (!items.length) {
    toast.error('购物车是空的', '打开「提示词商城」把卡片拖进购物车，或连上游提示词进来');
    return;
  }
  const groups = d.groups?.length ? d.groups : [{ id: 'g1', name: '组 1' }];
  const raw = assembleCartGrouped(items, groups, lang);
  if (!raw.trim()) {
    toast.error('没有可用片段', '购物车里的片段文本为空');
    return;
  }
  // 组装方式：'paragraph'=一整段自然语言（必走对话模型从头写）/ 'fragments'=逐段片段（可选优化合并）
  const paragraph = d.assembleMode === 'paragraph';
  const useLlm = paragraph || d.optimize;
  // 片段模式且不勾「优化」：直接用原始拼接，零 API
  if (!useLlm) {
    setMall(id, { status: 'success', assembled: raw, error: null, logs: ['原始拼接（未优化）'] });
    pushTextDownstream(id, raw, '提示词商城');
    toast.success('已合成提示词', '未优化 · 直接拼接');
    return;
  }
  // 走对话模型（合并去重 或 整段自然语言）
  if (!d.modelId) {
    toast.error('请先选一个对话模型', paragraph ? '「整段自然语言」需要对话模型撰写' : '或关掉「优化」直接用原始拼接');
    return;
  }
  const sset = useSettingsStore.getState();
  const why = diagnoseChatModel(sset.configs, sset.plans, sset.activePlanId, d.modelId);
  if (why) {
    setMall(id, { status: 'error', error: why, logs: [why] });
    toast.error('该对话模型不可用', why);
    return;
  }
  if (sset.activePlanId === null) {
    toast.error('没有可用方案', '先在设置页建一个方案并配置对话模型');
    return;
  }
  const t0 = Date.now();
  setMall(id, { status: 'running', error: null, logs: [paragraph ? '撰写整段自然语言描述…' : '合并优化提示词…'] });
  const r = await window.electronAPI.chat.optimizePrompt({
    planId: sset.activePlanId,
    modelId: d.modelId,
    userInput: raw,
    systemPrompt: (paragraph ? PROMPT_MALL_PARAGRAPH_SYSTEM : PROMPT_MALL_SYSTEM)[lang]
  });
  if (!r.ok || r.data.optimizedBy === null) {
    const msg = (!r.ok ? r.error.message : r.data.reason) || '合成提示词失败（上游超时/报错）';
    setMall(id, { status: 'error', error: msg, logs: [msg] });
    toast.error('合成提示词失败', msg);
    return;
  }
  const out = stripFences(r.data.optimized) || raw;
  setMall(id, {
    status: 'success',
    assembled: out,
    error: null,
    logs: [`已合成 · ${d.modelId} · 用时 ${((Date.now() - t0) / 1000).toFixed(1)}s`]
  });
  pushTextDownstream(id, out, '提示词商城');
  toast.success('已合成提示词', '可连 生图 / 分镜 / 视频 节点');
}

/**
 * 为提示词商城某张卡片生成缩略图：复用绘画模型（api:image:generate，1K 方图）→ 落盘到 thumbDir/<cardId>.png。
 * 产物按软件「产物入库」哲学也会进资产库（打 source 标记便于区分）。若用户在外部（如 ComfyUI）批量生成，
 * 直接把 <cardId>.png 放进缩略图文件夹即可被识别，无需走此函数。
 */
/** 缩略图按大类落到子文件夹：选「总文件夹」后，每个大类自动建一个子文件夹（copy-into 自带 mkdir -p）。 */
export function mallThumbSubdir(thumbDir: string, cat: string): string {
  const base = thumbDir.replace(/[\\/]+$/, '');
  const safe = (cat || 'misc').replace(/[\\/:*?"<>|]/g, '_');
  return `${base}/${safe}`;
}

export async function generateMallThumb(card: PromptMallCard, modelId: string, thumbDir: string, overwrite = false): Promise<{ ok: boolean; error?: string }> {
  const prompt = buildThumbGenPrompt(card);
  const res = await generateOnce(modelId, prompt, { n: 1, aspect: '1:1', imageSize: '1K', quality: 'high', source: 'prompt-mall-thumb', seed: THUMB_SEED }, []);
  if (res.error) return { ok: false, error: res.error };
  const src = res.images[0];
  if (!src) return { ok: false, error: '未返回图片' };
  const r = await window.electronAPI.storage.copyInto({ targetDir: mallThumbSubdir(thumbDir, card.cat), items: [{ src, destName: `${card.id}.png` }], overwrite });
  if (!r.ok) return { ok: false, error: r.error.message };
  return { ok: true };
}

/**
 * 「开发模式」用连接的 ComfyUI 节点生成某卡缩略图：把 genPrompt 当文本输入喂给该 ComfyUI 工作流（z-image 等），
 * defer 模式取回结果图 → copy-into 落盘 thumbDir/<cardId>.png（按 cardId 一一对应）。用户自有 ComfyUI 出图，版权干净。
 */
export async function generateMallThumbViaComfy(card: PromptMallCard, comfyNodeId: string, thumbDir: string, overwrite = false): Promise<{ ok: boolean; error?: string }> {
  const st = useSmartCanvasStore.getState();
  const node = st.nodes.find((n) => n.id === comfyNodeId);
  if (!node || node.type !== 'comfy') return { ok: false, error: '没有连接的 ComfyUI 节点' };
  const d = node.data as unknown as ComfyNodeData;
  if (!d.workflowId) return { ok: false, error: 'ComfyUI 节点未选工作流模板' };
  // seed 由用户工作流的 KSampler 决定（此处不强塞）；提示词经统一风格包装保证目录一致
  const cv = buildComfyControlValues(d.controls, d.controlValues, { prompts: [buildThumbGenPrompt(card)], images: [], masks: [], size: undefined }, undefined, d.inputBindings);
  // skipGallery=true：缩略图不进资产库（图库）
  const r = await submitComfyAndWait(comfyNodeId, d.workflowId, cv, currentDocId(), true, true);
  if (r.kind === 'submit-error') return { ok: false, error: r.message };
  if (r.kind === 'timeout') return { ok: false, error: 'ComfyUI 运行超时（15 分钟未返回）' };
  const o = r.outcome;
  if (!o || !o.ok) return { ok: false, error: o?.error ?? 'ComfyUI 运行失败' };
  const src = o.images?.[0];
  if (!src) return { ok: false, error: 'ComfyUI 未返回图片（检查工作流是否含 SaveImage 输出）' };
  const cp = await window.electronAPI.storage.copyInto({ targetDir: mallThumbSubdir(thumbDir, card.cat), items: [{ src, destName: `${card.id}.png` }], overwrite });
  if (!cp.ok) return { ok: false, error: cp.error.message };
  return { ok: true };
}


// ─────────────────────────────────────────────────────────────
// 循环节点（loop）：对每一项——写当前项输出（提示词/尺寸/图片通道）→ 触发并等待
// 直接下游 runnable（生图/ComfyUI/视频）完成 → 下一项。暂停（项间生效）/继续/停止/跳过/从指定项继续。
// 防死锁：loop 不进 RUNNABLE（运行全部跳过）+ 与「运行全部」双向互斥。
// ─────────────────────────────────────────────────────────────

interface LoopCtl {
  stop: boolean;
  skip: boolean;
  paused: boolean;
  resume: (() => void) | null;
  docId: string | null;
  currentTarget: { id: string; type: string } | null;
}
const loopCtls = new Map<string, LoopCtl>();

export function isAnyLoopRunning(): boolean {
  return loopCtls.size > 0;
}

function setLoop(id: string, patch: Partial<LoopNodeData>): void {
  useSmartCanvasStore.getState().updateNodeData(id, patch as Partial<SmartNodeData>);
}

/** 暂停（当前项跑完后挂起）。 */
export function pauseLoop(id: string): void {
  const ctl = loopCtls.get(id);
  if (ctl) ctl.paused = true;
}

export function resumeLoop(id: string): void {
  const ctl = loopCtls.get(id);
  if (ctl?.resume) {
    ctl.paused = false;
    const f = ctl.resume;
    ctl.resume = null;
    f();
  } else if (ctl) ctl.paused = false;
}

/** 取消当前在途下游任务（停止/跳过共用）。 */
function cancelLoopTarget(ctl: LoopCtl): void {
  const t = ctl.currentTarget;
  if (!t) return;
  if (t.type === 'work') cancelWork(t.id);
  else if (t.type === 'comfy') cancelComfy(t.id);
  else if (t.type === 'video') cancelVideo(t.id);
}

export function stopLoop(id: string): void {
  const ctl = loopCtls.get(id);
  if (!ctl) return;
  ctl.stop = true;
  cancelLoopTarget(ctl);
  resumeLoop(id); // 暂停态也能停
}

export function skipLoopItem(id: string): void {
  const ctl = loopCtls.get(id);
  if (!ctl) return;
  ctl.skip = true;
  cancelLoopTarget(ctl);
}

/** 某节点的直接下游 runnable（生图/ComfyUI/视频），按位置排序稳定。循环节点与图片列表自驱共用。 */
function downstreamRunnables(sourceId: string): Node[] {
  const st = useSmartCanvasStore.getState();
  return st.edges
    .filter((e) => e.source === sourceId)
    .map((e) => st.nodes.find((n) => n.id === e.target))
    .filter((n): n is Node => !!n && (n.type === 'work' || n.type === 'comfy' || n.type === 'video'))
    .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
}

/** 抽象状态 → 具体节点数据 patch（循环节点与图片列表节点字段名不同，由各自适配器映射）。 */
interface BatchState {
  status?: RunStatus | 'paused';
  index?: number;
  total?: number;
  done?: number;
  fail?: number;
  logs?: string[];
  error?: string | null;
}
interface BatchAdapter {
  /** 状态/计数/日志 → 节点 patch */
  statusPatch: (s: BatchState) => Record<string, unknown>;
  /** 当前项 → 节点输出 patch（提示词/尺寸/批次图） */
  itemPatch: (item: LoopItem) => Record<string, unknown>;
}

const loopAdapter: BatchAdapter = {
  statusPatch: (s) => {
    const p: Record<string, unknown> = {};
    if (s.status !== undefined) p.status = s.status;
    if (s.index !== undefined) p.currentIndex = s.index;
    if (s.total !== undefined) p.totalItems = s.total;
    if (s.done !== undefined) p.doneCount = s.done;
    if (s.fail !== undefined) p.failCount = s.fail;
    if (s.logs !== undefined) p.logs = s.logs;
    if (s.error !== undefined) p.error = s.error;
    return p;
  },
  // 每项覆写全部输出通道：未用到的通道置 undefined 清空（避免下游读到上一项的残留）
  itemPatch: (item) => ({ currentValue: item.label, outPrompt: item.prompt, outSize: item.size, outImages: item.images, outImage: undefined })
};

const imageListAdapter: BatchAdapter = {
  statusPatch: (s) => {
    const p: Record<string, unknown> = {};
    if (s.status !== undefined) {
      p.runStatus = s.status;
      // 运行结束（非 running/paused）→ 清当前批，避免下游误读上一次的旧批（imageNodeOutputs 已门控，这里再保险）
      if (s.status !== 'running' && s.status !== 'paused') p.outBatch = undefined;
    }
    if (s.index !== undefined) p.batchIndex = s.index;
    if (s.total !== undefined) p.totalBatches = s.total;
    if (s.done !== undefined) p.doneCount = s.done;
    if (s.fail !== undefined) p.failCount = s.fail;
    if (s.logs !== undefined) p.runLogs = s.logs;
    if (s.error !== undefined) p.runError = s.error;
    return p;
  },
  itemPatch: (item) => ({ outBatch: item.images })
};

/**
 * 共享的「逐项/逐批执行」核心：写当前项输出 → 运行直接下游 runnable → 等完成 → 下一项。
 * 循环节点（loopAdapter）与图片列表自驱（imageListAdapter）共用，统一支持 暂停/继续/停止/跳过/从指定项继续/切画布硬停。
 */
async function runBatchIteration(
  sourceId: string,
  items: LoopItem[],
  targets: Node[],
  startIndex: number,
  startDone: number,
  startFail: number,
  stopOnError: boolean,
  docId: string | null,
  ad: BatchAdapter
): Promise<void> {
  const apply = (p: Record<string, unknown>): void =>
    useSmartCanvasStore.getState().updateNodeData(sourceId, p as Partial<SmartNodeData>);
  const ctl: LoopCtl = { stop: false, skip: false, paused: false, resume: null, docId, currentTarget: null };
  loopCtls.set(sourceId, ctl);
  const start = Math.max(0, Math.min(items.length - 1, startIndex));
  let done = start > 0 ? startDone : 0;
  let fail = start > 0 ? startFail : 0;
  apply(ad.statusPatch({ status: 'running', error: null, total: items.length, done, fail, logs: [`开始：共 ${items.length} 项${start ? `，从第 ${start + 1} 项继续` : ''}`] }));
  try {
    for (let i = start; i < items.length; i++) {
      if (ctl.stop) break;
      if (ctl.paused) {
        apply(ad.statusPatch({ status: 'paused', logs: [`已暂停（即将执行第 ${i + 1}/${items.length} 项）`] }));
        await new Promise<void>((resolve) => {
          ctl.resume = resolve;
        });
        if (ctl.stop) break;
        apply(ad.statusPatch({ status: 'running' }));
      }
      // 画布切换检测：读写当前 store 的下游节点，切走必须硬停（结果会乱），把停点写回后台文档
      if (currentDocId() !== ctl.docId) {
        patchDocNodes(ctl.docId as string, [
          { nodeId: sourceId, patch: ad.statusPatch({ status: 'idle', index: i, logs: [`已停于第 ${i + 1} 项（切换了画布）；可「从第 ${i + 1} 项继续」`] }) }
        ]);
        return;
      }
      const item = items[i];
      ctl.skip = false;
      apply({ ...ad.itemPatch(item), ...ad.statusPatch({ index: i, logs: [`第 ${i + 1}/${items.length} 项：${item.label}（成功 ${done} · 失败 ${fail}）`] }) });
      let itemFailed = false;
      for (const t of targets) {
        if (ctl.stop) break;
        const live = useSmartCanvasStore.getState().nodes.find((n) => n.id === t.id);
        if (!live) continue;
        ctl.currentTarget = { id: t.id, type: live.type ?? '' };
        await runOne(live, false); // 下游完成感知 = 现有 Promise 语义（runWork/Comfy/Video 都 await 到终态）
        ctl.currentTarget = null;
        if (ctl.skip) break;
        const after = useSmartCanvasStore.getState().nodes.find((n) => n.id === t.id);
        const status = (after?.data as { status?: string } | undefined)?.status;
        if (status === 'error') itemFailed = true;
      }
      if (ctl.stop) break;
      if (ctl.skip) {
        apply(ad.statusPatch({ logs: [`第 ${i + 1} 项已跳过`] }));
        continue;
      }
      if (itemFailed) {
        fail++;
        apply(ad.statusPatch({ fail }));
        if (stopOnError) {
          apply(ad.statusPatch({ status: 'error', error: `第 ${i + 1} 项失败，已按设置停止`, index: i }));
          return;
        }
      } else {
        done++;
        apply(ad.statusPatch({ done }));
      }
    }
    if (ctl.stop) {
      apply(ad.statusPatch({ status: 'idle', logs: [`已停止（成功 ${done} · 失败 ${fail}）；可「从指定项继续」`] }));
    } else {
      apply(ad.statusPatch({ status: fail ? 'error' : 'success', error: fail ? `${fail} 项失败` : null, logs: [`完成：成功 ${done} · 失败 ${fail} / 共 ${items.length} 项`] }));
      toast.success('批量完成', `成功 ${done} · 失败 ${fail}`);
    }
  } finally {
    loopCtls.delete(sourceId);
  }
}

/** 运行循环节点（startIndex 可从指定项继续）。 */
export async function runLoopNode(id: string, opts?: { startIndex?: number }): Promise<void> {
  const st = useSmartCanvasStore.getState();
  const node = st.nodes.find((n) => n.id === id);
  if (!node || node.type !== 'loop') return;
  if (loopCtls.has(id)) {
    toast.error('该循环正在运行', '先暂停/停止再重新开始');
    return;
  }
  if (useSmartRunStore.getState().running) {
    toast.error('「运行全部」进行中', '等它结束或先停止，再启动循环');
    return;
  }
  const d = node.data as unknown as LoopNodeData;
  // folder 模式：先扫描文件夹
  let folderFiles: string[] | undefined;
  if (d.sourceType === 'folder') {
    if (!d.folderDir) {
      toast.error('先选择图片文件夹');
      return;
    }
    const r = await window.electronAPI.storage.listImages({ dir: d.folderDir });
    if (!r.ok) {
      setLoop(id, { status: 'error', error: r.error.message, logs: [r.error.message] });
      toast.error(r.error.message, r.error.hint);
      return;
    }
    folderFiles = r.data.files.map((f) => f.path);
  }
  const items = buildLoopItems(d, folderFiles);
  if (!items.length) {
    toast.error('循环没有可执行的项', '检查列表/范围/文件夹内容/拖入的图片');
    return;
  }
  const targets = downstreamRunnables(id);
  if (!targets.length) {
    toast.error('循环下游没有可运行节点', '把循环节点连到 生图 / ComfyUI / 视频 节点');
    return;
  }
  await runBatchIteration(id, items, targets, opts?.startIndex ?? 0, d.doneCount ?? 0, d.failCount ?? 0, !!d.stopOnError, currentDocId(), loopAdapter);
}

/** 运行图片列表节点（自驱逐批跑下游；Q2「列表节点自己驱动」）。复用循环的批次迭代核心。 */
export async function runImageListNode(id: string, opts?: { startIndex?: number }): Promise<void> {
  const st = useSmartCanvasStore.getState();
  const node = st.nodes.find((n) => n.id === id);
  if (!node || node.type !== 'image') return;
  if (loopCtls.has(id)) {
    toast.error('该列表正在运行', '先暂停/停止再重新开始');
    return;
  }
  if (useSmartRunStore.getState().running) {
    toast.error('「运行全部」进行中', '等它结束或先停止，再启动');
    return;
  }
  const d = node.data as unknown as ImageNodeData;
  const srcs = (d.srcs ?? []).filter(Boolean);
  if (!srcs.length) {
    toast.error('图片列表为空', '先添加图片');
    return;
  }
  const items = chunkImages(srcs, d.batchSize ?? 1).map((batch, i) => ({
    label: batch.length > 1 ? `第 ${i + 1} 批 · ${batch.length} 张` : fileBaseName(batch[0]),
    images: batch
  }));
  const targets = downstreamRunnables(id);
  if (!targets.length) {
    toast.error('图片列表下游没有可运行节点', '把图片列表连到 生图 / ComfyUI / 视频 节点');
    return;
  }
  await runBatchIteration(id, items, targets, opts?.startIndex ?? 0, d.doneCount ?? 0, d.failCount ?? 0, false, currentDocId(), imageListAdapter);
}

function fileBaseName(f: string): string {
  if (!f) return '图片';
  if (f.startsWith('data:')) return '内嵌图片';
  return f.split(/[\\/]/).pop() ?? f;
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

// loop 有意不进 RUNNABLE：运行全部跳过循环节点（与循环驱动器双向互斥，防死锁）
const RUNNABLE = new Set(['work', 'comfy', 'llm', 'storyboard', 'prompt-mall', 'frame-interp', 'video-clip', 'upscale', 'vectorize', 'segment', 'proof']);
// 运行全部时「当前正在跑」的节点（点停止时据此终止在途任务，而非等它自然跑完）
let currentRunNode: { id: string; type: string } | null = null;

/**
 * 资产库删了某些源文件后，从智能画布的结果里同步剔除这些图（内存累积库 + 当前画布节点 data.result）。
 * 由 SmartCanvasPage 订阅 useDeletedMediaStore 调用，实现「资产库删除 → 工作流预览同步清掉」。
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
  if (isAnyLoopRunning()) {
    toast.error('有循环节点正在运行', '先停止循环，再「运行全部」（两者互斥防冲突）');
    return;
  }
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
      else if (n.type === 'storyboard') await runStoryboardNode(id);
      else if (n.type === 'prompt-mall') await runPromptMallNode(id);
      else if (n.type === 'frame-interp') await runFrameInterpNode(id);
      else if (n.type === 'video-clip') await runVideoClipNode(id);
      else if (n.type === 'upscale') await runUpscaleNode(id);
      else if (n.type === 'vectorize') await runVectorizeNode(id);
      // 切分/对稿在「运行全部」里按 needsRun 跳过已完成的（status==='success'）——它们每跑一次都烧钱
      // （切分=N 次重绘、对稿=1 次视觉调用），否则在已完成的画布上点「运行全部」会重复扣费。
      // 显式触发（工作台按钮 / 右键运行此节点）直接调用 runSegmentNode/runProofNode，不经此门控，照常可重跑。
      else if (n.type === 'segment') { if (needsRun(n)) await runSegmentNode(id); }
      else if (n.type === 'proof') { if (needsRun(n)) await runProofNode(id); }
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
  const t = node.type ?? '';
  if (
    t !== 'work' &&
    t !== 'comfy' &&
    t !== 'llm' &&
    t !== 'image-reverse' &&
    t !== 'video-reverse' &&
    t !== 'frame-interp' &&
    t !== 'video-clip' &&
    t !== 'storyboard' &&
    t !== 'prompt-mall' &&
    t !== 'upscale' &&
    t !== 'vectorize' &&
    t !== 'segment' &&
    t !== 'proof'
  )
    return false; // loop 有意不收：下游单点运行不会反向触发整个循环
  const status = (node.data as unknown as { status?: string }).status;
  return status !== 'running' && status !== 'success';
}

async function runOne(node: Node, allowCascade = true): Promise<void> {
  if (node.type === 'work') await runWorkNode(node.id, new Set(), allowCascade);
  else if (node.type === 'comfy') await runComfyNode(node.id);
  else if (node.type === 'llm') await runLlmNode(node.id);
  else if (node.type === 'video') await runVideoNode(node.id);
  else if (node.type === 'image-reverse') await runImageReverseNode(node.id);
  else if (node.type === 'video-reverse') await runVideoReverseNode(node.id);
  else if (node.type === 'frame-interp') await runFrameInterpNode(node.id);
  else if (node.type === 'video-clip') await runVideoClipNode(node.id);
  else if (node.type === 'storyboard') await runStoryboardNode(node.id);
  else if (node.type === 'prompt-mall') await runPromptMallNode(node.id);
  else if (node.type === 'upscale') await runUpscaleNode(node.id);
  else if (node.type === 'vectorize') await runVectorizeNode(node.id);
  else if (node.type === 'segment') await runSegmentNode(node.id);
  else if (node.type === 'proof') await runProofNode(node.id);
}

// ───────────────────────── 图像 / 视频反推（复用 api:lab:reverse）─────────────────────────

/** 图像反推：上游图片（或本地上传）→ 视觉模型反推 → 描述/标签/风格文本，喂下游。 */
export async function runImageReverseNode(id: string): Promise<void> {
  const st = useSmartCanvasStore.getState();
  const node = st.nodes.find((n) => n.id === id);
  if (!node) return;
  const d = node.data as unknown as ImageReverseNodeData;
  const setF = (p: Partial<ImageReverseNodeData>): void => st.updateNodeData(id, p as Partial<SmartNodeData>);
  if (!d.modelId) {
    toast.error('未选视觉模型', '在节点上选一个支持识图的对话模型');
    return;
  }
  const sset = useSettingsStore.getState();
  const why = diagnoseChatModel(sset.configs, sset.plans, sset.activePlanId, d.modelId);
  if (why) {
    setF({ status: 'error', error: why, logs: [why] });
    toast.error('该对话模型不可用', why);
    return;
  }
  const up = computeUpstream(st.nodes, st.edges, id);
  const img = up.images[0] || d.inputImage?.url;
  if (!img) {
    toast.error('图像反推需要图片', '连一个图片来源，或在节点上传一张图');
    return;
  }
  setF({ status: 'running', error: null });
  const t0 = Date.now();
  const r = await window.electronAPI.lab.reverse({ imagePaths: [img], modelId: d.modelId, resultType: d.reverseType });
  if (!r.ok) {
    setF({ status: 'error', error: r.error.message, logs: [r.error.message] });
    toast.error(r.error.message, r.error.hint);
    return;
  }
  const text = cleanReversePrompt((r.data as { result?: unknown }).result);
  setF({ status: 'success', resultText: text, logs: [`图像反推 · ${d.modelId} · ${d.reverseType} · 用时 ${((Date.now() - t0) / 1000).toFixed(1)}s`] });
}

/** 视频反推：上游视频 → 渲染端抽帧 → 多图反推 → 文本，喂下游。 */
export async function runVideoReverseNode(id: string): Promise<void> {
  const st = useSmartCanvasStore.getState();
  const node = st.nodes.find((n) => n.id === id);
  if (!node) return;
  const d = node.data as unknown as VideoReverseNodeData;
  const setF = (p: Partial<VideoReverseNodeData>): void => st.updateNodeData(id, p as Partial<SmartNodeData>);
  if (!d.modelId) {
    toast.error('未选视觉模型', '在节点上选一个支持识图的对话模型');
    return;
  }
  const sset = useSettingsStore.getState();
  const why = diagnoseChatModel(sset.configs, sset.plans, sset.activePlanId, d.modelId);
  if (why) {
    setF({ status: 'error', error: why, logs: [why] });
    toast.error('该对话模型不可用', why);
    return;
  }
  const up = computeUpstream(st.nodes, st.edges, id);
  const v = up.videos[0];
  if (!v) {
    toast.error('视频反推需要视频', '连一个「视频上传」或「视频生成」节点进来');
    return;
  }
  setF({ status: 'running', error: null });
  const t0 = Date.now();
  const url = v.startsWith('data:') || v.startsWith('http') ? v : localPathToImageUrl(v);
  const frames = await captureVideoFrames(url, d.frameCount ?? 6);
  if (!frames.length) {
    setF({ status: 'error', error: '无法从视频抽帧（解码失败）', logs: ['抽帧失败'] });
    toast.error('视频抽帧失败', '换一个视频，或确认格式（mp4 / webm）');
    return;
  }
  const r = await window.electronAPI.lab.reverse({ imagePaths: frames, modelId: d.modelId, resultType: d.reverseType });
  if (!r.ok) {
    setF({ status: 'error', error: r.error.message, logs: [r.error.message] });
    toast.error(r.error.message, r.error.hint);
    return;
  }
  const text = cleanReversePrompt((r.data as { result?: unknown }).result);
  setF({ status: 'success', resultText: text, logs: [`视频反推 · ${frames.length} 帧 · ${d.modelId} · 用时 ${((Date.now() - t0) / 1000).toFixed(1)}s`] });
}

/** 视频缩放/补帧：上游视频 → 主进程 ffmpeg 重编码到目标宽高（可选 minterpolate 补帧到 30/60fps）→ 输出本地 mp4 喂下游。 */
// ───────────────────────── 切分 / 对稿（视觉元素分析 → 重绘拼合 / 逐元素检错）─────────────────────────

/** 切分重绘的「取消」标记（项间生效：在跑的元素跑完，不再发新的）。 */
const cancelledSeg = new Set<string>();

/** 写节点数据：当前文档走 live store；非当前文档（后台）走 doc 存储（跨文档不丢）。 */
function patchSmartNode(docId: string | null, id: string, patch: Partial<SmartNodeData>): void {
  if (!docId || docId === currentDocId()) {
    useSmartCanvasStore.getState().updateNodeData(id, patch);
  } else {
    patchDocNodes(docId, [{ nodeId: id, patch: patch as unknown as Record<string, unknown> }]);
  }
}

/** 切分/对稿的输入图（上游图片优先；本地上传兜底）。 */
function visionInputSrc(d: { inputImage?: { url: string } | null }, up: CollectedInputs): string | undefined {
  return up.images[0] || d.inputImage?.url || undefined;
}

/** 量图片自然尺寸（crossOrigin 安全）。 */
async function measureImage(src: string): Promise<{ w: number; h: number }> {
  const img = await loadImageCors(src);
  return { w: img.naturalWidth || 1, h: img.naturalHeight || 1 };
}

/** 落盘 dataURI → 磁盘路径（节点数据存路径不存大 base64，防 localStorage 配额爆）。失败回退原 dataURI。 */
async function persistDataUri(dataUri: string): Promise<string> {
  if (!dataUri.startsWith('data:')) return dataUri;
  try {
    const r = await window.electronAPI.storage.saveCanvasAsset({ dataUri });
    if (r.ok && r.data.filePath) return r.data.filePath;
  } catch {
    /* 落盘失败：保留 dataURI */
  }
  return dataUri;
}

/** 视觉模型可用性预检（返回不可用原因，可用返回 null）。 */
function visionModelGuard(modelId: string | undefined): string | null {
  if (!modelId) return '未选视觉模型：在工作台选一个支持识图的多模态对话模型';
  const sset = useSettingsStore.getState();
  return diagnoseChatModel(sset.configs, sset.plans, sset.activePlanId, modelId);
}

/** 切分：识别元素（一次视觉调用，含逐元素重绘提示词）。写 elements + 源图尺寸。 */
export async function runSegmentDetect(id: string): Promise<void> {
  const st = useSmartCanvasStore.getState();
  const node = st.nodes.find((n) => n.id === id);
  if (!node) return;
  const d = node.data as unknown as SegmentNodeData;
  const docId = currentDocId();
  const why = visionModelGuard(d.modelId);
  if (why) {
    patchSmartNode(docId, id, { status: 'error', error: why, logs: [why] });
    toast.error('视觉模型不可用', why);
    return;
  }
  const up = computeUpstream(st.nodes, st.edges, id);
  const src = visionInputSrc(d, up);
  if (!src) {
    toast.error('切分需要一张图', '连一个图片来源，或在工作台上传一张图');
    return;
  }
  patchSmartNode(docId, id, { status: 'running', phase: '识别元素中…', error: null });
  liveRunningNodes.add(id);
  try {
    const dim = await measureImage(src);
    const sendable = await sendableUrl(src);
    if (!sendable) throw new Error('读取图片失败');
    const r = await window.electronAPI.lab.visionAnalyze({
      imagePaths: [sendable],
      modelId: d.modelId as string,
      systemPrompt: SEGMENT_DETECT_SYSTEM
    });
    if (!r.ok) throw new Error(r.error.message);
    const els = parseSegElements(r.data.text, dim.w, dim.h);
    if (!els.length) throw new Error('没有识别到元素（可换更强的视觉模型，或在工作台手动加框）');
    patchSmartNode(docId, id, {
      status: 'idle',
      phase: undefined,
      imgW: dim.w,
      imgH: dim.h,
      elements: els,
      analysisSrc: src,
      composedSrc: undefined,
      error: null,
      logs: [`识别到 ${els.length} 个元素 · ${d.modelId}`]
    });
  } catch (e) {
    const msg = (e as Error).message;
    patchSmartNode(docId, id, { status: 'error', phase: undefined, error: msg, logs: [msg] });
    toast.error('识别元素失败', msg);
  } finally {
    liveRunningNodes.delete(id);
  }
}

/** 切分：重绘单个元素（裁出该元素 → 图生图 → 写回 regenSrc）。studio 单元素按钮用。 */
export async function runSegmentRegenOne(id: string, index: number): Promise<void> {
  const st = useSmartCanvasStore.getState();
  const node = st.nodes.find((n) => n.id === id);
  if (!node) return;
  const d = node.data as unknown as SegmentNodeData;
  const els = d.elements ?? [];
  const el = els[index];
  if (!el) return;
  const docId = currentDocId();
  const up = computeUpstream(st.nodes, st.edges, id);
  const src = visionInputSrc(d, up);
  if (!src) {
    toast.error('缺少源图');
    return;
  }
  const genModel = (d.genModelId || firstImageModel()).trim();
  if (!genModel) {
    toast.error('未配置生图模型', '设置页加一个绘画模型');
    return;
  }
  const writeEl = (patch: Partial<SegElement>): void => {
    const cur = (useSmartCanvasStore.getState().nodes.find((n) => n.id === id)?.data as unknown as SegmentNodeData)?.elements ?? els;
    const next = cur.map((x, i) => (i === index ? { ...x, ...patch } : x));
    patchSmartNode(docId, id, { elements: next });
  };
  writeEl({ status: 'running', error: null });
  liveRunningNodes.add(id);
  try {
    const img = await loadImageCors(src);
    const cropUri = cropToDataUri(img, el.box, 'png');
    const prompt = [d.stylePrompt?.trim(), el.prompt?.trim()].filter(Boolean).join('，') || el.label;
    const res = await generateOnce(genModel, prompt, { source: 'smart-canvas' }, cropUri ? [cropUri] : []);
    if (res.error || !res.images.length) writeEl({ status: 'error', error: res.error || '无输出' });
    else writeEl({ status: 'done', regenSrc: res.images[res.images.length - 1], error: null });
  } catch (e) {
    writeEl({ status: 'error', error: (e as Error).message });
  } finally {
    liveRunningNodes.delete(id);
  }
}

/** 切分：逐元素重绘（顺序，项间可取消）。 */
export async function runSegmentRegenAll(id: string): Promise<void> {
  const st = useSmartCanvasStore.getState();
  const node = st.nodes.find((n) => n.id === id);
  if (!node) return;
  const d = node.data as unknown as SegmentNodeData;
  const docId = currentDocId();
  const up = computeUpstream(st.nodes, st.edges, id);
  const src = visionInputSrc(d, up);
  const els = d.elements ?? [];
  if (!src || !els.length) {
    toast.error('先识别元素', '工作台里先「识别元素」');
    return;
  }
  const genModel = (d.genModelId || firstImageModel()).trim();
  if (!genModel) {
    toast.error('未配置生图模型', '设置页加一个绘画模型');
    return;
  }
  cancelledSeg.delete(id);
  liveRunningNodes.add(id);
  patchSmartNode(docId, id, { status: 'running', phase: '逐元素重绘中…', error: null });
  let img: HTMLImageElement;
  try {
    img = await loadImageCors(src);
  } catch {
    liveRunningNodes.delete(id);
    patchSmartNode(docId, id, { status: 'error', phase: undefined, error: '读取源图失败' });
    return;
  }
  const work = els.map((e) => ({ ...e }));
  for (let i = 0; i < work.length; i++) {
    if (cancelledSeg.has(id)) break;
    const el = work[i];
    work[i] = { ...el, status: 'running', error: null };
    patchSmartNode(docId, id, { elements: work.map((x) => ({ ...x })), phase: `重绘 ${i + 1}/${work.length}：${el.label}` });
    const cropUri = cropToDataUri(img, el.box, 'png');
    const prompt = [d.stylePrompt?.trim(), el.prompt?.trim()].filter(Boolean).join('，') || el.label;
    const res = await generateOnce(genModel, prompt, { source: 'smart-canvas' }, cropUri ? [cropUri] : []);
    if (res.error || !res.images.length) work[i] = { ...el, status: 'error', error: res.error || '无输出' };
    else work[i] = { ...el, status: 'done', regenSrc: res.images[res.images.length - 1], error: null };
    patchSmartNode(docId, id, { elements: work.map((x) => ({ ...x })) });
  }
  liveRunningNodes.delete(id);
  const okCount = work.filter((x) => x.status === 'done').length;
  patchSmartNode(docId, id, { status: 'idle', phase: undefined, elements: work, logs: [`重绘完成 ${okCount}/${work.length}`] });
}

/** 切分：把重绘好的元素按原框 1:1 拼回整图（输出 composedSrc）。 */
export async function runSegmentCompose(id: string): Promise<void> {
  const st = useSmartCanvasStore.getState();
  const node = st.nodes.find((n) => n.id === id);
  if (!node) return;
  const d = node.data as unknown as SegmentNodeData;
  const docId = currentDocId();
  const up = computeUpstream(st.nodes, st.edges, id);
  const src = visionInputSrc(d, up);
  const els = d.elements ?? [];
  if (!src || !d.imgW || !d.imgH) {
    toast.error('先识别元素');
    return;
  }
  const pieces = els.filter((e) => e.regenSrc).map((e) => ({ src: e.regenSrc as string, box: e.box }));
  patchSmartNode(docId, id, { status: 'running', phase: '拼合中…' });
  try {
    const dataUri = await compositeAtBoxes(src, d.imgW, d.imgH, pieces, 'png');
    if (!dataUri) throw new Error('合成失败');
    const out = await persistDataUri(dataUri);
    const patch = { status: 'success' as const, phase: undefined, composedSrc: out, error: null, logs: [`拼合完成 · ${pieces.length} 个元素`] };
    patchSmartNode(docId, id, patch);
    persistActiveDocTerminal(docId, id, { status: 'success', composedSrc: out });
  } catch (e) {
    const msg = (e as Error).message;
    patchSmartNode(docId, id, { status: 'error', phase: undefined, error: msg });
  }
}

/** 切分：一键全流程（识别 → 逐元素重绘 → 拼回整图）。RUNNABLE / 运行此节点 / 运行全部 走它。 */
export async function runSegmentNode(id: string): Promise<void> {
  const d0 = useSmartCanvasStore.getState().nodes.find((n) => n.id === id)?.data as unknown as SegmentNodeData | undefined;
  if (!d0?.elements?.length) {
    await runSegmentDetect(id);
    const da = useSmartCanvasStore.getState().nodes.find((n) => n.id === id)?.data as unknown as SegmentNodeData | undefined;
    if (!da?.elements?.length) return; // 识别失败
  }
  await runSegmentRegenAll(id);
  if (cancelledSeg.has(id)) {
    cancelledSeg.delete(id);
    return;
  }
  await runSegmentCompose(id);
}

/** 切分：取消逐元素重绘（项间生效）。 */
export function cancelSegment(id: string): void {
  cancelledSeg.add(id);
  liveRunningNodes.delete(id);
  patchSmartNode(currentDocId(), id, { status: 'idle', phase: undefined });
}

/** 对稿：多模态模型逐元素检错 → 元素清单 + 审稿报告 + 标注图。 */
export async function runProofNode(id: string): Promise<void> {
  const st = useSmartCanvasStore.getState();
  const node = st.nodes.find((n) => n.id === id);
  if (!node) return;
  const d = node.data as unknown as ProofNodeData;
  const docId = currentDocId();
  const why = visionModelGuard(d.modelId);
  if (why) {
    patchSmartNode(docId, id, { status: 'error', error: why, logs: [why] });
    toast.error('视觉模型不可用', why);
    return;
  }
  const up = computeUpstream(st.nodes, st.edges, id);
  const src = visionInputSrc(d, up);
  if (!src) {
    toast.error('对稿需要一张图', '连一个图片来源，或在工作台上传一张图');
    return;
  }
  patchSmartNode(docId, id, { status: 'running', error: null });
  liveRunningNodes.add(id);
  try {
    const dim = await measureImage(src);
    const sendable = await sendableUrl(src);
    if (!sendable) throw new Error('读取图片失败');
    const r = await window.electronAPI.lab.visionAnalyze({
      imagePaths: [sendable],
      modelId: d.modelId as string,
      systemPrompt: PROOF_SYSTEM
    });
    if (!r.ok) throw new Error(r.error.message);
    const els = parseProofElements(r.data.text, dim.w, dim.h);
    // 解析不到任何元素 = 视觉模型多半没返回有效 JSON：当作失败抛出，
    // 否则 buildProofReport([]) 会给出「未发现问题」的假「全清」结论，误导用户（与 runSegmentDetect 行为一致）。
    if (!els.length) throw new Error('未解析到元素（视觉模型可能没返回有效 JSON）——可换更强的多模态模型重试');
    const report = buildProofReport(els);
    const problems = els.filter((e) => !e.ok);
    let annotated: string | undefined;
    if (problems.length) {
      try {
        const dataUri = await drawAnnotated(
          src,
          dim.w,
          dim.h,
          problems.map((e) => ({ box: e.box, color: severityColor(e.severity), label: e.label }))
        );
        if (dataUri) annotated = await persistDataUri(dataUri);
      } catch {
        /* 标注图失败不影响报告 */
      }
    }
    const patch = {
      status: 'success' as const,
      imgW: dim.w,
      imgH: dim.h,
      elements: els,
      reportText: report,
      annotatedSrc: annotated,
      analysisSrc: src,
      error: null,
      logs: [`检查 ${els.length} 个元素 · 发现 ${problems.length} 处问题`]
    };
    patchSmartNode(docId, id, patch);
    persistActiveDocTerminal(docId, id, patch as unknown as Record<string, unknown>);
  } catch (e) {
    const msg = (e as Error).message;
    patchSmartNode(docId, id, { status: 'error', error: msg, logs: [msg] });
    toast.error('对稿分析失败', msg);
  } finally {
    liveRunningNodes.delete(id);
  }
}

export async function runScaleVideo(
  id: string,
  width: number | null,
  height: number | null,
  fps?: number | null
): Promise<void> {
  const st = useSmartCanvasStore.getState();
  const node = st.nodes.find((n) => n.id === id);
  if (!node) return;
  const setF = (p: Partial<ScaleNodeData>): void => st.updateNodeData(id, p as Partial<SmartNodeData>);
  const up = computeUpstream(st.nodes, st.edges, id);
  const v = up.videos[0];
  if (!v) {
    toast.error('没有上游视频', '连一个视频来源进来');
    return;
  }
  if (v.startsWith('data:')) {
    setF({ vidStatus: 'error', vidError: '该视频是内联数据，无法缩放（请用视频上传节点选本地文件）' });
    toast.error('无法缩放该视频', '请改用「视频上传」节点选本地文件');
    return;
  }
  setF({ vidStatus: 'running', vidError: null });
  if (fps) toast.info('补帧处理中（运动补偿插帧较慢）', '每 5 秒视频约需 1~3 分钟，请耐心等待');
  const r = await window.electronAPI.video.scale({ inputPath: v, width, height, fps: fps ?? null });
  if (!r.ok) {
    setF({ vidStatus: 'error', vidError: r.error.message });
    toast.error(r.error.message, r.error.hint);
    return;
  }
  setF({ vidStatus: 'success', outputVideo: r.data.path, vidError: null });
  backfillVideoPoster(r.data.imageId, r.data.path);
  toast.success(fps ? `视频处理完成（已补帧到 ${fps}fps）` : '视频缩放完成', '已输出处理后的视频并自动入资产库，可连下游');
}

/** 产物视频入库后的封面补抓：渲染端抓首帧 → api:video:save-thumbnail（后台静默，失败忽略）。 */
function backfillVideoPoster(imageId: number | undefined, filePath: string): void {
  if (imageId == null || !filePath) return;
  void captureVideoPoster(localPathToImageUrl(filePath)).then((du) => {
    if (du) void window.electronAPI.video.saveThumbnail({ imageId, dataUri: du });
  });
}

// ───────────────────────── 插帧节点（本地 RIFE：api:interp:run 同步等完成，进度走 interp:progress）─────────────────────────

/** clientTag → nodeId（模块级：interp:progress 按 tag 找节点回填进度，切页不丢） */
const pendingInterp = new Map<string, string>();

/** 插帧：上游视频 → 主进程 RIFE 管线（拆帧→AI 插帧→合帧）→ 输出 mp4 喂下游。 */
export async function runFrameInterpNode(id: string): Promise<void> {
  const st = useSmartCanvasStore.getState();
  const node = st.nodes.find((n) => n.id === id);
  if (!node || node.type !== 'frame-interp') return;
  const d = node.data as unknown as FrameInterpNodeData;
  const setF = (p: Partial<FrameInterpNodeData>): void =>
    useSmartCanvasStore.getState().updateNodeData(id, p as Partial<SmartNodeData>);
  if (d.status === 'running') return;
  const up = computeUpstream(st.nodes, st.edges, id);
  const v = up.videos[0];
  if (!v) {
    toast.error('插帧需要视频', '连一个「视频上传 / 视频生成 / 缩放」节点进来');
    return;
  }
  if (v.startsWith('data:')) {
    setF({ status: 'error', error: '该视频是内联数据，无法插帧（请用视频上传节点选本地文件）' });
    toast.error('无法插帧该视频', '请改用「视频上传」节点选本地文件');
    return;
  }
  const clientTag = crypto.randomUUID();
  pendingInterp.set(clientTag, id);
  setF({ status: 'running', progress: 0, phase: '排队中…', error: null, taskId: undefined });
  try {
    const r = await window.electronAPI.interp.run({
      inputPath: v,
      targetFps: d.targetFps || 60,
      model: d.model,
      clientTag
    });
    if (!r.ok) {
      if (r.error.code === 'CANCELLED') {
        setF({ status: 'idle', progress: undefined, phase: undefined, taskId: undefined });
        return;
      }
      setF({ status: 'error', error: r.error.message, progress: undefined, phase: undefined, taskId: undefined });
      toast.error(r.error.message, r.error.hint);
      return;
    }
    setF({
      status: 'success',
      outputVideo: r.data.outputPath,
      srcFps: r.data.srcFps,
      durationMs: r.data.elapsedMs,
      progress: 100,
      phase: undefined,
      error: null,
      taskId: undefined
    });
    backfillVideoPoster(r.data.imageId, r.data.outputPath);
    toast.success(
      `插帧完成：${r.data.srcFps ?? '?'}fps → ${r.data.targetFps}fps`,
      `用时 ${((r.data.elapsedMs ?? 0) / 1000).toFixed(1)}s，已自动入资产库，可连下游或右键另存`
    );
    // 完成自动弹出放大播放（统一 Lightbox），第一时间对比流畅度；Esc 即关
    useSmartPreviewStore.getState().open(
      [{ src: localPathToImageUrl(r.data.outputPath), type: 'video', meta: { filePath: r.data.outputPath } }],
      0
    );
  } finally {
    pendingInterp.delete(clientTag);
  }
}

/** 取消插帧（节点上的取消按钮）。 */
export async function cancelFrameInterp(id: string): Promise<void> {
  const st = useSmartCanvasStore.getState();
  const node = st.nodes.find((n) => n.id === id);
  const d = node?.data as unknown as FrameInterpNodeData | undefined;
  // taskId 由 interp:progress 首条推送回填；还没拿到时兜底全取消（插帧本就串行单任务）
  await window.electronAPI.interp.cancel(d?.taskId ? { taskId: d.taskId } : {});
}

// ───────────────────────── 保真放大 / 图像转矢量节点（复刻工具箱 api:upscale / api:vec）─────────────────────────

/** 上游图 src 是否「裸本地路径」（非 data:/http/mengbi-image://blob:）。 */
function isPlainLocalPath(src: string): boolean {
  return !/^(data:|https?:|mengbi-image:|blob:)/i.test(src);
}

/** 保真放大：接上游图 → api:upscale:run-single（同步等完成，主进程自动入资产库）→ 输出放大图喂下游。 */
export async function runUpscaleNode(id: string): Promise<void> {
  const st = useSmartCanvasStore.getState();
  const node = st.nodes.find((n) => n.id === id);
  if (!node || node.type !== 'upscale') return;
  const d = node.data as unknown as UpscaleNodeData;
  const setF = (p: Partial<UpscaleNodeData>): void =>
    useSmartCanvasStore.getState().updateNodeData(id, p as Partial<SmartNodeData>);
  if (d.status === 'running') return;
  if (!d.modelName) {
    toast.error('请先选放大模型', '在节点上选一个模型（未装引擎先一键安装）');
    return;
  }
  const up = computeUpstream(st.nodes, st.edges, id);
  const src = up.images[0];
  if (!src) {
    toast.error('放大需要图片', '连一个图片来源（图片 / 生图 / ComfyUI / 缩放 / 结果）进来');
    return;
  }
  setF({ status: 'running', error: null, logs: ['处理中…'] });
  const t0 = Date.now();
  const plain = isPlainLocalPath(src);
  let du = '';
  if (!plain) {
    du = (await sendableUrl(src)) ?? '';
    if (!du) {
      setF({ status: 'error', error: '上游图片无法读取' });
      return;
    }
  }
  const r = await window.electronAPI.upscale.runSingle(
    plain
      ? { inputPath: src, modelName: d.modelName, scale: d.scale, format: d.format, tile: 0, gpuId: 'auto', tta: false, backend: 'ncnn', keepAlpha: true }
      : { inputDataUri: du, modelName: d.modelName, scale: d.scale, format: d.format, tile: 0, gpuId: 'auto', tta: false, backend: 'ncnn', keepAlpha: true }
  );
  if (!r.ok) {
    setF({ status: 'error', error: r.error.message, logs: [r.error.message] });
    toast.error(r.error.message, r.error.hint);
    return;
  }
  const ms = r.data.elapsedMs ?? Date.now() - t0;
  setF({
    status: 'success',
    outputImage: r.data.outputPath,
    outW: r.data.outputW,
    outH: r.data.outputH,
    durationMs: ms,
    error: null,
    logs: [`放大 ${d.scale}× · ${r.data.outputW}×${r.data.outputH} · 用时 ${(ms / 1000).toFixed(1)}s`]
  });
  useSmartCanvasStore.getState().ensureResultNode(id);
  toast.success('放大完成', '已输出放大图并自动入资产库，可连下游');
}

// taskId → 矢量化节点（vec:progress 按 taskId 路由结果；切页不丢）
const pendingVec = new Map<string, { nodeId: string; docId: string | null }>();
const pendingVecResolve = new Map<string, () => void>();
const pendingVecTimer = new Map<string, ReturnType<typeof setTimeout>>();

/** 矢量化输出目录：跟随工具箱（tools_storage_path / image_storage_path）下的 /vec 子目录。 */
function vecOutputDir(): string {
  const prefs = useSettingsStore.getState().prefs;
  const base = (prefs.tools_storage_path || prefs.image_storage_path || '').trim();
  if (!base) return '';
  const sep = base.includes('\\') ? '\\' : '/';
  return base.endsWith(sep) ? `${base}vec` : `${base}${sep}vec`;
}

/** 图像转矢量：接上游图 → api:vec:run-vtracer / run-potrace（异步，vec:progress 回结果路径）→ 输出 SVG。 */
export async function runVectorizeNode(id: string): Promise<void> {
  const st = useSmartCanvasStore.getState();
  const node = st.nodes.find((n) => n.id === id);
  if (!node || node.type !== 'vectorize') return;
  const d = node.data as unknown as VectorizeNodeData;
  const setF = (p: Partial<VectorizeNodeData>): void =>
    useSmartCanvasStore.getState().updateNodeData(id, p as Partial<SmartNodeData>);
  if (d.status === 'running') return;
  const up = computeUpstream(st.nodes, st.edges, id);
  const src = up.images[0];
  if (!src) {
    toast.error('矢量化需要图片', '连一个图片来源进来');
    return;
  }
  const outputDir = vecOutputDir();
  if (!outputDir) {
    toast.error('未设置输出目录', '到「设置 → 存储」配置工具箱 / 图片存储路径');
    return;
  }
  // vec 只吃文件路径：内联/URL 图先落临时文件
  let inputPath = src;
  if (!isPlainLocalPath(src)) {
    const du = await sendableUrl(src);
    if (!du) {
      setF({ status: 'error', error: '上游图片无法读取' });
      return;
    }
    const tr = await window.electronAPI.storage.saveTempImage({ dataUri: du });
    if (!tr.ok) {
      setF({ status: 'error', error: '无法准备输入图片' });
      return;
    }
    inputPath = tr.data.filePath;
  }
  setF({ status: 'running', error: null, progress: 0, logs: ['提交中…'], outputSvgPath: null });
  const docId = currentDocId();
  const r = await (d.vmode === 'potrace'
    ? window.electronAPI.vec.runPotrace({ inputPath, outputDir, naming: 'suffix', onConflict: 'rename' })
    : window.electronAPI.vec.runVtracer({ inputPath, outputDir, naming: 'suffix', onConflict: 'rename' }));
  if (!r.ok) {
    setF({ status: 'error', error: r.error.message, logs: [r.error.message] });
    toast.error(r.error.message, r.error.hint);
    return;
  }
  const taskId = r.data.taskId;
  setF({ taskId, batchId: r.data.batchId });
  pendingVec.set(taskId, { nodeId: id, docId });
  // 提交即建下游结果节点（仿生图/放大）：无论结果在当前还是后台文档回来，结果节点都已存在、能拉到 SVG
  useSmartCanvasStore.getState().ensureResultNode(id);
  await new Promise<void>((res) => {
    pendingVecResolve.set(taskId, res);
    const timer = setTimeout(() => {
      pendingVecTimer.delete(taskId);
      if (pendingVecResolve.has(taskId)) {
        pendingVecResolve.delete(taskId);
        res();
      }
    }, 300_000); // 兜底：5 分钟没等到结果也放行，不卡 running
    pendingVecTimer.set(taskId, timer);
  });
}

/** vec:progress 路由：按 taskId 找矢量化节点，终态写 SVG 结果（当前文档直接写，后台文档 patchDocNodes）。 */
function routeVecProgress(p: VecTaskProgressPayload): void {
  const rec = pendingVec.get(p.taskId);
  if (!rec) return;
  const final = p.status === 'succeeded' || p.status === 'failed' || p.status === 'cancelled';
  const patch: Partial<VectorizeNodeData> =
    p.status === 'succeeded'
      ? { status: 'success', outputSvgPath: p.outputPath ?? null, progress: 100, error: null, logs: [`矢量化完成 · ${p.actualEngine ?? p.requestedMode}`] }
      : p.status === 'failed'
        ? { status: 'error', error: p.errorMessageZh ?? '矢量化失败', progress: undefined }
        : p.status === 'cancelled'
          ? { status: 'idle', progress: undefined }
          : { progress: Math.round(p.progress) };
  const cur = useSmartCanvasStore.getState().nodes.find((n) => n.id === rec.nodeId);
  if (cur) {
    useSmartCanvasStore.getState().updateNodeData(rec.nodeId, patch as Partial<SmartNodeData>);
    // 结果节点已在提交时建好（runVectorizeNode），这里只回灌数据；后台文档走 patchDocNodes
  } else if (rec.docId) {
    patchDocNodes(rec.docId, [{ nodeId: rec.nodeId, patch }]);
  }
  if (final) {
    const timer = pendingVecTimer.get(p.taskId);
    if (timer) {
      clearTimeout(timer);
      pendingVecTimer.delete(p.taskId);
    }
    pendingVec.delete(p.taskId);
    const res = pendingVecResolve.get(p.taskId);
    if (res) {
      pendingVecResolve.delete(p.taskId);
      res();
    }
  }
}

// ───────────────────────── 视频剪辑节点（本地 ffmpeg：api:video:edit op='clip' 同步等完成）─────────────────────────

/**
 * 视频剪辑：把节点存的片段（已 reconcile 自上游视频 + 用户排序/裁切）按时间轴一次性合成 →
 * 段间转场 + 每段音频/变速 + 整体调色 + 文字叠加（构图在主进程纯函数 buildClipFilterGraph）→ 输出 mp4 喂下游。
 * 只用持久化在节点上的 segments（其 src 来自上游视频）；运行时校验这些 src 仍连在上游，过滤掉已断开/内联的。
 */
export async function runVideoClipNode(id: string): Promise<void> {
  const st = useSmartCanvasStore.getState();
  const node = st.nodes.find((n) => n.id === id);
  if (!node || node.type !== 'video-clip') return;
  const d = node.data as unknown as VideoClipNodeData;
  const setF = (p: Partial<VideoClipNodeData>): void =>
    useSmartCanvasStore.getState().updateNodeData(id, p as Partial<SmartNodeData>);
  if (d.status === 'running') return;
  const up = computeUpstream(st.nodes, st.edges, id);
  const upVideos = up.videos.filter((v) => v && !v.startsWith('data:'));
  // 运行时自我 reconcile（不依赖组件渲染过 effect）：保留已排序/裁切的片段，按上游补默认新片段、剔除断开的。
  // 解决「中间节点从未渲染 / 滚出视口（onlyRenderVisibleElements）/ 新建即运行全部」时 d.segments 仍为空而误报无片段。
  const segs = reconcileSegments(upVideos, d.segments ?? []);
  if (!sameSegmentSrcs(segs, d.segments ?? [])) setF({ segments: segs }); // 写回持久化，节点 UI 同步
  if (!segs.length) {
    setF({ status: 'error', error: '没有可剪辑的片段：连入「视频上传 / 视频生成 / 缩放 / 插帧」节点（本地文件，不支持内联数据）' });
    toast.error('没有可剪辑的视频片段', '连入视频来源后，在节点或剪辑工作台里排序/裁切');
    return;
  }
  setF({ status: 'running', error: null, progress: undefined });
  const t0 = Date.now();
  const r = await window.electronAPI.video.edit({
    op: 'clip',
    inputs: segs.map((s) => s.src),
    segments: segs.map((s) => ({
      src: s.src,
      trimStart: s.trimStart,
      trimEnd: s.trimEnd,
      speed: s.speed,
      volume: s.volume,
      muted: s.muted,
      fadeIn: s.fadeIn,
      fadeOut: s.fadeOut,
      transition: s.transition,
      transitionDur: s.transitionDur
    })),
    texts: (d.texts ?? []).map((t) => ({ text: t.text, start: t.start, end: t.end, x: t.x, y: t.y, fontSize: t.fontSize, color: t.color })),
    brightness: d.brightness,
    contrast: d.contrast,
    saturation: d.saturation,
    gamma: d.gamma,
    hue: d.hue,
    fps: d.fps
  });
  if (!r.ok) {
    setF({ status: 'error', error: r.error.message });
    toast.error(r.error.message, r.error.hint);
    return;
  }
  setF({ status: 'success', outputVideo: r.data.path, error: null, durationMs: Date.now() - t0 });
  backfillVideoPoster(r.data.imageId, r.data.path);
  toast.success(`视频剪辑完成（${segs.length} 段）`, '已输出并自动入资产库，可连下游或右键另存');
}

/** interp:progress 路由：按 clientTag 找节点回填 进度/阶段/源帧率/taskId（App 级监听，切页不丢）。 */
function routeInterpProgress(p: InterpProgressPayload): void {
  if (!p.clientTag) return;
  const nodeId = pendingInterp.get(p.clientTag);
  if (!nodeId) return;
  useSmartCanvasStore.getState().updateNodeData(nodeId, {
    progress: p.percent,
    phase: p.phase,
    ...(p.srcFps != null ? { srcFps: p.srcFps } : {}),
    taskId: p.taskId
  } as Partial<SmartNodeData>);
}

// ───────────────────────── 视频节点（异步：提交→轮询在主进程，结果走 video:done）─────────────────────────
const pendingVideo = new Map<string, { nodeId: string; docId: string | null; startedAt: number }>();
const pendingVideoResolve = new Map<string, () => void>();

function setVideo(id: string, patch: Partial<VideoNodeData>): void {
  useSmartCanvasStore.getState().updateNodeData(id, patch as Partial<SmartNodeData>);
}

// adapter 路径的 video_kind（其余 kling/sora/unified 走 legacy 简易引擎）。
const ADAPTER_VIDEO_KINDS = new Set(['seedance', 'veo', 'runway', 'fal', 'custom']);
function isVideoAdapterKind(kind: string | null | undefined): boolean {
  return !!kind && ADAPTER_VIDEO_KINDS.has(kind);
}
// 协议自动纠偏提示：每个模型每会话只 toast 一次（批量/重试不刷屏）
const videoKindHintShown = new Set<string>();

interface VideoTarget {
  cfg: ApiConfig;
  videoKind: string;
  actualId: string;
  providerName: string;
}

/** 按复合标识/旧裸名在 type='video' 配置里解析出 凭证/协议/真实模型 id。 */
function resolveVideoTarget(d: VideoNodeData): VideoTarget | null {
  const configs = useSettingsStore.getState().configs;
  const r = resolveModelRef(configs, 'video', d.modelId);
  if (!r) return null;
  const cfg = r.config;
  // 协议自动纠偏（与主进程 findVideoConfig 同步）：legacy 配置 + 地址/模型明显是别家 → 用对的协议，
  // 这样渲染端才会构造 adapter 统一请求（input.request），主进程才能走 adapter 路径。
  const stored = normalizeVideoKind(cfg.video_kind) ?? 'kling';
  const videoKind = autoCorrectVideoKind(stored, cfg.base_url ?? '', r.actualId) ?? 'kling';
  if (videoKind !== stored && !videoKindHintShown.has(d.modelId)) {
    videoKindHintShown.add(d.modelId);
    toast.info(
      `已按地址/模型自动匹配视频协议（${videoKind}）`,
      '建议在 设置 → 视频模型 里把该配置的「视频 API 协议」改成一致，消除此提示'
    );
  }
  const merged = useVideoProvidersStore.getState().config;
  return {
    cfg,
    videoKind,
    actualId: r.actualId,
    providerName: merged.providers[videoKind]?.providerName ?? videoKind
  };
}

/** 收集上游 + 节点上的素材（原始 src，未转换）。 */
function collectVideoInputs(d: VideoNodeData, up: { prompts: string[]; images: string[] }): {
  prompt: string;
  upImages: string[];
  videoUrls: string[];
  audioUrls: string[];
} {
  return {
    prompt: [up.prompts.join('\n'), d.prompt].filter((s) => s && s.trim()).join('\n').trim(),
    upImages: up.images.slice(),
    videoUrls: (d.referenceVideoUrls ?? []).filter((u) => u && u.trim()),
    audioUrls: (d.referenceAudioUrls ?? []).filter((u) => u && u.trim())
  };
}

/** 组装统一请求（images 已是可发送 URL：dry-run 传原始、真实运行传转换后）。 */
function assembleVideoRequest(
  d: VideoNodeData,
  videoKind: string,
  actualId: string,
  prompt: string,
  images: string[],
  videoUrls: string[],
  audioUrls: string[],
  sizeOverride?: { aspect?: string; resolution?: string }
): VideoGenerationRequest {
  const mode = normalizeVideoMode(d.mode);
  const roleImages: VideoRequestImage[] = [];
  let imageUrls: string[] | undefined;
  const refImgs = (d.referenceImageUrls ?? []).filter((u) => u && u.trim());

  switch (mode) {
    case 'text_to_video':
      break;
    case 'image_to_video': {
      const f = (d.firstFrameUrl && d.firstFrameUrl.trim()) || images[0];
      if (f) roleImages.push({ url: f, role: 'first_frame' });
      break;
    }
    case 'continuous': {
      const f = (d.previousLastFrameUrl && d.previousLastFrameUrl.trim()) || images[0];
      if (f) roleImages.push({ url: f, role: 'first_frame' });
      break;
    }
    case 'first_last_frame': {
      const f = (d.firstFrameUrl && d.firstFrameUrl.trim()) || images[0];
      const l = (d.lastFrameUrl && d.lastFrameUrl.trim()) || images[1];
      if (f) roleImages.push({ url: f, role: 'first_frame' });
      if (l) roleImages.push({ url: l, role: 'last_frame' });
      break;
    }
    case 'reference_images':
      imageUrls = refImgs.length ? [...images, ...refImgs] : images;
      break;
    case 'reference_video':
      break;
    case 'reference_audio':
      if (images.length) imageUrls = images;
      break;
  }

  return {
    providerId: videoKind,
    modelId: actualId,
    mode,
    prompt,
    negativePrompt: d.negativePrompt?.trim() ? d.negativePrompt : undefined,
    duration: Number(d.duration) || 5,
    aspectRatio: sizeOverride?.aspect || d.aspect || 'adaptive',
    resolution: sizeOverride?.resolution || d.resolution || '720p',
    seed: d.seed ?? undefined,
    generateAudio: !!d.generateAudio,
    returnLastFrame: d.returnLastFrame ?? mode === 'continuous',
    images: roleImages.length ? roleImages : undefined,
    imageUrls: imageUrls && imageUrls.length ? imageUrls : undefined,
    videoUrls: mode === 'reference_video' || mode === 'reference_audio' ? (videoUrls.length ? videoUrls : undefined) : undefined,
    audioUrls: mode === 'reference_audio' ? (audioUrls.length ? audioUrls : undefined) : undefined
  };
}

/**
 * 本地/协议路径 → 可发送 URL（http/data 原样；mengbi-image:// 或本地 → fetch 成 dataURL）。
 * 失败返回 null（绝不回退原始本地路径——避免把 file:// / mengbi-image:// 当 URL 发给远端、或泄露本地路径）。
 */
export async function sendableUrl(src: string): Promise<string | null> {
  if (!src) return null;
  if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('data:')) return src;
  try {
    const url = src.startsWith('mengbi-image://') ? src : localPathToImageUrl(src);
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const blob = await resp.blob();
    return await new Promise<string | null>((res) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result));
      fr.onerror = () => res(null);
      fr.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export interface VideoDryRun {
  ok: boolean;
  legacy: boolean;
  issues: string[];
  cost: CostEstimate | null;
  needConfirm: boolean;
  summary: string;
}

/** 干跑校验 + 费用预估（不提交、不联网、不烧钱）。供节点「校验」按钮与生成前二次确认用。 */
export function dryRunVideo(videoId: string): VideoDryRun {
  const st = useSmartCanvasStore.getState();
  const node = st.nodes.find((n) => n.id === videoId);
  if (!node || node.type !== 'video') return { ok: false, legacy: false, issues: ['节点不存在'], cost: null, needConfirm: false, summary: '' };
  const d = node.data as unknown as VideoNodeData;
  if (!d.modelId) return { ok: false, legacy: false, issues: ['未选择视频模型'], cost: null, needConfirm: false, summary: '' };
  const target = resolveVideoTarget(d);
  if (!target) return { ok: false, legacy: false, issues: ['该模型未在「设置 → 视频模型」配置'], cost: null, needConfirm: false, summary: '' };

  const up = computeUpstream(st.nodes, st.edges, videoId);
  const inputs = collectVideoInputs(d, up);

  if (!isVideoAdapterKind(target.videoKind)) {
    // legacy 引擎：只做最基础检查
    const ok = !!(inputs.prompt || inputs.upImages[0]);
    return {
      ok,
      legacy: true,
      issues: ok ? [] : ['需要提示词或一张图片'],
      cost: null,
      needConfirm: false,
      summary: `${target.providerName} · ${normalizeVideoMode(d.mode)} · ${d.duration}s · ${d.resolution}`
    };
  }

  const merged = useVideoProvidersStore.getState().config;
  const model = findVideoModel(merged, target.actualId);
  const req = assembleVideoRequest(
    d,
    target.videoKind,
    target.actualId,
    inputs.prompt,
    inputs.upImages,
    inputs.videoUrls,
    inputs.audioUrls
  );
  const cost = estimateVideoCost(req, model);
  const summary = `${model?.displayName ?? target.actualId} · ${normalizeVideoMode(d.mode)} · ${req.duration}s · ${req.resolution} · ${req.aspectRatio}${req.generateAudio ? ' · 有声' : ''}`;
  if (!model) {
    // 无能力模板（自定义模型 id）→ 宽松校验：有输入即可
    const hasInput = !!(
      req.prompt?.trim() ||
      req.images?.length ||
      req.imageUrls?.length ||
      req.videoUrls?.length ||
      req.audioUrls?.length
    );
    return {
      ok: hasInput,
      legacy: false,
      issues: hasInput ? [] : ['缺少输入：提示词或素材（该模型无能力模板，按宽松校验）'],
      cost,
      needConfirm: hasInput && needsCostConfirm(cost, merged),
      summary: `${summary}（无模板·宽松）`
    };
  }
  const v = validateVideoRequest(req, model);
  const needConfirm = v.ok && needsCostConfirm(cost, merged);
  return { ok: v.ok, legacy: false, issues: v.issues.map((i) => i.message), cost, needConfirm, summary };
}

/** 运行一个视频节点：adapter 路径走统一请求 + 校验；legacy 路径保持原行为。提交 → 等 video:done。 */
export async function runVideoNode(videoId: string): Promise<void> {
  const st = useSmartCanvasStore.getState();
  const node = st.nodes.find((n) => n.id === videoId);
  if (!node || node.type !== 'video') return;
  const d = node.data as unknown as VideoNodeData;
  if (!d.modelId) {
    toast.error('请先在视频节点选择视频模型', '到「设置 → 视频模型」配置后再选');
    return;
  }
  const target = resolveVideoTarget(d);
  if (!target) {
    toast.error('该模型未配置', '到「设置 → 视频模型」添加，并在模型映射里加入该显示名');
    return;
  }
  const up = computeUpstream(st.nodes, st.edges, videoId);
  const inputs = collectVideoInputs(d, up);
  // 上游「尺寸来源」覆盖：按 emit 决定喂比例 / 分辨率 / 两者；分辨率吸附到供应商支持的最近档
  const upSize = up.sizes[0];
  let sizeOverride: { aspect?: string; resolution?: string } | undefined;
  if (upSize) {
    const e = upSize.emit ?? 'both';
    sizeOverride = {};
    if (e !== 'resolution') sizeOverride.aspect = upSize.aspect;
    if (e !== 'aspect') {
      sizeOverride.resolution = nearestResolution(
        upSize.height,
        findVideoModel(useVideoProvidersStore.getState().config, target.actualId)?.limits?.supportedResolutions ?? ['480p', '720p', '1080p']
      );
    }
  }
  // 画幅「自动」（d.aspect 空，且没有上游尺寸来源覆盖比例）：跟随首张上游图（或选定的首帧/参考图）的比例。
  // 回写 autoAspect 供节点卡片展示；量不到则保持 adaptive。
  let autoAspect: string | undefined;
  if (!d.aspect && !sizeOverride?.aspect) {
    const autoSrc = (d.firstFrameUrl && d.firstFrameUrl.trim()) || up.images[0] || (d.referenceImageUrls ?? [])[0];
    if (autoSrc) {
      autoAspect = await measureAspect(autoSrc);
      if (autoAspect) sizeOverride = { ...(sizeOverride ?? {}), aspect: autoAspect };
    }
  }
  setVideo(videoId, { autoAspect: !d.aspect ? autoAspect : undefined });
  const docId = currentDocId();
  // 视频等待不限时（2026-06-12）：供应商 timeout=0（默认）时渲染端**不设兜底计时器**——
  // 成败完全由主进程 video:done 推送驱动（主进程会一直轮询：上游报错才判失败）；节点上有「取消」可随时停。
  // 供应商显式设了上限（timeout>0）时保留「上限+90s」兜底，且必须严格大于主进程的 timeout（防成功结果被提前判死）。
  const providerTimeout = useVideoProvidersStore.getState().config.providers[target.videoKind]?.timeout ?? 0;
  const fallbackMs = providerTimeout > 0 ? providerTimeout + 90_000 : 0;

  let genInput: Parameters<typeof window.electronAPI.video.generate>[0];
  let costNote = '';
  let inputImages: string[] = [];

  if (isVideoAdapterKind(target.videoKind)) {
    // adapter 路径
    const merged = useVideoProvidersStore.getState().config;
    const model = findVideoModel(merged, target.actualId);
    // 上游图片转可发送 URL（data:/mengbi → dataURL）；任一失败即中止（不把本地路径发远端）
    const sentRaw = await Promise.all(inputs.upImages.map((s) => sendableUrl(s)));
    if (sentRaw.some((x) => x === null)) {
      setVideo(videoId, { status: 'error', error: '部分上游图片无法读取，已中止（避免把本地路径发到远端）' });
      toast.error('图片读取失败', '部分上游图片无法转换为可发送格式，已中止');
      return;
    }
    const sentImages = sentRaw as string[];
    inputImages = sentImages;
    const req = assembleVideoRequest(
      d,
      target.videoKind,
      target.actualId,
      inputs.prompt,
      sentImages,
      inputs.videoUrls,
      inputs.audioUrls,
      sizeOverride
    );
    // 无能力模板（第三方/自定义视频模型 id）→ 宽松校验：有输入即放行（对齐 dryRunVideo）。
    // 否则严格按能力模板校验。修复：第三方中转站视频模型未导入模板时被硬拒、无法提交。
    let validOk: boolean;
    let validMsg = '';
    if (!model) {
      const hasInput = !!(
        req.prompt?.trim() ||
        req.images?.length ||
        req.imageUrls?.length ||
        req.videoUrls?.length ||
        req.audioUrls?.length
      );
      validOk = hasInput;
      if (!hasInput) validMsg = '缺少输入：需要提示词或素材（该模型无能力模板，按宽松校验）';
    } else {
      const v = validateVideoRequest(req, model);
      validOk = v.ok;
      validMsg = v.issues.map((i) => i.message).join('；');
    }
    if (!validOk) {
      setVideo(videoId, { status: 'error', error: `参数校验未通过：${validMsg}` });
      toast.error('视频参数校验未通过', validMsg);
      return;
    }
    costNote = estimateVideoCost(req, model).note;
    genInput = {
      modelId: d.modelId,
      prompt: req.prompt,
      negativePrompt: req.negativePrompt,
      params: {
        mode: req.mode,
        duration: String(req.duration),
        resolution: req.resolution,
        aspect: req.aspectRatio
      },
      request: req
    };
  } else {
    // legacy 引擎（kling/sora/unified）—— 保持原行为
    const prompt = inputs.prompt;
    const image = inputs.upImages[0];
    if (!prompt && !image) {
      toast.error('视频节点没有输入', '连一个提示词节点，或（图生视频）连一张图片');
      return;
    }
    const resolution = (sizeOverride?.resolution || d.resolution || '720p').trim();
    let sentImage: string | undefined;
    if (image) {
      const conv = await sendableUrl(image);
      if (!conv) {
        setVideo(videoId, { status: 'error', error: '上游图片无法读取，已中止（避免把本地路径发到远端）' });
        toast.error('图片读取失败', '上游图片无法转换为可发送格式，已中止');
        return;
      }
      sentImage = conv;
    }
    inputImages = sentImage ? [sentImage] : [];
    genInput = {
      modelId: d.modelId,
      prompt,
      negativePrompt: d.negativePrompt,
      params: {
        mode: image ? 'image-to-video' : 'text-to-video',
        duration: d.duration || '5',
        aspect: sizeOverride?.aspect || d.aspect || '16:9',
        resolution,
        ...(d.seed != null ? { seed: d.seed } : {}),
        ...(sentImage ? { image: sentImage } : {}),
        ...(/\d+\s*x\s*\d+/i.test(resolution) ? { size: resolution } : {})
      }
    };
  }

  setVideo(videoId, {
    status: 'running',
    taskState: 'submitted',
    error: null,
    videoPath: null,
    progress: 0,
    phase: '提交中',
    costNote,
    logs: []
  });
  const r = await window.electronAPI.video.generate(genInput);
  if (!r.ok) {
    setVideo(videoId, { status: 'error', error: r.error.message });
    toast.error(r.error.message, r.error.hint);
    return;
  }
  const taskId = r.data.taskId;
  pendingVideo.set(taskId, { nodeId: videoId, docId, startedAt: Date.now() });
  setVideo(videoId, { taskId });
  // 参数记忆：提交成功的参数记下来，之后新建的视频节点直接继承（少一遍从头选）
  saveVideoNodeDefaults({
    modelId: d.modelId,
    mode: d.mode,
    duration: d.duration,
    aspect: d.aspect,
    resolution: d.resolution,
    generateAudio: d.generateAudio
  });
  // 历史记录（提交即记，便于失败/超时也留痕）
  useVideoHistoryStore.getState().add({
    taskId,
    providerId: target.videoKind,
    providerName: target.providerName,
    modelId: d.modelId,
    actualModelId: target.actualId,
    mode: normalizeVideoMode(d.mode),
    prompt: inputs.prompt,
    negativePrompt: d.negativePrompt,
    duration: Number(d.duration) || 5,
    resolution: d.resolution || '720p',
    aspectRatio: d.aspect || 'adaptive',
    generateAudio: !!d.generateAudio,
    returnLastFrame: d.returnLastFrame ?? false,
    inputImages,
    inputVideos: inputs.videoUrls,
    inputAudios: inputs.audioUrls,
    costNote,
    status: 'submitted',
    createdAt: Date.now()
  });
  // 等真正完成（video:done → routeVideoDone）再返回。
  // fallbackMs>0（供应商显式设了上限）才挂兜底计时器；不限时（默认）下完全靠主进程推送收尾，
  // 节点上的「取消」随时可停（abort 主进程轮询 → 也会推 video:done）。
  await new Promise<void>((resolve) => {
    const timer =
      fallbackMs > 0
        ? setTimeout(() => {
            pendingVideoResolve.delete(taskId);
            const ent = pendingVideo.get(taskId);
            pendingVideo.delete(taskId);
            useVideoHistoryStore.getState().patch(taskId, { status: 'timeout', finishedAt: Date.now() });
            const errPatch: Partial<VideoNodeData> = {
              status: 'error',
              error: '视频生成超时（超过供应商配置的时限未返回），请重试或把超时改为 0（不限时）',
              taskId: undefined,
              phase: undefined
            };
            if (ent && ent.docId && ent.docId !== currentDocId()) {
              patchDocNodes(ent.docId, [{ nodeId: ent.nodeId, patch: errPatch as Record<string, unknown> }]);
            } else {
              setVideo(videoId, errPatch);
            }
            resolve();
          }, fallbackMs)
        : null;
    pendingVideoResolve.set(taskId, () => {
      if (timer) clearTimeout(timer);
      resolve();
    });
  });
}

/** 批量生成：顺序跑 count 次（有 seed 则逐次 +1 取变体），结果累加到下游结果节点。 */
export async function runVideoBatch(videoId: string, count: number): Promise<void> {
  const n = Math.max(1, Math.min(20, Math.floor(count)));
  const node = useSmartCanvasStore.getState().nodes.find((x) => x.id === videoId);
  if (!node || node.type !== 'video') return;
  const base = (node.data as unknown as VideoNodeData).seed;
  for (let i = 0; i < n; i++) {
    const cur = useSmartCanvasStore.getState().nodes.find((x) => x.id === videoId);
    if (!cur) break;
    if (base != null) setVideo(videoId, { seed: base + i });
    setVideo(videoId, { logs: [`批量 ${i + 1}/${n}`] });
    await runVideoNode(videoId);
    const after = useSmartCanvasStore.getState().nodes.find((x) => x.id === videoId);
    const dd = after ? (after.data as unknown as VideoNodeData) : undefined;
    // 失败或用户取消则中止后续（避免连环烧钱）；取消把状态置 idle + taskState='cancelled'
    if (!after || dd?.status === 'error' || dd?.taskState === 'cancelled') break;
  }
  if (base != null) setVideo(videoId, { seed: base });
}

/** 取消一个视频节点的进行中任务。 */
export function cancelVideo(videoId: string): void {
  const node = useSmartCanvasStore.getState().nodes.find((n) => n.id === videoId);
  if (!node || node.type !== 'video') return;
  const d = node.data as unknown as VideoNodeData;
  setVideo(videoId, { status: 'idle', taskId: undefined, phase: undefined, taskState: 'cancelled', logs: ['已取消'] });
  if (d.taskId) {
    void window.electronAPI.video.cancel(d.taskId);
    pendingVideo.delete(d.taskId);
    useVideoHistoryStore.getState().patch(d.taskId, { status: 'cancelled', finishedAt: Date.now() });
    const f = pendingVideoResolve.get(d.taskId);
    if (f) {
      pendingVideoResolve.delete(d.taskId);
      f();
    }
  }
}

/** video:progress 推送 → 更新节点进度（仅当前文档）。 */
export function routeVideoProgress(payload: unknown): void {
  const p = payload as VideoProgressPayload;
  const ent = pendingVideo.get(p.taskId);
  if (!ent || (ent.docId && ent.docId !== currentDocId())) return;
  setVideo(ent.nodeId, { progress: p.percent, phase: p.phase, taskState: p.state });
}

/** 把视频结果包成 WorkResult（含 videos），供下游「结果」节点累积展示。 */
function buildVideoResult(p: VideoDonePayload, modelId: string): WorkResult {
  return {
    ok: !!p.ok,
    summary: '视频生成',
    images: [],
    videos: p.filePath ? [p.filePath] : [],
    logs: [],
    error: p.ok ? undefined : p.error ?? '视频生成失败',
    workType: 'video-generation',
    runMode: 'single',
    provider: 'mengbi',
    model: modelId,
    simulated: false,
    durationMs: p.durationMs
  };
}

/** video:done 推送 → 写回节点结果 + 推给下游「结果」节点（跨文档则回灌该文档存储）。 */
export function routeVideoDone(payload: unknown): void {
  const p = payload as VideoDonePayload;
  const ent = pendingVideo.get(p.taskId);
  if (!ent) return;
  pendingVideo.delete(p.taskId);
  const patch: Partial<VideoNodeData> = p.ok
    ? {
        status: 'success',
        taskState: 'succeeded',
        videoPath: p.filePath ?? null,
        outLastFrameUrl: p.lastFrameUrl ?? null,
        error: null,
        durationMs: p.durationMs,
        progress: 100,
        phase: '完成',
        taskId: undefined
      }
    : { status: 'error', taskState: 'failed', error: p.error ?? '视频生成失败', taskId: undefined, phase: undefined };

  // 历史记录收尾
  useVideoHistoryStore.getState().patch(p.taskId, {
    status: p.ok ? 'succeeded' : 'failed',
    localVideoPath: p.filePath,
    videoUrl: p.remoteUrl,
    lastFrameUrl: p.lastFrameUrl,
    error: p.ok ? undefined : p.error,
    finishedAt: Date.now()
  });

  if (ent.docId && ent.docId !== currentDocId()) {
    // 后台文档：回灌视频节点 + 给其下游结果节点推结果（成功时）
    patchDocNodes(ent.docId, [{ nodeId: ent.nodeId, patch: patch as Record<string, unknown> }]);
    if (p.ok) {
      const doc = readDocDoc(ent.docId);
      if (doc) {
        const src = doc.nodes.find((n) => n.id === ent.nodeId);
        const modelId = src ? ((src.data as unknown as VideoNodeData).modelId ?? '') : '';
        const result = buildVideoResult(p, modelId);
        notifyFolderOutputs(ent.nodeId, [result], ent.docId);
        for (const c of doc.connections.filter((x) => x.source === ent.nodeId)) {
          const tgt = doc.nodes.find((n) => n.id === c.target);
          if (tgt?.type === 'result') useSmartResultStore.getState().push(tgt.id, result);
        }
      }
    }
  } else {
    setVideo(ent.nodeId, patch);
    // 终态落盘当前文档：防切档 / 回启动页重载时被 sanitize 后的 idle 覆盖。
    persistActiveDocTerminal(ent.docId, ent.nodeId, patch as Record<string, unknown>);
    if (p.ok) {
      const st = useSmartCanvasStore.getState();
      const node = st.nodes.find((n) => n.id === ent.nodeId);
      const modelId = node ? (node.data as unknown as VideoNodeData).modelId : '';
      const result = buildVideoResult(p, modelId);
      notifyFolderOutputs(ent.nodeId, [result], ent.docId);
      for (const e of st.edges.filter((x) => x.source === ent.nodeId)) {
        const tgt = st.nodes.find((n) => n.id === e.target);
        if (tgt?.type === 'result') {
          useSmartResultStore.getState().push(tgt.id, result);
          st.updateNodeData(tgt.id, { result } as Partial<SmartNodeData>);
        }
      }
    }
  }

  const f = pendingVideoResolve.get(p.taskId);
  if (f) {
    pendingVideoResolve.delete(p.taskId);
    f();
  }
  // 抓首帧当资产库封面（免 ffmpeg：渲染端 <video>+canvas），后台静默补，失败忽略
  if (p.ok && p.imageId != null && p.filePath) {
    const imageId = p.imageId;
    void captureVideoPoster(localPathToImageUrl(p.filePath)).then((du) => {
      if (du) void window.electronAPI.video.saveThumbnail({ imageId, dataUri: du });
    });
  }
  if (p.ok) toast.success('视频生成完成', '已入资产库 / 已推到结果节点');
  else toast.error('视频生成失败', p.error);
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
  // 生成时若 work/comfy 节点下游没接结果节点，自动创建一个并连上（让结果有处可显示）
  const me = useSmartCanvasStore.getState().nodes.find((n) => n.id === nodeId);
  if (me && (me.type === 'work' || me.type === 'comfy' || me.type === 'video'))
    useSmartCanvasStore.getState().ensureResultNode(nodeId);
  await ensureUpstreamRun(nodeId, new Set());
  const node = useSmartCanvasStore.getState().nodes.find((n) => n.id === nodeId);
  if (node) await runOne(node);
}

// ── 全局推送监听（App 级注册，跨页面存活）──────────────────────────────
// 历史坑：这些监听原挂在 SmartCanvasPage 的 useEffect 里，App.tsx 的
// AnimatePresence + key={pathname} 切页时页面整体 unmount → 监听注销，
// 而 pendingWork/pendingComfy/pendingVideo 等 Map 是模块级——结果回来无人路由，
// 节点永远「运行中」直到超时兜底（用户看到读秒 300~500s）。
// 修法：监听上移到 App 级一次性注册（路由函数与 pending Map 同为模块级，天然配套）；
// 「结果回来时不在该画布」由 patchDocNodes 跨文档回灌兜住，互不冲突。
let runnerListenersOff: (() => void) | null = null;

/**
 * 重挂画布时把「仍有在途任务」的节点状态拉回 running（修「切页回来节点状态被重置成 待运行，
 * 后台却还在跑」）。根因：切页 unmount → sanitize 把 running 落盘成 idle / 重载时再 sanitize；
 * 而 pendingWork/pendingComfy/pendingVideo/pendingInterp 是模块级、任务其实还活着。
 * 本函数按 node.id 与这些 Map 对账，只「补回 running」（纯增量、幂等、绝不清状态/丢结果）。
 * 因 CanvasWorkspace `key={activeDocId}` —— 任何切页 / 切档都会重挂它，是统一的对账时机。
 */
export function resyncRunningNodesFromPending(): void {
  const st = useSmartCanvasStore.getState();
  if (!st.nodes.length) return;
  // 各 Map 里「正在跑」的节点 id 集合（按 node.id 比对；node id 全局随机唯一，跨文档不串）
  const comfyRunning = new Set<string>();
  for (const v of pendingComfy.values()) comfyRunning.add(v.comfyId);
  const videoRunning = new Set<string>();
  for (const v of pendingVideo.values()) videoRunning.add(v.nodeId);
  const interpRunning = new Set<string>(pendingInterp.values());
  for (const n of st.nodes) {
    const d = n.data as unknown as Record<string, unknown>;
    const live =
      (n.type === 'work' && (liveRunningNodes.has(n.id) || (activeWorkTasks.get(n.id)?.size ?? 0) > 0)) ||
      (n.type === 'comfy' && comfyRunning.has(n.id)) ||
      (n.type === 'video' && videoRunning.has(n.id)) ||
      (n.type === 'frame-interp' && interpRunning.has(n.id)) ||
      ((n.type === 'segment' || n.type === 'proof') && liveRunningNodes.has(n.id));
    if (live && d.status !== 'running') {
      st.updateNodeData(n.id, { status: 'running' } as Partial<SmartNodeData>);
    }
  }
}

/** 在 App 根组件注册全部智能画布推送监听（防重；返回统一注销函数）。 */
export function registerSmartRunnerListeners(): () => void {
  if (runnerListenersOff) return runnerListenersOff;
  const offs: Array<() => void> = [
    window.electronAPI.on('image:done', (p) => routeImageDone(p)),
    window.electronAPI.on('comfyui:run-done', (p) => routeComfyDone(p)),
    window.electronAPI.on('video:progress', (p) => routeVideoProgress(p)),
    window.electronAPI.on('video:done', (p) => routeVideoDone(p)),
    window.electronAPI.on('chat:chunk', (p) => routeChatChunk(p)),
    window.electronAPI.on('chat:done', (p) => routeChatDone(p)),
    window.electronAPI.on('interp:progress', (p) => routeInterpProgress(p as InterpProgressPayload)),
    window.electronAPI.on('vec:progress', (p) => routeVecProgress(p as VecTaskProgressPayload))
  ];
  // 资产库删除 → 结果同步剔除（useSmartResultStore 是模块级，画布未挂载也要剔）
  offs.push(
    useDeletedMediaStore.subscribe((s, prev) => {
      if (s.seq !== prev.seq) pruneDeletedImages(s.lastDeleted);
    })
  );
  runnerListenersOff = () => {
    for (const f of offs) f();
    runnerListenersOff = null;
  };
  return runnerListenersOff;
}

// ── TODO 接缝（后续真实后端，仅替换本层，不动 UI）──
// async function runUpscaleWorkNode(d, inputs) { /* 走 api:upscale:run-single */ }
