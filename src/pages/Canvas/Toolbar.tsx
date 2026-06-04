import { useRef, useState } from 'react';
import { useCanvasStore, makeLayerFromImage } from '@/store/canvasStore';
import { makeTextLayer, makeShapeLayer } from './types';
import { toast } from '@/store/toastStore';
import { ExportDialog } from './ExportDialog';
import { NewCanvasDialog } from './NewCanvasDialog';
import { PhotoshopBar } from './PhotoshopBar';
import { exportProjectAsMengbi, parseMengbiFile, applyInpaintMaskFromDataUri } from './canvasEngine/projectFile';
import { useImageParamsStore } from '@/store/imageParamsStore';
import {
  PlusIcon,
  TrashIcon,
  ImageIcon,
  CopyIconShape,
  SendIcon
} from '@/components/Icon';

type Tool = 'select' | 'hand' | 'brush' | 'eraser' | 'mask';

interface ToolbarProps {
  tool: Tool;
  onToolChange: (t: Tool) => void;
  mode: 'normal' | 'perspective' | 'crop';
  onModeChange: (m: 'normal' | 'perspective' | 'crop') => void;
  onBgRemove: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onOutpaint: () => void;
  onAIPanel: () => void;
  onHistory: () => void;
  onReferences: () => void;
  borderOutpaint: boolean;
  onToggleBorderOutpaint: () => void;
  maxCanvasSize: number;
}

