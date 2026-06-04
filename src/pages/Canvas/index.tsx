import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useCanvasStore, makeLayerFromImage } from '@/store/canvasStore';
import type { CanvasProject, Layer } from './types';
import type { SnapGuide } from './canvasEngine/snap';
import { Toolbar } from './Toolbar';
import { LayerPanel } from './LayerPanel';
import { CanvasStage } from './CanvasStage';
import { PropertiesPanel } from './PropertiesPanel';
import { BgRemoveDialog } from './BgRemoveDialog';
import { StatusBar } from './StatusBar';
import { Rulers } from './Rulers';
import { BrushPanel } from './BrushPanel';
import { MaskPanel } from './MaskPanel';
import { OutpaintDialog } from './OutpaintDialog';
import { AIActionPanel } from './AIActionPanel';
import { HistoryPanel } from './HistoryPanel';
import { ReferencePanel } from './ReferencePanel';
import { OutpaintHandles } from './OutpaintHandles';
import { openLayerContextMenu, openCanvasContextMenu, type CanvasMenuHandlers } from './contextMenu';
import { useBrushStore } from '@/store/brushStore';
import { useInpaintMaskStore } from '@/store/inpaintMaskStore';
import { toast } from '@/store/toastStore';
import './Canvas.css';

type StageMode = 'normal' | 'perspective' | 'crop';
type Tool = 'select' | 'hand' | 'brush' | 'eraser' | 'mask';

const HISTORY_LIMIT = 30;
const MAX_CANVAS_SIZE = 4096;
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 16;

