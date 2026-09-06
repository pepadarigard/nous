// Извлечение текста из файлов — ПОЛНОСТЬЮ ОФЛАЙН, без ИИ и без интернета.
// PDF читает pdf.js (лежит в приложении), DOCX/EPUB — свой мини-распаковщик ZIP,
// текстовые форматы — с определением кодировки (UTF-8 или windows-1251).

import type { MaterialKind } from '../types'

export interface Extracted {
  text: string
  pages?: number
  warn?: string // почему текста нет или он неполный
}

const EXT_KIND: Record<string, MaterialKind> = {
  pdf: 'pdf',
  docx: 'docx',
  doc: 'other',
  txt: 'text',
  md: 'markdown',
  markdown: 'markdown',
  csv: 'csv',
  tsv: 'csv',
  json: 'json',
  epub: 'docx',
  fb2: 'text',
  html: 'text',
  htm: 'text',
  xml: 'text',
  rtf: 'text',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  webp: 'image',
  gif: 'image',
  bmp: 'image',
}

export function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i < 0 ? '' : name.slice(i + 1).toLowerCase()
}

export function kindOf(name: string): MaterialKind {
  return EXT_KIND[extOf(name)] ?? 'other'
}

/** Человеческий размер файла. */
export function humanSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' Б'
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' КБ'
  return (bytes / 1024 / 1024).toFixed(1) + ' МБ'
}

/** Текст из байтов: сначала строгий UTF-8, при ошибке — windows-1251 (частый случай русских .txt). */
export function decodeText(buf: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    try {
      return new TextDecoder('windows-1251').decode(buf)
    } catch {
      return new TextDecoder('utf-8').decode(buf)
    }
  }
}

// ---------- ZIP (docx, epub) ----------

interface ZipEntry {
  name: string
  method: number
  offset: number
  compressedSize: number
}

/** Разбор центрального каталога ZIP. Нужен минимум: имена, метод сжатия, смещения. */
function zipEntries(buf: ArrayBuffer): ZipEntry[] {
  const view = new DataView(buf)
  const bytes = new Uint8Array(buf)
  // Ищем сигнатуру End Of Central Directory с конца (в хвосте может быть комментарий).
  let eocd = -1
  for (let i = bytes.length - 22; i >= 0 && i > bytes.length - 22 - 65536; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) return []
  const count = view.getUint16(eocd + 10, true)
  let p = view.getUint32(eocd + 16, true)
  const out: ZipEntry[] = []
  for (let i = 0; i < count && p + 46 <= bytes.length; i++) {
    if (view.getUint32(p, true) !== 0x02014b50) break
    const method = view.getUint16(p + 10, true)
    const compressedSize = view.getUint32(p + 20, true)
    const nameLen = view.getUint16(p + 28, true)
    const extraLen = view.getUint16(p + 30, true)
    const commentLen = view.getUint16(p + 32, true)
    const offset = view.getUint32(p + 42, true)
    const name = new TextDecoder('utf-8').decode(bytes.subarray(p + 46, p + 46 + nameLen))
    out.push({ name, method, offset, compressedSize })
    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}

async function inflateRaw(data: Uint8Array): Promise<ArrayBuffer> {
  const ds = new DecompressionStream('deflate-raw')
  const stream = new Blob([data as unknown as BlobPart]).stream().pipeThrough(ds)
  return await new Response(stream).arrayBuffer()
}

/** Содержимое одной записи ZIP как текст. */
async function zipRead(buf: ArrayBuffer, entry: ZipEntry): Promise<string> {
  const view = new DataView(buf)
  const bytes = new Uint8Array(buf)
  if (view.getUint32(entry.offset, true) !== 0x04034b50) return ''
  const nameLen = view.getUint16(entry.offset + 26, true)
  const extraLen = view.getUint16(entry.offset + 28, true)
  const start = entry.offset + 30 + nameLen + extraLen
  const raw = bytes.subarray(start, start + entry.compressedSize)
  if (entry.method === 0) return decodeText(raw.slice().buffer)
  if (entry.method === 8) return decodeText(await inflateRaw(raw))
  return ''
}

/** Разметку — вон, абзацы — сохранить. */
function stripTags(xml: string): string {
  return xml
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|title)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

async function fromDocx(buf: ArrayBuffer): Promise<Extracted> {
  const entries = zipEntries(buf)
  if (!entries.length) return { text: '', warn: 'Файл не читается как DOCX/EPUB.' }

  const doc = entries.find((e) => e.name === 'word/document.xml')
  if (doc) return { text: stripTags(await zipRead(buf, doc)) }

  // EPUB: собираем все страницы книги по порядку имён.
  const pages = entries.filter((e) => /\.(xhtml|html)$/i.test(e.name)).sort((a, b) => a.name.localeCompare(b.name))
  if (pages.length) {
    const parts: string[] = []
    for (const p of pages) parts.push(stripTags(await zipRead(buf, p)))
    return { text: parts.join('\n\n'), pages: pages.length }
  }
  return { text: '', warn: 'Внутри архива не нашлось текста.' }
}

// ---------- PDF ----------

async function fromPdf(buf: ArrayBuffer): Promise<Extracted> {
  const pdfjs = await import('pdfjs-dist')
  // Воркер лежит внутри приложения — интернет не нужен.
  const workerUrl = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise
  const parts: string[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    // Переносы строк сохраняем (hasEOL): без них страница склеивается в одну строку,
    // и нумерация заданий («1.», «12)») становится неотличимой от чисел внутри текста.
    let buf = ''
    for (const it of content.items) {
      if (!('str' in it)) continue
      buf += it.str
      if (it.hasEOL) buf += '\n'
      else if (!it.str.endsWith(' ')) buf += ' '
    }
    const pageText = buf
      .replace(/[ \t]+/g, ' ')
      .replace(/ ?\n ?/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
    if (pageText) parts.push(pageText)
    page.cleanup()
  }
  const pages = doc.numPages
  doc.cleanup()
  const text = parts.join('\n\n')
  return {
    text,
    pages,
    warn: text.trim().length < 40 ? 'В PDF нет текстового слоя (похоже, это сканы). Файл сохранён, но искать по нему не получится.' : undefined,
  }
}

// ---------- общий вход ----------

/** Достать текст из файла. Ошибки не бросает — возвращает пустой текст с пояснением. */
export async function extractText(file: File): Promise<Extracted> {
  const kind = kindOf(file.name)
  try {
    if (kind === 'image') return { text: '', warn: 'Картинка сохранена как есть — текст из неё не вынимается.' }
    const buf = await file.arrayBuffer()
    if (kind === 'pdf') return await fromPdf(buf)
    if (kind === 'docx') return await fromDocx(buf)
    const raw = decodeText(buf)
    if (/\.(html?|xml|fb2)$/i.test(file.name)) return { text: stripTags(raw) }
    if (/\.rtf$/i.test(file.name)) {
      // Грубо, но рабоче: выкидываем управляющие последовательности RTF.
      return { text: raw.replace(/\\'([0-9a-f]{2})/gi, '').replace(/\\[a-z]+-?\d* ?/gi, '').replace(/[{}]/g, '').trim() }
    }
    return { text: raw }
  } catch (e) {
    return { text: '', warn: 'Не получилось прочитать файл: ' + String((e as Error)?.message ?? e) }
  }
}
