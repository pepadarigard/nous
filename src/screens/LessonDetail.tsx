import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import { taskTheory } from '../data/theory'
import { subjectById, subjectName } from '../data/subjects'
import { addDaysISO, agendaByDate, dayLabel, todayISO } from '../lib/schedule'
import Modal from '../ui/Modal'
import { Check, Pin, PinOff, CalendarClock, Library, ExternalLink, Unlink, Sparkles, Loader2, RefreshCw, Eye, Plus, Dumbbell, BookOpen } from 'lucide-react'
import { humanError, isTauri, loadMaterialText, openMaterialFile, uid } from '../lib/api'
import { humanSize } from '../lib/extract'
import { lessonBrief } from '../lib/aiTutor'
import { aiReady } from '../lib/providers'
import { mdToHtml } from '../lib/md'
import type { Block, Lesson, Material, Question } from '../types'

const kindLabel: Record<Lesson['kind'], string> = { theory: 'Теория', practice: 'Практика', review: 'Повторение' }
const kindIcon: Record<Lesson['kind'], string> = { theory: '📖', practice: '✏️', review: '🔁' }

export default function LessonDetail({ blockId, lessonId, onClose }: { blockId: string; lessonId: string; onClose: () => void }) {
  const data = useStore((s) => s.data)
  const toggleLesson = useStore((s) => s.toggleLesson)
  const pinLesson = useStore((s) => s.pinLesson)
  const attachMaterial = useStore((s) => s.attachMaterial)
  const detachMaterial = useStore((s) => s.detachMaterial)
  const [pickDate, setPickDate] = useState(false)
  const navigate = useNavigate()

  const plan = data.plan
  const block = plan?.blocks.find((b) => b.id === blockId)
  const lesson = block?.lessons.find((l) => l.id === lessonId)

  // Дата занятия по текущей раскладке — чтобы «перенести на завтра» считалось от неё, а не от сегодня.
  const currentDate = useMemo(() => {
    if (!plan || !lesson) return null
    if (lesson.pinnedDate) return lesson.pinnedDate
    const map = agendaByDate(plan, data.schedules, data.rules)
    for (const [d, items] of Object.entries(map)) {
      if (items.some((i) => i.lesson.id === lessonId)) return d
    }
    return null
  }, [plan, lesson, data.schedules, data.rules, lessonId])

  if (!block || !lesson) return null

  const total = block.lessons.length
  const doneN = block.lessons.filter((l) => l.done).length
  const pct = total ? Math.round((doneN / total) * 100) : 0
  const s = subjectById(block.subjectId)
  const base = currentDate ?? todayISO()
  // Номер задания ищем и в заголовке, и в описании: у теоретических занятий заголовок
  // называет тему («Теория: Паронимы»), а номер живёт в описании («Разбери тему задания № 5»).
  // Диапазон («задания № 1–5» у повторения) намеренно НЕ считается номером: это несколько
  // заданий сразу, и подставлять теорию или фильтр по первому из них было бы враньём.
  // Номер обязан стоять после слова «задание» — иначе «Пробник № 1» выдаёт себя за
  // первое задание и тянет за собой чужую теорию. NB: [а-яё], а не \w — кириллица
  // в \w в JavaScript не входит.
  const taskMatch = (lesson.title + ' ' + lesson.description).match(
    /задани[а-яё]*\s*№\s*(\d{1,2})\s*(?:[–—-]\s*(\d{1,2}))?/i,
  )
  const lessonTaskNo = taskMatch && !taskMatch[2] ? Number(taskMatch[1]) : undefined

  // Доказательство вместо обещания: сколько заданий этого номера реально решено.
  // Галочка «выполнено» остаётся самоотчётом, а вот это — измерение.
  const solved = (data.attempts ?? []).filter(
    (a) => a.subjectId === block.subjectId && a.taskNo === lessonTaskNo && a.correct !== null,
  )
  const solvedRight = solved.filter((a) => a.correct).length

  // Теория по номеру занятия: раньше «разбери тему» было отпиской, теперь есть что разбирать.
  const theory = taskTheory(block.subjectId, lessonTaskNo)

  return (
    <Modal title={lesson.title} onClose={onClose} wide>
      <div className="row wrap" style={{ gap: 8, marginBottom: 14 }}>
        <span className="chip">{kindIcon[lesson.kind]} {kindLabel[lesson.kind]}</span>
        <span className="chip">{s?.emoji} {subjectName(block.subjectId)}</span>
        {currentDate && <span className="chip">📅 {dayLabel(currentDate)}</span>}
        {lesson.pinnedDate && <span className="badge"><Pin size={11} style={{ verticalAlign: -1 }} /> закреплено</span>}
        {lesson.done && <span className="badge strong">Выполнено ✓</span>}
      </div>

      <div style={{ fontSize: 15, lineHeight: 1.65 }}>{lesson.description || 'Подробного описания нет.'}</div>

      <div className="row wrap" style={{ marginTop: 16, gap: 10 }}>
        <button
          className={'btn ' + (lesson.done ? '' : 'btn-primary')}
          onClick={() => toggleLesson(block.id, lesson.id)}
        >
          {lesson.done ? 'Снять отметку' : 'Отметить выполненным'}
        </button>
        {/* Занятие знает свой номер задания — значит может открыть тренажёр уже настроенным.
            Отметка занятия ничего не доказывает, а решённые задания доказывают. */}
        {lessonTaskNo !== undefined && (
          <button
            className="btn"
            title={'Открыть тренажёр по заданию № ' + lessonTaskNo}
            onClick={() => {
              onClose()
              navigate('/trainer?subject=' + block.subjectId + '&task=' + lessonTaskNo)
            }}
          >
            <Dumbbell size={15} /> Решать № {lessonTaskNo}
          </button>
        )}
      </div>

      {theory && (
        <div className="card soft" style={{ marginTop: 18 }}>
          <div className="row" style={{ marginBottom: 8 }}>
            <BookOpen size={16} color="var(--accent)" />
            <b>Как решается задание № {lessonTaskNo}</b>
          </div>
          <div style={{ fontSize: 15, lineHeight: 1.6 }}>{theory.rule}</div>

          {theory.learn && (
            <div className="info-banner" style={{ marginTop: 10 }}>
              <div className="small" style={{ flex: 1 }}>{theory.learn}</div>
            </div>
          )}

          {theory.steps && (
            <>
              <div className="small" style={{ marginTop: 12, marginBottom: 4, fontWeight: 600 }}>Порядок действий</div>
              <ol style={{ margin: 0, paddingLeft: 20, fontSize: 14, lineHeight: 1.65 }}>
                {theory.steps.map((s, i) => <li key={i} style={{ marginBottom: 3 }}>{s}</li>)}
              </ol>
            </>
          )}

          {theory.traps && (
            <>
              <div className="small" style={{ marginTop: 12, marginBottom: 4, fontWeight: 600 }}>Где теряют балл</div>
              <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14, lineHeight: 1.65 }}>
                {theory.traps.map((t, i) => <li key={i} style={{ marginBottom: 3 }}>{t}</li>)}
              </ul>
            </>
          )}
        </div>
      )}

      {lessonTaskNo !== undefined && (
        <div className="small muted" style={{ marginTop: 10 }}>
          {solved.length ? (
            <>
              В тренажёре по заданию № {lessonTaskNo}: решено {solved.length}, верно {solvedRight} (
              {Math.round((solvedRight / solved.length) * 100)}%). Именно эти цифры идут в балл на
              «Прогрессе».
            </>
          ) : (
            <>По заданию № {lessonTaskNo} ты ещё ничего не решал — балл за него пока не считается.</>
          )}
        </div>
      )}

      <div className="card soft" style={{ marginTop: 18 }}>
        <div className="row" style={{ marginBottom: 8 }}>
          <CalendarClock size={16} color="var(--accent)" />
          <b>Когда заниматься</b>
        </div>
        <p className="small muted" style={{ marginTop: 0 }}>
          Перенос закрепляет занятие за датой: план вокруг него подстроится сам. Можно вернуть в общий поток.
        </p>
        <div className="row wrap" style={{ gap: 6 }}>
          <button className="btn btn-sm" onClick={() => pinLesson(block.id, lesson.id, todayISO())}>Сегодня</button>
          <button className="btn btn-sm" onClick={() => pinLesson(block.id, lesson.id, addDaysISO(base, 1))}>На день позже</button>
          <button className="btn btn-sm" onClick={() => pinLesson(block.id, lesson.id, addDaysISO(base, 7))}>+7 дней</button>
          <button className="btn btn-sm" onClick={() => setPickDate((v) => !v)}>Выбрать дату…</button>
          {lesson.pinnedDate && (
            <button className="btn btn-ghost btn-sm" onClick={() => pinLesson(block.id, lesson.id)}>
              <PinOff size={13} /> Вернуть в поток
            </button>
          )}
        </div>
        {pickDate && (
          <input
            className="input"
            type="date"
            autoFocus
            defaultValue={base}
            style={{ width: 180, marginTop: 10 }}
            onChange={(e) => {
              if (!e.target.value) return
              pinLesson(block.id, lesson.id, e.target.value)
              setPickDate(false)
            }}
          />
        )}
      </div>

      <BriefCard block={block} lesson={lesson} />

      <MaterialsCard
        materials={data.materials ?? []}
        attachedIds={lesson.materialIds ?? []}
        subjectId={block.subjectId}
        onAttach={(id) => attachMaterial(block.id, lesson.id, id)}
        onDetach={(id) => detachMaterial(block.id, lesson.id, id)}
      />

      <div className="card soft" style={{ marginTop: 16 }}>
        <div className="row" style={{ marginBottom: 6 }}>
          <b>Блок: {block.title}</b>
          <div className="spacer" />
          <span className="chip">{doneN} / {total} пройдено</span>
        </div>
        {block.goal && <p className="small muted" style={{ margin: '2px 0 12px' }}>🎯 {block.goal}</p>}
        <div className="pbar" style={{ marginBottom: 14 }}><span style={{ width: pct + '%' }} /></div>
        {block.lessons.map((l) => (
          <div
            key={l.id}
            className={'lesson' + (l.done ? ' done' : '')}
            style={{ background: l.id === lesson.id ? 'var(--accent-soft)' : undefined }}
          >
            <div className="kind-ic">{kindIcon[l.kind]}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 650, textDecoration: l.done ? 'line-through' : 'none' }}>{l.title}</div>
              <div className="small muted">{kindLabel[l.kind]}</div>
            </div>
            <div className="tick" onClick={() => toggleLesson(block.id, l.id)}>{l.done && <Check size={15} color="#fff" />}</div>
          </div>
        ))}
      </div>
    </Modal>
  )
}

