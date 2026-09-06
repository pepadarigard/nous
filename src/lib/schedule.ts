// Расписание плана по дням («лента») + цвета блоков.
//
// Место занятия в календаре определяется двумя правилами, в порядке приоритета:
//  1) занятие перенесено руками (lesson.pinnedDate) — стоит ровно там, куда его поставили;
//  2) иначе — авто-раскладка от даты создания плана по дням недели предмета,
//     с учётом выходных/каникул и потолка занятий в день.
// Выполненные занятия остаются на своих местах — история не пропадает.

import type { Block, Lesson, PlanEvent, ScheduleRules, StudyPlan, SubjectSchedule } from '../types'
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
  pinned: boolean // перенесено руками
}
export interface AgendaDay {
  dateISO: string
  date: Date
  items: AgendaItem[]
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}
export function iso(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return d.getFullYear() + '-' + mm + '-' + dd
}
export function todayISO(): string {
  return iso(startOfDay(new Date()))
}
export function addDaysISO(dateISO: string, n: number): string {
  const d = new Date(dateISO)
  d.setDate(d.getDate() + n)
  return iso(d)
}
/** JS getDay(): 0=Вс..6=Сб → наш формат 1=Пн..7=Вс. */
export function weekdayNum(d: Date): number {
  const j = d.getDay()
  return j === 0 ? 7 : j
}

/** Почему в этот день нет занятий («Каникулы», «Выходной») или null. */
export function dayOffReason(dateISO: string, rules?: ScheduleRules): string | null {
  if (!rules) return null
  if (rules.daysOff?.includes(dateISO)) return 'Выходной'
  const v = rules.vacations?.find((x) => dateISO >= x.from && dateISO <= x.to)
  return v ? v.title || 'Каникулы' : null
}

/** Быстрая проверка «день свободен от занятий». */
function offChecker(rules?: ScheduleRules): (dateISO: string) => boolean {
  const set = new Set(rules?.daysOff ?? [])
  const vacs = rules?.vacations ?? []
  return (dateISO: string) => set.has(dateISO) || vacs.some((v) => dateISO >= v.from && dateISO <= v.to)
}

const DEFAULT_DAYS = [1, 2, 3, 4, 5] // будни

/** Дни недели предмета (с запасным вариантом — будни). */
export function daysOfSubject(schedules: SubjectSchedule[], subjectId: string): number[] {
  const s = schedules.find((x) => x.subjectId === subjectId)
  return s?.days?.length ? s.days : DEFAULT_DAYS
}

/**
 * Разложить занятия плана по дням.
 * @param rules выходные/каникулы/потолок занятий в день (необязательно)
 */
