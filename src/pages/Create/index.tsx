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
import { RefEditor } from '@/components/RefEditor';
import { openContextMenu } from '@/components/ContextMenu';
import { confirmDialog } from '@/components/ConfirmDialog';
import { localPathToImageUrl } from '@/lib/imageUrl';
import './Create.css';

/**
 * 比例集合参考（覆盖 GPT Image 2 与 Nano Banana 系列）：
 *   - 绘图模型配置规则/GPT-Image-2-配置规则.md §2.3
 *   - 绘图模型配置规则/gemini_nano_banana_config.md §2.2
 */
/**
 * 比例 → 兼容性。两个标签：
 *   GI2  GPT Image 2 — 连续比例，规则：长边/短边 ≤ 3
 *   NB   Nano Banana 2 — 固定预设档位
 * 数据来源：生图模型比例以及分辨率.md
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
  { value: '21:9', label: '21:9', tags: ['GI2', 'NB'] }, // GI2 文档说"接近上限不建议超过"
  { value: '1:3', label: '1:3', tags: ['GI2'] },         // GI2 最小比例 1:3
  { value: '3:1', label: '3:1', tags: ['GI2'] },         // GI2 最大比例 3:1
  { value: '1:4', label: '1:4', tags: ['NB'] },
  { value: '4:1', label: '4:1', tags: ['NB'] },
  { value: '1:8', label: '1:8', tags: ['NB'] },
  { value: '8:1', label: '8:1', tags: ['NB'] }
];

/**
 * 自定义尺寸的内置推荐预设（来自 GPT-Image 2 官方 §推荐高质量尺寸）。
 * 用户可在右侧面板里点 chip 一键填入；也可"另存为"自己的预设（持久化在 store）。
 */
export interface SizePreset {
  key: string;
  label: string;
  w: number;
  h: number;
  builtin?: boolean;
}

