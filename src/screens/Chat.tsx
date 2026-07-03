import { useState, useRef, useEffect } from 'react'
import { useStore, type ChatMsg } from '../store'
import { tutorChat } from '../lib/ai'
import { mdToHtml } from '../lib/md'
import { openExternal } from '../lib/api'
import { Send, Trash2 } from 'lucide-react'

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

export default function Chat() {
  const cfg = useStore((s) => s.data.config)
  const msgs = useStore((s) => s.chatMsgs)
  const setMsgs = useStore((s) => s.setChatMsgs)
  const clearChat = useStore((s) => s.clearChat)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [thinking, setThinking] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight)
  }, [msgs, thinking, streaming])

  // Плавный вывод ответа ИИ по буквам, с рендером markdown на лету.
  // Медленно и красиво: посимвольно, с короткими паузами на знаках препинания;
  // общее время ограничено, чтобы длинные ответы не тянулись бесконечно.
  async function typeOut(base: ChatMsg[], full: string) {
    setStreaming(true)
    const put = (c: string) => setMsgs([...base, { role: 'assistant', content: c }])
    const total = full.length
    const INTERVAL = 24
    const maxTicks = Math.round(4800 / INTERVAL) // ~200 шагов на длинный ответ
    const ticks = Math.min(total, maxTicks)
    const step = Math.max(1, Math.ceil(total / Math.max(ticks, 1)))
    for (let i = step; i < total; i += step) {
      put(full.slice(0, i))
      const ch = full[i - 1]
      await sleep(/[.!?\n]/.test(ch) ? INTERVAL + 140 : /[,;:—]/.test(ch) ? INTERVAL + 60 : INTERVAL)
    }
    put(full)
    setStreaming(false)
  }

  async function send() {
    const q = input.trim()
    if (!q || busy) return
    const base: ChatMsg[] = [...msgs, { role: 'user', content: q }]
    setMsgs(base)
    setInput('')
    setBusy(true)
    setThinking(true)
    let ans = ''
    try {
      // Ждём ответ И минимум 2 секунды — что раньше кончится, тем дольше ждём.
      const [a] = await Promise.all([
        tutorChat(cfg, base.slice(-CONTEXT_WINDOW).map((m) => ({ role: m.role, content: m.content }))),
        sleep(2000),
      ])
      ans = a || 'Пустой ответ.'
    } catch (e: any) {
      ans = 'Ошибка: ' + (e?.message || '')
    }
    setThinking(false)
    await typeOut(base, ans)
    setBusy(false)
  }

  return (
    <div className="fade-in">
      <div className="page-head">
        <div className="row">
          <div>
            <h1>Чат с ИИ 💬</h1>
            <p>Спроси по теме, попроси объяснить задание или разобрать ошибку.</p>
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
            <div className="empty">
              <div className="big">💬</div>
              <p>Задай первый вопрос — например «объясни, как решать задание 13 по математике».</p>
            </div>
          )}
          {msgs.map((m, i) => {
            if (m.role === 'user') return <div key={i} className="bubble me">{m.content}</div>
            const isLast = i === msgs.length - 1
            const html = mdToHtml(m.content) + (streaming && isLast ? '<span class="type-caret"></span>' : '')
            return <div key={i} className="bubble ai md-body" dangerouslySetInnerHTML={{ __html: html }} />
          })}
          {thinking && (
            <div className="bubble ai">
              <span className="typing-dots"><i /><i /><i /></span>
            </div>
          )}
        </div>
        <div className="row" style={{ marginTop: 12, gap: 8 }}>
          <textarea
            className="input"
            rows={1}
            placeholder="Напиши вопрос…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
            style={{ resize: 'none' }}
          />
          <button className="btn btn-primary" onClick={send} disabled={!input.trim() || busy} aria-label="Отправить">
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}
