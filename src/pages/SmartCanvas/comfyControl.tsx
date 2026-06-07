import type { InputControl } from '@shared/comfyui';

/** 图片类控件由画布上游喂入（不在面板手填）。 */
export const COMFY_IMAGE_KINDS = new Set(['image', 'multi_image', 'mask', 'video', 'audio', 'file']);

/** 渲染一个 ComfyUI 工作流控件为可编辑表单项（图片类只读提示，由上游喂入）。检查器与 ComfyUI 节点共用。 */
export function renderComfyControl(c: InputControl, value: unknown, setCv: (id: string, v: unknown) => void): JSX.Element {
  const cid = c.id;
  const label = c.label || cid;
  if (COMFY_IMAGE_KINDS.has(c.type)) {
    return (
      <div key={cid} className="mb-sc-note">
        {label}：由画布上游喂入
      </div>
    );
  }
  const val = value ?? c.default ?? '';
  const num = typeof val === 'number' ? val : Number(val) || 0;
  let field: JSX.Element;
  switch (c.type) {
    case 'textarea':
    case 'json':
    case 'prompt':
      field = <textarea className="mb-textarea mb-sc-itext" value={String(val)} onChange={(e) => setCv(cid, e.target.value)} />;
      break;
    case 'number':
    case 'seed':
      field = <input className="mb-input" type="number" value={num} onChange={(e) => setCv(cid, Number(e.target.value))} />;
      break;
    case 'slider':
      field = (
        <input
          className="mb-sc-range"
          type="range"
          min={c.min ?? 0}
          max={c.max ?? 1}
          step={c.step ?? 0.01}
          value={num}
          onChange={(e) => setCv(cid, Number(e.target.value))}
        />
      );
      break;
    case 'select':
      field = (
        <select className="mb-select" value={String(val)} onChange={(e) => setCv(cid, e.target.value)}>
          {(c.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
      break;
    case 'switch':
      field = (
        <label className="mb-sc-switch-row">
          <input type="checkbox" checked={!!val} onChange={(e) => setCv(cid, e.target.checked)} /> 开启
        </label>
      );
      break;
    case 'color':
      field = <input type="color" value={String(val) || '#000000'} onChange={(e) => setCv(cid, e.target.value)} />;
      break;
    default:
      field = <input className="mb-input" value={String(val)} onChange={(e) => setCv(cid, e.target.value)} />;
  }
  return (
    <div key={cid} className="mb-sc-cfield">
      <label className="mb-sc-flabel">
        {label}
        {c.type === 'slider' ? ` · ${num}` : ''}
      </label>
      {field}
    </div>
  );
}
