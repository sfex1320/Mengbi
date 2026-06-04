import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { toast } from '@/store/toastStore';
import { WorkflowIcon } from '@/components/Icon';
import { useComfyuiStore, type ComfyLeftTab } from '@/store/comfyuiStore';
import { useComfyuiRunStore } from '@/store/comfyuiRunStore';
import { ConnectionBar } from './ConnectionBar';
import { ImportPanel } from './ImportPanel';
import { RunBar } from './RunBar';
import { LoopPanel } from './LoopPanel';
import { RunRecords } from './RunRecords';
import { GraphModal } from './GraphModal';
import { ImageOutput } from './outputs/ImageOutput';
import type {
  ConnectionStatus,
  RunProgressPayload,
  RunDonePayload,
  QueuePayload
} from '@shared/comfyui';
import './ComfyUI.css';

const TABS: Array<{ key: ComfyLeftTab; label: string }> = [
  { key: 'params', label: '参数' },
  { key: 'batch', label: '批量循环' },
  { key: 'records', label: '运行记录' }
];

export default function ComfyUIPage(): JSX.Element {
  const setConn = useComfyuiStore((s) => s.setConn);
  const leftTab = useComfyuiStore((s) => s.leftTab);
  const setLeftTab = useComfyuiStore((s) => s.setLeftTab);
  const activeGraph = useComfyuiStore((s) => s.activeGraph);
  const { outputs, setConnStatus, setProgress, setQueue, setRunning, finishRun, clearOutputs } =
    useComfyuiRunStore();
  const [graphOpen, setGraphOpen] = useState(false);
  // 输出本会话累积保留：不在切换工作流/新运行时清空，只在「清空」按钮或重启 app 时清。

  useEffect(() => {
    void window.electronAPI.comfyui.getConfig().then((r) => {
      if (r.ok)
        setConn({
          host: r.data.host,
          launchCommand: r.data.launchCommand,
          launchCwd: r.data.launchCwd,
          hasAuthToken: r.data.hasAuthToken
        });
    });
    void window.electronAPI.comfyui.status().then((r) => {
      if (r.ok) setConnStatus(r.data);
    });
  }, [setConn, setConnStatus]);

  useEffect(() => {
    const offStatus = window.electronAPI.on('comfyui:status', (p) =>
      setConnStatus(p as ConnectionStatus)
    );
    const offProgress = window.electronAPI.on('comfyui:run-progress', (p) =>
      setProgress(p as RunProgressPayload)
    );
    const offQueue = window.electronAPI.on('comfyui:queue', (p) => {
      const q = p as QueuePayload;
      setQueue(q);
      // 整批跑完（没有等待、没有在跑，且不是暂停态）→ 收尾。
      // 暂停（或断连自动暂停）时仍可能有剩余排队项，保持 running 以便显示「继续/停止」。
      if (q.total > 0 && q.pending === 0 && q.running === 0 && !q.paused) {
        setRunning(false);
        if (q.total > 1) toast.success('批量完成', `成功 ${q.done} · 失败 ${q.failed} / 共 ${q.total}`);
      }
    });
    const offDone = window.electronAPI.on('comfyui:run-done', (p) => {
      const d = p as RunDonePayload;
      finishRun(d.status, d.outputFiles, d.error);
      if (d.status === 'failed') toast.error(`运行失败 · 迭代 #${d.iterationIndex}`, d.error);
    });
    return () => {
      offStatus();
      offProgress();
      offQueue();
      offDone();
    };
  }, [setConnStatus, setProgress, setQueue, setRunning, finishRun]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.2 }}
      className="mb-cfy-root"
    >
      {/* 顶栏冻结：连接条（含末尾运行按钮），上下滑动时固定不动 */}
      <div className="mb-cfy-topbar">
        <ConnectionBar />
      </div>
      <div className="mb-cfy-main">
        <div className="mb-cfy-left">
          <ImportPanel />
          <div className="mb-cfy-tabs">
            {TABS.map((t) => (
              <button
                key={t.key}
                className={`mb-cfy-tab ${leftTab === t.key ? 'is-active' : ''}`}
                onClick={() => setLeftTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="mb-cfy-tabbody">
            {leftTab === 'params' && <RunBar />}
            {leftTab === 'batch' && <LoopPanel />}
            {leftTab === 'records' && <RunRecords />}
          </div>
        </div>
        <div className="mb-cfy-right">
          <div className="mb-cfy-output-card mb-card mb-cfy-output-full">
            <div className="mb-cfy-output-head">
              <span className="mb-cfy-section-title">输出（本次 {outputs.length}）</span>
              {outputs.length > 0 && (
                <button className="mb-btn mb-btn-sm mb-btn-ghost" onClick={clearOutputs}>
                  清空
                </button>
              )}
            </div>
            <ImageOutput outputs={outputs} />
          </div>
        </div>
      </div>

      {/* 右下角悬浮：节点流程图 */}
      <button
        className="mb-cfy-graph-fab"
        onClick={() => setGraphOpen(true)}
        disabled={!activeGraph}
        title={activeGraph ? '打开节点流程图' : '先导入工作流'}
      >
        <WorkflowIcon size={20} />
        <span>节点图</span>
      </button>
      <GraphModal open={graphOpen} onClose={() => setGraphOpen(false)} />
    </motion.div>
  );
}
