import { useState } from 'react'
import { useStore } from '../store'
import { buildPlanPrompt, importPlan } from '../lib/ai'
import { Copy, ArrowRight, ExternalLink } from 'lucide-react'
import { openExternal } from '../lib/api'

// Получить/обновить план от внешнего ИИ: промт → копировать → вставить ответ → разложить.
export default function PlanImporter({ onDone }: { onDone: () => void }) {
  const store = useStore()
  const [copied, setCopied] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const prompt = buildPlanPrompt({
    subjects: store.data.subjects,
    goals: store.data.goals,
    schedules: store.data.schedules,
    examDate: store.data.examDate,
    studentName: store.data.studentName,
    notes: store.data.planNotes,
  })

  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = prompt
      document.body.appendChild(ta)
      ta.select()
      try {
        document.execCommand('copy')
      } catch {
        /* ignore */
      }
      document.body.removeChild(ta)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  async function importIt() {
    if (!text.trim() || busy) return
    setError('')
    setBusy('Раскладываю план…')
    try {
      const res = await importPlan(store.data.config, text.trim(), (m) => setBusy(m))
      if (!res.blocks.length) {
        setError('Не удалось разобрать. Проверь, что вставил ответ ИИ целиком.')
        setBusy('')
        return
      }
      const subs = res.subjects.length ? res.subjects : store.data.subjects
      store.setSubjects(subs)
      if (!store.data.schedules.length) {
        store.setSchedules(subs.map((id) => ({ subjectId: id, hoursPerWeek: 6, days: [1, 2, 3, 4, 5] })))
      }
      store.setPlan({ createdAt: new Date().toISOString(), examDate: store.data.examDate, overview: res.overview, blocks: res.blocks })
      setBusy('')
      onDone()
    } catch (e: any) {
      setError('Ошибка: ' + (e?.message || 'не удалось разобрать'))
      setBusy('')
    }
  }

  const chip = (n: string) => (
    <span className="chip" style={{ background: 'var(--accent-soft)', color: 'var(--accent-text)', borderColor: 'transparent' }}>{n}</span>
  )

  return (
    <div>
      <div className="row" style={{ gap: 8 }}>
        {chip('Шаг 1')}
        <h3 style={{ margin: 0 }}>Скопируй промт и вставь его в ИИ</h3>
      </div>
      <p className="muted small" style={{ marginTop: 6 }}>
        Открой сильный ИИ (ChatGPT, DeepSeek и т.п.), вставь промт, получи план.
        <a href="https://chatgpt.com" onClick={(e) => { e.preventDefault(); openExternal('https://chatgpt.com') }} style={{ marginLeft: 8 }}>
          ChatGPT <ExternalLink size={12} style={{ verticalAlign: -1 }} />
        </a>
      </p>
      <textarea
        className="input"
        readOnly
        value={prompt}
        rows={7}
        onFocus={(e) => e.currentTarget.select()}
        style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12.5, background: 'var(--panel-2)' }}
      />
      <div className="row" style={{ margin: '10px 0 22px' }}>
        <button className="btn btn-primary" onClick={copy}>
          <Copy size={15} /> {copied ? 'Скопировано ✓' : 'Скопировать промт'}
        </button>
      </div>

      <div className="row" style={{ gap: 8 }}>
        {chip('Шаг 2')}
        <h3 style={{ margin: 0 }}>Вставь ответ ИИ или свой план</h3>
      </div>
      <p className="muted small" style={{ marginTop: 6 }}>Вставь ответ ИИ ИЛИ сразу свой готовый план (в любом виде) — приложение разложит его по календарю.</p>
      <textarea
        className="input"
        rows={7}
        placeholder="Вставь ответ ИИ или свой план…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        style={{ resize: 'vertical' }}
      />
      {busy && (
        <div className="row" style={{ marginTop: 10, gap: 10 }}>
          <div className="spin" style={{ width: 20, height: 20, borderWidth: 3 }} />
          <span className="muted small">{busy}</span>
        </div>
      )}
      {error && <p className="small" style={{ color: 'var(--danger)' }}>{error}</p>}
      <div className="row" style={{ marginTop: 16 }}>
        <div className="spacer" />
        <button className="btn btn-primary btn-lg" disabled={!text.trim() || !!busy} onClick={importIt}>
          Разложить план <ArrowRight size={16} />
        </button>
      </div>
    </div>
  )
}
