import { NavLink, Outlet } from 'react-router-dom'
import { LayoutDashboard, CalendarDays, TrendingUp, MessageCircle, Settings as Cog } from 'lucide-react'

const nav = [
  { to: '/', label: 'Главная', icon: LayoutDashboard, end: true },
  { to: '/plan', label: 'План', icon: CalendarDays },
  { to: '/progress', label: 'Прогресс', icon: TrendingUp },
  { to: '/chat', label: 'Чат с ИИ', icon: MessageCircle },
  { to: '/settings', label: 'Настройки', icon: Cog },
]

export default function Layout() {
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="logo">🎓</div>
          <span>Nous</span>
        </div>
        {nav.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}>
            <n.icon />
            {n.label}
          </NavLink>
        ))}
        <div className="sidebar-foot">
          Локальный помощник для подготовки к ЕГЭ.
          <br />
          План — от твоего ИИ, раскладка — тут.
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  )
}
