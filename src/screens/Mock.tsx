// Пробник: весь вариант разом и под таймером.
//
// Зачем отдельно от тренажёра. Тренажёр меряет точность по номерам — это про «умею
// ли я вообще». Экзамен же проверяет ещё и то, что тренажёр не трогает: держишься ли
// ты четыре часа, успеваешь ли, не сыпешься ли к концу. Плюс пробник даёт замер по
// всей работе разом и тем самым калибрует оценку, которая обычно экстраполируется
// с нескольких проверенных номеров.
//
// Откуда берётся вариант. Либо скачан целиком с Решу ЕГЭ — тогда это настоящая
// работа: те же номера, тот же порядок, задания подобраны друг к другу. Либо
// собран из банка по одному заданию на номер — это ближе к тренировке, но работает
// и без скачанных вариантов.
//
// Честность та же, что и везде: собранный из банка вариант редко покрывает всю
// работу, поэтому «набрано» показывается ОТ СОБРАННОГО, а пересчёт на полный
// экзамен подписан отдельно.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { subjectById } from '../data/subjects'
import type { ExamVariant, Question } from '../types'
import { SCORING, taskPoints, toTestScore } from '../data/scoring'
import { isPart2, part2Label } from '../data/egeTasks'
import { fitsBlank, isCorrect } from '../lib/bank'
import { countOf, plural } from '../lib/plural'
import { Timer, Play, Flag, CheckCircle2, XCircle, MinusCircle, ScrollText, Trash2 } from 'lucide-react'
import TaskFigures from '../ui/TaskFigures'
import CellAnswer from '../ui/CellAnswer'

type Phase = 'setup' | 'running' | 'check' | 'done'

interface Slot {
  taskNo: number
  points: number
  question: Question
  /** Развёрнутый ответ: одного верного нет, оценивают по критериям. */
  part2: boolean
  /**
   * Автоматически проверить нельзя — балл ставит сам ученик по разбору.
   *
   * Это не только вторая часть. Бывает задание с кратким ответом, у которого
   * эталона нет вовсе, и бывает ответ, который в бланк не помещается (у
   * информатики в задании 25 их двенадцать штук). Сравнивать такое посимвольно
   * — значит объявлять ученику «неверно» там, где он всё решил.
   */
  selfCheck: boolean
}

interface Outcome extends Slot {
  given: string
  verdict: boolean | null // null — эталона не было
  earned: number
}

function slot(subjectId: string, taskNo: number, question: Question): Slot {
  const part2 = isPart2(subjectId, taskNo)
  return {
    taskNo,
    points: taskPoints(subjectId, taskNo),
    question,
    part2,
    selfCheck: part2 || !fitsBlank(question.answer),
  }
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
    .map(([taskNo, list]) => slot(subjectId, taskNo, list[Math.floor(Math.random() * list.length)]))
    .sort((a, b) => a.taskNo - b.taskNo)
}

/**
 * Скачанный вариант — в задания.
 *
 * Порядок берём ИЗ ВАРИАНТА, а не сортируем по номеру: на экзамене работа идёт
 * так, как её составили. И номер берём из варианта же, а не из задания: одно и
 * то же задание может лежать в банке под своим номером, а в этой работе стоять
 * на другом месте — балл считается по месту. Задание, которого в банке уже нет,
 * просто пропускаем: дырка лучше, чем пустая карточка.
 */
