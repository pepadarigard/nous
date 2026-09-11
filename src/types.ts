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
  pinnedDate?: string // занятие перенесено руками на конкретный день (YYYY-MM-DD); авто-раскладка его не трогает
  materialIds?: string[] // свои материалы, привязанные к занятию
  brief?: LessonBrief // теория и задания от ИИ, сохранённые в занятии
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
  perDay?: number // сколько занятий этого предмета ставить в один день (по умолчанию 1)
}

export type MaterialKind = 'pdf' | 'docx' | 'text' | 'markdown' | 'csv' | 'json' | 'image' | 'other'

/**
 * Свой файл: учебник, вариант, конспект, таблица. Оригинал лежит в папке приложения,
 * извлечённый текст — рядом отдельным файлом (в состоянии хранится только описание).
 */
export interface Material {
  id: string
  name: string // имя файла как у пользователя
  kind: MaterialKind
  subjectId?: string
  addedAt: string
  size: number // байт
  pages?: number
  chars?: number // сколько символов текста удалось извлечь
  file?: string // имя сохранённого оригинала (<id>.<ext>), если сохранён
  note?: string
  warn?: string // почему текста нет или он неполный
}

/** Откуда взялось задание. */
// 'generated' стоит особняком: такое задание собрано самим приложением и его можно
// пересоздать в любой момент. Поэтому нерешённые генерированные задания разрешено
// выбрасывать при чистке — в отличие от того, что ученик принёс сам.
export type QuestionOrigin = 'manual' | 'import' | 'material' | 'ai' | 'generated'

/** Задание в личном банке. */
export interface Question {
  id: string
  subjectId: string
  taskNo?: number // номер задания в КИМ
  topic?: string
  text: string
  options?: string[] // варианты, если задание с выбором
  answer?: string // эталонный краткий ответ; несколько допустимых — через |
  solution?: string // разбор
  /**
   * Критерии оценивания — только у заданий второй части. Там нет одного верного
   * ответа, есть шкала: за что дают четыре балла, за что три и так далее.
   */
  criteria?: string
  /**
   * Чертежи к заданию как data:URL. Хранятся ВНУТРИ задания, а не ссылкой:
   * без рисунка геометрическая задача просто нерешаема, а приложение должно
   * работать без интернета — значит картинка обязана лежать рядом.
   */
  images?: string[]
  sourceId?: string // материал, из которого взято
  origin: QuestionOrigin
  createdAt: string
}

/** Оценка по одному критерию проверки. */
export interface CriterionScore {
  name: string
  got: number
  max: number
  comment: string
}

/** Разбор развёрнутого ответа: баллы по критериям, ошибки, что дальше. */
export interface SolutionReview {
  score: number
  max: number
  criteria: CriterionScore[]
  errors: string[]
  strengths: string[]
  advice: string
  uncertain?: boolean // ИИ не уверен в точных критериях — предупредить ученика
  at: string
  model?: string
}

/**
 * Разбор одной ошибки.
 *
 * Смысл не в том, чтобы показать правильный ответ — его видно и так. Смысл в
 * том, ГДЕ сломалось рассуждение: «взял площадь вместо периметра», «потерял
 * второй корень при отборе». Это и отличает занятие с репетитором от
 * нарешивания, и это же копится в типологию: если одна и та же метка выпадает
 * третий раз, дело не в невнимательности, а в непонятой теме.
 */
export interface MistakeNote {
  id: string
  at: string
  subjectId: string
  taskNo?: number
  questionId: string
  /** Короткая метка типа ошибки — по ней считаются повторы. */
  kind: string
  /** Где именно сломалось рассуждение. */
  why: string
  /** Что запомнить, чтобы не повторить. */
  remember: string
  /** Модель честно не уверена — показать это ученику. */
  uncertain?: boolean
  model?: string
}

/** Материал занятия, подготовленный ИИ и сохранённый в само занятие (дальше работает офлайн). */
export interface LessonBrief {
  theory: string // краткая теория в markdown
  tasks: { text: string; answer?: string }[]
  createdAt: string
  model?: string
}

/** Попытка решения — из неё считается статистика по номерам заданий. */
export interface Attempt {
  id: string
  questionId: string
  subjectId: string
  taskNo?: number
  at: string
  answer: string
  correct: boolean | null // null — эталона не было, проверить не с чем
  score?: number // баллы за развёрнутый ответ (если проверял ИИ)
  maxScore?: number
}

