import { useState, useRef, useEffect } from 'react'
import { useStore } from '../store'
import { mdToHtml } from '../lib/md'
import { openExternal } from '../lib/api'
import { subjectName } from '../data/subjects'
import { Send, Trash2, Copy, Check, ArrowUpRight } from 'lucide-react'

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
  return [...new Set(out)].slice(0, 4)
}

export default function Chat() {
  const data = useStore((s) => s.data)
  const msgs = useStore((s) => s.chatMsgs)
  const busy = useStore((s) => s.chatBusy)
  const sendChat = useStore((s) => s.sendChat)
  const clearChat = useStore((s) => s.clearChat)
  const [input, setInput] = useState('')
  const [copied, setCopied] = useState<number | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

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
  }, [msgs, busy])

  async function copyMsg(i: number, text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(i)
      setTimeout(() => setCopied((c) => (c === i ? null : c)), 1400)
    } catch {
      /* буфер недоступен — молча пропускаем */
    }
  }

  function fire(text: string) {
    const t = text.trim()
    if (!t || busy) return
    sendChat(t) // запрос живёт в сторе — не потеряется при уходе со вкладки
  }
  function onSendFromInput() {
    fire(input)
    setInput('')
    requestAnimationFrame(autoGrow)
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
          {msgs.length === 0 && !busy && (
            <div className="chat-empty">
              <div className="ce-av">ν</div>
              <h2>{data.studentName ? `Привет, ${data.studentName}!` : 'Привет!'} Я твой ИИ-репетитор</h2>
              <p>Объясню тему, разберу задание с ФИПИ или РешуЕГЭ, помогу понять ошибку. Спрашивай что угодно — или начни с готового вопроса:</p>
              <div className="ce-chips">
                {suggestions.map((s, i) => (
                  <button key={i} className="ce-chip" style={{ animationDelay: `${i * 60}ms` }} onClick={() => fire(s)}>
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
            return (
              <div key={i} className="msg-ai">
                <div className="ai-av">ν</div>
                <div className="ai-col">
                  <div className="bubble ai md-body" dangerouslySetInnerHTML={{ __html: mdToHtml(m.content) }} />
                  <div className="msg-tools">
                    <button className="tool-btn" onClick={() => copyMsg(i, m.content)}>
                      {copied === i ? (
                        <><Check size={13} /> Скопировано</>
                      ) : (
                        <><Copy size={13} /> Копировать</>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
          {busy && (
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
                onSendFromInput()
              }
            }}
          />
          <button
            className="chat-send"
            onClick={onSendFromInput}
            disabled={busy || !input.trim()}
            aria-label="Отправить"
            title="Отправить"
          >
            <Send size={17} />
          </button>
        </div>
        <div className="chat-hint">Enter — отправить · Shift + Enter — новая строка</div>
      </div>
    </div>
  )
}
