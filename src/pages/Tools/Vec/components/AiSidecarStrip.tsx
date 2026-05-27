/**
 * AiSidecarStrip —— AI · StarVector 的状态条 + 启动/停止按钮。
 *
 * 仅当 selectedMode === 'starvector' 时显示。
 * 把"模型路径是否配置 / sidecar 是否在线"展开成一条信息;并提供一键启停。
 */
import { useEffect, useState } from 'react';
import { useVecStore } from '@/store/vecStore';
import { toast } from '@/store/toastStore';
import { WrenchIcon } from '@/components/Icon';

interface ProbeState {
  modelPathConfigured: boolean;
  modelPathExists: boolean;
  sidecarReachable: boolean;
  available: boolean;
  modelPath: string | null;
}

export function AiSidecarStrip(): JSX.Element | null {
  const selectedMode = useVecStore((s) => s.selectedMode);
  const setModeAvailability = useVecStore((s) => s.setModeAvailability);
  const [probe, setProbe] = useState<ProbeState | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh(): Promise<void> {
    const r = await window.electronAPI.vec.starvectorProbe();
    if (r.ok) {
      setProbe(r.data);
      setModeAvailability('starvector', r.data.modelPathExists);
    }
  }

  useEffect(() => {
    if (selectedMode !== 'starvector') return;
    void refresh();
    const t = setInterval(() => void refresh(), 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMode]);

  if (selectedMode !== 'starvector') return null;
  if (!probe) {
    return (
      <div className="mb-vec-aistrip is-loading">
        <span>探测 StarVector 状态…</span>
      </div>
    );
  }

  if (!probe.modelPathConfigured) {
    return (
      <div className="mb-vec-aistrip is-warn">
        <strong>未配置模型路径</strong>
        <span>在 设置 → 工具箱 里填入 StarVector 模型目录绝对路径。</span>
      </div>
    );
  }
  if (!probe.modelPathExists) {
    return (
      <div className="mb-vec-aistrip is-warn">
        <strong>模型路径不存在</strong>
        <span title={probe.modelPath ?? ''}>
          {probe.modelPath?.split(/[\\/]/).slice(-2).join('/') ?? '(未知)'} — 检查目录是否完整。
        </span>
      </div>
    );
  }

  async function startServer(): Promise<void> {
    setBusy(true);
    try {
      const r = await window.electronAPI.vec.starvectorStartServer();
      if (!r.ok) {
        toast.error('启动失败', r.error.message);
        return;
      }
      toast.info('AI 服务启动中', '首次加载模型可能 30~60s,稍后再试');
      // 给 sidecar 几秒钟暖机
      setTimeout(() => void refresh(), 3000);
    } finally {
      setBusy(false);
    }
  }

  async function stopServer(): Promise<void> {
    setBusy(true);
    try {
      const r = await window.electronAPI.vec.starvectorStopServer();
      if (!r.ok) {
        toast.error('停止失败', r.error.message);
        return;
      }
      toast.info('已停止', 'StarVector sidecar 已关闭');
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!probe.sidecarReachable) {
    return (
      <div className="mb-vec-aistrip is-warn">
        <strong>AI 服务未启动</strong>
        <span>端口 7867 暂未响应。</span>
        <button
          type="button"
          className="mb-btn mb-btn-primary mb-btn-xs"
          onClick={() => void startServer()}
          disabled={busy}
        >
          {busy ? '启动中…' : '启动服务'}
        </button>
      </div>
    );
  }

  // OK
  return (
    <div className="mb-vec-aistrip is-ok">
      <span className="mb-vec-aistrip-dot" />
      <strong>StarVector 已就绪</strong>
      <span className="mb-vec-aistrip-path" title={probe.modelPath ?? ''}>
        {probe.modelPath?.split(/[\\/]/).slice(-1)[0]}
      </span>
      <button
        type="button"
        className="mb-btn mb-btn-ghost mb-btn-xs"
        onClick={() => void stopServer()}
        disabled={busy}
        title="释放显存(下次推理重新加载)"
      >
        <WrenchIcon size={11} /> 停止
      </button>
    </div>
  );
}
