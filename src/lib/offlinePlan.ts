// План БЕЗ ИИ: собирается из структуры КИМ по номерам заданий.
//
// Смысл: приложение должно быть полезным само по себе — без ключей, без интернета,
// без «сначала сходи к ChatGPT». План получается скелетным, зато честным и полным:
// каждое задание экзамена закрыто теорией, практикой и повторением.
//
// ТРИ ЭТАПА. Раньше план был одной длинной лентой «теория — практика» до самого
// экзамена, и это неправильно устроенная подготовка: нельзя весь год изучать
// новое и выйти на экзамен, ни разу не пройдя работу целиком под таймером.
// Поэтому план делится на три этапа, и у каждого своя задача:
//
//  1. ПОДГОТОВКА — разобраться. Теория и первая практика по каждому номеру,
//     блоками по разделам курса: раздел изучается целиком, а не вразбивку.
//  2. НАРЕШИВАНИЕ — довести до автоматизма. Много заданий подряд по разделу,
//     слабым местам — отдельный подход.
//  3. ПРОГОН — привыкнуть к работе целиком. Пробники под таймером: держишься
//     ли четыре часа, успеваешь ли, не сыпешься ли к концу.
//
// Этап — это свойство блока, а не отдельная сущность: раскладка по календарю,
// отметки и статистика работают как работали.

import type { Block, Lesson, PlanStage, StudyPlan } from '../types'
import { EGE_TASKS, hasTaskMap, sectionsOf } from '../data/egeTasks'
import { subjectName } from '../data/subjects'
import { uid } from './api'

/** Сколько пробников ставить на этап прогона по каждому предмету. */
const MOCK_RUNS = 3

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
 *
 * Блоки идут этапами: сначала вся подготовка по всем предметам, потом всё
 * нарешивание, потом прогоны. Порядок именно такой, а не «предмет за
 * предметом»: раскладка по календарю чередует предметы сама, а вот выйти на
 * пробник, не закончив разбираться, — плохая идея по любому предмету.
 */
export function buildOfflinePlan(opts: OfflinePlanOptions): StudyPlan {
  const subjects = opts.subjects.filter(hasTaskMap)
  const blocks: Block[] = []
  let order = 0

  const add = (b: Omit<Block, 'id' | 'order'>) => {
    blocks.push({ ...b, id: uid('b_'), order: order++ })
  }

  // ---------- 1. Подготовка: раздел курса целиком ----------
  for (const sid of subjects) {
    const tasks = EGE_TASKS[sid]
    const weak = new Set(opts.weakTaskNos?.[sid] ?? [])

    for (const sec of sectionsOf(sid)) {
      const lessons: Lesson[] = []
      for (const no of sec.tasks) {
        const t = tasks.find((x) => x.no === no)
        if (!t) continue
        lessons.push(
          lesson(
            'Теория: ' + t.title,
            'theory',
            'Разбери тему задания № ' + t.no + '. Правило и типовые ловушки есть в «Справочнике» — выпиши их себе.',
          ),
        )
        lessons.push(
          lesson(
            'Практика: задание № ' + t.no,
            'practice',
            'Реши 10–15 заданий № ' + t.no + '. Ошибки не пропускай: нажми «Почему я ошибся» — из повторов видно, что тема не понята.',
          ),
        )
        if (t.part2 || weak.has(t.no)) {
          lessons.push(
            lesson(
              'Практика: задание № ' + t.no + ' (второй подход)',
              'practice',
              t.part2
                ? 'Оформи полное решение так, как этого требуют критерии проверки. Проверить его можно во вкладке «Развёрнутый ответ».'
                : 'Это твоё слабое место — прорешай ещё раз, медленно и с самопроверкой.',
            ),
          )
        }
      }
      if (!lessons.length) continue
      lessons.push(
        lesson(
          'Повторение: ' + sec.section,
          'review',
          'Прорешай задания раздела вперемешку и разбери накопившиеся ошибки.',
        ),
      )
      add({
        subjectId: sid,
        stage: 'prep',
        title: subjectName(sid) + ': ' + sec.section,
        goal: 'Разобраться в разделе «' + sec.section + '»',
        lessons,
      })
    }
  }

  // ---------- 2. Нарешивание: скорость и автоматизм ----------
  for (const sid of subjects) {
    const lessons: Lesson[] = []
    for (const sec of sectionsOf(sid)) {
      const nos = sec.tasks
      lessons.push(
        lesson(
          'Нарешивание: ' + sec.section,
          'practice',
          'Задания № ' + nos[0] + '–' + nos[nos.length - 1] + ' подряд, без подглядывания в теорию. ' +
            'Цель не «понять», а «делать быстро и не думая».',
        ),
      )
    }
    lessons.push(
      lesson(
        'Слабые места: добить',
        'practice',
        'Открой «Тренажёр» → «Статистика» → «Что подтянуть первым» и пройди первые три номера списка. ' +
          'Там лежат баллы, которые дешевле всего забрать.',
      ),
    )
    if (!lessons.length) continue
    add({
      subjectId: sid,
      stage: 'drill',
      title: subjectName(sid) + ': нарешивание',
      goal: 'Довести решение до автоматизма и закрыть слабые места',
      lessons,
    })
  }

  // ---------- 3. Прогон: работа целиком под таймером ----------
  for (const sid of subjects) {
    const lessons: Lesson[] = []
    for (let i = 1; i <= MOCK_RUNS; i++) {
      lessons.push(
        lesson(
          'Пробник ' + i + ': вся работа под таймером',
          'review',
          'Целый вариант в «Тренажёре» → «Пробник». Время настоящее, перерывов нет, вторую часть пиши на листе. ' +
            'После — разбери каждый потерянный балл.',
        ),
      )
    }
    lessons.push(
      lesson(
        'Разбор пробников',
        'review',
        'Сравни три замера: где потери повторяются, там и надо чинить. Разовый промах разбирать не нужно.',
      ),
    )
    add({
      subjectId: sid,
      stage: 'run',
      title: subjectName(sid) + ': полный прогон',
      goal: 'Пройти работу целиком и выдержать по времени',
      lessons,
    })
  }

  const names = subjects.map(subjectName).join(', ')
  return {
    createdAt: new Date().toISOString(),
    examDate: opts.examDate,
    overview:
      'План собран по структуре ЕГЭ: ' +
      (names || 'предметы не выбраны') +
      '. Три этапа: сначала разобраться в каждом разделе, потом довести решение до автоматизма, ' +
      'в конце — пробники под настоящим таймером. Порядок и наполнение можно менять руками, ' +
      'а ИИ — дополнить или переписать план, когда он под рукой.',
    blocks,
  }
}

/** Название этапа для интерфейса. */
export const STAGE_TITLE: Record<PlanStage, string> = {
  prep: 'Подготовка',
  drill: 'Нарешивание',
  run: 'Полный прогон',
}

/** Что делают на этапе — одной строкой. */
export const STAGE_HINT: Record<PlanStage, string> = {
  prep: 'Разбираемся в каждом разделе: теория, первая практика, повторение.',
  drill: 'Доводим до автоматизма: много заданий подряд и слабые места.',
  run: 'Работа целиком под таймером — привыкнуть к настоящему экзамену.',
}

/** Сколько занятий получится — чтобы показать до нажатия кнопки. */
export function offlinePlanSize(subjects: string[]): number {
  return buildOfflinePlan({ subjects }).blocks.reduce((n, b) => n + b.lessons.length, 0)
}
