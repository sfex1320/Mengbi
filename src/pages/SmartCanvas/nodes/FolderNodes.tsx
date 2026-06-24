import { useMemo } from 'react';
import { NodeResizer, type NodeProps } from '@xyflow/react';
import { useSmartCanvasStore, useSmartPreviewStore } from '@/store/smartCanvasStore';
import { refreshFolderInput } from '@/lib/smartCanvasRunner';
import { localPathToImageUrl } from '@/lib/imageUrl';
import {
  FOLDER_NAME_RULE_LABELS,
  type FolderInputNodeData,
  type FolderOutputNodeData,
  type FolderNameRule,
  type SmartNodeData
} from '@shared/smartCanvas';
import { NodeShell } from './NodeShell';
import { MeasuredThumb, thumbPair } from '../MeasuredThumb';
import { showInFolder, openVideoPreview } from '../nodeArea';

/**
 * 文件夹输入节点：选输入文件夹 → 扫描图片（api:storage:list-images）→ 作为多图来源输出。
 * 与 ComfyUI 节点「逐张图执行」/ 生图节点 组合即文件夹批量处理。
 */
export function FolderInputNode({ id, data }: NodeProps): JSX.Element {
  const update = useSmartCanvasStore((s) => s.updateNodeData);
  const remove = useSmartCanvasStore((s) => s.removeNode);
  const openPreview = useSmartPreviewStore((s) => s.open);
  const d = data as unknown as FolderInputNodeData;
  const setF = (p: Partial<FolderInputNodeData>): void => update(id, p as Partial<SmartNodeData>);
  const files = d.files ?? [];
  const previewFiles = useMemo(() => files.slice(0, 8), [files]);

  async function pickFolder(): Promise<void> {
    const r = await window.electronAPI.storage.selectFolder();
    if (r.ok && r.data?.path) {
      setF({ dir: r.data.path });
      // 选完立刻扫一遍
      setTimeout(() => void refreshFolderInput(id), 0);
    }
  }

  return (
    <>
      <NodeResizer isVisible minWidth={220} minHeight={170} />
      <NodeShell
        title="文件夹输入"
        accent="is-folder-input"
        outputs
        fill
        onDelete={() => remove(id)}
        headRight={files.length ? <span className="mb-sc-status is-success">{files.length} 张</span> : undefined}
      >
        <div className="mb-sc-revctl nodrag">
          <button className="mb-btn mb-btn-sm mb-btn-ghost" onClick={() => void pickFolder()}>
            {d.dir ? '换文件夹' : '选择输入文件夹'}
          </button>
          {d.dir && (
            <div className="mb-sc-note" title={d.dir} style={{ cursor: 'pointer' }} onClick={() => void showInFolder(d.dir as string)}>
              {d.dir}
            </div>
          )}
          {d.dir && (
            <button className="mb-btn mb-btn-sm" title="重新扫描文件夹（文件有增减后点这里）" onClick={() => void refreshFolderInput(id)}>
              刷新（{files.length} 张{d.videoFiles?.length ? ` + ${d.videoFiles.length} 视频` : ''}）
            </button>
          )}
          {!!d.videoFiles?.length && (
            <div
              className="mb-sc-note"
              style={{ cursor: 'pointer' }}
              title="点击放大播放（←→ 可翻看全部视频）"
              onClick={() => openVideoPreview(d.videoFiles ?? [])}
            >
              🎬 {d.videoFiles.length} 个视频（可作下游 视频反推 / 缩放 / 插帧 来源）· 点击预览
            </div>
          )}
          {d.error && <div className="mb-sc-result-err">{d.error}</div>}
        </div>
        {previewFiles.length > 0 && (
          <div className="mb-sc-work-thumbs nodrag">
            {previewFiles.map((f, i) => {
              const t = thumbPair(f);
              return (
                <MeasuredThumb
                  key={f}
                  src={t.thumb}
                  fullSrc={t.full}
                  measureFull
                  alt={f}
                  title="点击放大（←→ 可翻看全部）"
                  onClick={() => openPreview(files.map((x) => ({ src: localPathToImageUrl(x), meta: { filePath: x } })), i)}
                />
              );
            })}
          </div>
        )}
        {files.length > previewFiles.length && <div className="mb-sc-note nodrag">… 共 {files.length} 张（缩略图只显示前 8 张）</div>}
      </NodeShell>
    </>
  );
}

/**
 * 文件夹输出节点：上游 生图/ComfyUI/视频/缩放/结果 每出一张结果自动落盘到指定文件夹
 *（runner 的结果归位汇集点调 notifyFolderOutputs → api:storage:copy-into）。失败记日志不中断生成。
 */
export function FolderOutputNode({ id, data }: NodeProps): JSX.Element {
  const update = useSmartCanvasStore((s) => s.updateNodeData);
  const remove = useSmartCanvasStore((s) => s.removeNode);
  const d = data as unknown as FolderOutputNodeData;
  const setF = (p: Partial<FolderOutputNodeData>): void => update(id, p as Partial<SmartNodeData>);

  async function pickFolder(): Promise<void> {
    const r = await window.electronAPI.storage.selectFolder();
    if (r.ok && r.data?.path) setF({ dir: r.data.path });
  }

  return (
    <>
      <NodeResizer isVisible minWidth={230} minHeight={200} />
      <NodeShell
        title="文件夹输出"
        accent="is-folder-output"
        inputs
        fill
        onDelete={() => remove(id)}
        headRight={
          <span className={`mb-sc-status ${d.failCount ? 'is-error' : 'is-success'}`}>
            存 {d.savedCount ?? 0}
            {d.failCount ? ` · 败 ${d.failCount}` : ''}
          </span>
        }
      >
        <div className="mb-sc-revctl nodrag">
          <button className="mb-btn mb-btn-sm mb-btn-ghost" onClick={() => void pickFolder()}>
            {d.dir ? '换输出文件夹' : '选择输出文件夹'}
          </button>
          {d.dir ? (
            <div className="mb-sc-note" title={`${d.dir}（点击打开）`} style={{ cursor: 'pointer' }} onClick={() => void showInFolder(d.dir as string)}>
              {d.dir}
            </div>
          ) : (
            <div className="mb-sc-note">未选文件夹时不落盘</div>
          )}
          <select className="mb-select" value={d.nameRule ?? 'original'} onChange={(e) => setF({ nameRule: e.target.value as FolderNameRule })}>
            {(Object.keys(FOLDER_NAME_RULE_LABELS) as FolderNameRule[]).map((k) => (
              <option key={k} value={k}>
                命名：{FOLDER_NAME_RULE_LABELS[k]}
              </option>
            ))}
          </select>
          {(d.nameRule ?? 'original') === 'prefix-seq' && (
            <input className="mb-input" value={d.prefix ?? 'output'} placeholder="文件名前缀" onChange={(e) => setF({ prefix: e.target.value })} />
          )}
          <label className="mb-sc-switch-row" title="关闭后上游结果不再自动落盘（只记日志）">
            <input type="checkbox" checked={d.enabled !== false} onChange={(e) => setF({ enabled: e.target.checked })} />
            自动保存上游结果
          </label>
          {d.error && <div className="mb-sc-result-err">{d.error}</div>}
          {d.logs?.length ? <div className="mb-sc-work-dur">{d.logs[d.logs.length - 1]}</div> : null}
        </div>
      </NodeShell>
    </>
  );
}
