// Генератор заданий ВНУТРИ приложения: задания не кончаются и их нельзя запомнить.
//
// Зачем так. Раньше банк был фиксированным файлом: 249 заданий, то есть около восьми
// на номер. Восемь — это минут пятнадцать, дальше ученик начинает узнавать формулировки,
// и интервальное повторение гоняет знакомые задания вместо проверки умения. Дописать
// пять тысяч заданий руками нельзя (не с гарантией правильности), а копировать чужие
// сборники нельзя по праву.
//
// Решение: генерировать на месте. Условие, ответ и разбор собираются из одних и тех же
// случайных чисел, поэтому ответ верен ПО ПОСТРОЕНИЮ — его неоткуда взять неправильно.
// Числа новые каждый раз, значит задание невозможно выучить наизусть.
//
// Где генератор не применим (сочинение, задачи по графику, развёрнутый ответ) — там
// его просто нет, и приложение честно предлагает свои задания через импорт.

import type { Question } from '../types'
import { PARONYMS, PLEONASM, FORMS } from '../data/norms'
import { ROOT_WORDS, PREFIX_WORDS, SUFFIX_WORDS, ENDING_WORDS, type GapWord } from '../data/spelling'
import { gridPolygon, polygonArea, lineGraph, areaUnder, type Cell, type GraphPoint } from './figures'
import { uid } from './api'

export interface GeneratedTask {
  subjectId: string
  taskNo: number
  topic: string
  text: string
  answer: string
  solution: string
  /** Свой чертёж как data:URL. Есть там, где без рисунка задания не существует. */
  figure?: string
}

/** Источник случайности. Свой — чтобы можно было воспроизвести набор в тестах. */
export type Rnd = () => number

const int = (r: Rnd, a: number, b: number) => a + Math.floor(r() * (b - a + 1))
const pick = <T,>(r: Rnd, a: readonly T[]): T => a[Math.floor(r() * a.length)]
/** Перемешать копию. Порядок вариантов не должен намекать на ответ. */
const shuffle = <T,>(r: Rnd, a: readonly T[]): T[] => {
  const out = [...a]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}
/**
 * Число для показа ученику, с запятой вместо точки.
 *
 * Округление здесь обязательно: 0,1 · 3,5 в двоичной арифметике даёт
 * 0.35000000000000003, и такой «правильный ответ» невозможно набрать —
 * проверка засчитала бы верное решение как ошибку. Шести знаков после
 * запятой хватает любому заданию ЕГЭ.
 */
const dec = (x: number) => String(Math.round(x * 1e6) / 1e6).replace('.', ',')

type Family = (r: Rnd) => { text: string; answer: string; solution: string; figure?: string } | null

interface TaskSpec {
  topic: string
  families: Family[]
}

// ---------- Профильная математика ----------

