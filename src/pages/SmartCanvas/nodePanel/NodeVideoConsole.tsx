import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSmartCanvasStore, absPosition } from '@/store/smartCanvasStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useVideoProvidersStore } from '@/store/videoProvidersStore';
import { computeUpstream, sendableUrl, normalizeImageDataUri } from '@/lib/smartCanvasRunner';
import { localPathToImageUrl } from '@/lib/imageUrl';
import { toast } from '@/store/toastStore';
import { VIDEO_MODE_LABELS, normalizeVideoMode, type VideoMode } from '@shared/video';
import { findVideoModel, getVideoProvider, type VideoModelCapabilities } from '@shared/videoProviders';
import { normalizeVideoKind } from '@shared/domain';
import { modelRefValue, resolveModelRef } from '@/lib/modelMapping';
import type { VideoNodeData, SmartNodeData } from '@shared/smartCanvas';
import { VideoNodeIcon } from '../icons';
import { ResizablePanelWrapper } from './ResizablePanelWrapper';
import { SegmentedControl, ModelDropdownButton } from './consoleControls';
import { AspectGlyph } from '../nodeControls';
import { VideoRunControls } from './VideoRunControls';
import './nodePanel.css';

const STORAGE_KEY = 'mengbi.smartCanvas.videoConsole.geom.v1';
const ALL_MODES: VideoMode[] = [
  'text_to_video',
  'image_to_video',
  'first_last_frame',
  'reference_images',
  'reference_video',
  'reference_audio',
  'continuous'
];
const MODE_CAP: Record<VideoMode, keyof VideoModelCapabilities> = {
  text_to_video: 'textToVideo',
  image_to_video: 'imageToVideo',
  first_last_frame: 'firstLastFrame',
  reference_images: 'referenceImages',
  reference_video: 'referenceVideo',
  reference_audio: 'referenceAudio',
  continuous: 'continuousVideo'
};
const DUR_PRESETS = ['4', '5', '6', '8', '10', '12', '15'];
const COMMON_ASPECTS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', '2:3', '3:2', 'adaptive'];
// 多格式支持（2026-07-14）：白名单放宽到浏览器可解码的常见图片格式；
// webp/avif/gif/bmp 选入后经 normalizeImageDataUri 重编码成 PNG——不少视频中转站的
// 上传端点只收 png/jpg（否则报「参考图格式无法识别」类错误）。
const IMG_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif'];
function linesToArr(s: string): string[] {
  return s.split(/[\n,]/).map((x) => x.trim()).filter(Boolean);
}
function matUrl(src: string): string {
  return src.startsWith('data:') || src.startsWith('http') ? src : localPathToImageUrl(src);
}

/** 视频节点弹出控制台（设置）：选中 video 节点时由 CanvasWorkspace 渲染。与生成控制台同设计语言、自适应大小。 */
export function NodeVideoConsole(): JSX.Element | null {
  const sel = useSmartCanvasStore((s) => s.nodes.find((x) => x.selected && x.type === 'video') ?? null);
  if (!sel) return null;
  const w = sel.measured?.width ?? (typeof sel.width === 'number' ? sel.width : 268);
  const h = sel.measured?.height ?? (typeof sel.height === 'number' ? sel.height : 200);
  const abs = absPosition(sel, useSmartCanvasStore.getState().nodes);
  const anchor = { x: abs.x, y: abs.y, w, h };
  return (
    <ResizablePanelWrapper storageKey={STORAGE_KEY} anchor={anchor} autoSize className="mb-np-console mb-np-video">
      <VideoConsoleInner key={sel.id} id={sel.id} />
    </ResizablePanelWrapper>
  );
}

function BarField({ label, className, children }: { label: string; className?: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className={`mb-np-bf ${className ?? ''}`}>
      <label className="mb-np-flabel">{label}</label>
      {children}
    </div>
  );
}

