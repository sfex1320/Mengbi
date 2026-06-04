import { useRef } from 'react';
import { NodeResizer, type NodeProps } from '@xyflow/react';
import { useSmartCanvasStore, useSmartPreviewStore } from '@/store/smartCanvasStore';
import { localPathToImageUrl } from '@/lib/imageUrl';
import type { ImageNodeData } from '@shared/smartCanvas';
import { NodeShell } from './NodeShell';
import { CopyButton, areaMenu, copyImage, imageToGallery, imageSaveAs } from '../nodeArea';
import { useGalleryPickerStore } from '../GalleryPickerDialog';

function imgUrl(src?: string): string | null {
  if (!src) return null;
  return src.startsWith('data:') ? src : localPathToImageUrl(src);
}

export function ImageNode({ id, data }: NodeProps): JSX.Element {
  const update = useSmartCanvasStore((s) => s.updateNodeData);
  const remove = useSmartCanvasStore((s) => s.removeNode);
  const openPreview = useSmartPreviewStore((s) => s.open);
  const pickFromGallery = useGalleryPickerStore((s) => s.open);
  const fileRef = useRef<HTMLInputElement>(null);
  const d = data as unknown as ImageNodeData;
  const url = imgUrl(d.src);

  function loadFile(file: File | null | undefined): void {
    if (!file || !file.type.startsWith('image/')) return;
    const r = new FileReader();
    r.onload = () => {
      const dataUri = String(r.result);
      const im = new window.Image();
      im.onload = () =>
        update(id, { src: dataUri, name: file.name, naturalW: im.naturalWidth, naturalH: im.naturalHeight });
      im.onerror = () => update(id, { src: dataUri, name: file.name });
      im.src = dataUri;
    };
    r.readAsDataURL(file);
  }

  return (
    <>
      <NodeResizer isVisible minWidth={120} minHeight={110} />
      <NodeShell title="图片" accent="is-image" outputs fill onDelete={() => remove(id)} label={d.label} labelColor={d.labelColor}>
        <div
          className="mb-sc-img-area nodrag"
          onPaste={(e) => {
            for (const it of Array.from(e.clipboardData?.items ?? [])) {
              if (it.kind === 'file' && it.type.startsWith('image/')) {
                loadFile(it.getAsFile());
                e.preventDefault();
                return;
              }
            }
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation(); // 别冒泡到画布 onDrop（否则会再创建一个新节点）
            loadFile(e.dataTransfer.files?.[0]);
          }}
          tabIndex={0}
        >
          {url ? (
            <>
              <img
                className="mb-sc-img"
                src={url}
                alt={d.name ?? '图片'}
                draggable={false}
                onClick={() => openPreview(url)}
                title="点击放大预览"
                onLoad={(e) => {
                  // 量实际分辨率（图库选图 / 上游来的图没存 naturalW/H 时补上，节点角标 + 检查器显示）
                  const t = e.currentTarget;
                  if (t.naturalWidth && (d.naturalW !== t.naturalWidth || d.naturalH !== t.naturalHeight)) {
                    update(id, { naturalW: t.naturalWidth, naturalH: t.naturalHeight });
                  }
                }}
                onContextMenu={(e) =>
                  areaMenu(e, [
                    { label: '复制图片', onClick: () => void copyImage(url) },
                    { label: '放大预览', onClick: () => openPreview(url) },
                    { label: '入图库', onClick: () => void imageToGallery(d.src as string) },
                    { label: '另存…', onClick: () => void imageSaveAs(d.src as string, 'smart-canvas-image.png') },
                    { separator: true },
                    { label: '替换图片', onClick: () => fileRef.current?.click() },
                    { label: '从图库选图', onClick: () => pickFromGallery(id) },
                    { label: '移除图片', variant: 'danger', onClick: () => update(id, { src: undefined }) }
                  ])
                }
              />
              <CopyButton onClick={() => void copyImage(url)} title="复制图片" />
              {d.naturalW && d.naturalH ? (
                <span className="mb-sc-img-dims">{d.naturalW}×{d.naturalH}</span>
              ) : null}
              <button className="mb-sc-img-x nodrag" onClick={() => update(id, { src: undefined })} title="移除图片">
                ✕
              </button>
            </>
          ) : (
            <div className="mb-sc-img-empty nodrag">
              <button className="mb-sc-img-drop" onClick={() => fileRef.current?.click()}>
                点击选择 · 拖入 · 粘贴图片
              </button>
              <button className="mb-btn mb-btn-sm mb-btn-ghost" onClick={() => pickFromGallery(id)}>
                从图库选图
              </button>
            </div>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={(e) => {
              loadFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>
      </NodeShell>
    </>
  );
}
