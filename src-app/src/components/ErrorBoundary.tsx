import React from 'react'

interface State { hasError: boolean; error?: Error }

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 40, background: '#0d1117', minHeight: '100vh', color: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <h1 style={{ color: '#f87171', marginBottom: 16 }}>Page Error</h1>
          <pre style={{ color: '#fbbf24', fontSize: 13, whiteSpace: 'pre-wrap', maxWidth: 800 }}>
            {this.state.error?.message}
            {'\n\n'}
            {this.state.error?.stack}
          </pre>
          <button onClick={() => window.location.href = '/dashboard'} style={{ marginTop: 24, padding: '10px 24px', background: '#F5A623', color: '#000', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer' }}>
            Back to Dashboard
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
