import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useSettingsStore } from '@/store/settingsStore';
import { useImageParamsStore } from '@/store/imageParamsStore';
import { toast } from '@/store/toastStore';
import { ChatPanel } from '@/components/ChatPanel';
import {
  SparkleIcon,
  ImageIcon,
  PlusIcon,
  TrashIcon,
  GalleryIcon,
  FolderIcon
} from '@/components/Icon';
import { Lightbox } from '@/components/Lightbox';
import { localPathToImageUrl } from '@/lib/imageUrl';
import './Create.css';

/**
 * 比例集合参考（覆盖 GPT Image 2 与 Nano Banana 系列）：
 *   - 绘图模型配置规则/GPT-Image-2-配置规则.md §2.3
 *   - 绘图模型配置规则/gemini_nano_banana_config.md §2.2
 */
/**
 * 比例 → 兼容性。两个标签：
 *   GI2  GPT Image 2（开源/中转一般支持，约束 16 整除 + 8.3MP）
 *   NB   Nano Banana 2 / Nano Banana Pro（gemini 系列）
 * 数据来源：绘图模型配置规则/*.md
 */
const ASPECTS: Array<{ value: string; label: string; tags: Array<'GI2' | 'NB'> }> = [
  { value: 'auto', label: '自动', tags: [] },
  { value: '1:1', label: '1:1', tags: ['GI2', 'NB'] },
  { value: '4:5', label: '4:5', tags: ['GI2', 'NB'] },
  { value: '5:4', label: '5:4', tags: ['GI2', 'NB'] },
  { value: '3:4', label: '3:4', tags: ['GI2', 'NB'] },
  { value: '4:3', label: '4:3', tags: ['GI2', 'NB'] },
  { value: '2:3', label: '2:3', tags: ['GI2', 'NB'] },
  { value: '3:2', label: '3:2', tags: ['GI2', 'NB'] },
  { value: '9:16', label: '9:16', tags: ['GI2', 'NB'] },
  { value: '16:9', label: '16:9', tags: ['GI2', 'NB'] },
  { value: '21:9', label: '21:9', tags: ['GI2', 'NB'] },
  { value: '9:21', label: '9:21', tags: ['GI2'] },
  { value: '1:2', label: '1:2', tags: ['GI2'] },
  { value: '2:1', label: '2:1', tags: ['GI2'] },
  { value: '1:3', label: '1:3', tags: ['GI2'] },
  { value: '3:1', label: '3:1', tags: ['GI2'] },
  { value: '4:1', label: '4:1', tags: ['GI2'] },
  { value: '1:4', label: '1:4', tags: ['GI2'] },
  { value: '8:1', label: '8:1', tags: [] },
  { value: '1:8', label: '1:8', tags: [] }
];

/** GPT Image 2 像素预算 8.3MP；其它模型最大 16MP（Nano Banana Pro）；
 *  默认按 8.3MP 自动联动，超过会被夹到 3840px 单边硬上限。 */
const PIXEL_BUDGET = 8_294_400;
const MIN_DIM = 256;
const MAX_DIM = 3840;
const STEP = 16;

function snapTo16(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return MIN_DIM;
  const snapped = Math.round(value / STEP) * STEP;
  return Math.max(MIN_DIM, Math.min(MAX_DIM, snapped));
}

/** 给定一边，按 8.3MP 预算反推另一边并 snap 到 16 倍数 */
function complementaryDim(known: number): number {
  if (!Number.isFinite(known) || known <= 0) return MIN_DIM;
  return snapTo16(PIXEL_BUDGET / known);
}

const IMAGE_SIZES = [
  { value: '', label: '自动' },
  { value: '1K', label: '1K (~1 MP 总像素)' },
  { value: '2K', label: '2K (~4 MP 总像素)' },
  { value: '4K', label: '4K (~8.3 MP 总像素，4K UHD)' }
];

const QUALITIES = [
  { value: '', label: '默认' },
  { value: 'standard', label: 'standard（快）' },
  { value: 'high', label: 'high（细节多）' }
];

interface QueueItem {
  id: number;
  model_id: string;
  positive_prompt: string;
  status: string;
  result_paths?: string;
  created_at?: string;
}

export default function CreatePage(): JSX.Element {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.25 }}
      className="mb-create-root"
    >
      <section className="mb-create-chat mb-card mb-marquee-glow">
        <ChatPanel />
      </section>

      <section className="mb-create-gen mb-card mb-marquee-glow">
        <GeneratorForm />
      </section>
    </motion.div>
  );
}

