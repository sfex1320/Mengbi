import { useMemo, useRef } from 'react';
import { NodeResizer, type NodeProps } from '@xyflow/react';
import { useSmartCanvasStore, useSmartPreviewStore } from '@/store/smartCanvasStore';
import { runWithUpstream, computeUpstream, cancelWork } from '@/lib/smartCanvasRunner';
import { localPathToImageUrl } from '@/lib/imageUrl';
import { WORK_TYPE_LABELS, RUN_MODE_LABELS, PROVIDER_LABELS, type WorkNodeData } from '@shared/smartCanvas';
import { NodeShell } from './NodeShell';
import { ExplainErrorButton } from './ExplainErrorButton';
import { MeasuredThumb, thumbPair } from '../MeasuredThumb';
import { useFitNodeToContent, fmtDur, areaMenu, copyImage, imageToGallery, imageSaveAs, dragOutNative, showInFolder } from '../nodeArea';

const STATUS_TEXT: Record<string, string> = {
  idle: '待运行',
  running: '运行中…',
  success: '成功',
  error: '失败'
};

const QUALITY_LABELS: Record<string, string> = { standard: '标准', high: '高质量' };

function imgUrl(src: string): string {
  return src.startsWith('data:') ? src : localPathToImageUrl(src);
}

/** 工作（生成）节点：紧凑展示类型/后端/状态/运行 + 实时预览上游输入 + 结果缩略图（参数在弹出控制台里调）。 */
export function WorkNode({ id, data }: NodeProps): JSX.Element {
  const remove = useSmartCanvasStore((s) => s.removeNode);
  const nodes = useSmartCanvasStore((s) => s.nodes);
  const edges = useSmartCanvasStore((s) => s.edges);
  const openPreview = useSmartPreviewStore((s) => s.open);
  const d = data as unknown as WorkNodeData;
  const running = d.status === 'running';
  const backend = d.provider === 'mock' ? PROVIDER_LABELS.mock : d.modelId || '未选模型（选中后在控制台里选）';

  const up = useMemo(() => computeUpstream(nodes, edges, id), [nodes, edges, id]);
  const firstPrompt = up.prompts[0];

  // 节点高度贴合真实内容（fitwrap 实测：输入图横条/参数摘要/报错/结果缩略图变化都自动跟随；手动 > 自适应）
  const fitRef = useRef<HTMLDivElement>(null);
  useFitNodeToContent(id, fitRef, 52, 800);

  return (
    <>
      <NodeResizer isVisible minWidth={220} minHeight={140} />
      <NodeShell
        title="生图"
        accent="is-work"
        inputs
        outputs
        fill
        onDelete={() => remove(id)}
        headRight={
          <span className={`mb-sc-status is-${d.status}`}>
            {running && <span className="mb-sc-spinner" aria-hidden />}
            {STATUS_TEXT[d.status] ?? d.status}
          </span>
        }
      >
        <div className="mb-sc-fitwrap nowheel" ref={fitRef}>
        <div className="mb-sc-work-line">
          {WORK_TYPE_LABELS[d.workType]} · {RUN_MODE_LABELS[d.runMode]}
        </div>
        <div className="mb-sc-work-model" title={backend}>
          {PROVIDER_LABELS[d.provider]}：{backend}
        </div>
        {d.provider === 'mengbi' && (
          // 弹窗控制台里调的参数也在卡片上预览一眼（免点进去确认）
          <div className="mb-sc-work-params" title="当前生成参数（在控制台里调）">
            {[
              `比例 ${d.aspect || (d.autoAspect ? `自动→${d.autoAspect}` : '自动')}`,
              `分辨率 ${d.imageSize || '默认'}`,
              d.quality ? `质量 ${QUALITY_LABELS[d.quality] ?? d.quality}` : null,
              `张数 ${d.n}`,
              `seed ${d.seed ?? '随机'}`
            ]
              .filter(Boolean)
              .join(' · ')}
          </div>
        )}

        {(up.images.length > 0 || up.prompts.length > 0) && (
          <div className="mb-sc-up">
            <div className="mb-sc-up-head">上游输入 · {up.images.length} 图 / {up.prompts.length} 词</div>
            {up.images.length > 0 && (
              // 输入图顺序横条（所见即所发）：渲染顺序 = computeUpstream 图序 = 提交给中转站的 refs 顺序；
              // 提示词里写「图N」就是角标 N 的那张。全量渲染（横向滚动），不再只截前 4 张。
              <div className="mb-sc-uporder nodrag nowheel" title="输入图顺序：提示词里的「图1/图2…」即按此角标对应">
                {up.images.map((p, i) => (
                  <div key={`${p}-${i}`} className="mb-sc-uporder-item">
                    <img
                      src={thumbPair(p).thumb}
                      alt={`图${i + 1}`}
                      loading="lazy"
                      decoding="async"
                      draggable={false}
                      onError={(e) => {
                        const full = thumbPair(p).full;
                        if (e.currentTarget.src !== full) e.currentTarget.src = full;
                      }}
                      onClick={() =>
                        // 统一预览：全部输入图作列表，从点击的那张开始（←→ 按输入顺序翻看）
                        openPreview(
                          up.images.map((x) => ({ src: imgUrl(x), meta: { filePath: x.startsWith('data:') ? undefined : x } })),
                          i
                        )
                      }
                    />
                    <span className="mb-sc-uporder-i">图{i + 1}</span>
                  </div>
                ))}
              </div>
            )}
            {firstPrompt && (
              <div className="mb-sc-up-prompt" title={up.prompts.join('\n')}>
                “{firstPrompt}”{up.prompts.length > 1 ? `（共 ${up.prompts.length} 条 · 逐条生图）` : ''}
              </div>
            )}
          </div>
        )}

        <div className="mb-sc-work-runrow nodrag">
          <button className="mb-btn mb-btn-sm mb-btn-primary" disabled={running} onClick={() => void runWithUpstream(id)}>
            {running ? '运行中…' : '运行'}
          </button>
          {running && (
            <button className="mb-btn mb-btn-sm mb-btn-ghost" onClick={() => cancelWork(id)} title="取消并释放队列槽，可立即重试">
              取消
            </button>
          )}
          {!d.aspect && d.autoAspect && (
            <span className="mb-sc-work-autoaspect" title="自动比例：跟随首张输入图的比例（含扩图/遮罩区域）">
              自动比例 {d.autoAspect}
            </span>
          )}
        </div>

        {d.error && (
          <div className="mb-sc-result-err nodrag">
            {d.error}
            <ExplainErrorButton nodeId={id} />
          </div>
        )}
        {d.result?.durationMs != null && <div className="mb-sc-work-dur">{fmtDur(d.result.durationMs)}</div>}

        {d.result?.images && d.result.images.length > 0 && (
          <div className="mb-sc-work-thumbs nodrag">
            {d.result.images.slice(0, 4).map((p, i) => {
              const t = thumbPair(p);
              // 统一预览：本节点全部结果图作为列表，从点击的那张开始（←→ 切换）
              const all = d.result?.images ?? [];
              const preview = (): void =>
                openPreview(
                  all.map((x) => ({ src: imgUrl(x), meta: { filePath: x.startsWith('data:') ? undefined : x, prompt: d.result?.prompt } })),
                  i
                );
              return (
                <MeasuredThumb
                  key={i}
                  src={t.thumb}
                  fullSrc={t.full}
                  measureFull
                  alt={`结果 ${i + 1}`}
                  title="结果 · 角标=真实分辨率 · 拖出到其他软件直接用 · 右键更多"
                  draggable
                  onDragStart={(e) => dragOutNative(e, p, `mengbi-result-${i + 1}`)}
                  onClick={preview}
                  onContextMenu={(e) =>
                    areaMenu(e, [
                      { label: '复制图片', onClick: () => void copyImage(t.full) },
                      { label: '放大预览', onClick: preview },
                      { label: '入资产库', onClick: () => void imageToGallery(p) },
                      { label: '另存…', onClick: () => void imageSaveAs(p, 'smart-canvas-result.png') },
                      { label: '打开文件所在目录', onClick: () => void showInFolder(p) }
                    ])
                  }
                />
              );
            })}
          </div>
        )}
        </div>
      </NodeShell>
    </>
  );
}
