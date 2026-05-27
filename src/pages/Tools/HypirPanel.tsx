import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { toast } from '@/store/toastStore';
import { confirmDialog } from '@/components/ConfirmDialog';
import {
  useToolsEngineStore,
  type HypirCurrentTask,
  type BatchItem,
  type BatchState,
  type UpscaleIntensity
} from '@/store/toolsEngineStore';
import { ImportPanel } from '@/components/ImportPanel';
import { ResultActions, ResultActionsBar } from '@/components/ResultActions';
import { CustomSelect } from '@/components/CustomSelect';
import {
  XIcon,
  FolderIcon,
  ZapIcon,
  TrashIcon,
  PlusIcon,
  CheckIcon
} from '@/components/Icon';
import {
  PROMPT_PRESETS,
  PROMPT_CATEGORY_LABELS,
  mergePrompt,
  promptContains,
  type PromptCategory
} from '@/lib/promptPresets';
import type {
  HypirPortableProbe,
  HypirServerStatus,
  HypirProgressPayload
} from '@shared/ipc';

/**
 * HYPIR Portable 面板 —— 状态机驱动。
 *
 * mengbi 在原生 HYPIR 之外加了：
 *   - 强度预设 (保守 / 标准 / 强力)，默认保守 —— 避免银发 / 白裙过度锐化
 *   - 高光保护 / 禁用额外锐化开关
 *   - 卸载模型按钮 —— 不停服务也能清显存
 *   - 批量处理 —— 一次选多张图依次跑完保存
 *   - 结果信息卡片 —— 显示分辨率 + 耗时 + 应用的预设
 */

type CardState =
  | 'loading'
  | 'not-installed'
  | 'missing-runtime'
  | 'missing-models'
  | 'gpu-unavailable'
  | 'server-stopped'
  | 'server-ready'
  | 'processing'
  | 'completed'
  | 'failed';

type Mode = 'single' | 'batch';

function deriveState(
  probe: HypirPortableProbe | null,
  server: HypirServerStatus | null,
  task: HypirCurrentTask | null,
  batch: BatchState
): CardState {
  if (!probe) return 'loading';
  if (!probe.exists || !probe.serverScaffoldExists || !probe.bats.startExists) {
    return 'not-installed';
  }
  if (!probe.python.exists) return 'missing-runtime';
  if (!probe.hypirSource.exists || !probe.hypirWeights.exists || !probe.sd21Base.exists) {
    return 'missing-models';
  }
  if (!server || !server.reachable) return 'server-stopped';
  const cuda = server.raw?.probe?.cuda_available;
  if (cuda === false) return 'gpu-unavailable';
  if (batch.active) return 'processing';
  if (task) {
    if (task.status === 'queued' || task.status === 'running') return 'processing';
    if (task.status === 'done') return 'completed';
    if (task.status === 'failed') return 'failed';
  }
  return 'server-ready';
}

const INTENSITY_OPTIONS: Array<{ value: UpscaleIntensity; label: string; hint: string }> = [
  { value: 'conservative', label: '保守修复（推荐）', hint: '少锐化、多原图，适合银发 / 白裙 / 高光 / 反光材质' },
  { value: 'standard', label: '标准修复', hint: '常规人像 / 风景照的中庸选项' },
  { value: 'strong', label: '强力修复', hint: '严重模糊或压缩损坏才用；可能在高光区域过度锐化' }
];

const DEFAULT_NEGATIVE_HYPIR = ''; // HYPIR 不吃 negative；UI 仅展示意图

