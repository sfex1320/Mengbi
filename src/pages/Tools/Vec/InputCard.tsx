/**
 * InputCard —— 左侧输入卡(v3 重设计)。
 *
 * 板块顺序:
 *   1. Dropzone (主视觉,大块拖拽区)
 *   2. 待处理文件列表(若有)
 *   3. 折叠区:高级参数(按当前模式呈现 mode-specific 表单)
 *   4. 折叠区:输出选项(目录 / 命名 / 重名)
 *   5. 识别提示条(浅色,底部,可忽略)
 *   6. 主操作:开始矢量化按钮
 *
 * 与上一版分散控件相比:
 *   - 输出选项默认折叠(大多数用户不改)
 *   - 高级参数按模式动态切换(VTracer 看 colorPrecision,Potrace 看 threshold)
 *   - 识别提示在底部小条,不和 dropzone 抢眼
 */
import { useState, useEffect, useRef, useCallback, type ChangeEvent } from 'react';
import { useVecStore } from '@/store/vecStore';
import { useSettingsStore } from '@/store/settingsStore';
import { toast } from '@/store/toastStore';
import { UploadIcon, FolderIcon, XIcon } from '@/components/Icon';
import { Collapsible } from './components/Collapsible';
import { ImageTypeHint } from './components/ImageTypeHint';
import type {
  VecMode,
  VecParams,
  VTracerParams,
  PotraceParams
} from '@/types/ipc';

const IMAGE_EXT = /\.(png|jpe?g|webp|bmp|gif|tiff?)$/i;

interface Props {
  onSubmit: (params: VecParams) => void | Promise<void>;
  submitting: boolean;
}

