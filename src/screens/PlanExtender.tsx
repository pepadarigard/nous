import { useState } from 'react'
import { useStore } from '../store'
import { extendPlan } from '../lib/ai'
import { humanError } from '../lib/api'
import { Wand2, RefreshCw } from 'lucide-react'

// «Дописать план» — в один клик дополняет СУЩЕСТВУЮЩИЙ план новыми занятиями по пожеланию ученика.
export default function PlanExtender({ onDone }: { onDone: () => void }) {
  const store = useStore()
  const plan = store.data.plan
  const [wish, setWish] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [addedN, setAddedN] = useState(0)

  async function run() {
    if (!wish.trim() || busy || !plan) return
    setError('')
    setAddedN(0)
    setBusy('ИИ дополняет план…')
    try {
      const blocks = await extendPlan(store.data.config, plan, wish.trim(), (m) => setBusy(m))
      if (!blocks.length) {
        setError('ИИ не вернул новых занятий. Переформулируй пожелание конкретнее и попробуй ещё раз.')
        setBusy('')
        return
      }
      const n = blocks.reduce((s, b) => s + b.lessons.length, 0)
      store.appendBlocks(blocks)
      store.ensureSubjectSetup([...new Set(blocks.map((b) => b.subjectId))])
      setAddedN(n)
      setWish('')
      setBusy('')
    } catch (e) {
      setError('Ошибка: ' + humanError(e))
      setBusy('')
    }
  }

  if (!plan) {
    return <p className="muted">Сначала создай план — тогда его можно будет дописать.</p>
  }

  return (
    <div>
      <p className="muted small" style={{ marginTop: 0 }}>
        Напиши обычными словами, что добавить — ИИ дополнит план новыми занятиями и <b>сохранит всё</b>, что уже есть.
        Например: «добавь еженедельный пробник по информатике» или «больше практики по стереометрии».
      </p>
      <textarea
        className="input"
        rows={3}
        placeholder="Что добавить в план?"
        value={wish}
        onChange={(e) => setWish(e.target.value)}
        style={{ resize: 'vertical' }}
      />

      {busy && (
        <div className="row" style={{ marginTop: 12, gap: 10 }}>
          <div className="spin" style={{ width: 20, height: 20, borderWidth: 3 }} />
          <span className="muted small">{busy}</span>
        </div>
      )}
      {addedN > 0 && !busy && (
        <div className="row" style={{ marginTop: 14, gap: 8 }}>
          <span className="chip" style={{ background: 'var(--accent-soft)', color: 'var(--accent-text)', borderColor: 'transparent' }}>Готово ✓</span>
          <span className="small">Добавлено занятий: <b>{addedN}</b>. Они появились в конце плана — можно дописать ещё или закрыть.</span>
        </div>
      )}
      {error && <p className="small" style={{ color: 'var(--danger)' }}>{error}</p>}

      <div className="row" style={{ marginTop: 18, gap: 10 }}>
        {addedN > 0 && <button className="btn btn-ghost" onClick={onDone}>Закрыть</button>}
        <div className="spacer" />
        <button className="btn btn-primary btn-lg" disabled={!wish.trim() || !!busy} onClick={run}>
          {addedN > 0 ? <><RefreshCw size={16} /> Дописать ещё</> : <><Wand2 size={16} /> Дописать план</>}
        </button>
      </div>
    </div>
  )
}
