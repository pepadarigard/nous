// Геймификация «Прогресса»: XP/уровни, серии, недельная динамика, тепловая карта активности, достижения.
// Всё считается ЧЕСТНО — только по реально отмеченным занятиям.

import type { AppData, LessonKind, ProgressEvent, StudyPlan } from '../types'

const POINTS: Record<LessonKind, number> = { theory: 8, practice: 12, review: 10 }
const LEVEL_TITLES = ['Новичок', 'Ученик', 'Знаток', 'Умник', 'Эрудит', 'Мастер', 'Гуру', 'Чемпион', 'Легенда', 'Гений ЕГЭ']

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export interface LevelInfo {
  level: number
  title: string
  xp: number
  intoLevel: number
  span: number
  toNext: number
  pct: number
}

// XP, нужный чтобы пройти уровень l насквозь (растёт с уровнем).
function xpForLevel(l: number): number {
  return 60 + (l - 1) * 45
}

export function levelInfo(xp: number): LevelInfo {
  let level = 1
  let acc = 0
  while (xp >= acc + xpForLevel(level)) {
    acc += xpForLevel(level)
    level++
  }
  const span = xpForLevel(level)
  const intoLevel = xp - acc
  const title = LEVEL_TITLES[Math.min(level - 1, LEVEL_TITLES.length - 1)]
  return { level, title, xp, intoLevel, span, toNext: span - intoLevel, pct: Math.round((intoLevel / span) * 100) }
}

function doneDays(events: ProgressEvent[]): Set<string> {
  return new Set(events.filter((e) => e.type === 'lesson_done').map((e) => new Date(e.at).toDateString()))
}

export function currentStreak(events: ProgressEvent[]): number {
  const days = doneDays(events)
  let streak = 0
  const cur = new Date()
  if (!days.has(cur.toDateString())) cur.setDate(cur.getDate() - 1)
  while (days.has(cur.toDateString())) {
    streak++
    cur.setDate(cur.getDate() - 1)
  }
  return streak
}

export function bestStreak(events: ProgressEvent[]): number {
  const keys = [...doneDays(events)].map((s) => new Date(s).getTime()).sort((a, b) => a - b)
  let best = 0
  let run = 0
  let prev = 0
  for (const t of keys) {
    if (prev && t - prev === 86400000) run++
    else run = 1
    if (run > best) best = run
    prev = t
  }
  return best
}

export interface HeatDay {
  date: string
  count: number
  lvl: number
  future: boolean
}

// Тепловая карта: `weeks` столбцов × 7 дней (Пн-Вс), сегодня — в последнем столбце.
export function buildHeat(events: ProgressEvent[], weeks = 13): HeatDay[][] {
  const counts: Record<string, number> = {}
  events.filter((e) => e.type === 'lesson_done').forEach((e) => {
    const k = dayKey(new Date(e.at))
    counts[k] = (counts[k] || 0) + 1
  })
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const end = new Date(today)
  const dow = (end.getDay() + 6) % 7 // Пн=0 … Вс=6
  end.setDate(end.getDate() + (6 - dow)) // до воскресенья текущей недели
  const cur = new Date(end)
  cur.setDate(cur.getDate() - (weeks * 7 - 1)) // назад к понедельнику N недель назад
  const cols: HeatDay[][] = []
  for (let w = 0; w < weeks; w++) {
    const col: HeatDay[] = []
    for (let d = 0; d < 7; d++) {
      const k = dayKey(cur)
      const c = counts[k] || 0
      const lvl = c === 0 ? 0 : c === 1 ? 1 : c === 2 ? 2 : c <= 4 ? 3 : 4
      col.push({ date: k, count: c, lvl, future: cur.getTime() > today.getTime() })
      cur.setDate(cur.getDate() + 1)
    }
    cols.push(col)
  }
  return cols
}

function countInWindow(events: ProgressEvent[], fromDaysAgo: number, toDaysAgo: number): number {
  const now = Date.now()
  const from = now - fromDaysAgo * 86400000
  const to = now - toDaysAgo * 86400000
  return events.filter((e) => e.type === 'lesson_done' && new Date(e.at).getTime() >= from && new Date(e.at).getTime() < to).length
}

export interface Achievement {
  id: string
  icon: string
  title: string
  desc: string
  unlocked: boolean
}

export interface Stats {
  doneCount: number
  totalCount: number
  overallPct: number
  byKind: Record<LessonKind, number>
  subjectsFull: number
  xp: number
  level: LevelInfo
  streak: number
  best: number
  thisWeek: number
  lastWeek: number
  weekDelta: number
  studiedToday: boolean
  heat: HeatDay[][]
  achievements: Achievement[]
  unlockedCount: number
}