/** Свои материалы, привязанные к занятию: открыть оригинал или отвязать. */
function MaterialsCard({ materials, attachedIds, subjectId, onAttach, onDetach }: {
  materials: Material[]
  attachedIds: string[]
  subjectId: string
  onAttach: (id: string) => void
  onDetach: (id: string) => void
}) {
  const attached = attachedIds.map((id) => materials.find((m) => m.id === id)).filter(Boolean) as Material[]
  // Сначала предлагаем материалы этого предмета и общие — чужие предметы только зашумляют список.
  const free = materials.filter((m) => !attachedIds.includes(m.id) && (!m.subjectId || m.subjectId === subjectId))

  return (
    <div className="card soft" style={{ marginTop: 16 }}>
      <div className="row" style={{ marginBottom: 8 }}>
        <Library size={16} color="var(--accent)" />
        <b>Материалы к занятию</b>
      </div>
      {attached.length === 0 && (
        <p className="small muted" style={{ marginTop: 0 }}>
          {materials.length === 0
            ? 'Пока не загружено ни одного файла — это делается в разделе «Материалы».'
            : 'Ничего не привязано. Выбери файл ниже, чтобы он был под рукой прямо на занятии.'}
        </p>
      )}
      {attached.map((m) => (
        <div key={m.id} className="row" style={{ gap: 10, padding: '7px 0', borderTop: '1px solid var(--border)' }}>
          <span>📄</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</div>
            <div className="small muted">{humanSize(m.size)}{m.pages ? ' · ' + m.pages + ' стр.' : ''}</div>
          </div>
          {m.file && isTauri && (
            <button className="btn btn-ghost btn-sm" onClick={() => openMaterialFile(m.file!).catch(() => {})} title="Открыть файл">
              <ExternalLink size={14} />
            </button>
          )}
          <button className="btn btn-ghost btn-sm" onClick={() => onDetach(m.id)} title="Отвязать">
            <Unlink size={14} />
          </button>
        </div>
      ))}
      {free.length > 0 && (
        <select
          className="select"
          value=""
          onChange={(e) => e.target.value && onAttach(e.target.value)}
          style={{ marginTop: 10, maxWidth: 380 }}
        >
          <option value="">+ привязать материал…</option>
          {free.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
      )}
    </div>
  )
}

/**
 * «Жить в занятии»: теория и задания по теме прямо в карточке.
 * Сгенерированное сохраняется В ЗАНЯТИЕ, поэтому при следующем открытии
 * (и без интернета) оно уже на месте.
 */
function BriefCard({ block, lesson }: { block: Block; lesson: Lesson }) {
  const data = useStore((s) => s.data)
  const setLessonBrief = useStore((s) => s.setLessonBrief)
  const addQuestions = useStore((s) => s.addQuestions)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [shown, setShown] = useState<Set<number>>(new Set())
  const [added, setAdded] = useState(0)

  const brief = lesson.brief
  const ready = aiReady(data.config)
  const taskNo = Number((lesson.title.match(/№\s*(\d{1,2})/) || [])[1]) || undefined

  /** Кусок своего материала по теме занятия — чтобы ИИ опирался на учебник ученика. */
  async function materialExcerpt(): Promise<string | undefined> {
    const id = lesson.materialIds?.[0]
    if (!id) return undefined
    const text = await loadMaterialText(id)
    if (!text) return undefined
    const word = lesson.title
      .replace(/^(Теория|Практика|Повторение):\s*/i, '')
      .split(/\s+/)
      .filter((w) => w.length > 5)
      .sort((a, b) => b.length - a.length)[0]
    if (word) {
      const i = text.toLowerCase().indexOf(word.toLowerCase())
      if (i >= 0) return text.slice(Math.max(0, i - 1200), i + 1800)
    }
    return text.slice(0, 2500)
  }

  async function make() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const res = await lessonBrief(data.config, {
        subjectId: block.subjectId,
        lessonTitle: lesson.title,
        lessonDescription: lesson.description,
        blockTitle: block.title,
        taskNo,
        materialText: await materialExcerpt(),
      })
      if (!res.theory.trim() && !res.tasks.length) {
        setError('ИИ вернул пустой материал. Попробуй ещё раз или смени модель в Настройках.')
      } else {
        setLessonBrief(block.id, lesson.id, res)
      }
    } catch (e) {
      setError(humanError(e))
    }
    setBusy(false)
  }

  function toBank() {
    if (!brief?.tasks.length) return
    const qs: Question[] = brief.tasks
      .filter((t) => t.text.trim())
      .map((t) => ({
        id: uid('q_'),
        subjectId: block.subjectId,
        taskNo,
        text: t.text,
        answer: t.answer,
        topic: lesson.title,
        origin: 'ai' as const,
        createdAt: new Date().toISOString(),
      }))
    addQuestions(qs)
    setAdded(qs.length)
  }

  return (
    <div className="card soft" style={{ marginTop: 16 }}>
      <div className="row wrap" style={{ marginBottom: 8, gap: 10 }}>
        <Sparkles size={16} color="var(--accent)" />
        <b>Материал занятия</b>
        <div className="spacer" />
        {brief && (
          <>
            <button className="btn btn-ghost btn-sm" onClick={toBank} title="Отправить задания в тренажёр">
              <Plus size={13} /> В тренажёр
            </button>
            <button className="btn btn-ghost btn-sm" onClick={make} disabled={busy || !ready} title="Сгенерировать заново">
              <RefreshCw size={13} />
            </button>
          </>
        )}
      </div>

      {!brief && (
        <>
          <p className="small muted" style={{ marginTop: 0 }}>
            ИИ разберёт тему этого занятия и даст несколько заданий с ответами. Результат сохранится
            в занятии — потом откроется и без интернета.
            {lesson.materialIds?.length ? ' Опорой послужит привязанный материал.' : ''}
          </p>
          <div className="row wrap" style={{ gap: 10 }}>
            <button className="btn btn-primary btn-sm" onClick={make} disabled={busy || !ready}>
              {busy ? <><Loader2 size={14} className="spin-ic" /> Готовлю…</> : <><Sparkles size={14} /> Подготовить теорию и задания</>}
            </button>
            {!ready && <span className="small" style={{ color: 'var(--warn)' }}>Нужен ИИ — настраивается в «Настройках».</span>}
          </div>
        </>
      )}

      {error && <p className="small" style={{ color: 'var(--danger)' }}>{error}</p>}
      {added > 0 && <p className="small" style={{ color: 'var(--accent-text)' }}>✓ Добавлено в банк заданий: {added}</p>}

      {brief && (
        <>
          {brief.theory && <div className="md-body" dangerouslySetInnerHTML={{ __html: mdToHtml(brief.theory) }} />}
          {brief.tasks.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <b className="small">Задания</b>
              {brief.tasks.map((t, i) => (
                <div key={i} className="q-row" style={{ marginTop: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="small" style={{ whiteSpace: 'pre-wrap' }}>{i + 1}. {t.text}</div>
                    {t.answer && shown.has(i) && (
                      <div className="small" style={{ marginTop: 4, color: 'var(--accent-text)' }}>Ответ: {t.answer}</div>
                    )}
                  </div>
                  {t.answer && !shown.has(i) && (
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => setShown((p) => new Set([...p, i]))}
                      title="Показать ответ"
                    >
                      <Eye size={13} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          <p className="small muted" style={{ marginTop: 10, marginBottom: 0 }}>
            Подготовлено ИИ {new Date(brief.createdAt).toLocaleDateString('ru-RU')}. Проверяй факты: модель может ошибаться.
          </p>
        </>
      )}
    </div>
  )
}
