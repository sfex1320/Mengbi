import { useNavigate } from 'react-router-dom';
import { useCanvasStore } from '@/store/canvasStore';
import { useImageParamsStore } from '@/store/imageParamsStore';
import { exportProjectAsPNG, blobToDataUri } from './canvasEngine/exportPNG';
import { ZERO_ADJUST, ADJUST_PRESETS } from './types';
import { toast } from '@/store/toastStore';

/**
 * 画板 AI 功能入口面板（需求十二节）。
 *
 * 铁律：所有 AI 操作**默认不覆盖原图**——能在本地做的（颜色/细节增强）直接作用在选中图层并可撤销；
 * 需要模型的，要么走画板内的局部重绘/扩图（结果作新图层），要么把当前画布作为参考图送到生图页。
 */

interface Props {
  onClose: () => void;
  /** 切到蒙版工具（用于局部重绘类） */
  onInpaint: () => void;
  /** 打开扩图对话框 */
  onOutpaint: () => void;
  /** 抠背景（作用于选中图层） */
  onBgRemove: () => void;
}

export function AIActionPanel({ onClose, onInpaint, onOutpaint, onBgRemove }: Props): JSX.Element {
  const navigate = useNavigate();
  const project = useCanvasStore((s) => s.project);
  const updateLayer = useCanvasStore((s) => s.updateLayer);
  const addRefs = useImageParamsStore((s) => s.addRefs);
  const setChatDraft = useImageParamsStore((s) => s.setChatDraft);

  const selectedId = project.selectedId;

  /** 把当前画布合成送到生图页作参考图，并可选预填提示词 */
  async function toGenerate(promptPreset?: string): Promise<void> {
    if (project.layers.length > 0) {
      try {
        const blob = await exportProjectAsPNG(project);
        const dataUri = await blobToDataUri(blob);
        const img = await loadImage(dataUri);
        addRefs([{ path: '', dataUri, width: img.naturalWidth, height: img.naturalHeight }]);
      } catch (e) {
        toast.error('合成画布失败', String(e));
      }
    }
    if (promptPreset) setChatDraft(promptPreset);
    onClose();
    navigate('/');
  }

  function applyAdjustPreset(key: string, label: string): void {
    if (!selectedId) {
      toast.info('未选中图层', '先选一个图像图层');
      return;
    }
    const preset = ADJUST_PRESETS.find((p) => p.key === key);
    if (preset) {
      updateLayer(selectedId, { ...ZERO_ADJUST, ...preset.patch });
      toast.success(`已套用「${label}」`, '可在属性面板继续微调，Ctrl+Z 撤销');
    }
    onClose();
  }

  const actions: Array<{ icon: string; label: string; hint?: string; run: () => void }> = [
    { icon: '🖼', label: '图生图', hint: '当前画布作参考图 → 生图页', run: () => void toGenerate() },
    { icon: '🩹', label: '局部重绘', hint: '涂蒙版后在右侧生成', run: () => { onInpaint(); onClose(); } },
    { icon: '⤢', label: '扩图', run: () => { onOutpaint(); onClose(); } },
    { icon: '🔍', label: '高清放大', hint: '工具箱', run: () => { onClose(); navigate('/tools'); } },
    { icon: '✂', label: '去背景', run: () => { onBgRemove(); onClose(); } },
    { icon: '🌄', label: '换背景', hint: '涂背景 → 局部重绘描述新背景', run: () => { onInpaint(); onClose(); toast.info('换背景', '用蒙版涂抹背景区域，在局部重绘里描述新背景'); } },
    { icon: '🎨', label: '风格迁移', run: () => void toGenerate('保持画面构图与主体，迁移为【在此填写风格】的整体风格') },
    { icon: '🔺', label: '图片转矢量', hint: '工具箱', run: () => { onClose(); navigate('/tools'); } },
    { icon: '✏', label: '线稿提取', run: () => void toGenerate('提取这张图的线稿：黑白干净线条、去除颜色与底纹') },
    { icon: '🌈', label: '颜色增强', hint: '本地·海报增强', run: () => applyAdjustPreset('poster', '海报色彩增强') },
    { icon: '✨', label: '细节增强', hint: '本地·局部锐化', run: () => applyAdjustPreset('local-sharpen', '局部锐化') },
    { icon: '📷', label: '真实化', run: () => void toGenerate('提升画面真实感：真实光照、真实材质质感、自然景深，保持构图') },
    { icon: '🔤', label: '文字修复', run: () => { onInpaint(); onClose(); toast.info('文字修复', '用蒙版圈出要修的文字区域，在局部重绘里写正确文字'); } },
    { icon: '🏷', label: 'Logo 修复', run: () => { onInpaint(); onClose(); toast.info('Logo 修复', '用蒙版圈出 Logo 区域，在局部重绘里描述目标 Logo'); } }
  ];

  return (
    <div className="mb-modal-backdrop" onClick={onClose}>
      <div className="mb-modal mb-ai-panel" onClick={(e) => e.stopPropagation()}>
        <h3>AI 功能</h3>
        <p className="mb-mask-rule">所有 AI 结果默认作为新图层，原图不破坏</p>
        <div className="mb-ai-grid">
          {actions.map((a) => (
            <button key={a.label} type="button" className="mb-ai-cell" onClick={a.run} title={a.hint ?? a.label}>
              <span className="mb-ai-cell-icon">{a.icon}</span>
              <span className="mb-ai-cell-label">{a.label}</span>
              {a.hint && <span className="mb-ai-cell-hint">{a.hint}</span>}
            </button>
          ))}
        </div>
        <div className="mb-modal-actions">
          <button type="button" className="mb-btn" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
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
