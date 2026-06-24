import { useEffect, useRef } from 'react';
import { NodeResizer, type NodeProps } from '@xyflow/react';
import { useSmartCanvasStore, useSmartPreviewStore } from '@/store/smartCanvasStore';
import { localPathToImageUrl } from '@/lib/imageUrl';
import { filesToImageSrcs } from '@/lib/mediaFile';
import type { ImageNodeData, SmartNodeData } from '@shared/smartCanvas';
import { NodeShell } from './NodeShell';
import { thumbPair } from '../MeasuredThumb';
import { ImagePlusIcon } from '../icons';
import { CopyButton, NodeHint, areaMenu, copyImage, imageToGallery, imageSaveAs, autoGrowNode, getNodeWidth } from '../nodeArea';
import { runImageListNode, pauseLoop, resumeLoop, stopLoop } from '@/lib/smartCanvasRunner';
import { ClampNumberInput } from '../nodePanel/consoleControls';
import { useGalleryPickerStore } from '../GalleryPickerDialog';
import { useImageEditorStore } from '../ImageEditorModal';

function imgUrl(src?: string): string | null {
  if (!src) return null;
  return src.startsWith('data:') ? src : localPathToImageUrl(src);
}

/** 加载图片（crossOrigin 以便 canvas 裁切不被污染；支持 data: / mengbi-image:// 磁盘路径）。 */
function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const im = new window.Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => resolve(im);
    im.onerror = reject;
    im.src = imgUrl(src) ?? src;
  });
}

const RUN_LABELS: Record<string, string> = { idle: '待运行', running: '运行中…', paused: '已暂停', success: '已完成', error: '失败' };

