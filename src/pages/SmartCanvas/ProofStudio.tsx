import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { useSmartCanvasStore, useSmartPreviewStore, useSmartTextStore } from '@/store/smartCanvasStore';
import { useSettingsStore } from '@/store/settingsStore';
import { computeUpstream, runProofNode } from '@/lib/smartCanvasRunner';
import { localPathToImageUrl } from '@/lib/imageUrl';
import { severityColor } from '@/lib/visionSegment';
import {
  PROOF_ISSUE_LABELS,
  PROOF_SEVERITY_LABELS,
  type ElementRect,
  type ProofNodeData,
  type SmartNodeData
} from '@shared/smartCanvas';
import { SearchableModelSelect } from './nodePanel/consoleControls';
import { copyText, imageSaveAs, imageToGallery, useBackdropClose } from './nodeArea';
import { BoxOverlayEditor, type OverlayBox } from './BoxOverlayEditor';

/** 对稿工作台（弹窗）开关：哪个对稿节点在编辑（null = 不显示）。 */
interface ProofStudioState {
  nodeId: string | null;
  open: (nodeId: string) => void;
  close: () => void;
}
export const useProofStudioStore = create<ProofStudioState>((set) => ({
  nodeId: null,
  open: (nodeId) => set({ nodeId }),
  close: () => set({ nodeId: null })
}));

const STATUS_TEXT: Record<string, string> = { idle: '待运行', running: '审稿中…', success: '已完成', error: '失败' };

function mediaUrl(src: string): string {
  return src.startsWith('data:') ? src : localPathToImageUrl(src);
}

/**
 * 对稿工作台：左=设定（视觉模型 / 上传图 / 开始对稿），中=海报 + 问题框叠加（按严重度配色），
 * 右=元素问题清单（类型 / 描述 / 修改建议）。审稿报告作节点文本输出喂下游，可导出标注图。
 */
