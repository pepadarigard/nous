import { useMemo, useState } from 'react'
import { useStore } from '../store'
import { SUBJECTS } from '../data/subjects'
import type { Lesson, PlanEvent, ScheduleRules, StudyPlan, SubjectSchedule } from '../types'
import {
  addDaysISO,
  agendaByDate,
  buildAgenda,
  dayLabel,
  dayOffReason,
  eventsByDate,
  iso,
  todayISO,
  weekdayNum,
  type AgendaDay,
  type AgendaItem,
} from '../lib/schedule'
import { useDragMove, type DragPayload } from '../lib/dragmove'
import { countOf } from '../lib/plural'
import { EGE_YEAR } from '../data/ege2027'
import Modal from '../ui/Modal'
import PlanImporter from './PlanImporter'
import PlanExtender from './PlanExtender'
import LessonDetail from './LessonDetail'
import ScheduleSetup from './ScheduleSetup'
import DayEditor from './DayEditor'
import {
  Check,
  CalendarDays,
  ListChecks,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  RefreshCw,
  Wand2,
  Flame,
  SlidersHorizontal,
  Pin,
  CalendarPlus,
  ArrowDownToLine,
} from 'lucide-react'

const kindIcon: Record<Lesson['kind'], string> = { theory: '📖', practice: '✏️', review: '🔁' }
const kindLabel: Record<Lesson['kind'], string> = { theory: 'Теория', practice: 'Практика', review: 'Повторение' }
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
const WD_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

/** Понедельник недели, к которой относится дата. */
function weekStartISO(dateISO: string): string {
  const d = new Date(dateISO)
  d.setDate(d.getDate() - (weekdayNum(d) - 1))
  return iso(d)
}

type Open = (blockId: string, lessonId: string) => void
type DragStart = (e: React.PointerEvent, payload: DragPayload) => void

export default function PlanScreen() {
  const data = useStore((s) => s.data)
  const toggleLesson = useStore((s) => s.toggleLesson)
  const pinLesson = useStore((s) => s.pinLesson)
  const catchUpOverdue = useStore((s) => s.catchUpOverdue)
  const [filter, setFilter] = useState<string>('all')
  const [view, setView] = useState<'list' | 'calendar'>('list')
  const [importOpen, setImportOpen] = useState(false)
  const [refineOpen, setRefineOpen] = useState(false)
  const [rulesOpen, setRulesOpen] = useState(false)
  const [dayOpen, setDayOpen] = useState<string | null>(null)
  const [detail, setDetail] = useState<{ blockId: string; lessonId: string } | null>(null)

  const { drag, start, wasDragging } = useDragMove((p, date) => pinLesson(p.blockId, p.lessonId, date))

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
  const onOpen: Open = (blockId, lessonId) => {
    if (wasDragging()) return // отпустили занятие после перетаскивания — не открываем карточку
    setDetail({ blockId, lessonId })
  }

  return (
    <div className="fade-in">
      <PlanHero
        plan={plan}
        schedules={data.schedules}
        rules={data.rules}
        examDate={data.examDate}
        onImport={() => setImportOpen(true)}
        onRefine={() => setRefineOpen(true)}
        onRules={() => setRulesOpen(true)}
      />

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
        <AgendaList
          plan={plan}
          schedules={data.schedules}
          rules={data.rules}
          events={data.events ?? []}
          matchSubject={matchSubject}
          onToggle={toggleLesson}
          onOpen={onOpen}
          onDragStart={start}
          overDay={drag?.over ?? null}
          onDayClick={(d) => setDayOpen(d)}
          onCatchUp={catchUpOverdue}
        />
      ) : (
        <CalendarView
          plan={plan}
          schedules={data.schedules}
          rules={data.rules}
          events={data.events ?? []}
          matchSubject={matchSubject}
          onOpenDay={(d) => setDayOpen(d)}
          onDragStart={start}
          overDay={drag?.over ?? null}
        />
      )}

      {drag && (
        <div className="drag-ghost" style={{ left: drag.x + 14, top: drag.y + 12 }}>
          📌 {drag.payload.title}
          <span className="dg-hint">{drag.over ? 'отпусти — перенесу на ' + dayLabel(drag.over).toLowerCase() : 'наведи на день'}</span>
        </div>
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
      {rulesOpen && (
        <Modal title="Расписание" onClose={() => setRulesOpen(false)} wide>
          <ScheduleSetup />
        </Modal>
      )}
      {dayOpen && <DayEditor dateISO={dayOpen} onClose={() => setDayOpen(null)} onOpenLesson={onOpen} />}
      {detail && <LessonDetail blockId={detail.blockId} lessonId={detail.lessonId} onClose={() => setDetail(null)} />}
    </div>
  )
}

