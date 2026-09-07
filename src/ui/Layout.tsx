import { NavLink, Outlet } from 'react-router-dom'
import { LayoutDashboard, CalendarDays, Library, Target, TrendingUp, MessageCircle, Settings as Cog, Trophy, AlertTriangle } from 'lucide-react'
import { useStore } from '../store'
import { computeStats } from '../lib/stats'
import UpdateBanner from './UpdateBanner'

const nav = [
  { to: '/', label: 'Главная', icon: LayoutDashboard, end: true },
  { to: '/plan', label: 'План', icon: CalendarDays },
  { to: '/materials', label: 'Материалы', icon: Library },
  { to: '/trainer', label: 'Тренажёр', icon: Target },
  { to: '/progress', label: 'Прогресс', icon: TrendingUp },
  { to: '/chat', label: 'Чат с ИИ', icon: MessageCircle },
  { to: '/settings', label: 'Настройки', icon: Cog },
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
            {n.label}
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
