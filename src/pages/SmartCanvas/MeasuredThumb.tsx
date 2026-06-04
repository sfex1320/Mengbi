import { useState } from 'react';

/**
 * 带「实际分辨率」徽章的缩略图：图片 onLoad 时量 naturalWidth×Height 显示在右下角。
 * 用于工作流图片节点 / 生成结果缩略图，让用户一眼看到真实分辨率。
 */
export function MeasuredThumb({
  src,
  alt,
  title,
  draggable,
  onClick,
  onDragStart
}: {
  src: string;
  alt?: string;
  title?: string;
  draggable?: boolean;
  onClick?: () => void;
  onDragStart?: (e: React.DragEvent) => void;
}): JSX.Element {
  const [dims, setDims] = useState('');
  return (
    <span className="mb-sc-thumb-wrap">
      <img
        src={src}
        alt={alt ?? ''}
        title={title}
        draggable={draggable}
        onDragStart={onDragStart}
        onClick={onClick}
        onLoad={(e) => {
          const t = e.currentTarget;
          if (t.naturalWidth && t.naturalHeight) setDims(`${t.naturalWidth}×${t.naturalHeight}`);
        }}
      />
      {dims && <span className="mb-sc-thumb-dims">{dims}</span>}
    </span>
  );
}