export default function CanvasPage(): JSX.Element {
  const project = useCanvasStore((s) => s.project);
  const loadProject = useCanvasStore((s) => s.loadProject);
  const addLayer = useCanvasStore((s) => s.addLayer);
  const updateLayer = useCanvasStore((s) => s.updateLayer);
  const duplicateLayer = useCanvasStore((s) => s.duplicateLayer);
  const removeLayer = useCanvasStore((s) => s.removeLayer);
  const removeLayers = useCanvasStore((s) => s.removeLayers);
  const setProjectMeta = useCanvasStore((s) => s.setProjectMeta);
  const selectAllLayers = useCanvasStore((s) => s.selectAllLayers);
  const groupSelected = useCanvasStore((s) => s.groupSelectedLayers);
  const selectLayer = useCanvasStore((s) => s.selectLayer);

  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [tool, setTool] = useState<Tool>('select');
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [mode, setMode] = useState<StageMode>('normal');
  const [bgOpen, setBgOpen] = useState(false);
  const [outpaintOpen, setOutpaintOpen] = useState(false);
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [refOpen, setRefOpen] = useState(false);
  const [borderOutpaint, setBorderOutpaint] = useState(false);
  const [lockToSelected, setLockToSelected] = useState(false);
  const [snapGuides, setSnapGuides] = useState<SnapGuide[]>([]);
  const [cursorCoord, setCursorCoord] = useState<{ x: number; y: number } | null>(null);
  const [maskMode, setMaskMode] = useState(false);
  const [cursorScreen, setCursorScreen] = useState<{ x: number; y: number } | null>(null);
  const setBrushSize = useBrushStore((s) => s.setSize);
  const brushSize = useBrushStore((s) => s.size);
  const brushColor = useBrushStore((s) => s.color);
  const maskBrushSize = useInpaintMaskStore((s) => s.brushSize);
  const maskColor = useInpaintMaskStore((s) => s.color);
  const maskEraseMode = useInpaintMaskStore((s) => s.eraseMode);
  const setMaskActive = useInpaintMaskStore((s) => s.setActive);

  // 撤销 / 重做：栈里存 project 引用本身（zustand 每次 set 都新建 project，引用即快照）。
  // 不再每次变更都 JSON.stringify —— 那是个隐藏的"卡顿源"，在大工程上每帧 50-200ms。
  // 防抖 350ms：连续滑块拖动 / 多次方向键合并为一步撤销。
  const undoRef = useRef<CanvasProject[]>([]);
  const redoRef = useRef<CanvasProject[]>([]);
  const lastCommittedRef = useRef<CanvasProject>(project);
  const skipNextSnapshotRef = useRef(false);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [, setHistoryTick] = useState(0);

  useEffect(() => {
    if (project === lastCommittedRef.current) return;
    if (skipNextSnapshotRef.current) {
      skipNextSnapshotRef.current = false;
      lastCommittedRef.current = project;
      return;
    }
    // 推入"上次提交的"为撤销点（关键：lastCommittedRef 是 batch 之前的状态，
    // 多次 useEffect 触发 → debounce 累计 → 只把最早的 prev 提交一次）
    const prev = lastCommittedRef.current;
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      const cur = useCanvasStore.getState().project;
      if (cur === prev) return;
      undoRef.current.push(prev);
      if (undoRef.current.length > HISTORY_LIMIT) undoRef.current.shift();
      redoRef.current = [];
      lastCommittedRef.current = cur;
      setHistoryTick((t) => t + 1);
    }, 350);
  }, [project]);

  const canUndo = undoRef.current.length > 0;
  const canRedo = redoRef.current.length > 0;

  function doUndo(): void {
    // 立即冲刷待提交的 debounce，避免半提交状态
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
      const cur = useCanvasStore.getState().project;
      if (cur !== lastCommittedRef.current) {
        undoRef.current.push(lastCommittedRef.current);
        if (undoRef.current.length > HISTORY_LIMIT) undoRef.current.shift();
        lastCommittedRef.current = cur;
      }
    }
    const prev = undoRef.current.pop();
    if (!prev) return;
    redoRef.current.push(useCanvasStore.getState().project);
    skipNextSnapshotRef.current = true;
    loadProject(prev);
    lastCommittedRef.current = prev;
    setHistoryTick((t) => t + 1);
  }
  function doRedo(): void {
    const next = redoRef.current.pop();
    if (!next) return;
    undoRef.current.push(useCanvasStore.getState().project);
    skipNextSnapshotRef.current = true;
    loadProject(next);
    lastCommittedRef.current = next;
    setHistoryTick((t) => t + 1);
  }

  // 同步「蒙版工具是否激活」到 inpaint 蒙版 store
  useEffect(() => {
    setMaskActive(tool === 'mask');
  }, [tool, setMaskActive]);

  const viewportRef = useRef<HTMLDivElement>(null);

  // ─── 缩放 / 平移 ───
  function fitToScreen(): void {
    const v = viewportRef.current;
    if (!v) return;
    const rect = v.getBoundingClientRect();
    const padding = 40;
    const fx = (rect.width - padding) / project.width;
    const fy = (rect.height - padding) / project.height;
    const z = Math.min(fx, fy, 4);
    const newZoom = Math.max(MIN_ZOOM, z);
    setZoom(newZoom);
    setPanX((rect.width - project.width * newZoom) / 2);
    setPanY((rect.height - project.height * newZoom) / 2);
  }

  function zoomTo100(): void {
    const v = viewportRef.current;
    if (!v) return;
    const rect = v.getBoundingClientRect();
    setZoom(1);
    setPanX((rect.width - project.width) / 2);
    setPanY((rect.height - project.height) / 2);
  }

  /** 围绕一个屏幕坐标（相对 viewport）变焦 */
  function zoomAt(newZoom: number, anchorX: number, anchorY: number): void {
    const z = clamp(newZoom, MIN_ZOOM, MAX_ZOOM);
    const sx = (anchorX - panX) / zoom;
    const sy = (anchorY - panY) / zoom;
    setZoom(z);
    setPanX(anchorX - sx * z);
    setPanY(anchorY - sy * z);
  }

  function zoomAtViewportCenter(newZoom: number): void {
    const v = viewportRef.current;
    if (!v) return;
    const rect = v.getBoundingClientRect();
    zoomAt(newZoom, rect.width / 2, rect.height / 2);
  }

  // 第一次挂载和画板尺寸变化时，自动 fit 一下
  useLayoutEffect(() => {
    const t = window.setTimeout(fitToScreen, 50);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.width, project.height]);

  // 滚轮缩放（以光标为锚点）
  useEffect(() => {
    const v = viewportRef.current;
    if (!v) return;
    function onWheel(e: WheelEvent): void {
      if (!viewportRef.current) return;
      e.preventDefault();
      const rect = viewportRef.current.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      zoomAt(zoom * factor, cx, cy);
    }
    v.addEventListener('wheel', onWheel, { passive: false });
    return () => v.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, panX, panY]);

  // 平移：抓手模式 / Space 持有 / 鼠标中键
  const panRef = useRef<{ x0: number; y0: number; panX0: number; panY0: number } | null>(null);
  function viewportMouseDown(e: React.MouseEvent): void {
    const handMode = tool === 'hand' || spaceHeld;
    const isMiddle = e.button === 1;
    if (!handMode && !isMiddle) return;
    e.preventDefault();
    panRef.current = { x0: e.clientX, y0: e.clientY, panX0: panX, panY0: panY };
  }
  useEffect(() => {
    function onMove(e: MouseEvent): void {
      if (!panRef.current) return;
      const dx = e.clientX - panRef.current.x0;
      const dy = e.clientY - panRef.current.y0;
      setPanX(panRef.current.panX0 + dx);
      setPanY(panRef.current.panY0 + dy);
    }
    function onUp(): void {
      panRef.current = null;
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, []);

  // 鼠标坐标跟踪（在 viewport 上）
  function viewportMouseMove(e: React.MouseEvent): void {
    if (!viewportRef.current) return;
    const rect = viewportRef.current.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    setCursorCoord({ x: (cx - panX) / zoom, y: (cy - panY) / zoom });
    setCursorScreen({ x: cx, y: cy });
  }
  function viewportMouseLeave(): void {
    setCursorCoord(null);
    setCursorScreen(null);
  }

  // ─── 键盘 ───
  // 用 ref 保存最新值，避免 keydown 闭包过期
  const stateRef = useRef({ project, zoom, panX, panY, tool, spaceHeld });
  stateRef.current = { project, zoom, panX, panY, tool, spaceHeld };

  useEffect(() => {
    function isInTextField(t: EventTarget | null): boolean {
      const el = t as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
    }

    function onKeyDown(e: KeyboardEvent): void {
      const inField = isInTextField(e.target);
      const ctrl = e.ctrlKey || e.metaKey;

      // Space 长按 = 抓手
      if (e.code === 'Space' && !inField && !e.repeat) {
        e.preventDefault();
        setSpaceHeld(true);
        return;
      }

      if (inField) return;

      // Ctrl+Z / Ctrl+Shift+Z
      if (ctrl && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) doRedo();
        else doUndo();
        return;
      }

      // Ctrl+0 = 100%
      if (ctrl && e.key === '0') {
        e.preventDefault();
        zoomTo100();
        return;
      }

      // Ctrl+= / Ctrl++ = 放大
      if (ctrl && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        zoomAtViewportCenter(stateRef.current.zoom * 1.2);
        return;
      }
      // Ctrl+- = 缩小
      if (ctrl && e.key === '-') {
        e.preventDefault();
        zoomAtViewportCenter(stateRef.current.zoom / 1.2);
        return;
      }

      // Z = 适合屏幕
      if (!ctrl && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        fitToScreen();
        return;
      }

      // Ctrl+J = 复制图层
      if (ctrl && (e.key === 'j' || e.key === 'J')) {
        const sel = stateRef.current.project.selectedId;
        if (sel) {
          e.preventDefault();
          duplicateLayer(sel);
        }
        return;
      }

      // V = 选择工具
      if (!ctrl && (e.key === 'v' || e.key === 'V')) {
        e.preventDefault();
        setTool('select');
        return;
      }
      // H = 抓手工具
      if (!ctrl && (e.key === 'h' || e.key === 'H')) {
        e.preventDefault();
        setTool('hand');
        return;
      }
      // B = 画笔
      if (!ctrl && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault();
        setTool('brush');
        return;
      }
      // E = 橡皮
      if (!ctrl && (e.key === 'e' || e.key === 'E')) {
        e.preventDefault();
        setTool('eraser');
        return;
      }
      // M = 局部重绘蒙版画笔
      if (!ctrl && (e.key === 'm' || e.key === 'M')) {
        e.preventDefault();
        setTool('mask');
        return;
      }
      // [ ] 调笔刷大小（Shift+ 加倍）
      if (!ctrl && (e.key === '[' || e.key === ']')) {
        e.preventDefault();
        const cur = useBrushStore.getState().size;
        const step = e.shiftKey ? 10 : 2;
        setBrushSize(e.key === '[' ? cur - step : cur + step);
        return;
      }

      // Ctrl+A 全选图层
      if (ctrl && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        selectAllLayers();
        return;
      }

      // Ctrl+G 组合所选
      if (ctrl && (e.key === 'g' || e.key === 'G') && !e.shiftKey) {
        e.preventDefault();
        groupSelected();
        return;
      }

      // Delete / Backspace = 删除选中图层（支持多选）
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const ids = stateRef.current.project.selectedIds ?? [];
        if (ids.length === 0) {
          const sel = stateRef.current.project.selectedId;
          if (!sel) return;
          e.preventDefault();
          removeLayer(sel);
          return;
        }
        e.preventDefault();
        if (ids.length === 1) removeLayer(ids[0]);
        else removeLayers(ids);
        return;
      }

      // 方向键 = 微调位置（支持多选批量）
      if (
        e.key === 'ArrowLeft' ||
        e.key === 'ArrowRight' ||
        e.key === 'ArrowUp' ||
        e.key === 'ArrowDown'
      ) {
        const ids = stateRef.current.project.selectedIds ?? [];
        if (ids.length === 0) return;
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        for (const id of ids) {
          const layer = stateRef.current.project.layers.find((l: Layer) => l.id === id);
          if (!layer || layer.locked || layer.isGroup) continue;
          const patch: Partial<Layer> = {};
          if (e.key === 'ArrowLeft') patch.x = layer.x - step;
          if (e.key === 'ArrowRight') patch.x = layer.x + step;
          if (e.key === 'ArrowUp') patch.y = layer.y - step;
          if (e.key === 'ArrowDown') patch.y = layer.y + step;
          updateLayer(id, patch);
        }
        return;
      }
    }
    function onKeyUp(e: KeyboardEvent): void {
      if (e.code === 'Space') setSpaceHeld(false);
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 拖拽文件到画布 → 加图层
  const dropRef = useRef<HTMLDivElement>(null);
  const [dropActive, setDropActive] = useState(false);
  useEffect(() => {
    const el = dropRef.current;
    if (!el) return;
    function onDragOver(e: DragEvent): void {
      if (!e.dataTransfer) return;
      const has = Array.from(e.dataTransfer.items).some((it) => it.kind === 'file');
      if (!has) return;
      e.preventDefault();
      setDropActive(true);
    }
    function onDragLeave(): void {
      setDropActive(false);
    }
    async function onDrop(e: DragEvent): Promise<void> {
      e.preventDefault();
      setDropActive(false);
      const files = Array.from(e.dataTransfer?.files ?? []).filter((f) =>
        f.type.startsWith('image/')
      );
      if (files.length === 0) return;
      for (const f of files) {
        try {
          const dataUri = await fileToDataUri(f);
          const img = await loadImage(dataUri);
          const layer = makeLayerFromImage({
            name: f.name.replace(/\.[^.]+$/, '').slice(0, 30) || '图层',
            sourcePath: null,
            cookedDataUri: dataUri,
            width: img.naturalWidth,
            height: img.naturalHeight,
            canvasWidth: project.width,
            canvasHeight: project.height
          });
          addLayer(layer);
        } catch (err) {
          toast.error('加载图片失败', String(err));
        }
      }
    }
    el.addEventListener('dragover', onDragOver);
    el.addEventListener('dragleave', onDragLeave);
    el.addEventListener('drop', onDrop);
    return () => {
      el.removeEventListener('dragover', onDragOver);
      el.removeEventListener('dragleave', onDragLeave);
      el.removeEventListener('drop', onDrop);
    };
  }, [project.width, project.height, addLayer]);

  // 画板尺寸限制（如果有外部数据让 width/height 超界，clamp 一下）
  useEffect(() => {
    if (project.width > MAX_CANVAS_SIZE || project.height > MAX_CANVAS_SIZE) {
      setProjectMeta({
        width: Math.min(project.width, MAX_CANVAS_SIZE),
        height: Math.min(project.height, MAX_CANVAS_SIZE)
      });
      toast.info('画板尺寸限制', `已上限到 ${MAX_CANVAS_SIZE}px`);
    }
  }, [project.width, project.height, setProjectMeta]);

  const handMode = tool === 'hand' || spaceHeld;

  // ─── 右键菜单 ───
  async function addImageFromPicker(): Promise<void> {
    const r = await window.electronAPI.storage.pickImages();
    if (!r.ok) {
      toast.error('打开文件失败', r.error.message);
      return;
    }
    for (const f of r.data.files) {
      try {
        const img = await loadImage(f.dataUri);
        addLayer(
          makeLayerFromImage({
            name: f.path.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') || '图层',
            sourcePath: f.path,
            width: img.naturalWidth,
            height: img.naturalHeight,
            canvasWidth: project.width,
            canvasHeight: project.height
          })
        );
      } catch (e) {
        toast.error('图片加载失败', String(e));
      }
    }
  }

  const menuHandlers: CanvasMenuHandlers = {
    onBgRemove: (id) => {
      selectLayer(id);
      setBgOpen(true);
    },
    onAddImage: () => void addImageFromPicker(),
    onOutpaint: () => setOutpaintOpen(true),
    onFitScreen: fitToScreen
  };

  function handleViewportContextMenu(e: React.MouseEvent): void {
    if (tool === 'brush' || tool === 'eraser' || tool === 'mask') return; // 绘制模式不弹菜单
    e.preventDefault();
    const sel = project.layers.find((l) => l.id === project.selectedId);
    if (sel) openLayerContextMenu(e.clientX, e.clientY, sel, menuHandlers);
    else openCanvasContextMenu(e.clientX, e.clientY, menuHandlers);
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.25 }}
      className="mb-canvas-root"
      ref={dropRef}
    >
      <Toolbar
        tool={tool}
        onToolChange={setTool}
        mode={mode}
        onModeChange={setMode}
        onBgRemove={() => setBgOpen(true)}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={doUndo}
        onRedo={doRedo}
        onOutpaint={() => setOutpaintOpen(true)}
        onAIPanel={() => setAiPanelOpen(true)}
        onHistory={() => setHistoryOpen(true)}
        onReferences={() => setRefOpen(true)}
        borderOutpaint={borderOutpaint}
        onToggleBorderOutpaint={() => setBorderOutpaint((v) => !v)}
        maxCanvasSize={MAX_CANVAS_SIZE}
      />

      <div className="mb-canvas-body">
        <LayerPanel
          menuHandlers={menuHandlers}
          zoom={zoom}
          onZoomIn={() => zoomAtViewportCenter(zoom * 1.2)}
          onZoomOut={() => zoomAtViewportCenter(zoom / 1.2)}
          onZoomTo100={zoomTo100}
          onFitScreen={fitToScreen}
          lockToSelected={lockToSelected}
          onToggleLockToSelected={() => setLockToSelected((v) => !v)}
          onCanvasProps={() => {
            setTool('select');
            selectLayer(null);
          }}
        />
        <div
          className={`mb-canvas-stage-wrap ${handMode ? 'is-hand' : ''}`}
          ref={viewportRef}
          onMouseDown={viewportMouseDown}
          onMouseMove={viewportMouseMove}
          onMouseLeave={viewportMouseLeave}
          onContextMenu={handleViewportContextMenu}
        >
          <CanvasStage
            zoom={zoom}
            panX={panX}
            panY={panY}
            mode={mode}
            handMode={handMode}
            brushTool={tool === 'brush' ? 'brush' : tool === 'eraser' ? 'eraser' : 'none'}
            maskMode={maskMode}
            inpaintMaskTool={tool === 'mask'}
            lockToSelected={lockToSelected}
            onModeChange={setMode}
            snapGuides={snapGuides}
            onSnapGuidesChange={setSnapGuides}
          />
          <Rulers
            zoom={zoom}
            panX={panX}
            panY={panY}
            width={0}
            height={0}
            cursor={cursorCoord}
          />
          {(tool === 'brush' || tool === 'eraser') && cursorScreen && (
            <div
              className="mb-canvas-brush-cursor"
              style={{
                left: cursorScreen.x,
                top: cursorScreen.y,
                width: Math.max(2, brushSize * zoom),
                height: Math.max(2, brushSize * zoom),
                borderColor: tool === 'eraser' ? '#fb923c' : 'rgba(255,255,255,0.9)',
                background: tool === 'brush' && !maskMode ? withAlpha(brushColor, 0.18) : 'transparent'
              }}
            />
          )}
          {tool === 'mask' && cursorScreen && (
            <div
              className="mb-canvas-brush-cursor"
              style={{
                left: cursorScreen.x,
                top: cursorScreen.y,
                width: Math.max(2, maskBrushSize * zoom),
                height: Math.max(2, maskBrushSize * zoom),
                borderColor: maskEraseMode ? '#fb923c' : withAlpha(maskColor, 0.9),
                background: maskEraseMode ? 'transparent' : withAlpha(maskColor, 0.25)
              }}
            />
          )}
          {borderOutpaint && (
            <OutpaintHandles
              zoom={zoom}
              panX={panX}
              panY={panY}
              width={project.width}
              height={project.height}
            />
          )}
          {project.layers.length === 0 && (
            <div className="mb-canvas-drop-hint">
              点击工具条「+ 添加图片」开始拼版（Z = 适合屏幕，H = 抓手，Space 临时抓手）
            </div>
          )}
        </div>
        {tool === 'mask' ? (
          <MaskPanel />
        ) : tool === 'brush' || tool === 'eraser' ? (
          <BrushPanel mode={maskMode ? 'mask' : 'paint'} />
        ) : (
          <PropertiesPanel
            onEnterPerspective={() => setMode('perspective')}
            onEnterCrop={() => setMode('crop')}
            onBgRemove={() => setBgOpen(true)}
            maxCanvasSize={MAX_CANVAS_SIZE}
            maskMode={maskMode}
            onMaskModeChange={setMaskMode}
          />
        )}
      </div>

      <StatusBar zoom={zoom} tool={tool} cursor={cursorCoord} />

      <BgRemoveDialog
        open={bgOpen}
        onClose={() => setBgOpen(false)}
        layer={project.layers.find((l) => l.id === project.selectedId) ?? null}
      />

      {outpaintOpen && <OutpaintDialog onClose={() => setOutpaintOpen(false)} />}

      {historyOpen && <HistoryPanel onClose={() => setHistoryOpen(false)} />}

      {refOpen && <ReferencePanel onClose={() => setRefOpen(false)} />}

      {aiPanelOpen && (
        <AIActionPanel
          onClose={() => setAiPanelOpen(false)}
          onInpaint={() => setTool('mask')}
          onOutpaint={() => setOutpaintOpen(true)}
          onBgRemove={() => {
            if (project.selectedId) {
              setBgOpen(true);
            } else {
              toast.info('未选中图层', '先选一个图像图层再去背景');
            }
          }}
        />
      )}

      {dropActive && (
        <div className="mb-canvas-fulldrop">松开鼠标加入画板</div>
      )}
    </motion.div>
  );
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** 把 '#rrggbbaa' 颜色转成带不同 alpha 的 rgba()，用于笔刷预览圈半透明填充 */
function withAlpha(color: string, alpha: number): string {
  const m = color.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
  if (!m) return `rgba(0,0,0,${alpha})`;
  const r = parseInt(m[1], 16);
  const g = parseInt(m[2], 16);
  const b = parseInt(m[3], 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function fileToDataUri(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(f);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error('image load failed'));
    im.src = src;
  });
}
