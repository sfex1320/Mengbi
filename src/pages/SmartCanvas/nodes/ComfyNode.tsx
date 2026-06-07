import { useMemo } from 'react';
import { NodeResizer, type NodeProps } from '@xyflow/react';
import { useSmartCanvasStore, useSmartPreviewStore, useSmartTextStore } from '@/store/smartCanvasStore';
import { runWithUpstream, comfyInputSlots, cancelComfy, forceResetComfy, computeUpstream } from '@/lib/smartCanvasRunner';
import { localPathToImageUrl } from '@/lib/imageUrl';
import type { ComfyNodeData } from '@shared/smartCanvas';
import { NodeShell } from './NodeShell';
import { MeasuredThumb } from '../MeasuredThumb';
import { fmtDur, areaMenu, copyText, copyImage, imageToGallery, imageSaveAs, makePromptNodeFrom } from '../nodeArea';

const STATUS_TEXT: Record<string, string> = {
  idle: '待运行',
  running: '运行中…',
  success: '成功',
  error: '失败'
};

function imgUrl(src: string): string {
  return src.startsWith('data:') ? src : localPathToImageUrl(src);
}

/** ComfyUI 节点：绑定工作流模板，运行后取回输出图。模板与控件在弹出检查器编辑。 */
export function ComfyNode({ id, data }: NodeProps): JSX.Element {
  const remove = useSmartCanvasStore((s) => s.removeNode);
  const openPreview = useSmartPreviewStore((s) => s.open);
  const openText = useSmartTextStore((s) => s.open);
  const nodes = useSmartCanvasStore((s) => s.nodes);
  const edges = useSmartCanvasStore((s) => s.edges);
  const d = data as unknown as ComfyNodeData;
  const running = d.status === 'running';
  const slots = comfyInputSlots(d.controls);
  // 真实上游（实时按连线计算，运行也用它；没接就是没接，不存在「后台缓存的旧输入」）
  const up = useMemo(() => computeUpstream(nodes, edges, id), [nodes, edges, id]);
  const texts = d.result?.texts ?? [];

  return (
    <>
      <NodeResizer isVisible minWidth={210} minHeight={150} />
      <NodeShell
        title="ComfyUI"
        accent="is-comfy"
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
        <div className="mb-sc-work-line">{d.templateName || '未选工作流模板'}</div>
        <div className="mb-sc-work-model">
          {!d.workflowId
            ? '选中后在检查器里选模板'
            : up.prompts.length || up.images.length
              ? `上游输入：${up.prompts.length} 词 · ${up.images.length} 图`
              : `未接上游 · 可接 ${slots.text.length} 词 / ${slots.image.length} 图（现用工作流默认）`}
        </div>
        <div className="mb-sc-work-runrow nodrag">
          <button className="mb-btn mb-btn-sm mb-btn-primary" disabled={running || !d.workflowId} onClick={() => void runWithUpstream(id)}>
            {running ? '运行中…' : '运行'}
          </button>
          {running && (
            <>
              <button className="mb-btn mb-btn-sm mb-btn-ghost" onClick={() => cancelComfy(id)} title="取消运行">
                取消
              </button>
              <button
                className="mb-btn mb-btn-sm mb-btn-ghost"
                onClick={() => forceResetComfy(id)}
                title="点取消没反应、卡住时：强制把状态重置为「待运行」（不依赖后端）"
              >
                强制重置
              </button>
            </>
          )}
        </div>
        {d.error && <div className="mb-sc-result-err">{d.error}</div>}
        {d.result?.durationMs != null && <div className="mb-sc-work-dur">{fmtDur(d.result.durationMs)}</div>}
        {d.result?.images && d.result.images.length > 0 && (
          <div className="mb-sc-work-thumbs nodrag">
            {d.result.images.slice(0, 4).map((p, i) => (
              <MeasuredThumb
                key={i}
                src={imgUrl(p)}
                alt={`输出 ${i + 1}`}
                title="结果 · 角标=实际分辨率 · 右键复制 / 另存"
                onClick={() => openPreview(imgUrl(p))}
                onContextMenu={(e) =>
                  areaMenu(e, [
                    { label: '复制图片', onClick: () => void copyImage(imgUrl(p)) },
                    { label: '放大预览', onClick: () => openPreview(imgUrl(p)) },
                    { label: '入图库', onClick: () => void imageToGallery(p) },
                    { label: '另存…', onClick: () => void imageSaveAs(p, 'comfyui-result.png') }
                  ])
                }
              />
            ))}
          </div>
        )}
        {texts.length > 0 && (
          <div className="mb-sc-result-texts nodrag">
            {texts.map((t, i) => (
              <div
                key={i}
                className="mb-sc-result-text"
                title="点击放大 · 右键复制 / 用输出建提示词节点"
                onClick={() => openText(t, 'ComfyUI 文本输出')}
                onContextMenu={(e) =>
                  areaMenu(e, [
                    { label: '复制文本', onClick: () => copyText(t) },
                    { label: '用输出建提示词节点', onClick: () => makePromptNodeFrom(id, t) },
                    { label: '放大查看', onClick: () => openText(t, 'ComfyUI 文本输出') }
                  ])
                }
              >
                {t}
              </div>
            ))}
            <button
              className="mb-btn mb-btn-sm mb-btn-ghost nodrag mb-sc-toprompt"
              title="把全部文本输出导入一个下游提示词节点"
              onClick={() => makePromptNodeFrom(id, texts.join('\n'))}
            >
              → 提示词节点
            </button>
          </div>
        )}
      </NodeShell>
    </>
  );
}
