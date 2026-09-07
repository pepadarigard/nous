import { create } from 'zustand'
import type { AppConfig, AppData, Attempt, Block, LessonBrief, Material, MockResult, PlanEvent, ProgressEvent, Question, ScheduleRules, StudyPlan, SubjectGoal, SubjectSchedule } from './types'
import { emptyData, emptyRules } from './types'
import { generateStarterSet } from './lib/taskgen'
import { catchUpPlan } from './lib/schedule'
import { loadState, saveState, uid, humanError, deleteMaterialFiles } from './lib/api'
import { tutorChatStream } from './lib/ai'
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

  pinLesson: (blockId: string, lessonId: string, dateISO?: string) => void
  catchUpOverdue: () => number
  addEvent: (e: Omit<PlanEvent, 'id'>) => void
  updateEvent: (id: string, patch: Partial<PlanEvent>) => void
  removeEvent: (id: string) => void
  toggleEvent: (id: string) => void
  setRules: (patch: Partial<ScheduleRules>) => void

  addMaterial: (m: Material) => void
  updateMaterial: (id: string, patch: Partial<Material>) => void
  removeMaterial: (id: string) => void
  attachMaterial: (blockId: string, lessonId: string, materialId: string) => void
  detachMaterial: (blockId: string, lessonId: string, materialId: string) => void

  setLessonBrief: (blockId: string, lessonId: string, brief?: LessonBrief) => void
  addQuestions: (qs: Question[]) => void
  updateQuestion: (id: string, patch: Partial<Question>) => void
  removeQuestion: (id: string) => void
  recordAttempt: (a: Omit<Attempt, 'id' | 'at'>) => void
  recordMock: (m: Omit<MockResult, 'id' | 'at'>) => void

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

    // Перенос занятия руками: дата → закрепить на ней, undefined → вернуть в авто-раскладку.
    pinLesson: (blockId, lessonId, dateISO) =>
      commit((d) => {
        const block = d.plan?.blocks.find((b) => b.id === blockId)
        const lesson = block?.lessons.find((l) => l.id === lessonId)
        if (!lesson) return d
        if (dateISO) lesson.pinnedDate = dateISO
        else delete lesson.pinnedDate
        return d
      }),

    // Разложить всё просроченное по ближайшим подходящим дням. Возвращает, сколько перенесено.
    catchUpOverdue: () => {
      const cur = get().data
      if (!cur.plan) return 0
      const byId = catchUpPlan(cur.plan, cur.schedules, cur.rules)
      const moved = Object.keys(byId).length
      if (!moved) return 0
      commit((d) => {
        for (const b of d.plan?.blocks ?? []) {
          for (const l of b.lessons) {
            if (byId[l.id]) l.pinnedDate = byId[l.id]
          }
        }
        return d
      })
      return moved
    },

    addEvent: (e) =>
      commit((d) => {
        if (!d.events) d.events = []
        d.events.push({ ...e, id: uid('ev_') })
        return d
      }),
    updateEvent: (id, patch) =>
      commit((d) => {
        const ev = d.events?.find((x) => x.id === id)
        if (ev) Object.assign(ev, patch)
        return d
      }),
    removeEvent: (id) =>
      commit((d) => {
        d.events = (d.events ?? []).filter((x) => x.id !== id)
        return d
      }),
    toggleEvent: (id) =>
      commit((d) => {
        const ev = d.events?.find((x) => x.id === id)
        if (ev) ev.done = !ev.done
        return d
      }),
    setRules: (patch) =>
      commit((d) => {
        d.rules = { ...emptyRules(), ...(d.rules ?? {}), ...patch }
        return d
      }),

    addMaterial: (m) =>
      commit((d) => {
        if (!d.materials) d.materials = []
        d.materials.unshift(m) // свежие — сверху
        return d
      }),
    updateMaterial: (id, patch) =>
      commit((d) => {
        const m = d.materials?.find((x) => x.id === id)
        if (m) Object.assign(m, patch)
        return d
      }),
    // Удаление стирает и файлы на диске: оставлять их — копить мусор в папке приложения.
    removeMaterial: (id) => {
      const m = get().data.materials?.find((x) => x.id === id)
      deleteMaterialFiles(id, m?.file).catch((e) => console.error('deleteMaterialFiles', e))
      commit((d) => {
        d.materials = (d.materials ?? []).filter((x) => x.id !== id)
        for (const b of d.plan?.blocks ?? []) {
          for (const l of b.lessons) {
            if (l.materialIds?.includes(id)) l.materialIds = l.materialIds.filter((x) => x !== id)
          }
        }
        return d
      })
    },
    attachMaterial: (blockId, lessonId, materialId) =>
      commit((d) => {
        const lesson = d.plan?.blocks.find((b) => b.id === blockId)?.lessons.find((l) => l.id === lessonId)
        if (!lesson) return d
        if (!lesson.materialIds) lesson.materialIds = []
        if (!lesson.materialIds.includes(materialId)) lesson.materialIds.push(materialId)
        return d
      }),
    detachMaterial: (blockId, lessonId, materialId) =>
      commit((d) => {
        const lesson = d.plan?.blocks.find((b) => b.id === blockId)?.lessons.find((l) => l.id === lessonId)
        if (lesson?.materialIds) lesson.materialIds = lesson.materialIds.filter((x) => x !== materialId)
        return d
      }),

    // Материал занятия от ИИ сохраняется В САМО ЗАНЯТИЕ: сгенерировали один раз — дальше офлайн.
    setLessonBrief: (blockId, lessonId, brief) =>
      commit((d) => {
        const lesson = d.plan?.blocks.find((b) => b.id === blockId)?.lessons.find((l) => l.id === lessonId)
        if (!lesson) return d
        if (brief) lesson.brief = brief
        else delete lesson.brief
        return d
      }),

    addQuestions: (qs) =>
      commit((d) => {
        if (!d.questions) d.questions = []
        d.questions.push(...qs)
        return d
      }),
    updateQuestion: (id, patch) =>
      commit((d) => {
        const q = d.questions?.find((x) => x.id === id)
        if (q) Object.assign(q, patch)
        return d
      }),
    removeQuestion: (id) =>
      commit((d) => {
        d.questions = (d.questions ?? []).filter((x) => x.id !== id)
        return d
      }),
    recordAttempt: (a) =>
      commit((d) => {
        if (!d.attempts) d.attempts = []
        d.attempts.push({ ...a, id: uid('at_'), at: new Date().toISOString() })
        // История попыток не должна расти бесконечно — держим последние 5000.
        if (d.attempts.length > 5000) d.attempts = d.attempts.slice(-5000)
        return d
      }),

    recordMock: (m) =>
      commit((d) => {
        if (!d.mocks) d.mocks = []
        d.mocks.push({ ...m, id: uid('mk_'), at: new Date().toISOString() })
        return d
      }),

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
    // Вывод ПЛАВНЫЙ: сырой поток копится в acc, а на экран проявляем посимвольно, адаптивно
    // догоняя буфер, — модель шлёт токены рывками, а текст «печатается» ровно.
    sendChat: async (text) => {
      const q = text.trim()
      const s0 = get()
      if (!q || s0.chatBusy) return
      const base: ChatMsg[] = [...s0.chatMsgs, { role: 'user', content: q }]
      set({ chatMsgs: base, chatBusy: true })

      let acc = '' // весь полученный сырой текст
      let shown = 0 // сколько символов уже показано
      let finalText = '' // очищенный полный ответ (cleanMath)
      let streamDone = false
      let reveal: ReturnType<typeof setInterval> | null = null
      const stopReveal = () => { if (reveal) { clearInterval(reveal); reveal = null } }
      const alive = () => get().chatBusy // очистили чат извне → прекращаем, не воскрешаем переписку
      const put = (content: string) => set({ chatMsgs: [...base, { role: 'assistant', content }] })

      const tick = () => {
        if (!alive()) { stopReveal(); return }
        if (shown < acc.length) {
          // проявляем долю отставания: ровное «печатание» с быстрым догоном при рывках потока
          shown = Math.min(acc.length, shown + Math.max(1, Math.ceil((acc.length - shown) / 7)))
          put(acc.slice(0, shown))
        } else if (streamDone) {
          stopReveal()
          put(finalText || acc || 'Пустой ответ.')
          set({ chatBusy: false })
        }
      }

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
        finalText = await tutorChatStream(
          d.config,
          base.slice(-CHAT_CONTEXT).map((m) => ({ role: m.role, content: m.content })),
          ctx,
          (delta) => {
            acc += delta
            if (!reveal) reveal = setInterval(tick, 20)
          },
        )
        streamDone = true
        if (!alive()) { stopReveal(); return }
        if (!reveal) {
          // ничего не стримилось (мгновенный ответ) — показать сразу
          put(finalText || 'Пустой ответ.')
          set({ chatBusy: false })
        }
        // иначе финал покажет tick, когда «печать» догонит буфер
      } catch (e) {
        stopReveal()
        if (!alive()) return
        put('⚠️ ' + humanError(e))
        set({ chatBusy: false })
      }
    },
    clearChat: () => set({ chatMsgs: [], chatBusy: false }),

    // Стартовые задания кладём сразу: иначе тренажёр, повторение и балл стоят
    // пустыми, пока ученик где-то не раздобудет свой банк, и половина приложения
    // выглядит нерабочей. Задания ГЕНЕРИРУЮТСЯ — значит и здесь, и потом их можно
    // сделать сколько угодно.
    finishOnboarding: () =>
      commit((d) => {
        const next = { ...d, onboarded: true }
        if (!(d.questions ?? []).length) {
          const fresh = generateStarterSet(d.subjects, 8)
          if (fresh.length) next.questions = fresh
        }
        return next
      }),

    resetAll: () =>
      commit((d) => {
        const fresh = emptyData()
        fresh.config = { ...fresh.config, ...d.config }
        return fresh
      }),
  }
})