export function Toolbar(props: ToolbarProps): JSX.Element {
  const project = useCanvasStore((s) => s.project);
  const addLayer = useCanvasStore((s) => s.addLayer);
  const duplicateLayer = useCanvasStore((s) => s.duplicateLayer);
  const removeLayer = useCanvasStore((s) => s.removeLayer);
  const loadProject = useCanvasStore((s) => s.loadProject);
  const updateLayer = useCanvasStore((s) => s.updateLayer);
  const flipHorizontal = useCanvasStore((s) => s.flipHorizontal);
  const flipVertical = useCanvasStore((s) => s.flipVertical);
  const [exportOpen, setExportOpen] = useState(false);
  const [newCanvasOpen, setNewCanvasOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selected = project.layers.find((l) => l.id === project.selectedId) ?? null;

  function addTextLayer(): void {
    const text = window.prompt('输入文本内容', '文字') ?? '';
    if (!text.trim()) return;
    const layer = makeTextLayer({
      text: text.trim(),
      x: project.width / 2 - 100,
      y: project.height / 2 - 16
    });
    addLayer(layer);
  }

  function addShapeLayer(kind: 'rect' | 'ellipse'): void {
    const w = Math.min(project.width * 0.4, 320);
    const h = kind === 'rect' ? Math.min(project.height * 0.3, 200) : Math.min(project.height * 0.4, 320);
    const layer = makeShapeLayer({
      kind,
      x: (project.width - w) / 2,
      y: (project.height - h) / 2,
      width: w,
      height: h
    });
    addLayer(layer);
  }

  async function handleSaveAs(): Promise<void> {
    try {
      const blob = await exportProjectAsMengbi(project);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${project.name || 'canvas'}.mengbi-canvas`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // 工程文件内嵌全部图层 dataURI，体积可观；延后吊销避免大文件下载被提前中断
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      toast.success('已保存工程文件');
    } catch (e) {
      toast.error('保存失败', String(e));
    }
  }

  async function handleOpenFile(file: File): Promise<void> {
    try {
      const text = await file.text();
      const { project, inpaintMask, references } = parseMengbiFile(text);
      loadProject(project);
      // 还原局部重绘蒙版
      if (inpaintMask) {
        applyInpaintMaskFromDataUri(inpaintMask, project.width, project.height);
      }
      // 还原参考图
      const refStore = useImageParamsStore.getState();
      refStore.clearRefs();
      if (references.length > 0) refStore.addRefs(references);
      toast.success('已打开工程文件', file.name);
    } catch (e) {
      toast.error('打开失败', String(e));
    }
  }

  async function handleAddImage(): Promise<void> {
    const r = await window.electronAPI.storage.pickImages();
    if (!r.ok) {
      toast.error('打开文件失败', r.error.message);
      return;
    }
    if (r.data.files.length === 0) return;
    for (const f of r.data.files) {
      try {
        const img = await loadImage(f.dataUri);
        const layer = makeLayerFromImage({
          name: layerNameFromPath(f.path),
          sourcePath: f.path,
          width: img.naturalWidth,
          height: img.naturalHeight,
          canvasWidth: project.width,
          canvasHeight: project.height
        });
        addLayer(layer);
      } catch (e) {
        toast.error('图片加载失败', String(e));
      }
    }
  }

  function rotate90(dir: 1 | -1): void {
    if (!selected) return;
    updateLayer(selected.id, { rotation: selected.rotation + (dir * Math.PI) / 2 });
  }

  return (
    <div className="mb-canvas-toolbar">
      <div className="mb-canvas-toolbar-group">
        <button
          type="button"
          className="mb-canvas-toolbar-btn is-primary"
          onClick={handleAddImage}
          title="添加图片"
        >
          <PlusIcon size={14} /> 图片
        </button>
        <button
          type="button"
          className="mb-canvas-toolbar-btn"
          onClick={addTextLayer}
          title="添加文本图层"
        >
          T 文本
        </button>
        <button
          type="button"
          className="mb-canvas-toolbar-btn"
          onClick={() => addShapeLayer('rect')}
          title="添加矩形"
        >
          ▭ 矩形
        </button>
        <button
          type="button"
          className="mb-canvas-toolbar-btn"
          onClick={() => addShapeLayer('ellipse')}
          title="添加椭圆"
        >
          ⬭ 椭圆
        </button>
      </div>

      <div className="mb-canvas-toolbar-group">
        <button
          type="button"
          className="mb-canvas-toolbar-btn"
          onClick={() => setNewCanvasOpen(true)}
          title="新建一张空白画布"
        >
          🆕 新建画布
        </button>
        <button
          type="button"
          className="mb-canvas-toolbar-btn"
          onClick={() => fileInputRef.current?.click()}
          title="打开 .mengbi-canvas 工程文件"
        >
          📂 打开
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".mengbi-canvas,.json,application/json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleOpenFile(f);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          className="mb-canvas-toolbar-btn"
          onClick={handleSaveAs}
          title="另存为 .mengbi-canvas（含所有图片，可跨电脑迁移）"
        >
          💾 保存
        </button>
      </div>

      <div className="mb-canvas-toolbar-group">
        <button
          type="button"
          className={`mb-canvas-toolbar-btn ${props.tool === 'select' ? 'is-active' : ''}`}
          onClick={() => props.onToolChange('select')}
          title="选择工具（V）：移动 / 缩放 / 旋转图层"
        >
          ↖ 选择
        </button>
        <button
          type="button"
          className={`mb-canvas-toolbar-btn ${props.tool === 'hand' ? 'is-active' : ''}`}
          onClick={() => props.onToolChange('hand')}
          title="抓手（H，按住 Space 临时切换）：拖动画布"
        >
          ✋ 抓手
        </button>
        <button
          type="button"
          className={`mb-canvas-toolbar-btn ${props.tool === 'brush' ? 'is-active' : ''}`}
          onClick={() => props.onToolChange('brush')}
          title="画笔（B）：在笔刷图层上绘制"
        >
          ✎ 画笔
        </button>
        <button
          type="button"
          className={`mb-canvas-toolbar-btn ${props.tool === 'eraser' ? 'is-active' : ''}`}
          onClick={() => props.onToolChange('eraser')}
          title="橡皮（E）：擦除当前选中图层的内容（非破坏性）"
        >
          ⌫ 橡皮
        </button>
        <button
          type="button"
          className={`mb-canvas-toolbar-btn ${props.tool === 'mask' ? 'is-active' : ''}`}
          onClick={() => props.onToolChange('mask')}
          title="蒙版（M）：涂抹局部重绘区域 / 选区"
        >
          ◐ 蒙版
        </button>
      </div>

      <div className="mb-canvas-toolbar-group">
        <button
          type="button"
          className="mb-canvas-toolbar-btn"
          onClick={props.onUndo}
          disabled={!props.canUndo}
          title="撤销（Ctrl+Z）"
        >
          ↶ 撤销
        </button>
        <button
          type="button"
          className="mb-canvas-toolbar-btn"
          onClick={props.onRedo}
          disabled={!props.canRedo}
          title="重做（Ctrl+Shift+Z）"
        >
          ↷ 重做
        </button>
        <button
          type="button"
          className="mb-canvas-toolbar-btn"
          onClick={props.onHistory}
          title="历史快照"
        >
          🕘 历史
        </button>
      </div>

      <div className="mb-canvas-toolbar-group">
        <button
          type="button"
          className={`mb-canvas-toolbar-btn ${props.mode === 'perspective' ? 'is-active' : ''}`}
          disabled={!selected}
          onClick={() => props.onModeChange(props.mode === 'perspective' ? 'normal' : 'perspective')}
          title="透视扭曲"
        >
          ⊞ 透视
        </button>
        <button
          type="button"
          className={`mb-canvas-toolbar-btn ${props.mode === 'crop' ? 'is-active' : ''}`}
          disabled={!selected}
          onClick={() => props.onModeChange(props.mode === 'crop' ? 'normal' : 'crop')}
          title="裁切"
        >
          ✂ 裁切
        </button>
        <button
          type="button"
          className="mb-canvas-toolbar-btn"
          disabled={!selected}
          onClick={props.onBgRemove}
          title="抠除背景"
        >
          <ImageIcon size={14} /> 抠图
        </button>
        <button
          type="button"
          className="mb-canvas-toolbar-btn"
          disabled={!selected}
          onClick={() => rotate90(-1)}
          title="逆时针旋转 90°"
        >
          ↺ 90°
        </button>
        <button
          type="button"
          className="mb-canvas-toolbar-btn"
          disabled={!selected}
          onClick={() => rotate90(1)}
          title="顺时针旋转 90°"
        >
          ↻ 90°
        </button>
        <button
          type="button"
          className="mb-canvas-toolbar-btn"
          disabled={!selected}
          onClick={() => selected && flipHorizontal(selected.id)}
          title="水平翻转"
        >
          ↔ 翻转
        </button>
        <button
          type="button"
          className="mb-canvas-toolbar-btn"
          disabled={!selected}
          onClick={() => selected && flipVertical(selected.id)}
          title="垂直翻转"
        >
          ↕ 翻转
        </button>
        <button
          type="button"
          className="mb-canvas-toolbar-btn is-accent"
          onClick={props.onOutpaint}
          title="AI 扩图：扩展画布并自动生成扩图蒙版"
        >
          ⤢ 扩图
        </button>
        <button
          type="button"
          className={`mb-canvas-toolbar-btn ${props.borderOutpaint ? 'is-active' : ''}`}
          onClick={props.onToggleBorderOutpaint}
          title="拖动画布边界扩图"
        >
          ⇲ 拖边扩图
        </button>
        <button
          type="button"
          className="mb-canvas-toolbar-btn"
          onClick={props.onReferences}
          title="参考图管理（8 类型 / 权重 / 启用）"
        >
          🖻 参考图
        </button>
        <button
          type="button"
          className="mb-canvas-toolbar-btn is-primary"
          onClick={props.onAIPanel}
          title="AI 功能（图生图 / 局部重绘 / 扩图 / 放大 / 去背景 …）"
        >
          ✦ AI
        </button>
        <button
          type="button"
          className="mb-canvas-toolbar-btn"
          disabled={!selected}
          onClick={() => selected && duplicateLayer(selected.id)}
          title="复制图层（Ctrl+J）"
        >
          <CopyIconShape size={14} /> 复制
        </button>
        <button
          type="button"
          className="mb-canvas-toolbar-btn"
          disabled={!selected}
          onClick={() => selected && removeLayer(selected.id)}
          title="删除图层（Delete）"
        >
          <TrashIcon size={14} /> 删除
        </button>
      </div>

      <div className="mb-canvas-toolbar-group">
        <button
          type="button"
          className="mb-canvas-toolbar-btn is-primary"
          onClick={() => setExportOpen(true)}
          title="导出 PNG / JPG / WebP（→ 磁盘 / 生图页）"
        >
          <SendIcon size={14} /> 导出
        </button>
      </div>

      <PhotoshopBar />

      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} />
      {newCanvasOpen && <NewCanvasDialog onClose={() => setNewCanvasOpen(false)} />}
    </div>
  );
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image load failed'));
    img.src = src;
  });
}

function layerNameFromPath(p: string): string {
  const base = p.replace(/\\/g, '/').split('/').pop() ?? '图层';
  return base.replace(/\.[^.]+$/, '').slice(0, 30);
}
