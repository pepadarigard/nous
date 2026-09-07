// Пробник: весь вариант разом и под таймером.
//
// Зачем отдельно от тренажёра. Тренажёр меряет точность по номерам — это про «умею
// ли я вообще». Экзамен же проверяет ещё и то, что тренажёр не трогает: держишься ли
// ты четыре часа, успеваешь ли, не сыпешься ли к концу. Плюс пробник даёт замер по
// всей работе разом и тем самым калибрует оценку, которая обычно экстраполируется
// с нескольких проверенных номеров.
//
// Честность та же, что и везде: банк редко покрывает все номера, поэтому «набрано»
// показывается ОТ СОБРАННОГО варианта, а пересчёт на полную работу подписан отдельно.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { subjectById } from '../data/subjects'
import type { Question } from '../types'
import { SCORING, taskPoints, toTestScore } from '../data/scoring'
import { isCorrect } from '../lib/bank'
import { countOf, plural } from '../lib/plural'
import { Timer, Play, Flag, CheckCircle2, XCircle, MinusCircle } from 'lucide-react'
import TaskFigures from '../ui/TaskFigures'

type Phase = 'setup' | 'running' | 'done'

interface Slot {
  taskNo: number
  points: number
  question: Question
}

interface Outcome extends Slot {
  given: string
  verdict: boolean | null // null — эталона не было
  earned: number
}

/** Из банка — по одному заданию на каждый номер, что вообще встречается в работе. */
function buildVariant(questions: Question[], subjectId: string): Slot[] {
  const byNo = new Map<number, Question[]>()
  for (const q of questions) {
    if (q.subjectId !== subjectId || q.taskNo === undefined) continue
    if (!taskPoints(subjectId, q.taskNo)) continue // номера нет в этой работе
    const list = byNo.get(q.taskNo)
    if (list) list.push(q)
    else byNo.set(q.taskNo, [q])
  }
  return [...byNo.entries()]
    .map(([taskNo, list]) => ({
      taskNo,
      points: taskPoints(subjectId, taskNo),
      question: list[Math.floor(Math.random() * list.length)],
    }))
    .sort((a, b) => a.taskNo - b.taskNo)
}

