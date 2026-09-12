// Справочник Nous как источник для ИИ.
//
// Зачем. Модель на 235 миллиардов параметров помнит мир целиком, но помнит его
// приблизительно, и русская орфография — худший случай: проверка показала, что
// на задании «где проверяемая гласная корня» ошибаются ВСЕ доступные модели,
// включая самые большие. При этом правильный ответ лежит у нас же в
// data/spelling.ts, а правило — в data/theory. Отдавать такое на память модели
// значит сознательно выбирать худший из двух источников.
//
// Поэтому перед ответом мы НАХОДИМ подходящие куски своего справочника и
// кладём их в запрос. Модель после этого не вспоминает, а читает.
//
// Почему поиск здесь простой, а не «настоящий». Никаких эмбеддингов: они
// требуют либо сети (а приложение обязано работать офлайн), либо тяжёлой
// модели в сборке. Справочник маленький — сотни абзацев, — и обычного
// совпадения слов с нормализацией окончаний хватает с запасом. Проверяется это
// не на глаз: у поиска есть свой прогон по типичным вопросам.

import { THEORY } from '../data/theory'
import { REFERENCE } from '../data/reference'
import { EGE_TASKS } from '../data/egeTasks'
import { ROOT_WORDS, PREFIX_WORDS, SUFFIX_WORDS, ENDING_WORDS } from '../data/spelling'
import { PARONYMS, PLEONASM, FORMS } from '../data/norms'
import { egeSpec } from '../data/ege2027'
import { subjectName } from '../data/subjects'

/** Кусок справочника, который можно показать модели. */
export interface Passage {
  id: string
  /** Откуда это — уходит в ответ, чтобы ученик знал источник. */
  title: string
  subjectId?: string
  taskNo?: number
  text: string
}

// ---------- нормализация слов ----------

/**
 * Слово к сравнимому виду.
 *
 * Русский язык склоняет всё подряд: «приставка», «приставки», «приставке» —
 * одно и то же слово, и поиск обязан их склеивать. Полноценной морфологии тут
 * не нужно: срезаем типовые окончания и оставляем основу. Грубо, но для
 * справочника на сотню страниц точнее, чем нужно.
 */
function stem(w: string): string {
  let s = w.toLowerCase().replace(/ё/g, 'е')
  if (s.length <= 4) return s
  // Порядок важен: сначала длинные окончания, иначе «ованиями» срежется как «и».
  for (const end of [
    'ованиями', 'ованиям', 'ования', 'ование', 'ованием',
    'иями', 'ями', 'ами', 'ыми', 'ими', 'ого', 'его', 'ому', 'ему', 'ыx',
    'ения', 'ению', 'ением', 'ение', 'ений',
    'ость', 'ости', 'остью',
    'ать', 'ять', 'еть', 'ить', 'ыть', 'уть',
    'ах', 'ях', 'ам', 'ям', 'ой', 'ей', 'ий', 'ый', 'ая', 'яя', 'ое', 'ее',
    'ы', 'и', 'а', 'я', 'у', 'ю', 'о', 'е', 'й', 'ь',
  ]) {
    if (s.length - end.length >= 4 && s.endsWith(end)) return s.slice(0, -end.length)
  }
  return s
}

/** Слова запроса, годные для поиска: без предлогов и прочего шума. */
const STOP = new Set([
  'как', 'что', 'это', 'или', 'для', 'при', 'над', 'под', 'про', 'без', 'the', 'and',
  'мне', 'меня', 'тебе', 'если', 'когда', 'почему', 'зачем', 'надо', 'нужно', 'можно',
  'быть', 'есть', 'буду', 'один', 'два', 'три', 'таки', 'так', 'вот', 'его', 'всё', 'все',
  'объясни', 'расскажи', 'помоги', 'скажи', 'подскажи', 'пример', 'примеры',
])
function terms(q: string): string[] {
  const out: string[] = []
  for (const raw of q.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (STOP.has(raw)) continue
    // Числа оставляем любой длины: «задание 10» без «10» теряет весь смысл.
    if (/^\d+$/.test(raw)) {
      if (!out.includes(raw)) out.push(raw)
      continue
    }
    if (raw.length < 3) continue
    const s = stem(raw)
    if (s.length >= 3 && !out.includes(s)) out.push(s)
  }
  return out
}

/**
 * Номер задания, названный в вопросе прямо.
 *
 * «Как решать задание 10 по русскому» — это запрос ровно про десятый номер, и
 * гадать по словам тут нечего. Без такого разбора поиск отдавал первый попавшийся
 * номер: слово «задание» есть в заголовке у каждого.
 */