export function computeStats(data: AppData): Stats {
  const plan: StudyPlan | undefined = data.plan
  const lessons = (plan?.blocks || []).flatMap((b) => b.lessons)
  const done = lessons.filter((l) => l.done)
  const byKind: Record<LessonKind, number> = { theory: 0, practice: 0, review: 0 }
  let xp = 0
  done.forEach((l) => {
    byKind[l.kind] = (byKind[l.kind] || 0) + 1
    xp += POINTS[l.kind] ?? 10
  })

  // предметов на 100% готовности
  const bySub: Record<string, { d: number; t: number }> = {}
  ;(plan?.blocks || []).forEach((b) => {
    const a = (bySub[b.subjectId] ||= { d: 0, t: 0 })
    b.lessons.forEach((l) => {
      a.t++
      if (l.done) a.d++
    })
  })
  const subjectsFull = Object.values(bySub).filter((v) => v.t > 0 && v.d === v.t).length

  const events = data.progress
  const streak = currentStreak(events)
  const best = Math.max(streak, bestStreak(events))
  const thisWeek = countInWindow(events, 7, 0)
  const lastWeek = countInWindow(events, 14, 7)
  const studiedToday = doneDays(events).has(new Date().toDateString())

  const doneCount = done.length
  const totalCount = lessons.length
  const level = levelInfo(xp)

  const A = (id: string, icon: string, title: string, desc: string, unlocked: boolean): Achievement => ({ id, icon, title, desc, unlocked })
  const achievements: Achievement[] = [
    A('first', '🌱', 'Первый шаг', 'Пройти 1 занятие', doneCount >= 1),
    A('ten', '📚', 'Десятка', 'Пройти 10 занятий', doneCount >= 10),
    A('quarter', '💪', 'Полсотни', 'Пройти 50 занятий', doneCount >= 50),
    A('hundred', '🏆', 'Сотня', 'Пройти 100 занятий', doneCount >= 100),
    A('streak3', '🔥', 'Разогрев', '3 дня подряд', best >= 3),
    A('streak7', '🔥', 'Неделя силы', '7 дней подряд', best >= 7),
    A('streak30', '⚡', 'Железная воля', '30 дней подряд', best >= 30),
    A('practice', '✍️', 'Практик', '20 практик решено', byKind.practice >= 20),
    A('review', '🔁', 'Повторяшка', '10 повторений', byKind.review >= 10),
    A('subject', '🎯', 'Предмет закрыт', 'Довести предмет до 100%', subjectsFull >= 1),
    A('level5', '⭐', 'Пятый уровень', 'Достичь 5 уровня', level.level >= 5),
    A('level10', '👑', 'Гений ЕГЭ', 'Достичь 10 уровня', level.level >= 10),
  ]

  return {
    doneCount,
    totalCount,
    overallPct: totalCount ? Math.round((doneCount / totalCount) * 100) : 0,
    byKind,
    subjectsFull,
    xp,
    level,
    streak,
    best,
    thisWeek,
    lastWeek,
    weekDelta: thisWeek - lastWeek,
    studiedToday,
    heat: buildHeat(events),
    achievements,
    unlockedCount: achievements.filter((a) => a.unlocked).length,
  }
}

// Событие-празднование (UI, НЕ сохраняется в state.json) — ставится в очередь при отметке занятия.
export type Celebration =
  | { id: string; kind: 'xp'; xp: number }
  | { id: string; kind: 'level'; level: number; title: string }
  | { id: string; kind: 'achievement'; icon: string; title: string; desc: string }

export interface Motivation {
  emoji: string
  title: string
  sub: string
}

export function motivate(s: Stats): Motivation {
  if (s.totalCount === 0) return { emoji: '🌱', title: 'Загрузи план и вперёд', sub: 'Как появится план — отмечай занятия, и здесь всё оживёт.' }
  if (s.doneCount === 0) return { emoji: '🚀', title: 'Пора начать!', sub: 'Отметь первое пройденное занятие — прогресс пойдёт вверх.' }
  if (s.studiedToday) return { emoji: '💪', title: 'Отличная работа сегодня!', sub: `Уровень ${s.level.level} · ${s.xp} XP. Каждое занятие приближает к цели.` }
  if (s.streak >= 7) return { emoji: '🔥', title: `${s.streak} дней подряд — ты в огне!`, sub: 'Позанимайся сегодня, чтобы не потерять серию.' }
  if (s.streak >= 1) return { emoji: '🔥', title: `Серия ${s.streak} — продолжай!`, sub: 'Отметь занятие сегодня, и серия станет длиннее.' }
  return { emoji: '✨', title: 'С возвращением!', sub: 'Одно занятие сегодня — и новая серия началась.' }
}
