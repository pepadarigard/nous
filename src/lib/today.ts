// «Что делать сегодня» — приложение решает само, ученик не планирует.
//
// Смысл. Раньше человеку приходилось соображать: открыть план, посмотреть занятия,
// отдельно вспомнить про тренажёр, отдельно про повторение, отдельно догадаться, что
// просрочку надо перенести. Это работа методиста, а не ученика. Здесь она делается за
// него: один упорядоченный список на сегодня, где всё уже расставлено по приоритету.
//
// Приоритет не выдуман, а следует из того, как работает подготовка:
//  1. Повторение — забывание идёт само по себе, и упущенное сегодня стоит дороже завтра.
//  2. Занятия плана — то, ради чего план и составлен.
//  3. Добивка слабого — если осталось время и уже видно, где проседает.
// Пробник стоит первым, когда он назначен на сегодня: он занимает целый заход и
// после него на обычные занятия сил уже не остаётся.

import type { AppData, Block, Lesson } from '../types'
import { agendaByDate, overdueItems, buildAgenda, todayISO } from './schedule'
import { reviewSummary } from './review'
import { weakSpots } from './bank'
import { SCORING } from '../data/scoring'
import { subjectName } from '../data/subjects'

/** Куда ведёт кнопка «Сделать». */
export type TodayAction =
  | { type: 'lesson'; blockId: string; lessonId: string }
  | { type: 'trainer'; subjectId?: string; taskNo?: number; review?: boolean }
  | { type: 'mock' }
  | { type: 'catchup' }

export interface TodayItem {
  id: string
  kind: 'review' | 'mock' | 'lesson' | 'weak' | 'catchup'
  title: string
  detail: string
  /** Сколько это примерно займёт, минут. */
  minutes: number
  action: TodayAction
  /** Уже сделано сегодня. */
  done: boolean
}

export interface TodayPlan {
  items: TodayItem[]
  minutes: number
  /** Сколько занятий просрочено. */
  overdue: number
  /** Одна фраза: что сегодня главное. Её и показываем крупно. */
  headline: string
}

/** Сколько заданий берёт один заход тренажёра. Должно совпадать с Trainer.tsx. */
export const REVIEW_SESSION = 20

const LESSON_MINUTES: Record<Lesson['kind'], number> = { theory: 25, practice: 30, review: 30 }

/**
 * Готово ли занятие-повторение. Повторять то, чего ещё не проходил, бессмысленно:
 * в свежем плане такие занятия есть с первого дня, и приложение звало «повторить
 * задания № 1–5», когда ученик не открыл ещё ни одной темы.
 */
export function reviewReady(block: Block, lesson: Lesson): boolean {
  if (lesson.kind !== 'review') return true
  const i = block.lessons.findIndex((l) => l.id === lesson.id)
  if (i <= 0) return true
  return block.lessons.slice(0, i).every((l) => l.done)
}

/** Пробник ли это занятие. Он стоит особняком: занимает целый заход. */
function isMock(lesson: Lesson): boolean {
  return /^Пробник/i.test(lesson.title)
}

