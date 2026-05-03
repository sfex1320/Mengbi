import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { toast } from '@/store/toastStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useImageParamsStore } from '@/store/imageParamsStore';
import { Modal } from '@/components/Modal';
import { openContextMenu } from '@/components/ContextMenu';
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
  const visionModels = configs
    .filter((c) => c.plan_id === activePlanId && c.type === 'text' && c.supports_vision)
    .flatMap((c) => Object.keys(c.model_mapping ?? {}));

  const [imagePath, setImagePath] = useState('');
  const [previewUri, setPreviewUri] = useState('');
  const [resultType, setResultType] = useState<'description' | 'tags' | 'style'>('description');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<unknown>(null);
  const [dragOver, setDragOver] = useState(false);

  // 把任意结果转回纯文本（description 是字符串，tags/style 可能是数组或对象）
  function resultText(): string {
    if (typeof result === 'string') return result;
    if (Array.isArray(result)) return (result as string[]).join(', ');
    if (result && typeof result === 'object') return JSON.stringify(result, null, 2);
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

  async function archiveAsPrompt(): Promise<void> {
    const t = resultText().trim();
    if (!t) return;
    const r = await window.electronAPI.prompt.upsert({
      title: t.slice(0, 40),
      text: t,
      kind: 'image',
      tags: visionModels[0] ? [visionModels[0]] : [],
      notes: '由反推工具生成'
    });
    if (r.ok) toast.success('已加入提示词管家');
    else toast.error('归档失败', r.error.message);
  }

  function showResultMenu(e: React.MouseEvent): void {
    e.preventDefault();
    const t = resultText();
    if (!t) return;
    openContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: '复制',
          icon: <CopyIconShape size={13} />,
          onClick: copyResult
        },
        {
          label: '用作生图提示词',
          variant: 'accent',
          icon: <SparkleIcon size={12} />,
          onClick: useAsImagePrompt
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
    setImagePath(f.path);
    setPreviewUri(f.dataUri);
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
    if (droppedPath) setImagePath(droppedPath);
    // 同时生成 dataUri 给预览缩略图
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') setPreviewUri(reader.result);
    };
    reader.readAsDataURL(file);
  }

  async function run(): Promise<void> {
    if (!imagePath) {
      toast.error('请拖入或选择一张图');
      return;
    }
    setBusy(true);
    setResult(null);
    const r = await window.electronAPI.lab.reverse({
      imagePaths: [imagePath],
      modelId: visionModels[0] ?? 'mock',
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
        <label className="mb-label">支持 vision 的对话模型</label>
        <input
          className="mb-input"
          value={visionModels[0] ?? '(未配置 — 会使用 Mock)'}
          readOnly
        />
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

      <button className="mb-btn mb-btn-primary" onClick={run} disabled={busy}>
        {busy ? '反推中…' : '开始反推'}
      </button>

      <AnimatePresence>
        {result !== null && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mb-lab-result"
          >
            <div className="mb-lab-result-head">
              <div className="mb-label" style={{ margin: 0 }}>
                结果（右键有更多）
              </div>
              <div className="mb-lab-result-actions">
                <button
                  className="mb-config-row-btn"
                  onClick={copyResult}
                  title="复制提示词到剪贴板"
                >
                  <CopyIconShape size={12} /> 复制
                </button>
                <button
                  className="mb-config-row-btn"
                  onClick={useAsImagePrompt}
                  title="把这段提示词扔进生图输入框，跳到生图页"
                >
                  <SparkleIcon size={12} /> 一键生图
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
            <pre onContextMenu={showResultMenu} style={{ userSelect: 'text', cursor: 'text' }}>
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
