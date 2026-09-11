// Свои чертежи к заданиям: приложение рисует их само.
//
// Зачем. Часть заданий ЕГЭ без картинки не существует в принципе: «найдите
// площадь фигуры на клетчатой бумаге» или «определите путь по графику
// скорости» — это задания К РИСУНКУ, текстом их не задать. Генератор такие
// номера просто пропускал.
//
// Чертежи скачанных заданий приходят с сайта, и это чужие картинки. А эти —
// наши: строятся из тех же чисел, из которых считается ответ. Значит, рисунок
// и ответ не могут разойтись, и никаких вопросов к источнику нет.
//
// Отдаём готовый SVG как data:URL — его показывает ui/TaskFigures через <img>.
// Внутри <img> браузер не выполняет скрипты и не применяет внешние стили,
// поэтому всё оформление здесь инлайновое, а фон рисунка всегда белый:
// на тёмной теме карточка чертежа тоже белая, как лист бумаги.

/** Цвета чертежа. Тёмное по белому — как в настоящем КИМ. */
const INK = '#1c2430'
const GRID = '#c9d4e0'
const FILL = 'rgba(45, 212, 191, 0.18)'
const ACCENT = '#0d9488'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Собрать SVG и упаковать в data:URL. */
function svg(w: number, h: number, body: string): string {
  const doc =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">` +
    `<rect width="${w}" height="${h}" fill="#fff"/>` +
    `<g font-family="Georgia, 'Times New Roman', serif" font-size="15" fill="${INK}">${body}</g>` +
    `</svg>`
  // encodeURIComponent, а не base64: SVG — это текст, так data:URL читаемее и короче.
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(doc)
}

const line = (x1: number, y1: number, x2: number, y2: number, color = GRID, w = 1) =>
  `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${w}"/>`

const text = (x: number, y: number, s: string, anchor = 'middle', size = 15) =>
  `<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="${size}">${esc(s)}</text>`

const dot = (x: number, y: number, r = 3.5, color = INK) =>
  `<circle cx="${x}" cy="${y}" r="${r}" fill="${color}"/>`

/** Стрелка на конце отрезка — для осей координат. */
function arrow(x1: number, y1: number, x2: number, y2: number): string {
  const a = Math.atan2(y2 - y1, x2 - x1)
  const s = 7
  const p = (k: number) => `${x2 - s * Math.cos(a - k)},${y2 - s * Math.sin(a - k)}`
  return line(x1, y1, x2, y2, INK, 1.6) +
    `<polygon points="${x2},${y2} ${p(0.4)} ${p(-0.4)}" fill="${INK}"/>`
}

// ---------- клетчатая бумага ----------

/** Точка в клетках. */
export interface Cell { x: number; y: number }

/**
 * Многоугольник на клетчатой бумаге.
 *
 * Классическое задание 1 профильной математики: фигура нарисована по клеткам,
 * нужна её площадь. Без рисунка условие не сформулировать.
 *
 * @param pts вершины в клетках, против часовой стрелки на экране
 * @param cols сколько клеток в сетке по горизонтали
 * @param rows сколько по вертикали
 */
export function gridPolygon(pts: Cell[], cols: number, rows: number): string {
  const S = 26 // сторона клетки в пикселях
  const PAD = 14
  const w = cols * S + PAD * 2
  const h = rows * S + PAD * 2
  const px = (c: number) => PAD + c * S
  // Ось Y на бумаге растёт вверх, в SVG — вниз. Переворачиваем здесь один раз,
  // чтобы во всех заданиях координаты считались «по-человечески».
  const py = (c: number) => PAD + (rows - c) * S

  let g = ''
  for (let i = 0; i <= cols; i++) g += line(px(i), PAD, px(i), PAD + rows * S)
  for (let j = 0; j <= rows; j++) g += line(PAD, py(j), PAD + cols * S, py(j))

  const poly = pts.map((p) => `${px(p.x)},${py(p.y)}`).join(' ')
  g += `<polygon points="${poly}" fill="${FILL}" stroke="${ACCENT}" stroke-width="2.4" stroke-linejoin="round"/>`
  for (const p of pts) g += dot(px(p.x), py(p.y), 3, ACCENT)
  return svg(w, h, g)
}

