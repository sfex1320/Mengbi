/**
 * ComfyUI 串行运行队列（并发=1）。区别于生图侧的 3 并发：单 GPU 顺序执行，
 * 并行提交只会抢显存。批量循环（第五阶段）也复用这个队列，逐 iteration 入队。
 *
 * 职责：取队首 → 跑 runEngine → 落库（store.updateRun）→ 推送 run-progress / run-done / queue。
 * 运行记录行由 IPC 层先 createRun(pending) 建好，这里只更新状态。
 */
import type { WebContents } from 'electron';
import { runIteration } from './runEngine';
import { updateRun } from './store';
import type {
  RunProgressPayload,
  RunDonePayload,
  QueuePayload,
  OutputFile,
  InputControl,
  Binding
} from '@shared/comfyui';

export interface QueuedRun {
  runId: string;
  batchId: string;
  iterationIndex: number;
  templateId: string | null;
  host: string;
  token?: string | null;
  clientId: string;
  workflowJson: string;
  controlValues: Record<string, unknown>;
  controls?: InputControl[];
  bindings?: Binding[];
  /** 输出限定：只读这些节点 id 的输出（空/未传 = 全部） */
  outputNodeIds?: string[];
  fileTaskId: number;
  sender: WebContents;
  /** feedback 模式：把上一轮输出路径回灌到这个输入控件 */
  feedbackToControlId?: string;
}

interface BatchCounter {
  total: number;
  pending: number;
  running: number;
  done: number;
  failed: number;
}

/** 看起来像"连接断了"的错误（而非普通执行失败/慢） */
const CONN_ERR =
  /ECONNREFUSED|ECONNRESET|ETIMEDOUT|ERR_CONNECTION|ERR_TIMED_OUT|net::ERR_CONNECTION|fetch failed|socket hang up|未连接/i;

class SerialRunQueue {
  private queue: QueuedRun[] = [];
  private running = false;
  private controllers = new Map<string, AbortController>();
  private batches = new Map<string, BatchCounter>();
  private batchOpts = new Map<string, { continueOnFail: boolean }>();
  private lastOutput = new Map<string, string>(); // batchId → 上一轮首个输出路径（feedback 用）
  private paused = false;

  pause(): void {
    this.paused = true;
  }
  resume(): void {
    this.paused = false;
    void this.drain();
  }
  isPaused(): boolean {
    return this.paused;
  }

  enqueue(items: QueuedRun[], opts?: { continueOnFail?: boolean }): void {
    if (items.length === 0) return;
    const batchId = items[0].batchId;
    const c = this.batches.get(batchId) ?? { total: 0, pending: 0, running: 0, done: 0, failed: 0 };
    c.total += items.length;
    c.pending += items.length;
    this.batches.set(batchId, c);
    this.batchOpts.set(batchId, { continueOnFail: opts?.continueOnFail ?? true });
    this.queue.push(...items);
    this.emitQueue(items[0].sender, batchId);
    void this.drain();
  }

  /** 跳过：等同取消该 run（中断在跑的或丢弃排队的） */
  skip(runId: string): void {
    this.cancel({ runId });
  }

  private purgeBatch(batchId: string, reason: 'cancelled'): void {
    this.queue = this.queue.filter((q) => {
      if (q.batchId !== batchId) return true;
      updateRun(q.runId, { status: reason, finishedAt: new Date().toISOString() });
      const c = this.batches.get(q.batchId);
      if (c) {
        c.pending = Math.max(0, c.pending - 1);
        c.failed += 1;
      }
      return false;
    });
  }

  cancel(opts: { batchId?: string; runId?: string }): { cancelled: number } {
    let n = 0;
    // 取消队列中尚未开始的
    if (opts.batchId || opts.runId) {
      this.queue = this.queue.filter((q) => {
        const hit = (opts.batchId && q.batchId === opts.batchId) || (opts.runId && q.runId === opts.runId);
        if (hit) {
          n++;
          updateRun(q.runId, { status: 'cancelled', finishedAt: new Date().toISOString() });
          const c = this.batches.get(q.batchId);
          if (c) {
            c.pending = Math.max(0, c.pending - 1);
            c.failed += 1; // 取消计入"未成功"，便于结果统计；UI 可单列
          }
        }
        return !hit;
      });
    }
    // 中断正在跑的
    for (const [runId, ctrl] of this.controllers.entries()) {
      const match =
        (opts.runId && runId === opts.runId) ||
        (opts.batchId && this.runningBatchId === opts.batchId);
      if (match) {
        ctrl.abort();
        n++;
      }
    }
    return { cancelled: n };
  }

  private runningBatchId: string | null = null;

  private async drain(): Promise<void> {
    if (this.running || this.paused) return;
    const item = this.queue.shift();
    if (!item) return;
    this.running = true;
    this.runningBatchId = item.batchId;
    await this.execute(item).catch(() => {
      /* execute 内部已 catch；此处兜底 */
    });
    this.running = false;
    this.runningBatchId = null;
    if (this.queue.length > 0) void this.drain();
  }

