import { useMemo, useState } from 'react';
import { NodeResizer, type NodeProps } from '@xyflow/react';
import { useSmartCanvasStore } from '@/store/smartCanvasStore';
import { runLoopNode, pauseLoop, resumeLoop, stopLoop, skipLoopItem } from '@/lib/smartCanvasRunner';
import { buildLoopItems } from '@/lib/loopItems';
import { filesToImageSrcs } from '@/lib/mediaFile';
import { toast } from '@/store/toastStore';
import {
  LOOP_SOURCE_LABELS,
  type LoopNodeData,
  type LoopSourceType,
  type LoopRangeAs,
  type SmartNodeData
} from '@shared/smartCanvas';
import { NodeShell } from './NodeShell';
import { NodeHint } from '../nodeArea';
import { thumbPair } from '../MeasuredThumb';
import { SegmentedControl, ClampNumberInput } from '../nodePanel/consoleControls';
import { localPathToImageUrl } from '@/lib/imageUrl';

const STATUS_TEXT: Record<string, string> = { idle: '待运行', running: '运行中…', paused: '已暂停', success: '已完成', error: '失败' };

function imgUrl(s: string): string {
  return s.startsWith('data:') ? s : localPathToImageUrl(s);
}

/**
 * 循环节点：对一组「项/批」逐项执行，每项把「当前值」作为输出（图片批 / 提示词 / 尺寸），
 * 触发并等待下游 生图/ComfyUI/视频 完成后切下一项。支持 暂停/继续/停止/跳过/从指定项继续。
 * 来源：图片批次（直接拖入多张 + 每批 N）/ 提示词列表 / 文件夹图片 / 尺寸列表 / 数值范围 / 固定次数。
 */
