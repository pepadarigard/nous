import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { isTauri } from './lib/api'
import { demoData } from './lib/demo'
import { checkScoring } from './data/scoring'
import { checkAgainstDemo } from './data/spelling'

// Демо-режим (только браузер, для скриншотов/разработки): ?demo=1 сеет наглядные данные.
if (!isTauri && new URLSearchParams(window.location.search).has('demo')) {
  localStorage.setItem('ege_planner_state_v1', JSON.stringify(demoData()))
}

// Сверка встроенных данных с официальными материалами ФИПИ — при разработке.
// Ошибка в весах задания или в букве слова тихо испортила бы и балл, и задания,
// а ни компилятор, ни линтер такого не видят. В сборку эти проверки не попадают:
// import.meta.env.DEV — константа, и минификатор вырезает блок целиком.
if (import.meta.env.DEV) {
  const problems = [...checkScoring(), ...checkAgainstDemo()]
  if (problems.length) console.warn('Данные разошлись с ФИПИ:\n' + problems.join('\n'))
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