const MATH: Record<number, TaskSpec> = {
  1: {
    topic: 'Планиметрия',
    families: [
      (r) => {
        const a = int(r, 4, 20), h = int(r, 3, 16)
        if ((a * h) % 2 !== 0) return null
        const s = (a * h) / 2
        return {
          text: `Основание треугольника равно ${a}, а высота, проведённая к нему, равна ${h}. Найдите площадь треугольника.`,
          answer: String(s),
          solution: `Площадь треугольника: S = ½ · основание · высоту.\nS = ½ · ${a} · ${h} = ${s}.`,
        }
      },
      (r) => {
        const a = int(r, 3, 14), b = int(r, a + 1, 22), h = int(r, 2, 12)
        if (((a + b) * h) % 2 !== 0) return null
        const s = ((a + b) / 2) * h
        return {
          text: `Основания трапеции равны ${a} и ${b}, высота равна ${h}. Найдите площадь трапеции.`,
          answer: String(s),
          solution: `Площадь трапеции: S = ((a + b) / 2) · h.\nS = ((${a} + ${b}) / 2) · ${h} = ${(a + b) / 2} · ${h} = ${s}.`,
        }
      },
      (r) => {
        const a = int(r, 3, 18), h = int(r, 2, 14)
        return {
          text: `Сторона параллелограмма равна ${a}, а высота, проведённая к ней, равна ${h}. Найдите площадь параллелограмма.`,
          answer: String(a * h),
          solution: `Площадь параллелограмма: S = a · h.\nS = ${a} · ${h} = ${a * h}.`,
        }
      },
      // Фигура на клетчатой бумаге. Условия тут нет вообще — есть рисунок,
      // и без него задание не существует. Раньше генератор такие пропускал.
      (r) => gridFigureTask(r),
    ],
  },
  2: {
    topic: 'Векторы',
    families: [
      (r) => {
        const x1 = int(r, -8, 9), y1 = int(r, -8, 9), x2 = int(r, -8, 9), y2 = int(r, -8, 9)
        const s = x1 * x2 + y1 * y2
        return {
          text: `Даны векторы a(${x1}; ${y1}) и b(${x2}; ${y2}). Найдите их скалярное произведение.`,
          answer: String(s),
          solution: `Скалярное произведение в координатах: a·b = x₁x₂ + y₁y₂.\na·b = ${x1}·${x2} + ${y1}·${y2} = ${x1 * x2} + ${y1 * y2} = ${s}.`,
        }
      },
      (r) => {
        const [x, y] = pick(r, [[3, 4], [6, 8], [5, 12], [8, 15], [9, 12], [7, 24], [20, 21], [12, 16]] as const)
        const len = Math.round(Math.sqrt(x * x + y * y))
        return {
          text: `Найдите длину вектора a(${x}; ${y}).`,
          answer: String(len),
          solution: `Длина вектора: |a| = √(x² + y²).\n|a| = √(${x}² + ${y}²) = √(${x * x} + ${y * y}) = √${x * x + y * y} = ${len}.`,
        }
      },
    ],
  },
  3: {
    topic: 'Стереометрия',
    families: [
      (r) => {
        const a = int(r, 2, 12), b = int(r, 2, 12), c = int(r, 2, 12)
        return {
          text: `Измерения прямоугольного параллелепипеда равны ${a}, ${b} и ${c}. Найдите его объём.`,
          answer: String(a * b * c),
          solution: `Объём параллелепипеда: V = a · b · c.\nV = ${a} · ${b} · ${c} = ${a * b * c}.`,
        }
      },
      (r) => {
        const a = int(r, 2, 15)
        return {
          text: `Ребро куба равно ${a}. Найдите площадь его полной поверхности.`,
          answer: String(6 * a * a),
          solution: `У куба 6 одинаковых граней, каждая — квадрат со стороной ${a}.\nS = 6a² = 6 · ${a * a} = ${6 * a * a}.`,
        }
      },
      (r) => {
        const s = int(r, 4, 30), h = int(r, 3, 15)
        if ((s * h) % 3 !== 0) return null
        return {
          text: `Площадь основания пирамиды равна ${s}, высота равна ${h}. Найдите объём пирамиды.`,
          answer: String((s * h) / 3),
          solution: `Объём пирамиды: V = ⅓ · S_осн · h.\nV = ${s} · ${h} / 3 = ${s * h} / 3 = ${(s * h) / 3}.`,
        }
      },
    ],
  },
  4: {
    topic: 'Вероятность',
    families: [
      (r) => {
        const p1 = int(r, 88, 97) / 100
        const p2 = (Math.round(p1 * 100) - int(r, 4, 12)) / 100
        const ans = Math.round((p1 - p2) * 100) / 100
        return {
          text: `Вероятность того, что новый чайник прослужит больше года, равна ${dec(p1)}. Вероятность того, что он прослужит больше двух лет, равна ${dec(p2)}. Найдите вероятность того, что чайник прослужит меньше двух лет, но больше года.`,
          answer: dec(ans),
          solution: `«Больше года» включает в себя «больше двух лет», поэтому нужный кусок — разность.\nP = ${dec(p1)} − ${dec(p2)} = ${dec(ans)}.`,
        }
      },
      (r) => {
        const total = pick(r, [20, 25, 40, 50] as const)
        const good = int(r, 3, total / 2)
        const ans = good / total
        if (Math.round(ans * 1000) / 1000 !== ans) return null
        return {
          text: `В соревновании участвуют ${total} спортсменов, из них ${good} — из России. Порядок выступления определяется жребием. Найдите вероятность того, что первым будет выступать спортсмен из России.`,
          answer: dec(ans),
          solution: `Классическая вероятность: P = (подходящие исходы) / (все исходы).\nP = ${good} / ${total} = ${dec(ans)}.`,
        }
      },
    ],
  },
  5: {
    topic: 'Вероятность',
    families: [
      (r) => {
        const p = int(r, 10, 95) / 100
        const ans = Math.round(p * p * 10000) / 10000
        return {
          text: `Вероятность того, что стрелок попадёт в мишень при одном выстреле, равна ${dec(p)}. Найдите вероятность того, что он попадёт при обоих из двух выстрелов. Выстрелы независимы.`,
          answer: dec(ans),
          solution: `Выстрелы независимы — вероятности перемножаются.\nP = ${dec(p)} · ${dec(p)} = ${dec(ans)}.`,
        }
      },
      (r) => {
        const p = int(r, 5, 60) / 100
        const q = Math.round((1 - p) * 100) / 100
        const both = Math.round(q * q * 10000) / 10000
        const ans = Math.round((1 - q * q) * 10000) / 10000
        return {
          text: `Вероятность выхода прибора из строя за год равна ${dec(p)}. Найдите вероятность того, что из двух независимых приборов за год откажет хотя бы один.`,
          answer: dec(ans),
          solution: `«Хотя бы один» считаем через противоположное событие.\nНи один не откажет: ${dec(q)} · ${dec(q)} = ${dec(both)}.\nP = 1 − ${dec(both)} = ${dec(ans)}.`,
        }
      },
    ],
  },
  7: {
    topic: 'Уравнения',
    families: [
      (r) => {
        const base = pick(r, [2, 3, 4, 5] as const), k = int(r, 2, 4), a = int(r, 1, 9)
        return {
          text: `Найдите корень уравнения ${base}^(x − ${a}) = ${base ** k}.`,
          answer: String(a + k),
          solution: `Приводим к одному основанию: ${base ** k} = ${base}^${k}.\nОснования равны — равны показатели: x − ${a} = ${k}.\nx = ${k} + ${a} = ${a + k}.`,
        }
      },
      (r) => {
        const base = pick(r, [2, 3, 5] as const), c = int(r, 2, 4), b = int(r, 1, 20)
        return {
          text: `Найдите корень уравнения log_${base}(x + ${b}) = ${c}.`,
          answer: String(base ** c - b),
          solution: `По определению логарифма: x + ${b} = ${base}^${c} = ${base ** c}.\nx = ${base ** c} − ${b} = ${base ** c - b}.\nПод логарифмом ${base ** c} > 0 — ОДЗ соблюдена.`,
        }
      },
      (r) => {
        const b = int(r, 3, 12), a = int(r, 1, 30)
        return {
          text: `Найдите корень уравнения √(x + ${a}) = ${b}.`,
          answer: String(b * b - a),
          solution: `Возводим обе части в квадрат: x + ${a} = ${b * b}.\nx = ${b * b} − ${a} = ${b * b - a}.\nПроверка: √(${b * b - a} + ${a}) = ${b} — верно.`,
        }
      },
    ],
  },
  8: {
    topic: 'Вычисления',
    families: [
      (r) => {
        const base = pick(r, [2, 3, 5, 7] as const), m = int(r, 2, 5), k = int(r, 1, 4)
        return {
          text: `Найдите значение выражения log_${base}(${base ** m}) · ${k}.`,
          answer: String(m * k),
          solution: `log_${base}(${base ** m}) — степень, в которую надо возвести ${base}, чтобы получить ${base ** m}. Она равна ${m}.\n${m} · ${k} = ${m * k}.`,
        }
      },
      (r) => {
        const a = pick(r, [2, 3, 5] as const), m = int(r, 5, 9), k = int(r, 1, 4)
        return {
          text: `Найдите значение выражения ${a}^${m} / ${a}^${m - k}.`,
          answer: String(a ** k),
          solution: `При делении степеней с одинаковым основанием показатели вычитаются.\n${a}^(${m} − ${m - k}) = ${a}^${k} = ${a ** k}.`,
        }
      },
    ],
  },
  6: {
    topic: 'Случайная величина',
    families: [
      (r) => {
        // Ожидание считаем в сотых долях целыми числами: 0.1·2 + 0.3·5 в двоичной
        // арифметике даёт хвост, а ученик такой ответ не наберёт.
        const n = int(r, 3, 4)
        const vals: number[] = []
        while (vals.length < n) {
          const v = int(r, 0, 12)
          if (!vals.includes(v)) vals.push(v)
        }
        vals.sort((a, b) => a - b)
        // Вероятности в сотых, в сумме ровно 100.
        const parts: number[] = []
        let left = 100
        for (let i = 0; i < n - 1; i++) {
          const p = int(r, 5, Math.max(5, left - 5 * (n - 1 - i)))
          parts.push(p)
          left -= p
        }
        parts.push(left)
        if (parts.some((p) => p < 5)) return null
        const exp100 = vals.reduce((s, v, i) => s + v * parts[i], 0)
        const table = vals.map((v, i) => `${v} — ${dec(parts[i] / 100)}`).join(';  ')
        const terms = vals.map((v, i) => `${v}·${dec(parts[i] / 100)}`).join(' + ')
        return {
          text: `Случайная величина X задана законом распределения (значение — вероятность):\n\n${table}\n\nНайдите математическое ожидание X.`,
          answer: dec(exp100 / 100),
          solution: `Математическое ожидание: M(X) = Σ xᵢ·pᵢ.\nM(X) = ${terms} = ${dec(exp100 / 100)}.\nПроверка: сумма вероятностей ${dec(parts.reduce((a, b) => a + b, 0) / 100)}.`,
        }
      },
      (r) => {
        const n = int(r, 2, 6)
        const p = pick(r, [10, 20, 25, 40, 50, 60, 75, 80] as const)
        return {
          text: `Проводится ${n} независимых испытаний, в каждом событие A происходит с вероятностью ${dec(p / 100)}. Найдите математическое ожидание числа появлений события A.`,
          answer: dec((n * p) / 100),
          solution: `Для схемы Бернулли M(X) = n·p.\nM(X) = ${n} · ${dec(p / 100)} = ${dec((n * p) / 100)}.`,
        }
      },
    ],
  },
  9: {
    topic: 'Производная',
    families: [
      (r) => {
        const a = int(r, 2, 9), b = int(r, 1, 12), t = int(r, 1, 6)
        return {
          text: `Точка движется по прямой по закону x(t) = ${a}t² + ${b}t, где x — координата в метрах, t — время в секундах. Найдите её скорость в момент времени t = ${t} с.`,
          answer: String(2 * a * t + b),
          solution: `Скорость — производная координаты по времени.\nv(t) = (${a}t² + ${b}t)′ = ${2 * a}t + ${b}.\nv(${t}) = ${2 * a} · ${t} + ${b} = ${2 * a * t + b} м/с.`,
        }
      },
      (r) => {
        const half = int(r, 1, 9), c = int(r, 1, 40)
        const b = 2 * half
        return {
          text: `Найдите наименьшее значение функции y = x² + ${b}x + ${c}.`,
          answer: String(c - half * half),
          solution: `Парабола ветвями вверх — наименьшее значение в вершине.\nx = −b/(2a) = −${b}/2 = −${half}.\ny(−${half}) = ${half * half} − ${b * half} + ${c} = ${c - half * half}.`,
        }
      },
    ],
  },
  13: {
    topic: 'Экономическая задача',
    families: [
      (r) => {
        // Вклад под сложный процент: сумма растёт в (1 + p/100) раз каждый год.
        const s = pick(r, [40000, 50000, 60000, 80000, 100000, 120000, 150000, 200000] as const)
        const p = pick(r, [5, 10, 20, 25, 50] as const)
        const years = int(r, 2, 3)
        const total = s * (1 + p / 100) ** years
        if (!Number.isInteger(total)) return null
        return {
          text: `В банк положили ${s} рублей под ${p} % годовых. Проценты начисляются в конце каждого года на всю сумму вклада. Какая сумма будет на счёте через ${years} года? Ответ дайте в рублях.`,
          answer: String(total),
          solution: `Каждый год сумма умножается на 1 + ${p}/100 = ${dec(1 + p / 100)}.\nЗа ${years} года: ${s} · ${dec(1 + p / 100)}^${years} = ${total} руб.`,
        }
      },
      (r) => {
        // Кредит, погашаемый равными платежами. Долг растёт на p %, потом платёж x.
        // Чтобы ответ был целым, подбираем сумму кратной знаменателю.
        const p = pick(r, [10, 20, 25, 50] as const)
        const k = 1 + p / 100
        const years = int(r, 2, 3)
        // Сумма платежей = S · k^n · (k − 1) / (k^n − 1) · n
        const denom = k ** years - 1
        const base = pick(r, [100000, 120000, 150000, 200000, 240000, 300000] as const)
        const payment = (base * k ** years * (k - 1)) / denom
        const total = payment * years
        if (!Number.isInteger(payment) || !Number.isInteger(total)) return null
        return {
          text: `В банке взяли кредит ${base} рублей. Условия таковы: в конце каждого года долг увеличивается на ${p} %, после чего вносится платёж. Кредит гасится ${years} равными платежами. Найдите размер одного платежа. Ответ дайте в рублях.`,
          answer: String(payment),
          solution: `Пусть платёж x. После ${years} лет долг обнуляется:\n${base}·${dec(k)}^${years} = x·(${dec(k)}^${years - 1} + … + 1).\nОтсюда x = ${base}·${dec(k)}^${years}·(${dec(k)} − 1) / (${dec(k)}^${years} − 1) = ${payment} руб.\nОбщая выплата: ${payment} · ${years} = ${total} руб.`,
        }
      },
    ],
  },
  11: {
    topic: 'Текстовые задачи',
    families: [
      (r) => {
        const v = pick(r, [40, 50, 60, 75, 80] as const), t = int(r, 2, 9)
        return {
          text: `Автомобиль ехал с постоянной скоростью ${v} км/ч и был в пути ${t} ч. Сколько километров он проехал?`,
          answer: String(v * t),
          solution: `Путь при равномерном движении: s = v · t.\ns = ${v} · ${t} = ${v * t} км.`,
        }
      },
      (r) => {
        const v1 = pick(r, [50, 60, 70] as const), v2 = pick(r, [10, 15, 20] as const), t = int(r, 2, 6)
        return {
          text: `Из двух посёлков навстречу друг другу одновременно вышли два пешехода со скоростями ${v1} и ${v2} км/ч. Через ${t} ч они встретились. Найдите расстояние между посёлками в километрах.`,
          answer: String((v1 + v2) * t),
          solution: `При движении навстречу скорости складываются: ${v1} + ${v2} = ${v1 + v2} км/ч.\ns = ${v1 + v2} · ${t} = ${(v1 + v2) * t} км.`,
        }
      },
    ],
  },
}