/** Тёмная hero-карта: обратный отсчёт до ЕГЭ, прогресс пути, темп недели. */
function PlanHero({ plan, schedules, rules, examDate, onImport, onRefine, onRules }: {
  plan: StudyPlan
  schedules: SubjectSchedule[]
  rules?: ScheduleRules
  examDate?: string
  onImport: () => void
  onRefine: () => void
  onRules: () => void
}) {
  const all = plan.blocks.flatMap((b) => b.lessons)
  const done = all.filter((l) => l.done).length
  const pct = all.length ? Math.round((done / all.length) * 100) : 0
  const daysLeft = examDate ? Math.max(0, Math.ceil((new Date(examDate).getTime() - Date.now()) / 86400000)) : null

  // Темп этой недели: занятия с датами внутри текущей недели.
  const ws = weekStartISO(todayISO())
  const we = addDaysISO(ws, 6)
  const agenda = useMemo(() => agendaByDate(plan, schedules, rules), [plan, schedules, rules])
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
        <div className="ph-bar"><span style={{ width: pct + '%' }} /></div>
        <div className="ph-sub">пройдено {pct}% плана · {done} из {all.length} занятий</div>
      </div>
      <div className="ph-right">
        <div className="ph-week">
          <Flame size={15} />
          <span>Эта неделя: <b>{weekDone}/{weekTotal}</b></span>
        </div>
        <div className="row wrap" style={{ gap: 8 }}>
          <button className="btn ph-btn" onClick={onRules}><SlidersHorizontal size={14} /> Расписание</button>
          <button className="btn ph-btn" onClick={onRefine}><Wand2 size={14} /> Изменить</button>
          <button className="btn ph-btn" onClick={onImport}><RefreshCw size={14} /> Обновить</button>
        </div>
      </div>
    </div>
  )
}

function LessonRow({ item, onToggle, onOpen, onDragStart }: {
  item: AgendaItem
  onToggle: (b: string, l: string) => void
  onOpen: Open
  onDragStart?: DragStart
}) {
  const { block, lesson, color } = item
  return (
    <div
      className={'lesson' + (lesson.done ? ' done' : '') + (onDragStart ? ' movable' : '')}
      style={{ borderLeft: '4px solid ' + color }}
      onPointerDown={(e) => onDragStart?.(e, { blockId: block.id, lessonId: lesson.id, title: lesson.title })}
      title={onDragStart ? 'Перетащи на другой день, чтобы перенести' : undefined}
    >
      <div className="kind-ic" style={{ background: color + '22', borderColor: 'transparent' }}>{kindIcon[lesson.kind]}</div>
      <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => onOpen(block.id, lesson.id)}>
        <div style={{ fontWeight: 650, textDecoration: lesson.done ? 'line-through' : 'none' }}>
          {lesson.title}
          {item.pinned && <Pin size={12} style={{ marginLeft: 6, verticalAlign: -1, color: 'var(--accent)' }} />}
        </div>
        <div className="small muted">{item.subjectEmoji} {kindLabel[lesson.kind]} · {block.title}</div>
        {lesson.description && <div className="small muted" style={{ marginTop: 3 }}>{lesson.description}</div>}
      </div>
      <div className="tick" onClick={() => onToggle(block.id, lesson.id)}>{lesson.done && <Check size={15} color="#fff" />}</div>
    </div>
  )
}

