// Демо-данные для браузерного режима (?demo=1): наглядные скриншоты и разработка без онбординга.

import type { AppData } from '../types'

export function demoData(): AppData {
  const day = 86400000
  const now = Date.now()
  let n = 0
  const L = (title: string, kind: 'theory' | 'practice' | 'review', done: boolean) => ({
    id: 'dl' + n++,
    title,
    kind,
    description: 'Реши 15–20 заданий по теме на РешуЕГЭ, выпиши ошибки в личный словарь.',
    done,
    completedAt: done ? new Date(now - (n % 14) * day).toISOString() : undefined,
  })
  const blocks = [
    {
      id: 'db1', subjectId: 'math_prof', title: 'Фундамент: планиметрия и векторы', goal: 'Закрыть задания 1–3 части 1', order: 0,
      lessons: [
        L('Планиметрия: базовые теоремы', 'theory', true), L('Практика: задание 1 на РешуЕГЭ', 'practice', true),
        L('Векторы и координаты', 'theory', true), L('Практика: задание 2', 'practice', true),
        L('Повторение: разбор ошибок недели', 'review', true), L('Стереометрия: сечения', 'theory', true),
        L('Практика: задание 3', 'practice', false), L('Вероятность: классика', 'theory', false),
        L('Практика: задание 5', 'practice', false), L('Повторение: планиметрия', 'review', false),
      ],
    },
    {
      id: 'db2', subjectId: 'informatics', title: 'КЕГЭ: ручные задания', goal: 'Уверенно решать 1, 2, 14', order: 1,
      lessons: [
        L('Системы счисления', 'theory', true), L('Практика: задание 14 на kompege', 'practice', true),
        L('Логика: таблицы истинности', 'theory', true), L('Практика: задание 2', 'practice', false),
        L('Python: обработка чисел', 'theory', false), L('Практика: задание 17', 'practice', false),
      ],
    },
    {
      id: 'db3', subjectId: 'russian', title: 'Фундамент: орфоэпия и лексика', goal: 'Задания 4–6 без ошибок', order: 2,
      lessons: [
        L('Орфоэпический минимум ФИПИ', 'theory', true), L('Практика: ударения, задание 4', 'practice', true),
        L('Паронимы: словарик', 'theory', false), L('Практика: задание 5', 'practice', false),
      ],
    },
  ]
  const spread = [13, 11, 10, 8, 7, 5, 4, 3, 1, 0, 0, 1, 2]
  const doneLessons = blocks.flatMap((b) => b.lessons.filter((l) => l.done).map((l) => ({ b, l })))
  const progress = doneLessons.map((x, i) => ({
    id: 'de' + i,
    at: new Date(now - spread[i % spread.length] * day).toISOString(),
    type: 'lesson_done' as const,
    subjectId: x.b.subjectId,
    label: 'Пройдено: ' + x.l.title,
    lessonId: x.l.id,
    kind: x.l.kind,
  }))
  return {
    version: 2,
    onboarded: true,
    config: { apiKey: '', textModel: 'qwen/qwen3-32b', showEstimate: true, soundOn: true },
    studentName: 'Миша',
    subjects: ['math_prof', 'informatics', 'russian'],
    goals: [
      { subjectId: 'math_prof', current: 58, target: 85 },
      { subjectId: 'informatics', current: 50, target: 90 },
      { subjectId: 'russian', current: 70, target: 92 },
    ],
    schedules: [
      { subjectId: 'math_prof', hoursPerWeek: 6, days: [1, 3, 5] },
      { subjectId: 'informatics', hoursPerWeek: 4, days: [2, 4] },
      { subjectId: 'russian', hoursPerWeek: 3, days: [6] },
    ],
    examDate: '2027-06-01',
    planNotes: '',
    plan: {
      createdAt: new Date(now - 20 * day).toISOString(),
      overview: 'Фундамент закрыт за лето, осенью — вторая часть. Стабильный ритм важнее рывков.',
      blocks,
    },
    progress,
  }
}