/** 不再内置任何预设——按用户要求，预设区一开始空，由"存为预设"自己积累。 */
const BUILTIN_SIZE_PRESETS: SizePreset[] = [];

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
  // 最近三个任务（按时间倒序）——支持并发跑，所以同时能有 3 条 running
  const [latestThree, setLatestThree] = useState<QueueItem[]>([]);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [editingRefIdx, setEditingRefIdx] = useState<number | null>(null);

  // 草稿态跟着 store 同步（store 是 persist 的，下次启动也回填）
  useEffect(() => {
    setWDraft(String(params.customW));
    setHDraft(String(params.customH));
  }, [params.customW, params.customH]);

  /** 单个任务的第一张图本地路径（用于卡片缩略图） */
  function taskFirstImagePath(task: QueueItem): string | null {
    if (!task.result_paths) return null;
    try {
      const arr = JSON.parse(task.result_paths) as string[];
      return arr[0] ?? null;
    } catch {
      return null;
    }
  }

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
      setLatestThree(arr.slice(0, 3));
    }
  }

  /** 改宽：snap 宽。若开了"自动计算"，自动按 8.3MP 预算反推高；否则只动宽 */
  function commitW(): void {
    const raw = Number(wDraft);
    if (!Number.isFinite(raw) || raw <= 0) return;
    const w = snapTo16(raw);
    if (params.autoCalcCustomSize) {
      const h = complementaryDim(w);
      params.setCustomW(w);
      params.setCustomH(h);
      setWDraft(String(w));
      setHDraft(String(h));
    } else {
      params.setCustomW(w);
      setWDraft(String(w));
    }
  }
  /** 改高：snap 高。"自动计算"开则联动算宽 */
  function commitH(): void {
    const raw = Number(hDraft);
    if (!Number.isFinite(raw) || raw <= 0) return;
    const h = snapTo16(raw);
    if (params.autoCalcCustomSize) {
      const w = complementaryDim(h);
      params.setCustomW(w);
      params.setCustomH(h);
      setWDraft(String(w));
      setHDraft(String(h));
    } else {
      params.setCustomH(h);
      setHDraft(String(h));
    }
  }

  /** 计算器：把 W/H 写回 store 输入框 */
  function applyCalculatedSize(w: number, h: number): void {
    const ww = snapTo16(w);
    const hh = snapTo16(h);
    params.setCustomW(ww);
    params.setCustomH(hh);
    setWDraft(String(ww));
    setHDraft(String(hh));
    toast.success('已应用到尺寸输入框', `${ww}×${hh}`);
  }

  /** 长宽反转 */
  function swapWH(): void {
    const w = params.customH;
    const h = params.customW;
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

  async function copyTaskImage(filePath: string): Promise<void> {
    try {
      const r = await fetch(localPathToImageUrl(filePath));
      const blob = await r.blob();
      const pngBlob =
        blob.type === 'image/png' ? blob : await blobToPng(blob);
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
      toast.success('图片已复制到剪贴板');
    } catch (e) {
      toast.error('复制失败', (e as Error).message);
    }
  }

  async function sendTaskToRefs(filePath: string): Promise<void> {
    try {
      const r = await fetch(localPathToImageUrl(filePath));
      const blob = await r.blob();
      const dataUri = await new Promise<string>((res) => {
        const fr = new FileReader();
        fr.onload = () => res(typeof fr.result === 'string' ? fr.result : '');
        fr.readAsDataURL(blob);
      });
      const dim = await probeImageSize(dataUri);
      params.addRefs([
        { path: filePath, dataUri, width: dim.w, height: dim.h }
      ]);
      toast.success('已加入参考图');
    } catch (e) {
      toast.error('置入参考失败', (e as Error).message);
    }
  }

  function showTaskImageMenu(e: React.MouseEvent, filePath: string): void {
    e.preventDefault();
    e.stopPropagation();
    openContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: '复制图片',
          onClick: () => copyTaskImage(filePath)
        },
        {
          label: '置入参考图',
          variant: 'accent',
          icon: <PlusIcon size={12} />,
          onClick: () => sendTaskToRefs(filePath)
        },
        {
          label: '放大预览',
          icon: <SparkleIcon size={12} />,
          onClick: () => setPreviewSrc(localPathToImageUrl(filePath))
        }
      ]
    });
  }

  function showTaskPromptMenu(e: React.MouseEvent, prompt: string): void {
    e.preventDefault();
    e.stopPropagation();
    if (!prompt) return;
    openContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: '复制提示词',
          onClick: async () => {
            try {
              await navigator.clipboard.writeText(prompt);
              toast.success('已复制');
            } catch {
              toast.error('复制失败');
            }
          }
        },
        {
          label: '用于对话框生图',
          variant: 'accent',
          icon: <SparkleIcon size={12} />,
          onClick: () => {
            params.setChatDraft(prompt);
            toast.success('已填到生图输入框', '左侧切到生图模式回车即可');
          }
        }
      ]
    });
  }

  async function openTaskFolder(task: QueueItem): Promise<void> {
    const paths = task.result_paths ? (JSON.parse(task.result_paths) as string[]) : [];
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
            <>
              <div className="mb-gen-custom-size">
                <input
                  type="number"
                  className="mb-input"
                  value={wDraft}
                  min={256}
                  max={4096}
                  step={16}
                  onChange={(e) => setWDraft(e.target.value)}
                  onBlur={commitW}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  }}
                  placeholder="宽 (px)"
                />
                <button
                  type="button"
                  className="mb-gen-swap"
                  onClick={swapWH}
                  title="长宽反转（W ↔ H）"
                  aria-label="长宽反转"
                >
                  ⇄
                </button>
                <input
                  type="number"
                  className="mb-input"
                  value={hDraft}
                  min={256}
                  max={4096}
                  step={16}
                  onChange={(e) => setHDraft(e.target.value)}
                  onBlur={commitH}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  }}
                  placeholder="高 (px)"
                />
              </div>
              <label className="mb-gen-autocalc-row" title="开关：开则修改一边自动算另一边；关则两个独立输入">
                <input
                  type="checkbox"
                  checked={params.autoCalcCustomSize}
                  onChange={(e) => params.setAutoCalcCustomSize(e.target.checked)}
                />
                <span>自动计算（改一边联动另一边，保持 8.3MP 预算）</span>
              </label>
              <SizeCalculator onApply={applyCalculatedSize} />
              <CustomSizePresets
                w={params.customW}
                h={params.customH}
                onPick={(w, h) => {
                  params.setCustomW(w);
                  params.setCustomH(h);
                  setWDraft(String(w));
                  setHDraft(String(h));
                }}
              />
            </>
          )}
          <div className="mb-gen-hint">
            {params.sizeMode === 'aspect'
              ? '"GI2" 标 GPT Image 2 兼容；"NB" 标 Nano Banana 系列兼容。蓝点表示同时支持。'
              : params.autoCalcCustomSize
                ? '失焦后自动 snap 到 16 整数倍；改宽 → 自动算高，改高 → 自动算宽（8.3 MP 预算）。'
                : '已关闭自动计算：宽 / 高 互不联动，由你直接输入。'}
          </div>
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
              <div
                key={r.path + i}
                className="mb-gen-ref-thumb"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('mb-ref-uri', r.dataUri);
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                title="拖到左侧对话区作附图 / 鼠标悬停有编辑+删除"
              >
                <img src={r.dataUri} alt={`ref ${i + 1}`} draggable={false} />
                <div className="mb-gen-ref-actions">
                  <button
                    type="button"
                    className="mb-gen-ref-act"
                    onClick={() => setEditingRefIdx(i)}
                    title="编辑"
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    className="mb-gen-ref-act mb-gen-ref-act-danger"
                    onClick={() => params.removeRefAt(i)}
                    title="删除"
                  >
                    <TrashIcon size={11} />
                  </button>
                </div>
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
        </div>

      </div>

      <div className="mb-gen-history">
        <div className="mb-gen-history-title">最新 3 个生图任务</div>
        {latestThree.length === 0 ? (
          <div className="mb-gen-empty">
            <ImageIcon size={20} />
            <div>还没有任务，去左侧对话框发个提示词</div>
          </div>
        ) : (
          <div className="mb-gen-task-grid">
            {latestThree.map((task) => {
              const filePath = taskFirstImagePath(task);
              return (
                <motion.div
                  key={task.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`mb-gen-task-card mb-gen-status-${task.status}`}
                >
                  {filePath ? (
                    <button
                      type="button"
                      className="mb-gen-task-thumb"
                      onClick={() => setPreviewSrc(localPathToImageUrl(filePath))}
                      onContextMenu={(e) => showTaskImageMenu(e, filePath)}
                      title="左键放大预览 · 右键复制 / 置入参考"
                    >
                      <img src={localPathToImageUrl(filePath)} alt="" draggable={false} />
                    </button>
                  ) : (
                    <div className="mb-gen-task-thumb is-empty">
                      <ImageIcon size={20} />
                    </div>
                  )}
                  <div className="mb-gen-task-meta">
                    <div className="mb-gen-task-row">
                      <span className="mb-gen-task-id">#{task.id}</span>
                      <span className="mb-gen-task-status">{task.status}</span>
                    </div>
                    <div
                      className="mb-gen-task-prompt-full"
                      onContextMenu={(e) => showTaskPromptMenu(e, task.positive_prompt)}
                      title="右键 复制 / 用于生图"
                      style={{ userSelect: 'text', cursor: 'text' }}
                    >
                      {task.positive_prompt}
                    </div>
                  </div>
                  <div className="mb-gen-task-actions">
                    <button
                      className="mb-btn mb-btn-secondary mb-btn-sm"
                      onClick={() => navigate('/manager')}
                      title="去图库查看"
                    >
                      <GalleryIcon size={12} />
                    </button>
                    <button
                      className="mb-btn mb-btn-secondary mb-btn-sm"
                      onClick={() => openTaskFolder(task)}
                      disabled={task.status !== 'done'}
                      title={task.status === 'done' ? '在文件夹中显示' : '生图完成后再点'}
                    >
                      <FolderIcon size={12} />
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>

      <Lightbox
        open={previewSrc !== null}
        src={previewSrc ?? ''}
        onClose={() => setPreviewSrc(null)}
      />

      <RefEditor
        open={editingRefIdx !== null}
        srcDataUri={
          editingRefIdx !== null
            ? params.refs[editingRefIdx]?.dataUri ?? ''
            : ''
        }
        onClose={() => setEditingRefIdx(null)}
        onSave={async (newUri) => {
          if (editingRefIdx === null) return;
          const cur = params.refs[editingRefIdx];
          if (!cur) {
            setEditingRefIdx(null);
            return;
          }
          // 保存涂鸦后的图片到 refs 同一索引；W×H 重新探测
          const dim = await probeImageSize(newUri);
          const next = [...params.refs];
          next[editingRefIdx] = {
            ...cur,
            dataUri: newUri,
            width: dim.w,
            height: dim.h
          };
          // store 没有"按 idx 替换"动作，clear + 重新加；保留其它索引顺序
          params.clearRefs();
          params.addRefs(next);
          setEditingRefIdx(null);
          toast.success('已保存编辑后的参考图');
        }}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────
// 自定义尺寸：预设 chip + 新增 / 删除按钮
// ─────────────────────────────────────────────────────
function CustomSizePresets({
  w,
  h,
  onPick
}: {
  w: number;
  h: number;
  onPick: (w: number, h: number) => void;
}): JSX.Element {
  const params = useImageParamsStore();
  const merged: SizePreset[] = [
    ...BUILTIN_SIZE_PRESETS,
    ...params.userSizePresets.map((p) => ({ ...p }))
  ];

  function isMatch(p: SizePreset): boolean {
    return p.w === w && p.h === h;
  }

  /**
   * 自动从当前 W×H 生成一个 ≤6 字的标签：以 gcd 比例为主（如 "16:9"），
   * 重名则尾巴加 "·2 / ·3"。原来用 window.prompt() 在 Electron 这种
   * 沙盒渲染进程是会被吞掉的（看着像点击"无反应"），所以改成纯前端命名。
   */
  function autoLabel(): string {
    const ratio = gcdAspect(w, h); // e.g. "16:9", "1:1"
    let base = ratio.length <= 6 ? ratio : `${w}`.slice(0, 6);
    let candidate = base;
    let n = 2;
    while (merged.some((p) => p.label === candidate)) {
      const suffix = `·${n}`;
      // 保证最终 ≤6 字
      const room = 6 - suffix.length;
      candidate = base.slice(0, room) + suffix;
      n += 1;
      if (n > 99) break;
    }
    return candidate;
  }

  function saveCurrent(): void {
    if (w < 256 || h < 256) {
      toast.error('当前尺寸太小，先调到 ≥256');
      return;
    }
    const exists = merged.find((p) => p.w === w && p.h === h);
    if (exists) {
      toast.info('已经有这个尺寸了', exists.label);
      return;
    }
    const label = autoLabel();
    params.addUserSizePreset({
      key: `u-${Date.now()}`,
      label,
      w,
      h
    });
    toast.success('已加入自定义预设', `${label}（${w}×${h}）`);
  }

  async function removeUser(key: string, label: string, e: React.MouseEvent): Promise<void> {
    e.stopPropagation();
    const ok = await confirmDialog({
      title: '删除自定义预设',
      message: `确定删除预设「${label}」？`,
      okText: '删除',
      danger: true
    });
    if (!ok) return;
    params.removeUserSizePreset(key);
  }

  return (
    <div className="mb-size-presets">
      <div className="mb-size-presets-row">
        {merged.map((p) => {
          const isUser = !p.builtin;
          return (
            <button
              key={p.key}
              type="button"
              className={`mb-size-preset ${isMatch(p) ? 'is-active' : ''} ${isUser ? 'is-user' : ''}`}
              onClick={() => onPick(p.w, p.h)}
              title={`${p.label} · ${p.w}×${p.h}`}
            >
              <span className="mb-size-preset-label">{p.label}</span>
              <span className="mb-size-preset-dim">
                {p.w}×{p.h}
              </span>
              {isUser && (
                <span
                  className="mb-size-preset-x"
                  onClick={(e) => removeUser(p.key, p.label, e)}
                  title="删除"
                >
                  ×
                </span>
              )}
            </button>
          );
        })}
        <button
          type="button"
          className="mb-size-preset mb-size-preset-add"
          onClick={saveCurrent}
          title="把当前 W×H 存为自定义预设"
        >
          <PlusIcon size={11} /> 存为预设
        </button>
      </div>
    </div>
  );
}

function gcdAspect(w: number, h: number): string {
  const g = gcdN(w, h);
  return `${w / g}:${h / g}`;
}
function gcdN(a: number, b: number): number {
  return b === 0 ? a : gcdN(b, a % b);
}

// ─────────────────────────────────────────────────────
// 自定义尺寸 · 计算器
//   A 模式：比例 + 总像素（含比较符 < / > / ≈ / =）
//   B 模式：比例 + 一边像素 → 自动算另一边
// ─────────────────────────────────────────────────────
type CalcMode = 'aspect-budget' | 'aspect-side';
type Cmp = 'lt' | 'gt' | 'approx' | 'eq';

const PIXEL_PRESETS: Array<{ value: number; label: string }> = [
  { value: 1_048_576, label: '1 MP' },
  { value: 4_194_304, label: '4 MP' },
  { value: 8_294_400, label: '8.3 MP（4K）' },
  { value: 16_777_216, label: '16 MP' }
];

/** 按比例 + 总像素 + 比较符 反推 W×H。snap=true 时对齐到 16 的倍数。 */
function calcByAspectBudget(
  aw: number,
  ah: number,
  budget: number,
  cmp: Cmp,
  snap: boolean
): { w: number; h: number } {
  const hExact = Math.sqrt((budget * ah) / aw);
  const wExact = (hExact * aw) / ah;

  // 不对齐 16：每个比较符都直接给 ratio-correct 的"接近"值
  if (!snap) {
    if (cmp === 'lt') {
      // 严格小于：缩 1px 即可
      return {
        w: Math.max(1, Math.floor(wExact)),
        h: Math.max(1, Math.floor(hExact))
      };
    }
    if (cmp === 'gt') {
      return {
        w: Math.max(1, Math.ceil(wExact)),
        h: Math.max(1, Math.ceil(hExact))
      };
    }
    // approx / eq 都返回最接近的整数
    return {
      w: Math.max(1, Math.round(wExact)),
      h: Math.max(1, Math.round(hExact))
    };
  }

  // snap=true：对齐 16 的倍数，单边 256-3840
  if (cmp === 'eq' || cmp === 'approx') {
    // 强制等于 + 16 对齐 = 最接近预算的"16 倍数"——退化为 round
    return {
      w: Math.max(256, Math.min(3840, Math.round(wExact / 16) * 16)),
      h: Math.max(256, Math.min(3840, Math.round(hExact / 16) * 16))
    };
  }
  if (cmp === 'gt') {
    let w = Math.max(256, Math.min(3840, Math.ceil(wExact / 16) * 16));
    let h = Math.max(256, Math.min(3840, Math.ceil(hExact / 16) * 16));
    while (w * h < budget && (w < 3840 || h < 3840)) {
      if (w <= h && w < 3840) w += 16;
      else if (h < 3840) h += 16;
      else break;
    }
    return { w, h };
  }
  // 'lt'
  let w = Math.max(256, Math.min(3840, Math.floor(wExact / 16) * 16));
  let h = Math.max(256, Math.min(3840, Math.floor(hExact / 16) * 16));
  while (w * h > budget && (w > 256 || h > 256)) {
    if (w >= h && w > 256) w -= 16;
    else if (h > 256) h -= 16;
    else break;
  }
  return { w, h };
}

function SizeCalculator({
  onApply
}: {
  onApply: (w: number, h: number) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<CalcMode>('aspect-budget');

  // 公共：比例
  const [ratioW, setRatioW] = useState('16');
  const [ratioH, setRatioH] = useState('9');

  // mode A: 总像素 + 比较符
  const [budget, setBudget] = useState('8294400'); // 自由输入；下拉只是预设
  const [cmp, setCmp] = useState<Cmp>('lt');

  // mode B: 一边像素
  const [base, setBase] = useState<'w' | 'h'>('w');
  const [baseValue, setBaseValue] = useState('1024');
  /** 两种模式共用：是否对齐到 16 的倍数 */
  const [snap16, setSnap16] = useState(true);

  // 实时算结果
  const calc = useMemo(() => {
    const aw = Number(ratioW);
    const ah = Number(ratioH);
    if (![aw, ah].every((v) => Number.isFinite(v) && v > 0)) return null;

    if (mode === 'aspect-budget') {
      const b = Number(budget);
      if (!(Number.isFinite(b) && b > 0)) return null;
      return calcByAspectBudget(aw, ah, b, cmp, snap16);
    }
    // aspect-side
    const v = Number(baseValue);
    if (!(Number.isFinite(v) && v > 0)) return null;
    if (base === 'w') {
      const w = v;
      const h = (w * ah) / aw;
      return snap16
        ? { w: Math.round(w / 16) * 16, h: Math.round(h / 16) * 16 }
        : { w: Math.round(w), h: Math.round(h) };
    }
    const h = v;
    const w = (h * aw) / ah;
    return snap16
      ? { w: Math.round(w / 16) * 16, h: Math.round(h / 16) * 16 }
      : { w: Math.round(w), h: Math.round(h) };
  }, [mode, ratioW, ratioH, budget, cmp, base, baseValue, snap16]);

  return (
    <div className="mb-size-calc">
      <button
        type="button"
        className="mb-size-calc-toggle"
        onClick={() => setOpen((v) => !v)}
      >
        🧮 尺寸计算器 {open ? '▾' : '▸'}
      </button>
      {open && (
        <div className="mb-size-calc-body">
          <div className="mb-size-calc-modes">
            <button
              type="button"
              className={`mb-size-calc-mode ${mode === 'aspect-budget' ? 'is-active' : ''}`}
              onClick={() => setMode('aspect-budget')}
            >
              比例 + 总像素
            </button>
            <button
              type="button"
              className={`mb-size-calc-mode ${mode === 'aspect-side' ? 'is-active' : ''}`}
              onClick={() => setMode('aspect-side')}
            >
              比例 + 一边
            </button>
          </div>

          {/* 比例（W:H）一行：左 W 右 H */}
          <div className="mb-size-calc-pair">
            <div className="mb-size-calc-cell">
              <span className="mb-size-calc-label">比例 W</span>
              <input
                type="number"
                className="mb-input mb-size-calc-input"
                value={ratioW}
                onChange={(e) => setRatioW(e.target.value)}
                min={1}
                placeholder="W"
              />
            </div>
            <div className="mb-size-calc-cell">
              <span className="mb-size-calc-label">比例 H</span>
              <input
                type="number"
                className="mb-input mb-size-calc-input"
                value={ratioH}
                onChange={(e) => setRatioH(e.target.value)}
                min={1}
                placeholder="H"
              />
            </div>
          </div>

          {mode === 'aspect-budget' ? (
            <>
              {/* 比较符 + 总像素值，左右排 */}
              <div className="mb-size-calc-pair">
                <div className="mb-size-calc-cell">
                  <span className="mb-size-calc-label">关系</span>
                  <select
                    className="mb-select mb-size-calc-input"
                    value={cmp}
                    onChange={(e) => setCmp(e.target.value as Cmp)}
                  >
                    <option value="lt">小于 &lt;</option>
                    <option value="gt">大于 &gt;</option>
                    <option value="approx">约等于 ≈</option>
                    <option value="eq">强制等于 =</option>
                  </select>
                </div>
                <div className="mb-size-calc-cell">
                  <span className="mb-size-calc-label">总像素</span>
                  <input
                    type="number"
                    className="mb-input mb-size-calc-input"
                    value={budget}
                    onChange={(e) => setBudget(e.target.value)}
                    min={10000}
                    placeholder="像素"
                  />
                </div>
              </div>
              {/* 预设 + snap16 一行 */}
              <div className="mb-size-calc-pair">
                <div className="mb-size-calc-cell">
                  <span className="mb-size-calc-label">快速填值</span>
                  <select
                    className="mb-select mb-size-calc-input"
                    value=""
                    onChange={(e) => {
                      if (e.target.value) setBudget(e.target.value);
                    }}
                  >
                    <option value="">预设…</option>
                    {PIXEL_PRESETS.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>
                <label
                  className="mb-size-calc-snap"
                  title="勾上则结果对齐到 16 的倍数（多数模型要求）"
                >
                  <input
                    type="checkbox"
                    checked={snap16}
                    onChange={(e) => setSnap16(e.target.checked)}
                  />
                  <span>对齐 ×16</span>
                </label>
              </div>
            </>
          ) : (
            <>
              <div className="mb-size-calc-pair">
                <div className="mb-size-calc-cell">
                  <span className="mb-size-calc-label">已知</span>
                  <select
                    className="mb-select mb-size-calc-input"
                    value={base}
                    onChange={(e) => setBase(e.target.value as 'w' | 'h')}
                  >
                    <option value="w">宽 W</option>
                    <option value="h">高 H</option>
                  </select>
                </div>
                <div className="mb-size-calc-cell">
                  <span className="mb-size-calc-label">像素</span>
                  <input
                    type="number"
                    className="mb-input mb-size-calc-input"
                    value={baseValue}
                    onChange={(e) => setBaseValue(e.target.value)}
                    min={1}
                    placeholder="像素"
                  />
                </div>
              </div>
              <label
                className="mb-size-calc-snap"
                title="勾上则结果对齐到 16 的倍数（多数模型要求）"
              >
                <input
                  type="checkbox"
                  checked={snap16}
                  onChange={(e) => setSnap16(e.target.checked)}
                />
                <span>对齐到 ×16（多数模型要求）</span>
              </label>
            </>
          )}

          <div className="mb-size-calc-result-row">
            <div className="mb-size-calc-result">
              {calc ? (
                <>
                  <strong>
                    {calc.w} × {calc.h}
                  </strong>
                  <span className="mb-size-calc-mp">
                    （{(calc.w * calc.h / 1_000_000).toFixed(2)} MP）
                  </span>
                </>
              ) : (
                <span style={{ opacity: 0.55 }}>请填写有效值</span>
              )}
            </div>
            <button
              type="button"
              className="mb-btn mb-btn-primary mb-btn-sm"
              disabled={!calc}
              onClick={() => calc && onApply(calc.w, calc.h)}
            >
              一键导入
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Blob → image/png Blob，用于剪贴板 */
async function blobToPng(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return blob;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close?.();
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
  });
}
