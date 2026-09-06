import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { SUBJECTS, subjectById } from '../data/subjects'
import type { Material } from '../types'
import { extractText, humanSize, kindOf } from '../lib/extract'
import { isTauri, loadMaterialText, openMaterialFile, saveMaterialFile, saveMaterialText, uid } from '../lib/api'
import { countOf } from '../lib/plural'
import {
  Upload,
  Search,
  Trash2,
  ExternalLink,
  FileText,
  FileSpreadsheet,
  FileCode,
  Image as ImageIcon,
  File as FileIcon,
  X,
  Loader2,
  Info,
} from 'lucide-react'

// Оригиналы больше этого размера не копируем к себе: смысла мало, а место жалко.
const MAX_STORE_BYTES = 40 * 1024 * 1024

const KIND_ICON: Record<Material['kind'], typeof FileText> = {
  pdf: FileText,
  docx: FileText,
  text: FileText,
  markdown: FileText,
  csv: FileSpreadsheet,
  json: FileCode,
  image: ImageIcon,
  other: FileIcon,
}
const KIND_LABEL: Record<Material['kind'], string> = {
  pdf: 'PDF',
  docx: 'Документ',
  text: 'Текст',
  markdown: 'Markdown',
  csv: 'Таблица',
  json: 'JSON',
  image: 'Картинка',
  other: 'Файл',
}

/** «850 знаков» / «65 тыс. знаков» — без бессмысленного «0 тыс.». */
function charsLabel(chars: number): string {
  return chars < 10000 ? chars + ' знаков текста' : Math.round(chars / 1000) + ' тыс. знаков текста'
}

// Тексты материалов держим в памяти сессии: читать их с диска на каждый ввод буквы — расточительно.
const textCache = new Map<string, string>()

async function textOf(id: string): Promise<string> {
  const hit = textCache.get(id)
  if (hit !== undefined) return hit
  const t = (await loadMaterialText(id)) ?? ''
  textCache.set(id, t)
  return t
}

