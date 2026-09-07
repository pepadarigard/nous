import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import { subjectById } from '../data/subjects'
import type { Block, Lesson } from '../types'
import { agendaByDate, blockColors, eventsByDate, type AgendaItem } from '../lib/schedule'
import { currentStreak } from '../lib/stats'
import { buildToday, type TodayAction } from '../lib/today'
import LessonDetail from './LessonDetail'
import WeekReview from './WeekReview'
import { Flame, CalendarClock, CheckCircle2, Target, ArrowRight, Check } from 'lucide-react'

type Open = (blockId: string, lessonId: string) => void

const kindIcon: Record<Lesson['kind'], string> = { theory: '📖', practice: '✏️', review: '🔁' }
const kindLabel: Record<Lesson['kind'], string> = { theory: 'Теория', practice: 'Практика', review: 'Повторение' }

// Вид пункта «Сегодня» — цветом и значком видно, что это за работа, без чтения.
const todayIcon: Record<string, string> = { review: '🔁', mock: '⏱', lesson: '📖', weak: '🎯', catchup: '⏰' }
function kindColor(kind: string): string {
  return kind === 'review' ? '#8b5cf6' : kind === 'mock' ? '#0ea5e9' : kind === 'weak' ? '#f59e0b' : kind === 'catchup' ? '#ef4444' : 'var(--accent)'
}

function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function Row({ block, lesson, color, onToggle, onOpen }: { block: Block; lesson: Lesson; color: string; onToggle?: (b: string, l: string) => void; onOpen: Open }) {
  const s = subjectById(block.subjectId)
  return (
    <div className={'lesson' + (lesson.done ? ' done' : '')} style={{ borderLeft: `4px solid ${color}` }}>
      <div className="kind-ic" style={{ background: color + '22', borderColor: 'transparent' }}>{kindIcon[lesson.kind]}</div>
      <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => onOpen(block.id, lesson.id)}>
        <div style={{ fontWeight: 650, textDecoration: lesson.done ? 'line-through' : 'none' }}>{lesson.title}</div>
        <div className="small muted">{s?.emoji} {kindLabel[lesson.kind]} · {block.title}</div>
      </div>
      {onToggle ? (
        <div className="tick" onClick={() => onToggle(block.id, lesson.id)}>{lesson.done && <Check size={15} color="#fff" />}</div>
      ) : (
        lesson.done && <Check size={16} color="var(--accent)" />
      )}
    </div>
  )
}