  private async execute(item: QueuedRun): Promise<void> {
    const ctrl = new AbortController();
    this.controllers.set(item.runId, ctrl);
    const startedAt = Date.now();
    const c = this.batches.get(item.batchId);
    if (c) {
      c.pending = Math.max(0, c.pending - 1);
      c.running += 1;
    }
    updateRun(item.runId, { status: 'running' });

    // feedback：把上一轮输出路径回灌进本轮输入控件
    if (item.feedbackToControlId) {
      const prevPath = this.lastOutput.get(item.batchId);
      if (prevPath) item.controlValues = { ...item.controlValues, [item.feedbackToControlId]: prevPath };
    }

    const send = (channel: string, payload: unknown): void => {
      if (!item.sender.isDestroyed()) item.sender.send(channel, payload);
    };
    const pushProgress = (p: {
      phase: string;
      percent: number;
      currentNode?: string | null;
      perNode?: Record<string, { value: number; max: number }>;
      queueRemaining?: number;
    }): void => {
      const payload: RunProgressPayload = {
        runId: item.runId,
        batchId: item.batchId,
        iterationIndex: item.iterationIndex,
        promptId: null,
        phase: p.phase,
        percent: p.percent,
        currentNode: p.currentNode ?? null,
        perNode: p.perNode,
        queueRemaining: p.queueRemaining
      };
      send('comfyui:run-progress', payload);
    };

    let status: 'done' | 'failed' | 'cancelled' = 'done';
    let outputFiles: OutputFile[] = [];
    let error: string | undefined;
    try {
      outputFiles = await runIteration({
        host: item.host,
        token: item.token,
        clientId: item.clientId,
        workflowJson: item.workflowJson,
        controlValues: item.controlValues,
        controls: item.controls,
        bindings: item.bindings,
        outputNodeIds: item.outputNodeIds,
        fileTaskId: item.fileTaskId,
        signal: ctrl.signal,
        onPromptId: (promptId) => updateRun(item.runId, { promptId }),
        onUploaded: (map) => updateRun(item.runId, { uploadedFiles: map }),
        onProgress: pushProgress
      });
      status = 'done';
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (ctrl.signal.aborted || /abort/i.test(msg)) {
        status = 'cancelled';
        error = '已取消';
      } else if (CONN_ERR.test(msg)) {
        // 连接断了 → 自动暂停（剩余轮次留在队列），等用户重连后点继续
        status = 'failed';
        error = `连接已断开，已自动暂停批次：${msg}`;
        this.pause();
        send('comfyui:status', {
          phase: 'disconnected',
          host: item.host,
          reachable: false,
          managed: false,
          pid: null,
          message: '连接断开，批次已暂停。重连后点「继续」'
        });
      } else {
        status = 'failed';
        error = msg;
      }
    } finally {
      this.controllers.delete(item.runId);
    }

    const finishedAt = new Date().toISOString();
    updateRun(item.runId, {
      status,
      outputFiles: status === 'done' ? outputFiles : null,
      errorMessage: error ?? null,
      finishedAt,
      durationMs: Date.now() - startedAt
    });

    if (c) {
      c.running = Math.max(0, c.running - 1);
      if (status === 'done') c.done += 1;
      else c.failed += 1;
    }

    // feedback：记录本轮首个输出路径，供下一轮回灌
    if (status === 'done') {
      const firstPath = outputFiles.find((o) => o.path)?.path;
      if (firstPath) this.lastOutput.set(item.batchId, firstPath);
    }
    // 失败即停（非 continueOnFail）→ 清掉该批次剩余排队任务
    if (status === 'failed' && this.batchOpts.get(item.batchId)?.continueOnFail === false) {
      this.purgeBatch(item.batchId, 'cancelled');
    }

    const donePayload: RunDonePayload = {
      runId: item.runId,
      batchId: item.batchId,
      iterationIndex: item.iterationIndex,
      status,
      outputFiles: status === 'done' ? outputFiles : undefined,
      error
    };
    send('comfyui:run-done', donePayload);
    this.emitQueue(item.sender, item.batchId);

    // 批次彻底结束（无排队、无在跑、未暂停）→ 清理该批次的所有内存状态，防泄漏与跨批次串味。
    // 暂停时仍有排队项 → 不清理，等恢复跑完再清。
    const stillQueued = this.queue.some((q) => q.batchId === item.batchId);
    if (!stillQueued && !this.paused && c && c.pending === 0 && c.running === 0) {
      this.lastOutput.delete(item.batchId);
      this.batches.delete(item.batchId);
      this.batchOpts.delete(item.batchId);
    }
  }

  private emitQueue(sender: WebContents, batchId: string): void {
    const c = this.batches.get(batchId);
    if (!c || sender.isDestroyed()) return;
    const payload: QueuePayload = {
      batchId,
      total: c.total,
      pending: c.pending,
      running: c.running,
      done: c.done,
      failed: c.failed,
      paused: this.paused
    };
    sender.send('comfyui:queue', payload);
  }

  statusOf(batchId: string): BatchCounter | null {
    return this.batches.get(batchId) ?? null;
  }
}

let _queue: SerialRunQueue | null = null;
export function getRunQueue(): SerialRunQueue {
  if (!_queue) _queue = new SerialRunQueue();
  return _queue;
}

// 单调递增的文件名整型 id（编排器没有 generation_tasks.id）
let _fileTaskCounter = Math.floor(Date.now() / 1000) % 90000;
export function nextFileTaskId(): number {
  _fileTaskCounter = (_fileTaskCounter + 1) % 100000;
  return _fileTaskCounter;
}
