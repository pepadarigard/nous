import { create } from 'zustand'
import type { AppConfig, AppData, Block, ProgressEvent, StudyPlan, SubjectGoal, SubjectSchedule } from './types'
import { emptyData } from './types'
import { loadState, saveState, uid, humanError } from './lib/api'
import { tutorChat } from './lib/ai'
import { subjectName } from './data/subjects'
import { computeStats, type Celebration } from './lib/stats'

export interface ChatMsg {
  role: 'user' | 'assistant'
  content: string
}

// В модель шлём только хвост истории — иначе долгий чат упирается в лимиты контекста.
const CHAT_CONTEXT = 12

interface Store {
  loaded: boolean
  data: AppData
  planStatus: string
  celebrations: Celebration[]
  chatMsgs: ChatMsg[] // живёт в памяти сессии — чат не теряется при переходах между экранами
  chatBusy: boolean // запрос к ИИ в полёте; в сторе — чтобы доживал при уходе со вкладки

  init: () => Promise<void>
  setPlanStatus: (s: string) => void

  setConfig: (patch: Partial<AppConfig>) => void
  setStudentName: (n: string) => void
  setSubjects: (ids: string[]) => void
  setGoals: (goals: SubjectGoal[]) => void
  setSchedules: (s: SubjectSchedule[]) => void
  setExamDate: (d?: string) => void
  setPlanNotes: (n: string) => void

  setPlan: (p: StudyPlan) => void
  appendBlocks: (blocks: Block[]) => void
  setPlanBlocks: (blocks: Block[]) => void
  ensureSubjectSetup: (ids: string[]) => void
  toggleLesson: (blockId: string, lessonId: string) => void
  dismissCelebration: (id: string) => void
  setChatMsgs: (msgs: ChatMsg[]) => void
  sendChat: (text: string) => Promise<void>
  clearChat: () => void

  finishOnboarding: () => void
  resetAll: () => void
}

