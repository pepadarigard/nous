// Версия приложения и проверка обновлений через GitHub Releases.

import { isTauri } from './api'

// Публичный репозиторий проекта (owner/repo). Используется для проверки обновлений.
export const GITHUB_REPO = 'pepadarigard/nous'
export const GITHUB_URL = `https://github.com/${GITHUB_REPO}`
// В приложении версию отдаёт сам Tauri; в браузере берём ту, что вшита сборкой.
declare const __APP_VERSION__: string
const FALLBACK_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0'

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
  /** Что за файл ставить. null — в релизе нет установщика, обновляться руками. */
  asset: ReleaseAsset | null
  /** Описание релиза — что нового. */
  notes?: string
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
    asset: pickInstaller(json),
    notes: typeof json.body === 'string' ? json.body.trim() : undefined,
  }
}

/**
 * Установщик из релиза.
 *
 * Ищем именно .exe: в релизе рядом лежит и портативный zip, а его запуск ничего
 * не обновит. Если подходящего файла нет — обновиться на месте не выйдет,
 * и честнее отправить человека на страницу релиза руками.
 */
export interface ReleaseAsset {
  name: string
  url: string
  size: number
}

function pickInstaller(json: any): ReleaseAsset | null {
  const assets: any[] = Array.isArray(json?.assets) ? json.assets : []
  const exe = assets.find((a) => String(a?.name ?? '').toLowerCase().endsWith('.exe'))
  if (!exe?.browser_download_url) return null
  return { name: String(exe.name), url: String(exe.browser_download_url), size: Number(exe.size) || 0 }
}

/** Скачать установщик обновления. Возвращает путь к файлу на диске. */
export async function downloadUpdate(asset: ReleaseAsset): Promise<string> {
  if (!isTauri) throw new Error('Обновление ставится только в приложении.')
  const { invoke } = await import('@tauri-apps/api/core')
  return await invoke<string>('download_update', { url: asset.url, name: asset.name })
}

/**
 * Запустить установщик. Приложение при этом закрывается — иначе Windows не даст
 * переписать его файлы.
 *
 * Данные не теряются: план, прогресс и банк лежат в папке данных
 * (%APPDATA%\com.egeplan.desktop), а установщик работает только со своей.
 * Перед запуском всё равно делаем свежую копию состояния — на случай, если
 * обновление прервётся на середине.
 */
export async function installUpdate(path: string): Promise<void> {
  if (!isTauri) throw new Error('Обновление ставится только в приложении.')
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('run_installer', { path })
}
