// Загрузка заданий с Решу ЕГЭ в личный банк ученика.
//
// Почему загрузка, а не готовый файл в установщике. Задания на Решу ЕГЭ — чужая
// компиляция: разборы написаны авторами сайта, подборка тоже их. Разложить их по
// своему инсталлятору и раздавать — значит раздавать чужую работу. А скачать себе
// то, что и так открыто в браузере, ученик вправе: это его личная подготовка.
// Поэтому качает приложение НА МАШИНЕ УЧЕНИКА и складывает в его банк.
//
// Как устроено. У сайта есть версия для печати: одна страница отдаёт всю подборку
// сразу — условие, ответ и разбор. Значит, на целую тему уходит один запрос вместо
// десятка, и сайту от нас почти не больно. Между запросами всё равно ждём паузу.
//
// Что приходится чинить по дороге:
//  1. Мягкие переносы (U+00AD) насыпаны внутрь слов — «за­да­ние». Их выкидываем.
//  2. Формулы — это картинки, а не текст. В alt лежит их озвучка для незрячих
//     («дробь: числитель: 7, знаменатель: 25 конец дроби»), и без перевода
//     обратно в математику условие читать невозможно.
//  3. Чертежи — тоже картинки, и без них геометрическое задание нерешаемо.
//     Такие качаем отдельно и храним прямо в задании, чтобы работало офлайн.

import type { Question } from '../types'
import { isTauri, uid } from './api'

/** Поддомен Решу ЕГЭ по нашему id предмета. */
export const BANK_HOSTS: Record<string, string> = {
  russian: 'https://rus-ege.sdamgia.ru',
  math_prof: 'https://math-ege.sdamgia.ru',
  informatics: 'https://inf-ege.sdamgia.ru',
  physics: 'https://phys-ege.sdamgia.ru',
}

export const BANK_SUBJECTS = Object.keys(BANK_HOSTS)

/** Умеем ли качать банк по этому предмету. */
export function canDownload(subjectId: string): boolean {
  return subjectId in BANK_HOSTS
}

// ---------- сеть ----------

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(cmd, args)
}

/**
 * Страница банка. В приложении идёт через Rust — там нет CORS. В браузере
 * запрос заблокирует сам браузер, и это не чинится: сайт не отдаёт заголовки
 * для чужого источника. Поэтому в браузерной сборке загрузка недоступна честно,
 * а не «висит».
 */
async function getPage(url: string): Promise<string> {
  return retry(async () => {
    if (isTauri) return await invoke<string>('bank_get', { url })
    const res = await fetch(url)
    if (!res.ok) throw new Error('Сайт ответил ' + res.status)
    return await res.text()
  })
}

/**
 * Повтор после сетевой осечки.
 *
 * Проверка показала: из четырёх запросов подряд к сайту два могут оборваться
 * на установке соединения, а те же самые адреса через секунду отвечают. Одна
 * такая осечка не должна стоить ученику всей загрузки: за полный проход по
 * четырём предметам запросов сотни, и хоть один сорвётся почти наверняка.
 *
 * Пауза растёт, чтобы не долбить сайт, который и так споткнулся.
 */
async function retry<T>(run: () => Promise<T>, times = 2): Promise<T> {
  let last: unknown
  for (let i = 0; i <= times; i++) {
    try {
      return await run()
    } catch (e) {
      last = e
      if (i < times) await sleep(1200 * (i + 1))
    }
  }
  throw last
}

