import { useState } from 'react';
import { Lightbox } from '@/components/Lightbox';
import { openContextMenu } from '@/components/ContextMenu';
import { toast } from '@/store/toastStore';
import { localPathToImageUrl, thumbUrlFromOriginalPath } from '@/lib/imageUrl';
import type { OutputFile } from '@shared/comfyui';

function blobToDataUri(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(typeof r.result === 'string' ? r.result : '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(b);
  });
}

async function saveAs(path: string): Promise<void> {
  try {
    const blob = await (await fetch(localPathToImageUrl(path))).blob();
    const dataUri = await blobToDataUri(blob);
    const name = path.split(/[\\/]/).pop() ?? 'output.png';
    await window.electronAPI.storage.saveAs({ dataUri, defaultName: name });
  } catch (e) {
    toast.error('另存为失败', String(e));
  }
}

/** 第一阶段输出展示：图片缩略图（点开 Lightbox，右键菜单）+ 视频 + 文本。 */
export function ImageOutput({ outputs }: { outputs: OutputFile[] }): JSX.Element {
  const [lightbox, setLightbox] = useState<string | null>(null);

  if (outputs.length === 0) {
    return <div className="mb-cfy-output-empty">运行后结果会显示在这里</div>;
  }

  function imageMenu(e: React.MouseEvent, path: string): void {
    e.preventDefault();
    openContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: '放大查看', onClick: () => setLightbox(localPathToImageUrl(path)) },
        { label: '另存为…', onClick: () => void saveAs(path) },
        { label: '打开所在文件夹', onClick: () => void window.electronAPI.storage.showInFolder(path) }
      ]
    });
  }

  return (
    <div className="mb-cfy-output-grid">
      {outputs.map((o, i) => {
        if (o.kind === 'text') {
          return (
            <pre
              key={i}
              className="mb-cfy-output-text"
              onContextMenu={(e) => {
                e.preventDefault();
                openContextMenu({
                  x: e.clientX,
                  y: e.clientY,
                  items: [
                    {
                      label: '复制文本',
                      onClick: () => {
                        void navigator.clipboard.writeText(o.text ?? '');
                        toast.success('已复制');
                      }
                    }
                  ]
                });
              }}
            >
              {o.text}
            </pre>
          );
        }
        if (!o.path) return null;
        const p = o.path;
        if (o.kind === 'video') {
          return (
            <video
              key={i}
              className="mb-cfy-output-media"
              src={localPathToImageUrl(p)}
              controls
              onContextMenu={(e) => {
                e.preventDefault();
                openContextMenu({
                  x: e.clientX,
                  y: e.clientY,
                  items: [
                    { label: '另存为…', onClick: () => void saveAs(p) },
                    { label: '打开所在文件夹', onClick: () => void window.electronAPI.storage.showInFolder(p) }
                  ]
                });
              }}
            />
          );
        }
        if (o.kind === 'audio') {
          return (
            <audio
              key={i}
              className="mb-cfy-output-audio"
              src={localPathToImageUrl(p)}
              controls
              onContextMenu={(e) => {
                e.preventDefault();
                openContextMenu({
                  x: e.clientX,
                  y: e.clientY,
                  items: [
                    { label: '另存为…', onClick: () => void saveAs(p) },
                    { label: '打开所在文件夹', onClick: () => void window.electronAPI.storage.showInFolder(p) }
                  ]
                });
              }}
            />
          );
        }
        return (
          <button
            key={i}
            type="button"
            className="mb-cfy-output-tile"
            onClick={() => setLightbox(localPathToImageUrl(p))}
            onContextMenu={(e) => imageMenu(e, p)}
            title={p}
          >
            {/* 缩略图优先（运行时已 ensureThumbnail），加载失败回退原图，避免输出多图时卡顿 */}
            <img
              src={thumbUrlFromOriginalPath(p)}
              alt={`输出 ${i + 1}`}
              draggable={false}
              onError={(e) => {
                const el = e.currentTarget;
                if (!el.dataset.fallback) {
                  el.dataset.fallback = '1';
                  el.src = localPathToImageUrl(p);
                }
              }}
            />
          </button>
        );
      })}
      <Lightbox open={!!lightbox} src={lightbox ?? ''} onClose={() => setLightbox(null)} />
    </div>
  );
}
