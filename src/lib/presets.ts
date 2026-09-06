// Готовые планы подготовки — стратегии, а не один механический список.
//
// Зачем. Раньше план был один: по каждому номеру теория, практика и повторение.
// Он полный, но одинаковый для всех — а situations разные. Тому, кто идёт с нуля,
// нужен фундамент; тому, кому важно просто перейти порог, часть 2 не нужна вовсе
// и только отнимает время; тому, кто метит на высокий балл, наоборот, часть 1 надо
// быстро подтвердить и вложиться во вторую. За месяц до экзамена новая теория уже
// вредна — нужны повторение и пробники.
//
// Планы опираются на ОФИЦИАЛЬНЫЕ веса заданий из scoring.ts, поэтому «выгодные»
// номера считаются, а не угадываются: задание на 4 балла стоит четырёх на 1 балл.

import type { Block, Lesson, StudyPlan, SubjectGoal } from '../types'
import { EGE_TASKS, hasTaskMap, type EgeTask } from '../data/egeTasks'
import { SCORING, primaryForTest, taskPoints } from '../data/scoring'
import { subjectName } from '../data/subjects'
import { uid } from './api'

export interface PresetOptions {
  subjects: string[]
  examDate?: string
  /** Сколько недель осталось — от этого зависит, влезет ли план. */
  weeksLeft?: number
  /** Слабые номера из тренажёра: по ним добавляется подход. */
  weakTaskNos?: Record<string, number[]>
}

export interface PlanPreset {
  id: string
  name: string
  /** Для кого этот план — одной строкой. */
  who: string
  /** Что внутри и чего сознательно нет. */
  detail: string
  /** Сколько недель нужно, чтобы план имел смысл. */
  minWeeks?: number
  /** Дольше этого срока план не имеет смысла — предложим другой. */
  maxWeeks?: number
}

export const PRESETS: PlanPreset[] = [
  {
    id: 'foundation',
    name: 'С нуля, по порядку',
    who: 'Начинаешь всерьёз, времени полгода и больше',
    detail:
      'Каждый номер экзамена закрывается теорией и двумя подходами практики, после каждой пятёрки — повторение. Вторая часть идёт в конце, когда база уже стоит. Пробник раз в полтора месяца.',
    minWeeks: 20,
  },
  {
    id: 'threshold',
    name: 'Дойти до порога',
    who: 'Главное — гарантированно сдать и получить аттестат',
    detail:
      'Только первая часть и только надёжные номера: их отрабатываем до автоматизма по три подхода. Второй части здесь нет намеренно — на пороговый балл она не нужна, а времени съедает больше всего.',
  },
  {
    id: 'high',
    name: 'На высокий балл',
    who: 'Первая часть уже даётся, нужен максимум',
    detail:
      'Первую часть быстро подтверждаем одним подходом без теории, а всё освободившееся время уходит во вторую: теория и четыре подхода на каждый номер. Пробники часто.',
    minWeeks: 12,
  },
  {
    id: 'sprint',
    name: 'Спринт',
    who: 'Времени мало, надо выжать максимум из оставшегося',
    detail:
      'Номера идут по отдаче: сначала те, где за то же усилие больше первичных баллов. План обрезается под оставшиеся недели, чтобы не бросить его на середине.',
    maxWeeks: 20,
  },
  {
    id: 'finish',
    name: 'Финишная прямая',
    who: 'До экзамена меньше полутора месяцев',
    detail:
      'Новой теории нет — она уже не усвоится. Только повторение блоками и пробники каждую неделю: держим форму и вычищаем остатки ошибок.',
    maxWeeks: 8,
  },
]

/**
 * Какой план предложить. Решает не только срок, но и то, что ученик о себе сказал:
 * с текущими 30 баллами и целью 45 нужен другой план, чем с текущими 75 и целью 95,
 * даже если времени поровну.
 *
 * Порядок важен: сроки перекрывают всё остальное. Когда до экзамена месяц, никакой
 * «фундамент» уже не поможет, какие бы цели ни стояли.
 */
