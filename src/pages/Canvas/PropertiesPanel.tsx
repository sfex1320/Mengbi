import { useEffect, useState } from 'react';
import { useCanvasStore, isPseudoPath } from '@/store/canvasStore';
import { toast } from '@/store/toastStore';
import { BLEND_MODE_LABEL, type BlendMode, defaultPerspective, ADJUST_PRESETS, ZERO_ADJUST } from './types';
import { alignToCanvas, alignToTarget, type AlignKind } from './canvasEngine/align';

/** 画布尺寸预设（常用比例 / 分辨率，均 ≤ 4096） */
const CANVAS_SIZE_PRESETS: Array<{ label: string; w: number; h: number }> = [
  { label: '1:1 · 1024', w: 1024, h: 1024 },
  { label: '1:1 · 2048', w: 2048, h: 2048 },
  { label: '3:4 · 1536', w: 1152, h: 1536 },
  { label: '4:3 · 1536', w: 1536, h: 1152 },
  { label: '2:3 · 1536', w: 1024, h: 1536 },
  { label: '3:2 · 1536', w: 1536, h: 1024 },
  { label: '9:16 · 1080', w: 1080, h: 1920 },
  { label: '16:9 · 1920', w: 1920, h: 1080 },
  { label: '16:9 · 4K', w: 3840, h: 2160 }
];

const FONT_OPTIONS: Array<{ label: string; value: string }> = [
  { label: 'Inter / 系统', value: "'Inter', system-ui, sans-serif" },
  { label: '黑体（无衬线）', value: "'Microsoft YaHei', 'PingFang SC', sans-serif" },
  { label: '宋体（衬线）', value: "'SimSun', 'Songti SC', serif" },
  { label: '楷体', value: "'KaiTi', 'Kaiti SC', serif" },
  { label: '等宽', value: "'JetBrains Mono', 'Consolas', monospace" },
  { label: 'Serif', value: "Georgia, 'Times New Roman', serif" }
];

interface PropertiesPanelProps {
  onEnterPerspective: () => void;
  onEnterCrop: () => void;
  onBgRemove: () => void;
  maxCanvasSize: number;
  maskMode: boolean;
  onMaskModeChange: (b: boolean) => void;
}

