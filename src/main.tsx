import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { App } from './App'
import './index.css'
import { requestPersistentStorage } from './lib/platform'
import { applyTheme } from './state/prefs'

applyTheme()
registerSW({ immediate: true })
void requestPersistentStorage()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
