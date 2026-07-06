import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { NodeResizer, type NodeProps } from '@xyflow/react';
import { useSmartCanvasStore, useSmartPreviewStore, useSmartResultStore, useSmartTextStore } from '@/store/smartCanvasStore';
import { computeUpstream, retryPromptIndex, retryComfyItem } from '@/lib/smartCanvasRunner';
import { localPathToImageUrl } from '@/lib/imageUrl';
import { groupResults, type BatchDisplay } from '@/lib/resultGroups';
import { providerLabel, type ResultNodeData, type WorkResult } from '@shared/smartCanvas';
import type { PreviewItem } from '@/components/Lightbox';
import { NodeShell } from './NodeShell';
import { MeasuredThumb, thumbPair } from '../MeasuredThumb';
import { areaMenu, copyImage, copyText, imageSaveAs, fmtDur, autoGrowNode, dragOutNative, showInFolder, imageAsCreateRef, hoverPreviewProps, useBackdropClose } from '../nodeArea';
import { buildShortcutSendMenuItems } from '@/lib/mediaActions';
import type { ContextMenuEntry } from '@/components/ContextMenu';

function mediaUrl(src: string): string {
  return src.startsWith('data:') ? src : localPathToImageUrl(src);
}

/** 文本拖出：拖到画布空白落成提示词节点（文本没有 OS 文件形态，保留画布内载荷）。 */
function dragText(e: React.DragEvent, text: string): void {
  e.dataTransfer.setData('application/mengbi-sc-node', JSON.stringify({ kind: 'prompt', text }));
  e.dataTransfer.effectAllowed = 'copy';
}

/** WorkResult → 统一预览项列表（合集/单卡共用；meta 带提示词与文件路径）。 */
function resultPreviewItems(rs: WorkResult[]): PreviewItem[] {
  const items: PreviewItem[] = [];
  for (const r of rs) {
    for (const p of r.images) {
      items.push({
        src: mediaUrl(p),
        meta: {
          prompt: r.prompt,
          filePath: p.startsWith('data:') ? undefined : p,
          modelId: r.model,
          createdAt: r.createdAt
        }
      });
    }
  }
  return items;
}

/**
 * 合集详情弹层（居中 portal）：批次内每张图 + 任务信息 + 提示词全文 + 成败状态 + 单条重试。
 * 多提示词逐条生图（含分镜批量出图）的结果在这里按条查看 / 重试失败条。
 */
