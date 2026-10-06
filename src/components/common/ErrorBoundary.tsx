import React, { Component, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('[ErrorBoundary] Caught render error:', error, errorInfo);
  }

  handleReload = (): void => {
    window.location.reload();
  };

  handleReset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div
          className="app-container mini-player glass-panel"
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            padding: '24px',
            textAlign: 'center',
            background: 'rgba(16, 16, 20, 0.95)',
            borderRadius: '28px',
            boxShadow: '0 20px 40px rgba(0,0,0,0.4)',
            color: '#ffffff',
            userSelect: 'none'
          }}
        >
          <div
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '50%',
              background: 'rgba(255, 69, 58, 0.18)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '16px',
              color: '#ff453a',
              fontSize: '22px'
            }}
          >
            !
          </div>

          <h3
            style={{
              margin: '0 0 8px 0',
              fontSize: '17px',
              fontWeight: 600,
              letterSpacing: '-0.01em',
              color: '#ffffff'
            }}
          >
            Playback View Encountered an Issue
          </h3>

          <p
            style={{
              margin: '0 0 20px 0',
              fontSize: '13px',
              color: 'rgba(255, 255, 255, 0.65)',
              maxWidth: '320px',
              lineHeight: 1.45,
              wordBreak: 'break-word'
            }}
          >
            {this.state.error?.message || 'An unexpected rendering error occurred.'}
          </p>

          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              onClick={this.handleReset}
              style={{
                padding: '8px 18px',
                borderRadius: '12px',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                background: 'rgba(255, 255, 255, 0.08)',
                color: '#ffffff',
                fontSize: '13px',
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'background 0.2s'
              }}
            >
              Resume
            </button>
            <button
              onClick={this.handleReload}
              style={{
                padding: '8px 18px',
                borderRadius: '12px',
                border: 'none',
                background: '#0a84ff',
                color: '#ffffff',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
                boxShadow: '0 4px 12px rgba(10, 132, 255, 0.35)'
              }}
            >
              Reload
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
