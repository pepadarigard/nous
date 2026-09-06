import { useMemo, useState } from 'react'
import { useStore } from '../store'
import { subjectById } from '../data/subjects'
import { addDaysISO, buildAgenda, iso, overdueItems, todayISO, weekdayNum } from '../lib/schedule'
import { weakSpots } from '../lib/bank'
import { currentStreak } from '../lib/stats'
import { weeklyAdvice, type WeekAdvice } from '../lib/aiTutor'
import { aiReady } from '../lib/providers'
import { humanError } from '../lib/api'
import { mdToHtml } from '../lib/md'
import Modal from '../ui/Modal'
import PlanExtender from './PlanExtender'
import { ArrowDownToLine, Loader2, Sparkles, TrendingUp, Wand2 } from 'lucide-react'

function weekStartISO(dateISO: string): string {
  const d = new Date(dateISO)
  d.setDate(d.getDate() - (weekdayNum(d) - 1))
  return iso(d)
}

/**
 * Разбор недели. Цифры считаются ЗДЕСЬ, офлайн, и показываются всегда —
 * ИИ только комментирует готовые факты и предлагает, что менять. Без ключа
 * карточка остаётся полезной: цифры и кнопка «перенести просроченное» работают сами.
 */
export default function WeekReview() {
  const data = useStore((s) => s.data)
  const catchUpOverdue = useStore((s) => s.catchUpOverdue)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [advice, setAdvice] = useState<WeekAdvice | null>(null)
  const [moved, setMoved] = useState(0)
  const [extendOpen, setExtendOpen] = useState(false)

  const facts = useMemo(() => {
    if (!data.plan) return null
    const agenda = buildAgenda(data.plan, data.schedules, data.rules)
    const ws = weekStartISO(todayISO())
    const we = addDaysISO(ws, 6)
    let plannedWeek = 0
    let doneWeek = 0
    for (const d of agenda) {
      if (d.dateISO < ws || d.dateISO > we) continue
      plannedWeek += d.items.length
      doneWeek += d.items.filter((i) => i.lesson.done).length
    }
    const weak = weakSpots(data.attempts ?? [], 3).map((w) => ({
      subjectId: w.subjectId,
      taskNo: w.taskNo,
      pct: w.pct,
      total: w.total,
    }))
    return {
      plannedWeek,
      doneWeek,
      overdue: overdueItems(agenda).length,
      streak: currentStreak(data.progress, data.attempts ?? []),
      daysLeft: data.examDate ? Math.max(0, Math.ceil((new Date(data.examDate).getTime() - Date.now()) / 86400000)) : undefined,
      weak,
      subjects: data.goals.map((g) => ({ subjectId: g.subjectId, current: g.current, target: g.target })),
    }
  }, [data])

  if (!facts) return null
  const ready = aiReady(data.config)

  async function ask() {
    if (busy || !facts) return
    setBusy(true)
    setError('')
    try {
      setAdvice(await weeklyAdvice(data.config, facts))
    } catch (e) {
      setError(humanError(e))
    }
    setBusy(false)
  }

  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <div className="row wrap" style={{ gap: 10, marginBottom: 10 }}>
        <TrendingUp size={17} color="var(--accent)" />
        <h3 style={{ margin: 0, fontSize: 16 }}>Разбор недели</h3>
        <div className="spacer" />
        <button className="btn btn-sm" onClick={ask} disabled={busy || !ready} title={ready ? '' : 'Настрой ИИ в «Настройках»'}>
          {busy ? <><Loader2 size={14} className="spin-ic" /> Думаю…</> : <><Sparkles size={14} /> Спросить ИИ</>}
        </button>
      </div>

      <div className="row wrap" style={{ gap: 8 }}>
        <span className="chip">за неделю: {facts.doneWeek} из {facts.plannedWeek}</span>
        <span className="chip" style={facts.overdue ? { color: 'var(--warn)', borderColor: '#f3dfb6' } : undefined}>
          просрочено: {facts.overdue}
        </span>
        <span className="chip">серия: {facts.streak} 🔥</span>
        {facts.daysLeft !== undefined && <span className="chip">до ЕГЭ: {facts.daysLeft} дн.</span>}
      </div>

      {facts.weak.length > 0 && (
        <p className="small muted" style={{ marginTop: 10, marginBottom: 0 }}>
          Слабые места по тренажёру:{' '}
          {facts.weak
            .map((w) => (subjectById(w.subjectId)?.short ?? w.subjectId) + ' № ' + (w.taskNo ?? '?') + ' — ' + w.pct + '%')
            .join(' · ')}
        </p>
      )}

      {facts.overdue > 0 && (
        <div className="row wrap" style={{ gap: 10, marginTop: 12 }}>
          <button className="btn btn-sm" onClick={() => setMoved(catchUpOverdue())}>
            <ArrowDownToLine size={14} /> Перенести просроченное вперёд
          </button>
          {moved > 0 && <span className="small" style={{ color: 'var(--accent-text)' }}>✓ перенесено: {moved}</span>}
        </div>
      )}

      {error && <p className="small" style={{ color: 'var(--danger)' }}>{error}</p>}

      {advice && (
        <div style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          <div className="md-body" dangerouslySetInnerHTML={{ __html: mdToHtml(advice.verdict) }} />
          {advice.focus.length > 0 && (
            <>
              <b className="small">На чём сосредоточиться</b>
              <ul className="small" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {advice.focus.map((f, i) => <li key={i} style={{ marginBottom: 3 }}>{f}</li>)}
              </ul>
            </>
          )}
          {advice.wish && (
            <button className="btn btn-sm" style={{ marginTop: 12 }} onClick={() => setExtendOpen(true)}>
              <Wand2 size={14} /> Дописать план по этому
            </button>
          )}
        </div>
      )}

      {extendOpen && (
        <Modal title="Изменить план" onClose={() => setExtendOpen(false)}>
          <PlanExtender onDone={() => setExtendOpen(false)} initialWish={advice?.wish} />
        </Modal>
      )}
    </div>
  )
}
