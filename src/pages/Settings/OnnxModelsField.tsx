/**
 * ONNX 模型管理面板(Settings → 工具箱)。
 *
 * 两类条目:
 *   - 「内置(builtin)」:软件出厂提供的 5 个 .onnx,按 categoryHint 分组、可一键下载
 *   - 「自定义(custom)」:用户自由导入的 .onnx,按 modeHint 分组(导入时弹 modal 选)
 *
 * 操作:
 *   - 下载内置 / 删除已装 / 在文件夹中显示
 *   - 自由导入 .onnx:弹「指定分类」对话框 → 复制到 models 目录 + 写 custom_meta.json
 *
 * 数据流:每次挂载 + refresh / 下载 / 删除 / 导入完成 → onnxList() 拉新清单。
 * 下载进度走 PushChannel 'upscale:onnx-download-progress'。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from '@/store/toastStore';
import { confirmDialog } from '@/components/ConfirmDialog';
import { FolderIcon, PlusIcon, TrashIcon } from '@/components/Icon';
import { Modal } from '@/components/Modal';
import type {
  OnnxModelView,
  OnnxCustomEntry,
  UpscaleOnnxDownloadProgressPayload,
  UpscaleModeCategory
} from '@shared/ipc';

interface CategoryDef {
  id: UpscaleModeCategory;
  label: string;
  hint: string;
}

const CATEGORIES: CategoryDef[] = [
  { id: 'general-hd', label: '通用高清', hint: '照片 / 商品图 / 设计稿' },
  { id: 'general-fast', label: '通用快速', hint: '批量 / 低配置 / 快速预览(轻量)' },
  { id: 'anime-illust', label: '动漫插画', hint: '二次元 / 漫画 / 线稿' },
  { id: 'anime-video', label: '动漫视频', hint: '视频帧 / 连续帧' },
  { id: 'sharpen', label: '清晰增强', hint: '模糊图 / 老图 / 纹理图(社区强化)' },
  { id: 'custom', label: '自定义 / 未分类', hint: '没指定分类的 .onnx 放这里' }
];

export function OnnxModelsField(): JSX.Element {
  const [builtins, setBuiltins] = useState<OnnxModelView[]>([]);
  const [custom, setCustom] = useState<OnnxCustomEntry[]>([]);
  const [modelsDir, setModelsDir] = useState<string>('');
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<
    Record<string, { received: number; total: number }>
  >({});
  // 导入分类选择 modal
  const [importPicker, setImportPicker] = useState<{
    open: boolean;
    paths: string[];
  }>({ open: false, paths: [] });

  const refresh = useCallback(async () => {
    try {
      const r = await window.electronAPI.upscale.onnxList();
      if (r.ok) {
        setBuiltins(r.data.builtins);
        setCustom(r.data.custom);
        setModelsDir(r.data.modelsDir);
      }
    } catch {
      /* */
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!window.electronAPI?.on) return;
    const off = window.electronAPI.on('upscale:onnx-download-progress', (raw) => {
      const p = raw as UpscaleOnnxDownloadProgressPayload;
      setProgress((prev) => ({
        ...prev,
        [p.modelId]: { received: p.received, total: p.total }
      }));
    });
    return () => off?.();
  }, []);

  // 按 categoryHint 把 builtins 分组,按 modeHint 把 custom 分组
  const groupedBuiltins = useMemo(() => {
    const map = new Map<UpscaleModeCategory, OnnxModelView[]>();
    for (const cat of CATEGORIES) map.set(cat.id, []);
    for (const m of builtins) {
      const list = map.get(m.categoryHint) ?? [];
      list.push(m);
      map.set(m.categoryHint, list);
    }
    return map;
  }, [builtins]);

  const groupedCustom = useMemo(() => {
    const map = new Map<UpscaleModeCategory, OnnxCustomEntry[]>();
    for (const cat of CATEGORIES) map.set(cat.id, []);
    for (const c of custom) {
      const list = map.get(c.modeHint) ?? [];
      list.push(c);
      map.set(c.modeHint, list);
    }
    return map;
  }, [custom]);

  async function download(modelId: string): Promise<void> {
    setBusy(modelId);
    setProgress((p) => ({ ...p, [modelId]: { received: 0, total: 0 } }));
    try {
      const r = await window.electronAPI.upscale.onnxDownload({ modelId });
      if (!r.ok) {
        toast.error('下载失败', r.error.message);
        return;
      }
      toast.success(`已下载 ${modelId}`);
      await refresh();
    } finally {
      setBusy(null);
      setProgress((p) => {
        const next = { ...p };
        delete next[modelId];
        return next;
      });
    }
  }

  async function remove(fileName: string): Promise<void> {
    const yes = await confirmDialog({
      title: '删除 ONNX 模型',
      message: `确定删除 ${fileName}?`,
      okText: '删除',
      danger: true
    });
    if (!yes) return;
    setBusy(fileName);
    try {
      const r = await window.electronAPI.upscale.onnxRemove({ fileName });
      if (!r.ok) {
        toast.error('删除失败', r.error.message);
        return;
      }
      toast.success('已删除');
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  // 自由导入:先弹文件选,后弹分类选(用户在 Modal 里点确认才会真的复制)
  async function startImport(): Promise<void> {
    const pick = await window.electronAPI.storage.pickFiles({
      title: '选择 .onnx 模型文件(可多选)',
      filters: [{ name: 'ONNX 模型', extensions: ['onnx'] }]
    });
    if (!pick.ok || pick.data.filePaths.length === 0) return;
    setImportPicker({ open: true, paths: pick.data.filePaths });
  }

  async function confirmImport(modeHint: UpscaleModeCategory): Promise<void> {
    const paths = importPicker.paths;
    setImportPicker({ open: false, paths: [] });
    const r = await window.electronAPI.upscale.onnxImportFiles({
      filePaths: paths,
      modeHint
    });
    if (!r.ok) {
      toast.error('导入失败', r.error.message);
      return;
    }
    if (r.data.imported.length > 0) {
      toast.success(
        `已导入 ${r.data.imported.length} 个 .onnx`,
        `分类:${categoryLabel(modeHint)}`
      );
    }
    if (r.data.skipped.length > 0) {
      toast.error(
        `跳过 ${r.data.skipped.length} 个`,
        r.data.skipped.map((s) => `${s.src}: ${s.reason}`).join('; ')
      );
    }
    await refresh();
  }

  const installedCount = builtins.filter((m) => m.installed).length;
  const total = builtins.length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <button className="mb-btn mb-btn-ghost mb-btn-sm" onClick={() => void refresh()}>
          刷新
        </button>
        <button
          className="mb-btn mb-btn-ghost mb-btn-sm"
          onClick={() => void startImport()}
          title="选 .onnx 文件 → 指定分类 → 复制到 ONNX 模型库"
        >
          <PlusIcon size={12} /> 导入 .onnx
        </button>
        {modelsDir && (
          <button
            className="mb-btn mb-btn-ghost mb-btn-sm"
            onClick={() =>
              void window.electronAPI.storage.openPath({
                targetPath: modelsDir,
                ensureDir: true
              })
            }
            title="打开 .onnx 文件存放目录"
          >
            <FolderIcon size={12} /> 打开 .onnx 目录
          </button>
        )}
        <span className="mb-field-hint" style={{ marginLeft: 'auto', fontSize: 11 }}>
          内置 {installedCount}/{total} 已装 · 自定义 {custom.length} · onnxruntime-node 主进程
        </span>
      </div>

      {CATEGORIES.map((cat) => {
        const builtinList = groupedBuiltins.get(cat.id) ?? [];
        const customList = groupedCustom.get(cat.id) ?? [];
        if (builtinList.length === 0 && customList.length === 0) return null;
        return (
          <CategorySection
            key={cat.id}
            cat={cat}
            builtins={builtinList}
            customs={customList}
            busy={busy}
            progress={progress}
            onDownload={download}
            onRemove={remove}
          />
        );
      })}

      {importPicker.open && (
        <Modal
          open
          title="为导入的 .onnx 指定分类"
          onClose={() => setImportPicker({ open: false, paths: [] })}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 360 }}>
            <div style={{ fontSize: 12, color: 'var(--mb-color-text-muted)' }}>
              已选 {importPicker.paths.length} 个 .onnx。选一个分类挂上去,
              该分类的模式会自动把这些 .onnx 当作可用备选。
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {CATEGORIES.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="mb-btn mb-btn-secondary"
                  onClick={() => void confirmImport(c.id)}
                  style={{ justifyContent: 'flex-start', textAlign: 'left' }}
                >
                  <strong>{c.label}</strong>
                  <span
                    style={{
                      fontSize: 11,
                      marginLeft: 8,
                      color: 'var(--mb-color-text-muted)'
                    }}
                  >
                    {c.hint}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function categoryLabel(id: UpscaleModeCategory): string {
  return CATEGORIES.find((c) => c.id === id)?.label ?? id;
}

function CategorySection({
  cat,
  builtins,
  customs,
  busy,
  progress,
  onDownload,
  onRemove
}: {
  cat: CategoryDef;
  builtins: OnnxModelView[];
  customs: OnnxCustomEntry[];
  busy: string | null;
  progress: Record<string, { received: number; total: number }>;
  onDownload: (id: string) => Promise<void>;
  onRemove: (fileName: string) => Promise<void>;
}): JSX.Element {
  const installedHere = builtins.filter((m) => m.installed).length;
  const totalBuiltin = builtins.length;
  const totalCustom = customs.length;
  return (
    <div className="mb-mapping-list" style={{ marginBottom: 2 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 8,
          padding: '6px 0 4px',
          borderBottom: '1px solid var(--mb-color-border, rgba(255,255,255,0.06))'
        }}
      >
        <strong style={{ fontSize: 12, letterSpacing: '0.5px' }}>
          【{cat.label}】 (内置 {installedHere}/{totalBuiltin}
          {totalCustom > 0 && ` · 自定义 ${totalCustom}`})
        </strong>
        <span style={{ fontSize: 10, color: 'var(--mb-color-text-muted, #888)' }}>
          {cat.hint}
        </span>
      </div>

      {builtins.map((m) => {
        const prog = progress[m.id];
        const pct =
          prog && prog.total > 0 ? Math.round((prog.received / prog.total) * 100) : 0;
        const downloading = busy === m.id;
        return (
          <div
            key={m.id}
            className="mb-mapping-row"
            title={m.description}
            style={{ alignItems: 'flex-start' }}
          >
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <strong style={{ fontSize: 12 }}>{m.displayName}</strong>
                {m.installed && (
                  <span
                    style={{
                      fontSize: 10,
                      padding: '1px 5px',
                      borderRadius: 4,
                      background: 'var(--mb-color-success-bg, rgba(60,180,80,0.18))',
                      color: 'var(--mb-color-success, #4ade80)'
                    }}
                  >
                    已装
                  </span>
                )}
              </div>
              <span style={{ fontSize: 10, color: 'var(--mb-color-text-muted, #888)' }}>
                {(m.expectedBytes / 1024 / 1024).toFixed(1)} MB · {m.licenseNote}
              </span>
              <span style={{ fontSize: 10, opacity: 0.8 }}>{m.description}</span>
              <code style={{ fontSize: 10, opacity: 0.55 }}>{m.fileName}</code>
              {downloading && prog && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div
                    style={{
                      flex: 1,
                      height: 4,
                      background: 'var(--mb-color-surface-3, rgba(255,255,255,0.06))',
                      borderRadius: 2,
                      overflow: 'hidden'
                    }}
                  >
                    <div
                      style={{
                        width: `${pct}%`,
                        height: '100%',
                        background: 'var(--mb-color-primary, #ff9c4d)',
                        transition: 'width 120ms linear'
                      }}
                    />
                  </div>
                  <span style={{ fontSize: 10, minWidth: 70, textAlign: 'right' }}>
                    {pct}% · {(prog.received / 1024 / 1024).toFixed(1)} /{' '}
                    {(prog.total / 1024 / 1024).toFixed(0)} MB
                  </span>
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              {m.installed ? (
                <>
                  <button
                    className="mb-btn mb-btn-ghost mb-btn-xs"
                    onClick={() => void window.electronAPI.storage.showInFolder(m.absPath)}
                    title="在文件夹中显示"
                  >
                    <FolderIcon size={11} />
                  </button>
                  <button
                    className="mb-mapping-remove"
                    onClick={() => void onRemove(m.fileName)}
                    disabled={busy === m.fileName}
                    title="删除"
                  >
                    <TrashIcon size={12} />
                  </button>
                </>
              ) : (
                <button
                  className="mb-btn mb-btn-primary mb-btn-xs"
                  onClick={() => void onDownload(m.id)}
                  disabled={downloading}
                >
                  {downloading ? '下载中' : '下载'}
                </button>
              )}
            </div>
          </div>
        );
      })}

      {customs.map((c) => (
        <div key={c.fileName} className="mb-mapping-row">
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <code style={{ fontSize: 11 }}>{c.fileName}</code>
              <span
                style={{
                  fontSize: 10,
                  padding: '1px 5px',
                  borderRadius: 4,
                  background: 'var(--mb-color-surface-3, rgba(255,255,255,0.06))',
                  color: 'var(--mb-color-text-muted, #888)'
                }}
              >
                自定义
              </span>
            </div>
            <span style={{ fontSize: 10, color: 'var(--mb-color-text-muted, #888)' }}>
              {(c.sizeBytes / 1024 / 1024).toFixed(1)} MB · 用户导入
            </span>
          </div>
          <button
            className="mb-btn mb-btn-ghost mb-btn-xs"
            onClick={() => void window.electronAPI.storage.showInFolder(c.absPath)}
          >
            <FolderIcon size={11} />
          </button>
          <button
            className="mb-mapping-remove"
            onClick={() => void onRemove(c.fileName)}
            disabled={busy === c.fileName}
          >
            <TrashIcon size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
