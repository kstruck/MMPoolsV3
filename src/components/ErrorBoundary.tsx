import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { errorHandler, ErrorSeverity } from '../services/errorHandler';

interface ErrorBoundaryState {
    hasError: boolean;
    error: Error | null;
}

interface ErrorBoundaryProps {
    children: React.ReactNode;
    /** Optional compact fallback (e.g. a single panel) instead of the full-screen one. */
    fallback?: React.ReactNode;
    /** When this value changes, the boundary resets — e.g. pass the active tab id so
     *  switching tabs clears a crashed panel instead of stranding the whole surface. */
    resetKey?: unknown;
}

/**
 * Error Boundary — catches unhandled React rendering errors and shows a friendly
 * fallback instead of a white screen. Logs caught errors via the ErrorHandler service.
 * Used globally (default full-screen fallback) AND per-tab in SuperAdmin (compact
 * `fallback` + `resetKey`) so one panel's crash no longer takes down the app.
 */
export class ErrorBoundary extends React.Component<
    ErrorBoundaryProps,
    ErrorBoundaryState
> {
    constructor(props: ErrorBoundaryProps) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return { hasError: true, error };
    }

    componentDidUpdate(prevProps: ErrorBoundaryProps): void {
        if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
            this.setState({ hasError: false, error: null });
        }
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
        const isChunkLoadError =
            error.name === 'ChunkLoadError' ||
            (error.message && error.message.includes('Failed to fetch dynamically imported module'));

        if (isChunkLoadError) {
            const reloadCount = parseInt(sessionStorage.getItem('chunk_load_reload_count') || '0', 10);
            if (reloadCount < 1) {
                sessionStorage.setItem('chunk_load_reload_count', (reloadCount + 1).toString());
                window.location.reload();
                return;
            }
        }

        errorHandler.handleError(error, {
            severity: isChunkLoadError ? ErrorSeverity.MEDIUM : ErrorSeverity.CRITICAL,
            context: { componentStack: errorInfo.componentStack },
            notify: false, // We show our own fallback UI
        });
    }

    handleReload = () => {
        this.setState({ hasError: false, error: null });
        window.location.href = '/';
    };

    render() {
        if (this.state.hasError) {
            if (this.props.fallback !== undefined) {
                return this.props.fallback;
            }
            return (
                <div className="min-h-screen bg-navy-950 flex items-center justify-center p-6">
                    <div className="max-w-md w-full bg-navy-900 border border-[rgba(230,206,150,0.16)] rounded-2xl p-8 text-center shadow-panel">
                        <div className="mb-4 flex justify-center"><AlertTriangle size={48} className="text-gold-500" /></div>
                        <h1 className="text-2xl font-display font-bold uppercase text-white mb-2">
                            Something went wrong
                        </h1>
                        <p className="text-[#9FB0CC] font-body mb-6">
                            An unexpected error occurred. Our team has been notified.
                            Please try refreshing or returning to the home page.
                        </p>
                        {import.meta.env.DEV && this.state.error && (
                            <pre className="text-left text-xs text-brandred-500 bg-navy-950 rounded-lg p-4 mb-6 overflow-auto max-h-40 border border-brandred-700/30">
                                {this.state.error.message}
                                {'\n'}
                                {this.state.error.stack}
                            </pre>
                        )}
                        <div className="flex gap-3 justify-center">
                            <button
                                onClick={() => window.location.reload()}
                                className="px-5 py-2.5 bg-navy-800 hover:bg-navy-700 text-white rounded-lg transition-colors duration-150 font-display font-bold uppercase tracking-[0.05em] text-sm"
                            >
                                Refresh Page
                            </button>
                            <button
                                onClick={this.handleReload}
                                className="px-5 py-2.5 bg-brandred-600 hover:bg-brandred-500 text-white rounded-lg transition-colors duration-150 font-display font-bold uppercase tracking-[0.05em] text-sm shadow-[0_6px_16px_rgba(196,52,46,0.28)]"
                            >
                                Go Home
                            </button>
                        </div>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
