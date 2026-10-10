// Worlds avatars: soft round critters drawn on canvas, shared by the plaza,
// the lobby preview and both games so a person looks the same everywhere.

export const EMOTE_GLYPHS = {
  wave: '👋', heart: '❤️', laugh: '😂', wow: '😮', dance: '💃', sleep: '💤',
}

function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16)
  const clamp = (v) => Math.max(0, Math.min(255, v))
  const r = clamp((n >> 16) + amount)
  const g = clamp(((n >> 8) & 255) + amount)
  const b = clamp((n & 255) + amount)
  return `rgb(${r},${g},${b})`
}

// A 2D ghost in the style of the Hackaton Rewards pals, floating above (x, y).
// `s` is roughly its radius. Used where a live 3D ghost would be overkill.
export function drawAvatar(ctx, x, y, s, opts = {}) {
  const { color = '#c8cdd6', facing = 1, walking = false, t = 0, away = false, face = 'dots' } = opts
  const float = Math.sin(t / 520) * s * 0.08
  ctx.save()
  ctx.translate(x, y)
  ctx.fillStyle = 'rgba(0,0,0,0.16)'
  ctx.beginPath(); ctx.ellipse(0, 0, s * 0.62 * (1 - float / s), s * 0.18, 0, 0, Math.PI * 2); ctx.fill()
  ctx.translate(0, -s * 0.35 + float)
  if (walking) ctx.rotate(Math.sin(t / 160) * 0.06)
  ctx.globalAlpha = away ? 0.5 : 0.96
  const grad = ctx.createLinearGradient(-s, -s * 1.6, s, 0)
  grad.addColorStop(0, shade(color, 38))
  grad.addColorStop(1, shade(color, -22))
  ctx.fillStyle = grad
  // body: dome, straight-ish sides, five scallops at the hem
  const w = s * 0.78
  const top = -s * 1.7
  ctx.beginPath()
  ctx.moveTo(-w, -s * 0.1)
  ctx.lineTo(-w, top + w)
  ctx.arc(0, top + w, w, Math.PI, 0)
  ctx.lineTo(w, -s * 0.1)
  const lobes = 5
  for (let i = 0; i < lobes; i++) {
    const x0 = w - (2 * w * i) / lobes
    const x1 = w - (2 * w * (i + 1)) / lobes
    ctx.quadraticCurveTo((x0 + x1) / 2, i % 2 ? -s * 0.28 : s * 0.12, x1, -s * 0.1)
  }
  ctx.closePath()
  ctx.fill()
  // arms
  for (const side of [-1, 1]) {
    ctx.beginPath(); ctx.ellipse(side * w * 1.06, -s * 0.72, s * 0.2, s * 0.13, side * -0.5, 0, Math.PI * 2); ctx.fill()
  }
  // sheen
  ctx.fillStyle = 'rgba(255,255,255,0.45)'
  ctx.beginPath(); ctx.ellipse(-w * 0.45, top + w * 0.55, s * 0.1, s * 0.18, -0.4, 0, Math.PI * 2); ctx.fill()
  ctx.globalAlpha = 1
  // face
  const look = facing * s * 0.08
  const ey = top + w * 0.95
  if (face === 'mystery') {
    ctx.fillStyle = '#fff'; ctx.font = `800 ${s * 0.9}px system-ui, sans-serif`
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('?', look, ey + s * 0.1)
  } else {
    ctx.fillStyle = '#2b2f3a'
    for (const ex of [-0.28, 0.28]) {
      ctx.beginPath(); ctx.ellipse(ex * s + look, ey, s * 0.07, s * 0.11, 0, 0, Math.PI * 2); ctx.fill()
    }
    ctx.fillStyle = 'rgba(255,140,165,0.55)'
    for (const ex of [-0.48, 0.48]) {
      ctx.beginPath(); ctx.ellipse(ex * s + look, ey + s * 0.2, s * 0.09, s * 0.05, 0, 0, Math.PI * 2); ctx.fill()
    }
    ctx.strokeStyle = '#2b2f3a'; ctx.lineWidth = Math.max(1.2, s * 0.05); ctx.lineCap = 'round'
    ctx.beginPath(); ctx.arc(look, ey + s * 0.12, s * 0.1, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke()
  }
  ctx.restore()
}

export function drawNameTag(ctx, x, y, text, { host = false, scale = 1 } = {}) {
  ctx.save()
  ctx.font = `600 ${12 * scale}px system-ui, sans-serif`
  const label = text
  const w = ctx.measureText(label).width + 12 * scale
  const h = 18 * scale
  ctx.fillStyle = host ? 'rgba(214,150,10,0.92)' : 'rgba(20,24,36,0.72)'
  roundRect(ctx, x - w / 2, y, w, h, h / 2); ctx.fill()
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText(label, x, y + h / 2 + 0.5)
  ctx.restore()
}

export function drawBubble(ctx, x, y, text, { scale = 1, alpha = 1 } = {}) {
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.font = `500 ${13 * scale}px system-ui, sans-serif`
  const words = text.split(' ')
  const lines = []
  let line = ''
  const maxW = 170 * scale
  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (ctx.measureText(next).width > maxW && line) { lines.push(line); line = word } else line = next
  }
  if (line) lines.push(line)
  const shown = lines.slice(0, 3)
  const lh = 16 * scale
  const w = Math.min(maxW, Math.max(...shown.map((l) => ctx.measureText(l).width))) + 16 * scale
  const h = shown.length * lh + 10 * scale
  const bx = x - w / 2
  const by = y - h - 8 * scale
  ctx.fillStyle = '#fff'
  ctx.shadowColor = 'rgba(0,0,0,0.18)'; ctx.shadowBlur = 6 * scale; ctx.shadowOffsetY = 2 * scale
  roundRect(ctx, bx, by, w, h, 10 * scale); ctx.fill()
  ctx.shadowColor = 'transparent'
  ctx.beginPath(); ctx.moveTo(x - 6 * scale, by + h - 1); ctx.lineTo(x, by + h + 7 * scale); ctx.lineTo(x + 6 * scale, by + h - 1); ctx.fill()
  ctx.fillStyle = '#1f2430'; ctx.textAlign = 'center'; ctx.textBaseline = 'top'
  shown.forEach((l, i) => ctx.fillText(l, x, by + 5 * scale + i * lh))
  ctx.restore()
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}
