import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store'
import { SUBJECTS } from '../data/subjects'
import { EGE_TASKS } from '../data/egeTasks'
import type { SolutionReview } from '../types'
import { checkSolution, findCriteria } from '../lib/aiTutor'
import { aiReady } from '../lib/providers'
import { humanError, loadMaterialText } from '../lib/api'
import { mdToHtml } from '../lib/md'
import { AlertTriangle, Check, Loader2, ScrollText, Sparkles } from 'lucide-react'

/**
 * Проверка развёрнутого ответа (сочинение, задача с решением) по критериям.
 * Единственное место, где без ИИ никак: короткий ответ приложение сверяет само,
 * а развёрнутый оценить по критериям может только модель.
 */
export default function SolutionCheck() {
  const data = useStore((s) => s.data)
  const recordAttempt = useStore((s) => s.recordAttempt)

  const part2 = useMemo(() => {
    const map: Record<string, number[]> = {}
    for (const [sid, tasks] of Object.entries(EGE_TASKS)) map[sid] = tasks.filter((t) => t.part2).map((t) => t.no)
    return map
  }, [])

  const subjects = data.subjects.length ? data.subjects : Object.keys(EGE_TASKS)
  const [subjectId, setSubjectId] = useState(subjects[0])
  const [taskNo, setTaskNo] = useState<number | undefined>(part2[subjects[0]]?.[0])
  const [task, setTask] = useState('')
  const [solution, setSolution] = useState('')
  const [materialId, setMaterialId] = useState('')
  const [criteria, setCriteria] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [review, setReview] = useState<SolutionReview | null>(null)

  const ready = aiReady(data.config)
  const nos = part2[subjectId] ?? []
  const materials = (data.materials ?? []).filter((m) => m.chars)

  // Критерии берём из материалов ученика: в демоверсиях ФИПИ они есть, и это точнее памяти модели.
  useEffect(() => {
    let alive = true
    if (!materialId) {
      setCriteria(undefined)
      return
    }
    loadMaterialText(materialId).then((t) => {
      if (alive) setCriteria(t ? findCriteria(t, taskNo) : undefined)
    })
    return () => { alive = false }
  }, [materialId, taskNo])

  async function run() {
    if (!solution.trim() || busy) return
    setBusy(true)
    setError('')
    setReview(null)
    try {
      const res = await checkSolution(data.config, { subjectId, taskNo, task, solution, criteria })
      setReview(res)
      recordAttempt({
        questionId: 'free_' + subjectId + '_' + (taskNo ?? 0),
        subjectId,
        taskNo,
        answer: solution.slice(0, 400),
        correct: res.max > 0 ? res.score >= res.max * 0.7 : null,
        score: res.score,
        maxScore: res.max,
      })
    } catch (e) {
      setError(humanError(e))
    }
    setBusy(false)
  }

  return (
    <div className="grid" style={{ gap: 16, maxWidth: 860 }}>
      <div className="card">
        <div className="row" style={{ gap: 10, marginBottom: 8 }}>
          <ScrollText size={17} color="var(--accent)" />
          <b>Развёрнутый ответ</b>
        </div>
        <p className="small muted" style={{ marginTop: 0 }}>
          Сочинение, задача с решением, обоснование — то, что нельзя сверить с эталоном.
          ИИ разбирает ответ по критериям и показывает, где теряются баллы.
        </p>

        <div className="row wrap" style={{ gap: 10 }}>
          <label className="field" style={{ marginBottom: 0, maxWidth: 230 }}>
            <span>Предмет</span>
            <select
              className="select"
              value={subjectId}
              onChange={(e) => {
                setSubjectId(e.target.value)
                setTaskNo(part2[e.target.value]?.[0])
              }}
            >
              {SUBJECTS.filter((s) => subjects.includes(s.id)).map((s) => (
                <option key={s.id} value={s.id}>{s.emoji} {s.short}</option>
              ))}
            </select>
          </label>
          <label className="field" style={{ marginBottom: 0, maxWidth: 260 }}>
            <span>Задание</span>
            <select className="select" value={taskNo ?? ''} onChange={(e) => setTaskNo(e.target.value ? Number(e.target.value) : undefined)}>
              <option value="">без номера</option>
              {nos.map((n) => (
                <option key={n} value={n}>№{n} — {EGE_TASKS[subjectId]?.find((t) => t.no === n)?.title}</option>
              ))}
            </select>
          </label>
          {materials.length > 0 && (
            <label className="field" style={{ marginBottom: 0, flex: 1, minWidth: 220 }}>
              <span>Критерии из материала {criteria ? '✓ нашлись' : ''}</span>
              <select className="select" value={materialId} onChange={(e) => setMaterialId(e.target.value)}>
                <option value="">по памяти модели</option>
                {materials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </label>
          )}
        </div>

        <label className="field" style={{ marginTop: 12 }}>
          <span>Условие задания (можно вставить текст или оставить пустым)</span>
          <textarea className="input" rows={3} value={task} onChange={(e) => setTask(e.target.value)} placeholder="Например: текст для сочинения или условие задачи…" />
        </label>
        <label className="field">
          <span>Твой ответ</span>
          <textarea
            className="input"
            rows={10}
            value={solution}
            onChange={(e) => setSolution(e.target.value)}
            placeholder="Впиши своё решение или сочинение целиком, как написал бы на экзамене…"
          />
        </label>

        <div className="row wrap" style={{ gap: 10 }}>
          <button className="btn btn-primary" disabled={!solution.trim() || busy || !ready} onClick={run}>
            {busy ? <><Loader2 size={15} className="spin-ic" /> Проверяю…</> : <><Sparkles size={15} /> Проверить по критериям</>}
          </button>
          <span className="small muted">{solution.trim().split(/\s+/).filter(Boolean).length} слов</span>
          {!ready && <span className="small" style={{ color: 'var(--warn)' }}>Нужен ИИ: в Настройках выбери провайдера или локальную модель.</span>}
        </div>
        {error && <p className="small" style={{ color: 'var(--danger)' }}>{error}</p>}
      </div>

      {review && <ReviewCard review={review} />}
    </div>
  )
}

function ReviewCard({ review }: { review: SolutionReview }) {
  const pct = review.max ? Math.round((review.score / review.max) * 100) : 0
  const color = pct >= 80 ? 'var(--success)' : pct >= 50 ? 'var(--warn)' : 'var(--danger)'
  return (
    <div className="card">
      <div className="row wrap" style={{ gap: 12, marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>Разбор</h3>
        <div className="spacer" />
        <span className="chip" style={{ borderColor: color, color, fontWeight: 700 }}>
          {review.score} из {review.max} баллов
        </span>
      </div>

      {review.uncertain && (
        <div className="info-banner" style={{ marginBottom: 12 }}>
          <AlertTriangle size={16} color="var(--warn)" />
          <div className="small" style={{ flex: 1 }}>
            Модель не уверена в точных критериях этого задания — сверься с официальными критериями ФИПИ.
            Если они есть в твоих материалах, выбери файл в поле «Критерии из материала».
          </div>
        </div>
      )}

      {review.criteria.map((c, i) => (
        <div key={i} className="row wrap" style={{ gap: 10, padding: '8px 0', borderTop: i ? '1px solid var(--border)' : 'none' }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <b className="small">{c.name}</b>
            {c.comment && <div className="small muted" style={{ marginTop: 2 }}>{c.comment}</div>}
          </div>
          <span className="chip" style={{ color: c.got >= c.max ? 'var(--success)' : c.got > 0 ? 'var(--warn)' : 'var(--danger)' }}>
            {c.got} / {c.max}
          </span>
        </div>
      ))}

      {review.errors.length > 0 && (
        <div className="card soft" style={{ marginTop: 14 }}>
          <b className="small">Где потерял баллы</b>
          <ul className="small" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {review.errors.map((e, i) => <li key={i} style={{ marginBottom: 4 }}>{e}</li>)}
          </ul>
        </div>
      )}
      {review.strengths.length > 0 && (
        <div className="card soft" style={{ marginTop: 10 }}>
          <b className="small">Что засчитано</b>
          <ul className="small" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {review.strengths.map((e, i) => <li key={i} style={{ marginBottom: 4 }}><Check size={12} style={{ verticalAlign: -1, color: 'var(--success)' }} /> {e}</li>)}
          </ul>
        </div>
      )}
      {review.advice && (
        <div className="md-body" style={{ marginTop: 14 }} dangerouslySetInnerHTML={{ __html: mdToHtml(review.advice) }} />
      )}
    </div>
  )
}