// ---------- Информатика ----------

/** Составные числа с богатым набором делителей — на них задания про делители осмысленны. */
const DIVISIBLE: readonly number[] = [
  60, 72, 84, 90, 96, 108, 120, 126, 132, 140, 144, 150, 156, 168, 180, 192, 198, 210, 216, 220,
  240, 252, 264, 270, 280, 288, 294, 300, 312, 320, 324, 336, 350, 360, 378, 384, 396, 400, 420,
  432, 440, 450, 462, 480, 490, 504, 520, 528, 540, 550, 560, 576, 588, 600, 612, 630, 640, 648,
  660, 672, 700, 720, 750, 756, 768, 780, 792, 800, 810, 840, 864, 880, 900, 924, 936, 960, 972,
  980, 1008, 1050, 1080, 1120, 1152, 1200, 1260, 1320, 1400, 1440, 1512, 1560, 1680, 1800, 1920,
]

const VOWELS = new Set(['А', 'Е', 'И', 'О', 'У', 'Ы', 'Э', 'Ю', 'Я'])

/** Наборы букв для комбинаторики: у каждого свой состав гласных и согласных. */
const LETTER_SETS: readonly (readonly string[])[] = [
  ['А', 'Б', 'В'],
  ['К', 'Л', 'М', 'Н'],
  ['А', 'О', 'У', 'Ы', 'Э'],
  ['Б', 'В', 'Г', 'А', 'О'],
  ['Д', 'Е', 'Ж', 'И'],
  ['Л', 'М', 'Н', 'О', 'П', 'А'],
  ['Р', 'С', 'Т', 'У'],
  ['А', 'Б', 'В', 'Г', 'Д', 'Е'],
  ['И', 'К', 'С', 'Т'],
  ['Е', 'Л', 'О', 'Р', 'Т'],
  ['А', 'Г', 'Н', 'О', 'Р'],
  ['З', 'И', 'М', 'А'],
  ['В', 'Е', 'Т', 'Р', 'О', 'С'],
  ['Ю', 'Я', 'П', 'Р'],
  ['Б', 'Д', 'Ж', 'Э', 'Ы'],
]

