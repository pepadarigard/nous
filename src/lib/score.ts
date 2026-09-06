// Честная оценка балла — по тому, что ученик РЕШИЛ, а не по тому, что отметил галочкой.
//
// Зачем это вообще. Раньше балл на экране считался так: стартовый балл, который ученик
// назвал сам, плюс доля отмеченных занятий до цели, которую он тоже назвал сам. То есть
// можно было отметить весь план, не решив ни одной задачи, и увидеть «85 баллов».
// Здесь оценка берётся из попыток в тренажёре: точность по каждому номеру задания
// умножается на официальный вес этого номера в первичных баллах.
//
// Главный принцип: НЕ ЗНАЕМ — НЕ ПОКАЗЫВАЕМ. Если по номеру нет решений, он не
// превращается молча в ноль и не подставляется «средним по больнице» без предупреждения:
// рядом с любой оценкой идёт покрытие — какая доля работы вообще проверена.

import type { Attempt } from '../types'
import { SCORING, hasScoring, taskPoints, toTestScore } from '../data/scoring'

/** Насколько уверенно решается конкретный номер задания. */
export interface TaskAccuracy {
  taskNo: number
  /** Вес номера в первичных баллах. */
  points: number
  total: number
  correct: number
  /** Доля верных, 0–1. */
  rate: number
}

export interface SubjectEstimate {
  subjectId: string
  maxPrimary: number
  /** Сумма весов номеров, по которым есть хотя бы одно решение. */
  coveredPoints: number
  /** Доля работы, проверенная решениями, 0–1. */
  coverage: number
  /** Первичные баллы, заработанные на проверенной части. Это же — нижняя граница. */
  earnedOnCovered: number
  /** Нижняя граница в тестовых: непроверенное не даёт ничего. */
  floorTest: number
  /** Ожидаемый первичный балл за всю работу, если остальное пойдёт так же. */
  expectedPrimary: number
  /** Он же в тестовых баллах — верхняя, оптимистичная граница. */
  testScore: number
  /** Сколько попыток учтено. */
  attempts: number
  /** Номера, где чаще ошибаешься — сначала самые дорогие. */
  weakest: TaskAccuracy[]
  perTask: TaskAccuracy[]
  /** Год шкалы перевода — чтобы честно подписать цифру. */
  scaleYear: number
  /** Шкала не покрывает нынешний максимум (структура КИМ уже поменялась). */
  scaleStale: boolean
}

/** Меньше этого числа решений по предмету — цифре верить рано. */
export const ENOUGH_ATTEMPTS = 20

/**
 * Оценка по предмету. null — если предмета нет в официальных данных
 * или по нему вообще ничего не решено (тогда показывать нечего).
 */
export function estimateSubject(subjectId: string, attempts: Attempt[]): SubjectEstimate | null {
  const s = SCORING[subjectId]
  if (!s) return null

  // Самопроверка без вердикта (correct === null) в счёт не идёт — это не измерение.
  const byTask = new Map<number, { total: number; correct: number }>()
  let used = 0
  for (const a of attempts) {
    if (a.subjectId !== subjectId || a.correct === null || a.taskNo === undefined) continue
    if (!taskPoints(subjectId, a.taskNo)) continue // номера нет в этой работе
    const st = byTask.get(a.taskNo) ?? { total: 0, correct: 0 }
    st.total++
    if (a.correct) st.correct++
    byTask.set(a.taskNo, st)
    used++
  }
  if (!used) return null

  const perTask: TaskAccuracy[] = [...byTask.entries()]
    .map(([taskNo, st]) => ({
      taskNo,
      points: taskPoints(subjectId, taskNo),
      total: st.total,
      correct: st.correct,
      rate: st.correct / st.total,
    }))
    .sort((a, b) => a.taskNo - b.taskNo)

  const coveredPoints = perTask.reduce((n, t) => n + t.points, 0)
  const earnedOnCovered = perTask.reduce((n, t) => n + t.points * t.rate, 0)
  const coverage = coveredPoints / s.maxPrimary
  // Экстраполяция: непроверенная часть пойдёт как проверенная. Честна ровно настолько,
  // насколько велико покрытие, — поэтому оно всегда едет рядом с цифрой.
  const share = coveredPoints ? earnedOnCovered / coveredPoints : 0
  const expectedPrimary = share * s.maxPrimary

  return {
    subjectId,
    maxPrimary: s.maxPrimary,
    coveredPoints,
    coverage,
    earnedOnCovered,
    floorTest: toTestScore(subjectId, earnedOnCovered),
    expectedPrimary,
    testScore: toTestScore(subjectId, expectedPrimary),
    attempts: used,
    perTask,
    // Слабые места: сначала те, где теряется больше всего первичных баллов.
    weakest: [...perTask]
      .filter((t) => t.rate < 1)
      .sort((a, b) => b.points * (1 - b.rate) - a.points * (1 - a.rate))
      .slice(0, 5),
    scaleYear: s.scaleYear,
    scaleStale: s.toTest.length < s.maxPrimary + 1,
  }
}

/** Оценки по всем предметам, где есть и официальные данные, и решения. */
export function estimateAll(subjectIds: string[], attempts: Attempt[]): SubjectEstimate[] {
  return subjectIds
    .filter(hasScoring)
    .map((id) => estimateSubject(id, attempts))
    .filter((e): e is SubjectEstimate => e !== null)
}

/** Насколько можно верить цифре. Определяет, как её подписать в интерфейсе. */
export type Trust = 'none' | 'weak' | 'ok'

export function trustOf(e: SubjectEstimate | null): Trust {
  if (!e) return 'none'
  if (e.attempts < ENOUGH_ATTEMPTS || e.coverage < 0.25) return 'weak'
  return 'ok'
}
