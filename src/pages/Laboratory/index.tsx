import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { toast } from '@/store/toastStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useImageParamsStore } from '@/store/imageParamsStore';
import { Modal } from '@/components/Modal';
import { openContextMenu } from '@/components/ContextMenu';
import { useLabStore } from '@/store/labStore';
import { autoTag } from '@/lib/autoTag';
import {
  FlaskIcon,
  ZapIcon,
  CopyIconShape,
  SparkleIcon,
  PlusIcon
} from '@/components/Icon';
import './Laboratory.css';

interface Tool {
  key: string;
  name: string;
  desc: string;
  priority: 'P0' | 'P1' | 'P2';
  available: boolean;
}

const TOOLS: Tool[] = [
  { key: 'reverse', name: '反推', desc: '上传一张图，得到近似生成它的提示词', priority: 'P0', available: true },
  { key: 'translate', name: '中英互译', desc: '提示词中英双向翻译', priority: 'P0', available: true },
  {
    key: 'split',
    name: '拆解',
    desc: '把一段提示词拆成主题/风格/光线/构图/镜头/后处理',
    priority: 'P1',
    available: false
  },
  {
    key: 'compare',
    name: '多模型对比',
    desc: '同提示词喂给多个模型，并排出图',
    priority: 'P2',
    available: false
  },
  { key: 'fuse', name: '融合', desc: '把两条提示词按比例（70%/30%）合一条', priority: 'P2', available: false }
];

export default function LaboratoryPage(): JSX.Element {
  const [openTool, setOpenTool] = useState<string | null>(null);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.25 }}
      className="mb-lab-root"
    >
      <section className="mb-card mb-lab-shell mb-marquee-glow">
        <header className="mb-lab-header">
          <h2>
            <FlaskIcon size={20} /> 提示词实验室
          </h2>
          <p>对提示词本身做实验：反推 / 拆解 / 翻译 / 融合 / 对比测试</p>
        </header>

        <div className="mb-lab-grid">
          {TOOLS.map((tool, i) => (
            <motion.button
              key={tool.key}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04, duration: 0.3 }}
              whileHover={{ scale: tool.available ? 1.025 : 1 }}
              whileTap={{ scale: tool.available ? 0.98 : 1 }}
              className={`mb-lab-tool ${tool.available ? '' : 'is-disabled'}`}
              onClick={() => {
                if (tool.available) setOpenTool(tool.key);
                else toast.info(`${tool.name} 暂未实现`, `计划在 ${tool.priority === 'P1' ? 'v1.1' : 'v1.5+'} 版本提供`);
              }}
            >
              <div className="mb-lab-tool-glow" />
              <div className="mb-lab-tool-head">
                <span className="mb-lab-tool-name">{tool.name}</span>
                <span className={`mb-lab-tool-badge mb-lab-badge-${tool.priority}`}>
                  {tool.priority}
                </span>
              </div>
              <p className="mb-lab-tool-desc">{tool.desc}</p>
              <span className="mb-lab-tool-cta">
                {tool.available ? '打开' : '即将上线'} <ZapIcon size={12} />
              </span>
            </motion.button>
          ))}
        </div>
      </section>

      <Modal
        open={openTool === 'reverse'}
        onClose={() => setOpenTool(null)}
        title="反推：图片 → 提示词"
        width={580}
      >
        <ReverseTool onClose={() => setOpenTool(null)} />
      </Modal>

      <Modal
        open={openTool === 'translate'}
        onClose={() => setOpenTool(null)}
        title="中英互译"
        width={580}
      >
        <TranslateTool onClose={() => setOpenTool(null)} />
      </Modal>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────
// Reverse Tool
// ─────────────────────────────────────────────────────

