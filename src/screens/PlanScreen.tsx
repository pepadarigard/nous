import { useMemo, useState } from 'react'
import { useStore } from '../store'
import { SUBJECTS, subjectById } from '../data/subjects'
import type { Lesson, StudyPlan, SubjectSchedule } from '../types'
import { agendaByDate, buildAgenda, dayLabel, type AgendaDay, type AgendaItem } from '../lib/schedule'
import { EGE_YEAR } from '../data/ege2027'
import Modal from '../ui/Modal'
import PlanImporter from './PlanImporter'
import PlanExtender from './PlanExtender'
import LessonDetail from './LessonDetail'
import { Check, CalendarDays, ListChecks, ChevronLeft, ChevronRight, ChevronDown, X, RefreshCw, Wand2, Flame } from 'lucide-react'

const kindIcon: Record<Lesson['kind'], string> = { theory: '📖', practice: '✏️', review: '🔁' }
const kindLabel: Record<Lesson['kind'], string> = { theory: 'Теория', practice: 'Практика', review: 'Повторение' }
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
const WD_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function weekdayMon(d: Date): number {
  const j = d.getDay()
  return j === 0 ? 7 : j
}
/** Понедельник недели, к которой относится дата. */
function weekStartISO(dateISO: string): string {
  const d = new Date(dateISO)
  d.setDate(d.getDate() - (weekdayMon(d) - 1))
  return iso(d)
}
function addDays(dateISO: string, n: number): string {
  const d = new Date(dateISO)
  d.setDate(d.getDate() + n)
  return iso(d)
}

type Open = (blockId: string, lessonId: string) => void

export default function PlanScreen() {
  const data = useStore((s) => s.data)
  const toggleLesson = useStore((s) => s.toggleLesson)
  const [filter, setFilter] = useState<string>('all')
  const [view, setView] = useState<'list' | 'calendar'>('list')
  const [importOpen, setImportOpen] = useState(false)
  const [refineOpen, setRefineOpen] = useState(false)
  const [detail, setDetail] = useState<{ blockId: string; lessonId: string } | null>(null)

  const plan = data.plan
  if (!plan) {
    return (
      <div className="fade-in">
        <div className="page-head">
          <h1>План подготовки</h1>
          <p>Плана пока нет. Получи его от ИИ или вставь свой — это займёт минуту.</p>
        </div>
        <div className="card" style={{ maxWidth: 760 }}>
          <PlanImporter onDone={() => setImportOpen(false)} />
        </div>
      </div>
    )
  }

  const usedSubjects = SUBJECTS.filter((s) => plan.blocks.some((b) => b.subjectId === s.id))
  const matchSubject = (sid: string) => filter === 'all' || sid === filter
  const onOpen: Open = (blockId, lessonId) => setDetail({ blockId, lessonId })

  return (
    <div className="fade-in">
      <PlanHero plan={plan} schedules={data.schedules} examDate={data.examDate} onImport={() => setImportOpen(true)} onRefine={() => setRefineOpen(true)} />

      <div className="row wrap" style={{ margin: '18px 0', gap: 8 }}>
        <div className="seg">
          <button className={'seg-btn' + (view === 'list' ? ' on' : '')} onClick={() => setView('list')}>
            <ListChecks size={15} /> Список
          </button>
          <button className={'seg-btn' + (view === 'calendar' ? ' on' : '')} onClick={() => setView('calendar')}>
            <CalendarDays size={15} /> Календарь
          </button>
        </div>
        <div className="spacer" />
        <div className="row wrap" style={{ gap: 6 }}>
          <div className="chip" style={{ cursor: 'pointer', ...(filter === 'all' ? selChip : {}) }} onClick={() => setFilter('all')}>Все</div>
          {usedSubjects.map((s) => (
            <div key={s.id} className="chip" style={{ cursor: 'pointer', ...(filter === s.id ? selChip : {}) }} onClick={() => setFilter(s.id)}>
              {s.emoji} {s.short}
            </div>
          ))}
        </div>
      </div>

      {view === 'list' ? (
        <AgendaList plan={plan} schedules={data.schedules} matchSubject={matchSubject} onToggle={toggleLesson} onOpen={onOpen} />
      ) : (
        <CalendarView plan={plan} schedules={data.schedules} matchSubject={matchSubject} onToggle={toggleLesson} onOpen={onOpen} />
      )}

      {importOpen && (
        <Modal title="Обновить план" onClose={() => setImportOpen(false)} wide>
          <PlanImporter onDone={() => setImportOpen(false)} />
        </Modal>
      )}
      {refineOpen && (
        <Modal title="Изменить план" onClose={() => setRefineOpen(false)}>
          <PlanExtender onDone={() => setRefineOpen(false)} />
        </Modal>
      )}
      {detail && <LessonDetail blockId={detail.blockId} lessonId={detail.lessonId} onClose={() => setDetail(null)} />}
    </div>
  )
}