const INFORMATICS: Record<number, TaskSpec> = {
  7: {
    topic: 'Объём данных',
    families: [
      (r) => {
        const w = pick(r, [640, 800, 1024, 1280, 1600] as const)
        const h = pick(r, [480, 600, 768, 1024] as const)
        const depth = pick(r, [8, 16, 24, 32] as const)
        const kb = (w * h * depth) / 8 / 1024
        if (!Number.isInteger(kb)) return null
        return {
          text: `Несжатое растровое изображение размером ${w} × ${h} пикселей сохранили с глубиной цвета ${depth} бит на пиксель. Определите размер файла в Кбайт (служебные данные не учитывать).`,
          answer: String(kb),
          solution: `V = ширина · высота · глубина = ${w} · ${h} · ${depth} = ${w * h * depth} бит.\nВ байты: / 8 = ${(w * h * depth) / 8}.\nВ Кбайты: / 1024 = ${kb} Кбайт.`,
        }
      },
      (r) => {
        const freq = pick(r, [16000, 24000, 32000, 48000] as const)
        const bits = pick(r, [8, 16] as const)
        const sec = pick(r, [10, 15, 30, 60] as const)
        const ch = pick(r, [1, 2] as const)
        const kb = (freq * bits * sec * ch) / 8 / 1024
        if (!Number.isInteger(kb)) return null
        return {
          text: `Производится ${ch === 1 ? 'одноканальная (моно)' : 'двухканальная (стерео)'} звукозапись с частотой дискретизации ${freq} Гц и разрешением ${bits} бит. Запись длится ${sec} секунд. Определите размер файла в Кбайт (сжатие не используется).`,
          answer: String(kb),
          solution: `V = частота · разрядность · время · каналы = ${freq} · ${bits} · ${sec} · ${ch} = ${freq * bits * sec * ch} бит.\nВ Кбайты: / 8 / 1024 = ${kb} Кбайт.`,
        }
      },
    ],
  },
  8: {
    topic: 'Комбинаторика',
    families: [
      (r) => {
        const letters = pick(r, LETTER_SETS)
        const len = int(r, 3, 6)
        const cons = letters.filter((c) => !VOWELS.has(c)).length
        if (!cons) return null
        const count = cons * letters.length ** (len - 1)
        return {
          text: `Все ${len}-буквенные слова составляются из букв ${letters.join(', ')}. Буквы могут повторяться. Сколько существует слов, которые НЕ начинаются с гласной буквы?`,
          answer: String(count),
          solution: `На первую позицию годятся только согласные — их ${cons}.\nНа каждую из остальных ${len - 1} позиций — любая из ${letters.length} букв.\nВсего: ${cons} · ${letters.length}^${len - 1} = ${count}.`,
        }
      },
      (r) => {
        const letters = pick(r, LETTER_SETS)
        const len = int(r, 3, 6)
        const last = pick(r, letters)
        const count = letters.length ** (len - 1)
        return {
          text: `Все ${len}-буквенные слова составляются из букв ${letters.join(', ')}. Буквы могут повторяться. Сколько существует слов, которые заканчиваются на букву ${last}?`,
          answer: String(count),
          solution: `Последняя буква задана — на неё есть ровно 1 вариант.\nНа каждую из остальных ${len - 1} позиций — любая из ${letters.length} букв.\nВсего: ${letters.length}^${len - 1} = ${count}.`,
        }
      },
      (r) => {
        const letters = pick(r, LETTER_SETS)
        const len = int(r, 3, 5)
        const vow = letters.filter((c) => VOWELS.has(c)).length
        const cons = letters.length - vow
        if (!vow || !cons || len < 2) return null
        const count = cons * letters.length ** (len - 2) * vow
        return {
          text: `Все ${len}-буквенные слова составляются из букв ${letters.join(', ')}. Буквы могут повторяться. Сколько существует слов, которые начинаются с согласной и заканчиваются гласной?`,
          answer: String(count),
          solution: `Первая буква — согласная: ${cons} вариантов.\nПоследняя — гласная: ${vow} вариантов.\nСередина (${len - 2} позиций) — любая из ${letters.length}.\nВсего: ${cons} · ${letters.length}^${len - 2} · ${vow} = ${count}.`,
        }
      },
      (r) => {
        const letters = pick(r, LETTER_SETS)
        const len = int(r, 2, Math.min(4, letters.length))
        let count = 1
        for (let k = 0; k < len; k++) count *= letters.length - k
        const factors: number[] = []
        for (let k = 0; k < len; k++) factors.push(letters.length - k)
        return {
          text: `Все ${len}-буквенные слова составляются из букв ${letters.join(', ')}. Сколько существует слов, в которых все буквы РАЗЛИЧНЫ?`,
          answer: String(count),
          solution: `Каждая следующая позиция теряет одну букву из запаса.\nВсего: ${factors.join(' · ')} = ${count}.`,
        }
      },
    ],
  },
  11: {
    topic: 'Кодирование',
    families: [
      (r) => {
        const alphabet = pick(r, [26, 30, 33, 60, 68, 100] as const)
        const len = int(r, 6, 14)
        const people = pick(r, [20, 50, 100, 200, 500] as const)
        const bpc = Math.ceil(Math.log2(alphabet))
        const bytes = Math.ceil((bpc * len) / 8)
        return {
          text: `Для регистрации на сайте каждому пользователю выдаётся идентификатор из ровно ${len} символов. В качестве символов используют ${alphabet} различных знаков. Каждый идентификатор записывается минимально возможным и одинаковым целым количеством байт, при этом используется посимвольное кодирование и все символы кодируются одинаковым и минимально возможным количеством бит. Определите объём памяти в байтах, отводимый для записи ${people} идентификаторов.`,
          answer: String(bytes * people),
          solution: `Бит на символ: ⌈log₂ ${alphabet}⌉ = ${bpc}.\nБит на идентификатор: ${bpc} · ${len} = ${bpc * len}.\nБайт (округляем ВВЕРХ): ⌈${bpc * len} / 8⌉ = ${bytes}.\nНа ${people} штук: ${bytes} · ${people} = ${bytes * people}.`,
        }
      },
    ],
  },
  13: {
    topic: 'Сети',
    families: [
      (r) => {
        const prefix = pick(r, [24, 25, 26, 27, 28] as const)
        const oct = [int(r, 10, 200), int(r, 0, 255), int(r, 0, 255), int(r, 1, 254)]
        const maskBits = 0xffffffff << (32 - prefix)
        const mask = [(maskBits >>> 24) & 255, (maskBits >>> 16) & 255, (maskBits >>> 8) & 255, maskBits & 255]
        const last = oct[3] & mask[3]
        return {
          text: `IP-адрес узла: ${oct.join('.')}, маска подсети: ${mask.join('.')}. Чему равен последний байт адреса сети?`,
          answer: String(last),
          solution: `Адрес сети = IP AND маска, побитово.\nПоследний байт адреса ${oct[3]}, маски ${mask[3]}.\n${oct[3]} AND ${mask[3]} = ${last}.`,
        }
      },
    ],
  },
  14: {
    topic: 'Системы счисления',
    families: [
      (r) => {
        const base = pick(r, [2, 3, 5, 8, 16] as const)
        const value = int(r, 50, 900)
        const rec = value.toString(base).toUpperCase()
        return {
          text: `Число ${value} записали в системе счисления с основанием ${base}. Сколько значащих цифр в этой записи?`,
          answer: String(rec.length),
          solution: `Переводим ${value} в основание ${base} делением с остатком.\nПолучается ${rec} — в записи ${rec.length} цифр.`,
        }
      },
      (r) => {
        const value = int(r, 100, 8000)
        const bin = value.toString(2)
        const ones = [...bin].filter((c) => c === '1').length
        return {
          text: `Сколько единиц содержится в двоичной записи числа ${value}?`,
          answer: String(ones),
          solution: `Двоичная запись числа ${value}: ${bin}.\nЕдиниц в ней ${ones}.`,
        }
      },
    ],
  },
  16: {
    topic: 'Рекурсия',
    families: [
      (r) => {
        const n = int(r, 8, 30)
        const f = [0, 1, 1]
        for (let k = 3; k <= n; k++) f[k] = f[k - 1] + f[k - 2]
        return {
          text: `Функция F задана так: F(1) = 1, F(2) = 1, а при n > 2 выполняется F(n) = F(n−1) + F(n−2). Чему равно значение F(${n})?`,
          answer: String(f[n]),
          solution: `Считаем по порядку, не рекурсией:\nF(1)=1, F(2)=1, F(3)=2, F(4)=3, F(5)=5, …\nДойдя до n = ${n}, получаем ${f[n]}.`,
        }
      },
      (r) => {
        const n = int(r, 6, 40)
        const val = (n * (n + 1)) / 2
        return {
          text: `Функция F задана так: F(1) = 1, а при n > 1 выполняется F(n) = F(n−1) + n. Чему равно значение F(${n})?`,
          answer: String(val),
          solution: `Каждый шаг добавляет очередное n, то есть F(n) = 1 + 2 + … + n.\nСумма первых n чисел: n·(n+1)/2 = ${n}·${n + 1}/2 = ${val}.`,
        }
      },
      (r) => {
        const n = int(r, 4, 20)
        const val = 2 ** n - 1
        return {
          text: `Функция F задана так: F(1) = 1, а при n > 1 выполняется F(n) = 2·F(n−1) + 1. Чему равно значение F(${n})?`,
          answer: String(val),
          solution: `F(1)=1, F(2)=3, F(3)=7, F(4)=15 — каждый раз на единицу меньше степени двойки.\nЗначит F(n) = 2^n − 1 = 2^${n} − 1 = ${val}.`,
        }
      },
      (r) => {
        const a = int(r, 2, 9)
        const d = int(r, 2, 12)
        const n = int(r, 5, 40)
        const val = a + d * (n - 1)
        return {
          text: `Функция F задана так: F(1) = ${a}, а при n > 1 выполняется F(n) = F(n−1) + ${d}. Чему равно значение F(${n})?`,
          answer: String(val),
          solution: `От F(1) до F(${n}) сделано ${n - 1} шагов, каждый прибавляет ${d}.\nF(${n}) = ${a} + ${d}·${n - 1} = ${val}.`,
        }
      },
      (r) => {
        const n = int(r, 4, 11)
        let val = 1
        for (let k = 2; k <= n; k++) val *= k
        return {
          text: `Функция F задана так: F(1) = 1, а при n > 1 выполняется F(n) = n · F(n−1). Чему равно значение F(${n})?`,
          answer: String(val),
          solution: `Это произведение всех чисел от 1 до n.\nF(${n}) = 1·2·…·${n} = ${val}.`,
        }
      },
    ],
  },
  23: {
    topic: 'Исполнители',
    families: [
      (r) => {
        const from = int(r, 1, 5), to = int(r, 12, 30)
        const memo = new Map<number, number>()
        const ways = (x: number): number => {
          if (x > to) return 0
          if (x === to) return 1
          const hit = memo.get(x)
          if (hit !== undefined) return hit
          const res = ways(x + 1) + ways(x * 2)
          memo.set(x, res)
          return res
        }
        const cnt = ways(from)
        return {
          text: `У исполнителя две команды: «прибавь 1» и «умножь на 2». Сколько существует программ, которые число ${from} преобразуют в число ${to}?`,
          answer: String(cnt),
          solution: `Считаем рекуррентно с конца: f(${to}) = 1, для x < ${to} f(x) = f(x+1) + f(2x).\nЧисла больше ${to} отбрасываем — из них уже не вернуться.\nИз ${from} в ${to} ведёт ${cnt} программ.`,
        }
      },
    ],
  },
  25: {
    topic: 'Делители',
    families: [
      (r) => {
        const value = pick(r, DIVISIBLE)
        let count = 0
        for (let d = 1; d * d <= value; d++) {
          if (value % d === 0) count += d * d === value ? 1 : 2
        }
        return {
          text: `Сколько всего натуральных делителей у числа ${value}?`,
          answer: String(count),
          solution: `Перебираем делители до √${value}: каждый найденный d даёт и парный ${value}/d.\nВсего делителей: ${count}.`,
        }
      },
      (r) => {
        const value = pick(r, DIVISIBLE)
        let sum = 0
        for (let d = 1; d <= value; d++) if (value % d === 0) sum += d
        return {
          text: `Найдите сумму всех натуральных делителей числа ${value} (включая 1 и само число).`,
          answer: String(sum),
          solution: `Выписываем делители парами d и ${value}/d и складываем.\nСумма делителей числа ${value} равна ${sum}.`,
        }
      },
      (r) => {
        const value = pick(r, DIVISIBLE)
        const from = pick(r, [2, 3, 5, 7, 9, 11, 13] as const)
        let found = 0
        for (let d = from + 1; d <= value; d++) {
          if (value % d === 0) { found = d; break }
        }
        if (!found) return null
        return {
          text: `Найдите наименьший натуральный делитель числа ${value}, который больше ${from}.`,
          answer: String(found),
          solution: `Идём вверх от ${from + 1} и проверяем делимость ${value} нацело.\nПервый подходящий делитель — ${found}.`,
        }
      },
      (r) => {
        const k = pick(r, [3, 4, 6, 7, 8, 9, 11, 12, 13, 14, 15, 17, 18, 19] as const)
        const a = int(r, 10, 400)
        const b = a + int(r, 100, 900)
        const count = Math.floor(b / k) - Math.floor((a - 1) / k)
        return {
          text: `Сколько натуральных чисел из отрезка от ${a} до ${b} включительно делятся на ${k} без остатка?`,
          answer: String(count),
          solution: `До ${b} таких чисел ⌊${b}/${k}⌋ = ${Math.floor(b / k)}, до ${a - 1} — ⌊${a - 1}/${k}⌋ = ${Math.floor((a - 1) / k)}.\nРазность: ${Math.floor(b / k)} − ${Math.floor((a - 1) / k)} = ${count}.`,
        }
      },
    ],
  },
}

