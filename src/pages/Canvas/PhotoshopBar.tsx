import { useEffect, useState } from 'react';
import { useCanvasStore } from '@/store/canvasStore';
import { usePsBridgeStore, type ReimportMode } from '@/store/psBridgeStore';
import { exportProjectAsPNG, blobToDataUri } from './canvasEngine/exportPNG';
import { importDataUriToCanvas } from './importToCanvas';
import { toast } from '@/store/toastStore';
import { autoSnapshot } from '@/store/snapshotStore';
import { confirmDialog } from '@/components/ConfirmDialog';
import type { PsFileChangedPayload } from '@shared/ipc';

/**
 * 画板工具栏里的「Photoshop 联动」组：
 *   - 发送到 PS：把当前画布合成成 PNG，写临时文件并用 PS / 系统默认程序打开，开始监听
 *   - 从 PS 导入：手动把最近一次临时文件读回画板
 *   - ⚙ 设置：PS 路径 / 导回方式 / 自动导回 / 临时目录
 *
 * 该组件在画板页常驻，因此把 `ps:file-changed` 监听放在这里（单实例）。
 * 工作流详见 CLAUDE.md §4.8 与需求十四节。
 */
export function PhotoshopBar(): JSX.Element {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const lastTempPath = usePsBridgeStore((s) => s.lastTempPath);
  const setLastTempPath = usePsBridgeStore((s) => s.setLastTempPath);
  const reimportMode = usePsBridgeStore((s) => s.reimportMode);
  const autoReimport = usePsBridgeStore((s) => s.autoReimport);
  const setStatus = usePsBridgeStore((s) => s.setStatus);

  // 启动时拉一次桥状态（PS 路径 / 临时目录是否存在）
  useEffect(() => {
    void refreshStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshStatus(): Promise<void> {
    const r = await window.electronAPI.ps.status();
    if (r.ok) setStatus(r.data);
  }

  // 监听 PS 保存（mtime 前进）→ 导回
  useEffect(() => {
    const off = window.electronAPI.on('ps:file-changed', (payload) => {
      const p = payload as PsFileChangedPayload;
      void handleFileChanged(p.tempPath);
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoReimport, reimportMode]);

  async function handleFileChanged(tempPath: string): Promise<void> {
    if (!autoReimport) {
      const okGo = await confirmDialog({
        title: '检测到 Photoshop 编辑结果',
        message: '是否把保存后的图片导入回画板？',
        detail: `导入方式：${REIMPORT_LABEL[reimportMode]}（可在 PS 联动设置里修改）`,
        okText: '导入',
        cancelText: '暂不'
      });
      if (!okGo) return;
    }
    await doReimport(tempPath);
  }

  async function doReimport(tempPath: string): Promise<void> {
    const r = await window.electronAPI.ps.readBack({ tempPath });
    if (!r.ok) {
      toast.error('导入失败', r.error.message);
      return;
    }
    autoSnapshot('导入 PS 结果前');
    try {
      await importDataUriToCanvas(r.data.dataUri, reimportMode, 'PS 编辑');
      toast.success('已导入 Photoshop 结果', REIMPORT_LABEL[reimportMode]);
    } catch (e) {
      toast.error('图片加载失败', String(e));
    }
  }

  async function handleSend(): Promise<void> {
    const project = useCanvasStore.getState().project;
    if (project.layers.length === 0) {
      toast.info('画板为空', '先添加图片再发送到 Photoshop');
      return;
    }
    autoSnapshot('发送 PS 前');
    try {
      const blob = await exportProjectAsPNG(project);
      const dataUri = await blobToDataUri(blob);
      const r = await window.electronAPI.ps.send({
        dataUri,
        suggestedName: project.name || 'canvas'
      });
      if (!r.ok) {
        toast.error('发送失败', r.error.message);
        return;
      }
      setLastTempPath(r.data.tempPath);
      toast.success(
        r.data.openedWith === 'photoshop' ? '已在 Photoshop 打开' : '已用系统默认程序打开',
        '在 PS 编辑并 Ctrl+S 保存，软件会提示导回'
      );
    } catch (e) {
      toast.error('导出失败', String(e));
    }
  }

  async function handleManualImport(): Promise<void> {
    if (!lastTempPath) {
      toast.info('没有可导入的文件', '先点「发送到 PS」');
      return;
    }
    await doReimport(lastTempPath);
  }

  return (
    <div className="mb-canvas-toolbar-group">
      <button
        type="button"
        className="mb-canvas-toolbar-btn"
        onClick={handleSend}
        title="把当前画布发送到 Photoshop 编辑"
      >
        🅿 发送到 PS
      </button>
      <button
        type="button"
        className="mb-canvas-toolbar-btn"
        onClick={handleManualImport}
        disabled={!lastTempPath}
        title="把最近一次 PS 编辑结果导入回画板"
      >
        ⬇ 从 PS 导入
      </button>
      <button
        type="button"
        className="mb-canvas-toolbar-btn"
        onClick={() => setSettingsOpen(true)}
        title="Photoshop 联动设置"
      >
        ⚙
      </button>
      {settingsOpen && (
        <PhotoshopDialog onClose={() => setSettingsOpen(false)} onChanged={refreshStatus} />
      )}
    </div>
  );
}

const REIMPORT_LABEL: Record<ReimportMode, string> = {
  'new-layer': '作为新图层',
  replace: '替换当前图层',
  'new-canvas': '新建画板'
};

function PhotoshopDialog({
  onClose,
  onChanged
}: {
  onClose: () => void;
  onChanged: () => void;
}): JSX.Element {
  const photoshopPath = usePsBridgeStore((s) => s.photoshopPath);
  const photoshopPathExists = usePsBridgeStore((s) => s.photoshopPathExists);
  const tempDir = usePsBridgeStore((s) => s.tempDir);
  const keepTemp = usePsBridgeStore((s) => s.keepTemp);
  const reimportMode = usePsBridgeStore((s) => s.reimportMode);
  const autoReimport = usePsBridgeStore((s) => s.autoReimport);
  const setReimportMode = usePsBridgeStore((s) => s.setReimportMode);
  const setAutoReimport = usePsBridgeStore((s) => s.setAutoReimport);

  // 临时目录可编辑：本地 draft，失焦/回车提交
  const [tempDraft, setTempDraft] = useState(tempDir);
  useEffect(() => setTempDraft(tempDir), [tempDir]);

  async function pickPhotoshop(): Promise<void> {
    const r = await window.electronAPI.storage.pickFile({
      title: '选择 Photoshop 可执行文件',
      filters: [{ name: '可执行文件', extensions: ['exe', 'app', ''] }]
    });
    if (!r.ok || !r.data.filePath) return;
    const save = await window.electronAPI.ps.setConfig({ photoshopPath: r.data.filePath });
    if (save.ok) {
      onChanged();
      toast.success('已设置 Photoshop 路径');
    }
  }

  async function clearPhotoshop(): Promise<void> {
    const r = await window.electronAPI.ps.setConfig({ photoshopPath: '' });
    if (r.ok) {
      onChanged();
      toast.info('已清除 Photoshop 路径', '今后用系统默认程序打开');
    }
  }

  async function commitTempDir(value: string): Promise<void> {
    const v = value.trim();
    if (v === tempDir) return;
    const r = await window.electronAPI.ps.setConfig({ tempDir: v });
    if (r.ok) {
      onChanged();
      toast.success('已更新临时目录');
    }
  }

  async function pickTempDir(): Promise<void> {
    const r = await window.electronAPI.storage.selectFolder();
    if (!r.ok || !r.data) return;
    setTempDraft(r.data.path);
    await commitTempDir(r.data.path);
  }

  async function toggleKeepTemp(): Promise<void> {
    const r = await window.electronAPI.ps.setConfig({ keepTemp: !keepTemp });
    if (r.ok) onChanged();
  }

  async function openTempDir(): Promise<void> {
    const r = await window.electronAPI.ps.openTempDir();
    if (!r.ok) toast.error('打开失败', r.error.message);
  }

  return (
    <div className="mb-modal-backdrop" onClick={onClose}>
      <div className="mb-modal mb-ps-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>Photoshop 联动设置</h3>

        <div className="mb-ps-field">
          <label>Photoshop 路径</label>
          <div className="mb-ps-pathrow">
            <span
              className={`mb-ps-pathtext ${photoshopPath && !photoshopPathExists ? 'is-missing' : ''}`}
              title={photoshopPath || '未设置 → 用系统默认程序打开 PNG'}
            >
              {photoshopPath
                ? `${photoshopPath}${photoshopPathExists ? '' : '（文件不存在）'}`
                : '未设置 → 系统默认程序打开'}
            </span>
            <button type="button" className="mb-ps-minibtn" onClick={pickPhotoshop}>
              选择
            </button>
            <button
              type="button"
              className="mb-ps-minibtn is-danger"
              onClick={clearPhotoshop}
              disabled={!photoshopPath}
            >
              清除
            </button>
          </div>
        </div>

        <div className="mb-ps-field">
          <label>导回方式</label>
          <select
            className="mb-canvas-props-select"
            value={reimportMode}
            onChange={(e) => setReimportMode(e.target.value as ReimportMode)}
          >
            <option value="new-layer">作为新图层</option>
            <option value="replace">替换当前图层</option>
            <option value="new-canvas">新建画板</option>
          </select>
        </div>

        <label className="mb-ps-checkrow">
          <input type="checkbox" checked={autoReimport} onChange={(e) => setAutoReimport(e.target.checked)} />
          检测到保存后自动导回（关闭则每次弹确认）
        </label>

        <label className="mb-ps-checkrow">
          <input type="checkbox" checked={keepTemp} onChange={toggleKeepTemp} />
          导回后保留临时文件
        </label>

        <div className="mb-ps-field">
          <label>临时目录</label>
          <div className="mb-ps-pathrow">
            <input
              className="mb-canvas-props-input"
              value={tempDraft}
              onChange={(e) => setTempDraft(e.target.value)}
              onBlur={() => commitTempDir(tempDraft)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
              spellCheck={false}
            />
            <button type="button" className="mb-ps-minibtn" onClick={pickTempDir}>
              选择
            </button>
            <button type="button" className="mb-ps-minibtn" onClick={openTempDir}>
              打开
            </button>
          </div>
        </div>

        <p className="mb-ps-note">
          工作流：发送到 PS → 在 Photoshop 编辑并 Ctrl+S 覆盖保存 → 软件检测到文件变化后按上面的导回方式装回画板。第一阶段仅支持 PNG 往返。
        </p>

        <div className="mb-modal-actions">
          <button type="button" className="mb-btn mb-btn-primary" onClick={onClose}>
            完成
          </button>
        </div>
      </div>
    </div>
  );
}