/** Тёмная hero-карта: обратный отсчёт до ЕГЭ, прогресс пути, темп недели. */
function PlanHero({ plan, schedules, examDate, onImport, onRefine }: {
  plan: StudyPlan
  schedules: SubjectSchedule[]
  examDate?: string
  onImport: () => void
  onRefine: () => void
}) {
  const all = plan.blocks.flatMap((b) => b.lessons)
  const done = all.filter((l) => l.done).length
  const pct = all.length ? Math.round((done / all.length) * 100) : 0
  const daysLeft = examDate ? Math.max(0, Math.ceil((new Date(examDate).getTime() - Date.now()) / 86400000)) : null

  // Темп этой недели: занятия с датами внутри текущей недели.
  const todayISO = iso(new Date())
  const ws = weekStartISO(todayISO)
  const we = addDays(ws, 6)
  const agenda = useMemo(() => agendaByDate(plan, schedules), [plan, schedules])
  let weekTotal = 0
  let weekDone = 0
  for (const [d, items] of Object.entries(agenda)) {
    if (d >= ws && d <= we) {
      weekTotal += items.length
      weekDone += items.filter((i) => i.lesson.done).length
    }
  }

  return (
    <div className="plan-hero">
      <div className="ph-left">
        <div className="ph-kicker">Путь к ЕГЭ {EGE_YEAR}</div>
        <div className="ph-count">
          {daysLeft !== null ? (
            <>
              <span className="ph-num">{daysLeft}</span>
              <span className="ph-cap">{daysLeft % 10 === 1 && daysLeft % 100 !== 11 ? 'день' : [2, 3, 4].includes(daysLeft % 10) && ![12, 13, 14].includes(daysLeft % 100) ? 'дня' : 'дней'} до экзамена</span>
            </>
          ) : (
            <span className="ph-cap">дата экзамена — в Настройках</span>
          )}
        </div>
        <div className="ph-bar"><span style={{ width: `${pct}%` }} /></div>
        <div className="ph-sub">пройдено {pct}% плана · {done} из {all.length} занятий</div>
      </div>
      <div className="ph-right">
        <div className="ph-week">
          <Flame size={15} />
          <span>Эта неделя: <b>{weekDone}/{weekTotal}</b></span>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn ph-btn" onClick={onRefine}><Wand2 size={14} /> Изменить</button>
          <button className="btn ph-btn" onClick={onImport}><RefreshCw size={14} /> Обновить</button>
        </div>
      </div>
    </div>
  )
}

function LessonRow({ item, onToggle, onOpen }: { item: AgendaItem; onToggle: (b: string, l: string) => void; onOpen: Open }) {
  const { block, lesson, color } = item
  return (
    <div className={'lesson' + (lesson.done ? ' done' : '')} style={{ borderLeft: `4px solid ${color}` }}>
      <div className="kind-ic" style={{ background: color + '22', borderColor: 'transparent' }}>{kindIcon[lesson.kind]}</div>
      <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => onOpen(block.id, lesson.id)}>
        <div style={{ fontWeight: 650, textDecoration: lesson.done ? 'line-through' : 'none' }}>{lesson.title}</div>
        <div className="small muted">{item.subjectEmoji} {kindLabel[lesson.kind]} · {block.title}</div>
        {lesson.description && <div className="small muted" style={{ marginTop: 3 }}>{lesson.description}</div>}
      </div>
      <div className="tick" onClick={() => onToggle(block.id, lesson.id)}>{lesson.done && <Check size={15} color="#fff" />}</div>
    </div>
  )
}

