import { useState } from 'react'
import { useStore } from '../store'
import { SUBJECTS } from '../data/subjects'
import type { Lesson, StudyPlan, SubjectSchedule } from '../types'
import { agendaByDate, buildAgenda, dayLabel, type AgendaItem } from '../lib/schedule'
import Modal from '../ui/Modal'
import PlanImporter from './PlanImporter'
import PlanExtender from './PlanExtender'
import LessonDetail from './LessonDetail'
import { Check, CalendarDays, ListChecks, ChevronLeft, ChevronRight, X, RefreshCw, Wand2 } from 'lucide-react'

const kindIcon: Record<Lesson['kind'], string> = { theory: '📖', practice: '✏️', review: '🔁' }
const kindLabel: Record<Lesson['kind'], string> = { theory: 'Теория', practice: 'Практика', review: 'Повторение' }
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function weekdayMon(d: Date): number {
  const j = d.getDay()
  return j === 0 ? 7 : j
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
      <div className="page-head">
        <div className="row">
          <div>
            <h1>План подготовки</h1>
            <p>{plan.overview}</p>
          </div>
          <div className="spacer" />
          <div className="row wrap" style={{ gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn" onClick={() => setRefineOpen(true)}><Wand2 size={15} /> Дописать план</button>
            <button className="btn" onClick={() => setImportOpen(true)}><RefreshCw size={15} /> Обновить план</button>
          </div>
        </div>
      </div>

      <div className="row wrap" style={{ marginBottom: 18, gap: 8 }}>
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
        <Modal title="Дописать план" onClose={() => setRefineOpen(false)}>
          <PlanExtender onDone={() => setRefineOpen(false)} />
        </Modal>
      )}
      {detail && <LessonDetail blockId={detail.blockId} lessonId={detail.lessonId} onClose={() => setDetail(null)} />}
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

function AgendaList({
  plan, schedules, matchSubject, onToggle, onOpen,
}: {
  plan: StudyPlan
  schedules: SubjectSchedule[]
  matchSubject: (sid: string) => boolean
  onToggle: (b: string, l: string) => void
  onOpen: Open
}) {
  const agenda = buildAgenda(plan, schedules)
    .map((d) => ({ ...d, items: d.items.filter((i) => matchSubject(i.block.subjectId)) }))
    .filter((d) => d.items.length)

  if (!agenda.length) {
    return (
      <div className="empty">
        <div className="big">🗓️</div>
        <p>В плане нет занятий. Обнови план.</p>
      </div>
    )
  }

  return (
    <div className="grid" style={{ gap: 22 }}>
      {agenda.map((day) => {
        const isToday = dayLabel(day.dateISO) === 'Сегодня'
        const doneN = day.items.filter((i) => i.lesson.done).length
        return (
          <div key={day.dateISO}>
            <div className="row" style={{ marginBottom: 10, gap: 10 }}>
              <h3 style={{ margin: 0, color: isToday ? 'var(--accent-text)' : 'var(--text)' }}>{dayLabel(day.dateISO)}</h3>
              {isToday && <span className="badge strong">сегодня</span>}
              <div className="spacer" />
              <span className="chip">{doneN}/{day.items.length}</span>
            </div>
            {day.items.map((it) => <LessonRow key={it.lesson.id} item={it} onToggle={onToggle} onOpen={onOpen} />)}
          </div>
        )
      })}
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
          {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((w) => <div key={w} className="cal-dow">{w}</div>)}
        </div>
        <div className="cal-grid">
          {cells.map((d, idx) => {
            if (d === null) return <div key={'e' + idx} className="cal-cell empty" />
            const dISO = iso(new Date(y, m, d))
            const items = map[dISO] || []
            const cls = 'cal-cell' + (dISO === todayISO ? ' today' : '') + (dISO === selected ? ' sel' : '') + (dISO < todayISO ? ' past' : '')
            return (
              <div key={dISO} className={cls} onClick={() => { setSelected(dISO); setOpen(true) }}>
                <div className="cal-num">{d}</div>
                {items.length > 0 && (
                  <div className="cal-tasks">
                    {items.slice(0, 2).map((it, i) => (
                      <div key={i} className="cal-task" style={{ borderLeft: `3px solid ${it.color}`, textDecoration: it.lesson.done ? 'line-through' : 'none' }} title={it.lesson.title}>
                        {it.lesson.title}
                      </div>
                    ))}
                    {items.length > 2 && <div className="cal-more">+{items.length - 2} ещё</div>}
                  </div>
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
