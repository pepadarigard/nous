// Диагностический срез: с чего вообще начинать.
//
// Зачем. Ученик ставит цель «восемьдесят баллов», и план строится из воздуха:
// приложение не знает, что он уже умеет. Получается подготовка ко всему сразу,
// а это самый дорогой способ готовиться. Замер меняет всё: после него видно
// карту «что беру, что нет», и «цена балла» начинает считать по фактам, а не
// молчать.
//
// Чем это НЕ является. Это не пробник: тут нет таймера и нет цели набрать балл.
// Задача одна — по разу дотронуться до каждого номера, чтобы стало понятно, где
// вообще стоять.
//
// Вторая часть спрашивается иначе. Решать сочинение и задачу с параметром ради
// замера — это ещё три часа, и человек бросит на середине. Поэтому там вопрос
// честный и быстрый: берёшься ли ты за это задание. Для карты умений этого
// достаточно, и ученик сам понимает, что оценил себя сам.

import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import type { Question } from '../types'
import { SCORING, taskPoints } from '../data/scoring'
import { EGE_TASKS, isPart2, part2Label, taskSection } from '../data/egeTasks'
import { subjectById } from '../data/subjects'
import { fitsBlank, isCorrect } from '../lib/bank'
import { canGenerate, generateTasks, bankKey } from '../lib/taskgen'
import { countOf, plural } from '../lib/plural'
import { notMeasured } from '../lib/priority'
import CellAnswer from '../ui/CellAnswer'
import TaskFigures from '../ui/TaskFigures'
import { Stethoscope, Check, X, ArrowRight, ScrollText } from 'lucide-react'

/** Как ученик оценил своё умение по заданию второй части. */
type SelfRate = 'sure' | 'try' | 'no'

const RATE_SCORE: Record<SelfRate, number> = { sure: 1, try: 0.5, no: 0 }

interface Step {
  taskNo: number
  points: number
  part2: boolean
  question?: Question // у второй части задание показываем, но решать не просим
}

const selChip = { borderColor: 'var(--accent)', background: 'var(--accent-soft)', color: 'var(--accent-text)' }

