// Синхронизация телефона и компьютера — файлом, без сервера.
//
// Почему без сервера. Обещание приложения — «данные твои и лежат у тебя».
// Свой сервер это обещание ломает: появляется место, где лежит чужая копия
// твоей подготовки, и человек, который может её потерять или посмотреть. А
// файл ученик кладёт куда хочет: в облако, которым и так пользуется, в
// мессенджер самому себе, на флешку.
//
// Почему СЛИЯНИЕ, а не замена. Обычный «экспорт-импорт» для синхронизации не
// годится: решал днём на телефоне, вечером на компьютере — и любой импорт
// стирает половину работы. Поэтому здесь настоящее слияние двух состояний.
//
// Правило простое и его стоит держать в голове:
//
//   ЖУРНАЛЫ СКЛАДЫВАЮТСЯ, НАСТРОЙКИ БЕРУТСЯ У БОЛЕЕ СВЕЖЕЙ СТОРОНЫ.
//
// Попытки, пробники, разборы ошибок, задания и события — это записи, каждая со
// своим id: их объединяем, ничего не теряя. А цели, расписание, ключи и
// правила существуют в одном экземпляре, и угадывать тут нечего: берём те, что
// сохранены позже.
//
// Отдельно план. Два плана слить нельзя — это разные деревья. Но галочки
// «выполнено» терять нельзя тем более: их ученик ставил руками. Поэтому берём
// более свежий план, а отметки переносим ПО НАЗВАНИЮ занятия внутри блока:
// идентификаторы у планов с разных устройств разные, а названия совпадают.

import type { AppData, Block, StudyPlan } from '../types'

/** Что лежит в файле синхронизации. */
export interface SyncFile {
  /** Версия формата. Появится вторая — по ней и разойдёмся. */
  nous: 1
  /** Когда снят слепок. По нему решается, чьи настройки свежее. */
  savedAt: string
  /** Откуда файл — просто чтобы человек не перепутал. */
  device?: string
  data: AppData
}

/** Запись с идентификатором — любой элемент журнала. */
interface WithId {
  id: string
}

/** Объединить два журнала по id, сохранив порядок: сначала свои, потом чужие новые. */
function unionById<T extends WithId>(mine: T[] = [], theirs: T[] = []): T[] {
  const seen = new Set(mine.map((x) => x.id))
  const out = [...mine]
  for (const x of theirs) {
    if (!seen.has(x.id)) {
      seen.add(x.id)
      out.push(x)
    }
  }
  return out
}

/** Ключ занятия внутри плана: блок и название. Идентификаторы у копий разные. */
const lessonKey = (b: Block, title: string) => b.title + '␟' + title

/** Названия занятий, отмеченных выполненными. */
function doneKeys(plan?: StudyPlan): Set<string> {
  const out = new Set<string>()
  for (const b of plan?.blocks ?? []) {
    for (const l of b.lessons) if (l.done) out.add(lessonKey(b, l.title))
  }
  return out
}

/**
 * Слить два состояния.
 *
 * @param mine что лежит на этом устройстве
 * @param theirs что приехало из файла
 * @param mineAt когда сохранено моё (ISO); пусто — считаем очень старым
 * @param theirsAt когда сохранено чужое
 */
