import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useStore } from '../store'
import { SUBJECTS, subjectById } from '../data/subjects'
import type { Attempt, Question } from '../types'
import { isCorrect, taskStats, trainingQueue } from '../lib/bank'
import { dueForReview } from '../lib/review'
import { todayISO } from '../lib/schedule'
import { countOf } from '../lib/plural'
import BankImport from './BankImport'
import SolutionCheck from './SolutionCheck'
import Mock from './Mock'
import Modal from '../ui/Modal'
import { Play, Plus, BarChart3, Trash2, Check, X, RotateCcw, ListChecks, Lightbulb, ScrollText, Timer } from 'lucide-react'

type Tab = 'train' | 'check' | 'mock' | 'bank' | 'stats'

const selChip = { borderColor: 'var(--accent)', background: 'var(--accent-soft)', color: 'var(--accent-text)' }

// Стабильные пустые массивы: `?? []` создавал новый массив на каждый рендер,
// из-за чего useMemo пересчитывался всегда, а селектор zustand дёргал перерисовку.
const NO_QUESTIONS: Question[] = []
const NO_ATTEMPTS: Attempt[] = []

export default function Trainer() {
  const data = useStore((s) => s.data)
  const [tab, setTab] = useState<Tab>('train')
  const [importOpen, setImportOpen] = useState(false)

  // Занятие плана открывает тренажёр уже настроенным: «Практика: задание № 7» ведёт
  // на /trainer?subject=russian&task=7, чтобы не искать номер руками.
  const [params] = useSearchParams()
  const fromPlan = {
    subject: params.get('subject') || 'all',
    taskNo: params.get('task') ? Number(params.get('task')) : ('all' as number | 'all'),
    review: params.get('mode') === 'review',
  }

  const questions = data.questions ?? NO_QUESTIONS
  const attempts = data.attempts ?? NO_ATTEMPTS

  return (
    <div className="fade-in">
      <div className="page-head">
        <h1>Тренажёр</h1>
        <p>
          Свой банк заданий и проверка ответов. Работает без интернета: ответ сверяется с эталоном прямо здесь,
          статистика копится по номерам заданий ЕГЭ.
        </p>
      </div>

      <div className="row wrap" style={{ gap: 8, marginBottom: 18 }}>
        <div className="seg">
          <button className={'seg-btn' + (tab === 'train' ? ' on' : '')} onClick={() => setTab('train')}><Play size={15} /> Решать</button>
          <button className={'seg-btn' + (tab === 'check' ? ' on' : '')} onClick={() => setTab('check')}><ScrollText size={15} /> Развёрнутый ответ</button>
          <button className={'seg-btn' + (tab === 'mock' ? ' on' : '')} onClick={() => setTab('mock')}><Timer size={15} /> Пробник</button>
          <button className={'seg-btn' + (tab === 'bank' ? ' on' : '')} onClick={() => setTab('bank')}><ListChecks size={15} /> Банк ({questions.length})</button>
          <button className={'seg-btn' + (tab === 'stats' ? ' on' : '')} onClick={() => setTab('stats')}><BarChart3 size={15} /> Статистика</button>
        </div>
        <div className="spacer" />
        <button className="btn btn-primary" onClick={() => setImportOpen(true)}><Plus size={15} /> Добавить задания</button>
      </div>

      {/* key: приход с новым номером из плана пересобирает вкладку с нужным фильтром */}
      {tab === 'train' && (
        <TrainTab
          key={fromPlan.subject + ':' + fromPlan.taskNo + ':' + fromPlan.review}
          questions={questions}
          initialSubject={fromPlan.subject}
          initialTaskNo={fromPlan.taskNo}
          initialReview={fromPlan.review}
        />
      )}
      {tab === 'check' && <SolutionCheck />}
      {tab === 'bank' && <BankTab questions={questions} />}
      {tab === 'mock' && <Mock />}
      {tab === 'stats' && <StatsTab />}

      {importOpen && (
        <Modal title="Добавить задания" onClose={() => setImportOpen(false)} wide>
          <BankImport onDone={() => setImportOpen(false)} />
        </Modal>
      )}
      {questions.length === 0 && tab === 'train' && (
        <div className="empty" style={{ marginTop: 10 }}>
          <div className="big">🎯</div>
          <p>Банк пуст. Загрузи свой файл с заданиями или разбери материал — и можно решать.</p>
          <button className="btn btn-primary" onClick={() => setImportOpen(true)}><Plus size={15} /> Добавить задания</button>
        </div>
      )}
      {attempts.length > 0 && tab === 'train' && (
        <p className="small muted" style={{ marginTop: 18 }}>
          Всего решено попыток: {attempts.length} · верно {attempts.filter((a) => a.correct).length}
        </p>
      )}
    </div>
  )
}

