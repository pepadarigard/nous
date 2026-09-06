// Перетаскивание занятия на другой день.
//
// Своё, на pointer-событиях, а не нативный HTML5 drag-and-drop: нативный в WebView2 капризен
// (не даёт подсветку до drop, ломается на прокрутке) и не поддаётся автопроверке.
// Приёмник дня помечается атрибутом data-day="YYYY-MM-DD".

import { useEffect, useRef, useState } from 'react'

export interface DragPayload {
  blockId: string
  lessonId: string
  title: string
}

export interface DragState {
  payload: DragPayload
  x: number
  y: number
  over: string | null // дата под курсором
}

const THRESHOLD = 4 // пикселей, после которых нажатие считается перетаскиванием, а не кликом

function dayUnder(x: number, y: number): string | null {
  const el = document.elementFromPoint(x, y)
  const holder = el && (el as HTMLElement).closest('[data-day]')
  return holder ? holder.getAttribute('data-day') : null
}

/**
 * Возвращает состояние перетаскивания и обработчик, который вешается на занятие:
 * onPointerDown={(e) => start(e, payload)}
 */
export function useDragMove(onDrop: (payload: DragPayload, dateISO: string) => void) {
  const [drag, setDrag] = useState<DragState | null>(null)
  const origin = useRef<{ x: number; y: number; payload: DragPayload } | null>(null)
  const active = useRef(false)
  const endedAt = useRef(0) // когда закончилось перетаскивание — чтобы отличить его от клика
  const dropRef = useRef(onDrop)
  dropRef.current = onDrop

  useEffect(() => {
    function move(e: PointerEvent) {
      const o = origin.current
      if (!o) return
      if (!active.current) {
        if (Math.abs(e.clientX - o.x) + Math.abs(e.clientY - o.y) < THRESHOLD) return
        active.current = true
        document.body.style.userSelect = 'none'
        document.body.style.cursor = 'grabbing'
      }
      setDrag({ payload: o.payload, x: e.clientX, y: e.clientY, over: dayUnder(e.clientX, e.clientY) })
    }
    function up(e: PointerEvent) {
      const o = origin.current
      origin.current = null
      if (active.current && o) {
        const date = dayUnder(e.clientX, e.clientY)
        if (date) dropRef.current(o.payload, date)
        endedAt.current = Date.now()
      }
      active.current = false
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      setDrag(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [])

  function start(e: React.PointerEvent, payload: DragPayload) {
    if (e.button !== 0) return
    origin.current = { x: e.clientX, y: e.clientY, payload }
    active.current = false
  }

  // Клик прилетает уже ПОСЛЕ pointerup, поэтому смотрим не только на текущее состояние,
  // но и на «только что отпустили» — иначе после переноса открывалась бы карточка занятия.
  const wasDragging = () => active.current || Date.now() - endedAt.current < 250

  return { drag, start, wasDragging }
}
