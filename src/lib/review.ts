// Интервальное повторение: ошибка возвращается завтра, потом через три дня, неделю и дальше.
//
// Зачем. «Повторение: задания № 1–5» в плане ставится один раз и намертво: задание,
// в котором ты ошибся сегодня, само по себе больше никогда не вернётся. До экзамена
// месяцы — на такой дистанции выигрывает не объём прорешанного, а то, что не забылось.
//
// Почему без нового хранилища. Уровень карточки выводится из истории попыток: сколько
// раз подряд она решена верно в конце. Это значит, что схема заработала СРАЗУ на уже
// накопленных данных, ничего не надо мигрировать, и рассинхрону между историей
// и «состоянием повторения» просто неоткуда взяться.

import type { Attempt, Question } from '../types'
import { addDaysISO, todayISO } from './schedule'

/**
 * Через сколько дней показать снова, по уровню карточки. Уровень — длина цепочки
 * верных ответов подряд: ошибся — цепочка рвётся, и задание возвращается завтра.
 */
export const INTERVALS = [1, 3, 7, 16, 35] as const

export interface ReviewCard {
  question: Question
  /** Длина текущей цепочки верных ответов (обрезана до последнего интервала). */
  level: number
  /** Сколько раз ошибался за всё время — чем больше, тем задание коварнее. */
  lapses: number
  /** Дата последней попытки с вердиктом (YYYY-MM-DD). */
  lastISO: string
  /** Когда пора повторить. */
  dueISO: string
  /** На сколько дней просрочено (0 — ровно сегодня). */
  overdueDays: number
}

/** Дата из ISO-времени попытки. */
function dayOf(at: string): string {
  return at.slice(0, 10)
}

/** Разница в днях между двумя датами YYYY-MM-DD. */
function daysBetween(fromISO: string, toISO: string): number {
  return Math.round((Date.parse(toISO) - Date.parse(fromISO)) / 86400000)
}

/**
 * Карточки повторения по всем заданиям, которые хоть раз решались с вердиктом.
 * Задания без истории сюда не попадают: они новые, их место в обычной очереди.
 */
export function reviewCards(questions: Question[], attempts: Attempt[], today = todayISO()): ReviewCard[] {
  // Самопроверка без вердикта (correct === null) сигнала не несёт — пропускаем.
  const byQuestion = new Map<string, Attempt[]>()
  for (const a of attempts) {
    if (a.correct === null) continue
    const list = byQuestion.get(a.questionId)
    if (list) list.push(a)
    else byQuestion.set(a.questionId, [a])
  }

  const out: ReviewCard[] = []
  for (const q of questions) {
    const list = byQuestion.get(q.id)
    if (!list?.length) continue
    // История приходит по порядку добавления, но на всякий случай сортируем по времени.
    const sorted = [...list].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))

    // Уровень считается по ДНЯМ, а не по попыткам. Пять прогонов подряд за один вечер —
    // это зубрёжка: так можно было бы накрутить максимальный интервал за один заход,
    // хотя назавтра задание всё равно забудется. И день засчитывается, только если в
    // этот день не было ни одной ошибки: ошибся утром, вспомнил к вечеру — знанием это
    // ещё не стало, надо вернуться завтра.
    const byDay = new Map<string, boolean>()
    for (const a of sorted) {
      const d = dayOf(a.at)
      byDay.set(d, (byDay.get(d) ?? true) && a.correct === true)
    }
    const days = [...byDay.keys()]
    let streak = 0
    for (let i = days.length - 1; i >= 0; i--) {
      if (!byDay.get(days[i])) break
      streak++
    }
    const level = Math.min(streak, INTERVALS.length - 1)
    const lastISO = days[days.length - 1]
    const dueISO = addDaysISO(lastISO, INTERVALS[level])

    out.push({
      question: q,
      level,
      lapses: sorted.filter((a) => a.correct === false).length,
      lastISO,
      dueISO,
      overdueDays: Math.max(0, daysBetween(dueISO, today)),
    })
  }
  return out
}

/**
 * Что пора повторить сегодня. Сначала самое просроченное, потом самое слабое —
 * забытое раньше важнее, чем почти выученное.
 */
export function dueForReview(
  questions: Question[],
  attempts: Attempt[],
  today = todayISO(),
  limit = 30,
): ReviewCard[] {
  return reviewCards(questions, attempts, today)
    .filter((c) => c.dueISO <= today)
    .sort((a, b) => b.overdueDays - a.overdueDays || a.level - b.level || b.lapses - a.lapses)
    .slice(0, limit)
}

export interface ReviewSummary {
  /** Сколько заданий пора повторить сегодня. */
  due: number
  /** Сколько всего заданий в обороте повторения. */
  tracked: number
  /** Ближайшая дата, когда снова будет что повторять (если сегодня пусто). */
  nextISO: string | null
}

export function reviewSummary(questions: Question[], attempts: Attempt[], today = todayISO()): ReviewSummary {
  const cards = reviewCards(questions, attempts, today)
  const due = cards.filter((c) => c.dueISO <= today)
  const later = cards.filter((c) => c.dueISO > today).map((c) => c.dueISO).sort()
  return { due: due.length, tracked: cards.length, nextISO: due.length ? null : (later[0] ?? null) }
}