function BatchPopup({ batch, onClose }: { batch: BatchDisplay; onClose: () => void }): JSX.Element {
  const openPreview = useSmartPreviewStore((s) => s.open);
  const openText = useSmartTextStore((s) => s.open);
  const backdrop = useBackdropClose(onClose);
  const allItems = resultPreviewItems(batch.items);

  // Esc 关闭（与全局 Lightbox 同习惯；Lightbox 打开时它在更上层先吃掉 Esc）
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  let imgOffset = 0;
  const first = batch.items[0];
  return createPortal(
    <div className="mb-sc-batch-mask" {...backdrop}>
      <div className="mb-sc-batch-pop mb-card" role="dialog" aria-label="合集详情">
        <div className="mb-sc-batch-head">
          <b>
            本次合集：{batch.count} 张{batch.failCount ? ` · 成 ${batch.okCount} 败 ${batch.failCount}` : ''}
          </b>
          <span className="mb-sc-batch-sub">
            {first ? `${providerLabel(first.provider)} · ${first.model}` : ''}
            {first?.durationMs != null ? ` · ${fmtDur(first.durationMs)}` : ''}
          </span>
          <button className="mb-sc-node-x" onClick={onClose} title="关闭">
            ✕
          </button>
        </div>
        <div className="mb-sc-batch-body">
          {batch.items.map((r, ri) => {
            const startIdx = imgOffset;
            imgOffset += r.images.length;
            return (
              <div key={ri} className={`mb-sc-batch-item ${r.ok ? '' : 'is-fail'}`}>
                <div className="mb-sc-batch-itemhead">
                  {r.shotIndex != null && <span className="mb-sc-sb-no">{r.shotIndex + 1}</span>}
                  <span className={`mb-sc-status is-${r.ok ? 'success' : 'error'}`}>
                    {r.ok ? `成功 · ${r.images.length} 张` : '失败'}
                  </span>
                  {r.shotIndex != null && <span className="mb-sc-batch-shot">分镜 {r.shotIndex + 1}</span>}
                  {!r.ok && r.sourceNodeId != null && r.shotIndex != null && (
                    <button
                      className="mb-btn mb-btn-sm mb-btn-primary"
                      title="只重跑这一条（同批次归位，成功后状态翻新）"
                      onClick={() => {
                        // 按源节点类型分发：生图批次 → retryPromptIndex；ComfyUI 逐条批次 → retryComfyItem
                        const src = useSmartCanvasStore.getState().nodes.find((n) => n.id === r.sourceNodeId);
                        if (src?.type === 'comfy') void retryComfyItem(r.sourceNodeId as string, r.shotIndex as number);
                        else void retryPromptIndex(r.sourceNodeId as string, r.shotIndex as number);
                      }}
                    >
                      重试此条
                    </button>
                  )}
                </div>
                {r.prompt && (
                  <div
                    className="mb-sc-batch-prompt"
                    title="点击放大查看 · 右键复制"
                    onClick={() => openText(r.prompt ?? '', `第 ${(r.shotIndex ?? ri) + 1} 条提示词`)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      copyText(r.prompt ?? '');
                    }}
                  >
                    {r.prompt}
                  </div>
                )}
                {!r.ok && r.error && <div className="mb-sc-result-err">{r.error}</div>}
                {r.images.length > 0 && (
                  <div className="mb-sc-result-grid">
                    {r.images.map((p, i) => {
                      const t = thumbPair(p);
                      return (
                        <MeasuredThumb
                          key={i}
                          src={t.thumb}
                          fullSrc={t.full}
                          measureFull
                          alt={`图 ${i + 1}`}
                          title="点击放大（整批可 ←→ 切换） · 拖出=原文件"
                          draggable
                          onDragStart={(e) => dragOutNative(e, p, `mengbi-batch-${ri}-${i}`)}
                          onClick={() => openPreview(allItems, startIdx + i)}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>,
    document.body
  );
}

/**
 * 结果节点（统一集合）：每次生成的结果都累积排布在此，未重启一直保留、重启清空。
 * 单图任务平铺；多图任务/多提示词批次 → 合集卡（点开看批次详情：每张图+提示词+成败+单条重试）。
 * 卡片尺寸固定 —— 拖大节点只改变一行排几个，不放大卡片（看大图用放大预览）。
 */
export function ResultNode({ id, data }: NodeProps): JSX.Element {
  const d = data as unknown as ResultNodeData;
  const navigate = useNavigate();
  const remove = useSmartCanvasStore((s) => s.removeNode);
  const updateNodeData = useSmartCanvasStore((s) => s.updateNodeData);
  const nodes = useSmartCanvasStore((s) => s.nodes);
  const edges = useSmartCanvasStore((s) => s.edges);
  const openPreview = useSmartPreviewStore((s) => s.open);
  const openText = useSmartTextStore((s) => s.open);
  const results = useSmartResultStore((s) => s.accum[id] ?? []);
  const clearStore = useSmartResultStore((s) => s.clear);
  const [openBatch, setOpenBatch] = useState<number | null>(null);
  // 清空累积同时清掉 data.result（下游 computeUpstream 的桥），避免清空后下游仍读到旧结果
  const clearAccum = (nodeId: string): void => {
    clearStore(nodeId);
    updateNodeData(nodeId, { result: null });
  };

  const groups = useMemo(() => groupResults(results), [results]);
  const images = results.flatMap((r) => r.images);
  const texts = results.flatMap((r) => r.texts ?? []);
  const videos = results.flatMap((r) => r.videos ?? []);
  const total = images.length + texts.length + videos.length;
  const last = results[results.length - 1];
  const singlePreviewItems = useMemo(() => resultPreviewItems(results), [results]);

  const metaParts: string[] = [];
  if (images.length) metaParts.push(`${images.length} 图`);
  if (texts.length) metaParts.push(`${texts.length} 文本`);
  if (videos.length) metaParts.push(`${videos.length} 视频`);

  // 上游「组合预览」：连进来的 分组/提示词/图片 等的实时组合内容（看多段提示词/图如何组成）。
  // 图片预览仅在还没有累积运行结果时显示，避免和「运行结果」重复（生成节点跑完后其图已在下方累积区）。
  const up = useMemo(() => computeUpstream(nodes, edges, id), [nodes, edges, id]);
  const combined = up.prompts.join('\n\n');
  const showImgPreview = up.images.length > 0 && images.length === 0;
  const hasPreview = up.prompts.length > 0 || showImgPreview || up.sizes.length > 0;

  // 自适应增高：按展示单元数（合集占一格）撑高（只增不减，封顶；卡片固定尺寸，列数按节点宽度算）。
  useEffect(() => {
    let need = 120;
    if (hasPreview) need += 86;
    if (groups.length) need += Math.ceil(groups.length / 2) * 110 + 30;
    if (texts.length) need += Math.min(220, 30 + texts.length * 26);
    if (videos.length) need += videos.length * 124;
    autoGrowNode(id, need, 900);
  }, [id, hasPreview, groups.length, texts.length, videos.length]);

  /** 单张结果图的右键菜单（直接使用，无需绕资产库）。 */
  function imageMenu(e: React.MouseEvent, p: string, previewIdx: number): void {
    areaMenu(e, [
      { label: '放大预览', onClick: () => openPreview(singlePreviewItems, previewIdx) },
      { label: '复制图片', onClick: () => void copyImage(mediaUrl(p)) },
      { label: '另存…', onClick: () => void imageSaveAs(p, 'smart-canvas-result.png') },
      {
        label: '作参考图（发到生图页）',
        onClick: () =>
          void imageAsCreateRef(p).then((okk) => {
            if (okk) navigate('/');
          })
      },
      { separator: true },
      { label: '打开文件所在目录', onClick: () => void showInFolder(p) }
    ]);
  }

  /** 上游「传入」图片（还没生成结果时的组合预览）的右键菜单。
   *  修复：传入结果节点的图原先只有 onClick、无 onContextMenu，右键冒泡到节点级菜单，
   *  而节点级菜单对 result 节点只看累积结果（accum），传入图不在其中 → 完全没有右键操作。 */
  function previewImageMenu(e: React.MouseEvent, p: string, i: number): void {
    const items: ContextMenuEntry[] = [
      { label: '放大预览', onClick: () => openPreview(up.images.map((x) => ({ src: mediaUrl(x) })), i) },
      { label: '复制图片', onClick: () => void copyImage(mediaUrl(p)) },
      { label: '另存…', onClick: () => void imageSaveAs(p, 'smart-canvas-input.png') },
      {
        label: '作参考图（发到生图页）',
        onClick: () =>
          void imageAsCreateRef(p).then((okk) => {
            if (okk) navigate('/');
          })
      }
    ];
    if (!p.startsWith('data:')) {
      items.push({ separator: true }, { label: '打开文件所在目录', onClick: () => void showInFolder(p) });
    }
    items.push(...buildShortcutSendMenuItems({ kind: 'image', src: p }));
    areaMenu(e, items);
  }

  /** 在累积全图列表里找某张图的下标（合集封面点开预览用）。 */
  function previewIndexOf(p: string): number {
    return Math.max(0, images.indexOf(p));
  }

  return (
    <>
      <NodeResizer isVisible minWidth={180} minHeight={140} />
      <NodeShell
        title="结果"
        accent="is-result"
        inputs
        outputs
        fill
        onDelete={() => remove(id)}
        label={d.label}
        labelColor={d.labelColor}
        headRight={
          total ? (
            <button className="mb-sc-node-x nodrag" title="清空累积结果" onClick={() => clearAccum(id)}>
              清空
            </button>
          ) : undefined
        }
      >
        {hasPreview && (
          <div className="mb-sc-result-preview nodrag">
            <div className="mb-sc-result-meta">
              上游组合预览 · {up.images.length} 图 / {up.prompts.length} 段词{up.sizes.length ? ` / ${up.sizes.length} 尺寸` : ''}（按连线/卡片顺序组合）
            </div>
            {up.sizes.length > 0 && (
              <div className="mb-sc-result-text">
                {up.sizes
                  .map((s) => `尺寸 ${s.aspect} · ${s.width}×${s.height}（${s.emit === 'aspect' ? '只比例' : s.emit === 'resolution' ? '只分辨率' : '比例+分辨率'}）`)
                  .join('；')}
              </div>
            )}
            {combined && (
              <div className="mb-sc-result-text" title="点击放大查看组合全文" onClick={() => openText(combined, '上游组合预览')}>
                {combined}
              </div>
            )}
            {showImgPreview && (
              <div className="mb-sc-result-grid">
                {up.images.slice(0, 6).map((p, i) => {
                  const t = thumbPair(p);
                  return (
                    <MeasuredThumb
                      key={`pv-${i}`}
                      src={t.thumb}
                      fullSrc={t.full}
                      measureFull
                      alt={`预览 ${i + 1}`}
                      onClick={() => openPreview(up.images.map((x) => ({ src: mediaUrl(x) })), i)}
                      onContextMenu={(e) => previewImageMenu(e, p, i)}
                    />
                  );
                })}
              </div>
            )}
          </div>
        )}
        {total === 0 ? (
          hasPreview ? null : (
            <div className="mb-sc-empty">
              把 生成 / ComfyUI 的图、或 LLM 的文本连到这里，运行后结果会累积显示（重启清空）。也可把 分组/提示词/图片 连进来预览组合。
            </div>
          )
        ) : (
          <div
            className="mb-sc-result mb-sc-arearel"
            onContextMenu={(e) =>
              areaMenu(e, [
                ...(images.length
                  ? [
                      { label: '复制首图', onClick: () => void copyImage(mediaUrl(images[0])) },
                      { label: '首图另存…', onClick: () => void imageSaveAs(images[0], 'smart-canvas-result.png') },
                      { label: '打开存储目录', onClick: () => void showInFolder(images[0]) }
                    ]
                  : videos.length
                    ? [{ label: '打开存储目录', onClick: () => void showInFolder(videos[0]) }]
                    : []),
                ...(texts.length ? [{ label: '复制全部文本', onClick: () => copyText(texts.join('\n\n')) }] : []),
                { separator: true },
                { label: '清空累积结果', variant: 'danger' as const, onClick: () => clearAccum(id) }
              ])
            }
          >
            {last?.simulated && <div className="mb-sc-sim">含模拟结果 · {providerLabel(last.provider)}</div>}
            <div className="mb-sc-result-meta">
              {metaParts.join(' / ')} · {results.length} 次生成
              {last?.durationMs != null ? ` · ${fmtDur(last.durationMs)}` : ''} · 拖出=原文件直接用
            </div>
            {last?.error && !last?.batchId && <div className="mb-sc-result-err">{last.error}</div>}

            {groups.length > 0 && (
              <div className="mb-sc-result-grid nodrag">
                {groups.map((g, gi) => {
                  if (g.kind === 'single') {
                    const p = g.src;
                    const t = thumbPair(p);
                    const pi = previewIndexOf(p);
                    return (
                      <MeasuredThumb
                        key={`g-${gi}`}
                        src={t.thumb}
                        fullSrc={t.full}
                        measureFull
                        alt={`结果图 ${gi + 1}`}
                        title="点击放大（←→ 切换全部） · 拖出到其他软件直接用 · 右键更多 · 角标=真实分辨率"
                        draggable
                        onDragStart={(e) => dragOutNative(e, p, `mengbi-result-${gi + 1}`)}
                        onClick={() => openPreview(singlePreviewItems, pi)}
                        onContextMenu={(e) => imageMenu(e, p, pi)}
                      />
                    );
                  }
                  // 合集卡：封面叠片 + 张数/成败角标，点开看批次详情
                  const coverT = g.cover ? thumbPair(g.cover) : null;
                  return (
                    <button
                      key={`g-${gi}`}
                      type="button"
                      className={`mb-sc-rstack ${g.failCount ? 'has-fail' : ''}`}
                      title={`合集：${g.count} 张${g.failCount ? ` · ${g.failCount} 条失败（点开可单条重试）` : ''} · 点击查看批次详情`}
                      onClick={() => setOpenBatch(gi)}
                    >
                      {coverT ? (
                        <img src={coverT.thumb} alt="合集封面" draggable={false} loading="lazy" decoding="async" />
                      ) : (
                        <span className="mb-sc-rstack-empty">全部失败</span>
                      )}
                      <span className="mb-sc-rstack-badge">
                        {g.count} 张{g.failCount ? ` · 败 ${g.failCount}` : ''}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {texts.length > 0 && (
              <div className="mb-sc-result-texts nodrag">
                {texts.map((t, i) => (
                  <div
                    key={`txt-${i}`}
                    className="mb-sc-result-text"
                    title="点击放大查看全文 · 拖出成提示词节点 · 右键复制"
                    draggable
                    onDragStart={(e) => dragText(e, t)}
                    onClick={() => openText(t, '结果文本')}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      copyText(t);
                    }}
                  >
                    {t}
                  </div>
                ))}
              </div>
            )}

            {videos.length > 0 && (
              <div className="mb-sc-result-videos nodrag">
                {videos.map((v, i) => (
                  <div
                    key={`vid-${i}`}
                    className="mb-sc-result-vidwrap"
                    onContextMenu={(e) =>
                      areaMenu(e, [
                        { label: '放大预览', onClick: () => openPreview(videos.map((x) => ({ src: mediaUrl(x), type: 'video' as const, meta: { filePath: x } })), i) },
                        { label: '打开文件所在目录', onClick: () => void showInFolder(v) },
                        { label: '拖出：按住下方「拖出视频」把手拖到其他软件', disabled: true, onClick: () => undefined }
                      ])
                    }
                  >
                    <video className="mb-sc-result-video" src={mediaUrl(v)} controls preload="metadata" loop {...hoverPreviewProps()} title="悬停自动预览 · 右键放大播放" />
                    <div
                      className="mb-sc-result-vidgrab"
                      title="按住拖出：把视频原文件拖进其他软件直接用"
                      draggable
                      onDragStart={(e) => dragOutNative(e, v, `mengbi-video-${i + 1}`)}
                    >
                      ⠿ 拖出视频（原文件）
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </NodeShell>
      {openBatch != null && groups[openBatch]?.kind === 'batch' && (
        <BatchPopup batch={groups[openBatch] as BatchDisplay} onClose={() => setOpenBatch(null)} />
      )}
    </>
  );
}
