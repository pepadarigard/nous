// Банк заданий: разбор своих форматов и проверка ответов — БЕЗ ИИ и БЕЗ интернета.
//
// Проверка «в лоб» здесь честнее, чем кажется: в тестовой части ЕГЭ ответ короткий
// и однозначный, поэтому сравнение по нормализованной строке даёт тот же вердикт,
// что и человек. Развёрнутые ответы этим способом не проверяются — там нужен ИИ.

import type { Attempt, Question } from '../types'

// ---------- проверка ответа ----------

/** Ответ к короткому виду: без регистра, пробелов, «ё», хвостовой пунктуации. */
export function normAnswer(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[\s ]+/g, '')
    .replace(/[.,;:!?"'`«»]+$/g, '')
    // Ведущая пунктуация — мусор от копирования, НО «,5» и «.5» это число:
    // отрицательный просмотр вперёд не даёт срезать разделитель перед цифрой.
    .replace(/^[.,;:!?"'`«»]+(?!\d)/g, '')
    .replace(/^[;:!?"'`«»]+/g, '')
    .replace(/,/g, '.') // 3,5 и 3.5 — один и тот же ответ
    .trim()
}

/**
 * Как ещё можно прочитать тот же ответ. Запятая в ЕГЭ двусмысленна: в «3,14» это
 * десятичный разделитель, а в «2,3» — перечисление номеров, которое в бланк пишут
 * слитно («23»). Когда прочтения не различить (по одной цифре с каждой стороны),
 * принимаем оба: засчитать верный ответ важнее, чем придраться к разделителю.
 */
function answerForms(s: string): string[] {
  const norm = normAnswer(s)
  const parts = norm.split('.')
  const digitList = parts.length > 1 && parts.every((p) => /^\d$/.test(p))
  const forms = digitList ? [norm, parts.join('')] : [norm]
  // Число ещё и в каноническом виде: «14,40», «14,4» и «014.4» — один ответ.
  // Без этого лишний ноль в конце превращал верное решение в ошибку.
  const canon = canonNumber(norm)
  if (canon !== null && !forms.includes(canon)) forms.push(canon)
  return forms
}

/**
 * Ответ как число, приведённое к одному виду: без хвостовых нулей, без ведущих
 * нулей, минус нормализован. null — если это не одно число (слово, перечисление,
 * дробь «2/3»), тогда сравниваем как текст.
 */
function canonNumber(norm: string): string | null {
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(norm)) return null
  const n = Number(norm)
  if (!Number.isFinite(n)) return null
  // toString сам убирает хвостовые и ведущие нули; экспоненциальную запись
  // (1e-7) в ответах ЕГЭ не встретишь, но на всякий случай отбрасываем.
  const out = String(n)
  return out.includes('e') ? null : out
}

/** Сколько клеток в бланке кратких ответов. */
export const BLANK_CELLS = 17

/**
 * Влезает ли эталон в бланк кратких ответов.
 *
 * Не всякий ответ — короткий. У информатики в задании 25 их двенадцать штук
 * подряд, у задания 27 — два поля по паре чисел; такое в бланк из семнадцати
 * клеток не пишут, и сравнивать посимвольно там нечего. Приложение по этому
 * признаку и решает, показать клеточки с автопроверкой или поле для решения
 * с самопроверкой по разбору.
 */
export function fitsBlank(expected?: string): boolean {
  if (!expected) return false
  return expected.split('|').some((v) => {
    const n = normAnswer(v).length
    return n > 0 && n <= BLANK_CELLS
  })
}

/** Совпадает ли ответ с эталоном. Несколько допустимых эталонов пишутся через | */
export function isCorrect(given: string, expected?: string): boolean | null {
  if (!expected || !expected.trim()) return null // эталона нет — сравнивать не с чем
  const g = answerForms(given)
  if (!g[0]) return false
  return expected
    .split('|')
    .flatMap((x) => answerForms(x))
    .filter(Boolean)
    .some((e) => g.includes(e))
}

// ---------- статистика ----------

export interface TaskStat {
  subjectId: string
  taskNo?: number
  total: number
  correct: number
  pct: number
  lastAt?: string
}

/** Сводка по номерам заданий: где сыпешься чаще всего. */
export function taskStats(attempts: Attempt[]): TaskStat[] {
  const map = new Map<string, TaskStat>()
  for (const a of attempts) {
    if (a.correct === null) continue // самопроверка без вердикта в статистику не идёт
    const key = a.subjectId + '#' + (a.taskNo ?? '-')
    let st = map.get(key)
    if (!st) {
      st = { subjectId: a.subjectId, taskNo: a.taskNo, total: 0, correct: 0, pct: 0 }
      map.set(key, st)
    }
    st.total++
    if (a.correct) st.correct++
    if (!st.lastAt || a.at > st.lastAt) st.lastAt = a.at
  }
  const out = [...map.values()]
  for (const st of out) st.pct = st.total ? Math.round((st.correct / st.total) * 100) : 0
  return out.sort((a, b) => a.pct - b.pct || b.total - a.total)
}

/** Слабые места: где решено меньше 70% при хотя бы трёх попытках. */
export function weakSpots(attempts: Attempt[], limit = 5): TaskStat[] {
  return taskStats(attempts).filter((s) => s.total >= 3 && s.pct < 70).slice(0, limit)
}

/**
 * Очередь заданий на тренировку: сначала то, где ошибался, потом нерешённое,
 * потом давно решённое верно. Внутри групп — перемешиваем, чтобы не зубрить порядок.
 */
export function trainingQueue(questions: Question[], attempts: Attempt[], limit = 20): Question[] {
  const byQ = new Map<string, { total: number; wrong: number; lastAt: string }>()
  for (const a of attempts) {
    const st = byQ.get(a.questionId) ?? { total: 0, wrong: 0, lastAt: '' }
    st.total++
    if (a.correct === false) st.wrong++
    if (a.at > st.lastAt) st.lastAt = a.at
    byQ.set(a.questionId, st)
  }
  const score = (q: Question): number => {
    const st = byQ.get(q.id)
    if (!st) return 1 // ни разу не решал
    if (st.wrong > 0) return 0 - st.wrong // ошибался — вперёд очереди
    return 2 // решал верно — в самый конец
  }
  const shuffled = [...questions]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  return shuffled.sort((a, b) => score(a) - score(b)).slice(0, limit)
}

// ---------- разбор таблиц (свой формат) ----------

/** Разделитель таблицы по первой строке: ; , или табуляция. */
function guessDelimiter(line: string): string {
  const counts: [string, number][] = [
    [';', (line.match(/;/g) || []).length],
    ['\t', (line.match(/\t/g) || []).length],
    [',', (line.match(/,/g) || []).length],
  ]
  counts.sort((a, b) => b[1] - a[1])
  return counts[0][1] > 0 ? counts[0][0] : ';'
}

/** Разбор CSV/TSV с кавычками. Возвращает строки как массивы ячеек. */
export function parseTable(text: string): string[][] {
  const clean = text.replace(/^﻿/, '')
  const firstLine = clean.slice(0, clean.indexOf('\n') < 0 ? clean.length : clean.indexOf('\n'))
  const delim = guessDelimiter(firstLine)
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i]
    if (quoted) {
      if (c === '"') {
        if (clean[i + 1] === '"') {
          cell += '"'
          i++
        } else quoted = false
      } else cell += c
      continue
    }
    if (c === '"') {
      quoted = true
      continue
    }
    if (c === delim) {
      row.push(cell)
      cell = ''
      continue
    }
    if (c === '\n') {
      row.push(cell.replace(/\r$/, ''))
      if (row.some((x) => x.trim())) rows.push(row)
      row = []
      cell = ''
      continue
    }
    cell += c
  }
  row.push(cell.replace(/\r$/, ''))
  if (row.some((x) => x.trim())) rows.push(row)
  return rows
}

/** Строки из JSON-массива объектов → та же таблица (первая строка — имена полей). */
export function jsonToTable(text: string): string[][] {
  const data = JSON.parse(text)
  const arr: any[] = Array.isArray(data) ? data : Array.isArray(data?.questions) ? data.questions : []
  if (!arr.length) return []
  const keys = [...new Set(arr.flatMap((o) => (o && typeof o === 'object' ? Object.keys(o) : [])))]
  const rows: string[][] = [keys]
  for (const o of arr) {
    rows.push(keys.map((k) => (o?.[k] === undefined || o?.[k] === null ? '' : String(o[k]))))
  }
  return rows
}

export type FieldName = 'text' | 'answer' | 'taskNo' | 'topic' | 'solution' | 'skip'

export const FIELD_LABEL: Record<FieldName, string> = {
  text: 'Вопрос',
  answer: 'Ответ',
  taskNo: 'Номер задания',
  topic: 'Тема',
  solution: 'Разбор',
  skip: '— не брать —',
}

/** Догадка о назначении колонок по их заголовкам — чтобы не размечать руками каждый раз. */
export function guessMapping(header: string[]): FieldName[] {
  return header.map((h) => {
    const t = h.toLowerCase().trim()
    if (/вопрос|задание|условие|текст|text|question|task/.test(t) && !/номер|no|№/.test(t)) return 'text'
    if (/ответ|ключ|эталон|answer|key/.test(t)) return 'answer'
    if (/номер|№|no\b|task_?no|number/.test(t)) return 'taskNo'
    if (/тема|topic|раздел/.test(t)) return 'topic'
    if (/разбор|решени|solution|объясн/.test(t)) return 'solution'
    return 'skip'
  })
}

// ---------- вытаскивание заданий из текста материала ----------

export interface DraftQuestion {
  taskNo?: number
  text: string
  answer?: string
}

/**
 * Ключ ответов в конце варианта: «Ответы: 1) 24 2) 15» или «1. 24».
 *
 * Ищем именно заголовок ключа — «ответы» во множественном или «ключ». Одиночное
 * «Ответ:» этим считать НЕЛЬЗЯ: оно стоит после каждого задания, и остаток документа
 * тогда принимается за ключ. На домашке «1. … Ответ: 6 / 2. Решить номера…» это
 * приводило к тому, что заданию 2 подставлялся «ответ» — слово «Решить».
 */
function parseAnswerKey(text: string): Record<number, string> {
  const out: Record<number, string> = {}
  // NB: `\b` здесь применять НЕЛЬЗЯ — в JS границы слова считаются по [A-Za-z0-9_],
  // кириллица туда не входит, и «ответы\n» никогда не совпадёт. Нужен юникодный lookahead.
  const head = text.toLowerCase().match(/(?:ответы|ключи?\s+ответов|ключ)(?![\p{L}])/gu)
  if (!head) return out
  const idx = text.toLowerCase().lastIndexOf(head[head.length - 1])
  if (idx < 0) return out
  const tail = text.slice(idx)
  // Значение — либо десятичная дробь целиком («0,4»), либо кусок без запятых. Порядок
  // важен: запятая в ЕГЭ и десятичный разделитель, и разделитель пар в строке ключа
  // («1) 24, 2) 15»). Сначала пробуем прочитать дробь, иначе режем по запятой.
  const re = /(\d{1,2})\s*[).:]\s*(\d+[.,]\d+|[^\s,;]{1,40})/g
  let m: RegExpExecArray | null
  while ((m = re.exec(tail))) {
    const no = Number(m[1])
    if (no >= 1 && no <= 40 && !out[no]) out[no] = m[2].trim()
  }
  return out
}

/**
 * Найти в тексте пронумерованные задания. Два пути, от надёжного к рискованному:
 *
 * 1. Явная разметка «Задание 5 № 26841» — её печатают Решу ЕГЭ и сборники. Однозначна,
 *    поэтому берётся как есть, включая подборки с пропусками номеров.
 * 2. Голые номера в печатном варианте — тут приходится гадать по возрастающей цепочке,
 *    и результат стоит просматривать глазами перед добавлением в банк.
 */
export function extractQuestions(
  text: string,
  maxLen = 1200,
  minLetters = 40,
  minChain = 3,
): DraftQuestion[] {
  const key = parseAnswerKey(text)
  // В HTML-выгрузке заголовок задания часто приклеен к предыдущему тексту: тег <span>
  // переноса строки не даёт. Разрываем строку перед однозначным маркером «Задание N №»,
  // иначе он не окажется в начале строки и разбор его не увидит. Форму без «№» не трогаем:
  // «см. задание 5» встречается в обычной прозе, и рвать по ней нельзя.
  const lines = text.replace(/(\S)[ \t]+(Задание\s*\d{1,2}\s*№)/gi, '$1\n$2').split('\n')

  interface Cand { no: number; line: number; rest: string }

  // СНАЧАЛА — явная разметка «Задание 5» или «Задание 5 № 26841»: так печатают Решу ЕГЭ
  // и многие сборники. Она однозначна, поэтому гадать по цепочке не нужно, а номера
  // берутся как написаны — даже с пропусками (1, 4, 9 — это подборка по типу задания,
  // и требовать от неё возрастания подряд было бы неверно).
  const marked: Cand[] = []
  lines.forEach((raw, i) => {
    const m = raw.match(/^\s*задание\s*(\d{1,2})\b\s*(?:№\s*\d+)?\s*(.*)$/i)
    if (!m) return
    const no = Number(m[1])
    if (no < 1 || no > 40) return
    marked.push({ no, line: i, rest: m[2].trim() })
  })

  let chain: Cand[]
  if (marked.length >= 2) {
    chain = marked
  } else {
    // Иначе — вариант, где номера стоят голыми: «12.», «12)» или просто «12» в рамке.
    const cands: Cand[] = []
    lines.forEach((raw, i) => {
      const m = raw.match(/^\s*(?:задание\s*)?(\d{1,2})\s*[.)]?\s*(.*)$/i)
      if (!m) return
      const no = Number(m[1])
      if (no < 1 || no > 40) return
      const rest = m[2].trim()
      // Отсекаем формулы и таблицы: после номера должно быть либо пусто (номер в рамке),
      // либо начало нормального предложения, а не «=», цифра или знак.
      if (rest && !/^[\p{L}«"(]/u.test(rest)) return
      cands.push({ no, line: i, rest })
    })

    // Наивный поиск «строка начинается с числа» ловит варианты ответов («1) …», «2) …»),
    // которых в варианте больше, чем самих заданий. Поэтому берём только НОМЕРА, ИДУЩИЕ
    // ПО ВОЗРАСТАНИЮ через весь документ: повторяющиеся списки в такую цепочку не попадут.
    chain = []
    let expect = -1
    for (const c of cands) {
      if (!chain.length) {
        if (c.no <= 3) {
          chain.push(c)
          expect = c.no + 1
        }
        continue
      }
      if (c.no >= expect && c.no <= expect + 2) {
        chain.push(c)
        expect = c.no + 1
      }
    }
    // Порог цепочки параметром: в PDF он защищает от списков вариантов («1) … 2) …»),
    // а при ручной вставке домашка из двух пунктов — обычное дело.
    if (chain.length < minChain) return []
  }

  const out: DraftQuestion[] = []
  for (let i = 0; i < chain.length; i++) {
    const from = chain[i]
    const to = i + 1 < chain.length ? chain[i + 1].line : lines.length
    let body = [from.rest, ...lines.slice(from.line + 1, to)].join('\n').trim()
    if (body.length > maxLen) body = body.slice(0, maxLen).trim()
    if (body.length < 12) continue
    // В настоящем задании есть связный текст, а не только формулы и обозначения.
    // Порог параметром: для PDF он спасает от мусора, но короткий пункт домашки
    // («Повторить тождества») под него не проходит — и молча пропадает.
    const letters = (body.match(/\p{L}/gu) || []).length
    if (letters < minLetters) continue
    let answer: string | undefined = key[from.no]
    const inline = body.match(/ответ\s*[:—-]\s*([^\n]{1,60})/i)
    if (inline && inline.index !== undefined) {
      answer = inline[1].trim()
      body = body.slice(0, inline.index).trim()
    }
    out.push({ taskNo: from.no, text: body, answer })
  }
  return out
}

/** Куски текста для ручного отбора: абзацы разумной длины, без служебного мусора. */
export function textParagraphs(text: string, min = 60, max = 1500, minLetters = 40): string[] {
  return text
    .split(/\n{2,}|\n(?=\s*(?:задание|\d{1,2}[.)])\s)/i)
    .map((p) => p.trim())
    .filter((p) => p.length >= min && p.length <= max && (p.match(/\p{L}/gu) || []).length > minLetters)
}
