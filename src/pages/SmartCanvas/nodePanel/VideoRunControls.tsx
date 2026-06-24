import { useMemo, useState } from 'react';
import { useSmartCanvasStore } from '@/store/smartCanvasStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useVideoProvidersStore } from '@/store/videoProvidersStore';
import { runVideoNode, runVideoBatch, cancelVideo, dryRunVideo } from '@/lib/smartCanvasRunner';
import { ClampNumberInput } from './consoleControls';
import { toast } from '@/store/toastStore';
import { VIDEO_TASK_STATE_LABELS } from '@shared/video';
import type { VideoNodeData, SmartNodeData } from '@shared/smartCanvas';

/**
 * 视频「运行控制」共享块（卡片 + 控制台共用，DRY）：生成 / 校验 / 批量 / 取消 + 二次确认 + 费用 + 状态。
 * compact=卡片（只 生成/取消/状态）；否则=控制台（生成/校验/批量/取消/状态/费用）。
 */
export function VideoRunControls({ id, compact = false }: { id: string; compact?: boolean }): JSX.Element | null {
  const node = useSmartCanvasStore((s) => s.nodes.find((n) => n.id === id));
  const update = useSmartCanvasStore((s) => s.updateNodeData);
  const nodes = useSmartCanvasStore((s) => s.nodes);
  const edges = useSmartCanvasStore((s) => s.edges);
  const configs = useSettingsStore((s) => s.configs);
  const merged = useVideoProvidersStore((s) => s.config);
  const [confirm, setConfirm] = useState<{ kind: 'single' } | { kind: 'batch'; count: number } | null>(null);
  const [batchCount, setBatchCount] = useState(2);

  const dry = useMemo(() => (node ? dryRunVideo(id) : null), [id, node, nodes, edges, configs, merged]);
  if (!node) return null;
  const d = node.data as unknown as VideoNodeData;
  const running = d.status === 'running';
  const setF = (p: Partial<VideoNodeData>): void => update(id, p as Partial<SmartNodeData>);

  const costText = dry?.cost
    ? `${dry.cost.amount != null ? `≈¥${dry.cost.amount}` : '费用未知'} · ${dry.cost.tier === 'high' ? '高' : dry.cost.tier === 'medium' ? '中' : '低'}费`
    : '';
  const statusText = running
    ? d.taskState
      ? VIDEO_TASK_STATE_LABELS[d.taskState]
      : '生成中'
    : d.status === 'success'
      ? '已完成'
      : d.status === 'error'
        ? '失败'
        : '待运行';

  function reduceCost(): void {
    setF({ resolution: '720p', duration: '5', generateAudio: false });
    toast.success('已套用低成本参数', '720p · 5s · 关闭音频');
  }
  function onGenerate(): void {
    const r = dryRunVideo(id);
    if (!r.ok) {
      setF({ error: r.issues.join('；') });
      toast.error('视频参数校验未通过', r.issues.join('；'));
      return;
    }
    if (r.needConfirm) {
      setConfirm({ kind: 'single' });
      return;
    }
    setF({ error: null });
    void runVideoNode(id);
  }
  function onBatch(): void {
    const r = dryRunVideo(id);
    if (!r.ok) {
      setF({ error: r.issues.join('；') });
      toast.error('视频参数校验未通过', r.issues.join('；'));
      return;
    }
    setConfirm({ kind: 'batch', count: batchCount });
  }

  if (confirm) {
    return (
      <div className="mb-sc-vconfirm nodrag">
        <div className="mb-sc-vconfirm-t">{confirm.kind === 'batch' ? `确认批量生成 ×${confirm.count}` : '确认生成（费用较高）'}</div>
        <div className="mb-sc-vconfirm-s">{dry?.summary}</div>
        <div className="mb-sc-vconfirm-s">
          {dry?.cost?.note}
          {confirm.kind === 'batch'
            ? ` · 总计 ${dry?.cost?.amount != null ? `≈¥${(dry.cost.amount * confirm.count).toFixed(2)}` : `${confirm.count}× ${costText || '未知'}`}`
            : costText
              ? ` · ${costText}`
              : ''}
        </div>
        <div className="mb-sc-vconfirm-btns">
          <button
            className="mb-btn mb-btn-sm mb-btn-primary"
            onClick={() => {
              const c = confirm;
              setConfirm(null);
              setF({ error: null });
              if (c.kind === 'batch') void runVideoBatch(id, c.count);
              else void runVideoNode(id);
            }}
          >
            {confirm.kind === 'batch' ? '确认批量' : '确认生成'}
          </button>
          <button className="mb-btn mb-btn-sm mb-btn-secondary" onClick={reduceCost}>一键降本</button>
          <button className="mb-btn mb-btn-sm mb-btn-ghost" onClick={() => setConfirm(null)}>取消</button>
        </div>
      </div>
    );
  }

  return (
    <>
      {dry && !dry.ok && dry.issues.length > 0 && <div className="mb-sc-vissue nodrag">⚠ {dry.issues.join('；')}</div>}
      <div className={`mb-np-bar-run mb-np-video-run nodrag ${compact ? 'is-compact' : ''}`}>
        <button className="mb-np-run" disabled={running || !d.modelId} onClick={onGenerate}>
          ▶ {running ? '生成中…' : '生成视频'}
        </button>
        <div className="mb-np-run-side">
          {!compact && (
            <button
              className="mb-btn mb-btn-sm mb-btn-ghost"
              disabled={running || !d.modelId}
              onClick={() => {
                const r = dryRunVideo(id);
                toast[r.ok ? 'success' : 'error'](
                  r.ok ? '校验通过' : '校验未通过',
                  r.ok ? `${r.summary}${costText ? ' · ' + costText : ''}` : r.issues.join('；')
                );
              }}
            >
              校验
            </button>
          )}
          {!compact && merged.batchEnabled && !running && (
            <span className="mb-sc-vbatch">
              ×
              <ClampNumberInput min={2} max={20} value={batchCount} onCommit={setBatchCount} />
              <button className="mb-btn mb-btn-sm mb-btn-secondary" disabled={!d.modelId} onClick={onBatch}>
                批量
              </button>
            </span>
          )}
          {running && (
            <button className="mb-btn mb-btn-sm mb-btn-ghost" onClick={() => cancelVideo(id)} title="取消生成">
              ■ 取消
            </button>
          )}
          {/* 卡片(compact)不再重复「待运行」状态——节点标题栏已显示状态；控制台保留胶囊 */}
          {!compact && (
            <span className={`mb-np-status is-${d.status}`}>
              <i className="mb-np-status-dot" />
              {statusText}
            </span>
          )}
          {!compact && costText && <span className="mb-np-note">{costText}</span>}
        </div>
      </div>
    </>
  );
}