function askedTaskNo(q: string): number | undefined {
  const m = q.match(/(?:задани[а-яё]*|номер|№)\s*№?\s*(\d{1,2})|(\d{1,2})\s*(?:-?[гое]{0,2}\s*)?задани/i)
  const n = Number(m?.[1] ?? m?.[2])
  return n >= 1 && n <= 30 ? n : undefined
}

// ---------- сборка справочника в куски ----------

let cache: Passage[] | null = null

/** Весь встроенный справочник одним списком. Собирается один раз. */
export function allPassages(): Passage[] {
  if (cache) return cache
  const out: Passage[] = []

  // 1. Теория по каждому номеру — самое ценное: это прямо «как решать».
  for (const [sid, byNo] of Object.entries(THEORY)) {
    for (const [no, t] of Object.entries(byNo)) {
      const n = Number(no)
      const title = EGE_TASKS[sid]?.find((x) => x.no === n)?.title ?? ''
      const parts = [t.rule]
      if (t.learn) parts.push('Выучить: ' + t.learn)
      if (t.steps?.length) parts.push('Порядок действий: ' + t.steps.join(' '))
      if (t.traps?.length) parts.push('Где теряют балл: ' + t.traps.join(' '))
      out.push({
        id: 'theory:' + sid + ':' + no,
        title: `${subjectName(sid)}, задание №${no} — ${title}`,
        subjectId: sid,
        taskNo: n,
        text: parts.join('\n'),
      })
    }
  }

  // 2. Справочники: каждый раздел отдельным куском, чтобы в запрос уезжало
  //    нужное, а не весь список ударений целиком.
  for (const doc of REFERENCE) {
    for (const sec of doc.sections) {
      out.push({
        id: 'ref:' + doc.id + ':' + sec.title,
        title: `${doc.title} — ${sec.title}`,
        subjectId: doc.subjectId,
        text: sec.lines.join('\n'),
      })
    }
  }

  /**
   * 3. Словарные данные по русскому — пословно.
   *
   * Именно тут модель ошибается чаще всего, и именно тут у нас точные данные.
   * Проверка это подтвердила: на вопросе «где проверяемая гласная корня» все
   * модели, включая самую большую, отвечали неверно, хотя ответ («укротить»,
   * проверочное «крОткий») лежит в data/spelling.ts. Правило без списка слов
   * не помогает: моделям не хватает не правила, а конкретного слова.
   *
   * Куски делаем по десять слов: одно слово на кусок разорвало бы поиск, а
   * весь список целиком вытеснил бы из запроса всё остальное.
   */
  const chunk = <T>(arr: readonly T[], n: number): T[][] => {
    const out: T[][] = []
    for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n) as T[])
    return out
  }
  chunk(ROOT_WORDS, 10).forEach((part, i) => {
    out.push({
      id: 'word:root:' + i,
      title: 'Русский язык, задание №9 — гласные в корне: список слов',
      subjectId: 'russian',
      taskNo: 9,
      text: part.map(([w, l, kind, hint]) => `${w.replace('..', l.toUpperCase())} — ${kind}${hint ? ', ' + hint : ''}`).join('\n'),
    })
  })
  for (const [name, list, no, what] of [
    ['приставки', PREFIX_WORDS, 10, 'задание №10 — приставки'],
    ['суффиксы', SUFFIX_WORDS, 11, 'задание №11 — суффиксы'],
    ['окончания', ENDING_WORDS, 12, 'задание №12 — окончания и причастия'],
  ] as const) {
    chunk(list, 14).forEach((part, i) => {
      out.push({
        id: 'word:' + name + ':' + i,
        title: 'Русский язык, ' + what + ': список слов',
        subjectId: 'russian',
        taskNo: no,
        text: part.map(([w, l]) => w.replace('..', l.toUpperCase())).join(', '),
      })
    })
  }
  chunk(PARONYMS, 8).forEach((part, i) => {
    out.push({
      id: 'word:paronym:' + i,
      title: 'Русский язык, задание №5 — паронимы: разбор пар',
      subjectId: 'russian',
      taskNo: 5,
      text: part.map(([sent, right, why]) => `${sent} → ${right}. ${why}`).join('\n'),
    })
  })
  chunk(PLEONASM, 8).forEach((part, i) => {
    out.push({
      id: 'word:pleonasm:' + i,
      title: 'Русский язык, задание №6 — лишние слова и тавтология',
      subjectId: 'russian',
      taskNo: 6,
      text: part.map(([sent, right, why]) => `${sent} → ${right}. ${why}`).join('\n'),
    })
  })
  chunk(FORMS, 8).forEach((part, i) => {
    out.push({
      id: 'word:form:' + i,
      title: 'Русский язык, задание №7 — формы слова',
      subjectId: 'russian',
      taskNo: 7,
      text: part.map(([sent, right, why]) => `${sent} → ${right}. ${why}`).join('\n'),
    })
  })

  // 4. Структура работы по предметам: сколько заданий, что где, сколько времени.
  for (const sid of Object.keys(EGE_TASKS)) {
    out.push({
      id: 'spec:' + sid,
      title: `Структура ЕГЭ: ${subjectName(sid)}`,
      subjectId: sid,
      text: egeSpec(sid),
    })
  }

  cache = out
  return out
}

