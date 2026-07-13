/**
 * 智能画布「单文档内容」读写：每个文档的 nodes/edges/viewport 序列化成 SmartCanvasDoc，
 * 存 localStorage `mengbi.smartCanvas.doc.<id>`。元数据列表见 store/smartDocsStore.ts。
 *
 * 写入做去抖（autosave 在 CanvasWorkspace 里 500ms 去抖调用本模块的同步 write），
 * 因此这里直接同步 setItem，不再像旧版那样自带延迟序列化层。
 */
import type { Node, Edge, Viewport } from '@xyflow/react';
import type { SmartCanvasDoc, SmartNodeData } from '@shared/smartCanvas';
import { serialize, deserialize, parseDoc } from './smartCanvasApi';
import { useSmartDocsStore } from '@/store/smartDocsStore';
import { useSmartCanvasStore } from '@/store/smartCanvasStore';
import { toast } from '@/store/toastStore';

const LEGACY_KEY = 'mengbi.smartCanvas.v1';
const docKey = (id: string): string => `mengbi.smartCanvas.doc.${id}`;

/** 配额超限提示去抖：最多每 30s 弹一次（避免 500ms autosave 反复弹，又不会修好前永久沉默）。 */
let lastQuotaWarnAt = 0;
function isQuotaError(e: unknown): boolean {
  return (
    e instanceof DOMException &&
    (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22)
  );
}

/** running 状态归零，重载不残留「进行中」幽灵（旧版在 persist.partialize 里做，现移到落盘前）。 */
function sanitize(doc: SmartCanvasDoc): SmartCanvasDoc {
  return {
    ...doc,
    // 旧智能分镜的「转场」输出口（out-trans）已于 2026-07-12 随双输出方案删除：
    // 旧连线原位迁回默认口 out（新节点单输出=整段分镜脚本，连线不丢）。
    connections: (doc.connections ?? []).map((c) =>
      c.sourceHandle === 'out-trans' ? { ...c, sourceHandle: 'out' } : c
    ),
    nodes: doc.nodes.map((n) => {
      const d = n.data as unknown as Record<string, unknown>;
      // 旧智能分镜（N 条分镜 + 转场，2026-07-12 重做为「一整段时间轴分镜脚本」）→ 原位迁移：
      // 既有分镜合成一段存进 resultText（不丢用户成果），旧字段全部剥掉。
      if (n.type === 'storyboard' && (Array.isArray(d.shots) || 'shotCount' in d || 'constraints' in d)) {
        const shots = Array.isArray(d.shots) ? (d.shots as unknown[]).filter((x): x is string => typeof x === 'string' && !!x.trim()) : [];
        const migrated: Record<string, unknown> = {
          ...d,
          resultText: typeof d.resultText === 'string' && d.resultText.trim() ? d.resultText : shots.join('；'),
          status: d.status === 'running' ? 'idle' : d.status
        };
        for (const k of ['shots', 'shotsMeta', 'transitions', 'constraints', 'style', 'analysis', 'analysisModelId', 'lastStage', 'story', 'shotMode', 'shotCount', 'transitionStyle', 'includeTimeInPrompt']) {
          delete migrated[k];
        }
        return { ...n, data: migrated as unknown as SmartNodeData };
      }
      // 旧「角色设计」节点（character，已于提示词商城上线时下线）→ 迁移成提示词节点，
      // 保留最后生成的角色资产 / 形式提示词 / 描述文本，不丢用户既有成果。
      if ((n.type as string) === 'character') {
        const text = String(d.charPrompt || d.sheetPrompt || d.desc || '').trim();
        return { ...n, type: 'prompt', data: { text } as unknown as SmartNodeData };
      }
      // 旧「视频反推」节点（video-reverse，2026-07-11 并入「反推」image-reverse）→ 原位换 type：
      // 字段同名（modelId/reverseType/frameCount/resultText…）直接沿用；position/连线不动——
      // 合并后 image-reverse 本就接受视频来源，旧连线（视频→反推）依旧合法。
      if ((n.type as string) === 'video-reverse') {
        return { ...n, type: 'image-reverse', data: { ...d, status: d.status === 'running' ? 'idle' : d.status } as unknown as SmartNodeData };
      }
      // 反推/分镜/角色卡 运行是渲染端同步 await（无 pending Map 可对账），关软件时的 running 一并归零防幽灵
      if ((n.type === 'work' || n.type === 'llm' || n.type === 'comfy' || n.type === 'image-reverse' || n.type === 'storyboard' || n.type === 'character-card') && d.status === 'running') {
        return {
          ...n,
          data: { ...d, status: 'idle', taskId: undefined, runId: undefined } as unknown as SmartNodeData
        };
      }
      // 结果节点的累积结果不入文档：重启即清（累积只活在内存 useSmartResultStore）
      if (n.type === 'result' && d.result) {
        return { ...n, data: { ...d, result: null } as unknown as SmartNodeData };
      }
      // 缩放节点输出是大 dataURI，不入文档（重新打开会从上游图重算），避免爆 localStorage 配额
      if (n.type === 'scale' && d.outputImage) {
        return { ...n, data: { ...d, outputImage: undefined } as unknown as SmartNodeData };
      }
      // 循环节点：running/paused 归 idle（重载无运行控制器，否则成「运行中」幽灵）；
      // 清当前项输出（outPrompt/outSize/outImages 是逐项瞬态，重载不该泄漏给下游 + 省配额）；
      // 保留 currentIndex/totalItems/计数供「从此项继续」。
      if (n.type === 'loop') {
        const status = d.status === 'running' || d.status === 'paused' ? 'idle' : d.status;
        return {
          ...n,
          data: { ...d, status, outPrompt: undefined, outSize: undefined, outImage: undefined, outImages: undefined } as unknown as SmartNodeData
        };
      }
      // 图片列表自驱：runStatus 归 idle + 清「当前批」outBatch（防重载残留「运行中」/把旧批喂下游）。
      if (n.type === 'image' && (d.runStatus === 'running' || d.runStatus === 'paused' || (Array.isArray(d.outBatch) && d.outBatch.length))) {
        return {
          ...n,
          data: { ...d, runStatus: 'idle', batchIndex: undefined, totalBatches: undefined, doneCount: 0, failCount: 0, runLogs: [], runError: null, outBatch: undefined } as unknown as SmartNodeData
        };
      }
      // 切分/对稿：running 归 idle（重载无编排器，否则成「运行中」幽灵）；识别/重绘/拼合/报告结果保留（小体积、磁盘路径）
      if ((n.type === 'segment' || n.type === 'proof') && d.status === 'running') {
        return { ...n, data: { ...d, status: 'idle', phase: undefined } as unknown as SmartNodeData };
      }
      return n;
    })
  };
}

