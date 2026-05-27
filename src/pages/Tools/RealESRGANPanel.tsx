import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ImportPanel } from '@/components/ImportPanel';
import { ResultActions, ResultActionsBar } from '@/components/ResultActions';
import { useToolsStore } from '@/store/toolsStore';
import { useToolsEngineStore } from '@/store/toolsEngineStore';
import { toast } from '@/store/toastStore';
import { confirmDialog } from '@/components/ConfirmDialog';
import { FolderIcon, TrashIcon, CheckIcon, XIcon, ZapIcon, PlusIcon } from '@/components/Icon';
import { localPathToImageUrl } from '@/lib/imageUrl';
import {
  getUpscaleModelMeta,
  groupModelsByCategory
} from '@/lib/upscaleModelMeta';
import type {
  UpscaleEngineStatus,
  UpscaleSource,
  UpscaleFormat,
  UpscaleProgressPayload,
  UpscaleInstallProgressPayload
} from '@shared/ipc';

/**
 * Real-ESRGAN ncnn Vulkan 面板（保真放大模式）。
 *
 * 用法：
 * 1. 首次进来若引擎未安装：显示安装卡片，提供 GitHub / 国内镜像 / 自动 三种下载源
 * 2. 引擎装好后：单图标签 / 批量标签 二选一，配 模型 / 倍率 / 输出格式 / tile / GPU / TTA
 * 3. 开始放大：主进程串行跑（避免 Vulkan 显存抖动），进度从 stderr 解析 'XX.XX%'
 * 4. 完成：单图回传 dataUri 直接预览 + 右键菜单；批量列结果路径，可一键打开输出目录
 *
 * 不在本面板做的事：本地非 ncnn 模型管理（专属 ONNX 推理已下线）；AI 修复（走 HypirPanel）
 */

type Mode = 'single' | 'batch';

const SCALES: Array<2 | 3 | 4> = [2, 3, 4];
const FORMATS: UpscaleFormat[] = ['png', 'jpg', 'webp'];
const DEFAULT_MODEL = 'realesrgan-x4plus-anime';

// 模型描述与分类移到 @/lib/upscaleModelMeta —— 同时被设置页复用

