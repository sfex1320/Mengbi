import { useState } from 'react';
import { toast } from '@/store/toastStore';
import { useComfyuiStore } from '@/store/comfyuiStore';
import { useComfyuiRunStore } from '@/store/comfyuiRunStore';
import { RunControl } from './RunControl';
import type { ConnectionPhase, ComfyLaunchCandidate } from '@shared/comfyui';

const PHASE_LABEL: Record<ConnectionPhase, string> = {
  disconnected: '未连接',
  connecting: '连接中',
  connected: '已连接',
  'launch-failed': '启动失败',
  executing: '执行中',
  queued: '队列中'
};

export function ConnectionBar(): JSX.Element {
  const { host, launchCommand, launchCwd, setConn } = useComfyuiStore();
  const { connStatus, connecting, running, setConnStatus, setConnecting } = useComfyuiRunStore();
  const [advanced, setAdvanced] = useState(false);
  const [token, setToken] = useState('');
  const [freeing, setFreeing] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanList, setScanList] = useState<ComfyLaunchCandidate[]>([]);

  const phase: ConnectionPhase = running
    ? 'executing'
    : connecting
      ? 'connecting'
      : (connStatus?.phase ?? 'disconnected');

  async function persist(): Promise<void> {
    await window.electronAPI.comfyui.setConfig({
      host,
      launchCommand,
      launchCwd,
      ...(token ? { authToken: token } : {})
    });
  }

  /** 选 ComfyUI 文件夹 → 自动识别启动方式，回填启动命令 / 目录 / 地址 */
  async function pickAndScan(): Promise<void> {
    const r = await window.electronAPI.storage.selectFolder();
    if (!r.ok || !r.data) return; // 用户取消
    const dir = r.data.path;
    setScanning(true);
    const sr = await window.electronAPI.comfyui.scanLaunch({ dir });
    setScanning(false);
    if (!sr.ok) {
      toast.error(sr.error.message, sr.error.hint);
      return;
    }
    const cands = sr.data.candidates;
    if (cands.length === 0) {
      setConn({ launchCwd: dir });
      setScanList([]);
      toast.info('没识别到启动脚本', '已填入目录，请手动填写启动命令（如 python main.py --port 8188）');
      return;
    }
    if (cands.length === 1) {
      applyCandidate(cands[0]);
      return;
    }
    setScanList(cands); // 多个 → 让用户选一个
  }

  function applyCandidate(c: ComfyLaunchCandidate): void {
    setConn({ launchCommand: c.command, launchCwd: c.cwd, host: c.host });
    setScanList([]);
    toast.success('已识别启动方式', c.label);
  }

  async function detect(): Promise<void> {
    setConnecting(true);
    await persist();
    const r = await window.electronAPI.comfyui.detect({ host });
    setConnecting(false);
    if (r.ok && r.data.reachable) {
      setConnStatus({ phase: 'connected', host, reachable: true, managed: false, pid: null, version: r.data.version });
      toast.success('已连接 ComfyUI', r.data.version ? `版本 ${r.data.version}` : undefined);
    } else {
      setConnStatus({ phase: 'disconnected', host, reachable: false, managed: false, pid: null });
      if (!r.ok) toast.error(r.error.message, r.error.hint);
    }
  }

  async function start(): Promise<void> {
    setConnecting(true);
    await persist();
    const r = await window.electronAPI.comfyui.start();
    setConnecting(false);
    if (r.ok) {
      setConnStatus({ phase: 'connected', host, reachable: true, managed: true, pid: r.data.pid });
      toast.success('ComfyUI 已启动并连接');
    } else {
      setConnStatus({ phase: 'launch-failed', host, reachable: false, managed: false, pid: null });
      toast.error(r.error.message, r.error.hint);
    }
  }

  async function stop(): Promise<void> {
    const r = await window.electronAPI.comfyui.stop();
    if (r.ok) {
      setConnStatus({ phase: 'disconnected', host, reachable: false, managed: false, pid: null });
      toast.info('已停止 ComfyUI');
    }
  }

  async function refreshNodes(): Promise<void> {
    const r = await window.electronAPI.comfyui.refreshObjectInfo();
    if (r.ok) toast.success('已刷新节点类型', r.data.nodeTypes ? `${r.data.nodeTypes} 种节点` : '（未连接）');
    else toast.error(r.error.message);
  }

  async function freeMem(opts: { unloadModels?: boolean; freeMemory?: boolean }, okText: string): Promise<void> {
    setFreeing(true);
    const r = await window.electronAPI.comfyui.freeMemory(opts);
    setFreeing(false);
    if (r.ok) toast.success(okText, '已通知 ComfyUI，将在空闲时执行');
    else toast.error(r.error.message, r.error.hint);
  }

  return (
    <section className="mb-cfy-conn mb-card">
      <div className="mb-cfy-conn-row">
        <span className={`mb-cfy-pill is-${phase}`}>{PHASE_LABEL[phase]}</span>
        <input
          className="mb-input mb-cfy-host"
          placeholder="127.0.0.1:8188"
          value={host}
          onChange={(e) => setConn({ host: e.target.value })}
        />
        <button className="mb-btn mb-btn-sm" onClick={() => void detect()} disabled={connecting || running}>
          检测
        </button>
        <button className="mb-btn mb-btn-sm" onClick={() => void start()} disabled={connecting || running}>
          启动 ComfyUI
        </button>
        <button
          className="mb-btn mb-btn-sm mb-btn-ghost"
          onClick={() => void stop()}
          disabled={!connStatus?.managed}
        >
          停止
        </button>
        <button
          className="mb-btn mb-btn-sm mb-btn-ghost"
          onClick={() => void refreshNodes()}
          disabled={!connStatus?.reachable}
          title="装了新自定义节点 / 升级 ComfyUI 后，刷新节点类型（更新采样器/模型等下拉项）"
        >
          刷新节点
        </button>
        <button
          className="mb-btn mb-btn-sm mb-btn-ghost"
          onClick={() => void freeMem({ unloadModels: true }, '已请求卸载模型')}
          disabled={!connStatus?.reachable || freeing || running}
          title="卸载 ComfyUI 已加载的模型，释放它们占用的显存（不影响缓存）"
        >
          卸载模型
        </button>
        <button
          className="mb-btn mb-btn-sm mb-btn-ghost"
          onClick={() => void freeMem({ unloadModels: true, freeMemory: true }, '已请求清理缓存与显存')}
          disabled={!connStatus?.reachable || freeing || running}
          title="卸载模型 + 清理缓存，尽量释放内存与显存"
        >
          清理显存/内存
        </button>
        <button className="mb-btn mb-btn-sm mb-btn-ghost" onClick={() => setAdvanced((v) => !v)}>
          {advanced ? '收起' : '启动配置'}
        </button>
        {/* 运行按钮放在本行末尾，随整条连接行一起冻结 */}
        <RunControl />
      </div>

      {advanced && (
        <div className="mb-cfy-conn-adv">
          <div
            style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}
          >
            <button
              className="mb-btn mb-btn-sm mb-btn-primary"
              onClick={() => void pickAndScan()}
              disabled={scanning}
            >
              {scanning ? '识别中…' : '📁 选择 ComfyUI 文件夹（自动识别）'}
            </button>
            <span className="mb-cfy-conn-msg">
              选根目录即可——自动找 run_*.bat / python_embeded / venv，回填下方命令与目录
            </span>
          </div>
          {scanList.length > 0 && (
            <div
              style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}
            >
              {scanList.map((c, i) => (
                <button
                  key={`${c.command}-${i}`}
                  type="button"
                  className="mb-btn mb-btn-ghost"
                  style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, textAlign: 'left' }}
                  onClick={() => applyCandidate(c)}
                  title={`${c.command}  （目录：${c.cwd}）`}
                >
                  <span style={{ fontWeight: 600 }}>{c.label}</span>
                  <span style={{ fontSize: 12, opacity: 0.7, fontFamily: 'monospace' }}>{c.command}</span>
                </button>
              ))}
            </div>
          )}
          <label className="mb-label">启动命令</label>
          <input
            className="mb-input"
            placeholder="run_nvidia_gpu.bat  /  python main.py --listen 127.0.0.1 --port 8188"
            value={launchCommand}
            onChange={(e) => setConn({ launchCommand: e.target.value })}
          />
          <label className="mb-label">ComfyUI 目录</label>
          <input
            className="mb-input"
            placeholder="ComfyUI 根目录（启动命令的工作目录）"
            value={launchCwd}
            onChange={(e) => setConn({ launchCwd: e.target.value })}
          />
          <label className="mb-label">访问令牌（可选，远程转发才需要）</label>
          <input
            className="mb-input"
            type="password"
            placeholder="留空＝本地无鉴权"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
          <div className="mb-cfy-conn-advfoot">
            <button className="mb-btn mb-btn-sm" onClick={() => void persist().then(() => toast.success('已保存连接配置'))}>
              保存配置
            </button>
            {connStatus?.message && <span className="mb-cfy-conn-msg">{connStatus.message}</span>}
          </div>
        </div>
      )}
    </section>
  );
}
