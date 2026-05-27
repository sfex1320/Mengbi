/**
 * Real-ESRGAN 面板(2026-05-28 全新设计):
 *   - 7 模式系统(智能推荐 / 通用高清 / 通用快速 / 动漫插画 / 动漫视频 / 清晰增强 / 自定义)
 *   - 普通设置 + 高级设置折叠区
 *   - ToolsPanelLayout 左右双卡布局,与 vec / hypir / supir 视觉统一
 *
 * 后端能力当前为 ncnn-vulkan v0.2.0(4 个内置模型 + 用户导入 .bin/.param)。
 * spec 里需要 PyTorch 后端的模式(清晰增强 / 通用快速 .pth / face_enhance / .pth 自定义)
 * 在 UI 上明确标"需 PyTorch 后端",运行时回退到能用的近似模型并 toast 提示。
 */
import { useEffect, useMemo, useState } from 'react';
import { ImportPanel } from '@/components/ImportPanel';
import { ResultActions, ResultActionsBar } from '@/components/ResultActions';
import { Collapsible } from '@/components/Collapsible';
import { useToolsStore } from '@/store/toolsStore';
import { useToolsEngineStore } from '@/store/toolsEngineStore';
import { toast } from '@/store/toastStore';
import { confirmDialog } from '@/components/ConfirmDialog';
import {
  XIcon,
  FolderIcon,
  TrashIcon,
  CheckIcon,
  ZapIcon,
  PlusIcon
} from '@/components/Icon';
import { localPathToImageUrl } from '@/lib/imageUrl';
import {
  MODES,
  getMode,
  resolveModelForMode,
  recommendModeFromImageType,
  DETAIL_LEVELS,
  DENOISE_LEVELS,
  FORMATS as MODE_FORMATS,
  type UpscaleModeId,
  type DetailLevel,
  type DenoiseLevel,
  type BackendCapabilities
} from '@/lib/upscaleModes';
import { getUpscaleModelMeta, groupModelsByCategory } from '@/lib/upscaleModelMeta';
import {
  ToolsPanelLayout,
  InputCardShell,
  OutputCardShell,
  PanelBanner,
  Field,
  Segmented
} from './shared/ToolsPanelLayout';
import type {
  UpscaleEngineStatus,
  UpscaleSource,
  UpscaleFormat,
  UpscaleProgressPayload,
  UpscaleInstallProgressPayload
} from '@shared/ipc';

type Mode = 'single' | 'batch';

const SCALES: Array<2 | 3 | 4> = [2, 3, 4];