// ---------- Решать ----------

interface Session {
  queue: Question[]
  idx: number
  correct: number
  wrong: number
}

function TrainTab({
  questions,
  initialSubject = 'all',
  initialTaskNo = 'all',
  initialReview = false,
}: {
  questions: Question[]
  initialSubject?: string
  initialTaskNo?: number | 'all'
  initialReview?: boolean
}) {
  const data = useStore((s) => s.data)
  const recordAttempt = useStore((s) => s.recordAttempt)
  const attempts = data.attempts ?? NO_ATTEMPTS

  const [subject, setSubject] = useState(initialSubject)
  const [taskNo, setTaskNo] = useState<number | 'all'>(initialTaskNo)
  const [onlyWrong, setOnlyWrong] = useState(false)
  const [onlyDue, setOnlyDue] = useState(initialReview)
  const [session, setSession] = useState<Session | null>(null)
  const [given, setGiven] = useState('')
  const [verdict, setVerdict] = useState<boolean | null | 'unchecked'>('unchecked')

  const usedSubjects = useMemo(() => [...new Set(questions.map((q) => q.subjectId))], [questions])

  // Очередь повторения: порядок здесь ОСМЫСЛЕН (сначала самое просроченное),
  // поэтому её нельзя перемешивать, как обычную подборку.
  const dueIds = useMemo(() => {
    const cards = dueForReview(questions, attempts, todayISO(), 200)
    return new Map(cards.map((c, i) => [c.question.id, i]))
  }, [questions, attempts])

  const pool = useMemo(() => {
    let list = questions
    if (subject !== 'all') list = list.filter((q) => q.subjectId === subject)
    if (taskNo !== 'all') list = list.filter((q) => q.taskNo === taskNo)
    if (onlyWrong) {
      const bad = new Set(attempts.filter((a) => a.correct === false).map((a) => a.questionId))
      list = list.filter((q) => bad.has(q.id))
    }
    if (onlyDue) {
      list = list.filter((q) => dueIds.has(q.id)).sort((a, b) => dueIds.get(a.id)! - dueIds.get(b.id)!)
    }
    return list
  }, [questions, subject, taskNo, onlyWrong, onlyDue, dueIds, attempts])

  const taskNumbers = useMemo(() => {
    const list = subject === 'all' ? questions : questions.filter((q) => q.subjectId === subject)
    return [...new Set(list.map((q) => q.taskNo).filter((x): x is number => !!x))].sort((a, b) => a - b)
  }, [questions, subject])

  function start() {
    // В повторении очередь уже выстроена по срочности — перемешивать её нельзя.
    const queue = onlyDue ? pool.slice(0, 20) : trainingQueue(pool, attempts, 20)
    if (!queue.length) return
    setSession({ queue, idx: 0, correct: 0, wrong: 0 })
    setGiven('')
    setVerdict('unchecked')
  }

  const q = session ? session.queue[session.idx] : null

  function check() {
    if (!q || verdict !== 'unchecked') return
    const res = isCorrect(given, q.answer)
    setVerdict(res)
    if (res !== null) {
      recordAttempt({ questionId: q.id, subjectId: q.subjectId, taskNo: q.taskNo, answer: given, correct: res })
      setSession((s) => (s ? { ...s, correct: s.correct + (res ? 1 : 0), wrong: s.wrong + (res ? 0 : 1) } : s))
    }
  }

  // Задание без эталона: вердикт ставит сам ученик, глядя на разбор.
  function selfMark(ok: boolean) {
    if (!q) return
    recordAttempt({ questionId: q.id, subjectId: q.subjectId, taskNo: q.taskNo, answer: given, correct: ok })
    setSession((s) => (s ? { ...s, correct: s.correct + (ok ? 1 : 0), wrong: s.wrong + (ok ? 0 : 1) } : s))
    setVerdict(ok)
  }

  function next() {
    if (!session) return
    if (session.idx + 1 >= session.queue.length) {
      setSession({ ...session, idx: session.queue.length })
      return
    }
    setSession({ ...session, idx: session.idx + 1 })
    setGiven('')
    setVerdict('unchecked')
  }

  if (!questions.length) return null

  // Итог сессии
  if (session && session.idx >= session.queue.length) {
    const total = session.correct + session.wrong
    const pct = total ? Math.round((session.correct / total) * 100) : 0
    return (
      <div className="card" style={{ maxWidth: 560 }}>
        <h3 style={{ marginTop: 0 }}>{pct >= 80 ? '🎉 Отличный заход!' : pct >= 50 ? '👍 Неплохо' : '💪 Есть над чем поработать'}</h3>
        <p className="muted">
          Решено {countOf(total, ['задание', 'задания', 'заданий'])}, верно {session.correct} — это {pct}%.
        </p>
        <div className="row">
          <button className="btn btn-primary" onClick={start}><RotateCcw size={15} /> Ещё подход</button>
          <button className="btn btn-ghost" onClick={() => setSession(null)}>Закончить</button>
        </div>
      </div>
    )
  }

  if (session && q) {
    const s = subjectById(q.subjectId)
    const answered = verdict !== 'unchecked'
    return (
      <div className="card" style={{ maxWidth: 760 }}>
        <div className="row wrap" style={{ gap: 8, marginBottom: 12 }}>
          <span className="chip">{s?.emoji} {s?.short ?? q.subjectId}</span>
          {q.taskNo ? <span className="chip">задание №{q.taskNo}</span> : null}
          {q.topic ? <span className="chip">{q.topic}</span> : null}
          <div className="spacer" />
          <span className="small muted">{session.idx + 1} из {session.queue.length} · верно {session.correct}</span>
        </div>

        <div className="q-text">{q.text}</div>
        {q.options && q.options.length > 0 && (
          <ul className="small" style={{ marginTop: 8 }}>
            {q.options.map((o, i) => <li key={i}>{o}</li>)}
          </ul>
        )}

        <label className="field" style={{ marginTop: 14 }}>
          <span>Твой ответ</span>
          <input
            className="input"
            autoFocus
            value={given}
            disabled={answered}
            onChange={(e) => setGiven(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              if (answered) next()
              else check()
            }}
            placeholder="впиши ответ, как на экзамене"
          />
        </label>

        {verdict === true && <div className="verdict ok"><Check size={16} /> Верно!</div>}
        {verdict === false && (
          <div className="verdict bad">
            <X size={16} /> Мимо.{q.answer ? <> Правильный ответ: <b>{q.answer.split('|')[0]}</b></> : null}
          </div>
        )}
        {verdict === null && (
          <div className="verdict self">
            <Lightbulb size={16} />
            <div style={{ flex: 1 }}>
              У этого задания нет эталонного ответа — сверься с разбором и отметь сам.
              {q.solution && <div className="small" style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>{q.solution}</div>}
            </div>
            <button className="btn btn-sm" onClick={() => selfMark(true)}>Решил верно</button>
            <button className="btn btn-sm" onClick={() => selfMark(false)}>Ошибся</button>
          </div>
        )}
        {answered && verdict !== null && q.solution && (
          <div className="card soft" style={{ marginTop: 12 }}>
            <b className="small">Разбор</b>
            <div className="small" style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{q.solution}</div>
          </div>
        )}

        <div className="row" style={{ marginTop: 16 }}>
          <button className="btn btn-ghost" onClick={() => setSession(null)}>Прервать</button>
          <div className="spacer" />
          {!answered ? (
            <button className="btn btn-primary" onClick={check} disabled={!given.trim()}>Проверить</button>
          ) : (
            <button className="btn btn-primary" onClick={next}>Дальше →</button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="card" style={{ maxWidth: 720 }}>
      <h3 style={{ marginTop: 0 }}>Что решаем</h3>
      <div className="row wrap" style={{ gap: 6, marginBottom: 12 }}>
        <div className="chip" style={{ cursor: 'pointer', ...(subject === 'all' ? selChip : {}) }} onClick={() => { setSubject('all'); setTaskNo('all') }}>Все предметы</div>
        {SUBJECTS.filter((s) => usedSubjects.includes(s.id)).map((s) => (
          <div key={s.id} className="chip" style={{ cursor: 'pointer', ...(subject === s.id ? selChip : {}) }} onClick={() => { setSubject(s.id); setTaskNo('all') }}>
            {s.emoji} {s.short}
          </div>
        ))}
      </div>
      {taskNumbers.length > 0 && (
        <div className="row wrap" style={{ gap: 6, marginBottom: 12 }}>
          <div className="chip" style={{ cursor: 'pointer', ...(taskNo === 'all' ? selChip : {}) }} onClick={() => setTaskNo('all')}>Любое задание</div>
          {taskNumbers.map((n) => (
            <div key={n} className="chip" style={{ cursor: 'pointer', ...(taskNo === n ? selChip : {}) }} onClick={() => setTaskNo(n)}>№{n}</div>
          ))}
        </div>
      )}
      <label className="row" style={{ gap: 8, marginBottom: 8 }}>
        <input type="checkbox" checked={onlyWrong} onChange={(e) => setOnlyWrong(e.target.checked)} />
        <span className="small">только те, где ошибался</span>
      </label>
      <label className="row" style={{ gap: 8, marginBottom: 14 }}>
        <input type="checkbox" checked={onlyDue} onChange={(e) => setOnlyDue(e.target.checked)} />
        <span className="small">
          только на повторение сегодня{dueIds.size > 0 && <> — {dueIds.size}</>}
        </span>
      </label>
      <div className="row">
        <span className="small muted">подходит заданий: {pool.length}</span>
        <div className="spacer" />
        <button className="btn btn-primary btn-lg" disabled={!pool.length} onClick={start}><Play size={16} /> Начать</button>
      </div>
      <p className="small muted" style={{ marginBottom: 0, marginTop: 12 }}>
        В подход берётся до 20 заданий: сначала те, где ошибался, потом нерешённые.
      </p>
    </div>
  )
}

// ---------- Банк ----------

function BankTab({ questions }: { questions: Question[] }) {
  const removeQuestion = useStore((s) => s.removeQuestion)
  const updateQuestion = useStore((s) => s.updateQuestion)
  const [subject, setSubject] = useState('all')
  const [query, setQuery] = useState('')

  const shown = questions.filter((q) => {
    if (subject !== 'all' && q.subjectId !== subject) return false
    const t = query.trim().toLowerCase()
    return !t || q.text.toLowerCase().includes(t) || (q.answer ?? '').toLowerCase().includes(t)
  })
  const noAnswer = questions.filter((q) => !q.answer).length

  if (!questions.length) {
    return (
      <div className="empty">
        <div className="big">📥</div>
        <p>Банк пока пуст. Кнопка «Добавить задания» выше принимает твой файл, материал или ручной ввод.</p>
      </div>
    )
  }

  return (
    <div>
      <div className="row wrap" style={{ gap: 8, marginBottom: 14 }}>
        <input className="input" style={{ maxWidth: 340 }} placeholder="Поиск по банку…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="spacer" />
        <div className="row wrap" style={{ gap: 6 }}>
          <div className="chip" style={{ cursor: 'pointer', ...(subject === 'all' ? selChip : {}) }} onClick={() => setSubject('all')}>Все</div>
          {SUBJECTS.filter((s) => questions.some((q) => q.subjectId === s.id)).map((s) => (
            <div key={s.id} className="chip" style={{ cursor: 'pointer', ...(subject === s.id ? selChip : {}) }} onClick={() => setSubject(s.id)}>
              {s.emoji} {s.short}
            </div>
          ))}
        </div>
      </div>

      {noAnswer > 0 && (
        <p className="small" style={{ color: 'var(--warn)' }}>
          Без эталонного ответа: {noAnswer}. Такие задания придётся отмечать самому — впиши ответ прямо в списке, и проверка станет автоматической.
        </p>
      )}

      <div className="grid" style={{ gap: 8 }}>
        {shown.map((q) => (
          <div key={q.id} className="q-row">
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="row wrap" style={{ gap: 6, marginBottom: 4 }}>
                <span className="chip">{subjectById(q.subjectId)?.emoji} {subjectById(q.subjectId)?.short ?? q.subjectId}</span>
                {q.taskNo ? <span className="badge">№{q.taskNo}</span> : null}
                {q.topic ? <span className="small muted">{q.topic}</span> : null}
              </div>
              <div className="small" style={{ whiteSpace: 'pre-wrap' }}>{q.text.slice(0, 300)}{q.text.length > 300 ? '…' : ''}</div>
            </div>
            <input
              className="input"
              style={{ width: 150 }}
              defaultValue={q.answer ?? ''}
              placeholder="ответ"
              onBlur={(e) => updateQuestion(q.id, { answer: e.target.value.trim() || undefined })}
            />
            <button className="btn btn-ghost btn-sm" onClick={() => removeQuestion(q.id)} title="Удалить"><Trash2 size={14} /></button>
          </div>
        ))}
      </div>
      {shown.length === 0 && <p className="muted small">Ничего не нашлось.</p>}
    </div>
  )
}

// ---------- Статистика ----------

function StatsTab() {
  const attempts = useStore((s) => s.data.attempts ?? NO_ATTEMPTS)
  const stats = useMemo(() => taskStats(attempts), [attempts])

  if (!attempts.length) {
    return (
      <div className="empty">
        <div className="big">📊</div>
        <p>Статистика появится, как только решишь первые задания.</p>
      </div>
    )
  }

  const bySubject = new Map<string, typeof stats>()
  for (const st of stats) {
    const arr = bySubject.get(st.subjectId) ?? []
    arr.push(st)
    bySubject.set(st.subjectId, arr)
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      {[...bySubject.entries()].map(([sid, rows]) => {
        const s = subjectById(sid)
        const total = rows.reduce((n, r) => n + r.total, 0)
        const correct = rows.reduce((n, r) => n + r.correct, 0)
        return (
          <div className="card" key={sid}>
            <div className="row" style={{ marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>{s?.emoji} {s?.name ?? sid}</h3>
              <div className="spacer" />
              <span className="chip">{correct} из {total} верно</span>
            </div>
            {rows
              .slice()
              .sort((a, b) => (a.taskNo ?? 99) - (b.taskNo ?? 99))
              .map((r) => (
                <div className="row" key={String(r.taskNo)} style={{ gap: 12, padding: '6px 0' }}>
                  <span style={{ width: 96 }} className="small">
                    {r.taskNo ? 'Задание №' + r.taskNo : 'Без номера'}
                  </span>
                  <div className="pbar" style={{ flex: 1 }}>
                    <span style={{ width: r.pct + '%', background: r.pct >= 80 ? 'var(--success)' : r.pct >= 50 ? 'var(--warn)' : 'var(--danger)' }} />
                  </div>
                  <span className="small" style={{ width: 92, textAlign: 'right' }}>
                    {r.pct}% ({r.correct}/{r.total})
                  </span>
                </div>
              ))}
          </div>
        )
      })}
    </div>
  )
}
