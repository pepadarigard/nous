import { useRef, useState } from 'react'
import { useStore } from '../store'
import { subjectName, subjectById } from '../data/subjects'
import {
  BANK_SUBJECTS,
  canDownload,
  downloadSubject,
  downloadVariants,
  type BankProgress,
} from '../lib/sdamgia'
import { isTauri, humanError } from '../lib/api'
import { bankKey } from '../lib/taskgen'
import { countOf } from '../lib/plural'
import type { Question } from '../types'
import { Download, Loader2, Check, X, Image as ImageIcon } from 'lucide-react'

/** Номер задания на Решу ЕГЭ, если задание пришло оттуда. */
function siteId(q: Question): string | undefined {
  return q.sourceId?.startsWith('sdamgia:') ? q.sourceId.slice('sdamgia:'.length) : undefined
}

/**
 * Загрузка заданий с Решу ЕГЭ в личный банк.
 *
 * Экран нарочно многословен про то, что происходит: качается чужой сайт, это
 * занимает минуты, и человек должен видеть, что приложение не зависло, а идёт
 * по подборкам. Прерывание работает в любой момент — уже скачанное сохраняется.
 */
export default function BankDownload({ onDone }: { onDone?: () => void }) {
  const data = useStore((s) => s.data)
  const addQuestions = useStore((s) => s.addQuestions)
  const addVariant = useStore((s) => s.addVariant)

  // Сколько заданий с Решу ЕГЭ уже лежит по каждому предмету.
  const have: Record<string, number> = {}
  for (const q of data.questions ?? []) {
    if (q.sourceId?.startsWith('sdamgia:')) have[q.subjectId] = (have[q.subjectId] ?? 0) + 1
  }
  const totalHave = Object.values(have).reduce((a, b) => a + b, 0)
  const haveVars: Record<string, number> = {}
  for (const v of data.variants ?? []) haveVars[v.subjectId] = (haveVars[v.subjectId] ?? 0) + 1
  const totalVars = Object.values(haveVars).reduce((a, b) => a + b, 0)

  const mine = (data.subjects.length ? data.subjects : BANK_SUBJECTS).filter(canDownload)
  const [chosen, setChosen] = useState<string[]>(mine)
  const [perTask, setPerTask] = useState(50)
  const [varCount, setVarCount] = useState(5)
  const [withImages, setWithImages] = useState(true)
  const [busy, setBusy] = useState(false)
  const [prog, setProg] = useState<BankProgress | null>(null)
  const [added, setAdded] = useState<Record<string, number>>({})
  const [addedVars, setAddedVars] = useState<Record<string, number>>({})
  const [error, setError] = useState('')
  const abort = useRef<{ aborted: boolean }>({ aborted: false })

  const toggle = (id: string) =>
    setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]))

  async function run() {
    if (busy || !chosen.length) return
    setBusy(true)
    setError('')
    setAdded({})
    setAddedVars({})
    abort.current = { aborted: false }
    // Что уже лежит в банке — иначе повторная загрузка удвоила бы всё.
    const bank = data.questions ?? []
    const known = new Set(bank.map(bankKey))
    // Номера заданий на сайте: по ним и сверяем, что уже скачано. Сверки по
    // тексту мало — у задания с чертежом текст в банке уже подчищен от пометки
    // «[чертёж]» и с сырым текстом со страницы не совпадёт.
    const reuse = new Map<string, string>()
    for (const q of bank) {
      const sid = siteId(q)
      if (sid) reuse.set(sid, q.id)
    }
    try {
      for (const sid of chosen) {
        if (abort.current.aborted) break
        const qs = await downloadSubject(sid, {
          perTask,
          withImages,
          known,
          knownIds: new Set(reuse.keys()),
          onProgress: setProg,
          signal: abort.current,
        })
        // Складываем сразу после предмета: если следующий упадёт, этот уже сохранён.
        if (qs.length) addQuestions(qs)
        for (const q of qs) {
          known.add(bankKey(q))
          const id = siteId(q)
          if (id) reuse.set(id, q.id)
        }
        setAdded((a) => ({ ...a, [sid]: qs.length }))

        if (abort.current.aborted || varCount <= 0) continue
        const vars = await downloadVariants(sid, varCount, {
          withImages,
          reuse,
          onProgress: setProg,
          signal: abort.current,
        })
        for (const v of vars) {
          addVariant(
            { subjectId: v.subjectId, title: v.title, sourceId: v.sourceId },
            v.questions,
            v.questionIds,
            v.taskNos,
          )
          for (const q of v.questions) {
            known.add(bankKey(q))
            const id = siteId(q)
            if (id) reuse.set(id, q.id)
          }
        }
        setAddedVars((a) => ({ ...a, [sid]: vars.length }))
      }
    } catch (e) {
      setError(humanError(e))
    }
    setProg(null)
    setBusy(false)
  }

  const totalAdded = Object.values(added).reduce((a, b) => a + b, 0)
  const totalAddedVars = Object.values(addedVars).reduce((a, b) => a + b, 0)

  if (!isTauri) {
    return (
      <div className="card soft">
        <b>Загрузка работает в приложении</b>
        <p className="small muted" style={{ marginBottom: 0 }}>
          В браузере чужой сайт запросы не отдаёт — это ограничение самого браузера, обойти его со
          стороны страницы нельзя. Скачай Nous, и кнопка заработает.
        </p>
      </div>
    )
  }

  return (
    <div>
      <p className="muted small" style={{ marginTop: 0 }}>
        Nous сходит на Решу ЕГЭ и заберёт задания по каждому номеру — с ответами и разборами, а по
        геометрии ещё и с чертежами. Заодно скачает целые пробные варианты: их можно пройти
        целиком под таймером, во вкладке «Пробник». Всё складывается в твой банк и дальше работает
        без интернета. Займёт несколько минут: между запросами приложение выжидает паузу, чтобы не
        мешать сайту.
      </p>

      <div className="row wrap" style={{ gap: 8, marginBottom: 6 }}>
        {BANK_SUBJECTS.map((id) => (
          <button
            key={id}
            className={'chip' + (chosen.includes(id) ? ' on' : '')}
            disabled={busy}
            onClick={() => toggle(id)}
            style={chosen.includes(id) ? { borderColor: 'var(--accent)', background: 'var(--accent-soft)', color: 'var(--accent-text)' } : undefined}
          >
            {subjectById(id)?.emoji} {subjectById(id)?.short ?? id}
            {have[id] ? <span className="small muted"> · {have[id]}</span> : null}
            {haveVars[id] ? <span className="small muted"> · {haveVars[id]} вар.</span> : null}
          </button>
        ))}
      </div>
      {/* Что уже есть — чтобы было понятно, докачиваем мы или качаем впервые.
          Повторная загрузка не дублирует: уже лежащие в банке задания пропускаются,
          поэтому её же можно жать, чтобы забрать появившееся на сайте новое. */}
      <p className="small muted" style={{ marginTop: 0, marginBottom: 14 }}>
        {totalHave
          ? 'В банке уже ' +
            countOf(totalHave, ['задание', 'задания', 'заданий']) +
            ' с Решу ЕГЭ' +
            (totalVars
              ? ' и ' + countOf(totalVars, ['целый вариант', 'целых варианта', 'целых вариантов'])
              : '') +
            '. Повторная загрузка ничего не задвоит — возьмёт только то, чего ещё нет.'
          : 'Банк с Решу ЕГЭ пока пуст.'}
      </p>

      <div className="row wrap" style={{ gap: 16, marginBottom: 16 }}>
        <label className="small">
          Заданий на номер:{' '}
          <select className="input" style={{ width: 90, display: 'inline-block' }} value={perTask} disabled={busy} onChange={(e) => setPerTask(Number(e.target.value))}>
            <option value={20}>20</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </label>
        <label className="small">
          Целых вариантов:{' '}
          <select className="input" style={{ width: 130, display: 'inline-block' }} value={varCount} disabled={busy} onChange={(e) => setVarCount(Number(e.target.value))}>
            <option value={0}>не нужно</option>
            <option value={3}>3</option>
            <option value={5}>5</option>
            <option value={10}>10</option>
            <option value={15}>15</option>
          </select>
        </label>
        <label className="small row" style={{ gap: 6, width: 'auto' }}>
          <input type="checkbox" checked={withImages} disabled={busy} onChange={(e) => setWithImages(e.target.checked)} />
          <ImageIcon size={14} /> качать чертежи
        </label>
      </div>

      {prog && (
        <div className="card soft" style={{ marginBottom: 14 }}>
          <div className="row" style={{ gap: 10 }}>
            <Loader2 size={16} className="spin-ic" />
            <b>{subjectName(prog.subjectId)}</b>
            <div className="spacer" />
            <span className="small muted">{prog.note}</span>
          </div>
          <div className="pbar" style={{ marginTop: 10 }}>
            <span style={{ width: `${Math.round((prog.done / Math.max(1, prog.total)) * 100)}%` }} />
          </div>
          <div className="small muted" style={{ marginTop: 6 }}>
            шаг {prog.done} из {prog.total} · набрано {prog.got}
          </div>
        </div>
      )}

      {Object.entries(added).map(([sid, n]) => (
        <div key={sid} className="small" style={{ color: 'var(--accent-text)', marginBottom: 4 }}>
          <Check size={13} /> {subjectName(sid)}: {countOf(n, ['задание', 'задания', 'заданий'])}
          {addedVars[sid]
            ? ' и ' + countOf(addedVars[sid], ['целый вариант', 'целых варианта', 'целых вариантов'])
            : ''}
        </div>
      ))}

      {error && <p className="small" style={{ color: 'var(--danger)' }}>{error}</p>}

      <div className="row" style={{ gap: 10, marginTop: 14 }}>
        {busy ? (
          <button className="btn" onClick={() => { abort.current.aborted = true }}>
            <X size={15} /> Остановить
          </button>
        ) : (
          <button className="btn btn-primary btn-lg" disabled={!chosen.length} onClick={run}>
            <Download size={16} /> {totalHave ? 'Докачать задания' : 'Загрузить задания'}
          </button>
        )}
        <div className="spacer" />
        {!busy && (totalAdded > 0 || totalAddedVars > 0) && onDone && (
          <button className="btn btn-primary" onClick={onDone}>Готово</button>
        )}
      </div>
    </div>
  )
}
