import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ShieldAlert } from 'lucide-react';
import { BrandLogo } from './BrandLogo';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  /** Only populated outside production builds. */
  debugMessage: string | null;
}

/**
 * Root error boundary. A rendering failure anywhere in the tree must degrade to a
 * branded, recoverable screen instead of a blank page.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, debugMessage: null };
    this.handleTryAgain = this.handleTryAgain.bind(this);
    this.handleReload = this.handleReload.bind(this);
  }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return {
      hasError: true,
      debugMessage: import.meta.env.DEV && error instanceof Error ? error.message : null,
    };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    // Keep the full diagnostic in the console; never send user data anywhere.
    console.error('Unhandled render error caught by ErrorBoundary:', error, info.componentStack);
  }

  handleTryAgain() {
    this.setState({ hasError: false, debugMessage: null });
  }

  handleReload() {
    window.location.reload();
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <main
        role="alert"
        className="min-h-screen bg-black text-white flex items-center justify-center px-4"
      >
        <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#181818] p-6 sm:p-8 shadow-2xl">
          <BrandLogo />

          <div className="mt-6 flex h-12 w-12 items-center justify-center rounded-xl border border-red-500/30 bg-red-500/10 text-red-400">
            <ShieldAlert className="h-6 w-6" aria-hidden="true" />
          </div>

          <h1 className="mt-4 text-2xl font-extrabold tracking-tight text-white">
            Something went wrong
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-[#B3B3B3]">
            An unexpected error occurred while rendering this page. You can try again — if the
            problem keeps happening, reload the page or contact support.
          </p>

          {this.state.debugMessage && (
            <p className="mt-4 break-words rounded-xl border border-white/10 bg-[#121212] p-3 font-mono text-[11px] text-red-300">
              {this.state.debugMessage}
            </p>
          )}

          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={this.handleTryAgain}
              className="inline-flex min-h-[46px] items-center justify-center rounded-full border border-white/20 bg-[#121212] px-6 py-3 text-sm font-semibold text-white transition-colors hover:border-[#1DB954] hover:text-[#1DB954] cursor-pointer"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={this.handleReload}
              className="inline-flex min-h-[46px] items-center justify-center rounded-full bg-[#1DB954] px-6 py-3 text-sm font-bold text-black transition-colors hover:bg-[#15803D] hover:text-white cursor-pointer"
            >
              Reload page
            </button>
          </div>
        </div>
      </main>
    );
  }
}
