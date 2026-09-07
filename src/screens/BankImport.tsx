import { useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import BankDownload from './BankDownload'
import { SUBJECTS } from '../data/subjects'
import type { Question } from '../types'
import { extractQuestions, FIELD_LABEL, guessMapping, jsonToTable, parseTable, textParagraphs, type DraftQuestion, type FieldName } from '../lib/bank'
import { decodeText } from '../lib/extract'
import { loadMaterialText, uid } from '../lib/api'
import { countOf } from '../lib/plural'
import { generateStarterSet, generatorCoverage } from '../lib/taskgen'
import { FileUp, Library, Plus, Check, X, Loader2, ClipboardPaste, Sparkles, Download } from 'lucide-react'

type Mode = 'download' | 'menu' | 'file' | 'paste' | 'material' | 'manual'

/**
 * Пополнение банка заданий БЕЗ ИИ:
 *  — свой файл (CSV/TSV/JSON) с ручным сопоставлением колонок — любой формат подходит;
 *  — вставка текстом: домашка приходит в чём попало, и заранее формат не угадать;
 *  — разбор загруженного материала по нумерации заданий;
 *  — руками по одному.
 */
export default function BankImport({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<Mode>('menu')

  if (mode === 'download') return <DownloadPane onBack={() => setMode('menu')} onDone={onDone} />
  if (mode === 'file') return <FromFile onBack={() => setMode('menu')} onDone={onDone} />
  if (mode === 'paste') return <FromPaste onBack={() => setMode('menu')} onDone={onDone} />
  if (mode === 'material') return <FromMaterial onBack={() => setMode('menu')} onDone={onDone} />
  if (mode === 'manual') return <Manual onBack={() => setMode('menu')} onDone={onDone} />

  return (
    <div className="grid" style={{ gap: 12 }}>
      <p className="small muted" style={{ margin: 0 }}>
        Задания остаются на твоём компьютере. Всё, кроме загрузки с Решу ЕГЭ, работает и без интернета.
      </p>
      <button className="pick-card" onClick={() => setMode('download')}>
        <Download size={20} color="var(--accent)" />
        <div>
          <b>Скачать с Решу ЕГЭ</b>
          <div className="small muted">
            Задания по каждому номеру с ответами, разборами и чертежами — прямо в банк.
          </div>
        </div>
      </button>
      <button className="pick-card" onClick={() => setMode('file')}>
        <FileUp size={20} color="var(--accent)" />
        <div>
          <b>Из своего файла</b>
          <div className="small muted">CSV, TSV или JSON в любом виде — сам скажешь, где вопрос, где ответ.</div>
        </div>
      </button>
      <SeedCard onDone={onDone} />
      <button className="pick-card" onClick={() => setMode('paste')}>
        <ClipboardPaste size={20} color="var(--accent)" />
        <div>
          <b>Вставить текстом</b>
          <div className="small muted">Домашка из чата, с сайта, из документа — просто вставь, разберусь на месте.</div>
        </div>
      </button>
      <button className="pick-card" onClick={() => setMode('material')}>
        <Library size={20} color="var(--accent)" />
        <div>
          <b>Из материала</b>
          <div className="small muted">Разберу вариант или страницу с Решу ЕГЭ по нумерации заданий.</div>
        </div>
      </button>
      <button className="pick-card" onClick={() => setMode('manual')}>
        <Plus size={20} color="var(--accent)" />
        <div>
          <b>Вручную</b>
          <div className="small muted">Одно задание: вопрос, ответ, разбор.</div>
        </div>
      </button>
    </div>
  )
}

const FIELDS: FieldName[] = ['text', 'answer', 'taskNo', 'topic', 'solution', 'skip']

/** Свой файл: показываем таблицу и даём разметить колонки. */
function FromFile({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const addQuestions = useStore((s) => s.addQuestions)
  const subjects = useStore((s) => s.data.subjects)
  const fileRef = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<string[][] | null>(null)
  const [map, setMap] = useState<FieldName[]>([])
  const [hasHeader, setHasHeader] = useState(true)
  const [subjectId, setSubjectId] = useState(subjects[0] ?? 'russian')
  const [defaultTaskNo, setDefaultTaskNo] = useState('')
  const [error, setError] = useState('')

  async function load(file: File | undefined) {
    if (!file) return
    setError('')
    try {
      const text = decodeText(await file.arrayBuffer())
      const table = /\.json$/i.test(file.name) ? jsonToTable(text) : parseTable(text)
      if (!table.length) {
        setError('В файле не нашлось строк.')
        return
      }
      setRows(table)
      setMap(guessMapping(table[0]))
    } catch (e) {
      setError('Не получилось разобрать файл: ' + String((e as Error)?.message ?? e))
    }
  }

  const body = rows ? (hasHeader ? rows.slice(1) : rows) : []
  const textCol = map.indexOf('text')
  const ready = rows && textCol >= 0 && body.length > 0

  function save() {
    if (!rows) return
    const answerCol = map.indexOf('answer')
    const noCol = map.indexOf('taskNo')
    const topicCol = map.indexOf('topic')
    const solCol = map.indexOf('solution')
    const out: Question[] = []
    for (const r of body) {
      const text = (r[textCol] ?? '').trim()
      if (!text) continue
      const no = noCol >= 0 ? parseInt((r[noCol] ?? '').replace(/\D/g, ''), 10) : NaN
      out.push({
        id: uid('q_'),
        subjectId,
        taskNo: Number.isFinite(no) ? no : defaultTaskNo ? Number(defaultTaskNo) : undefined,
        text,
        answer: answerCol >= 0 ? (r[answerCol] ?? '').trim() || undefined : undefined,
        topic: topicCol >= 0 ? (r[topicCol] ?? '').trim() || undefined : undefined,
        solution: solCol >= 0 ? (r[solCol] ?? '').trim() || undefined : undefined,
        origin: 'import',
        createdAt: new Date().toISOString(),
      })
    }
    addQuestions(out)
    onDone()
  }

  return (
    <div>
      <button className="btn btn-ghost btn-sm" onClick={onBack}>← Назад</button>
      <h3 style={{ marginTop: 12 }}>Свой файл с заданиями</h3>
      <p className="small muted" style={{ marginTop: 0 }}>
        Подойдёт любая таблица: выгрузка из Excel, свой список, чужой банк. Главное — чтобы вопросы были в одной колонке.
      </p>

      <div className="row wrap" style={{ gap: 10, marginBottom: 12 }}>
        <button className="btn" onClick={() => fileRef.current?.click()}><FileUp size={15} /> Выбрать файл</button>
        <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,.json" style={{ display: 'none' }} onChange={(e) => load(e.target.files?.[0])} />
        {rows && <span className="small muted">строк: {rows.length}</span>}
      </div>
      {error && <p className="small" style={{ color: 'var(--danger)' }}>{error}</p>}

      {rows && (
        <>
          <div className="row wrap" style={{ gap: 12, marginBottom: 10 }}>
            <label className="field" style={{ marginBottom: 0, maxWidth: 220 }}>
              <span>Предмет</span>
              <select className="select" value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
                {SUBJECTS.map((s) => <option key={s.id} value={s.id}>{s.emoji} {s.short}</option>)}
              </select>
            </label>
            <label className="field" style={{ marginBottom: 0, maxWidth: 190 }}>
              <span>Номер задания (если нет колонки)</span>
              <input className="input" value={defaultTaskNo} onChange={(e) => setDefaultTaskNo(e.target.value.replace(/\D/g, '').slice(0, 2))} placeholder="напр. 4" />
            </label>
            <label className="row" style={{ gap: 8, alignSelf: 'flex-end', paddingBottom: 8 }}>
              <input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} />
              <span className="small">первая строка — заголовки</span>
            </label>
          </div>

          <div className="table-wrap">
            <table className="prev-table">
              <thead>
                <tr>
                  {rows[0].map((h, i) => (
                    <th key={i}>
                      <select
                        className="select"
                        value={map[i] ?? 'skip'}
                        onChange={(e) => setMap((m) => m.map((x, j) => (j === i ? (e.target.value as FieldName) : x)))}
                        style={{ padding: '4px 6px', fontSize: 12 }}
                      >
                        {FIELDS.map((f) => <option key={f} value={f}>{FIELD_LABEL[f]}</option>)}
                      </select>
                      {hasHeader && <div className="small muted" style={{ marginTop: 4 }}>{h}</div>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {body.slice(0, 5).map((r, i) => (
                  <tr key={i}>
                    {rows[0].map((_, j) => <td key={j}>{(r[j] ?? '').slice(0, 90)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {textCol < 0 && <p className="small" style={{ color: 'var(--warn)' }}>Отметь колонку с вопросом — без неё задания не собрать.</p>}
          <div className="row" style={{ marginTop: 14 }}>
            <div className="spacer" />
            <button className="btn btn-primary" disabled={!ready} onClick={save}>
              Добавить {countOf(body.length, ['задание', 'задания', 'заданий'])}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

/** Разбор загруженного материала по нумерации заданий. */
function FromMaterial({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const data = useStore((s) => s.data)
  const addQuestions = useStore((s) => s.addQuestions)
  const materials = (data.materials ?? []).filter((m) => m.chars)
  const [materialId, setMaterialId] = useState(materials[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  const [how, setHow] = useState<'auto' | 'paras'>('auto')
  const [drafts, setDrafts] = useState<DraftQuestion[] | null>(null)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [subjectId, setSubjectId] = useState(
    materials.find((m) => m.id === materialId)?.subjectId ?? data.subjects[0] ?? 'russian',
  )

  async function scan() {
    if (!materialId) return
    setBusy(true)
    const text = (await loadMaterialText(materialId)) ?? ''
    if (how === 'auto') {
      const found = extractQuestions(text)
      setDrafts(found)
      setPicked(new Set(found.map((_, i) => i))) // разбор по нумерации — обычно всё годится
    } else {
      const found = textParagraphs(text).map((t) => ({ text: t }))
      setDrafts(found)
      setPicked(new Set()) // куски текста выбирает человек
    }
    setBusy(false)
  }

  function save() {
    if (!drafts) return
    const out: Question[] = drafts
      .filter((_, i) => picked.has(i))
      .map((d) => ({
        id: uid('q_'),
        subjectId,
        taskNo: d.taskNo,
        text: d.text,
        answer: d.answer,
        sourceId: materialId,
        origin: 'material' as const,
        createdAt: new Date().toISOString(),
      }))
    addQuestions(out)
    onDone()
  }

  const withAnswer = useMemo(() => (drafts ?? []).filter((d) => d.answer).length, [drafts])

  return (
    <div>
      <button className="btn btn-ghost btn-sm" onClick={onBack}>← Назад</button>
      <h3 style={{ marginTop: 12 }}>Задания из материала</h3>
      {materials.length === 0 ? (
        <p className="small muted">Сначала загрузи файл в разделе «Материалы» — разбирать пока нечего.</p>
      ) : (
        <>
          <div className="row wrap" style={{ gap: 10, marginBottom: 12 }}>
            <label className="field" style={{ marginBottom: 0, flex: 1, minWidth: 220 }}>
              <span>Материал</span>
              <select className="select" value={materialId} onChange={(e) => setMaterialId(e.target.value)}>
                {materials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </label>
            <label className="field" style={{ marginBottom: 0, maxWidth: 200 }}>
              <span>Предмет</span>
              <select className="select" value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
                {SUBJECTS.map((s) => <option key={s.id} value={s.id}>{s.emoji} {s.short}</option>)}
              </select>
            </label>
            <button className="btn" style={{ alignSelf: 'flex-end', marginBottom: 8 }} disabled={!materialId || busy} onClick={scan}>
              {busy ? <><Loader2 size={15} className="spin-ic" /> Читаю…</> : 'Найти задания'}
            </button>
          </div>

          <div className="row wrap" style={{ gap: 8, marginBottom: 10 }}>
            <div className="seg">
              <button className={'seg-btn' + (how === 'auto' ? ' on' : '')} onClick={() => { setHow('auto'); setDrafts(null) }}>По нумерации</button>
              <button className={'seg-btn' + (how === 'paras' ? ' on' : '')} onClick={() => { setHow('paras'); setDrafts(null) }}>Отобрать вручную</button>
            </div>
            <span className="small muted" style={{ flex: 1, minWidth: 200 }}>
              {how === 'auto'
                ? 'Ищу задания по номерам. Лучше всего — страница, сохранённая с Решу ЕГЭ (там разметка «Задание 5 № 26841», её беру как есть, даже если номера идут с пропусками). Обычный текст и конспекты тоже разбираются; в PDF со сложной вёрсткой попадает мусор — просмотри список.'
                : 'Показываю куски текста — отметь те, что годятся в задания.'}
            </span>
          </div>

          {drafts && (
            drafts.length === 0 ? (
              <p className="small muted">
                Пронумерованных заданий не нашлось. Так бывает со сканами и с текстами без нумерации —
                добавь задания вручную или таблицей.
              </p>
            ) : (
              <>
                <div className="row wrap" style={{ gap: 10, marginBottom: 8 }}>
                  <span className="chip">нашлось: {drafts.length}</span>
                  <span className="chip">с ответом: {withAnswer}</span>
                  <div className="spacer" />
                  <button className="btn btn-ghost btn-sm" onClick={() => setPicked(new Set(drafts.map((_, i) => i)))}>Выбрать все</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setPicked(new Set())}>Снять все</button>
                </div>
                <div className="draft-list">
                  {drafts.map((d, i) => (
                    <div key={i} className={'draft' + (picked.has(i) ? ' on' : '')} onClick={() => {
                      setPicked((p) => {
                        const n = new Set(p)
                        if (n.has(i)) n.delete(i)
                        else n.add(i)
                        return n
                      })
                    }}>
                      <div className="tick">{picked.has(i) && <Check size={14} color="#fff" />}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="row" style={{ gap: 8 }}>
                          {d.taskNo ? <span className="badge">№{d.taskNo}</span> : null}
                          {d.answer ? <span className="badge strong">ответ: {d.answer}</span> : <span className="small muted">без ответа</span>}
                        </div>
                        <div className="small" style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>{d.text.slice(0, 240)}{d.text.length > 240 ? '…' : ''}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="row" style={{ marginTop: 14 }}>
                  <div className="spacer" />
                  <button className="btn btn-primary" disabled={picked.size === 0} onClick={save}>
                    Добавить {countOf(picked.size, ['задание', 'задания', 'заданий'])}
                  </button>
                </div>
              </>
            )
          )}
        </>
      )}
    </div>
  )
}

/**
 * Стартовые задания. Нужны, чтобы тренажёр, интервальное повторение и балл
 * работали сразу после установки, а не после того, как ученик где-то раздобудет
 * свой банк. Задания собирает генератор (lib/taskgen.ts): ответ считается из тех же
 * чисел, что попали в условие, поэтому он верен по построению.
 */
function SeedCard({ onDone }: { onDone: () => void }) {
  const data = useStore((s) => s.data)
  const addQuestions = useStore((s) => s.addQuestions)
  const [added, setAdded] = useState(0)

  const subjects = data.subjects.length ? data.subjects : ['russian']
  const cov = generatorCoverage()
  const numbers = subjects.reduce((n, sid) => n + (cov[sid]?.length ?? 0), 0)

  function load() {
    const fresh = generateStarterSet(subjects, 10, Math.random, new Set((data.questions ?? []).map((q) => q.text)))
    if (!fresh.length) return
    addQuestions(fresh)
    setAdded(fresh.length)
    setTimeout(onDone, 900)
  }

  return (
    <button className="pick-card" onClick={load} disabled={!numbers}>
      <Sparkles size={20} color="var(--accent)" />
      <div style={{ textAlign: 'left' }}>
        <b>Сгенерировать задания</b>
        <div className="small muted">
          {added > 0 ? (
            <>Добавлено {countOf(added, ['задание', 'задания', 'заданий'])} ✓</>
          ) : numbers ? (
            <>
              Соберу свежие задания по {countOf(numbers, ['номеру', 'номерам', 'номерам'])} твоих предметов — с
              ответами и разбором. Числа каждый раз новые, поэтому запомнить их нельзя.
            </>
          ) : (
            <>По твоим предметам генерация пока не поддерживается.</>
          )}
        </div>
      </div>
    </button>
  )
}

/**
 * Вставка текстом — путь для домашки, у которой формат заранее неизвестен.
 *
 * Задание может прийти как угодно: сообщением в чате, куском с сайта, текстом из
 * документа, набранным с фотографии тетради. Поэтому здесь не требуется НИКАКОЙ
 * структуры: сначала пробуем найти нумерацию, а если её нет — режем на куски и даём
 * отметить нужные руками. Номер и ответ у каждой находки правятся прямо в списке:
 * при неизвестном формате автоопределение обязательно где-то промахнётся, и мириться
 * с этим не нужно.
 */
function FromPaste({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const subjects = useStore((s) => s.data.subjects)
  const addQuestions = useStore((s) => s.addQuestions)
  const [subjectId, setSubjectId] = useState(subjects[0] ?? 'russian')
  const [raw, setRaw] = useState('')
  const [drafts, setDrafts] = useState<DraftQuestion[] | null>(null)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [byNumbers, setByNumbers] = useState(true)

  function scan() {
    const text = raw.trim()
    if (!text) return
    // Копия из чата часто схлопывается в одну строку — тогда номера стоят внутри неё,
    // и построчный разбор их не видит. Разрываем перед «N.» и «N)», но только если
    // строк почти нет: там, где разметка уже есть, лезть в неё незачем.
    // Признак нового пункта: номер с точкой или скобкой, за которым идёт заглавная буква.
    // «Ответ» и «Ключ» исключены нарочно: в «со сторонами 3 и 4. Ответ: 6» иначе
    // получился бы фантомный пункт номер 4.
    const flat =
      text.split('\n').length < 3
        ? text.replace(/\s+(\d{1,2}[.)]\s+(?!Ответ|Ключ)[А-ЯЁA-Z])/g, '\n$1')
        : text
    // Пороги здесь мягче, чем при разборе PDF: домашка бывает короткой («Повторить
    // тождества»), и выбрасывать такие пункты как мусор нельзя — их вставили нарочно.
    const found = extractQuestions(flat, 1200, 12, 2)
    if (found.length) {
      setDrafts(found)
      setPicked(new Set(found.map((_, i) => i)))
      setByNumbers(true)
      return
    }
    // Нумерации нет — значит, это просто текст. Режем на куски, выбирать будет человек.
    let paras = textParagraphs(flat, 12, 1500, 8)
    // Абзацев не оказалось, а строк несколько — значит, разделитель одиночный перенос.
    if (paras.length <= 1 && flat.includes('\n')) {
      paras = flat.split('\n').map((l) => l.trim()).filter((l) => l.length >= 12)
    }
    setDrafts(paras.length ? paras.map((t) => ({ text: t })) : [{ text }])
    setPicked(new Set())
    setByNumbers(false)
  }

  function edit(i: number, patch: Partial<DraftQuestion>) {
    setDrafts((ds) => (ds ? ds.map((d, k) => (k === i ? { ...d, ...patch } : d)) : ds))
  }

  function save() {
    if (!drafts) return
    const out: Question[] = drafts
      .filter((_, i) => picked.has(i))
      .map((d) => ({
        id: uid('q_'),
        subjectId,
        taskNo: d.taskNo,
        text: d.text.trim(),
        answer: d.answer?.trim() || undefined,
        origin: 'manual' as const,
        createdAt: new Date().toISOString(),
      }))
      .filter((q) => q.text.length > 0)
    if (!out.length) return
    addQuestions(out)
    onDone()
  }

  return (
    <div>
      <button className="btn btn-ghost btn-sm" onClick={onBack}>← Назад</button>
      <h3 style={{ marginTop: 12 }}>Вставить текстом</h3>
      <p className="small muted" style={{ marginTop: 0 }}>
        Вставь что есть — хоть весь список домашки, хоть одно задание. Если в тексте есть
        нумерация («Задание 5», «5)», «5.»), разберу по ней; если нет — покажу кусками,
        отметишь нужные. Номер и ответ можно поправить прямо в списке.
      </p>

      <div className="row wrap" style={{ gap: 10, marginBottom: 10 }}>
        <label className="field" style={{ marginBottom: 0, minWidth: 200 }}>
          <span>Предмет</span>
          <select className="select" value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
            {SUBJECTS.map((s) => <option key={s.id} value={s.id}>{s.emoji} {s.short}</option>)}
          </select>
        </label>
      </div>

      <textarea
        className="input"
        style={{ minHeight: 150, fontFamily: 'inherit' }}
        placeholder={'Например:\n1. Найдите значение выражения…\nОтвет: 12\n\n2. Решите уравнение…\nОтвет: 5'}
        value={raw}
        onChange={(e) => { setRaw(e.target.value); setDrafts(null) }}
      />

      <div className="row" style={{ marginTop: 10 }}>
        <span className="small muted">{raw.trim().length > 0 && <>символов: {raw.trim().length}</>}</span>
        <div className="spacer" />
        <button className="btn btn-primary" disabled={!raw.trim()} onClick={scan}>Разобрать</button>
      </div>

      {drafts && (
        <div style={{ marginTop: 14 }}>
          <div className="row wrap" style={{ gap: 10, marginBottom: 8 }}>
            <span className="chip">{byNumbers ? 'нашлось по нумерации' : 'нумерации нет — куски текста'}: {drafts.length}</span>
            <div className="spacer" />
            <button className="btn btn-ghost btn-sm" onClick={() => setPicked(new Set(drafts.map((_, i) => i)))}>Выбрать все</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setPicked(new Set())}>Снять все</button>
          </div>

          <div className="draft-list">
            {drafts.map((d, i) => (
              <div key={i} className={'draft' + (picked.has(i) ? ' on' : '')}>
                <div
                  className="tick"
                  style={{ cursor: 'pointer' }}
                  onClick={() => setPicked((p) => {
                    const n = new Set(p)
                    if (n.has(i)) n.delete(i)
                    else n.add(i)
                    return n
                  })}
                >
                  {picked.has(i) && <Check size={14} color="#fff" />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="row wrap" style={{ gap: 8, marginBottom: 6 }}>
                    <input
                      className="input"
                      style={{ width: 92 }}
                      placeholder="№"
                      inputMode="numeric"
                      value={d.taskNo ?? ''}
                      onChange={(e) => {
                        const n = Number(e.target.value)
                        edit(i, { taskNo: e.target.value && n >= 1 && n <= 40 ? n : undefined })
                      }}
                    />
                    <input
                      className="input"
                      style={{ flex: 1, minWidth: 130 }}
                      placeholder="ответ (можно несколько через |)"
                      value={d.answer ?? ''}
                      onChange={(e) => edit(i, { answer: e.target.value })}
                    />
                  </div>
                  <textarea
                    className="input"
                    style={{ minHeight: 54, fontFamily: 'inherit' }}
                    value={d.text}
                    onChange={(e) => edit(i, { text: e.target.value })}
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="row" style={{ marginTop: 14 }}>
            <span className="small muted">
              Без ответа задание тоже сохранится — вердикт поставишь сам при решении.
            </span>
            <div className="spacer" />
            <button className="btn btn-primary" disabled={picked.size === 0} onClick={save}>
              Добавить {countOf(picked.size, ['задание', 'задания', 'заданий'])}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/** Одно задание руками. */
function Manual({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const subjects = useStore((s) => s.data.subjects)
  const addQuestions = useStore((s) => s.addQuestions)
  const [subjectId, setSubjectId] = useState(subjects[0] ?? 'russian')
  const [taskNo, setTaskNo] = useState('')
  const [text, setText] = useState('')
  const [answer, setAnswer] = useState('')
  const [solution, setSolution] = useState('')

  function save() {
    if (!text.trim()) return
    addQuestions([{
      id: uid('q_'),
      subjectId,
      taskNo: taskNo ? Number(taskNo) : undefined,
      text: text.trim(),
      answer: answer.trim() || undefined,
      solution: solution.trim() || undefined,
      origin: 'manual',
      createdAt: new Date().toISOString(),
    }])
    onDone()
  }

  return (
    <div>
      <button className="btn btn-ghost btn-sm" onClick={onBack}>← Назад</button>
      <h3 style={{ marginTop: 12 }}>Своё задание</h3>
      <div className="row wrap" style={{ gap: 10 }}>
        <label className="field" style={{ maxWidth: 220 }}>
          <span>Предмет</span>
          <select className="select" value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
            {SUBJECTS.map((s) => <option key={s.id} value={s.id}>{s.emoji} {s.short}</option>)}
          </select>
        </label>
        <label className="field" style={{ maxWidth: 150 }}>
          <span>Номер задания</span>
          <input className="input" value={taskNo} onChange={(e) => setTaskNo(e.target.value.replace(/\D/g, '').slice(0, 2))} placeholder="напр. 12" />
        </label>
      </div>
      <label className="field">
        <span>Вопрос</span>
        <textarea className="input" rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="Условие задания…" />
      </label>
      <label className="field">
        <span>Ответ (несколько допустимых — через |)</span>
        <input className="input" value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="напр. 24|42" />
      </label>
      <label className="field">
        <span>Разбор (необязательно)</span>
        <textarea className="input" rows={3} value={solution} onChange={(e) => setSolution(e.target.value)} />
      </label>
      <div className="row">
        <div className="spacer" />
        <button className="btn btn-ghost" onClick={onBack}><X size={15} /> Отмена</button>
        <button className="btn btn-primary" disabled={!text.trim()} onClick={save}>Добавить</button>
      </div>
    </div>
  )
}

/** Загрузка банка с Решу ЕГЭ — отдельной страницей, чтобы поместился прогресс. */
function DownloadPane({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  return (
    <div>
      <button className="btn btn-ghost btn-sm" onClick={onBack}>← Назад</button>
      <h3 style={{ marginTop: 12 }}>Скачать задания с Решу ЕГЭ</h3>
      <BankDownload onDone={onDone} />
    </div>
  )
}
