import { useMemo, useRef } from 'react';
import { NodeResizer, type NodeProps } from '@xyflow/react';
import { useSmartCanvasStore, useSmartPreviewStore } from '@/store/smartCanvasStore';
import { computeUpstream, runSegmentNode, cancelSegment } from '@/lib/smartCanvasRunner';
import { useSegmentStudioStore } from '../SegmentStudio';
import { localPathToImageUrl } from '@/lib/imageUrl';
import type { SegmentNodeData } from '@shared/smartCanvas';
import { NodeShell } from './NodeShell';
import { MeasuredThumb, thumbPair } from '../MeasuredThumb';
import { useFitNodeToContent } from '../nodeArea';

const STATUS_TEXT: Record<string, string> = { idle: '待运行', running: '处理中…', success: '已完成', error: '失败' };

function mediaUrl(src: string): string {
  return src.startsWith('data:') ? src : localPathToImageUrl(src);
}

/**
 * 切分工具节点（精简卡片）：上游图 → 识别元素 → 逐元素重绘 → 1:1 拼回整图。
 * 全流程（识别框/调框/反推/统一风格/重绘/拼合）在「切分工作台」弹窗里（useSegmentStudioStore）。
 * 卡片只留：上游图状态 / 元素数 / 运行(一键) / 打开工作台 / 拼合图预览。
 */
export function SegmentNode({ id, data }: NodeProps): JSX.Element {
  const remove = useSmartCanvasStore((s) => s.removeNode);
  const nodes = useSmartCanvasStore((s) => s.nodes);
  const edges = useSmartCanvasStore((s) => s.edges);
  const openStudio = useSegmentStudioStore((s) => s.open);
  const openPreview = useSmartPreviewStore((s) => s.open);
  const d = data as unknown as SegmentNodeData;
  const up = useMemo(() => computeUpstream(nodes, edges, id), [nodes, edges, id]);
  const running = d.status === 'running';
  const els = d.elements ?? [];
  const upImg = up.images.length > 0 || !!d.inputImage?.url;
  // 空态 = 没图也没识别结果：卡体中央显示流程引导（取代原先会被遮的 tooltip 提示）
  const empty = !upImg && els.length === 0;

  // 节点高度贴合真实内容（fitwrap 实测，双向；手动 > 自适应）——不再用 autoGrowNode 拍脑袋估高
  const fitRef = useRef<HTMLDivElement>(null);
  useFitNodeToContent(id, fitRef, 52, 700);

  const composed = d.composedSrc ? thumbPair(d.composedSrc) : null;

  return (
    <>
      <NodeResizer isVisible minWidth={220} minHeight={200} />
      <NodeShell
        title="切分工具"
        accent="is-segment"
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
          {/* 主入口固定排在卡体第一位：常显渐变按钮，不靠 tooltip、不会被连接口/后续内容遮挡或挤出 */}
          <button className="mb-btn mb-btn-sm mb-btn-primary mb-sc-seg-openbtn" onClick={() => openStudio(id)}>
            🎛 打开切分工作台
          </button>
          {empty ? (
            <div className="mb-sc-seg-guide">
              <b>切分重绘流程</b>
              <span>① 连一张图（或进工作台上传）</span>
              <span>② 识别元素 → 拖框校准</span>
              <span>③ 统一风格 · 逐元素重绘</span>
              <span>④ 1:1 拼回整图输出</span>
            </div>
          ) : (
            <>
              {up.images.length > 0 ? (
                <div className="mb-sc-fromup is-fed">已接入图片{up.images.length > 1 ? `（用第 1 张，共 ${up.images.length} 张）` : ''}</div>
              ) : d.inputImage?.url ? (
                <div className="mb-sc-note">已上传图片（在工作台可更换）</div>
              ) : (
                <div className="mb-sc-note">源图已断开：连一个图片来源，或到工作台重新上传</div>
              )}
              {els.length > 0 && (
                <div className="mb-sc-note">
                  识别 {els.length} 个元素 · 已重绘 {els.filter((e) => e.status === 'done').length}/{els.length}
                </div>
              )}
            </>
          )}
        </div>

        <div className="mb-sc-sb-runrow nodrag">
          {running ? (
            <button className="mb-btn mb-btn-sm is-stop" onClick={() => cancelSegment(id)}>
              取消
            </button>
          ) : (
            <button className="mb-btn mb-btn-sm mb-sc-runbtn" disabled={!upImg} onClick={() => void runSegmentNode(id)}>
              一键切分重绘
            </button>
          )}
        </div>

        {d.phase && running && <div className="mb-sc-work-dur nodrag">{d.phase}</div>}
        {d.error && <div className="mb-sc-result-err nodrag">{d.error}</div>}

        {composed && (
          <div className="mb-sc-seg-out nodrag">
            <div className="mb-sc-result-meta">拼合输出</div>
            <MeasuredThumb
              src={composed.thumb}
              fullSrc={composed.full}
              measureFull
              alt="拼合图"
              onClick={() => openPreview([{ src: mediaUrl(d.composedSrc as string) }], 0)}
            />
          </div>
        )}
        </div>
      </NodeShell>
    </>
  );
}
