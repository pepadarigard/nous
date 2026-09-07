import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { checkUpdate, downloadUpdate, installUpdate, type UpdateInfo } from '../lib/update'
import { isTauri, humanError, openExternal, saveState } from '../lib/api'
import { Download, Loader2, X, ArrowUpCircle } from 'lucide-react'

/**
 * Предложение обновиться.
 *
 * Проверка идёт САМА при запуске — раз в сутки, тихо. Если сети нет или релизов
 * ещё не выпускали, никто ничего не узнаёт: молчаливая неудача здесь правильная,
 * приложение работает и без обновлений.
 *
 * Обновление ставится целиком отсюда: скачали установщик, запустили, приложение
 * закрылось. Ходить на GitHub руками не нужно — ссылка остаётся только как
 * запасной путь, если в релизе не оказалось .exe.
 */

/** Как часто проверять. Чаще нет смысла: релизы выходят не по часам. */
const CHECK_EVERY_MS = 24 * 60 * 60 * 1000
const SEEN_KEY = 'nous_update_seen'
const CHECKED_KEY = 'nous_update_checked'

export default function UpdateBanner() {
  const data = useStore((s) => s.data)
  const [info, setInfo] = useState<UpdateInfo | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    const last = Number(localStorage.getItem(CHECKED_KEY) ?? 0)
    if (Date.now() - last < CHECK_EVERY_MS) return
    let alive = true
    // Не на первой секунде запуска: пусть приложение сначала покажется.
    const t = setTimeout(async () => {
      try {
        const got = await checkUpdate()
        localStorage.setItem(CHECKED_KEY, String(Date.now()))
        if (alive && got.newer) setInfo(got)
      } catch {
        /* сети нет или релизов ещё не было — это не повод беспокоить */
      }
    }, 2500)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [])

  if (!info || hidden) return null
  // «Потом» скрывает баннер до следующей версии, а не навсегда.
  if (localStorage.getItem(SEEN_KEY) === info.latest) return null

  async function update() {
    if (!info?.asset || busy) return
    setError('')
    try {
      // Перед подменой файлов кладём свежую копию данных. Установщик их не
      // трогает, но если обновление оборвётся — будет откуда взять.
      setBusy('Сохраняю данные…')
      await saveState(data, true)
      setBusy('Скачиваю обновление…')
      const path = await downloadUpdate(info.asset)
      setBusy('Запускаю установщик…')
      await installUpdate(path)
    } catch (e) {
      setError(humanError(e))
      setBusy('')
    }
  }

  const later = () => {
    localStorage.setItem(SEEN_KEY, info.latest)
    setHidden(true)
  }

  return (
    <div className="upd-banner">
      <ArrowUpCircle size={18} />
      <div style={{ flex: 1 }}>
        <b>Вышла версия {info.latest}</b>
        <div className="small">
          У тебя {info.current}.{' '}
          {isTauri && info.asset ? (
            'Обновлю сам: план, прогресс и банк заданий останутся на месте.'
          ) : (
            <>
              {isTauri ? 'В этом релизе нет установщика — ' : 'Ставится в приложении, а не в браузере — '}
              <a href={info.url} onClick={(e) => { e.preventDefault(); openExternal(info.url) }}>
                открыть страницу релиза
              </a>
              .
            </>
          )}
        </div>
        {error && <div className="small" style={{ color: 'var(--danger)', marginTop: 4 }}>{error}</div>}
      </div>
      {isTauri && info.asset && (
        <button className="btn btn-sm btn-primary" onClick={update} disabled={!!busy}>
          {busy ? <><Loader2 size={14} className="spin-ic" /> {busy}</> : <><Download size={14} /> Обновить</>}
        </button>
      )}
      {!busy && (
        <button className="btn btn-sm btn-ghost" onClick={later} title="Скрыть до следующей версии">
          <X size={14} /> Потом
        </button>
      )}
    </div>
  )
}
