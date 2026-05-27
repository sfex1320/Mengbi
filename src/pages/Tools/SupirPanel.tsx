import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { toast } from '@/store/toastStore';
import { confirmDialog } from '@/components/ConfirmDialog';
import {
  useToolsEngineStore,
  type SupirCurrentTask,
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
  CheckIcon
} from '@/components/Icon';
import {
  PROMPT_PRESETS,
  PROMPT_CATEGORY_LABELS,
  mergePrompt,
  promptContains,
  type PromptCategory,
  type PromptPreset
} from '@/lib/promptPresets';
import type {
  SupirPortableProbe,
  SupirServerStatus,
  SupirProgressPayload
} from '@shared/ipc';

/**
 * SUPIR Portable 面板。
 *
 * 与 HypirPanel 平行，独立 IPC + SUPIR 专属参数：
 *   - 检查点 F (保真) / Q (质量)
 *   - 强度预设 (保守 / 标准 / 强力)，默认保守
 *   - 高光保护 / 禁用额外锐化
 *   - 高级折叠：steps / cfg / restoration_scale / color_fix / tile
 *   - 卸载模型按钮 / 批量 / 结果信息卡片
 */

type CardState =
  | 'loading'
  | 'not-installed'
  | 'missing-models'
  | 'gpu-unavailable'
  | 'server-stopped'
  | 'server-ready'
  | 'processing'
  | 'completed'
  | 'failed';

type Mode = 'single' | 'batch';

const INTENSITY_OPTIONS: Array<{ value: UpscaleIntensity; label: string; hint: string }> = [
  { value: 'conservative', label: '保守修复（推荐）', hint: '12 步 + 高光保护 + 颜色 Wavelet，最快约 60-90 秒/张（2K 4× 放大）' },
  { value: 'standard', label: '标准修复', hint: '18 步 + restoration=4.0，常规人像 / 风景中庸选项，约 90-150 秒/张' },
  { value: 'strong', label: '强力修复', hint: '28 步 + restoration=6.0，严重损坏才用，约 150-240 秒/张；可能在高光区域过度锐化' }
];

function deriveState(
  probe: SupirPortableProbe | null,
  server: SupirServerStatus | null,
  task: SupirCurrentTask | null,
  batch: BatchState
): CardState {
  if (!probe) return 'loading';
  if (!probe.exists || !probe.bats.startExists || !probe.serverScaffoldExists) {
    return 'not-installed';
  }
  if (
    !probe.supirSource.exists ||
    (!probe.supirV0F.exists && !probe.supirV0Q.exists) ||
    !probe.sdxlBase.exists
  ) {
    return 'missing-models';
  }
  if (!server || !server.reachable) return 'server-stopped';
  if (server.raw?.probe?.cuda_available === false) return 'gpu-unavailable';
  if (batch.active) return 'processing';
  if (task) {
    if (task.status === 'queued' || task.status === 'running') return 'processing';
    if (task.status === 'done') return 'completed';
    if (task.status === 'failed') return 'failed';
  }
  return 'server-ready';
}

