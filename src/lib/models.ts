// Подбор самой умной модели, доступной на ключе Groq.
// Приоритет — качество русского языка и рассуждений (для репетитора это главное).

export interface ModelInfo {
  match: RegExp
  label: string
  hint: string
  score: number
}

// Паттерны учитывают имена всех провайдеров: Groq/OpenRouter ('openai/gpt-oss-120b', 'qwen/qwen3-32b')
// и Cerebras ('gpt-oss-120b', 'qwen-3-235b…', 'zai-glm-4.6' — без префиксов и с дефисами).
// Reasoning/code/vision-варианты уже отсеяны EXCLUDE — сюда попадают только обычные chat/instruct.
// Паттерны устойчивы к версиям (V3→V4, GLM-4→GLM-5, Qwen3→Qwen3.6) и к именам всех провайдеров.
const PRIORITY: ModelInfo[] = [
  { match: /deepseek.*(chat|v[3-9])/i, label: 'DeepSeek', hint: 'очень умная, отличный русский, быстрая', score: 98 },
  { match: /kimi-k2/i, label: 'Kimi K2', hint: 'умная, отлично знает русский', score: 96 },
  { match: /gpt-4\.[1-9](?!-mini|-nano)/i, label: 'GPT-4.1', hint: 'очень умная', score: 94 },
  { match: /gpt-4o(?!-mini)/i, label: 'GPT-4o', hint: 'очень умная', score: 91 },
  { match: /gpt-oss-120b/i, label: 'GPT-OSS 120B', hint: 'очень умная, сильная логика', score: 90 },
  { match: /glm-[5-9]/i, label: 'GLM-5', hint: 'умная, отличный русский', score: 89 },
  { match: /qwen[-.]?3[.-]?(235b|397b|122b)/i, label: 'Qwen3 (большая)', hint: 'большая и умная', score: 85 },
  { match: /nemotron.*ultra/i, label: 'Nemotron Ultra', hint: 'огромная и умная', score: 84 },
  { match: /llama-?3\.3-70b/i, label: 'Llama 3.3 70B', hint: 'умная универсальная', score: 80 },
  { match: /hermes-3-llama-3\.1-405b/i, label: 'Hermes 3 405B', hint: 'большая универсальная', score: 78 },
  { match: /glm-4-plus|glm-4\.[5-9]/i, label: 'GLM-4', hint: 'умная, хороший русский', score: 76 },
  { match: /gemini.*flash/i, label: 'Gemini Flash', hint: 'быстрая и толковая', score: 74 },
  { match: /qwen[-.]?3[.-]?next-80b/i, label: 'Qwen3 Next 80B', hint: 'новая и умная', score: 72 },
  { match: /qwen[-.]?3\.[5-9]/i, label: 'Qwen3', hint: 'новая и быстрая', score: 70 },
  { match: /gpt-4o-mini|gpt-4\.[1-9]-mini/i, label: 'GPT-4o mini', hint: 'быстрая и толковая', score: 68 },
  { match: /mistral-large|mixtral-8x22/i, label: 'Mistral Large', hint: 'умная универсальная', score: 66 },
  { match: /nemotron.*super/i, label: 'Nemotron Super', hint: 'умная и быстрая', score: 64 },
  { match: /gemma-[4-9]/i, label: 'Gemma', hint: 'толковая от Google', score: 62 },
  { match: /qwen[-.]?3[.-]?(32b|27b|35b)/i, label: 'Qwen3', hint: 'надёжная', score: 60 },
  { match: /glm-4-flash|glm-4-air/i, label: 'GLM-4 Flash', hint: 'бесплатная и шустрая', score: 56 },
  { match: /glm-4/i, label: 'GLM-4', hint: 'толковая, хороший русский', score: 54 },
  { match: /gpt-oss-20b/i, label: 'GPT-OSS 20B', hint: 'быстрая и толковая', score: 50 },
  { match: /phi-4/i, label: 'Phi-4', hint: 'компактная и толковая', score: 44 },
  { match: /llama-4-maverick/i, label: 'Llama 4 Maverick', hint: 'универсальная', score: 40 },
  { match: /llama-4-scout/i, label: 'Llama 4 Scout', hint: 'быстрая', score: 30 },
  { match: /llama-?3\.1-8b/i, label: 'Llama 3.1 8B', hint: 'очень быстрая, попроще', score: 20 },
]

// Модели, НЕ подходящие для быстрой генерации плана/чата:
// служебные (озвучка/эмбеддинги/модерация), кодовые, мультимодальные (vision/omni),
// и «думающие»/reasoning (медленные, часто отдают пустой content) — их автоподбор избегает.
const EXCLUDE = /whisper|tts|guard|embed|moderat|rerank|allam|compound|safety|audio|image|flux|ocr|code|\bvl\b|vision|glm-\dv|thinking|reasoning|qwq|deepseek-r1|distill|omni|preview/i

/** Плохая модель для нашей задачи (кодовая/vision/reasoning) — используется и для «перевыбрать». */
export function isBadModel(id: string): boolean {
  return EXCLUDE.test(id)
}

/** Только модели, пригодные для быстрого чата/текста. Для OpenRouter — только бесплатные (:free). */
export function chatModels(available: string[], provider?: string): string[] {
  const base = available.filter((id) => !EXCLUDE.test(id))
  if (provider === 'openrouter') return base.filter((id) => id.endsWith(':free'))
  return base
}

/** Насколько модель «умная» по нашей шкале (неизвестные — 10). Свежие ревизии чуть выше. */
export function modelScore(id: string): number {
  const p = PRIORITY.find((x) => x.match.test(id))
  if (!p) return 10
  return p.score + (/\d{4}|latest/i.test(id) ? 1 : 0)
}

/** Человеческое имя и подсказка для известных моделей. */
export function modelLabel(id: string): { label: string; hint: string } {
  const p = PRIORITY.find((x) => x.match.test(id))
  return p ? { label: p.label, hint: p.hint } : { label: id, hint: '' }
}

/** Самая умная из доступных (или null, если список пуст). */
export function pickBestModel(available: string[], provider?: string): string | null {
  const list = chatModels(available, provider)
  if (!list.length) return null
  return [...list].sort((a, b) => modelScore(b) - modelScore(a))[0]
}
