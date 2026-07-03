import { useEffect } from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useStore } from './store'
import { checkApiKey } from './lib/api'
import { modelScore, pickBestModel } from './lib/models'
import Layout from './ui/Layout'
import Onboarding from './screens/Onboarding'
import Home from './screens/Home'
import PlanScreen from './screens/PlanScreen'
import ProgressScreen from './screens/ProgressScreen'
import Chat from './screens/Chat'
import Settings from './screens/Settings'
import Celebrations from './ui/Celebrations'

export default function App() {
  const loaded = useStore((s) => s.loaded)
  const onboarded = useStore((s) => s.data.onboarded)
  const init = useStore((s) => s.init)

  useEffect(() => {
    init()
  }, [init])

  // Одноразовый автоподбор самой умной модели для старых установок
  // (новые получают её ещё в онбординге). Срабатывает только при рабочей сети.
  useEffect(() => {
    if (!loaded) return
    const { config } = useStore.getState().data
    if (!config.apiKey || config.modelAutoPicked) return
    checkApiKey(config.apiKey).then((r) => {
      if (!r.ok || !r.models?.length) return // сеть/ключ подведёт — попробуем при следующем запуске
      const best = pickBestModel(r.models)
      const setConfig = useStore.getState().setConfig
      if (best && modelScore(best) > modelScore(config.textModel)) {
        setConfig({ textModel: best, modelAutoPicked: true })
      } else {
        setConfig({ modelAutoPicked: true })
      }
    })
  }, [loaded])

  if (!loaded) {
    return (
      <div className="center-wrap">
        <div className="spin" />
      </div>
    )
  }

  if (!onboarded) return <Onboarding />

  return (
    <>
      <HashRouter>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Home />} />
            <Route path="plan" element={<PlanScreen />} />
            <Route path="progress" element={<ProgressScreen />} />
            <Route path="chat" element={<Chat />} />
            <Route path="settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </HashRouter>
      <Celebrations />
    </>
  )
}
