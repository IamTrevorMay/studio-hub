import React from 'react';

export default class PageErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('[PageErrorBoundary] Uncaught error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={styles.container}>
          <div style={styles.card}>
            <div style={styles.icon}>!</div>
            <h2 style={styles.title}>Something went wrong</h2>
            <p style={styles.message}>
              {this.state.error?.message || 'An unexpected error occurred.'}
            </p>
            <button
              style={styles.button}
              onClick={() => this.setState({ hasError: false, error: null })}
            >
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const styles = {
  container: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '400px',
    padding: '40px',
    fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
  },
  card: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '16px',
    padding: '40px',
    maxWidth: '420px',
    textAlign: 'center',
  },
  icon: {
    width: '48px',
    height: '48px',
    borderRadius: '50%',
    background: 'rgba(239,68,68,0.15)',
    color: '#ef4444',
    fontSize: '24px',
    fontWeight: 700,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    margin: '0 auto 16px',
  },
  title: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: '18px',
    fontWeight: 600,
    margin: '0 0 8px',
  },
  message: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: '14px',
    lineHeight: '1.5',
    margin: '0 0 24px',
    wordBreak: 'break-word',
  },
  button: {
    padding: '10px 24px',
    background: 'linear-gradient(135deg, #5b8fc7, #8fb4d8)',
    border: 'none',
    borderRadius: '10px',
    color: '#ffffff',
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
  },
};
