import { NavLink, Outlet } from 'react-router-dom'
import { LayoutDashboard, CalendarDays, TrendingUp, MessageCircle, Settings as Cog, Trophy } from 'lucide-react'
import { useStore } from '../store'
import { computeStats } from '../lib/stats'

const nav = [
  { to: '/', label: 'Главная', icon: LayoutDashboard, end: true },
  { to: '/plan', label: 'План', icon: CalendarDays },
  { to: '/progress', label: 'Прогресс', icon: TrendingUp },
  { to: '/chat', label: 'Чат с ИИ', icon: MessageCircle },
  { to: '/settings', label: 'Настройки', icon: Cog },
]

export default function Layout() {
  const data = useStore((s) => s.data)
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
          Учись в удовольствие. План — от твоего ИИ, всё остальное — тут.
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  )
}