export default function Diagnostic() {
  const data = useStore((s) => s.data)
  const recordAttempt = useStore((s) => s.recordAttempt)
  const addQuestions = useStore((s) => s.addQuestions)
  const nav = useNavigate()

  const questions = useMemo(() => data.questions ?? [], [data.questions])
  const attempts = useMemo(() => data.attempts ?? [], [data.attempts])

  const subjects = useMemo(
    () => (data.subjects.length ? data.subjects : Object.keys(EGE_TASKS)).filter((id) => id in SCORING),
    [data.subjects],
  )
  const [subject, setSubject] = useState(subjects[0] ?? '')
  const [steps, setSteps] = useState<Step[] | null>(null)
  const [idx, setIdx] = useState(0)
  const [given, setGiven] = useState('')
  const [done, setDone] = useState<{ taskNo: number; ok: boolean; part2: boolean }[]>([])

  const blind = subject ? notMeasured(attempts, subject) : []

  /**
   * Собрать срез: по одному заданию на каждый номер работы.
   *
   * Задания берём из банка, а чего нет — генерируем на месте. Если номер не
   * умеем ни взять, ни собрать, он всё равно попадает в срез, когда это вторая
   * часть: там вопрос про умение, а не про решение.
   */
  function build() {
    const tasks = EGE_TASKS[subject] ?? []
    const known = new Set(questions.map(bankKey))
    const fresh: Question[] = []
    const out: Step[] = []
    for (const t of tasks) {
      const points = taskPoints(subject, t.no)
      if (!points) continue
      const part2 = isPart2(subject, t.no)
      const pool = questions.filter(
        (q) => q.subjectId === subject && q.taskNo === t.no && (part2 || fitsBlank(q.answer)),
      )
      let q = pool.length ? pool[Math.floor(Math.random() * pool.length)] : undefined
      if (!q && !part2 && canGenerate(subject, t.no)) {
        const made = generateTasks(subject, t.no, 1, Math.random, known)
        if (made.length) {
          q = made[0]
          known.add(bankKey(q))
          fresh.push(q)
        }
      }
      if (!q && !part2) continue // нечего показать и нечего собрать — номер пропускаем
      out.push({ taskNo: t.no, points, part2, question: q })
    }
    if (!out.length) return
    if (fresh.length) addQuestions(fresh)
    setSteps(out)
    setIdx(0)
    setGiven('')
    setDone([])
  }

  /** Записать результат по шагу и перейти к следующему. */
  function answer(ok: boolean, score?: number, max?: number) {
    const step = steps?.[idx]
    if (!step) return
    recordAttempt({
      // У задания второй части своей карточки в банке может и не быть — мы её
      // и не просили решать. Но замер записать обязаны, иначе срез покажет
      // карту на экране и ничего не оставит расчёту «цены балла», ради
      // которого его и проходили. Идентификатор тогда собираем из номера —
      // так же, как это делает проверка развёрнутого ответа.
      questionId: step.question?.id ?? 'free_' + subject + '_' + step.taskNo,
      subjectId: subject,
      taskNo: step.taskNo,
      answer: given.slice(0, 200) || (step.part2 ? '(самооценка)' : ''),
      correct: ok,
      ...(score !== undefined ? { score, maxScore: max } : {}),
    })
    setDone((d) => [...d, { taskNo: step.taskNo, ok, part2: step.part2 }])
    setGiven('')
    setIdx((i) => i + 1)
  }

  // ---------- Итог ----------
  if (steps && idx >= steps.length) {
    const strong = done.filter((d) => d.ok)
    const weak = done.filter((d) => !d.ok)
    const bySection = new Map<string, { total: number; ok: number }>()
    for (const d of done) {
      const sec = taskSection(subject, d.taskNo) || '—'
      const cur = bySection.get(sec) ?? { total: 0, ok: 0 }
      cur.total++
      if (d.ok) cur.ok++
      bySection.set(sec, cur)
    }
    const rows = [...bySection.entries()]
      .map(([section, v]) => ({ section, pct: Math.round((v.ok / v.total) * 100), ...v }))
      .sort((a, b) => a.pct - b.pct)

    return (
      <div className="fade-in">
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>Срез готов</h3>
          <p className="small muted" style={{ marginTop: 0 }}>
            Взял {countOf(strong.length, ['номер', 'номера', 'номеров'])} из {done.length}. Это не балл
            и не приговор: по одной попытке на номер видно направление, а не точную цифру. Зато
            теперь «Что подтянуть первым» в статистике считает по фактам.
          </p>
          {rows.map((r) => (
            <div className="row wrap" key={r.section} style={{ gap: 12, padding: '6px 0' }}>
              <span style={{ width: 190, minWidth: 140 }} className="small">{r.section}</span>
              <div className="pbar" style={{ flex: 1, minWidth: 100 }}>
                <span style={{ width: r.pct + '%', background: r.pct >= 80 ? 'var(--success)' : r.pct >= 50 ? 'var(--warn)' : 'var(--danger)' }} />
              </div>
              <span className="small" style={{ width: 80, textAlign: 'right' }}>{r.ok} из {r.total}</span>
            </div>
          ))}
          {weak.length > 0 && (
            <p className="small" style={{ marginTop: 12, marginBottom: 0 }}>
              Не взял: {weak.map((d) => '№' + d.taskNo).join(', ')}.
            </p>
          )}
        </div>
        <div className="row wrap" style={{ gap: 10 }}>
          <button className="btn btn-primary btn-lg" onClick={() => nav('/trainer?tab=stats')}>
            Что подтянуть первым <ArrowRight size={16} />
          </button>
          <button className="btn" onClick={() => setSteps(null)}>Ещё срез</button>
        </div>
      </div>
    )
  }

  // ---------- Прохождение ----------
  if (steps) {
    const step = steps[idx]
    const q = step.question
    const pct = Math.round((idx / steps.length) * 100)
    return (
      <div className="fade-in">
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="row wrap" style={{ gap: 12 }}>
            <b>Задание {idx + 1} из {steps.length}</b>
            <div className="pbar" style={{ flex: 1, minWidth: 120 }}><span style={{ width: pct + '%' }} /></div>
            <button className="btn btn-sm btn-ghost" onClick={() => setSteps(null)}>Прервать</button>
          </div>
        </div>

        <div className="card">
          <div className="row wrap" style={{ gap: 8, marginBottom: 8 }}>
            <span className="chip">№{step.taskNo}</span>
            <span className="chip">{taskSection(subject, step.taskNo)}</span>
            {step.part2 && (
              <span className="chip chip-part2">
                <ScrollText size={13} /> {part2Label(subject, step.taskNo)}
              </span>
            )}
            <div className="spacer" />
            <span className="small muted">{step.points} {plural(step.points, ['балл', 'балла', 'баллов'])}</span>
          </div>

          {q && <div className="q-text">{q.text}</div>}
          {q && <TaskFigures images={q.images} />}
          {!q && (
            <p className="muted">
              Задания этого номера в банке пока нет — оцени своё умение по названию:{' '}
              <b>{EGE_TASKS[subject]?.find((t) => t.no === step.taskNo)?.title}</b>.
            </p>
          )}

          {step.part2 ? (
            <>
              <p className="small muted" style={{ marginTop: 14 }}>
                Решать целиком сейчас не надо — на это ушли бы часы. Ответь честно: взялся бы ты за
                это задание на экзамене?
              </p>
              <div className="row wrap" style={{ gap: 8 }}>
                <button className="btn" onClick={() => answer(true, step.points * RATE_SCORE.sure, step.points)}>
                  Решаю уверенно
                </button>
                <button className="btn" onClick={() => answer(false, step.points * RATE_SCORE.try, step.points)}>
                  Пробую, но не всегда
                </button>
                <button className="btn" onClick={() => answer(false, step.points * RATE_SCORE.no, step.points)}>
                  Не берусь
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="field" style={{ marginTop: 14 }}>
                <span>Твой ответ</span>
                <CellAnswer value={given} onChange={setGiven} onEnter={() => answer(isCorrect(given, q?.answer) === true)} autoFocus />
              </div>
              <div className="row wrap" style={{ gap: 10, marginTop: 14 }}>
                <button
                  className="btn btn-primary"
                  disabled={!given.trim()}
                  onClick={() => answer(isCorrect(given, q?.answer) === true)}
                >
                  <Check size={15} /> Ответил
                </button>
                <button className="btn btn-ghost" onClick={() => answer(false)}>
                  <X size={15} /> Не знаю
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    )
  }

  // ---------- Настройка ----------
  if (!subjects.length) {
    return (
      <div className="empty">
        <div className="big">🩺</div>
        <p>Сначала выбери предметы в настройках — срез делается по структуре конкретного экзамена.</p>
      </div>
    )
  }

  const tasksCount = (EGE_TASKS[subject] ?? []).filter((t) => taskPoints(subject, t.no)).length

  return (
    <div className="fade-in">
      <div className="page-head">
        <h1>Диагностика</h1>
        <p>
          Один заход по всем номерам, чтобы понять, где ты стоишь. Без таймера и без оценки:
          это замер, а не экзамен. После него приложение перестанет советовать вслепую.
        </p>
      </div>

      <div className="card">
        <div className="row wrap" style={{ gap: 8, marginBottom: 14 }}>
          {subjects.map((id) => (
            <div
              key={id}
              className="chip"
              style={{ cursor: 'pointer', ...(subject === id ? selChip : {}) }}
              onClick={() => setSubject(id)}
            >
              {subjectById(id)?.emoji} {subjectById(id)?.short ?? id}
            </div>
          ))}
        </div>

        <p className="small muted" style={{ marginTop: 0 }}>
          В работе {countOf(tasksCount, ['номер', 'номера', 'номеров'])}. Задания с кратким ответом
          решаешь как обычно; про вторую часть просто отвечаешь, берёшься ты за неё или нет —
          решать её ради замера незачем.
          {blind.length > 0 ? (
            <> Сейчас без единой попытки: {blind.length} из {tasksCount}.</>
          ) : (
            <> По всем номерам уже есть попытки — срез их уточнит.</>
          )}
        </p>

        <button className="btn btn-primary btn-lg" onClick={build}>
          <Stethoscope size={16} /> Начать срез
        </button>
      </div>
    </div>
  )
}
