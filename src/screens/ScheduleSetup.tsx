import { useMemo, useState } from 'react'
import { useStore } from '../store'
import { WEEKDAYS, subjectById } from '../data/subjects'
import { addDaysISO, buildAgenda, todayISO } from '../lib/schedule'
import type { SubjectSchedule } from '../types'
import { CalendarOff, Plus, Trash2, Info } from 'lucide-react'
import { plural } from '../lib/plural'

const onChip = { borderColor: 'var(--accent)', background: 'var(--accent-soft)', color: 'var(--accent-text)', fontWeight: 700 }

function fmt(dateISO: string): string {
  const d = new Date(dateISO)
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: '2-digit' })
}

/**
 * Правила расписания: в какие дни какой предмет, сколько занятий в день,
 * общий потолок нагрузки, выходные и каникулы. Всё применяется сразу.
 */
export default function ScheduleSetup() {
  const data = useStore((s) => s.data)
  const setSchedules = useStore((s) => s.setSchedules)
  const setRules = useStore((s) => s.setRules)

  const rules = data.rules ?? { daysOff: [], vacations: [] }
  const [vFrom, setVFrom] = useState('')
  const [vTo, setVTo] = useState('')
  const [vTitle, setVTitle] = useState('')
  const [dayOff, setDayOff] = useState('')

  const subjects = data.subjects.length ? data.subjects : data.schedules.map((s) => s.subjectId)

  function schOf(sid: string): SubjectSchedule {
    return data.schedules.find((s) => s.subjectId === sid) ?? { subjectId: sid, hoursPerWeek: 4, days: [1, 3, 5] }
  }
  function patchSch(sid: string, patch: Partial<SubjectSchedule>) {
    const exists = data.schedules.some((s) => s.subjectId === sid)
    const next = exists
      ? data.schedules.map((s) => (s.subjectId === sid ? { ...s, ...patch } : s))
      : [...data.schedules, { ...schOf(sid), ...patch }]
    setSchedules(next)
  }
  function toggleDay(sid: string, n: number) {
    const cur = schOf(sid).days ?? []
    const days = cur.includes(n) ? cur.filter((x) => x !== n) : [...cur, n].sort((a, b) => a - b)
    patchSch(sid, { days })
  }

  function addVacation() {
    if (!vFrom || !vTo) return
    const from = vFrom <= vTo ? vFrom : vTo
    const to = vFrom <= vTo ? vTo : vFrom
    setRules({ vacations: [...(rules.vacations ?? []), { id: 'vac_' + Date.now().toString(36), from, to, title: vTitle.trim() || undefined }] })
    setVFrom('')
    setVTo('')
    setVTitle('')
  }
  function removeVacation(id: string) {
    setRules({ vacations: (rules.vacations ?? []).filter((v) => v.id !== id) })
  }
  function addDayOff() {
    if (!dayOff || rules.daysOff?.includes(dayOff)) return
    setRules({ daysOff: [...(rules.daysOff ?? []), dayOff].sort() })
    setDayOff('')
  }
  function removeDayOff(d: string) {
    setRules({ daysOff: (rules.daysOff ?? []).filter((x) => x !== d) })
  }

  // Живой предпросмотр нагрузки на две недели вперёд — видно последствия правок сразу.
  const preview = useMemo(() => {
    if (!data.plan) return null
    const agenda = buildAgenda(data.plan, data.schedules, data.rules)
    const from = todayISO()
    const to = addDaysISO(from, 13)
    const days = agenda.filter((d) => d.dateISO >= from && d.dateISO <= to)
    const total = days.reduce((n, d) => n + d.items.length, 0)
    const busiest = days.reduce((mx, d) => Math.max(mx, d.items.length), 0)
    const last = agenda.length ? agenda[agenda.length - 1].dateISO : null
    // Правила могут перекрыть столько, что части занятий уже некуда встать.
    // Сказать об этом надо здесь — там же, где правила и задаются.
    const inPlan = data.plan.blocks.reduce((n, b) => n + b.lessons.length, 0)
    const unplaced = inPlan - agenda.reduce((n, d) => n + d.items.length, 0)
    return { total, busiest, workDays: days.length, last, unplaced }
  }, [data.plan, data.schedules, data.rules])

  return (
    <div>
      <p className="small muted" style={{ marginTop: 0 }}>
        Занятия плана раскладываются по этим правилам. Перенесённые руками занятия остаются на своих датах —
        правила их не двигают.
      </p>

      <div className="card soft" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Дни занятий</h3>
        {subjects.length === 0 && <p className="small muted" style={{ margin: 0 }}>Предметы появятся после создания плана.</p>}
        {subjects.map((sid) => {
          const s = subjectById(sid)
          const sch = schOf(sid)
          return (
            <div key={sid} className="sch-row">
              <div className="sch-name">
                <span style={{ fontSize: 18 }}>{s?.emoji ?? '📘'}</span>
                <b>{s?.short ?? sid}</b>
              </div>
              <div className="row wrap" style={{ gap: 5 }}>
                {WEEKDAYS.map((w) => (
                  <div
                    key={w.n}
                    className="chip"
                    style={{ cursor: 'pointer', padding: '5px 10px', ...(sch.days?.includes(w.n) ? onChip : {}) }}
                    onClick={() => toggleDay(sid, w.n)}
                    title={w.full}
                  >
                    {w.short}
                  </div>
                ))}
              </div>
              <label className="sch-perday">
                <span className="small muted">в день</span>
                <select
                  className="select"
                  value={String(sch.perDay ?? 1)}
                  onChange={(e) => patchSch(sid, { perDay: Number(e.target.value) })}
                  style={{ width: 62, padding: '6px 8px' }}
                >
                  {[1, 2, 3, 4].map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </label>
            </div>
          )
        })}
        {subjects.some((sid) => (schOf(sid).days ?? []).length === 0) && (
          <p className="small" style={{ color: 'var(--warn)', marginBottom: 0 }}>
            ⚠️ У предмета без выбранных дней занятия не попадут в календарь.
          </p>
        )}
      </div>

      <div className="card soft" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Нагрузка</h3>
        <label className="field" style={{ maxWidth: 320 }}>
          <span>Максимум занятий в день (по всем предметам)</span>
          <select
            className="select"
            value={String(rules.maxPerDay ?? 0)}
            onChange={(e) => setRules({ maxPerDay: Number(e.target.value) })}
          >
            <option value="0">Без ограничения</option>
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>{n} в день</option>
            ))}
          </select>
        </label>
        {preview && (
          <div className="info-banner" style={{ marginBottom: 0 }}>
            <Info size={16} color="var(--accent)" />
            <div className="small" style={{ flex: 1 }}>
              Ближайшие 2 недели: <b>{preview.total}</b>{' '}
              {plural(preview.total, ['занятие', 'занятия', 'занятий'])} в <b>{preview.workDays}</b>{' '}
              {plural(preview.workDays, ['дне', 'днях', 'днях'])}
              {preview.busiest > 0 && <> (самый плотный день — {preview.busiest})</>}.
              {preview.last && <> План заканчивается <b>{fmt(preview.last)}</b>.</>}
            </div>
          </div>
        )}
        {preview && preview.unplaced > 0 && (
          <div className="info-banner" style={{ marginTop: 10, marginBottom: 0, background: '#fff9ef', borderColor: '#f3dfb6' }}>
            <Info size={16} color="#c08a1e" />
            <div className="small" style={{ flex: 1 }}>
              <b>Не поместилось: {preview.unplaced}</b> — этим занятиям не нашлось дня. Верни дни
              недели, подними потолок или укороти каникулы.
            </div>
          </div>
        )}
      </div>

      <div className="card soft">
        <h3 style={{ marginTop: 0 }}>
          <CalendarOff size={16} style={{ verticalAlign: -2, marginRight: 6 }} />
          Выходные и каникулы
        </h3>
        <p className="small muted" style={{ marginTop: 0 }}>В эти дни занятия не ставятся — план сам сдвигается дальше.</p>

        <div className="row wrap" style={{ gap: 8, marginBottom: 10 }}>
          <input className="input" type="date" value={dayOff} onChange={(e) => setDayOff(e.target.value)} style={{ width: 170 }} />
          <button className="btn btn-sm" onClick={addDayOff} disabled={!dayOff}>
            <Plus size={14} /> Выходной
          </button>
        </div>
        {(rules.daysOff ?? []).length > 0 && (
          <div className="row wrap" style={{ gap: 6, marginBottom: 14 }}>
            {(rules.daysOff ?? []).map((d) => (
              <div key={d} className="chip" style={{ cursor: 'pointer' }} onClick={() => removeDayOff(d)} title="Убрать">
                {fmt(d)} ✕
              </div>
            ))}
          </div>
        )}

        <div className="row wrap" style={{ gap: 8, alignItems: 'flex-end' }}>
          <label className="field" style={{ marginBottom: 0 }}>
            <span className="small muted">с</span>
            <input className="input" type="date" value={vFrom} onChange={(e) => setVFrom(e.target.value)} style={{ width: 170 }} />
          </label>
          <label className="field" style={{ marginBottom: 0 }}>
            <span className="small muted">по</span>
            <input className="input" type="date" value={vTo} onChange={(e) => setVTo(e.target.value)} style={{ width: 170 }} />
          </label>
          <label className="field" style={{ marginBottom: 0, flex: 1, minWidth: 160 }}>
            <span className="small muted">название</span>
            <input className="input" value={vTitle} onChange={(e) => setVTitle(e.target.value)} placeholder="Каникулы, поездка…" />
          </label>
          <button className="btn btn-sm" onClick={addVacation} disabled={!vFrom || !vTo}>
            <Plus size={14} /> Добавить
          </button>
        </div>

        {(rules.vacations ?? []).length > 0 && (
          <div style={{ marginTop: 12 }}>
            {(rules.vacations ?? []).map((v) => (
              <div key={v.id} className="row" style={{ gap: 10, padding: '7px 0', borderTop: '1px solid var(--border)' }}>
                <span>🌴</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <b>{v.title || 'Каникулы'}</b>
                  <div className="small muted">{fmt(v.from)} — {fmt(v.to)}</div>
                </div>
                <button className="btn btn-ghost btn-sm" onClick={() => removeVacation(v.id)} title="Удалить">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
