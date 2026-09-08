import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { StoreProvider } from './lib/store'
import { aplicarTemaSalvo } from './lib/tema'
import './styles.css'

// antes de montar a tela, para nao piscar um tema e trocar para o outro
aplicarTemaSalvo()

// service worker: deixa o app instalavel no celular e abrir mesmo sem sinal
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    // a versao vai na URL: quando muda, o navegador troca o service worker e o
    // cache antigo e descartado, em vez de servir uma versao velha para sempre
    void navigator.serviceWorker.register(
      `${import.meta.env.BASE_URL}sw.js?v=${__VERSAO__}`,
      { scope: import.meta.env.BASE_URL },
    )
  })
}

// o app assumiu: a tela de resgate do index.html sai de cena
clearTimeout((window as unknown as { __bootTimer?: number }).__bootTimer)
document.getElementById('boot')?.remove()

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <StoreProvider>
      <App />
    </StoreProvider>
  </React.StrictMode>,
)