export function SupirPanel(): JSX.Element {
  const probe = useToolsEngineStore((s) => s.supirPortable);
  const probeLoading = useToolsEngineStore((s) => s.supirPortableLoading);
  const refreshProbe = useToolsEngineStore((s) => s.refreshSupirPortable);

  const server = useToolsEngineStore((s) => s.supirServer);
  const serverLoading = useToolsEngineStore((s) => s.supirServerLoading);
  const refreshServer = useToolsEngineStore((s) => s.refreshSupirServer);

  const task = useToolsEngineStore((s) => s.supirCurrentTask);
  const setTask = useToolsEngineStore((s) => s.setSupirCurrentTask);
  const applyProgress = useToolsEngineStore((s) => s.applySupirProgress);

  const batch = useToolsEngineStore((s) => s.supirBatch);
  const setBatch = useToolsEngineStore((s) => s.setSupirBatch);
  const resetBatch = useToolsEngineStore((s) => s.resetSupirBatch);

  const [busy, setBusy] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('single');
  const [inputDataUri, setInputDataUri] = useState<string | null>(null);
  const [batchFiles, setBatchFiles] = useState<string[]>([]);
  const [scale, setScale] = useState<2 | 3 | 4>(2);                // 默认 2× 更稳妥
  const [checkpoint, setCheckpoint] = useState<'F' | 'Q'>('F');    // 默认保真
  const [intensity, setIntensity] = useState<UpscaleIntensity>('conservative');
  const [highlightProtection, setHighlightProtection] = useState<boolean>(true);
  const [disablePostsharpen, setDisablePostsharpen] = useState<boolean>(true);
  const [prompt, setPrompt] = useState<string>('');
  const [negativePrompt, setNegativePrompt] = useState<string>('');
  // 高级覆盖参数 —— null = 走 preset
  const [overrideEnabled, setOverrideEnabled] = useState<boolean>(false);
  const [numSteps, setNumSteps] = useState<number>(25);
  const [cfgScale, setCfgScale] = useState<number>(4.0);
  const [restorationScale, setRestorationScale] = useState<number>(1.5);
  const [colorFix, setColorFix] = useState<'Wavelet' | 'AdaIn' | 'None'>('Wavelet');
  const [tileEncoder, setTileEncoder] = useState<number>(512);
  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);

  const batchCancelRef = useRef(false);
  useEffect(() => {
    batchCancelRef.current = batch.cancelRequested;
  }, [batch.cancelRequested]);

  useEffect(() => {
    void refreshProbe(false);
  }, [refreshProbe]);

  useEffect(() => {
    if (probe?.exists) void refreshServer(false);
  }, [probe, refreshServer]);

  useEffect(() => {
    if (!window.electronAPI?.on) return;
    const off = window.electronAPI.on('supir:progress', (raw) => {
      applyProgress(raw as SupirProgressPayload);
    });
    return () => off?.();
  }, [applyProgress]);

  const state: CardState = deriveState(probe, server, task, batch);
  // showUnloadHint 仍保留作为"模型已加载"角标提示;真正的"卸载"按钮已迁到顶部 CleanupBar
  const showUnloadHint =
    (state === 'server-ready' || state === 'completed' || state === 'failed') &&
    !!server?.raw?.loaded_checkpoint;

  async function doStartServer(): Promise<void> {
    setBusy('start');
    const r = await window.electronAPI.supir.startServer();
    if (!r.ok) {
      setBusy(null);
      toast.error('启动失败', r.error.message);
      return;
    }
    if (r.data.alreadyRunning) toast.info('SUPIR 服务已在运行');
    for (let i = 0; i < 60; i++) {
      await new Promise((res) => setTimeout(res, 500));
      const s = await window.electronAPI.supir.serverStatus();
      if (s.ok && s.data.reachable) {
        await refreshServer(true);
        setBusy(null);
        toast.success('SUPIR 服务运行中');
        return;
      }
    }
    setBusy(null);
    toast.error('服务启动超时（30s 仍未响应）', '看 HYPIR_Portable/logs/supir.log');
    await refreshServer(true);
  }

  async function doStopServer(): Promise<void> {
    const ok = await confirmDialog({
      title: '停止 SUPIR 服务',
      message: '确定停止 SUPIR 服务吗？',
      detail: '正在运行的任务会被丢弃；下次提交任务前需要重新启动。',
      okText: '停止',
      danger: true
    });
    if (!ok) return;
    setBusy('stop');
    const r = await window.electronAPI.supir.stopServer();
    setBusy(null);
    if (!r.ok) {
      toast.error('停止失败', r.error.message);
      return;
    }
    toast.success(r.data.stopped ? '服务已停止' : '已尝试停止');
    await refreshServer(true);
  }

  // 旧的 doUnloadModel() 函数已移除 —— 卸载模型功能迁到工具箱顶部"清理显存与缓存"统一栏

  function submitInput(inputPath: string) {
    const base = {
      inputPath,
      scale,
      checkpoint,
      prompt,
      negativePrompt,
      intensity,
      highlightProtection,
      disablePostsharpen
    };
    if (!overrideEnabled) return base;
    return {
      ...base,
      numSteps,
      cfgScale,
      restorationScale,
      colorFix,
      tileEncoder
    };
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
      suggestedName: `supir-in-${Date.now()}`
    });
    if (!saved.ok) {
      setBusy(null);
      toast.error('保存输入图失败', saved.error.message);
      return;
    }
    const r = await window.electronAPI.supir.submitTask(submitInput(saved.data.filePath));
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
        checkpoint,
        prompt,
        negativePrompt,
        intensity,
        highlightProtection,
        disablePostsharpen
      }
    });
    toast.success('SUPIR 任务已提交', `${intensityLabel(intensity)} · ckpt=${checkpoint}`);
  }

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
        const subm = await window.electronAPI.supir.submitTask(submitInput(cur.inputPath));
        if (!subm.ok) throw new Error(subm.error.message);
        const taskId = subm.data.taskId;
        setBatch((prev) => ({
          ...prev,
          items: prev.items.map((it) => (it.index === i ? { ...it, taskId } : it))
        }));
        setTask({
          taskId,
          status: 'queued',
          percent: 0,
          message: `批量 ${i + 1}/${items.length}：${cur.fileName}`,
          submittedInput: {
            inputPath: cur.inputPath,
            scale,
            checkpoint,
            prompt,
            negativePrompt,
            intensity,
            highlightProtection,
            disablePostsharpen
          }
        });

        let final: 'done' | 'failed' | 'cancelled' | null = null;
        while (final === null) {
          if (batchCancelRef.current) {
            try {
              await window.electronAPI.supir.cancelTask({ taskId });
            } catch {
              /* ignore */
            }
            final = 'cancelled';
            break;
          }
          await new Promise((res) => setTimeout(res, 1500));
          const st = await window.electronAPI.supir.taskStatus({ taskId });
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
    toast.success('批量处理结束', `共 ${items.length} 张，已完成 ${done} 张`);
  }

  function doCancelBatch(): void {
    if (!batch.active) return;
    setBatch((prev) => ({ ...prev, cancelRequested: true }));
    batchCancelRef.current = true;
    toast.info('已请求取消批量', '当前张跑完后停止后续任务');
  }

  async function doCancel(): Promise<void> {
    if (!task) return;
    const r = await window.electronAPI.supir.cancelTask({ taskId: task.taskId });
    if (!r.ok) {
      toast.error('取消失败', r.error.message);
      return;
    }
    toast.info('已请求取消');
  }

  function pickPreset(p: PromptPreset): void {
    setPrompt(mergePrompt(prompt, p));
  }

  const canSubmit = state === 'server-ready' || state === 'completed' || state === 'failed';

  return (
    <div className="mb-tools-pane">
      <div className="mb-tools-pane-left">
        <SupirStateBanner
          state={state}
          probe={probe}
          server={server}
          loading={probeLoading || serverLoading}
          busy={busy}
          showUnloadHint={showUnloadHint}
          onStart={doStartServer}
          onStop={doStopServer}
          onRefresh={() => void refreshProbe(true).then(() => refreshServer(true))}
        />

        {canSubmit || state === 'processing' ? (
          <>
            <div className="mb-tools-warn-card">
              <strong>AI 修复放大</strong>
              ：适合模糊、压缩损坏、低清照片，画质更强，但可能生成新的纹理细节。
              对于银发、白裙、高光、反光材质，建议使用<strong> 保守修复</strong>模式。
            </div>

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

            <h3 className="mb-tools-pane-section">引擎参数</h3>
            <div className="mb-tools-fields">
              <Field label="修复强度（默认保守修复，避免银发 / 白裙过度锐化）">
                <CustomSelect
                  value={intensity}
                  onChange={(v) => {
                    setIntensity(v);
                    setHighlightProtection(v !== 'strong');
                    if (v === 'conservative') {
                      setNumSteps(25);
                      setCfgScale(4.0);
                      setRestorationScale(1.5);
                      setColorFix('Wavelet');
                    } else if (v === 'standard') {
                      setNumSteps(40);
                      setCfgScale(7.5);
                      setRestorationScale(4.0);
                      setColorFix('Wavelet');
                    } else {
                      setNumSteps(50);
                      setCfgScale(9.0);
                      setRestorationScale(6.0);
                      setColorFix('AdaIn');
                    }
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
                <Field label="检查点">
                  <CustomSelect
                    value={checkpoint}
                    onChange={(v) => setCheckpoint(v as 'F' | 'Q')}
                    options={[
                      { value: 'F', label: 'v0F · 保真优先（推荐：少过锐）' },
                      { value: 'Q', label: 'v0Q · 质量优先（更激进创作）' }
                    ]}
                    disabled={state === 'processing'}
                  />
                </Field>
                <Field label="倍率">
                  <CustomSelect
                    value={String(scale)}
                    onChange={(v) => setScale(Number(v) as 2 | 3 | 4)}
                    options={[2, 3, 4].map((s) => ({ value: String(s), label: `${s}×` }))}
                    disabled={state === 'processing'}
                  />
                </Field>
              </div>

              <Field label="正向提示词（默认按反过度锐化方向走，无需填）">
                <textarea
                  className="mb-input mb-textarea"
                  rows={2}
                  placeholder="留空使用 mengbi 默认：natural details, soft texture, faithful restoration ..."
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  disabled={state === 'processing'}
                />
                <SupirPromptPicker
                  current={prompt}
                  onPick={pickPreset}
                  onClear={() => setPrompt('')}
                  disabled={state === 'processing'}
                />
              </Field>

              <div className="mb-tools-toggle-row">
                <ToggleField
                  label="高光保护"
                  hint="检测亮度高的像素，对其减少 SUPIR 贡献，避免银发 / 白裙脏纹理"
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

              <details
                open={showAdvanced}
                onToggle={(e) => setShowAdvanced((e.target as HTMLDetailsElement).open)}
              >
                <summary className="mb-tools-pane-section" style={{ cursor: 'pointer' }}>
                  高级参数（自定义 step / cfg / restoration / color fix / tile / 反向 prompt）
                </summary>
                <div className="mb-tools-fields" style={{ marginTop: 8 }}>
                  <ToggleField
                    label="启用自定义覆盖"
                    hint="开启后才用下方手调值；关闭则跟随强度预设的默认值"
                    value={overrideEnabled}
                    onChange={setOverrideEnabled}
                    disabled={state === 'processing'}
                  />

                  <Field label="反向提示词（留空使用 mengbi 默认）">
                    <textarea
                      className="mb-input mb-textarea"
                      rows={2}
                      placeholder="默认：over-sharpened, excessive details, harsh texture, plastic skin, dirty white clothes, halo, jagged edges, overprocessed ..."
                      value={negativePrompt}
                      onChange={(e) => setNegativePrompt(e.target.value)}
                      disabled={state === 'processing'}
                    />
                  </Field>

                  <div className="mb-tools-engine-row">
                    <Field label={`采样步数 (${numSteps})`}>
                      <input
                        type="range"
                        min={20}
                        max={100}
                        step={5}
                        value={numSteps}
                        onChange={(e) => setNumSteps(Number(e.target.value))}
                        disabled={state === 'processing' || !overrideEnabled}
                      />
                    </Field>
                    <Field label={`CFG Scale (${cfgScale})`}>
                      <input
                        type="range"
                        min={1}
                        max={12}
                        step={0.5}
                        value={cfgScale}
                        onChange={(e) => setCfgScale(Number(e.target.value))}
                        disabled={state === 'processing' || !overrideEnabled}
                      />
                    </Field>
                  </div>
                  <div className="mb-tools-engine-row">
                    <Field label={`Restoration Scale (${restorationScale})`}>
                      <input
                        type="range"
                        min={-1}
                        max={10}
                        step={0.5}
                        value={restorationScale}
                        onChange={(e) => setRestorationScale(Number(e.target.value))}
                        disabled={state === 'processing' || !overrideEnabled}
                      />
                    </Field>
                    <Field label="Color Fix">
                      <CustomSelect
                        value={colorFix}
                        onChange={(v) => setColorFix(v as 'Wavelet' | 'AdaIn' | 'None')}
                        options={[
                          { value: 'Wavelet', label: 'Wavelet（默认 / 最自然）' },
                          { value: 'AdaIn', label: 'AdaIn（统计匹配）' },
                          { value: 'None', label: '关闭' }
                        ]}
                        disabled={state === 'processing' || !overrideEnabled}
                      />
                    </Field>
                  </div>
                  <Field label="VAE Tile Encoder（爆显存就调小）">
                    <CustomSelect
                      value={String(tileEncoder)}
                      onChange={(v) => setTileEncoder(Number(v))}
                      options={[256, 384, 512, 768, 1024].map((t) => ({
                        value: String(t),
                        label: String(t)
                      }))}
                      disabled={state === 'processing'}
                    />
                  </Field>
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
                  <ZapIcon size={14} />{' '}
                  {state === 'processing' ? '处理中…' : `提交修复任务 (SUPIR-${checkpoint})`}
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
              {/* "卸载模型"按钮已迁移到工具箱顶部"清理显存与缓存"栏 */}
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
          <BatchResultList batch={batch} onClear={() => resetBatch()} />
        ) : state === 'completed' && task?.outputPath ? (
          <SupirCompletedResult outputPath={task.outputPath} task={task} />
        ) : state === 'failed' && task ? (
          <SupirFailedResult task={task} />
        ) : (
          <div className="mb-tools-placeholder">
            {state === 'server-ready'
              ? '左侧载入输入图（或切到「批量」选多张）并点「提交修复任务」'
              : '请先按左侧提示完成 SUPIR 引擎部署'}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── State banner ───────────────────────────────────────

function SupirStateBanner(props: {
  state: CardState;
  probe: SupirPortableProbe | null;
  server: SupirServerStatus | null;
  loading: boolean;
  busy: string | null;
  showUnloadHint: boolean;
  onStart: () => Promise<void>;
  onStop: () => Promise<void>;
  onRefresh: () => void;
}): JSX.Element {
  const { state, probe, server, busy, loading } = props;
  const meta = STATE_META[state];

  return (
    <div className={`mb-hypir-banner is-${state}`}>
      <div className="mb-hypir-banner-head">
        <span className={`mb-hypir-dot is-${meta.tone}`} />
        <span className="mb-hypir-banner-title">{meta.title}</span>
        <span className="mb-hypir-banner-spacer" />
        {probe?.portablePath && (
          <code className="mb-hypir-banner-path" title={probe.portablePath}>
            {probe.portablePath}
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
      <div className="mb-hypir-banner-body">{meta.desc(probe, server)}</div>

      <div className="mb-hypir-banner-actions">
        {state === 'not-installed' && (
          <span className="mb-tools-field-hint">
            SUPIR 复用 HYPIR 的便携包目录 / Python 运行时。请先去 HYPIR tab 完成 bootstrap。
          </span>
        )}
        {state === 'missing-models' && probe && (
          <>
            <button
              className="mb-btn mb-btn-secondary mb-btn-sm"
              onClick={() =>
                void window.electronAPI.storage.openPath({ targetPath: probe.portablePath })
              }
            >
              <FolderIcon size={13} /> 打开便携包目录
            </button>
            <span className="mb-tools-field-hint">
              按 README_supir.txt 三步走：① git clone SUPIR 到 app/SUPIR；② 下 SUPIR-v0F.ckpt 到
              models/supir/；③ 下 SDXL base 到 models/sdxl_base/
            </span>
          </>
        )}
        {state === 'server-stopped' && (
          <button
            className="mb-btn mb-btn-primary mb-btn-sm"
            disabled={busy === 'start'}
            onClick={() => void props.onStart()}
          >
            <ZapIcon size={13} />{' '}
            {busy === 'start' ? '启动中…（等服务起来 + 模型加载）' : '启动 SUPIR 服务'}
          </button>
        )}
        {(state === 'server-ready' ||
          state === 'processing' ||
          state === 'completed' ||
          state === 'failed') && (
          <details className="mb-tools-details" style={{ flex: 1 }}>
            <summary>
              服务运行中 · 展开看 GPU / checkpoint / 操作
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
                当前显存里的 checkpoint：
                {server?.raw?.loaded_checkpoint ? (
                  <code>SUPIR-{server.raw.loaded_checkpoint}</code>
                ) : (
                  '⌛ 首张图时按需加载'
                )}
              </div>
              <div>
                可用 ckpt：
                {probe?.supirV0F.exists && <code style={{ marginRight: 6 }}>v0F</code>}
                {probe?.supirV0Q.exists && <code>v0Q</code>}
              </div>
              <div>
                队列：{server?.raw?.queue_size ?? 0} | 活跃：{server?.raw?.active_tasks ?? 0}
              </div>
              <div className="mb-tools-row-buttons" style={{ marginTop: 8 }}>
                <button
                  className="mb-btn mb-btn-ghost mb-btn-sm"
                  onClick={() =>
                    probe &&
                    void window.electronAPI.storage.openPath({ targetPath: probe.portablePath })
                  }
                >
                  <FolderIcon size={12} /> 便携包目录
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

const STATE_META: Record<
  CardState,
  {
    title: string;
    tone: 'gray' | 'amber' | 'red' | 'green' | 'blue';
    desc: (
      p: SupirPortableProbe | null,
      s: SupirServerStatus | null
    ) => React.ReactNode;
  }
> = {
  loading: { title: '检测中…', tone: 'gray', desc: () => '正在探测 SUPIR Portable 资源' },
  'not-installed': {
    title: '便携包未就位',
    tone: 'red',
    desc: () => 'SUPIR 复用 HYPIR Portable 的 bundle。先去 HYPIR tab 完成 bootstrap。'
  },
  'missing-models': {
    title: '缺 SUPIR 源码 / 模型 / SDXL base',
    tone: 'amber',
    desc: (p) => (
      <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.5 }}>
        {!p?.supirSource.exists && (
          <li>
            SUPIR 源码缺失：<code>app/SUPIR/</code>
          </li>
        )}
        {!p?.supirV0F.exists && !p?.supirV0Q.exists && (
          <li>
            SUPIR 检查点缺失：<code>models/supir/SUPIR-v0F.ckpt</code> 或 v0Q 至少一个
          </li>
        )}
        {!p?.sdxlBase.exists && (
          <li>
            SDXL base 缺失：<code>models/sdxl_base/</code>
          </li>
        )}
      </ul>
    )
  },
  'gpu-unavailable': {
    title: 'GPU 不可用',
    tone: 'red',
    desc: () => 'PyTorch 看不到 CUDA。SUPIR 比 HYPIR 更吃显存，确认显卡 ≥ 16GB 可用。'
  },
  'server-stopped': {
    title: '服务未启动',
    tone: 'amber',
    desc: () => '依赖都齐了。点下方按钮启动 SUPIR 服务（端口 7866，与 HYPIR 7865 不冲突）。'
  },
  'server-ready': {
    title: '服务运行中',
    tone: 'green',
    desc: (_p, s) => `已连上 127.0.0.1:${s?.port ?? '?'}；等你提交任务。`
  },
  processing: {
    title: '正在处理',
    tone: 'blue',
    desc: () => 'SDXL 扩散采样中。SUPIR 比 HYPIR 慢 30-50%，但质量更高 + 更保真。'
  },
  completed: {
    title: '处理完成',
    tone: 'green',
    desc: () => '输出已落到 output 目录。右侧可复制 / 另存为 / 加入图库。'
  },
  failed: {
    title: '处理失败',
    tone: 'red',
    desc: () => '看右侧错误说明；显存不足请降 tile_encoder 或换 HYPIR / 保真放大。'
  }
};

// ─── Result blocks ─────────────────────────────────────

function SupirCompletedResult({
  outputPath,
  task
}: {
  outputPath: string;
  task: SupirCurrentTask;
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
        defaultName={`supir-${task.submittedInput?.checkpoint ?? 'F'}-${task.taskId.slice(0, 8)}`}
        sourceModel={`SUPIR-${task.submittedInput?.checkpoint ?? '?'}`}
        params={{
          scale: task.submittedInput?.scale,
          checkpoint: task.submittedInput?.checkpoint,
          prompt: task.submittedInput?.prompt,
          intensity: task.submittedInput?.intensity
        }}
      />
      <ResultActions
        dataUri={dataUri}
        kind="upscale"
        defaultName={`supir-${task.submittedInput?.checkpoint ?? 'F'}-${task.taskId.slice(0, 8)}`}
        sourceModel={`SUPIR-${task.submittedInput?.checkpoint ?? '?'}`}
        params={{}}
      >
        <img src={dataUri} className="mb-tools-result-img" alt="SUPIR 修复结果" />
      </ResultActions>
      <SupirResultInfoCard task={task} outputPath={outputPath} />
    </>
  );
}

function SupirResultInfoCard({
  task,
  outputPath
}: {
  task: SupirCurrentTask;
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
            {info?.num_steps && (
              <span className="mb-tools-result-info-sub">
                （{info.num_steps} 步，cfg={info.cfg_scale}, rest={info.restoration_scale}）
              </span>
            )}
          </span>
        </div>
        <div>
          <span className="mb-tools-result-info-k">高光保护</span>
          <span className="mb-tools-result-info-v">
            {info?.highlight_protection ? '开' : '关'}
            {info?.color_fix && (
              <span className="mb-tools-result-info-sub"> · color_fix={info.color_fix}</span>
            )}
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

function SupirFailedResult({ task }: { task: SupirCurrentTask }): JSX.Element {
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

// ─── 批量子组件（与 HypirPanel 等同） ─────────────

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
  task: SupirCurrentTask | null;
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

function SupirPromptPicker(props: {
  current: string;
  onPick: (p: PromptPreset) => void;
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

// ─── 工具函数 ──────────────────────────────────────────

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
