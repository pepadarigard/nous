import { useState } from 'react'
import { useStore } from '../store'
import { SUBJECTS, WEEKDAYS, subjectName } from '../data/subjects'
import { checkApiKey, humanError, isTauri, openExternal } from '../lib/api'
import PlanImporter from './PlanImporter'
import { Check, KeyRound, ArrowRight, ArrowLeft, Target, Sparkles } from 'lucide-react'

type Step = 'setup' | 'subjects' | 'goals' | 'schedule' | 'questions' | 'import'
const STEPS: Step[] = ['setup', 'subjects', 'goals', 'schedule', 'questions', 'import']
const QUESTIONS = [
  'Как думаешь, какой у тебя сейчас уровень по этим предметам? (с нуля / база есть / хорошо, но надо подтянуть)',
  'С чего хочешь начать — что важнее подтянуть в первую очередь?',
  'Какие темы или типы заданий даются тяжелее всего?',
  'Есть ли пожелания к плану — темп, формат, что избегать?',
]

export default function Onboarding() {
  const store = useStore()
  const [step, setStep] = useState<Step>('setup')

  const [apiKey, setApiKey] = useState(store.data.config.apiKey)
  const [textModel, setTextModel] = useState(store.data.config.textModel)
  const [checking, setChecking] = useState(false)
  const [checkMsg, setCheckMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const [name, setName] = useState(store.data.studentName || '')
  const [sel, setSel] = useState<string[]>(store.data.subjects)
  const [goals, setGoalsState] = useState<Record<string, { current: string; target: string }>>({})
  const [hours, setHours] = useState<Record<string, string>>({})
  const [days, setDays] = useState<Record<string, number[]>>({})
  const [examDate, setExamDate] = useState(store.data.examDate || '')
  const [answers, setAnswers] = useState<Record<number, string>>({})

  const stepIndex = STEPS.indexOf(step)

  async function doCheck() {
    setChecking(true)
    setCheckMsg(null)
    const r = await checkApiKey(apiKey)
    setChecking(false)
    setCheckMsg(r.ok ? { ok: true, text: `Ключ рабочий! Моделей: ${r.models?.length ?? '?'}` } : { ok: false, text: humanError(r.error || 'Ключ не подошёл') })
  }
  function toggleSubject(id: string) {
    setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  }
  function toggleDay(sid: string, n: number) {
    setDays((d) => {
      const cur = d[sid] || []
      return { ...d, [sid]: cur.includes(n) ? cur.filter((x) => x !== n) : [...cur, n].sort() }
    })
  }
  function setGoalField(id: string, field: 'current' | 'target', val: string) {
    const clean = val.replace(/[^0-9]/g, '').slice(0, 3) // разрешаем пустое, только цифры
    setGoalsState((g) => {
      const prev = g[id] ?? { current: '50', target: '80' }
      return { ...g, [id]: { ...prev, [field]: clean } }
    })
  }
  function goalNum(id: string, field: 'current' | 'target', fallback: number): number {
    const v = goals[id]?.[field]
    if (v === undefined || v === '') return fallback
    return Math.max(0, Math.min(100, Number(v)))
  }

  function saveSetupAndNext() {
    store.setConfig({ apiKey, textModel })
    setStep('subjects')
  }
  function saveSubjectsAndNext() {
    store.setStudentName(name)
    store.setSubjects(sel)
    setStep('goals')
  }
  function saveGoalsAndNext() {
    store.setGoals(sel.map((id) => ({ subjectId: id, current: goalNum(id, 'current', 50), target: goalNum(id, 'target', 80) })))
    setStep('schedule')
  }
  function saveScheduleAndNext() {
    store.setSchedules(sel.map((id) => ({ subjectId: id, hoursPerWeek: Number(hours[id]) || 4, days: days[id] ?? [1, 3, 5] })))
    store.setExamDate(examDate || undefined)
    setStep('questions')
  }
  function saveQuestionsAndNext() {
    const notes = QUESTIONS.map((q, i) => (answers[i]?.trim() ? `${q} — ${answers[i].trim()}` : '')).filter(Boolean).join('; ')
    store.setPlanNotes(notes)
    setStep('import')
  }

  return (
    <div className="center-wrap">
      <div className="onb-card fade-in">
        <div className="stepper">
          {STEPS.map((s, i) => (
            <div key={s} className={'dot' + (i <= stepIndex ? ' on' : '')} />
          ))}
        </div>

        {step === 'setup' && (
          <div className="fade-in">
            <div className="row" style={{ gap: 12, marginBottom: 6 }}>
              <div className="brand" style={{ padding: 0 }}>
                <div className="logo">🎓</div>
              </div>
              <h1 style={{ margin: 0, fontSize: 24 }}>Настройка ИИ</h1>
            </div>
            <p className="muted" style={{ marginTop: 0 }}>
              Наш ИИ раскладывает план и отвечает в чате. Работает на твоём ключе Groq. Получить бесплатный:{' '}
              <a href="https://console.groq.com/keys" onClick={(e) => { e.preventDefault(); openExternal('https://console.groq.com/keys') }}>
                console.groq.com/keys
              </a>
            </p>
            <label className="field">
              <span><KeyRound size={13} style={{ verticalAlign: -2, marginRight: 5 }} />API-ключ Groq</span>
              <input className="input" type="password" placeholder="gsk_..." value={apiKey} onChange={(e) => { setApiKey(e.target.value); setCheckMsg(null) }} />
            </label>
            <label className="field">
              <span>Модель ИИ</span>
              <select className="select" value={textModel} onChange={(e) => setTextModel(e.target.value)}>
                <option value="qwen/qwen3-32b">Qwen3 32B — умная и надёжная (рекомендуется)</option>
                <option value="qwen/qwen3.6-27b">Qwen3.6 27B — новее, быстрее</option>
              </select>
            </label>
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn btn-ghost" onClick={doCheck} disabled={!apiKey || checking}>{checking ? 'Проверяю…' : 'Проверить ключ'}</button>
              {checkMsg && <span className="small" style={{ color: checkMsg.ok ? 'var(--success)' : 'var(--danger)' }}>{checkMsg.ok ? '✓ ' : '✕ '}{checkMsg.text}</span>}
            </div>
            <div className="divider" />
            <div className="row">
              <div className="spacer" />
              <button className="btn btn-primary btn-lg" disabled={!apiKey.trim()} onClick={saveSetupAndNext}>Продолжить <ArrowRight size={17} /></button>
            </div>
            {!isTauri && <p className="small muted" style={{ marginTop: 14 }}>Ты в браузере (разработка): вставь план в формате JSON — разложится и без ключа.</p>}
          </div>
        )}

        {step === 'subjects' && (
          <div className="fade-in">
            <h1 style={{ fontSize: 24 }}>Кто ты и что сдаёшь?</h1>
            <p className="muted" style={{ marginTop: 0 }}>Это нужно, чтобы собрать точный промт для ИИ.</p>
            <label className="field">
              <span>Как тебя зовут? (необязательно)</span>
              <input className="input" placeholder="Имя" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <div className="grid cols-2">
              {SUBJECTS.map((s) => (
                <div key={s.id} className={'subject-card' + (sel.includes(s.id) ? ' sel' : '')} onClick={() => toggleSubject(s.id)}>
                  <span className="emoji">{s.emoji}</span>
                  <div>
                    <div style={{ fontWeight: 700 }}>{s.short}</div>
                    <div className="small muted">{s.name}</div>
                  </div>
                  <div className="check">{sel.includes(s.id) && <Check size={14} />}</div>
                </div>
              ))}
            </div>
            <div className="divider" />
            <div className="row">
              <button className="btn btn-ghost" onClick={() => setStep('setup')}><ArrowLeft size={16} /> Назад</button>
              <div className="spacer" />
              <span className="muted small">{sel.length} выбрано</span>
              <button className="btn btn-primary btn-lg" disabled={!sel.length} onClick={saveSubjectsAndNext}>Далее <ArrowRight size={17} /></button>
            </div>
          </div>
        )}

        {step === 'goals' && (
          <div className="fade-in">
            <div className="row" style={{ gap: 10, marginBottom: 2 }}>
              <Target size={22} color="var(--accent)" />
              <h1 style={{ fontSize: 24, margin: 0 }}>Твои баллы и цели</h1>
            </div>
            <p className="muted" style={{ marginTop: 6 }}>На сколько баллов пишешь пробники <b>сейчас</b> и на сколько <b>хочешь</b> выйти (0–100).</p>
            {sel.map((id) => {
              const curStr = goals[id]?.current ?? '50'
              const tgtStr = goals[id]?.target ?? '80'
              const cur = goalNum(id, 'current', 50)
              const tgt = goalNum(id, 'target', 80)
              return (
                <div className="card soft" key={id} style={{ marginBottom: 12 }}>
                  <div className="row" style={{ marginBottom: 12 }}><b>{subjectName(id)}</b></div>
                  <div className="row wrap" style={{ gap: 18 }}>
                    <label style={{ margin: 0 }}>
                      <div className="small muted" style={{ marginBottom: 6 }}>Сейчас, баллов</div>
                      <input className="input" type="number" min={0} max={100} value={curStr} onChange={(e) => setGoalField(id, 'current', e.target.value)} style={{ width: 110 }} />
                    </label>
                    <span style={{ fontSize: 22, color: 'var(--muted)', alignSelf: 'flex-end', paddingBottom: 8 }}>→</span>
                    <label style={{ margin: 0 }}>
                      <div className="small muted" style={{ marginBottom: 6 }}>Цель, баллов</div>
                      <input className="input" type="number" min={0} max={100} value={tgtStr} onChange={(e) => setGoalField(id, 'target', e.target.value)} style={{ width: 110 }} />
                    </label>
                    <div className="spacer" />
                    {tgt > cur && <span className="chip" style={{ alignSelf: 'flex-end' }}>рост +{tgt - cur}</span>}
                  </div>
                </div>
              )
            })}
            <div className="divider" />
            <div className="row">
              <button className="btn btn-ghost" onClick={() => setStep('subjects')}><ArrowLeft size={16} /> Назад</button>
              <div className="spacer" />
              <button className="btn btn-primary btn-lg" onClick={saveGoalsAndNext}>Далее <ArrowRight size={17} /></button>
            </div>
          </div>
        )}

        {step === 'schedule' && (
          <div className="fade-in">
            <h1 style={{ fontSize: 24 }}>Сколько времени готов уделять?</h1>
            <p className="muted" style={{ marginTop: 0 }}>Дни и нагрузка — на них ляжет план в календаре.</p>
            <label className="field">
              <span>Дата ближайшего экзамена (необязательно)</span>
              <input className="input" type="date" value={examDate} onChange={(e) => setExamDate(e.target.value)} style={{ maxWidth: 220 }} />
            </label>
            {sel.map((id) => (
              <div className="card soft" key={id} style={{ marginBottom: 12 }}>
                <div className="row" style={{ marginBottom: 12 }}>
                  <b>{subjectName(id)}</b>
                  <div className="spacer" />
                  <div className="row" style={{ gap: 6 }}>
                    <span className="muted small">часов/нед:</span>
                    <input className="input" type="number" min={1} max={40} value={hours[id] ?? '4'} onChange={(e) => setHours((h) => ({ ...h, [id]: e.target.value.replace(/[^0-9]/g, '').slice(0, 2) }))} style={{ width: 74, padding: '8px 10px' }} />
                  </div>
                </div>
                <div className="row wrap" style={{ gap: 6 }}>
                  {WEEKDAYS.map((w) => {
                    const on = (days[id] || []).includes(w.n)
                    return (
                      <div key={w.n} className="chip" style={{ cursor: 'pointer', ...(on ? { borderColor: 'var(--accent)', background: 'var(--accent-soft)', color: 'var(--accent-text)' } : {}) }} onClick={() => toggleDay(id, w.n)}>{w.short}</div>
                    )
                  })}
                </div>
              </div>
            ))}
            <div className="divider" />
            <div className="row">
              <button className="btn btn-ghost" onClick={() => setStep('goals')}><ArrowLeft size={16} /> Назад</button>
              <div className="spacer" />
              <button className="btn btn-primary btn-lg" onClick={saveScheduleAndNext}>Далее <ArrowRight size={17} /></button>
            </div>
          </div>
        )}

        {step === 'questions' && (
          <div className="fade-in">
            <div className="row" style={{ gap: 10, marginBottom: 2 }}>
              <Sparkles size={22} color="var(--accent)" />
              <h1 style={{ fontSize: 23, margin: 0 }}>Пара вопросов для точности</h1>
            </div>
            <p className="muted" style={{ marginTop: 6 }}>Ответь коротко — эти ответы пойдут в промт, чтобы ИИ составил план точнее. Любой можно пропустить.</p>
            {QUESTIONS.map((qq, i) => (
              <label className="field" key={i}>
                <span>{qq}</span>
                <input className="input" value={answers[i] || ''} onChange={(e) => setAnswers((a) => ({ ...a, [i]: e.target.value }))} placeholder="Твой ответ…" />
              </label>
            ))}
            <div className="divider" />
            <div className="row">
              <button className="btn btn-ghost" onClick={() => setStep('schedule')}><ArrowLeft size={16} /> Назад</button>
              <div className="spacer" />
              <button className="btn btn-primary btn-lg" onClick={saveQuestionsAndNext}>К плану <ArrowRight size={17} /></button>
            </div>
          </div>
        )}

        {step === 'import' && (
          <div className="fade-in">
            <div className="row" style={{ gap: 10, marginBottom: 2 }}>
              <Sparkles size={22} color="var(--accent)" />
              <h1 style={{ fontSize: 23, margin: 0 }}>Получи план от ИИ</h1>
            </div>
            <p className="muted" style={{ marginTop: 6, marginBottom: 18 }}>Скопируй готовый промт → вставь в ChatGPT/DeepSeek → верни ответ сюда.</p>
            <PlanImporter onDone={() => store.finishOnboarding()} />
            <div className="divider" />
            <button className="btn btn-ghost" onClick={() => setStep('questions')}><ArrowLeft size={16} /> Назад</button>
          </div>
        )}
      </div>
    </div>
  )
}
