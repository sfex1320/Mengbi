import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from '@/store/toastStore';
import { openContextMenu, type ContextMenuEntry } from '@/components/ContextMenu';
import {
  CopyIconShape,
  FolderIcon,
  GalleryIcon,
  PlusIcon,
  SparkleIcon
} from '@/components/Icon';

interface Props {
  /** 处理结果的 dataUri（PNG / JPG / SVG 都行） */
  dataUri: string;
  /** 用于落盘命名 + 入库标记 */
  kind: 'upscale' | 'vectorize';
  /** 用于另存为对话框的默认文件名（不带后缀） */
  defaultName: string;
  /** 入库时附加 sourceModel / params */
  sourceModel?: string;
  params?: Record<string, unknown>;
  /** 触发右键菜单的目标元素 */
  children: React.ReactNode;
}

/**
 * 包裹处理结果的容器，挂上右键菜单：
 *   - 复制图片
 *   - 另存为
 *   - 加入图库
 *   - 在文件夹中显示（保存后才出现）
 *
 * 处理结果区还提供顶部按钮组（手动渲染时调用 ResultActionsBar）。
 */
export function ResultActions({
  dataUri,
  kind,
  defaultName,
  sourceModel,
  params,
  children
}: Props): JSX.Element {
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const navigate = useNavigate();

  async function sendToOtherTool(target: 'upscale' | 'hypir' | 'supir'): Promise<void> {
    try {
      const { useToolsStore } = await import('@/store/toolsStore');
      useToolsStore.setState({ pendingImport: dataUri, activeTab: target });
      navigate('/tools');
    } catch (e) {
      toast.error('发送失败', String(e));
    }
  }

  function showMenu(e: React.MouseEvent): void {
    e.preventDefault();
    const items: ContextMenuEntry[] = [
      {
        label: '复制图片',
        icon: <CopyIconShape size={13} />,
        onClick: () => copyImage(dataUri).catch((err) => toast.error('复制失败', String(err)))
      },
      {
        label: '另存为...',
        icon: <FolderIcon size={13} />,
        onClick: () => {
          void saveAs(dataUri, kind, defaultName).then((p) => {
            if (p) setSavedPath(p);
          });
        }
      },
      {
        label: '加入图库',
        icon: <GalleryIcon size={13} />,
        onClick: () => void importToGallery(dataUri, kind, sourceModel, params)
      },
      {
        label: '保存到工具箱目录',
        icon: <PlusIcon size={13} />,
        onClick: () => {
          void autoSave(dataUri, kind, defaultName).then((p) => {
            if (p) setSavedPath(p);
          });
        }
      },
      { separator: true },
      {
        label: '继续在工具箱处理…',
        icon: <SparkleIcon size={12} />,
        children: [
          {
            label: '再用保真放大处理一遍',
            onClick: () => void sendToOtherTool('upscale')
          },
          {
            label: '送 HYPIR 做 AI 修复',
            onClick: () => void sendToOtherTool('hypir')
          },
          {
            label: '送 SUPIR 做 AI 修复',
            onClick: () => void sendToOtherTool('supir')
          }
          // "矢量化"菜单项已随矢量化功能整体移除，待重做
        ]
      }
    ];
    if (savedPath) {
      items.push({
        label: '在文件夹中显示',
        icon: <FolderIcon size={13} />,
        onClick: () => void window.electronAPI.storage.showInFolder(savedPath)
      });
    }
    openContextMenu({ x: e.clientX, y: e.clientY, items });
  }

  return (
    <div onContextMenu={showMenu} className="mb-result-actions-wrap">
      {children}
    </div>
  );
}

/**
 * 顶部按钮组——同样四个动作 + 在文件夹中显示。结果区上方使用。
 */
