import { useEffect, useState } from 'react';
import { localPathToImageUrl, thumbUrlFromOriginalPath } from '@/lib/imageUrl';

/**
 * 原始来源（本地绝对路径或 data:URI）→ { thumb: 显示用缩略图 URL, full: 全图 URL }。
 * 本地路径优先用资产库同款 .thumbs WebP 缩略图（最长边 512px，~5-40KB）；
 * 缩略图缺失（视频帧 / canvas-assets / 老图未补）由 <img onError> 自动回退全图。
 * 高分辨率（4K/8K）结果图全量解码 + GPU 上传是智能画布卡顿掉帧的主因，网格一律走缩略图。
 */
export function thumbPair(src: string): { thumb: string; full: string } {
  if (src.startsWith('data:') || src.startsWith('blob:')) return { thumb: src, full: src };
  return { thumb: thumbUrlFromOriginalPath(src), full: localPathToImageUrl(src) };
}

/**
 * 带「实际分辨率」徽章的缩略图。封面**只加载缩略图**，绝不为了量角标去解码原图。
 * - 不传 fullSrc：直接渲染 src，onLoad 量 naturalWidth×Height（src 即是要显示的图，无额外代价）。
 * - 传 fullSrc（缩略图模式）：网格里显示 src（缩略图）。**不再** off-DOM 解码 fullSrc 量真实分辨率——
 *   对「几万×几万」超大图，那等于在渲染端整张解码一遍，是卡死主因；真实分辨率改到放大预览(Lightbox)里看。
 *   缩略图加载失败才回退渲染 fullSrc（此时显示的就是原图，onLoad 顺带量到真实分辨率）。
 */
export function MeasuredThumb({
  src,
  fullSrc,
  alt,
  title,
  draggable,
  noDims,
  measureFull,
  onClick,
  onDragStart,
  onContextMenu
}: {
  src: string;
  /** 真实全图（本地协议 URL 或 dataURI）；提供时 src 视为缩略图 */
  fullSrc?: string;
  alt?: string;
  title?: string;
  draggable?: boolean;
  /** 兼容保留：缩略图模式本就不再量原图角标，此项现等同「连回退显示原图时也不量」。 */
  noDims?: boolean;
  /**
   * 节点预览专用：off-DOM 解码 fullSrc 量「真实分辨率」角标（缩略图模式下也显示）。
   * 仅用于节点内的少量预览图（生图/ComfyUI/结果），不要给资产库大网格用——
   * 那里一次几百张全图解码会卡死（铁律 23③）。
   */
  measureFull?: boolean;
  onClick?: () => void;
  onDragStart?: (e: React.DragEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}): JSX.Element {
  const [dims, setDims] = useState('');
  const [thumbFailed, setThumbFailed] = useState(false);

  // src 变化（同位置换图）→ 复位回退态与角标
  useEffect(() => {
    setThumbFailed(false);
    setDims('');
  }, [src, fullSrc]);

  // measureFull：节点预览里 off-DOM 解码原图量真实分辨率（少量图，开销可控）
  useEffect(() => {
    if (noDims || !measureFull) return;
    const target = fullSrc || src;
    if (!target) return;
    let alive = true;
    const im = new Image();
    im.onload = () => {
      if (alive && im.naturalWidth && im.naturalHeight) setDims(`${im.naturalWidth}×${im.naturalHeight}`);
    };
    im.src = target;
    return () => {
      alive = false;
      im.onload = null;
    };
  }, [measureFull, noDims, fullSrc, src]);

  const display = thumbFailed && fullSrc ? fullSrc : src;
  // 仅当「显示的就是原图本身」时才顺带量分辨率（无 fullSrc / 缩略图加载失败回退到原图）；
  // 缩略图正常显示时不量（量了得解码原图，对超大图会卡死）。
  const measureOnLoad = !noDims && (!fullSrc || fullSrc === src || thumbFailed);
  return (
    <span className="mb-sc-thumb-wrap">
      <img
        src={display}
        alt={alt ?? ''}
        title={title}
        draggable={draggable}
        loading="lazy"
        decoding="async"
        onDragStart={onDragStart}
        onClick={onClick}
        onContextMenu={onContextMenu}
        onError={() => {
          if (fullSrc && !thumbFailed) setThumbFailed(true);
        }}
        onLoad={(e) => {
          if (!measureOnLoad) return;
          const t = e.currentTarget;
          if (t.naturalWidth && t.naturalHeight) setDims(`${t.naturalWidth}×${t.naturalHeight}`);
        }}
      />
      {dims && <span className="mb-sc-thumb-dims">{dims}</span>}
    </span>
  );
}