// ---------- Физика ----------

const PHYSICS: Record<number, TaskSpec> = {
  1: {
    topic: 'Кинематика',
    families: [
      // Путь по графику скорости: задание целиком в рисунке.
      (r) => speedGraphTask(r),
      (r) => {
        const a = pick(r, [2, 4, 6, 8, 10] as const), t = int(r, 2, 9)
        return {
          text: `Тело начинает двигаться из состояния покоя с постоянным ускорением ${a} м/с². Какой путь оно пройдёт за ${t} с?`,
          answer: String((a * t * t) / 2),
          solution: `Из покоя (v₀ = 0): s = a·t² / 2.\ns = ${a} · ${t * t} / 2 = ${(a * t * t) / 2} м.`,
        }
      },
      (r) => {
        const v0 = pick(r, [0, 5, 10, 15, 20] as const), a = int(r, 2, 8), t = int(r, 2, 9)
        return {
          text: `Тело движется с начальной скоростью ${v0} м/с и постоянным ускорением ${a} м/с². Какой станет его скорость через ${t} с?`,
          answer: String(v0 + a * t),
          solution: `v = v₀ + a·t.\nv = ${v0} + ${a} · ${t} = ${v0 + a * t} м/с.`,
        }
      },
    ],
  },
  2: {
    topic: 'Законы Ньютона',
    families: [
      (r) => {
        const m = pick(r, [2, 3, 4, 5, 8, 10, 12] as const), a = pick(r, [2, 3, 4, 5] as const)
        return {
          text: `На тело массой ${m} кг действует равнодействующая сила, сообщающая ему ускорение ${a} м/с². Найдите модуль этой силы.`,
          answer: String(m * a),
          solution: `Второй закон Ньютона: F = m·a.\nF = ${m} · ${a} = ${m * a} Н.`,
        }
      },
      (r) => {
        const m = pick(r, [2, 4, 5, 8, 10, 12, 20, 25] as const)
        const a = pick(r, [2, 3, 4, 5, 6] as const)
        return {
          text: `Тело массой ${m} кг движется с ускорением ${a} м/с² под действием равнодействующей силы. Затем ту же силу приложили к телу вдвое большей массы. Какое ускорение оно получит?`,
          answer: dec(a / 2),
          solution: `Сила та же, а масса вдвое больше: F = m·a, значит при удвоении массы ускорение уменьшается вдвое.\na₂ = ${a} / 2 = ${dec(a / 2)} м/с².`,
        }
      },
      (r) => {
        const f = pick(r, [12, 20, 24, 30, 36, 40, 48, 60, 80, 100, 120] as const)
        const m = pick(r, [2, 3, 4, 5, 6, 8, 10] as const)
        if (f % m !== 0) return null
        return {
          text: `Равнодействующая сила ${f} Н сообщает телу массой ${m} кг некоторое ускорение. Найдите модуль этого ускорения.`,
          answer: String(f / m),
          solution: `Из второго закона Ньютона a = F / m.\na = ${f} / ${m} = ${f / m} м/с².`,
        }
      },
      (r) => {
        const m = pick(r, [2, 4, 5, 8, 10, 15, 20, 25, 40, 50] as const)
        const mu = pick(r, [0.1, 0.2, 0.25, 0.3, 0.4, 0.5] as const)
        const fr = mu * m * 10
        return {
          text: `Брусок массой ${m} кг равномерно тянут по горизонтальному столу. Коэффициент трения между бруском и столом равен ${dec(mu)}. Найдите силу трения. Считайте g = 10 м/с².`,
          answer: dec(fr),
          solution: `Сила трения скольжения: Fтр = μ·N, а на горизонтали N = m·g.\nFтр = ${dec(mu)} · ${m} · 10 = ${dec(fr)} Н.`,
        }
      },
      (r) => {
        const k = pick(r, [40, 50, 80, 100, 120, 150, 200, 250, 400, 500] as const)
        const x = pick(r, [0.02, 0.04, 0.05, 0.08, 0.1, 0.12, 0.15, 0.2] as const)
        return {
          text: `Пружину жёсткостью ${k} Н/м растянули на ${dec(x * 100)} см. Какая сила упругости при этом возникла?`,
          answer: dec(k * x),
          solution: `Закон Гука: F = k·x, где x — удлинение В МЕТРАХ.\n${dec(x * 100)} см = ${dec(x)} м.\nF = ${k} · ${dec(x)} = ${dec(k * x)} Н.`,
        }
      },
    ],
  },
  3: {
    topic: 'Статика',
    families: [
      (r) => {
        const f1 = pick(r, [10, 20, 30, 40, 60] as const)
        const d1 = pick(r, [2, 3, 4, 6] as const)
        const d2 = pick(r, [1, 2, 3] as const)
        if ((f1 * d1) % d2 !== 0) return null
        const f2 = (f1 * d1) / d2
        return {
          text: `На левое плечо рычага длиной ${d1} м действует сила ${f1} Н. Какую силу нужно приложить к правому плечу длиной ${d2} м, чтобы рычаг был в равновесии?`,
          answer: String(f2),
          solution: `Равновесие рычага: F₁·d₁ = F₂·d₂.\n${f1} · ${d1} = F₂ · ${d2}\nF₂ = ${f1 * d1} / ${d2} = ${f2} Н.`,
        }
      },
    ],
  },
  4: {
    topic: 'Импульс и энергия',
    families: [
      (r) => {
        const m = pick(r, [2, 4, 5, 10, 20] as const), v = pick(r, [3, 4, 6, 8, 10] as const)
        return {
          text: `Тело массой ${m} кг движется со скоростью ${v} м/с. Найдите модуль его импульса.`,
          answer: String(m * v),
          solution: `Импульс: p = m·v.\np = ${m} · ${v} = ${m * v} кг·м/с.`,
        }
      },
      (r) => {
        const m = pick(r, [2, 4, 6, 8, 10] as const), v = pick(r, [2, 4, 6, 10] as const)
        return {
          text: `Тело массой ${m} кг движется со скоростью ${v} м/с. Найдите его кинетическую энергию.`,
          answer: String((m * v * v) / 2),
          solution: `E = m·v² / 2.\nE = ${m} · ${v * v} / 2 = ${(m * v * v) / 2} Дж.`,
        }
      },
    ],
  },
  7: {
    topic: 'Термодинамика',
    families: [
      (r) => {
        const q = pick(r, [100, 200, 300, 500, 800] as const)
        const a = pick(r, [50, 100, 150, 200] as const)
        return {
          text: `Газу передали количество теплоты ${q} Дж, при этом газ совершил работу ${a} Дж. На сколько джоулей изменилась его внутренняя энергия?`,
          answer: String(q - a),
          solution: `Первый закон термодинамики: Q = ΔU + A, откуда ΔU = Q − A.\nΔU = ${q} − ${a} = ${q - a} Дж.`,
        }
      },
      (r) => {
        const q = pick(r, [150, 250, 400, 600, 750, 900, 1200] as const)
        const du = pick(r, [50, 100, 200, 300, 400, 500] as const)
        if (du >= q) return null
        return {
          text: `Газу передали количество теплоты ${q} Дж, его внутренняя энергия увеличилась на ${du} Дж. Какую работу совершил газ?`,
          answer: String(q - du),
          solution: `Первый закон термодинамики: Q = ΔU + A, откуда A = Q − ΔU.\nA = ${q} − ${du} = ${q - du} Дж.`,
        }
      },
      (r) => {
        const du = pick(r, [100, 150, 200, 250, 300, 450, 600] as const)
        const a = pick(r, [50, 100, 150, 200, 250, 350] as const)
        return {
          text: `Внутренняя энергия газа выросла на ${du} Дж, при этом газ совершил работу ${a} Дж. Какое количество теплоты газу передали?`,
          answer: String(du + a),
          solution: `Первый закон термодинамики: Q = ΔU + A.\nQ = ${du} + ${a} = ${du + a} Дж.`,
        }
      },
      (r) => {
        const qh = pick(r, [200, 250, 400, 500, 800, 1000, 1200, 1600, 2000] as const)
        const eff = pick(r, [10, 20, 25, 40, 50] as const)
        const a = (qh * eff) / 100
        if (!Number.isInteger(a)) return null
        return {
          text: `Тепловая машина за цикл получает от нагревателя ${qh} Дж и совершает полезную работу ${a} Дж. Каков КПД машины в процентах?`,
          answer: String(eff),
          solution: `КПД = A / Qн · 100 %.\nη = ${a} / ${qh} · 100 % = ${eff} %.`,
        }
      },
      (r) => {
        const t2 = pick(r, [200, 250, 280, 300, 320, 350, 400] as const)
        const mult = pick(r, [1.25, 1.5, 2, 2.5, 4] as const)
        const t1 = t2 * mult
        if (!Number.isInteger(t1)) return null
        const eff = Math.round(((t1 - t2) / t1) * 100)
        if (((t1 - t2) / t1) * 100 !== eff) return null
        return {
          text: `Идеальная тепловая машина работает с нагревателем при температуре ${t1} К и холодильником при ${t2} К. Каков её максимальный КПД в процентах?`,
          answer: String(eff),
          solution: `Для цикла Карно η = (T₁ − T₂) / T₁ · 100 %.\nη = (${t1} − ${t2}) / ${t1} · 100 % = ${eff} %.`,
        }
      },
    ],
  },
  8: {
    topic: 'МКТ',
    families: [
      (r) => {
        const k = int(r, 2, 9)
        return {
          text: `Идеальный газ находится в закрытом сосуде постоянного объёма. Абсолютную температуру газа увеличили в ${k} раза. Во сколько раз увеличилось его давление?`,
          answer: String(k),
          solution: `При постоянном объёме p/T = const (закон Шарля).\nТемпература выросла в ${k} раза — значит и давление в ${k} раза.`,
        }
      },
      (r) => {
        const k = int(r, 2, 9)
        return {
          text: `Идеальный газ находится под постоянным давлением. Абсолютную температуру газа увеличили в ${k} раза. Во сколько раз увеличился его объём?`,
          answer: String(k),
          solution: `При постоянном давлении V/T = const (закон Гей-Люссака).\nТемпература выросла в ${k} раза — объём тоже в ${k} раза.`,
        }
      },
      (r) => {
        const k = int(r, 2, 9)
        return {
          text: `Идеальный газ сжимают при постоянной температуре так, что его объём уменьшается в ${k} раза. Во сколько раз увеличится давление газа?`,
          answer: String(k),
          solution: `При постоянной температуре p·V = const (закон Бойля — Мариотта).\nОбъём уменьшился в ${k} раза — давление во столько же выросло.`,
        }
      },
      (r) => {
        const n = pick(r, [1, 2, 3, 4, 5] as const)
        const t = pick(r, [300, 400, 600, 900] as const)
        const k = 1.38
        const e = Math.round((1.5 * k * t) / 10) / 100
        return {
          text: `Средняя кинетическая энергия теплового движения молекулы идеального газа при температуре ${t} К равна E. Во сколько раз она вырастет, если температуру увеличить в ${n + 1} раза?`,
          answer: String(n + 1),
          solution: `Средняя энергия молекулы E = (3/2)·k·T — она прямо пропорциональна абсолютной температуре.\nПри T в ${n + 1} раза больше и энергия в ${n + 1} раза больше.\n(Справочно: при ${t} К это около ${e}·10⁻²¹ Дж.)`,
        }
      },
    ],
  },
  11: {
    topic: 'Электрические цепи',
    families: [
      (r) => {
        const r1 = pick(r, [2, 3, 4, 5, 6, 10, 12] as const), r2 = pick(r, [2, 3, 4, 5, 6, 10, 12] as const)
        return {
          text: `Два резистора сопротивлением ${r1} Ом и ${r2} Ом соединены последовательно. Найдите сопротивление участка цепи.`,
          answer: String(r1 + r2),
          solution: `При последовательном соединении сопротивления складываются.\nR = ${r1} + ${r2} = ${r1 + r2} Ом.`,
        }
      },
      (r) => {
        const [r1, r2] = pick(r, [[2, 2], [3, 6], [4, 4], [6, 3], [10, 10], [12, 4], [6, 12], [20, 5]] as const)
        const res = (r1 * r2) / (r1 + r2)
        if (!Number.isInteger(res)) return null
        return {
          text: `Два резистора сопротивлением ${r1} Ом и ${r2} Ом соединены параллельно. Найдите сопротивление участка цепи.`,
          answer: String(res),
          solution: `R = (R₁ · R₂) / (R₁ + R₂).\nR = ${r1 * r2} / ${r1 + r2} = ${res} Ом.`,
        }
      },
      (r) => {
        const u = pick(r, [6, 12, 24, 36, 48] as const), rr = pick(r, [2, 3, 4, 6, 12] as const)
        if (u % rr !== 0) return null
        return {
          text: `К участку цепи с сопротивлением ${rr} Ом приложено напряжение ${u} В. Найдите силу тока в амперах.`,
          answer: String(u / rr),
          solution: `Закон Ома для участка цепи: I = U / R.\nI = ${u} / ${rr} = ${u / rr} А.`,
        }
      },
    ],
  },
  17: {
    topic: 'Ядерная физика',
    families: [
      (r) => {
        const A = int(r, 200, 240), Z = int(r, 80, 95)
        const alpha = r() < 0.5
        const ans = alpha ? A - 4 : A
        return {
          text: `Ядро с массовым числом ${A} и зарядовым числом ${Z} испытало ${alpha ? 'альфа' : 'бета-минус'}-распад. Чему равно массовое число образовавшегося ядра?`,
          answer: String(ans),
          solution: alpha
            ? `При альфа-распаде вылетает ядро гелия: массовое число уменьшается на 4.\nA = ${A} − 4 = ${ans}.`
            : `При бета-минус-распаде вылетает электрон: массовое число НЕ меняется, растёт только зарядовое.\nA = ${ans}.`,
        }
      },
    ],
  },
  19: {
    topic: 'Измерения',
    families: [
      (r) => {
        const div = pick(r, [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 50] as const)
        return {
          text: `Цена деления шкалы прибора равна ${dec(div)}. Чему равна погрешность измерения этим прибором, если она составляет половину цены деления?`,
          answer: dec(div / 2),
          solution: `Погрешность — половина цены деления.\nΔ = ${dec(div)} / 2 = ${dec(div / 2)}.`,
        }
      },
      (r) => {
        const big = pick(r, [1, 2, 5, 10, 20, 50, 100] as const)
        const parts = pick(r, [2, 4, 5, 10] as const)
        const div = big / parts
        const marks = int(r, 3, parts * 4)
        return {
          text: `Между двумя соседними подписанными штрихами шкалы, отличающимися на ${dec(big)}, укладывается ${parts} делений. Стрелка стоит на ${marks} делении после нуля. Что показывает прибор?`,
          answer: dec(div * marks),
          solution: `Цена деления: ${dec(big)} / ${parts} = ${dec(div)}.\nПоказание: ${dec(div)} · ${marks} = ${dec(div * marks)}.`,
        }
      },
      (r) => {
        const div = pick(r, [0.1, 0.2, 0.5, 1, 2, 5, 10] as const)
        const mult = int(r, 4, 40)
        const value = div * mult
        const rel = Math.round(((div / 2) / value) * 1000) / 10
        if (!Number.isFinite(rel) || rel <= 0) return null
        return {
          text: `Прибор с ценой деления ${dec(div)} показал значение ${dec(value)}. Погрешность равна половине цены деления. Найдите относительную погрешность в процентах, округлив до десятых.`,
          answer: dec(rel),
          solution: `Абсолютная погрешность: ${dec(div)} / 2 = ${dec(div / 2)}.\nОтносительная: ${dec(div / 2)} / ${dec(value)} · 100 % ≈ ${dec(rel)} %.`,
        }
      },
      (r) => {
        const div = pick(r, [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5] as const)
        const mult = int(r, 3, 30)
        const value = div * mult
        return {
          text: `Цена деления прибора равна ${dec(div)}, стрелка остановилась на отметке ${dec(value)}. Погрешность считают равной половине цены деления. Запишите наибольшее возможное значение измеряемой величины.`,
          answer: dec(value + div / 2),
          solution: `Результат записывают как ${dec(value)} ± ${dec(div / 2)}.\nНаибольшее значение: ${dec(value)} + ${dec(div / 2)} = ${dec(value + div / 2)}.`,
        }
      },
    ],
  },
}