function ReverseTool({ onClose }: { onClose: () => void }): JSX.Element {
  const { configs, activePlanId } = useSettingsStore();
  const navigate = useNavigate();
  const imgParams = useImageParamsStore();
  const labStore = useLabStore();

  // 优先列已勾"vision"的模型；若全没勾，退而求其次给所有 text 模型，
  // 让用户能自己选——很多多模态模型（Qwen-VL / GPT-4o / Gemini ...）即使配置时
  // 忘记勾 vision 也能跑。
  const visionConfigs = configs.filter(
    (c) => c.plan_id === activePlanId && c.type === 'text' && c.supports_vision
  );
  const allTextConfigs = configs.filter(
    (c) => c.plan_id === activePlanId && c.type === 'text'
  );
  const useFallback = visionConfigs.length === 0;
  const visionModels = (useFallback ? allTextConfigs : visionConfigs).flatMap((c) =>
    Object.keys(c.model_mapping ?? {})
  );

  // 状态全部走 labStore，跨"开关弹窗"持久化
  const modelId = labStore.reverseModelId || visionModels[0] || '';
  const setModelId = labStore.setReverseModelId;
  const imagePath = labStore.reverseImagePath;
  const previewUri = labStore.reversePreviewUri;
  const resultType = labStore.reverseResultType;
  const setResultType = labStore.setReverseResultType;
  const result = labStore.reverseResult;
  const setResult = labStore.setReverseResult;

  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const resultPreRef = useRef<HTMLPreElement>(null);
  const resultBoxRef = useRef<HTMLDivElement>(null);

  // 统一改图入口，避免 path 和 dataUri 分两步覆盖造成的状态错乱
  const setReverseImage = labStore.setReverseImage;

  // 抓 <pre> 里用户高亮选中的文本
  function getSelectedFromResult(): string {
    const pre = resultPreRef.current;
    if (!pre) return '';
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return '';
    if (!pre.contains(sel.anchorNode)) return '';
    const t = sel.toString().trim();
    return t;
  }

  // 模型列表变化时，若当前选的不在新列表里 → 重置成第一项
  useEffect(() => {
    if (visionModels.length === 0) {
      if (modelId !== '') setModelId('');
    } else if (!visionModels.includes(modelId)) {
      setModelId(visionModels[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visionModels.join(',')]);

  // 结果出来时滚进视口，避免用户找不到结果框
  useEffect(() => {
    if (result === null) return;
    const t = setTimeout(() => {
      resultBoxRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 100);
    return () => clearTimeout(t);
  }, [result]);

  // 把任意结果转回纯文本（description 是字符串，tags/style 可能是数组或对象）
  function resultText(): string {
    if (typeof result === 'string') return result;
    if (Array.isArray(result)) return (result as string[]).join(', ');
    if (result && typeof result === 'object') {
      const obj = result as Record<string, unknown>;
      if (typeof obj.text === 'string') return obj.text;
      if (Array.isArray(obj.tags)) return (obj.tags as string[]).join(', ');
      return JSON.stringify(result, null, 2);
    }
    return '';
  }

  async function copyResult(): Promise<void> {
    const t = resultText();
    if (!t) return;
    try {
      await navigator.clipboard.writeText(t);
      toast.success('提示词已复制');
    } catch {
      toast.error('复制失败');
    }
  }

  function useAsImagePrompt(): void {
    const t = resultText().trim();
    if (!t) return;
    imgParams.setChatDraft(t);
    onClose();
    navigate('/');
    toast.success('已填到生图输入框', '回车直接生图');
  }

  function useSelectedAsImagePrompt(): void {
    const t = getSelectedFromResult();
    if (!t) {
      toast.info('请先在结果文本里选中要使用的片段');
      return;
    }
    imgParams.setChatDraft(t);
    onClose();
    navigate('/');
    toast.success('已用选中片段填到生图输入框');
  }

  async function copySelected(): Promise<void> {
    const t = getSelectedFromResult();
    if (!t) {
      toast.info('请先选中要复制的片段');
      return;
    }
    try {
      await navigator.clipboard.writeText(t);
      toast.success('已复制选中片段');
    } catch {
      toast.error('复制失败');
    }
  }

  async function archiveAsPrompt(): Promise<void> {
    const t = resultText().trim();
    if (!t) return;
    // 用真正反推用的那个 modelId 当模型 tag —— 不是 visionModels[0]（那是列表第一项）
    // 然后让 autoTag 抽出主体/风格/关键词，再合并去重
    const auto = autoTag(t, modelId || null, [], 10);
    // 从 previewUri 缩成小图（最长边 ≤ 256px webp dataUri，单个 ~20-40KB）
    let thumb: string | null = null;
    if (previewUri) {
      try {
        thumb = await downscaleDataUri(previewUri, 256, 0.78);
      } catch {
        thumb = null;
      }
    }
    const r = await window.electronAPI.prompt.upsert({
      title: t.slice(0, 40),
      text: t,
      kind: 'image',
      tags: auto.merged,
      notes: `由反推工具生成 · 模型 ${modelId || '(mock)'}`,
      thumb_data_uri: thumb ?? undefined
    });
    if (r.ok) toast.success('已加入提示词管家');
    else toast.error('归档失败', r.error.message);
  }

  function showResultMenu(e: React.MouseEvent): void {
    e.preventDefault();
    const t = resultText();
    if (!t) return;
    const sel = getSelectedFromResult();
    openContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: sel ? `复制选中（${sel.length} 字）` : '复制整段',
          icon: <CopyIconShape size={13} />,
          onClick: sel ? copySelected : copyResult
        },
        {
          label: '一键生图（整段）',
          variant: 'accent',
          icon: <SparkleIcon size={12} />,
          onClick: useAsImagePrompt
        },
        {
          label: sel ? `选中生图（${sel.length} 字）` : '选中生图',
          variant: 'accent',
          icon: <SparkleIcon size={12} />,
          disabled: !sel,
          onClick: useSelectedAsImagePrompt
        },
        {
          label: '加入提示词管家',
          icon: <PlusIcon size={12} />,
          onClick: archiveAsPrompt
        }
      ]
    });
  }

  async function pickFromDialog(): Promise<void> {
    const r = await window.electronAPI.storage.pickImages();
    if (!r.ok || r.data.files.length === 0) return;
    const f = r.data.files[0];
    setReverseImage(f.path, f.dataUri);
  }

  function onDragOver(e: React.DragEvent<HTMLDivElement>): void {
    e.preventDefault();
    setDragOver(true);
  }
  function onDragLeave(): void {
    setDragOver(false);
  }
  async function onDrop(e: React.DragEvent<HTMLDivElement>): Promise<void> {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('只支持图片文件');
      return;
    }
    // Electron 的 File 对象有 path 属性指向真实磁盘路径
    const droppedPath = (file as File & { path?: string }).path ?? '';
    // 同时生成 dataUri 给预览缩略图，path + dataUri 一起写入避免覆盖
    const reader = new FileReader();
    reader.onload = () => {
      const dataUri = typeof reader.result === 'string' ? reader.result : '';
      setReverseImage(droppedPath, dataUri);
    };
    reader.readAsDataURL(file);
  }

  async function run(): Promise<void> {
    if (!imagePath) {
      toast.error('请拖入或选择一张图');
      return;
    }
    if (!modelId && visionModels.length > 0) {
      toast.error('请先选一个多模态视觉模型');
      return;
    }
    setBusy(true);
    setResult(null);
    const r = await window.electronAPI.lab.reverse({
      imagePaths: [imagePath],
      modelId: modelId || 'mock',
      resultType
    });
    setBusy(false);
    if (r.ok) {
      setResult((r.data as { result: unknown }).result);
      toast.success('反推完成');
    } else {
      toast.error('反推失败', r.error.message);
    }
  }

  return (
    <div className="mb-lab-form">
      <div>
        <label className="mb-label">
          多模态视觉模型（用来做反推）{useFallback && ' · 当前 plan 下没勾过 vision，列出全部 text 模型给你选'}
        </label>
        {visionModels.length === 0 ? (
          <input
            className="mb-input"
            value="(未配置任何对话模型 — 会使用 Mock)"
            readOnly
          />
        ) : (
          <select
            className="mb-select"
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
          >
            {visionModels.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        )}
        {useFallback && (
          <div className="mb-field-hint">
            建议把真正支持图片输入的模型（GPT-4o / Claude / Gemini / Qwen-VL ...）
            在设置里勾上"支持 vision"，下次只列出它们。
          </div>
        )}
      </div>

      <div>
        <label className="mb-label">图片</label>
        <div
          className={`mb-lab-dropzone ${dragOver ? 'is-over' : ''} ${previewUri ? 'has-image' : ''}`}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onClick={pickFromDialog}
        >
          {previewUri ? (
            <img src={previewUri} alt="reference" className="mb-lab-dropzone-img" />
          ) : (
            <div className="mb-lab-dropzone-tip">
              <span>拖图到这里 / 点击选择</span>
              <span className="mb-lab-dropzone-hint">PNG · JPG · WebP</span>
            </div>
          )}
        </div>
        {imagePath && (
          <div className="mb-lab-dropzone-path" title={imagePath}>
            {imagePath}
          </div>
        )}
      </div>

      <div>
        <label className="mb-label">输出格式</label>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['description', 'tags', 'style'] as const).map((t) => (
            <button
              key={t}
              className={`mb-btn mb-btn-secondary mb-btn-sm ${
                resultType === t ? 'is-active-pill' : ''
              }`}
              onClick={() => setResultType(t)}
              style={
                resultType === t
                  ? { background: 'var(--mb-accent-soft)', color: 'var(--mb-accent)', borderColor: 'var(--mb-accent)' }
                  : {}
              }
            >
              {t === 'description' ? '完整描述' : t === 'tags' ? '逗号标签' : '风格分析'}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          className="mb-btn mb-btn-primary"
          style={{ flex: 1 }}
          onClick={run}
          disabled={busy}
        >
          {busy ? '反推中…' : '开始反推'}
        </button>
        <button
          className="mb-btn mb-btn-secondary"
          onClick={() => {
            labStore.clearReverse();
            toast.info('已清空');
          }}
          disabled={busy || (!previewUri && result === null)}
          title="清空当前图片和上一次结果"
        >
          清空
        </button>
      </div>

      <AnimatePresence>
        {result !== null && (
          <motion.div
            ref={resultBoxRef}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.2 }}
            className="mb-lab-result"
          >
            <div className="mb-lab-result-head">
              <div className="mb-label" style={{ margin: 0 }}>
                反推结果 <span style={{ opacity: 0.55, fontWeight: 400 }}>（可拖蓝选中片段；右键更多）</span>
              </div>
              <div className="mb-lab-result-actions">
                <button
                  className="mb-config-row-btn"
                  onClick={copyResult}
                  title="复制提示词到剪贴板"
                >
                  <CopyIconShape size={12} /> 复制整段
                </button>
                <button
                  className="mb-config-row-btn"
                  onClick={useAsImagePrompt}
                  title="把整段提示词扔进生图输入框，跳到生图页"
                >
                  <SparkleIcon size={12} /> 一键生图
                </button>
                <button
                  className="mb-config-row-btn"
                  onClick={useSelectedAsImagePrompt}
                  title="只把你选中的那一段扔进生图输入框；先用鼠标在下方文本里拖蓝"
                >
                  <SparkleIcon size={12} /> 选中生图
                </button>
                <button
                  className="mb-config-row-btn"
                  onClick={archiveAsPrompt}
                  title="加入提示词管家"
                >
                  <PlusIcon size={12} /> 加入管家
                </button>
              </div>
            </div>
            <pre
              ref={resultPreRef}
              onContextMenu={showResultMenu}
              style={{ userSelect: 'text', cursor: 'text' }}
            >
              {resultText()}
            </pre>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─────────────────────────────────────────────────────
// Translate Tool
// ─────────────────────────────────────────────────────

function TranslateTool({ onClose: _ }: { onClose: () => void }): JSX.Element {
  const [text, setText] = useState('');
  const [direction, setDirection] = useState<'zh-to-en' | 'en-to-zh'>('zh-to-en');
  const [result, setResult] = useState('');
  const [busy, setBusy] = useState(false);

  async function run(): Promise<void> {
    if (!text.trim()) {
      toast.error('请输入要翻译的文本');
      return;
    }
    setBusy(true);
    setResult('');
    const r = await window.electronAPI.lab.translate({ text, direction });
    setBusy(false);
    if (r.ok) {
      setResult((r.data as { result: string }).result);
      toast.success('翻译完成');
    } else {
      toast.error('翻译失败', r.error.message);
    }
  }

  return (
    <div className="mb-lab-form">
      <div>
        <label className="mb-label">方向</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="mb-btn mb-btn-secondary mb-btn-sm"
            style={
              direction === 'zh-to-en'
                ? { background: 'var(--mb-accent-soft)', color: 'var(--mb-accent)', borderColor: 'var(--mb-accent)' }
                : {}
            }
            onClick={() => setDirection('zh-to-en')}
          >
            中 → 英
          </button>
          <button
            className="mb-btn mb-btn-secondary mb-btn-sm"
            style={
              direction === 'en-to-zh'
                ? { background: 'var(--mb-accent-soft)', color: 'var(--mb-accent)', borderColor: 'var(--mb-accent)' }
                : {}
            }
            onClick={() => setDirection('en-to-zh')}
          >
            英 → 中
          </button>
        </div>
      </div>
      <div>
        <label className="mb-label">原文</label>
        <textarea
          className="mb-textarea"
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </div>
      <button className="mb-btn mb-btn-primary" onClick={run} disabled={busy}>
        {busy ? '翻译中…' : '翻译'}
      </button>
      {result && (
        <div className="mb-lab-result">
          <div className="mb-label">译文</div>
          <pre>{result}</pre>
        </div>
      )}
    </div>
  );
}

/**
 * 把 dataUri 缩成最长边 = maxEdge 的 webp dataUri。
 * 用 createImageBitmap + OffscreenCanvas（fallback HTMLCanvas）。
 */
async function downscaleDataUri(
  src: string,
  maxEdge: number,
  quality: number
): Promise<string> {
  const blob = await (await fetch(src)).blob();
  const bm = await createImageBitmap(blob);
  const ratio = Math.min(maxEdge / bm.width, maxEdge / bm.height, 1);
  const w = Math.max(1, Math.round(bm.width * ratio));
  const h = Math.max(1, Math.round(bm.height * ratio));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas ctx missing');
  ctx.drawImage(bm, 0, 0, w, h);
  bm.close?.();
  return canvas.toDataURL('image/webp', quality);
}
