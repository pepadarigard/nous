import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { subjectById } from '../data/subjects'
import type { Block, StudyPlan } from '../types'
import { computeStats, motivate } from '../lib/stats'
import { estimateSubject, trustOf } from '../lib/score'
import { countOf } from '../lib/plural'
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts'
import { Flame, CalendarCheck, Target, Info } from 'lucide-react'

function fmtDay(iso: string) {
  const d = new Date(iso)
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`
}

function completionBySubject(plan?: StudyPlan): Record<string, { done: number; total: number }> {
  const by: Record<string, { done: number; total: number }> = {}
  if (!plan) return by
  plan.blocks.forEach((b: Block) => {
    const a = (by[b.subjectId] ||= { done: 0, total: 0 })
    b.lessons.forEach((l) => {
      a.total++
      if (l.done) a.done++
    })
  })
  return by
}

const axis = { stroke: '#9aa1ad', fontSize: 12 }
const tip = { background: '#fff', border: '1px solid #e7e9ee', borderRadius: 10, color: '#1b1e26' }
const WD = ['Пн', '', 'Ср', '', 'Пт', '', '']

/** Кольцо прогресса уровня: заполнение = доля XP внутри текущего уровня. Дорисовывается при открытии. */
function LevelRing({ level, pct }: { level: number; pct: number }) {
  const R = 54
  const C = 2 * Math.PI * R
  const target = Math.max(0.02, pct / 100) * C
  const [drawn, setDrawn] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setDrawn(true))
    return () => cancelAnimationFrame(id)
  }, [])
  const filled = drawn ? target : 0.02
  return (
    <svg className="lvl-ring" viewBox="0 0 130 130" width="132" height="132">
      <defs>
        <linearGradient id="ringG" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#2dd4bf" />
          <stop offset="100%" stopColor="#0d9488" />
        </linearGradient>
      </defs>
      <circle cx="65" cy="65" r={R} fill="none" stroke="#e8f4f2" strokeWidth="11" />
      <circle
        cx="65" cy="65" r={R} fill="none"
        stroke="url(#ringG)" strokeWidth="11" strokeLinecap="round"
        strokeDasharray={`${filled} ${C - filled}`}
        transform="rotate(-90 65 65)"
      />
      <text x="65" y="60" textAnchor="middle" className="ring-num">{level}</text>
      <text x="65" y="82" textAnchor="middle" className="ring-cap">уровень</text>
    </svg>
  )
}

export default function ProgressScreen() {
  const data = useStore((s) => s.data)
  const showEstimate = data.config.showEstimate !== false
  const st = computeStats(data)
  const mo = motivate(st)

  const events = [...data.progress].sort((a, b) => a.at.localeCompare(b.at))
  const lessonEvents = events.filter((e) => e.type === 'lesson_done')
  let cum = 0
  const cumMap: Record<string, number> = {}
  lessonEvents.forEach((e) => {
    cum++
    cumMap[fmtDay(e.at)] = cum
  })
  const cumSeries = Object.entries(cumMap).map(([date, count]) => ({ date, count }))

  const comp = completionBySubject(data.plan)
  // Балл считается по РЕШЁННОМУ в тренажёре, а не по отмеченным занятиям: галочка — это
  // самоотчёт, а попытка с вердиктом — измерение. Нет решений → нет и балла, врать не будем.
  const attempts = data.attempts ?? []
  const rows = data.goals.map((g) => {
    const c = comp[g.subjectId] || { done: 0, total: 0 }
    const frac = c.total ? c.done / c.total : 0
    const est = estimateSubject(g.subjectId, attempts)
    return {
      g,
      subj: subjectById(g.subjectId),
      done: c.done,
      total: c.total,
      pct: Math.round(frac * 100),
      est,
      trust: trustOf(est),
    }
  })
  const anyStaleScale = rows.some((r) => r.est?.scaleStale)

  return (
    <div className="fade-in">
      <div className="page-head">
        <h1>Твой прогресс 📈</h1>
        <p>{mo.emoji} {mo.title} {mo.sub}</p>
      </div>

      {/* Hero: уровень с кольцом + ключевые метрики */}
      <div className="card level-hero">
        <LevelRing level={st.level.level} pct={st.level.pct} />
        <div className="lh-mid">
          <div className="lh-kicker">Уровень {st.level.level}</div>
          <div className="lh-title">{st.level.title}</div>
          <div className="lh-xp">{st.xp} XP · до следующего уровня ещё <b>{st.level.toNext} XP</b></div>
          <div className="pbar" style={{ marginTop: 10, maxWidth: 340 }}><span style={{ width: `${st.level.pct}%` }} /></div>
        </div>
        <div className="lh-side">
          <div className="lh-metric">
            <div className="lh-m-ic" style={{ color: 'var(--warn)' }}><Flame size={16} /></div>
            <div><b>{st.streak}</b> дн. подряд<div className="small muted">рекорд {st.best}</div></div>
          </div>
          <div className="lh-metric">
            <div className="lh-m-ic" style={{ color: 'var(--accent)' }}><CalendarCheck size={16} /></div>
            <div><b>{st.thisWeek}</b> за 7 дней<div className="small" style={{ color: st.weekDelta >= 0 ? 'var(--success)' : 'var(--muted)' }}>{st.weekDelta >= 0 ? `+${st.weekDelta}` : st.weekDelta} к прошлой</div></div>
          </div>
          <div className="lh-metric">
            <div className="lh-m-ic" style={{ color: 'var(--accent)' }}><Target size={16} /></div>
            <div><b>{st.overallPct}%</b> плана<div className="small muted">{st.doneCount} из {st.totalCount}</div></div>
          </div>
        </div>
      </div>

      {/* Активность + кривая роста */}
      <div className="grid cols-2 stagger" style={{ margin: '16px 0 22px', alignItems: 'stretch' }}>
        <div className="card">
          <div className="row" style={{ marginBottom: 14 }}>
            <h3 style={{ margin: 0 }}>Твоя активность</h3>
            <div className="spacer" />
            <span className="small muted">13 недель</span>
          </div>
          <div className="heat-wrap">
            <div className="heat-days">
              {WD.map((w, i) => <div key={i} className="heat-day-lbl">{w}</div>)}
            </div>
            <div className="heat">
              {st.heat.map((col, ci) => (
                <div className="heat-col" key={ci} style={{ animationDelay: `${ci * 30}ms` }}>
                  {col.map((d, di) => (
                    <div key={di} className={`heat-cell l${d.lvl}${d.future ? ' fut' : ''}`} title={`${d.date}: ${d.count} зан.`} />
                  ))}
                </div>
              ))}
            </div>
          </div>
          <div className="heat-legend">
            <span className="small muted">меньше</span>
            <i className="heat-cell l0" /><i className="heat-cell l1" /><i className="heat-cell l2" /><i className="heat-cell l3" /><i className="heat-cell l4" />
            <span className="small muted">больше</span>
          </div>
        </div>

        <div className="card">
          <h3>Пройдено занятий (всего)</h3>
          {cumSeries.length === 0 ? (
            <div className="empty" style={{ padding: '34px 10px' }}><div className="big">🌱</div><p>Отметь первое занятие — график начнёт расти.</p></div>
          ) : (
            <ResponsiveContainer width="100%" height={205}>
              <AreaChart data={cumSeries} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0d9488" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#0d9488" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#eceef2" />
                <XAxis dataKey="date" {...axis} />
                <YAxis {...axis} allowDecimals={false} />
                <Tooltip contentStyle={tip} />
                <Area type="monotone" dataKey="count" stroke="#0d9488" strokeWidth={2.5} fill="url(#g1)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Достижения */}
      <div className="card" style={{ marginBottom: 22 }}>
        <div className="row" style={{ marginBottom: 14 }}>
          <h3 style={{ margin: 0 }}>Достижения</h3>
          <div className="spacer" />
          <span className="chip">{st.unlockedCount} / {st.achievements.length}</span>
        </div>
        <div className="ach-grid stagger">
          {st.achievements.map((a) => (
            <div className={'ach' + (a.unlocked ? ' on' : '')} key={a.id} title={a.desc}>
              <div className="ach-ic">{a.unlocked ? a.icon : '🔒'}</div>
              <div className="ach-tx">
                <b>{a.title}</b>
                <div className="small muted">{a.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* По предметам + честный балл */}
      {rows.length > 0 && (
        <>
          <h3 style={{ margin: '4px 0 12px' }}>По предметам</h3>
          <div className="info-banner" style={{ marginBottom: 16 }}>
            <Info size={16} className="ib-icon" />
            <div className="small">
              <div><b>Готовность</b> — какую часть плана по предмету ты уже прошёл.</div>
              {showEstimate && (
                <div style={{ marginTop: 3 }}>
                  <b>Балл</b> — из решённого в тренажёре: точность по каждому номеру задания умножается
                  на его вес в первичных баллах по спецификации ФИПИ, дальше — перевод по шкале.
                  Считается только по тем номерам, что ты решал, поэтому рядом всегда стоит покрытие.
                  Отмеченные занятия на балл не влияют: галочка — это обещание, а не результат.
                </div>
              )}
              {showEstimate && anyStaleScale && (
                <div style={{ marginTop: 3 }}>
                  ⚠️ По профильной математике структура ЕГЭ-2027 изменилась (20 заданий, 33 первичных балла),
                  а шкала перевода на 2027 год выйдет только весной. Пока считаем по шкале 2026 — балл там
                  самый грубый.
                </div>
              )}
            </div>
          </div>
          <div className="grid cols-2 stagger">
            {rows.map(({ g, subj, done: d, total: t, pct, est, trust }) => (
              <div className="card subj-card" key={g.subjectId}>
                <div className="subj-top">
                  <span className="subj-emoji">{subj?.emoji || '📘'}</span>
                  <div className="subj-name">
                    <b>{subj?.short || g.subjectId}</b>
                    <div className="small muted">{t ? `Пройдено ${d} из ${t} занятий` : 'План ещё не составлен'}</div>
                  </div>
                  {showEstimate &&
                    (est ? (
                      <div
                        className="score-badge"
                        title={`На проверенной части набрано ${est.earnedOnCovered.toFixed(1)} из ${est.maxPrimary} первичных баллов`}
                      >
                        <div className="score-num">≈{est.testScore}</div>
                        <div className="score-cap">балл</div>
                      </div>
                    ) : (
                      <div className="score-badge" title="Балл появится, когда порешаешь задания в тренажёре">
                        <div className="score-num muted">—</div>
                        <div className="score-cap">нет данных</div>
                      </div>
                    ))}
                </div>
                <div className="pbar big"><span style={{ width: `${pct}%` }} /></div>
                <div className="row small" style={{ marginTop: 7 }}>
                  <span className="muted">Готовность</span>
                  <div className="spacer" />
                  <b>{pct}%</b>
                </div>
                {showEstimate && est && (
                  <>
                    {/* Диапазон вместо одной цифры: слева — то, что уже доказано решениями,
                        справа — если непроверенная часть пойдёт так же. */}
                    <div className="score-scale">
                      <div className="scg"><span className="scg-n">{est.floorTest}</span><span className="scg-l">по решённому</span></div>
                      <div className="scg-arrow">→</div>
                      <div className="scg"><span className="scg-n accent">≈{est.testScore}</span><span className="scg-l">если так же дальше</span></div>
                      <div className="scg-arrow">→</div>
                      <div className="scg"><span className="scg-n">{g.target}</span><span className="scg-l">цель</span></div>
                    </div>
                    <div className="small muted" style={{ marginTop: 7 }}>
                      Проверено {Math.round(est.coverage * 100)}% работы · {countOf(est.attempts, ['решение', 'решения', 'решений'])}
                      {trust === 'weak' && <> · <b>данных мало, цифра пляшет</b></>}
                    </div>
                  </>
                )}
                {showEstimate && !est && (
                  <div className="small muted" style={{ marginTop: 7 }}>
                    Балла пока нет — он считается по решённым заданиям в тренажёре. Отметки в плане
                    его не двигают.
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
