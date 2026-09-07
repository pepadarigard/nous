import { useRef, useState } from 'react'
import { useStore } from '../store'
import { subjectName, subjectById } from '../data/subjects'
import { BANK_SUBJECTS, canDownload, downloadSubject, type BankProgress } from '../lib/sdamgia'
import { isTauri, humanError } from '../lib/api'
import { countOf } from '../lib/plural'
import { Download, Loader2, Check, X, Image as ImageIcon } from 'lucide-react'

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

  const mine = (data.subjects.length ? data.subjects : BANK_SUBJECTS).filter(canDownload)
  const [chosen, setChosen] = useState<string[]>(mine)
  const [perTask, setPerTask] = useState(50)
  const [withImages, setWithImages] = useState(true)
  const [busy, setBusy] = useState(false)
  const [prog, setProg] = useState<BankProgress | null>(null)
  const [added, setAdded] = useState<Record<string, number>>({})
  const [error, setError] = useState('')
  const abort = useRef<{ aborted: boolean }>({ aborted: false })

  const toggle = (id: string) =>
    setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]))

  async function run() {
    if (busy || !chosen.length) return
    setBusy(true)
    setError('')
    setAdded({})
    abort.current = { aborted: false }
    // Что уже лежит в банке — иначе повторная загрузка удвоила бы всё.
    const known = new Set((data.questions ?? []).map((q) => q.text))
    try {
      for (const sid of chosen) {
        if (abort.current.aborted) break
        const qs = await downloadSubject(sid, {
          perTask,
          withImages,
          known,
          onProgress: setProg,
          signal: abort.current,
        })
        // Складываем сразу после предмета: если следующий упадёт, этот уже сохранён.
        if (qs.length) addQuestions(qs)
        for (const q of qs) known.add(q.text)
        setAdded((a) => ({ ...a, [sid]: qs.length }))
      }
    } catch (e) {
      setError(humanError(e))
    }
    setProg(null)
    setBusy(false)
  }

  const totalAdded = Object.values(added).reduce((a, b) => a + b, 0)

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
        геометрии ещё и с чертежами. Всё складывается в твой банк и дальше работает без интернета.
        Займёт несколько минут: между запросами приложение выжидает паузу, чтобы не мешать сайту.
      </p>

      <div className="row wrap" style={{ gap: 8, marginBottom: 14 }}>
        {BANK_SUBJECTS.map((id) => (
          <button
            key={id}
            className={'chip' + (chosen.includes(id) ? ' on' : '')}
            disabled={busy}
            onClick={() => toggle(id)}
            style={chosen.includes(id) ? { borderColor: 'var(--accent)', background: 'var(--accent-soft)', color: 'var(--accent-text)' } : undefined}
          >
            {subjectById(id)?.emoji} {subjectById(id)?.short ?? id}
          </button>
        ))}
      </div>

      <div className="row wrap" style={{ gap: 16, marginBottom: 16 }}>
        <label className="small">
          Заданий на номер:{' '}
          <select className="input" style={{ width: 90, display: 'inline-block' }} value={perTask} disabled={busy} onChange={(e) => setPerTask(Number(e.target.value))}>
            <option value={20}>20</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
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
            подборка {prog.done} из {prog.total} · набрано {countOf(prog.got, ['задание', 'задания', 'заданий'])}
          </div>
        </div>
      )}

      {Object.entries(added).map(([sid, n]) => (
        <div key={sid} className="small" style={{ color: 'var(--accent-text)', marginBottom: 4 }}>
          <Check size={13} /> {subjectName(sid)}: {countOf(n, ['задание', 'задания', 'заданий'])}
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
            <Download size={16} /> Загрузить задания
          </button>
        )}
        <div className="spacer" />
        {!busy && totalAdded > 0 && onDone && (
          <button className="btn btn-primary" onClick={onDone}>Готово</button>
        )}
      </div>
    </div>
  )
}