/** Картинка-чертёж как data:URL. */
async function getImage(url: string): Promise<string | null> {
  try {
    if (isTauri) return await retry(() => invoke<string>('bank_image', { url }))
    const res = await fetch(url)
    if (!res.ok) return null
    const blob = await res.blob()
    return await new Promise((ok) => {
      const fr = new FileReader()
      fr.onload = () => ok(String(fr.result))
      fr.onerror = () => ok(null)
      fr.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ---------- разбор текста ----------

/**
 * Текст элемента С СОХРАНЕНИЕМ структуры.
 *
 * `textContent` склеивает всё подряд, и задание превращалось в кирпич:
 * «…является число 6321.а) Приведите пример двух…». А в этих заданиях структура
 * и есть половина условия — пункты а), б), в) и ряды 1)…5) должны стоять
 * каждый со своей строки, иначе читать невозможно.
 *
 * Поэтому обходим дерево сами и на границах блоков ставим перенос.
 */
function blockText(root: Node): string {
  const BLOCK = new Set(['P', 'DIV', 'LI', 'TR', 'BR', 'H1', 'H2', 'H3', 'H4', 'H5', 'TABLE', 'UL', 'OL'])
  let out = ''
  const walk = (n: Node) => {
    if (n.nodeType === 3) {
      out += n.nodeValue ?? ''
      return
    }
    if (n.nodeType !== 1) return
    const el = n as Element
    const block = BLOCK.has(el.tagName)
    if (block && out && !out.endsWith('\n')) out += '\n'
    if (el.tagName === 'TD' && out && !/[\s|]$/.test(out)) out += ' | '
    for (const c of el.childNodes) walk(c)
    if (block && out && !out.endsWith('\n')) out += '\n'
  }
  walk(root)
  return out
}

/** Мягкие переносы и неразрывные пробелы, которыми нашпигована вёрстка сайта. */
function clean(s: string): string {
  return s
    .replace(/­/g, '')
    .replace(/ /g, ' ')
    // Невидимые «склейки», которыми сайт запрещает перенос строки: они стоят
    // после дефиса в «IP-адрес» и после дробной черты в «м/с». Глазом их не
    // видно, а ответ «0,09 м/с» из-за них не совпадал сам с собой.
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
    .replace(/\u2011/g, '-')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Ответ с сайта — к виду бланка ЕГЭ.
 *
 * Сайт хранит ответ так, как показывает его человеку, и в двух местах это
 * расходится с бланком:
 *
 *  1. Несколько полей ответа склеены амперсандом: «586&3» у информатики — это
 *     два ответа подряд, а «&» придуман сайтом для себя.
 *  2. У физики к числу дописана единица измерения: «0,09 м/с.». В бланк единицы
 *     не пишут никогда — условие само говорит, в чём отвечать. Ученик напишет
 *     «0,09», и без чистки его верный ответ считался бы ошибкой.
 *
 * Хвост срезается, только если он ВЕСЬ похож на единицу измерения. «3 или 4»,
 * «а) 11 285; б) нет» и любое слово остаются как есть.
 */
function cleanAnswer(raw: string): string | undefined {
  let a = raw.replace(/^Ответ:\s*/i, '').trim()
  if (!a) return undefined
  a = a.split('&').map((p) => p.trim()).filter(Boolean).join(' ')
  const unit = a.match(
    /^(-?\d+(?:[.,]\d+)?)\s*(?:[A-Za-zА-Яа-яЁё]+(?:\s*\/\s*[A-Za-zА-Яа-яЁё]+)?[²³°%]?\.?)$/,
  )
  if (unit) a = unit[1]
  a = a.replace(/\.$/, '').trim()
  // Пустышка: остались одни пункты «а) б)» и знаки препинания. Такой «эталон»
  // хуже, чем никакого, — по нему нечего сверять, а выглядит он как ответ.
  if (!/[\p{L}\d]/u.test(a.replace(/\b[а-яa-z]\)/gi, ''))) return undefined
  return a || undefined
}

/**
 * Озвучка формулы обратно в математику.
 *
 * В alt картинки лежит текст для чтения вслух: «дробь: числитель: 7, знаменатель:
 * 25 конец дроби». Читать такое в условии невозможно, поэтому разворачиваем
 * обратно в привычную запись. Порядок замен важен: сначала парные конструкции
 * (дробь, корень, степень), потом одиночные слова.
 */
export function formulaFromAlt(alt: string): string {
  let s = ' ' + clean(alt) + ' '

  // 1. Скобки. Их больше всего — в разборе по математике буквально тысячи,
  // и без замены формула читается как протокол: «левая круглая скобка 91a…».
  const BRACKETS: [string, string][] = [
    ['левая круглая скобка', '('],
    ['правая круглая скобка', ')'],
    ['левая квадратная скобка', '['],
    ['правая квадратная скобка', ']'],
    ['левая фигурная скобка', '{'],
    ['правая фигурная скобка', '}'],
  ]
  for (const [word, to] of BRACKETS) {
    s = s.replace(new RegExp('(?<![\\p{L}])' + word + '(?![\\p{L}])', 'gu'), to)
  }

  // 2. Парные конструкции. Шаблон нарочно не пускает внутрь себя ещё одну такую
  // же («(?!дробь:)»), поэтому находится САМАЯ ВНУТРЕННЯЯ, и вложенные дроби
  // разворачиваются от середины наружу за несколько проходов. Со старым `[^:]*?`
  // вложенная дробь ломала разбор и оставляла «числитель» прямо в тексте.
  for (let pass = 0; pass < 8; pass++) {
    const before = s
    s = s.replace(
      /дробь:\s*числитель:\s*((?:(?!дробь:)[\s\S])*?),\s*знаменатель:\s*((?:(?!дробь:)[\s\S])*?)\s*конец дроби/g,
      (_m, a, b) => `(${a.trim()})/(${b.trim()})`,
    )
    s = s.replace(
      /корень из:\s*начало аргумента:\s*((?:(?!корень из:)[\s\S])*?)\s*конец аргумента/g,
      (_m, a) => `√(${a.trim()})`,
    )
    s = s.replace(
      /корень (\S+) степени из:\s*начало аргумента:\s*((?:(?!корень )[\s\S])*?)\s*конец аргумента/g,
      (_m, n, a) => `корень ${n} степени из (${a.trim()})`,
    )
    s = s.replace(
      /в степени:?\s*начало степени:?\s*((?:(?!в степени)[\s\S])*?)\s*конец степени/g,
      (_m, a) => `^(${a.trim()})`,
    )
    s = s.replace(
      /(целая|дробная) часть:\s*начало аргумента:\s*([\s\S]*?)\s*конец аргумента/g,
      (_m, kind, a) => (kind === 'целая' ? `⌊${a.trim()}⌋` : `{${a.trim()}}`),
    )
    if (s === before) break
  }

  // 3. Остатки LaTeX. Сайт местами отдаёт исходную разметку прямо в alt —
  // в тексте это выглядело как «\overlineabcd» и «x \leqslant14d».
  const LATEX: [RegExp, string][] = [
    [/\\ldots|\\dots/g, '…'],
    [/\\angle/g, '∠'],
    [/\\geqslant|\\geq|\\ge(?![a-z])/g, ' ≥ '],
    [/\\leqslant|\\leq|\\le(?![a-z])/g, ' ≤ '],
    [/\\cup/g, ' ∪ '],
    [/\\cap/g, ' ∩ '],
    [/\\in(?![a-z])/g, ' ∈ '],
    [/\\mapsto/g, ' ↦ '],
    [/\\equiv/g, ' ≡ '],
    [/\\Rightarrow/g, ' ⇒ '],
    [/\\rightarrow|\\to(?![a-z])/g, ' → '],
    [/\\pm/g, '±'],
    [/\\times/g, '·'],
    [/\\cdot/g, '·'],
    [/\\tau/g, 'τ'],
    [/\\sigma/g, 'σ'],
    [/\\alpha/g, 'α'],
    [/\\beta/g, 'β'],
    [/\\varphi|\\phi/g, 'φ'],
    [/\\infty/g, '∞'],
    [/\\abs/g, '|'],
  ]
  for (const [re, to] of LATEX) s = s.replace(re, to)
  // Черта над цифрами — так в математике записывают число по его цифрам (abcd).
  // Ставим комбинируемое надчёркивание, чтобы это читалось как в учебнике.
  s = s.replace(/\\overline\{?([A-Za-zА-Яа-я0-9]+)\}?/g, (_m, w: string) =>
    [...w].map((c) => c + '̅').join(''),
  )
  // Всё оставшееся служебное (\left, \right, \quad, \mathop, \dfrac) просто снимаем.
  s = s.replace(/\\[a-zA-Z]+\s?/g, '')

  // Короткая степень без обёртки: «a в степени 4» — так сайт пишет, когда
  // показатель простой. Конструкция «начало степени … конец степени» выше её
  // не ловит, и в тексте оставалось «a_1 в степени 4».
  s = s.replace(/\s*в степени\s+(-?\d+|[a-zA-Zа-яА-Я])(?![\p{L}\d])/gu, '^$1')

  // 4. Слова-связки, которых конструкции выше не покрывают.
  const PHRASES: [string, string][] = [
    ['новая строка', '\n'],
    ['равносильно', ' ⇔ '],
    ['не принадлежит', ' ∉ '],
    ['принадлежит', ' ∈ '],
    ['система', 'система: '],
    ['совокупность', 'совокупность: '],
  ]
  for (const [word, to] of PHRASES) {
    s = s.replace(new RegExp('(?<![\\p{L}])' + word + '(?![\\p{L}])', 'gu'), to)
  }
  // Границу слова здесь НЕЛЬЗЯ писать через \b: в JS она определена через [A-Za-z0-9_],
  // и для кириллицы просто не срабатывает — /\bминус\b/ не найдёт «минус» никогда.
  // Поэтому вокруг слова стоят просмотры «не буква» с флагом u.
  const WORDS: [string, string][] = [
    ['в квадрате', '²'],
    ['в кубе', '³'],
    ['умножить на', '·'],
    ['разделить на', '/'],
    ['больше или равно', '≥'],
    ['меньше или равно', '≤'],
    ['не равно', '≠'],
    ['логарифм по основанию', 'log'],
    ['натуральный логарифм', 'ln'],
    ['плюс', '+'],
    ['минус', '−'],
    ['равно', '='],
    ['больше', '>'],
    ['меньше', '<'],
    ['синус', 'sin'],
    ['косинус', 'cos'],
    ['тангенс', 'tg'],
    ['котангенс', 'ctg'],
    ['бесконечность', '∞'],
    ['градусов', '°'],
    ['пи', 'π'],
    ['альфа', 'α'],
    ['бета', 'β'],
    ['гамма', 'γ'],
    ['сумма', 'Σ'],
  ]
  for (const [word, to] of WORDS) {
    s = s.replace(new RegExp('(?<![\\p{L}])' + word + '(?![\\p{L}])', 'gu'), to)
  }
  // Пробелы схлопываем, но НЕ переносы: «новая строка» выше ставит их осмысленно.
  return s
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\s*([²³°])/g, '$1')
    .trim()
}

/** Задание, снятое со страницы. */
export interface ScrapedTask {
  /** Номер задания в КИМ (из подписи «Тип N»). */
  taskNo?: number
  /** Свой номер задания на сайте — по нему ловим повторы. */
  sourceId?: string
  text: string
  answer?: string
  solution?: string
  /** Критерии оценивания — есть только у заданий второй части. */
  criteria?: string
  /** Адреса чертежей: без них часть заданий нерешаема. */
  imageUrls: string[]
}

/**
 * Разобрать страницу для печати.
 *
 * Работает через DOMParser, а не регулярками: вёрстка сайта живая, а нам нужны
 * вложенные блоки и атрибуты картинок — на регулярках это разъедется на первой
 * же правке чужого шаблона.
 */
export function parsePrintPage(html: string, host: string): ScrapedTask[] {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const out: ScrapedTask[] = []
  const blocks = [...doc.querySelectorAll('.prob_maindiv')]

  /**
   * Кандидаты в условие для каждого задания.
   *
   * Условие бывает не одним куском: у номеров 1–3 сначала идёт текст для чтения,
   * а вопрос к нему отдельным блоком. Вложенные блоки берём один раз, иначе текст
   * задвоится.
   */
  const candidates = blocks.map((block) => {
    const all = [...block.querySelectorAll('.probtext, .pbody')].filter(
      // Критерии оценивания у заданий второй части лежат в СВОЁМ .pbody внутри
      // .prob_crits. Отсекать их надо здесь, по предку: если выкидывать позже,
      // из склеенной копии .prob_crits уже не виден — он остался снаружи.
      (el) => !el.closest('.prob_crits'),
    )
    /**
     * Справка сайта («Источник», «Актуальность», «Правило: … Что проверяется и
     * что нужно знать?») лежит в .align-left и к условию не относится никогда.
     *
     * В подборке по номеру она у всех заданий одна и её ловил отсев по повторам
     * ниже. В ЦЕЛОМ ВАРИАНТЕ у каждого номера справка СВОЯ — повторов нет, и
     * семнадцать из двадцати семи условий по русскому приезжали с тринадцатью
     * тысячами знаков чужой теории впереди. Надёжная примета тут одна: где
     * элемент лежит.
     */
    const real = all.filter((el) => !el.closest('.align-left'))
    const found = real.length ? real : all
    return found.filter((el) => !found.some((o) => o !== el && o.contains(el)))
  })

  /**
   * Отсев статьи сайта.
   *
   * Перед условием сайт иногда разворачивает целую теорию по номеру — тысяч на
   * тринадцать знаков и в такой же разметке. Из-за неё восемьдесят пять разных
   * заданий превращались в восемьдесят пять копий одной статьи.
   *
   * Отличить надёжно можно не по вёрстке (она у каждого номера своя), а по сути:
   * СТАТЬЯ НА СТРАНИЦЕ ОДНА И ТА ЖЕ У ВСЕХ ЗАДАНИЙ, а условие уникально. Значит,
   * выбрасываем куски, повторяющиеся у большинства. Порог высокий: несколько
   * вопросов к одному тексту — обычное дело, и такой текст выкидывать нельзя.
   */
  const freq = new Map<string, number>()
  for (const els of candidates) {
    for (const key of new Set(els.map((e) => clean(e.textContent ?? '').slice(0, 400)))) {
      freq.set(key, (freq.get(key) ?? 0) + 1)
    }
  }
  const shared = (el: Element) =>
    blocks.length >= 4 && (freq.get(clean(el.textContent ?? '').slice(0, 400)) ?? 0) > blocks.length * 0.6

  for (let bi = 0; bi < blocks.length; bi++) {
    const block = blocks[bi]
    const nums = block.querySelector('.prob_nums')?.textContent ?? ''
    const taskNo = Number(clean(nums).match(/Тип\s*(\d+)/)?.[1]) || undefined
    const sourceId = clean(nums).match(/№\s*(\d+)/)?.[1]

    const kept = candidates[bi].filter((el) => !shared(el))
    const body = doc.createElement('div')
    for (const el of (kept.length ? kept : candidates[bi]).length ? (kept.length ? kept : candidates[bi]) : [block]) {
      body.appendChild(el.cloneNode(true))
    }
    // body уже собран из копий — правим его на месте.
    const copy = body
    // .prob_crits — таблица критериев оценивания у заданий второй части. В условие
    // она попадать не должна: ученик видел «…Найдите наименьшее простое число,
    // Критерии оценивания выполнения заданияБаллыВерно получены все…».
    // Сами критерии ценные, поэтому не выбрасываем, а забираем отдельным полем.
    const critsEl = copy.querySelector('.prob_crits') ?? block.querySelector('.prob_crits')
    const criteria = critsEl ? clean(blockText(critsEl)) : undefined
    for (const n of copy.querySelectorAll('.solution, .answer, .prob_nums, .minor, .attr9, .prob_answer, .prob_crits')) {
      n.remove()
    }
    const imageUrls: string[] = []
    for (const img of copy.querySelectorAll('img')) {
      const src = img.getAttribute('src') ?? ''
      if (img.classList.contains('tex')) {
        // Формула — возвращаем в текст.
        img.replaceWith(doc.createTextNode(' ' + formulaFromAlt(img.getAttribute('alt') ?? '') + ' '))
        continue
      }
      if (img.classList.contains('briefcase') || src.startsWith('/img/')) {
        img.remove() // иконки интерфейса
        continue
      }
      const abs = src.startsWith('http') ? src : host + (src.startsWith('/') ? src : '/' + src)
      imageUrls.push(abs)
      img.replaceWith(doc.createTextNode('\n[чертёж]\n'))
    }

    const text = clean(blockText(copy))
    // В ответе тоже бывают формулы-картинки. Без разворота «а) 4 ≤ x ≤ 8; б) 7»
    // превращалось в «а) б)» — эталон, по которому нечего сверять.
    const ansCopy = block.querySelector('.answer')?.cloneNode(true) as HTMLElement | undefined
    if (ansCopy) {
      for (const img of ansCopy.querySelectorAll('img')) {
        if (img.classList.contains('tex')) {
          img.replaceWith(doc.createTextNode(' ' + formulaFromAlt(img.getAttribute('alt') ?? '') + ' '))
        } else {
          img.remove()
        }
      }
    }
    const answer = cleanAnswer(clean(ansCopy ? blockText(ansCopy) : ''))
    const solCopy = block.querySelector('.solution')?.cloneNode(true) as HTMLElement | undefined
    if (solCopy) {
      for (const img of solCopy.querySelectorAll('img')) {
        if (img.classList.contains('tex')) {
          img.replaceWith(doc.createTextNode(' ' + formulaFromAlt(img.getAttribute('alt') ?? '') + ' '))
        } else {
          img.remove()
        }
      }
    }
    const solution = solCopy ? clean(blockText(solCopy)).replace(/^Пояснение[^.]*\.\s*/i, '') : undefined

    if (text.length > 15) out.push({ taskNo, sourceId, text, answer, solution, criteria, imageUrls })
  }
  return out
}

/** Тема каталога: номер темы на сайте и её подборки заданий. */
export interface CatalogTheme {
  /** Номер темы («Т7» → 7). Ориентир для обхода, НЕ номер задания в КИМ. */
  theme: number
  title: string
  categoryIds: number[]
}

/**
 * Каталог предмета: темы и их подборки.
 *
 * Раньше отсюда возвращался плоский список подборок — и загрузка честно обходила
 * все двести с лишним, то есть минут семь на предмет, даже когда нужного уже
 * набрано с запасом. Темы позволяют остановиться: набрали по теме сколько
 * просили — переходим к следующей, а не дочитываем её до конца.
 */
export function parseCatalog(html: string): CatalogTheme[] {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const out: CatalogTheme[] = []
  for (const box of doc.querySelectorAll('.cat_category')) {
    // Заголовок темы — это <b>, а у подборок внутри стоит <a>. По этому и отличаем
    // тему от её подборок: блоки вложены друг в друга и селектор ловит оба.
    const head = clean(box.querySelector('b')?.textContent ?? '')
    // Русский подписывает темы «Т1.», физика и информатика — просто «1.».
    const m = head.match(/^Т?\s*(\d+)\.\s*(.*)$/)
    if (!m) continue
    const ids = [
      ...new Set(
        [...box.querySelectorAll('a[href*="category_id="]')]
          .map((a) => Number(a.getAttribute('href')?.match(/category_id=(\d+)/)?.[1]))
          .filter((n): n is number => Boolean(n)),
      ),
    ]
    if (ids.length) out.push({ theme: Number(m[1]), title: m[2], categoryIds: ids })
  }
  // Запасной путь: вёрстка каталога поменялась — берём хотя бы плоский список.
  if (!out.length) {
    const ids = [
      ...new Set(
        [...doc.querySelectorAll('a[href*="category_id="]')]
          .map((a) => Number(a.getAttribute('href')?.match(/category_id=(\d+)/)?.[1]))
          .filter((n): n is number => Boolean(n)),
      ),
    ]
    if (ids.length) out.push({ theme: 0, title: 'Все задания', categoryIds: ids })
  }
  return out.sort((a, b) => a.theme - b.theme)
}

// ---------- загрузка ----------

/** Ход загрузки — чтобы экран показывал, что происходит, а не «подождите». */
export interface BankProgress {
  subjectId: string
  /** Сколько подборок обработано и сколько всего. */
  done: number
  total: number
  /** Сколько заданий уже набрано. */
  got: number
  note: string
}

export interface BankOptions {
  /** Максимум заданий на один номер КИМ. */
  perTask?: number
  /** Качать ли чертежи. Без них геометрия нерешаема, но банк тяжелеет. */
  withImages?: boolean
  /** Тексты, которые уже есть в банке: повторно их не берём. */
  known?: ReadonlySet<string>
  /**
   * Задания Решу ЕГЭ, которые уже лежат в банке, — по номеру на сайте.
   *
   * Сверять по тексту здесь мало: у задания с чертежом текст в банке уже
   * подчищен от пометки «[чертёж]», и с сырым текстом со страницы он не
   * совпадёт. Номер задания на сайте — точная и неизменная примета, поэтому
   * повторная загрузка опирается на неё.
   */
  knownIds?: ReadonlySet<string>
  onProgress?: (p: BankProgress) => void
  /** Прервать загрузку (ученик закрыл окно). */
  signal?: { aborted: boolean }
}

/**
 * Пауза между запросами. Сайт чужой и живой: качать в сто потоков — значит мешать
 * тем, кто там же готовится. Одна страница отдаёт целую подборку, так что даже с
 * паузой весь предмет забирается за пару минут.
 */
const PAUSE_MS = 900

/** Слишком тяжёлый чертёж пропускаем: столько в задании ЕГЭ не бывает. */
const MAX_IMAGE_BYTES = 120 * 1024

/**
 * Скачать банк по предмету.
 *
 * Порядок: каталог → список подборок → печатная версия каждой подборки. Номер КИМ
 * берём из самой карточки задания («Тип N»), а не из каталога: так номера не
 * разъедутся, если сайт переставит темы местами.
 */
export async function downloadSubject(subjectId: string, opts: BankOptions = {}): Promise<Question[]> {
  const host = BANK_HOSTS[subjectId]
  if (!host) return []
  const perTask = opts.perTask ?? 50
  const known = new Set(opts.known ?? [])
  const knownIds = new Set(opts.knownIds ?? [])
  const report = (done: number, total: number, got: number, note: string) =>
    opts.onProgress?.({ subjectId, done, total, got, note })

  report(0, 1, 0, 'Открываю каталог заданий…')
  const catalog = await getPage(host + '/prob_catalog')
  const themes = parseCatalog(catalog)
  if (!themes.length) throw new Error('Каталог заданий не разобрался — сайт изменил вёрстку.')

  const out: Question[] = []
  const byTask = new Map<number, number>()
  const now = new Date().toISOString()

  for (let ti = 0; ti < themes.length; ti++) {
    if (opts.signal?.aborted) break
    const theme = themes[ti]
    // Сколько набрано по этой теме — считаем отдельно, потому что номер задания
    // известен только из самой карточки, а не из каталога.
    let gotHere = 0

    for (const cid of theme.categoryIds) {
      if (opts.signal?.aborted || gotHere >= perTask) break
      report(ti, themes.length, out.length, `Тема ${theme.theme}: ${theme.title}`.slice(0, 60))

      let tasks: ScrapedTask[] = []
      try {
        const html = await getPage(`${host}/test?filter=all&category_id=${cid}&print=true`)
        tasks = parsePrintPage(html, host)
      } catch {
        await sleep(PAUSE_MS)
        continue // одна подборка не открылась — не повод ронять всю загрузку
      }

      for (const t of tasks) {
        if (opts.signal?.aborted) break
        if (!t.taskNo || !t.answer) continue // без номера или без эталона задание бесполезно
        if ((byTask.get(t.taskNo) ?? 0) >= perTask) continue
        if (t.sourceId && knownIds.has(t.sourceId)) continue
        if (known.has(t.text)) continue
        known.add(t.text)
        if (t.sourceId) knownIds.add(t.sourceId)

        let text = t.text
        const images: string[] = []
        if (t.imageUrls.length) {
          if (!opts.withImages) continue // задание с чертежом без чертежа не решается
          for (const url of t.imageUrls.slice(0, 3)) {
            const data = await getImage(url)
            if (data && data.length <= MAX_IMAGE_BYTES) images.push(data)
            await sleep(200)
          }
          if (!images.length) continue
          text = text.replace(/\[чертёж\]\n?/g, '')
        }

        byTask.set(t.taskNo, (byTask.get(t.taskNo) ?? 0) + 1)
        gotHere++
        out.push({
          id: uid('q_'),
          subjectId,
          taskNo: t.taskNo,
          text: text.trim(),
          answer: t.answer,
          solution: t.solution,
          images: images.length ? images : undefined,
          origin: 'import',
          sourceId: t.sourceId ? 'sdamgia:' + t.sourceId : undefined,
          createdAt: now,
        })
      }

      await sleep(PAUSE_MS)
    }

    report(ti + 1, themes.length, out.length, 'Скачано заданий: ' + out.length)
  }

  return out
}

// ---------- целые варианты ----------

/**
 * Готовый вариант экзамена: задания по порядку, с первого номера до последнего.
 *
 * Отличается от подборки по номеру принципиально. Подборка — это тренировка
 * одного умения; вариант — замер целиком, под таймером и в том порядке, в
 * котором придётся решать на экзамене. Собрать такой из банка нельзя: в нём
 * важен не только состав, но и то, что задания подобраны друг к другу.
 */
export interface ScrapedVariant {
  /** Номер варианта на сайте — он же ссылка. */
  sourceId: string
  title: string
  tasks: ScrapedTask[]
}

/**
 * Список доступных вариантов.
 *
 * Сама страница — одностраничное приложение на восемь килобайт, в её HTML
 * вариантов нет: список подгружается запросом к /newapi/general и лежит там
 * в поле ourVariants. Поэтому разбирать надо JSON, а не разметку.
 */
export async function listVariants(subjectId: string): Promise<string[]> {
  const host = BANK_HOSTS[subjectId]
  if (!host) return []
  const raw = await getPage(host + '/newapi/general')
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    throw new Error('Список вариантов не разобрался — сайт изменил ответ.')
  }
  const ids = (json as { ourVariants?: unknown })?.ourVariants
  if (!Array.isArray(ids)) return []
  return ids.map(String).filter((s) => /^\d+$/.test(s))
}

