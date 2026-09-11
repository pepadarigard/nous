import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useStore } from '../store'
import { SUBJECTS, subjectById } from '../data/subjects'
import type { Attempt, MistakeNote, Question } from '../types'
import { fitsBlank, isCorrect, sectionStats, taskStats, trainingQueue } from '../lib/bank'
import { dueForReview } from '../lib/review'
import { REVIEW_SESSION } from '../lib/today'
import { canGenerate, generateTasks, generatedNumbers, bankKey } from '../lib/taskgen'
import { isPart2, part2Label, sectionsOf, taskSection } from '../data/egeTasks'
import { todayISO } from '../lib/schedule'
import { countOf, plural } from '../lib/plural'
import { explainMistake, type MistakeExplained } from '../lib/aiTutor'
import { humanError } from '../lib/api'
import { priorities, notMeasured, gapSummary } from '../lib/priority'
import BankImport from './BankImport'
import SolutionCheck from './SolutionCheck'
import Mock from './Mock'
import Modal from '../ui/Modal'
import TaskFigures from '../ui/TaskFigures'
import CellAnswer from '../ui/CellAnswer'
import { Play, Plus, BarChart3, Trash2, Check, X, RotateCcw, ListChecks, Lightbulb, ScrollText, Timer } from 'lucide-react'

type Tab = 'train' | 'check' | 'mock' | 'bank' | 'stats'

const selChip = { borderColor: 'var(--accent)', background: 'var(--accent-soft)', color: 'var(--accent-text)' }

// Стабильные пустые массивы: `?? []` создавал новый массив на каждый рендер,
// из-за чего useMemo пересчитывался всегда, а селектор zustand дёргал перерисовку.
const NO_QUESTIONS: Question[] = []
const NO_ATTEMPTS: Attempt[] = []
const NO_MISTAKES: MistakeNote[] = []

