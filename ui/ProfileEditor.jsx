import React, { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import * as api from '../api.js'
import { MERCH, OPTION_LABELS, SLOTS, loadLibrary, makeGhost, portrait } from '../ghost3d.js'

// A live 3D ghost that turns slowly; drag to spin it.
export function GhostPreview({ profile, size = 220 }) {
  const mountRef = useRef(null)
  const ghostRef = useRef(null)
  const profileRef = useRef(profile)
  profileRef.current = profile
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let disposed = false
    let frame = 0
    let renderer
    const mount = mountRef.current
    const drag = { active: false, x: 0, spin: 0 }
    ;(async () => {
      let lib
      try { lib = await loadLibrary() } catch { setFailed(true); return }
      if (disposed) return
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
      renderer.outputColorSpace = THREE.SRGBColorSpace
      renderer.setSize(size, size)
      mount.appendChild(renderer.domElement)
      const scene = new THREE.Scene()
      scene.add(new THREE.HemisphereLight('#ffffff', '#b9a8d8', 2.1))
      const sun = new THREE.DirectionalLight('#ffffff', 1.7)
      sun.position.set(2, 4, 5)
      scene.add(sun)
      const floor = new THREE.Mesh(new THREE.CircleGeometry(0.55, 32), new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.12 }))
      floor.rotation.x = -Math.PI / 2
      scene.add(floor)
      const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 20)
      camera.position.set(0, 1.0, 2.9)
      camera.lookAt(0, 0.7, 0)
      const ghost = makeGhost(lib)
      ghostRef.current = ghost
      ghost.update(profileRef.current)
      scene.add(ghost.root)
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      let key = ''
      const el = renderer.domElement
      el.style.touchAction = 'none'
      el.style.cursor = 'grab'
      el.addEventListener('pointerdown', (e) => { drag.active = true; drag.x = e.clientX; el.setPointerCapture?.(e.pointerId) })
      el.addEventListener('pointermove', (e) => { if (drag.active) { drag.spin += (e.clientX - drag.x) * 0.012; drag.x = e.clientX } })
      el.addEventListener('pointerup', () => { drag.active = false })
      const tick = (t) => {
        frame = requestAnimationFrame(tick)
        const p = profileRef.current
        const k = [p.color, ...SLOTS.map((s) => p[s])].join('|')
        if (k !== key) { ghost.update(p); key = k }
        ghost.root.rotation.y = drag.spin + (reduce || drag.active ? 0 : Math.sin(t / 1800) * 0.5)
        ghost.root.position.y = 0.12 + (reduce ? 0 : Math.sin(t / 520) * 0.05)
        renderer.render(scene, camera)
      }
      frame = requestAnimationFrame(tick)
    })()
    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      renderer?.dispose()
      renderer?.domElement.remove()
    }
  }, [size])

  return (
    <div ref={mountRef} className="mw-ghost-preview" style={{ width: size, height: size }}
      role="img" aria-label={`${profile.name || 'Your'} ghost`}>
      {failed && <span className="mw-small mw-muted">3D preview unavailable</span>}
    </div>
  )
}

// A still portrait of someone's ghost, rendered from the same 3D models.
export function GhostPortrait({ profile, size = 44 }) {
  const [src, setSrc] = useState(null)
  const key = [profile.color, profile.face, profile.hat, profile.neck, profile.hold].join('|')
  useEffect(() => {
    let alive = true
    portrait(profile, 160).then((canvas) => { if (alive) setSrc(canvas.toDataURL()) }).catch(() => {})
    return () => { alive = false }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  return src
    ? <img src={src} width={size} height={size} alt="" style={{ display: 'block' }} />
    : <span style={{ display: 'block', width: size * 0.6, height: size * 0.6, borderRadius: '50%', background: profile.color || '#c8cdd6' }} />
}

const TAB_LABELS = { color: 'Colour', face: 'Face', hat: 'Hat', neck: 'Neck', hold: 'Hold' }

export default function ProfileEditor({ me, onSaved, first = false, onCancel }) {
  const [draft, setDraft] = useState({ ...me.profile, name: first ? '' : me.profile.name })
  const [tab, setTab] = useState('color')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const options = me.outfit || {}

  async function save(event) {
    event.preventDefault()
    if (!draft.name.trim()) { setError('Pick a name people will see.'); return }
    setSaving(true); setError('')
    try {
      const { profile } = await api.saveMe(draft)
      window.mobius?.signal?.('outfit_saved', { hat: profile.hat, neck: profile.neck, hold: profile.hold, face: profile.face })
      onSaved(profile)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  function surprise() {
    const pick = (list) => list[Math.floor(Math.random() * list.length)]
    const next = { ...draft, color: pick(me.colors) }
    for (const slot of SLOTS) if (options[slot]) next[slot] = pick(options[slot])
    setDraft(next)
  }

  return (
    <form className="mw-card mw-profile" onSubmit={save}>
      <div className="mw-preview-col">
        <GhostPreview profile={{ ...draft, name: draft.name || 'You' }} />
        <button type="button" className="mw-btn small ghost" onClick={surprise}>Surprise me</button>
      </div>
      <div>
        <label className="mw-small mw-muted" htmlFor="mw-name">Name</label>
        <input id="mw-name" className="mw-input" maxLength={24} value={draft.name}
          placeholder="What should people call you?" autoComplete="nickname"
          onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        <div className="mw-tabs" role="tablist" aria-label="Customize">
          {['color', ...SLOTS].map((t) => (
            <button type="button" key={t} role="tab" aria-selected={tab === t} className="mw-tab" onClick={() => setTab(t)}>
              {TAB_LABELS[t]}
            </button>
          ))}
        </div>
        {tab === 'color' ? (
          <div className="mw-swatches" role="group" aria-label="Colour">
            {me.colors.map((c) => (
              <button type="button" key={c} className="mw-swatch" style={{ background: c }}
                aria-label={`Colour ${c}`} aria-pressed={draft.color === c}
                onClick={() => setDraft({ ...draft, color: c })} />
            ))}
          </div>
        ) : (
          <div className="mw-chips" role="group" aria-label={TAB_LABELS[tab]}>
            {(options[tab] || []).map((value) => (
              <button type="button" key={value} className="mw-chip" aria-pressed={draft[tab] === value}
                onClick={() => setDraft({ ...draft, [tab]: value })}>
                {OPTION_LABELS[tab]?.[value] || value}
                {MERCH.has(value) && <span className="mw-merch">Möbius</span>}
              </button>
            ))}
          </div>
        )}
        {error && <div className="mw-error">{error}</div>}
        <div className="mw-row" style={{ marginTop: 16 }}>
          <button className="mw-btn primary" disabled={saving}>{first ? 'Enter Worlds' : 'Save look'}</button>
          {onCancel && <button type="button" className="mw-btn ghost" onClick={onCancel}>Cancel</button>}
        </div>
      </div>
    </form>
  )
}
