import { useState, useRef, useEffect } from 'react'
import { useStore, type ChatMsg } from '../store'
import { tutorChat } from '../lib/ai'
import { mdToHtml } from '../lib/md'
import { humanError, openExternal } from '../lib/api'
import { subjectName } from '../data/subjects'
import { Send, Trash2, Copy, Check, Square, ArrowUpRight } from 'lucide-react'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
// В Groq шлём только хвост истории — иначе долгий чат упирается в лимиты контекста.
const CONTEXT_WINDOW = 12

// Ссылки в ответах ИИ открываем во внешнем браузере, а не внутри окна приложения.
function handleLinkClick(e: React.MouseEvent) {
  const a = (e.target as HTMLElement).closest('a.md-link') as HTMLAnchorElement | null
  if (!a) return
  const href = a.getAttribute('href') || ''
  if (/^https?:\/\//i.test(href)) {
    e.preventDefault()
    openExternal(href)
  }
}

// Готовые подсказки на пустом экране — под предметы ученика, чтобы можно было начать в один клик.
const SUBJECT_HINTS: Record<string, string> = {
  russian: 'Объясни, как писать сочинение (задание 27) по русскому',
  math_prof: 'Как решать задание 13 по профильной математике?',
  math_base: 'Разбери типовое задание по базовой математике',
  informatics: 'Разбери задание 27 по информатике с кодом',
  physics: 'Как решать задачи на механику по физике?',
}
function buildSuggestions(subjects: string[]): string[] {
  const out: string[] = []
  if (subjects[0]) out.push(`С чего начать подготовку по предмету «${subjectName(subjects[0])}»?`)
  for (const s of subjects) {
    if (out.length >= 3) break
    if (SUBJECT_HINTS[s]) out.push(SUBJECT_HINTS[s])
  }
  out.push('Разбери мою ошибку — я скину условие задания и своё решение')
  out.push('Составь список тем, которые надо выучить в первую очередь')
  // Уникальные, максимум 4 карточки.
  return [...new Set(out)].slice(0, 4)
}

