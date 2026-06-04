import { useState } from 'react';
import { useCanvasStore } from '@/store/canvasStore';
import { useInpaintMaskStore } from '@/store/inpaintMaskStore';
import {
  maskToBlackWhitePng,
  blackWhitePngToMask,
  maskHasCoverage
} from './canvasEngine/maskEngine';
import { blobToDataUri } from './canvasEngine/exportPNG';
import { InpaintDialog } from './InpaintDialog';
import { toast } from '@/store/toastStore';

/**
 * 局部重绘蒙版面板（左侧工具切到「蒙版」时显示在右侧）。
 *
 * 规则：白色 = 需要 AI 处理；黑色 = 保持不变（导出黑白 PNG 时按此渲染）。
 */
export function MaskPanel(): JSX.Element {
  const project = useCanvasStore((s) => s.project);
  const canvas = useInpaintMaskStore((s) => s.canvas);
  const eraseMode = useInpaintMaskStore((s) => s.eraseMode);
  const shapeMode = useInpaintMaskStore((s) => s.shapeMode);
  const setShapeMode = useInpaintMaskStore((s) => s.setShapeMode);
  const visible = useInpaintMaskStore((s) => s.visible);
  const color = useInpaintMaskStore((s) => s.color);
  const brushSize = useInpaintMaskStore((s) => s.brushSize);
  const hardness = useInpaintMaskStore((s) => s.hardness);
  const brushOpacity = useInpaintMaskStore((s) => s.brushOpacity);
  const maskOpacity = useInpaintMaskStore((s) => s.maskOpacity);

  const setEraseMode = useInpaintMaskStore((s) => s.setEraseMode);
  const setVisible = useInpaintMaskStore((s) => s.setVisible);
  const setColor = useInpaintMaskStore((s) => s.setColor);
  const setBrushSize = useInpaintMaskStore((s) => s.setBrushSize);
  const setHardness = useInpaintMaskStore((s) => s.setHardness);
  const setBrushOpacity = useInpaintMaskStore((s) => s.setBrushOpacity);
  const setMaskOpacity = useInpaintMaskStore((s) => s.setMaskOpacity);
  const clear = useInpaintMaskStore((s) => s.clear);
  const fill = useInpaintMaskStore((s) => s.fill);
  const invert = useInpaintMaskStore((s) => s.invert);
  const feather = useInpaintMaskStore((s) => s.feather);
  const expand = useInpaintMaskStore((s) => s.expand);
  const contract = useInpaintMaskStore((s) => s.contract);
  const ensureSize = useInpaintMaskStore((s) => s.ensureSize);
  const replaceCanvas = useInpaintMaskStore((s) => s.replaceCanvas);

  const [radius, setRadius] = useState(8);
  const [importInvert, setImportInvert] = useState(false);
  const [inpaintOpen, setInpaintOpen] = useState(false);

  async function handleExport(): Promise<void> {
    if (!canvas || !maskHasCoverage(canvas)) {
      toast.info('蒙版为空', '先涂抹要 AI 处理的区域');
      return;
    }
    try {
      const blob = await maskToBlackWhitePng(canvas, { threshold: false });
      const dataUri = await blobToDataUri(blob);
      const r = await window.electronAPI.storage.saveAs({
        dataUri,
        defaultName: `${project.name || 'mask'}-mask.png`,
        filters: [{ name: 'PNG', extensions: ['png'] }]
      });
      if (r.ok && r.data) toast.success('已导出黑白蒙版', '白 = AI 处理区');
    } catch (e) {
      toast.error('导出失败', String(e));
    }
  }

  async function handleImport(): Promise<void> {
    const r = await window.electronAPI.storage.pickImages();
    if (!r.ok) {
      toast.error('打开文件失败', r.error.message);
      return;
    }
    const f = r.data.files[0];
    if (!f) return;
    try {
      const img = await loadImage(f.dataUri);
      const next = await blackWhitePngToMask(img, project.width, project.height, color, {
        invert: importInvert
      });
      replaceCanvas(next);
      toast.success('已导入蒙版', importInvert ? '已按相反规则解释' : '白 = AI 处理区');
    } catch (e) {
      toast.error('图片加载失败', String(e));
    }
  }

  function ensure(): void {
    ensureSize(project.width, project.height);
  }

  return (
    <div className="mb-canvas-props">
      <h3>局部重绘蒙版</h3>
      <p className="mb-mask-rule">白色 = AI 处理区，黑色 = 保持不变</p>

      <button
        type="button"
        className="mb-canvas-props-actionbtn is-accent"
        style={{ width: '100%', marginBottom: 10 }}
        onClick={() => setInpaintOpen(true)}
      >
        ✦ 用蒙版做局部重绘
      </button>
      {inpaintOpen && <InpaintDialog onClose={() => setInpaintOpen(false)} />}

      <div className="mb-canvas-props-section">
        <p className="mb-canvas-props-section-title">笔触</p>
        <div className="mb-canvas-props-btnrow">
          <button
            type="button"
            className={`mb-canvas-props-actionbtn ${!eraseMode ? 'is-accent' : ''}`}
            onClick={() => setEraseMode(false)}
          >
            ✎ 涂抹
          </button>
          <button
            type="button"
            className={`mb-canvas-props-actionbtn ${eraseMode ? 'is-accent' : ''}`}
            onClick={() => setEraseMode(true)}
          >
            ⌫ 擦除
          </button>
        </div>
        <p className="mb-canvas-props-section-title" style={{ marginTop: 8 }}>选区形状</p>
        <div className="mb-canvas-props-btnrow">
          {([
            ['brush', '自由画笔'],
            ['rect', '矩形'],
            ['ellipse', '椭圆'],
            ['lasso', '套索']
          ] as const).map(([m, label]) => (
            <button
              key={m}
              type="button"
              className={`mb-canvas-props-actionbtn ${shapeMode === m ? 'is-accent' : ''}`}
              onClick={() => setShapeMode(m)}
            >
              {label}
            </button>
          ))}
        </div>
        <Slider label="大小" value={brushSize} min={1} max={400} onChange={setBrushSize} suffix="px" />
        <Slider
          label="硬度"
          value={Math.round(hardness * 100)}
          min={0}
          max={100}
          onChange={(v) => setHardness(v / 100)}
          suffix="%"
        />
        <Slider
          label="浓度"
          value={Math.round(brushOpacity * 100)}
          min={5}
          max={100}
          onChange={(v) => setBrushOpacity(v / 100)}
          suffix="%"
        />
      </div>

      <div className="mb-canvas-props-section">
        <p className="mb-canvas-props-section-title">显示</p>
        <div className="mb-canvas-props-row">
          <label>颜色</label>
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="mb-mask-color"
          />
          <button
            type="button"
            className={`mb-canvas-props-actionbtn ${visible ? 'is-accent' : ''}`}
            onClick={() => setVisible(!visible)}
          >
            {visible ? '隐藏蒙版' : '显示蒙版'}
          </button>
        </div>
        <Slider
          label="叠加透明度"
          value={Math.round(maskOpacity * 100)}
          min={10}
          max={100}
          onChange={(v) => setMaskOpacity(v / 100)}
          suffix="%"
        />
      </div>

      <div className="mb-canvas-props-section">
        <p className="mb-canvas-props-section-title">蒙版操作</p>
        <div className="mb-canvas-props-btnrow">
          <button type="button" className="mb-canvas-props-actionbtn" onClick={() => { ensure(); fill(); }}>
            填充
          </button>
          <button type="button" className="mb-canvas-props-actionbtn" onClick={() => { ensure(); invert(); }}>
            反选
          </button>
          <button type="button" className="mb-canvas-props-actionbtn is-danger" onClick={clear}>
            清空
          </button>
        </div>
        <Slider label="半径/像素" value={radius} min={1} max={80} onChange={setRadius} suffix="px" />
        <div className="mb-canvas-props-btnrow">
          <button type="button" className="mb-canvas-props-actionbtn" onClick={() => { ensure(); feather(radius); }}>
            羽化
          </button>
          <button type="button" className="mb-canvas-props-actionbtn" onClick={() => { ensure(); feather(radius * 2); }}>
            模糊边缘
          </button>
          <button type="button" className="mb-canvas-props-actionbtn" onClick={() => { ensure(); expand(radius); }}>
            扩展
          </button>
          <button type="button" className="mb-canvas-props-actionbtn" onClick={() => { ensure(); contract(radius); }}>
            收缩
          </button>
        </div>
      </div>

      <div className="mb-canvas-props-section">
        <p className="mb-canvas-props-section-title">导入 / 导出</p>
        <div className="mb-canvas-props-btnrow">
          <button type="button" className="mb-canvas-props-actionbtn is-accent" onClick={handleExport}>
            导出黑白 PNG
          </button>
          <button type="button" className="mb-canvas-props-actionbtn" onClick={handleImport}>
            导入 PNG 为蒙版
          </button>
        </div>
        <label className="mb-ps-checkrow" style={{ fontSize: 'var(--mb-text-tiny)', marginTop: 6 }}>
          <input
            type="checkbox"
            checked={importInvert}
            onChange={(e) => setImportInvert(e.target.checked)}
          />
          导入时按相反规则（黑 = AI 区）解释
        </label>
      </div>

      <p className="mb-mask-hint">
        在画布上涂抹要重绘的区域；完成后在「局部重绘」里直接提交，或导出黑白蒙版给外部模型。
      </p>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  onChange,
  suffix
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  suffix?: string;
}): JSX.Element {
  return (
    <div className="mb-canvas-props-row">
      <label style={{ minWidth: 64 }}>{label}</label>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(+e.target.value)}
        className="mb-canvas-props-slider"
      />
      <span style={{ minWidth: 42, textAlign: 'right', fontSize: 'var(--mb-text-tiny)' }}>
        {value}
        {suffix ?? ''}
      </span>
    </div>
  );
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error('image load failed'));
    im.src = src;
  });
}