/**
 * Результат пробника. Хранится отдельно от попыток, потому что ценность здесь —
 * не отдельный ответ, а замер целиком: сколько набрал за один заход и под таймером.
 * По этой истории видно движение, которого не видно в общей точности.
 */
export interface MockResult {
  id: string
  subjectId: string
  at: string
  /** Набрано первичных баллов. */
  primary: number
  /** Из скольких возможных в СОБРАННОМ варианте (банк редко покрывает всю работу). */
  ofPrimary: number
  /** Максимум за настоящую работу — для честного пересчёта. */
  maxPrimary: number
  /** Тестовый балл: доля от собранного варианта, натянутая на всю работу. */
  testScore: number
  /** Сколько заданий было в варианте. */
  count: number
  /** Сколько минут ушло по факту. */
  minutes: number
}

/**
 * Готовый вариант экзамена: список заданий по порядку.
 *
 * Хранится ССЫЛКАМИ на задания, а не копиями: сами задания лежат в общем банке
 * и оттуда же попадают в тренажёр и в повторение. Вариант добавляет к ним одно
 * — порядок, в котором их надо решать, и то, что это один замер целиком.
 */
export interface ExamVariant {
  id: string
  subjectId: string
  title: string
  /** Номер варианта на сайте-источнике, чтобы не скачать его дважды. */
  sourceId?: string
  /** Задания по порядку, от первого номера к последнему. */
  questionIds: string[]
  /**
   * Номер каждого задания В ЭТОЙ работе, параллельно questionIds.
   *
   * Хранится отдельно от самого задания, потому что одно и то же задание может
   * стоять в банке под своим номером, а в варианте занимать другое место — и
   * балл за него считается по МЕСТУ В РАБОТЕ. Старые варианты этого поля не
   * имеют: там номер равен позиции.
   */
  taskNos?: number[]
  addedAt: string
}

/** Своё дело в календаре: репетитор, пробник, отдых — что угодно вне плана ИИ. */
export interface PlanEvent {
  id: string
  date: string // YYYY-MM-DD
  title: string
  note?: string
  time?: string // '17:30' — необязательно
  subjectId?: string
  done?: boolean
}

/** Отрезок без занятий: каникулы, поездка, болезнь. */
export interface Vacation {
  id: string
  from: string // YYYY-MM-DD включительно
  to: string // YYYY-MM-DD включительно
  title?: string
}

/** Правила раскладки плана по календарю. */
export interface ScheduleRules {
  daysOff: string[] // отдельные дни без занятий (YYYY-MM-DD)
  vacations: Vacation[]
  maxPerDay?: number // потолок занятий в день по всем предметам (0/undefined — без потолка)
}

export function emptyRules(): ScheduleRules {
  return { daysOff: [], vacations: [] }
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

export type Provider =
  | 'ollama'
  | 'lmstudio'
  | 'groq'
  | 'openrouter'
  | 'cerebras'
  | 'siliconflow'
  | 'zhipu'
  | 'nvidia'
  | 'deepinfra'
  | 'novita'
  | 'github'

export interface AppConfig {
  apiKey: string // ключ Groq (историческое поле)
  apiKeyOr?: string // ключ OpenRouter
  apiKeyCb?: string // ключ Cerebras
  extraKeys?: Partial<Record<Provider, string>> // ключи остальных провайдеров
  provider?: Provider // активный провайдер ИИ
  textModel: string
  modelAutoPicked?: boolean // самая умная модель уже подобрана автоматически (чтобы не перевыбирать)
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
  materials?: Material[] // свои файлы (библиотека)
  questions?: Question[] // личный банк заданий
  attempts?: Attempt[] // история решений
  mocks?: MockResult[] // результаты пробников
  mistakes?: MistakeNote[] // разборы своих ошибок — из них видно, что повторяется
  variants?: ExamVariant[] // скачанные целые варианты экзамена
  events?: PlanEvent[] // свои дела в календаре
  rules?: ScheduleRules // выходные, каникулы, потолок занятий в день
}

export const DEFAULT_TEXT_MODEL = 'qwen/qwen3-32b'

export function emptyData(): AppData {
  return {
    version: 3,
    onboarded: false,
    config: { apiKey: '', textModel: DEFAULT_TEXT_MODEL, showEstimate: true, soundOn: true },
    subjects: [],
    goals: [],
    schedules: [],
    progress: [],
    materials: [],
    questions: [],
    attempts: [],
    mocks: [],
    mistakes: [],
    variants: [],
    events: [],
    rules: emptyRules(),
  }
}
