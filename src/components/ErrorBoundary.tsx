import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
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

  render(): ReactNode {
    if (this.state.error) {
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
          <h1 style={{ fontSize: 18, margin: '0 0 14px', color: '#f43f5e' }}>
            渲染崩溃了
          </h1>
          <p
            style={{
              color: 'rgba(245,245,247,.7)',
              fontSize: 13,
              maxWidth: 720,
              lineHeight: 1.6
            }}
          >
            <code
              style={{
                background: 'rgba(255,255,255,.06)',
                padding: '2px 6px',
                borderRadius: 6,
                color: '#fb923c'
              }}
            >
              {this.state.error.name}
            </code>
            : {this.state.error.message}
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
            {this.state.error.stack}
            {this.state.info?.componentStack}
          </pre>
          <p style={{ marginTop: 20, fontSize: 12, color: 'rgba(245,245,247,.5)' }}>
            把上面这段截图发给开发者即可定位。
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}
