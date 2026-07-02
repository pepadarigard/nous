import type { Subject } from '../types'

// Предметы ЕГЭ. id совпадает с именем файла банка вопросов (src/data/bank/<id>.json).
export const SUBJECTS: Subject[] = [
  { id: 'math_prof', name: 'Математика (профильная)', short: 'Матем. (проф)', emoji: '📐' },
  { id: 'math_base', name: 'Математика (базовая)', short: 'Матем. (база)', emoji: '➗' },
  { id: 'russian', name: 'Русский язык', short: 'Русский', emoji: '📝' },
  { id: 'physics', name: 'Физика', short: 'Физика', emoji: '🧲' },
  { id: 'informatics', name: 'Информатика', short: 'Информатика', emoji: '💻' },
  { id: 'chemistry', name: 'Химия', short: 'Химия', emoji: '⚗️' },
  { id: 'biology', name: 'Биология', short: 'Биология', emoji: '🧬' },
  { id: 'history', name: 'История', short: 'История', emoji: '🏛️' },
  { id: 'social', name: 'Обществознание', short: 'Обществозн.', emoji: '⚖️' },
  { id: 'geography', name: 'География', short: 'География', emoji: '🌍' },
  { id: 'literature', name: 'Литература', short: 'Литература', emoji: '📚' },
  { id: 'english', name: 'Английский язык', short: 'Английский', emoji: '🇬🇧' },
]

export function subjectById(id: string): Subject | undefined {
  return SUBJECTS.find((s) => s.id === id)
}

export function subjectName(id: string): string {
  return subjectById(id)?.name ?? id
}

export const WEEKDAYS = [
  { n: 1, short: 'Пн', full: 'Понедельник' },
  { n: 2, short: 'Вт', full: 'Вторник' },
  { n: 3, short: 'Ср', full: 'Среда' },
  { n: 4, short: 'Чт', full: 'Четверг' },
  { n: 5, short: 'Пт', full: 'Пятница' },
  { n: 6, short: 'Сб', full: 'Суббота' },
  { n: 7, short: 'Вс', full: 'Воскресенье' },
]
