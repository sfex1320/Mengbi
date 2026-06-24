import { NodeResizer, type NodeProps } from '@xyflow/react';
import { useSmartCanvasStore, useSmartPreviewStore } from '@/store/smartCanvasStore';
import { computeUpstream, runVectorizeNode } from '@/lib/smartCanvasRunner';
import { localPathToImageUrl } from '@/lib/imageUrl';
import type { VectorizeNodeData, VectorizeMode, SmartNodeData } from '@shared/smartCanvas';
import { NodeShell } from './NodeShell';
import { SegmentedControl } from '../nodePanel/consoleControls';
import { areaMenu, imageSaveAs, dragOutNative, showInFolder } from '../nodeArea';

/** 图像转矢量节点：接上游图 → 本地 VTracer（彩色）/ Potrace（单色）→ 输出 SVG（终端产物）。
 *  CPU 内置算法，无需装引擎。1:1 复刻工具箱「图像转矢量」。SVG 只连「结果 / 文件夹输出」查看·另存。 */
export function VectorizeNode({ id, data }: NodeProps): JSX.Element {
  const update = useSmartCanvasStore((s) => s.updateNodeData);
  const remove = useSmartCanvasStore((s) => s.removeNode);
  const nodes = useSmartCanvasStore((s) => s.nodes);
  const edges = useSmartCanvasStore((s) => s.edges);
  const d = data as unknown as VectorizeNodeData;
  const setF = (p: Partial<VectorizeNodeData>): void => update(id, p as Partial<SmartNodeData>);

  const up = computeUpstream(nodes, edges, id);
  const hasInput = !!up.images[0];
  const running = d.status === 'running';
  const outUrl = d.outputSvgPath ? localPathToImageUrl(d.outputSvgPath) : null;

  const openSvg = (): void => {
    if (!d.outputSvgPath || !outUrl) return;
    useSmartPreviewStore.getState().open([{ src: outUrl, type: 'image', meta: { filePath: d.outputSvgPath } }], 0);
  };

  return (
    <>
      <NodeResizer isVisible minWidth={220} minHeight={160} />
      <NodeShell title="图像转矢量" accent="is-vectorize" inputs outputs fill onDelete={() => remove(id)}>
        {!hasInput ? (
          <div className="mb-sc-empty">连一个图片来源 → 选模式 → 转 SVG（输出连「结果 / 文件夹输出」查看·另存）</div>
        ) : (
          <div className="mb-sc-revctl nodrag">
            <SegmentedControl
              value={d.vmode}
              options={[
                { value: 'vtracer', label: '彩色 VTracer' },
                { value: 'potrace', label: '单色 Potrace' }
              ]}
              onChange={(v) => setF({ vmode: v as VectorizeMode })}
            />
            <div className="mb-sc-work-model">{d.vmode === 'potrace' ? '单色矢量（线稿 / 印章）' : '彩色矢量（logo / 文化墙美陈）'}</div>
            <div className="mb-sc-revrow">
              <button className="mb-btn mb-btn-sm mb-btn-primary" disabled={running} onClick={() => void runVectorizeNode(id)}>
                {running ? '矢量化中…' : d.outputSvgPath ? '重新矢量化' : '开始矢量化'}
              </button>
            </div>
            {running && (
              <div className="mb-sc-video-prog nodrag">
                <div className="mb-sc-video-prog-track">
                  <i style={{ width: `${d.progress ?? 0}%` }} />
                </div>
                <span>{(d.progress ?? 0) >= 100 ? '完成' : '处理中…'}</span>
              </div>
            )}
            {d.error && <div className="mb-sc-result-err">{d.error}</div>}
            {outUrl && (
              <button
                type="button"
                className="mb-sc-upscale-out nodrag"
                draggable
                onDragStart={(e) => dragOutNative(e, d.outputSvgPath ?? '', 'vectorized')}
                onClick={openSvg}
                onContextMenu={(e) =>
                  areaMenu(e, [
                    { label: '放大查看', onClick: openSvg },
                    { label: '另存 SVG…', onClick: () => void imageSaveAs(d.outputSvgPath ?? '', 'vectorized.svg') },
                    { label: '打开文件所在目录', onClick: () => void showInFolder(d.outputSvgPath ?? '') }
                  ])
                }
                title="SVG 结果 · 点击放大 · 拖出直用 · 右键更多"
              >
                <img src={outUrl} alt="SVG 结果" draggable={false} />
              </button>
            )}
          </div>
        )}
      </NodeShell>
    </>
  );
}
