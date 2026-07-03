import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { isTauri } from './lib/api'
import { demoData } from './lib/demo'

// Демо-режим (только браузер, для скриншотов/разработки): ?demo=1 сеет наглядные данные.
if (!isTauri && new URLSearchParams(window.location.search).has('demo')) {
  localStorage.setItem('ege_planner_state_v1', JSON.stringify(demoData()))
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
