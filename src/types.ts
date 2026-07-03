// Модель данных. Наш ИИ НЕ генерирует план — он раскладывает план от внешнего ИИ.

export type LessonKind = 'theory' | 'practice' | 'review'

export interface Subject {
  id: string
  name: string
  short: string
  emoji: string
}

export interface Lesson {
  id: string
  title: string
  kind: LessonKind
  description: string
  done: boolean
  completedAt?: string
}

export interface Block {
  id: string
  subjectId: string
  title: string
  goal: string
  order: number
  lessons: Lesson[]
}

export interface StudyPlan {
  createdAt: string
  examDate?: string
  overview: string
  blocks: Block[]
}

export interface SubjectGoal {
  subjectId: string
  current: number
  target: number
}

export interface SubjectSchedule {
  subjectId: string
  hoursPerWeek: number
  days: number[] // 1=Пн ... 7=Вс
}

export type ProgressType = 'lesson_done' | 'plan_created'

export interface ProgressEvent {
  id: string
  at: string
  type: ProgressType
  subjectId?: string
  label: string
  lessonId?: string // чтобы удалить событие при снятии отметки (иначе статистика накручивается)
  kind?: LessonKind // для честного XP по истории (переживает обновление плана)
}

export interface AppConfig {
  apiKey: string
  textModel: string
  showEstimate?: boolean // показывать приблизительный балл по прогрессу (по умолчанию да)
  soundOn?: boolean // звук при новом уровне/достижении (по умолчанию да)
}

export interface AppData {
  version: number
  onboarded: boolean
  config: AppConfig
  studentName?: string
  subjects: string[]
  goals: SubjectGoal[]
  schedules: SubjectSchedule[]
  examDate?: string
  planNotes?: string // ответы на доп. вопросы — идут в промт для ИИ
  plan?: StudyPlan
  progress: ProgressEvent[]
}

export const DEFAULT_TEXT_MODEL = 'qwen/qwen3-32b'

export function emptyData(): AppData {
  return {
    version: 2,
    onboarded: false,
    config: { apiKey: '', textModel: DEFAULT_TEXT_MODEL, showEstimate: true, soundOn: true },
    subjects: [],
    goals: [],
    schedules: [],
    progress: [],
  }
}