export function ProofStudio(): JSX.Element | null {
  const nodeId = useProofStudioStore((s) => s.nodeId);
  const close = useProofStudioStore((s) => s.close);
  const backdrop = useBackdropClose(close);
  const nodes = useSmartCanvasStore((s) => s.nodes);
  const edges = useSmartCanvasStore((s) => s.edges);
  const update = useSmartCanvasStore((s) => s.updateNodeData);
  const openPreview = useSmartPreviewStore((s) => s.open);
  const openText = useSmartTextStore((s) => s.open);
  const configs = useSettingsStore((s) => s.configs);

  const node = nodeId ? nodes.find((n) => n.id === nodeId) : undefined;
  const d = node?.type === 'proof' ? (node.data as unknown as ProofNodeData) : null;
  const up = useMemo(
    () => (nodeId && d ? computeUpstream(nodes, edges, nodeId) : { images: [] as string[], prompts: [], refs: [], videos: [], sizes: [] }),
    [nodes, edges, nodeId, d]
  );
  const src = up.images[0] || d?.inputImage?.url || '';
  const visionModels = useMemo(() => textModelNames(configs), [configs]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [measured, setMeasured] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    setMeasured(null);
    if (!src) return;
    let alive = true;
    const im = new Image();
    im.onload = () => {
      if (alive && im.naturalWidth) setMeasured({ w: im.naturalWidth, h: im.naturalHeight });
    };
    im.src = mediaUrl(src);
    return () => {
      alive = false;
      im.onload = null;
    };
  }, [src]);

  useEffect(() => {
    if (!nodeId) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nodeId, close]);
  useEffect(() => {
    if (nodeId && !d) close();
  }, [nodeId, d, close]);

  if (!nodeId || !d) return null;
  const setF = (p: Partial<ProofNodeData>): void => update(nodeId, p as Partial<SmartNodeData>);
  const els = d.elements ?? [];
  const problems = els.filter((e) => !e.ok);
  const running = d.status === 'running';
  // 源图换了（连线换上游）就用现量尺寸而非旧检测尺寸，否则问题框按旧比例错位
  const useDetected = d.analysisSrc === src;
  const imgW = (useDetected ? d.imgW : 0) || measured?.w || 0;
  const imgH = (useDetected ? d.imgH : 0) || measured?.h || 0;

  // 只把有问题的元素画框（ok 的不画，避免画面太乱）；可手动拖动校准框位置
  const overlay: OverlayBox[] = problems.map((e, i) => ({
    id: e.id,
    box: e.box,
    label: `${i + 1}. ${e.label}`,
    color: e.id === selectedId ? 'var(--mb-accent)' : severityColor(e.severity)
  }));
  const onBoxChange = (boxId: string, box: ElementRect): void => {
    setF({ elements: els.map((e) => (e.id === boxId ? { ...e, box } : e)) });
  };

  async function onUpload(file: File): Promise<void> {
    const du = await new Promise<string>((res) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result));
      fr.readAsDataURL(file);
    });
    let url = du;
    try {
      const r = await window.electronAPI.storage.saveCanvasAsset({ dataUri: du });
      if (r.ok && r.data.filePath) url = r.data.filePath;
    } catch {
      /* 落盘失败用 dataURI */
    }
    setF({ inputImage: { url, name: file.name }, elements: [], reportText: undefined, annotatedSrc: undefined, imgW: undefined, imgH: undefined });
  }

  return createPortal(
    <div className="mb-modal-backdrop" {...backdrop}>
      <div className="mb-modal mb-sc-studio mb-sc-proofstudio mb-card" onClick={(e) => e.stopPropagation()}>
        <div className="mb-sc-studio-head">
          <h3>对稿工作台</h3>
          <span className={`mb-sc-status is-${d.status}`}>
            {running && <span className="mb-sc-spinner" aria-hidden />}
            {STATUS_TEXT[d.status] ?? d.status}
          </span>
          <span className="mb-sc-studio-hint">逐元素检错：字体 / 元素 / Logo / 形态 · 问题框按严重度配色</span>
          <button className="mb-sc-node-x" onClick={close} title="关闭（Esc）">
            ✕
          </button>
        </div>

        <div className="mb-sc-studio-body">
          {/* ── 左：设定 ── */}
          <div className="mb-sc-studio-right mb-sc-seg-set">
            <label className="mb-sc-flabel">视觉模型（多模态/识图）</label>
            <SearchableModelSelect options={visionModels} value={d.modelId ?? ''} onChange={(v) => setF({ modelId: v })} placeholder="选支持识图的对话模型" />
            <label className="mb-sc-flabel">源图</label>
            {up.images.length > 0 ? (
              <div className="mb-sc-fromup is-fed">由上游输入（{up.images.length} 张，用第 1 张）</div>
            ) : (
              <label className="mb-btn mb-btn-sm" style={{ cursor: 'pointer', textAlign: 'center' }}>
                {d.inputImage?.url ? '更换图片…' : '上传图片…'}
                <input
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void onUpload(f);
                    e.currentTarget.value = '';
                  }}
                />
              </label>
            )}

            <div className="mb-sc-seg-actions">
              <button className="mb-btn mb-btn-sm mb-btn-primary mb-sc-runbtn" disabled={running || !src || !d.modelId} onClick={() => void runProofNode(nodeId)}>
                {running ? '审稿中…' : els.length ? '重新对稿' : '开始对稿'}
              </button>
            </div>
            {d.error && <div className="mb-sc-result-err">{d.error}</div>}
            {els.length > 0 && (
              <div className="mb-sc-note">
                检查 {els.length} 个元素 · 发现 <b style={{ color: problems.length ? '#ef4444' : '#22c55e' }}>{problems.length}</b> 处问题
              </div>
            )}
            {d.reportText && (
              <button className="mb-btn mb-btn-sm" onClick={() => openText(d.reportText as string, '审稿报告')}>
                查看审稿报告全文
              </button>
            )}
          </div>

          {/* ── 中：海报 + 问题框 ── */}
          <div className="mb-sc-studio-center mb-sc-seg-center">
            {src && imgW && imgH ? (
              <BoxOverlayEditor
                src={src}
                imgW={imgW}
                imgH={imgH}
                boxes={overlay}
                editable={!running}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onChange={onBoxChange}
              />
            ) : (
              <div className="mb-sc-seg-empty">{src ? '读取图片中…' : '先连一个图片来源或上传一张图'}</div>
            )}
            {d.annotatedSrc && (
              <div className="mb-sc-seg-toolbar">
                <button className="mb-btn mb-btn-sm" onClick={() => openPreview([{ src: mediaUrl(d.annotatedSrc as string) }], 0)}>
                  放大标注图
                </button>
                <button className="mb-btn mb-btn-sm" onClick={() => void imageSaveAs(d.annotatedSrc as string, 'proof-annotated.png')}>
                  导出标注图
                </button>
                <button className="mb-btn mb-btn-sm" onClick={() => void imageToGallery(d.annotatedSrc as string)}>
                  入资产库
                </button>
              </div>
            )}
          </div>

          {/* ── 右：问题清单 ── */}
          <div className="mb-sc-studio-right mb-sc-seg-list">
            <div className="mb-sc-studio-hint" style={{ marginBottom: 6 }}>
              {els.length ? `${problems.length} 处问题（点条目高亮对应框）` : '点「开始对稿」逐元素检错'}
            </div>
            {problems.length === 0 && els.length > 0 && <div className="mb-sc-note">未发现明显的字体/元素/Logo/形态问题 👍</div>}
            {problems.map((e, i) => (
              <div
                key={e.id}
                className={`mb-sc-proof-item${e.id === selectedId ? ' is-sel' : ''}`}
                onClick={() => setSelectedId(e.id)}
              >
                <div className="mb-sc-proof-item-head">
                  <span className="mb-sc-seg-idx" style={{ background: severityColor(e.severity) }}>{i + 1}</span>
                  <span className="mb-sc-proof-label">{e.label}</span>
                  <span className="mb-sc-proof-sev" style={{ color: severityColor(e.severity) }}>{PROOF_SEVERITY_LABELS[e.severity]}</span>
                </div>
                <div className="mb-sc-proof-tags">
                  {e.issueTypes.map((t) => (
                    <span key={t} className="mb-sc-proof-tag">{PROOF_ISSUE_LABELS[t]}</span>
                  ))}
                </div>
                {e.description && <div className="mb-sc-proof-desc">问题：{e.description}</div>}
                {e.suggestion && <div className="mb-sc-proof-fix">建议：{e.suggestion}</div>}
              </div>
            ))}
            {d.reportText && (
              <button className="mb-btn mb-btn-xs" style={{ marginTop: 8 }} onClick={() => copyText(d.reportText as string)}>
                复制审稿报告
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

function textModelNames(configs: ReturnType<typeof useSettingsStore.getState>['configs']): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of configs) {
    if (c.type !== 'text') continue;
    for (const n of Object.keys(c.model_mapping ?? {})) if (!seen.has(n)) { seen.add(n); out.push(n); }
  }
  return out;
}
