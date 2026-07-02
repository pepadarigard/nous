import { useStore } from '../store'
import { subjectById } from '../data/subjects'
import type { Block, StudyPlan } from '../types'
import { computeStats, motivate } from '../lib/stats'
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts'
import { Flame, CheckCircle2, Trophy, CalendarCheck, Info } from 'lucide-react'

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
  // Честный приблизительный балл: старт + доля пройденного плана до цели. Никогда не выше цели.
  const rows = data.goals.map((g) => {
    const c = comp[g.subjectId] || { done: 0, total: 0 }
    const frac = c.total ? c.done / c.total : 0
    const est = Math.round(g.current + (g.target - g.current) * frac)
    return { g, subj: subjectById(g.subjectId), done: c.done, total: c.total, pct: Math.round(frac * 100), est }
  })

  return (
    <div className="fade-in">
      <div className="page-head">
        <h1>Твой прогресс 📈</h1>
        <p>Каждое отмеченное занятие — это XP, серия и шаг к цели. Смотри, как ты растёшь.</p>
      </div>

      {/* Мотивация */}
      <div className="motiv">
        <div className="motiv-emoji">{mo.emoji}</div>
        <div>
          <div className="motiv-title">{mo.title}</div>
          <div className="motiv-sub">{mo.sub}</div>
        </div>
      </div>

      {/* Уровень · Серия · Неделя · Готовность */}
      <div className="grid cols-4" style={{ margin: '16px 0 22px' }}>
        <div className="stat level-card">
          <div className="row" style={{ gap: 8, color: 'var(--accent)' }}><Trophy size={17} /><span className="lbl" style={{ margin: 0 }}>Уровень {st.level.level}</span></div>
          <div className="val" style={{ fontSize: 22 }}>{st.level.title}</div>
          <div className="pbar" style={{ marginTop: 10 }}><span style={{ width: `${st.level.pct}%` }} /></div>
          <div className="small muted" style={{ marginTop: 6 }}>{st.xp} XP · до {st.level.level + 1} ур. ещё {st.level.toNext}</div>
        </div>
        <div className="stat">
          <div className="row" style={{ gap: 8, color: 'var(--warn)' }}><Flame size={17} /><span className="lbl" style={{ margin: 0 }}>Серия дней</span></div>
          <div className="val">{st.streak} 🔥</div>
          <div className="small muted" style={{ marginTop: 6 }}>Рекорд: {st.best} дн.</div>
        </div>
        <div className="stat">
          <div className="row" style={{ gap: 8, color: 'var(--accent)' }}><CalendarCheck size={17} /><span className="lbl" style={{ margin: 0 }}>За 7 дней</span></div>
          <div className="val">{st.thisWeek}<span style={{ fontSize: 16, color: 'var(--muted)' }}> зан.</span></div>
          <div className="small" style={{ marginTop: 6, color: st.weekDelta >= 0 ? 'var(--success)' : 'var(--muted)' }}>
            {st.weekDelta >= 0 ? `+${st.weekDelta}` : st.weekDelta} к прошлой неделе
          </div>
        </div>
        <div className="stat">
          <div className="row" style={{ gap: 8, color: 'var(--accent)' }}><CheckCircle2 size={17} /><span className="lbl" style={{ margin: 0 }}>Общая готовность</span></div>
          <div className="val">{st.overallPct}%</div>
          <div className="small muted" style={{ marginTop: 6 }}>{st.doneCount} из {st.totalCount} занятий</div>
        </div>
      </div>

      {/* Тепловая карта активности */}
      <div className="card" style={{ marginBottom: 22 }}>
        <div className="row" style={{ marginBottom: 14 }}>
          <h3 style={{ margin: 0 }}>Твоя активность</h3>
          <div className="spacer" />
          <span className="small muted">последние 13 недель</span>
        </div>
        <div className="heat-wrap">
          <div className="heat-days">
            {WD.map((w, i) => <div key={i} className="heat-day-lbl">{w}</div>)}
          </div>
          <div className="heat">
            {st.heat.map((col, ci) => (
              <div className="heat-col" key={ci}>
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

      {/* Кривая роста */}
      {cumSeries.length > 0 && (
        <div className="card" style={{ marginBottom: 22 }}>
          <h3>Пройдено занятий (всего)</h3>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={cumSeries} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#0d9488" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#0d9488" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#eceef2" />
              <XAxis dataKey="date" {...axis} />
              <YAxis {...axis} />
              <Tooltip contentStyle={tip} />
              <Area type="monotone" dataKey="count" stroke="#0d9488" strokeWidth={2.5} fill="url(#g1)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Достижения */}
      <div className="card" style={{ marginBottom: 22 }}>
        <div className="row" style={{ marginBottom: 14 }}>
          <h3 style={{ margin: 0 }}>Достижения</h3>
          <div className="spacer" />
          <span className="small muted">{st.unlockedCount} / {st.achievements.length}</span>
        </div>
        <div className="ach-grid">
          {st.achievements.map((a) => (
            <div className={'ach' + (a.unlocked ? ' on' : '')} key={a.id}>
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
                  <b>Балл</b> — стартовый балл плюс доля пройденного пути к цели. Честный ориентир по прогрессу, а не гарантия результата ЕГЭ.
                </div>
              )}
            </div>
          </div>
          <div className="grid cols-2">
            {rows.map(({ g, subj, done: d, total: t, pct, est }) => (
              <div className="card subj-card" key={g.subjectId}>
                <div className="subj-top">
                  <span className="subj-emoji">{subj?.emoji || '📘'}</span>
                  <div className="subj-name">
                    <b>{subj?.short || g.subjectId}</b>
                    <div className="small muted">{t ? `Пройдено ${d} из ${t} занятий` : 'План ещё не составлен'}</div>
                  </div>
                  {showEstimate && (
                    <div className="score-badge" title="Приблизительный балл по прогрессу плана">
                      <div className="score-num">≈{est}</div>
                      <div className="score-cap">балл</div>
                    </div>
                  )}
                </div>
                <div className="pbar big"><span style={{ width: `${pct}%` }} /></div>
                <div className="row small" style={{ marginTop: 7 }}>
                  <span className="muted">Готовность</span>
                  <div className="spacer" />
                  <b>{pct}%</b>
                </div>
                {showEstimate && (
                  <div className="score-scale">
                    <div className="scg"><span className="scg-n">{g.current}</span><span className="scg-l">старт</span></div>
                    <div className="scg-arrow">→</div>
                    <div className="scg"><span className="scg-n accent">≈{est}</span><span className="scg-l">сейчас</span></div>
                    <div className="scg-arrow">→</div>
                    <div className="scg"><span className="scg-n">{g.target}</span><span className="scg-l">цель</span></div>
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
