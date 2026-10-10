// Möbius Kart, raced live over the island. The game comes from Game Studio
// (kart_game.js, bundled by tools/bundle_kart.py) and runs in a sandboxed frame
// with the studio's helper (kart_runtime.js). This component is the bridge:
// the session's shared race (world.race) goes into the game, and the game's
// position reports, start and finish go out as session actions. Everyone
// drives their own copy; other real players' karts follow their reports.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { buildGameDocument } from '../kart_runtime.js'
import { KART_HTML } from '../kart_game.js'
import GHOSTS from '../models_ghosts.js'
import { LOGO } from '../models.js'

const MODELS = Object.fromEntries(Object.entries(GHOSTS).map(([name, glb]) => [`wg_${name}`, glb]))
const SAVES = 'kart-saves.json'

// The real racers in this race as game drivers (you flagged), you first.
export function raceRoster(players, race, you) {
  const ids = new Set(Object.keys(race?.racers || {}))
  ids.add(you)
  return players
    .filter((p) => ids.has(p.pid))
    .sort((a, b) => (a.pid === you ? -1 : b.pid === you ? 1 : 0))
    .slice(0, 8)
    .map((p) => ({ pid: p.pid, name: p.name, color: p.color, face: p.face, hat: p.hat, neck: p.neck, hold: p.hold, you: p.pid === you }))
}

export default function KartRace({ players, race, you, serverNow, send, sendLatest, onClose }) {
  const frameRef = useRef(null)
  const [saves, setSaves] = useState(null)
  const [error, setError] = useState('')
  const roster = raceRoster(players, race, you)
  const latest = useRef({ roster, race })
  latest.current = { roster, race }

  useEffect(() => {
    let alive = true
    Promise.resolve(window.mobius?.storage?.get(SAVES)).catch(() => null)
      .then((value) => { if (alive) setSaves(value && typeof value === 'object' ? value : {}) })
    return () => { alive = false }
  }, [])

  const srcDoc = useMemo(() => {
    if (!saves) return null
    const safe = (v) => JSON.stringify(v).replace(/</g, '\\u003c')
    const head = `<script>window.MOBIUS_KART_LIVE = ${safe({ you })}; window.MOBIUS_KART_RACERS = ${safe(latest.current.roster)}</script>`
    const html = KART_HTML.replace('<script type="module">', () => `${head}<script type="module">`)
    return buildGameDocument(html, { saves, art: { images: { mobius_logo: { dataUrl: LOGO } }, models: MODELS } })
  }, [saves, you])

  const post = () => frameRef.current?.contentWindow?.postMessage({
    type: 'mobius-kart:race', racers: latest.current.roster, race: latest.current.race, now: serverNow(),
  }, '*')
  // every snapshot brings the latest reports: pass them on
  useEffect(post, [race]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    function onMessage(event) {
      if (!frameRef.current || event.source !== frameRef.current.contentWindow) return
      const msg = event.data || {}
      if (msg.type === 'mobius-kart:ready') post()
      else if (msg.type === 'mobius-kart:go') send({ t: 'race_go' })
      else if (msg.type === 'mobius-kart:state') sendLatest({ t: 'race_state', p: msg.p, d: msg.d, v: msg.v, s: msg.s })
      else if (msg.type === 'mobius-kart:finish') send({ t: 'race_finish', time: msg.time })
      else if (msg.type === 'mobius-kart:item') send({ t: 'race_item', kind: msg.kind, p: msg.p, d: msg.d, target: msg.target ?? null })
      else if (msg.type === 'mobius-kart:itemgone') send({ t: 'race_item_gone', id: msg.id })
      else if (msg.type === 'mobius-kart:close') onClose()
      else if (msg.type === 'studio:save' && typeof msg.key === 'string') {
        setSaves((prev) => {
          const next = { ...(prev || {}), [msg.key]: msg.value }
          window.mobius?.storage?.set(SAVES, next).catch(() => {})
          return next
        })
      } else if (msg.type === 'studio:error') setError(String(msg.message || 'Something went wrong'))
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [send, sendLatest, onClose]) // eslint-disable-line react-hooks/exhaustive-deps

  // leaving an unfinished race frees your place in the lobby, or hands your kart to a bot mid-race
  useEffect(() => () => {
    const mine = latest.current.race?.racers?.[you]
    if (mine && !mine.done && !mine.bot) send({ t: 'race_leave' })
  }, [you, send])
  // the host handed your kart to a bot while this was open (the tab slept too long): you left
  const leftAtOpen = useRef(!!race?.racers?.[you]?.bot)
  useEffect(() => { if (!leftAtOpen.current && race?.racers?.[you]?.bot) onClose() }, [race, you, onClose])

  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="mw-kart" role="dialog" aria-label="Möbius Kart race">
      {srcDoc
        ? <iframe ref={frameRef} title="Möbius Kart" sandbox="allow-scripts allow-pointer-lock" allow="fullscreen *; gamepad *; autoplay *"
            srcDoc={srcDoc} onLoad={() => frameRef.current?.contentWindow?.focus()} />
        : <div className="mw-status">Rolling the karts out…</div>}
      <button type="button" className="mw-btn small mw-kart-close" onClick={onClose}>← Back to the island</button>
      {error && <div className="mw-status" role="alert">The race hit a problem: {error.slice(0, 140)}</div>}
    </div>
  )
}
