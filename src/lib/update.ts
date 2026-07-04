// Версия приложения и проверка обновлений через GitHub Releases.

import { isTauri } from './api'

// Публичный репозиторий проекта (owner/repo). Используется для проверки обновлений.
export const GITHUB_REPO = 'pepadarigard/nous'
export const GITHUB_URL = `https://github.com/${GITHUB_REPO}`
const FALLBACK_VERSION = '0.2.4'

export async function appVersion(): Promise<string> {
  if (isTauri) {
    try {
      const { getVersion } = await import('@tauri-apps/api/app')
      return await getVersion()
    } catch {
      /* fallback ниже */
    }
  }
  return FALLBACK_VERSION
}

// Сравнение версий вида "1.2.3" (можно с ведущей v): >0 если a новее b.
function cmpVer(a: string, b: string): number {
  const pa = a.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d !== 0) return d > 0 ? 1 : -1
  }
  return 0
}

export interface UpdateInfo {
  current: string
  latest: string
  newer: boolean
  url: string
}

export async function checkUpdate(): Promise<UpdateInfo> {
  const current = await appVersion()
  let text: string
  if (isTauri) {
    const { invoke } = await import('@tauri-apps/api/core')
    text = await invoke<string>('github_latest', { repo: GITHUB_REPO })
  } else {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
    })
    text = await res.text()
  }
  let json: any
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error('GitHub ответил непонятно. Попробуй позже.')
  }
  if (!json?.tag_name) {
    if (/not found/i.test(String(json?.message))) throw new Error('Релизов на GitHub пока нет.')
    throw new Error(json?.message || 'Не удалось получить информацию о релизах.')
  }
  const latest = String(json.tag_name)
  return {
    current,
    latest,
    newer: cmpVer(latest, current) > 0,
    url: String(json.html_url || `${GITHUB_URL}/releases/latest`),
  }
}