export function buildAgenda(
  plan: StudyPlan,
  schedules: SubjectSchedule[],
  rules?: ScheduleRules,
  horizonDays = 900,
): AgendaDay[] {
  const colors = blockColors(plan)
  const daysMap: Record<string, AgendaItem[]> = {}

  const mk = (block: Block, lesson: Lesson, dateISO: string, pinned: boolean): AgendaItem => {
    const subj = subjectById(block.subjectId)
    return {
      dateISO,
      block,
      lesson,
      color: colors[block.id],
      subjectShort: subj?.short ?? block.subjectId,
      subjectEmoji: subj?.emoji ?? '📘',
      pinned,
    }
  }
  const put = (dateISO: string, item: AgendaItem) => {
    if (!daysMap[dateISO]) daysMap[dateISO] = []
    daysMap[dateISO].push(item)
  }

  // 1. Закреплённые руками — сразу на свои даты (они же занимают места в потолке дня).
  const queues: Record<string, { block: Block; lesson: Lesson }[]> = {}
  const order: string[] = [] // порядок предметов = порядок появления блоков в плане
  for (const b of plan.blocks) {
    for (const l of b.lessons) {
      if (l.pinnedDate) {
        put(l.pinnedDate, mk(b, l, l.pinnedDate, true))
        continue
      }
      if (!queues[b.subjectId]) {
        queues[b.subjectId] = []
        order.push(b.subjectId)
      }
      queues[b.subjectId].push({ block: b, lesson: l })
    }
  }

  // 2. Авто-раскладка остальных: идём по датам, на каждой раздаём слоты предметам.
  const anchor = startOfDay(plan.createdAt ? new Date(plan.createdAt) : new Date())
  const maxPerDay = rules?.maxPerDay && rules.maxPerDay > 0 ? rules.maxPerDay : Infinity
  const isOff = offChecker(rules)
  const ptr: Record<string, number> = {}
  for (const sid of order) ptr[sid] = 0
  const remaining = () => order.reduce((n, sid) => n + (queues[sid].length - ptr[sid]), 0)

  const cursor = new Date(anchor)
  let guard = 0
  while (remaining() > 0 && guard < horizonDays) {
    const key = iso(cursor)
    if (!isOff(key)) {
      const wd = weekdayNum(cursor)
      let slots = maxPerDay - (daysMap[key]?.length ?? 0)
      for (const sid of order) {
        if (slots <= 0) break
        if (ptr[sid] >= queues[sid].length) continue
        const sch = schedules.find((s) => s.subjectId === sid)
        const days = sch?.days?.length ? sch.days : DEFAULT_DAYS
        if (!days.includes(wd)) continue
        const perDay = Math.max(1, Math.min(6, sch?.perDay ?? 1))
        for (let k = 0; k < perDay && slots > 0 && ptr[sid] < queues[sid].length; k++) {
          const pair = queues[sid][ptr[sid]++]
          put(key, mk(pair.block, pair.lesson, key, false))
          slots--
        }
      }
    }
    cursor.setDate(cursor.getDate() + 1)
    guard++
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
  if (diff === -1) return 'Вчера'
  return WD_FULL[d.getDay()] + ', ' + d.getDate() + ' ' + MONTHS[d.getMonth()]
}

/** Карта «дата (ISO) → занятия» для календарной сетки. */
export function agendaByDate(
  plan: StudyPlan,
  schedules: SubjectSchedule[],
  rules?: ScheduleRules,
): Record<string, AgendaItem[]> {
  const map: Record<string, AgendaItem[]> = {}
  for (const d of buildAgenda(plan, schedules, rules)) map[d.dateISO] = d.items
  return map
}

/** Занятия на сегодня (для главной). */
export function todayItems(plan: StudyPlan, schedules: SubjectSchedule[], rules?: ScheduleRules): AgendaItem[] {
  const key = todayISO()
  return buildAgenda(plan, schedules, rules).find((d) => d.dateISO === key)?.items ?? []
}

/** Свои дела по датам. */
export function eventsByDate(events: PlanEvent[] = []): Record<string, PlanEvent[]> {
  const map: Record<string, PlanEvent[]> = {}
  for (const e of events) {
    if (!map[e.date]) map[e.date] = []
    map[e.date].push(e)
  }
  for (const k of Object.keys(map)) map[k].sort((a, b) => (a.time || '').localeCompare(b.time || ''))
  return map
}

/** Просроченные занятия: в прошлом и не отмечены. */
export function overdueItems(agenda: AgendaDay[]): AgendaItem[] {
  const today = todayISO()
  return agenda.filter((d) => d.dateISO < today).flatMap((d) => d.items.filter((i) => !i.lesson.done))
}

const CATCHUP_PER_DAY = 2 // сколько догоняющих занятий добавляем в один день

/** Ближайший подходящий день для предмета, с учётом уже занятых догоняющими слотов. */
function findCatchUpSlot(
  subjectId: string,
  schedules: SubjectSchedule[],
  rules: ScheduleRules | undefined,
  added: Record<string, number>,
): string {
  const isOff = offChecker(rules)
  const days = daysOfSubject(schedules, subjectId)
  let cursor = todayISO()
  for (let guard = 0; guard < 500; guard++) {
    const fits = !isOff(cursor) && days.includes(weekdayNum(new Date(cursor))) && (added[cursor] ?? 0) < CATCHUP_PER_DAY
    if (fits) {
      added[cursor] = (added[cursor] ?? 0) + 1
      return cursor
    }
    cursor = addDaysISO(cursor, 1)
  }
  return todayISO()
}

/**
 * Разложить ВСЁ просроченное по ближайшим подходящим дням (по дням недели предмета,
 * мимо выходных и каникул, не больше двух догоняющих в день).
 *
 * Считается итеративно: закрепление занятия вынимает его из общей очереди, из-за чего
 * следующие занятия подтягиваются вперёд и сами могут оказаться в прошлом. Повторяем,
 * пока просрочка не исчезнет — одного нажатия должно хватать.
 *
 * Возвращает карту «id занятия → дата» для закрепления.
 */
export function catchUpPlan(
  plan: StudyPlan,
  schedules: SubjectSchedule[],
  rules?: ScheduleRules,
): Record<string, string> {
  const work: StudyPlan = JSON.parse(JSON.stringify(plan))
  const added: Record<string, number> = {}
  const result: Record<string, string> = {}

  for (let pass = 0; pass < 12; pass++) {
    const overdue = overdueItems(buildAgenda(work, schedules, rules))
    if (!overdue.length) break
    for (const item of overdue) {
      const date = findCatchUpSlot(item.block.subjectId, schedules, rules, added)
      result[item.lesson.id] = date
      const lesson = work.blocks.find((b) => b.id === item.block.id)?.lessons.find((l) => l.id === item.lesson.id)
      if (lesson) lesson.pinnedDate = date
    }
  }
  return result
}