/**
 * 把 image 节点的大 base64 src 落盘换成磁盘路径（持久化前调，防 localStorage 配额爆掉丢改动）。
 * 非 data:URI / 落盘失败的跳过；成功后用 updateNodeData 写回 store（同时改内存与后续持久化）。
 * 仅处理 image 节点 src（最常见的大图来源：拖入 / 上传 / 粘贴的参考图）。其它节点内嵌图后续再扩。
 */
export async function externalizeImageNodes(): Promise<void> {
  const isBig = (s: unknown): s is string => typeof s === 'string' && s.startsWith('data:');
  const targets = useSmartCanvasStore.getState().nodes.filter((n) => {
    if (n.type !== 'image') return false;
    const d = n.data as unknown as { src?: unknown; srcs?: unknown; inpaintMaskSrc?: unknown; maskOverlaySrc?: unknown; originalSrc?: unknown };
    return isBig(d.src) || (Array.isArray(d.srcs) && d.srcs.some(isBig)) || isBig(d.inpaintMaskSrc) || isBig(d.maskOverlaySrc) || isBig(d.originalSrc);
  });
  for (const n of targets) {
    const d = n.data as unknown as { src?: string; srcs?: string[]; inpaintMaskSrc?: string; maskOverlaySrc?: string; originalSrc?: string };
    // 单图 src
    if (isBig(d.src)) {
      const src = d.src;
      try {
        const r = await window.electronAPI.storage.saveCanvasAsset({ dataUri: src });
        if (r.ok && r.data.filePath) {
          // 仅当该节点 src 仍是这张 base64 时才覆盖（避免覆盖期间用户的新改动）
          const cur = useSmartCanvasStore.getState().nodes.find((x) => x.id === n.id);
          if (cur && (cur.data as unknown as { src?: string }).src === src) {
            useSmartCanvasStore.getState().updateNodeData(n.id, { src: r.data.filePath } as unknown as Partial<SmartNodeData>);
          }
        }
      } catch {
        /* 落盘失败：保留 base64，下次自动保存再试 */
      }
    }
    // 局部重绘遮罩：与 src 同样落盘换路径（运行前 runWorkNode 用 sendableUrl 转回 dataURI）
    if (isBig(d.inpaintMaskSrc)) {
      const mask = d.inpaintMaskSrc;
      try {
        const r = await window.electronAPI.storage.saveCanvasAsset({ dataUri: mask });
        if (r.ok && r.data.filePath) {
          const cur = useSmartCanvasStore.getState().nodes.find((x) => x.id === n.id);
          if (cur && (cur.data as unknown as { inpaintMaskSrc?: string }).inpaintMaskSrc === mask) {
            useSmartCanvasStore.getState().updateNodeData(n.id, { inpaintMaskSrc: r.data.filePath } as unknown as Partial<SmartNodeData>);
          }
        }
      } catch {
        /* 落盘失败：保留 base64 */
      }
    }
    // 红色可视标注层：与遮罩同样落盘换路径（纯展示，节点 <img> 支持磁盘路径）
    if (isBig(d.maskOverlaySrc)) {
      const ov = d.maskOverlaySrc;
      try {
        const r = await window.electronAPI.storage.saveCanvasAsset({ dataUri: ov });
        if (r.ok && r.data.filePath) {
          const cur = useSmartCanvasStore.getState().nodes.find((x) => x.id === n.id);
          if (cur && (cur.data as unknown as { maskOverlaySrc?: string }).maskOverlaySrc === ov) {
            useSmartCanvasStore.getState().updateNodeData(n.id, { maskOverlaySrc: r.data.filePath } as unknown as Partial<SmartNodeData>);
          }
        }
      } catch {
        /* 落盘失败：保留 base64 */
      }
    }
    // 最初始图：与 src 同样落盘换路径（编辑器「重置」时 loadImageCors 支持磁盘路径）
    if (isBig(d.originalSrc)) {
      const orig = d.originalSrc;
      try {
        const r = await window.electronAPI.storage.saveCanvasAsset({ dataUri: orig });
        if (r.ok && r.data.filePath) {
          const cur = useSmartCanvasStore.getState().nodes.find((x) => x.id === n.id);
          if (cur && (cur.data as unknown as { originalSrc?: string }).originalSrc === orig) {
            useSmartCanvasStore.getState().updateNodeData(n.id, { originalSrc: r.data.filePath } as unknown as Partial<SmartNodeData>);
          }
        }
      } catch {
        /* 落盘失败：保留 base64 */
      }
    }
    // 列表 srcs[]：逐张把 base64 落盘换路径（列表模式批量大图最易爆配额）
    if (Array.isArray(d.srcs) && d.srcs.some(isBig)) {
      const orig = d.srcs.slice();
      const next: string[] = [];
      let changed = false;
      for (const s of orig) {
        if (isBig(s)) {
          try {
            const r = await window.electronAPI.storage.saveCanvasAsset({ dataUri: s });
            if (r.ok && r.data.filePath) {
              next.push(r.data.filePath);
              changed = true;
              continue;
            }
          } catch {
            /* keep base64 */
          }
        }
        next.push(s);
      }
      if (changed) {
        const cur = useSmartCanvasStore.getState().nodes.find((x) => x.id === n.id);
        // 仅当 srcs 未被用户改动时才写回
        const curSrcs = (cur?.data as unknown as { srcs?: string[] } | undefined)?.srcs ?? [];
        if (cur && JSON.stringify(curSrcs) === JSON.stringify(orig)) {
          useSmartCanvasStore.getState().updateNodeData(n.id, { srcs: next } as unknown as Partial<SmartNodeData>);
        }
      }
    }
  }
}

