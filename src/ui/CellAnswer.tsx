import { useEffect, useRef } from 'react'

/**
 * Поле краткого ответа как в бланке ЕГЭ.
 *
 * Зачем клеточки, а не обычная строка. В бланке ответов № 1 ответ пишется
 * посимвольно, с первой клеточки, без пробелов и разделителей — и половина
 * потерянных баллов на экзамене берётся именно отсюда: лишний пробел, запятая
 * между номерами, ответ не с начала строки. Тренироваться надо в том виде, в
 * котором придётся отвечать.
 *
 * Клеток всегда {@link CELLS}, сколько бы ни было в ответе: если показывать
 * ровно столько, сколько нужно, поле само подсказывает длину ответа — а на
 * экзамене такой подсказки нет.
 */
const CELLS = 17

/** Что вообще можно писать в бланк: буквы, цифры, запятая в десятичной дроби, минус. */
const ALLOWED = /[-0-9A-Za-zА-Яа-яЁё,]/

export default function CellAnswer({
  value,
  onChange,
  onEnter,
  disabled,
  autoFocus,
}: {
  value: string
  onChange: (v: string) => void
  onEnter?: () => void
  disabled?: boolean
  autoFocus?: boolean
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([])
  const chars = [...value].slice(0, CELLS)

  useEffect(() => {
    if (autoFocus) refs.current[0]?.focus()
  }, [autoFocus])

  const focusCell = (i: number) => {
    const el = refs.current[Math.max(0, Math.min(CELLS - 1, i))]
    el?.focus()
    el?.select()
  }

  /** Заменить символ в позиции i (пустая строка — стереть). */
  const setAt = (i: number, ch: string) => {
    const next = [...chars]
    while (next.length < i) next.push(' ')
    next[i] = ch
    onChange(next.join('').replace(/\s+$/, ''))
  }

  function onKeyDown(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      onEnter?.()
      return
    }
    if (e.key === 'Backspace') {
      e.preventDefault()
      // Пусто — уходим назад и стираем там: так работает любой код из СМС.
      if (chars[i]) setAt(i, '')
      else if (i > 0) {
        setAt(i - 1, '')
        focusCell(i - 1)
      }
      return
    }
    if (e.key === 'ArrowLeft') { e.preventDefault(); focusCell(i - 1) }
    if (e.key === 'ArrowRight') { e.preventDefault(); focusCell(i + 1) }
    if (e.key === 'Delete') { e.preventDefault(); setAt(i, '') }
  }

  function onInput(i: number, e: React.ChangeEvent<HTMLInputElement>) {
    // Из вставки берём всё разом и раскладываем по клеткам, начиная с текущей.
    const typed = [...e.target.value].filter((c) => ALLOWED.test(c))
    if (!typed.length) {
      e.target.value = chars[i] ?? ''
      return
    }
    const next = [...chars]
    while (next.length < i) next.push(' ')
    for (let k = 0; k < typed.length && i + k < CELLS; k++) next[i + k] = typed[k]
    onChange(next.join('').replace(/\s+$/, ''))
    focusCell(i + typed.length)
  }

  return (
    <div className="cells" role="group" aria-label="Ответ по клеточкам, как в бланке ЕГЭ">
      {Array.from({ length: CELLS }, (_, i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el }}
          className={'cell' + (chars[i] && chars[i] !== ' ' ? ' filled' : '')}
          value={chars[i] === ' ' ? '' : (chars[i] ?? '')}
          onChange={(e) => onInput(i, e)}
          onKeyDown={(e) => onKeyDown(i, e)}
          onFocus={(e) => e.target.select()}
          disabled={disabled}
          inputMode="text"
          autoComplete="off"
          spellCheck={false}
          aria-label={'Клетка ' + (i + 1)}
        />
      ))}
    </div>
  )
}