export default function Materials() {
  const data = useStore((s) => s.data)
  const addMaterial = useStore((s) => s.addMaterial)
  const updateMaterial = useStore((s) => s.updateMaterial)
  const removeMaterial = useStore((s) => s.removeMaterial)

  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<string>('')
  const [errors, setErrors] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [subject, setSubject] = useState('all')
  const [preview, setPreview] = useState<Material | null>(null)
  const [hits, setHits] = useState<Record<string, number>>({}) // id → сколько совпадений в тексте
  const [dragOver, setDragOver] = useState(false)

  const materials = data.materials ?? []

  // Поиск по содержимому: ищем в тексте всех материалов, а не только в названиях.
  useEffect(() => {
    const q = query.trim().toLowerCase()
    if (q.length < 2) {
      setHits({})
      return
    }
    let cancelled = false
    const timer = window.setTimeout(async () => {
      const found: Record<string, number> = {}
      for (const m of materials) {
        if (!m.chars) continue
        const t = (await textOf(m.id)).toLowerCase()
        if (cancelled) return
        let n = 0
        let from = 0
        for (;;) {
          const i = t.indexOf(q, from)
          if (i < 0) break
          n++
          from = i + q.length
          if (n > 999) break
        }
        if (n) found[m.id] = n
      }
      if (!cancelled) setHits(found)
    }, 260)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, materials.length])

  async function importFiles(files: FileList | File[]) {
    const list = Array.from(files)
    if (!list.length) return
    const problems: string[] = []
    for (let i = 0; i < list.length; i++) {
      const file = list[i]
      setBusy('Читаю «' + file.name + '» (' + (i + 1) + ' из ' + list.length + ')…')
      try {
        const id = uid('mat_')
        const kind = kindOf(file.name)
        const ext = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.') + 1).toLowerCase() : 'bin'
        const res = await extractText(file)
        let stored: string | undefined
        if (file.size <= MAX_STORE_BYTES) {
          const saved = await saveMaterialFile(id + '.' + ext, await file.arrayBuffer())
          if (saved) stored = id + '.' + ext
        } else {
          problems.push(file.name + ': файл больше 40 МБ — сохранил только текст.')
        }
        if (res.text.trim()) {
          await saveMaterialText(id, res.text)
          textCache.set(id, res.text)
        }
        addMaterial({
          id,
          name: file.name,
          kind,
          addedAt: new Date().toISOString(),
          size: file.size,
          pages: res.pages,
          chars: res.text.trim().length || undefined,
          file: stored,
          warn: res.warn,
          subjectId: subject !== 'all' ? subject : undefined,
        })
        if (res.warn) problems.push(file.name + ': ' + res.warn)
      } catch (e) {
        problems.push(file.name + ': ' + String((e as Error)?.message ?? e))
      }
    }
    setBusy('')
    setErrors(problems)
    if (fileRef.current) fileRef.current.value = ''
  }

  const shown = materials.filter((m) => {
    if (subject !== 'all' && m.subjectId !== subject) return false
    const q = query.trim().toLowerCase()
    if (!q) return true
    return m.name.toLowerCase().includes(q) || hits[m.id] > 0
  })

  const totalChars = materials.reduce((n, m) => n + (m.chars ?? 0), 0)

  return (
    <div className="fade-in">
      <div className="page-head">
        <h1>Материалы</h1>
        <p>
          Свои учебники, варианты, конспекты и таблицы. Текст из них вынимается прямо на твоём компьютере —
          без интернета и без ИИ, поэтому поиск работает всегда.
        </p>
      </div>

      <div
        className={'drop-zone' + (dragOver ? ' over' : '')}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          if (e.dataTransfer?.files?.length) importFiles(e.dataTransfer.files)
        }}
        onClick={() => fileRef.current?.click()}
      >
        <Upload size={22} color="var(--accent)" />
        <div>
          <b>Перетащи файлы сюда</b> или нажми, чтобы выбрать
          <div className="small muted" style={{ marginTop: 3 }}>
            PDF, DOCX, EPUB, FB2, TXT, MD, CSV, JSON, картинки
          </div>
        </div>
        <input
          ref={fileRef}
          type="file"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => e.target.files && importFiles(e.target.files)}
        />
      </div>

      {busy && (
        <div className="row" style={{ gap: 10, margin: '12px 0' }}>
          <Loader2 size={16} className="spin-ic" />
          <span className="muted small">{busy}</span>
        </div>
      )}
      {errors.length > 0 && (
        <div className="info-banner" style={{ marginTop: 12 }}>
          <Info size={16} color="var(--warn)" />
          <div className="small" style={{ flex: 1 }}>
            {errors.map((t, i) => <div key={i}>{t}</div>)}
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => setErrors([])}><X size={14} /></button>
        </div>
      )}

      {materials.length > 0 && (
        <div className="row wrap" style={{ gap: 8, margin: '18px 0' }}>
          <div className="search-box">
            <Search size={15} color="var(--muted-2)" />
            <input
              className="inline-input"
              placeholder="Найти по названию и по тексту внутри файлов…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && <button className="btn btn-ghost btn-sm" onClick={() => setQuery('')}><X size={14} /></button>}
          </div>
          <div className="spacer" />
          <div className="row wrap" style={{ gap: 6 }}>
            <div className="chip" style={{ cursor: 'pointer', ...(subject === 'all' ? selChip : {}) }} onClick={() => setSubject('all')}>Все</div>
            {SUBJECTS.filter((s) => data.subjects.includes(s.id)).map((s) => (
              <div key={s.id} className="chip" style={{ cursor: 'pointer', ...(subject === s.id ? selChip : {}) }} onClick={() => setSubject(s.id)}>
                {s.emoji} {s.short}
              </div>
            ))}
          </div>
        </div>
      )}

      {materials.length === 0 ? (
        <div className="empty">
          <div className="big">📚</div>
          <p>Пока пусто. Закинь сюда сборник заданий, свой конспект или таблицу — дальше их можно привязать к занятиям и искать по ним.</p>
        </div>
      ) : shown.length === 0 ? (
        <p className="muted small">Ничего не нашлось. Попробуй другое слово.</p>
      ) : (
        <div className="grid" style={{ gap: 10 }}>
          {shown.map((m) => {
            const Icon = KIND_ICON[m.kind]
            const s = m.subjectId ? subjectById(m.subjectId) : null
            return (
              <div key={m.id} className="mat-row">
                <div className="mat-ic"><Icon size={18} /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="mat-name" onClick={() => setPreview(m)} title="Посмотреть текст">{m.name}</div>
                  <div className="row wrap small muted" style={{ gap: 10, marginTop: 3 }}>
                    <span>{KIND_LABEL[m.kind]}</span>
                    <span>{humanSize(m.size)}</span>
                    {m.pages ? <span>{countOf(m.pages, ['страница', 'страницы', 'страниц'])}</span> : null}
                    {m.chars ? <span>{charsLabel(m.chars)}</span> : <span style={{ color: 'var(--warn)' }}>без текста</span>}
                    {hits[m.id] ? <span style={{ color: 'var(--accent-text)' }}>найдено {hits[m.id]}</span> : null}
                  </div>
                </div>
                <select
                  className="select"
                  value={m.subjectId ?? ''}
                  onChange={(e) => updateMaterial(m.id, { subjectId: e.target.value || undefined })}
                  style={{ width: 168, padding: '6px 8px' }}
                  title="Предмет"
                >
                  <option value="">без предмета</option>
                  {SUBJECTS.map((x) => (
                    <option key={x.id} value={x.id}>{x.emoji} {x.short}</option>
                  ))}
                </select>
                <button className="btn btn-ghost btn-sm" onClick={() => setPreview(m)} title="Текст">
                  <FileText size={14} />
                </button>
                {m.file && isTauri && (
                  <button className="btn btn-ghost btn-sm" onClick={() => openMaterialFile(m.file!).catch(() => {})} title="Открыть оригинал">
                    <ExternalLink size={14} />
                  </button>
                )}
                <button className="btn btn-ghost btn-sm" onClick={() => removeMaterial(m.id)} title="Удалить">
                  <Trash2 size={14} />
                </button>
                {s && <span className="chip" style={{ marginLeft: 2 }}>{s.emoji}</span>}
              </div>
            )
          })}
        </div>
      )}

      {materials.length > 0 && (
        <p className="small muted" style={{ marginTop: 18 }}>
          Всего {countOf(materials.length, ['файл', 'файла', 'файлов'])}
          {totalChars > 0 && <> · {Math.round(totalChars / 1000)} тыс. знаков текста для поиска и для ИИ</>}
        </p>
      )}

      {preview && <MaterialPreview material={preview} query={query} onClose={() => setPreview(null)} />}
    </div>
  )
}