/** 把当前画布内容写入某文档（同步）。配额超限时提示用户（每会话一次）。 */
export function writeDocContent(id: string, nodes: Node[], edges: Edge[], viewport: Viewport): void {
  try {
    localStorage.setItem(docKey(id), JSON.stringify(sanitize(serialize(nodes, edges, viewport))));
  } catch (e) {
    console.warn('[smartdoc persist] setItem failed', e);
    if (isQuotaError(e)) {
      const now = Date.now();
      // 配额仍超限时每 30s 再提醒一次，避免「警告一次后默默丢改动」
      if (now - lastQuotaWarnAt > 30_000) {
        lastQuotaWarnAt = now;
        toast.error(
          '本地存储空间不足，画布未能自动保存',
          '图片体积过大已超浏览器配额。请「保存」导出 .json 备份，或删减大图 / 删除不用的画布。'
        );
      }
    }
  }
}

/** 读某文档的原始 DTO 文档（用于在途任务结果回灌「非当前」文档时定位下游节点）。 */
export function readDocDoc(id: string): SmartCanvasDoc | null {
  const raw = localStorage.getItem(docKey(id));
  if (!raw) return null;
  return parseDoc(raw);
}

/** 给某文档的若干节点合并 data 补丁，落盘一次（在途任务完成后用户已切走时，把结果写回正确文档）。 */
export function patchDocNodes(id: string, patches: Array<{ nodeId: string; patch: Record<string, unknown> }>): void {
  const raw = localStorage.getItem(docKey(id));
  if (!raw) return;
  const doc = parseDoc(raw);
  if (!doc) return;
  const map = new Map(patches.map((p) => [p.nodeId, p.patch]));
  let changed = false;
  for (const n of doc.nodes) {
    const p = map.get(n.id);
    if (p) {
      n.data = { ...(n.data as unknown as Record<string, unknown>), ...p } as unknown as SmartNodeData;
      changed = true;
    }
  }
  if (!changed) return;
  try {
    localStorage.setItem(docKey(id), JSON.stringify(sanitize(doc)));
  } catch (e) {
    console.warn('[smartdoc patch] setItem failed', e);
  }
}

