import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { initPwaInstallCapture } from './hooks/usePwa'

// Capture `beforeinstallprompt` as early as possible before route transitions.
initPwaInstallCapture()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

// PWA: register the service worker so `beforeinstallprompt` and offline shell
// work across production builds and dev/preview environments.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* installability is progressive enhancement — ignore failures */
    })
  })
}