/** Полоса текущей недели: кружки-дни с прогрессом, клик скроллит к дню. */
function WeekStrip({ agenda, onDayClick }: { agenda: Record<string, AgendaItem[]>; onDayClick: (dateISO: string) => void }) {
  const todayISO = iso(new Date())
  const ws = weekStartISO(todayISO)
  const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i))
  return (
    <div className="week-strip stagger">
      {days.map((d) => {
        const items = agenda[d] || []
        const doneN = items.filter((i) => i.lesson.done).length
        const isToday = d === todayISO
        const isPast = d < todayISO
        const allDone = items.length > 0 && doneN === items.length
        const dt = new Date(d)
        return (
          <div
            key={d}
            className={'ws-day' + (isToday ? ' today' : '') + (isPast ? ' past' : '') + (allDone ? ' alldone' : '')}
            onClick={() => onDayClick(d)}
            title={`${dayLabel(d)}: ${doneN}/${items.length}`}
          >
            <span className="ws-wd">{WD_SHORT[weekdayMon(dt) - 1]}</span>
            <span className="ws-num">{allDone ? <Check size={16} /> : dt.getDate()}</span>
            <span className="ws-dots">
              {items.slice(0, 4).map((it, i) => (
                <i key={i} style={{ background: it.lesson.done ? 'var(--accent)' : it.color, opacity: it.lesson.done ? 1 : 0.55 }} />
              ))}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function AgendaList({
  plan, schedules, matchSubject, onToggle, onOpen,
}: {
  plan: StudyPlan
  schedules: SubjectSchedule[]
  matchSubject: (sid: string) => boolean
  onToggle: (b: string, l: string) => void
  onOpen: Open
}) {
  const [showOverdue, setShowOverdue] = useState(false)
  const [openWeeks, setOpenWeeks] = useState<Set<string>>(() => new Set())
  const todayISO = iso(new Date())
  const agendaDays: AgendaDay[] = useMemo(() => buildAgenda(plan, schedules), [plan, schedules])
  const agenda = useMemo(() => {
    const m: Record<string, AgendaItem[]> = {}
    for (const d of agendaDays) m[d.dateISO] = d.items
    return m
  }, [agendaDays])

  const days = agendaDays
    .map((d) => ({ ...d, items: d.items.filter((i) => matchSubject(i.block.subjectId)) }))
    .filter((d) => d.items.length)

  if (!days.length) {
    return (
      <div className="empty">
        <div className="big">🗓️</div>
        <p>В плане нет занятий. Обнови план.</p>
      </div>
    )
  }

  // Прошлые несделанные → свёрнутая карточка «Просрочено»; прошлые сделанные живут в «Прогрессе».
  const overdueDays = days
    .filter((d) => d.dateISO < todayISO)
    .map((d) => ({ ...d, items: d.items.filter((i) => !i.lesson.done) }))
    .filter((d) => d.items.length)
  const overdueCount = overdueDays.reduce((s, d) => s + d.items.length, 0)
  const upcoming = days.filter((d) => d.dateISO >= todayISO)

  // Группировка по неделям: [{ ws, label, days, total, done }]
  const thisWs = weekStartISO(todayISO)
  const weeks: { ws: string; label: string; days: AgendaDay[]; total: number; doneN: number }[] = []
  for (const day of upcoming) {
    const ws = weekStartISO(day.dateISO)
    let w = weeks.find((x) => x.ws === ws)
    if (!w) {
      const label =
        ws === thisWs ? 'Эта неделя'
        : ws === addDays(thisWs, 7) ? 'Следующая неделя'
        : `${new Date(ws).getDate()} ${MONTHS_SHORT[new Date(ws).getMonth()]} – ${new Date(addDays(ws, 6)).getDate()} ${MONTHS_SHORT[new Date(addDays(ws, 6)).getMonth()]}`
      w = { ws, label, days: [], total: 0, doneN: 0 }
      weeks.push(w)
    }
    w.days.push(day)
    w.total += day.items.length
    w.doneN += day.items.filter((i) => i.lesson.done).length
  }

  // «Переключённые» недели: по умолчанию открыты первые две, клик инвертирует состояние.
  const weekOpen = (ws: string, idx: number) => (openWeeks.has(ws) ? !(idx < 2) : idx < 2)
  const toggleWeek = (ws: string) => {
    setOpenWeeks((prev) => {
      const next = new Set(prev)
      if (next.has(ws)) next.delete(ws)
      else next.add(ws)
      return next
    })
  }

  function scrollToDay(dateISO: string) {
    if (dateISO < todayISO) {
      setShowOverdue(true)
      setTimeout(() => document.getElementById('overdue-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60)
      return
    }
    const ws = weekStartISO(dateISO)
    const idx = weeks.findIndex((w) => w.ws === ws)
    if (idx >= 2 && !weekOpen(ws, idx)) toggleWeek(ws)
    setTimeout(() => document.getElementById('day-' + dateISO)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80)
  }

  return (
    <div className="grid" style={{ gap: 18 }}>
      <WeekStrip agenda={agenda} onDayClick={scrollToDay} />

      {overdueCount > 0 && (
        <div className="card" id="overdue-card" style={{ background: '#fff9ef', borderColor: '#f3dfb6' }}>
          <div className="row" style={{ gap: 10 }}>
            <b>⏰ Просрочено: {overdueCount}</b>
            <span className="small muted">— не отмечено из прошлых дней. Догони или просто продолжай с сегодня.</span>
            <div className="spacer" />
            <button className="btn btn-ghost btn-sm" onClick={() => setShowOverdue(!showOverdue)}>
              {showOverdue ? 'Скрыть' : 'Показать'}
            </button>
          </div>
          {showOverdue && overdueDays.map((day) => (
            <div key={day.dateISO} style={{ marginTop: 14 }}>
              <div className="small muted" style={{ marginBottom: 6, fontWeight: 650 }}>{dayLabel(day.dateISO)}</div>
              {day.items.map((it) => <LessonRow key={it.lesson.id} item={it} onToggle={onToggle} onOpen={onOpen} />)}
            </div>
          ))}
        </div>
      )}

      {weeks.map((w, wi) => {
        const opened = weekOpen(w.ws, wi)
        return (
          <div key={w.ws} className="week-group">
            <button className="week-head" onClick={() => toggleWeek(w.ws)}>
              <span className="wh-label">{w.label}</span>
              <span className="wh-prog">
                <span className="wh-bar"><i style={{ width: `${w.total ? (w.doneN / w.total) * 100 : 0}%` }} /></span>
                {w.doneN}/{w.total}
              </span>
              <ChevronDown size={17} className={'wh-chev' + (opened ? ' open' : '')} />
            </button>

            {opened && w.days.map((day) => {
              const isToday = day.dateISO === todayISO
              const doneN = day.items.filter((i) => i.lesson.done).length
              const allDone = doneN === day.items.length
              return (
                <div key={day.dateISO} id={'day-' + day.dateISO} className={'day-block' + (isToday ? ' day-today' : '')}>
                  <div className="row" style={{ marginBottom: 10, gap: 10 }}>
                    <h3 style={{ margin: 0, color: isToday ? 'var(--accent-text)' : 'var(--text)' }}>{dayLabel(day.dateISO)}</h3>
                    {isToday && <span className="badge strong">сегодня</span>}
                    <div className="spacer" />
                    <span className="chip">{doneN}/{day.items.length}</span>
                  </div>
                  {isToday && allDone && (
                    <div className="day-done-banner">🎉 День закрыт — все занятия выполнены. Красавчик!</div>
                  )}
                  {day.items.map((it) => <LessonRow key={it.lesson.id} item={it} onToggle={onToggle} onOpen={onOpen} />)}
                </div>
              )
            })}
          </div>
        )
      })}
      {upcoming.length === 0 && (
        <p className="muted small">Будущих занятий не осталось — обнови план или нажми «Изменить план».</p>
      )}
    </div>
  )
}

function CalendarView({
  plan, schedules, matchSubject, onToggle, onOpen,
}: {
  plan: StudyPlan
  schedules: SubjectSchedule[]
  matchSubject: (sid: string) => boolean
  onToggle: (b: string, l: string) => void
  onOpen: Open
}) {
  const [cursor, setCursor] = useState(() => { const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), 1) })
  const [selected, setSelected] = useState(() => iso(new Date()))
  const [open, setOpen] = useState(false)

  const mapAll = agendaByDate(plan, schedules)
  const map: Record<string, AgendaItem[]> = {}
  for (const [k, v] of Object.entries(mapAll)) {
    const f = v.filter((i) => matchSubject(i.block.subjectId))
    if (f.length) map[k] = f
  }

  const y = cursor.getFullYear()
  const m = cursor.getMonth()
  const firstWd = weekdayMon(new Date(y, m, 1))
  const daysIn = new Date(y, m + 1, 0).getDate()
  const todayISO = iso(new Date())
  const cells: (number | null)[] = []
  for (let i = 1; i < firstWd; i++) cells.push(null)
  for (let d = 1; d <= daysIn; d++) cells.push(d)
  const selItems = map[selected] || []

  return (
    <>
      <div className="card">
        <div className="cal-head">
          <button className="btn btn-ghost btn-sm" onClick={() => setCursor(new Date(y, m - 1, 1))}><ChevronLeft size={16} /></button>
          <div className="cal-title">{MONTHS[m]} {y}</div>
          <button className="btn btn-ghost btn-sm" onClick={() => setCursor(new Date(y, m + 1, 1))}><ChevronRight size={16} /></button>
          <div className="spacer" />
          <button className="btn btn-ghost btn-sm" onClick={() => { const t = new Date(); setCursor(new Date(t.getFullYear(), t.getMonth(), 1)); setSelected(iso(t)) }}>Сегодня</button>
        </div>
        <div className="cal-grid" style={{ marginBottom: 6 }}>
          {WD_SHORT.map((w) => <div key={w} className="cal-dow">{w}</div>)}
        </div>
        <div className="cal-grid">
          {cells.map((d, idx) => {
            if (d === null) return <div key={'e' + idx} className="cal-cell empty" />
            const dISO = iso(new Date(y, m, d))
            const items = map[dISO] || []
            const doneN = items.filter((i) => i.lesson.done).length
            const cls = 'cal-cell' + (dISO === todayISO ? ' today' : '') + (dISO === selected ? ' sel' : '') + (dISO < todayISO ? ' past' : '')
            return (
              <div key={dISO} className={cls} onClick={() => { setSelected(dISO); setOpen(true) }}>
                <div className="cal-num">{d}</div>
                {items.length > 0 && (
                  <>
                    <div className="cal-tasks">
                      {items.slice(0, 2).map((it, i) => (
                        <div key={i} className="cal-task" style={{ borderLeft: `3px solid ${it.color}`, textDecoration: it.lesson.done ? 'line-through' : 'none' }} title={it.lesson.title}>
                          {it.lesson.title}
                        </div>
                      ))}
                      {items.length > 2 && <div className="cal-more">+{items.length - 2} ещё</div>}
                    </div>
                    <div className="cal-prog"><i style={{ width: `${(doneN / items.length) * 100}%` }} /></div>
                  </>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {open && (
        <div className="drawer-bg" onClick={() => setOpen(false)}>
          <div className="drawer" onClick={(e) => e.stopPropagation()}>
            <div className="row" style={{ marginBottom: 4 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 21 }}>{dayLabel(selected)}</h2>
                <div className="small muted" style={{ textTransform: 'capitalize' }}>
                  {new Date(selected).toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}
                </div>
              </div>
              <div className="spacer" />
              <button className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}><X size={16} /></button>
            </div>
            <div className="chip" style={{ margin: '12px 0 16px' }}>{selItems.length} {selItems.length === 1 ? 'занятие' : 'занятий'}</div>
            {selItems.length === 0 ? (
              <p className="muted small">В этот день занятий по плану нет.</p>
            ) : (
              selItems.map((it) => <LessonRow key={it.lesson.id} item={it} onToggle={onToggle} onOpen={onOpen} />)
            )}
          </div>
        </div>
      )}
    </>
  )
}

const selChip = { borderColor: 'var(--accent)', background: 'var(--accent-soft)', color: 'var(--accent-text)' }
// использовано в PlanHero подсветкой предметных чипов при желании
void subjectById
