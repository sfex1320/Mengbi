import { toast } from '@/store/toastStore';
import { useComfyuiStore } from '@/store/comfyuiStore';
import { useComfyuiRunStore } from '@/store/comfyuiRunStore';

const PHASE_TEXT: Record<string, string> = {
  submitting: '提交中',
  queued: '排队中',
  executing: '执行中',
  downloading: '下载结果',
  done: '完成'
};

/**
 * 运行控件（内联，放在连接条同一行末尾，随顶栏冻结）：运行/取消 + 紧凑进度。
 * 单次运行用当前工作流 + 参数面板里的控件值；批量循环仍在「批量循环」tab 触发。
 */
export function RunControl(): JSX.Element {
  const { running, progress, currentBatchId, startRun } = useComfyuiRunStore();
  const activeWorkflowId = useComfyuiStore((s) => s.activeWorkflowId);
  const activeWorkflowJson = useComfyuiStore((s) => s.activeWorkflowJson);
  const ready = !!(activeWorkflowId || activeWorkflowJson);

  async function run(): Promise<void> {
    const s = useComfyuiStore.getState();
    if (!s.activeWorkflowId && !s.activeWorkflowJson) {
      toast.error('请先导入或加载一个工作流');
      return;
    }
    const r = await window.electronAPI.comfyui.runSingle({
      workflowId: s.activeWorkflowId ?? undefined,
      workflowJson: s.activeWorkflowId ? undefined : (s.activeWorkflowJson ?? undefined),
      controlValues: s.controlValues,
      controls: s.activeControls,
      bindings: s.activeBindings,
      outputNodeIds: s.outputNodeIds.length ? s.outputNodeIds : undefined
    });
    if (!r.ok) {
      toast.error(r.error.message, r.error.hint);
      return;
    }
    startRun(r.data.runId, r.data.batchId);
  }

  async function cancel(): Promise<void> {
    if (currentBatchId) await window.electronAPI.comfyui.cancel({ batchId: currentBatchId });
  }

  const pct = progress?.percent ?? 0;

  return (
    <div className="mb-cfy-runinline">
      {!running ? (
        <button
          className="mb-btn mb-btn-sm mb-btn-primary"
          onClick={() => void run()}
          disabled={!ready}
          title={ready ? '运行当前工作流' : '先导入工作流'}
        >
          运行
        </button>
      ) : (
        <button className="mb-btn mb-btn-sm mb-btn-danger" onClick={() => void cancel()}>
          取消
        </button>
      )}
      {running && (
        <span className="mb-cfy-progress-inline" title={`${progress?.phase ?? ''} ${pct}%`}>
          <span className="mb-cfy-progress-inline-track">
            <i style={{ width: `${pct}%` }} />
          </span>
          <span className="mb-cfy-progress-inline-label">
            {PHASE_TEXT[progress?.phase ?? ''] ?? progress?.phase ?? '准备中'} {pct}%
          </span>
        </span>
      )}
    </div>
  );
}
