import { useState } from 'react'
import { useStore } from '../store'
import { extendPlan, editPlan } from '../lib/ai'
import { humanError } from '../lib/api'
import { Wand2, RefreshCw, Shuffle } from 'lucide-react'

type Mode = 'add' | 'edit'

// «Изменить план»: дополнить новыми занятиями ИЛИ переделать существующее (порядок, наполнение, состав).
export default function PlanExtender({ onDone }: { onDone: () => void }) {
  const store = useStore()
  const plan = store.data.plan
  const [mode, setMode] = useState<Mode>('add')
  const [wish, setWish] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [resultMsg, setResultMsg] = useState('')

  async function run() {
    if (!wish.trim() || busy || !plan) return
    setError('')
    setResultMsg('')
    try {
      if (mode === 'add') {
        setBusy('ИИ дополняет план…')
        const blocks = await extendPlan(store.data.config, plan, wish.trim(), (m) => setBusy(m))
        if (!blocks.length) {
          setError('ИИ не вернул новых занятий. Переформулируй пожелание конкретнее.')
          setBusy('')
          return
        }
        const n = blocks.reduce((s, b) => s + b.lessons.length, 0)
        store.appendBlocks(blocks)
        store.ensureSubjectSetup([...new Set(blocks.map((b) => b.subjectId))])
        setResultMsg(`Добавлено занятий: ${n}. Они появились в конце плана.`)
      } else {
        setBusy('ИИ переделывает план…')
        const blocks = await editPlan(store.data.config, plan, wish.trim(), (m) => setBusy(m))
        const n = blocks.reduce((s, b) => s + b.lessons.length, 0)
        const kept = blocks.reduce((s, b) => s + b.lessons.filter((l) => l.done).length, 0)
        store.setPlanBlocks(blocks)
        store.ensureSubjectSetup([...new Set(blocks.map((b) => b.subjectId))])
        setResultMsg(`План переделан: теперь ${n} занятий${kept ? `, выполненные сохранены (${kept})` : ''}. Раскладка по дням началась заново с сегодня.`)
      }
      setWish('')
      setBusy('')
    } catch (e) {
      setError('Ошибка: ' + humanError(e))
      setBusy('')
    }
  }

  if (!plan) {
    return <p className="muted">Сначала создай план — тогда его можно будет изменить.</p>
  }

  return (
    <div>
      <div className="seg" style={{ marginBottom: 14 }}>
        <button className={'seg-btn' + (mode === 'add' ? ' on' : '')} onClick={() => setMode('add')}>
          <Wand2 size={15} /> Дополнить
        </button>
        <button className={'seg-btn' + (mode === 'edit' ? ' on' : '')} onClick={() => setMode('edit')}>
          <Shuffle size={15} /> Переделать
        </button>
      </div>

      {mode === 'add' ? (
        <p className="muted small" style={{ marginTop: 0 }}>
          Напиши, что <b>добавить</b> — ИИ дополнит план новыми занятиями, ничего не трогая.
          Например: «добавь еженедельный пробник по информатике» или «больше практики по стереометрии».
        </p>
      ) : (
        <p className="muted small" style={{ marginTop: 0 }}>
          Напиши, что <b>изменить</b> — ИИ может менять наполнение занятий, порядок, удалять и заменять блоки.
          Например: «сделай меньше теории и больше практики», «поставь орфографию раньше пунктуации», «распиши задания подробнее».
          Выполненные занятия не потеряются.
        </p>
      )}

      <textarea
        className="input"
        rows={3}
        placeholder={mode === 'add' ? 'Что добавить в план?' : 'Что изменить в плане?'}
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
      {resultMsg && !busy && (
        <div className="row" style={{ marginTop: 14, gap: 8 }}>
          <span className="chip" style={{ background: 'var(--accent-soft)', color: 'var(--accent-text)', borderColor: 'transparent' }}>Готово ✓</span>
          <span className="small">{resultMsg}</span>
        </div>
      )}
      {error && <p className="small" style={{ color: 'var(--danger)' }}>{error}</p>}

      <div className="row" style={{ marginTop: 18, gap: 10 }}>
        {resultMsg && <button className="btn btn-ghost" onClick={onDone}>Закрыть</button>}
        <div className="spacer" />
        <button className="btn btn-primary btn-lg" disabled={!wish.trim() || !!busy} onClick={run}>
          {mode === 'add'
            ? (resultMsg ? <><RefreshCw size={16} /> Дописать ещё</> : <><Wand2 size={16} /> Дописать план</>)
            : <><Shuffle size={16} /> Переделать план</>}
        </button>
      </div>
    </div>
  )
}