export function LoopNode({ id, data }: NodeProps): JSX.Element {
  const update = useSmartCanvasStore((s) => s.updateNodeData);
  const remove = useSmartCanvasStore((s) => s.removeNode);
  const d = data as unknown as LoopNodeData;
  const setF = (p: Partial<LoopNodeData>): void => update(id, p as Partial<SmartNodeData>);
  const running = d.status === 'running';
  const paused = d.status === 'paused';
  const active = running || paused;
  const [startFrom, setStartFrom] = useState(1);
  const images = d.images ?? [];

  // 项数预估（folder 模式运行时才扫描，这里不显示预估）
  const planned = useMemo(() => (d.sourceType === 'folder' ? null : buildLoopItems(d).length), [d]);
  const isImageSource = d.sourceType === 'images' || d.sourceType === 'folder';

  async function pickFolder(): Promise<void> {
    const r = await window.electronAPI.storage.selectFolder();
    if (r.ok && r.data?.path) setF({ folderDir: r.data.path });
  }

  async function addImages(files: File[]): Promise<void> {
    const added = await filesToImageSrcs(files);
    if (!added.length) return;
    const cur = useSmartCanvasStore.getState().nodes.find((n) => n.id === id);
    const curImgs = ((cur?.data as unknown as LoopNodeData | undefined)?.images ?? []).slice();
    setF({ images: [...curImgs, ...added] });
  }

  function startAt(index1: number): void {
    const idx = Math.max(1, Math.trunc(index1)) - 1;
    void runLoopNode(id, { startIndex: idx });
  }

  return (
    <>
      <NodeResizer isVisible minWidth={260} minHeight={300} />
      <NodeShell
        title="循环"
        accent="is-loop"
        outputs
        fill
        onDelete={() => remove(id)}
        headRight={
          <span className={`mb-sc-status is-${running ? 'running' : d.status === 'paused' ? 'idle' : d.status}`}>
            {running && <span className="mb-sc-spinner" aria-hidden />}
            {STATUS_TEXT[d.status] ?? d.status}
          </span>
        }
      >
        <div className="mb-sc-revctl nodrag">
          <select className="mb-select" value={d.sourceType} disabled={active} onChange={(e) => setF({ sourceType: e.target.value as LoopSourceType })}>
            {(Object.keys(LOOP_SOURCE_LABELS) as LoopSourceType[]).map((k) => (
              <option key={k} value={k}>
                {LOOP_SOURCE_LABELS[k]}
              </option>
            ))}
          </select>

          {/* 图片批次：直接拖入 / 选入多张 */}
          {d.sourceType === 'images' && (
            <div
              className="mb-sc-loop-imgs"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'));
                if (files.length) {
                  e.preventDefault();
                  e.stopPropagation();
                  void addImages(files);
                }
              }}
            >
              <div className="mb-sc-imglist-head">
                <span>{images.length} 张</span>
                {images.length > 0 && !active && (
                  <button className="mb-sc-plist-clear" onClick={() => setF({ images: [] })}>
                    清空
                  </button>
                )}
              </div>
              {images.length > 0 && (
                <div className="mb-sc-imglist-grid is-mini">
                  {images.slice(0, 12).map((s, i) => (
                    <div key={`${s}-${i}`} className="mb-sc-imglist-cell">
                      <img src={thumbPair(s).thumb} alt="" draggable={false} loading="lazy" onError={(e) => { if (e.currentTarget.src !== imgUrl(s)) e.currentTarget.src = imgUrl(s); }} />
                      {!active && (
                        <button className="mb-sc-imglist-x" onClick={() => setF({ images: images.filter((_, j) => j !== i) })}>
                          ✕
                        </button>
                      )}
                    </div>
                  ))}
                  {images.length > 12 && <div className="mb-sc-imglist-more">+{images.length - 12}</div>}
                </div>
              )}
              <label className="mb-btn mb-btn-sm mb-btn-ghost mb-sc-loop-addbtn">
                ＋ 添加图片
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  disabled={active}
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    void addImages(Array.from(e.target.files ?? []));
                    e.target.value = '';
                  }}
                />
              </label>
            </div>
          )}

          {d.sourceType === 'folder' && (
            <>
              <button className="mb-btn mb-btn-sm mb-btn-ghost" disabled={active} onClick={() => void pickFolder()}>
                {d.folderDir ? '换图片文件夹' : '选择图片文件夹'}
              </button>
              {d.folderDir && <div className="mb-sc-note">{d.folderDir}</div>}
            </>
          )}

          {/* 图片来源共用：每批张数 */}
          {isImageSource && (
            <div className="mb-sc-sb-row">
              <span className="mb-sc-sb-lbl">每批张数</span>
              <ClampNumberInput min={1} max={200} value={d.batchSize || 1} onCommit={(v) => setF({ batchSize: v })} />
              <span className="mb-sc-imglist-batchhint">张 / 批</span>
            </div>
          )}

          {d.sourceType === 'prompts' && (
            <textarea
              className="mb-sc-input"
              rows={5}
              value={d.promptLines}
              placeholder={'每行一条提示词，例如：\n一只猫\n一只狗\n一只兔子'}
              onChange={(e) => setF({ promptLines: e.target.value })}
            />
          )}

          {d.sourceType === 'sizes' && (
            <textarea
              className="mb-sc-input"
              rows={5}
              value={d.sizeLines}
              placeholder={'每行一组宽高（支持 x / × / , 分隔），例如：\n1024x1024\n1920,1080\n768×1344'}
              onChange={(e) => setF({ sizeLines: e.target.value })}
            />
          )}

          {d.sourceType === 'count' && (
            <div className="mb-sc-sb-row">
              <span className="mb-sc-sb-lbl">次数</span>
              <ClampNumberInput min={1} max={1000} value={d.count || 1} onCommit={(v) => setF({ count: v })} />
            </div>
          )}

          {d.sourceType === 'range' && (
            <>
              <div className="mb-sc-loop-range">
                <ClampNumberInput min={-1000000} max={1000000} value={d.rangeFrom} onCommit={(v) => setF({ rangeFrom: v })} />
                <span>→</span>
                <ClampNumberInput min={-1000000} max={1000000} value={d.rangeTo} onCommit={(v) => setF({ rangeTo: v })} />
                <span>步</span>
                <ClampNumberInput min={-100000} max={100000} value={d.rangeStep} onCommit={(v) => setF({ rangeStep: v })} />
              </div>
              <SegmentedControl
                value={d.rangeAs}
                size="sm"
                options={[
                  { value: 'text' as LoopRangeAs, label: '作文本' },
                  { value: 'size-width' as LoopRangeAs, label: '作宽' },
                  { value: 'size-height' as LoopRangeAs, label: '作高' }
                ]}
                onChange={(v) => setF({ rangeAs: v })}
              />
              {d.rangeAs !== 'text' && (
                <div className="mb-sc-sb-row">
                  <span className="mb-sc-sb-lbl">{d.rangeAs === 'size-width' ? '固定高' : '固定宽'}</span>
                  <ClampNumberInput min={16} max={16384} value={d.rangeOtherEdge ?? 1024} onCommit={(v) => setF({ rangeOtherEdge: v })} />
                </div>
              )}
            </>
          )}

          <label className="mb-sc-switch-row" title="勾选：某项失败立即停止；不勾：失败跳过继续（事后可看失败数）">
            <input type="checkbox" checked={!!d.stopOnError} disabled={active} onChange={(e) => setF({ stopOnError: e.target.checked })} />
            失败即停
          </label>
          {planned != null && (
            <div className="mb-sc-note">
              预计 {planned} 项 <NodeHint text="输出口连到 生图（逐张）/ ComfyUI / 视频 节点逐项驱动" />
            </div>
          )}
        </div>

        {/* 状态行：当前项 / 总数 / 当前值 / 成败 */}
        {(active || (d.totalItems ?? 0) > 0) && (
          <div className="mb-sc-loop-status nodrag">
            <span>
              第 {(d.currentIndex ?? 0) + 1}/{d.totalItems ?? '?'} 项 · 成功 {d.doneCount ?? 0} · 失败 {d.failCount ?? 0}
            </span>
            {d.currentValue && <span className="mb-sc-loop-cur" title={d.currentValue}>当前：{d.currentValue}</span>}
          </div>
        )}
        {d.error && <div className="mb-sc-result-err nodrag">{d.error}</div>}
        {!d.error && d.logs?.length ? <div className="mb-sc-work-dur nodrag">{d.logs[d.logs.length - 1]}</div> : null}

        <div className="mb-sc-sb-runrow nodrag">
          {!active ? (
            <>
              <button className="mb-btn mb-btn-sm mb-btn-primary mb-sc-runbtn" onClick={() => void runLoopNode(id)}>
                运行循环
              </button>
              {(d.currentIndex ?? 0) > 0 && (
                <>
                  <ClampNumberInput min={1} max={Math.max(1, d.totalItems ?? 1000)} value={Math.min(startFrom < 2 ? (d.currentIndex ?? 0) + 1 : startFrom, d.totalItems ?? 1000)} onCommit={setStartFrom} />
                  <button
                    className="mb-btn mb-btn-sm mb-btn-ghost"
                    title="从指定项继续（项序号从 1 起）"
                    onClick={() => startAt(startFrom < 2 ? (d.currentIndex ?? 0) + 1 : startFrom)}
                  >
                    从此项继续
                  </button>
                </>
              )}
            </>
          ) : (
            <>
              {paused ? (
                <button className="mb-btn mb-btn-sm mb-btn-primary" onClick={() => resumeLoop(id)}>
                  继续
                </button>
              ) : (
                <button className="mb-btn mb-btn-sm" title="当前项完成后暂停" onClick={() => { pauseLoop(id); toast.info('将在当前项完成后暂停'); }}>
                  暂停
                </button>
              )}
              <button className="mb-btn mb-btn-sm mb-btn-ghost" title="取消当前项并跳到下一项" onClick={() => skipLoopItem(id)}>
                跳过此项
              </button>
              <button className="mb-btn mb-btn-sm mb-btn-ghost is-stop" onClick={() => stopLoop(id)}>
                停止
              </button>
            </>
          )}
        </div>
      </NodeShell>
    </>
  );
}
