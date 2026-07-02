// Расписание плана по дням («лента») + цвета блоков.
// Скользящий подход: незавершённые занятия раскладываются по доступным дням, начиная с сегодня.
// Так «сегодня» всегда актуально, а пропущенное не копится как просрочка.

import type { Block, Lesson, StudyPlan, SubjectSchedule } from '../types'
import { subjectById } from '../data/subjects'

export const BLOCK_COLORS = [
  '#6d5efc',
  '#34d399',
  '#f59e0b',
  '#f472b6',
  '#38bdf8',
  '#a78bfa',
  '#fb7185',
  '#4ade80',
  '#facc15',
  '#22d3ee',
  '#c084fc',
  '#fb923c',
]

/** Цвет для каждого блока плана (по порядку). */
export function blockColors(plan: StudyPlan): Record<string, string> {
  const map: Record<string, string> = {}
  plan.blocks.forEach((b, i) => {
    map[b.id] = BLOCK_COLORS[i % BLOCK_COLORS.length]
  })
  return map
}

export interface AgendaItem {
  dateISO: string
  block: Block
  lesson: Lesson
  color: string
  subjectShort: string
  subjectEmoji: string
}
export interface AgendaDay {
  dateISO: string
  date: Date
  items: AgendaItem[]
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}
function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
/** JS getDay(): 0=Вс..6=Сб → наш формат 1=Пн..7=Вс. */
function weekdayNum(d: Date): number {
  const j = d.getDay()
  return j === 0 ? 7 : j
}

/**
 * Разложить незавершённые занятия по дням, начиная с сегодня.
 * По каждому предмету — свои дни недели; в один день может быть несколько предметов.
 */
export function buildAgenda(
  plan: StudyPlan,
  schedules: SubjectSchedule[],
  horizonDays = 800,
): AgendaDay[] {
  const colors = blockColors(plan)
  // Фиксированная раскладка от даты создания плана: у каждого занятия своя дата, выполненные НЕ пропадают.
  const anchor = startOfDay(plan.createdAt ? new Date(plan.createdAt) : new Date())

  // Очередь ВСЕХ занятий по предметам (сохраняя порядок блоков), включая выполненные.
  const bySubject: Record<string, { block: Block; lesson: Lesson }[]> = {}
  for (const b of plan.blocks) {
    for (const l of b.lessons) {
      ;(bySubject[b.subjectId] ||= []).push({ block: b, lesson: l })
    }
  }

  const daysMap: Record<string, AgendaItem[]> = {}
  const scheduleFor = (sid: string) => schedules.find((s) => s.subjectId === sid)

  for (const [sid, queue] of Object.entries(bySubject)) {
    if (!queue.length) continue
    const sch = scheduleFor(sid)
    const days = sch?.days?.length ? sch.days : [1, 2, 3, 4, 5] // по умолчанию будни
    const subj = subjectById(sid)
    const cursor = new Date(anchor)
    let placed = 0
    let guard = 0
    while (placed < queue.length && guard < horizonDays) {
      if (days.includes(weekdayNum(cursor))) {
        const { block, lesson } = queue[placed]
        const key = iso(cursor)
        ;(daysMap[key] ||= []).push({
          dateISO: key,
          block,
          lesson,
          color: colors[block.id],
          subjectShort: subj?.short ?? sid,
          subjectEmoji: subj?.emoji ?? '📘',
        })
        placed++
      }
      cursor.setDate(cursor.getDate() + 1)
      guard++
    }
  }

  return Object.keys(daysMap)
    .sort()
    .map((k) => ({ dateISO: k, date: new Date(k), items: daysMap[k] }))
}

const WD_FULL = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']

/** Человеческая подпись дня: «Сегодня», «Завтра», иначе «Пн, 7 июл». */
export function dayLabel(dateISO: string): string {
  const d = new Date(dateISO)
  const today = startOfDay(new Date())
  const diff = Math.round((d.getTime() - today.getTime()) / 86400000)
  if (diff === 0) return 'Сегодня'
  if (diff === 1) return 'Завтра'
  return `${WD_FULL[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`
}

/** Карта «дата (ISO) → занятия» для календарной сетки. */
export function agendaByDate(plan: StudyPlan, schedules: SubjectSchedule[], horizon = 250): Record<string, AgendaItem[]> {
  const map: Record<string, AgendaItem[]> = {}
  for (const d of buildAgenda(plan, schedules, horizon)) map[d.dateISO] = d.items
  return map
}

/** Занятия на сегодня (для главной). */
export function todayItems(plan: StudyPlan, schedules: SubjectSchedule[]): AgendaItem[] {
  const agenda = buildAgenda(plan, schedules, 3)
  const todayISO = iso(startOfDay(new Date()))
  return agenda.find((d) => d.dateISO === todayISO)?.items ?? []
}