/** Скачать один вариант целиком. Печатная версия отдаёт его одной страницей. */
export async function fetchVariant(subjectId: string, sourceId: string, no: number): Promise<ScrapedVariant | null> {
  const host = BANK_HOSTS[subjectId]
  if (!host) return null
  const html = await getPage(`${host}/test?id=${sourceId}&print=true`)
  const tasks = parsePrintPage(html, host)
  if (tasks.length < 5) return null // не вариант, а огрызок
  return { sourceId, title: 'Вариант ' + no, tasks }
}

/** Что получилось скачать: сам вариант и задания к нему. */
export interface DownloadedVariant {
  subjectId: string
  sourceId: string
  title: string
  /** Только НОВЫЕ задания — их надо положить в банк. */
  questions: Question[]
  /** Весь вариант по порядку: и новые задания, и те, что уже лежали в банке. */
  questionIds: string[]
  /** Номер каждого задания в работе, параллельно questionIds. */
  taskNos: number[]
}

/**
 * Скачать несколько вариантов подряд.
 *
 * Задания варианта кладутся в тот же банк, что и всё остальное: тогда они
 * заодно попадают в тренажёр и в повторение. Сам вариант — это только порядок,
 * список идентификаторов, а не вторая копия заданий.
 */
export async function downloadVariants(
  subjectId: string,
  count: number,
  opts: BankOptions & {
    /**
     * Задания Решу ЕГЭ, уже лежащие в банке: номер на сайте → наш id задания.
     *
     * Варианты собраны из того же пула, что и подборки по номерам, поэтому
     * пересечение неизбежно. Скачивать копию нельзя: у одного задания должна
     * быть одна личность, иначе попытки и повторение разъедутся на два
     * одинаковых текста. Такие задания вариант просто переиспользует.
     */
    reuse?: ReadonlyMap<string, string>
  } = {},
): Promise<DownloadedVariant[]> {
  const reuse = new Map(opts.reuse ?? [])
  const report = (done: number, total: number, got: number, note: string) =>
    opts.onProgress?.({ subjectId, done, total, got, note })

  report(0, 1, 0, 'Смотрю, какие варианты есть…')
  const ids = await listVariants(subjectId)
  if (!ids.length) throw new Error('На сайте не нашлось готовых вариантов.')
  const take = ids.slice(0, Math.max(1, count))

  const out: DownloadedVariant[] = []
  const now = new Date().toISOString()
  for (let i = 0; i < take.length; i++) {
    if (opts.signal?.aborted) break
    report(i, take.length, out.length, `Вариант ${i + 1} из ${take.length}`)
    let v: ScrapedVariant | null = null
    try {
      v = await fetchVariant(subjectId, take[i], i + 1)
    } catch {
      await sleep(PAUSE_MS)
      continue // один вариант не открылся — остальные всё равно нужны
    }
    if (!v) {
      await sleep(PAUSE_MS)
      continue
    }

    const questions: Question[] = []
    const questionIds: string[] = []
    const taskNos: number[] = []
    for (let ti = 0; ti < v.tasks.length; ti++) {
      const t = v.tasks[ti]
      // Такое задание уже есть в банке — берём его, а не вторую копию.
      const already = t.sourceId ? reuse.get(t.sourceId) : undefined
      if (already) {
        questionIds.push(already)
        taskNos.push(ti + 1)
        continue
      }
      /**
       * Номер задания в варианте — это ЕГО МЕСТО, а не «Тип» с сайта.
       *
       * «Тип» — внутренняя классификация Решу ЕГЭ, и в варианте она разъезжается
       * с работой. У информатики проверка показала: на десятой позиции «Тип Д29»
       * (номера нет вовсе), на тринадцатой «Тип Д30», а на двадцать третьей —
       * «Тип 13», хотя стоит там настоящее задание 23 про исполнителя. Считать
       * по «Типу» значило бы отдать ученику работу с двумя тринадцатыми
       * заданиями, без десятого и двадцать третьего, и с чужими весами баллов.
       */
      const taskNo = ti + 1
      let text = t.text
      const images: string[] = []
      if (t.imageUrls.length && opts.withImages !== false) {
        for (const url of t.imageUrls.slice(0, 3)) {
          const data = await getImage(url)
          if (data && data.length <= MAX_IMAGE_BYTES) images.push(data)
          await sleep(200)
        }
        if (images.length) text = text.replace(/\[чертёж\]\n?/g, '')
      }
      const q: Question = {
        id: uid('q_'),
        subjectId,
        taskNo,
        text: text.trim(),
        answer: t.answer,
        solution: t.solution,
        criteria: t.criteria,
        images: images.length ? images : undefined,
        origin: 'import',
        sourceId: t.sourceId ? 'sdamgia:' + t.sourceId : undefined,
        createdAt: now,
      }
      questions.push(q)
      questionIds.push(q.id)
      taskNos.push(taskNo)
      if (t.sourceId) reuse.set(t.sourceId, q.id)
    }
    out.push({ subjectId, sourceId: v.sourceId, title: v.title, questions, questionIds, taskNos })
    report(i + 1, take.length, out.length, 'Скачано вариантов: ' + out.length)
    await sleep(PAUSE_MS)
  }
  return out
}