export function suggestPreset(weeksLeft?: number, goals: SubjectGoal[] = []): string {
  if (weeksLeft !== undefined && weeksLeft <= 8) return 'finish'
  if (weeksLeft !== undefined && weeksLeft <= 20) return 'sprint'
  if (!goals.length) return 'foundation'

  const avg = (f: (g: SubjectGoal) => number) => goals.reduce((s, g) => s + f(g), 0) / goals.length
  const current = avg((g) => g.current)
  const target = avg((g) => g.target)
  // Порог берём из официальных минимумов по выбранным предметам.
  const minTest = avg((g) => SCORING[g.subjectId]?.minTest ?? 40)

  // Цель — едва перейти порог: вторая часть не нужна, она только съест время.
  if (target <= minTest + 12) return 'threshold'
  // База уже стоит — значит пора вкладываться во вторую часть.
  if (current >= 70) return 'high'
  return 'foundation'
}

// ---------- сборка ----------

function lesson(title: string, kind: Lesson['kind'], description: string): Lesson {
  return { id: uid('l_'), title, kind, description, done: false }
}

function theoryLesson(t: EgeTask): Lesson {
  return lesson(
    'Теория: ' + t.title,
    'theory',
    'Разбери тему задания № ' + t.no + '. Выпиши правило и типовые ловушки в свой конспект.',
  )
}

function practiceLesson(t: EgeTask, pass: number, total: number): Lesson {
  const tail =
    total > 1 ? ' (подход ' + pass + ' из ' + total + ')' : ''
  return lesson(
    'Практика: задание № ' + t.no + tail,
    'practice',
    pass === 1
      ? 'Реши 10–15 заданий № ' + t.no + '. Ошибки выпиши отдельно — они пойдут в повторение.'
      : 'Ещё подход к заданию № ' + t.no + ': решай медленнее и проверяй себя по каждому шагу.',
  )
}

function reviewLesson(from: number, to: number): Lesson {
  return lesson(
    'Повторение: задания № ' + from + '–' + to,
    'review',
    'Прорешай подряд задания № ' + from + '–' + to + ' и разбери накопившиеся ошибки.',
  )
}

function mockLesson(subjectId: string, n: number): Lesson {
  return lesson(
    'Пробник № ' + n,
    'review',
    'Полный заход под таймером во вкладке «Тренажёр → Пробник» по предмету «' +
      subjectName(subjectId) +
      '». Считай первичный балл и смотри, где потерял.',
  )
}

/** Задания предмета, разложенные на части. */
function partsOf(subjectId: string): { part1: EgeTask[]; part2: EgeTask[] } {
  const tasks = EGE_TASKS[subjectId] ?? []
  return {
    part1: tasks.filter((t) => !t.part2),
    part2: tasks.filter((t) => t.part2),
  }
}

/** Отдача номера: сколько первичных баллов он приносит. */
function weight(subjectId: string, t: EgeTask): number {
  return taskPoints(subjectId, t.no) || 1
}

function block(subjectId: string, title: string, goal: string, order: number, lessons: Lesson[]): Block {
  return { id: uid('b_'), subjectId, title, goal, order, lessons }
}

/** Нарезать список номеров на блоки по size и собрать занятия по правилам. */
function buildBlocks(
  subjectId: string,
  tasks: EgeTask[],
  order: { n: number },
  opts: {
    size: number
    theory: boolean
    passes: (t: EgeTask) => number
    review: boolean
    label?: string
  },
): Block[] {
  const out: Block[] = []
  for (let i = 0; i < tasks.length; i += opts.size) {
    const chunk = tasks.slice(i, i + opts.size)
    const lessons: Lesson[] = []
    for (const t of chunk) {
      if (opts.theory) lessons.push(theoryLesson(t))
      const n = opts.passes(t)
      for (let p = 1; p <= n; p++) lessons.push(practiceLesson(t, p, n))
    }
    const nos = chunk.map((t) => t.no)
    const from = Math.min(...nos)
    const to = Math.max(...nos)
    if (opts.review) lessons.push(reviewLesson(from, to))
    const what = opts.label ? opts.label + ': ' : ''
    out.push(
      block(
        subjectId,
        subjectName(subjectId) + ' — ' + what + 'задания № ' + nos.join(', '),
        'Закрыть задания № ' + from + '–' + to + ' без ошибок',
        order.n++,
        lessons,
      ),
    )
  }
  return out
}

