import { useMemo, useState } from 'react'
import { useStore } from '../store'
import { addDaysISO, agendaByDate, dayLabel, dayOffReason, eventsByDate, todayISO } from '../lib/schedule'
import type { PlanEvent } from '../types'
import { countOf } from '../lib/plural'
import { Check, X, Plus, Trash2, CalendarOff, CalendarCheck, Pin, PinOff, ArrowRight } from 'lucide-react'

/**
 * Один день целиком: занятия плана (можно переносить), свои дела, выходной.
 * Открывается кликом по дню в календаре или по кнопке «День» в ленте.
 */
export default function DayEditor({
  dateISO,
  onClose,
  onOpenLesson,
}: {
  dateISO: string
  onClose: () => void
  onOpenLesson?: (blockId: string, lessonId: string) => void
}) {
  const data = useStore((s) => s.data)
  const toggleLesson = useStore((s) => s.toggleLesson)
  const pinLesson = useStore((s) => s.pinLesson)
  const addEvent = useStore((s) => s.addEvent)
  const updateEvent = useStore((s) => s.updateEvent)
  const removeEvent = useStore((s) => s.removeEvent)
  const toggleEvent = useStore((s) => s.toggleEvent)
  const setRules = useStore((s) => s.setRules)

  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const [time, setTime] = useState('')
  const [note, setNote] = useState('')
  const [moveFor, setMoveFor] = useState<string | null>(null) // id занятия, для которого открыт выбор даты

  const rules = data.rules
  const off = dayOffReason(dateISO, rules)
  const isSingleDayOff = (rules?.daysOff ?? []).includes(dateISO)

  const items = useMemo(
    () => (data.plan ? (agendaByDate(data.plan, data.schedules, data.rules)[dateISO] ?? []) : []),
    [data.plan, data.schedules, data.rules, dateISO],
  )
  const events: PlanEvent[] = useMemo(() => eventsByDate(data.events ?? [])[dateISO] ?? [], [data.events, dateISO])

  function submitEvent() {
    const t = title.trim()
    if (!t) return
    addEvent({ date: dateISO, title: t, time: time || undefined, note: note.trim() || undefined })
    setTitle('')
    setTime('')
    setNote('')
    setAdding(false)
  }

  function toggleDayOff() {
    const cur = rules?.daysOff ?? []
    setRules({ daysOff: isSingleDayOff ? cur.filter((d) => d !== dateISO) : [...cur, dateISO].sort() })
  }

  // Заглавной должна быть только первая буква: capitalize по-CSS поднимал и месяц,
  // и «г.» — получалось «7 Сентября 2026 Г.».
  const dateText = new Date(dateISO).toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const full = dateText.charAt(0).toUpperCase() + dateText.slice(1)

  return (
    <div className="drawer-bg" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ marginBottom: 4 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 21 }}>{dayLabel(dateISO)}</h2>
            <div className="small muted">{full}</div>
          </div>
          <div className="spacer" />
          <button className="btn btn-ghost btn-sm" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="row wrap" style={{ margin: '12px 0 16px', gap: 8 }}>
          <span className="chip">{countOf(items.length, ['занятие', 'занятия', 'занятий'])}</span>
          {events.length > 0 && <span className="chip">{countOf(events.length, ['своё дело', 'своих дела', 'своих дел'])}</span>}
          {off && <span className="badge">{off}</span>}
          <div className="spacer" />
          {!off || isSingleDayOff ? (
            <button className="btn btn-ghost btn-sm" onClick={toggleDayOff}>
              {isSingleDayOff ? <><CalendarCheck size={14} /> Сделать рабочим</> : <><CalendarOff size={14} /> Сделать выходным</>}
            </button>
          ) : (
            <span className="small muted">день внутри каникул — правится в «Расписании»</span>
          )}
        </div>

        {events.map((ev) => (
          <div key={ev.id} className={'lesson ev-row' + (ev.done ? ' done' : '')} style={{ borderLeft: '4px dashed var(--muted-2)' }}>
            <div className="kind-ic" style={{ background: 'var(--panel-2)', borderColor: 'transparent' }}>📌</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <input
                className="inline-input"
                value={ev.title}
                onChange={(e) => updateEvent(ev.id, { title: e.target.value })}
                style={{ textDecoration: ev.done ? 'line-through' : 'none' }}
              />
              <div className="row" style={{ gap: 8, marginTop: 2 }}>
                <input
                  className="inline-input small"
                  type="time"
                  value={ev.time ?? ''}
                  onChange={(e) => updateEvent(ev.id, { time: e.target.value || undefined })}
                  style={{ width: 88 }}
                />
                <input
                  className="inline-input small"
                  placeholder="заметка"
                  value={ev.note ?? ''}
                  onChange={(e) => updateEvent(ev.id, { note: e.target.value || undefined })}
                />
              </div>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => removeEvent(ev.id)} title="Удалить"><Trash2 size={14} /></button>
            <div className="tick" onClick={() => toggleEvent(ev.id)}>{ev.done && <Check size={15} color="#fff" />}</div>
          </div>
        ))}

        {adding ? (
          <div className="card soft" style={{ marginTop: 10 }}>
            <label className="field">
              <span>Что за дело</span>
              <input
                className="input"
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') submitEvent() }}
                placeholder="Репетитор по физике, пробник, тренировка…"
              />
            </label>
            <div className="row wrap" style={{ gap: 10 }}>
              <label className="field" style={{ marginBottom: 0 }}>
                <span>Время</span>
                <input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} style={{ width: 130 }} />
              </label>
              <label className="field" style={{ marginBottom: 0, flex: 1, minWidth: 160 }}>
                <span>Заметка</span>
                <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="необязательно" />
              </label>
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              <div className="spacer" />
              <button className="btn btn-ghost btn-sm" onClick={() => setAdding(false)}>Отмена</button>
              <button className="btn btn-primary btn-sm" onClick={submitEvent} disabled={!title.trim()}>Добавить</button>
            </div>
          </div>
        ) : (
          <button className="btn btn-sm" style={{ marginTop: 6 }} onClick={() => setAdding(true)}>
            <Plus size={14} /> Своё дело
          </button>
        )}

        <div style={{ height: 18 }} />

        {items.length === 0 ? (
          <p className="muted small">Занятий плана в этот день нет{off ? ' — день отмечен как «' + off + '»' : ''}.</p>
        ) : (
          items.map((it) => (
            <div key={it.lesson.id} className={'lesson' + (it.lesson.done ? ' done' : '')} style={{ borderLeft: '4px solid ' + it.color, flexWrap: 'wrap' }}>
              <div className="kind-ic" style={{ background: it.color + '22', borderColor: 'transparent' }}>
                {it.lesson.kind === 'theory' ? '📖' : it.lesson.kind === 'practice' ? '✏️' : '🔁'}
              </div>
              <div style={{ flex: 1, minWidth: 0, cursor: onOpenLesson ? 'pointer' : 'default' }} onClick={() => onOpenLesson?.(it.block.id, it.lesson.id)}>
                <div style={{ fontWeight: 650, textDecoration: it.lesson.done ? 'line-through' : 'none' }}>
                  {it.lesson.title}
                  {it.pinned && <Pin size={12} style={{ marginLeft: 6, verticalAlign: -1, color: 'var(--accent)' }} />}
                </div>
                <div className="small muted">{it.subjectEmoji} {it.block.title}</div>
              </div>
              <div className="tick" onClick={() => toggleLesson(it.block.id, it.lesson.id)}>{it.lesson.done && <Check size={15} color="#fff" />}</div>

              <div className="row wrap" style={{ width: '100%', gap: 6, marginTop: 8 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => pinLesson(it.block.id, it.lesson.id, addDaysISO(dateISO, 1))} title="Перенести на завтра">
                  <ArrowRight size={13} /> На день
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => pinLesson(it.block.id, it.lesson.id, addDaysISO(dateISO, 7))} title="Перенести на неделю вперёд">
                  +7 дней
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => pinLesson(it.block.id, it.lesson.id, todayISO())}>
                  Сегодня
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => setMoveFor(moveFor === it.lesson.id ? null : it.lesson.id)}>
                  Дата…
                </button>
                {it.pinned && (
                  <button className="btn btn-ghost btn-sm" onClick={() => pinLesson(it.block.id, it.lesson.id)} title="Вернуть в общий поток плана">
                    <PinOff size={13} /> В поток
                  </button>
                )}
                {moveFor === it.lesson.id && (
                  <input
                    className="input"
                    type="date"
                    autoFocus
                    defaultValue={dateISO}
                    onChange={(e) => {
                      if (!e.target.value) return
                      pinLesson(it.block.id, it.lesson.id, e.target.value)
                      setMoveFor(null)
                    }}
                    style={{ width: 165, padding: '6px 10px' }}
                  />
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
