import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { useSmartCanvasStore, useSmartPreviewStore } from '@/store/smartCanvasStore';
import { useSettingsStore } from '@/store/settingsStore';
import {
  computeUpstream,
  runSegmentDetect,
  runSegmentRegenAll,
  runSegmentRegenOne,
  runSegmentCompose,
  runSegmentNode,
  cancelSegment
} from '@/lib/smartCanvasRunner';
import { localPathToImageUrl } from '@/lib/imageUrl';
import type { ElementRect, SegmentNodeData, SmartNodeData } from '@shared/smartCanvas';
import { SearchableModelSelect } from './nodePanel/consoleControls';
import { useBackdropClose } from './nodeArea';
import { BoxOverlayEditor, type OverlayBox } from './BoxOverlayEditor';
import { MeasuredThumb, thumbPair } from './MeasuredThumb';

/** 切分工作台（弹窗）开关：哪个切分节点在编辑（null = 不显示）。 */
interface SegmentStudioState {
  nodeId: string | null;
  open: (nodeId: string) => void;
  close: () => void;
}
export const useSegmentStudioStore = create<SegmentStudioState>((set) => ({
  nodeId: null,
  open: (nodeId) => set({ nodeId }),
  close: () => set({ nodeId: null })
}));

const STATUS_TEXT: Record<string, string> = { idle: '待运行', running: '处理中…', success: '已完成', error: '失败' };
const EL_STATUS: Record<string, string> = { idle: '待重绘', running: '重绘中…', done: '已重绘', error: '失败' };

function mediaUrl(src: string): string {
  return src.startsWith('data:') ? src : localPathToImageUrl(src);
}

/**
 * 切分工作台：左=设定（视觉模型 / 生图模型 / 统一风格 / 上传图 / 一键全流程），
 * 中=图片 + 可拖拽缩放的元素框（识别 / 重绘 / 拼合），右=元素清单（逐个反推词 + 单独重绘 + 预览）。
 * 全部运行链路复用 runSegment*（零改动），节点卡只留摘要。
 */
