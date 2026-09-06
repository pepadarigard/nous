// Три вещи, которые умеет только ИИ и не умеет офлайн-часть приложения:
//  1) проверить развёрнутый ответ по критериям (checkSolution);
//  2) подготовить теорию и задания прямо к занятию (lessonBrief) — результат сохраняется
//     в занятие, поэтому дальше открывается без сети;
//  3) разобрать неделю по РЕАЛЬНЫМ цифрам и посоветовать, что менять (weeklyAdvice).
//
// Везде действует правило приложения: ИИ — усилитель, а не условие работы. Если ключа нет,
// сеть лежит или модель ответила мусором — интерфейс должен продолжать работать без него.

import type { AppConfig, CriterionScore, LessonBrief, SolutionReview } from '../types'
import { callJSON, cleanMath, isMock } from './ai'
import { subjectName } from '../data/subjects'
import { egeSpec } from '../data/ege2027'
import { EGE_TASKS } from '../data/egeTasks'

const HONESTY =
  'ЧЕСТНОСТЬ ВАЖНЕЕ ПОЛНОТЫ: не выдумывай баллы, критерии, правила и примеры. ' +
  'Если точных критериев не знаешь — поставь "uncertain": true и честно скажи об этом в "advice". ' +
  'Лучше короткий точный разбор, чем длинный с выдумками. Никакой дежурной похвалы.'

