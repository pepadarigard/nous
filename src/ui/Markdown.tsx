import { mdToHtml } from '../lib/md'
import { openExternal } from '../lib/api'

/**
 * Разметка от ИИ, выведенная как HTML.
 *
 * Существует ради одной строчки — перехвата клика по ссылке. Без него ссылка
 * в ответе модели уводит ОКНО ПРИЛОЖЕНИЯ на сайт: в Tauri это не вкладка, а
 * тот же webview, и вернуться назад нечем — приложение приходится
 * перезапускать. Раньше перехват стоял только в чате, а разбор занятия,
 * проверка сочинения и итоги недели рисовали markdown напрямую.
 *
 * Текст экранируется внутри mdToHtml, а href разрешён только для http(s),
 * поэтому подставить сюда разметку или javascript: нельзя.
 */
export default function Markdown({
  text,
  html,
  className = '',
  style,
}: {
  /** Исходный markdown. */
  text?: string
  /** Уже собранный HTML — для стрима, где к разметке дописывается курсор. */
  html?: string
  className?: string
  style?: React.CSSProperties
}) {
  function onClick(e: React.MouseEvent) {
    const a = (e.target as HTMLElement).closest('a.md-link') as HTMLAnchorElement | null
    if (!a) return
    const href = a.getAttribute('href') || ''
    if (/^https?:\/\//i.test(href)) {
      e.preventDefault()
      openExternal(href)
    }
  }

  return (
    <div
      className={('md-body ' + className).trim()}
      style={style}
      onClick={onClick}
      dangerouslySetInnerHTML={{ __html: html ?? mdToHtml(text ?? '') }}
    />
  )
}
