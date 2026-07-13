import { useMemo, useRef, useState } from 'react';
import { NodeResizer, type NodeProps } from '@xyflow/react';
import { useSmartCanvasStore, useSmartPreviewStore } from '@/store/smartCanvasStore';
import { localPathToImageUrl } from '@/lib/imageUrl';
import { filesToImageSrcs } from '@/lib/mediaFile';
import { activeImageList, cellOrdinals, toggleSkipIdx, moveImageItem, insertImagesAt, removeImageAt } from '@/lib/imageListOrder';
import type { ImageNodeData, SmartNodeData, WorkNodeData } from '@shared/smartCanvas';
import { NodeShell } from './NodeShell';
import { thumbPair } from '../MeasuredThumb';
import { ImagePlusIcon } from '../icons';
import { CopyButton, areaMenu, copyImage, imageToGallery, imageSaveAs, useFitNodeToContent } from '../nodeArea';
import { computeUpstream } from '@/lib/smartCanvasRunner';
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

export function ImageNode({ id, data }: NodeProps): JSX.Element {
  const update = useSmartCanvasStore((s) => s.updateNodeData);
  const remove = useSmartCanvasStore((s) => s.removeNode);
  const nodesAll = useSmartCanvasStore((s) => s.nodes);
  const edgesAll = useSmartCanvasStore((s) => s.edges);
  const openPreview = useSmartPreviewStore((s) => s.open);
  const pickFromGallery = useGalleryPickerStore((s) => s.open);
  const openEditor = useImageEditorStore((s) => s.open);
  const fileRef = useRef<HTMLInputElement>(null);
  const listFileRef = useRef<HTMLInputElement>(null);
  // 九宫格内部拖拽重排：记录拖起的格子下标；overIdx 高亮当前悬停靶格
  const dragFrom = useRef<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const d = data as unknown as ImageNodeData;
  const url = imgUrl(d.src); // 原图 URL（放大预览 / 复制 / 另存用）
  const cover = d.src ? thumbPair(d.src).thumb : null;
  const overlayUrl = imgUrl(d.maskOverlaySrc); // 红色半透明蒙版 / 扩边标注层
  const srcs = d.srcs ?? [];
  // 每格角标（1 起；跳过=null 不占号）——与传给下游的 activeImageList 严格同序
  const ordinals = cellOrdinals(srcs, d.disabledIdx);
  const setF = (p: Partial<ImageNodeData>): void => update(id, p as Partial<SmartNodeData>);

  /**
   * 单图模式的「下游序号」角标：这张图在第一个直连生图下游的 computeUpstream 图序里排第几
   * （= 提交给中转站的 refs 序 = 用户提示词里的「图N」）。一图连多个生图下游时角标显示第一个，
   * title 里列全部。纯派生（nodes+edges 现算），不新增持久化字段。
   */
  const downOrder = useMemo(() => {
    if (d.listMode || !d.src) return null;
    const works: Array<{ wid: string; wname: string }> = [];
    for (const e of edgesAll) {
      if (e.source !== id) continue;
      const t = nodesAll.find((n) => n.id === e.target);
      if (t?.type === 'work' && !works.some((w) => w.wid === t.id)) {
        works.push({ wid: t.id, wname: (t.data as unknown as WorkNodeData).name?.trim() || '生图' });
      }
    }
    if (!works.length) return null;
    const entries = works
      .map((w) => {
        const up = computeUpstream(nodesAll, edgesAll, w.wid);
        // imageFroms 与 images 一一并联；本节点单图模式只贡献 1 张 → 首个命中下标即序号
        const idx = up.imageFroms ? up.imageFroms.indexOf(id) : -1;
        return { ...w, idx };
      })
      .filter((x) => x.idx >= 0);
    if (!entries.length) return null;
    return {
      first: entries[0].idx + 1,
      title: entries.map((x) => `${x.wname}：图${x.idx + 1}`).join('\n')
    };
  }, [nodesAll, edgesAll, id, d.listMode, d.src]);

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

  // 节点高度贴合真实内容（fitwrap 实测，两种模式统一）：
  // 单图 = 图片区按「节点宽 × naturalW/H 纵横比」出自然高度；九宫格 = 格数增删/单图↔列表切换都实测跟随。
  // 旧网格算式的容器内边距常数与真实 DOM 有 ~30px 偏差（且完全不覆盖单图模式），故改实测。手动 > 自适应。
  const fitRef = useRef<HTMLDivElement>(null);
  useFitNodeToContent(id, fitRef, 52, 1600);

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

  /** 把文件放进列表：at 为格子下标（放进该位置、原图后移）；缺省/越界 = 追加到末尾。 */
  async function addToList(files: File[], at?: number): Promise<void> {
    const added = await filesToImageSrcs(files);
    if (!added.length) return;
    // 读最新 srcs/disabledIdx（await 读文件期间可能已变），经纯函数插入（禁用标记跟着顺延重映射）
    const cur = useSmartCanvasStore.getState().nodes.find((n) => n.id === id);
    const curD = cur?.data as unknown as ImageNodeData | undefined;
    const patch = insertImagesAt(curD?.srcs ?? [], curD?.disabledIdx, at ?? -1, added);
    setF({ srcs: patch.srcs, disabledIdx: patch.disabledIdx });
  }

  function toggleList(): void {
    if (!d.listMode) {
      const seed = d.src ? [d.src, ...srcs.filter((s) => s !== d.src)] : srcs;
      setF({ listMode: true, srcs: seed });
    } else {
      // 回单图：取第一张「未跳过」的图作为单图（跳过标记只在列表模式有意义，顺手清掉）
      setF({ listMode: false, src: activeImageList(srcs, d.disabledIdx)[0] ?? srcs[0], disabledIdx: undefined });
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
      title={d.listMode ? '切回单图' : '切到列表（九宫格多图：角标序号 = 传给下游生图的图序；Alt+点击可跳过某格）'}
      onClick={toggleList}
    >
      {d.listMode ? '单图' : '列表'}
    </button>
  );

  return (
    <>
      <NodeResizer isVisible minWidth={120} minHeight={110} />
      <NodeShell title="图片" accent="is-image" outputs fill onDelete={() => remove(id)} headRight={toggle} label={d.label} labelColor={d.labelColor}>
        <div className="mb-sc-fitwrap nowheel" ref={fitRef}>
        {!d.listMode ? (
          <div
            className="mb-sc-img-area nodrag"
            // 单图区自然高度 = 宽 × 图片纵横比（fitwrap 实测的测量口径；无尺寸信息时退回 min-height 兜底）
            style={url && d.naturalW && d.naturalH ? { aspectRatio: `${d.naturalW} / ${d.naturalH}` } : undefined}
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
                {downOrder ? (
                  // 下游序号角标：这张图在直连生图节点里的图序（提示词写「图N」即指它）；连多个生图时 title 列全部
                  <span className="mb-sc-img-ord nodrag" title={`在下游生图中的图序（提示词里的「图N」即此序号）：\n${downOrder.title}`}>
                    图{downOrder.first}
                  </span>
                ) : null}
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
              <span>
                图片列表 · {srcs.length} 张
                {d.disabledIdx?.length ? `（跳过 ${d.disabledIdx.length}，传下游 ${activeImageList(srcs, d.disabledIdx).length}）` : ''}
              </span>
              {srcs.length > 0 && (
                <button className="mb-sc-plist-clear" title="清空列表" onClick={() => setF({ srcs: [], disabledIdx: undefined })}>
                  清空
                </button>
              )}
            </div>

            {/* 九宫格：3 列固定；角标序号 = 实际传下游的图序（跳过的不占号，所见即所发）。
                交互：点击放大 · Alt+点击跳过/恢复 · 格间拖拽重排 · 拖文件到格=插到该位置 · 「＋」格添加 */}
            <div className="mb-sc-img9-grid">
              {srcs.map((s, i) => {
                const tp = thumbPair(s);
                const full = imgUrl(s) as string;
                const skipped = ordinals[i] === null;
                return (
                  <div
                    key={`${s}-${i}`}
                    className={`mb-sc-img9-cell ${skipped ? 'is-skip' : ''} ${overIdx === i ? 'is-dragover' : ''}`}
                    draggable
                    onDragStart={(e) => {
                      dragFrom.current = i;
                      e.dataTransfer.effectAllowed = 'move';
                      // 内部重排专用类型：canvas 的 onDrop 不认识它，不会误建节点
                      e.dataTransfer.setData('application/mengbi-img9', String(i));
                    }}
                    onDragEnd={() => {
                      dragFrom.current = null;
                      setOverIdx(null);
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setOverIdx(i);
                    }}
                    onDragLeave={() => setOverIdx((v) => (v === i ? null : v))}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation(); // 别冒泡到容器（容器 drop=追加末尾）/ 画布（建节点）
                      setOverIdx(null);
                      const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'));
                      if (files.length) {
                        void addToList(files, i); // 拖文件到某格 = 放进该位置（原图后移）
                        return;
                      }
                      if (dragFrom.current != null && dragFrom.current !== i) {
                        // 格间拖拽 = 移动重排；禁用标记跟着图走（纯函数统一重映射）
                        const patch = moveImageItem(srcs, d.disabledIdx, dragFrom.current, i);
                        setF({ srcs: patch.srcs, disabledIdx: patch.disabledIdx });
                      }
                      dragFrom.current = null;
                    }}
                  >
                    <img
                      src={tp.thumb}
                      alt=""
                      draggable={false}
                      loading="lazy"
                      decoding="async"
                      onClick={(e) => {
                        e.stopPropagation(); // 格子级点击不冒泡到节点（Alt+点击节点=跳过整个节点，靠这里区分）
                        if (e.altKey) {
                          // Alt+点击 = 跳过/恢复该格（跳过的不传下游、不占序号）
                          setF({ disabledIdx: toggleSkipIdx(d.disabledIdx, i) });
                        } else {
                          previewList(i);
                        }
                      }}
                      onError={(e) => {
                        if (e.currentTarget.src !== full) e.currentTarget.src = full;
                      }}
                      title={skipped ? 'Alt+点击恢复（当前跳过：不传下游）' : '点击放大 · Alt+点击跳过 · 拖动换位'}
                    />
                    <button
                      className="mb-sc-imglist-x"
                      title="移除"
                      onClick={() => {
                        const patch = removeImageAt(srcs, d.disabledIdx, i);
                        setF({ srcs: patch.srcs, disabledIdx: patch.disabledIdx });
                      }}
                    >
                      ✕
                    </button>
                    <span className={`mb-sc-img9-idx ${skipped ? 'is-skip' : ''}`}>{skipped ? '跳过' : ordinals[i]}</span>
                  </div>
                );
              })}
              {/* 末尾常驻「＋」空格：点击选文件（多选）；也可把文件直接拖到这里 = 追加 */}
              <button
                className={`mb-sc-img9-add ${overIdx === -2 ? 'is-dragover' : ''}`}
                onClick={() => listFileRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOverIdx(-2);
                }}
                onDragLeave={() => setOverIdx((v) => (v === -2 ? null : v))}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setOverIdx(null);
                  const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'));
                  if (files.length) void addToList(files);
                }}
                title="添加图片（可多选）；拖文件到这里 = 追加到末尾"
              >
                <ImagePlusIcon size={22} />
                <span>＋</span>
              </button>
            </div>

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
        </div>
      </NodeShell>
    </>
  );
}
