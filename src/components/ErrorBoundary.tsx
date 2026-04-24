import { Component, type ErrorInfo, type ReactNode } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    error: null,
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const details = errorInfo.componentStack ? `\n${errorInfo.componentStack}` : ''
    // eslint-disable-next-line no-console
    console.error('[T-CAN] Renderer crash', error, details)
  }

  render() {
    if (!this.state.error) {
      return this.props.children
    }

    return (
      <div
        style={{
          minHeight: '100vh',
          background: '#131313',
          color: '#e5e2e1',
          padding: '24px',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        }}
      >
        <h1 style={{ margin: '0 0 16px', color: '#00ff41', fontSize: '20px', letterSpacing: '0.12em' }}>
          T-CAN RENDERER ERROR
        </h1>
        <p style={{ margin: '0 0 12px' }}>
          The renderer crashed during startup. Rebuild the app and restart it. If this only happens on one machine,
          remove stale app state and make sure the Electron preload bundle matches the renderer.
        </p>
        <pre
          style={{
            margin: 0,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            border: '1px solid rgba(0,255,65,0.4)',
            padding: '16px',
            background: '#0a0a0a',
          }}
        >
          {this.state.error.stack ?? this.state.error.message}
        </pre>
      </div>
    )
  }
}
