import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSmartKeybindStore, comboFromEvent, KEYBIND_ACTIONS } from '@/store/smartCanvasStore';

/** 自定义快捷键编辑器：点「录制」后按下任意组合即绑定到该功能。 */
export function KeybindingsDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const bindings = useSmartKeybindStore((s) => s.bindings);
  const setBinding = useSmartKeybindStore((s) => s.setBinding);
  const reset = useSmartKeybindStore((s) => s.reset);
  const [recording, setRecording] = useState<string | null>(null);

  useEffect(() => {
    if (!recording) return;
    function onKey(e: KeyboardEvent): void {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === 'Escape') {
        setRecording(null);
        return;
      }
      const combo = comboFromEvent(e);
      if (!combo) return; // 纯修饰键，继续等
      setBinding(recording as string, combo);
      setRecording(null);
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [recording, setBinding]);

  // portal 到 body + flex 居中：父级 .mb-sc-root 带 framer transform，否则 fixed/居中会错位
  return createPortal(
    <div className="mb-sc-keys-backdrop" onClick={onClose}>
      <div className="mb-sc-keys mb-card" onClick={(e) => e.stopPropagation()}>
        <div className="mb-sc-keys-head">
          <span>智能画布 · 快捷键</span>
          <button className="mb-sc-node-x" onClick={onClose} title="关闭">
            ✕
          </button>
        </div>
        <div className="mb-sc-keys-hint">点右侧组合键按钮 → 按下任意组合即可重新绑定；Esc 取消录制。</div>
        <div className="mb-sc-keys-list">
          {KEYBIND_ACTIONS.map((a) => (
            <div key={a.id} className="mb-sc-keys-row">
              <span className="mb-sc-keys-label">{a.label}</span>
              <button
                className={`mb-btn mb-btn-sm ${recording === a.id ? 'is-armed' : 'mb-btn-ghost'} mb-sc-keys-combo`}
                onClick={() => setRecording(recording === a.id ? null : a.id)}
              >
                {recording === a.id ? '按下按键…' : bindings[a.id] || '未设置'}
              </button>
              {bindings[a.id] && recording !== a.id && (
                <button className="mb-sc-node-x" title="清除" onClick={() => setBinding(a.id, '')}>
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="mb-sc-keys-foot">
          <button className="mb-btn mb-btn-sm mb-btn-ghost" onClick={reset}>
            恢复默认
          </button>
          <button className="mb-btn mb-btn-sm" onClick={onClose}>
            完成
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
