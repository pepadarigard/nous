import { useState } from 'react'
import { useStore } from '../store'
import { buildPlanPrompt, importPlan, generatePlanInApp, type ImportResult } from '../lib/ai'
import { subjectById } from '../data/subjects'
import type { Block } from '../types'
import { Copy, ArrowRight, ExternalLink, PartyPopper, Zap, WifiOff } from 'lucide-react'
import { humanError, openExternal } from '../lib/api'
import { PRESETS, buildPresetPlan, presetCoverage, presetSize, suggestPreset } from '../lib/presets'
import { hasTaskMap } from '../data/egeTasks'
import { weakSpots } from '../lib/bank'
import { countOf } from '../lib/plural'

// Сводка по разложенному плану: сколько занятий и до какой даты его хватит по расписанию.
interface SummaryRow {
  subjectId: string
  total: number
  theory: number
  practice: number
  review: number
  endsText: string
  note?: string
}

// Получить/обновить план от внешнего ИИ: промт → копировать → вставить ответ → разложить.
export default function PlanImporter({ onDone }: { onDone: () => void }) {
  const store = useStore()
  const [copied, setCopied] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [summary, setSummary] = useState<SummaryRow[] | null>(null)

  function buildSummary(blocks: Block[]): SummaryRow[] {
    const bySub: Record<string, { total: number; theory: number; practice: number; review: number }> = {}
    for (const b of blocks) {
      const a = (bySub[b.subjectId] ||= { total: 0, theory: 0, practice: 0, review: 0 })
      for (const l of b.lessons) {
        a.total++
        a[l.kind]++
      }
    }
    const exam = store.data.examDate ? new Date(store.data.examDate) : null
    return Object.entries(bySub).map(([sid, c]) => {
      const sch = store.data.schedules.find((s) => s.subjectId === sid)
      const perWeek = sch?.days?.length || 5
      const weeks = Math.ceil(c.total / perWeek)
      const end = new Date()
      end.setDate(end.getDate() + weeks * 7)
      const endsText = end.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
      let note: string | undefined
      if (exam) {
        const gapDays = Math.round((exam.getTime() - end.getTime()) / 86400000)
        if (gapDays > 42) note = 'закончится сильно раньше экзамена — потом просто нажмёшь «Дописать план»'
        else if (gapDays < -7) note = 'занятий больше, чем влезает до экзамена — темп будет плотный'
      }
      return { subjectId: sid, ...c, endsText, note }
    })
  }

  const offlineSubjects = (store.data.subjects.length ? store.data.subjects : ['russian']).filter(hasTaskMap)

  // Сколько недель осталось — от этого зависит и что предложить, и влезет ли план.
  const weeksLeft = store.data.examDate
    ? Math.max(0, Math.ceil((new Date(store.data.examDate).getTime() - Date.now()) / (7 * 86400000)))
    : undefined
  const [preset, setPreset] = useState(() => suggestPreset(weeksLeft))
  const presetOpts = { subjects: offlineSubjects, examDate: store.data.examDate, weeksLeft }
  const offlineSize = offlineSubjects.length ? presetSize(preset, presetOpts) : 0
  const coverage = offlineSubjects.length ? presetCoverage(preset, presetOpts) : { covered: 0, max: 0 }

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

  function applyResult(res: ImportResult) {
    const subs = res.subjects.length ? res.subjects : store.data.subjects
    store.setSubjects(subs)
    store.ensureSubjectSetup(subs) // новым предметам — дефолтные цель и расписание
    store.setPlan({ createdAt: new Date().toISOString(), examDate: store.data.examDate, overview: res.overview, blocks: res.blocks })
    setSummary(buildSummary(res.blocks)) // сводка вместо мгновенного закрытия
  }

  // План без ИИ: по структуре КИМ. Работает всегда — без ключа, без сети, мгновенно.
  function buildOffline() {
    const subjects = (store.data.subjects.length ? store.data.subjects : ['russian']).filter(hasTaskMap)
    if (!subjects.length) return
    // Слабые места из тренажёра дают дополнительную практику по нужным номерам.
    const weakTaskNos: Record<string, number[]> = {}
    for (const w of weakSpots(store.data.attempts ?? [], 12)) {
      if (!w.taskNo) continue
      if (!weakTaskNos[w.subjectId]) weakTaskNos[w.subjectId] = []
      weakTaskNos[w.subjectId].push(w.taskNo)
    }
    const plan = buildPresetPlan(preset, {
      subjects,
      examDate: store.data.examDate,
      weeksLeft,
      weakTaskNos,
    })
    store.ensureSubjectSetup(subjects)
    store.setPlan(plan)
    setSummary(buildSummary(plan.blocks))
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
      applyResult(res)
      setBusy('')
    } catch (e) {
      setError('Ошибка: ' + humanError(e))
      setBusy('')
    }
  }

  async function generateIt() {
    if (busy) return
    setError('')
    setBusy('Готовлюсь…')
    try {
      const res = await generatePlanInApp(
        store.data.config,
        {
          subjects: store.data.subjects,
          goals: store.data.goals,
          schedules: store.data.schedules,
          examDate: store.data.examDate,
          studentName: store.data.studentName,
          notes: store.data.planNotes,
        },
        (m) => setBusy(m),
      )
      applyResult(res)
      setBusy('')
    } catch (e) {
      setError('Ошибка: ' + humanError(e))
      setBusy('')
    }
  }

  const chip = (n: string) => (
    <span className="chip" style={{ background: 'var(--accent-soft)', color: 'var(--accent-text)', borderColor: 'transparent' }}>{n}</span>
  )

  // Экран-сводка после успешной раскладки
  if (summary) {
    return (
      <div className="fade-in">
        <div className="row" style={{ gap: 10, marginBottom: 6 }}>
          <PartyPopper size={22} color="var(--accent)" />
          <h3 style={{ margin: 0 }}>План разложен по календарю!</h3>
        </div>
        <p className="muted small" style={{ marginTop: 4 }}>Вот что получилось. Оценки «до какой даты хватит» — по твоему расписанию занятий.</p>
        {summary.map((r) => {
          const s = subjectById(r.subjectId)
          return (
            <div className="card soft" key={r.subjectId} style={{ marginBottom: 10, padding: 14 }}>
              <div className="row" style={{ gap: 10 }}>
                <span style={{ fontSize: 20 }}>{s?.emoji || '📘'}</span>
                <b>{s?.short || r.subjectId}</b>
                <div className="spacer" />
                <span className="chip">{r.total} занятий</span>
              </div>
              <div className="row wrap small muted" style={{ marginTop: 8, gap: 12 }}>
                <span>📖 теория: {r.theory}</span>
                <span>✏️ практика: {r.practice}</span>
                <span>🔁 повторение: {r.review}</span>
                <div className="spacer" />
                <span>хватит примерно до <b style={{ color: 'var(--text)' }}>{r.endsText}</b></span>
              </div>
              {r.note && <p className="small" style={{ margin: '8px 0 0', color: 'var(--warn)' }}>💡 {r.note}</p>}
            </div>
          )
        })}
        <div className="row" style={{ marginTop: 16 }}>
          <div className="spacer" />
          <button className="btn btn-primary btn-lg" onClick={onDone}>Отлично, поехали 🚀</button>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="card soft" style={{ marginBottom: 18 }}>
        <div className="row" style={{ gap: 10, marginBottom: 6 }}>
          <WifiOff size={17} color="var(--accent)" />
          <b>Без ИИ и без интернета</b>
        </div>
        <p className="small muted" style={{ marginTop: 0 }}>
          Соберу план прямо здесь, по структуре экзамена. Выбери стратегию — они отличаются не
          оформлением, а тем, на что тратится время: номера берутся с учётом их веса в первичных
          баллах. Если в тренажёре уже копится статистика, по слабым номерам добавлю подход.
        </p>
        {offlineSubjects.length === 0 ? (
          <p className="small" style={{ color: 'var(--warn)', margin: 0 }}>
            Готовая структура пока есть для русского, профильной математики, информатики и физики —
            для твоих предметов собери план через ИИ или вставь свой.
          </p>
        ) : (
          <>
            <div className="grid" style={{ gap: 8, marginBottom: 12 }}>
              {PRESETS.map((p) => {
                const fits =
                  weeksLeft === undefined ||
                  ((p.minWeeks === undefined || weeksLeft >= p.minWeeks) &&
                    (p.maxWeeks === undefined || weeksLeft <= p.maxWeeks))
                return (
                  <button
                    key={p.id}
                    className={'pick-card' + (preset === p.id ? ' on' : '')}
                    style={preset === p.id ? { borderColor: 'var(--accent)', background: 'var(--accent-soft)' } : undefined}
                    onClick={() => setPreset(p.id)}
                  >
                    <div style={{ textAlign: 'left' }}>
                      <div className="row wrap" style={{ gap: 8 }}>
                        <b>{p.name}</b>
                        {!fits && (
                          <span className="badge" title="По сроку до экзамена этот план подходит хуже">
                            не по сроку
                          </span>
                        )}
                      </div>
                      <div className="small muted">{p.who}</div>
                      {preset === p.id && (
                        <div className="small" style={{ marginTop: 6 }}>{p.detail}</div>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
            <div className="row wrap" style={{ gap: 10 }}>
              <button className="btn btn-primary" onClick={buildOffline}>Собрать этот план</button>
              <span className="small muted">
                {offlineSubjects.map((id) => subjectById(id)?.short ?? id).join(', ')} ·{' '}
                {countOf(offlineSize, ['занятие', 'занятия', 'занятий'])} · закрывает{' '}
                <b>{coverage.covered}</b> из {coverage.max} первичных баллов
                {weeksLeft !== undefined && <> · до экзамена {countOf(weeksLeft, ['неделя', 'недели', 'недель'])}</>}
              </span>
            </div>
          </>
        )}
      </div>

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
      <div className="row" style={{ margin: '10px 0 14px' }}>
        <button className="btn btn-primary" onClick={copy}>
          <Copy size={15} /> {copied ? 'Скопировано ✓' : 'Скопировать промт'}
        </button>
      </div>

      <div className="row" style={{ gap: 10, margin: '0 0 8px' }}>
        <span className="small muted">или</span>
        <button className="btn" onClick={generateIt} disabled={!!busy}>
          <Zap size={15} /> Сгенерировать прямо в приложении
        </button>
        <span className="small muted">на твоём ключе Groq, ~минута на предмет</span>
      </div>
      {busy && (
        <div className="row" style={{ margin: '4px 0 10px', gap: 10 }}>
          <div className="spin" style={{ width: 18, height: 18, borderWidth: 3 }} />
          <span className="muted small">{busy}</span>
        </div>
      )}
      <div style={{ height: 8 }} />

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
