import { useStore } from '../store'
import { subjectById, subjectName } from '../data/subjects'
import Modal from '../ui/Modal'
import { Check } from 'lucide-react'
import type { Lesson } from '../types'

const kindLabel: Record<Lesson['kind'], string> = { theory: 'Теория', practice: 'Практика', review: 'Повторение' }
const kindIcon: Record<Lesson['kind'], string> = { theory: '📖', practice: '✏️', review: '🔁' }

export default function LessonDetail({ blockId, lessonId, onClose }: { blockId: string; lessonId: string; onClose: () => void }) {
  const plan = useStore((s) => s.data.plan)
  const toggleLesson = useStore((s) => s.toggleLesson)
  const block = plan?.blocks.find((b) => b.id === blockId)
  const lesson = block?.lessons.find((l) => l.id === lessonId)
  if (!block || !lesson) return null

  const total = block.lessons.length
  const doneN = block.lessons.filter((l) => l.done).length
  const pct = total ? Math.round((doneN / total) * 100) : 0
  const s = subjectById(block.subjectId)

  return (
    <Modal title={lesson.title} onClose={onClose} wide>
      <div className="row wrap" style={{ gap: 8, marginBottom: 14 }}>
        <span className="chip">{kindIcon[lesson.kind]} {kindLabel[lesson.kind]}</span>
        <span className="chip">{s?.emoji} {subjectName(block.subjectId)}</span>
        {lesson.done && <span className="badge strong">Выполнено ✓</span>}
      </div>

      <div style={{ fontSize: 15, lineHeight: 1.65 }}>{lesson.description || 'Подробного описания нет.'}</div>

      <button
        className={'btn ' + (lesson.done ? '' : 'btn-primary')}
        style={{ marginTop: 16 }}
        onClick={() => toggleLesson(block.id, lesson.id)}
      >
        {lesson.done ? 'Снять отметку' : 'Отметить выполненным'}
      </button>

      <div className="card soft" style={{ marginTop: 20 }}>
        <div className="row" style={{ marginBottom: 6 }}>
          <b>Блок: {block.title}</b>
          <div className="spacer" />
          <span className="chip">{doneN} / {total} пройдено</span>
        </div>
        {block.goal && <p className="small muted" style={{ margin: '2px 0 12px' }}>🎯 {block.goal}</p>}
        <div className="pbar" style={{ marginBottom: 14 }}><span style={{ width: `${pct}%` }} /></div>
        {block.lessons.map((l) => (
          <div
            key={l.id}
            className={'lesson' + (l.done ? ' done' : '')}
            style={{ background: l.id === lesson.id ? 'var(--accent-soft)' : undefined }}
          >
            <div className="kind-ic">{kindIcon[l.kind]}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 650, textDecoration: l.done ? 'line-through' : 'none' }}>{l.title}</div>
              <div className="small muted">{kindLabel[l.kind]}</div>
            </div>
            <div className="tick" onClick={() => toggleLesson(block.id, l.id)}>{l.done && <Check size={15} color="#fff" />}</div>
          </div>
        ))}
      </div>
    </Modal>
  )
}
