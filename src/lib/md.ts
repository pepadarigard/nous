// Лёгкий разбор Markdown → HTML для сообщений ИИ (заголовки, жирный, курсив, списки, код, разделители).
// Текст сначала экранируется, поэтому inject не пройдёт.

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Плейсхолдер код-блока: пробелы-разделители + маркер, чтобы не совпасть с числами в тексте.
const CB_OPEN = ' CB'
const CB_CLOSE = ' '

// Кэш разбора: при плавном стриме список сообщений перерисовывается десятки раз в секунду,
// но меняется только последнее (растущее) сообщение — остальные берём из кэша, а не парсим заново.
const mdCache = new Map<string, string>()
export function mdToHtml(src: string): string {
  if (!src) return ''
  const hit = mdCache.get(src)
  if (hit !== undefined) return hit
  const out = renderMd(src)
  mdCache.set(src, out)
  if (mdCache.size > 400) mdCache.delete(mdCache.keys().next().value as string)
  return out
}

function renderMd(src: string): string {
  const blocks: string[] = []
  // код-блоки ```...``` — вытаскиваем, чтобы не трогать
  let t = src.replace(/```(\w*)\n?([\s\S]*?)```/g, (_m, _lang, code) => {
    blocks.push('<pre class="md-pre"><code>' + esc(code) + '</code></pre>')
    return CB_OPEN + (blocks.length - 1) + CB_CLOSE
  })
  t = esc(t)

  // ссылки: [текст](url) и «голые» http-ссылки → кликабельный <a class="md-link">
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a class="md-link" href="$2">$1</a>')
  t = t.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a class="md-link" href="$2">$2</a>')

  t = t
    .replace(/^\s*#{4,6}\s+(.*)$/gm, '<div class="md-h md-h4">$1</div>')
    .replace(/^\s*###\s+(.*)$/gm, '<div class="md-h md-h3">$1</div>')
    .replace(/^\s*##\s+(.*)$/gm, '<div class="md-h md-h2">$1</div>')
    .replace(/^\s*#\s+(.*)$/gm, '<div class="md-h md-h1">$1</div>')
  t = t.replace(/^\s*(---|\*\*\*|___)\s*$/gm, '<hr class="md-hr">')
  t = t
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code class="md-code">$1</code>')

  const lines = t.split('\n')
  const out: string[] = []
  let inUl = false
  let inOl = false
  const closeLists = () => {
    if (inUl) { out.push('</ul>'); inUl = false }
    if (inOl) { out.push('</ol>'); inOl = false }
  }
  for (const ln of lines) {
    const ul = ln.match(/^\s*[-*]\s+(.*)$/)
    const ol = ln.match(/^\s*\d+\.\s+(.*)$/)
    if (ul) {
      if (inOl) { out.push('</ol>'); inOl = false }
      if (!inUl) { out.push('<ul class="md-ul">'); inUl = true }
      out.push('<li>' + ul[1] + '</li>')
      continue
    }
    if (ol) {
      if (inUl) { out.push('</ul>'); inUl = false }
      if (!inOl) { out.push('<ol class="md-ol">'); inOl = true }
      out.push('<li>' + ol[1] + '</li>')
      continue
    }
    closeLists()
    if (ln.trim() === '') continue
    if (/^CB\d+$/.test(ln.trim())) out.push(ln.trim())
    else if (/^\s*<(div class="md-h|hr|pre)/.test(ln)) out.push(ln)
    else out.push('<p class="md-p">' + ln + '</p>')
  }
  closeLists()
  t = out.join('\n')
  t = t.replace(/CB(\d+)/g, (_m, i) => blocks[+i] ?? '')
  return t
}
