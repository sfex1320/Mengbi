import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /**
   * 变化时自动复位错误态。页面级边界传 location.pathname：切换功能页即自动恢复，
   * 不必重载整个应用（解决「一处崩溃 → 永久白屏 → 所有功能无法使用」）。
   */
  resetKey?: string;
  /**
   * contained=true：只占据页面内容区（不 fixed 全屏），保留侧栏 / 顶栏可用，
   * 用户可直接点侧栏切到别的功能。根级（main.tsx）不传 → 全屏兜底。
   */
  contained?: boolean;
}

interface State {
  error: Error | null;
  info: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ info });
    console.error('[ErrorBoundary]', error, info);
  }

  componentDidUpdate(prev: Props): void {
    // 路由变化（resetKey 变了）→ 清错误态，让目标页面正常渲染
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null, info: null });
    }
  }

  render(): ReactNode {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    if (this.props.contained) {
      // 页面级：只占内容区，侧栏 / 顶栏照常可用，切到别的功能页即自动恢复
      return (
        <div className="mb-errboundary">
          <div className="mb-errboundary-card mb-card">
            <div className="mb-errboundary-title">这个页面出了点问题</div>
            <div className="mb-errboundary-desc">
              当前页面渲染时遇到异常，已被拦截，避免整个应用卡死。可以点「重试」，或直接用左侧导航切换到其它功能继续使用。
            </div>
            <pre className="mb-errboundary-detail">
              {error.name}: {error.message}
            </pre>
            <div className="mb-errboundary-actions">
              <button className="mb-btn mb-btn-primary mb-btn-sm" onClick={() => this.setState({ error: null, info: null })}>
                重试
              </button>
              <button
                className="mb-btn mb-btn-secondary mb-btn-sm"
                onClick={() => {
                  this.setState({ error: null, info: null });
                  window.location.hash = '#/';
                }}
              >
                返回生图首页
              </button>
            </div>
          </div>
        </div>
      );
    }

    // 根级兜底（全屏）：理论上很少触发——页面级边界先接住大多数渲染崩溃
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          padding: 60,
          color: '#f5f5f7',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          background: '#0a0b10',
          overflow: 'auto'
        }}
      >
        <h1 style={{ fontSize: 18, margin: '0 0 14px', color: '#f43f5e' }}>渲染崩溃了</h1>
        <p style={{ color: 'rgba(245,245,247,.7)', fontSize: 13, maxWidth: 720, lineHeight: 1.6 }}>
          <code style={{ background: 'rgba(255,255,255,.06)', padding: '2px 6px', borderRadius: 6, color: '#fb923c' }}>
            {error.name}
          </code>
          : {error.message}
        </p>
        <pre
          style={{
            marginTop: 20,
            padding: 16,
            background: 'rgba(255,255,255,.04)',
            border: '1px solid rgba(255,255,255,.08)',
            borderRadius: 12,
            fontSize: 12,
            fontFamily: 'Consolas, monospace',
            color: 'rgba(245,245,247,.7)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            maxHeight: '60vh',
            overflow: 'auto'
          }}
        >
          {error.stack}
          {info?.componentStack}
        </pre>
        <button
          className="mb-btn mb-btn-primary mb-btn-sm"
          style={{ marginTop: 20 }}
          onClick={() => {
            this.setState({ error: null, info: null });
            window.location.hash = '#/';
            window.location.reload();
          }}
        >
          重新加载
        </button>
      </div>
    );
  }
}