export const useStore = create<Store>((set, get) => {
  const commit = (mut: (d: AppData) => AppData) => {
    const next = mut(structuredClone(get().data))
    set({ data: next })
    saveState(next).catch((e) => console.error('saveState', e))
  }
  const pushProgress = (d: AppData, e: Omit<ProgressEvent, 'id' | 'at'>) => {
    d.progress.push({ id: uid('pr_'), at: new Date().toISOString(), ...e })
  }

  return {
    loaded: false,
    data: emptyData(),
    planStatus: '',
    celebrations: [],
    chatMsgs: [],
    chatBusy: false,

    init: async () => {
      const saved = await loadState()
      const base = emptyData()
      const data = saved ? { ...base, ...saved, config: { ...base.config, ...saved.config } } : base
      set({ data, loaded: true })
    },
    setPlanStatus: (s) => set({ planStatus: s }),

    setConfig: (patch) => commit((d) => ({ ...d, config: { ...d.config, ...patch } })),
    setStudentName: (n) => commit((d) => ({ ...d, studentName: n })),
    setSubjects: (ids) => commit((d) => ({ ...d, subjects: ids })),
    setGoals: (goals) => commit((d) => ({ ...d, goals })),
    setSchedules: (s) => commit((d) => ({ ...d, schedules: s })),
    setExamDate: (date) => commit((d) => ({ ...d, examDate: date })),
    setPlanNotes: (n) => commit((d) => ({ ...d, planNotes: n })),

    setPlan: (p) =>
      commit((d) => {
        d.plan = p
        pushProgress(d, { type: 'plan_created', label: 'План загружен' })
        return d
      }),

    appendBlocks: (blocks) =>
      commit((d) => {
        if (!d.plan || !blocks.length) return d
        d.plan.blocks = [...d.plan.blocks, ...blocks]
        return d
      }),

    // Полная замена блоков (переделка плана ИИ): раскладка по дням начинается заново с сегодня.
    setPlanBlocks: (blocks) =>
      commit((d) => {
        if (!d.plan || !blocks.length) return d
        d.plan.blocks = blocks
        d.plan.createdAt = new Date().toISOString()
        return d
      }),

    // После импорта/дописывания плана: новые предметы получают дефолтные цель и расписание,
    // иначе они не видны в «Прогрессе по предметам» и не попадают в промт.
    ensureSubjectSetup: (ids) =>
      commit((d) => {
        for (const id of ids) {
          if (!d.subjects.includes(id)) d.subjects.push(id)
          if (!d.goals.some((g) => g.subjectId === id)) d.goals.push({ subjectId: id, current: 50, target: 80 })
          if (!d.schedules.some((s) => s.subjectId === id)) d.schedules.push({ subjectId: id, hoursPerWeek: 6, days: [1, 2, 3, 4, 5] })
        }
        return d
      }),

    toggleLesson: (blockId, lessonId) => {
      const prev = get().data
      const before = computeStats(prev)
      const next = structuredClone(prev)
      const block = next.plan?.blocks.find((b) => b.id === blockId)
      const lesson = block?.lessons.find((l) => l.id === lessonId)
      if (!lesson) return
      lesson.done = !lesson.done
      lesson.completedAt = lesson.done ? new Date().toISOString() : undefined

      const celebs: Celebration[] = []
      if (!lesson.done) {
        // Снятие отметки: убираем события этого занятия, иначе серию/карту/XP можно накрутить toggle'ом.
        // Старые события без lessonId чистим по label (совпадает с названием).
        const label = `Пройдено: ${lesson.title}`
        next.progress = next.progress.filter(
          (e) => e.type !== 'lesson_done' || (e.lessonId ? e.lessonId !== lesson.id : e.label !== label),
        )
      }
      if (lesson.done) {
        pushProgress(next, {
          type: 'lesson_done',
          subjectId: block!.subjectId,
          label: `Пройдено: ${lesson.title}`,
          lessonId: lesson.id,
          kind: lesson.kind,
        })
        const after = computeStats(next)
        const gained = after.xp - before.xp
        if (gained > 0) celebs.push({ id: uid('cel_'), kind: 'xp', xp: gained })
        if (after.level.level > before.level.level) {
          celebs.push({ id: uid('cel_'), kind: 'level', level: after.level.level, title: after.level.title })
        }
        const wasUnlocked = new Set(before.achievements.filter((a) => a.unlocked).map((a) => a.id))
        after.achievements
          .filter((a) => a.unlocked && !wasUnlocked.has(a.id))
          .forEach((a) => celebs.push({ id: uid('cel_'), kind: 'achievement', icon: a.icon, title: a.title, desc: a.desc }))
      }

      set({ data: next, celebrations: celebs.length ? [...get().celebrations, ...celebs] : get().celebrations })
      saveState(next).catch((e) => console.error('saveState', e))
    },
    dismissCelebration: (id) => set({ celebrations: get().celebrations.filter((c) => c.id !== id) }),
    setChatMsgs: (msgs) => set({ chatMsgs: msgs }),

    // Запрос к репетитору живёт В СТОРЕ, а не в компоненте чата: пользователь может уйти
    // на другую вкладку — ответ всё равно дойдёт и ляжет в chatMsgs, а не потеряется.
    sendChat: async (text) => {
      const q = text.trim()
      const s0 = get()
      if (!q || s0.chatBusy) return
      const base: ChatMsg[] = [...s0.chatMsgs, { role: 'user', content: q }]
      set({ chatMsgs: base, chatBusy: true })
      let ans = ''
      try {
        const d = get().data
        // Краткая справка об ученике — чтобы репетитор отвечал в контексте его предметов и целей.
        const ctx = [
          d.studentName ? `имя ${d.studentName}` : '',
          ...d.subjects.map((id) => {
            const g = d.goals.find((x) => x.subjectId === id)
            return `${subjectName(id)} (${g ? `сейчас ~${g.current}, цель ${g.target}` : 'баллы не указаны'})`
          }),
          d.examDate ? `экзамен ${d.examDate}` : '',
        ].filter(Boolean).join('; ')
        const a = await tutorChat(d.config, base.slice(-CHAT_CONTEXT).map((m) => ({ role: m.role, content: m.content })), ctx)
        ans = a || 'Пустой ответ.'
      } catch (e) {
        ans = '⚠️ ' + humanError(e)
      }
      set({ chatMsgs: [...base, { role: 'assistant', content: ans }], chatBusy: false })
    },
    clearChat: () => set({ chatMsgs: [], chatBusy: false }),

    finishOnboarding: () => commit((d) => ({ ...d, onboarded: true })),
    resetAll: () => commit(() => emptyData()),
  }
})
