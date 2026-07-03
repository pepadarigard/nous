import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { checkApiKey, humanError, isTauri, openExternal, saveState } from '../lib/api'
import { appVersion, checkUpdate, GITHUB_URL, type UpdateInfo } from '../lib/update'
import { subjectName } from '../data/subjects'
import type { AppData } from '../types'
import Modal from '../ui/Modal'
import PlanImporter from './PlanImporter'
import PlanExtender from './PlanExtender'
import { KeyRound, RefreshCw, AlertTriangle, Wand2, Download, Upload, ExternalLink, FolderOpen } from 'lucide-react'

export default function Settings() {
  const data = useStore((s) => s.data)
  const setConfig = useStore((s) => s.setConfig)
  const resetAll = useStore((s) => s.resetAll)

  const [apiKey, setApiKey] = useState(data.config.apiKey)
  const [textModel, setTextModel] = useState(data.config.textModel)
  const showEstimate = data.config.showEstimate !== false
  const soundOn = data.config.soundOn !== false
  const [checking, setChecking] = useState(false)
  const [checkMsg, setCheckMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [saved, setSaved] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [refineOpen, setRefineOpen] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)

  // Данные: экспорт/импорт
  const fileRef = useRef<HTMLInputElement>(null)
  const [exportMsg, setExportMsg] = useState<{ ok: boolean; text: string; path?: string } | null>(null)
  const [importData, setImportData] = useState<AppData | null>(null)
  const [importErr, setImportErr] = useState('')

  // О приложении: версия и обновления
  const [version, setVersion] = useState('')
  const [updBusy, setUpdBusy] = useState(false)
  const [updMsg, setUpdMsg] = useState<{ info?: UpdateInfo; error?: string } | null>(null)

  useEffect(() => {
    appVersion().then(setVersion)
  }, [])

  function save() {
    setConfig({ apiKey, textModel })
    setSaved(true)
    setTimeout(() => setSaved(false), 1600)
  }
  async function check() {
    setChecking(true)
    setCheckMsg(null)
    const r = await checkApiKey(apiKey)
    setChecking(false)
    setCheckMsg(r.ok ? { ok: true, text: `Рабочий. Моделей: ${r.models?.length ?? '?'}` } : { ok: false, text: humanError(r.error || 'Ошибка') })
  }

  async function doExport() {
    setExportMsg(null)
    const json = JSON.stringify(data, null, 2)
    const name = `nous-backup-${new Date().toISOString().slice(0, 10)}.json`
    try {
      if (isTauri) {
        const { invoke } = await import('@tauri-apps/api/core')
        const path = await invoke<string>('export_state', { data: json, fileName: name })
        setExportMsg({ ok: true, text: `Сохранено в Загрузки: ${name}`, path })
      } else {
        const blob = new Blob([json], { type: 'application/json' })
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = name
        a.click()
        URL.revokeObjectURL(a.href)
        setExportMsg({ ok: true, text: `Файл ${name} скачан.` })
      }
    } catch (e) {
      setExportMsg({ ok: false, text: 'Не получилось: ' + humanError(e) })
    }
  }

  async function revealExport() {
    if (!exportMsg?.path) return
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('reveal_path', { path: exportMsg.path })
    } catch {
      /* не критично */
    }
  }

  async function onImportFile(f: File | undefined) {
    setImportErr('')
    if (!f) return
    try {
      const parsed = JSON.parse(await f.text())
      if (!parsed || typeof parsed !== 'object' || !parsed.config) throw new Error('bad')
      setImportData(parsed as AppData)
    } catch {
      setImportErr('Это не похоже на бэкап Nous — нужен JSON-файл, созданный кнопкой «Экспорт».')
    }
    if (fileRef.current) fileRef.current.value = ''
  }

  async function applyImport() {
    if (!importData) return
    await saveState(importData)
    window.location.reload()
  }

  async function doCheckUpdate() {
    setUpdBusy(true)
    setUpdMsg(null)
    try {
      const info = await checkUpdate()
      setUpdMsg({ info })
    } catch (e) {
      setUpdMsg({ error: humanError(e) })
    }
    setUpdBusy(false)
  }

  return (
    <div className="fade-in" style={{ maxWidth: 720 }}>
      <div className="page-head">
        <h1>Настройки</h1>
        <p>Ключ, модель ИИ и обновление плана.</p>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <h3><KeyRound size={16} style={{ verticalAlign: -2, marginRight: 6 }} />ИИ (Groq)</h3>
        <label className="field">
          <span>API-ключ</span>
          <input className="input" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="gsk_..." />
        </label>
        <label className="field">
          <span>Модель</span>
          <select className="select" value={textModel} onChange={(e) => setTextModel(e.target.value)}>
            <option value="qwen/qwen3-32b">Qwen3 32B — умная и надёжная (рекомендуется)</option>
            <option value="qwen/qwen3.6-27b">Qwen3.6 27B — новее, быстрее</option>
          </select>
        </label>
        <div className="row">
          <button className="btn btn-primary" onClick={save}>{saved ? 'Сохранено ✓' : 'Сохранить'}</button>
          <button className="btn btn-ghost" onClick={check} disabled={!apiKey || checking}>{checking ? 'Проверяю…' : 'Проверить ключ'}</button>
          {checkMsg && <span className="small" style={{ color: checkMsg.ok ? 'var(--success)' : 'var(--danger)' }}>{checkMsg.ok ? '✓ ' : '✕ '}{checkMsg.text}</span>}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <h3>Прогресс</h3>
        <div className="toggle-row">
          <div>
            <div><b>Приблизительный балл</b></div>
            <div className="small muted" style={{ marginTop: 3 }}>
              Показывать на «Прогрессе» примерный балл по каждому предмету. Считается честно: стартовый балл + доля пройденного плана до цели. Это ориентир, а не гарантия ЕГЭ.
            </div>
          </div>
          <button
            className={'switch ' + (showEstimate ? 'on' : '')}
            role="switch"
            aria-checked={showEstimate}
            aria-label="Приблизительный балл"
            onClick={() => setConfig({ showEstimate: !showEstimate })}
          >
            <span />
          </button>
        </div>
        <div className="toggle-row" style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
          <div>
            <div><b>Звук уровней и достижений</b></div>
            <div className="small muted" style={{ marginTop: 3 }}>
              Короткий приятный сигнал, когда берёшь новый уровень или получаешь достижение. Конфетти останется в любом случае 🎉
            </div>
          </div>
          <button
            className={'switch ' + (soundOn ? 'on' : '')}
            role="switch"
            aria-checked={soundOn}
            aria-label="Звук уровней и достижений"
            onClick={() => setConfig({ soundOn: !soundOn })}
          >
            <span />
          </button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <h3>План</h3>
        <p className="small muted" style={{ marginTop: 0 }}>
          Сейчас в плане: {data.subjects.map(subjectName).join(', ') || '—'}
          {data.examDate ? ` · экзамен ${new Date(data.examDate).toLocaleDateString('ru-RU')}` : ''}
        </p>
        <div className="row wrap" style={{ gap: 10 }}>
          <button className="btn" onClick={() => setImportOpen(true)}><RefreshCw size={15} /> Обновить план (с нуля)</button>
          <button className="btn" onClick={() => setRefineOpen(true)}><Wand2 size={15} /> Дописать план</button>
        </div>
        <p className="small muted" style={{ marginBottom: 0, marginTop: 10 }}>
          «Дописать план» — добавить свои пожелания обычными словами к уже готовому плану.
        </p>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <h3>Данные</h3>
        <p className="small muted" style={{ marginTop: 0 }}>
          Бэкап одним файлом: план, прогресс, достижения и настройки. Пригодится при переустановке или переносе на другой ПК.
        </p>
        <div className="row wrap" style={{ gap: 10 }}>
          <button className="btn" onClick={doExport}><Download size={15} /> Экспорт данных</button>
          <button className="btn" onClick={() => fileRef.current?.click()}><Upload size={15} /> Импорт из файла</button>
          <input ref={fileRef} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={(e) => onImportFile(e.target.files?.[0])} />
        </div>
        {exportMsg && (
          <div className="row" style={{ marginTop: 10, gap: 10 }}>
            <span className="small" style={{ color: exportMsg.ok ? 'var(--success)' : 'var(--danger)' }}>{exportMsg.ok ? '✓ ' : '✕ '}{exportMsg.text}</span>
            {exportMsg.path && (
              <button className="btn btn-ghost btn-sm" onClick={revealExport}><FolderOpen size={14} /> Показать в папке</button>
            )}
          </div>
        )}
        {importErr && <p className="small" style={{ color: 'var(--danger)', marginBottom: 0 }}>{importErr}</p>}
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <h3>О приложении</h3>
        <p className="small muted" style={{ marginTop: 0 }}>
          Nous {version ? `v${version}` : ''} — локальный помощник для подготовки к ЕГЭ.
        </p>
        <div className="row wrap" style={{ gap: 10 }}>
          <button className="btn" onClick={doCheckUpdate} disabled={updBusy}>
            <RefreshCw size={15} /> {updBusy ? 'Проверяю…' : 'Проверить обновления'}
          </button>
          <button className="btn btn-ghost" onClick={() => openExternal(GITHUB_URL)}><ExternalLink size={15} /> Страница проекта</button>
        </div>
        {updMsg?.error && <p className="small" style={{ color: 'var(--danger)', marginBottom: 0 }}>{updMsg.error}</p>}
        {updMsg?.info && (
          <div className="row" style={{ marginTop: 10, gap: 10 }}>
            {updMsg.info.newer ? (
              <>
                <span className="small" style={{ color: 'var(--accent-text)' }}>🎉 Доступна новая версия {updMsg.info.latest} (у тебя v{updMsg.info.current})</span>
                <button className="btn btn-primary btn-sm" onClick={() => openExternal(updMsg.info!.url)}>Скачать</button>
              </>
            ) : (
              <span className="small" style={{ color: 'var(--success)' }}>✓ У тебя последняя версия ({updMsg.info.current})</span>
            )}
          </div>
        )}
      </div>

      <div className="card" style={{ borderColor: '#f3caca' }}>
        <h3 style={{ color: 'var(--danger)' }}><AlertTriangle size={16} style={{ verticalAlign: -2, marginRight: 6 }} />Опасная зона</h3>
        <p className="small muted" style={{ marginTop: 0 }}>Полный сброс удалит план, прогресс и настройки. Пройдёшь всё заново.</p>
        <button className="btn btn-danger" onClick={() => setConfirmReset(true)}>Начать всё заново</button>
      </div>

      {importOpen && (
        <Modal title="Обновить план" onClose={() => setImportOpen(false)} wide>
          <PlanImporter onDone={() => setImportOpen(false)} />
        </Modal>
      )}
      {refineOpen && (
        <Modal title="Дописать план" onClose={() => setRefineOpen(false)}>
          <PlanExtender onDone={() => setRefineOpen(false)} />
        </Modal>
      )}
      {confirmReset && (
        <Modal title="Точно всё сбросить?" onClose={() => setConfirmReset(false)}>
          <p className="muted">Это действие необратимо. Все данные приложения будут удалены.</p>
          <div className="row">
            <div className="spacer" />
            <button className="btn btn-ghost" onClick={() => setConfirmReset(false)}>Отмена</button>
            <button className="btn btn-danger" onClick={resetAll}>Да, сбросить</button>
          </div>
        </Modal>
      )}
      {importData && (
        <Modal title="Импортировать данные?" onClose={() => setImportData(null)}>
          <p className="muted">
            Текущие план, прогресс и настройки будут <b>заменены</b> данными из файла
            {importData.studentName ? <> (ученик: <b>{importData.studentName}</b>)</> : null}. Продолжить?
          </p>
          <div className="row">
            <div className="spacer" />
            <button className="btn btn-ghost" onClick={() => setImportData(null)}>Отмена</button>
            <button className="btn btn-primary" onClick={applyImport}>Да, импортировать</button>
          </div>
        </Modal>
      )}
    </div>
  )
}
