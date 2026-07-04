// Слой доступа к платформе. Работает и в Tauri (боевое .exe), и в браузере (для разработки).
// В Tauri — вызовы Rust-команд; в браузере — localStorage + прямой fetch/файловый input.

import type { AppData, Provider } from '../types'
import { GITHUB_MODELS, OR_FALLBACK_MODELS, PROVIDERS, normProvider } from './providers'

export const isTauri =
  typeof window !== 'undefined' &&
  ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(cmd, args)
}

const STATE_KEY = 'ege_planner_state_v1'

/** Загрузить всё состояние приложения. */
export async function loadState(): Promise<AppData | null> {
  try {
    if (isTauri) {
      const s = await invoke<string | null>('load_state')
      return s ? (JSON.parse(s) as AppData) : null
    }
    const s = localStorage.getItem(STATE_KEY)
    return s ? (JSON.parse(s) as AppData) : null
  } catch (e) {
    console.error('loadState error', e)
    return null
  }
}

/** Сохранить всё состояние приложения. */
export async function saveState(data: AppData): Promise<void> {
  const json = JSON.stringify(data)
  if (isTauri) {
    await invoke('save_state', { data: json })
    return
  }
  localStorage.setItem(STATE_KEY, json)
}

export interface GroqBody {
  model: string
  messages: unknown[]
  temperature?: number
  max_tokens?: number
  response_format?: { type: string }
  reasoning_format?: string
  stream?: boolean
}

/** Подгонка тела под провайдера — общая для обычного и стримингового запросов. */
function prepPayload(prov: Provider, body: GroqBody): Record<string, unknown> {
  const payload: Record<string, unknown> = { ...body }
  if (prov !== 'groq') delete payload.reasoning_format // параметр только Groq — другие провайдеры его не знают
  // Гибридно-рассуждающие модели (DeepSeek V4, Qwen3, GLM) без этого флага сначала ДОЛГО
  // «думают» (reasoning_content) и только потом отвечают — чат ощущается зависшим.
  // Проверено живым запросом: с флагом первое слово приходит через ~1–2 секунды.
  if (prov === 'siliconflow') payload.enable_thinking = false
  if (prov === 'zhipu') payload.thinking = { type: 'disabled' }
  if (prov === 'openrouter') {
    // Бесплатные модели часто перегружены (429 upstream) — даём OpenRouter цепочку запасных,
    // он сам переключится. Формат: массив `models` ВМЕСТО одиночного `model`.
    // ВАЖНО: OpenRouter принимает МАКСИМУМ 3 модели в массиве (больше → ошибка 400).
    const chain = [body.model, ...OR_FALLBACK_MODELS.filter((m) => m !== body.model)].slice(0, 3)
    payload.models = chain
    delete payload.model
  }
  return payload
}

/**
 * Низкоуровневый запрос к провайдеру ИИ (OpenAI-совместимый chat/completions).
 * В Tauri идёт через Rust (без CORS). В браузере — прямой fetch.
 */
