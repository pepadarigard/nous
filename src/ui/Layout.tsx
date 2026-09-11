import { NavLink, Outlet } from 'react-router-dom'
import { LayoutDashboard, CalendarDays, Library, Target, BookOpen, TrendingUp, MessageCircle, Settings as Cog, Trophy, AlertTriangle } from 'lucide-react'
import { useStore } from '../store'
import { computeStats } from '../lib/stats'
import UpdateBanner from './UpdateBanner'

// Подпись у пункта две: полная для бокового меню и короткая для нижней панели
// на телефоне. Девять полных названий в 375 точек не помещаются, панель
// начинает прокручиваться — а прокрутку внизу экрана человек просто не
// замечает, и половина разделов для него исчезает.
const nav = [
  { to: '/', label: 'Главная', short: 'Главная', icon: LayoutDashboard, end: true },
  { to: '/plan', label: 'План', short: 'План', icon: CalendarDays },
  { to: '/materials', label: 'Материалы', short: 'Файлы', icon: Library },
  { to: '/trainer', label: 'Тренажёр', short: 'Решать', icon: Target },
  { to: '/reference', label: 'Справочник', short: 'Справка', icon: BookOpen },
  { to: '/progress', label: 'Прогресс', short: 'Прогресс', icon: TrendingUp },
  { to: '/chat', label: 'Чат с ИИ', short: 'Чат', icon: MessageCircle },
  { to: '/settings', label: 'Настройки', short: 'Ещё', icon: Cog },
]

export default function Layout() {
  const data = useStore((s) => s.data)
  const saveError = useStore((s) => s.saveError)
  const st = computeStats(data)

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="logo">ν</div>
          <span>Nous</span>
        </div>
        {nav.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}>
            <n.icon />
            <span className="nav-full">{n.label}</span>
            <span className="nav-short">{n.short}</span>
          </NavLink>
        ))}
        <NavLink to="/progress" className="side-level" title="Открыть прогресс">
          <div className="sl-top">
            <Trophy size={14} />
            <span>Ур. {st.level.level} · {st.level.title}</span>
            <span className="sl-xp">{st.xp} XP</span>
          </div>
          <div className="sl-bar"><span style={{ width: `${st.level.pct}%` }} /></div>
        </NavLink>
        <div className="sidebar-foot">
          Учись в удовольствие. План, задания и повторение работают без интернета.
        </div>
      </aside>
      <main className="main">
        {/* Сбой записи нельзя оставлять в консоли: без этой полосы ученик узнал бы
            о потере работы только при следующем запуске. */}
        {saveError && (
          <div className="save-warn">
            <AlertTriangle size={16} />
            <div>
              <b>Не удаётся сохранить</b> — сделанное сейчас может пропасть при перезапуске.
              <div className="small">{saveError}</div>
            </div>
          </div>
        )}
        <UpdateBanner />
        <Outlet />
      </main>
    </div>
  )
}
