import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import { subjectById } from '../data/subjects'
import type { Block, Lesson } from '../types'
import { agendaByDate, blockColors, dayLabel, eventsByDate, type AgendaItem } from '../lib/schedule'
import { currentStreak } from '../lib/stats'
import { reviewSummary } from '../lib/review'
import { countOf } from '../lib/plural'
import LessonDetail from './LessonDetail'
import WeekReview from './WeekReview'
import { Flame, CalendarClock, CheckCircle2, Target, RotateCcw, ArrowRight, Check } from 'lucide-react'

type Open = (blockId: string, lessonId: string) => void

const kindIcon: Record<Lesson['kind'], string> = { theory: '📖', practice: '✏️', review: '🔁' }
const kindLabel: Record<Lesson['kind'], string> = { theory: 'Теория', practice: 'Практика', review: 'Повторение' }

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
  const toggleLesson = useStore((s) => s.toggleLesson)
  const toggleEvent = useStore((s) => s.toggleEvent)
  const [detail, setDetail] = useState<{ blockId: string; lessonId: string } | null>(null)
  const onOpen: Open = (blockId, lessonId) => setDetail({ blockId, lessonId })
  const plan = data.plan

  if (!plan) {
    return (
      <div className="empty fade-in">
        <div className="big">🗓️</div>
        <p>Плана пока нет. Загляни в раздел «План», чтобы получить его от ИИ.</p>
        <button className="btn btn-primary" onClick={() => nav('/plan')}>К плану <ArrowRight size={16} /></button>
      </div>
    )
  }

  const colors = blockColors(plan)
  const allPairs = plan.blocks.flatMap((b) => b.lessons.map((l) => ({ block: b, lesson: l })))
  const total = allPairs.length
  const done = allPairs.filter((x) => x.lesson.done).length
  const pct = total ? Math.round((done / total) * 100) : 0
  const streak = currentStreak(data.progress) // единая логика со «Прогрессом»: только реальные занятия
  const due = reviewSummary(data.questions ?? [], data.attempts ?? [])
  let daysLeft: number | null = null
  if (data.examDate) daysLeft = Math.ceil((new Date(data.examDate).getTime() - Date.now()) / 86400000)

  const agenda = agendaByDate(plan, data.schedules, data.rules)
  const todayISO = iso(new Date())
  const today: AgendaItem[] = agenda[todayISO] || []
  const tmr = new Date()
  tmr.setDate(tmr.getDate() + 1)
  const tomorrow: AgendaItem[] = agenda[iso(tmr)] || []
  const evMap = eventsByDate(data.events ?? [])
  const todayEvents = evMap[todayISO] || []
  const tomorrowEvents = evMap[iso(tmr)] || []
  // Будущих занятий не осталось — план кончился, пора дописать или обновить.
  const planEnded = !Object.keys(agenda).some((k) => k >= todayISO && agenda[k].length > 0)

  const review = allPairs.filter((x) => x.lesson.kind === 'review' && !x.lesson.done).slice(0, 5)
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

      <WeekReview />

      {/* Интервальное повторение: то, в чём ошибся, возвращается по расписанию.
          Это про ЗАДАНИЯ из тренажёра — не путать с блоком «Что повторить» ниже,
          там занятия плана. */}
      {due.tracked > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="row wrap" style={{ gap: 10 }}>
            <RotateCcw size={17} color="var(--accent)" />
            <b>Повторить задания</b>
            {due.due > 0 ? (
              <span className="small muted">
                — {countOf(due.due, ['задание ждёт', 'задания ждут', 'заданий ждут'])} повторения. Дальше
                интервал растёт: день, три, неделя.
              </span>
            ) : (
              <span className="small muted">
                — на сегодня всё повторено
                {due.nextISO && <> · следующее {dayLabel(due.nextISO).toLowerCase()}</>}
              </span>
            )}
            <div className="spacer" />
            {due.due > 0 && (
              <button className="btn btn-primary btn-sm" onClick={() => nav('/trainer?mode=review')}>
                Повторить {due.due} <ArrowRight size={14} />
              </button>
            )}
          </div>
        </div>
      )}

      <div className="grid cols-2 stagger" style={{ alignItems: 'start' }}>
        <div className="card">
          <div className="row" style={{ marginBottom: 12 }}>
            <h3 style={{ margin: 0 }}>📌 Сегодня</h3>
            <div className="spacer" />
            <span className="chip">{today.length + todayEvents.length}</span>
          </div>
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
              <div className="tick" onClick={() => toggleEvent(ev.id)}>{ev.done && <Check size={15} color="#fff" />}</div>
            </div>
          ))}
          {today.length === 0 ? (
            <p className="muted small">
              {todayEvents.length ? 'Занятий плана на сегодня нет — только свои дела.' : 'На сегодня занятий нет — отдохни или повтори пройденное.'}
            </p>
          ) : (
            today.map((it) => <Row key={it.lesson.id} block={it.block} lesson={it.lesson} color={it.color} onToggle={toggleLesson} onOpen={onOpen} />)
          )}

          <div className="row" style={{ margin: '18px 0 10px' }}>
            <h3 style={{ margin: 0, fontSize: 16 }}>🌅 Завтра</h3>
            <div className="spacer" />
            <span className="chip">{tomorrow.length + tomorrowEvents.length}</span>
          </div>
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

        <div className="grid" style={{ gap: 16 }}>
          <div className="card">
            <div className="row" style={{ marginBottom: 12 }}>
              <RotateCcw size={17} color="var(--accent)" />
              <h3 style={{ margin: 0, fontSize: 16 }}>Что повторить</h3>
            </div>
            {review.length === 0 ? (
              <p className="muted small">Нет занятий на повторение — так держать!</p>
            ) : (
              review.map((x) => <Row key={x.lesson.id} block={x.block} lesson={x.lesson} color={colors[x.block.id]} onToggle={toggleLesson} onOpen={onOpen} />)
            )}
          </div>

          <div className="card">
            <div className="row" style={{ marginBottom: 12 }}>
              <CheckCircle2 size={17} color="var(--success)" />
              <h3 style={{ margin: 0, fontSize: 16 }}>Недавно сделано</h3>
            </div>
            {recent.length === 0 ? (
              <p className="muted small">Пока ничего не отмечено. Начни с заданий на сегодня 👆</p>
            ) : (
              recent.map((x) => <Row key={x.lesson.id} block={x.block} lesson={x.lesson} color={colors[x.block.id]} onOpen={onOpen} />)
            )}
          </div>
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