export function ResultActionsBar({
  dataUri,
  kind,
  defaultName,
  sourceModel,
  params
}: Omit<Props, 'children'>): JSX.Element {
  const [savedPath, setSavedPath] = useState<string | null>(null);
  return (
    <div className="mb-result-actions-bar">
      <button
        className="mb-btn mb-btn-secondary mb-btn-sm"
        onClick={() => copyImage(dataUri).catch((err) => toast.error('复制失败', String(err)))}
      >
        <CopyIconShape size={13} /> 复制
      </button>
      <button
        className="mb-btn mb-btn-secondary mb-btn-sm"
        onClick={() =>
          saveAs(dataUri, kind, defaultName).then((p) => p && setSavedPath(p))
        }
      >
        <FolderIcon size={13} /> 另存为
      </button>
      <button
        className="mb-btn mb-btn-secondary mb-btn-sm"
        onClick={() => importToGallery(dataUri, kind, sourceModel, params)}
      >
        <GalleryIcon size={13} /> 加入图库
      </button>
      <button
        className="mb-btn mb-btn-secondary mb-btn-sm"
        onClick={() =>
          autoSave(dataUri, kind, defaultName).then((p) => p && setSavedPath(p))
        }
      >
        <PlusIcon size={13} /> 保存到目录
      </button>
      {savedPath && (
        <button
          className="mb-btn mb-btn-ghost mb-btn-sm"
          onClick={() => void window.electronAPI.storage.showInFolder(savedPath)}
        >
          打开所在位置
        </button>
      )}
    </div>
  );
}

// ─── implementations ──────────────────────────────────────

/**
 * 把传进来的"图像源"统一成 data URI 字符串。
 *
 * 支持两种输入:
 *   - data:image/...;base64,...  原样返回(老路径)
 *   - mengbi-image://x/... 或任意 http(s) URL  fetch → blob → FileReader.readAsDataURL
 *     (主进程不阻塞 IPC 大字符串,改成"用户触发动作时才转")
 */
async function toDataUri(srcOrDataUri: string): Promise<string> {
  if (srcOrDataUri.startsWith('data:')) return srcOrDataUri;
  const blob = await (await fetch(srcOrDataUri)).blob();
  return await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error ?? new Error('FileReader failed'));
    r.readAsDataURL(blob);
  });
}

async function copyImage(srcOrDataUri: string): Promise<void> {
  // SVG 走 text/plain 复制(无论是 data URI 还是 URL,fetch 都能拿到文本)
  if (srcOrDataUri.endsWith('.svg') || srcOrDataUri.startsWith('data:image/svg+xml')) {
    const r = await fetch(srcOrDataUri);
    const svgText = await r.text();
    await navigator.clipboard.writeText(svgText);
    toast.success('已复制 SVG 文本');
    return;
  }
  const blob = await (await fetch(srcOrDataUri)).blob();
  await navigator.clipboard.write([
    new ClipboardItem({ [blob.type || 'image/png']: blob })
  ]);
  toast.success('已复制图片');
}

async function saveAs(
  srcOrDataUri: string,
  _kind: 'upscale' | 'vectorize',
  defaultName: string
): Promise<string | null> {
  const dataUri = await toDataUri(srcOrDataUri);
  const ext = dataUri.startsWith('data:image/svg+xml')
    ? 'svg'
    : dataUri.startsWith('data:image/jpeg')
      ? 'jpg'
      : 'png';
  const r = await window.electronAPI.storage.saveAs({
    dataUri,
    defaultName: `${defaultName}.${ext}`,
    filters:
      ext === 'svg'
        ? [{ name: 'SVG', extensions: ['svg'] }]
        : [
            { name: 'PNG', extensions: ['png'] },
            { name: 'JPEG', extensions: ['jpg', 'jpeg'] }
          ]
  });
  if (!r.ok) {
    toast.error('另存为失败', r.error.message);
    return null;
  }
  if (!r.data) return null; // 用户取消
  toast.success('已保存', r.data.filePath);
  return r.data.filePath;
}

async function autoSave(
  srcOrDataUri: string,
  kind: 'upscale' | 'vectorize',
  suggestedName: string
): Promise<string | null> {
  const dataUri = await toDataUri(srcOrDataUri);
  const r = await window.electronAPI.tools.saveOutput({
    dataUri,
    kind,
    suggestedName
  });
  if (!r.ok) {
    toast.error('保存失败', r.error.message);
    return null;
  }
  toast.success('已保存到工具箱目录', r.data.filePath);
  return r.data.filePath;
}

async function importToGallery(
  srcOrDataUri: string,
  kind: 'upscale' | 'vectorize',
  sourceModel?: string,
  params?: Record<string, unknown>
): Promise<void> {
  const dataUri = await toDataUri(srcOrDataUri);
  const r = await window.electronAPI.gallery.importFromBuffer({
    dataUri,
    kind,
    sourceModel,
    params
  });
  if (!r.ok) {
    toast.error('入库失败', r.error.message);
    return;
  }
  toast.success('已加入图库', `图片 #${r.data.id}`);
}
