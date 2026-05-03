import { useEffect, useState } from 'react';
import './WindowControls.css';

/**
 * macOS 风 traffic light，hover 时显示具体图标。放在窗口右上角。
 */
export function WindowControls(): JSX.Element {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let mounted = true;
    window.electronAPI?.window?.state().then((r) => {
      if (mounted && r.ok) setMaximized(r.data.maximized);
    });
    return () => {
      mounted = false;
    };
  }, []);

  async function onMin(): Promise<void> {
    await window.electronAPI?.window?.minimize();
  }
  async function onMax(): Promise<void> {
    const r = await window.electronAPI?.window?.maximizeToggle();
    if (r?.ok) setMaximized(r.data.maximized);
  }
  async function onClose(): Promise<void> {
    await window.electronAPI?.window?.close();
  }

  return (
    <div className="mb-traffic" role="group" aria-label="窗口控制">
      <button
        className="mb-traffic-dot mb-traffic-min"
        onClick={onMin}
        aria-label="最小化"
        title="最小化"
      >
        <svg viewBox="0 0 12 12" width="8" height="8">
          <line x1="2.5" y1="6" x2="9.5" y2="6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
      <button
        className="mb-traffic-dot mb-traffic-max"
        onClick={onMax}
        aria-label={maximized ? '还原' : '最大化'}
        title={maximized ? '还原' : '最大化'}
      >
        {maximized ? (
          <svg viewBox="0 0 12 12" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="1.4">
            <rect x="2.4" y="3.4" width="5" height="5" rx="0.6" />
            <path d="M4.4 3.4V2.4h5v5h-1" />
          </svg>
        ) : (
          <svg viewBox="0 0 12 12" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="1.4">
            <rect x="2.5" y="2.5" width="7" height="7" rx="0.8" />
          </svg>
        )}
      </button>
      <button
        className="mb-traffic-dot mb-traffic-close"
        onClick={onClose}
        aria-label="关闭"
        title="关闭"
      >
        <svg viewBox="0 0 12 12" width="8" height="8">
          <line x1="3" y1="3" x2="9" y2="9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <line x1="9" y1="3" x2="3" y2="9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
