import { useEffect, useMemo, useState } from 'react';
import { useReactFlow, type Node } from '@xyflow/react';
import { useSmartCanvasStore, useSmartCanvasUiStore, absPosition } from '@/store/smartCanvasStore';
import type {
  PromptNodeData,
  WorkNodeData,
  LlmNodeData,
  GroupNodeData,
  ImageNodeData,
  ComfyNodeData
} from '@shared/smartCanvas';
import { NODE_ICONS } from './icons';
import type { SmartNodeKind } from '@shared/smartCanvas';

const TYPE_LABEL: Record<string, string> = {
  image: '图片',
  prompt: '提示词',
  llm: 'LLM',
  work: '生图',
  comfy: 'ComfyUI',
  result: '结果',
  group: '分组',
  'angle-prompt': '镜头',
  light: '光源',
  palette: '配色工具',
  scale: '缩放',
  ratio: '尺寸分析',
  text: '文字',
  compare: '对比',
  video: '视频',
  'image-reverse': '图像反推',
  'video-source': '视频上传',
  'video-reverse': '视频反推',
  'frame-interp': '插帧',
  'video-clip': '视频剪辑',
  storyboard: '智能分镜',
  'prompt-mall': '提示词商城',
  loop: '循环',
  upscale: '保真放大',
  vectorize: '图像转矢量',
  'folder-input': '文件夹输入',
  'folder-output': '文件夹输出'
};

/** 节点的可搜索文本（类型名 + 内容片段）。导出供画布筛选 dim 复用。 */
export function nodeSearchText(n: Node): string {
  const t = n.type ?? '';
  const label = TYPE_LABEL[t] ?? t;
  let extra = '';
  if (t === 'prompt') extra = (n.data as unknown as PromptNodeData).text ?? '';
  else if (t === 'work') extra = (n.data as unknown as WorkNodeData).prompt ?? '';
  else if (t === 'llm') {
    const d = n.data as unknown as LlmNodeData;
    extra = `${d.input ?? ''} ${d.resultText ?? ''}`;
  } else if (t === 'group') extra = (n.data as unknown as GroupNodeData).title ?? '';
  else if (t === 'image') extra = (n.data as unknown as ImageNodeData).name ?? '';
  else if (t === 'comfy') extra = (n.data as unknown as ComfyNodeData).templateName ?? '';
  return `${label} ${extra}`.toLowerCase();
}

/** 节点搜索（Ctrl+F）：输入关键词 → 命中列表 → 点击居中并选中该节点。 */
export function NodeSearch({ onClose }: { onClose: () => void }): JSX.Element {
  const nodes = useSmartCanvasStore((s) => s.nodes);
  const selectOnly = useSmartCanvasStore((s) => s.selectOnly);
  const setDimFilter = useSmartCanvasUiStore((s) => s.setDimFilter);
  const { setCenter, getZoom } = useReactFlow();
  const [q, setQ] = useState('');

  // 输入关键词即在画布上把不匹配的节点变暗（筛选显示）；关闭搜索清除筛选
  useEffect(() => {
    setDimFilter(q.trim());
  }, [q, setDimFilter]);
  useEffect(() => () => setDimFilter(''), [setDimFilter]);

  const matches = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return [];
    return nodes.filter((n) => nodeSearchText(n).includes(query)).slice(0, 12);
  }, [q, nodes]);

  function jump(n: Node): void {
    const abs = absPosition(n, nodes);
    const w = n.measured?.width ?? (typeof n.width === 'number' ? n.width : 240);
    const h = n.measured?.height ?? (typeof n.height === 'number' ? n.height : 140);
    selectOnly(n.id);
    void setCenter(abs.x + w / 2, abs.y + h / 2, { zoom: Math.max(getZoom(), 0.8), duration: 350 });
    onClose();
  }

  function snippet(n: Node): string {
    const txt = nodeSearchText(n);
    return txt.length > 48 ? `${txt.slice(0, 48)}…` : txt;
  }

  return (
    <div className="mb-sc-search mb-card">
      <input
        className="mb-input mb-sc-search-input"
        autoFocus
        placeholder="搜索节点（类型 / 文字）… Esc 关闭"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
          else if (e.key === 'Enter' && matches.length) jump(matches[0]);
        }}
      />
      {q.trim() && (
        <div className="mb-sc-search-list">
          {matches.length === 0 ? (
            <div className="mb-sc-search-empty">没有匹配的节点</div>
          ) : (
            matches.map((n) => {
              const Ico = NODE_ICONS[(n.type ?? 'work') as SmartNodeKind] ?? NODE_ICONS.work;
              return (
                <button key={n.id} className="mb-sc-search-item" onClick={() => jump(n)}>
                  <Ico size={14} />
                  <span className="mb-sc-search-item-text">{snippet(n)}</span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
