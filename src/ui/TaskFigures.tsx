/**
 * Чертежи к заданию.
 *
 * Геометрию и графики без рисунка решать нельзя — «в треугольнике ABC…» без
 * самого треугольника это не задание, а загадка. Картинки лежат в самом задании
 * как data:URL, поэтому показываются и без интернета.
 *
 * Через <img src>, а не вставкой SVG в разметку: инлайн чужого SVG пустил бы в
 * страницу и его скрипты, а в <img> браузер их не выполняет.
 */
export default function TaskFigures({ images }: { images?: string[] }) {
  if (!images?.length) return null
  return (
    <div className="task-figs">
      {images.map((src, i) => (
        <img key={i} src={src} alt={'Чертёж к заданию ' + (i + 1)} loading="lazy" />
      ))}
    </div>
  )
}
