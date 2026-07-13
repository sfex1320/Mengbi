import { useMemo, useRef } from 'react';
import { NodeResizer, type NodeProps } from '@xyflow/react';
import { useSmartCanvasStore, useSmartTextStore } from '@/store/smartCanvasStore';
import { computeUpstream, runProofNode } from '@/lib/smartCanvasRunner';
import { useProofStudioStore } from '../ProofStudio';
import type { ProofNodeData } from '@shared/smartCanvas';
import { NodeShell } from './NodeShell';
import { useFitNodeToContent } from '../nodeArea';

const STATUS_TEXT: Record<string, string> = { idle: '待运行', running: '审稿中…', success: '已完成', error: '失败' };

/**
 * 对稿节点（精简卡片）：接海报/设计图 → 多模态模型逐元素检错（字体/元素/Logo/形态）。
 * 叠框 + 问题清单 + 标注图在「对稿工作台」弹窗里；节点输出审稿报告文本喂下游。
 */
export function ProofNode({ id, data }: NodeProps): JSX.Element {
  const remove = useSmartCanvasStore((s) => s.removeNode);
  const nodes = useSmartCanvasStore((s) => s.nodes);
  const edges = useSmartCanvasStore((s) => s.edges);
  const openStudio = useProofStudioStore((s) => s.open);
  const openText = useSmartTextStore((s) => s.open);
  const d = data as unknown as ProofNodeData;
  const up = useMemo(() => computeUpstream(nodes, edges, id), [nodes, edges, id]);
  const running = d.status === 'running';
  const els = d.elements ?? [];
  const problems = els.filter((e) => !e.ok).length;
  const upImg = up.images.length > 0 || !!d.inputImage?.url;

  // 节点高度贴合真实内容（fitwrap 实测：接入状态/元素统计/报告/报错各状态变化都自动跟随；手动 > 自适应）
  const fitRef = useRef<HTMLDivElement>(null);
  useFitNodeToContent(id, fitRef, 52, 700);

  return (
    <>
      <NodeResizer isVisible minWidth={220} minHeight={200} />
      <NodeShell
        title="对稿"
        accent="is-proof"
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
        <div className="mb-sc-revctl nodrag">
          {upImg ? (
            <div className="mb-sc-fromup is-fed">已接入图片{up.images.length > 1 ? `（用第 1 张，共 ${up.images.length} 张）` : ''}</div>
          ) : (
            <div className="mb-sc-note">连一个图片来源，或在工作台上传一张图</div>
          )}
          {els.length > 0 && (
            <div className="mb-sc-note">
              检查 {els.length} 个元素 · <b style={{ color: problems ? 'var(--mb-danger, #ef4444)' : 'var(--mb-success, #22c55e)' }}>{problems} 处问题</b>
            </div>
          )}
          <button
            className="mb-btn mb-btn-sm mb-btn-primary mb-sc-studio-openbtn"
            title="问题框叠加 / 元素问题清单 / 标注图导出 都在工作台里"
            onClick={() => openStudio(id)}
          >
            🎛 打开对稿工作台
          </button>
        </div>

        <div className="mb-sc-sb-runrow nodrag">
          <button className="mb-btn mb-btn-sm mb-sc-runbtn" disabled={running || !upImg} onClick={() => void runProofNode(id)}>
            {running ? '审稿中…' : els.length ? '重新对稿' : '开始对稿'}
          </button>
        </div>

        {d.error && <div className="mb-sc-result-err nodrag">{d.error}</div>}

        {d.reportText && (
          <div
            className="mb-sc-note nodrag"
            style={{ cursor: 'pointer' }}
            title="点击查看完整审稿报告"
            onClick={() => openText(d.reportText as string, '审稿报告')}
          >
            审稿报告已生成 · 点击查看 / 进工作台看叠框
          </div>
        )}
        </div>
      </NodeShell>
    </>
  );
}