export default function Chat() {
  const cfg = useStore((s) => s.data.config)
  const data = useStore((s) => s.data)
  const msgs = useStore((s) => s.chatMsgs)
  const setMsgs = useStore((s) => s.setChatMsgs)
  const clearChat = useStore((s) => s.clearChat)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [thinking, setThinking] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [copied, setCopied] = useState<number | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const stopRef = useRef(false)

  const suggestions = buildSuggestions(data.subjects)

  // Поле ввода растёт под текст (до ~5 строк), после отправки сжимается обратно.
  function autoGrow() {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 132) + 'px'
  }

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight)
  }, [msgs, thinking, streaming])

  async function copyMsg(i: number, text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(i)
      setTimeout(() => setCopied((c) => (c === i ? null : c)), 1400)
    } catch {
      /* буфер недоступен — молча пропускаем */
    }
  }

  // Плавный вывод ответа ИИ по буквам, с рендером markdown на лету.
  // Посимвольно, с короткими паузами на знаках препинания; можно прервать кнопкой «стоп».
  async function typeOut(base: ChatMsg[], full: string) {
    stopRef.current = false
    setStreaming(true)
    const put = (c: string) => setMsgs([...base, { role: 'assistant', content: c }])
    const total = full.length
    const INTERVAL = 22
    const maxTicks = Math.round(4600 / INTERVAL)
    const ticks = Math.min(total, maxTicks)
    const step = Math.max(1, Math.ceil(total / Math.max(ticks, 1)))
    for (let i = step; i < total; i += step) {
      if (stopRef.current) break
      put(full.slice(0, i))
      const ch = full[i - 1]
      await sleep(/[.!?\n]/.test(ch) ? INTERVAL + 130 : /[,;:—]/.test(ch) ? INTERVAL + 55 : INTERVAL)
    }
    put(full)
    setStreaming(false)
  }

  async function sendText(text: string) {
    const q = text.trim()
    if (!q || busy) return
    const base: ChatMsg[] = [...msgs, { role: 'user', content: q }]
    setMsgs(base)
    setInput('')
    requestAnimationFrame(autoGrow)
    setBusy(true)
    setThinking(true)
    let ans = ''
    try {
      // Краткая справка об ученике — чтобы репетитор отвечал в контексте его предметов и целей.
      const ctx = [
        data.studentName ? `имя ${data.studentName}` : '',
        ...data.subjects.map((id) => {
          const g = data.goals.find((x) => x.subjectId === id)
          return `${subjectName(id)} (${g ? `сейчас ~${g.current}, цель ${g.target}` : 'баллы не указаны'})`
        }),
        data.examDate ? `экзамен ${data.examDate}` : '',
      ].filter(Boolean).join('; ')
      const a = await tutorChat(
        cfg,
        base.slice(-CONTEXT_WINDOW).map((m) => ({ role: m.role, content: m.content })),
        ctx,
      )
      ans = a || 'Пустой ответ.'
    } catch (e) {
      ans = '⚠️ ' + humanError(e)
    }
    setThinking(false)
    await typeOut(base, ans)
    setBusy(false)
  }

  function onSendClick() {
    if (streaming) {
      stopRef.current = true // прервать анимацию печати — показать ответ целиком
      return
    }
    sendText(input)
  }

  return (
    <div className="fade-in chat-page">
      <div className="page-head">
        <div className="row">
          <div>
            <h1>Чат с ИИ 💬</h1>
            <p>Твой репетитор: объяснит тему, разберёт задание, поможет с ошибкой.</p>
          </div>
          <div className="spacer" />
          {msgs.length > 0 && !busy && (
            <button className="btn btn-ghost" onClick={clearChat} title="Очистить чат">
              <Trash2 size={15} /> Очистить
            </button>
          )}
        </div>
      </div>
      <div className="chat-wrap">
        <div className="chat-scroll" ref={scrollRef} onClick={handleLinkClick}>
          {msgs.length === 0 && !thinking && (
            <div className="chat-empty">
              <div className="ce-av">ν</div>
              <h2>{data.studentName ? `Привет, ${data.studentName}!` : 'Привет!'} Я твой ИИ-репетитор</h2>
              <p>Объясню тему, разберу задание с ФИПИ или РешуЕГЭ, помогу понять ошибку. Спрашивай что угодно — или начни с готового вопроса:</p>
              <div className="ce-chips">
                {suggestions.map((s, i) => (
                  <button
                    key={i}
                    className="ce-chip"
                    style={{ animationDelay: `${i * 60}ms` }}
                    onClick={() => sendText(s)}
                  >
                    <span>{s}</span>
                    <ArrowUpRight size={17} />
                  </button>
                ))}
              </div>
            </div>
          )}
          {msgs.map((m, i) => {
            if (m.role === 'user') {
              return (
                <div key={i} className="msg-me">
                  <div className="bubble me">{m.content}</div>
                </div>
              )
            }
            const isLast = i === msgs.length - 1
            const html = mdToHtml(m.content) + (streaming && isLast ? '<span class="type-caret"></span>' : '')
            return (
              <div key={i} className="msg-ai">
                <div className="ai-av">ν</div>
                <div className="ai-col">
                  <div className="bubble ai md-body" dangerouslySetInnerHTML={{ __html: html }} />
                  {!(streaming && isLast) && (
                    <div className="msg-tools">
                      <button className="tool-btn" onClick={() => copyMsg(i, m.content)}>
                        {copied === i ? (
                          <><Check size={13} /> Скопировано</>
                        ) : (
                          <><Copy size={13} /> Копировать</>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
          {thinking && (
            <div className="msg-ai">
              <div className="ai-av">ν</div>
              <div className="bubble ai thinking-bubble">
                <span className="typing-dots"><i /><i /><i /></span>
              </div>
            </div>
          )}
        </div>
        <div className="chat-input">
          <textarea
            ref={inputRef}
            rows={1}
            placeholder="Напиши вопрос…"
            value={input}
            onChange={(e) => { setInput(e.target.value); autoGrow() }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                sendText(input)
              }
            }}
          />
          <button
            className={'chat-send' + (streaming ? ' stop' : '')}
            onClick={onSendClick}
            disabled={thinking || (!streaming && !input.trim())}
            aria-label={streaming ? 'Остановить' : 'Отправить'}
            title={streaming ? 'Показать ответ целиком' : 'Отправить'}
          >
            {streaming ? <Square size={15} fill="currentColor" /> : <Send size={17} />}
          </button>
        </div>
        <div className="chat-hint">Enter — отправить · Shift + Enter — новая строка</div>
      </div>
    </div>
  )
}
