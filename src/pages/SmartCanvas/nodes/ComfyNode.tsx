import { useMemo, useRef } from 'react';
import { NodeResizer, type NodeProps } from '@xyflow/react';
import { useSmartCanvasStore, useSmartPreviewStore, useSmartTextStore } from '@/store/smartCanvasStore';
import { runWithUpstream, comfyInputSlots, cancelComfy, forceResetComfy, computeUpstream } from '@/lib/smartCanvasRunner';
import type { ComfyNodeData } from '@shared/smartCanvas';
import { NodeShell } from './NodeShell';
import { ExplainErrorButton } from './ExplainErrorButton';
import { MeasuredThumb, thumbPair } from '../MeasuredThumb';
import { fmtDur, areaMenu, copyText, copyImage, imageToGallery, imageSaveAs, makePromptNodeFrom, ToPromptButton, useFitNodeToContent, dragOutNative, showInFolder } from '../nodeArea';

const STATUS_TEXT: Record<string, string> = {
  idle: '待运行',
  running: '运行中…',
  success: '成功',
  error: '失败'
};

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

  // 外接提示词：新建一个提示词节点放到本节点左侧并连上（在那里编辑提示词更方便）
  function attachPromptNode(): void {
    const st = useSmartCanvasStore.getState();
    const self = st.nodes.find((n) => n.id === id);
    const pos = self ? { x: self.position.x - 320, y: self.position.y } : undefined;
    const pid = st.addNode('prompt', pos);
    st.onConnect({ source: pid, target: id, sourceHandle: null, targetHandle: null });
    st.selectOnly(pid);
  }

  // 节点高度贴合真实内容（fitwrap 实测，双向：外接提示词/报错/结果图行数/文本清单变化都自动跟随；手动 > 自适应）
  const fitRef = useRef<HTMLDivElement>(null);
  useFitNodeToContent(id, fitRef, 52, 900);

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
        <div className="mb-sc-fitwrap nowheel" ref={fitRef}>
        <div className="mb-sc-work-line">{d.templateName || '未选工作流模板'}</div>
        <div className="mb-sc-work-model">
          {!d.workflowId
            ? '选中后在检查器里选模板'
            : up.prompts.length || up.images.length
              ? `上游输入：${up.prompts.length} 词 · ${up.images.length} 图`
              : `未接上游 · 可接 ${slots.text.length} 词 / ${slots.image.length} 图（现用工作流默认）`}
        </div>
        {d.workflowId &&
          (up.prompts.length > 0 ? (
            <div
              className="mb-sc-comfy-prompt nodrag"
              title="送入工作流的提示词（来自上游提示词节点）· 点击放大查看"
              onClick={() => openText(up.prompts.join('\n'), 'ComfyUI 提示词（外接）')}
            >
              <span className="mb-sc-comfy-prompt-tag">外接提示词</span>
              <span className="mb-sc-comfy-prompt-text">{up.prompts.join(' / ')}</span>
            </div>
          ) : slots.text.length > 0 ? (
            <button
              className="mb-sc-comfy-attach nodrag"
              onClick={attachPromptNode}
              title="新建一个提示词节点并连到本节点的文本控件——在提示词节点里编辑更方便（外接）"
            >
              ＋ 接提示词节点（外接编辑）
            </button>
          ) : null)}
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
              // 统一预览：本节点全部输出图作为列表，从点击的那张开始（←→ 切换）
              const all = d.result?.images ?? [];
              const preview = (): void =>
                openPreview(
                  all.map((x) => ({
                    src: x.startsWith('data:') ? x : thumbPair(x).full,
                    meta: { filePath: x.startsWith('data:') ? undefined : x }
                  })),
                  i
                );
              return (
                <MeasuredThumb
                  key={i}
                  src={t.thumb}
                  fullSrc={t.full}
                  measureFull
                  alt={`输出 ${i + 1}`}
                  title="结果 · 角标=真实分辨率 · 拖出到其他软件直接用 · 右键更多"
                  draggable
                  onDragStart={(e) => dragOutNative(e, p, `comfyui-result-${i + 1}`)}
                  onClick={preview}
                  onContextMenu={(e) =>
                    areaMenu(e, [
                      { label: '复制图片', onClick: () => void copyImage(t.full) },
                      { label: '放大预览', onClick: preview },
                      { label: '入资产库', onClick: () => void imageToGallery(p) },
                      { label: '另存…', onClick: () => void imageSaveAs(p, 'comfyui-result.png') },
                      { label: '打开文件所在目录', onClick: () => void showInFolder(p) }
                    ])
                  }
                />
              );
            })}
          </div>
        )}
        {texts.length > 0 && (
          <div className="mb-sc-result-texts mb-sc-comfy-texts nodrag">
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
            <ToPromptButton onClick={() => makePromptNodeFrom(id, texts.join('\n'))} title="把全部文本输出导入一个下游提示词节点" />
          </div>
        )}
        </div>
      </NodeShell>
    </>
  );
}