function VideoConsoleInner({ id }: { id: string }): JSX.Element | null {
  const node = useSmartCanvasStore((s) => s.nodes.find((n) => n.id === id));
  const update = useSmartCanvasStore((s) => s.updateNodeData);
  const deselectAll = useSmartCanvasStore((s) => s.deselectAll);
  const nodes = useSmartCanvasStore((s) => s.nodes);
  const edges = useSmartCanvasStore((s) => s.edges);
  const configs = useSettingsStore((s) => s.configs);
  const merged = useVideoProvidersStore((s) => s.config);
  const ensureLoaded = useVideoProvidersStore((s) => s.ensureLoaded);
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string>('');

  useEffect(() => {
    void ensureLoaded();
  }, [ensureLoaded]);

  const videoModels = useMemo(() => {
    // {name:模型名, provider:中转站, ref:复合标识}——与生图节点同款 ModelDropdownButton（按钮式 + 「中转站 /」前缀）
    const out: Array<{ name: string; provider: string; ref: string }> = [];
    const seen = new Set<string>();
    for (const c of configs) {
      if (c.type !== 'video') continue;
      const prov = (c.provider_name ?? '').trim();
      for (const name of Object.keys(c.model_mapping ?? {})) {
        const ref = modelRefValue(prov, name);
        if (!seen.has(ref)) {
          seen.add(ref);
          out.push({ name, provider: prov, ref });
        }
      }
    }
    return out;
  }, [configs]);

  const d = node ? (node.data as unknown as VideoNodeData) : null;
  const mode = normalizeVideoMode(d?.mode);

  const resolved = useMemo(() => {
    if (!d?.modelId) return null;
    const r = resolveModelRef(configs, 'video', d.modelId);
    if (!r) return null;
    const videoKind = normalizeVideoKind(r.config.video_kind) ?? 'kling';
    return { videoKind, actualId: r.actualId, model: findVideoModel(merged, r.actualId) };
  }, [configs, d?.modelId, merged]);

  const model = resolved?.model ?? null;
  // 该供应商是否配置了素材上传端点：没配就别显示「上传本地视频/音频」按钮（点了必失败），改提示走 URL
  const provider = resolved ? getVideoProvider(merged, resolved.videoKind) : null;
  const canUploadAsset = !!provider?.uploadEndpoint;
  const caps = model?.capabilities;
  const lim = model?.limits;
  const availableModes = useMemo<VideoMode[]>(() => {
    if (!caps) return ['text_to_video', 'image_to_video'];
    return ALL_MODES.filter((m) => caps[MODE_CAP[m]]);
  }, [caps]);

  useEffect(() => {
    if (d && availableModes.length && !availableModes.includes(mode)) update(id, { mode: availableModes[0] } as Partial<SmartNodeData>);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableModes, mode, id]);

  const up = useMemo(() => computeUpstream(nodes, edges, id), [nodes, edges, id]);

  if (!node || !d) return null;
  const setF = (patch: Partial<VideoNodeData>): void => update(id, patch as Partial<SmartNodeData>);

  const resolutions = lim?.supportedResolutions && lim.supportedResolutions.length ? lim.supportedResolutions : ['480p', '720p', '1080p'];
  const aspectPresets = lim?.supportedAspectRatios && lim.supportedAspectRatios.length ? lim.supportedAspectRatios : COMMON_ASPECTS;
  const aspectIsCustom = !!d.aspect && !aspectPresets.includes(d.aspect);
  // 空 = 自动（跟随首张上游图比例，运行时在 runVideoNode 量取）
  const aspectCur = !d.aspect ? '' : aspectPresets.includes(d.aspect) ? d.aspect : '__custom__';
  const upSize = up.sizes[0];
  const upEmit = upSize?.emit ?? 'both';
  const aspectFed = !!upSize && upEmit !== 'resolution';
  const tierFed = !!upSize && upEmit !== 'aspect';
  const durations = lim ? DUR_PRESETS.filter((x) => Number(x) >= lim.durationMin && Number(x) <= lim.durationMax) : DUR_PRESETS;
  const upFed = up.prompts.length > 0;

  return (
    <div className="mb-np-root">
      <div className="mb-np-header">
        <div className="mb-np-header-left">
          <span className="mb-np-header-ico">
            <VideoNodeIcon size={16} />
          </span>
          <span className="mb-np-header-title">视频节点</span>
          <span className="mb-np-header-dot">·</span>
          <input
            className="mb-np-header-name"
            value={d.name ?? ''}
            placeholder="未命名"
            onChange={(e) => setF({ name: e.target.value })}
            title="节点名称（点击编辑）"
          />
        </div>
        <div className="mb-np-header-right">
          <button className="mb-np-hbtn mb-np-hbtn-ico" title="关闭（取消选中）" onClick={deselectAll}>
            ✕
          </button>
        </div>
      </div>

      <div className="mb-np-bar">
        <BarField label="视频模型" className="mb-np-bf-model">
          {videoModels.length === 0 ? (
            <button className="mb-btn mb-btn-sm mb-btn-ghost" onClick={() => navigate('/settings')}>
              ＋ 去「设置 → 视频模型」配置
            </button>
          ) : (
            <ModelDropdownButton
              value={d.modelId}
              options={videoModels}
              placeholder="（选择视频模型）"
              emptyHint="当前方案没有视频模型"
              onChange={(v) => setF({ modelId: v })}
            />
          )}
        </BarField>

        <BarField label="模式">
          <SegmentedControl
            value={availableModes.includes(mode) ? mode : availableModes[0]}
            size="sm"
            options={availableModes.map((m) => ({ value: m, label: VIDEO_MODE_LABELS[m] }))}
            onChange={(v) => setF({ mode: v as VideoMode })}
          />
        </BarField>

        <BarField label="时长(s)">
          <SegmentedControl value={d.duration} size="sm" options={durations.map((x) => ({ value: x, label: x }))} onChange={(v) => setF({ duration: v })} />
        </BarField>
        {aspectFed ? (
          <BarField label="画幅">
            <div className="mb-sc-fromup is-fed">由上游尺寸来源输入（{upSize?.aspect}）</div>
          </BarField>
        ) : (
          <BarField label="画幅">
            <SegmentedControl
              value={aspectCur}
              size="sm"
              options={[
                { value: '', label: '自动', title: '自动：跟随首张上游图（或选定首帧）的比例' },
                ...aspectPresets.map((a) => ({ value: a, label: a, icon: /\d+[:：]\d+/.test(a) ? <AspectGlyph ratio={a} size={14} /> : undefined })),
                { value: '__custom__', label: '自定义' }
              ]}
              onChange={(v) => {
                if (v === '__custom__') {
                  if (!aspectIsCustom) setF({ aspect: '16:10' });
                } else setF({ aspect: v });
              }}
            />
            {aspectIsCustom && (
              <input className="mb-input mb-np-custom" value={d.aspect} placeholder="如 16:10" onChange={(e) => setF({ aspect: e.target.value })} />
            )}
          </BarField>
        )}
        {tierFed ? (
          <BarField label="分辨率">
            <div className="mb-sc-fromup is-fed">由上游尺寸来源输入（{upSize?.width}×{upSize?.height}，吸附到最近档）</div>
          </BarField>
        ) : (
          <BarField label="分辨率">
            <SegmentedControl value={d.resolution} size="sm" options={resolutions.map((x) => ({ value: x, label: x }))} onChange={(v) => setF({ resolution: v })} />
          </BarField>
        )}

        {(!lim || lim.supportSeed) && (
          <BarField label="Seed（空=随机）">
            <input
              className="mb-input"
              type="number"
              style={{ width: 120 }}
              value={d.seed ?? ''}
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => setF({ seed: e.target.value === '' ? null : Number(e.target.value) })}
            />
          </BarField>
        )}

        {(!caps || caps.generateAudio || caps.returnLastFrame) && (
          <BarField label="选项">
            <div className="mb-np-vchecks">
              {(!caps || caps.generateAudio) && (
                <label className="mb-sc-vcheck">
                  <input type="checkbox" checked={!!d.generateAudio} onChange={(e) => setF({ generateAudio: e.target.checked })} />
                  有声{d.generateAudio ? '（+费用）' : ''}
                </label>
              )}
              {(!caps || caps.returnLastFrame) && (
                <label className="mb-sc-vcheck">
                  <input type="checkbox" checked={!!d.returnLastFrame} onChange={(e) => setF({ returnLastFrame: e.target.checked })} />
                  返回末帧
                </label>
              )}
            </div>
          </BarField>
        )}
      </div>

      <div className="mb-np-vbody">
        {/* 素材（按模式） */}
        {(mode === 'image_to_video' || mode === 'first_last_frame') && (
          <div className="mb-sc-vmat">
            <span className="mb-sc-vmat-l">首帧</span>
            <span className="mb-sc-vmat-s">{d.firstFrameUrl ? '本地图' : up.images[0] ? '上游图 1' : '（无）'}</span>
            <button className="mb-btn mb-btn-xs mb-btn-ghost" onClick={() => void pickImageInto('firstFrameUrl')}>选本地图</button>
            {d.firstFrameUrl && <button className="mb-btn mb-btn-xs mb-btn-ghost" onClick={() => setF({ firstFrameUrl: null })}>用上游</button>}
          </div>
        )}
        {mode === 'first_last_frame' && (
          <div className="mb-sc-vmat">
            <span className="mb-sc-vmat-l">尾帧</span>
            <span className="mb-sc-vmat-s">{d.lastFrameUrl ? '本地图' : up.images[1] ? '上游图 2' : '（无）'}</span>
            <button className="mb-btn mb-btn-xs mb-btn-ghost" onClick={() => void pickImageInto('lastFrameUrl')}>选本地图</button>
            {d.lastFrameUrl && <button className="mb-btn mb-btn-xs mb-btn-ghost" onClick={() => setF({ lastFrameUrl: null })}>用上游</button>}
          </div>
        )}
        {mode === 'reference_images' && (
          <>
            <div className="mb-sc-vmat">
              <span className="mb-sc-vmat-l">参考图</span>
              <span className="mb-sc-vmat-s">
                共 {up.images.length + (d.referenceImageUrls ?? []).length} 张 · 上游 {up.images.length} + 本地 {(d.referenceImageUrls ?? []).length}（按序号顺序发送）
              </span>
              <button className="mb-btn mb-btn-xs mb-btn-ghost" onClick={() => void addRefImage()}>＋本地图</button>
              {(d.referenceImageUrls ?? []).length > 0 && (
                <button className="mb-btn mb-btn-xs mb-btn-ghost" onClick={() => setF({ referenceImageUrls: [] })}>清空本地</button>
              )}
            </div>
            {(up.images.length > 0 || (d.referenceImageUrls ?? []).length > 0) && (
              <div className="mb-sc-vreflist nodrag">
                {up.images.map((u, i) => (
                  <div className="mb-sc-vrefitem" key={`up-${i}`} title={`参考图 ${i + 1}（来自上游）`}>
                    <img src={matUrl(u)} alt={`参考图 ${i + 1}`} draggable={false} />
                    <span className="mb-sc-vrefitem-no">{i + 1}</span>
                    <span className="mb-sc-vrefitem-src">上游</span>
                  </div>
                ))}
                {(d.referenceImageUrls ?? []).map((u, i) => (
                  <div className="mb-sc-vrefitem" key={`local-${i}`} title={`参考图 ${up.images.length + i + 1}（本地）`}>
                    <img src={matUrl(u)} alt={`参考图 ${up.images.length + i + 1}`} draggable={false} />
                    <span className="mb-sc-vrefitem-no">{up.images.length + i + 1}</span>
                    <span className="mb-sc-vrefitem-src">本地</span>
                    <button
                      className="mb-sc-vrefitem-x"
                      title="移除这张本地参考图"
                      onClick={() => setF({ referenceImageUrls: (d.referenceImageUrls ?? []).filter((_, j) => j !== i) })}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        {mode === 'reference_video' && (
          <div className="mb-np-field mb-np-field-full">
            <label className="mb-np-flabel">参考视频 URL（每行一个；或上传本地）</label>
            <textarea
              className="mb-textarea"
              rows={2}
              value={(d.referenceVideoUrls ?? []).join('\n')}
              placeholder="https://.../ref.mp4"
              onChange={(e) => setF({ referenceVideoUrls: linesToArr(e.target.value) })}
            />
            {canUploadAsset ? (
              <button className="mb-btn mb-btn-xs mb-btn-secondary" disabled={!d.modelId || !!busy} onClick={() => void uploadAV('video')}>＋ 上传本地视频</button>
            ) : (
              <span className="mb-sc-vhint">该供应商未配置上传端点，直接在上方填公网 URL 即可</span>
            )}
          </div>
        )}
        {mode === 'reference_audio' && (
          <div className="mb-np-field mb-np-field-full">
            <label className="mb-np-flabel">参考音频 URL（每行一个；或上传本地）</label>
            <textarea
              className="mb-textarea"
              rows={2}
              value={(d.referenceAudioUrls ?? []).join('\n')}
              placeholder="https://.../ref.mp3"
              onChange={(e) => setF({ referenceAudioUrls: linesToArr(e.target.value) })}
            />
            {canUploadAsset ? (
              <button className="mb-btn mb-btn-xs mb-btn-secondary" disabled={!d.modelId || !!busy} onClick={() => void uploadAV('audio')}>＋ 上传本地音频</button>
            ) : (
              <span className="mb-sc-vhint">该供应商未配置上传端点，直接在上方填公网 URL 即可</span>
            )}
          </div>
        )}
        {mode === 'continuous' && (
          <div className="mb-sc-vhint">
            首帧 = {d.previousLastFrameUrl ? '上一段最后一帧' : up.images[0] ? '上游第 1 张图' : '（需先有上一段或上游图）'}
            {d.previousLastFrameUrl && <button className="mb-btn mb-btn-xs mb-btn-ghost" onClick={() => setF({ previousLastFrameUrl: null })}>清除</button>}
          </div>
        )}
        {busy && <div className="mb-sc-vhint">{busy}</div>}

        {/* 提示词：上游接入时标黄提示、不再渲染输入框（禁止本节点手填，统一由上游喂入） */}
        {upFed ? (
          <div className="mb-sc-fromup is-fed">提示词由上游输入（{up.prompts.length} 段{up.images.length ? ` · ${up.images.length} 图` : ''}），无需手填</div>
        ) : (
          <div className="mb-np-field mb-np-field-full">
            <label className="mb-np-flabel">提示词（描述画面 / 运动，可留空）</label>
            <textarea
              className="mb-textarea"
              rows={2}
              value={d.prompt}
              placeholder="描述画面 / 运动…"
              onChange={(e) => setF({ prompt: e.target.value })}
            />
          </div>
        )}
        {(!lim || lim.supportNegativePrompt) && (
          <div className="mb-np-field mb-np-field-full">
            <label className="mb-np-flabel">负向提示词（可空）</label>
            <input className="mb-input" value={d.negativePrompt ?? ''} onChange={(e) => setF({ negativePrompt: e.target.value })} />
          </div>
        )}

        <VideoRunControls id={id} />
      </div>
    </div>
  );

  async function pickNormalizedImage(): Promise<string | null> {
    const r = await window.electronAPI.storage.pickFile({ filters: [{ name: '图片', extensions: IMG_EXTS }] });
    if (!r.ok || !r.data.filePath) return null;
    setBusy('图片处理中…');
    try {
      const du = await sendableUrl(r.data.filePath);
      if (!du) {
        toast.error('图片读取失败', '无法转换该图片，请换一张');
        return null;
      }
      return await normalizeImageDataUri(du);
    } finally {
      setBusy('');
    }
  }
  async function pickImageInto(field: 'firstFrameUrl' | 'lastFrameUrl'): Promise<void> {
    const du = await pickNormalizedImage();
    if (du) setF({ [field]: du } as Partial<VideoNodeData>);
  }
  async function addRefImage(): Promise<void> {
    const du = await pickNormalizedImage();
    if (du) setF({ referenceImageUrls: [...(d!.referenceImageUrls ?? []), du] });
  }
  async function uploadAV(kind: 'video' | 'audio'): Promise<void> {
    const exts = kind === 'video' ? ['mp4', 'mov', 'webm'] : ['mp3', 'wav', 'm4a', 'aac'];
    const r = await window.electronAPI.storage.pickFile({ filters: [{ name: kind === 'video' ? '视频' : '音频', extensions: exts }] });
    if (!r.ok || !r.data.filePath) return;
    setBusy('上传中…');
    try {
      const up2 = await window.electronAPI.video.uploadAsset({ modelId: d!.modelId, filePath: r.data.filePath, kind });
      if (!up2.ok) {
        toast.error('素材上传失败', up2.error.message + (up2.error.hint ? `（${up2.error.hint}）` : ''));
        return;
      }
      if (kind === 'video') setF({ referenceVideoUrls: [...(d!.referenceVideoUrls ?? []), up2.data.url] });
      else setF({ referenceAudioUrls: [...(d!.referenceAudioUrls ?? []), up2.data.url] });
      toast.success('素材已上传', up2.data.url);
    } finally {
      setBusy('');
    }
  }
}