/** Сколько занятий вообще влезет в оставшееся время (по 3 занятия в день, 5 дней в неделю). */
function capacity(weeksLeft?: number): number {
  if (!weeksLeft || weeksLeft <= 0) return Infinity
  return weeksLeft * 5 * 3
}

function overview(preset: PlanPreset, subjects: string[], total: number): string {
  const names = subjects.filter(hasTaskMap).map(subjectName).join(', ')
  return (
    '«' + preset.name + '» — ' + preset.who.toLowerCase() + '. ' +
    'Предметы: ' + (names || 'не выбраны') + '. Всего занятий: ' + total + '. ' +
    preset.detail
  )
}

/**
 * Собрать план по выбранной стратегии. Возвращает готовый StudyPlan —
 * ИИ и интернет не участвуют.
 */
export function buildPresetPlan(presetId: string, opts: PresetOptions): StudyPlan {
  const preset = PRESETS.find((p) => p.id === presetId) ?? PRESETS[0]
  const subjects = opts.subjects.filter(hasTaskMap)
  const order = { n: 0 }
  const blocks: Block[] = []

  for (const sid of subjects) {
    const { part1, part2 } = partsOf(sid)
    const weak = new Set(opts.weakTaskNos?.[sid] ?? [])
    const isWeak = (t: EgeTask) => weak.has(t.no)

    if (preset.id === 'threshold') {
      // Берём НЕ всю первую часть, а ровно столько номеров, сколько нужно на порог,
      // плюс запас в треть — на случай ошибок на самом экзамене. Иначе план «просто
      // сдать» получался длиннее полного, что бессмысленно.
      const s = SCORING[sid]
      const need = s ? Math.ceil(primaryForTest(sid, s.minTest) * 1.35) : Infinity
      const take: EgeTask[] = []
      let acc = 0
      for (const t of part1) {
        if (acc >= need) break
        take.push(t)
        acc += weight(sid, t)
      }
      blocks.push(
        ...buildBlocks(sid, take, order, {
          size: 4,
          theory: true,
          passes: (t) => (isWeak(t) ? 4 : 3),
          review: true,
          label: 'база',
        }),
      )
      blocks.push(block(sid, subjectName(sid) + ' — проверка себя', 'Убедиться, что порог берётся стабильно', order.n++, [
        mockLesson(sid, 1),
        reviewLesson(take[0]?.no ?? 1, take[take.length - 1]?.no ?? 1),
        mockLesson(sid, 2),
      ]))
      continue
    }

    if (preset.id === 'high') {
      // Часть 1 — только подтвердить, без теории. Основное время во вторую часть.
      blocks.push(
        ...buildBlocks(sid, part1, order, {
          size: 6,
          theory: false,
          passes: (t) => (isWeak(t) ? 2 : 1),
          review: true,
          label: 'подтверждение',
        }),
      )
      blocks.push(
        ...buildBlocks(sid, part2, order, {
          size: 2,
          theory: true,
          passes: () => 4,
          review: true,
          label: 'вторая часть',
        }),
      )
      blocks.push(block(sid, subjectName(sid) + ' — пробники', 'Держать форму на полном варианте', order.n++, [
        mockLesson(sid, 1),
        mockLesson(sid, 2),
        mockLesson(sid, 3),
      ]))
      continue
    }

    if (preset.id === 'sprint') {
      // По отдаче: где за то же усилие больше баллов. Внутри равного веса — по порядку.
      const byYield = [...part1, ...part2].sort(
        (a, b) => weight(sid, b) - weight(sid, a) || a.no - b.no,
      )
      blocks.push(
        ...buildBlocks(sid, byYield, order, {
          size: 4,
          theory: true,
          passes: (t) => (isWeak(t) ? 2 : 1),
          review: true,
          label: 'по отдаче',
        }),
      )
      // Когда времени мало, пробник — самый выгодный час: он сразу показывает,
      // где сыпешься, и не даёт тратить оставшееся на то, что уже решается.
      blocks.push(block(sid, subjectName(sid) + ' — пробники', 'Быстро находить, что ещё проседает', order.n++, [
        mockLesson(sid, 1),
        mockLesson(sid, 2),
      ]))
      continue
    }

    if (preset.id === 'finish') {
      // Новой теории нет: только повторение блоками и пробники.
      const all = [...part1, ...part2]
      const lessons: Lesson[] = []
      let mock = 1
      for (let i = 0; i < all.length; i += 5) {
        const chunk = all.slice(i, i + 5)
        lessons.push(reviewLesson(chunk[0].no, chunk[chunk.length - 1].no))
        if (i > 0 && i % 10 === 0) lessons.push(mockLesson(sid, mock++))
      }
      lessons.push(mockLesson(sid, mock))
      blocks.push(block(sid, subjectName(sid) + ' — повторение перед экзаменом', 'Ничего не забыть и держать темп', order.n++, lessons))
      continue
    }

    // foundation — по умолчанию: фундамент по порядку, вторая часть в конце.
    blocks.push(
      ...buildBlocks(sid, part1, order, {
        size: 5,
        theory: true,
        passes: (t) => (isWeak(t) ? 3 : 2),
        review: true,
      }),
    )
    if (part2.length) {
      blocks.push(
        ...buildBlocks(sid, part2, order, {
          size: 3,
          theory: true,
          passes: () => 3,
          review: true,
          label: 'вторая часть',
        }),
      )
    }
    blocks.push(block(sid, subjectName(sid) + ' — пробники', 'Проверить себя на полном варианте', order.n++, [
      mockLesson(sid, 1),
      mockLesson(sid, 2),
    ]))
  }

  // Не даём плану заведомо не поместиться: лучше честно короче, чем брошенным на середине.
  const cap = capacity(opts.weeksLeft)
  let total = blocks.reduce((n, b) => n + b.lessons.length, 0)
  if (total > cap) {
    let left = cap
    const kept: Block[] = []
    for (const b of blocks) {
      if (left <= 0) break
      if (b.lessons.length <= left) {
        kept.push(b)
        left -= b.lessons.length
      } else {
        kept.push({ ...b, lessons: b.lessons.slice(0, left) })
        left = 0
      }
    }
    blocks.length = 0
    blocks.push(...kept)
    total = blocks.reduce((n, b) => n + b.lessons.length, 0)
  }

  return {
    createdAt: new Date().toISOString(),
    examDate: opts.examDate,
    overview: overview(preset, subjects, total),
    blocks,
  }
}

