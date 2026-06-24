import { useState } from 'react';
import { toast } from '@/store/toastStore';
import { CustomSelect } from '@/components/CustomSelect';
import { useComfyuiStore } from '@/store/comfyuiStore';
import { useComfyuiRunStore } from '@/store/comfyuiRunStore';
import { ClampNumberInput } from '@/pages/SmartCanvas/nodePanel/consoleControls';
import type { LoopConfig, LoopMode, LoopVar } from '@shared/comfyui';

const MODES: Array<{ key: LoopMode; label: string }> = [
  { key: 'single', label: '单次' },
  { key: 'range', label: '参数递增' },
  { key: 'list', label: '列表' },
  { key: 'cartesian', label: '组合(笛卡尔积)' },
  { key: 'formula', label: '公式' },
  { key: 'feedback', label: '结果回灌' }
];

const MAX_ITER = 500;

interface VarRow {
  controlId: string;
  kind: 'range' | 'list';
  from: string;
  to: string;
  step: string;
  valuesText: string;
}

function parseValues(text: string): Array<string | number> {
  return text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (s !== '' && !Number.isNaN(Number(s)) ? Number(s) : s));
}

function rangeLen(from: number, to: number, step: number): number {
  const s = step === 0 ? 1 : Math.abs(step);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.max(0, Math.floor(Math.abs(to - from) / s + 1e-9) + 1);
}