// ---------- Русский язык ----------
// Здесь ответ не вычисляется, но задание всё равно СОБИРАЕТСЯ: слово и набор
// отвлекающих вариантов выбираются случайно, поэтому подборка каждый раз новая.

const STRESS: readonly (readonly [string, string])[] = [
  ['звонИт', 'звОнит'], ['тОрты', 'тортЫ'], ['бАнты', 'бантЫ'], ['красИвее', 'красивЕе'],
  ['договОр', 'дОговор'], ['каталОг', 'катАлог'], ['свЁкла', 'свеклА'], ['щавЕль', 'щАвель'],
  ['жалюзИ', 'жАлюзи'], ['квартАл', 'квАртал'], ['тУфля', 'туфлЯ'], ['слИвовый', 'сливОвый'],
  ['облегчИть', 'облЕгчить'], ['цепОчка', 'цЕпочка'], ['граждАнство', 'грАжданство'],
  ['начАть', 'нАчать'], ['принЯть', 'прИнять'], ['создалА', 'сОздала'], ['вручИт', 'врУчит'],
  ['насорИт', 'насОрит'], ['кровоточИть', 'кровотОчить'], ['мозаИчный', 'мозАичный'],
  ['дефИс', 'дЕфис'], ['докумЕнт', 'докУмент'], ['экспЕрт', 'Эксперт'], ['шофЁр', 'шОфер'],
  ['корЫсть', 'кОрысть'], ['столЯр', 'стОляр'], ['цЕнтнер', 'центнЕр'], ['нарОст', 'нАрост'],
  ['оптОвый', 'Оптовый'], ['кУхонный', 'кухОнный'], ['прибЫв', 'прИбыв'], ['зАнятый', 'занЯтый'],
  ['вОвремя', 'вовремЯ'], ['донЕльзя', 'донельзЯ'], ['исчЕрпать', 'исчерпАть'],
  ['закУпорить', 'закупОрить'], ['освЕдомиться', 'осведомИться'], ['чЕрпать', 'черпАть'],
]