export function buildToday(data: AppData): TodayPlan {
  const items: TodayItem[] = []
  const today = todayISO()
  const questions = data.questions ?? []
  const attempts = data.attempts ?? []

  // --- просрочка: не пункт работы, а кнопка «разложи за меня» ---
  const overdue = data.plan
    ? overdueItems(buildAgenda(data.plan, data.schedules, data.rules)).length
    : 0

  // --- 1. повторение ---
  // Обещаем ровно столько, сколько влезет в один заход тренажёра. Раньше здесь
  // стояло 40, тренажёр показывал всю очередь (бывает под сотню), а в подход брал
  // 20 — три разных числа про одно и то же дело. Если ученику говорят «иди сверху
  // вниз, порядок правильный», числа обязаны сходиться.
  const backlog = reviewSummary(questions, attempts, today).due
  if (backlog) {
    const take = Math.min(backlog, REVIEW_SESSION)
    items.push({
      id: 'review',
      kind: 'review',
      title: 'Повторить ' + take + ' ' + plural(take, 'задание', 'задания', 'заданий'),
      detail:
        backlog > take
          ? 'Освежить пора ' + backlog + ' — беру самые просроченные ' + take + ', остальные подтянутся ' +
            'в следующие дни. Ответишь верно — вернутся не скоро, ошибёшься — завтра.'
          : 'Эти задания пора освежить, пока не забылись. Ответишь верно — вернутся не скоро, ошибёшься — завтра.',
      minutes: Math.max(5, Math.round(take * 1.5)),
      action: { type: 'trainer', review: true },
      done: false,
    })
  }

  // --- 2. занятия на сегодня ---
  const agenda = data.plan ? agendaByDate(data.plan, data.schedules, data.rules) : {}
  const todayItems = agenda[today] ?? []
  const mocks = todayItems.filter((i) => isMock(i.lesson))
  const lessons = todayItems.filter((i) => !isMock(i.lesson))

  for (const m of mocks) {
    items.push({
      id: m.lesson.id,
      kind: 'mock',
      title: m.lesson.title + ' · ' + subjectName(m.block.subjectId),
      detail: 'Полный заход под таймером. Делай его первым: после него на обычные занятия сил не останется.',
      minutes: SCORING[m.block.subjectId]?.minutes ?? 120,
      action: { type: 'mock' },
      done: m.lesson.done,
    })
  }

  for (const it of lessons) {
    // Повторение, к которому ещё не пройден материал, сегодня не показываем.
    if (it.lesson.kind === 'review' && !reviewReady(it.block, it.lesson)) continue
    items.push({
      id: it.lesson.id,
      kind: 'lesson',
      title: it.lesson.title,
      detail: it.subjectEmoji + ' ' + subjectName(it.block.subjectId),
      minutes: LESSON_MINUTES[it.lesson.kind],
      action: { type: 'lesson', blockId: it.block.id, lessonId: it.lesson.id },
      done: it.lesson.done,
    })
  }

  // --- 3. добивка слабого: только когда данные уже есть ---
  const weak = weakSpots(attempts, 1)[0]
  if (weak?.taskNo && questions.some((q) => q.subjectId === weak.subjectId && q.taskNo === weak.taskNo)) {
    items.push({
      id: 'weak',
      kind: 'weak',
      title: 'Добить задание № ' + weak.taskNo,
      detail:
        subjectName(weak.subjectId) + ': пока верно ' + weak.pct + '% из ' + weak.total +
        '. Это самое слабое место — с него и растёт балл быстрее всего.',
      minutes: 15,
      action: { type: 'trainer', subjectId: weak.subjectId, taskNo: weak.taskNo },
      done: false,
    })
  }

  // --- выходной, но план ещё идёт: предлагаем взять вперёд ---
  // «Ничего не назначено» — плохой ответ учителя. Особенно в первый день после
  // настройки: человек пришёл заниматься, а приложение отправляет его домой.
  if (!items.length && data.plan) {
    const nextDay = Object.keys(agenda)
      .filter((d) => d > today && agenda[d].length)
      .sort()[0]
    const next = nextDay ? agenda[nextDay].find((i) => !i.lesson.done && !isMock(i.lesson)) : undefined
    if (next) {
      items.push({
        id: next.lesson.id,
        kind: 'lesson',
        title: next.lesson.title,
        detail:
          'Сегодня по расписанию выходной. Если есть силы — возьми это занятие вперёд, ' +
          'дальше будет свободнее.',
        minutes: LESSON_MINUTES[next.lesson.kind],
        action: { type: 'lesson', blockId: next.block.id, lessonId: next.lesson.id },
        done: false,
      })
    }
  }

  // --- просрочка последним пунктом: сначала сегодняшнее, потом долги ---
  if (overdue > 0) {
    items.push({
      id: 'catchup',
      kind: 'catchup',
      title: 'Разобрать просроченное: ' + overdue,
      detail: 'Перенесу их на ближайшие свободные дни — по два в день, чтобы не завалить расписание.',
      minutes: 0,
      action: { type: 'catchup' },
      done: false,
    })
  }

  const left = items.filter((i) => !i.done && i.kind !== 'catchup')
  const minutes = left.reduce((n, i) => n + i.minutes, 0)

  return { items, minutes, overdue, headline: headlineFor(items, left, minutes, data) }
}

function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100
  const b = a % 10
  if (a > 10 && a < 20) return many
  if (b > 1 && b < 5) return few
  if (b === 1) return one
  return many
}

/** Одна фраза наверху: что сегодня главное. Её читают вместо того, чтобы думать. */
function headlineFor(all: TodayItem[], left: TodayItem[], minutes: number, data: AppData): string {
  if (!data.plan) return 'Плана пока нет — соберём за минуту.'
  if (!all.length) return 'На сегодня ничего не назначено и брать вперёд нечего — план пройден.'
  if (!left.length) return 'Всё на сегодня сделано. Можно закрывать приложение со спокойной душой.'
  const mock = left.find((i) => i.kind === 'mock')
  if (mock) return 'Сегодня пробник — это главное дело дня, остальное потом.'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  const time = h > 0 ? h + ' ч' + (m ? ' ' + m + ' мин' : '') : m + ' мин'
  return 'Сегодня примерно на ' + time + '. Иди сверху вниз — порядок уже правильный.'
}
