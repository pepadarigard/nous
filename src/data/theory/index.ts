// Точка входа для теории. Предметы добавляются сюда по мере написания —
// приложение само покажет теорию там, где она уже есть, и промолчит, где ещё нет.

import type { SubjectTheory, TaskTheory } from './types'
import { RUSSIAN_THEORY } from './russian'
import { MATH_PROF_THEORY } from './mathProf'

export type { TaskTheory, SubjectTheory }

export const THEORY: Record<string, SubjectTheory> = {
  russian: RUSSIAN_THEORY,
  math_prof: MATH_PROF_THEORY,
}

/** Теория по конкретному номеру задания. undefined — значит, её ещё не написали. */
export function taskTheory(subjectId: string, taskNo?: number): TaskTheory | undefined {
  if (taskNo === undefined) return undefined
  return THEORY[subjectId]?.[taskNo]
}

/** По скольким номерам предмета теория уже есть — для честной подписи в интерфейсе. */
export function theoryCount(subjectId: string): number {
  return Object.keys(THEORY[subjectId] ?? {}).length
}