function taskTitle(subjectId: string, taskNo?: number): string {
  if (!taskNo) return ''
  return EGE_TASKS[subjectId]?.find((t) => t.no === taskNo)?.title ?? ''
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

// ---------- 1. Проверка развёрнутого ответа ----------

export interface CheckInput {
  subjectId: string
  taskNo?: number
  task: string // условие задания
  solution: string // ответ ученика
  criteria?: string // критерии из материалов ученика, если он их дал
}

/** Проверить развёрнутый ответ по критериям и выставить баллы по пунктам. */
export async function checkSolution(cfg: AppConfig, input: CheckInput): Promise<SolutionReview> {
  if (isMock()) {
    return {
      score: 2,
      max: 3,
      criteria: [
        { name: 'К1. Демонстрационный критерий', got: 2, max: 3, comment: 'В браузере ИИ выключен — это демо-разбор.' },
      ],
      errors: ['Это демо-ответ, реальная проверка идёт в приложении.'],
      strengths: [],
      advice: 'Запусти приложение, чтобы получить настоящий разбор.',
      at: new Date().toISOString(),
    }
  }

  const title = taskTitle(input.subjectId, input.taskNo)
  const system =
    'Ты — эксперт предметной комиссии ЕГЭ по предмету «' + subjectName(input.subjectId) + '». ' +
    'Проверяешь развёрнутый ответ ученика строго по официальным критериям ФИПИ и выставляешь баллы по каждому критерию.\n\n' +
    HONESTY + '\n\n' +
    'Отвечай ТОЛЬКО JSON без пояснений вокруг:\n' +
    '{"score": число, "max": число, "uncertain": true|false, ' +
    '"criteria": [{"name": "К1. Название критерия", "got": число, "max": число, "comment": "за что снял или почему полный балл"}], ' +
    '"errors": ["конкретная ошибка с цитатой из ответа"], ' +
    '"strengths": ["что реально удалось"], ' +
    '"advice": "что сделать, чтобы в следующий раз получить полный балл"}\n' +
    'Комментарии — по-русски, конкретные, с опорой на текст ученика. Пиши без LaTeX.'

  const user =
    'ПРЕДМЕТ: ' + subjectName(input.subjectId) + '\n' +
    (input.taskNo ? 'ЗАДАНИЕ № ' + input.taskNo + (title ? ' (' + title + ')' : '') + '\n' : '') +
    (input.criteria ? '\nКРИТЕРИИ (из материалов ученика, опирайся в первую очередь на них):\n' + input.criteria.slice(0, 4000) + '\n' : '') +
    '\nУСЛОВИЕ ЗАДАНИЯ:\n' + (input.task.trim() || '(ученик не привёл условие — оценивай по тексту ответа)') +
    '\n\nОТВЕТ УЧЕНИКА:\n' + input.solution.trim()

  const raw = await callJSON(cfg, { system, user, temperature: 0.2, maxTokens: 2200 })
  const criteria: CriterionScore[] = Array.isArray(raw?.criteria)
    ? raw.criteria.map((c: any) => ({
        name: cleanMath(String(c?.name ?? 'Критерий')),
        got: num(c?.got),
        max: num(c?.max, 1),
        comment: cleanMath(String(c?.comment ?? '')),
      }))
    : []
  const score = raw?.score !== undefined ? num(raw.score) : criteria.reduce((n, c) => n + c.got, 0)
  const max = raw?.max !== undefined ? num(raw.max, 1) : criteria.reduce((n, c) => n + c.max, 0)

  return {
    score,
    max: max || 1,
    criteria,
    errors: (Array.isArray(raw?.errors) ? raw.errors : []).map((x: any) => cleanMath(String(x))).filter(Boolean),
    strengths: (Array.isArray(raw?.strengths) ? raw.strengths : []).map((x: any) => cleanMath(String(x))).filter(Boolean),
    advice: cleanMath(String(raw?.advice ?? '')),
    uncertain: !!raw?.uncertain,
    at: new Date().toISOString(),
    model: cfg.textModel,
  }
}

/** Найти в тексте материала кусок с критериями оценивания — чтобы проверка шла по ним. */
export function findCriteria(text: string, taskNo?: number): string | undefined {
  const low = text.toLowerCase()
  let idx = low.indexOf('критерии оценивания')
  if (idx < 0) idx = low.indexOf('критерии проверки')
  if (idx < 0) return undefined
  const chunk = text.slice(idx, idx + 6000)
  if (!taskNo) return chunk
  // Если критериев несколько, пробуем взять кусок вокруг нужного номера задания.
  const marker = new RegExp('задани[ея][^\\n]{0,20}' + taskNo + '\\b', 'i')
  const m = chunk.match(marker)
  return m && m.index !== undefined ? chunk.slice(Math.max(0, m.index - 500)) : chunk
}

// ---------- 2. Занятие с теорией и заданиями ----------

export interface BriefInput {
  subjectId: string
  lessonTitle: string
  lessonDescription?: string
  blockTitle?: string
  taskNo?: number
  materialText?: string // выдержка из своих материалов, если они привязаны к занятию
}

/** Подготовить к занятию краткую теорию и несколько заданий с ответами. */
export async function lessonBrief(cfg: AppConfig, input: BriefInput): Promise<LessonBrief> {
  if (isMock()) {
    return {
      theory: '## Демо-теория\n\nВ браузере ИИ выключен — в приложении здесь будет разбор темы занятия.',
      tasks: [{ text: 'Демо-задание: проверь, что карточка занятия открывается.', answer: 'ок' }],
      createdAt: new Date().toISOString(),
    }
  }

  const spec = egeSpec(input.subjectId)
  const system =
    'Ты — репетитор по подготовке к ЕГЭ. Готовишь материал ровно к ОДНОМУ занятию: коротко объясняешь тему ' +
    'и даёшь задания на отработку. Пишешь по-русски, без воды и без мотивационных вступлений.\n\n' +
    HONESTY + '\n' +
    'Математику пиши обычным текстом (√, π, ², ≤, a/b), НЕ используй LaTeX.\n\n' +
    'Отвечай ТОЛЬКО JSON:\n' +
    '{"theory": "разбор темы в markdown: суть, правило, порядок действий, типовые ловушки — до 350 слов", ' +
    '"tasks": [{"text": "условие задания", "answer": "точный краткий ответ"}]}\n' +
    'Заданий — 4 штуки, от простого к сложному, в формате настоящего ЕГЭ. ' +
    'Ответ должен быть однозначным и коротким; если для задания однозначного ответа не бывает — не давай такое задание.'

  const user =
    'ПРЕДМЕТ: ' + subjectName(input.subjectId) + '\n' +
    (input.blockTitle ? 'БЛОК ПЛАНА: ' + input.blockTitle + '\n' : '') +
    'ЗАНЯТИЕ: ' + input.lessonTitle + '\n' +
    (input.lessonDescription ? 'ЧТО НАДО СДЕЛАТЬ: ' + input.lessonDescription + '\n' : '') +
    (input.taskNo ? 'НОМЕР ЗАДАНИЯ ЕГЭ: ' + input.taskNo + '\n' : '') +
    (spec ? '\nСТРУКТУРА ЭКЗАМЕНА (опора, не пересказывай её ученику):\n' + spec + '\n' : '') +
    (input.materialText
      ? '\nВЫДЕРЖКА ИЗ МАТЕРИАЛОВ УЧЕНИКА (опирайся на неё, если она по теме):\n' + input.materialText.slice(0, 3000)
      : '')

  const raw = await callJSON(cfg, { system, user, temperature: 0.35, maxTokens: 2600 })
  const tasks = (Array.isArray(raw?.tasks) ? raw.tasks : [])
    .map((t: any) => ({ text: cleanMath(String(t?.text ?? '')), answer: t?.answer ? cleanMath(String(t.answer)) : undefined }))
    .filter((t: { text: string }) => t.text.trim())

  return {
    theory: cleanMath(String(raw?.theory ?? ''), true),
    tasks,
    createdAt: new Date().toISOString(),
    model: cfg.textModel,
  }
}

// ---------- 3. Разбор недели ----------

export interface WeekFacts {
  doneWeek: number
  plannedWeek: number
  overdue: number
  streak: number
  daysLeft?: number
  weak: { subjectId: string; taskNo?: number; pct: number; total: number }[]
  subjects: { subjectId: string; current: number; target: number }[]
}

export interface WeekAdvice {
  verdict: string // 2–4 предложения по существу
  focus: string[] // на чём сосредоточиться на следующей неделе
  wish?: string // готовая формулировка для «дописать план»
}

/**
 * Разбор недели: цифры считаются ОФЛАЙН и передаются как факты, ИИ только интерпретирует.
 * Так он не может «придумать» прогресс, которого не было.
 */
export async function weeklyAdvice(cfg: AppConfig, facts: WeekFacts): Promise<WeekAdvice> {
  if (isMock()) {
    return {
      verdict: 'Демо-разбор: в браузере ИИ выключен.',
      focus: ['Проверь работу разбора в приложении'],
    }
  }
  const weakText = facts.weak.length
    ? facts.weak.map((w) => subjectName(w.subjectId) + ' задание № ' + (w.taskNo ?? '?') + ' — ' + w.pct + '% из ' + w.total + ' попыток').join('; ')
    : 'данных тренажёра пока нет'

  const system =
    'Ты — наставник ученика, который готовится к ЕГЭ. Тебе дают ТОЧНЫЕ цифры за неделю. ' +
    'Твоя задача — коротко и честно сказать, как обстоят дела, и назвать 2–3 конкретных приоритета на следующую неделю.\n\n' +
    'ЗАПРЕЩЕНО: хвалить без повода, придумывать цифры, которых нет, лить воду и мотивационные лозунги. ' +
    'Если неделя провалена — скажи прямо, но по-человечески и с конкретным выходом.\n\n' +
    'Отвечай ТОЛЬКО JSON: {"verdict": "2–4 предложения", "focus": ["приоритет", "приоритет"], ' +
    '"wish": "одна фраза для дополнения плана, например: больше практики по заданию 12 и повторение пунктуации"}'

  const user =
    'ФАКТЫ ЗА НЕДЕЛЮ (все цифры настоящие):\n' +
    '- выполнено занятий: ' + facts.doneWeek + ' из ' + facts.plannedWeek + '\n' +
    '- просрочено занятий: ' + facts.overdue + '\n' +
    '- серия дней подряд: ' + facts.streak + '\n' +
    (facts.daysLeft !== undefined ? '- дней до экзамена: ' + facts.daysLeft + '\n' : '') +
    '- слабые места по тренажёру: ' + weakText + '\n' +
    '- предметы и цели: ' + facts.subjects.map((s) => subjectName(s.subjectId) + ' сейчас ~' + s.current + ', цель ' + s.target).join('; ')

  const raw = await callJSON(cfg, { system, user, temperature: 0.35, maxTokens: 900 })
  return {
    verdict: cleanMath(String(raw?.verdict ?? ''), true),
    focus: (Array.isArray(raw?.focus) ? raw.focus : []).map((x: any) => cleanMath(String(x))).filter(Boolean),
    wish: raw?.wish ? cleanMath(String(raw.wish)) : undefined,
  }
}
