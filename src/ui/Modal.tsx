import { useEffect, type ReactNode } from 'react'
import { X } from 'lucide-react'

export default function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
}) {
  // Escape закрывает окно — привычно и удобно.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  return (
    <div className="modal-bg" onClick={onClose}>
      <div
        className="modal fade-in"
        style={wide ? { maxWidth: 720 } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="row" style={{ marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 20 }}>{title}</h2>
          <div className="spacer" />
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Закрыть">
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