function mmss(totalSec: number): string {
  const s = Math.max(0, totalSec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`
}

export default function Mock() {
  const data = useStore((s) => s.data)
  const recordAttempt = useStore((s) => s.recordAttempt)
  const recordMock = useStore((s) => s.recordMock)

  const questions = useMemo(() => data.questions ?? [], [data.questions])
  const mocks = data.mocks ?? []

  // Предметы, по которым есть и официальные веса, и хоть какие-то задания в банке.
  const subjects = useMemo(
    () => [...new Set(questions.map((q) => q.subjectId))].filter((id) => id in SCORING),
    [questions],
  )

  const [subject, setSubject] = useState('')
  const [phase, setPhase] = useState<Phase>('setup')
  const [slots, setSlots] = useState<Slot[]>([])
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [deadline, setDeadline] = useState(0)
  const [startedAt, setStartedAt] = useState(0)
  const [left, setLeft] = useState(0)
  const [outcome, setOutcome] = useState<Outcome[] | null>(null)

  const active = subject || subjects[0] || ''
  const scoring = SCORING[active]
  const preview = useMemo(() => (active ? buildVariant(questions, active) : []), [questions, active])
  const previewPoints = preview.reduce((n, s) => n + s.points, 0)
  // Время режем пропорционально собранной части: полные 235 минут на пять заданий —
  // не тренировка, а самообман.
  const previewMinutes =
    scoring && previewPoints
      ? Math.max(5, Math.round((scoring.minutes * previewPoints) / scoring.maxPrimary))
      : 0

  // Таймер: держим момент окончания, а не счётчик, — тогда он не врёт после сна вкладки.
  const finishRef = useRef<() => void>(() => {})
  useEffect(() => {
    if (phase !== 'running') return
    const tick = () => {
      const rest = Math.round((deadline - Date.now()) / 1000)
      setLeft(rest)
      if (rest <= 0) finishRef.current()
    }
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [phase, deadline])

  function start() {
    const variant = buildVariant(questions, active)
    if (!variant.length) return
    const points = variant.reduce((n, s) => n + s.points, 0)
    const minutes = Math.max(5, Math.round((scoring.minutes * points) / scoring.maxPrimary))
    setSlots(variant)
    setAnswers({})
    setOutcome(null)
    setStartedAt(Date.now())
    setDeadline(Date.now() + minutes * 60000)
    setPhase('running')
  }

  function finish() {
    setPhase('done')
    const res: Outcome[] = slots.map((s) => {
      const given = (answers[s.question.id] ?? '').trim()
      const verdict = given ? isCorrect(given, s.question.answer) : false
      return { ...s, given, verdict, earned: verdict === true ? s.points : 0 }
    })
    setOutcome(res)

    // Ответы уходят в общую историю: они кормят статистику, балл и повторение.
    for (const r of res) {
      if (!r.given) continue // не отвечал — это не попытка
      recordAttempt({
        questionId: r.question.id,
        subjectId: r.question.subjectId,
        taskNo: r.taskNo,
        answer: r.given,
        correct: r.verdict,
      })
    }

    const earned = res.reduce((n, r) => n + r.earned, 0)
    const ofPrimary = res.reduce((n, r) => n + r.points, 0)
    const share = ofPrimary ? earned / ofPrimary : 0
    recordMock({
      subjectId: active,
      primary: earned,
      ofPrimary,
      maxPrimary: scoring.maxPrimary,
      testScore: toTestScore(active, share * scoring.maxPrimary),
      count: res.length,
      minutes: Math.max(1, Math.round((Date.now() - startedAt) / 60000)),
    })
  }
  finishRef.current = finish

  if (!subjects.length) {
    return (
      <div className="empty">
        <div className="big">⏱️</div>
        <p>
          Пробник собирается из твоего банка заданий. Добавь задания хотя бы по одному предмету —
          и появится вариант с таймером и подсчётом первичного балла.
        </p>
      </div>
    )
  }

  // ---------- Итоги ----------
  if (phase === 'done' && outcome) {
    const earned = outcome.reduce((n, r) => n + r.earned, 0)
    const ofPrimary = outcome.reduce((n, r) => n + r.points, 0)
    const share = ofPrimary ? earned / ofPrimary : 0
    const full = share * scoring.maxPrimary
    const test = toTestScore(active, full)
    const partial = ofPrimary < scoring.maxPrimary
    const spent = Math.max(1, Math.round((Date.now() - startedAt) / 60000))

    return (
      <div className="fade-in">
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>Пробник пройден</h3>
          <div className="row wrap" style={{ gap: 20, alignItems: 'flex-end' }}>
            <div>
              <div style={{ fontSize: 34, fontWeight: 700, lineHeight: 1 }}>
                {earned} <span className="small muted" style={{ fontWeight: 400 }}>из {ofPrimary}</span>
              </div>
              <div className="small muted">первичных баллов за собранный вариант</div>
            </div>
            <div>
              <div style={{ fontSize: 34, fontWeight: 700, lineHeight: 1, color: 'var(--accent)' }}>≈{test}</div>
              <div className="small muted">тестовых, если весь экзамен пойдёт так же</div>
            </div>
            <div className="spacer" />
            <div className="small muted">
              {countOf(outcome.length, ['задание', 'задания', 'заданий'])} · {spent}{' '}
              {plural(spent, ['минута', 'минуты', 'минут'])}
            </div>
          </div>
          {partial && (
            <div className="info-banner" style={{ marginTop: 14 }}>
              <div className="small">
                Вариант собран из {countOf(outcome.length, ['номера', 'номеров', 'номеров'])} — это{' '}
                {Math.round((ofPrimary / scoring.maxPrimary) * 100)}% настоящей работы, а не полный
                экзамен. Тестовый балл выше — пересчёт по этой доле, не замер. Чем полнее банк, тем
                ближе цифра к правде.
              </div>
            </div>
          )}
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>Разбор по номерам</h3>
          {outcome.map((r) => (
            <div key={r.question.id} className="row wrap" style={{ gap: 10, padding: '9px 0', borderTop: '1px solid var(--line)' }}>
              <b style={{ minWidth: 42 }}>№{r.taskNo}</b>
              {r.verdict === true ? (
                <CheckCircle2 size={16} color="var(--success)" />
              ) : r.verdict === null ? (
                <MinusCircle size={16} color="var(--muted)" />
              ) : (
                <XCircle size={16} color="var(--danger)" />
              )}
              <span className="small" style={{ flex: 1, minWidth: 180 }}>
                {r.given ? <>твой ответ: <b>{r.given}</b></> : <span className="muted">без ответа</span>}
                {r.verdict === false && r.question.answer && <> · верно: <b>{r.question.answer}</b></>}
                {r.verdict === null && <span className="muted"> · эталона нет, проверь сам</span>}
              </span>
              <span className="small muted">
                {r.earned} из {r.points}
              </span>
            </div>
          ))}
        </div>

        <div className="row" style={{ marginTop: 16 }}>
          <button className="btn btn-primary" onClick={() => setPhase('setup')}>
            <Play size={15} /> Ещё пробник
          </button>
        </div>
      </div>
    )
  }

  // ---------- Прогон ----------
  if (phase === 'running') {
    const answered = slots.filter((s) => (answers[s.question.id] ?? '').trim()).length
    const soon = left <= 300
    return (
      <div className="fade-in">
        <div
          className="card"
          style={{ position: 'sticky', top: 0, zIndex: 5, marginBottom: 16, borderColor: soon ? 'var(--danger)' : undefined }}
        >
          <div className="row wrap" style={{ gap: 12 }}>
            <Timer size={18} color={soon ? 'var(--danger)' : 'var(--accent)'} />
            <b style={{ fontSize: 22, fontVariantNumeric: 'tabular-nums', color: soon ? 'var(--danger)' : undefined }}>
              {mmss(left)}
            </b>
            <span className="small muted">
              отвечено {answered} из {slots.length}
            </span>
            <div className="spacer" />
            <button className="btn btn-primary btn-sm" onClick={finish}>
              <Flag size={14} /> Завершить
            </button>
          </div>
        </div>

        {slots.map((s) => (
          <div className="card" key={s.question.id} style={{ marginBottom: 12 }}>
            <div className="row wrap" style={{ gap: 8, marginBottom: 6 }}>
              <span className="chip">№{s.taskNo}</span>
              <span className="small muted">
                {s.points} {plural(s.points, ['балл', 'балла', 'баллов'])}
              </span>
            </div>
            <div style={{ marginBottom: 8, whiteSpace: 'pre-wrap' }}>{s.question.text}</div>
            <TaskFigures images={s.question.images} />
            <input
              className="input"
              placeholder="ответ"
              value={answers[s.question.id] ?? ''}
              onChange={(e) => setAnswers({ ...answers, [s.question.id]: e.target.value })}
            />
          </div>
        ))}

        <div className="row" style={{ marginTop: 8, marginBottom: 24 }}>
          <div className="spacer" />
          <button className="btn btn-primary" onClick={finish}>
            <Flag size={15} /> Завершить пробник
          </button>
        </div>
      </div>
    )
  }

  // ---------- Настройка ----------
  return (
    <div className="fade-in">
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Пробник под таймером</h3>
        <p className="small muted" style={{ marginTop: 0 }}>
          Собираю вариант из твоего банка — по одному заданию на каждый номер. Время режу
          пропорционально: настоящий экзамен по этому предмету идёт{' '}
          {scoring ? scoring.minutes : 0} минут за всю работу.
        </p>

        <div className="row wrap" style={{ gap: 8, marginBottom: 14 }}>
          {subjects.map((id) => (
            <div
              key={id}
              className="chip"
              style={{
                cursor: 'pointer',
                ...(id === active
                  ? { borderColor: 'var(--accent)', background: 'var(--accent-soft)', color: 'var(--accent-text)' }
                  : {}),
              }}
              onClick={() => setSubject(id)}
            >
              {subjectById(id)?.emoji} {subjectById(id)?.short ?? id}
            </div>
          ))}
        </div>

        {preview.length === 0 ? (
          <p className="small muted">По этому предмету в банке нет заданий с номерами.</p>
        ) : (
          <>
            <div className="row wrap" style={{ gap: 14, marginBottom: 12 }}>
              <span className="small">
                В варианте: <b>{countOf(preview.length, ['задание', 'задания', 'заданий'])}</b>
              </span>
              <span className="small">
                Максимум: <b>{previewPoints}</b> из {scoring.maxPrimary} первичных
              </span>
              <span className="small">
                Время: <b>{previewMinutes}</b> {plural(previewMinutes, ['минута', 'минуты', 'минут'])}
              </span>
            </div>
            <button className="btn btn-primary btn-lg" onClick={start}>
              <Play size={16} /> Начать пробник
            </button>
          </>
        )}
      </div>

      {mocks.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3 style={{ marginTop: 0 }}>Прошлые пробники</h3>
          {[...mocks]
            .reverse()
            .slice(0, 10)
            .map((m) => (
              <div key={m.id} className="row wrap" style={{ gap: 10, padding: '8px 0', borderTop: '1px solid var(--line)' }}>
                <span className="small muted" style={{ minWidth: 92 }}>
                  {new Date(m.at).toLocaleDateString('ru-RU')}
                </span>
                <span className="chip">{subjectById(m.subjectId)?.short ?? m.subjectId}</span>
                <span className="small">
                  {m.primary} из {m.ofPrimary} первичных
                </span>
                <div className="spacer" />
                <b>≈{m.testScore}</b>
              </div>
            ))}
        </div>
      )}
    </div>
  )
}