/** Своё дело в ленте дня. */
function EventRow({ ev, onToggle, onClick }: { ev: PlanEvent; onToggle?: (id: string) => void; onClick?: () => void }) {
  return (
    <div className={'lesson ev-row' + (ev.done ? ' done' : '')} style={{ borderLeft: '4px dashed var(--muted-2)' }}>
      <div className="kind-ic" style={{ background: 'var(--panel-2)', borderColor: 'transparent' }}>📌</div>
      <div style={{ flex: 1, minWidth: 0, cursor: onClick ? 'pointer' : 'default' }} onClick={onClick}>
        <div style={{ fontWeight: 650, textDecoration: ev.done ? 'line-through' : 'none' }}>
          {ev.time ? <span className="muted" style={{ marginRight: 6 }}>{ev.time}</span> : null}
          {ev.title}
        </div>
        <div className="small muted">Своё дело{ev.note ? ' · ' + ev.note : ''}</div>
      </div>
      {onToggle && (
        <div className="tick" onClick={() => onToggle(ev.id)}>{ev.done && <Check size={15} color="#fff" />}</div>
      )}
    </div>
  )
}

/** Полоса текущей недели: кружки-дни с прогрессом, клик открывает день, можно бросить занятие. */
function WeekStrip({ agenda, events, rules, overDay, onDayClick }: {
  agenda: Record<string, AgendaItem[]>
  events: Record<string, PlanEvent[]>
  rules?: ScheduleRules
  overDay: string | null
  onDayClick: (dateISO: string) => void
}) {
  const today = todayISO()
  const ws = weekStartISO(today)
  const days = Array.from({ length: 7 }, (_, i) => addDaysISO(ws, i))
  return (
    <div className="week-strip stagger">
      {days.map((d) => {
        const items = agenda[d] || []
        const evs = events[d] || []
        const doneN = items.filter((i) => i.lesson.done).length
        const isToday = d === today
        const isPast = d < today
        const allDone = items.length > 0 && doneN === items.length
        const off = dayOffReason(d, rules)
        const dt = new Date(d)
        return (
          <div
            key={d}
            data-day={d}
            className={'ws-day' + (isToday ? ' today' : '') + (isPast ? ' past' : '') + (allDone ? ' alldone' : '') + (off ? ' off' : '') + (overDay === d ? ' drop' : '')}
            onClick={() => onDayClick(d)}
            title={off ? off : dayLabel(d) + ': ' + doneN + '/' + items.length}
          >
            <span className="ws-wd">{WD_SHORT[weekdayNum(dt) - 1]}</span>
            <span className="ws-num">{allDone ? <Check size={16} /> : dt.getDate()}</span>
            <span className="ws-dots">
              {items.slice(0, 4).map((it, i) => (
                <i key={i} style={{ background: it.lesson.done ? 'var(--accent)' : it.color, opacity: it.lesson.done ? 1 : 0.55 }} />
              ))}
              {evs.length > 0 && <i style={{ background: 'var(--muted-2)' }} />}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function AgendaList({
  plan, schedules, rules, events, matchSubject, onToggle, onOpen, onDragStart, overDay, onDayClick, onCatchUp,
}: {
  plan: StudyPlan
  schedules: SubjectSchedule[]
  rules?: ScheduleRules
  events: PlanEvent[]
  matchSubject: (sid: string) => boolean
  onToggle: (b: string, l: string) => void
  onOpen: Open
  onDragStart: DragStart
  overDay: string | null
  onDayClick: (dateISO: string) => void
  onCatchUp: () => number
}) {
  const toggleEvent = useStore((s) => s.toggleEvent)
  const [showOverdue, setShowOverdue] = useState(false)
  const [openWeeks, setOpenWeeks] = useState<Set<string>>(() => new Set())
  const [moved, setMoved] = useState(0)
  const today = todayISO()
  const agendaDays: AgendaDay[] = useMemo(() => buildAgenda(plan, schedules, rules), [plan, schedules, rules])
  const agenda = useMemo(() => {
    const m: Record<string, AgendaItem[]> = {}
    for (const d of agendaDays) m[d.dateISO] = d.items
    return m
  }, [agendaDays])
  const evMap = useMemo(() => eventsByDate(events), [events])

  // Занятию может не найтись места: каникулы, выходные или дни недели предмета
  // способны перекрыть весь горизонт — и тогда план молча пустеет. Считаем потерю,
  // чтобы сказать о причине прямо, а не показывать пустой экран.
  const unplaced = useMemo(() => {
    const total = plan.blocks.reduce((n, b) => n + b.lessons.length, 0)
    return total - agendaDays.reduce((n, d) => n + d.items.length, 0)
  }, [plan, agendaDays])

  const days = agendaDays
    .map((d) => ({ ...d, items: d.items.filter((i) => matchSubject(i.block.subjectId)) }))
    .filter((d) => d.items.length)

  // Прошлые несделанные → свёрнутая карточка «Просрочено»; прошлые сделанные живут в «Прогрессе».
  const overdueDays = days
    .filter((d) => d.dateISO < today)
    .map((d) => ({ ...d, items: d.items.filter((i) => !i.lesson.done) }))
    .filter((d) => d.items.length)
  const overdueCount = overdueDays.reduce((s, d) => s + d.items.length, 0)
  const upcoming = days.filter((d) => d.dateISO >= today)

  // Дни со своими делами, но без занятий, тоже должны быть в ленте.
  const upcomingKeys = new Set(upcoming.map((d) => d.dateISO))
  const eventOnlyDays: AgendaDay[] = Object.keys(evMap)
    .filter((d) => d >= today && !upcomingKeys.has(d))
    .map((d) => ({ dateISO: d, date: new Date(d), items: [] }))
  const allUpcoming = [...upcoming, ...eventOnlyDays].sort((a, b) => a.dateISO.localeCompare(b.dateISO))

  // Группировка по неделям
  const thisWs = weekStartISO(today)
  const weeks: { ws: string; label: string; days: AgendaDay[]; total: number; doneN: number }[] = []
  for (const day of allUpcoming) {
    const ws = weekStartISO(day.dateISO)
    let w = weeks.find((x) => x.ws === ws)
    if (!w) {
      const label =
        ws === thisWs ? 'Эта неделя'
        : ws === addDaysISO(thisWs, 7) ? 'Следующая неделя'
        : new Date(ws).getDate() + ' ' + MONTHS_SHORT[new Date(ws).getMonth()] + ' – ' + new Date(addDaysISO(ws, 6)).getDate() + ' ' + MONTHS_SHORT[new Date(addDaysISO(ws, 6)).getMonth()]
      w = { ws, label, days: [], total: 0, doneN: 0 }
      weeks.push(w)
    }
    w.days.push(day)
    w.total += day.items.length
    w.doneN += day.items.filter((i) => i.lesson.done).length
  }

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
    if (dateISO < today) {
      setShowOverdue(true)
      setTimeout(() => document.getElementById('overdue-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60)
      return
    }
    const ws = weekStartISO(dateISO)
    const idx = weeks.findIndex((w) => w.ws === ws)
    if (idx >= 2 && !weekOpen(ws, idx)) toggleWeek(ws)
    setTimeout(() => document.getElementById('day-' + dateISO)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80)
  }

  if (!days.length && !Object.keys(evMap).length) {
    return (
      <div className="empty">
        <div className="big">🗓️</div>
        {unplaced > 0 ? (
          <p>
            В плане {countOf(unplaced, ['занятие', 'занятия', 'занятий'])}, но места для них не
            нашлось: каникулы, выходные или дни недели предметов перекрыли весь период. Загляни в
            «Расписание».
          </p>
        ) : (
          <p>В плане нет занятий. Обнови план.</p>
        )}
      </div>
    )
  }

  return (
    <div className="grid" style={{ gap: 18 }}>
      <WeekStrip agenda={agenda} events={evMap} rules={rules} overDay={overDay} onDayClick={scrollToDay} />

      {unplaced > 0 && (
        <div className="card" style={{ background: '#fff9ef', borderColor: '#f3dfb6' }}>
          <div className="row wrap" style={{ gap: 10 }}>
            <b>⚠️ Не поместилось: {unplaced}</b>
            <span className="small muted">
              — каникулы, выходные или дни недели предмета не оставили места. Проверь «Расписание».
            </span>
          </div>
        </div>
      )}

      {overdueCount > 0 && (
        <div className="card" id="overdue-card" style={{ background: '#fff9ef', borderColor: '#f3dfb6' }}>
          <div className="row wrap" style={{ gap: 10 }}>
            <b>⏰ Просрочено: {overdueCount}</b>
            <span className="small muted">— не отмечено из прошлых дней.</span>
            <div className="spacer" />
            <button
              className="btn btn-primary btn-sm"
              onClick={() => setMoved(onCatchUp())}
              title="Разложить просроченное по ближайшим дням, не больше двух в день"
            >
              <ArrowDownToLine size={14} /> Перенести вперёд
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowOverdue(!showOverdue)}>
              {showOverdue ? 'Скрыть' : 'Показать'}
            </button>
          </div>
          {moved > 0 && (
            <p className="small" style={{ color: 'var(--accent-text)', margin: '10px 0 0' }}>
              ✓ Перенесено: {countOf(moved, ['занятие', 'занятия', 'занятий'])}. Они закреплены на новых датах — открой занятие, чтобы вернуть его в общий поток.
            </p>
          )}
          {showOverdue && overdueDays.map((day) => (
            <div key={day.dateISO} style={{ marginTop: 14 }}>
              <div className="small muted" style={{ marginBottom: 6, fontWeight: 650 }}>{dayLabel(day.dateISO)}</div>
              {day.items.map((it) => <LessonRow key={it.lesson.id} item={it} onToggle={onToggle} onOpen={onOpen} onDragStart={onDragStart} />)}
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
                <span className="wh-bar"><i style={{ width: (w.total ? (w.doneN / w.total) * 100 : 0) + '%' }} /></span>
                {w.doneN}/{w.total}
              </span>
              <ChevronDown size={17} className={'wh-chev' + (opened ? ' open' : '')} />
            </button>

            {opened && w.days.map((day) => {
              const isToday = day.dateISO === today
              const doneN = day.items.filter((i) => i.lesson.done).length
              const allDone = day.items.length > 0 && doneN === day.items.length
              const dayEvents = evMap[day.dateISO] || []
              const off = dayOffReason(day.dateISO, rules)
              return (
                <div
                  key={day.dateISO}
                  id={'day-' + day.dateISO}
                  data-day={day.dateISO}
                  className={'day-block' + (isToday ? ' day-today' : '') + (overDay === day.dateISO ? ' drop' : '')}
                >
                  <div className="row wrap" style={{ marginBottom: 10, gap: 10 }}>
                    <h3 style={{ margin: 0, color: isToday ? 'var(--accent-text)' : 'var(--text)' }}>{dayLabel(day.dateISO)}</h3>
                    {isToday && <span className="badge strong">сегодня</span>}
                    {off && <span className="badge">{off}</span>}
                    <div className="spacer" />
                    <button className="btn btn-ghost btn-sm" onClick={() => onDayClick(day.dateISO)} title="Добавить своё дело, перенести занятия">
                      <CalendarPlus size={14} /> День
                    </button>
                    <span className="chip">{doneN}/{day.items.length}</span>
                  </div>
                  {isToday && allDone && dayEvents.every((e) => e.done) && (
                    <div className="day-done-banner">🎉 День закрыт — все занятия выполнены. Красавчик!</div>
                  )}
                  {dayEvents.map((ev) => <EventRow key={ev.id} ev={ev} onToggle={toggleEvent} onClick={() => onDayClick(day.dateISO)} />)}
                  {day.items.map((it) => <LessonRow key={it.lesson.id} item={it} onToggle={onToggle} onOpen={onOpen} onDragStart={onDragStart} />)}
                </div>
              )
            })}
          </div>
        )
      })}
      {allUpcoming.length === 0 && (
        <p className="muted small">Будущих занятий не осталось — обнови план или нажми «Изменить план».</p>
      )}
    </div>
  )
}

function CalendarView({
  plan, schedules, rules, events, matchSubject, onOpenDay, onDragStart, overDay,
}: {
  plan: StudyPlan
  schedules: SubjectSchedule[]
  rules?: ScheduleRules
  events: PlanEvent[]
  matchSubject: (sid: string) => boolean
  onOpenDay: (dateISO: string) => void
  onDragStart: DragStart
  overDay: string | null
}) {
  const [cursor, setCursor] = useState(() => { const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), 1) })

  const mapAll = useMemo(() => agendaByDate(plan, schedules, rules), [plan, schedules, rules])
  const map: Record<string, AgendaItem[]> = {}
  for (const [k, v] of Object.entries(mapAll)) {
    const f = v.filter((i) => matchSubject(i.block.subjectId))
    if (f.length) map[k] = f
  }
  const evMap = useMemo(() => eventsByDate(events), [events])

  const y = cursor.getFullYear()
  const m = cursor.getMonth()
  const firstWd = weekdayNum(new Date(y, m, 1))
  const daysIn = new Date(y, m + 1, 0).getDate()
  const today = todayISO()
  const cells: (number | null)[] = []
  for (let i = 1; i < firstWd; i++) cells.push(null)
  for (let d = 1; d <= daysIn; d++) cells.push(d)

  return (
    <div className="card">
      <div className="cal-head">
        <button className="btn btn-ghost btn-sm" onClick={() => setCursor(new Date(y, m - 1, 1))}><ChevronLeft size={16} /></button>
        <div className="cal-title">{MONTHS[m]} {y}</div>
        <button className="btn btn-ghost btn-sm" onClick={() => setCursor(new Date(y, m + 1, 1))}><ChevronRight size={16} /></button>
        <div className="spacer" />
        <span className="small muted" style={{ marginRight: 10 }}>Занятие можно перетащить на другой день</span>
        <button className="btn btn-ghost btn-sm" onClick={() => { const t = new Date(); setCursor(new Date(t.getFullYear(), t.getMonth(), 1)) }}>Сегодня</button>
      </div>
      <div className="cal-grid" style={{ marginBottom: 6 }}>
        {WD_SHORT.map((w) => <div key={w} className="cal-dow">{w}</div>)}
      </div>
      <div className="cal-grid">
        {cells.map((d, idx) => {
          if (d === null) return <div key={'e' + idx} className="cal-cell empty" />
          const dISO = iso(new Date(y, m, d))
          const items = map[dISO] || []
          const evs = evMap[dISO] || []
          const doneN = items.filter((i) => i.lesson.done).length
          const off = dayOffReason(dISO, rules)
          const cls = 'cal-cell'
            + (dISO === today ? ' today' : '')
            + (dISO < today ? ' past' : '')
            + (off ? ' off' : '')
            + (overDay === dISO ? ' drop' : '')
          return (
            <div key={dISO} data-day={dISO} className={cls} onClick={() => onOpenDay(dISO)} title={off || undefined}>
              <div className="cal-num">{d}{off && <span className="cal-off">🌴</span>}</div>
              {(items.length > 0 || evs.length > 0) && (
                <>
                  <div className="cal-tasks">
                    {evs.slice(0, 1).map((ev) => (
                      <div key={ev.id} className="cal-task" style={{ borderLeft: '3px dashed var(--muted-2)', textDecoration: ev.done ? 'line-through' : 'none' }} title={ev.title}>
                        📌 {ev.title}
                      </div>
                    ))}
                    {items.slice(0, evs.length ? 1 : 2).map((it) => (
                      <div
                        key={it.lesson.id}
                        className="cal-task movable"
                        style={{ borderLeft: '3px solid ' + it.color, textDecoration: it.lesson.done ? 'line-through' : 'none' }}
                        title={it.lesson.title}
                        onPointerDown={(e) => onDragStart(e, { blockId: it.block.id, lessonId: it.lesson.id, title: it.lesson.title })}
                      >
                        {it.lesson.title}
                      </div>
                    ))}
                    {items.length + evs.length > 2 && <div className="cal-more">+{items.length + evs.length - 2} ещё</div>}
                  </div>
                  {items.length > 0 && <div className="cal-prog"><i style={{ width: (doneN / items.length) * 100 + '%' }} /></div>}
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

const selChip = { borderColor: 'var(--accent)', background: 'var(--accent-soft)', color: 'var(--accent-text)' }
