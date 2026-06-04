import { useEffect, useState } from 'react';
import { useImageParamsStore } from '@/store/imageParamsStore';
import { useSettingsStore } from '@/store/settingsStore';
import { toast } from '@/store/toastStore';
import { TrashIcon, PlusIcon } from '@/components/Icon';

/**
 * LoRA 选择器：扫描 lora_folder_path 目录列出 .safetensors / .pt / .ckpt，
 * 用户多选后每条配权重（0–2，步进 0.05）。
 *
 * 注入路径见 imageParamsStore.buildParams：
 *   - 通用：拼成 <lora:name:weight> 串放 params.lora（OpenAI 兼容站会被 prompt 末尾拼接）
 *   - ComfyUI：workflow JSON 里用 {{lora}} 占位符接收同一字符串
 *
 * 如果用户没设 lora_folder_path,组件返回 null（在 Create 面板里就不渲染）。
 */
export function LoraSelector(): JSX.Element | null {
  const selected = useImageParamsStore((s) => s.selectedLoras);
  const upsertLora = useImageParamsStore((s) => s.upsertLora);
  const removeLora = useImageParamsStore((s) => s.removeLora);
  const setLoraWeight = useImageParamsStore((s) => s.setLoraWeight);
  const clearLoras = useImageParamsStore((s) => s.clearLoras);
  const folderPath = useSettingsStore((s) => s.prefs.lora_folder_path);

  const [available, setAvailable] = useState<Array<{ name: string; path: string; sizeBytes: number }>>([]);
  const [loaded, setLoaded] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [open, setOpen] = useState(false);

  async function scan(): Promise<void> {
    setScanning(true);
    const r = await window.electronAPI.storage.scanLoras();
    setScanning(false);
    if (!r.ok) {
      toast.error('扫描失败', r.error.message);
      return;
    }
    setAvailable(r.data);
    setLoaded(true);
    if (r.data.length === 0) {
      toast.info('未发现 LoRA 文件', '检查 lora_folder_path 是否正确');
    }
  }

  // 首次展开时自动扫一次
  useEffect(() => {
    if (open && !loaded && folderPath) {
      void scan();
    }
  }, [open, loaded, folderPath]);

  if (!folderPath || !folderPath.trim()) return null;

  return (
    <div className="mb-lora-section">
      <div className="mb-lora-header">
        <button
          type="button"
          className="mb-lora-toggle"
          onClick={() => setOpen((v) => !v)}
        >
          🎛️ LoRA · {selected.length} 已选 {open ? '▴' : '▾'}
        </button>
        {selected.length > 0 && (
          <button
            type="button"
            className="mb-btn mb-btn-ghost mb-btn-sm"
            onClick={clearLoras}
            title="清空已选"
          >
            清空
          </button>
        )}
      </div>

      {/* 已选列表 + 权重滑块 */}
      {selected.length > 0 && (
        <div className="mb-lora-selected-list">
          {selected.map((l) => (
            <div key={l.name} className="mb-lora-selected-row">
              <div className="mb-lora-selected-name" title={l.path}>
                {l.name}
              </div>
              <input
                type="range"
                min={0}
                max={2}
                step={0.05}
                value={l.weight}
                onChange={(e) => setLoraWeight(l.name, parseFloat(e.target.value))}
                className="mb-lora-weight-slider"
              />
              <span className="mb-lora-weight-val">{l.weight.toFixed(2)}</span>
              <button
                type="button"
                className="mb-lora-remove"
                onClick={() => removeLora(l.name)}
                title="移除"
              >
                <TrashIcon size={11} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 可选列表（折叠） */}
      {open && (
        <div className="mb-lora-available">
          <div className="mb-lora-available-actions">
            <button
              type="button"
              className="mb-btn mb-btn-ghost mb-btn-sm"
              onClick={() => void scan()}
              disabled={scanning}
            >
              {scanning ? '扫描中...' : '重新扫描'}
            </button>
            <span className="mb-field-hint">
              共发现 {available.length} 个；点 + 加入，权重默认 1.00
            </span>
          </div>
          <div className="mb-lora-available-list">
            {available.map((l) => {
              const isSelected = selected.some((s) => s.name === l.name);
              return (
                <button
                  key={l.path}
                  type="button"
                  className={`mb-lora-available-item ${isSelected ? 'is-selected' : ''}`}
                  onClick={() => {
                    if (isSelected) removeLora(l.name);
                    else upsertLora({ name: l.name, path: l.path, weight: 1.0 });
                  }}
                  title={l.path}
                >
                  <span className="mb-lora-available-name">{l.name}</span>
                  <span className="mb-lora-available-size">
                    {(l.sizeBytes / 1024 / 1024).toFixed(0)} MB
                  </span>
                  {!isSelected && <PlusIcon size={11} />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