export function LoopPanel(): JSX.Element {
  const { activeControls, activeWorkflowId, activeWorkflowJson, activeBindings, controlValues, outputNodeIds } =
    useComfyuiStore();
  const { running, queue, progress } = useComfyuiRunStore();

  const [mode, setMode] = useState<LoopMode>('single');
  const [rows, setRows] = useState<VarRow[]>([]);
  const [formulaCount, setFormulaCount] = useState(5);
  const [formulaItems, setFormulaItems] = useState<Array<{ controlId: string; expr: string }>>([]);
  const [fbControl, setFbControl] = useState('');
  const [fbMax, setFbMax] = useState(4);
  const [continueOnFail, setContinueOnFail] = useState(true);

  const ctrlOpts = activeControls.map((c) => ({ value: c.id, label: c.label }));
  const firstCtrl = activeControls[0]?.id ?? '';
  const paused = queue?.paused ?? false;

  function addRow(): void {
    setRows((r) => [
      ...r,
      { controlId: firstCtrl, kind: mode === 'list' ? 'list' : 'range', from: '20', to: '40', step: '5', valuesText: '' }
    ]);
  }
  function setRow(i: number, patch: Partial<VarRow>): void {
    setRows((r) => r.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  }
  function delRow(i: number): void {
    setRows((r) => r.filter((_, idx) => idx !== i));
  }

  // 预估任务数（不真建笛卡尔积）
  function estimate(): number {
    if (mode === 'single') return 1;
    if (mode === 'formula') return Math.max(1, formulaCount);
    if (mode === 'feedback') return Math.max(1, fbMax);
    const lens = rows.map((r) =>
      r.kind === 'range' ? rangeLen(Number(r.from), Number(r.to), Number(r.step)) : parseValues(r.valuesText).length
    );
    // 有空变量 → 视为 0（后端会因「某个循环变量没有可用值」报错，这里提前禁用运行）
    if (lens.length === 0 || lens.some((n) => n === 0)) return 0;
    if (mode === 'cartesian') return lens.reduce((a, b) => a * b, 1);
    return Math.min(...lens);
  }
  const planned = estimate();
  const overLimit = planned > MAX_ITER;

  function buildConfig(): LoopConfig {
    if (mode === 'single') return { mode: 'single', continueOnFail };
    if (mode === 'formula')
      return {
        mode: 'formula',
        formula: { count: formulaCount, items: formulaItems.filter((x) => x.controlId && x.expr) },
        continueOnFail
      };
    if (mode === 'feedback')
      return { mode: 'feedback', feedback: { toControlId: fbControl, maxIterations: fbMax }, continueOnFail };
    const vars: LoopVar[] = rows.map((r) =>
      r.kind === 'range'
        ? { controlId: r.controlId, kind: 'range', from: Number(r.from), to: Number(r.to), step: Number(r.step) }
        : { controlId: r.controlId, kind: 'list', values: parseValues(r.valuesText) }
    );
    return { mode, vars, continueOnFail };
  }

  async function run(): Promise<void> {
    if (!activeWorkflowId && !activeWorkflowJson) {
      toast.error('请先导入或加载一个工作流');
      return;
    }
    if (overLimit) {
      toast.error(`预计 ${planned} 轮，超过上限 ${MAX_ITER}`, '请缩小范围（笛卡尔积尤其容易爆炸）');
      return;
    }
    if (mode === 'feedback' && !fbControl.trim()) {
      toast.error('请先选择要回灌的图片控件', '否则反馈循环不会生效');
      return;
    }
    if (mode === 'formula') {
      const active = formulaItems.filter((x) => x.controlId && x.expr);
      if (!active.length) {
        toast.error('请先填写公式', '至少一个控件的表达式不为空');
        return;
      }
      // 轻量预校验：只允许 数字 / + - * / % ( ) . 和变量 i（真正求值在后端 expr-eval，安全无 eval）
      const bad = active.find((x) => !/^[\s0-9.+\-*/%()i]+$/i.test(x.expr) || /\/\s*0(?![.0-9])/.test(x.expr));
      if (bad) {
        toast.error('公式不合法', `「${bad.expr}」只允许 数字 / + - * / % ( ) 与变量 i，且不能除以 0`);
        return;
      }
    }
    const r = await window.electronAPI.comfyui.runBatch({
      workflowId: activeWorkflowId ?? undefined,
      workflowJson: activeWorkflowId ? undefined : (activeWorkflowJson ?? undefined),
      controlValues,
      controls: activeControls,
      bindings: activeBindings,
      outputNodeIds: outputNodeIds.length ? outputNodeIds : undefined,
      loopConfig: buildConfig()
    });
    if (!r.ok) {
      toast.error(r.error.message, r.error.hint);
      return;
    }
    useComfyuiRunStore.getState().startRun(r.data.batchId, r.data.batchId);
    toast.info('已加入队列', `共 ${r.data.plannedCount} 轮`);
  }

  async function cancel(): Promise<void> {
    const bid = useComfyuiRunStore.getState().currentBatchId;
    if (bid) await window.electronAPI.comfyui.cancel({ batchId: bid });
  }
  async function skipCurrent(): Promise<void> {
    const rid = useComfyuiRunStore.getState().progress?.runId;
    if (rid) await window.electronAPI.comfyui.skip({ runId: rid });
  }
  async function pause(): Promise<void> {
    await window.electronAPI.comfyui.pause();
  }
  async function resume(): Promise<void> {
    await window.electronAPI.comfyui.resume();
  }

  const showRows = mode === 'range' || mode === 'list' || mode === 'cartesian';

  return (
    <section className="mb-cfy-loop mb-card">
      <div className="mb-cfy-loop-modes">
        {MODES.map((m) => (
          <button key={m.key} className={`mb-cfy-modepill ${mode === m.key ? 'is-active' : ''}`} onClick={() => setMode(m.key)}>
            {m.label}
          </button>
        ))}
      </div>

      {activeControls.length === 0 && (
        <div className="mb-cfy-form-empty">先导入工作流并识别出参数，才能配置循环。</div>
      )}

      {showRows && (
        <div className="mb-cfy-loop-rows">
          {rows.map((r, i) => (
            <div key={i} className="mb-cfy-loop-row">
              <CustomSelect value={r.controlId} onChange={(v) => setRow(i, { controlId: v })} options={ctrlOpts} placeholder="选参数…" />
              {mode === 'cartesian' && (
                <div className="mb-cfy-kind">
                  <CustomSelect
                    value={r.kind}
                    onChange={(v) => setRow(i, { kind: v as 'range' | 'list' })}
                    options={[{ value: 'range', label: '递增' }, { value: 'list', label: '列表' }]}
                  />
                </div>
              )}
              {r.kind === 'range' && mode !== 'list' ? (
                <div className="mb-cfy-range">
                  <input className="mb-input" type="number" value={r.from} onFocus={(e) => e.currentTarget.select()} onChange={(e) => setRow(i, { from: e.target.value })} placeholder="起" />
                  <input className="mb-input" type="number" value={r.to} onFocus={(e) => e.currentTarget.select()} onChange={(e) => setRow(i, { to: e.target.value })} placeholder="止" />
                  <input className="mb-input" type="number" value={r.step} onFocus={(e) => e.currentTarget.select()} onChange={(e) => setRow(i, { step: e.target.value })} placeholder="步长" />
                </div>
              ) : (
                <input className="mb-input" value={r.valuesText} onChange={(e) => setRow(i, { valuesText: e.target.value })} placeholder="值1, 值2, 值3" />
              )}
              <button className="mb-btn mb-btn-sm mb-btn-ghost" onClick={() => delRow(i)}>✕</button>
            </div>
          ))}
          <button className="mb-btn mb-btn-sm mb-btn-ghost" onClick={addRow} disabled={!firstCtrl}>
            + 添加变量
          </button>
        </div>
      )}

      {mode === 'formula' && (
        <div className="mb-cfy-loop-rows">
          <label className="mb-cfy-field">
            <span className="mb-label">总轮数 n</span>
            <ClampNumberInput min={1} max={MAX_ITER} value={formulaCount} onCommit={setFormulaCount} />
          </label>
          {formulaItems.map((it, i) => (
            <div key={i} className="mb-cfy-loop-row">
              <CustomSelect
                value={it.controlId}
                onChange={(v) => setFormulaItems((a) => a.map((x, idx) => (idx === i ? { ...x, controlId: v } : x)))}
                options={ctrlOpts}
                placeholder="选参数…"
              />
              <input className="mb-input" value={it.expr} placeholder="如 1000 + i  /  max(0.2, 1 - i*0.1)" onChange={(e) => setFormulaItems((a) => a.map((x, idx) => (idx === i ? { ...x, expr: e.target.value } : x)))} />
              <button className="mb-btn mb-btn-sm mb-btn-ghost" onClick={() => setFormulaItems((a) => a.filter((_, idx) => idx !== i))}>✕</button>
            </div>
          ))}
          <button className="mb-btn mb-btn-sm mb-btn-ghost" onClick={() => setFormulaItems((a) => [...a, { controlId: firstCtrl, expr: '' }])}>
            + 添加公式
          </button>
          <div className="mb-cfy-loop-hint">可用变量 i(当前轮,从0)/n(总轮数) + 函数 min/max/abs/round/floor/ceil/sqrt/pow/rand()。安全表达式，不执行代码。</div>
        </div>
      )}

      {mode === 'feedback' && (
        <div className="mb-cfy-loop-rows">
          <label className="mb-cfy-field">
            <span className="mb-label">回灌到（图片输入控件）</span>
            <CustomSelect value={fbControl} onChange={setFbControl} options={ctrlOpts} placeholder="选图片控件…" />
          </label>
          <label className="mb-cfy-field">
            <span className="mb-label">最大轮数</span>
            <ClampNumberInput min={1} max={MAX_ITER} value={fbMax} onCommit={setFbMax} />
          </label>
          <div className="mb-cfy-loop-hint">每轮把上一轮的首个输出图作为下一轮该控件的输入（接龙式迭代）。</div>
        </div>
      )}

      <label className="mb-cfy-field-switch">
        <input type="checkbox" checked={continueOnFail} onChange={(e) => setContinueOnFail(e.target.checked)} />
        <span className="mb-label">失败继续（取消勾选＝失败即停）</span>
      </label>

      {mode !== 'single' && activeControls.length > 0 && (
        <div className={`mb-cfy-estimate ${overLimit ? 'is-over' : ''}`}>
          预计任务数：{planned} / 上限 {MAX_ITER}
          {overLimit && '（超限，请缩小范围）'}
        </div>
      )}

      <div className="mb-cfy-run-actions">
        {!running ? (
          <button
            className="mb-btn mb-btn-primary"
            onClick={() => void run()}
            disabled={activeControls.length === 0 || overLimit || planned === 0 || (mode === 'feedback' && !fbControl)}
          >
            批量运行
          </button>
        ) : (
          <>
            {!paused ? (
              <button className="mb-btn mb-btn-sm mb-btn-ghost" onClick={() => void pause()}>暂停</button>
            ) : (
              <button className="mb-btn mb-btn-sm" onClick={() => void resume()}>继续</button>
            )}
            <button className="mb-btn mb-btn-sm mb-btn-ghost" onClick={() => void skipCurrent()}>跳过当前</button>
            <button className="mb-btn mb-btn-danger" onClick={() => void cancel()}>停止</button>
          </>
        )}
        {queue && (
          <div className="mb-cfy-progress">
            <div className="mb-cfy-progress-bar" style={{ width: `${queue.total ? Math.round(((queue.done + queue.failed) / queue.total) * 100) : 0}%` }} />
            <span className="mb-cfy-progress-label">
              {paused ? '已暂停 · ' : ''}{queue.done + queue.failed}/{queue.total} · 成功 {queue.done} 失败 {queue.failed}
              {progress?.percent ? ` · 本轮 ${progress.percent}%` : ''}
            </span>
          </div>
        )}
      </div>
    </section>
  );
}
