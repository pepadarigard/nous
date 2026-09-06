// План БЕЗ ИИ: собирается из структуры КИМ по номерам заданий.
//
// Смысл: приложение должно быть полезным само по себе — без ключей, без интернета,
// без «сначала сходи к ChatGPT». План получается скелетным, зато честным и полным:
// каждое задание экзамена закрыто теорией, практикой и повторением.

import type { Block, Lesson, StudyPlan } from '../types'
import { EGE_TASKS, hasTaskMap } from '../data/egeTasks'
import { subjectName } from '../data/subjects'
import { uid } from './api'

const TASKS_PER_BLOCK = 5 // сколько номеров заданий закрывает один блок

export interface OfflinePlanOptions {
  subjects: string[]
  examDate?: string
  /** Слабые места (номера заданий) — по ним добавляется лишняя практика. */
  weakTaskNos?: Record<string, number[]>
}

function lesson(title: string, kind: Lesson['kind'], description: string): Lesson {
  return { id: uid('l_'), title, kind, description, done: false }
}

/**
 * Собрать план по структуре экзамена.
 * Для каждой группы заданий: теория по каждому номеру, практика по каждому номеру,
 * в конце блока — повторение. Задания второй части получают вдвое больше практики.
 */
export function buildOfflinePlan(opts: OfflinePlanOptions): StudyPlan {
  const blocks: Block[] = []
  let order = 0

  for (const sid of opts.subjects) {
    if (!hasTaskMap(sid)) continue
    const tasks = EGE_TASKS[sid]
    const weak = new Set(opts.weakTaskNos?.[sid] ?? [])

    for (let i = 0; i < tasks.length; i += TASKS_PER_BLOCK) {
      const chunk = tasks.slice(i, i + TASKS_PER_BLOCK)
      const from = chunk[0].no
      const to = chunk[chunk.length - 1].no
      const lessons: Lesson[] = []

      for (const t of chunk) {
        lessons.push(
          lesson(
            'Теория: ' + t.title,
            'theory',
            'Разбери тему задания № ' + t.no + '. Выпиши правило и типовые ловушки в свой конспект.',
          ),
        )
        lessons.push(
          lesson(
            'Практика: задание № ' + t.no,
            'practice',
            'Реши 10–15 заданий № ' + t.no + '. Ошибки выпиши отдельно — они пойдут в повторение.',
          ),
        )
        // Вторая часть и слабые места требуют отдельного второго подхода.
        if (t.part2 || weak.has(t.no)) {
          lessons.push(
            lesson(
              'Практика: задание № ' + t.no + ' (второй подход)',
              'practice',
              t.part2
                ? 'Оформи полное решение так, как этого требуют критерии проверки.'
                : 'Это твоё слабое место — прорешай ещё раз, медленно и с самопроверкой.',
            ),
          )
        }
      }

      lessons.push(
        lesson(
          'Повторение: задания № ' + from + '–' + to,
          'review',
          'Прорешай подряд задания № ' + from + '–' + to + ' и разбери накопившиеся ошибки.',
        ),
      )

      blocks.push({
        id: uid('b_'),
        subjectId: sid,
        title: subjectName(sid) + ': задания № ' + from + '–' + to,
        goal: 'Закрыть задания № ' + from + '–' + to + ' без ошибок',
        order: order++,
        lessons,
      })
    }
  }

  const names = opts.subjects.filter(hasTaskMap).map(subjectName).join(', ')
  return {
    createdAt: new Date().toISOString(),
    examDate: opts.examDate,
    overview:
      'План собран по структуре ЕГЭ: ' +
      (names || 'предметы не выбраны') +
      '. Каждое задание экзамена закрыто теорией, практикой и повторением. ' +
      'Порядок и наполнение можно менять руками, а ИИ — дополнить или переписать план, когда он под рукой.',
    blocks,
  }
}

/** Сколько занятий получится — чтобы показать до нажатия кнопки. */
export function offlinePlanSize(subjects: string[]): number {
  return buildOfflinePlan({ subjects }).blocks.reduce((n, b) => n + b.lessons.length, 0)
}