export function PropertiesPanel({
  onEnterPerspective,
  onEnterCrop,
  onBgRemove,
  maxCanvasSize,
  maskMode,
  onMaskModeChange
}: PropertiesPanelProps): JSX.Element {
  const project = useCanvasStore((s) => s.project);
  const update = useCanvasStore((s) => s.updateLayer);
  const flipH = useCanvasStore((s) => s.flipHorizontal);
  const flipV = useCanvasStore((s) => s.flipVertical);
  const bringFwd = useCanvasStore((s) => s.bringForward);
  const sendBwd = useCanvasStore((s) => s.sendBackward);
  const bringTop = useCanvasStore((s) => s.bringToFront);
  const sendBot = useCanvasStore((s) => s.sendToBack);
  const setCooked = useCanvasStore((s) => s.setCooked);
  const setPerspective = useCanvasStore((s) => s.setPerspective);
  const setCrop = useCanvasStore((s) => s.setCrop);
  const setProjectMeta = useCanvasStore((s) => s.setProjectMeta);
  const replaceLayerSource = useCanvasStore((s) => s.replaceLayerSource);
  const enableMask = useCanvasStore((s) => s.enableMask);
  const clearMask = useCanvasStore((s) => s.clearMask);

  const layer = project.layers.find((l) => l.id === project.selectedId) ?? null;

  if (!layer) {
    return (
      <div className="mb-canvas-props">
        <h3>画板</h3>
        <div className="mb-canvas-props-section">
          <p className="mb-canvas-props-section-title">尺寸</p>
          <CanvasSizeInput
            label="W"
            value={project.width}
            max={maxCanvasSize}
            onCommit={(n) => setProjectMeta({ width: n })}
          />
          <CanvasSizeInput
            label="H"
            value={project.height}
            max={maxCanvasSize}
            onCommit={(n) => setProjectMeta({ height: n })}
          />
          <p
            style={{
              fontSize: 'var(--mb-text-tiny)',
              color: 'var(--mb-text-muted)',
              margin: '4px 0 0',
              lineHeight: 1.4
            }}
          >
            上限 {maxCanvasSize} × {maxCanvasSize}（覆盖 4K + 主流绘图模型上限）
          </p>
          <p className="mb-canvas-props-section-title" style={{ marginTop: 8 }}>常用尺寸预设</p>
          <div className="mb-canvas-props-presetgrid">
            {CANVAS_SIZE_PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                className="mb-canvas-props-actionbtn"
                onClick={() => setProjectMeta({ width: p.w, height: p.h })}
                title={`${p.w} × ${p.h}`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <div className="mb-canvas-props-section">
          <p className="mb-canvas-props-section-title">背景</p>
          <div className="mb-canvas-props-row">
            <select
              className="mb-canvas-props-select"
              value={project.background}
              onChange={(e) => setProjectMeta({ background: e.target.value })}
            >
              <option value="transparent">透明</option>
              <option value="#ffffff">白</option>
              <option value="#000000">黑</option>
              <option value="#1c1c24">深灰</option>
            </select>
          </div>
        </div>
        <div className="mb-canvas-props-empty">
          选中一个图层，可在这里调整位置 / 缩放 / 旋转 / 混合 / 透视 / 裁切。
        </div>
      </div>
    );
  }

  const num = (n: number, dec = 0): string => {
    const m = Math.pow(10, dec);
    return (Math.round(n * m) / m).toString();
  };

  const isImage = !layer.isGroup && !layer.isText && !layer.isBrush && !layer.shapeKind;

  return (
    <div className="mb-canvas-props">
      <h3>{layer.name}</h3>

      {layer.isText && (
        <div className="mb-canvas-props-section">
          <p className="mb-canvas-props-section-title">文本</p>
          <textarea
            className="mb-canvas-props-input"
            value={layer.text ?? ''}
            onChange={(e) => update(layer.id, { text: e.target.value, name: e.target.value.slice(0, 20) || '文本' })}
            rows={3}
            style={{ width: '100%', fontFamily: 'inherit' }}
          />
          <div className="mb-canvas-props-row">
            <label>字体</label>
            <select
              className="mb-canvas-props-select"
              value={layer.fontFamily ?? "'Inter', system-ui, sans-serif"}
              onChange={(e) => update(layer.id, { fontFamily: e.target.value })}
            >
              {FONT_OPTIONS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>
          <div className="mb-canvas-props-row">
            <label>字号</label>
            <input
              type="number"
              className="mb-canvas-props-input"
              value={layer.fontSize ?? 32}
              min={6}
              max={500}
              onChange={(e) => update(layer.id, { fontSize: Math.max(6, Math.min(500, +e.target.value || 32)) })}
            />
          </div>
          <div className="mb-canvas-props-row">
            <label>颜色</label>
            <input
              type="text"
              className="mb-canvas-props-input"
              value={(layer.fillColor ?? '#ffffffff').toUpperCase()}
              onChange={(e) => update(layer.id, { fillColor: e.target.value })}
            />
          </div>
          <div className="mb-canvas-props-btnrow">
            <button
              type="button"
              className={`mb-canvas-props-actionbtn ${layer.fontWeight === 'bold' ? 'is-accent' : ''}`}
              onClick={() => update(layer.id, { fontWeight: layer.fontWeight === 'bold' ? 'normal' : 'bold' })}
            >
              <b>B</b>
            </button>
            <button
              type="button"
              className={`mb-canvas-props-actionbtn ${layer.fontStyle === 'italic' ? 'is-accent' : ''}`}
              onClick={() => update(layer.id, { fontStyle: layer.fontStyle === 'italic' ? 'normal' : 'italic' })}
            >
              <i>I</i>
            </button>
            <button
              type="button"
              className={`mb-canvas-props-actionbtn ${layer.textUnderline ? 'is-accent' : ''}`}
              onClick={() => update(layer.id, { textUnderline: !layer.textUnderline })}
              title="下划线"
            >
              <u>U</u>
            </button>
            <button
              type="button"
              className={`mb-canvas-props-actionbtn ${layer.align === 'left' ? 'is-accent' : ''}`}
              onClick={() => update(layer.id, { align: 'left' })}
            >
              ⫹
            </button>
            <button
              type="button"
              className={`mb-canvas-props-actionbtn ${layer.align === 'center' ? 'is-accent' : ''}`}
              onClick={() => update(layer.id, { align: 'center' })}
            >
              ≡
            </button>
            <button
              type="button"
              className={`mb-canvas-props-actionbtn ${layer.align === 'right' ? 'is-accent' : ''}`}
              onClick={() => update(layer.id, { align: 'right' })}
            >
              ⫸
            </button>
          </div>
          <div className="mb-canvas-props-row">
            <label>描边</label>
            <input
              type="text"
              className="mb-canvas-props-input"
              value={(layer.strokeColor ?? '').toUpperCase()}
              placeholder="留空=无"
              onChange={(e) => update(layer.id, { strokeColor: e.target.value })}
            />
            <input
              type="number"
              className="mb-canvas-props-input"
              style={{ maxWidth: 60 }}
              min={0}
              max={40}
              value={layer.strokeWidth ?? 0}
              onChange={(e) => update(layer.id, { strokeWidth: Math.max(0, +e.target.value || 0) })}
            />
          </div>
          <div className="mb-canvas-props-row">
            <label>阴影</label>
            <input
              type="text"
              className="mb-canvas-props-input"
              value={(layer.shadowColor ?? '').toUpperCase()}
              placeholder="留空=无"
              onChange={(e) => update(layer.id, { shadowColor: e.target.value })}
            />
            <input
              type="number"
              className="mb-canvas-props-input"
              style={{ maxWidth: 60 }}
              min={0}
              max={60}
              value={layer.shadowBlur ?? 0}
              title="模糊"
              onChange={(e) => update(layer.id, { shadowBlur: Math.max(0, +e.target.value || 0) })}
            />
          </div>
          {layer.shadowColor && (
            <div className="mb-canvas-props-row">
              <label>阴影偏移</label>
              <input
                type="number"
                className="mb-canvas-props-input"
                value={layer.shadowOffsetX ?? 0}
                title="X"
                onChange={(e) => update(layer.id, { shadowOffsetX: +e.target.value || 0 })}
              />
              <input
                type="number"
                className="mb-canvas-props-input"
                value={layer.shadowOffsetY ?? 0}
                title="Y"
                onChange={(e) => update(layer.id, { shadowOffsetY: +e.target.value || 0 })}
              />
            </div>
          )}
        </div>
      )}

      {layer.shapeKind && (
        <div className="mb-canvas-props-section">
          <p className="mb-canvas-props-section-title">形状（{layer.shapeKind === 'rect' ? '矩形' : '椭圆'}）</p>
          <div className="mb-canvas-props-row">
            <label>填充</label>
            <input
              type="text"
              className="mb-canvas-props-input"
              value={(layer.fillColor ?? '').toUpperCase()}
              onChange={(e) => update(layer.id, { fillColor: e.target.value })}
              placeholder="#fb923cff"
            />
          </div>
          <div className="mb-canvas-props-row">
            <label>描边</label>
            <input
              type="text"
              className="mb-canvas-props-input"
              value={(layer.strokeColor ?? '').toUpperCase()}
              onChange={(e) => update(layer.id, { strokeColor: e.target.value })}
              placeholder="留空 = 无描边"
            />
          </div>
          <div className="mb-canvas-props-row">
            <label>描边宽</label>
            <input
              type="number"
              className="mb-canvas-props-input"
              value={layer.strokeWidth ?? 0}
              min={0}
              max={100}
              onChange={(e) => update(layer.id, { strokeWidth: Math.max(0, +e.target.value || 0) })}
            />
          </div>
        </div>
      )}

      <div className="mb-canvas-props-section">
        <p className="mb-canvas-props-section-title">位置</p>
        <div className="mb-canvas-props-row">
          <label>X</label>
          <input
            type="number"
            className="mb-canvas-props-input"
            value={Math.round(layer.x)}
            onChange={(e) => update(layer.id, { x: +e.target.value || 0 })}
          />
          <label>Y</label>
          <input
            type="number"
            className="mb-canvas-props-input"
            value={Math.round(layer.y)}
            onChange={(e) => update(layer.id, { y: +e.target.value || 0 })}
          />
        </div>
        <AlignButtons />
      </div>

      <div className="mb-canvas-props-section">
        <p className="mb-canvas-props-section-title">缩放 / 旋转</p>
        <div className="mb-canvas-props-row">
          <label>SX</label>
          <input
            type="number"
            step="0.05"
            className="mb-canvas-props-input"
            value={num(layer.scaleX, 3)}
            onChange={(e) => update(layer.id, { scaleX: +e.target.value || 0.001 })}
          />
          <label>SY</label>
          <input
            type="number"
            step="0.05"
            className="mb-canvas-props-input"
            value={num(layer.scaleY, 3)}
            onChange={(e) => update(layer.id, { scaleY: +e.target.value || 0.001 })}
          />
        </div>
        <div className="mb-canvas-props-row">
          <label>角度</label>
          <input
            type="number"
            step="1"
            className="mb-canvas-props-input"
            value={num((layer.rotation * 180) / Math.PI, 1)}
            onChange={(e) =>
              update(layer.id, { rotation: ((+e.target.value || 0) * Math.PI) / 180 })
            }
          />
          <span style={{ color: 'var(--mb-text-muted)', fontSize: 'var(--mb-text-tiny)' }}>°</span>
        </div>
        <div className="mb-canvas-props-btnrow">
          <button
            type="button"
            className="mb-canvas-props-actionbtn"
            onClick={() => flipH(layer.id)}
          >
            ↔ 水平翻转
          </button>
          <button
            type="button"
            className="mb-canvas-props-actionbtn"
            onClick={() => flipV(layer.id)}
          >
            ↕ 垂直翻转
          </button>
        </div>
      </div>

      <div className="mb-canvas-props-section">
        <p className="mb-canvas-props-section-title">不透明度 + 混合模式</p>
        <div className="mb-canvas-props-row">
          <label style={{ minWidth: 56 }}>{Math.round(layer.opacity * 100)}%</label>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(layer.opacity * 100)}
            onChange={(e) => update(layer.id, { opacity: +e.target.value / 100 })}
            className="mb-canvas-props-slider"
          />
        </div>
        <div className="mb-canvas-props-row">
          <select
            className="mb-canvas-props-select"
            value={layer.blendMode}
            onChange={(e) => update(layer.id, { blendMode: e.target.value as BlendMode })}
          >
            {(Object.keys(BLEND_MODE_LABEL) as BlendMode[]).map((m) => (
              <option key={m} value={m}>
                {BLEND_MODE_LABEL[m]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mb-canvas-props-section">
        <p className="mb-canvas-props-section-title">层级</p>
        <div className="mb-canvas-props-btnrow">
          <button type="button" className="mb-canvas-props-actionbtn" onClick={() => bringFwd(layer.id)}>
            上移一层
          </button>
          <button type="button" className="mb-canvas-props-actionbtn" onClick={() => sendBwd(layer.id)}>
            下移一层
          </button>
          <button type="button" className="mb-canvas-props-actionbtn" onClick={() => bringTop(layer.id)}>
            移到顶层
          </button>
          <button type="button" className="mb-canvas-props-actionbtn" onClick={() => sendBot(layer.id)}>
            移到底层
          </button>
        </div>
      </div>

      <div className="mb-canvas-props-section">
        <p className="mb-canvas-props-section-title">变形</p>
        <div className="mb-canvas-props-btnrow">
          <button
            type="button"
            className="mb-canvas-props-actionbtn is-accent"
            onClick={() => {
              if (!layer.perspective) {
                setPerspective(layer.id, defaultPerspective(layer.width, layer.height));
              }
              onEnterPerspective();
            }}
            title="进入透视编辑"
          >
            ⊞ 透视
          </button>
          <button
            type="button"
            className="mb-canvas-props-actionbtn is-accent"
            onClick={() => {
              if (!layer.crop) {
                setCrop(layer.id, { x: 0, y: 0, width: layer.width, height: layer.height });
              }
              onEnterCrop();
            }}
            title="进入裁切编辑"
          >
            ✂ 裁切
          </button>
          {layer.perspective && (
            <button
              type="button"
              className="mb-canvas-props-actionbtn is-danger"
              onClick={() => {
                setPerspective(layer.id, null);
                setCooked(layer.id, null);
              }}
            >
              重置透视
            </button>
          )}
          {layer.crop && (
            <button
              type="button"
              className="mb-canvas-props-actionbtn is-danger"
              onClick={() => setCrop(layer.id, null)}
            >
              重置裁切
            </button>
          )}
        </div>
      </div>

      <div className="mb-canvas-props-section">
        <p className="mb-canvas-props-section-title">抠图</p>
        <div className="mb-canvas-props-btnrow">
          <button
            type="button"
            className="mb-canvas-props-actionbtn is-accent"
            onClick={onBgRemove}
          >
            抠除背景
          </button>
          {layer.cookedDataUri && (
            <button
              type="button"
              className="mb-canvas-props-actionbtn is-danger"
              onClick={() => {
                if (!layer.sourcePath || isPseudoPath(layer.sourcePath)) {
                  toast.error(
                    '无法恢复原图',
                    '此图层来自画板合成（抠图/导出/合并），没有可恢复的磁盘原图'
                  );
                  return;
                }
                setCooked(layer.id, null);
              }}
            >
              恢复原图
            </button>
          )}
        </div>
      </div>

      {isImage && (
        <div className="mb-canvas-props-section">
          <p className="mb-canvas-props-section-title">调整</p>
          <AdjSlider label="亮度" min={-100} max={100} value={Math.round((layer.adjBrightness ?? 0) * 100)} onChange={(v) => update(layer.id, { adjBrightness: v / 100 })} />
          <AdjSlider label="对比度" min={-100} max={100} value={Math.round((layer.adjContrast ?? 0) * 100)} onChange={(v) => update(layer.id, { adjContrast: v / 100 })} />
          <AdjSlider label="饱和度" min={-100} max={100} value={Math.round((layer.adjSaturation ?? 0) * 100)} onChange={(v) => update(layer.id, { adjSaturation: v / 100 })} />
          <AdjSlider label="色相" min={-180} max={180} value={Math.round(layer.adjHue ?? 0)} onChange={(v) => update(layer.id, { adjHue: v })} />
          <AdjSlider label="色温" min={-100} max={100} value={Math.round((layer.adjTemperature ?? 0) * 100)} onChange={(v) => update(layer.id, { adjTemperature: v / 100 })} />
          <AdjSlider label="曝光" min={-100} max={100} value={Math.round((layer.adjExposure ?? 0) * 100)} onChange={(v) => update(layer.id, { adjExposure: v / 100 })} />
          <AdjSlider label="锐化" min={0} max={100} value={Math.round((layer.adjSharpen ?? 0) * 100)} onChange={(v) => update(layer.id, { adjSharpen: v / 100 })} />
          <AdjSlider label="模糊" min={0} max={40} value={Math.round(layer.adjBlur ?? 0)} onChange={(v) => update(layer.id, { adjBlur: v })} suffix="px" />
          <AdjSlider label="降噪" min={0} max={100} value={Math.round((layer.adjDenoise ?? 0) * 100)} onChange={(v) => update(layer.id, { adjDenoise: v / 100 })} />
          <div className="mb-canvas-props-btnrow">
            <button
              type="button"
              className={`mb-canvas-props-actionbtn ${layer.adjGrayscale ? 'is-accent' : ''}`}
              onClick={() => update(layer.id, { adjGrayscale: !layer.adjGrayscale })}
            >
              黑白
            </button>
            <button
              type="button"
              className={`mb-canvas-props-actionbtn ${layer.adjInvert ? 'is-accent' : ''}`}
              onClick={() => update(layer.id, { adjInvert: !layer.adjInvert })}
            >
              反色
            </button>
            <button
              type="button"
              className="mb-canvas-props-actionbtn"
              onClick={() => update(layer.id, ZERO_ADJUST)}
            >
              重置全部
            </button>
          </div>
          <p className="mb-canvas-props-section-title" style={{ marginTop: 10 }}>调色预设</p>
          <div className="mb-canvas-props-btnrow">
            {ADJUST_PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                className="mb-canvas-props-actionbtn"
                onClick={() => update(layer.id, { ...ZERO_ADJUST, ...p.patch })}
                title={`套用「${p.label}」`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {isImage && (
      <div className="mb-canvas-props-section">
        <p className="mb-canvas-props-section-title">蒙版（非破坏性）</p>
        <div className="mb-canvas-props-btnrow">
          {!layer.maskStrokes ? (
            <button
              type="button"
              className="mb-canvas-props-actionbtn is-accent"
              onClick={() => {
                enableMask(layer.id);
                onMaskModeChange(true);
                toast.info('蒙版已添加', '切换到画笔工具开始涂抹');
              }}
            >
              ＋ 添加蒙版
            </button>
          ) : (
            <>
              <button
                type="button"
                className={`mb-canvas-props-actionbtn ${maskMode ? 'is-accent' : ''}`}
                onClick={() => onMaskModeChange(!maskMode)}
                title="进入 / 退出蒙版编辑模式"
              >
                {maskMode ? '退出蒙版' : '编辑蒙版'}
              </button>
              <button
                type="button"
                className="mb-canvas-props-actionbtn is-danger"
                onClick={() => {
                  clearMask(layer.id);
                  onMaskModeChange(false);
                }}
              >
                清除蒙版
              </button>
            </>
          )}
        </div>
        <p
          style={{
            fontSize: 'var(--mb-text-tiny)',
            color: 'var(--mb-text-muted)',
            margin: '4px 0 0',
            lineHeight: 1.4
          }}
        >
          蒙版模式下：画笔 = 隐藏，橡皮 = 还原。完成后点「退出蒙版」。
        </p>
      </div>
      )}

      {isImage && (
      <div className="mb-canvas-props-section">
        <p className="mb-canvas-props-section-title">来源</p>
        <div className="mb-canvas-props-btnrow">
          <button
            type="button"
            className="mb-canvas-props-actionbtn"
            onClick={async () => {
              const r = await window.electronAPI.storage.pickImages();
              if (!r.ok) {
                toast.error('打开文件失败', r.error.message);
                return;
              }
              const f = r.data.files[0];
              if (!f) return;
              const img = new Image();
              img.onload = () => {
                replaceLayerSource(layer.id, {
                  sourcePath: f.path,
                  cookedDataUri: null,
                  width: img.naturalWidth,
                  height: img.naturalHeight
                });
                toast.success('已替换图层来源', '透视 / 裁切 / 抠图已重置');
              };
              img.onerror = () => toast.error('图片加载失败');
              img.src = f.dataUri;
            }}
            title="保留 transform / 不透明度 / 混合模式，只换原图"
          >
            ↻ 替换来源
          </button>
        </div>
      </div>
      )}
    </div>
  );
}

function AdjSlider({
  label,
  min,
  max,
  value,
  onChange,
  suffix
}: {
  label: string;
  min: number;
  max: number;
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
}): JSX.Element {
  return (
    <div className="mb-canvas-props-row">
      <label style={{ minWidth: 56 }}>{label}</label>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(+e.target.value)}
        className="mb-canvas-props-slider"
      />
      <span style={{ minWidth: 38, textAlign: 'right', fontSize: 'var(--mb-text-tiny)', color: 'var(--mb-text-muted)' }}>
        {value}
        {suffix ?? ''}
      </span>
    </div>
  );
}

/**
 * 对齐按钮组：
 *   - 单选层 → 对齐到画板
 *   - 多选层 → 前 N-1 层对齐到 selectedIds 最后一层（target）
 */
function AlignButtons(): JSX.Element {
  const project = useCanvasStore((s) => s.project);
  const update = useCanvasStore((s) => s.updateLayer);
  const ids = project.selectedIds ?? (project.selectedId ? [project.selectedId] : []);
  const multi = ids.length >= 2;

  function doAlign(kind: AlignKind): void {
    if (ids.length === 0) return;
    if (!multi) {
      const layer = project.layers.find((l) => l.id === ids[0]);
      if (!layer) return;
      const next = alignToCanvas(
        layer,
        { width: project.width, height: project.height },
        kind
      );
      update(layer.id, next);
      return;
    }
    const target = project.layers.find((l) => l.id === ids[ids.length - 1]);
    if (!target) return;
    const others = project.layers.filter((l) => ids.includes(l.id));
    const moves = alignToTarget(others, target, kind);
    moves.forEach((p, id) => update(id, p));
  }

  const title = multi
    ? `对齐到最后选中的图层（${ids.length - 1} 个移动 → target）`
    : '对齐到画板';

  return (
    <div className="mb-canvas-props-align" title={title}>
      <button type="button" onClick={() => doAlign('left')} title="左对齐">⇤</button>
      <button type="button" onClick={() => doAlign('center-h')} title="水平居中">⇔</button>
      <button type="button" onClick={() => doAlign('right')} title="右对齐">⇥</button>
      <button type="button" onClick={() => doAlign('top')} title="顶对齐">⇧</button>
      <button type="button" onClick={() => doAlign('center-v')} title="垂直居中">⇕</button>
      <button type="button" onClick={() => doAlign('bottom')} title="底对齐">⇩</button>
    </div>
  );
}

/**
 * 画板尺寸输入：用 draft 字符串状态承接每次按键，blur / Enter 时才 clamp 并写回 store。
 * 解决"输入 1024 时被 64 卡住"的问题——中间不合法状态允许存在。
 */
function CanvasSizeInput({
  label,
  value,
  max,
  onCommit
}: {
  label: string;
  value: number;
  max: number;
  onCommit: (n: number) => void;
}): JSX.Element {
  const [draft, setDraft] = useState(String(value));

  // 外部 value 变化时同步 draft（撤销 / 重做 / 加载工程触发）
  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  function commit(): void {
    const raw = parseInt(draft, 10);
    if (!Number.isFinite(raw) || raw <= 0) {
      // 非法 → 还原到当前 store 值
      setDraft(String(value));
      return;
    }
    const clamped = Math.max(64, Math.min(max, raw));
    setDraft(String(clamped));
    if (clamped !== value) onCommit(clamped);
  }

  return (
    <div className="mb-canvas-props-row">
      <label>{label}</label>
      <input
        type="text"
        inputMode="numeric"
        className="mb-canvas-props-input"
        value={draft}
        onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ''))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setDraft(String(value));
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
    </div>
  );
}