export function mergeState(
  mine: AppData,
  theirs: AppData,
  mineAt: string,
  theirsAt: string,
): AppData {
  // Чьи настройки главнее. Равенство трактуем в пользу своих: перезаписывать
  // то, что человек видит прямо сейчас, без причины не стоит.
  const theirsNewer = Boolean(theirsAt) && theirsAt > (mineAt || '')
  const fresh = theirsNewer ? theirs : mine
  const stale = theirsNewer ? mine : theirs

  // План: берём у свежей стороны, а отметки — со ВСЕХ, объединением.
  const doneAll = new Set([...doneKeys(mine.plan), ...doneKeys(theirs.plan)])
  const plan = fresh.plan ?? stale.plan
  const mergedPlan: StudyPlan | undefined = plan && {
    ...plan,
    blocks: plan.blocks.map((b) => ({
      ...b,
      lessons: b.lessons.map((l) => (l.done || doneAll.has(lessonKey(b, l.title)) ? { ...l, done: true } : l)),
    })),
  }

  return {
    ...fresh,
    // Единственные в своём роде — у свежей стороны.
    version: Math.max(mine.version, theirs.version),
    onboarded: mine.onboarded || theirs.onboarded,
    config: { ...stale.config, ...fresh.config },
    studentName: fresh.studentName ?? stale.studentName,
    subjects: fresh.subjects.length ? fresh.subjects : stale.subjects,
    goals: fresh.goals.length ? fresh.goals : stale.goals,
    schedules: fresh.schedules.length ? fresh.schedules : stale.schedules,
    examDate: fresh.examDate ?? stale.examDate,
    planNotes: fresh.planNotes ?? stale.planNotes,
    rules: fresh.rules ?? stale.rules,
    plan: mergedPlan,

    // Журналы — объединение. Здесь терять нельзя ничего.
    progress: unionById(mine.progress, theirs.progress),
    questions: unionById(mine.questions, theirs.questions),
    attempts: unionById(mine.attempts, theirs.attempts),
    mocks: unionById(mine.mocks, theirs.mocks),
    mistakes: unionById(mine.mistakes, theirs.mistakes),
    variants: unionById(mine.variants, theirs.variants),
    events: unionById(mine.events, theirs.events),
    // Материалы — тоже журнал, но САМИ ФАЙЛЫ по этому каналу не едут: они
    // лежат в папке приложения и весят слишком много. Приезжает описание, и
    // приложение честно покажет, что оригинал остался на другом устройстве.
    materials: unionById(mine.materials, theirs.materials),
  }
}

/** Что изменится при слиянии — показать до того, как нажмут кнопку. */
export interface MergePreview {
  attempts: number
  questions: number
  mocks: number
  mistakes: number
  variants: number
  events: number
  materials: number
  /** Чей план и настройки победят. */
  takesSettings: 'мои' | 'из файла'
  /** Сколько отметок «выполнено» добавится в план. */
  lessonsDone: number
}

export function previewMerge(
  mine: AppData,
  theirs: AppData,
  mineAt: string,
  theirsAt: string,
): MergePreview {
  const newOf = <T extends WithId>(a: T[] = [], b: T[] = []) => {
    const seen = new Set(a.map((x) => x.id))
    return b.filter((x) => !seen.has(x.id)).length
  }
  const before = doneKeys(mine.plan)
  const after = doneKeys(theirs.plan)
  let gained = 0
  for (const k of after) if (!before.has(k)) gained++
  return {
    attempts: newOf(mine.attempts, theirs.attempts),
    questions: newOf(mine.questions, theirs.questions),
    mocks: newOf(mine.mocks, theirs.mocks),
    mistakes: newOf(mine.mistakes, theirs.mistakes),
    variants: newOf(mine.variants, theirs.variants),
    events: newOf(mine.events, theirs.events),
    materials: newOf(mine.materials, theirs.materials),
    takesSettings: theirsAt && theirsAt > (mineAt || '') ? 'из файла' : 'мои',
    lessonsDone: gained,
  }
}

/** Разобрать файл: и новый конверт, и старый бэкап одним куском. */
export function parseSyncFile(text: string): { data: AppData; savedAt: string; device?: string } {
  const raw = JSON.parse(text)
  if (raw && typeof raw === 'object' && raw.nous === 1 && raw.data?.config) {
    return { data: raw.data as AppData, savedAt: String(raw.savedAt ?? ''), device: raw.device }
  }
  // Старый бэкап — это просто AppData без конверта. Времени в нём нет, значит
  // считаем его старым: чужие настройки не должны молча вытеснить текущие.
  if (raw && typeof raw === 'object' && raw.config) return { data: raw as AppData, savedAt: '' }
  throw new Error('Это не файл Nous — нужен JSON, созданный кнопкой «Сохранить для переноса».')
}

/** Собрать файл синхронизации. */
export function buildSyncFile(data: AppData, device?: string): SyncFile {
  return { nous: 1, savedAt: new Date().toISOString(), device, data }
}