/** 读某文档内容；不存在 / 解析失败 → null。 */
export function readDocContent(id: string): { nodes: Node[]; edges: Edge[]; viewport: Viewport } | null {
  const raw = localStorage.getItem(docKey(id));
  if (!raw) return null;
  const doc = parseDoc(raw);
  if (!doc) return null;
  return deserialize(sanitize(doc));
}

/** 把当前画布缓冲区落盘到「当前文档」（切标签 / 回启动页前调，确保不丢改动）。 */
export function saveCurrentDoc(): void {
  const ds = useSmartDocsStore.getState();
  const cur = ds.activeDocId;
  if (!cur) return;
  const st = useSmartCanvasStore.getState();
  writeDocContent(cur, st.nodes, st.edges, st.viewport);
  ds.touch(cur, st.nodes.length);
}

/** 把目标文档内容载入缓冲区（不存在则清空）。 */
function loadInto(id: string): void {
  const content = readDocContent(id);
  const st = useSmartCanvasStore.getState();
  if (content) st.load(content.nodes, content.edges, content.viewport);
  else st.reset();
}

/**
 * 切换到某文档标签：先把当前画布落盘到当前文档，再载入目标内容，最后 setActive。
 * 顺序很关键：load 在 setActive 之前 → 新 workspace 挂载时缓冲区已是目标内容（viewport 正确）；
 * 旧 workspace 卸载时其 cleanup 因 activeDocId 已变会跳过重复保存（见 CanvasWorkspace 守卫）。
 */
export function switchDoc(targetId: string): void {
  const ds = useSmartDocsStore.getState();
  if (ds.activeDocId === targetId) return;
  saveCurrentDoc();
  loadInto(targetId);
  ds.setActive(targetId);
}

/** 回到「选择画布」启动页（先把当前画布落盘）。 */
export function backToLauncher(): void {
  saveCurrentDoc();
  useSmartDocsStore.getState().setActive(null);
}

/** 关闭一个标签页（不删文档）：若关的是当前页，先落盘当前，再切到相邻标签的内容。 */
export function closeDocTab(id: string): void {
  const ds = useSmartDocsStore.getState();
  const wasActive = ds.activeDocId === id;
  if (wasActive) saveCurrentDoc();
  ds.closeTab(id);
  const next = useSmartDocsStore.getState().activeDocId;
  if (wasActive && next) loadInto(next);
}

/** 复制一张画布：新建元数据「<原名> 副本」+ 整段内容克隆，返回新 id。 */
export function duplicateDoc(srcId: string): string | null {
  const ds = useSmartDocsStore.getState();
  const src = ds.docs.find((d) => d.id === srcId);
  if (!src) return null;
  const newId = ds.createDoc(`${src.title} 副本`);
  const raw = localStorage.getItem(docKey(srcId));
  if (raw) {
    try {
      localStorage.setItem(docKey(newId), raw);
    } catch (e) {
      console.warn('[smartdoc duplicate] setItem failed', e);
    }
  }
  ds.touch(newId, src.nodeCount);
  return newId;
}

// ── 批量保存 / 导入（本地） ───────────────────────────────────────────────
// 智能画布全部存在 localStorage（renderer 端），批量导出 = 打包成一个 .json 触发浏览器下载，
// 批量导入 = <input type=file multiple> 读入若干 .json（批量包或单画布）→ 各新建一个文档。零新 IPC。

export interface SmartDocsBundleEntry {
  title: string;
  doc: SmartCanvasDoc;
}
export interface SmartDocsBundle {
  format: 'mengbi-smart-canvas-bundle';
  version: number;
  exportedAt: string;
  docs: SmartDocsBundleEntry[];
}

const BUNDLE_FORMAT = 'mengbi-smart-canvas-bundle';

