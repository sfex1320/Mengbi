/**
 * Real-ESRGAN 面板(2026-05-28 第二轮重设计):
 *
 * 布局:
 *   - 左:纯设置(模式 / 模式详情 / 普通参数 / 高级折叠 / 提交)
 *   - 右:输入区(添加图) + 任务列表(像 vec) + 选中任务的对比预览
 *
 * 输入模型统一:不分单/批,用户拖入 N 张就处理 N 张
 *   - N=1 走 run-single(有 token 级进度)
 *   - N>=2 走 run-batch(整批跑完一次返回)
 *
 * 结果支持:
 *   - 任务列表点击查看
 *   - ImageCompareViewer:原图 / 结果 对比 + 缩放 + 拖动
 *   - 右键菜单 复制 / 另存为 / 入库
 */
import { useEffect, useMemo, useState, useCallback } from 'react';
import { ImportPanel } from '@/components/ImportPanel';
import { ResultActions, ResultActionsBar } from '@/components/ResultActions';
import { Collapsible } from '@/components/Collapsible';
import { CustomSelect } from '@/components/CustomSelect';
import { useToolsEngineStore } from '@/store/toolsEngineStore';
import { toast } from '@/store/toastStore';
import { confirmDialog } from '@/components/ConfirmDialog';
import {
  XIcon,
  FolderIcon,
  TrashIcon,
  CheckIcon,
  ZapIcon,
  PlusIcon,
  UploadIcon
} from '@/components/Icon';
import { localPathToImageUrl } from '@/lib/imageUrl';
import {
  MODES,
  getMode,
  resolveModelForMode,
  recommendModeFromImageType,
  candidatesForMode,
  DETAIL_LEVELS,
  DENOISE_LEVELS,
  FORMATS as MODE_FORMATS,
  COMMUNITY_REFERENCE,
  type UpscaleModeId,
  type DetailLevel,
  type DenoiseLevel,
  type BackendCapabilities,
  type UpscaleBackend,
  type ModelCandidate
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
  UpscaleInstallProgressPayload,
  OnnxModelView,
  OnnxCustomEntry
} from '@shared/ipc';

interface UpscaleTask {
  id: string;
  /** 输入图 file 路径(没有就用 dataUri 落临时盘后取回的路径) */
  inputPath: string;
  /** 用于预览展示 */
  inputDisplayUrl: string;
  outputPath: string | null;
  inputW: number;
  inputH: number;
  outputW: number;
  outputH: number;
  modelName: string;
  modeId: UpscaleModeId;
  scale: 2 | 3 | 4;
  elapsedMs: number;
  status: 'running' | 'done' | 'failed';
  progress?: number;
  errorMessage?: string;
  ts: number;
}

const SCALES: Array<2 | 3 | 4> = [2, 3, 4];

