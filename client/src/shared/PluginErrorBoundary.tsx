import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = {
  label: string;
  children: ReactNode;
  onRetry?: () => void;
};

type State = { error: Error | null };

export class PluginErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[plugin:${this.props.label}]`, error, info.componentStack);
  }

  private retry = () => {
    this.setState({ error: null });
    this.props.onRetry?.();
  };

  render() {
    if (this.state.error) {
      return (
        <div
          className="rounded-lg border border-amber-200 bg-amber-50/90 px-3 py-2 text-[11px] text-amber-950"
          role="alert"
        >
          <p className="font-semibold">{this.props.label} failed to load</p>
          <p className="mt-1 font-mono text-[10px] opacity-90">{this.state.error.message}</p>
          <button
            type="button"
            onClick={this.retry}
            className="mt-2 px-2 py-1 rounded bg-amber-200 hover:bg-amber-300 text-[10px] font-bold uppercase tracking-wide"
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
