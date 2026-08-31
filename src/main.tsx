import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { BrowserRouter } from 'react-router'
import { HelmetProvider } from 'react-helmet-async'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ThemeProvider } from './contexts/ThemeContext'
import { ToastProvider } from './components/ui/Toast'
import { initSentry, installGlobalErrorHandlers } from './sentry'
import { errorHandler, ErrorSeverity } from './services/errorHandler'

// Fire-and-forget: initSentry() dynamically imports @sentry/react, so this
// must never block first paint. Swallow a load failure (e.g. offline) —
// losing error telemetry must never crash the app it's meant to observe.
initSentry().catch(() => {})

// Non-render errors — thrown in an event handler, a timer, an async callback,
// or an unhandled promise rejection — never reach <ErrorBoundary>, which only
// sees errors during React rendering. Before this they were recorded nowhere.
//
// The handler self-limits (dedupe + rolling cap, see sentry.ts) and stands down
// whenever Sentry is actually initialized, so this feeds the logClientError sink
// only and never double-reports what Sentry's GlobalHandlers already captured.
//
// `.catch(() => {})` is load-bearing, not defensive habit: handleError returns a
// promise, and an unhandled rejection from it would re-enter THIS handler.
installGlobalErrorHandlers((error, context) => {
  errorHandler
    .handleError(error, { severity: ErrorSeverity.HIGH, context, notify: false })
    .catch(() => {})
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <HelmetProvider>
        <BrowserRouter>
          <ThemeProvider>
            <ToastProvider>
              <App />
            </ToastProvider>
          </ThemeProvider>
        </BrowserRouter>
      </HelmetProvider>
    </ErrorBoundary>
  </React.StrictMode>,
)