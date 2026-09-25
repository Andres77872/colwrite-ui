import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/inter/latin-400.css'
import '@fontsource/inter/latin-500.css'
import '@fontsource/inter/latin-600.css'
import '@fontsource/inter/latin-700.css'
import 'katex/dist/katex.min.css'
import './styles/globals.css'
import { AuthProvider } from './components/auth/AuthContext'
import { ToastProvider } from './components/ui/toast'
import { ConfirmProvider } from './components/ui/confirm-dialog'
import { TooltipProvider } from './components/ui/tooltip'
import { initTheme } from './lib/theme'
import App from './App.tsx'

// Takes over from the pre-paint script in index.html: same resolution, plus
// following the OS while the preference is "system".
initTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Toasts and confirmations sit above auth so the login flow can use them too. */}
    <ToastProvider>
      <ConfirmProvider>
        {/* One provider for the whole app. It used to be mounted separately in
            the tools rail and the sidebar, so the shared open delay and the
            skip-delay grace period did not carry between them — and any
            tooltip outside those two subtrees had no provider at all. */}
        <TooltipProvider delayDuration={300}>
          <AuthProvider>
            <App />
          </AuthProvider>
        </TooltipProvider>
      </ConfirmProvider>
    </ToastProvider>
  </StrictMode>,
)