/** Просмотр извлечённого текста с подсветкой найденного. */
function MaterialPreview({ material, query, onClose }: { material: Material; query: string; onClose: () => void }) {
  const [text, setText] = useState<string | null>(null)
  const [q, setQ] = useState(query)
  const updateMaterial = useStore((s) => s.updateMaterial)

  useEffect(() => {
    let alive = true
    textOf(material.id).then((t) => alive && setText(t))
    return () => { alive = false }
  }, [material.id])

  const shown = useMemo(() => {
    if (!text) return []
    const needle = q.trim().toLowerCase()
    const paras = text.split(/\n{2,}/).filter((p) => p.trim())
    if (!needle) return paras.slice(0, 60)
    return paras.filter((p) => p.toLowerCase().includes(needle)).slice(0, 60)
  }, [text, q])

  function mark(p: string) {
    const needle = q.trim()
    if (!needle) return p
    const parts = p.split(new RegExp('(' + needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi'))
    return parts.map((x, i) => (x.toLowerCase() === needle.toLowerCase() ? <mark key={i}>{x}</mark> : x))
  }

  return (
    <div className="drawer-bg" onClick={onClose}>
      <div className="drawer wide-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ marginBottom: 10 }}>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: 19, overflow: 'hidden', textOverflow: 'ellipsis' }}>{material.name}</h2>
            <div className="small muted">
              {KIND_LABEL[material.kind]} · {humanSize(material.size)}
              {material.pages ? ' · ' + countOf(material.pages, ['страница', 'страницы', 'страниц']) : ''}
            </div>
          </div>
          <div className="spacer" />
          <button className="btn btn-ghost btn-sm" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="search-box" style={{ marginBottom: 12 }}>
          <Search size={15} color="var(--muted-2)" />
          <input className="inline-input" placeholder="Искать внутри файла…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>

        <label className="field">
          <span>Заметка к материалу</span>
          <input
            className="input"
            defaultValue={material.note ?? ''}
            placeholder="например: сборник Ященко, 36 вариантов"
            onBlur={(e) => updateMaterial(material.id, { note: e.target.value.trim() || undefined })}
          />
        </label>

        {material.warn && <p className="small" style={{ color: 'var(--warn)' }}>⚠️ {material.warn}</p>}

        {text === null ? (
          <div className="row" style={{ gap: 10 }}><Loader2 size={16} className="spin-ic" /><span className="muted small">Читаю…</span></div>
        ) : !text.trim() ? (
          <p className="muted small">Текста в этом файле нет.</p>
        ) : (
          <div className="mat-text">
            {shown.map((p, i) => <p key={i}>{mark(p)}</p>)}
            {shown.length === 0 && <p className="muted small">В файле нет такого фрагмента.</p>}
            {shown.length >= 60 && <p className="muted small">…показаны первые 60 кусков. Уточни поиск, чтобы найти нужное.</p>}
          </div>
        )}
      </div>
    </div>
  )
}

const selChip = { borderColor: 'var(--accent)', background: 'var(--accent-soft)', color: 'var(--accent-text)' }