export async function groqRaw(apiKey: string, body: GroqBody, provider: Provider = 'groq'): Promise<any> {
  const prov = normProvider(provider)
  const p = PROVIDERS[prov]
  const payload = prepPayload(prov, body)
  delete payload.stream // этот путь всегда без стрима — иначе в ответ приедет SSE вместо JSON
  const bodyStr = JSON.stringify(payload)
  let text: string
  if (isTauri) {
    text = await invoke<string>('llm_request', { apiKey, body: bodyStr, base: p.base })
  } else {
    const res = await fetch(`${p.base}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-Title': 'Nous',
      },
      body: bodyStr,
    })
    text = await res.text()
    if (!res.ok && !text.trim().startsWith('{')) throw new Error(`${p.name} HTTP ${res.status}: ${text.slice(0, 300)}`)
  }
  let parsed: any
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(`${p.name} вернул не-JSON: ${text.slice(0, 200)}`)
  }
  if (typeof parsed === 'string') {
    // голая строка вместо JSON-объекта = сообщение об ошибке ("Api key is invalid" и т.п.)
    throw new Error(`${p.name}: ${parsed}`)
  }
  if (parsed?.error) {
    throw new Error(parsed.error.message || parsed.error || `Ошибка ${p.name} API`)
  }
  if (!Array.isArray(parsed?.choices)) {
    // нет choices — модель не ответила (плохой ключ, недоступная модель); не отдаём «пустоту»
    throw new Error(String(parsed?.message || parsed?.detail || `${p.name} не вернул ответ — проверь ключ и модель`))
  }
  return parsed
}

/**
 * Стриминговый запрос: onChunk получает куски текста ПО МЕРЕ генерации — ответ виден сразу.
 * В Tauri — SSE через Rust; в браузере стрима нет, обычный запрос одним куском (для разработки).
 * Возвращает полный собранный текст.
 */
export async function llmStream(
  apiKey: string,
  body: GroqBody,
  provider: Provider,
  onChunk: (s: string) => void,
): Promise<string> {
  const prov = normProvider(provider)
  const p = PROVIDERS[prov]
  if (isTauri) {
    const core = await import('@tauri-apps/api/core')
    const ch = new core.Channel<string>()
    ch.onmessage = (s) => onChunk(s)
    const payload = prepPayload(prov, { ...body, stream: true })
    return await core.invoke<string>('llm_stream', {
      apiKey,
      body: JSON.stringify(payload),
      base: p.base,
      onChunk: ch,
    })
  }
  const noStream = { ...body }
  delete noStream.stream
  const resp = await groqRaw(apiKey, noStream, prov)
  const text: string = resp?.choices?.[0]?.message?.content ?? ''
  if (text) onChunk(text)
  return text
}

/** GET с авторизацией к провайдеру (список моделей, проверка ключа). Возвращает распарсенный JSON. */
async function authGet(apiKey: string, url: string): Promise<any> {
  let text: string
  if (isTauri) {
    text = await invoke<string>('llm_get', { apiKey, url })
  } else {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } })
    text = await res.text()
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`Сервис вернул не-JSON: ${text.slice(0, 200)}`)
  }
}

/** Проверка ключа провайдера + список моделей. */
export async function checkApiKey(apiKey: string, provider: Provider = 'groq'): Promise<{ ok: boolean; error?: string; models?: string[] }> {
  const prov = normProvider(provider)
  const p = PROVIDERS[prov]
  try {
    if (prov === 'github') {
      // У GitHub Models нет обычного /models — проверяем ключ микро-запросом дешёвой модели.
      const r = await groqRaw(apiKey, { model: 'openai/gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 }, 'github')
      if (r?.choices) return { ok: true, models: GITHUB_MODELS }
      return { ok: false, error: 'Неожиданный ответ GitHub Models' }
    }
    if (prov === 'openrouter') {
      // /models у OpenRouter публичный (список вернём в любом случае), а ключ проверяем отдельным эндпоинтом.
      const models = await authGet(apiKey, `${p.base}/models`)
        .then((r) => ((r?.data || []) as any[]).map((m: any) => m.id))
        .catch(() => [] as string[])
      const auth = await authGet(apiKey, `${p.base}/auth/key`)
      if (auth?.error) return { ok: false, error: auth.error.message || 'Ключ не подошёл', models }
      return { ok: true, models }
    }
    const parsed = await authGet(apiKey, `${p.base}/models`)
    if (parsed?.error) return { ok: false, error: parsed.error.message || 'Ошибка' }
    // На плохой ключ сервис может ответить голой строкой ("Api key is invalid") или объектом
    // без массива data — это НЕ успех, иначе показывали бы «Рабочий. Моделей: 0».
    if (!Array.isArray(parsed?.data)) {
      const msg = typeof parsed === 'string' ? parsed : parsed?.message || 'Сервис не вернул список моделей — проверь ключ'
      return { ok: false, error: String(msg) }
    }
    const ids = parsed.data.map((m: any) => m.id).filter(Boolean)
    if (ids.length === 0) return { ok: false, error: 'Список моделей пуст — возможно, ключ без доступа к моделям' }
    return { ok: true, models: ids }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Сеть недоступна' }
  }
}

/** Уникальный id без внешних зависимостей. */
export function uid(prefix = ''): string {
  return prefix + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
}

/** Переводит технические ошибки (Rust/Groq/fetch, по-английски) в понятный русский. */
export function humanError(e: unknown): string {
  const m = String((e as any)?.message ?? e ?? '')
  const low = m.toLowerCase()
  if (/invalid api key|401|unauthorized|invalid_api_key/.test(low)) return 'Неверный API-ключ. Проверь его в Настройках.'
  if (/rate limit|429|too many|rate-limited/.test(low)) return 'Модели ИИ сейчас перегружены или лимит запросов исчерпан — подожди 20–30 секунд и попробуй ещё раз.'
  if (/timed? ?out|timeout/.test(low)) return 'Сервер не ответил вовремя. Проверь интернет и попробуй ещё раз.'
  if (/error sending request|dns|connect|network|failed to fetch|отправки запроса/.test(low))
    return 'Нет соединения с сервером ИИ. Если ты в России и без VPN — переключи провайдера на OpenRouter в Настройках (он работает без VPN).'
  if (/413|too large|context length|maximum context/.test(low)) return 'Запрос слишком длинный для модели.'
  return m || 'Неизвестная ошибка.'
}

/** Открыть ссылку во внешнем браузере (Tauri) или новой вкладке (браузер). */
export async function openExternal(url: string): Promise<void> {
  if (isTauri) {
    try {
      const { openUrl } = await import('@tauri-apps/plugin-opener')
      await openUrl(url)
      return
    } catch (e) {
      console.error('openExternal', e)
    }
  }
  window.open(url, '_blank')
}
