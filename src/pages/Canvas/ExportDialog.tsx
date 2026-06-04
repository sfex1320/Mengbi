import { useState } from 'react';
import { Modal } from '@/components/Modal';
import { useCanvasStore } from '@/store/canvasStore';
import { useImageParamsStore } from '@/store/imageParamsStore';
import { useNavigate } from 'react-router-dom';
import { exportProjectAsPNG, blobToDataUri } from './canvasEngine/exportPNG';
import { toast } from '@/store/toastStore';

type Format = 'png' | 'jpg' | 'webp';
type Destination = 'file' | 'ref' | 'smart-canvas';

interface Props {
  open: boolean;
  onClose: () => void;
}

const FORMAT_LABEL: Record<Format, string> = { png: 'PNG', jpg: 'JPEG', webp: 'WebP' };
const FORMAT_MIME: Record<Format, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp'
};

/**
 * 统一的导出对话框：
 *   - 格式：PNG / JPG / WebP（PNG 无质量、JPG/WebP 有质量滑块）
 *   - 去向：保存到磁盘 / 直接送入生图页参考图
 */
export function ExportDialog({ open, onClose }: Props): JSX.Element {
  const project = useCanvasStore((s) => s.project);
  const addRefs = useImageParamsStore((s) => s.addRefs);
  const navigate = useNavigate();

  const [format, setFormat] = useState<Format>('png');
  const [quality, setQuality] = useState<number>(0.92);
  const [destination, setDestination] = useState<Destination>('file');
  const [busy, setBusy] = useState(false);

  async function doExport(): Promise<void> {
    if (project.layers.length === 0) {
      toast.info('画板为空', '先添加图片再导出');
      return;
    }
    setBusy(true);
    try {
      // 第一步：先按 PNG 拿到全分辨率画布
      const pngBlob = await exportProjectAsPNG(project);
      let outBlob: Blob = pngBlob;
      // 转成目标格式
      if (format !== 'png') {
        outBlob = await reencode(pngBlob, FORMAT_MIME[format], quality);
      }
      if (destination === 'file') {
        const url = URL.createObjectURL(outBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${project.name || 'canvas'}-${Date.now()}.${format}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        // 大图导出 blob 可达数十 MB，浏览器读取/落盘需要时间；延后吊销避免提前失效致下载失败
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
        toast.success(`已导出 ${FORMAT_LABEL[format]}`);
      } else if (destination === 'smart-canvas') {
        // 整张画板（已合成 + 选定格式）作为图片节点发送到智能画布，落在其当前视图正中心
        const dataUri = await blobToDataUri(outBlob);
        const { useSmartInboxStore } = await import('@/store/smartInboxStore');
        useSmartInboxStore.getState().push([{ src: dataUri, name: project.name || '画板成图' }]);
        toast.success('已发送到智能画布', '按 Ctrl+7 打开智能画布查看');
        navigate('/smart-canvas');
      } else {
        // 送入生图页：先把图写到主进程 temp-refs/ 拿到真实磁盘路径，
        // 这样 /v1/images/edits 那边 fs.readFile 才不会爆 ENOENT。
        const dataUri = await blobToDataUri(outBlob);
        const r = await window.electronAPI.storage.saveTempImage({
          dataUri,
          suggestedName: project.name || 'canvas'
        });
        if (!r.ok) {
          toast.error('暂存导出图失败', r.error.message);
          return;
        }
        addRefs([
          { path: r.data.filePath, dataUri, width: project.width, height: project.height }
        ]);
        toast.success('已发送到生图页', '可在右侧"参考图"查看');
        navigate('/');
      }
      onClose();
    } catch (e) {
      toast.error('导出失败', String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="导出画板"
      width={460}
      footer={
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="mb-canvas-toolbar-btn" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button
            type="button"
            className="mb-canvas-toolbar-btn is-primary"
            onClick={doExport}
            disabled={busy}
          >
            {busy
              ? '处理中…'
              : destination === 'file'
                ? '保存到磁盘'
                : destination === 'smart-canvas'
                  ? '发送到智能画布'
                  : '送入生图页'}
          </button>
        </div>
      }
    >
      <div className="mb-canvas-props-section">
        <p className="mb-canvas-props-section-title">格式</p>
        <div className="mb-canvas-props-btnrow" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
          {(['png', 'jpg', 'webp'] as const).map((f) => (
            <button
              key={f}
              type="button"
              className={`mb-canvas-props-actionbtn ${format === f ? 'is-accent' : ''}`}
              onClick={() => setFormat(f)}
            >
              {FORMAT_LABEL[f]}
            </button>
          ))}
        </div>
      </div>

      {format !== 'png' && (
        <div className="mb-canvas-props-section">
          <p className="mb-canvas-props-section-title">质量 ({Math.round(quality * 100)}%)</p>
          <input
            type="range"
            min={20}
            max={100}
            value={Math.round(quality * 100)}
            onChange={(e) => setQuality(+e.target.value / 100)}
            className="mb-canvas-props-slider"
            style={{ width: '100%' }}
          />
          <p
            style={{
              fontSize: 'var(--mb-text-tiny)',
              color: 'var(--mb-text-muted)',
              margin: 0
            }}
          >
            JPEG 不支持透明，背景会被填成画板背景色。WebP 支持透明 + 体积更小。
          </p>
        </div>
      )}

      <div className="mb-canvas-props-section">
        <p className="mb-canvas-props-section-title">保存到</p>
        <div className="mb-canvas-props-btnrow" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
          <button
            type="button"
            className={`mb-canvas-props-actionbtn ${destination === 'file' ? 'is-accent' : ''}`}
            onClick={() => setDestination('file')}
          >
            ⤓ 磁盘
          </button>
          <button
            type="button"
            className={`mb-canvas-props-actionbtn ${destination === 'ref' ? 'is-accent' : ''}`}
            onClick={() => setDestination('ref')}
          >
            → 生图页参考图
          </button>
          <button
            type="button"
            className={`mb-canvas-props-actionbtn ${destination === 'smart-canvas' ? 'is-accent' : ''}`}
            onClick={() => setDestination('smart-canvas')}
          >
            ✦ 智能画布
          </button>
        </div>
      </div>

      <div className="mb-canvas-props-section">
        <p className="mb-canvas-props-section-title">画布信息</p>
        <p style={{ fontSize: 'var(--mb-text-aux)', color: 'var(--mb-text-secondary)', margin: 0 }}>
          {project.width} × {project.height}px ·{' '}
          {project.layers.filter((l) => !l.isGroup).length} 层图像
        </p>
      </div>
    </Modal>
  );
}

async function reencode(srcBlob: Blob, mime: string, quality: number): Promise<Blob> {
  const bitmap = await createImageBitmap(srcBlob);
  const c = document.createElement('canvas');
  c.width = bitmap.width;
  c.height = bitmap.height;
  const ctx = c.getContext('2d')!;
  // JPEG 不支持透明，画白底兜底
  if (mime === 'image/jpeg') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
  }
  ctx.drawImage(bitmap, 0, 0);
  return await new Promise((resolve, reject) => {
    c.toBlob(
      (b) => {
        if (b) resolve(b);
        else reject(new Error('reencode failed'));
      },
      mime,
      quality
    );
  });
}
