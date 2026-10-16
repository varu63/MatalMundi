import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Uncaught render error:', error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
        <p className="text-6xl">⚠️</p>
        <h1 className="page-title">Something went wrong</h1>
        <p className="max-w-md text-sm text-ink-500">
          The page hit an unexpected error. Reloading usually fixes it — if it keeps happening,
          the information below helps support debug it.
        </p>
        <pre className="max-w-lg overflow-auto rounded bg-ink-100 p-3 text-left text-xs text-ink-700">
          {this.state.error.message}
        </pre>
        <div className="flex gap-2">
          <button className="btn-primary" onClick={() => window.location.reload()}>
            Reload
          </button>
          <a className="btn bg-ink-100 text-ink-700 hover:bg-ink-200" href="/">
            Go home
          </a>
        </div>
      </div>
    );
  }
}