function variantSlots(v: ExamVariant, byId: Map<string, Question>): Slot[] {
  const out: Slot[] = []
  for (let i = 0; i < v.questionIds.length; i++) {
    const q = byId.get(v.questionIds[i])
    if (!q) continue
    out.push(slot(v.subjectId, v.taskNos?.[i] ?? i + 1, q))
  }
  return out
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
  const removeVariant = useStore((s) => s.removeVariant)

  const questions = useMemo(() => data.questions ?? [], [data.questions])
  const mocks = data.mocks ?? []
  const byId = useMemo(() => new Map(questions.map((q) => [q.id, q])), [questions])

  // Предметы, по которым есть и официальные веса, и хоть какие-то задания в банке.
  const subjects = useMemo(
    () => [...new Set(questions.map((q) => q.subjectId))].filter((id) => id in SCORING),
    [questions],
  )

  const [subject, setSubject] = useState('')
  const [pickedId, setPickedId] = useState('') // выбранный скачанный вариант ('' — собрать из банка)
  const [phase, setPhase] = useState<Phase>('setup')
  const [slots, setSlots] = useState<Slot[]>([])
  const [title, setTitle] = useState('')
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [self, setSelf] = useState<Record<string, number>>({}) // самопроверка второй части
  const [deadline, setDeadline] = useState(0)
  const [startedAt, setStartedAt] = useState(0)
  const [spentMin, setSpentMin] = useState(0)
  const [left, setLeft] = useState(0)
  const [outcome, setOutcome] = useState<Outcome[] | null>(null)

  const active = subject || subjects[0] || ''
  const scoring = SCORING[active]
  const ready = useMemo(
    () => (data.variants ?? []).filter((v) => v.subjectId === active),
    [data.variants, active],
  )
  const picked = ready.find((v) => v.id === pickedId)

  const preview = useMemo(
    () => (picked ? variantSlots(picked, byId) : active ? buildVariant(questions, active) : []),
    [picked, byId, questions, active],
  )
  const previewPoints = preview.reduce((n, s) => n + s.points, 0)
  // Время режем пропорционально собранной части: полные 235 минут на пять заданий —
  // не тренировка, а самообман. У целого варианта доля равна единице, и выходит
  // ровно столько, сколько идёт настоящий экзамен.
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
    const variant = preview
    if (!variant.length) return
    const points = variant.reduce((n, s) => n + s.points, 0)
    const minutes = Math.max(5, Math.round((scoring.minutes * points) / scoring.maxPrimary))
    setSlots(variant)
    setTitle(picked ? picked.title : 'Вариант из банка')
    setAnswers({})
    setSelf({})
    setOutcome(null)
    setSpentMin(0)
    setStartedAt(Date.now())
    setDeadline(Date.now() + minutes * 60000)
    setPhase('running')
  }

  /** На что ученик ответил, но машина проверить не может: он и ставит балл. */
  const toGrade = slots.filter((s) => s.selfCheck && (answers[s.question.id] ?? '').trim())

  /** Время кончилось или нажато «Завершить»: дальше либо самопроверка, либо итоги. */
  function stop() {
    const spent = Math.max(1, Math.round((Date.now() - startedAt) / 60000))
    setSpentMin(spent)
    if (toGrade.length) setPhase('check')
    else score({}, spent)
  }
  finishRef.current = stop

  /** Свести всё в результат. marks — баллы, которые ученик поставил себе за вторую часть. */
  function score(marks: Record<string, number>, minutes: number) {
    const res: Outcome[] = slots.map((s) => {
      const given = (answers[s.question.id] ?? '').trim()
      if (s.selfCheck) {
        // Тут нет одного верного ответа: есть шкала. Балл ставит ученик по
        // критериям, а «верно» считаем по тому же порогу, что и проверка ИИ.
        const earned = given ? Math.min(s.points, Math.max(0, marks[s.question.id] ?? 0)) : 0
        return { ...s, given, verdict: given ? earned >= s.points * 0.7 : false, earned }
      }
      const verdict = given ? isCorrect(given, s.question.answer) : false
      return { ...s, given, verdict, earned: verdict === true ? s.points : 0 }
    })
    setOutcome(res)
    setPhase('done')

    // Ответы уходят в общую историю: они кормят статистику, балл и повторение.
    for (const r of res) {
      if (!r.given) continue // не отвечал — это не попытка
      recordAttempt({
        questionId: r.question.id,
        subjectId: r.question.subjectId,
        taskNo: r.taskNo,
        answer: r.given.slice(0, 400),
        correct: r.verdict,
        ...(r.selfCheck ? { score: r.earned, maxScore: r.points } : {}),
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
      minutes: Math.max(1, minutes),
    })
  }

  if (!subjects.length) {
    return (
      <div className="empty">
        <div className="big">⏱️</div>
        <p>
          Пробник собирается из твоего банка заданий. Добавь задания хотя бы по одному предмету —
          или скачай целые варианты с Решу ЕГЭ в «Банке заданий».
        </p>
      </div>
    )
  }

  // ---------- Самопроверка того, что машина не считает ----------
  if (phase === 'check') {
    return (
      <div className="fade-in">
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>Оцени сам</h3>
          <p className="small muted" style={{ marginBottom: 0 }}>
            Эти задания посчитать автоматически нельзя: у развёрнутого ответа нет одного верного
            варианта — его оценивает эксперт по критериям. Ниже критерии и авторское решение:
            сверься и поставь себе балл честно. Заниженный балл не страшен, завышенный — испортит
            замер.
          </p>
        </div>

        {toGrade.map((s) => (
          <div className="card" key={s.question.id} style={{ marginBottom: 12 }}>
            <div className="row wrap" style={{ gap: 8, marginBottom: 8 }}>
              <span className="chip">№{s.taskNo}</span>
              {s.part2 && (
                <span className="chip chip-part2">
                  <ScrollText size={13} /> {part2Label(active, s.taskNo)}
                </span>
              )}
              <div className="spacer" />
              <span className="small muted">до {s.points} {plural(s.points, ['балла', 'баллов', 'баллов'])}</span>
            </div>
            <div className="q-text" style={{ marginBottom: 10 }}>{s.question.text}</div>
            <TaskFigures images={s.question.images} />

            <div className="card soft" style={{ marginBottom: 10 }}>
              <div className="small muted" style={{ marginBottom: 4 }}>Что ты написал</div>
              <div className="sol-body">{answers[s.question.id]}</div>
            </div>

            {/* Эталон есть не всегда, но если есть — это и есть главное, с чем
                сверяться: у таких заданий ответ просто не влез в бланк. */}
            {s.question.answer && (
              <div className="small" style={{ marginBottom: 8 }}>
                Верный ответ: <b>{s.question.answer.split('|')[0]}</b>
              </div>
            )}
            {s.question.criteria && (
              <details style={{ marginBottom: 8 }}>
                <summary className="small" style={{ cursor: 'pointer' }}>Критерии оценивания</summary>
                <div className="sol-body" style={{ marginTop: 6 }}>{s.question.criteria}</div>
              </details>
            )}
            {s.question.solution && (
              <details style={{ marginBottom: 10 }}>
                <summary className="small" style={{ cursor: 'pointer' }}>Авторское решение</summary>
                <div className="sol-body" style={{ marginTop: 6 }}>{s.question.solution}</div>
              </details>
            )}

            {/* У сочинения шкала до 22 баллов — рядом кнопок её не уложить,
                поэтому длинные шкалы показываем списком. */}
            <div className="row wrap" style={{ gap: 6 }}>
              <span className="small">Мой балл:</span>
              {s.points <= 6 ? (
                Array.from({ length: s.points + 1 }, (_, i) => i).map((n) => (
                  <button
                    key={n}
                    className="chip"
                    style={
                      (self[s.question.id] ?? 0) === n
                        ? { borderColor: 'var(--accent)', background: 'var(--accent-soft)', color: 'var(--accent-text)' }
                        : undefined
                    }
                    onClick={() => setSelf({ ...self, [s.question.id]: n })}
                  >
                    {n}
                  </button>
                ))
              ) : (
                <select
                  className="input"
                  style={{ width: 110, display: 'inline-block' }}
                  value={self[s.question.id] ?? 0}
                  onChange={(e) => setSelf({ ...self, [s.question.id]: Number(e.target.value) })}
                >
                  {Array.from({ length: s.points + 1 }, (_, i) => i).map((n) => (
                    <option key={n} value={n}>{n} из {s.points}</option>
                  ))}
                </select>
              )}
            </div>
          </div>
        ))}

        <div className="row" style={{ marginTop: 8, marginBottom: 24 }}>
          <div className="spacer" />
          <button className="btn btn-primary btn-lg" onClick={() => score(self, spentMin || 1)}>
            <CheckCircle2 size={16} /> Посчитать результат
          </button>
        </div>
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
    const spent = spentMin || 1

    return (
      <div className="fade-in">
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>{title} — пройден</h3>
          <div className="row wrap" style={{ gap: 20, alignItems: 'flex-end' }}>
            <div>
              <div style={{ fontSize: 34, fontWeight: 700, lineHeight: 1 }}>
                {earned} <span className="small muted" style={{ fontWeight: 400 }}>из {ofPrimary}</span>
              </div>
              <div className="small muted">первичных баллов за этот вариант</div>
            </div>
            <div>
              <div style={{ fontSize: 34, fontWeight: 700, lineHeight: 1, color: 'var(--accent)' }}>≈{test}</div>
              <div className="small muted">
                {partial ? 'тестовых, если весь экзамен пойдёт так же' : 'тестовых по официальной шкале'}
              </div>
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
                Вариант покрывает {Math.round((ofPrimary / scoring.maxPrimary) * 100)}% настоящей
                работы, а не весь экзамен. Тестовый балл — пересчёт по этой доле, не замер. Чтобы
                получить честную цифру, скачай целый вариант в «Банке заданий».
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
                {!r.given ? (
                  <span className="muted">без ответа</span>
                ) : r.selfCheck ? (
                  <>оценил сам: <b>{r.earned}</b> из {r.points}</>
                ) : (
                  <>твой ответ: <b>{r.given}</b></>
                )}
                {!r.selfCheck && r.verdict === false && r.question.answer && (
                  <> · верно: <b>{r.question.answer.split('|')[0]}</b></>
                )}
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
            <button className="btn btn-primary btn-sm" onClick={stop}>
              <Flag size={14} /> Завершить
            </button>
          </div>
        </div>

        {slots.map((s, i) => (
          <div className="card" key={s.question.id} style={{ marginBottom: 12 }}>
            <div className="row wrap" style={{ gap: 8, marginBottom: 8 }}>
              <span className="chip">№{s.taskNo}</span>
              {s.part2 && (
                <span className="chip chip-part2">
                  <ScrollText size={13} /> {part2Label(active, s.taskNo)}
                </span>
              )}
              {s.points > 0 && (
                <span className="small muted">
                  {s.points} {plural(s.points, ['балл', 'балла', 'баллов'])}
                </span>
              )}
              <div className="spacer" />
              <span className="small muted">{i + 1} из {slots.length}</span>
            </div>
            <div className="q-text">{s.question.text}</div>
            <TaskFigures images={s.question.images} />
            {s.question.options && s.question.options.length > 0 && (
              <ul className="small" style={{ marginTop: 8 }}>
                {s.question.options.map((o, k) => <li key={k}>{o}</li>)}
              </ul>
            )}

            {s.selfCheck ? (
              <label className="field" style={{ marginTop: 14 }}>
                <span>Твой ответ</span>
                <div className="small muted" style={{ marginBottom: 6 }}>
                  Пиши на листе, как на экзамене, — сюда перенеси решение или его суть. После
                  таймера сверишь с критериями и поставишь себе балл.
                </div>
                <textarea
                  className="input"
                  rows={4}
                  value={answers[s.question.id] ?? ''}
                  onChange={(e) => setAnswers({ ...answers, [s.question.id]: e.target.value })}
                />
              </label>
            ) : (
              <div className="field" style={{ marginTop: 14 }}>
                <span>Твой ответ</span>
                <CellAnswer
                  value={answers[s.question.id] ?? ''}
                  onChange={(v) => setAnswers({ ...answers, [s.question.id]: v })}
                />
              </div>
            )}
          </div>
        ))}

        <div className="row" style={{ marginTop: 8, marginBottom: 24 }}>
          <div className="spacer" />
          <button className="btn btn-primary" onClick={stop}>
            <Flag size={15} /> Завершить пробник
          </button>
        </div>
      </div>
    )
  }

  // ---------- Настройка ----------
  const part2Count = preview.filter((s) => s.part2).length
  return (
    <div className="fade-in">
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Пробник под таймером</h3>
        <p className="small muted" style={{ marginTop: 0 }}>
          Настоящий экзамен по этому предмету идёт {scoring ? scoring.minutes : 0} минут за всю
          работу. Целый вариант получает всё это время; собранный из банка — столько, сколько
          весит собранная часть.
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
              onClick={() => { setSubject(id); setPickedId('') }}
            >
              {subjectById(id)?.emoji} {subjectById(id)?.short ?? id}
            </div>
          ))}
        </div>

        {/* Выбор варианта. Скачанные идут первыми: это настоящая работа, а сборка
            из банка — запасной вариант, когда качать нечего или не хочется. */}
        <div className="row wrap" style={{ gap: 8, marginBottom: 14 }}>
          {ready.map((v) => (
            <div
              key={v.id}
              className="chip"
              style={{
                cursor: 'pointer',
                ...(v.id === pickedId
                  ? { borderColor: 'var(--accent)', background: 'var(--accent-soft)', color: 'var(--accent-text)' }
                  : {}),
              }}
              onClick={() => setPickedId(v.id)}
            >
              {v.title}
            </div>
          ))}
          <div
            className="chip"
            style={{
              cursor: 'pointer',
              ...(!pickedId
                ? { borderColor: 'var(--accent)', background: 'var(--accent-soft)', color: 'var(--accent-text)' }
                : {}),
            }}
            onClick={() => setPickedId('')}
          >
            Собрать из банка
          </div>
        </div>

        {!ready.length && (
          <p className="small muted" style={{ marginTop: -6 }}>
            Целых вариантов по этому предмету пока нет — их можно скачать с Решу ЕГЭ в «Банке
            заданий». Пока собираю вариант из банка: по одному заданию на каждый номер.
          </p>
        )}

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
              {part2Count > 0 && (
                <span className="small">
                  Вторая часть: <b>{part2Count}</b>
                </span>
              )}
            </div>
            <div className="row wrap" style={{ gap: 10 }}>
              <button className="btn btn-primary btn-lg" onClick={start}>
                <Play size={16} /> Начать пробник
              </button>
              {picked && (
                <button
                  className="btn btn-sm"
                  title="Убрать этот вариант из списка"
                  onClick={() => { removeVariant(picked.id); setPickedId('') }}
                >
                  <Trash2 size={14} /> Убрать вариант
                </button>
              )}
            </div>
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