/** Сколько занятий даст стратегия — чтобы показать до нажатия кнопки. */
export function presetSize(presetId: string, opts: PresetOptions): number {
  return buildPresetPlan(presetId, opts).blocks.reduce((n, b) => n + b.lessons.length, 0)
}

/** Сколько первичных баллов покрывает план — честная мера охвата. */
export function presetCoverage(presetId: string, opts: PresetOptions): { covered: number; max: number } {
  const plan = buildPresetPlan(presetId, opts)
  let covered = 0
  let max = 0
  for (const sid of opts.subjects.filter(hasTaskMap)) {
    const s = SCORING[sid]
    if (!s) continue
    max += s.maxPrimary
    // Заголовок бывает и диапазоном («задания № 1–5»): считать только концы —
    // значит занижать покрытие втрое. Разворачиваем диапазон целиком.
    const nos = new Set<number>()
    for (const b of plan.blocks.filter((x) => x.subjectId === sid)) {
      for (const l of b.lessons) {
        const range = l.title.match(/№\s*(\d{1,2})\s*[–—-]\s*(\d{1,2})/)
        if (range) {
          for (let k = Number(range[1]); k <= Number(range[2]); k++) nos.add(k)
          continue
        }
        for (const m of l.title.matchAll(/(\d{1,2})/g)) {
          if (l.title.includes('№')) nos.add(Number(m[1]))
        }
      }
    }
    for (const no of nos) covered += taskPoints(sid, no)
  }
  return { covered, max }
}
