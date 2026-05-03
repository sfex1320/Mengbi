import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './styles/global.css';

// 把全局未捕获错误也写到 console，方便 DevTools 一眼看到
window.addEventListener('error', (e) => {
  console.error('[window.error]', e.message, e.error);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('[unhandledrejection]', e.reason);
});

const container = document.getElementById('root');
if (!container) throw new Error('#root not found');

if (!window.electronAPI) {
  container.innerHTML = `
    <div style="position:fixed;inset:0;padding:60px;color:#f5f5f7;background:#0a0b10;font-family:system-ui,-apple-system,sans-serif;overflow:auto">
      <h1 style="font-size:18px;margin:0 0 14px;color:#f43f5e">Preload 脚本未加载</h1>
      <p style="color:rgba(245,245,247,.7);font-size:13px;max-width:640px;line-height:1.6">
        渲染进程拿不到 <code style="background:rgba(255,255,255,.06);padding:2px 6px;border-radius:6px;color:#fb923c">window.electronAPI</code>，
        说明主进程指定的 preload 路径不存在或脚本运行时出错。
      </p>
      <p style="color:rgba(245,245,247,.5);font-size:12px;margin-top:14px">
        请检查 dev 终端日志中是否有 <code style="background:rgba(255,255,255,.06);padding:2px 6px;border-radius:6px;color:#fb923c">preload path:</code>
        / <code style="background:rgba(255,255,255,.06);padding:2px 6px;border-radius:6px;color:#fb923c">preload-error</code> 字样，
        以及 <code style="background:rgba(255,255,255,.06);padding:2px 6px;border-radius:6px;color:#fb923c">[preload] starting</code> 是否打印。
      </p>
    </div>`;
  throw new Error('window.electronAPI is undefined; preload not loaded');
}

try {
  createRoot(container).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>
  );
} catch (e) {
  const err = e as Error;
  console.error('[bootstrap] render failed', err);
  container.innerHTML = `
    <div style="position:fixed;inset:0;padding:60px;color:#f5f5f7;background:#0a0b10;font-family:system-ui,-apple-system,sans-serif;overflow:auto">
      <h1 style="font-size:18px;margin:0 0 14px;color:#f43f5e">启动失败</h1>
      <p style="color:rgba(245,245,247,.7);font-size:13px"><code style="background:rgba(255,255,255,.06);padding:2px 6px;border-radius:6px;color:#fb923c">${err.name}</code>: ${err.message}</p>
      <pre style="margin-top:20px;padding:16px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:12px;font-size:12px;font-family:Consolas,monospace;color:rgba(245,245,247,.7);white-space:pre-wrap;word-break:break-all">${err.stack ?? ''}</pre>
    </div>`;
}
