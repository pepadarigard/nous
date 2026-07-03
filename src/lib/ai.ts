// «Мозг» приложения. Наш ИИ НЕ придумывает план — он:
//  1) собирает готовый промт для внешнего ИИ (buildPlanPrompt, чистая функция);
//  2) раскладывает ответ внешнего ИИ в структуру (importPlan — сначала прямой JSON, потом ИИ-подстраховка);
//  3) отвечает в чате (tutorChat).

import type { AppConfig, Block, Lesson, StudyPlan, SubjectGoal, SubjectSchedule } from '../types'
import { groqRaw, isTauri, uid, type GroqBody } from './api'
import { activeKey } from './providers'
import { SUBJECTS, subjectName, WEEKDAYS } from '../data/subjects'
import { EGE_YEAR, egeSpec } from '../data/ege2027'

function useMock(): boolean {
  if (isTauri) return false
  try {
    return localStorage.getItem('ege_real_ai') !== '1'
  } catch {
    return true
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function isRateLimit(e: unknown): boolean {
  const m = String((e as any)?.message ?? e).toLowerCase()
  return m.includes('rate limit') || m.includes('429') || m.includes('too many') || m.includes('rate_limit')
}

async function groqRawRetry(cfg: AppConfig, body: GroqBody): Promise<any> {
  let last: unknown
  for (let i = 0; i < 3; i++) {
    try {
      return await groqRaw(activeKey(cfg), body, cfg.provider ?? 'groq', { folder: cfg.yandexFolder })
    } catch (e) {
      last = e
      if (isRateLimit(e) && i < 2) {
        await sleep(4500)
        continue
      }
      throw e
    }
  }
  throw last
}

const MATH_RULE =
  'Математику пиши ПРОСТЫМ читаемым текстом Юникодом: √, π, ², ³, ≤, ≥, ×, ÷, ·, ⇒, ∈, ℤ, ℝ, дроби вида a/b, sin(2x), [0; π], x₁, log₂. ' +
  'КАТЕГОРИЧЕСКИ НЕ используй LaTeX: никаких команд с обратным слэшем (\\frac, \\sqrt, \\Rightarrow, \\pi, \\mathbb, \\cdot, \\in и т.п.), фигурных скобок для степеней и знаков доллара $. ' +
  'Пиши «⇒» вместо \\Rightarrow, «π» вместо \\pi, «a/b» вместо \\frac, «√(x)» вместо \\sqrt. Объясняй по шагам, коротко и понятно.'

const REFERENCE_METHODOLOGY = `
Опирайся на эту проверенную методику подготовки к ЕГЭ.

РИТМ: будни — 1–2 коротких занятия в день; один день в неделю — полный выходной; минимум раз в неделю — разбор ошибок недели. Ученик ведёт таблицу слабых мест. «Правило одной задачи» в тяжёлый день.

ПРАКТИКА: без авто-контрольных. Практика = решать РЕАЛЬНЫЕ задания по теме на РешуЕГЭ/СдамГИА и в открытом банке ФИПИ (информатика — kompege.ru). Формулируй конкретно: «реши 15–20 заданий №… по теме … на РешуЕГЭ».

ПОВТОРЕНИЕ: регулярно вставляй занятия-повторение (kind="review"), которые ВОЗВРАЩАЮТСЯ к КОНКРЕТНЫМ ранее пройденным темам (перерешать задания по прошлой теме, разбор ошибок, прогон таблицы слабых мест) — чтобы материал закреплялся и запоминался. В описании review указывай, какую именно тему повторяем.

ПОРЯДОК ТЕМ:
• Математика профиль, часть 1: планиметрия, векторы, стереометрия, вероятность, теоремы о вероятностях, простейшие уравнения, вычисления/преобразования (степени, корни, логарифмы, тригонометрия), производная и первообразная, задачи с физ. смыслом, текстовые задачи, графики функций, наиб./наим. Часть 2: 13 (уравнения), 15 (неравенства), 14 (стереометрия), далее 16–19.
• Информатика (КЕГЭ): ручные — системы счисления, кодирование, логика, графы, исполнители, теория игр; на Python — обработка чисел/строк, файлы/сортировка, задания 26 и 27. С первого дня — kompege.ru.
• Русский: 1–3 анализ текста, 4 ударения, 5–8 нормы, 9–15 орфография, 16–21 пунктуация, 22–26 текст и выразительность, 27 сочинение.

ПРИНЦИПЫ: не переходить к новой теме, пока не закрыта текущая; каждые 2–3 недели — полный пробник; сначала фундамент, потом сложное.
РЕСУРСЫ: ФИПИ, РешуЕГЭ/СдамГИА, kompege.ru, К. Поляков, Школково.
`.trim()

function toSup(e: string): string {
  const SUP: Record<string, string> = {
    '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
    '+': '⁺', '-': '⁻', '−': '⁻', '(': '⁽', ')': '⁾', n: 'ⁿ', x: 'ˣ', i: 'ⁱ',
  }
  const t = e.trim()
  if (t.length > 0 && [...t].every((c) => c in SUP)) return [...t].map((c) => SUP[c]).join('')
  return '^(' + t + ')'
}

function toSub(e: string): string {
  const SUB: Record<string, string> = {
    '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
    '+': '₊', '-': '₋', '−': '₋', '=': '₌', '(': '₍', ')': '₎',
    a: 'ₐ', e: 'ₑ', h: 'ₕ', i: 'ᵢ', j: 'ⱼ', k: 'ₖ', l: 'ₗ', m: 'ₘ', n: 'ₙ', o: 'ₒ', p: 'ₚ', r: 'ᵣ', s: 'ₛ', t: 'ₜ', u: 'ᵤ', v: 'ᵥ', x: 'ₓ',
  }
  const t = e.trim()
  if (t.length > 0 && [...t].every((c) => c in SUB)) return [...t].map((c) => SUB[c]).join('')
  return '_' + t
}

// Полный набор LaTeX-команд → Юникод, чтобы в чате не оставалось «Rightarrow», «mathbb{Z}» и т.п.
const LATEX_MAP: Record<string, string> = {
  // греческие
  '\\pi': 'π', '\\alpha': 'α', '\\beta': 'β', '\\gamma': 'γ', '\\delta': 'δ', '\\epsilon': 'ε', '\\varepsilon': 'ε',
  '\\zeta': 'ζ', '\\eta': 'η', '\\theta': 'θ', '\\vartheta': 'θ', '\\iota': 'ι', '\\kappa': 'κ', '\\lambda': 'λ',
  '\\mu': 'μ', '\\nu': 'ν', '\\xi': 'ξ', '\\rho': 'ρ', '\\sigma': 'σ', '\\tau': 'τ', '\\upsilon': 'υ', '\\phi': 'φ',
  '\\varphi': 'φ', '\\chi': 'χ', '\\psi': 'ψ', '\\omega': 'ω',
  '\\Gamma': 'Γ', '\\Delta': 'Δ', '\\Theta': 'Θ', '\\Lambda': 'Λ', '\\Xi': 'Ξ', '\\Pi': 'Π', '\\Sigma': 'Σ',
  '\\Phi': 'Φ', '\\Psi': 'Ψ', '\\Omega': 'Ω',
  // операторы
  '\\cdot': '·', '\\times': '×', '\\div': '÷', '\\pm': '±', '\\mp': '∓', '\\ast': '∗', '\\star': '⋆',
  '\\leq': '≤', '\\le': '≤', '\\geq': '≥', '\\ge': '≥', '\\neq': '≠', '\\ne': '≠', '\\approx': '≈',
  '\\equiv': '≡', '\\cong': '≅', '\\sim': '∼', '\\propto': '∝', '\\ll': '≪', '\\gg': '≫',
  '\\infty': '∞', '\\partial': '∂', '\\nabla': '∇', '\\sum': '∑', '\\prod': '∏', '\\int': '∫',
  '\\sqrt': '√', '\\angle': '∠', '\\perp': '⊥', '\\parallel': '∥', '\\degree': '°', '\\circ': '°', '\\deg': '°',
  // множества и логика
  '\\in': '∈', '\\notin': '∉', '\\ni': '∋', '\\subset': '⊂', '\\subseteq': '⊆', '\\supset': '⊃', '\\supseteq': '⊇',
  '\\cup': '∪', '\\cap': '∩', '\\emptyset': '∅', '\\varnothing': '∅', '\\setminus': '\\',
  '\\forall': '∀', '\\exists': '∃', '\\nexists': '∄', '\\neg': '¬', '\\land': '∧', '\\lor': '∨',
  '\\mathbb{R}': 'ℝ', '\\mathbb{Z}': 'ℤ', '\\mathbb{N}': 'ℕ', '\\mathbb{Q}': 'ℚ', '\\mathbb{C}': 'ℂ',
  // стрелки
  '\\Rightarrow': '⇒', '\\Leftarrow': '⇐', '\\Leftrightarrow': '⇔', '\\iff': '⇔', '\\implies': '⇒',
  '\\rightarrow': '→', '\\to': '→', '\\leftarrow': '←', '\\leftrightarrow': '↔', '\\mapsto': '↦', '\\gets': '←',
  // многоточия и пробелы
  '\\ldots': '…', '\\dots': '…', '\\cdots': '…', '\\quad': ' ', '\\qquad': '  ',
}

// gentle=true — для чата: чистим только LaTeX/математику, но СОХРАНЯЕМ markdown (**, ###, списки),
// скобки {} и отступы, чтобы разметку отрисовал mdToHtml. Обычный режим (для плана) вырезает всё.
export function cleanMath(input: string, gentle = false): string {
  if (!input) return input
  let s = String(input)
  s = s.split('').filter((ch) => { const k = ch.charCodeAt(0); return k >= 32 || k === 9 || k === 10 || k === 13 }).join('')
  s = s.replace(/\${1,2}/g, '')
  if (!gentle) s = s.replace(/\*\*|__/g, '')
  s = s.replace(/\\left\s*|\\right\s*/g, '')
  // обёртки-«шрифты»: оставляем содержимое
  s = s.replace(/\\(?:text|mathrm|mathbf|mathit|mathsf|operatorname|boxed)\s*\{([^{}]*)\}/g, '$1')
  s = s.replace(/\\sqrt\s*\{([^{}]*)\}/g, '√($1)')
  s = s.replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '($1)/($2)')
  // надстрочные: {..}, число, одиночная буква (x^n → xⁿ)
  s = s.replace(/\^\{([^{}]*)\}/g, (_m, e) => toSup(e))
  s = s.replace(/\^(-?\d+)/g, (_m, d) => toSup(d))
  s = s.replace(/\^([A-Za-zА-Яа-я])/g, (_m, c) => toSup(c))
  // подстрочные: только явные {..} (голый _ не трогаем — это ломало бы snake_case в коде Python)
  s = s.replace(/_\{([^{}]*)\}/g, (_m, e) => toSub(e))
  for (const [k, v] of Object.entries(LATEX_MAP)) s = s.split(k).join(v)
  // \mathbb{X} для нестандартных букв (ℝℤℕℚℂ уже заменены выше) → сама буква
  s = s.replace(/\\mathbb\s*\{([^{}]*)\}/g, '$1')
  s = s.replace(/\\(sin|cos|tan|cot|ctg|tg|sec|csc|log|ln|lim|exp|arcsin|arccos|arctan|arcctg|min|max)\b/g, '$1')
  s = s.replace(/\\([a-zA-Zа-яА-Я]+)/g, '$1')
  if (!gentle) {
    s = s.replace(/[{}]/g, '')
    s = s.replace(/[ \t]{2,}/g, ' ')
  }
  return s.trim()
}

function extractJson(text: string): any {
  let t = (text || '').trim()
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) t = fence[1].trim()
  try {
    return JSON.parse(t)
  } catch {
    /* пробуем вырезать */
  }
  const s = t.indexOf('{')
  const e = t.lastIndexOf('}')
  if (s !== -1 && e > s) {
    try {
      return JSON.parse(t.slice(s, e + 1))
    } catch {
      /* всё */
    }
  }
  throw new Error('Не удалось разобрать JSON')
}

