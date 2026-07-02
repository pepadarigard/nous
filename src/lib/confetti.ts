// Лёгкое конфетти на canvas, без зависимостей. Само создаёт и убирает слой.

interface Cannon {
  x: number
  y: number
  angle: number // радианы, -PI/2 = вверх
  spread: number
  count: number
  power: number
}

interface Part {
  x: number; y: number; vx: number; vy: number
  size: number; color: string; rot: number; vr: number; life: number
}

const COLORS = ['#0d9488', '#14b8a6', '#5eead4', '#fbbf24', '#f472b6', '#60a5fa', '#34d399', '#a78bfa']

function burst(cannons: Cannon[]) {
  if (typeof document === 'undefined') return
  const canvas = document.createElement('canvas')
  canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:10000'
  document.body.appendChild(canvas)
  const ctx = canvas.getContext('2d')
  if (!ctx) { canvas.remove(); return }
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const W = window.innerWidth
  const H = window.innerHeight
  canvas.width = W * dpr
  canvas.height = H * dpr
  ctx.scale(dpr, dpr)

  const parts: Part[] = []
  for (const c of cannons) {
    for (let i = 0; i < c.count; i++) {
      const a = c.angle + (Math.random() - 0.5) * c.spread
      const sp = (5 + Math.random() * 7) * c.power
      parts.push({
        x: c.x, y: c.y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        size: 5 + Math.random() * 7,
        color: COLORS[(Math.random() * COLORS.length) | 0],
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.35,
        life: 1,
      })
    }
  }

  const start = performance.now()
  let raf = 0
  function frame(now: number) {
    const t = now - start
    ctx!.clearRect(0, 0, W, H)
    let alive = false
    for (const p of parts) {
      p.vy += 0.22 // гравитация
      p.vx *= 0.99
      p.x += p.vx
      p.y += p.vy
      p.rot += p.vr
      if (t > 1500) p.life -= 0.02
      if (p.life > 0 && p.y < H + 40) {
        alive = true
        ctx!.save()
        ctx!.globalAlpha = Math.max(0, p.life)
        ctx!.translate(p.x, p.y)
        ctx!.rotate(p.rot)
        ctx!.fillStyle = p.color
        ctx!.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.62)
        ctx!.restore()
      }
    }
    if (alive && t < 4500) raf = requestAnimationFrame(frame)
    else { cancelAnimationFrame(raf); canvas.remove() }
  }
  raf = requestAnimationFrame(frame)
}

// Большой салют: две «пушки» снизу по краям к центру.
export function confettiBig() {
  const W = window.innerWidth
  const H = window.innerHeight
  burst([
    { x: W * 0.1, y: H * 0.88, angle: -Math.PI / 3, spread: 0.7, count: 90, power: 1.35 },
    { x: W * 0.9, y: H * 0.88, angle: (-Math.PI * 2) / 3, spread: 0.7, count: 90, power: 1.35 },
  ])
}

// Небольшой всплеск из точки (доли экрана 0..1).
export function confettiSmall(x = 0.5, y = 0.3) {
  const W = window.innerWidth
  const H = window.innerHeight
  burst([{ x: W * x, y: H * y, angle: -Math.PI / 2, spread: 1.7, count: 50, power: 1 }])
}