/**
 * Площадь фигуры на клетчатой бумаге (профильная математика, № 1).
 *
 * Вершины кладём строго в узлы сетки, а площадь считаем шнурованием по тем же
 * координатам, которыми рисуется многоугольник, — разойтись рисунку и ответу
 * негде. Отбраковываем вырожденные и слишком мелкие фигуры: по ним не видно,
 * что задание про площадь.
 */
function gridFigureTask(r: Rnd) {
  const cols = int(r, 7, 10)
  const rows = int(r, 6, 8)
  const kind = pick(r, ['треугольник', 'четырёхугольник'] as const)
  const n = kind === 'треугольник' ? 3 : 4

  const pts: Cell[] = []
  const used = new Set<string>()
  for (let i = 0; i < n; i++) {
    let p: Cell | null = null
    for (let t = 0; t < 40 && !p; t++) {
      const c = { x: int(r, 0, cols), y: int(r, 0, rows) }
      if (!used.has(c.x + ':' + c.y)) p = c
    }
    if (!p) return null
    used.add(p.x + ':' + p.y)
    pts.push(p)
  }
  // Обходим вершины по кругу вокруг центра — иначе многоугольник получится
  // самопересекающимся, а шнурование для такого считает не то, что нарисовано.
  const cx = pts.reduce((s, p) => s + p.x, 0) / n
  const cy = pts.reduce((s, p) => s + p.y, 0) / n
  pts.sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx))

  const area = polygonArea(pts)
  if (area < 6 || !Number.isInteger(area * 2)) return null
  // Отбраковка вырожденных фигур. Одних размеров мало: треугольник шириной в
  // шесть клеток и высотой в две проходит их, а выглядит как полоска, по
  // которой площадь на глаз не прикинуть. Поэтому смотрим ещё и на то, какую
  // долю своей рамки фигура занимает.
  const spanX = Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x))
  const spanY = Math.max(...pts.map((p) => p.y)) - Math.min(...pts.map((p) => p.y))
  if (spanX < 4 || spanY < 4) return null
  if (area < spanX * spanY * 0.3) return null

  const coords = pts.map((p) => `(${p.x}; ${p.y})`).join(', ')
  return {
    text: `На клетчатой бумаге со стороной клетки 1 изображён ${kind}. Найдите его площадь.`,
    answer: dec(area),
    solution:
      `Считать по клеткам необязательно — достаточно координат вершин: ${coords}.\n` +
      `Площадь через координаты (формула площади многоугольника):\n` +
      `S = ½·|Σ (xᵢ·yᵢ₊₁ − xᵢ₊₁·yᵢ)| = ${dec(area)}.\n` +
      `Тот же ответ даёт достройка до прямоугольника с вычитанием лишних треугольников.`,
    figure: gridPolygon(pts, cols, rows),
  }
}

/**
 * Путь по графику скорости (физика, № 1).
 *
 * Путь — это площадь под графиком, и никакого текстового условия здесь нет:
 * всё в рисунке. Ломаная строится по целым узлам, площадь считается по тем же
 * узлам трапециями, поэтому ответ ровно такой, какой «видно» на картинке.
 */
function speedGraphTask(r: Rnd) {
  const xMax = int(r, 4, 6)
  const yMax = int(r, 3, 5)
  const pts: GraphPoint[] = [{ t: 0, v: int(r, 0, yMax) }]
  let t = 0
  while (t < xMax) {
    const step = Math.min(xMax - t, int(r, 1, 2))
    t += step
    pts.push({ t, v: int(r, 0, yMax) })
  }
  if (pts.length < 3) return null
  const s = areaUnder(pts)
  if (s < 2) return null
  // Половинки допустимы (трапеция), а более дробного на клетчатом графике не бывает.
  if (Math.round(s * 2) !== s * 2) return null

  return {
    text:
      `По графику зависимости модуля скорости тела от времени определите путь, ` +
      `пройденный телом от момента времени 0 с до момента времени ${xMax} с. ` +
      `Ответ дайте в метрах.`,
    answer: dec(s),
    solution:
      `Путь — это площадь фигуры под графиком скорости.\n` +
      `Разбиваем её на трапеции по участкам между узлами; площадь трапеции — ` +
      `полусумма оснований на высоту:\n` +
      pts
        .slice(1)
        .map((p, i) => {
          const a = pts[i]
          return `  от ${a.t} до ${p.t} с: (${a.v} + ${p.v})/2 · ${p.t - a.t} = ${dec(((a.v + p.v) / 2) * (p.t - a.t))}`
        })
        .join('\n') +
      `\nСумма: ${dec(s)} м.`,
    figure: lineGraph(pts, { xLabel: 't, с', yLabel: 'v, м/с', xMax, yMax }),
  }
}

/**
 * Задания 9–12: пять рядов слов с пропусками; назвать ряды, где пропущена
 * ОДНА И ТА ЖЕ буква. Ответ — номера рядов подряд, как в бланке.
 *
 * Форма сверена с демоверсией ЕГЭ-2027: у корней и приставок в ряду по три
 * слова («во всех словах одного ряда»), у суффиксов и окончаний — по два
 * («в обоих словах одного ряда»).
 *
 * Ряд-ответ набирается из слов с одинаковой буквой, ряд-обманка — из слов с
 * разными. Значит, ответ верен по построению: он вычисляется из тех же
 * данных, из которых собран сам вопрос.
 *
 * `explain` — как объяснить конкретное слово в разборе (для корней это тип
 * гласной и проверочное слово, для остальных достаточно самой буквы).
 */
function sameLetterRows(
  r: Rnd,
  words: readonly GapWord[],
  perRow: 2 | 3,
  explain?: (word: string) => string,
) {
  const byLetter = new Map<string, GapWord[]>()
  for (const w of words) {
    const list = byLetter.get(w[1])
    if (list) list.push(w)
    else byLetter.set(w[1], [w])
  }
  const letters = [...byLetter.keys()].filter((l) => (byLetter.get(l)?.length ?? 0) >= perRow)
  if (letters.length < 2) return null

  const ROWS = 5
  // Сколько рядов верных. Ни ноль, ни все пять: и то и другое ученик угадает,
  // не читая слов, а в настоящих вариантах такого не бывает.
  const rightCount = int(r, 1, 3)
  const isRight = shuffle(r, [...Array(ROWS)].map((_, i) => i < rightCount))
  const used = new Set<string>()
  const take = (pool: GapWord[]): GapWord | null => {
    const free = pool.filter((w) => !used.has(w[0]))
    if (!free.length) return null
    const w = pick(r, free)
    used.add(w[0])
    return w
  }

  const rows: { words: GapWord[]; right: boolean }[] = []
  for (const right of isRight) {
    const row: GapWord[] = []
    if (right) {
      const l = pick(r, letters)
      for (let i = 0; i < perRow; i++) {
        const w = take(byLetter.get(l)!)
        if (!w) return null
        row.push(w)
      }
    } else {
      // В обманке ровно одно слово выбивается: искать его — и есть работа.
      const mixed = shuffle(r, letters)
      const odd = int(r, 0, perRow - 1)
      for (let i = 0; i < perRow; i++) {
        const w = take(byLetter.get(i === odd ? mixed[1] : mixed[0])!)
        if (!w) return null
        row.push(w)
      }
    }
    rows.push({ words: row, right })
  }

  const answer = rows.map((row, i) => (row.right ? i + 1 : 0)).filter(Boolean).join('')
  const body = rows.map((row, i) => `${i + 1}) ${row.words.map((w) => w[0]).join(', ')}`).join('\n')
  const why = rows
    .map((row, i) => {
      const parts = row.words
        .map((w) => w[0].replace('..', w[1].toUpperCase()) + (explain ? ` (${explain(w[0])})` : ''))
        .join('; ')
      return `${i + 1}) ${parts} — ${row.right ? 'буква одна и та же' : 'буквы разные'}`
    })
    .join('\n')
  const scope = perRow === 3 ? 'во всех словах одного ряда' : 'в обоих словах одного ряда'
  return {
    text: `Укажите варианты ответов, в которых ${scope} пропущена одна и та же буква. Запишите номера ответов подряд, без пробелов.\n\n${body}`,
    answer,
    solution: `${why}\n\nОтвет: ${answer}.`,
  }
}