export function ImageNode({ id, data }: NodeProps): JSX.Element {
  const update = useSmartCanvasStore((s) => s.updateNodeData);
  const remove = useSmartCanvasStore((s) => s.removeNode);
  const openPreview = useSmartPreviewStore((s) => s.open);
  const pickFromGallery = useGalleryPickerStore((s) => s.open);
  const openEditor = useImageEditorStore((s) => s.open);
  const fileRef = useRef<HTMLInputElement>(null);
  const listFileRef = useRef<HTMLInputElement>(null);
  const d = data as unknown as ImageNodeData;
  const url = imgUrl(d.src); // 原图 URL（放大预览 / 复制 / 另存用）
  const cover = d.src ? thumbPair(d.src).thumb : null;
  const overlayUrl = imgUrl(d.maskOverlaySrc); // 红色半透明蒙版 / 扩边标注层
  const srcs = d.srcs ?? [];
  const running = d.runStatus === 'running';
  const paused = d.runStatus === 'paused';
  const active = running || paused;
  const setF = (p: Partial<ImageNodeData>): void => update(id, p as Partial<SmartNodeData>);

  /** 「重置遮罩」：清掉遮罩并把图片还原到最初状态/尺寸。
   *  优先用 originalSrc；旧节点没存 originalSrc 但有扩边记录 → 把扩出的透明边裁回去即可还原原图原尺寸；
   *  纯画笔遮罩（没改像素）→ 清遮罩即可。 */
  async function resetMaskAndRestore(): Promise<void> {
    if (d.originalSrc) {
      setF({ src: d.originalSrc, originalSrc: undefined, inpaintMaskSrc: undefined, maskOverlaySrc: undefined, outpaintPad: undefined, naturalW: undefined, naturalH: undefined });
      return;
    }
    const pad = d.outpaintPad;
    if (pad && (pad.top || pad.right || pad.bottom || pad.left) && d.src) {
      try {
        const img = await loadImg(d.src);
        const cw = (img.naturalWidth || img.width) - (pad.left ?? 0) - (pad.right ?? 0);
        const ch = (img.naturalHeight || img.height) - (pad.top ?? 0) - (pad.bottom ?? 0);
        if (cw > 0 && ch > 0) {
          const c = document.createElement('canvas');
          c.width = cw;
          c.height = ch;
          const ctx = c.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, pad.left ?? 0, pad.top ?? 0, cw, ch, 0, 0, cw, ch);
            setF({ src: c.toDataURL('image/png'), inpaintMaskSrc: undefined, maskOverlaySrc: undefined, outpaintPad: undefined, naturalW: cw, naturalH: ch });
            return;
          }
        }
      } catch {
        /* 裁切失败 → 退回只清遮罩 */
      }
    }
    setF({ inpaintMaskSrc: undefined, maskOverlaySrc: undefined, outpaintPad: undefined });
  }

  // 列表模式：按缩略图行数自适应高度（只增不减）
  useEffect(() => {
    if (!d.listMode) return;
    const w = getNodeWidth(id);
    const perRow = Math.max(2, Math.floor((w - 20) / 72));
    const rows = Math.ceil(srcs.length / perRow);
    autoGrowNode(id, 168 + rows * 74, 900);
  }, [id, d.listMode, srcs.length]);

  function loadSingle(file: File | null | undefined): void {
    if (!file || !file.type.startsWith('image/')) return;
    const r = new FileReader();
    r.onload = () => {
      const dataUri = String(r.result);
      const im = new window.Image();
      // 换成全新一张图：清掉旧图的「最初始图 / 重绘遮罩」血缘，避免重置/遮罩错位到旧图
      im.onload = () =>
        setF({ src: dataUri, name: file.name, naturalW: im.naturalWidth, naturalH: im.naturalHeight, originalSrc: undefined, inpaintMaskSrc: undefined, maskOverlaySrc: undefined, outpaintPad: undefined });
      im.onerror = () => setF({ src: dataUri, name: file.name, originalSrc: undefined, inpaintMaskSrc: undefined, maskOverlaySrc: undefined, outpaintPad: undefined });
      im.src = dataUri;
    };
    r.readAsDataURL(file);
  }

  async function addToList(files: File[]): Promise<void> {
    const added = await filesToImageSrcs(files);
    if (!added.length) return;
    // 读最新 srcs（await 期间可能已变），追加
    const cur = useSmartCanvasStore.getState().nodes.find((n) => n.id === id);
    const curSrcs = ((cur?.data as unknown as ImageNodeData | undefined)?.srcs ?? []).slice();
    setF({ srcs: [...curSrcs, ...added] });
  }

  function toggleList(): void {
    if (!d.listMode) {
      const seed = d.src ? [d.src, ...srcs.filter((s) => s !== d.src)] : srcs;
      setF({ listMode: true, srcs: seed });
    } else {
      setF({ listMode: false, src: srcs[0] });
    }
  }

  function previewList(i: number): void {
    openPreview(
      srcs.map((s) => ({ src: imgUrl(s) as string, meta: { filePath: s.startsWith('data:') ? '' : s } })),
      i
    );
  }

  const toggle = (
    <button
      className="mb-sc-mini-toggle nodrag"
      title={d.listMode ? '切回单图' : '切到列表（多图，可设每批张数、逐批跑下游 / 接循环）'}
      onClick={toggleList}
    >
      {d.listMode ? '单图' : '列表'}
    </button>
  );

  return (
    <>
      <NodeResizer isVisible minWidth={120} minHeight={110} />
      <NodeShell title="图片" accent="is-image" outputs fill onDelete={() => remove(id)} headRight={toggle} label={d.label} labelColor={d.labelColor}>
        {!d.listMode ? (
          <div
            className="mb-sc-img-area nodrag"
            onPaste={(e) => {
              for (const it of Array.from(e.clipboardData?.items ?? [])) {
                if (it.kind === 'file' && it.type.startsWith('image/')) {
                  loadSingle(it.getAsFile());
                  e.preventDefault();
                  return;
                }
              }
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              loadSingle(e.dataTransfer.files?.[0]);
            }}
            tabIndex={0}
          >
            {url && cover ? (
              <>
                <img
                  className="mb-sc-img"
                  src={cover}
                  alt={d.name ?? '图片'}
                  draggable={false}
                  loading="lazy"
                  decoding="async"
                  onClick={() => openPreview(url)}
                  title="点击放大预览（原图）"
                  onError={(e) => {
                    if (e.currentTarget.src !== url) e.currentTarget.src = url;
                  }}
                  onLoad={(e) => {
                    const t = e.currentTarget;
                    const showingFull = d.src?.startsWith('data:') || t.src === url;
                    if (showingFull && t.naturalWidth && (d.naturalW !== t.naturalWidth || d.naturalH !== t.naturalHeight)) {
                      setF({ naturalW: t.naturalWidth, naturalH: t.naturalHeight });
                    }
                  }}
                  onContextMenu={(e) =>
                    areaMenu(e, [
                      { label: '编辑图片…', onClick: () => openEditor(id, d.src as string) },
                      { label: '复制图片', onClick: () => void copyImage(url) },
                      { label: '放大预览', onClick: () => openPreview(url) },
                      { label: '入资产库', onClick: () => void imageToGallery(d.src as string) },
                      { label: '另存…', onClick: () => void imageSaveAs(d.src as string, 'smart-canvas-image.png') },
                      { separator: true },
                      { label: '替换图片', onClick: () => fileRef.current?.click() },
                      { label: '从资产库选图', onClick: () => pickFromGallery(id) },
                      { label: '改为图片列表', onClick: toggleList },
                      { label: '移除图片', variant: 'danger', onClick: () => setF({ src: undefined }) }
                    ])
                  }
                />
                {overlayUrl && (
                  <img className="mb-sc-img-overlay nodrag" src={overlayUrl} alt="" draggable={false} aria-hidden />
                )}
                {d.outpaintPad && (d.outpaintPad.top || d.outpaintPad.right || d.outpaintPad.bottom || d.outpaintPad.left) ? (
                  <span className="mb-sc-img-outpaint-label nodrag" title="AI 扩图各边新增像素（红色区=新扩出的待填充区）">
                    扩边 ↑{d.outpaintPad.top} →{d.outpaintPad.right} ↓{d.outpaintPad.bottom} ←{d.outpaintPad.left}
                  </span>
                ) : null}
                <button className="mb-sc-img-edit nodrag" onClick={() => openEditor(id, d.src as string)} title="编辑图片（扩图 / 画笔 / 裁切 / 蒙版 / 调色）">
                  ✎ 编辑
                </button>
                <CopyButton onClick={() => void copyImage(url)} title="复制图片" />
                {d.naturalW && d.naturalH ? <span className="mb-sc-img-dims">{d.naturalW}×{d.naturalH}</span> : null}
                {d.inpaintMaskSrc ? (
                  <button
                    className="mb-sc-img-maskbadge nodrag"
                    onClick={() => void resetMaskAndRestore()}
                    title="已设局部重绘遮罩：连「图片 + 提示词」到生图节点，运行即按遮罩重画。点此清除遮罩并把图片还原到最初状态 / 尺寸（扩图也会撤销）"
                  >
                    ◐ 重绘遮罩 ✕
                  </button>
                ) : null}
                <button className="mb-sc-img-x nodrag" onClick={() => setF({ src: undefined })} title="移除图片">
                  ✕
                </button>
              </>
            ) : (
              <div className="mb-sc-img-empty nodrag">
                <button className="mb-sc-img-drop" onClick={() => fileRef.current?.click()}>
                  <ImagePlusIcon size={34} />
                  <span>点击选择 · 拖入 · 粘贴图片</span>
                </button>
                <button className="mb-btn mb-btn-sm mb-btn-ghost" onClick={() => pickFromGallery(id)}>
                  从资产库选图
                </button>
              </div>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={(e) => {
                loadSingle(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </div>
        ) : (
          <div
            className="mb-sc-imglist nodrag"
            onPaste={(e) => {
              const files = Array.from(e.clipboardData?.items ?? [])
                .filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
                .map((it) => it.getAsFile())
                .filter((f): f is File => !!f);
              if (files.length) {
                void addToList(files);
                e.preventDefault();
              }
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'));
              if (files.length) {
                e.preventDefault();
                e.stopPropagation();
                void addToList(files);
              }
            }}
            tabIndex={0}
          >
            <div className="mb-sc-imglist-head">
              <span>图片列表 · {srcs.length} 张</span>
              {srcs.length > 0 && (
                <button className="mb-sc-plist-clear" title="清空列表" onClick={() => setF({ srcs: [] })}>
                  清空
                </button>
              )}
            </div>

            {srcs.length > 0 ? (
              <div className="mb-sc-imglist-grid">
                {srcs.map((s, i) => {
                  const tp = thumbPair(s);
                  const full = imgUrl(s) as string;
                  return (
                    <div key={`${s}-${i}`} className={`mb-sc-imglist-cell ${d.batchIndex === Math.floor(i / Math.max(1, d.batchSize || 1)) && active ? 'is-current' : ''}`}>
                      <img
                        src={tp.thumb}
                        alt=""
                        draggable={false}
                        loading="lazy"
                        decoding="async"
                        onClick={() => previewList(i)}
                        onError={(e) => {
                          if (e.currentTarget.src !== full) e.currentTarget.src = full;
                        }}
                        title="点击放大"
                      />
                      <button className="mb-sc-imglist-x" title="移除" onClick={() => setF({ srcs: srcs.filter((_, j) => j !== i) })}>
                        ✕
                      </button>
                      <span className="mb-sc-imglist-i">{i + 1}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <button className="mb-sc-img-drop" onClick={() => listFileRef.current?.click()}>
                <ImagePlusIcon size={30} />
                <span>选择多张 · 拖入 · 粘贴</span>
              </button>
            )}

            <div className="mb-sc-imglist-actions">
              <button className="mb-btn mb-btn-sm mb-btn-ghost" onClick={() => listFileRef.current?.click()}>
                ＋ 添加图片
              </button>
              <button className="mb-btn mb-btn-sm mb-btn-ghost" onClick={() => pickFromGallery(id)} title="从资产库选图（追加）">
                资产库
              </button>
            </div>

            <div className="mb-sc-imglist-batch">
              <span className="mb-sc-sb-lbl">每批传下游</span>
              <ClampNumberInput min={1} max={200} value={d.batchSize || 1} onCommit={(v) => setF({ batchSize: v })} />
              <span className="mb-sc-imglist-batchhint">张</span>
              <NodeHint text="连到 生图（开「逐张处理输入图」）/ ComfyUI（逐张）/ 循环 节点逐批批量处理" />
            </div>

            {/* 自驱逐批运行（也可不点，直接连「循环」节点由其驱动） */}
            <div className="mb-sc-sb-runrow">
              {!active ? (
                <button className="mb-btn mb-btn-sm mb-btn-primary mb-sc-runbtn" disabled={!srcs.length} onClick={() => void runImageListNode(id)}>
                  逐批运行下游
                </button>
              ) : (
                <>
                  {paused ? (
                    <button className="mb-btn mb-btn-sm mb-btn-primary" onClick={() => resumeLoop(id)}>
                      继续
                    </button>
                  ) : (
                    <button className="mb-btn mb-btn-sm" title="当前批完成后暂停" onClick={() => pauseLoop(id)}>
                      暂停
                    </button>
                  )}
                  <button className="mb-btn mb-btn-sm mb-btn-ghost is-stop" onClick={() => stopLoop(id)}>
                    停止
                  </button>
                </>
              )}
            </div>

            {(active || (d.totalBatches ?? 0) > 0) && (
              <div className="mb-sc-loop-status">
                {RUN_LABELS[d.runStatus ?? 'idle']} · 第 {(d.batchIndex ?? 0) + 1}/{d.totalBatches ?? '?'} 批 · 成功 {d.doneCount ?? 0} · 失败 {d.failCount ?? 0}
              </div>
            )}
            {d.runError && <div className="mb-sc-result-err">{d.runError}</div>}

            <input
              ref={listFileRef}
              type="file"
              accept="image/*"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => {
                void addToList(Array.from(e.target.files ?? []));
                e.target.value = '';
              }}
            />
          </div>
        )}
      </NodeShell>
    </>
  );
}