// ---------- поиск ----------

export interface FoundPassage extends Passage {
  score: number
}

/**
 * Найти в справочнике то, что относится к вопросу.
 *
 * Считаем по словам: совпадение в заголовке весит больше, чем в теле, — у
 * заголовка «задание №10 — Правописание приставок» слов мало, и попадание туда
 * почти наверняка не случайно. Предмет ученика поднимает свои куски, но чужие
 * не выбрасывает: вопрос про ударение может задать и математик.
 */
export function findKnowledge(
  query: string,
  opts: { subjectId?: string; taskNo?: number; limit?: number } = {},
): FoundPassage[] {
  const t = terms(query)
  if (!t.length) return []
  const limit = opts.limit ?? 4
  const idx = index()
  const taskNo = opts.taskNo ?? askedTaskNo(query)

  const scored: FoundPassage[] = []
  for (const p of idx) {
    let score = 0
    for (const w of t) {
      // Вес слова обратно пропорционален тому, как часто оно встречается.
      //
      // Без этого «сколько заданий в ЕГЭ по русскому» находило теорию к
      // первому попавшемуся номеру: слово «задание» есть в заголовке у
      // каждого куска и перевешивало всё остальное. Редкое слово («Фано»,
      // «пароним») почти наверняка указывает на нужный кусок, частое —
      // не значит ничего.
      const w8 = idx.weight.get(w) ?? 1
      if (idx.title.get(p.id)!.includes(' ' + w + ' ')) score += 3 * w8
      else if (idx.body.get(p.id)!.includes(' ' + w + ' ')) score += w8
    }
    if (!score) continue
    // Названный прямо номер задания — почти всегда именно то, что просят.
    if (taskNo && p.taskNo === taskNo) score += 12
    if (opts.subjectId && p.subjectId === opts.subjectId) score += 1.5
    scored.push({ ...p, score })
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit)
}

/** Разобранный справочник: слова каждого куска и вес каждого слова. */
interface Index extends Array<Passage> {
  title: Map<string, string>
  body: Map<string, string>
  weight: Map<string, number>
}
let idxCache: Index | null = null

function index(): Index {
  if (idxCache) return idxCache
  const list = allPassages() as Index
  list.title = new Map()
  list.body = new Map()
  list.weight = new Map()
  const seen = new Map<string, number>()
  const words = (s: string) => ' ' + (s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).map(stem).join(' ') + ' '
  for (const p of list) {
    const t = words(p.title)
    const b = words(p.text)
    list.title.set(p.id, t)
    list.body.set(p.id, b)
    for (const w of new Set((t + b).split(' ').filter(Boolean))) seen.set(w, (seen.get(w) ?? 0) + 1)
  }
  // Слово в половине кусков почти ничего не различает, слово в одном — различает всё.
  for (const [w, n] of seen) list.weight.set(w, Math.log(1 + list.length / n))
  idxCache = list
  return list
}

/**
 * Найденное — в текст для запроса модели.
 *
 * Кусок режем: в справочнике есть разделы на тысячи знаков (список ударений),
 * и целиком они вытеснят из запроса сам вопрос.
 */
export function knowledgeBlock(found: FoundPassage[], maxCharsEach = 1400): string {
  if (!found.length) return ''
  const parts = found.map((p) => '### ' + p.title + '\n' + p.text.slice(0, maxCharsEach))
  return (
    'СПРАВОЧНИК NOUS (проверенные данные приложения — опирайся В ПЕРВУЮ ОЧЕРЕДЬ на них, ' +
    'они точнее твоей памяти; если справочник противоречит тому, что ты помнишь, прав справочник):\n\n' +
    parts.join('\n\n')
  )
}

/** Коротко: сколько кусков в справочнике — для честной подписи в интерфейсе. */
export function knowledgeSize(): number {
  return allPassages().length
}