export default function Home() {
  const nav = useNavigate()
  const data = useStore((s) => s.data)
  const toggleEvent = useStore((s) => s.toggleEvent)
  const catchUpOverdue = useStore((s) => s.catchUpOverdue)
  const [moved, setMoved] = useState(0)
  const [detail, setDetail] = useState<{ blockId: string; lessonId: string } | null>(null)
  const onOpen: Open = (blockId, lessonId) => setDetail({ blockId, lessonId })
  const plan = data.plan

  if (!plan) {
    return (
      <div className="empty fade-in">
        <div className="big">🗓️</div>
        <p>Плана пока нет. Загляни в раздел «План» — соберётся за секунду, по структуре экзамена.</p>
        <button className="btn btn-primary" onClick={() => nav('/plan')}>К плану <ArrowRight size={16} /></button>
      </div>
    )
  }

  const colors = blockColors(plan)
  const allPairs = plan.blocks.flatMap((b) => b.lessons.map((l) => ({ block: b, lesson: l })))
  const total = allPairs.length
  const done = allPairs.filter((x) => x.lesson.done).length
  const pct = total ? Math.round((done / total) * 100) : 0
  const streak = currentStreak(data.progress, data.attempts ?? []) // единая логика со «Прогрессом»
  let daysLeft: number | null = null
  if (data.examDate) daysLeft = Math.ceil((new Date(data.examDate).getTime() - Date.now()) / 86400000)

  const agenda = agendaByDate(plan, data.schedules, data.rules)
  const todayISO = iso(new Date())
  const tmr = new Date()
  tmr.setDate(tmr.getDate() + 1)
  const tomorrow: AgendaItem[] = agenda[iso(tmr)] || []
  const evMap = eventsByDate(data.events ?? [])
  const todayEvents = evMap[todayISO] || []
  const tomorrowEvents = evMap[iso(tmr)] || []
  // Будущих занятий не осталось — план кончился, пора дописать или обновить.
  const planEnded = !Object.keys(agenda).some((k) => k >= todayISO && agenda[k].length > 0)

  // Программу на сегодня считает приложение — ученику остаётся идти сверху вниз.
  const day = buildToday(data)

  function runAction(a: TodayAction) {
    if (a.type === 'lesson') return onOpen(a.blockId, a.lessonId)
    if (a.type === 'mock') return nav('/trainer?tab=mock')
    if (a.type === 'catchup') return setMoved(catchUpOverdue())
    const p = new URLSearchParams()
    if (a.review) p.set('mode', 'review')
    if (a.subjectId) p.set('subject', a.subjectId)
    if (a.taskNo) p.set('task', String(a.taskNo))
    nav('/trainer?' + p.toString())
  }

  const recent = allPairs
    .filter((x) => x.lesson.done && x.lesson.completedAt)
    .sort((a, b) => (b.lesson.completedAt || '').localeCompare(a.lesson.completedAt || ''))
    .slice(0, 5)

  return (
    <div className="fade-in">
      <div className="page-head">
        <h1>Привет{data.studentName ? `, ${data.studentName}` : ''}! 👋</h1>
        <p>{plan.overview}</p>
      </div>

      {planEnded && (
        <div className="info-banner" style={{ marginBottom: 18 }}>
          <span style={{ fontSize: 18 }}>🏁</span>
          <div className="small" style={{ flex: 1 }}>
            <b>Занятия по плану закончились.</b> Самое время дописать план (новые темы или больше практики) или собрать новый.
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => nav('/plan')}>К плану</button>
        </div>
      )}

      <div className="grid cols-4 stagger" style={{ marginBottom: 22 }}>
        <div className="stat">
          <div className="row" style={{ gap: 8, color: 'var(--accent)' }}><Target size={17} /><span className="lbl" style={{ margin: 0 }}>Общий прогресс</span></div>
          <div className="val">{pct}%</div>
          <div className="pbar" style={{ marginTop: 8 }}><span style={{ width: `${pct}%` }} /></div>
        </div>
        <div className="stat">
          <div className="row" style={{ gap: 8, color: 'var(--success)' }}><CheckCircle2 size={17} /><span className="lbl" style={{ margin: 0 }}>Пройдено</span></div>
          <div className="val">{done}<span style={{ fontSize: 18, color: 'var(--muted)' }}> / {total}</span></div>
        </div>
        <div className="stat">
          <div className="row" style={{ gap: 8, color: 'var(--warn)' }}><Flame size={17} /><span className="lbl" style={{ margin: 0 }}>Серия дней</span></div>
          <div className="val">{streak} 🔥</div>
        </div>
        <div className="stat">
          <div className="row" style={{ gap: 8, color: '#0ea5e9' }}><CalendarClock size={17} /><span className="lbl" style={{ margin: 0 }}>До экзамена</span></div>
          <div className="val">{daysLeft !== null ? (daysLeft >= 0 ? `${daysLeft} дн.` : '—') : '—'}</div>
        </div>
      </div>

      {/* Единственный экран, отвечающий на вопрос «что делать». Порядок уже расставлен
          по приоритету, поэтому ученику не нужно ничего планировать — он идёт сверху вниз. */}
      <div className="card" style={{ marginBottom: 18 }}>
        <div className="row wrap" style={{ marginBottom: 6, gap: 10 }}>
          <h3 style={{ margin: 0 }}>📌 Сегодня</h3>
          <div className="spacer" />
          {day.minutes > 0 && <span className="chip">≈ {day.minutes} мин</span>}
        </div>
        <p className="small muted" style={{ marginTop: 0, marginBottom: 14 }}>{day.headline}</p>

        {day.items.map((it, i) => (
          <div
            key={it.id}
            className={'lesson' + (it.done ? ' done' : '')}
            style={{ borderLeft: '4px solid ' + kindColor(it.kind), cursor: 'pointer' }}
            onClick={() => runAction(it.action)}
          >
            <div className="kind-ic" style={{ background: kindColor(it.kind) + '22', borderColor: 'transparent' }}>
              {it.done ? '✓' : todayIcon[it.kind]}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 650, textDecoration: it.done ? 'line-through' : 'none' }}>
                {!it.done && it.kind !== 'catchup' && (
                  <span className="muted" style={{ marginRight: 6 }}>{i + 1}.</span>
                )}
                {it.title}
              </div>
              <div className="small muted">{it.detail}</div>
            </div>
            {!it.done && it.minutes > 0 && <span className="small muted">{it.minutes} мин</span>}
            <ArrowRight size={15} color="var(--muted)" />
          </div>
        ))}

        {todayEvents.length > 0 && (
          <div style={{ marginTop: 10 }}>
            {todayEvents.map((ev) => (
              <div key={ev.id} className={'lesson ev-row' + (ev.done ? ' done' : '')} style={{ borderLeft: '4px dashed var(--muted-2)' }}>
                <div className="kind-ic" style={{ background: 'var(--panel-2)', borderColor: 'transparent' }}>📌</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 650, textDecoration: ev.done ? 'line-through' : 'none' }}>
                    {ev.time ? <span className="muted" style={{ marginRight: 6 }}>{ev.time}</span> : null}
                    {ev.title}
                  </div>
                  <div className="small muted">Своё дело{ev.note ? ' · ' + ev.note : ''}</div>
                </div>
                <div className="tick" onClick={(e) => { e.stopPropagation(); toggleEvent(ev.id) }}>
                  {ev.done && <Check size={15} color="#fff" />}
                </div>
              </div>
            ))}
          </div>
        )}

        {moved > 0 && (
          <p className="small" style={{ color: 'var(--success)', marginBottom: 0 }}>
            Перенесено занятий: {moved}. Расписание снова сходится.
          </p>
        )}
      </div>

      <WeekReview />

      <div className="grid cols-2 stagger" style={{ alignItems: 'start' }}>
        <div className="card">
          <div className="row" style={{ marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: 16 }}>🌅 Завтра</h3>
            <div className="spacer" />
            <span className="chip">{tomorrow.length + tomorrowEvents.length}</span>
          </div>
          <p className="small muted" style={{ marginTop: 0 }}>
            Смотреть необязательно — завтра приложение само поставит это в «Сегодня».
          </p>
          {tomorrowEvents.map((ev) => (
            <div key={ev.id} className="lesson ev-row" style={{ borderLeft: '4px dashed var(--muted-2)' }}>
              <div className="kind-ic" style={{ background: 'var(--panel-2)', borderColor: 'transparent' }}>📌</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 650 }}>{ev.time ? <span className="muted" style={{ marginRight: 6 }}>{ev.time}</span> : null}{ev.title}</div>
                <div className="small muted">Своё дело</div>
              </div>
            </div>
          ))}
          {tomorrow.length === 0 ? (
            <p className="muted small">Завтра занятий по плану нет.</p>
          ) : (
            tomorrow.map((it) => <Row key={it.lesson.id} block={it.block} lesson={it.lesson} color={it.color} onOpen={onOpen} />)
          )}
        </div>

        <div className="card">
          <div className="row" style={{ marginBottom: 12 }}>
            <CheckCircle2 size={17} color="var(--success)" />
            <h3 style={{ margin: 0, fontSize: 16 }}>Недавно сделано</h3>
          </div>
          {recent.length === 0 ? (
            <p className="muted small">Пока ничего не отмечено. Начни с первого пункта в «Сегодня» 👆</p>
          ) : (
            recent.map((x) => <Row key={x.lesson.id} block={x.block} lesson={x.lesson} color={colors[x.block.id]} onOpen={onOpen} />)
          )}
        </div>
      </div>

      <div className="row" style={{ marginTop: 22 }}>
        <div className="spacer" />
        <button className="btn" onClick={() => nav('/plan')}>Весь план <ArrowRight size={15} /></button>
      </div>

      {detail && <LessonDetail blockId={detail.blockId} lessonId={detail.lessonId} onClose={() => setDetail(null)} />}
    </div>
  )
}
