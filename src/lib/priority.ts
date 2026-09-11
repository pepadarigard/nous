// Цена балла: что подтягивать первым.
//
// Зачем это нужно. Готовиться ко всему сразу нельзя — времени до экзамена
// конечное число. А решение «чем заняться сегодня» ученик принимает вслепую:
// обычно он идёт добивать то, что и так получается, потому что там приятнее.
//
// Между тем это считается арифметикой, без всякого ИИ. Известны три вещи:
//  1. Сколько баллов стоит номер — официальные веса из scoring.ts.
//  2. Насколько ты его уже берёшь — твоя точность по попыткам.
//  3. Сколько там ещё можно добрать — разница до потолка.
//
// Отсюда «сколько первичных баллов лежит невостребованными в этом номере».
// Дальше делим на трудоёмкость: задание второй части на четыре балла даёт
// больше, но и стоит нескольких недель, а номер на один балл, который ты
// проваливаешь по невнимательности, забирается за вечер.
//
// Считаем ЧЕСТНО и говорим, чего не знаем: по номеру без попыток сказать
// нечего, и такой номер попадает в отдельный список «ещё не мерили», а не
// подмешивается к расчёту с выдуманной точностью.

import type { Attempt } from '../types'
import { SCORING, taskPoints } from '../data/scoring'
import { EGE_TASKS, isPart2, taskSection } from '../data/egeTasks'

/** Во сколько раз задание второй части дороже по времени, чем номер первой. */
const PART2_EFFORT = 4

/**
 * Со скольких попыток точность считается надёжной.
 *
 * Меньше — не повод молчать: диагностический срез даёт по одной попытке на
 * номер, и это уже в разы лучше, чем ничего. Но такую строчку надо ПОДПИСАТЬ
 * как грубую, иначе «берёшь 0%» по одному промаху выглядит приговором.
 */
export const ENOUGH_TRIES = 3

export interface Priority {
  subjectId: string
  taskNo: number
  title: string
  section: string
  /** Вес номера в первичных баллах. */
  points: number
  /** Доля верных, 0…1. */
  rate: number
  tries: number
  /** Сколько первичных баллов здесь ещё можно добрать. */
  gap: number
  /** Баллы на единицу усилия — по этому и сортируем. */
  value: number
  /** Попыток меньше надёжного минимума — цифра грубая, так и подписываем. */
  rough: boolean
  part2: boolean
}

/**
 * Что выгоднее всего подтянуть по одному предмету.
 *
 * @param attempts вся история попыток
 * @param subjectId предмет
 */
export function priorities(attempts: Attempt[], subjectId: string): Priority[] {
  const scoring = SCORING[subjectId]
  const tasks = EGE_TASKS[subjectId]
  if (!scoring || !tasks) return []

  const tries = new Map<number, { total: number; correct: number }>()
  for (const a of attempts) {
    if (a.subjectId !== subjectId || a.correct === null || !a.taskNo) continue
    const st = tries.get(a.taskNo) ?? { total: 0, correct: 0 }
    st.total++
    if (a.correct) st.correct++
    tries.set(a.taskNo, st)
  }

  const out: Priority[] = []
  for (const t of tasks) {
    const st = tries.get(t.no)
    if (!st) continue // ни одной попытки — гадать не о чем
    const points = taskPoints(subjectId, t.no)
    if (!points) continue
    const rate = st.correct / st.total
    const gap = points * (1 - rate)
    const part2 = isPart2(subjectId, t.no)
    out.push({
      subjectId,
      taskNo: t.no,
      title: t.title,
      section: t.section,
      points,
      rate,
      tries: st.total,
      gap,
      value: gap / (part2 ? PART2_EFFORT : 1),
      part2,
      rough: st.total < ENOUGH_TRIES,
    })
  }
  return out.sort((a, b) => b.value - a.value)
}

/** Номера, по которым нет ни одной попытки: их надо сначала прорешать, а не чинить. */
export function notMeasured(attempts: Attempt[], subjectId: string): number[] {
  const tasks = EGE_TASKS[subjectId]
  if (!tasks) return []
  const tries = new Map<number, number>()
  for (const a of attempts) {
    if (a.subjectId !== subjectId || a.correct === null || !a.taskNo) continue
    tries.set(a.taskNo, (tries.get(a.taskNo) ?? 0) + 1)
  }
  return tasks.filter((t) => !tries.get(t.no)).map((t) => t.no)
}

/**
 * Сколько первичных баллов лежит невостребованными в целом разделе.
 * Тот же расчёт, но сложенный по разделам: с этого начинают, когда провал
 * не в одном номере, а в теме.
 */
export function sectionPriorities(
  attempts: Attempt[],
  subjectId: string,
): { section: string; gap: number; tasks: number[] }[] {
  const map = new Map<string, { section: string; gap: number; tasks: number[] }>()
  for (const p of priorities(attempts, subjectId)) {
    const key = p.section || taskSection(subjectId, p.taskNo)
    const cur = map.get(key) ?? { section: key, gap: 0, tasks: [] }
    cur.gap += p.gap
    cur.tasks.push(p.taskNo)
    map.set(key, cur)
  }
  return [...map.values()]
    .map((s) => ({ ...s, tasks: s.tasks.sort((a, b) => a - b) }))
    .sort((a, b) => b.gap - a.gap)
}

/**
 * Сколько всего баллов можно добрать по предмету — и сколько из них в первых
 * трёх номерах списка. Нужно, чтобы честно написать «половина потерь тут».
 */
export function gapSummary(attempts: Attempt[], subjectId: string): { total: number; top: number } {
  const list = priorities(attempts, subjectId)
  const total = list.reduce((n, p) => n + p.gap, 0)
  const top = list.slice(0, 3).reduce((n, p) => n + p.gap, 0)
  return { total, top }
}