export function RealESRGANPanel(): JSX.Element {
  // ─── 引擎状态(共享 store) ────────────────────────
  const status = useToolsEngineStore((s) => s.upscaleStatus);
  const statusBusy = useToolsEngineStore((s) => s.upscaleStatusLoading);
  const refreshUpscaleStatus = useToolsEngineStore((s) => s.refreshUpscaleStatus);

  // ─── 安装 / 引擎管理 ──────────────────────────────
  const [installBusy, setInstallBusy] = useState(false);
  const [installSource, setInstallSource] = useState<UpscaleSource>('auto');
  const [installProgress, setInstallProgress] = useState<{
    component: string;
    received: number;
    total: number;
  } | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);

  // ─── 输入(统一,不分单/批) ───────────────────────
  /** 待处理输入路径(全是绝对文件路径,粘贴的 dataUri 会被先 saveTempImage 转盘) */
  const [pendingInputs, setPendingInputs] = useState<string[]>([]);
  /** 单图粘贴/拖入临时 dataUri(还未存盘);粘贴后会一并 saveTempImage 进 pendingInputs */
  const [pasteUri, setPasteUri] = useState<string | null>(null);

  // ─── 任务列表 ─────────────────────────────────────
  const [tasks, setTasks] = useState<UpscaleTask[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  // O(1) 选中查找 + 避免每次 render 都跑 .find
  const selectedTask = useMemo(
    () => tasks.find((t) => t.id === selectedTaskId) ?? null,
    [tasks, selectedTaskId]
  );

  const TASKS_CAP = 50;

  // ─── 设置 ─────────────────────────────────────────
  const [selectedMode, setSelectedMode] = useState<UpscaleModeId>('smart');
  const [scale, setScale] = useState<2 | 3 | 4>(4);
  const [format, setFormat] = useState<UpscaleFormat>('png');
  const [detailLevel, setDetailLevel] = useState<DetailLevel>('standard');
  const [denoiseLevel, setDenoiseLevel] = useState<DenoiseLevel>('mid');
  const [tile, setTile] = useState<number>(0);
  const [gpuId, setGpuId] = useState<'auto' | number>('auto');
  const [tta, setTta] = useState<boolean>(false);
  const [keepAlpha, setKeepAlpha] = useState(true);
  const [keepOriginalName, setKeepOriginalName] = useState(true);
  const [customModel, setCustomModel] = useState<string | null>(null);
  /**
   * 各模式下用户手动选的候选模型(null = 走 resolver 默认最优)。
   * 切换模式不丢:用户在 anime-illust 选了 4xHFA2k.onnx,
   * 切去 general-hd 再回来仍然是 4xHFA2k.onnx。
   */
  const [modelOverride, setModelOverride] = useState<Partial<Record<UpscaleModeId, { key: string; backend: UpscaleBackend }>>>({});

  // ─── 运行态 ───────────────────────────────────────
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<UpscaleProgressPayload | null>(null);

  // ─── ONNX 模型清单(主进程内 onnxruntime-node,无需启停) ──────────
  // 既追"内置已装的 id 列表"供 resolveModelForMode 用,
  // 也要拿到 custom + modeHint 供候选下拉用。
  const [onnxModels, setOnnxModels] = useState<OnnxModelView[]>([]);
  const [onnxCustom, setOnnxCustom] = useState<OnnxCustomEntry[]>([]);

  const refreshOnnxModels = useCallback(async () => {
    try {
      const r = await window.electronAPI.upscale.onnxList();
      if (r.ok) {
        setOnnxModels(r.data.builtins);
        setOnnxCustom(r.data.custom);
      }
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    void refreshOnnxModels();
  }, [refreshOnnxModels]);

  const installedOnnxIds = useMemo(
    () => onnxModels.filter((m) => m.installed).map((m) => m.id),
    [onnxModels]
  );

  // ─── 计算 ─────────────────────────────────────────
  const noEngine = !status || !status.installed;
  const platformBlocked = status?.platform === 'unsupported';

  // ONNX 后端默认始终可用(onnxruntime-node 是主进程内置,无需启动);
  // ncnn 看引擎是否已装。
  const caps: BackendCapabilities = useMemo(
    () => ({ ncnn: !!status?.installed, onnx: true }),
    [status?.installed]
  );

  const availableModelsLower = useMemo(
    () => (status?.models ?? []).map((m) => m.name.toLowerCase()),
    [status?.models]
  );

  const resolvedTarget = useMemo(() => {
    if (selectedMode === 'smart') {
      const rec = recommendModeFromImageType({});
      const cfg = getMode(rec.modeId);
      const r = resolveModelForMode(cfg, caps, availableModelsLower, installedOnnxIds, customModel);
      return r ? { ...r, reason: r.reason ?? rec.reason } : null;
    }
    return resolveModelForMode(
      getMode(selectedMode),
      caps,
      availableModelsLower,
      installedOnnxIds,
      customModel
    );
  }, [selectedMode, caps, availableModelsLower, installedOnnxIds, customModel]);

  // 列出当前模式下所有可选候选模型(用户在 ModeDetailCard 里能切)
  const currentCandidates = useMemo<ModelCandidate[]>(() => {
    if (selectedMode === 'smart' || selectedMode === 'custom') return [];
    return candidatesForMode(
      selectedMode,
      caps,
      status?.models ?? [],
      onnxModels,
      onnxCustom
    );
  }, [selectedMode, caps, status?.models, onnxModels, onnxCustom]);

  // 当前模式的手动覆盖(若有);切换模式时各自保留
  const currentOverride = modelOverride[selectedMode];

  // 最终用哪个模型 + 哪个后端:覆盖优先,否则 resolver 默认
  const effectiveModelName: string | null = currentOverride
    ? currentOverride.key
    : resolvedTarget?.model ?? null;
  const effectiveBackend: UpscaleBackend = currentOverride
    ? currentOverride.backend
    : resolvedTarget?.backend ?? 'ncnn';

  // 设置 / 清空 模式手动覆盖
  function setOverrideForCurrent(c: ModelCandidate | null): void {
    setModelOverride((prev) => {
      const next = { ...prev };
      if (c == null) delete next[selectedMode];
      else next[selectedMode] = { key: c.key, backend: c.backend };
      return next;
    });
  }

  const totalInputs = pendingInputs.length + (pasteUri ? 1 : 0);

  // ─── ONNX session 预热(debounced) ─────────────────────────
  // 选定 ONNX 模型 + 有输入图时,500ms 后台预热,首张推理少等 5-15s。
  // 模型变化即重启计时;无 ONNX 路径不触发。
  const [prewarmingModel, setPrewarmingModel] = useState<string | null>(null);
  useEffect(() => {
    if (effectiveBackend !== 'onnx' || !effectiveModelName || totalInputs === 0) {
      setPrewarmingModel(null);
      return;
    }
    const modelId = effectiveModelName;
    const t = setTimeout(async () => {
      setPrewarmingModel(modelId);
      try {
        await window.electronAPI.upscale.onnxPrewarm({ modelId });
      } catch {
        /* ignore */
      } finally {
        setPrewarmingModel((prev) => (prev === modelId ? null : prev));
      }
    }, 500);
    return () => clearTimeout(t);
  }, [effectiveBackend, effectiveModelName, totalInputs]);

  // ─── effects ──────────────────────────────────────
  useEffect(() => {
    void refreshUpscaleStatus(false);
  }, [refreshUpscaleStatus]);

  useEffect(() => {
    if (!window.electronAPI?.on) return;
    const offProg = window.electronAPI.on('upscale:progress', (raw) => {
      const p = raw as UpscaleProgressPayload;
      // 仅在本面板运行期间反映进度；放大引擎串行执行，单批进度即当前任务进度
      if (!running) return;
      setProgress(p);
      // 同步更新对应任务的进度
      setTasks((arr) =>
        arr.map((t) =>
          t.status === 'running'
            ? { ...t, progress: p.percent ?? t.progress }
            : t
        )
      );
    });
    const offInstall = window.electronAPI.on('upscale:install-progress', (raw) => {
      const p = raw as UpscaleInstallProgressPayload;
      setInstallProgress(p);
    });
    return () => {
      offProg?.();
      offInstall?.();
    };
  }, [running]);

  // ─── handlers ─────────────────────────────────────
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
        toast.error('引擎安装失败', '展开下方诊断查看详情');
        return;
      }
      toast.success('引擎已安装', `内置 ${r.data.modelsInstalled.length} 个模型`);
      await refreshStatus();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setInstallError(`未预期错误:${msg}`);
    } finally {
      setInstallBusy(false);
      setInstallProgress(null);
    }
  }

  async function installFromLocalZip(): Promise<void> {
    if (typeof window.electronAPI.upscale.installEngineFromZip !== 'function') {
      setInstallError('需重启 dev:preload 不参与 HMR');
      return;
    }
    const pick = await window.electronAPI.storage.pickFile({
      title: '选择 Real-ESRGAN ncnn Vulkan release zip',
      filters: [{ name: 'ZIP 压缩包', extensions: ['zip'] }]
    });
    if (!pick.ok || !pick.data.filePath) return;
    setInstallBusy(true);
    try {
      const r = await window.electronAPI.upscale.installEngineFromZip({
        zipPath: pick.data.filePath
      });
      if (!r.ok) {
        setInstallError(r.error.message);
        return;
      }
      toast.success('引擎已安装');
      await refreshStatus();
    } finally {
      setInstallBusy(false);
    }
  }

  async function uninstallEngine(): Promise<void> {
    const ok = await confirmDialog({
      title: '卸载放大引擎',
      message: '确定卸载 Real-ESRGAN ncnn Vulkan 引擎吗?',
      detail: '会删除引擎二进制 + 所有已装模型。',
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
      toast.error('需重启 dev');
      return;
    }
    const pick = await window.electronAPI.storage.pickFiles({
      title: '选择 .bin / .param 模型文件(可多选;同名成对才能用)',
      filters: [{ name: 'NCNN 模型', extensions: ['bin', 'param'] }]
    });
    if (!pick.ok || pick.data.filePaths.length === 0) return;
    const nonNcnn = pick.data.filePaths.filter((p) => !/\.(bin|param)$/i.test(p));
    if (nonNcnn.length > 0) {
      toast.error(
        '不支持的格式',
        `${nonNcnn.length} 个文件不是 .bin/.param。.onnx 模型请到 设置 → 工具箱 → ONNX 模型库 导入。`
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

  // ─── 输入管理 ─────────────────────────────────────
  const addFilesFromPicker = useCallback(async (): Promise<void> => {
    const r = await window.electronAPI.storage.pickImages();
    if (!r.ok || r.data.files.length === 0) return;
    setPendingInputs((prev) => [...new Set([...prev, ...r.data.files.map((f) => f.path)])]);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    const paths = files
      .map((f) => (f as File & { path?: string }).path)
      .filter((p): p is string => !!p && /\.(png|jpe?g|webp|bmp|gif|tiff?)$/i.test(p));
    if (paths.length === 0) return;
    setPendingInputs((prev) => [...new Set([...prev, ...paths])]);
  }, []);

  function removePending(p: string): void {
    setPendingInputs((arr) => arr.filter((x) => x !== p));
  }
  function clearPending(): void {
    setPendingInputs([]);
    setPasteUri(null);
  }

  // ─── 提交 ─────────────────────────────────────────
  async function handleSubmit(): Promise<void> {
    if (totalInputs === 0) {
      toast.error('请先添加图片');
      return;
    }
    if (!effectiveModelName) {
      toast.error('当前模式无可用模型');
      return;
    }

    // 处理 pasteUri:转盘成 path 然后并入 pending
    let finalPaths: string[] = [...pendingInputs];
    if (pasteUri) {
      const saved = await window.electronAPI.storage.saveTempImage({
        dataUri: pasteUri,
        suggestedName: `upscale-in-${Date.now()}`
      });
      if (!saved.ok) {
        toast.error('粘贴的图保存失败', saved.error.message);
        return;
      }
      finalPaths.unshift(saved.data.filePath);
    }

    const submittedTaskIds: string[] = [];
    const seedTime = Date.now();
    // 给每张图建一条 running 任务
    const newTasks: UpscaleTask[] = finalPaths.map((p, i) => {
      const id = `t-${seedTime}-${i}`;
      submittedTaskIds.push(id);
      return {
        id,
        inputPath: p,
        inputDisplayUrl: localPathToImageUrl(p),
        outputPath: null,
        inputW: 0,
        inputH: 0,
        outputW: 0,
        outputH: 0,
        modelName: effectiveModelName!,
        modeId: selectedMode,
        scale,
        elapsedMs: 0,
        status: 'running',
        progress: 0,
        ts: seedTime + i
      };
    });
    setTasks((arr) => [...newTasks, ...arr].slice(0, TASKS_CAP));
    setSelectedTaskId(submittedTaskIds[0]);
    setRunning(true);
    setProgress(null);

    const params = {
      modelName: effectiveModelName!,
      scale,
      format,
      tile,
      gpuId,
      tta,
      backend: effectiveBackend,
      keepAlpha
    };

    try {
      if (finalPaths.length === 1) {
        const r = await window.electronAPI.upscale.runSingle({
          inputPath: finalPaths[0],
          ...params
        });
        if (!r.ok) {
          markTasksFailed(submittedTaskIds, r.error.message);
          if (r.error.code !== 'CANCELLED') toast.error('放大失败', r.error.message);
        } else {
          markTaskDone(submittedTaskIds[0], {
            outputPath: r.data.outputPath,
            inputW: r.data.inputW,
            inputH: r.data.inputH,
            outputW: r.data.outputW,
            outputH: r.data.outputH,
            elapsedMs: r.data.elapsedMs
          });
          toast.success(
            '放大完成',
            `${r.data.inputW}×${r.data.inputH} → ${r.data.outputW}×${r.data.outputH}(${(r.data.elapsedMs / 1000).toFixed(1)}s)`
          );
        }
      } else {
        const r = await window.electronAPI.upscale.runBatch({
          inputPaths: finalPaths,
          ...params
        });
        if (!r.ok) {
          markTasksFailed(submittedTaskIds, r.error.message);
          if (r.error.code !== 'CANCELLED') toast.error('批量放大失败', r.error.message);
        } else {
          r.data.results.forEach((res, i) => {
            const tid = submittedTaskIds[i];
            if (!tid) return;
            markTaskDone(tid, {
              outputPath: res.outputPath,
              inputW: 0,
              inputH: 0,
              outputW: res.outputW,
              outputH: res.outputH,
              elapsedMs: res.elapsedMs
            });
          });
          toast.success('批量完成', `${r.data.results.length} 张已输出`);
        }
      }
    } finally {
      setRunning(false);
      clearPending();
    }
  }

  function markTaskDone(
    id: string,
    info: {
      outputPath: string;
      inputW: number;
      inputH: number;
      outputW: number;
      outputH: number;
      elapsedMs: number;
    }
  ): void {
    setTasks((arr) =>
      arr.map((t) =>
        t.id === id
          ? {
              ...t,
              status: 'done',
              outputPath: info.outputPath,
              inputW: info.inputW || t.inputW,
              inputH: info.inputH || t.inputH,
              outputW: info.outputW,
              outputH: info.outputH,
              elapsedMs: info.elapsedMs,
              progress: 100
            }
          : t
      )
    );
  }
  function markTasksFailed(ids: string[], message: string): void {
    setTasks((arr) =>
      arr.map((t) =>
        ids.includes(t.id) ? { ...t, status: 'failed', errorMessage: message } : t
      )
    );
  }

  async function cancel(): Promise<void> {
    const r = await window.electronAPI.upscale.cancel({});
    if (r.ok) toast.info('已请求取消');
  }

  // ─── 渲染:头部 / 平台不支持 / 引擎未装 / 正常 ─────
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
            当前平台不受支持 — Real-ESRGAN ncnn 仅 Windows / macOS / Linux 三平台二进制。
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
          {noEngine ? (
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
          ) : (
            <>
              {/* 1. 模式选择 grid */}
              <ModeSelectorGrid
                selected={selectedMode}
                onChange={setSelectedMode}
                caps={caps}
              />

              {/* 2. 模式详情卡 */}
              <ModeDetailCard
                modeId={selectedMode}
                resolved={resolvedTarget}
                candidates={currentCandidates}
                override={currentOverride ?? null}
                onPickCandidate={setOverrideForCurrent}
                customModel={customModel}
                onPickCustom={setCustomModel}
                availableModels={status?.models ?? []}
                onImportCustom={importLocalModels}
              />

              {/* 3. 普通设置 */}
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

              {/* 4. 高级设置(折叠) */}
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
                  keepAlpha={keepAlpha}
                  setKeepAlpha={setKeepAlpha}
                  keepOriginalName={keepOriginalName}
                  setKeepOriginalName={setKeepOriginalName}
                  effectiveBackend={effectiveBackend}
                  disabled={running}
                />
              </Collapsible>

              {/* 5. 提交 */}
              <SubmitBar
                running={running}
                disabled={!effectiveModelName || statusBusy || totalInputs === 0}
                onSubmit={() => void handleSubmit()}
                onCancel={() => void cancel()}
                fileCount={totalInputs}
                hint={
                  totalInputs === 0
                    ? '右侧添加图片后即可开始'
                    : prewarmingModel
                      ? `预热中: ${prewarmingModel}(首次加载需 5-15s)`
                      : resolvedTarget?.usedFallback && !currentOverride
                        ? `⚠ 后端不支持理想模型,将用「${resolvedTarget.model}」近似`
                        : `将用模型「${effectiveModelName ?? '?'}」处理 ${totalInputs} 张`
                }
              />
            </>
          )}
        </InputCardShell>
      }
      right={
        <OutputCardShell state="result">
          {!noEngine && (
            <>
              {/* A. 输入区(上) */}
              <InputZone
                pendingInputs={pendingInputs}
                pasteUri={pasteUri}
                setPasteUri={setPasteUri}
                onAddFiles={() => void addFilesFromPicker()}
                onClear={clearPending}
                onRemove={removePending}
                onDrop={handleDrop}
                disabled={running}
              />

              {/* B. 任务列表(中) */}
              {tasks.length > 0 && (
                <TaskList
                  tasks={tasks}
                  selectedId={selectedTaskId}
                  onSelect={setSelectedTaskId}
                  onClear={() => {
                    setTasks([]);
                    setSelectedTaskId(null);
                  }}
                />
              )}

              {/* C. 选中任务的预览(下,占大头) */}
              <PreviewArea task={selectedTask} progress={progress} running={running} />
            </>
          )}
          {noEngine && <EmptyPane noEngine />}
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
        {noEngine && <span className="mb-tlx-chip is-warn">引擎未安装</span>}
        <button type="button" className="mb-btn mb-btn-ghost mb-btn-sm" onClick={() => void onRefresh()}>
          刷新
        </button>
        {!noEngine && (
          <button
            type="button"
            className="mb-btn mb-btn-ghost mb-btn-sm"
            onClick={() => void onUninstall()}
          >
            <TrashIcon size={12} /> 卸载
          </button>
        )}
      </div>
    </>
  );
}

// ──────────────────────────────────────────────────────────────────
// 模式 grid
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
          const hasNcnnPath = !!m.ncnnIdealName || (m.ncnnAlternativeNames?.length ?? 0) > 0;
          // 没 ncnn 路径 + ncnn 引擎缺失 → 提示"需 ONNX 模型"
          const needsOnnxOnly =
            !hasNcnnPath && !caps.ncnn && m.id !== 'custom' && m.id !== 'smart';
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
              {needsOnnxOnly && <span className="mb-tlx-mode-flag">需 ONNX 模型</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// 模式详情卡
// ──────────────────────────────────────────────────────────────────

function ModeDetailCard({
  modeId,
  resolved,
  candidates,
  override,
  onPickCandidate,
  customModel,
  onPickCustom,
  availableModels,
  onImportCustom
}: {
  modeId: UpscaleModeId;
  resolved: {
    model: string;
    backend: UpscaleBackend;
    usedFallback: boolean;
    reason?: string;
  } | null;
  /** 该模式下所有可选候选(默认置顶) */
  candidates: ModelCandidate[];
  /** 当前用户手动选了哪个(null = 走 resolver 默认) */
  override: { key: string; backend: UpscaleBackend } | null;
  /** 设置 / 清空 模式覆盖 */
  onPickCandidate: (c: ModelCandidate | null) => void;
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

      {modeId === 'custom' && (
        <div className="mb-tlx-mode-detail-custom">
          <Field label="选择模型">
            <CustomSelect
              value={customModel ?? ''}
              onChange={onPickCustom}
              optgroups={[
                ...groupModelsByCategory(availableModels).map((g) => ({
                  label: g.label,
                  options: g.items.map((m) => ({
                    value: m.name,
                    label: m.name,
                    meta: getUpscaleModelMeta(m.name).label,
                    hint: getUpscaleModelMeta(m.name).description
                  }))
                }))
              ]}
              placeholder="(选择一个已导入的模型)"
            />
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
              支持 .bin + .param 同名成对(ncnn 引擎)。.onnx 模型请到 设置 → 工具箱 → ONNX 模型库 导入。
            </span>
          </div>
          <CommunityReferenceSection />
        </div>
      )}

      {modeId !== 'custom' && modeId !== 'smart' && candidates.length > 0 && (
        <Field
          label="使用模型"
          hint="该模式下所有可用候选;默认是最优(★),也可手动切其它"
        >
          <CustomSelect
            value={
              override
                ? `${override.backend}:${override.key}`
                : candidates.find((c) => c.isDefault)
                  ? `${candidates.find((c) => c.isDefault)!.backend}:${candidates.find((c) => c.isDefault)!.key}`
                  : ''
            }
            onChange={(v) => {
              const found = candidates.find((c) => `${c.backend}:${c.key}` === v);
              if (!found) return;
              // 选回默认就清掉覆盖
              if (found.isDefault) onPickCandidate(null);
              else onPickCandidate(found);
            }}
            options={candidates.map((c) => ({
              value: `${c.backend}:${c.key}`,
              label: `${c.isDefault ? '★ ' : ''}${c.label}`,
              meta: c.source === 'ncnn' ? 'ncnn' : c.source === 'onnx-builtin' ? 'ONNX 内置' : 'ONNX 自定义',
              hint: c.isDefault ? '该模式的默认最优模型' : `候选 · 后端 ${c.backend}`
            }))}
            placeholder="(无可用候选)"
          />
        </Field>
      )}

      {modeId !== 'custom' && (
        <div className="mb-tlx-mode-detail-mapping">
          <span className="mb-tlx-key">理想模型</span>
          <code className="mb-tlx-val">{mode.idealModel}</code>
          {resolved && (
            <>
              <span className="mb-tlx-key">实际使用</span>
              <code className={`mb-tlx-val ${resolved.usedFallback ? 'is-warn' : 'is-ok'}`}>
                {override?.key ?? resolved.model}
              </code>
              <span className="mb-tlx-key">后端</span>
              <code
                className={`mb-tlx-val ${(override?.backend ?? resolved.backend) === 'onnx' ? 'is-ok' : ''}`}
              >
                {(override?.backend ?? resolved.backend) === 'onnx'
                  ? 'ONNX · onnxruntime-node(主进程内)'
                  : 'ncnn-vulkan'}
              </code>
            </>
          )}
          {!resolved && (
            <span className="mb-tlx-mode-detail-unavailable">
              ⚠ 当前没有可用模型 — 到「ONNX 模型库」下载对应 .onnx,或装 ncnn 引擎,或换其他模式
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// 普通 / 高级设置
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
        <Segmented value={detailLevel} onChange={setDetailLevel} options={DETAIL_LEVELS} />
      </Field>
      <Field
        label="降噪强度"
        hint="当前 ncnn / ONNX 后端不带 dni 双权重插值,该参数仅作 UI 占位"
      >
        <Segmented value={denoiseLevel} onChange={setDenoiseLevel} options={DENOISE_LEVELS} />
      </Field>
      <Field label="输出格式">
        <Segmented
          value={format as 'png' | 'jpg' | 'webp'}
          onChange={setFormat as (v: 'png' | 'jpg' | 'webp') => void}
          options={MODE_FORMATS}
        />
      </Field>
      {disabled && <span className="mb-tlx-field-hint">(处理中,参数已锁定)</span>}
    </div>
  );
}

function AdvancedSettings({
  tile,
  setTile,
  gpuId,
  setGpuId,
  tta,
  setTta,
  keepAlpha,
  setKeepAlpha,
  keepOriginalName,
  setKeepOriginalName,
  effectiveBackend,
  disabled
}: {
  tile: number;
  setTile: (n: number) => void;
  gpuId: 'auto' | number;
  setGpuId: (g: 'auto' | number) => void;
  tta: boolean;
  setTta: (b: boolean) => void;
  keepAlpha: boolean;
  setKeepAlpha: (b: boolean) => void;
  keepOriginalName: boolean;
  setKeepOriginalName: (b: boolean) => void;
  effectiveBackend: UpscaleBackend;
  disabled: boolean;
}): JSX.Element {
  const isOnnx = effectiveBackend === 'onnx';
  return (
    <div className="mb-tlx-advanced">
      <Field
        label="Tile 分块"
        hint={isOnnx ? '0 = 整图(显存够时最快);默认 256' : '0 = 自动。爆显存就降到 128 / 256'}
      >
        <input
          type="number"
          className="mb-tlx-input"
          min={0}
          max={4096}
          step={32}
          value={tile}
          onChange={(e) =>
            setTile(Math.max(0, Math.min(4096, Number(e.target.value) || 0)))
          }
          disabled={disabled}
        />
      </Field>
      <Field
        label="GPU"
        hint={isOnnx ? 'ONNX 后端 EP 自动选(DirectML/CoreML/CUDA → CPU 回退),此选项仅 ncnn 生效' : ''}
      >
        <CustomSelect
          value={gpuId === 'auto' ? 'auto' : String(gpuId)}
          onChange={(v) => setGpuId(v === 'auto' ? 'auto' : Number(v))}
          options={[
            { value: 'auto', label: '自动' },
            { value: '0', label: 'GPU #0' },
            { value: '1', label: 'GPU #1' },
            { value: '2', label: 'GPU #2' },
            { value: '3', label: 'GPU #3' }
          ]}
          disabled={disabled || isOnnx}
        />
      </Field>
      <CheckRow
        checked={tta}
        onChange={setTta}
        disabled={disabled || isOnnx}
        label="TTA 测试时增强"
        hint={isOnnx ? '⚠ TTA 仅 ncnn 后端支持;ONNX 后端会忽略' : '8 倍耗时,细节略好;默认关'}
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
  fileCount,
  hint
}: {
  running: boolean;
  disabled: boolean;
  onSubmit: () => void;
  onCancel: () => void;
  fileCount: number;
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
        <ZapIcon size={14} />
        {running ? '处理中…' : fileCount > 1 ? `开始放大 (${fileCount})` : '开始放大'}
      </button>
      {running && (
        <button type="button" className="mb-btn mb-btn-ghost" onClick={onCancel}>
          <XIcon size={12} /> 取消
        </button>
      )}
      <span className="mb-tlx-submit-hint">{hint}</span>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// 输入区(右侧上)
// ──────────────────────────────────────────────────────────────────

function InputZone({
  pendingInputs,
  pasteUri,
  setPasteUri,
  onAddFiles,
  onClear,
  onRemove,
  onDrop,
  disabled
}: {
  pendingInputs: string[];
  pasteUri: string | null;
  setPasteUri: (u: string | null) => void;
  onAddFiles: () => void;
  onClear: () => void;
  onRemove: (p: string) => void;
  onDrop: (e: React.DragEvent) => void;
  disabled: boolean;
}): JSX.Element {
  const [hovering, setHovering] = useState(false);
  const total = pendingInputs.length + (pasteUri ? 1 : 0);

  return (
    <div
      className={`mb-tlx-input-strip-wrap ${hovering ? 'is-hover' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setHovering(true);
      }}
      onDragLeave={() => setHovering(false)}
      onDrop={(e) => {
        setHovering(false);
        onDrop(e);
      }}
    >
      {total === 0 && !pasteUri ? (
        <div className="mb-tlx-input-strip">
          <UploadIcon size={14} />
          <span className="mb-tlx-input-strip-empty">
            拖入图片到此(支持多张),或粘贴 / 点击
          </span>
          <button
            type="button"
            className="mb-btn mb-btn-ghost mb-btn-sm"
            onClick={onAddFiles}
            disabled={disabled}
          >
            <FolderIcon size={12} /> 选择文件
          </button>
          <div style={{ display: 'none' }}>
            <ImportPanel value={pasteUri} onChange={setPasteUri} maxDim={4096} />
          </div>
        </div>
      ) : (
        <div className="mb-tlx-input-strip">
          <span className="mb-tlx-input-strip-title">{total} 张待处理</span>
          <div className="mb-tlx-input-strip-thumbs">
            {pasteUri && (
              <img
                src={pasteUri}
                className="mb-tlx-input-thumb"
                alt="paste"
                title="来自粘贴"
              />
            )}
            {pendingInputs.slice(0, 12).map((p) => (
              <img
                key={p}
                src={localPathToImageUrl(p)}
                className="mb-tlx-input-thumb"
                alt=""
                title={p.split(/[\\/]/).pop()}
                onClick={() => onRemove(p)}
                style={{ cursor: 'pointer' }}
              />
            ))}
            {pendingInputs.length > 12 && (
              <span className="mb-tlx-field-hint">+{pendingInputs.length - 12}</span>
            )}
          </div>
          <button
            type="button"
            className="mb-btn mb-btn-ghost mb-btn-sm"
            onClick={onAddFiles}
            disabled={disabled}
          >
            <PlusIcon size={12} /> 加图
          </button>
          <button
            type="button"
            className="mb-btn mb-btn-ghost mb-btn-sm"
            onClick={() => {
              onClear();
              setPasteUri(null);
            }}
            disabled={disabled}
          >
            <XIcon size={11} /> 清空
          </button>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// 任务列表
// ──────────────────────────────────────────────────────────────────

function TaskList({
  tasks,
  selectedId,
  onSelect,
  onClear
}: {
  tasks: UpscaleTask[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onClear: () => void;
}): JSX.Element {
  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 4
        }}
      >
        <span className="mb-tlx-section-title">任务列表</span>
        <button
          type="button"
          className="mb-btn mb-btn-ghost mb-btn-xs"
          onClick={onClear}
          title="清空列表(不删输出文件)"
        >
          <TrashIcon size={11} />
        </button>
      </div>
      <ul className="mb-tlx-task-list">
        {tasks.map((t) => {
          const base = t.inputPath.split(/[\\/]/).pop() ?? t.id;
          return (
            <li
              key={t.id}
              className={`mb-tlx-task-row is-${t.status} ${t.id === selectedId ? 'is-selected' : ''}`}
              onClick={() => onSelect(t.id)}
              title={t.errorMessage ?? `${t.modeId} · ${t.modelName} · ${t.scale}×`}
            >
              <span className="mb-tlx-task-name">{base}</span>
              <span className="mb-tlx-task-mode-chip">{t.scale}×</span>
              <span className="mb-tlx-task-mode-chip">{getMode(t.modeId).label}</span>
              <span className="mb-tlx-task-status">
                <span className={`mb-tlx-task-dot is-${t.status}`} />
                {t.status === 'done'
                  ? `${(t.elapsedMs / 1000).toFixed(1)}s`
                  : t.status === 'failed'
                    ? '失败'
                    : `${t.progress ?? 0}%`}
              </span>
              {t.status === 'running' && (
                <span className="mb-tlx-task-bar">
                  <span className="mb-tlx-task-bar-fill" style={{ width: `${t.progress ?? 0}%` }} />
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// 预览区(对比 / 缩放 / 拖动)
// ──────────────────────────────────────────────────────────────────

function PreviewArea({
  task,
  progress
}: {
  task: UpscaleTask | null;
  progress: UpscaleProgressPayload | null;
  running: boolean;
}): JSX.Element {
  if (!task) {
    return (
      <div className="mb-tlx-empty" style={{ flex: 1, justifyContent: 'center' }}>
        <div className="mb-tlx-empty-title">点任务行查看对比</div>
        <div className="mb-tlx-empty-sub">
          每次提交会在上方列表里出现一行任务。
          点开能看到原图与放大结果的对比预览(可缩放 / 拖动 / 滑条对比)。
        </div>
      </div>
    );
  }

  if (task.status === 'running') {
    return (
      <div className="mb-tlx-progress" style={{ flex: 1 }}>
        <div className="mb-tlx-progress-title">放大中…</div>
        <div className="mb-tlx-progress-bar">
          <div
            className="mb-tlx-progress-fill"
            style={{ width: `${progress?.percent ?? task.progress ?? 0}%` }}
          />
        </div>
        <div className="mb-tlx-progress-pct">
          {progress?.percent ?? task.progress ?? 0}%
        </div>
        <div className="mb-tlx-progress-detail">
          {progress?.phase
            ? progress.phase
            : (progress?.percent ?? task.progress ?? 0) === 0
              ? '模型冷加载中(首次 10-30s,后续秒级)…'
              : '处理中…'}
        </div>
      </div>
    );
  }

  if (task.status === 'failed') {
    return (
      <div className="mb-tlx-empty" style={{ flex: 1 }}>
        <div className="mb-tlx-empty-title" style={{ color: 'var(--mb-color-danger, #ef4444)' }}>
          任务失败
        </div>
        <div className="mb-tlx-empty-sub">{task.errorMessage ?? '未知错误'}</div>
      </div>
    );
  }

  // done — 直接展示输出图,不再做对比 wipe。
  // <img decoding=async loading=lazy> + max-width 100% 让浏览器异步解码大图,UI 不卡。
  if (!task.outputPath) return <></>;
  const afterUrl = localPathToImageUrl(task.outputPath);

  return (
    <div className="mb-tlx-result-single">
      <ResultActionsBar
        dataUri={afterUrl}
        kind="upscale"
        defaultName={`upscale-${task.outputW}x${task.outputH}-${task.ts}`}
        sourceModel={`Real-ESRGAN/${task.modelName}`}
        params={{ scale: task.scale, model: task.modelName, mode: task.modeId }}
      />
      <div className="mb-tlx-result-image-wrap">
        <img
          src={afterUrl}
          alt="result"
          className="mb-tlx-result-image"
          decoding="async"
          loading="lazy"
          draggable={false}
        />
      </div>
      <div className="mb-tlx-result-meta">
        <span><em>原图</em> {task.inputW || '?'}×{task.inputH || '?'}</span>
        <span><em>输出</em> {task.outputW}×{task.outputH}</span>
        <span><em>模式</em> {getMode(task.modeId).label}</span>
        <span><em>模型</em> {task.modelName}</span>
        <span><em>倍率</em> {task.scale}×</span>
        <span><em>耗时</em> {(task.elapsedMs / 1000).toFixed(1)}s</span>
        <button
          type="button"
          className="mb-btn mb-btn-ghost mb-btn-sm"
          onClick={() => task.outputPath && void window.electronAPI.storage.showInFolder(task.outputPath)}
        >
          <FolderIcon size={11} /> 文件夹
        </button>
      </div>
      <ResultActions
        dataUri={afterUrl}
        kind="upscale"
        defaultName={`upscale-${task.outputW}x${task.outputH}-${task.ts}`}
        sourceModel={`Real-ESRGAN/${task.modelName}`}
        params={{ scale: task.scale, model: task.modelName }}
      >
        <span style={{ display: 'none' }} />
      </ResultActions>
    </div>
  );
}

function EmptyPane({ noEngine }: { noEngine: boolean }): JSX.Element {
  return (
    <div className="mb-tlx-empty">
      <div className="mb-tlx-empty-title">{noEngine ? '请先安装引擎' : '尚无任务'}</div>
      <div className="mb-tlx-empty-sub">
        {noEngine ? '左侧选下载源后点「在线安装引擎」' : '左侧选模式 + 加图后点开始放大'}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// 引擎安装引导
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
        首次使用需下载 ~10 MB 二进制(含 4 个默认 ncnn 模型)。Vulkan 跨厂商 GPU 加速,
        无 Python 依赖,装好即可离线放大。.onnx 模型由「ONNX 模型库」单独管理。
      </p>
      <Field label="下载来源">
        <CustomSelect
          value={installSource}
          onChange={(v) => setInstallSource(v)}
          options={[
            { value: 'auto', label: '自动(直链 → 国内镜像轮转)' },
            { value: 'github', label: '仅 GitHub 直链' },
            { value: 'mirror', label: '仅国内镜像' }
          ]}
          disabled={installBusy}
        />
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
// 自定义模式下展示的「社区模型分类参考表」(折叠,默认收起)
//   不是真的内置模型 —— 是给用户做参考:用 chaiNNer / spandrel
//   把这些 .pth/.safetensors 转 .onnx 后,挂到哪个分类下能用得最好。
// ──────────────────────────────────────────────────────────────────

function CommunityReferenceSection(): JSX.Element {
  // 按 category 排好序;表里 6 条,直接平铺
  const rows = COMMUNITY_REFERENCE;
  const categoryLabel: Record<UpscaleModeId, string> = {
    smart: '智能推荐',
    'general-hd': '通用高清',
    'general-fast': '通用快速',
    'anime-illust': '动漫插画',
    'anime-video': '动漫视频',
    sharpen: '清晰增强',
    custom: '自定义'
  };
  return (
    <Collapsible title="社区模型分类参考" badge={`${rows.length} 个常用社区模型`}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span className="mb-tlx-field-hint">
          下表给出常见社区放大模型的「主要用途」与「推荐归类」。这些模型通常只发 .pth / .safetensors,
          需要用 <code>chaiNNer</code> / <code>spandrel</code> 自己转 .onnx 后,
          到 设置 → 工具箱 → ONNX 模型库 选「导入 .onnx」,挂到对应分类即可在那个模式选用。
        </span>
        <div className="mb-mapping-list">
          {rows.map((r) => (
            <div
              key={r.name}
              className="mb-mapping-row"
              style={{ alignItems: 'flex-start' }}
            >
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <strong style={{ fontSize: 12 }}>{r.name}</strong>
                  <span
                    style={{
                      fontSize: 10,
                      padding: '1px 5px',
                      borderRadius: 4,
                      background: 'var(--mb-color-surface-3, rgba(255,255,255,0.06))',
                      color: 'var(--mb-color-text-2, #b8b8b8)'
                    }}
                  >
                    {categoryLabel[r.category]}
                  </span>
                </div>
                <span style={{ fontSize: 11, opacity: 0.85 }}>{r.purpose}</span>
                <span style={{ fontSize: 10, color: 'var(--mb-color-text-muted, #888)' }}>
                  作者 {r.author} · {r.license}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Collapsible>
  );
}