function GeneratorForm(): JSX.Element {
  const { configs, activePlanId } = useSettingsStore();
  const params = useImageParamsStore();
  const navigate = useNavigate();

  const imageModels = useMemo(
    () =>
      configs
        .filter((c) => c.plan_id === activePlanId && c.type === 'image')
        .flatMap((c) => Object.keys(c.model_mapping ?? {})),
    [configs, activePlanId]
  );

  // 自定义尺寸输入框的"草稿态"——保持字符串形态便于编辑（中间允许空、连删等）
  const [wDraft, setWDraft] = useState(String(params.customW));
  const [hDraft, setHDraft] = useState(String(params.customH));
  const [latest, setLatest] = useState<QueueItem | null>(null);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);

  // 草稿态跟着 store 同步（store 是 persist 的，下次启动也回填）
  useEffect(() => {
    setWDraft(String(params.customW));
    setHDraft(String(params.customH));
  }, [params.customW, params.customH]);

  const latestImagePath = useMemo(() => {
    if (!latest?.result_paths) return null;
    try {
      const arr = JSON.parse(latest.result_paths) as string[];
      return arr[0] ?? null;
    } catch {
      return null;
    }
  }, [latest?.result_paths]);

  useEffect(() => {
    if (imageModels.length > 0 && !params.imageModelId) {
      params.setImageModelId(imageModels[0]);
    }
  }, [imageModels, params.imageModelId]);

  useEffect(() => {
    if (!window.electronAPI?.on) return;
    refreshLatest();
    const offDone = window.electronAPI.on('image:done', (payload) => {
      refreshLatest();
      const v = payload as { taskId: number; cancelled?: boolean; error?: string };
      if (v.error) toast.error('生图失败', v.error);
      else if (v.cancelled) toast.info('已取消');
      else toast.success('生图完成', `任务 #${v.taskId} · 已自动归入图库`);
    });
    const offProgress = window.electronAPI.on('image:progress', () => refreshLatest());
    return () => {
      offDone();
      offProgress();
    };
  }, []);

  async function refreshLatest(): Promise<void> {
    const r = await window.electronAPI.image.queue();
    if (r.ok) {
      const arr = r.data as QueueItem[];
      setLatest(arr.length > 0 ? arr[0] : null);
    }
  }

  /** 改宽：snap 宽 → 自动按 8.3MP 预算反推高 */
  function commitW(): void {
    const raw = Number(wDraft);
    if (!Number.isFinite(raw) || raw <= 0) return;
    const w = snapTo16(raw);
    const h = complementaryDim(w);
    params.setCustomW(w);
    params.setCustomH(h);
    setWDraft(String(w));
    setHDraft(String(h));
  }
  /** 改高：snap 高 → 自动按 8.3MP 预算反推宽（双向联动） */
  function commitH(): void {
    const raw = Number(hDraft);
    if (!Number.isFinite(raw) || raw <= 0) return;
    const h = snapTo16(raw);
    const w = complementaryDim(h);
    params.setCustomW(w);
    params.setCustomH(h);
    setWDraft(String(w));
    setHDraft(String(h));
  }

  function probeImageSize(dataUri: string): Promise<{ w: number; h: number }> {
    return new Promise((resolve) => {
      const im = new Image();
      im.onload = () => resolve({ w: im.naturalWidth, h: im.naturalHeight });
      im.onerror = () => resolve({ w: 0, h: 0 });
      im.src = dataUri;
    });
  }

  /** 从拖拽进来的 File 列表加 ref，复用同一份探测尺寸 + 上限逻辑 */
  async function addRefFiles(files: FileList | File[]): Promise<void> {
    const arr = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (arr.length === 0) {
      toast.error('只支持图片文件');
      return;
    }
    const remaining = 10 - params.refs.length;
    if (remaining <= 0) {
      toast.error('参考图已达上限', '最多 10 张');
      return;
    }
    const accepted = arr.slice(0, remaining);
    const enriched = await Promise.all(
      accepted.map(async (file) => {
        const dataUri = await new Promise<string>((res) => {
          const r = new FileReader();
          r.onload = () => res(typeof r.result === 'string' ? r.result : '');
          r.onerror = () => res('');
          r.readAsDataURL(file);
        });
        const { w, h } = await probeImageSize(dataUri);
        // Electron 给原生 File 加了 path 字段
        const path = (file as File & { path?: string }).path ?? '';
        return { path, dataUri, width: w, height: h };
      })
    );
    params.addRefs(enriched.filter((r) => r.path && r.dataUri));
    if (arr.length > remaining) {
      toast.info('已截断到 10 张上限', `丢弃 ${arr.length - remaining} 张`);
    }
  }

  const [refDragOver, setRefDragOver] = useState(false);
  function onRefDragOver(e: React.DragEvent): void {
    e.preventDefault();
    setRefDragOver(true);
  }
  function onRefDragLeave(): void {
    setRefDragOver(false);
  }
  function onRefDrop(e: React.DragEvent): void {
    e.preventDefault();
    setRefDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      void addRefFiles(e.dataTransfer.files);
    }
  }

  async function pickRefs(): Promise<void> {
    if (!window.electronAPI?.storage?.pickImages) return;
    const r = await window.electronAPI.storage.pickImages();
    if (!r.ok) {
      toast.error('选择参考图失败', r.error.message);
      return;
    }
    if (r.data.files.length === 0) return;
    const remaining = 10 - params.refs.length;
    if (remaining <= 0) {
      toast.error('参考图已达上限', '最多 10 张');
      return;
    }
    const accepted = r.data.files.slice(0, remaining);
    // 探测每张参考图真实尺寸，给"自动比例"用
    const enriched = await Promise.all(
      accepted.map(async (f) => {
        const { w, h } = await probeImageSize(f.dataUri);
        return { ...f, width: w, height: h };
      })
    );
    params.addRefs(enriched);
    if (r.data.files.length > remaining) {
      toast.info('已截断到 10 张上限', `丢弃 ${r.data.files.length - remaining} 张`);
    }
  }

  async function openLatestFolder(): Promise<void> {
    if (!latest) return;
    const paths = latest.result_paths ? (JSON.parse(latest.result_paths) as string[]) : [];
    if (paths.length === 0) {
      toast.info('该任务还没生成图片', '生图完成后再点');
      return;
    }
    const r = await window.electronAPI.storage.showInFolder(paths[0]);
    if (!r.ok) toast.error('打开失败', r.error.message);
  }

  return (
    <div className="mb-gen">
      <div className="mb-gen-header">
        <h2>
          <SparkleIcon size={18} /> 绘图参数
        </h2>
        <select
          className="mb-chat-model-select"
          value={params.imageModelId}
          onChange={(e) => params.setImageModelId(e.target.value)}
          style={{ maxWidth: 200 }}
        >
          {imageModels.length === 0 && <option value="">未配置绘画模型</option>}
          {imageModels.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>

      <div className="mb-gen-form">
        <div>
          <div className="mb-gen-mode-row">
            <button
              type="button"
              className={`mb-gen-mode ${params.sizeMode === 'aspect' ? 'is-active' : ''}`}
              onClick={() => params.setSizeMode('aspect')}
            >
              按比例
            </button>
            <button
              type="button"
              className={`mb-gen-mode ${params.sizeMode === 'custom' ? 'is-active' : ''}`}
              onClick={() => params.setSizeMode('custom')}
            >
              自定义尺寸
            </button>
          </div>

          {params.sizeMode === 'aspect' ? (
            <div className="mb-gen-aspects">
              {ASPECTS.map((a) => (
                <motion.button
                  key={a.value}
                  className={`mb-gen-aspect ${params.aspect === a.value ? 'is-active' : ''}`}
                  onClick={() => params.setAspect(a.value)}
                  whileTap={{ scale: 0.94 }}
                  title={
                    a.tags.length === 0
                      ? '通用比例（部分模型可能不识别）'
                      : `兼容：${a.tags.join(' + ')}`
                  }
                >
                  <span className="mb-gen-aspect-tags">
                    {a.tags.includes('GI2') && (
                      <span className="mb-gen-aspect-tag mb-gen-tag-gi2">GI2</span>
                    )}
                    {a.tags.includes('NB') && (
                      <span className="mb-gen-aspect-tag mb-gen-tag-nb">NB</span>
                    )}
                  </span>
                  <span className="mb-gen-aspect-label">{a.label}</span>
                </motion.button>
              ))}
            </div>
          ) : (
            <div className="mb-gen-custom-size">
              <input
                type="number"
                className="mb-input"
                value={wDraft}
                min={256}
                max={3840}
                step={16}
                onChange={(e) => setWDraft(e.target.value)}
                onBlur={commitW}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                }}
                placeholder="宽 (px)"
              />
              <span className="mb-gen-times">×</span>
              <input
                type="number"
                className="mb-input"
                value={hDraft}
                min={256}
                max={3840}
                step={16}
                onChange={(e) => setHDraft(e.target.value)}
                onBlur={commitH}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                }}
                placeholder="高 (px)"
              />
            </div>
          )}
          <div className="mb-gen-hint">
            {params.sizeMode === 'aspect'
              ? '"GI2" 标 GPT Image 2 兼容；"NB" 标 Nano Banana 系列兼容。蓝点表示同时支持。'
              : '失焦后自动 snap 到 16 整数倍；改宽 → 自动算高，改高 → 自动算宽（保持 8.3 MP 像素预算）。'}
          </div>
        </div>

        <div className="mb-gen-tip">
          提示词在左侧对话框输入；AI 优化已移除，参数全在这边设。
        </div>

        <div className="mb-gen-row">
          <div style={{ flex: 1 }}>
            <label className="mb-label">张数</label>
            <select
              className="mb-select"
              value={params.n}
              onChange={(e) => params.setN(Number(e.target.value) as 1 | 2 | 3 | 4)}
            >
              {[1, 2, 3, 4].map((v) => (
                <option key={v} value={v}>
                  {v} 张
                </option>
              ))}
            </select>
          </div>
          {params.sizeMode === 'aspect' && (
            <div style={{ flex: 1 }}>
              <label className="mb-label">分辨率档位</label>
              <select
                className="mb-select"
                value={params.imageSize}
                onChange={(e) =>
                  params.setImageSize(e.target.value as '' | '1K' | '2K' | '4K')
                }
              >
                {IMAGE_SIZES.map((v) => (
                  <option key={v.value || 'auto'} value={v.value}>
                    {v.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div style={{ flex: 1 }}>
            <label className="mb-label">质量</label>
            <select
              className="mb-select"
              value={params.quality}
              onChange={(e) =>
                params.setQuality(e.target.value as '' | 'standard' | 'high')
              }
            >
              {QUALITIES.map((v) => (
                <option key={v.value || 'auto'} value={v.value}>
                  {v.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="mb-label">参考图（{params.refs.length}/10）</label>
          <div
            className={`mb-gen-refs ${refDragOver ? 'is-dragover' : ''}`}
            onDragOver={onRefDragOver}
            onDragLeave={onRefDragLeave}
            onDrop={onRefDrop}
          >
            {params.refs.map((r, i) => (
              <div key={r.path + i} className="mb-gen-ref-thumb">
                <img src={r.dataUri} alt={`ref ${i + 1}`} />
                <button
                  type="button"
                  className="mb-gen-ref-remove"
                  onClick={() => params.removeRefAt(i)}
                  title="移除"
                >
                  <TrashIcon size={11} />
                </button>
              </div>
            ))}
            {params.refs.length < 10 && (
              <button
                type="button"
                className="mb-gen-ref-add"
                onClick={pickRefs}
                title="点击选择 / 拖图进来 都行"
              >
                <PlusIcon size={20} />
                <span>{refDragOver ? '松手添加' : '拖入 / 点击'}</span>
              </button>
            )}
          </div>
          <div className="mb-gen-hint">
            支持把图直接拖到上方框里。带参考图时：OpenAI 标准协议自动改走 <code>/v1/images/edits</code>（需模型支持图入，如 gpt-image-1/2）；GRSAI 协议把参考图作为 <code>urls</code> 字段送上游。
          </div>
        </div>

      </div>

      <div className="mb-gen-history">
        <div className="mb-gen-history-title">最新生图任务</div>
        {!latest ? (
          <div className="mb-gen-empty">
            <ImageIcon size={20} />
            <div>还没有任务，去左侧对话框发个提示词</div>
          </div>
        ) : (
          <motion.div
            key={latest.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className={`mb-gen-task-card mb-gen-status-${latest.status}`}
          >
            <div className="mb-gen-task-content">
              {latestImagePath && (
                <button
                  type="button"
                  className="mb-gen-task-thumb"
                  onClick={() => setPreviewSrc(localPathToImageUrl(latestImagePath))}
                  title="点击放大预览（滚轮缩放 / 拖动平移）"
                >
                  <img src={localPathToImageUrl(latestImagePath)} alt="" draggable={false} />
                </button>
              )}
              <div className="mb-gen-task-meta">
                <div className="mb-gen-task-row">
                  <span className="mb-gen-task-id">#{latest.id}</span>
                  <span className="mb-gen-task-status">{latest.status}</span>
                </div>
                <div className="mb-gen-task-prompt-full">{latest.positive_prompt}</div>
              </div>
            </div>
            <div className="mb-gen-task-actions">
              <button
                className="mb-btn mb-btn-secondary mb-btn-sm"
                onClick={() => navigate('/manager')}
              >
                <GalleryIcon size={13} /> 跳转图库
              </button>
              <button
                className="mb-btn mb-btn-secondary mb-btn-sm"
                onClick={openLatestFolder}
                disabled={latest.status !== 'done'}
                title={latest.status === 'done' ? '在文件夹中显示' : '生图完成后再点'}
              >
                <FolderIcon size={13} /> 打开文件夹
              </button>
            </div>
          </motion.div>
        )}
      </div>

      <Lightbox
        open={previewSrc !== null}
        src={previewSrc ?? ''}
        onClose={() => setPreviewSrc(null)}
      />
    </div>
  );
}
