// Приятные синтезированные звуки (без файлов) через WebAudio. Играют только на редких событиях.

let ctx: AudioContext | null = null

function ac(): AudioContext | null {
  try {
    if (!ctx) ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
    if (ctx.state === 'suspended') ctx.resume()
    return ctx
  } catch {
    return null
  }
}

function tone(freq: number, start: number, dur: number, gain = 0.14, type: OscillatorType = 'triangle') {
  const c = ac()
  if (!c) return
  const o = c.createOscillator()
  const g = c.createGain()
  o.type = type
  o.frequency.value = freq
  o.connect(g)
  g.connect(c.destination)
  const t0 = c.currentTime + start
  g.gain.setValueAtTime(0, t0)
  g.gain.linearRampToValueAtTime(gain, t0 + 0.02)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  o.start(t0)
  o.stop(t0 + dur + 0.03)
}

// Восходящее арпеджио C-E-G-C (мажор) — «уровень взят!».
export function playLevelUp() {
  tone(523.25, 0, 0.18)
  tone(659.25, 0.11, 0.18)
  tone(783.99, 0.22, 0.22)
  tone(1046.5, 0.33, 0.4)
}

// Мягкий двойной колокольчик — «достижение».
export function playAchievement() {
  tone(783.99, 0, 0.16, 0.11)
  tone(1046.5, 0.09, 0.3, 0.11)
}