export function HypirPanel(): JSX.Element {
  void DEFAULT_NEGATIVE_HYPIR;
  const portable = useToolsEngineStore((s) => s.hypirPortable);
  const portableLoading = useToolsEngineStore((s) => s.hypirPortableLoading);
  const refreshPortable = useToolsEngineStore((s) => s.refreshHypirPortable);

  const server = useToolsEngineStore((s) => s.hypirServer);
  const serverLoading = useToolsEngineStore((s) => s.hypirServerLoading);
  const refreshServer = useToolsEngineStore((s) => s.refreshHypirServer);

  const task = useToolsEngineStore((s) => s.hypirCurrentTask);
  const setTask = useToolsEngineStore((s) => s.setHypirCurrentTask);
  const applyProgress = useToolsEngineStore((s) => s.applyHypirProgress);

  const batch = useToolsEngineStore((s) => s.hypirBatch);
  const setBatch = useToolsEngineStore((s) => s.setHypirBatch);
  const resetBatch = useToolsEngineStore((s) => s.resetHypirBatch);

  const [busy, setBusy] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('single');
  const [inputDataUri, setInputDataUri] = useState<string | null>(null);
  const [batchFiles, setBatchFiles] = useState<string[]>([]);
  const [scale, setScale] = useState<2 | 3 | 4>(2);            // 默认 2× 更稳妥
  const [tileSize, setTileSize] = useState<number>(512);
  const [intensity, setIntensity] = useState<UpscaleIntensity>('conservative');
  const [highlightProtection, setHighlightProtection] = useState<boolean>(true);
  const [disablePostsharpen, setDisablePostsharpen] = useState<boolean>(true);
  const [prompt, setPrompt] = useState<string>('');
  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);
  // 修复深度：50 / 100 / 150 / 200 / 250 / 300 / 350 / 400；改值会触发服务端重加载（约 30s）
  const [restorationDepth, setRestorationDepth] = useState<number>(200);

  // 用于"取消批量"读到最新值
  const batchCancelRef = useRef(false);
  useEffect(() => {
    batchCancelRef.current = batch.cancelRequested;
  }, [batch.cancelRequested]);

  useEffect(() => {
    void refreshPortable(false);
  }, [refreshPortable]);

  useEffect(() => {
    if (portable?.exists) void refreshServer(false);
  }, [portable, refreshServer]);

  useEffect(() => {
    if (!window.electronAPI?.on) return;
    const off = window.electronAPI.on('hypir:progress', (raw) => {
      applyProgress(raw as HypirProgressPayload);
    });
    return () => off?.();
  }, [applyProgress]);

  const state: CardState = deriveState(portable, server, task, batch);

  // ── handlers ───────────────────────────────────────

  async function doBootstrap(): Promise<void> {
    setBusy('bootstrap');
    const r = await window.electronAPI.hypir.bootstrap();
    setBusy(null);
    if (!r.ok) {
      toast.error('展开脚手架失败', r.error.message);
      return;
    }
    toast.success('脚手架已就位', `${r.data.copied} 个文件已写入，${r.data.skipped} 个已存在跳过`);
    await refreshPortable(true);
  }

  async function doChangePortablePath(): Promise<void> {
    const pick = await window.electronAPI.storage.selectFolder();
    if (!pick.ok || !pick.data) return;
    const r = await window.electronAPI.hypir.setPortablePath({ path: pick.data.path });
    if (!r.ok) {
      toast.error('保存失败', r.error.message);
      return;
    }
    toast.success('已切换 HYPIR 便携包目录', pick.data.path);
    setTask(null);
    await refreshPortable(true);
    await refreshServer(true);
  }

  async function doResetPortablePath(): Promise<void> {
    const r = await window.electronAPI.hypir.setPortablePath({ path: '' });
    if (!r.ok) {
      toast.error('重置失败', r.error.message);
      return;
    }
    toast.success('已恢复默认 HYPIR 路径');
    await refreshPortable(true);
  }

  async function doStartServer(): Promise<void> {
    setBusy('start');
    const r = await window.electronAPI.hypir.startServer();
    if (!r.ok) {
      setBusy(null);
      toast.error('启动失败', r.error.message);
      return;
    }
    if (r.data.alreadyRunning) toast.info('服务已在运行');
    for (let i = 0; i < 60; i++) {
      await new Promise((res) => setTimeout(res, 500));
      const s = await window.electronAPI.hypir.serverStatus();
      if (s.ok && s.data.reachable) {
        await refreshServer(true);
        setBusy(null);
        toast.success('HYPIR 服务运行中');
        return;
      }
    }
    setBusy(null);
    toast.error('服务启动超时（30s 仍未响应）', '看 HYPIR_Portable/logs/hypir.log');
    await refreshServer(true);
  }

  async function doStopServer(): Promise<void> {
    const ok = await confirmDialog({
      title: '停止 HYPIR 服务',
      message: '确定停止 HYPIR Portable 服务吗？',
      detail: '正在运行的任务会被丢弃；下次提交任务前需要重新启动服务。',
      okText: '停止',
      danger: true
    });
    if (!ok) return;
    setBusy('stop');
    const r = await window.electronAPI.hypir.stopServer();
    setBusy(null);
    if (!r.ok) {
      toast.error('停止失败', r.error.message);
      return;
    }
    toast.success(r.data.stopped ? '服务已停止' : '已尝试停止');
    await refreshServer(true);
  }

  // 旧的 doUnloadModel() 函数已移除 —— 卸载模型功能迁到工具箱顶部"清理显存与缓存"统一栏

  async function doRunTest(): Promise<void> {
    if (!portable) return;
    await window.electronAPI.storage.openPath({ targetPath: portable.portablePath });
    toast.info('已打开便携包目录', '双击 test_env.bat 查看完整环境自检');
  }

  // ── 单图提交 ────────────────────────────────────
  async function doSubmitSingle(): Promise<void> {
    if (!inputDataUri) {
      toast.error('请先载入图片');
      return;
    }
    setBusy('submit');
    const saved = await window.electronAPI.storage.saveTempImage({
      dataUri: inputDataUri,
      suggestedName: `hypir-in-${Date.now()}`
    });
    if (!saved.ok) {
      setBusy(null);
      toast.error('保存输入图失败', saved.error.message);
      return;
    }
    const r = await window.electronAPI.hypir.submitTask({
      inputPath: saved.data.filePath,
      scale,
      tileSize,
      prompt,
      intensity,
      highlightProtection,
      disablePostsharpen,
      restorationDepth
    });
    setBusy(null);
    if (!r.ok) {
      toast.error('提交失败', r.error.message);
      return;
    }
    setTask({
      taskId: r.data.taskId,
      status: 'queued',
      percent: 0,
      message: '已提交，排队中…',
      submittedInput: {
        inputPath: saved.data.filePath,
        scale,
        tileSize,
        prompt,
        intensity,
        highlightProtection,
        disablePostsharpen,
        restorationDepth
      }
    });
    const loadedDepth = server?.raw?.probe?.loaded_model_t ?? null;
    if (loadedDepth !== null && loadedDepth !== restorationDepth) {
      toast.info(
        `任务已提交（修复深度 ${restorationDepth}）`,
        `从深度 ${loadedDepth} 切到 ${restorationDepth}，首张会先重加载模型（约 30s）`
      );
    } else {
      toast.success('任务已提交', `${intensityLabel(intensity)} · 深度 ${restorationDepth} · task=${r.data.taskId.slice(0, 8)}`);
    }
  }

  // ── 批量：选文件 ────────────────────────────────
  async function doPickBatchFiles(): Promise<void> {
    const r = await window.electronAPI.storage.pickFiles({
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }],
      title: '选择要批量修复的图片'
    });
    if (!r.ok || !r.data.filePaths.length) return;
    setBatchFiles(r.data.filePaths);
    toast.info(`已选择 ${r.data.filePaths.length} 张图片`);
  }

  function removeBatchFile(idx: number): void {
    setBatchFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  // ── 批量：开跑（依次提交，等每张完成再提交下一张） ──
  async function doRunBatch(): Promise<void> {
    if (!batchFiles.length) {
      toast.error('请先选择要批量处理的文件');
      return;
    }
    const items: BatchItem[] = batchFiles.map((p, i) => ({
      index: i,
      inputPath: p,
      fileName: basename(p),
      status: 'pending'
    }));
    setBatch({
      active: true,
      cancelRequested: false,
      currentIndex: 0,
      total: items.length,
      items
    });
    batchCancelRef.current = false;
    setBusy('batch');

    for (let i = 0; i < items.length; i++) {
      if (batchCancelRef.current) {
        // 标记剩余的为 cancelled
        setBatch((prev) => ({
          ...prev,
          items: prev.items.map((it) =>
            it.status === 'pending' ? { ...it, status: 'cancelled' as const } : it
          )
        }));
        break;
      }
      const cur = items[i];
      setBatch((prev) => ({
        ...prev,
        currentIndex: i,
        items: prev.items.map((it) =>
          it.index === i ? { ...it, status: 'running' as const } : it
        )
      }));

      try {
        const subm = await window.electronAPI.hypir.submitTask({
          inputPath: cur.inputPath,
          scale,
          tileSize,
          prompt,
          intensity,
          highlightProtection,
          disablePostsharpen,
          restorationDepth
        });
        if (!subm.ok) throw new Error(subm.error.message);

        const taskId = subm.data.taskId;
        setBatch((prev) => ({
          ...prev,
          items: prev.items.map((it) => (it.index === i ? { ...it, taskId } : it))
        }));
        // 让 currentTask 也跟着走，复用 hypir:progress 进度条
        setTask({
          taskId,
          status: 'queued',
          percent: 0,
          message: `批量 ${i + 1}/${items.length}：${cur.fileName}`,
          submittedInput: {
            inputPath: cur.inputPath,
            scale,
            tileSize,
            prompt,
            intensity,
            highlightProtection,
            disablePostsharpen,
            restorationDepth
          }
        });

        // 轮询直到结束
        let final: 'done' | 'failed' | 'cancelled' | null = null;
        while (final === null) {
          if (batchCancelRef.current) {
            try {
              await window.electronAPI.hypir.cancelTask({ taskId });
            } catch {
              /* ignore */
            }
            final = 'cancelled';
            break;
          }
          await new Promise((res) => setTimeout(res, 800));
          const st = await window.electronAPI.hypir.taskStatus({ taskId });
          if (!st.ok) continue;
          const s = st.data;
          if (s.status === 'done') {
            final = 'done';
            setBatch((prev) => ({
              ...prev,
              items: prev.items.map((it) =>
                it.index === i
                  ? {
                      ...it,
                      status: 'done',
                      outputPath: s.output_path,
                      durationSeconds:
                        s.duration_seconds ?? s.result_info?.duration_seconds ?? null,
                      width: s.result_info?.width,
                      height: s.result_info?.height
                    }
                  : it
              )
            }));
            break;
          }
          if (s.status === 'failed') {
            final = 'failed';
            setBatch((prev) => ({
              ...prev,
              items: prev.items.map((it) =>
                it.index === i
                  ? { ...it, status: 'failed', errorMessage: s.error_message_zh ?? s.message }
                  : it
              )
            }));
            break;
          }
          if (s.status === 'cancelled') {
            final = 'cancelled';
            setBatch((prev) => ({
              ...prev,
              items: prev.items.map((it) =>
                it.index === i ? { ...it, status: 'cancelled' as const } : it
              )
            }));
            break;
          }
        }
      } catch (e) {
        setBatch((prev) => ({
          ...prev,
          items: prev.items.map((it) =>
            it.index === i ? { ...it, status: 'failed', errorMessage: (e as Error).message } : it
          )
        }));
      }
    }

    setBatch((prev) => ({ ...prev, active: false }));
    setBusy(null);
    const done = batch.items.filter((it) => it.status === 'done').length;
    toast.success(`批量处理结束`, `共 ${items.length} 张，已完成 ${done} 张`);
  }

  function doCancelBatch(): void {
    if (!batch.active) return;
    setBatch((prev) => ({ ...prev, cancelRequested: true }));
    batchCancelRef.current = true;
    toast.info('已请求取消批量', '当前张跑完后停止后续任务');
  }

  async function doCancel(): Promise<void> {
    if (!task) return;
    const r = await window.electronAPI.hypir.cancelTask({ taskId: task.taskId });
    if (!r.ok) {
      toast.error('取消失败', r.error.message);
      return;
    }
    toast.info('已请求取消');
  }

  // ── render ────────────────────────────────────────

  const canSubmit = state === 'server-ready' || state === 'completed' || state === 'failed';
  // showUnloadHint 仍保留作为"模型已加载"的角标提示;真正的"卸载"按钮已迁到顶部 CleanupBar
  const showUnloadHint = server?.raw?.model_loaded === true;

  return (
    <div className="mb-tools-pane">
      <div className="mb-tools-pane-left">
        <StateBanner
          state={state}
          portable={portable}
          server={server}
          loading={portableLoading || serverLoading}
          busy={busy}
          showUnloadHint={showUnloadHint}
          onBootstrap={doBootstrap}
          onChangePath={doChangePortablePath}
          onResetPath={doResetPortablePath}
          onStart={doStartServer}
          onStop={doStopServer}
          onRunTest={doRunTest}
          onRefresh={() => void refreshPortable(true).then(() => refreshServer(true))}
        />

        {canSubmit || state === 'processing' ? (
          <>
            {/* 警示 banner —— 反过度锐化教育 */}
            <div className="mb-tools-warn-card">
              <strong>AI 修复放大</strong>
              ：适合模糊、压缩损坏、低清照片，画质更强，但可能生成新的纹理细节。
              对于银发、白裙、高光、反光材质，建议使用<strong> 保守修复</strong>模式。
            </div>

            {/* 单图 / 批量 切换 */}
            <div className="mb-tools-mode-tabs">
              <button
                type="button"
                className={`mb-tools-mode-tab ${mode === 'single' ? 'is-active' : ''}`}
                onClick={() => setMode('single')}
                disabled={state === 'processing'}
              >
                单图
              </button>
              <button
                type="button"
                className={`mb-tools-mode-tab ${mode === 'batch' ? 'is-active' : ''}`}
                onClick={() => setMode('batch')}
                disabled={state === 'processing'}
              >
                批量（{batchFiles.length}）
              </button>
            </div>

            <h3 className="mb-tools-pane-section">输入</h3>
            {mode === 'single' ? (
              <ImportPanel value={inputDataUri} onChange={setInputDataUri} maxDim={2048} />
            ) : (
              <BatchFilePicker
                files={batchFiles}
                onPick={doPickBatchFiles}
                onClear={() => setBatchFiles([])}
                onRemove={removeBatchFile}
                disabled={state === 'processing'}
              />
            )}

            <h3 className="mb-tools-pane-section">参数</h3>
            <div className="mb-tools-fields">
              {/* 强度预设 —— 一等公民 */}
              <Field label="修复强度（默认保守修复，避免银发 / 白裙过度锐化）">
                <CustomSelect
                  value={intensity}
                  onChange={(v) => {
                    setIntensity(v);
                    setHighlightProtection(v !== 'strong');
                  }}
                  options={INTENSITY_OPTIONS.map((o) => ({
                    value: o.value,
                    label: o.label,
                    hint: o.hint
                  }))}
                  disabled={state === 'processing'}
                />
                <div className="mb-tools-field-hint">
                  {INTENSITY_OPTIONS.find((o) => o.value === intensity)?.hint}
                </div>
              </Field>

              <div className="mb-tools-engine-row">
                <Field label="倍率">
                  <CustomSelect
                    value={String(scale)}
                    onChange={(v) => setScale(Number(v) as 2 | 3 | 4)}
                    options={[2, 3, 4].map((s) => ({ value: String(s), label: `${s}×` }))}
                    disabled={state === 'processing'}
                  />
                </Field>
                <Field label="Tile 尺寸（爆显存就调小）">
                  <CustomSelect
                    value={String(tileSize)}
                    onChange={(v) => setTileSize(Number(v))}
                    options={[256, 384, 512, 768, 1024].map((s) => ({
                      value: String(s),
                      label: String(s)
                    }))}
                    disabled={state === 'processing'}
                  />
                </Field>
              </div>

              {/* 高级折叠：修复深度 + 提示词 + 高光保护 + 禁用锐化 */}
              <details
                open={showAdvanced}
                onToggle={(e) => setShowAdvanced((e.target as HTMLDetailsElement).open)}
              >
                <summary className="mb-tools-pane-section" style={{ cursor: 'pointer' }}>
                  高级参数（修复深度 / 提示词 / 高光保护 / 禁用锐化）
                </summary>

                <div className="mb-tools-fields" style={{ marginTop: 8 }}>
                  {/* 修复深度滑块 —— HYPIR 的 model_t / coeff_t 同步 */}
                  <Field label={`修复深度 (${restorationDepth}) — HYPIR 没有"采样步数"，这个是等价旋钮`}>
                    <input
                      type="range"
                      min={50}
                      max={400}
                      step={50}
                      value={restorationDepth}
                      onChange={(e) => setRestorationDepth(Number(e.target.value))}
                      disabled={state === 'processing'}
                    />
                    <div className="mb-tools-field-hint">
                      50–150：更轻、更接近原图；
                      <strong>200 是官方默认（推荐）</strong>；
                      250–400：更深度修复，可能引入新纹理。
                      {server?.raw?.probe?.loaded_model_t != null &&
                        server.raw.probe.loaded_model_t !== restorationDepth && (
                          <span className="mb-tools-depth-warn">
                            {' '}⚠ 当前显存里加载的是深度{' '}
                            <code>{server.raw.probe.loaded_model_t}</code>
                            ；提交后会先卸载并重加载模型（约 30 秒）。
                          </span>
                        )}
                    </div>
                  </Field>

                  <Field label="正向提示词（默认按反过度锐化方向走，无需填）">
                    <textarea
                      className="mb-input mb-textarea"
                      rows={2}
                      placeholder="留空使用 mengbi 默认：natural details, soft texture, faithful restoration ..."
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      disabled={state === 'processing'}
                    />
                    <PromptPresetPicker
                      current={prompt}
                      onPick={(p) => setPrompt(mergePrompt(prompt, p))}
                      onClear={() => setPrompt('')}
                      disabled={state === 'processing'}
                    />
                  </Field>

                  <div className="mb-tools-toggle-row">
                    <ToggleField
                      label="高光保护"
                      hint="检测亮度高的像素，对其减少 HYPIR 贡献，避免银发 / 白裙脏纹理"
                      value={highlightProtection}
                      onChange={setHighlightProtection}
                      disabled={state === 'processing'}
                    />
                    <ToggleField
                      label="禁用额外锐化"
                      hint="不在输出后叠加 unsharp mask / clarity 等后处理"
                      value={disablePostsharpen}
                      onChange={setDisablePostsharpen}
                      disabled={state === 'processing'}
                    />
                  </div>

                  <div className="mb-tools-hint-box">
                    默认反向 prompt：
                    <code>
                      over-sharpened, excessive details, harsh texture, plastic skin,
                      dirty white clothes, halo, artifacts, jagged edges, overprocessed
                    </code>
                    （HYPIR 模型本身不吃 negative，UI 仅展示意图）
                  </div>
                </div>
              </details>
            </div>

            <div className="mb-tools-action-row">
              {mode === 'single' ? (
                <button
                  className="mb-btn mb-btn-primary"
                  onClick={() => void doSubmitSingle()}
                  disabled={state === 'processing' || !inputDataUri || busy === 'submit'}
                >
                  <ZapIcon size={14} /> {state === 'processing' ? '处理中…' : '提交修复任务'}
                </button>
              ) : (
                <button
                  className="mb-btn mb-btn-primary"
                  onClick={() => void doRunBatch()}
                  disabled={state === 'processing' || !batchFiles.length || busy === 'batch'}
                >
                  <ZapIcon size={14} />{' '}
                  {state === 'processing'
                    ? `批量中… (${batch.currentIndex + 1}/${batch.total})`
                    : `批量提交 ${batchFiles.length} 张`}
                </button>
              )}

              {state === 'processing' && batch.active && (
                <button className="mb-btn mb-btn-ghost" onClick={doCancelBatch}>
                  <XIcon size={13} /> 取消批量
                </button>
              )}
              {state === 'processing' && !batch.active && (
                <button className="mb-btn mb-btn-ghost" onClick={() => void doCancel()}>
                  <XIcon size={13} /> 取消
                </button>
              )}
              {/* "卸载模型"按钮已迁移到工具箱顶部统一"清理显存与缓存"栏 */}
            </div>
          </>
        ) : null}
      </div>

      <div className="mb-tools-pane-right">
        <h3 className="mb-tools-pane-section">结果</h3>

        {state === 'processing' && batch.active ? (
          <BatchProgressView batch={batch} task={task} />
        ) : state === 'processing' && task ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            className="mb-tools-busy-card"
          >
            <div className="mb-tools-progress-bar">
              <div className="mb-tools-progress-bar-fill" style={{ width: `${task.percent}%` }} />
            </div>
            <div className="mb-tools-progress-phase">{task.message || '处理中…'}</div>
            <div className="mb-tools-progress-pct">{task.percent}%</div>
          </motion.div>
        ) : !batch.active && batch.items.length > 0 ? (
          // 批量已结束 —— 仍展示列表
          <BatchResultList
            batch={batch}
            onClear={() => resetBatch()}
          />
        ) : state === 'completed' && task?.outputPath ? (
          <CompletedResult outputPath={task.outputPath} task={task} />
        ) : state === 'failed' && task ? (
          <FailedResult task={task} />
        ) : (
          <div className="mb-tools-placeholder">
            {state === 'server-ready'
              ? '左侧载入输入图（或切到「批量」选多张）并点「提交修复任务」'
              : '请先按左侧提示完成 HYPIR 引擎部署'}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── 状态横幅 ──────────────────────────────────────────

function StateBanner(props: {
  state: CardState;
  portable: HypirPortableProbe | null;
  server: HypirServerStatus | null;
  loading: boolean;
  busy: string | null;
  showUnloadHint: boolean;
  onBootstrap: () => Promise<void>;
  onChangePath: () => Promise<void>;
  onResetPath: () => Promise<void>;
  onStart: () => Promise<void>;
  onStop: () => Promise<void>;
  onRunTest: () => Promise<void>;
  onRefresh: () => void;
}): JSX.Element {
  const { state, portable, server, busy, loading } = props;
  const meta = STATE_META[state];

  return (
    <div className={`mb-hypir-banner is-${state}`}>
      <div className="mb-hypir-banner-head">
        <span className={`mb-hypir-dot is-${meta.tone}`} />
        <span className="mb-hypir-banner-title">{meta.title}</span>
        <span className="mb-hypir-banner-spacer" />
        {portable?.portablePath && (
          <code className="mb-hypir-banner-path" title={portable.portablePath}>
            {portable.portablePath}
          </code>
        )}
        <button
          className="mb-btn mb-btn-ghost mb-btn-sm"
          onClick={props.onRefresh}
          disabled={loading}
        >
          {loading ? '刷新中…' : '刷新'}
        </button>
      </div>
      <div className="mb-hypir-banner-body">{meta.desc(portable, server)}</div>

      <div className="mb-hypir-banner-actions">
        {state === 'not-installed' && (
          <>
            <button
              className="mb-btn mb-btn-primary mb-btn-sm"
              disabled={busy === 'bootstrap'}
              onClick={() => void props.onBootstrap()}
            >
              <PlusIcon size={13} /> {busy === 'bootstrap' ? '展开中…' : '在默认位置展开脚手架'}
            </button>
            <button
              className="mb-btn mb-btn-secondary mb-btn-sm"
              onClick={() => void props.onChangePath()}
            >
              <FolderIcon size={13} /> 改到其他目录
            </button>
          </>
        )}
        {state === 'missing-runtime' && (
          <>
            <button
              className="mb-btn mb-btn-primary mb-btn-sm"
              onClick={() =>
                portable &&
                void window.electronAPI.storage.openPath({
                  targetPath: portable.portablePath,
                  ensureDir: true
                })
              }
            >
              <FolderIcon size={13} /> 打开便携包目录
            </button>
            <span className="mb-tools-field-hint">
              按 README 步骤 1 / 2 装好 runtime/python + 依赖，回来点"刷新"
            </span>
          </>
        )}
        {state === 'missing-models' && (
          <>
            <button
              className="mb-btn mb-btn-secondary mb-btn-sm"
              onClick={() =>
                portable &&
                void window.electronAPI.storage.openPath({ targetPath: portable.portablePath })
              }
            >
              <FolderIcon size={13} /> 打开便携包
            </button>
            <button
              className="mb-btn mb-btn-ghost mb-btn-sm"
              onClick={() => void props.onRunTest()}
            >
              查看自检
            </button>
          </>
        )}
        {state === 'gpu-unavailable' && (
          <button
            className="mb-btn mb-btn-secondary mb-btn-sm"
            onClick={() => void props.onRunTest()}
          >
            打开便携包看 test_env.bat
          </button>
        )}
        {state === 'server-stopped' && (
          <button
            className="mb-btn mb-btn-primary mb-btn-sm"
            disabled={busy === 'start'}
            onClick={() => void props.onStart()}
          >
            <ZapIcon size={13} /> {busy === 'start' ? '启动中…（等服务起来）' : '启动 HYPIR 服务'}
          </button>
        )}
        {(state === 'server-ready' ||
          state === 'processing' ||
          state === 'completed' ||
          state === 'failed') && (
          <details className="mb-tools-details" style={{ flex: 1 }}>
            <summary>
              服务运行中 · 展开看 GPU / 模型 / 操作
              {props.showUnloadHint && ' · 模型在显存'}
            </summary>
            <div className="mb-hypir-server-info">
              {server?.raw?.probe?.gpu_name && (
                <div>
                  GPU：<code>{server.raw.probe.gpu_name}</code>
                </div>
              )}
              {server?.raw?.probe?.vram_total_mb && (
                <div>
                  显存：
                  <code>{(server.raw.probe.vram_total_mb / 1024).toFixed(1)} GB</code>
                </div>
              )}
              <div>
                模型：{server?.raw?.model_loaded ? '✓ 已加载到显存' : '⌛ 首张图时按需加载'}
              </div>
              <div>
                队列：{server?.raw?.queue_size ?? 0} | 活跃：{server?.raw?.active_tasks ?? 0}
              </div>
              <div className="mb-tools-row-buttons" style={{ marginTop: 8 }}>
                <button
                  className="mb-btn mb-btn-ghost mb-btn-sm"
                  onClick={() =>
                    portable &&
                    void window.electronAPI.storage.openPath({ targetPath: portable.portablePath })
                  }
                >
                  <FolderIcon size={12} /> 便携包目录
                </button>
                <button
                  className="mb-btn mb-btn-ghost mb-btn-sm"
                  onClick={() => void props.onChangePath()}
                >
                  改路径
                </button>
                <button
                  className="mb-btn mb-btn-ghost mb-btn-sm"
                  onClick={() => void props.onResetPath()}
                >
                  恢复默认
                </button>
                {/* "卸载模型"按钮已迁移到工具箱顶部"清理显存与缓存"栏 */}
                <button
                  className="mb-btn mb-btn-ghost mb-btn-sm"
                  onClick={() => void props.onStop()}
                  disabled={busy === 'stop'}
                >
                  <TrashIcon size={12} /> {busy === 'stop' ? '停止中…' : '停止服务'}
                </button>
              </div>
            </div>
          </details>
        )}
      </div>
    </div>
  );
}

// ─── 文案表 ────────────────────────────────────────────

const STATE_META: Record<
  CardState,
  {
    title: string;
    tone: 'gray' | 'amber' | 'red' | 'green' | 'blue';
    desc: (p: HypirPortableProbe | null, s: HypirServerStatus | null) => React.ReactNode;
  }
> = {
  loading: { title: '检测中…', tone: 'gray', desc: () => '正在探测 HYPIR Portable 包结构' },
  'not-installed': {
    title: '未安装',
    tone: 'red',
    desc: (p) => (
      <>
        便携包未就位。点下方按钮在默认目录{p ? <code> {p.portablePath} </code> : ' '}展开脚手架，
        或选你想装的目录。脚手架只放 bat / hypir_server / 配置（约 50KB），
        运行时 Python、模型权重要自己按 README 部署。
      </>
    )
  },
  'missing-runtime': {
    title: '缺便携 Python',
    tone: 'amber',
    desc: () =>
      '脚手架已就位，但 runtime/python 还没装。打开便携包，按 README 第 1-2 步放好可嵌入 Python + 跑 install_or_repair.bat。'
  },
  'missing-models': {
    title: '缺模型 / HYPIR 源码',
    tone: 'amber',
    desc: (p) => (
      <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.5 }}>
        {!p?.hypirSource.exists && (
          <li>
            HYPIR 源码缺失：<code>app/HYPIR/</code>
          </li>
        )}
        {!p?.hypirWeights.exists && (
          <li>
            HYPIR 权重缺失：<code>models/hypir/HYPIR_sd2.pth</code>
          </li>
        )}
        {!p?.sd21Base.exists && (
          <li>
            SD2.1 base 缺失：<code>models/sd2_1_base/</code>
          </li>
        )}
      </ul>
    )
  },
  'gpu-unavailable': {
    title: 'GPU 不可用',
    tone: 'red',
    desc: () =>
      'PyTorch 看不到 CUDA。可能是显卡驱动没装、装的是 CPU 版 torch、或显卡不在路上。跑 test_env.bat 看详细原因。'
  },
  'server-stopped': {
    title: '服务未启动',
    tone: 'amber',
    desc: () => '依赖都齐了，只是 HYPIR 服务还没起。点下方按钮启动。'
  },
  'server-ready': {
    title: '服务运行中',
    tone: 'green',
    desc: (_p, s) => `已连上 127.0.0.1:${s?.port ?? '?'}；等你提交任务。`
  },
  processing: {
    title: '正在处理',
    tone: 'blue',
    desc: () => '任务在 HYPIR worker 队列里跑。可在结果区看到实时进度。'
  },
  completed: {
    title: '处理完成',
    tone: 'green',
    desc: () => '输出已落到便携包的 output 目录。右侧可复制 / 另存为 / 加入图库。'
  },
  failed: {
    title: '处理失败',
    tone: 'red',
    desc: () => '看右侧错误说明；显存不足请按提示降 tile_size 或倍率，或改用「保真放大」。'
  }
};

// ─── 结果块 ─────────────────────────────────────────────

function CompletedResult({
  outputPath,
  task
}: {
  outputPath: string;
  task: HypirCurrentTask;
}): JSX.Element {
  const [dataUri, setDataUri] = useState<string | null>(null);
  useEffect(() => {
    void (async () => {
      try {
        const { localPathToImageUrl } = await import('@/lib/imageUrl');
        const url = localPathToImageUrl(outputPath);
        const r = await fetch(url);
        const blob = await r.blob();
        const reader = new FileReader();
        reader.onload = () =>
          setDataUri(typeof reader.result === 'string' ? reader.result : null);
        reader.readAsDataURL(blob);
      } catch {
        setDataUri(null);
      }
    })();
  }, [outputPath]);

  if (!dataUri) {
    return (
      <div className="mb-tools-placeholder">
        已完成 — 但预览读取失败。直接打开输出：
        <button
          className="mb-btn mb-btn-ghost mb-btn-sm"
          style={{ marginLeft: 6 }}
          onClick={() => void window.electronAPI.storage.showInFolder(outputPath)}
        >
          <FolderIcon size={12} /> 查看
        </button>
      </div>
    );
  }
  return (
    <>
      <ResultActionsBar
        dataUri={dataUri}
        kind="upscale"
        defaultName={`hypir-${task.taskId.slice(0, 8)}`}
        sourceModel="HYPIR"
        params={{
          scale: task.submittedInput?.scale,
          tile: task.submittedInput?.tileSize,
          prompt: task.submittedInput?.prompt,
          intensity: task.submittedInput?.intensity
        }}
      />
      <ResultActions
        dataUri={dataUri}
        kind="upscale"
        defaultName={`hypir-${task.taskId.slice(0, 8)}`}
        sourceModel="HYPIR"
        params={{}}
      >
        <img src={dataUri} className="mb-tools-result-img" alt="HYPIR 修复结果" />
      </ResultActions>
      <ResultInfoCard task={task} outputPath={outputPath} />
    </>
  );
}

function ResultInfoCard({
  task,
  outputPath
}: {
  task: HypirCurrentTask;
  outputPath: string;
}): JSX.Element {
  const info = task.resultInfo;
  const duration = task.durationSeconds ?? info?.duration_seconds ?? null;
  return (
    <div className="mb-tools-result-info">
      <div className="mb-tools-result-info-grid">
        <div>
          <span className="mb-tools-result-info-k">分辨率</span>
          <span className="mb-tools-result-info-v">
            {info?.width && info?.height ? `${info.width} × ${info.height}` : '—'}
            {info?.input_width && info?.input_height && (
              <span className="mb-tools-result-info-sub">
                （原图 {info.input_width} × {info.input_height}）
              </span>
            )}
          </span>
        </div>
        <div>
          <span className="mb-tools-result-info-k">用时</span>
          <span className="mb-tools-result-info-v">
            {duration !== null ? `${duration.toFixed(1)} 秒` : '—'}
          </span>
        </div>
        <div>
          <span className="mb-tools-result-info-k">强度</span>
          <span className="mb-tools-result-info-v">
            {intensityLabel((info?.intensity as UpscaleIntensity) || task.submittedInput?.intensity || 'conservative')}
            {info?.blend_alpha !== undefined && (
              <span className="mb-tools-result-info-sub">
                （融合 {(info.blend_alpha * 100).toFixed(0)}% HYPIR）
              </span>
            )}
          </span>
        </div>
        <div>
          <span className="mb-tools-result-info-k">高光保护</span>
          <span className="mb-tools-result-info-v">
            {info?.highlight_protection ? '开' : '关'}
          </span>
        </div>
        <div>
          <span className="mb-tools-result-info-k">修复深度</span>
          <span className="mb-tools-result-info-v">
            {info?.model_t ?? task.submittedInput?.restorationDepth ?? '—'}
            <span className="mb-tools-result-info-sub"> (model_t = coeff_t)</span>
          </span>
        </div>
      </div>
      <div className="mb-tools-result-meta">
        输出：<code>{outputPath}</code>
        <button
          className="mb-btn mb-btn-ghost mb-btn-sm"
          style={{ marginLeft: 6 }}
          onClick={() => void window.electronAPI.storage.showInFolder(outputPath)}
        >
          打开
        </button>
      </div>
    </div>
  );
}

function FailedResult({ task }: { task: HypirCurrentTask }): JSX.Element {
  return (
    <div
      className="mb-tools-hypir-summary is-block"
      style={{ flexDirection: 'column', alignItems: 'flex-start', padding: 14 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <XIcon size={14} /> 任务失败
      </div>
      <div style={{ marginTop: 6, fontSize: 12, fontWeight: 400 }}>
        {task.errorMessageZh || task.message}
      </div>
      {task.errorHint && (
        <div
          style={{
            marginTop: 4,
            fontSize: 11,
            color: 'var(--mb-text-muted)',
            fontWeight: 400
          }}
        >
          💡 {task.errorHint}
        </div>
      )}
    </div>
  );
}

// ─── 批量子组件 ──────────────────────────────────────

function BatchFilePicker(props: {
  files: string[];
  onPick: () => void | Promise<void>;
  onClear: () => void;
  onRemove: (i: number) => void;
  disabled: boolean;
}): JSX.Element {
  return (
    <div className="mb-tools-batch-picker">
      <div className="mb-tools-batch-actions">
        <button
          className="mb-btn mb-btn-secondary mb-btn-sm"
          onClick={() => void props.onPick()}
          disabled={props.disabled}
        >
          <FolderIcon size={13} /> 选择图片（可多选）
        </button>
        {props.files.length > 0 && (
          <button
            className="mb-btn mb-btn-ghost mb-btn-sm"
            onClick={props.onClear}
            disabled={props.disabled}
          >
            <XIcon size={11} /> 清空
          </button>
        )}
        <span className="mb-tools-field-hint" style={{ marginLeft: 'auto' }}>
          所选每张都会按当前参数依次跑完保存
        </span>
      </div>
      {props.files.length === 0 ? (
        <div className="mb-tools-placeholder" style={{ minHeight: 80 }}>
          未选择文件
        </div>
      ) : (
        <ul className="mb-tools-batch-list">
          {props.files.map((p, i) => (
            <li key={`${p}-${i}`}>
              <span className="mb-tools-batch-idx">{i + 1}</span>
              <span className="mb-tools-batch-name" title={p}>
                {basename(p)}
              </span>
              <button
                className="mb-btn mb-btn-ghost mb-btn-sm"
                onClick={() => props.onRemove(i)}
                disabled={props.disabled}
                title="移除"
              >
                <XIcon size={11} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BatchProgressView({
  batch,
  task
}: {
  batch: BatchState;
  task: HypirCurrentTask | null;
}): JSX.Element {
  const done = batch.items.filter((it) => it.status === 'done').length;
  const failed = batch.items.filter((it) => it.status === 'failed').length;
  return (
    <div className="mb-tools-batch-progress">
      <div className="mb-tools-batch-header">
        <strong>
          批量处理中 {batch.currentIndex + 1} / {batch.total}
        </strong>
        <span>
          ✓ {done} · ✗ {failed}
        </span>
      </div>
      {task && (
        <div className="mb-tools-busy-card" style={{ minHeight: 140 }}>
          <div className="mb-tools-progress-bar">
            <div className="mb-tools-progress-bar-fill" style={{ width: `${task.percent}%` }} />
          </div>
          <div className="mb-tools-progress-phase">{task.message}</div>
          <div className="mb-tools-progress-pct">{task.percent}%</div>
        </div>
      )}
      <ul className="mb-tools-batch-list is-status">
        {batch.items.map((it) => (
          <li key={`${it.inputPath}-${it.index}`} className={`is-${it.status}`}>
            <span className="mb-tools-batch-idx">{it.index + 1}</span>
            <span className="mb-tools-batch-name" title={it.inputPath}>
              {it.fileName}
            </span>
            <span className="mb-tools-batch-status">{batchStatusLabel(it.status)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function BatchResultList({
  batch,
  onClear
}: {
  batch: BatchState;
  onClear: () => void;
}): JSX.Element {
  const done = batch.items.filter((it) => it.status === 'done');
  const failed = batch.items.filter((it) => it.status === 'failed');
  return (
    <div className="mb-tools-batch-progress">
      <div className="mb-tools-batch-header">
        <strong>批量已结束</strong>
        <span>
          共 {batch.total}（✓ {done.length} · ✗ {failed.length}）
        </span>
        <button className="mb-btn mb-btn-ghost mb-btn-sm" onClick={onClear} style={{ marginLeft: 8 }}>
          <XIcon size={11} /> 清空记录
        </button>
      </div>
      <ul className="mb-tools-batch-list is-status">
        {batch.items.map((it) => (
          <li key={`${it.inputPath}-${it.index}`} className={`is-${it.status}`}>
            <span className="mb-tools-batch-idx">{it.index + 1}</span>
            <span className="mb-tools-batch-name" title={it.inputPath}>
              {it.fileName}
            </span>
            {it.status === 'done' && (
              <>
                <span className="mb-tools-batch-meta">
                  {it.width}×{it.height} · {it.durationSeconds?.toFixed(1)}s
                </span>
                {it.outputPath && (
                  <button
                    className="mb-btn mb-btn-ghost mb-btn-sm"
                    onClick={() => void window.electronAPI.storage.showInFolder(it.outputPath!)}
                    title="在文件夹中查看"
                  >
                    <FolderIcon size={11} />
                  </button>
                )}
              </>
            )}
            {it.status === 'failed' && (
              <span className="mb-tools-batch-err" title={it.errorMessage}>
                {it.errorMessage?.slice(0, 40) || '失败'}
              </span>
            )}
            {it.status !== 'done' && it.status !== 'failed' && (
              <span className="mb-tools-batch-status">{batchStatusLabel(it.status)}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── 子组件 ─────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="mb-tools-field">
      <label className="mb-tools-field-label">{label}</label>
      {children}
    </div>
  );
}

function ToggleField(props: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}): JSX.Element {
  return (
    <label
      className={`mb-tools-toggle ${props.value ? 'is-on' : ''} ${props.disabled ? 'is-disabled' : ''}`}
    >
      <input
        type="checkbox"
        checked={props.value}
        onChange={(e) => props.onChange(e.target.checked)}
        disabled={props.disabled}
      />
      <span className="mb-tools-toggle-box">
        {props.value && <CheckIcon size={11} />}
      </span>
      <span className="mb-tools-toggle-body">
        <span className="mb-tools-toggle-label">{props.label}</span>
        {props.hint && <span className="mb-tools-toggle-hint">{props.hint}</span>}
      </span>
    </label>
  );
}

function PromptPresetPicker(props: {
  current: string;
  onPick: (preset: import('@/lib/promptPresets').PromptPreset) => void;
  onClear: () => void;
  disabled?: boolean;
}): JSX.Element {
  const [activeCategory, setActiveCategory] = useState<PromptCategory>('intensity');
  const filtered = useMemo(
    () => PROMPT_PRESETS.filter((p) => p.category === activeCategory),
    [activeCategory]
  );
  const categories = Object.keys(PROMPT_CATEGORY_LABELS) as PromptCategory[];

  return (
    <div className="mb-prompt-presets">
      <div className="mb-prompt-presets-tabs">
        {categories.map((c) => (
          <button
            key={c}
            type="button"
            className={`mb-prompt-presets-tab ${activeCategory === c ? 'is-active' : ''}`}
            onClick={() => setActiveCategory(c)}
            disabled={props.disabled}
          >
            {PROMPT_CATEGORY_LABELS[c]}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        {props.current && (
          <button
            type="button"
            className="mb-btn mb-btn-ghost mb-btn-sm"
            onClick={props.onClear}
            disabled={props.disabled}
            title="清空提示词"
          >
            <XIcon size={11} /> 清空
          </button>
        )}
      </div>
      <div className="mb-prompt-presets-chips">
        {filtered.map((p) => {
          const selected = promptContains(props.current, p);
          const toneCls =
            p.tone === 'sharper' ? 'is-sharper' : p.tone === 'softer' ? 'is-softer' : '';
          return (
            <button
              key={p.label}
              type="button"
              className={`mb-prompt-chip ${selected ? 'is-selected' : ''} ${toneCls}`}
              onClick={() => props.onPick(p)}
              disabled={props.disabled}
              title={p.hint ? `${p.prompt}\n\n${p.hint}` : p.prompt}
            >
              {p.label}
              {selected && <span className="mb-prompt-chip-check">✓</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── 工具函数 ───────────────────────────────────────────

function intensityLabel(i: UpscaleIntensity): string {
  return INTENSITY_OPTIONS.find((o) => o.value === i)?.label.split('（')[0] || i;
}

function batchStatusLabel(s: BatchItem['status']): string {
  switch (s) {
    case 'pending':
      return '排队中';
    case 'running':
      return '处理中';
    case 'done':
      return '✓ 完成';
    case 'failed':
      return '✗ 失败';
    case 'cancelled':
      return '已取消';
  }
}

function basename(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] || p;
}