export function RealESRGANPanel(): JSX.Element {
  const inputDataUri = useToolsStore((s) => s.inputDataUri);
  const setInputDataUri = useToolsStore((s) => s.setInputDataUri);
  const batchInputs = useToolsStore((s) => s.batchInputs);
  const setBatchInputs = useToolsStore((s) => s.setBatchInputs);
  const lastUpscale = useToolsStore((s) => s.lastUpscale);
  const setLastUpscale = useToolsStore((s) => s.setLastUpscale);

  // 引擎状态走共享 store（跨标签切换缓存，不重复 IPC）
  const status = useToolsEngineStore((s) => s.upscaleStatus);
  const statusBusy = useToolsEngineStore((s) => s.upscaleStatusLoading);
  const refreshUpscaleStatus = useToolsEngineStore((s) => s.refreshUpscaleStatus);
  const [installBusy, setInstallBusy] = useState(false);
  const [installSource, setInstallSource] = useState<UpscaleSource>('auto');
  const [installProgress, setInstallProgress] = useState<{
    component: string;
    received: number;
    total: number;
  } | null>(null);

  const [mode, setMode] = useState<Mode>('single');
  const [modelName, setModelName] = useState<string>(DEFAULT_MODEL);
  const [scale, setScale] = useState<2 | 3 | 4>(4);
  const [format, setFormat] = useState<UpscaleFormat>('png');
  const [tile, setTile] = useState<number>(0);
  const [gpuId, setGpuId] = useState<'auto' | number>('auto');
  const [tta, setTta] = useState<boolean>(false);

  const [running, setRunning] = useState(false);
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);
  const [progress, setProgress] = useState<UpscaleProgressPayload | null>(null);
  const [batchResults, setBatchResults] = useState<
    Array<{ inputPath: string; outputPath: string; outputW: number; outputH: number; elapsedMs: number }>
  >([]);

  // 第一次进 panel 触发拉取（store 内部会去重 + 缓存）
  useEffect(() => {
    void refreshUpscaleStatus(false);
  }, [refreshUpscaleStatus]);

  // status 拿到后，校正选中模型
  useEffect(() => {
    if (status && status.models.length > 0 && !status.models.find((m) => m.name === modelName)) {
      setModelName(status.models[0].name);
    }
  }, [status, modelName]);

  useEffect(() => {
    if (!window.electronAPI?.on) return;
    const offProg = window.electronAPI.on('upscale:progress', (raw) => {
      const p = raw as UpscaleProgressPayload;
      if (currentTaskId && p.taskId !== currentTaskId) return;
      setProgress(p);
    });
    const offInstall = window.electronAPI.on('upscale:install-progress', (raw) => {
      const p = raw as UpscaleInstallProgressPayload;
      setInstallProgress(p);
    });
    return () => {
      offProg?.();
      offInstall?.();
    };
  }, [currentTaskId]);

  /** 强制刷新（用户点"重扫"按钮 / 装完引擎后调用） */
  async function refreshStatus(): Promise<void> {
    await refreshUpscaleStatus(true);
  }

  const [installError, setInstallError] = useState<string | null>(null);

  async function installEngine(): Promise<void> {
    setInstallBusy(true);
    setInstallError(null);
    setInstallProgress({ component: 'engine', received: 0, total: 0 });
    try {
      const r = await window.electronAPI.upscale.installEngine({ source: installSource });
      if (!r.ok) {
        setInstallError(r.error.message);
        toast.error('引擎安装失败', '展开下方诊断查看每个源的失败原因');
        return;
      }
      toast.success('引擎已安装', `内置 ${r.data.modelsInstalled.length} 个模型`);
      await refreshStatus();
    } catch (e) {
      // preload 缺方法 / IPC 抛错 / 其他意外 —— 至少把状态从"安装中"解出来
      const msg = e instanceof Error ? e.message : String(e);
      setInstallError(`未预期错误：${msg}\n\n常见原因：preload 脚本未热更新 —— 完全停掉 dev 重启。`);
      toast.error('引擎安装失败', msg);
    } finally {
      setInstallBusy(false);
      setInstallProgress(null);
    }
  }

  async function installFromLocalZip(): Promise<void> {
    // 先检查 preload 是否暴露了新方法 —— 用户没重启 dev 时给个明确提示，避免卡死
    if (typeof window.electronAPI.upscale.installEngineFromZip !== 'function') {
      const hint =
        '本地导入功能需要重启 dev：完全停掉 npm run dev（Ctrl+C），再重新启动一次。' +
        '\n原因：preload 脚本不参与 HMR，新加的 IPC 方法只能在重启后生效。';
      setInstallError(hint);
      toast.error('需重启 dev', '展开下方诊断看说明');
      return;
    }
    const pick = await window.electronAPI.storage.pickFile({
      title: '选择 Real-ESRGAN ncnn Vulkan release zip',
      filters: [{ name: 'ZIP 压缩包', extensions: ['zip'] }]
    });
    if (!pick.ok) {
      toast.error('选择文件失败', pick.error.message);
      return;
    }
    if (!pick.data.filePath) return;
    setInstallBusy(true);
    setInstallError(null);
    try {
      const r = await window.electronAPI.upscale.installEngineFromZip({
        zipPath: pick.data.filePath
      });
      if (!r.ok) {
        setInstallError(r.error.message);
        toast.error('本地安装失败', r.error.message);
        return;
      }
      toast.success('引擎已安装', `内置 ${r.data.modelsInstalled.length} 个模型`);
      await refreshStatus();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setInstallError(`未预期错误：${msg}`);
      toast.error('本地安装失败', msg);
    } finally {
      setInstallBusy(false);
    }
  }

  async function uninstallEngine(): Promise<void> {
    const ok = await confirmDialog({
      title: '卸载放大引擎',
      message: '确定卸载 Real-ESRGAN ncnn Vulkan 引擎吗？',
      detail: '会删除引擎二进制 + 所有已装模型；HYPIR / 矢量化不受影响。',
      okText: '卸载',
      danger: true
    });
    if (!ok) return;
    const r = await window.electronAPI.upscale.removeEngine();
    if (!r.ok) {
      toast.error('卸载失败', r.error.message);
      return;
    }
    toast.success('引擎已卸载');
    await refreshStatus();
  }

  async function importLocalModels(): Promise<void> {
    if (typeof window.electronAPI.upscale.importLocalModelFiles !== 'function') {
      toast.error('需重启 dev', '本地模型导入是新增方法，preload 需重启才能生效');
      return;
    }
    const pick = await window.electronAPI.storage.pickFiles({
      title: '选择 .bin / .param 模型文件（可多选；同名成对才能用）',
      filters: [{ name: 'NCNN 模型', extensions: ['bin', 'param'] }]
    });
    if (!pick.ok) {
      toast.error('选择失败', pick.error.message);
      return;
    }
    if (pick.data.filePaths.length === 0) return;
    const r = await window.electronAPI.upscale.importLocalModelFiles({
      filePaths: pick.data.filePaths
    });
    if (!r.ok) {
      toast.error('导入失败', r.error.message);
      return;
    }
    toast.success(`已导入 ${r.data.imported.length} 个文件`, `当前可用模型：${r.data.modelsAfter.length}`);
    await refreshStatus();
  }

  async function pickBatch(): Promise<void> {
    const r = await window.electronAPI.storage.pickImages();
    if (!r.ok) {
      toast.error('选图失败', r.error.message);
      return;
    }
    if (r.data.files.length === 0) return;
    setBatchInputs(r.data.files.map((f) => f.path));
  }

  function commonParams(): {
    modelName: string;
    scale: 2 | 3 | 4;
    format: UpscaleFormat;
    tile: number;
    gpuId: 'auto' | number;
    tta: boolean;
  } {
    return { modelName, scale, format, tile, gpuId, tta };
  }

  async function runSingle(): Promise<void> {
    if (!inputDataUri) {
      toast.error('请先载入图片');
      return;
    }
    if (!status?.installed) {
      toast.error('请先安装引擎');
      return;
    }
    setRunning(true);
    setProgress(null);
    setBatchResults([]);
    const reqId = makeTempId();
    setCurrentTaskId(reqId);
    const r = await window.electronAPI.upscale.runSingle({
      inputDataUri,
      ...commonParams()
    });
    setRunning(false);
    setCurrentTaskId(null);
    if (!r.ok) {
      if (r.error.code !== 'CANCELLED') {
        toast.error('放大失败', r.error.message);
      }
      return;
    }
    // 2026-05-28: 不再依赖 outputDataUri,UI 用 mengbi-image:// 协议读 outputPath
    setLastUpscale({
      outputDataUri: r.data.outputDataUri ?? '',
      outputPath: r.data.outputPath,
      inputW: r.data.inputW,
      inputH: r.data.inputH,
      outputW: r.data.outputW,
      outputH: r.data.outputH,
      engineLabel: 'Real-ESRGAN ncnn',
      modelName,
      scale,
      elapsedMs: r.data.elapsedMs,
      ts: Date.now()
    });
    toast.success(
      '放大完成',
      `${r.data.inputW}×${r.data.inputH} → ${r.data.outputW}×${r.data.outputH}（${(r.data.elapsedMs / 1000).toFixed(1)}s）`
    );
  }

  async function runBatch(): Promise<void> {
    if (batchInputs.length === 0) {
      toast.error('请先选择要批量放大的文件');
      return;
    }
    if (!status?.installed) {
      toast.error('请先安装引擎');
      return;
    }
    setRunning(true);
    setProgress(null);
    setBatchResults([]);
    const reqId = makeTempId();
    setCurrentTaskId(reqId);
    const r = await window.electronAPI.upscale.runBatch({
      inputPaths: batchInputs,
      ...commonParams()
    });
    setRunning(false);
    setCurrentTaskId(null);
    if (!r.ok) {
      if (r.error.code !== 'CANCELLED') {
        toast.error('批量放大失败', r.error.message);
      }
      return;
    }
    setBatchResults(r.data.results);
    toast.success('批量完成', `${r.data.results.length} 张已输出`);
  }

  async function cancel(): Promise<void> {
    const r = await window.electronAPI.upscale.cancel({});
    if (r.ok) {
      toast.info('已请求取消');
    }
  }

  const noEngine = !status || !status.installed;
  const platformBlocked = status?.platform === 'unsupported';

  return (
    <div className="mb-tools-pane">
      <div className="mb-tools-pane-left">
        {/* ── 引擎状态条 ─────────────────────── */}
        <EngineStatusCard
          status={status}
          statusBusy={statusBusy}
          installBusy={installBusy}
          installProgress={installProgress}
          installSource={installSource}
          setInstallSource={setInstallSource}
          installError={installError}
          onInstall={installEngine}
          onInstallFromZip={installFromLocalZip}
          onUninstall={uninstallEngine}
          onRefresh={refreshStatus}
          platformBlocked={!!platformBlocked}
        />

        {!noEngine && (
          <>
            {/* ── 模式：单图 vs 批量 ──────────── */}
            <div className="mb-tools-engine-row">
              <button
                className={`mb-tools-engine-chip ${mode === 'single' ? 'is-active' : ''}`}
                onClick={() => setMode('single')}
                disabled={running}
              >
                <span className="mb-tools-engine-title">单图</span>
                <span className="mb-tools-engine-desc">一张图，回读到面板预览</span>
              </button>
              <button
                className={`mb-tools-engine-chip ${mode === 'batch' ? 'is-active' : ''}`}
                onClick={() => setMode('batch')}
                disabled={running}
              >
                <span className="mb-tools-engine-title">批量</span>
                <span className="mb-tools-engine-desc">一组图，直接落输出目录</span>
              </button>
            </div>

            {/* ── 输入 ────────────────────────── */}
            <h3 className="mb-tools-pane-section">输入</h3>
            {mode === 'single' ? (
              <ImportPanel value={inputDataUri} onChange={setInputDataUri} maxDim={4096} />
            ) : (
              <div className="mb-tools-batch-list">
                <div className="mb-tools-row-buttons">
                  <button
                    className="mb-btn mb-btn-secondary mb-btn-sm"
                    onClick={() => void pickBatch()}
                    disabled={running}
                  >
                    <FolderIcon size={13} /> 选择多张图
                  </button>
                  {batchInputs.length > 0 && (
                    <button
                      className="mb-btn mb-btn-ghost mb-btn-sm"
                      onClick={() => setBatchInputs([])}
                      disabled={running}
                    >
                      <XIcon size={13} /> 清空（{batchInputs.length}）
                    </button>
                  )}
                </div>
                {batchInputs.length === 0 ? (
                  <div className="mb-tools-placeholder" style={{ minHeight: 80 }}>
                    尚未选图 — 点上方按钮多选 PNG / JPG / WebP
                  </div>
                ) : (
                  <ul className="mb-tools-batch-files">
                    {batchInputs.slice(0, 8).map((p) => (
                      <li key={p} title={p}>
                        {basename(p)}
                      </li>
                    ))}
                    {batchInputs.length > 8 && (
                      <li className="mb-tools-batch-more">…还有 {batchInputs.length - 8} 张</li>
                    )}
                  </ul>
                )}
              </div>
            )}

            {/* ── 参数 ────────────────────────── */}
            <h3 className="mb-tools-pane-section">参数</h3>
            <div className="mb-tools-fields">
              <Field label="模型">
                {(status?.models.length ?? 0) === 0 ? (
                  <div className="mb-tools-empty-models" style={{ padding: 12 }}>
                    <p className="mb-tools-empty-models-title" style={{ fontSize: 12 }}>
                      引擎已装，但没扫到模型
                    </p>
                    <p className="mb-tools-empty-models-hint">
                      官方 v0.2.0 windows zip 应该自带 6 个模型（~10MB）。
                      你的安装可能是早期 bug 留下的半成品，建议：① 卸载重装；
                      或 ② 自行下到 .bin/.param 后点「导入本地模型」。
                    </p>
                    {status?.modelsPath && (
                      <code style={{ fontSize: 11, wordBreak: 'break-all' }}>
                        {status.modelsPath}（{status.modelsDirExists ? '存在' : '不存在'}）
                      </code>
                    )}

                    {/* 顶层目录清单：直观看到引擎根里到底有啥 */}
                    {status && status.engineRootListing.length > 0 && (
                      <details style={{ marginTop: 8 }}>
                        <summary style={{ fontSize: 11, cursor: 'pointer', color: 'var(--mb-text-secondary)' }}>
                          引擎目录里现有 {status.engineRootListing.length} 项（点开看）
                        </summary>
                        <ul style={{ margin: '6px 0 0', paddingLeft: 16, fontSize: 11, color: 'var(--mb-text-muted)' }}>
                          {status.engineRootListing.map((e) => (
                            <li key={e.name}>
                              {e.isDir ? '📁' : '📄'} {e.name}
                              {!e.isDir && ` · ${formatBytes(e.sizeBytes)}`}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}

                    <div className="mb-tools-row-buttons" style={{ marginTop: 8 }}>
                      <button
                        className="mb-btn mb-btn-primary mb-btn-sm"
                        onClick={() => void importLocalModels()}
                      >
                        <PlusIcon size={13} /> 导入本地模型（.bin/.param）
                      </button>
                      <button
                        className="mb-btn mb-btn-ghost mb-btn-sm"
                        onClick={() =>
                          status?.modelsPath &&
                          void window.electronAPI.storage.openPath({
                            targetPath: status.modelsPath,
                            ensureDir: true
                          })
                        }
                      >
                        <FolderIcon size={12} /> 打开 models 目录
                      </button>
                      <button
                        className="mb-btn mb-btn-ghost mb-btn-sm"
                        onClick={() =>
                          status?.enginePath &&
                          void window.electronAPI.storage.openPath({
                            targetPath: status.enginePath
                          })
                        }
                      >
                        <FolderIcon size={12} /> 打开引擎根目录
                      </button>
                      <button
                        className="mb-btn mb-btn-ghost mb-btn-sm"
                        onClick={() => void refreshStatus()}
                      >
                        重扫
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <select
                      className="mb-select"
                      value={modelName}
                      onChange={(e) => setModelName(e.target.value)}
                      disabled={running}
                    >
                      {groupModelsByCategory(status?.models ?? []).map((g) => (
                        <optgroup key={g.category} label={`【${g.label}】`}>
                          {g.items.map((m) => {
                            const meta = getUpscaleModelMeta(m.name);
                            return (
                              <option key={m.name} value={m.name}>
                                {m.name}  ·  {meta.label}
                              </option>
                            );
                          })}
                        </optgroup>
                      ))}
                    </select>
                    <span className="mb-tools-field-hint">
                      {getUpscaleModelMeta(modelName).description}
                    </span>
                    <div
                      className="mb-tools-row-buttons"
                      style={{ marginTop: 4, alignSelf: 'flex-start' }}
                    >
                      <button
                        className="mb-btn mb-btn-ghost mb-btn-sm"
                        onClick={() => void importLocalModels()}
                      >
                        <PlusIcon size={12} /> 再导入模型
                      </button>
                      <button
                        className="mb-btn mb-btn-ghost mb-btn-sm"
                        onClick={() => void refreshStatus()}
                        title="重新扫描 models 目录,识别手动放进去的新 .bin/.param"
                      >
                        刷新列表
                      </button>
                    </div>
                  </>
                )}
              </Field>

              <div className="mb-tools-engine-row">
                <Field label="倍率">
                  <select
                    className="mb-select"
                    value={scale}
                    onChange={(e) => setScale(Number(e.target.value) as 2 | 3 | 4)}
                    disabled={running}
                  >
                    {SCALES.map((s) => (
                      <option key={s} value={s}>
                        {s}×
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="输出格式">
                  <select
                    className="mb-select"
                    value={format}
                    onChange={(e) => setFormat(e.target.value as UpscaleFormat)}
                    disabled={running}
                  >
                    {FORMATS.map((f) => (
                      <option key={f} value={f}>
                        {f.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              <div className="mb-tools-engine-row">
                <Field label="Tile 分块（0=自动）">
                  <input
                    type="number"
                    className="mb-input"
                    min={0}
                    max={4096}
                    step={32}
                    value={tile}
                    onChange={(e) => setTile(Math.max(0, Math.min(4096, Number(e.target.value) || 0)))}
                    disabled={running}
                  />
                  <span className="mb-tools-field-hint">爆显存就降到 128/256</span>
                </Field>
                <Field label="GPU">
                  <select
                    className="mb-select"
                    value={gpuId === 'auto' ? 'auto' : String(gpuId)}
                    onChange={(e) =>
                      setGpuId(e.target.value === 'auto' ? 'auto' : Number(e.target.value))
                    }
                    disabled={running}
                  >
                    <option value="auto">自动</option>
                    {[0, 1, 2, 3].map((g) => (
                      <option key={g} value={g}>
                        GPU #{g}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              <label className="mb-tools-switch-row">
                <input
                  type="checkbox"
                  checked={tta}
                  onChange={(e) => setTta(e.target.checked)}
                  disabled={running}
                />
                <span>TTA 模式（8 倍耗时，细节略好；默认关）</span>
              </label>
            </div>

            <div className="mb-tools-action-row">
              <button
                className="mb-btn mb-btn-primary"
                onClick={() => (mode === 'single' ? void runSingle() : void runBatch())}
                disabled={running || statusBusy}
              >
                <ZapIcon size={14} /> {running ? '放大中…' : '开始放大'}
              </button>
              {running && (
                <button className="mb-btn mb-btn-ghost" onClick={() => void cancel()}>
                  <XIcon size={13} /> 取消
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── 右侧结果区 ─────────────────────────── */}
      <div className="mb-tools-pane-right">
        <h3 className="mb-tools-pane-section">输出</h3>

        {/* 互斥渲染：busy / 单图结果 / 批量结果 / placeholder */}
        {running ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            className="mb-tools-busy-card"
          >
            <div className="mb-tools-progress-bar">
              <div
                className="mb-tools-progress-bar-fill"
                style={{ width: `${progress?.percent ?? 0}%` }}
              />
            </div>
            <div className="mb-tools-progress-phase">
              {progress
                ? `${progress.itemIndex + 1}/${progress.itemCount} · ${progress.phase}${
                    progress.currentInput ? ` · ${progress.currentInput}` : ''
                  }`
                : '准备中…'}
            </div>
            <div className="mb-tools-progress-pct">{progress?.percent ?? 0}%</div>
          </motion.div>
        ) : null}

        {!running && !lastUpscale && batchResults.length === 0 && (
          <div className="mb-tools-placeholder">
            {noEngine
              ? '请先在左侧安装 Real-ESRGAN 引擎'
              : '左侧载入输入并点「开始放大」'}
          </div>
        )}

        {!running && mode === 'single' && lastUpscale && (
          <>
            <ResultActionsBar
              dataUri={localPathToImageUrl(lastUpscale.outputPath)}
              kind="upscale"
              defaultName={`upscale-${lastUpscale.outputW}x${lastUpscale.outputH}-${lastUpscale.ts}`}
              sourceModel={`${lastUpscale.engineLabel}/${lastUpscale.modelName}`}
              params={{ scale: lastUpscale.scale, model: lastUpscale.modelName }}
            />
            <ResultActions
              dataUri={localPathToImageUrl(lastUpscale.outputPath)}
              kind="upscale"
              defaultName={`upscale-${lastUpscale.outputW}x${lastUpscale.outputH}-${lastUpscale.ts}`}
              sourceModel={`${lastUpscale.engineLabel}/${lastUpscale.modelName}`}
              params={{ scale: lastUpscale.scale, model: lastUpscale.modelName }}
            >
              <img
                src={localPathToImageUrl(lastUpscale.outputPath)}
                className="mb-tools-result-img"
                alt="放大结果"
              />
            </ResultActions>
            <div className="mb-tools-result-meta">
              {lastUpscale.inputW}×{lastUpscale.inputH} → {lastUpscale.outputW}×{lastUpscale.outputH}
              {' · '}
              {lastUpscale.modelName} · {lastUpscale.scale}x ·
              {' '}
              {(lastUpscale.elapsedMs / 1000).toFixed(1)}s · 右键可复制 / 另存为 / 加入图库
              <button
                type="button"
                className="mb-btn mb-btn-ghost mb-btn-sm"
                style={{ marginLeft: 8 }}
                onClick={() => void window.electronAPI.storage.showInFolder(lastUpscale.outputPath)}
              >
                <FolderIcon size={12} /> 打开输出目录
              </button>
              <button
                type="button"
                className="mb-btn mb-btn-ghost mb-btn-sm"
                style={{ marginLeft: 6 }}
                onClick={() => setLastUpscale(null)}
              >
                清空
              </button>
            </div>
          </>
        )}

        {!running && mode === 'batch' && batchResults.length > 0 && (
          <div className="mb-tools-batch-results">
            <div className="mb-tools-result-meta">
              共 {batchResults.length} 张完成
            </div>
            <ul className="mb-tools-batch-results-list">
              {batchResults.map((r) => (
                <li key={r.outputPath} title={r.outputPath}>
                  <span className="mb-tools-batch-results-name">{basename(r.outputPath)}</span>
                  <span className="mb-tools-batch-results-dim">
                    → {r.outputW}×{r.outputH} · {(r.elapsedMs / 1000).toFixed(1)}s
                  </span>
                  <button
                    className="mb-btn mb-btn-ghost mb-btn-sm"
                    onClick={() => void window.electronAPI.storage.showInFolder(r.outputPath)}
                  >
                    <FolderIcon size={12} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

      </div>
    </div>
  );
}

// ─── 引擎安装卡片 ────────────────────────────────────────

function EngineStatusCard(props: {
  status: UpscaleEngineStatus | null;
  statusBusy: boolean;
  installBusy: boolean;
  installProgress: { component: string; received: number; total: number } | null;
  installSource: UpscaleSource;
  setInstallSource: (s: UpscaleSource) => void;
  installError: string | null;
  onInstall: () => Promise<void>;
  onInstallFromZip: () => Promise<void>;
  onUninstall: () => Promise<void>;
  onRefresh: () => Promise<void>;
  platformBlocked: boolean;
}): JSX.Element {
  const {
    status,
    statusBusy,
    installBusy,
    installProgress,
    installSource,
    setInstallSource,
    installError
  } = props;

  if (props.platformBlocked) {
    return (
      <div className="mb-tools-empty-models">
        <p className="mb-tools-empty-models-title">当前平台不受支持</p>
        <p className="mb-tools-empty-models-hint">
          Real-ESRGAN ncnn 仅提供 Windows / macOS / Linux 三平台二进制。
        </p>
      </div>
    );
  }

  if (statusBusy && !status) {
    return <div className="mb-tools-placeholder" style={{ minHeight: 60 }}>读取引擎状态中…</div>;
  }

  if (!status || !status.installed) {
    const pct = installProgress
      ? Math.round((installProgress.received / Math.max(1, installProgress.total)) * 100)
      : 0;
    return (
      <div className="mb-tools-empty-models">
        <p className="mb-tools-empty-models-title">Real-ESRGAN ncnn Vulkan 引擎未安装</p>
        <p className="mb-tools-empty-models-hint">
          首次使用需下载 ~10MB 二进制（含 4 个默认模型）。不依赖 Python / PyTorch / CUDA，
          走 Vulkan 跨厂商 GPU 加速。安装后即可离线放大。
        </p>
        <div className="mb-tools-fields">
          <Field label="下载来源">
            <select
              className="mb-select"
              value={installSource}
              onChange={(e) => setInstallSource(e.target.value as UpscaleSource)}
              disabled={installBusy}
            >
              <option value="auto">自动（直链 → 多家国内镜像轮转）</option>
              <option value="github">仅 GitHub 直链</option>
              <option value="mirror">仅国内镜像（多家轮转）</option>
            </select>
          </Field>
        </div>
        {installBusy && installProgress && (
          <div className="mb-tools-download-progress">
            <div className="mb-tools-download-progress-bar" style={{ width: `${pct}%` }} />
            <span>
              {installProgress.component} · {(installProgress.received / 1024 / 1024).toFixed(1)} /
              {(installProgress.total / 1024 / 1024).toFixed(0)} MB
            </span>
          </div>
        )}
        {installError && (
          <details className="mb-tools-details" open>
            <summary style={{ color: 'rgb(239, 68, 68)' }}>
              下载失败 — 展开查看每个源的具体错误
            </summary>
            <pre
              style={{
                margin: '8px 0 0',
                fontSize: 11,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                color: 'var(--mb-text-muted)',
                fontFamily: 'Consolas, ui-monospace, monospace'
              }}
            >
              {installError}
            </pre>
          </details>
        )}
        <div className="mb-tools-action-row">
          <button
            className="mb-btn mb-btn-primary"
            onClick={() => void props.onInstall()}
            disabled={installBusy}
          >
            {installBusy ? '安装中…' : '在线安装引擎'}
          </button>
          <button
            className="mb-btn mb-btn-secondary"
            onClick={() => void props.onInstallFromZip()}
            disabled={installBusy}
            title="网络全断时的兜底：自己从 GitHub Release 页下到 zip 后导入"
          >
            <FolderIcon size={13} /> 导入本地 zip
          </button>
          <button className="mb-btn mb-btn-ghost mb-btn-sm" onClick={() => void props.onRefresh()}>
            重新检测
          </button>
        </div>
        <div className="mb-tools-field-hint" style={{ marginTop: 6 }}>
          网络全断也能用：浏览器开{' '}
          <a
            className="mb-tools-link"
            onClick={() =>
              void window.electronAPI.storage.openUrl(
                'https://github.com/xinntao/Real-ESRGAN-ncnn-vulkan/releases/tag/v0.2.0'
              )
            }
          >
            GitHub Release 页
          </a>{' '}
          下对应平台的 zip，再点「导入本地 zip」。
        </div>
      </div>
    );
  }

  // 引擎已装：折叠成一条 details，默认收起，只保留状态徽章 + ⋯ 按钮
  return (
    <details className="mb-tools-engine-installed-fold">
      <summary className="mb-tools-engine-installed-summary">
        <span className="mb-tools-status-dot is-ok" aria-hidden />
        <CheckIcon size={12} />
        <span>
          引擎就绪 · v{status.version} · {status.models.length} 模型
        </span>
        <span className="mb-tools-summary-spacer" />
        <span className="mb-tools-summary-toggle">详情</span>
      </summary>
      <div className="mb-tools-engine-installed-actions">
        <code className="mb-tools-engine-installed-path">{status.enginePath}</code>
        <div className="mb-tools-row-buttons">
          <button
            className="mb-btn mb-btn-ghost mb-btn-sm"
            onClick={() => void props.onRefresh()}
            title="重新扫描已装模型"
          >
            重扫
          </button>
          <button
            className="mb-btn mb-btn-ghost mb-btn-sm"
            onClick={() =>
              void window.electronAPI.storage.openPath({ targetPath: status.enginePath })
            }
          >
            <FolderIcon size={12} /> 引擎目录
          </button>
          <button
            className="mb-btn mb-btn-ghost mb-btn-sm"
            onClick={() => void props.onUninstall()}
          >
            <TrashIcon size={12} /> 卸载
          </button>
        </div>
      </div>
    </details>
  );
}

// ─── 子组件 ──────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="mb-tools-field">
      <label className="mb-tools-field-label">{label}</label>
      {children}
    </div>
  );
}

function basename(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i >= 0 ? p.slice(i + 1) : p;
}

function makeTempId(): string {
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}