export function InputCard({ onSubmit, submitting }: Props): JSX.Element {
  const { prefs } = useSettingsStore();
  const selectedMode = useVecStore((s) => s.selectedMode);
  const pendingInputs = useVecStore((s) => s.pendingInputs);
  const addPendingInputs = useVecStore((s) => s.addPendingInputs);
  const clearPendingInputs = useVecStore((s) => s.clearPendingInputs);
  const outputDir = useVecStore((s) => s.outputDir);
  const setOutputDir = useVecStore((s) => s.setOutputDir);
  const naming = useVecStore((s) => s.naming);
  const setNaming = useVecStore((s) => s.setNaming);
  const onConflict = useVecStore((s) => s.onConflict);
  const setOnConflict = useVecStore((s) => s.setOnConflict);
  const setLastImageHint = useVecStore((s) => s.setLastImageHint);

  const [hovering, setHovering] = useState(false);
  const [params, setParams] = useState<VecParams>({});

  // 切模式时重置 params,避免上一个模式的字段串到下一个
  const prevMode = useRef(selectedMode);
  useEffect(() => {
    if (prevMode.current !== selectedMode) {
      prevMode.current = selectedMode;
      setParams({});
    }
  }, [selectedMode]);

  const detectFirstImage = useCallback(
    (paths: string[]) => {
      if (paths.length === 0) return;
      void window.electronAPI.vec
        .detectType({ inputPath: paths[0] })
        .then((r) => {
          if (r.ok) setLastImageHint(r.data);
        })
        .catch(() => {});
    },
    [setLastImageHint]
  );

  const handlePick = useCallback(async () => {
    const r = await window.electronAPI.storage.pickFiles({
      filters: [
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'tiff'] }
      ],
      title: '选择要矢量化的图片'
    });
    if (r.ok && r.data.filePaths.length) {
      addPendingInputs(r.data.filePaths);
      detectFirstImage(r.data.filePaths);
    }
  }, [addPendingInputs, detectFirstImage]);

  const handlePickFolder = useCallback(async () => {
    const r = await window.electronAPI.storage.selectFolder();
    if (r.ok && r.data) setOutputDir(r.data.path);
  }, [setOutputDir]);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setHovering(false);
      const files = Array.from(e.dataTransfer.files);
      const paths: string[] = [];
      for (const f of files) {
        const p = (f as File & { path?: string }).path;
        if (p && IMAGE_EXT.test(p)) paths.push(p);
      }
      if (paths.length) {
        addPendingInputs(paths);
        detectFirstImage(paths);
      } else if (files.length > 0) {
        toast.info('未识别图片', '只接受 PNG / JPG / WebP / BMP / GIF / TIFF');
      }
    },
    [addPendingInputs, detectFirstImage]
  );

  const effectiveOutputDir = outputDir.trim() || resolveDefaultOutputDir(prefs);
  const canSubmit = pendingInputs.length > 0 && !submitting;

  return (
    <div className="mb-vec-input-card">
      {/* 1. Dropzone */}
      <div
        className={`mb-vec-dz ${hovering ? 'is-hover' : ''} ${pendingInputs.length > 0 ? 'is-has-files' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setHovering(true);
        }}
        onDragLeave={() => setHovering(false)}
        onDrop={handleDrop}
      >
        {pendingInputs.length === 0 ? (
          <>
            <UploadIcon size={28} />
            <div className="mb-vec-dz-headline">拖入图片到此</div>
            <div className="mb-vec-dz-sub">支持多选 / 文件夹 · PNG / JPG / WebP / BMP / GIF / TIFF</div>
            <button
              type="button"
              className="mb-btn mb-btn-ghost mb-btn-sm"
              onClick={() => void handlePick()}
            >
              或点击选择文件
            </button>
          </>
        ) : (
          <FileList
            paths={pendingInputs}
            onClear={clearPendingInputs}
            onAddMore={() => void handlePick()}
          />
        )}
      </div>

      {/* 2. 识别提示(只在有文件后才出) */}
      {pendingInputs.length > 0 && <ImageTypeHint />}

      {/* 3. 折叠:高级参数 */}
      <Collapsible
        title={`高级参数 · ${modeLabel(selectedMode)}`}
        badge={Object.keys(params as Record<string, unknown>).length > 0 ? '已自定义' : '默认'}
      >
        <ModeParamsEditor mode={selectedMode} params={params} onChange={setParams} />
      </Collapsible>

      {/* 4. 折叠:输出选项 */}
      <Collapsible title="输出选项" badge={namingLabel(naming) + ' · ' + conflictLabel(onConflict)}>
        <div className="mb-vec-output-opts">
          <label className="mb-vec-opt-row">
            <span>目录</span>
            <div className="mb-vec-output-pick">
              <input
                type="text"
                value={outputDir}
                onChange={(e) => setOutputDir(e.target.value)}
                placeholder={`留空 = ${effectiveOutputDir || '工具箱保存路径 / vec /'}`}
                spellCheck={false}
              />
              <button
                type="button"
                className="mb-btn mb-btn-ghost mb-btn-sm"
                onClick={() => void handlePickFolder()}
              >
                <FolderIcon size={12} /> 选择
              </button>
            </div>
          </label>
          <label className="mb-vec-opt-row">
            <span>命名</span>
            <select value={naming} onChange={(e) => setNaming(e.target.value as 'original' | 'suffix')}>
              <option value="original">保留原名 (name.svg)</option>
              <option value="suffix">加后缀 (name.vec.svg)</option>
            </select>
          </label>
          <label className="mb-vec-opt-row">
            <span>重名</span>
            <select
              value={onConflict}
              onChange={(e) => setOnConflict(e.target.value as 'overwrite' | 'skip' | 'rename')}
            >
              <option value="rename">自动改名 (name (1).svg)</option>
              <option value="overwrite">覆盖原文件</option>
              <option value="skip">跳过该任务</option>
            </select>
          </label>
        </div>
      </Collapsible>

      {/* 5. 提交按钮 */}
      <div className="mb-vec-submit-bar">
        <button
          type="button"
          className="mb-btn mb-btn-primary mb-vec-submit-btn"
          onClick={() => void onSubmit(params)}
          disabled={!canSubmit}
        >
          {submitting
            ? '提交中…'
            : pendingInputs.length === 0
              ? '请先添加图片'
              : `开始矢量化 (${pendingInputs.length})`}
        </button>
        {pendingInputs.length > 0 && (
          <span className="mb-vec-submit-eta">
            {pendingInputs.length === 1
              ? '通常 < 1s'
              : `${pendingInputs.length} 张 · CPU 并发约 ${estimateSeconds(pendingInputs.length)}s`}
          </span>
        )}
      </div>
    </div>
  );
}

// ── 文件列表 ────────────────────────────────────────────────

function FileList({
  paths,
  onClear,
  onAddMore
}: {
  paths: string[];
  onClear: () => void;
  onAddMore: () => void;
}): JSX.Element {
  const showCount = paths.length > 100 ? 100 : paths.length;
  return (
    <div className="mb-vec-filelist">
      <div className="mb-vec-filelist-head">
        <span>{paths.length} 张待处理</span>
        <div className="mb-vec-filelist-head-actions">
          <button type="button" className="mb-btn mb-btn-ghost mb-btn-xs" onClick={onAddMore}>
            <UploadIcon size={11} /> 加图
          </button>
          <button type="button" className="mb-btn mb-btn-ghost mb-btn-xs" onClick={onClear}>
            <XIcon size={11} /> 清空
          </button>
        </div>
      </div>
      <ul className="mb-vec-filelist-list">
        {paths.slice(0, showCount).map((p) => (
          <li key={p} title={p}>
            {p.split(/[\\/]/).pop() ?? p}
          </li>
        ))}
        {paths.length > showCount && (
          <li className="mb-vec-filelist-more">… 还有 {paths.length - showCount} 项</li>
        )}
      </ul>
    </div>
  );
}

// ── 模式参数编辑器 ─────────────────────────────────────────

function ModeParamsEditor({
  mode,
  params,
  onChange
}: {
  mode: VecMode;
  params: VecParams;
  onChange: (p: VecParams) => void;
}): JSX.Element {
  // VecParams 是 union,keyof 算下来是 never;用 string + as 转换
  function patch(key: string, val: unknown) {
    onChange({ ...(params as Record<string, unknown>), [key]: val } as VecParams);
  }

  if (mode === 'vtracer') {
    const p = params as VTracerParams;
    return (
      <div className="mb-vec-params">
        <ParamSlider
          label="颜色精度"
          min={1}
          max={10}
          step={1}
          value={p.colorPrecision ?? 8}
          onChange={(v) => patch('colorPrecision', v)}
          hint="值越大越保色,但 path 越多 (默认 8)"
        />
        <ParamSlider
          label="斑点过滤"
          min={0}
          max={20}
          step={1}
          value={p.filterSpeckle ?? 4}
          onChange={(v) => patch('filterSpeckle', v)}
          hint="过滤小斑点的阈值 (默认 4)"
        />
        <ParamSlider
          label="角度阈值"
          min={0}
          max={180}
          step={5}
          value={p.cornerThreshold ?? 60}
          onChange={(v) => patch('cornerThreshold', v)}
          hint="低值=尖角 / 高值=圆滑 (默认 60°)"
        />
      </div>
    );
  }
  if (mode === 'potrace') {
    const p = params as PotraceParams;
    return (
      <div className="mb-vec-params">
        <ParamSlider
          label="二值化阈值"
          min={0}
          max={255}
          step={1}
          value={p.threshold ?? 128}
          onChange={(v) => patch('threshold', v)}
          hint="越大保留越多黑色 (默认 128)"
        />
        <ParamSlider
          label="斑点过滤"
          min={0}
          max={100}
          step={1}
          value={p.turdSize ?? 2}
          onChange={(v) => patch('turdSize', v)}
          hint="忽略小于此像素数的斑点 (默认 2)"
        />
        <label className="mb-vec-param-row">
          <span>反相</span>
          <input
            type="checkbox"
            checked={p.blackOnWhite ?? true}
            onChange={(e) => patch('blackOnWhite', e.target.checked)}
          />
          <span className="mb-vec-param-hint">勾选=黑色为前景 (默认)</span>
        </label>
      </div>
    );
  }
  return <div className="mb-vec-params-empty">该模式暂无可调参数</div>;
}

function ParamSlider({
  label,
  min,
  max,
  step,
  value,
  onChange,
  hint
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  hint?: string;
}): JSX.Element {
  function handle(e: ChangeEvent<HTMLInputElement>) {
    onChange(Number(e.target.value));
  }
  return (
    <label className="mb-vec-param-row">
      <span className="mb-vec-param-label">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={handle} />
      <span className="mb-vec-param-val">{value}</span>
      {hint && <span className="mb-vec-param-hint">{hint}</span>}
    </label>
  );
}

// ── 工具函数 ──────────────────────────────────────────────

function modeLabel(m: VecMode): string {
  return { vtracer: 'Fast', potrace: 'Crisp' }[m];
}
function namingLabel(n: 'original' | 'suffix'): string {
  return n === 'suffix' ? '加后缀' : '保留原名';
}
function conflictLabel(c: 'overwrite' | 'skip' | 'rename'): string {
  return { overwrite: '覆盖', skip: '跳过', rename: '自动改名' }[c];
}
function estimateSeconds(n: number): number {
  return Math.max(1, Math.round(n * 0.4));
}

function resolveDefaultOutputDir(prefs: { tools_storage_path?: string; image_storage_path?: string }): string {
  const base = prefs.tools_storage_path || prefs.image_storage_path || '';
  if (!base) return '';
  const sep = base.includes('\\') ? '\\' : '/';
  return base.endsWith(sep) ? `${base}vec` : `${base}${sep}vec`;
}