export default function Trainer() {
  const data = useStore((s) => s.data)
  // Вкладку можно открыть по ссылке: «Сегодня» на главной ведёт прямо в пробник.
  const [tab, setTab] = useState<Tab>(() => {
    const t = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('tab')
    return t === 'mock' || t === 'bank' || t === 'stats' || t === 'check' ? (t as Tab) : 'train'
  })
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
  const addQuestions = useStore((s) => s.addQuestions)
  const attempts = data.attempts ?? NO_ATTEMPTS
  const [added, setAdded] = useState(0)

  const [subject, setSubject] = useState(initialSubject)
  const [section, setSection] = useState('all')
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
    if (section !== 'all') list = list.filter((q) => taskSection(q.subjectId, q.taskNo) === section)
    if (taskNo !== 'all') list = list.filter((q) => q.taskNo === taskNo)
    if (onlyWrong) {
      const bad = new Set(attempts.filter((a) => a.correct === false).map((a) => a.questionId))
      list = list.filter((q) => bad.has(q.id))
    }
    if (onlyDue) {
      list = list.filter((q) => dueIds.has(q.id)).sort((a, b) => dueIds.get(a.id)! - dueIds.get(b.id)!)
    }
    return list
  }, [questions, subject, section, taskNo, onlyWrong, onlyDue, dueIds, attempts])

  // Разделы показываем только по одному предмету: «Орфография» и «Механика» в
  // одном ряду — это не выбор темы, а свалка.
  const sections = useMemo(() => {
    if (subject === 'all') return []
    return sectionsOf(subject)
      .map((s) => s.section)
      .filter((name) => questions.some((q) => q.subjectId === subject && taskSection(subject, q.taskNo) === name))
  }, [questions, subject])

  const taskNumbers = useMemo(() => {
    let list = subject === 'all' ? questions : questions.filter((q) => q.subjectId === subject)
    if (section !== 'all') list = list.filter((q) => taskSection(q.subjectId, q.taskNo) === section)
    return [...new Set(list.map((q) => q.taskNo).filter((x): x is number => !!x))].sort((a, b) => a - b)
  }, [questions, subject, section])

  // Задания генерируются, а не берутся из готового списка, поэтому кончиться не могут.
  // Догенерируем ровно под текущий фильтр: выбран номер — по нему, выбран предмет —
  // по всем его номерам, ничего не выбрано — по всем предметам ученика.
  function addMore(count = 10) {
    const subjects = subject !== 'all' ? [subject] : data.subjects.length ? data.subjects : ['russian']
    const fresh: Question[] = []
    // Что уже лежит в банке — иначе повторное нажатие возвращало бы те же задания.
    const known = new Set(questions.map(bankKey))
    for (const sid of subjects) {
      const nos = taskNo !== 'all' ? (canGenerate(sid, taskNo) ? [taskNo] : []) : generatedNumbers(sid)
      for (const no of nos) {
        const made = generateTasks(sid, no, taskNo !== 'all' ? count : Math.max(2, Math.round(count / nos.length)), Math.random, known)
        for (const q of made) known.add(bankKey(q))
        fresh.push(...made)
      }
    }
    if (!fresh.length) return
    addQuestions(fresh)
    setAdded(fresh.length)
    window.setTimeout(() => setAdded(0), 2500)
  }

  const canAddMore =
    (subject !== 'all' ? [subject] : data.subjects.length ? data.subjects : ['russian']).some((sid) =>
      taskNo !== 'all' ? canGenerate(sid, taskNo) : generatedNumbers(sid).length > 0,
    )

  function start() {
    // В повторении очередь уже выстроена по срочности — перемешивать её нельзя.
    const queue = onlyDue ? pool.slice(0, REVIEW_SESSION) : trainingQueue(pool, attempts, REVIEW_SESSION)
    if (!queue.length) return
    setSession({ queue, idx: 0, correct: 0, wrong: 0 })
    setGiven('')
    setVerdict('unchecked')
  }

  const q = session ? session.queue[session.idx] : null

  function check() {
    if (!q || verdict !== 'unchecked') return
    // Ответ, который в бланк не помещается (у информатики в задании 25 их
    // двенадцать штук), сверять посимвольно нельзя — это вердикт наугад.
    // Такое задание ученик отмечает сам, глядя на разбор.
    const res = fitsBlank(q.answer) ? isCorrect(given, q.answer) : null
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
    const part2 = isPart2(q.subjectId, q.taskNo)
    const longAnswer = part2 || !fitsBlank(q.answer)
    return (
      <div className="card" style={{ maxWidth: 760 }}>
        <div className="row wrap" style={{ gap: 8, marginBottom: 12 }}>
          <span className="chip">{s?.emoji} {s?.short ?? q.subjectId}</span>
          {q.taskNo ? <span className="chip">задание №{q.taskNo}</span> : null}
          {/* Вторая часть — другой жанр: решают на листе, оценивают по критериям.
              Ученик должен понимать это до того, как начнёт писать. */}
          {part2 && <span className="chip chip-part2"><ScrollText size={13} /> {part2Label(q.subjectId, q.taskNo)}</span>}
          {q.topic ? <span className="chip">{q.topic}</span> : null}
          <div className="spacer" />
          <span className="small muted">{session.idx + 1} из {session.queue.length} · верно {session.correct}</span>
        </div>

        <div className="q-text">{q.text}</div>
        <TaskFigures images={q.images} />
        {q.options && q.options.length > 0 && (
          <ul className="small" style={{ marginTop: 8 }}>
            {q.options.map((o, i) => <li key={i}>{o}</li>)}
          </ul>
        )}

        {longAnswer ? (
          <label className="field" style={{ marginTop: 16 }}>
            <span>Твой ответ</span>
            <div className="small muted" style={{ marginBottom: 6 }}>
              Решай на листе, как на экзамене, — здесь запиши итоговый ответ. Полное решение
              можно разобрать по критериям во вкладке «Развёрнутый ответ».
            </div>
            <textarea
              className="input"
              rows={3}
              autoFocus
              value={given}
              disabled={answered}
              onChange={(e) => setGiven(e.target.value)}
              placeholder="например: а) да; б) нет; в) 11"
            />
          </label>
        ) : (
          <div className="field" style={{ marginTop: 16 }}>
            <span>Твой ответ</span>
            <div className="small muted" style={{ marginBottom: 8 }}>
              Как в бланке: с первой клетки, по одному символу, без пробелов и запятых между
              номерами.
            </div>
            <CellAnswer
              value={given}
              onChange={setGiven}
              onEnter={() => (answered ? next() : check())}
              disabled={answered}
              autoFocus
            />
          </div>
        )}

        {verdict === true && <div className="verdict ok"><Check size={16} /> Верно!</div>}
        {verdict === false && (
          <>
            <div className="verdict bad">
              <X size={16} /> Мимо.{q.answer ? <> Правильный ответ: <b>{q.answer.split('|')[0]}</b></> : null}
            </div>
            {/* Правильный ответ ученик и так видит — от этого он ничему не
                научился. Учит другое: в каком месте рассуждение свернуло не туда. */}
            <MistakeBox question={q} given={given} />
          </>
        )}
        {verdict === null && (
          <div className="verdict self">
            <Lightbulb size={16} />
            <div style={{ flex: 1 }}>
              {q.answer ? (
                <>
                  Такой ответ в бланк не помещается — сверься сам. Верный ответ:{' '}
                  <b>{q.answer.split('|')[0]}</b>
                </>
              ) : (
                <>У этого задания нет эталонного ответа — сверься с разбором и отметь сам.</>
              )}
              {q.solution && <div className="sol-body" style={{ marginTop: 6 }}>{q.solution}</div>}
            </div>
            <button className="btn btn-sm" onClick={() => selfMark(true)}>Решил верно</button>
            <button className="btn btn-sm" onClick={() => selfMark(false)}>Ошибся</button>
          </div>
        )}
        {answered && verdict !== null && q.solution && (
          <div className="solution-box">
            <b className="sol-head">Разбор</b>
            <div className="sol-body">{q.solution}</div>
          </div>
        )}
        {/* Критерии показываем только после ответа: до него они подсказывают,
            из скольких пунктов состоит решение. */}
        {answered && q.criteria && (
          <details className="solution-box crit-box">
            <summary className="sol-head">Критерии оценивания</summary>
            <div className="sol-body">{q.criteria}</div>
          </details>
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
      {/* Раздел курса. Выбирать тему полезнее, чем номер: «не понимаю производную»
          — это девятое, двенадцатое и семнадцатое задания сразу, и разбирать их
          надо вместе, а не поодиночке. */}
      {sections.length > 0 && (
        <div className="row wrap" style={{ gap: 6, marginBottom: 12 }}>
          <div className="chip" style={{ cursor: 'pointer', ...(section === 'all' ? selChip : {}) }} onClick={() => { setSection('all'); setTaskNo('all') }}>Любая тема</div>
          {sections.map((s) => (
            <div key={s} className="chip" style={{ cursor: 'pointer', ...(section === s ? selChip : {}) }} onClick={() => { setSection(s); setTaskNo('all') }}>{s}</div>
          ))}
        </div>
      )}
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
      <div className="row wrap" style={{ gap: 10 }}>
        <span className="small muted">
          подходит заданий: {pool.length}
          {added > 0 && <span style={{ color: 'var(--success)' }}> · добавлено {added} новых</span>}
        </span>
        <div className="spacer" />
        {canAddMore && (
          <button
            className="btn"
            onClick={() => addMore()}
            title="Задания собираются на месте: числа каждый раз новые, поэтому они не кончаются и их нельзя запомнить"
          >
            <Plus size={15} /> Ещё задания
          </button>
        )}
        <button className="btn btn-primary btn-lg" disabled={!pool.length} onClick={start}><Play size={16} /> Начать</button>
      </div>
      <p className="small muted" style={{ marginBottom: 0, marginTop: 12 }}>
        В подход берётся до {REVIEW_SESSION} заданий: сначала те, где ошибался, потом нерешённые.
      </p>
    </div>
  )
}

// ---------- Разбор ошибки ----------

/**
 * «Почему я ошибся» — то, ради чего вообще нужен ИИ в тренажёре.
 *
 * Нарочно НЕ запускается само. Во-первых, это запрос к модели на каждую ошибку
 * — а ошибок за подход бывает десяток. Во-вторых, иногда ученик и сам видит,
 * где промахнулся, и лишний текст тут только мешает. Кнопка — и разбор.
 *
 * Метка ошибки сохраняется: из повторов видно, что дело не в невнимательности.
 */
function MistakeBox({ question, given }: { question: Question; given: string }) {
  const cfg = useStore((s) => s.data.config)
  const mistakes = useStore((s) => s.data.mistakes ?? NO_MISTAKES)
  const addMistake = useStore((s) => s.addMistake)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [got, setGot] = useState<MistakeExplained | null>(null)

  // Сколько раз эта же ошибка уже была — считаем ПОСЛЕ разбора, по его метке.
  const repeats = got ? mistakes.filter((m) => m.kind === got.kind).length : 0

  async function run() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const res = await explainMistake(cfg, {
        subjectId: question.subjectId,
        taskNo: question.taskNo,
        task: question.text,
        expected: question.answer ?? '',
        given,
        solution: question.solution,
      })
      setGot(res)
      addMistake({
        subjectId: question.subjectId,
        taskNo: question.taskNo,
        questionId: question.id,
        kind: res.kind,
        why: res.why,
        remember: res.remember,
        uncertain: res.uncertain,
        model: cfg.textModel,
      })
    } catch (e) {
      setError(humanError(e))
    }
    setBusy(false)
  }

  if (got) {
    return (
      <div className="card soft" style={{ marginTop: 10 }}>
        <div className="row" style={{ gap: 8, marginBottom: 6 }}>
          <Lightbulb size={16} color="var(--accent)" />
          <b>{got.kind}</b>
          {repeats > 1 && (
            <span className="chip" style={{ borderColor: 'var(--warn)', color: 'var(--warn)' }}>
              уже {repeats}-й раз
            </span>
          )}
        </div>
        <div className="sol-body">{got.why}</div>
        {got.remember && (
          <div className="small" style={{ marginTop: 8 }}>
            <b>Запомни:</b> {got.remember}
          </div>
        )}
        {got.uncertain && (
          <div className="small muted" style={{ marginTop: 6 }}>
            По твоему ответу трудно понять ход мысли — разбор мог промахнуться.
          </div>
        )}
        {repeats > 2 && (
          <div className="small" style={{ marginTop: 8, color: 'var(--warn)' }}>
            Это уже не невнимательность. Разбери тему целиком: вкладка «Что решаем» → нужный раздел.
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{ marginTop: 8 }}>
      <button className="btn btn-sm" onClick={run} disabled={busy}>
        <Lightbulb size={14} /> {busy ? 'Разбираю…' : 'Почему я ошибся'}
      </button>
      {error && <span className="small" style={{ color: 'var(--danger)', marginLeft: 10 }}>{error}</span>}
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


/**
 * Статистика отвечает на три разных вопроса, и путать их нельзя.
 *
 *  1. «Что подтянуть первым» — цена балла. Считается арифметикой: вес номера
 *     на экзамене умножить на долю, которую ты в нём теряешь. Вторая часть
 *     делится на трудоёмкость, иначе список всегда советовал бы сочинение.
 *  2. «Чего я не понимаю» — разделы курса. Провал в одном номере — случайность,
 *     провал в разделе — непонятая тема.
 *  3. «Что я делаю не так» — повторяющиеся ошибки из разборов.
 *
 * Номера остаются внизу, как деталь: по ним видно частности, но решения по ним
 * не принимают.
 */
function StatsTab() {
  const attempts = useStore((s) => s.data.attempts ?? NO_ATTEMPTS)
  const mistakes = useStore((s) => s.data.mistakes ?? NO_MISTAKES)
  const stats = useMemo(() => taskStats(attempts), [attempts])
  const sections = useMemo(() => sectionStats(attempts), [attempts])

  // Повторы ошибок: одна и та же метка два раза и больше.
  const repeated = useMemo(() => {
    const map = new Map<string, { kind: string; count: number; last: MistakeNote }>()
    for (const m of mistakes) {
      const cur = map.get(m.kind)
      if (cur) {
        cur.count++
        if (m.at > cur.last.at) cur.last = m
      } else {
        map.set(m.kind, { kind: m.kind, count: 1, last: m })
      }
    }
    return [...map.values()].filter((x) => x.count > 1).sort((a, b) => b.count - a.count)
  }, [mistakes])

  if (!attempts.length) {
    return (
      <div className="empty">
        <div className="big">📊</div>
        <p>Статистика появится, как только решишь первые задания.</p>
      </div>
    )
  }

  const subjects = [...new Set(stats.map((s) => s.subjectId))]

  return (
    <div className="grid" style={{ gap: 16 }}>
      {/* 1. Что подтянуть первым */}
      {subjects.map((sid) => {
        const list = priorities(attempts, sid).slice(0, 5)
        const gaps = gapSummary(attempts, sid)
        const blind = notMeasured(attempts, sid)
        if (!list.length && !blind.length) return null
        const s = subjectById(sid)
        return (
          <div className="card" key={'prio_' + sid}>
            <div className="row" style={{ marginBottom: 4 }}>
              <h3 style={{ margin: 0 }}>{s?.emoji} Что подтянуть первым</h3>
              <div className="spacer" />
              <span className="chip">{s?.short ?? sid}</span>
            </div>
            <p className="small muted" style={{ marginTop: 4 }}>
              {gaps.total >= 1 ? (
                <>
                  Сейчас ты теряешь примерно <b>{Math.round(gaps.total)}</b>{' '}
                  {plural(Math.round(gaps.total), ['первичный балл', 'первичных балла', 'первичных баллов'])}, из них{' '}
                  <b>{Math.round(gaps.top)}</b> — в трёх номерах сверху списка. Задания второй части стоят
                  дороже, но и берутся дольше, поэтому в порядке они учтены с поправкой на трудоёмкость.
                </>
              ) : (
                <>Потерь почти нет — по измеренным номерам ты берёшь почти всё.</>
              )}
            </p>
            {list.map((p) => (
              <div className="row wrap" key={p.taskNo} style={{ gap: 10, padding: '8px 0', borderTop: '1px solid var(--line)' }}>
                <b style={{ minWidth: 40 }}>№{p.taskNo}</b>
                <span className="small" style={{ flex: 1, minWidth: 180 }}>
                  {p.title}
                  {p.part2 && <span className="muted"> · вторая часть</span>}
                </span>
                <span className="small muted" style={{ width: 108, textAlign: 'right' }}>
                  берёшь {Math.round(p.rate * 100)}% из {p.tries}
                </span>
                {/* Дробное число по-русски всегда «балла»: «ноль целых восемь
                    десятых балла». Склонять по округлению нельзя — выходило
                    «+0.8 балл». */}
                <span className="small" style={{ width: 96, textAlign: 'right', color: 'var(--accent-text)' }}>
                  +{p.gap.toFixed(1).replace('.', ',')} балла
                </span>
              </div>
            ))}
            {blind.length > 0 && (
              <p className="small muted" style={{ marginTop: 10, marginBottom: 0 }}>
                Ещё не мерили: {blind.map((n) => '№' + n).join(', ')}. По ним счёт не ведётся — сначала
                прорешай по несколько штук, иначе список выше судит по половине работы.
              </p>
            )}
          </div>
        )
      })}

      {/* 2. Чего не понимаю — по разделам */}
      {subjects.map((sid) => {
        const rows = sections.filter((x) => x.subjectId === sid)
        if (!rows.length) return null
        const s = subjectById(sid)
        return (
          <div className="card" key={'sec_' + sid}>
            <div className="row" style={{ marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>{s?.emoji} Темы: {s?.name ?? sid}</h3>
              <div className="spacer" />
              <span className="small muted">раздел важнее номера</span>
            </div>
            {rows.map((r) => (
              <div className="row wrap" key={r.section} style={{ gap: 12, padding: '6px 0' }}>
                <span style={{ width: 190, minWidth: 140 }} className="small">{r.section}</span>
                <div className="pbar" style={{ flex: 1, minWidth: 100 }}>
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

      {/* 3. Что я делаю не так */}
      {repeated.length > 0 && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Повторяющиеся ошибки</h3>
          <p className="small muted" style={{ marginTop: 0 }}>
            Одно и то же второй раз — уже не случайность. Это разборы, которые ты запрашивал в
            тренажёре кнопкой «Почему я ошибся».
          </p>
          {repeated.map((r) => (
            <div key={r.kind} style={{ padding: '9px 0', borderTop: '1px solid var(--line)' }}>
              <div className="row wrap" style={{ gap: 8 }}>
                <b style={{ flex: 1, minWidth: 160 }}>{r.kind}</b>
                <span
                  className="chip"
                  style={r.count > 2 ? { borderColor: 'var(--danger)', color: 'var(--danger)' } : undefined}
                >
                  {countOf(r.count, ['раз', 'раза', 'раз'])}
                </span>
                {r.last.taskNo ? <span className="small muted">№{r.last.taskNo}</span> : null}
              </div>
              {r.last.remember && <div className="small muted" style={{ marginTop: 4 }}>{r.last.remember}</div>}
            </div>
          ))}
        </div>
      )}

      {/* 4. Подробности по номерам */}
      {subjects.map((sid) => {
        const rows = stats.filter((x) => x.subjectId === sid)
        const s = subjectById(sid)
        const total = rows.reduce((n, r) => n + r.total, 0)
        const correct = rows.reduce((n, r) => n + r.correct, 0)
        return (
          <details className="card" key={'no_' + sid}>
            <summary className="row" style={{ cursor: 'pointer' }}>
              <b>{s?.emoji} Подробно по номерам: {s?.short ?? sid}</b>
              <div className="spacer" />
              <span className="chip">{correct} из {total} верно</span>
            </summary>
            <div style={{ marginTop: 10 }}>
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
          </details>
        )
      })}
    </div>
  )
}
