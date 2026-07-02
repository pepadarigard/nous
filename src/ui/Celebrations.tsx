import { useEffect } from 'react'
import { useStore } from '../store'
import type { Celebration } from '../lib/stats'
import { confettiBig, confettiSmall } from '../lib/confetti'
import { playLevelUp, playAchievement } from '../lib/sound'

// Глобальный слой праздников: тосты «+XP» и достижений + окно нового уровня с конфетти/звуком.
export default function Celebrations() {
  const celebs = useStore((s) => s.celebrations)
  const dismiss = useStore((s) => s.dismissCelebration)
  const soundOn = useStore((s) => s.data.config.soundOn !== false)

  const level = celebs.find((c) => c.kind === 'level') as Extract<Celebration, { kind: 'level' }> | undefined
  const toasts = celebs.filter((c) => c.kind !== 'level')

  return (
    <>
      <div className="toast-stack">
        {toasts.map((c) => (
          <Toast key={c.id} c={c} soundOn={soundOn} onDone={() => dismiss(c.id)} />
        ))}
      </div>
      {level && <LevelModal key={level.id} c={level} soundOn={soundOn} onClose={() => dismiss(level.id)} />}
    </>
  )
}

function Toast({ c, soundOn, onDone }: { c: Celebration; soundOn: boolean; onDone: () => void }) {
  useEffect(() => {
    if (c.kind === 'achievement') {
      confettiSmall(0.5, 0.18)
      if (soundOn) playAchievement()
    }
    const ms = c.kind === 'xp' ? 1700 : 3800
    const t = setTimeout(onDone, ms)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (c.kind === 'xp') {
    return (
      <div className="toast toast-xp pop-in">
        <span className="toast-xp-num">+{c.xp}</span> XP <span className="toast-xp-emoji">💪</span>
      </div>
    )
  }
  if (c.kind === 'achievement') {
    return (
      <div className="toast toast-ach pop-in">
        <div className="toast-ach-ic">{c.icon}</div>
        <div>
          <div className="toast-ach-k">Достижение получено!</div>
          <div className="toast-ach-t">{c.title}</div>
        </div>
      </div>
    )
  }
  return null
}

function LevelModal({ c, soundOn, onClose }: { c: Extract<Celebration, { kind: 'level' }>; soundOn: boolean; onClose: () => void }) {
  useEffect(() => {
    confettiBig()
    if (soundOn) playLevelUp()
    const t = setTimeout(onClose, 6500)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="celebrate-overlay" onClick={onClose}>
      <div className="celebrate-card pop-big" onClick={(e) => e.stopPropagation()}>
        <div className="celebrate-rays" />
        <div className="celebrate-badge">{c.level}</div>
        <div className="celebrate-kicker">Новый уровень!</div>
        <div className="celebrate-title">{c.title}</div>
        <div className="celebrate-sub">Уровень {c.level} · ты стал лучше 🚀</div>
        <button className="btn btn-primary btn-lg" onClick={onClose}>Круто! 🎉</button>
      </div>
    </div>
  )
}
