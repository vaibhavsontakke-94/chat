import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/ui/ErrorBoundary'
import { PreferencesProvider } from './hooks/usePreferences'
import { AuthProvider } from './lib/auth/AuthProvider'

const container = document.getElementById('root')

if (!container) {
  throw new Error('Root element #root was not found in index.html.')
}

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <PreferencesProvider>
          <App />
        </PreferencesProvider>
      </AuthProvider>
    </ErrorBoundary>
  </StrictMode>,
)