/**
 * Площадь многоугольника по координатам вершин — формула шнурования.
 * Ею же считается ответ, поэтому рисунок и ответ заведомо согласованы.
 */
export function polygonArea(pts: Cell[]): number {
  let s = 0
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    s += a.x * b.y - b.x * a.y
  }
  return Math.abs(s) / 2
}

// ---------- график ----------

/** Узел ломаной: время и значение. */
export interface GraphPoint { t: number; v: number }

/**
 * График величины от времени: ломаная по узлам.
 *
 * Задание «определите путь по графику скорости» — это площадь под ломаной.
 * Ни условие, ни ответ без рисунка не существуют.
 */
export function lineGraph(
  pts: GraphPoint[],
  opts: { xLabel: string; yLabel: string; xMax: number; yMax: number },
): string {
  const PAD_L = 46
  // Снизу и справа места нужно больше, чем кажется: там сходятся стрелка оси,
  // последнее деление и подпись величины. С прежними отступами «t, с» налезало
  // и на стрелку, и на цифру.
  const PAD_B = 52
  const PAD_T = 22
  const PAD_R = 40
  const S = 34 // пикселей на деление
  const w = PAD_L + opts.xMax * S + PAD_R
  const h = PAD_T + opts.yMax * S + PAD_B
  const px = (t: number) => PAD_L + t * S
  const py = (v: number) => PAD_T + (opts.yMax - v) * S

  let g = ''
  // сетка по делениям
  for (let i = 0; i <= opts.xMax; i++) g += line(px(i), PAD_T, px(i), py(0))
  for (let j = 0; j <= opts.yMax; j++) g += line(PAD_L, py(j), px(opts.xMax), py(j))

  // площадь под ломаной закрашена: именно её и просят найти
  const area = [`${px(pts[0].t)},${py(0)}`, ...pts.map((p) => `${px(p.t)},${py(p.v)}`), `${px(pts[pts.length - 1].t)},${py(0)}`]
  g += `<polygon points="${area.join(' ')}" fill="${FILL}"/>`
  g += `<polyline points="${pts.map((p) => `${px(p.t)},${py(p.v)}`).join(' ')}" fill="none" stroke="${ACCENT}" stroke-width="2.6" stroke-linejoin="round"/>`
  for (const p of pts) g += dot(px(p.t), py(p.v), 3, ACCENT)

  // оси со стрелками и подписями делений
  g += arrow(PAD_L, py(0), px(opts.xMax) + 14, py(0))
  g += arrow(PAD_L, py(0), PAD_L, PAD_T - 10)
  for (let i = 1; i <= opts.xMax; i++) g += text(px(i), py(0) + 17, String(i), 'middle', 12)
  for (let j = 1; j <= opts.yMax; j++) g += text(PAD_L - 8, py(j) + 4, String(j), 'end', 12)
  // Подписи осей — отдельной строкой ниже делений и левее шкалы, чтобы
  // ни с цифрами, ни со стрелками они не пересекались.
  g += text(px(opts.xMax) + 18, py(0) + 36, opts.xLabel, 'end', 13)
  g += text(PAD_L - 10, PAD_T - 8, opts.yLabel, 'end', 13)
  return svg(w, h, g)
}

/** Площадь под ломаной — путь по графику скорости. Трапеции по каждому участку. */
export function areaUnder(pts: GraphPoint[]): number {
  let s = 0
  for (let i = 1; i < pts.length; i++) {
    s += ((pts[i - 1].v + pts[i].v) / 2) * (pts[i].t - pts[i - 1].t)
  }
  return s
}