export function RealESRGANPanel(): JSX.Element {
  // ─── 现有 store 状态(全部保留,不改) ──────────────────
  const inputDataUri = useToolsStore((s) => s.inputDataUri);
  const setInputDataUri = useToolsStore((s) => s.setInputDataUri);
  const batchInputs = useToolsStore((s) => s.batchInputs);
  const setBatchInputs = useToolsStore((s) => s.setBatchInputs);
  const lastUpscale = useToolsStore((s) => s.lastUpscale);
  const setLastUpscale = useToolsStore((s) => s.setLastUpscale);

  const status = useToolsEngineStore((s) => s.upscaleStatus);
  const statusBusy = useToolsEngineStore((s) => s.upscaleStatusLoading);
  const refreshUpscaleStatus = useToolsEngineStore((s) => s.refreshUpscaleStatus);

  // ─── 现有引擎安装 / 运行状态 ──────────────────────────
  const [installBusy, setInstallBusy] = useState(false);
  const [installSource, setInstallSource] = useState<UpscaleSource>('auto');
  const [installProgress, setInstallProgress] = useState<{
    component: string;
    received: number;
    total: number;
  } | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);

  const [inputMode, setInputMode] = useState<Mode>('single');
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

  // ─── 新 spec 字段 ──────────────────────────────────
  const [selectedMode, setSelectedMode] = useState<UpscaleModeId>('smart');
  const [detailLevel, setDetailLevel] = useState<DetailLevel>('standard');
  const [denoiseLevel, setDenoiseLevel] = useState<DenoiseLevel>('mid');
  const [faceEnhance, setFaceEnhance] = useState(false);
  const [keepAlpha, setKeepAlpha] = useState(true);
  const [keepOriginalName, setKeepOriginalName] = useState(true);
  const [customModel, setCustomModel] = useState<string | null>(null);

  // ─── 计算 ─────────────────────────────────────────
  const noEngine = !status || !status.installed;
  const platformBlocked = status?.platform === 'unsupported';

  /** 当前后端能力(目前只有 ncnn) */
  const caps: BackendCapabilities = useMemo(
    () => ({ ncnn: !!status?.installed, pytorch: false }),
    [status?.installed]
  );

  const availableModelsLower = useMemo(
    () => (status?.models ?? []).map((m) => m.name.toLowerCase()),
    [status?.models]
  );

  /** 根据选中的模式 + 后端能力 → 解析出真正用的 ncnn 模型名 */
  const resolvedTarget = useMemo(() => {
    if (selectedMode === 'smart') {
      const rec = recommendModeFromImageType({});
      const cfg = getMode(rec.modeId);
      const r = resolveModelForMode(cfg, caps, availableModelsLower, customModel);
      return r ? { ...r, reason: r.reason ?? rec.reason } : null;
    }
    return resolveModelForMode(
      getMode(selectedMode),
      caps,
      availableModelsLower,
      customModel
    );
  }, [selectedMode, caps, availableModelsLower, customModel]);

  /** 实际即将提交的 ncnn 模型名(没解析出 → 空,UI 用于禁用提交) */
  const effectiveModelName: string | null = resolvedTarget?.model ?? null;

  // ─── 现有 effects ─────────────────────────────────
  useEffect(() => {
    void refreshUpscaleStatus(false);
  }, [refreshUpscaleStatus]);

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

  // ─── 现有 handlers (全部保留,不改) ──────────────────
  async function refreshStatus(): Promise<void> {
    await refreshUpscaleStatus(true);
  }

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
      const msg = e instanceof Error ? e.message : String(e);
      setInstallError(`未预期错误:${msg}\n常见原因:preload 未热更新,完全停掉 dev 重启。`);
      toast.error('引擎安装失败', msg);
    } finally {
      setInstallBusy(false);
      setInstallProgress(null);
    }
  }

  async function installFromLocalZip(): Promise<void> {
    if (typeof window.electronAPI.upscale.installEngineFromZip !== 'function') {
      setInstallError('需重启 dev:preload 脚本不参与 HMR,新加的 IPC 方法只能在重启后生效。');
      toast.error('需重启 dev');
      return;
    }
    const pick = await window.electronAPI.storage.pickFile({
      title: '选择 Real-ESRGAN ncnn Vulkan release zip',
      filters: [{ name: 'ZIP 压缩包', extensions: ['zip'] }]
    });
    if (!pick.ok || !pick.data.filePath) return;
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
    } finally {
      setInstallBusy(false);
    }
  }

  async function uninstallEngine(): Promise<void> {
    const ok = await confirmDialog({
      title: '卸载放大引擎',
      message: '确定卸载 Real-ESRGAN ncnn Vulkan 引擎吗?',
      detail: '会删除引擎二进制 + 所有已装模型;HYPIR / 矢量化不受影响。',
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
      toast.error('需重启 dev', '本地模型导入是新增方法,preload 需重启才能生效');
      return;
    }
    const pick = await window.electronAPI.storage.pickFiles({
      title: '选择 .bin / .param 模型文件(可多选;同名成对才能用)',
      filters: [{ name: 'NCNN 模型', extensions: ['bin', 'param'] }]
    });
    if (!pick.ok || pick.data.filePaths.length === 0) return;

    // 友好提示:用户选了 .pth/.safetensors 等
    const nonNcnn = pick.data.filePaths.filter((p) => !/\.(bin|param)$/i.test(p));
    if (nonNcnn.length > 0) {
      toast.error(
        '不支持的格式',
        `${nonNcnn.length} 个文件不是 .bin/.param。.pth/.safetensors 等需要 PyTorch 后端,暂未启用。`
      );
      return;
    }

    const r = await window.electronAPI.upscale.importLocalModelFiles({
      filePaths: pick.data.filePaths
    });
    if (!r.ok) {
      toast.error('导入失败', r.error.message);
      return;
    }
    toast.success(`已导入 ${r.data.imported.length} 个文件`);
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

  function commonParams(modelToUse: string): {
    modelName: string;
    scale: 2 | 3 | 4;
    format: UpscaleFormat;
    tile: number;
    gpuId: 'auto' | number;
    tta: boolean;
  } {
    return { modelName: modelToUse, scale, format, tile, gpuId, tta };
  }

  async function runSingle(): Promise<void> {
    if (!inputDataUri) {
      toast.error('请先载入图片');
      return;
    }
    if (!effectiveModelName) {
      toast.error('当前模式无可用模型', '后端不支持理想模型;尝试切换为「通用高清」或「动漫插画」');
      return;
    }
    setRunning(true);
    setProgress(null);
    setBatchResults([]);
    const reqId = makeTempId();
    setCurrentTaskId(reqId);
    const r = await window.electronAPI.upscale.runSingle({
      inputDataUri,
      ...commonParams(effectiveModelName)
    });
    setRunning(false);
    setCurrentTaskId(null);
    if (!r.ok) {
      if (r.error.code !== 'CANCELLED') toast.error('放大失败', r.error.message);
      return;
    }
    setLastUpscale({
      outputDataUri: r.data.outputDataUri ?? '',
      outputPath: r.data.outputPath,
      inputW: r.data.inputW,
      inputH: r.data.inputH,
      outputW: r.data.outputW,
      outputH: r.data.outputH,
      engineLabel: 'Real-ESRGAN ncnn',
      modelName: effectiveModelName,
      scale,
      elapsedMs: r.data.elapsedMs,
      ts: Date.now()
    });
    const fb = resolvedTarget?.usedFallback ? ' · 已用近似模型代替' : '';
    toast.success(
      '放大完成',
      `${r.data.inputW}×${r.data.inputH} → ${r.data.outputW}×${r.data.outputH}(${(r.data.elapsedMs / 1000).toFixed(1)}s)${fb}`
    );
  }

  async function runBatch(): Promise<void> {
    if (batchInputs.length === 0) {
      toast.error('请先选择要批量放大的文件');
      return;
    }
    if (!effectiveModelName) {
      toast.error('当前模式无可用模型');
      return;
    }
    setRunning(true);
    setProgress(null);
    setBatchResults([]);
    const reqId = makeTempId();
    setCurrentTaskId(reqId);
    const r = await window.electronAPI.upscale.runBatch({
      inputPaths: batchInputs,
      ...commonParams(effectiveModelName)
    });
    setRunning(false);
    setCurrentTaskId(null);
    if (!r.ok) {
      if (r.error.code !== 'CANCELLED') toast.error('批量放大失败', r.error.message);
      return;
    }
    setBatchResults(r.data.results);
    toast.success('批量完成', `${r.data.results.length} 张已输出`);
  }

  async function cancel(): Promise<void> {
    const r = await window.electronAPI.upscale.cancel({});
    if (r.ok) toast.info('已请求取消');
  }

  // ─── 渲染 ─────────────────────────────────────────
  const header = (
    <RealEsrganHeader
      status={status}
      onRefresh={refreshStatus}
      onUninstall={uninstallEngine}
      noEngine={noEngine}
    />
  );

  if (platformBlocked) {
    return (
      <ToolsPanelLayout
        header={header}
        left={
          <PanelBanner tone="error">
            当前平台不受支持 — Real-ESRGAN ncnn 仅提供 Windows / macOS / Linux 三平台二进制。
          </PanelBanner>
        }
        right={<OutputCardShell state="empty"><div className="mb-tlx-empty">不可用</div></OutputCardShell>}
      />
    );
  }

  return (
    <ToolsPanelLayout
      header={header}
      left={
        <InputCardShell>
          {/* 引擎未装:大块引导 */}
          {noEngine && (
            <EngineInstaller
              installBusy={installBusy}
              installSource={installSource}
              setInstallSource={setInstallSource}
              installProgress={installProgress}
              installError={installError}
              onInstall={installEngine}
              onInstallFromZip={installFromLocalZip}
              onRefresh={refreshStatus}
              statusBusy={statusBusy}
            />
          )}

          {/* 引擎已装:正常使用 */}
          {!noEngine && (
            <>
              {/* 1. 单图 / 批量 切换 */}
              <Segmented
                value={inputMode}
                onChange={setInputMode}
                options={[
                  { value: 'single', label: '单图', hint: '一张图,直接预览' },
                  { value: 'batch', label: '批量', hint: '一组图,直接落输出目录' }
                ]}
              />

              {/* 2. 输入 */}
              {inputMode === 'single' ? (
                <ImportPanel value={inputDataUri} onChange={setInputDataUri} maxDim={4096} />
              ) : (
                <BatchInputBlock
                  batchInputs={batchInputs}
                  onPick={() => void pickBatch()}
                  onClear={() => setBatchInputs([])}
                  disabled={running}
                />
              )}

              {/* 3. 模式选择(7 模式 grid) */}
              <ModeSelectorGrid
                selected={selectedMode}
                onChange={setSelectedMode}
                caps={caps}
              />

              {/* 4. 模式详情卡 */}
              <ModeDetailCard
                modeId={selectedMode}
                resolved={resolvedTarget}
                customModel={customModel}
                onPickCustom={setCustomModel}
                availableModels={status?.models ?? []}
                onImportCustom={importLocalModels}
              />

              {/* 5. 普通设置 */}
              <PrimarySettings
                scale={scale}
                setScale={setScale}
                detailLevel={detailLevel}
                setDetailLevel={setDetailLevel}
                denoiseLevel={denoiseLevel}
                setDenoiseLevel={setDenoiseLevel}
                format={format}
                setFormat={setFormat}
                disabled={running}
              />

              {/* 6. 高级设置(默认折叠) */}
              <Collapsible
                title="高级设置"
                badge={`${tile === 0 ? 'tile 自动' : `tile ${tile}`} · ${tta ? 'TTA' : '无 TTA'}`}
              >
                <AdvancedSettings
                  tile={tile}
                  setTile={setTile}
                  gpuId={gpuId}
                  setGpuId={setGpuId}
                  tta={tta}
                  setTta={setTta}
                  faceEnhance={faceEnhance}
                  setFaceEnhance={setFaceEnhance}
                  keepAlpha={keepAlpha}
                  setKeepAlpha={setKeepAlpha}
                  keepOriginalName={keepOriginalName}
                  setKeepOriginalName={setKeepOriginalName}
                  caps={caps}
                  disabled={running}
                />
              </Collapsible>

              {/* 7. 提交 */}
              <SubmitBar
                running={running}
                disabled={!effectiveModelName || statusBusy}
                onSubmit={() => (inputMode === 'single' ? void runSingle() : void runBatch())}
                onCancel={() => void cancel()}
                hint={
                  resolvedTarget?.usedFallback
                    ? `⚠ 当前后端不支持理想模型,运行时将用「${resolvedTarget.model}」近似代替`
                    : effectiveModelName
                      ? `将用模型「${effectiveModelName}」处理`
                      : '当前模式无可用模型,请切换或扩展模型'
                }
              />
            </>
          )}
        </InputCardShell>
      }
      right={
        <OutputCardShell state={running ? 'progress' : lastUpscale || batchResults.length > 0 ? 'result' : 'empty'}>
          {running ? (
            <ProgressPane progress={progress} onCancel={cancel} />
          ) : inputMode === 'single' && lastUpscale ? (
            <SingleResultPane lastUpscale={lastUpscale} />
          ) : inputMode === 'batch' && batchResults.length > 0 ? (
            <BatchResultPane results={batchResults} />
          ) : (
            <EmptyPane noEngine={noEngine} />
          )}
        </OutputCardShell>
      }
    />
  );
}

// ──────────────────────────────────────────────────────────────────
// Header
// ──────────────────────────────────────────────────────────────────

function RealEsrganHeader({
  status,
  onRefresh,
  onUninstall,
  noEngine
}: {
  status: UpscaleEngineStatus | null;
  onRefresh: () => Promise<void>;
  onUninstall: () => Promise<void>;
  noEngine: boolean;
}): JSX.Element {
  return (
    <>
      <div className="mb-tlx-header-title">
        <ZapIcon size={16} />
        <span>保真放大</span>
        <span className="mb-tlx-header-subtitle">
          Real-ESRGAN ncnn Vulkan · 本地处理,零数据上传
        </span>
      </div>
      <div className="mb-tlx-header-actions">
        {!noEngine && status && (
          <span className="mb-tlx-chip is-ok" title={status.enginePath}>
            <CheckIcon size={11} /> 引擎就绪 · v{status.version} · {status.models.length} 模型
          </span>
        )}
        {noEngine && (
          <span className="mb-tlx-chip is-warn">引擎未安装</span>
        )}
        <button
          type="button"
          className="mb-btn mb-btn-ghost mb-btn-sm"
          onClick={() => void onRefresh()}
          title="重新扫描模型目录"
        >
          刷新
        </button>
        {!noEngine && (
          <button
            type="button"
            className="mb-btn mb-btn-ghost mb-btn-sm"
            onClick={() => void onUninstall()}
            title="卸载引擎(矢量化 / HYPIR 不受影响)"
          >
            <TrashIcon size={12} /> 卸载
          </button>
        )}
      </div>
    </>
  );
}

// ──────────────────────────────────────────────────────────────────
// Mode selector grid (7 个友好模式)
// ──────────────────────────────────────────────────────────────────

function ModeSelectorGrid({
  selected,
  onChange,
  caps
}: {
  selected: UpscaleModeId;
  onChange: (m: UpscaleModeId) => void;
  caps: BackendCapabilities;
}): JSX.Element {
  return (
    <div>
      <div className="mb-tlx-section-title">模式</div>
      <div className="mb-tlx-mode-grid">
        {MODES.map((m) => {
          const active = m.id === selected;
          const needsPytorch = m.requires.pytorch && !caps.pytorch;
          return (
            <button
              key={m.id}
              type="button"
              className={`mb-tlx-mode-card is-cat-${m.category} ${active ? 'is-active' : ''}`}
              onClick={() => onChange(m.id)}
              title={m.description}
            >
              <span className="mb-tlx-mode-name">{m.label}</span>
              <span className="mb-tlx-mode-tagline">{m.tagline}</span>
              {needsPytorch && <span className="mb-tlx-mode-flag">需 PyTorch</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Mode detail card (描述 + 真实模型名 + warning + custom 选择)
// ──────────────────────────────────────────────────────────────────

function ModeDetailCard({
  modeId,
  resolved,
  customModel,
  onPickCustom,
  availableModels,
  onImportCustom
}: {
  modeId: UpscaleModeId;
  resolved: { model: string; usedFallback: boolean; reason?: string } | null;
  customModel: string | null;
  onPickCustom: (m: string) => void;
  availableModels: Array<{ name: string; sizeBytes: number }>;
  onImportCustom: () => Promise<void>;
}): JSX.Element {
  const mode = getMode(modeId);
  return (
    <div className="mb-tlx-mode-detail">
      <div className="mb-tlx-mode-detail-desc">{mode.description}</div>

      {mode.warning && <PanelBanner tone="warn">{mode.warning}</PanelBanner>}

      {/* 自定义模式:选择本地已导入的 .bin */}
      {modeId === 'custom' && (
        <div className="mb-tlx-mode-detail-custom">
          <Field label="选择模型">
            <select
              className="mb-tlx-select"
              value={customModel ?? ''}
              onChange={(e) => onPickCustom(e.target.value)}
            >
              <option value="">(未选择)</option>
              {groupModelsByCategory(availableModels).map((g) => (
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
          </Field>
          <div className="mb-tlx-row-buttons">
            <button
              type="button"
              className="mb-btn mb-btn-ghost mb-btn-sm"
              onClick={() => void onImportCustom()}
            >
              <PlusIcon size={12} /> 导入新模型
            </button>
            <span className="mb-tlx-field-hint" style={{ flex: 1 }}>
              支持 .bin + .param 同名成对。.pth/.safetensors 暂不支持(需 PyTorch 后端)
            </span>
          </div>
        </div>
      )}

      {/* 模式 ↔ 真实模型 映射 */}
      {modeId !== 'custom' && (
        <div className="mb-tlx-mode-detail-mapping">
          <span className="mb-tlx-key">理想模型</span>
          <code className="mb-tlx-val">{mode.idealModel}</code>
          {resolved && (
            <>
              <span className="mb-tlx-key">实际使用</span>
              <code className={`mb-tlx-val ${resolved.usedFallback ? 'is-warn' : 'is-ok'}`}>
                {resolved.model}
              </code>
            </>
          )}
          {!resolved && (
            <span className="mb-tlx-mode-detail-unavailable">
              ⚠ 当前后端无法运行此模式
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// 普通设置:倍率 / 细节 / 降噪 / 输出格式
// ──────────────────────────────────────────────────────────────────

function PrimarySettings({
  scale,
  setScale,
  detailLevel,
  setDetailLevel,
  denoiseLevel,
  setDenoiseLevel,
  format,
  setFormat,
  disabled
}: {
  scale: 2 | 3 | 4;
  setScale: (s: 2 | 3 | 4) => void;
  detailLevel: DetailLevel;
  setDetailLevel: (l: DetailLevel) => void;
  denoiseLevel: DenoiseLevel;
  setDenoiseLevel: (l: DenoiseLevel) => void;
  format: UpscaleFormat;
  setFormat: (f: UpscaleFormat) => void;
  disabled: boolean;
}): JSX.Element {
  return (
    <div className="mb-tlx-primary-settings">
      <div className="mb-tlx-section-title">参数</div>
      <Field label="放大倍率">
        <Segmented
          value={String(scale) as '2' | '3' | '4'}
          onChange={(v) => setScale(Number(v) as 2 | 3 | 4)}
          options={SCALES.map((s) => ({ value: String(s) as '2' | '3' | '4', label: `${s}×` }))}
        />
      </Field>

      <Field label="细节强度">
        <Segmented
          value={detailLevel}
          onChange={setDetailLevel}
          options={DETAIL_LEVELS}
        />
      </Field>

      <Field label="降噪强度">
        <Segmented value={denoiseLevel} onChange={setDenoiseLevel} options={DENOISE_LEVELS} />
        <span className="mb-tlx-field-hint">
          降噪强度需 PyTorch 后端 + general-x4v3 模型才真生效;当前后端会忽略该值
        </span>
      </Field>

      <Field label="输出格式">
        <Segmented value={format as 'png' | 'jpg' | 'webp'} onChange={setFormat as (v: 'png' | 'jpg' | 'webp') => void} options={MODE_FORMATS} />
      </Field>

      {disabled && <span className="mb-tlx-field-hint">(处理中,参数已锁定)</span>}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// 高级设置
// ──────────────────────────────────────────────────────────────────

function AdvancedSettings({
  tile,
  setTile,
  gpuId,
  setGpuId,
  tta,
  setTta,
  faceEnhance,
  setFaceEnhance,
  keepAlpha,
  setKeepAlpha,
  keepOriginalName,
  setKeepOriginalName,
  caps,
  disabled
}: {
  tile: number;
  setTile: (n: number) => void;
  gpuId: 'auto' | number;
  setGpuId: (g: 'auto' | number) => void;
  tta: boolean;
  setTta: (b: boolean) => void;
  faceEnhance: boolean;
  setFaceEnhance: (b: boolean) => void;
  keepAlpha: boolean;
  setKeepAlpha: (b: boolean) => void;
  keepOriginalName: boolean;
  setKeepOriginalName: (b: boolean) => void;
  caps: BackendCapabilities;
  disabled: boolean;
}): JSX.Element {
  return (
    <div className="mb-tlx-advanced">
      <Field label="Tile 分块" hint="0 = 自动。爆显存就降到 128 / 256">
        <input
          type="number"
          className="mb-tlx-input"
          min={0}
          max={4096}
          step={32}
          value={tile}
          onChange={(e) => setTile(Math.max(0, Math.min(4096, Number(e.target.value) || 0)))}
          disabled={disabled}
        />
      </Field>

      <Field label="GPU">
        <select
          className="mb-tlx-select"
          value={gpuId === 'auto' ? 'auto' : String(gpuId)}
          onChange={(e) =>
            setGpuId(e.target.value === 'auto' ? 'auto' : Number(e.target.value))
          }
          disabled={disabled}
        >
          <option value="auto">自动</option>
          {[0, 1, 2, 3].map((g) => (
            <option key={g} value={g}>GPU #{g}</option>
          ))}
        </select>
      </Field>

      <CheckRow
        checked={tta}
        onChange={setTta}
        disabled={disabled}
        label="TTA 测试时增强"
        hint="8 倍耗时,细节略好;默认关"
      />

      <CheckRow
        checked={faceEnhance}
        onChange={setFaceEnhance}
        disabled={disabled || !caps.pytorch}
        label="Face Enhance 人脸增强"
        hint={caps.pytorch ? '走 GFPGAN 修复人脸' : '⚠ 需 PyTorch 后端;当前不可用'}
      />

      <CheckRow
        checked={keepAlpha}
        onChange={setKeepAlpha}
        disabled={disabled}
        label="保留 Alpha 通道"
        hint="PNG / WebP 透明背景保留(JPG 不支持)"
      />

      <CheckRow
        checked={keepOriginalName}
        onChange={setKeepOriginalName}
        disabled={disabled}
        label="保留原始文件名"
        hint="批量时勾选 = output 用原文件名(加后缀如 _x4)"
      />
    </div>
  );
}

function CheckRow({
  checked,
  onChange,
  disabled,
  label,
  hint
}: {
  checked: boolean;
  onChange: (b: boolean) => void;
  disabled?: boolean;
  label: string;
  hint?: string;
}): JSX.Element {
  return (
    <label className={`mb-tlx-check-row ${disabled ? 'is-disabled' : ''}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
      />
      <span>
        {label}
        {hint && <span className="mb-tlx-field-hint" style={{ marginLeft: 6 }}>{hint}</span>}
      </span>
    </label>
  );
}

// ──────────────────────────────────────────────────────────────────
// 提交栏
// ──────────────────────────────────────────────────────────────────

function SubmitBar({
  running,
  disabled,
  onSubmit,
  onCancel,
  hint
}: {
  running: boolean;
  disabled: boolean;
  onSubmit: () => void;
  onCancel: () => void;
  hint: string;
}): JSX.Element {
  return (
    <div className="mb-tlx-submit-bar">
      <button
        type="button"
        className="mb-btn mb-btn-primary mb-tlx-submit-btn"
        onClick={onSubmit}
        disabled={running || disabled}
      >
        <ZapIcon size={14} /> {running ? '放大中…' : '开始放大'}
      </button>
      {running && (
        <button
          type="button"
          className="mb-btn mb-btn-ghost"
          onClick={onCancel}
        >
          <XIcon size={12} /> 取消
        </button>
      )}
      <span className="mb-tlx-submit-hint">{hint}</span>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// 输入子组件 — 批量
// ──────────────────────────────────────────────────────────────────

function BatchInputBlock({
  batchInputs,
  onPick,
  onClear,
  disabled
}: {
  batchInputs: string[];
  onPick: () => void;
  onClear: () => void;
  disabled: boolean;
}): JSX.Element {
  return (
    <div className="mb-tlx-batch-block">
      <div className="mb-tlx-row-buttons">
        <button
          type="button"
          className="mb-btn mb-btn-ghost mb-btn-sm"
          onClick={onPick}
          disabled={disabled}
        >
          <FolderIcon size={12} /> 选择多张图
        </button>
        {batchInputs.length > 0 && (
          <button
            type="button"
            className="mb-btn mb-btn-ghost mb-btn-sm"
            onClick={onClear}
            disabled={disabled}
          >
            <XIcon size={11} /> 清空 ({batchInputs.length})
          </button>
        )}
      </div>
      {batchInputs.length === 0 ? (
        <div className="mb-tlx-placeholder">尚未选图 — 点上方按钮多选 PNG / JPG / WebP</div>
      ) : (
        <ul className="mb-tlx-batch-files">
          {batchInputs.slice(0, 8).map((p) => (
            <li key={p} title={p}>{basename(p)}</li>
          ))}
          {batchInputs.length > 8 && (
            <li className="mb-tlx-batch-more">… 还有 {batchInputs.length - 8} 张</li>
          )}
        </ul>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// 输出区子组件
// ──────────────────────────────────────────────────────────────────

function EmptyPane({ noEngine }: { noEngine: boolean }): JSX.Element {
  return (
    <div className="mb-tlx-empty">
      <div className="mb-tlx-empty-title">{noEngine ? '请先安装引擎' : '尚无任务'}</div>
      <div className="mb-tlx-empty-sub">
        {noEngine
          ? '左侧选下载源后点「在线安装引擎」(~10 MB)'
          : '左侧载入图片 / 选模式 / 点「开始放大」'}
      </div>
    </div>
  );
}

function ProgressPane({
  progress,
  onCancel
}: {
  progress: UpscaleProgressPayload | null;
  onCancel: () => Promise<void>;
}): JSX.Element {
  const pct = progress?.percent ?? 0;
  return (
    <div className="mb-tlx-progress">
      <div className="mb-tlx-progress-title">放大中…</div>
      <div className="mb-tlx-progress-bar">
        <div className="mb-tlx-progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="mb-tlx-progress-pct">{pct}%</div>
      {progress?.phase && <div className="mb-tlx-progress-detail">{progress.phase}</div>}
      {progress?.itemCount && progress.itemCount > 1 && (
        <div className="mb-tlx-progress-detail">
          第 {progress.itemIndex + 1} / {progress.itemCount} 张
        </div>
      )}
      <button
        type="button"
        className="mb-btn mb-btn-ghost mb-btn-sm"
        onClick={() => void onCancel()}
        style={{ marginTop: 8 }}
      >
        <XIcon size={12} /> 取消
      </button>
    </div>
  );
}

interface LastUpscaleData {
  outputDataUri: string;
  outputPath: string;
  inputW: number;
  inputH: number;
  outputW: number;
  outputH: number;
  engineLabel: string;
  modelName: string;
  scale: number;
  elapsedMs: number;
  ts: number;
}

function SingleResultPane({
  lastUpscale
}: {
  lastUpscale: LastUpscaleData;
}): JSX.Element {
  const imgUrl = localPathToImageUrl(lastUpscale.outputPath);
  return (
    <div className="mb-tlx-result-single">
      <ResultActionsBar
        dataUri={imgUrl}
        kind="upscale"
        defaultName={`upscale-${lastUpscale.outputW}x${lastUpscale.outputH}-${lastUpscale.ts}`}
        sourceModel={`${lastUpscale.engineLabel}/${lastUpscale.modelName}`}
        params={{ scale: lastUpscale.scale, model: lastUpscale.modelName }}
      />
      <ResultActions
        dataUri={imgUrl}
        kind="upscale"
        defaultName={`upscale-${lastUpscale.outputW}x${lastUpscale.outputH}-${lastUpscale.ts}`}
        sourceModel={`${lastUpscale.engineLabel}/${lastUpscale.modelName}`}
        params={{ scale: lastUpscale.scale, model: lastUpscale.modelName }}
      >
        <img src={imgUrl} className="mb-tlx-result-img" alt="放大结果" />
      </ResultActions>
      <div className="mb-tlx-result-meta">
        <span><em>原尺寸</em> {lastUpscale.inputW}×{lastUpscale.inputH}</span>
        <span><em>输出</em> {lastUpscale.outputW}×{lastUpscale.outputH}</span>
        <span><em>模型</em> {lastUpscale.modelName}</span>
        <span><em>倍率</em> {lastUpscale.scale}×</span>
        <span><em>耗时</em> {(lastUpscale.elapsedMs / 1000).toFixed(1)}s</span>
        <button
          type="button"
          className="mb-btn mb-btn-ghost mb-btn-sm"
          onClick={() =>
            void window.electronAPI.storage.showInFolder(lastUpscale.outputPath)
          }
        >
          <FolderIcon size={11} /> 文件夹
        </button>
      </div>
    </div>
  );
}

function BatchResultPane({
  results
}: {
  results: Array<{
    inputPath: string;
    outputPath: string;
    outputW: number;
    outputH: number;
    elapsedMs: number;
  }>;
}): JSX.Element {
  return (
    <div className="mb-tlx-result-batch">
      <div className="mb-tlx-result-batch-title">批量完成 — {results.length} 张</div>
      <ul className="mb-tlx-result-batch-list">
        {results.map((r) => (
          <li key={r.outputPath}>
            <code>{basename(r.inputPath)}</code> → {r.outputW}×{r.outputH} · {(r.elapsedMs / 1000).toFixed(1)}s
            <button
              type="button"
              className="mb-btn mb-btn-ghost mb-btn-xs"
              onClick={() => void window.electronAPI.storage.showInFolder(r.outputPath)}
            >
              <FolderIcon size={10} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// 引擎安装引导(独立大块)
// ──────────────────────────────────────────────────────────────────

function EngineInstaller({
  installBusy,
  installSource,
  setInstallSource,
  installProgress,
  installError,
  onInstall,
  onInstallFromZip,
  onRefresh,
  statusBusy
}: {
  installBusy: boolean;
  installSource: UpscaleSource;
  setInstallSource: (s: UpscaleSource) => void;
  installProgress: { component: string; received: number; total: number } | null;
  installError: string | null;
  onInstall: () => Promise<void>;
  onInstallFromZip: () => Promise<void>;
  onRefresh: () => Promise<void>;
  statusBusy: boolean;
}): JSX.Element {
  const pct = installProgress
    ? Math.round((installProgress.received / Math.max(1, installProgress.total)) * 100)
    : 0;
  return (
    <div className="mb-tlx-installer">
      <div className="mb-tlx-installer-title">Real-ESRGAN ncnn Vulkan 引擎未安装</div>
      <p className="mb-tlx-installer-sub">
        首次使用需下载 ~10 MB 二进制(含 4 个默认模型)。不依赖 Python / PyTorch / CUDA,
        走 Vulkan 跨厂商 GPU 加速。安装后即可离线放大。
      </p>
      <Field label="下载来源">
        <select
          className="mb-tlx-select"
          value={installSource}
          onChange={(e) => setInstallSource(e.target.value as UpscaleSource)}
          disabled={installBusy}
        >
          <option value="auto">自动(直链 → 国内镜像轮转)</option>
          <option value="github">仅 GitHub 直链</option>
          <option value="mirror">仅国内镜像</option>
        </select>
      </Field>
      {installBusy && installProgress && (
        <div className="mb-tlx-installer-progress">
          <div className="mb-tlx-installer-progress-bar" style={{ width: `${pct}%` }} />
          <span>
            {installProgress.component} · {(installProgress.received / 1024 / 1024).toFixed(1)} /
            {(installProgress.total / 1024 / 1024).toFixed(0)} MB
          </span>
        </div>
      )}
      {installError && (
        <details className="mb-tlx-installer-error" open>
          <summary>下载失败 — 展开看详细</summary>
          <pre>{installError}</pre>
        </details>
      )}
      <div className="mb-tlx-row-buttons">
        <button
          type="button"
          className="mb-btn mb-btn-primary"
          onClick={() => void onInstall()}
          disabled={installBusy}
        >
          {installBusy ? '安装中…' : '在线安装引擎'}
        </button>
        <button
          type="button"
          className="mb-btn mb-btn-secondary"
          onClick={() => void onInstallFromZip()}
          disabled={installBusy}
        >
          <FolderIcon size={12} /> 导入本地 zip
        </button>
        <button
          type="button"
          className="mb-btn mb-btn-ghost mb-btn-sm"
          onClick={() => void onRefresh()}
          disabled={statusBusy}
        >
          重新检测
        </button>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// 工具
// ──────────────────────────────────────────────────────────────────

function basename(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i >= 0 ? p.slice(i + 1) : p;
}

function makeTempId(): string {
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
