// Справочник: то, во что заглядывают на две секунды и возвращаются к задаче.
//
// Данные для него в приложении лежали давно (data/reference.ts и data/theory),
// но показать их было негде: формулы жили в файле, теория открывалась только из
// карточки занятия. На настоящем экзамене по математике и физике справочные
// материалы выдают вместе с КИМ — значит, и готовиться надо с ними под рукой,
// а не вспоминая, где лежит нужная бумажка.
//
// Поиск идёт по всему сразу: ученик не помнит, формула это, ударение или
// теория к номеру, — он помнит слово.

import { useMemo, useState } from 'react'
import { useStore } from '../store'
import { REFERENCE } from '../data/reference'
import { THEORY } from '../data/theory'
import { EGE_TASKS, sectionsOf } from '../data/egeTasks'
import { SUBJECTS, subjectById } from '../data/subjects'
import { countOf } from '../lib/plural'
import { BookOpen, Search, Sigma } from 'lucide-react'

const selChip = { borderColor: 'var(--accent)', background: 'var(--accent-soft)', color: 'var(--accent-text)' }

/** Строка справочника, найденная поиском: откуда она и что в ней. */
interface Hit {
  where: string
  text: string
}

export default function Reference() {
  const mine = useStore((s) => s.data.subjects)
  const first = mine.find((id) => REFERENCE.some((r) => r.subjectId === id) || THEORY[id])
  const [subject, setSubject] = useState(first ?? 'russian')
  const [query, setQuery] = useState('')

  // Какие предметы вообще есть в справочнике. Свои предметы ученика идут
  // первыми, но остальные не прячем: он мог ещё не настроить список.
  const available = useMemo(() => {
    const ids = SUBJECTS.map((s) => s.id).filter((id) => REFERENCE.some((r) => r.subjectId === id) || THEORY[id])
    return [...ids].sort((a, b) => Number(mine.includes(b)) - Number(mine.includes(a)))
  }, [mine])

  const docs = REFERENCE.filter((r) => !r.subjectId || r.subjectId === subject)
  const theory = THEORY[subject]
  const tasks = EGE_TASKS[subject] ?? []

  // Поиск по всему сразу — и по формулам, и по теории к номерам.
  const hits = useMemo<Hit[]>(() => {
    const q = query.trim().toLowerCase()
    if (q.length < 2) return []
    const out: Hit[] = []
    for (const doc of REFERENCE) {
      for (const sec of doc.sections) {
        for (const line of sec.lines) {
          if (line.toLowerCase().includes(q)) out.push({ where: doc.title + ' · ' + sec.title, text: line })
        }
      }
    }
    for (const [sid, byNo] of Object.entries(THEORY)) {
      for (const [no, t] of Object.entries(byNo)) {
        const parts = [t.rule, t.learn ?? '', ...(t.steps ?? []), ...(t.traps ?? [])]
        const hit = parts.find((p) => p.toLowerCase().includes(q))
        if (hit) {
          out.push({
            where: (subjectById(sid)?.short ?? sid) + ' · задание №' + no,
            text: hit,
          })
        }
      }
    }
    return out.slice(0, 60)
  }, [query])

  return (
    <div className="fade-in">
      <div className="page-head">
        <h1>Справочник</h1>
        <p>
          Формулы, ударения и разбор каждого номера — офлайн и без ИИ. На экзамене по математике и
          физике справочные материалы выдают вместе с работой, так что пользоваться ими не
          стыдно: стыдно не знать, где они лежат.
        </p>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row wrap" style={{ gap: 10 }}>
          <Search size={16} className="muted" />
          <input
            className="input"
            style={{ flex: 1, minWidth: 200 }}
            placeholder="Искать формулу, слово, правило…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {query.trim().length >= 2 && (
          <div style={{ marginTop: 12 }}>
            <div className="small muted" style={{ marginBottom: 6 }}>
              {hits.length ? 'Нашлось: ' + countOf(hits.length, ['строка', 'строки', 'строк']) : 'Ничего не нашлось'}
            </div>
            {hits.map((h, i) => (
              <div key={i} style={{ padding: '6px 0', borderTop: '1px solid var(--line)' }}>
                <div className="small muted">{h.where}</div>
                <div>{h.text}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {query.trim().length < 2 && (
        <>
          <div className="row wrap" style={{ gap: 8, marginBottom: 16 }}>
            {available.map((id) => (
              <div
                key={id}
                className="chip"
                style={{ cursor: 'pointer', ...(subject === id ? selChip : {}) }}
                onClick={() => setSubject(id)}
              >
                {subjectById(id)?.emoji} {subjectById(id)?.short ?? id}
              </div>
            ))}
          </div>

          {docs.map((doc) => (
            <details className="card" key={doc.id} style={{ marginBottom: 12 }}>
              <summary style={{ cursor: 'pointer' }}>
                <b><Sigma size={14} /> {doc.title}</b>
                <div className="small muted" style={{ marginTop: 4 }}>{doc.summary}</div>
              </summary>
              <div style={{ marginTop: 12 }}>
                {doc.sections.map((sec) => (
                  <div key={sec.title} style={{ marginBottom: 14 }}>
                    <b className="small">{sec.title}</b>
                    <ul className="small" style={{ marginTop: 6 }}>
                      {sec.lines.map((line, i) => <li key={i}>{line}</li>)}
                    </ul>
                  </div>
                ))}
              </div>
            </details>
          ))}

          {theory && (
            <div className="card">
              <div className="row" style={{ marginBottom: 4 }}>
                <h3 style={{ margin: 0 }}><BookOpen size={16} /> Как решать каждый номер</h3>
                <div className="spacer" />
                <span className="small muted">
                  разобрано {Object.keys(theory).length} из {tasks.length}
                </span>
              </div>
              <p className="small muted" style={{ marginTop: 0 }}>
                Это шпаргалка, а не учебник: правило, порядок действий и то, на чём теряют балл.
              </p>
              {sectionsOf(subject).map((sec) => {
                const rows = sec.tasks.filter((no) => theory[no])
                if (!rows.length) return null
                return (
                  <div key={sec.section} style={{ marginTop: 14 }}>
                    <b className="small" style={{ color: 'var(--accent-text)' }}>{sec.section}</b>
                    {rows.map((no) => {
                      const t = theory[no]
                      const title = tasks.find((x) => x.no === no)?.title ?? ''
                      return (
                        <details key={no} style={{ padding: '7px 0', borderTop: '1px solid var(--line)' }}>
                          <summary style={{ cursor: 'pointer' }}>
                            <b>№{no}</b> <span className="small">{title}</span>
                          </summary>
                          <div style={{ marginTop: 8 }}>
                            <div>{t.rule}</div>
                            {t.learn && (
                              <div className="small" style={{ marginTop: 6 }}>
                                <b>Выучить:</b> {t.learn}
                              </div>
                            )}
                            {t.steps && t.steps.length > 0 && (
                              <>
                                <b className="small" style={{ display: 'block', marginTop: 8 }}>Порядок действий</b>
                                <ol className="small">{t.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
                              </>
                            )}
                            {t.traps && t.traps.length > 0 && (
                              <>
                                <b className="small" style={{ display: 'block', marginTop: 4 }}>Где теряют балл</b>
                                <ul className="small">{t.traps.map((s, i) => <li key={i}>{s}</li>)}</ul>
                              </>
                            )}
                          </div>
                        </details>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}