/** Как объяснить корневую гласную: тип и проверочное слово. */
const ROOT_HINT = new Map(ROOT_WORDS.map((w) => [w[0], `${w[2]}, ${w[3]}`]))
const ROOT_GAPS: readonly GapWord[] = ROOT_WORDS.map((w) => [w[0], w[1]] as const)

/** Убрать случайные не-кириллические вставки из данных. */
const ru = (s: string) => s.replace(/[^Ѐ-ӿ\s.,:;!?()«»—–-]/g, '').replace(/\s{2,}/g, ' ').trim()

const RUSSIAN: Record<number, TaskSpec> = {
  4: {
    topic: 'Ударение',
    families: [
      (r) => {
        const [right, wrong] = pick(r, STRESS)
        const others: string[] = []
        while (others.length < 4) {
          const c = pick(r, STRESS)[0]
          if (c !== right && !others.includes(c)) others.push(c)
        }
        const options = [wrong, ...others].sort(() => r() - 0.5)
        return {
          text: `В одном из приведённых ниже слов допущена ошибка в постановке ударения: НЕВЕРНО выделена буква, обозначающая ударный гласный звук. Выпишите это слово правильно.\n\n${options.join('   ')}`,
          answer: right.toLowerCase(),
          solution: `Верно: ${right}. Ошибка была в слове «${wrong}».\nВ ответ пишется само слово, без выделения: ${right.toLowerCase()}.`,
        }
      },
    ],
  },
  5: {
    topic: 'Паронимы',
    families: [
      (r) => {
        const [sentence, right, why] = pick(r, PARONYMS)
        return {
          text: `В приведённом ниже предложении неверно употреблено выделенное слово. Исправьте ошибку и запишите подобранное слово.\n\n${ru(sentence)}`,
          answer: right,
          solution: `${why}\nВерное слово: ${right}.`,
        }
      },
    ],
  },
  6: {
    topic: 'Лексические нормы',
    families: [
      (r) => {
        const [phrase, extra, why] = pick(r, PLEONASM)
        return {
          text: `Отредактируйте словосочетание: исключите лишнее слово. Выпишите это слово.\n\n${ru(phrase)}`,
          answer: extra,
          solution: `${why}\nЛишнее слово: «${extra}».`,
        }
      },
    ],
  },
  9: {
    topic: 'Правописание корней',
    families: [(r) => sameLetterRows(r, ROOT_GAPS, 3, (w) => ROOT_HINT.get(w) ?? '')],
  },
  10: {
    topic: 'Правописание приставок',
    families: [(r) => sameLetterRows(r, PREFIX_WORDS, 3)],
  },
  11: {
    topic: 'Суффиксы разных частей речи',
    families: [(r) => sameLetterRows(r, SUFFIX_WORDS, 2)],
  },
  12: {
    topic: 'Личные окончания глаголов и суффиксы причастий',
    families: [(r) => sameLetterRows(r, ENDING_WORDS, 2)],
  },
  7: {
    topic: 'Морфологические нормы',
    families: [
      (r) => {
        const [wrong, right, why] = pick(r, FORMS)
        return {
          text: `В приведённом ниже сочетании допущена ошибка в образовании формы слова. Исправьте ошибку и запишите слово правильно.\n\n${ru(wrong)}`,
          answer: right,
          solution: `${why}\nВерная форма: ${right}.`,
        }
      },
    ],
  },
}

const REGISTRY: Record<string, Record<number, TaskSpec>> = {
  math_prof: MATH,
  informatics: INFORMATICS,
  physics: PHYSICS,
  russian: RUSSIAN,
}

/** Умеет ли приложение генерировать задания по этому номеру. */
export function canGenerate(subjectId: string, taskNo: number): boolean {
  return Boolean(REGISTRY[subjectId]?.[taskNo])
}

/** Номера, по которым задания генерируются бесконечно. */
export function generatedNumbers(subjectId: string): number[] {
  return Object.keys(REGISTRY[subjectId] ?? {})
    .map(Number)
    .sort((a, b) => a - b)
}

/** Все предметы и номера, где генерация есть. */
export function generatorCoverage(): Record<string, number[]> {
  const out: Record<string, number[]> = {}
  for (const sid of Object.keys(REGISTRY)) out[sid] = generatedNumbers(sid)
  return out
}

/**
 * Сгенерировать одно задание. Возвращает null, если по номеру генерации нет
 * или подобранные числа не дали «красивого» ответа (тогда зовущий пробует ещё).
 */
export function generateOne(subjectId: string, taskNo: number, rnd: Rnd = Math.random): GeneratedTask | null {
  const spec = REGISTRY[subjectId]?.[taskNo]
  if (!spec) return null
  const made = pick(rnd, spec.families)(rnd)
  if (!made) return null
  return { subjectId, taskNo, topic: spec.topic, ...made }
}

/**
 * Ключ, по которому задания считаются одинаковыми.
 *
 * Одного текста мало. У заданий с чертежом текст ОДИН И ТОТ ЖЕ — «на клетчатой
 * бумаге изображён треугольник, найдите площадь», — а различаются они рисунком.
 * По тексту такие задания схлопывались в одно, и из двухсот сгенерированных в
 * банк попадало два.
 */
export function taskKey(text: string, figure?: string): string {
  return figure ? text + ' ' + figure : text
}

/** Тот же ключ для задания, которое уже лежит в банке. */
export function bankKey(q: { text: string; images?: string[] }): string {
  return taskKey(q.text, q.images?.[0])
}

/**
 * Сколько РАЗЛИЧНЫХ заданий номер может дать вообще. У числовых семейств запас
 * огромный, а у тех, что собираются из списка слов, он равен длине списка —
 * и обещать там «бесконечно» было бы враньём.
 */
export function variantCapacity(subjectId: string, taskNo: number, probes = 1500): number {
  const seen = new Set<string>()
  for (let i = 0; i < probes; i++) {
    const t = generateOne(subjectId, taskNo)
    if (t) seen.add(taskKey(t.text, t.figure))
  }
  return seen.size
}

/**
 * Набор заданий для банка.
 *
 * `known` — тексты, которые уже лежат в банке. Без него повторное нажатие «Ещё
 * задания» возвращало ТЕ ЖЕ задания: дедупликация шла только внутри одного вызова,
 * и по бедным номерам банк наполнялся копиями.
 */
export function generateTasks(
  subjectId: string,
  taskNo: number,
  count: number,
  rnd: Rnd = Math.random,
  known: ReadonlySet<string> = new Set(),
): Question[] {
  const seen = new Set<string>(known)
  const out: Question[] = []
  // Потолок попыток: у некоторых номеров пространство вариантов невелико,
  // и без него цикл крутился бы вечно, пытаясь набрать недостижимое число.
  for (let tries = 0; tries < count * 60 && out.length < count; tries++) {
    const t = generateOne(subjectId, taskNo, rnd)
    if (!t) continue
    const key = taskKey(t.text, t.figure)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      id: uid('q_'),
      subjectId: t.subjectId,
      taskNo: t.taskNo,
      topic: t.topic,
      text: t.text,
      answer: t.answer,
      solution: t.solution,
      images: t.figure ? [t.figure] : undefined,
      origin: 'generated',
      createdAt: new Date().toISOString(),
    })
  }
  return out
}

/** Стартовый набор: по нескольку заданий на каждый доступный номер предмета. */
export function generateStarterSet(
  subjectIds: string[],
  perNumber = 6,
  rnd: Rnd = Math.random,
  known: ReadonlySet<string> = new Set(),
): Question[] {
  const seen = new Set<string>(known)
  const out: Question[] = []
  for (const sid of subjectIds) {
    for (const no of generatedNumbers(sid)) {
      const made = generateTasks(sid, no, perNumber, rnd, seen)
      for (const q of made) seen.add(q.text)
      out.push(...made)
    }
  }
  return out
}