interface CallOpts {
  system: string
  user: string
  temperature?: number
  maxTokens?: number
}
async function callJSON(cfg: AppConfig, opts: CallOpts): Promise<any> {
  const base: GroqBody = {
    model: cfg.textModel,
    messages: [
      { role: 'system', content: opts.system },
      { role: 'user', content: opts.user },
    ],
    temperature: opts.temperature ?? 0.3,
    max_tokens: opts.maxTokens ?? 4000,
  }
  const attempts: GroqBody[] = [
    { ...base, response_format: { type: 'json_object' }, reasoning_format: 'hidden' },
    { ...base, reasoning_format: 'hidden' },
    { ...base },
  ]
  let lastErr: unknown
  for (const body of attempts) {
    try {
      const resp = await groqRawRetry(cfg, body)
      const c: string = resp?.choices?.[0]?.message?.content ?? ''
      if (!c.trim()) {
        lastErr = new Error('Пустой ответ ИИ')
        continue
      }
      return extractJson(c)
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Ошибка обращения к ИИ')
}

function coerceLessons(arr: any[]): Lesson[] {
  return (arr || [])
    .filter((l) => l && (l.title || l.description))
    .map((l) => {
      let kind: Lesson['kind'] = l.kind === 'theory' || l.kind === 'practice' || l.kind === 'review' ? l.kind : 'practice'
      if (l.kind === 'control') kind = 'practice'
      return {
        id: uid('les_'),
        title: cleanMath(String(l.title || 'Занятие')),
        kind,
        description: cleanMath(String(l.description || '')),
        done: false,
      }
    })
}

export interface PromptInput {
  subjects: string[]
  goals: SubjectGoal[]
  schedules: SubjectSchedule[]
  examDate?: string
  studentName?: string
  notes?: string
}

/** Недель между сегодня и датой экзамена (минимум 4, без даты — 26). */
function weeksUntil(examDate?: string): number {
  if (!examDate) return 26
  const diff = Math.round((new Date(examDate).getTime() - Date.now()) / (7 * 86400000))
  return Math.max(4, diff)
}

// Общие требования к качеству занятий (используются и во внешнем промте, и в своей генерации).
const LESSON_QUALITY =
  '- description каждого занятия — ПОДРОБНАЯ инструкция в 2–3 предложения: ЧТО именно изучить/решить (тема, номер задания), ГДЕ (РешуЕГЭ, банк ФИПИ, kompege.ru для информатики), СКОЛЬКО (число заданий) и КАК закрепить (выписать ошибки, повторить правило).\n' +
  '  Пример хорошего description: «Разбери правописание корней с чередованием (гар/гор, зар/зор, кас/кос). Затем реши 20 заданий №9 на РешуЕГЭ, раздел Орфография. Все слова с ошибками выпиши в личный словарик и проговори правило для каждого».\n' +
  '  Плохо (так НЕ делай): «Изучить лексику», «Повторить теорию», «Порешать задачи».\n' +
  '- Названия занятий — уникальные и конкретные (тема + что делаем).'

/** Собирает готовый промт для внешнего ИИ (ChatGPT/DeepSeek). Чистая функция, без запроса. */
export function buildPlanPrompt(input: PromptInput): string {
  const today = new Date().toISOString().slice(0, 10)
  const weeks = weeksUntil(input.examDate)
  const lines = input.subjects
    .map((id) => {
      const g = input.goals.find((x) => x.subjectId === id)
      const s = input.schedules.find((x) => x.subjectId === id)
      const daysN = s?.days?.length || 5
      const days = s?.days?.length ? s.days.map((d) => WEEKDAYS.find((w) => w.n === d)?.short).join(',') : 'будни'
      // Сколько занятий реально влезает до экзамена при таком расписании (с разумным потолком для JSON).
      const capacity = Math.max(40, Math.min(110, daysN * weeks))
      return `- ${subjectName(id)} (id: ${id}): сейчас ~${g?.current ?? '?'} → цель ${g?.target ?? '?'} баллов; занятия по дням: ${days} (${daysN} в неделю); нужно ≈${capacity} занятий`
    })
    .join('\n')
  const specs = input.subjects
    .map((id) => egeSpec(id))
    .filter(Boolean)
    .join('\n\n')
  const ids = input.subjects.join(', ')
  return [
    `Ты — опытный репетитор и методист ЕГЭ. Составь подробный персональный план подготовки к ЕГЭ ${EGE_YEAR}${input.studentName ? ` для ученика по имени ${input.studentName}` : ''}.`,
    '',
    'ДАННЫЕ УЧЕНИКА:',
    lines,
    `Сегодня: ${today}. Ученик сдаёт ЕГЭ ${EGE_YEAR}. ${input.examDate ? `Ориентир — ${input.examDate} (основной период), впереди ≈${weeks} недель.` : `Экзамен — конец мая ${EGE_YEAR}.`}`,
    input.notes ? `\nОТВЕТЫ И ПОЖЕЛАНИЯ УЧЕНИКА ПО ПРЕДМЕТАМ (учти обязательно): ${input.notes}` : '',
    specs ? `\nСТРУКТУРА ЭКЗАМЕНОВ (планируй строго под неё; детали ${EGE_YEAR} сверяй с демоверсиями ФИПИ):\n${specs}` : '',
    '',
    'МЕТОДИКА (следуй строго):',
    REFERENCE_METHODOLOGY,
    '',
    'ЭТАПЫ (в этом порядке внутри каждого предмета):',
    '1) Фундамент — база, без которой не решается остальное.',
    '2) Основная проработка — ВСЕ темы кодификатора ФИПИ по этому предмету, от простого к сложному.',
    '3) Сложные задания — вторая часть, высокобалльные номера.',
    '4) Финиш (последние 3–4 недели) — повторение слабых мест и полные пробники.',
    '',
    'ТРЕБОВАНИЯ:',
    '- Разбей на тематические блоки (5–8 занятий в блоке); занятия: теория (kind="theory"), практика (kind="practice"), повторение (kind="review").',
    '- Число занятий по предмету — примерно как указано в данных ученика (±15%). НЕ делай план из 20–30 занятий на год: лучше дробить темы мелче и добавлять больше практики.',
    LESSON_QUALITY,
    '- Регулярно вставляй kind="review", который возвращается к КОНКРЕТНЫМ уже пройденным темам.',
    '',
    'ПЕРЕД ОТВЕТОМ ПРОВЕРЬ СЕБЯ:',
    '(а) все разделы кодификатора покрыты; (б) порядок от простого к сложному; (в) количество занятий соответствует заданному; (г) каждый description подробный по образцу; (д) есть финишный этап с пробниками.',
    '',
    'ФОРМАТ ОТВЕТА — ОЧЕНЬ ВАЖНО:',
    `Верни ТОЛЬКО валидный JSON (без пояснений и без markdown-заборов). Поле subjectId бери СТРОГО из: ${ids}.`,
    'Схема:',
    '{"overview":"1-2 мотивирующих предложения","blocks":[{"subjectId":"<id>","title":"тема блока","goal":"цель блока","lessons":[{"title":"название занятия","kind":"theory|practice|review","description":"что именно делать"}]}]}',
  ].join('\n')
}

export interface ImportResult {
  blocks: Block[]
  subjects: string[]
  overview: string
}

/** Раскладывает ответ внешнего ИИ в структуру. Сначала прямой JSON (надёжно, без обрывов), потом ИИ-подстраховка. */
export async function importPlan(cfg: AppConfig, text: string, onProgress?: (m: string) => void): Promise<ImportResult> {
  onProgress?.('Раскладываю план…')
  const idSet = new Set(SUBJECTS.map((s) => s.id))
  let data: any = null
  try {
    data = extractJson(text)
  } catch {
    /* не JSON */
  }
  const hasBlocks = data && Array.isArray(data.blocks) && data.blocks.length > 0

  if (!hasBlocks) {
    if (useMock()) {
      return { blocks: mockBlocks('math_prof', 'Импортированный план'), subjects: ['math_prof'], overview: 'Демо-план (в браузере ИИ выключен).' }
    }
    onProgress?.('Привожу план к нужному виду через ИИ…')
    const ids = SUBJECTS.map((s) => s.id)
    data = await callJSON(cfg, {
      system:
        'Ты превращаешь готовый план подготовки к ЕГЭ (текст от другого ИИ) в JSON, СОХРАНЯЯ содержание. Отвечай только валидным JSON. ' +
        MATH_RULE,
      user:
        `План:\n"""\n${text.slice(0, 12000)}\n"""\n\n` +
        `Верни JSON: {"overview":"","blocks":[{"subjectId":"<id>","title":"","goal":"","lessons":[{"title":"","kind":"theory|practice|review","description":""}]}]}. ` +
        `subjectId СТРОГО из: ${ids.join(', ')}. Если план большой — сгруппируй по темам/неделям (до ~10 блоков), сохраняя суть.`,
      temperature: 0.2,
      maxTokens: 5000,
    })
  }

  const blocks: Block[] = ((data?.blocks || []) as any[])
    .filter((b) => b && (b.title || b.lessons))
    .map((b, i) => ({
      id: uid('blk_'),
      subjectId: idSet.has(b.subjectId) ? b.subjectId : SUBJECTS[0].id,
      title: cleanMath(String(b.title || `Блок ${i + 1}`)),
      goal: cleanMath(String(b.goal || '')),
      order: i,
      lessons: coerceLessons(b.lessons || []),
    }))
  const subjects = [...new Set(blocks.map((b) => b.subjectId))]
  return { blocks, subjects, overview: cleanMath(String(data?.overview || 'Твой план подготовки.')) }
}

/**
 * Генерация плана ПРЯМО В ПРИЛОЖЕНИИ (без внешнего ИИ): по каждому предмету — отдельный запрос
 * к умной модели на ключе ученика, со спецификацией ЕГЭ и требованиями к качеству занятий.
 */
export async function generatePlanInApp(cfg: AppConfig, input: PromptInput, onProgress?: (m: string) => void): Promise<ImportResult> {
  if (useMock()) {
    const sid = input.subjects[0] || 'math_prof'
    return {
      blocks: input.subjects.flatMap((s, i) => mockBlocks(s, subjectName(s)).map((b, j) => ({ ...b, order: i * 10 + j }))),
      subjects: input.subjects.length ? input.subjects : [sid],
      overview: 'Демо-план (в браузере ИИ выключен).',
    }
  }
  const today = new Date().toISOString().slice(0, 10)
  const weeks = weeksUntil(input.examDate)
  const allBlocks: Block[] = []
  let order = 0
  for (let i = 0; i < input.subjects.length; i++) {
    const sid = input.subjects[i]
    const name = subjectName(sid)
    onProgress?.(`Генерирую: ${name} (${i + 1} из ${input.subjects.length})…`)
    const g = input.goals.find((x) => x.subjectId === sid)
    const s = input.schedules.find((x) => x.subjectId === sid)
    const daysN = s?.days?.length || 5
    // Потолок ниже, чем у внешнего ИИ: длинный JSON в одном ответе рвётся. Остальное — «Дописать план».
    const target = Math.max(30, Math.min(70, daysN * weeks))
    const spec = egeSpec(sid)
    let data: any = null
    try {
      data = await callJSON(cfg, {
        system:
          `Ты — опытный методист ЕГЭ ${EGE_YEAR}. Составляешь план подготовки по предмету в строгом JSON. ` +
          'Отвечай ТОЛЬКО валидным JSON без пояснений. ' + MATH_RULE,
        user: [
          `Предмет: ${name}. Ученик: сейчас ~${g?.current ?? '?'} баллов, цель ${g?.target ?? '?'}. Сегодня ${today}, экзамен ЕГЭ ${EGE_YEAR}${input.examDate ? ` (${input.examDate})` : ''}, впереди ≈${weeks} недель, занятий в неделю: ${daysN}.`,
          input.notes ? `Пожелания ученика: ${input.notes}` : '',
          spec ? `\nСТРУКТУРА ЭКЗАМЕНА:\n${spec}` : '',
          `\nМЕТОДИКА:\n${REFERENCE_METHODOLOGY}`,
          '\nЭТАПЫ по порядку: 1) фундамент; 2) все темы кодификатора от простого к сложному; 3) сложные задания (вторая часть); 4) финиш — повторение слабых мест и полные пробники.',
          `\nСДЕЛАЙ ≈${target} занятий (блоки по 5–8 занятий). Требования:`,
          LESSON_QUALITY,
          '- Регулярно вставляй kind="review" с возвратом к конкретным пройденным темам.',
          `\nJSON-схема: {"blocks":[{"subjectId":"${sid}","title":"тема блока","goal":"цель","lessons":[{"title":"...","kind":"theory|practice|review","description":"..."}]}]}`,
        ].filter(Boolean).join('\n'),
        temperature: 0.35,
        maxTokens: 5000,
      })
    } catch {
      // Запасная попытка: короче план, меньше токенов — надёжнее на лимитах.
      onProgress?.(`Ещё раз, компактнее: ${name}…`)
      try {
        data = await callJSON(cfg, {
          system: `Ты методист ЕГЭ ${EGE_YEAR}. Отвечай только валидным JSON. ` + MATH_RULE,
          user:
            `План подготовки: ${name}, с ${g?.current ?? '?'} до ${g?.target ?? '?'} баллов, ≈${Math.min(40, target)} занятий (блоки по 5–6).\n` +
            (spec ? `СТРУКТУРА:\n${spec}\n` : '') +
            LESSON_QUALITY +
            `\nСхема: {"blocks":[{"subjectId":"${sid}","title":"...","goal":"...","lessons":[{"title":"...","kind":"theory|practice|review","description":"..."}]}]}`,
          temperature: 0.3,
          maxTokens: 3800,
        })
      } catch {
        data = null
      }
    }
    const blocks: Block[] = ((data?.blocks || []) as any[])
      .filter((b: any) => b && (b.title || b.lessons))
      .map((b: any) => ({
        id: uid('blk_'),
        subjectId: sid, // предмет фиксируем сами — модели иногда путают id
        title: cleanMath(String(b.title || 'Блок')),
        goal: cleanMath(String(b.goal || '')),
        order: order++,
        lessons: coerceLessons(b.lessons || []),
      }))
      .filter((b) => b.lessons.length > 0)
    allBlocks.push(...blocks)
    if (i < input.subjects.length - 1) await sleep(1500) // бережём rate-limit между предметами
  }
  if (!allBlocks.length) throw new Error('ИИ не вернул план. Попробуй ещё раз или используй путь через ChatGPT.')
  const names = [...new Set(allBlocks.map((b) => b.subjectId))]
  return {
    blocks: allBlocks,
    subjects: names,
    overview: `План подготовки к ЕГЭ ${EGE_YEAR}: сначала фундамент, затем все темы кодификатора и финишное повторение с пробниками.`,
  }
}

/**
 * «Переделать план»: ИИ меняет существующий план по пожеланию — содержание занятий, порядок,
 * состав блоков. Выполненные занятия сохраняются (переносим отметки по названию).
 */
export async function editPlan(cfg: AppConfig, plan: StudyPlan, wish: string, onProgress?: (m: string) => void): Promise<Block[]> {
  const req = wish.trim()
  if (!req) return []
  onProgress?.('ИИ переделывает план…')
  if (useMock()) {
    // Демо: переворачиваем порядок блоков, чтобы изменение было видно.
    return [...plan.blocks].reverse().map((b, i) => ({ ...b, order: i }))
  }
  // Компактное представление плана: без description, если он большой (иначе не влезет в ответ).
  const totalLessons = plan.blocks.reduce((s, b) => s + b.lessons.length, 0)
  const withDesc = totalLessons <= 45
  const compact = plan.blocks.map((b) => ({
    subjectId: b.subjectId,
    title: b.title,
    goal: b.goal,
    lessons: b.lessons.map((l) => ({
      title: l.title,
      kind: l.kind,
      done: l.done ? 1 : 0,
      ...(withDesc ? { description: l.description } : {}),
    })),
  }))
  const ids = SUBJECTS.map((s) => s.id)
  const data = await callJSON(cfg, {
    system:
      `Ты редактируешь план подготовки к ЕГЭ ${EGE_YEAR} по пожеланию ученика. Можно: переставлять и удалять блоки/занятия, менять названия, kind и описания, добавлять новое. ` +
      'НЕЛЬЗЯ: удалять или переименовывать занятия с done:1 (их можно только перемещать); трогать то, чего пожелание не касается (сохраняй дословно). ' +
      'Описания изменённых/новых занятий делай подробными: что, где, сколько решать. Отвечай ТОЛЬКО валидным JSON. ' +
      MATH_RULE,
    user:
      `ТЕКУЩИЙ ПЛАН:\n${JSON.stringify({ blocks: compact })}\n\n` +
      `ПОЖЕЛАНИЕ УЧЕНИКА: ${req}\n\n` +
      `Верни ПОЛНЫЙ обновлённый план: {"blocks":[{"subjectId":"<id>","title":"...","goal":"...","lessons":[{"title":"...","kind":"theory|practice|review","description":"..."}]}]}. subjectId СТРОГО из: ${ids.join(', ')}.`,
    temperature: 0.3,
    maxTokens: 8000,
  })
  const idSet = new Set(SUBJECTS.map((s) => s.id))
  const oldByTitle = new Map(
    plan.blocks.flatMap((b) => b.lessons.map((l) => [l.title.trim().toLowerCase(), l] as const)),
  )
  const blocks: Block[] = ((data?.blocks || []) as any[])
    .filter((b: any) => b && (b.title || b.lessons))
    .map((b: any, i: number) => ({
      id: uid('blk_'),
      subjectId: idSet.has(b.subjectId) ? b.subjectId : plan.blocks[0]?.subjectId || SUBJECTS[0].id,
      title: cleanMath(String(b.title || `Блок ${i + 1}`)),
      goal: cleanMath(String(b.goal || '')),
      order: i,
      lessons: coerceLessons(b.lessons || []).map((l) => {
        const old = oldByTitle.get(l.title.trim().toLowerCase())
        return {
          ...l,
          done: old?.done ?? false, // отметки выживают при переделке
          completedAt: old?.completedAt,
          // если описания в запрос не влезли и ИИ его не написал — возвращаем старое
          description: l.description || old?.description || '',
        }
      }),
    }))
    .filter((b) => b.lessons.length > 0)
  if (!blocks.length) throw new Error('ИИ не вернул обновлённый план. Сформулируй пожелание конкретнее и попробуй ещё раз.')
  return blocks
}

// Краткая шпаргалка по реальной структуре ЕГЭ — чтобы модель не выдумывала «части» и номера заданий.
const EGE_FACTS = `
СТРУКТУРА ЕГЭ (запомни, НЕ путай):
- Русский язык: 27 заданий. 1–26 с кратким ответом (4 — ударения, 5 — паронимы, 9–15 — орфография, 16–21 — пунктуация, 22–26 — работа с текстом), 27 — сочинение. У русского НЕТ «базового/профильного» уровня и НЕТ деления «часть 1 = база, часть 2 = профиль».
- Математика: это ДВА разных экзамена — база (21 задание, только краткие ответы) и профиль (19 заданий: 1–12 краткие, 13–19 с развёрнутым решением).
- Информатика (КЕГЭ): 27 заданий, сдаётся на компьютере.
- По другим предметам: если не помнишь точную структуру или номер задания — НЕ называй конкретных номеров.
`.trim()

/** Чат-репетитор. studentCtx — краткая справка об ученике (предметы, баллы, цели), чтобы отвечать точнее. */
export async function tutorChat(cfg: AppConfig, messages: { role: string; content: string }[], studentCtx?: string): Promise<string> {
  if (useMock()) return 'Демо-ответ репетитора (в браузере ИИ выключен). В приложении здесь будет реальный ответ.'
  const resp = await groqRawRetry(cfg, {
    model: cfg.textModel,
    messages: [
      {
        role: 'system',
        content:
          'Ты — опытный репетитор по подготовке к ЕГЭ (Россия). Объясняешь по-русски, по шагам, конкретно и по делу.\n\n' +
          'ЧЕСТНОСТЬ — ГЛАВНОЕ ПРАВИЛО:\n' +
          '- НИКОГДА не выдумывай: правила языка, примеры слов, номера заданий, баллы, названия книг, ссылки.\n' +
          '- Приводи пример, только если на 100% уверен, что он верный. Сомневаешься — не приводи вовсе.\n' +
          '- Если не знаешь точно — прямо скажи «не уверен» и посоветуй проверить на ФИПИ или в учебнике.\n' +
          '- Лучше короткий точный ответ, чем длинный с ошибками. Никакой «воды» и дежурной мотивации.\n\n' +
          EGE_FACTS + '\n\n' +
          'КАК ОТВЕЧАТЬ:\n' +
          '- Разбор задания: сначала краткий алгоритм, потом пример решения.\n' +
          '- Практику советуй на реальных площадках: РешуЕГЭ/СдамГИА, открытый банк ФИПИ, для информатики — kompege.ru.\n' +
          '- Оформляй в Markdown: подзаголовки (##), списки (- ), жирный (**важное**). ' + MATH_RULE +
          (studentCtx ? `\n\nТвой ученик: ${studentCtx}. Учитывай его предметы и уровень.` : ''),
      },
      ...messages,
    ],
    temperature: 0.4,
    max_tokens: 2600,
    reasoning_format: 'hidden',
  })
  return cleanMath(resp?.choices?.[0]?.message?.content ?? '', true)
}

/**
 * «Дописать план»: ученик обычными словами говорит, что добавить, а наш ИИ генерирует
 * НОВЫЕ блоки/занятия строго по этой теме (не повторяя имеющиеся). Возвращает блоки для append.
 * Существующий план не трогаем — только дополняем.
 */
export async function extendPlan(cfg: AppConfig, plan: StudyPlan, wish: string, onProgress?: (m: string) => void): Promise<Block[]> {
  const add = wish.trim()
  if (!add) return []
  onProgress?.('ИИ дополняет план…')
  const startOrder = plan.blocks.length
  const idSet = new Set(SUBJECTS.map((s) => s.id))
  const fallbackSubject = plan.blocks[0]?.subjectId || SUBJECTS[0].id
  if (useMock()) {
    return mockBlocks(fallbackSubject, `Дополнение: ${add}`).map((b, i) => ({ ...b, order: startOrder + i }))
  }
  const covered = plan.blocks.map((b) => `${subjectName(b.subjectId)}: ${b.title}`).slice(0, 60).join('; ')
  const ids = SUBJECTS.map((s) => s.id)
  const data = await callJSON(cfg, {
    system:
      'Ты ДОПОЛНЯЕШЬ уже существующий план подготовки к ЕГЭ новыми занятиями по пожеланию ученика. ' +
      'НЕ повторяй уже имеющиеся темы. Практика = решать реальные задания по теме на РешуЕГЭ/ФИПИ (информатика — kompege.ru); формулируй конкретно, что и где решать. ' +
      'Добавляй и повторение (kind="review"). Названия занятий — уникальные и конкретные. Отвечай ТОЛЬКО валидным JSON. ' +
      MATH_RULE,
    user:
      `Сегодня: ${new Date().toISOString().slice(0, 10)}${plan.examDate ? `, экзамен: ${plan.examDate}` : ''}.\n` +
      `Уже есть блоки: ${covered || '(план пуст)'}\n\n` +
      `ПОЖЕЛАНИЕ УЧЕНИКА — что добавить: ${add}\n\n` +
      `Верни JSON ТОЛЬКО с НОВЫМИ блоками строго по этому пожеланию: ` +
      `{"blocks":[{"subjectId":"<id>","title":"тема","goal":"цель","lessons":[{"title":"название","kind":"theory|practice|review","description":"что делать"}]}]}. ` +
      `subjectId СТРОГО из: ${ids.join(', ')}. Сделай 1–4 блока по теме пожелания, по 3–6 коротких занятий в каждом.`,
    temperature: 0.4,
    maxTokens: 4000,
  })
  return ((data?.blocks || []) as any[])
    .filter((b) => b && (b.title || b.lessons))
    .map((b, i) => ({
      id: uid('blk_'),
      subjectId: idSet.has(b.subjectId) ? b.subjectId : fallbackSubject,
      title: cleanMath(String(b.title || `Дополнение ${i + 1}`)),
      goal: cleanMath(String(b.goal || '')),
      order: startOrder + i,
      lessons: coerceLessons(b.lessons || []),
    }))
    .filter((b) => b.lessons.length > 0)
}

// Демо-план для проверки интерфейса в браузере.
function mockBlocks(subjectId: string, name: string): Block[] {
  const mk = (title: string, order: number, lessons: [string, Lesson['kind'], string][]): Block => ({
    id: uid('blk_'),
    subjectId,
    title,
    goal: `Освоить тему «${title}».`,
    order,
    lessons: lessons.map(([t, k, d]) => ({ id: uid('les_'), title: t, kind: k, description: d, done: false })),
  })
  return [
    mk(`Основы: ${name}`, 0, [
      ['Теория базовых понятий', 'theory', 'Разбор ключевой теории.'],
      ['Практика на РешуЕГЭ', 'practice', 'Реши 15 заданий по теме на РешуЕГЭ.'],
      ['Повторение', 'review', 'Разбор ошибок недели.'],
    ]),
    mk(`Продвинутые темы: ${name}`, 1, [
      ['Теория', 'theory', 'Сложные темы блока.'],
      ['Практика', 'practice', 'Реши задания уровня выше на РешуЕГЭ/ФИПИ.'],
      ['Повторение', 'review', 'Прогон таблицы слабых мест.'],
    ]),
  ]
}
