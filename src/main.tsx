import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { BrowserRouter } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ThemeProvider } from './contexts/ThemeContext'
import { ToastProvider } from './components/ui/Toast'

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