export function SegmentStudio(): JSX.Element | null {
  const nodeId = useSegmentStudioStore((s) => s.nodeId);
  const close = useSegmentStudioStore((s) => s.close);
  const backdrop = useBackdropClose(close);
  const nodes = useSmartCanvasStore((s) => s.nodes);
  const edges = useSmartCanvasStore((s) => s.edges);
  const update = useSmartCanvasStore((s) => s.updateNodeData);
  const openPreview = useSmartPreviewStore((s) => s.open);
  const configs = useSettingsStore((s) => s.configs);

  const node = nodeId ? nodes.find((n) => n.id === nodeId) : undefined;
  const d = node?.type === 'segment' ? (node.data as unknown as SegmentNodeData) : null;
  const up = useMemo(
    () => (nodeId && d ? computeUpstream(nodes, edges, nodeId) : { images: [] as string[], prompts: [], refs: [], videos: [], sizes: [] }),
    [nodes, edges, nodeId, d]
  );
  const src = up.images[0] || d?.inputImage?.url || '';

  const visionModels = useMemo(() => modelNames(configs, 'text'), [configs]);
  const genModels = useMemo(() => modelNames(configs, 'image'), [configs]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [measured, setMeasured] = useState<{ w: number; h: number } | null>(null);

  // 量源图尺寸（识别前用于框的参照系；识别后以 d.imgW/H 为准）
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
  const setF = (p: Partial<SegmentNodeData>): void => update(nodeId, p as Partial<SmartNodeData>);
  const els = d.elements ?? [];
  // 节点级运行，或任一元素在单独重绘中 → 都视为「忙」：禁用全流程/逐元素重绘/框编辑/清单编辑，杜绝并发互相覆盖
  const running = d.status === 'running' || els.some((e) => e.status === 'running');
  // 仅当「识别用的图 == 当前源图」才用识别时记下的尺寸；源图换了（连线换上游）就用现量的尺寸，否则框按旧比例错位
  const useDetected = d.analysisSrc === src;
  const imgW = (useDetected ? d.imgW : 0) || measured?.w || 0;
  const imgH = (useDetected ? d.imgH : 0) || measured?.h || 0;

  const setEl = (idx: number, patch: Partial<(typeof els)[number]>): void => {
    setF({ elements: els.map((e, i) => (i === idx ? { ...e, ...patch } : e)) });
  };
  const delEl = (idx: number): void => setF({ elements: els.filter((_, i) => i !== idx) });
  const addBox = (): void => {
    if (!imgW || !imgH) return;
    const w = Math.round(imgW * 0.25);
    const h = Math.round(imgH * 0.25);
    const box: ElementRect = { x: Math.round(imgW * 0.375), y: Math.round(imgH * 0.375), w, h };
    const id = `seg-manual-${Date.now()}`;
    setF({ elements: [...els, { id, label: `元素 ${els.length + 1}`, box, prompt: '', status: 'idle', error: null }] });
    setSelectedId(id);
  };

  const overlay: OverlayBox[] = els.map((e, i) => ({
    id: e.id,
    box: e.box,
    label: `${i + 1}. ${e.label}`,
    color: e.id === selectedId ? 'var(--mb-accent)' : e.status === 'done' ? '#22c55e' : e.status === 'error' ? '#ef4444' : '#60a5fa'
  }));
  const onBoxChange = (boxId: string, box: ElementRect): void => {
    const idx = els.findIndex((e) => e.id === boxId);
    if (idx >= 0) setEl(idx, { box });
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
    setF({ inputImage: { url, name: file.name }, elements: [], composedSrc: undefined, imgW: undefined, imgH: undefined });
  }

  return createPortal(
    <div className="mb-modal-backdrop" {...backdrop}>
      <div className="mb-modal mb-sc-studio mb-sc-segstudio mb-card" onClick={(e) => e.stopPropagation()}>
        <div className="mb-sc-studio-head">
          <h3>切分工作台</h3>
          <span className={`mb-sc-status is-${d.status}`}>
            {running && <span className="mb-sc-spinner" aria-hidden />}
            {STATUS_TEXT[d.status] ?? d.status}
          </span>
          <span className="mb-sc-studio-hint">识别元素 → 拖框校准 → 逐元素反推+重绘 → 1:1 拼回整图</span>
          <button className="mb-sc-node-x" onClick={close} title="关闭（Esc）">
            ✕
          </button>
        </div>

        <div className="mb-sc-studio-body">
          {/* ── 左：设定 ── */}
          <div className="mb-sc-studio-right mb-sc-seg-set">
            <label className="mb-sc-flabel">视觉模型（识别 + 反推）</label>
            <SearchableModelSelect options={visionModels} value={d.modelId ?? ''} onChange={(v) => setF({ modelId: v })} placeholder="选支持识图的对话模型" />
            <label className="mb-sc-flabel">生图模型（逐元素重绘）</label>
            <SearchableModelSelect options={genModels} value={d.genModelId ?? ''} onChange={(v) => setF({ genModelId: v })} placeholder="选绘画模型（空=默认首个）" />
            <label className="mb-sc-flabel">统一风格（拼进每个元素的重绘提示词）</label>
            <textarea
              className="mb-sc-input"
              rows={3}
              value={d.stylePrompt ?? ''}
              placeholder="如：扁平插画风、统一暖色调、相同光照（保证元素风格一致）"
              onChange={(e) => setF({ stylePrompt: e.target.value })}
            />
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
              {running ? (
                <button className="mb-btn mb-btn-sm is-stop" onClick={() => cancelSegment(nodeId)}>
                  取消
                </button>
              ) : (
                <button className="mb-btn mb-btn-sm mb-btn-primary mb-sc-runbtn" disabled={!src} onClick={() => void runSegmentNode(nodeId)}>
                  一键全流程
                </button>
              )}
            </div>
            {d.phase && running && <div className="mb-sc-work-dur">{d.phase}</div>}
            {d.error && <div className="mb-sc-result-err">{d.error}</div>}
            {d.logs?.length ? <div className="mb-sc-note">{d.logs[d.logs.length - 1]}</div> : null}
          </div>

          {/* ── 中：图 + 元素框 ── */}
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
            <div className="mb-sc-seg-toolbar">
              <button className="mb-btn mb-btn-sm" disabled={running || !src || !d.modelId} onClick={() => void runSegmentDetect(nodeId)}>
                {els.length ? '重新识别元素' : '识别元素'}
              </button>
              <button className="mb-btn mb-btn-sm" disabled={running || !els.length} onClick={() => void runSegmentRegenAll(nodeId)}>
                逐元素重绘
              </button>
              <button className="mb-btn mb-btn-sm" disabled={running || !els.some((e) => e.regenSrc)} onClick={() => void runSegmentCompose(nodeId)}>
                拼回整图
              </button>
              <button className="mb-btn mb-btn-sm" disabled={running || !imgW || !imgH} onClick={addBox} title="手动加一个元素框（自动识别不准时）">
                ＋ 加框
              </button>
            </div>
            {d.composedSrc && (
              <div className="mb-sc-seg-composed">
                <div className="mb-sc-result-meta">拼合输出（点击放大）</div>
                <MeasuredThumb
                  src={thumbPair(d.composedSrc).thumb}
                  fullSrc={thumbPair(d.composedSrc).full}
                  measureFull
                  alt="拼合图"
                  onClick={() => openPreview([{ src: mediaUrl(d.composedSrc as string) }], 0)}
                />
              </div>
            )}
          </div>

          {/* ── 右：元素清单 ── */}
          <div className="mb-sc-studio-right mb-sc-seg-list">
            <div className="mb-sc-studio-hint" style={{ marginBottom: 6 }}>
              {els.length ? `${els.length} 个元素（点框选中 / 拖框调位 / 角点缩放）` : '点「识别元素」自动找出画面元素'}
            </div>
            {els.map((e, i) => (
              <div
                key={e.id}
                className={`mb-sc-seg-item${e.id === selectedId ? ' is-sel' : ''}`}
                onClick={() => setSelectedId(e.id)}
              >
                <div className="mb-sc-seg-item-head">
                  <span className="mb-sc-seg-idx">{i + 1}</span>
                  <input
                    className="mb-sc-input mb-sc-seg-label"
                    value={e.label}
                    disabled={running}
                    onChange={(ev) => setEl(i, { label: ev.target.value })}
                    onClick={(ev) => ev.stopPropagation()}
                  />
                  <span className={`mb-sc-seg-elstatus is-${e.status ?? 'idle'}`}>{EL_STATUS[e.status ?? 'idle']}</span>
                  <button className="mb-sc-node-x" title="删除该元素" disabled={running} onClick={(ev) => { ev.stopPropagation(); delEl(i); }}>
                    ✕
                  </button>
                </div>
                <textarea
                  className="mb-sc-input mb-sc-seg-prompt"
                  rows={2}
                  value={e.prompt ?? ''}
                  disabled={running}
                  placeholder="该元素的重绘提示词（识别时自动填，可改）"
                  onChange={(ev) => setEl(i, { prompt: ev.target.value })}
                  onClick={(ev) => ev.stopPropagation()}
                />
                <div className="mb-sc-seg-item-foot">
                  <button
                    className="mb-btn mb-btn-xs"
                    disabled={running || !d.genModelId && !genModels.length}
                    onClick={(ev) => { ev.stopPropagation(); void runSegmentRegenOne(nodeId, i); }}
                  >
                    重绘此元素
                  </button>
                  {e.regenSrc && (
                    <MeasuredThumb
                      src={thumbPair(e.regenSrc).thumb}
                      fullSrc={thumbPair(e.regenSrc).full}
                      measureFull
                      alt="重绘"
                      onClick={() => openPreview([{ src: mediaUrl(e.regenSrc as string) }], 0)}
                    />
                  )}
                  {e.error && <span className="mb-sc-seg-elerr">{e.error}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

function modelNames(configs: ReturnType<typeof useSettingsStore.getState>['configs'], type: 'text' | 'image'): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of configs) {
    if (c.type !== type) continue;
    if (type === 'image' && c.image_kind === 'comfyui') continue;
    for (const n of Object.keys(c.model_mapping ?? {})) if (!seen.has(n)) { seen.add(n); out.push(n); }
  }
  return out;
}
