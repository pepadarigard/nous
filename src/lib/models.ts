// Подбор самой умной модели, доступной на ключе Groq.
// Приоритет — качество русского языка и рассуждений (для репетитора это главное).

export interface ModelInfo {
  match: RegExp
  label: string
  hint: string
  score: number
}

const PRIORITY: ModelInfo[] = [
  { match: /^moonshotai\/kimi-k2/i, label: 'Kimi K2', hint: 'самая умная, отлично знает русский', score: 100 },
  { match: /^openai\/gpt-oss-120b/i, label: 'GPT-OSS 120B', hint: 'очень умная, сильная логика', score: 90 },
  { match: /^llama-3\.3-70b/i, label: 'Llama 3.3 70B', hint: 'умная универсальная', score: 80 },
  { match: /^qwen\/qwen3\.6/i, label: 'Qwen3.6', hint: 'новая и быстрая', score: 70 },
  { match: /^qwen\/qwen3-32b/i, label: 'Qwen3 32B', hint: 'надёжная', score: 60 },
  { match: /^openai\/gpt-oss-20b/i, label: 'GPT-OSS 20B', hint: 'быстрая и толковая', score: 50 },
  { match: /^meta-llama\/llama-4-maverick/i, label: 'Llama 4 Maverick', hint: 'универсальная', score: 40 },
  { match: /^meta-llama\/llama-4-scout/i, label: 'Llama 4 Scout', hint: 'быстрая', score: 30 },
  { match: /^llama-3\.1-8b/i, label: 'Llama 3.1 8B', hint: 'очень быстрая, попроще', score: 20 },
]

// Не-чатовые и служебные модели: озвучка, распознавание, модерация, эмбеддинги и т.п.
const EXCLUDE = /whisper|tts|guard|embed|moderat|allam|compound|safety|rerank/i

/** Только модели, пригодные для чата/текста. */
export function chatModels(available: string[]): string[] {
  return available.filter((id) => !EXCLUDE.test(id))
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
export function pickBestModel(available: string[]): string | null {
  const list = chatModels(available)
  if (!list.length) return null
  return [...list].sort((a, b) => modelScore(b) - modelScore(a))[0]
}
