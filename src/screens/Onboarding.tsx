import { useState } from 'react'
import { useStore } from '../store'
import { SUBJECTS, WEEKDAYS, subjectName } from '../data/subjects'
import { checkApiKey, humanError, isTauri, openExternal } from '../lib/api'
import { modelLabel, pickBestModel } from '../lib/models'
import { PROVIDERS } from '../lib/providers'
import type { Provider } from '../types'
import { EGE_YEAR, EXAM_DATE_DEFAULT } from '../data/ege2027'
import PlanImporter from './PlanImporter'
import { Check, KeyRound, ArrowRight, ArrowLeft, Target, Sparkles } from 'lucide-react'

type Step = 'welcome' | 'setup' | 'subjects' | 'goals' | 'schedule' | 'questions' | 'import'
const STEPS: Step[] = ['welcome', 'setup', 'subjects', 'goals', 'schedule', 'questions', 'import']
// Точки прогресса — без приветственного экрана.
const DOT_STEPS = STEPS.filter((s) => s !== 'welcome')

export default function Onboarding() {
  const store = useStore()
  const [step, setStep] = useState<Step>('welcome')

  // OpenRouter по умолчанию — работает в России без VPN (Groq для тех, у кого VPN есть).
  const [prov, setProv] = useState<Provider>(store.data.config.provider ?? 'openrouter')
  const [keys, setKeys] = useState<Record<Provider, string>>({
    groq: store.data.config.apiKey || '',
    openrouter: store.data.config.apiKeyOr || '',
    cerebras: store.data.config.apiKeyCb || '',
    gigachat: store.data.config.apiKeyGc || '',
  })
  const apiKey = keys[prov]
  const pInfo = PROVIDERS[prov]
  const setApiKey = (v: string) => setKeys((k) => ({ ...k, [prov]: v }))
  const [textModel, setTextModel] = useState(store.data.config.textModel)
  const [pickedFor, setPickedFor] = useState<Provider | null>(null) // для какого провайдера подобрана textModel
  const [checking, setChecking] = useState(false)
  const [checkMsg, setCheckMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const [name, setName] = useState(store.data.studentName || '')
  const [sel, setSel] = useState<string[]>(store.data.subjects)
  const [goals, setGoalsState] = useState<Record<string, { current: string; target: string }>>({})
  const [hours, setHours] = useState<Record<string, string>>({})
  const [days, setDays] = useState<Record<string, number[]>>({})
  // Вопросы по каждому предмету: уровень/слабые места + пожелания; и общие пожелания к плану.
  const [subjAnswers, setSubjAnswers] = useState<Record<string, { level: string; wish: string }>>({})
  const [commonWish, setCommonWish] = useState('')


  async function doCheck() {
    setChecking(true)
    setCheckMsg(null)
    const r = await checkApiKey(apiKey, prov)
    setChecking(false)
    if (r.ok) {
      // Сразу подбираем самую сильную модель из доступных у провайдера (для OpenRouter — из бесплатных).
      const best = r.models?.length ? pickBestModel(r.models, prov) : null
      if (best) {
        setTextModel(best)
        setPickedFor(prov)
      }
      const label = best ? modelLabel(best).label : null
      setCheckMsg({ ok: true, text: `Ключ рабочий!${label ? ` Модель: ${label} (самая сильная из доступных)` : ''}` })
    } else {
      setCheckMsg({ ok: false, text: humanError(r.error || 'Ключ не подошёл') })
    }
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

  async function saveSetupAndNext() {
    // Модель считается подобранной, только если её выбирали под ТЕКУЩЕГО провайдера.
    let model = pickedFor === prov ? textModel : ''
    if (!model) {
      // Тихо подбираем самую сильную прямо сейчас.
      try {
        const r = await checkApiKey(apiKey, prov)
        const best = r.models?.length ? pickBestModel(r.models, prov) : null
        if (best) model = best
      } catch {
        /* остаёмся на дефолте */
      }
    }
    if (!model) model = pInfo.defaultModel // сеть подвела — надёжный дефолт провайдера
    store.setConfig({ provider: prov, apiKey: keys.groq, apiKeyOr: keys.openrouter, apiKeyCb: keys.cerebras, apiKeyGc: keys.gigachat, textModel: model, modelAutoPicked: true })
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
    // Дату не спрашиваем: все готовятся к ЕГЭ 2027 (основной период — конец мая). Сменить можно в Настройках.
    store.setExamDate(store.data.examDate || EXAM_DATE_DEFAULT)
    setStep('questions')
  }
  function setSubjAnswer(id: string, field: 'level' | 'wish', val: string) {
    setSubjAnswers((a) => {
      const prev = a[id] ?? { level: '', wish: '' }
      return { ...a, [id]: { ...prev, [field]: val } }
    })
  }
  function saveQuestionsAndNext() {
    const parts = sel
      .map((id) => {
        const a = subjAnswers[id]
        const bits = [
          a?.level?.trim() ? `уровень и слабые места — ${a.level.trim()}` : '',
          a?.wish?.trim() ? `пожелания — ${a.wish.trim()}` : '',
        ].filter(Boolean)
        return bits.length ? `${subjectName(id)}: ${bits.join('; ')}` : ''
      })
      .filter(Boolean)
    if (commonWish.trim()) parts.push(`Общие пожелания к плану: ${commonWish.trim()}`)
    store.setPlanNotes(parts.join('. '))
    setStep('import')
  }

  return (
    <div className="center-wrap ambient">
      <div className={'onb-card fade-in' + (step === 'welcome' ? ' onb-welcome' : '')}>
        {step !== 'welcome' && (
          <div className="stepper">
            {DOT_STEPS.map((s, i) => (
              <div key={s} className={'dot' + (i <= DOT_STEPS.indexOf(step) ? ' on' : '')} />
            ))}
          </div>
        )}

        {step === 'welcome' && (
          <div className="welcome">
            <div className="w-logo">ν</div>
            <h1 className="w-title">Nous</h1>
            <p className="w-tag">Личный штаб подготовки к ЕГЭ {EGE_YEAR}</p>
            <div className="w-feats">
              <div className="w-feat"><span className="w-ic">🗓</span><div><b>План под тебя</b><span>сильный ИИ раскладывает подготовку по дням — под твои цели и расписание</span></div></div>
              <div className="w-feat"><span className="w-ic">📈</span><div><b>Виден рост</b><span>уровни, серии, достижения и честный прогресс к баллам мечты</span></div></div>
              <div className="w-feat"><span className="w-ic">💬</span><div><b>Репетитор 24/7</b><span>объяснит тему и разберёт задание прямо в приложении</span></div></div>
            </div>
            <button className="btn btn-primary btn-lg w-cta" onClick={() => setStep('setup')}>
              Начать подготовку <ArrowRight size={18} />
            </button>
            <p className="small muted w-note">Бесплатно · без регистрации · все данные хранятся только у тебя</p>
          </div>
        )}

        {step === 'setup' && (
          <div className="fade-in">
            <div className="row" style={{ gap: 12, marginBottom: 6 }}>
              <div className="brand" style={{ padding: 0 }}>
                <div className="logo">🎓</div>
              </div>
              <h1 style={{ margin: 0, fontSize: 24 }}>Настройка ИИ</h1>
            </div>
            <p className="muted" style={{ marginTop: 0 }}>
              ИИ работает на твоём бесплатном ключе. Выбери сервис:
            </p>
            <div className="grid cols-2" style={{ marginBottom: 14 }}>
              <div className={'subject-card' + (prov === 'openrouter' ? ' sel' : '')} onClick={() => { setProv('openrouter'); setCheckMsg(null) }}>
                <span className="emoji">🇷🇺</span>
                <div>
                  <div style={{ fontWeight: 700 }}>OpenRouter</div>
                  <div className="small muted">работает в России без VPN · бесплатные модели</div>
                </div>
                <div className="check">{prov === 'openrouter' && <Check size={14} />}</div>
              </div>
              <div className={'subject-card' + (prov === 'cerebras' ? ' sel' : '')} onClick={() => { setProv('cerebras'); setCheckMsg(null) }}>
                <span className="emoji">🚀</span>
                <div>
                  <div style={{ fontWeight: 700 }}>Cerebras</div>
                  <div className="small muted">сверхбыстрый · щедрый бесплатный лимит</div>
                </div>
                <div className="check">{prov === 'cerebras' && <Check size={14} />}</div>
              </div>
              <div className={'subject-card' + (prov === 'gigachat' ? ' sel' : '')} onClick={() => { setProv('gigachat'); setCheckMsg(null) }}>
                <span className="emoji">🛡</span>
                <div>
                  <div style={{ fontWeight: 700 }}>GigaChat (Сбер)</div>
                  <div className="small muted">гарантированно в России · отличный русский</div>
                </div>
                <div className="check">{prov === 'gigachat' && <Check size={14} />}</div>
              </div>
              <div className={'subject-card' + (prov === 'groq' ? ' sel' : '')} onClick={() => { setProv('groq'); setCheckMsg(null) }}>
                <span className="emoji">⚡</span>
                <div>
                  <div style={{ fontWeight: 700 }}>Groq</div>
                  <div className="small muted">очень быстрый · в России нужен VPN</div>
                </div>
                <div className="check">{prov === 'groq' && <Check size={14} />}</div>
              </div>
            </div>
            <p className="small muted" style={{ marginTop: 0 }}>
              Получить бесплатный ключ {pInfo.name}:{' '}
              <a href={pInfo.keysUrl} onClick={(e) => { e.preventDefault(); openExternal(pInfo.keysUrl) }}>
                {pInfo.keysUrl.replace('https://', '')}
              </a>{' '}
              {prov === 'gigachat'
                ? '(вход по Сбер ID → создай проект GigaChat API → скопируй «Ключ авторизации»)'
                : '(регистрация → Create API Key → скопируй ключ)'}
            </p>
            <label className="field">
              <span><KeyRound size={13} style={{ verticalAlign: -2, marginRight: 5 }} />API-ключ {pInfo.name}</span>
              <input
                className="input"
                type="password"
                placeholder={pInfo.keyPrefix ? pInfo.keyPrefix + '...' : 'ключ авторизации (Authorization Key)'}
                value={apiKey}
                onChange={(e) => { setApiKey(e.target.value); setCheckMsg(null) }}
              />
            </label>
            <p className="small muted" style={{ marginTop: 0 }}>
              🧠 Модель ИИ подберём автоматически — самую умную из доступных (сменить можно в Настройках).
            </p>
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
            <p className="muted" style={{ marginTop: 0 }}>
              Дни и нагрузка — на них ляжет план в календаре. Готовимся к <b>ЕГЭ {EGE_YEAR}</b> (конец мая) — дату менять не нужно.
            </p>
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
              <h1 style={{ fontSize: 23, margin: 0 }}>Пара вопросов по каждому предмету</h1>
            </div>
            <p className="muted" style={{ marginTop: 6 }}>Ответь коротко — это пойдёт в промт, чтобы план попал точно в твои слабые места. Любое поле можно пропустить.</p>
            {sel.map((id) => (
              <div className="card soft" key={id} style={{ marginBottom: 12 }}>
                <div className="row" style={{ marginBottom: 10 }}>
                  <b>{subjectName(id)}</b>
                </div>
                <label className="field">
                  <span>Какой уровень сейчас и что даётся тяжелее всего?</span>
                  <input
                    className="input"
                    value={subjAnswers[id]?.level || ''}
                    onChange={(e) => setSubjAnswer(id, 'level', e.target.value)}
                    placeholder="например: база есть, плаваю в стереометрии и задачах с параметром"
                  />
                </label>
                <label className="field" style={{ marginBottom: 0 }}>
                  <span>Пожелания по этому предмету</span>
                  <input
                    className="input"
                    value={subjAnswers[id]?.wish || ''}
                    onChange={(e) => setSubjAnswer(id, 'wish', e.target.value)}
                    placeholder="например: упор на вторую часть, летом больше практики"
                  />
                </label>
              </div>
            ))}
            <label className="field">
              <span>Общие пожелания к плану (темп, формат, чего избегать)</span>
              <input className="input" value={commonWish} onChange={(e) => setCommonWish(e.target.value)} placeholder="например: по выходным не заниматься, люблю короткие занятия" />
            </label>
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