/** 批量导出：把若干（默认全部）智能画布打包成一个 .json 触发下载。返回导出数量。 */
export function exportDocsBundle(ids?: string[]): { ok: boolean; count: number } {
  // 先把当前画布落盘，确保导出的是最新内容
  saveCurrentDoc();
  const ds = useSmartDocsStore.getState();
  const targetIds = ids && ids.length ? ids : ds.docs.map((d) => d.id);
  const entries: SmartDocsBundleEntry[] = [];
  for (const id of targetIds) {
    const meta = ds.docs.find((d) => d.id === id);
    const raw = localStorage.getItem(docKey(id));
    if (!meta || !raw) continue;
    const doc = parseDoc(raw);
    if (!doc) continue;
    entries.push({ title: meta.title, doc });
  }
  if (!entries.length) return { ok: false, count: 0 };
  const bundle: SmartDocsBundle = {
    format: BUNDLE_FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    docs: entries
  };
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `mengbi-canvases-${entries.length}.json`;
  a.click();
  URL.revokeObjectURL(url);
  return { ok: true, count: entries.length };
}

/** 校验一个对象是否是合法画布 DTO（有 nodes/connections 数组）。 */
function isCanvasDoc(v: unknown): v is SmartCanvasDoc {
  const d = v as Partial<SmartCanvasDoc> | null;
  return !!d && Array.isArray(d.nodes) && Array.isArray(d.connections);
}

/**
 * 批量导入：吃一段文本（批量 bundle 或单画布 .json），为每个画布新建文档并落盘。
 * 不覆盖现有画布（都新建，靠 id 区分；同名不影响）。返回新建数量。
 */
export function importDocsFromText(text: string): { ok: boolean; created: number } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, created: 0 };
  }
  const entries: SmartDocsBundleEntry[] = [];
  const asBundle = parsed as Partial<SmartDocsBundle>;
  if (asBundle && asBundle.format === BUNDLE_FORMAT && Array.isArray(asBundle.docs)) {
    for (const e of asBundle.docs) {
      if (e && isCanvasDoc(e.doc)) entries.push({ title: e.title || e.doc.title || '导入画布', doc: e.doc });
    }
  } else if (isCanvasDoc(parsed)) {
    entries.push({ title: parsed.title || '导入画布', doc: parsed });
  }
  if (!entries.length) return { ok: false, created: 0 };
  const ds = useSmartDocsStore.getState();
  let created = 0;
  for (const e of entries) {
    const id = ds.createDoc(e.title);
    try {
      localStorage.setItem(docKey(id), JSON.stringify(sanitize(e.doc)));
      ds.touch(id, e.doc.nodes.length);
      created++;
    } catch (err) {
      console.warn('[smartdoc import] setItem failed', err);
      ds.deleteDoc(id); // 落盘失败回滚这条元数据
    }
  }
  return { ok: created > 0, created };
}

/** 删除某文档内容（删画布时连同元数据一起清）。 */
export function removeDocContent(id: string): void {
  try {
    localStorage.removeItem(docKey(id));
  } catch {
    /* ignore */
  }
}

/** 读旧单文档（zustand persist 包了一层 { state, version }）的图内容；无内容 → null。 */
function readLegacyContent(): { nodes: Node[]; edges: Edge[]; viewport: Viewport } | null {
  const raw = localStorage.getItem(LEGACY_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { state?: { nodes?: unknown; edges?: unknown; viewport?: unknown } };
    const st = parsed?.state;
    if (!st || !Array.isArray(st.nodes) || st.nodes.length === 0) return null;
    return {
      nodes: st.nodes as Node[],
      edges: (Array.isArray(st.edges) ? st.edges : []) as Edge[],
      viewport: (st.viewport as Viewport) ?? { x: 0, y: 0, zoom: 1 }
    };
  } catch {
    return null;
  }
}

/**
 * 一次性迁移：旧版只有一块画布（mengbi.smartCanvas.v1）。首次进入新版若文档库为空且旧数据非空，
 * 就把它落成一个「我的画布」文档（不自动打开，启动页里以卡片呈现）。迁移后置 migrated 防重复。
 */
export function migrateLegacyIfNeeded(): void {
  const ds = useSmartDocsStore.getState();
  if (ds.migrated) return;
  const legacy = readLegacyContent();
  if (legacy && legacy.nodes.length) {
    const id = ds.createDoc('我的画布');
    writeDocContent(id, legacy.nodes, legacy.edges, legacy.viewport);
    ds.touch(id, legacy.nodes.length);
  }
  ds.markMigrated();
}
