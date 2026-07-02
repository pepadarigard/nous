// Слой доступа к платформе. Работает и в Tauri (боевое .exe), и в браузере (для разработки).
// В Tauri — вызовы Rust-команд; в браузере — localStorage + прямой fetch/файловый input.

import type { AppData } from '../types'

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
}

/**
 * Низкоуровневый запрос к Groq. Возвращает распарсенный JSON-ответ Groq целиком.
 * В Tauri идёт через Rust (без CORS, ключ на стороне Rust). В браузере — прямой fetch.
 */
export async function groqRaw(apiKey: string, body: GroqBody): Promise<any> {
  const bodyStr = JSON.stringify(body)
  let text: string
  if (isTauri) {
    text = await invoke<string>('groq_request', { apiKey, body: bodyStr })
  } else {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: bodyStr,
    })
    text = await res.text()
    if (!res.ok) throw new Error(`Groq HTTP ${res.status}: ${text.slice(0, 300)}`)
  }
  let parsed: any
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(`Groq вернул не-JSON: ${text.slice(0, 200)}`)
  }
  if (parsed?.error) {
    throw new Error(parsed.error.message || 'Ошибка Groq API')
  }
  return parsed
}

/** Проверка ключа: делает лёгкий запрос к списку моделей. */
export async function checkApiKey(apiKey: string): Promise<{ ok: boolean; error?: string; models?: string[] }> {
  try {
    if (isTauri) {
      const text = await invoke<string>('groq_models', { apiKey })
      const parsed = JSON.parse(text)
      if (parsed?.error) return { ok: false, error: parsed.error.message }
      return { ok: true, models: (parsed.data || []).map((m: any) => m.id) }
    }
    const res = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    const parsed = await res.json()
    if (!res.ok) return { ok: false, error: parsed?.error?.message || `HTTP ${res.status}` }
    return { ok: true, models: (parsed.data || []).map((m: any) => m.id) }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Сеть недоступна' }
  }
}

export interface PickedFile {
  name: string
  bytes: Uint8Array
}

/** Выбор файлов пользователем (материалы для разбора). */
export async function pickFiles(): Promise<PickedFile[]> {
  if (isTauri) {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const sel = await open({
      multiple: true,
      filters: [
        { name: 'Материалы', extensions: ['pdf', 'docx', 'png', 'jpg', 'jpeg', 'webp', 'txt', 'md'] },
      ],
    })
    if (!sel) return []
    const paths = Array.isArray(sel) ? sel : [sel]
    const out: PickedFile[] = []
    for (const p of paths) {
      const b64 = await invoke<string>('read_file_bytes', { path: p })
      out.push({ name: (p as string).split(/[\\/]/).pop() || (p as string), bytes: b64ToBytes(b64) })
    }
    return out
  }
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.accept = '.pdf,.docx,.png,.jpg,.jpeg,.webp,.txt,.md'
    input.onchange = async () => {
      const files = Array.from(input.files || [])
      const out: PickedFile[] = []
      for (const f of files) out.push({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })
      resolve(out)
    }
    input.click()
  })
}

/** Уникальный id без внешних зависимостей. */
export function uid(prefix = ''): string {
  return prefix + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
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
