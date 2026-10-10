// Ghost Drop, played over the island. The game comes from Game Studio (ghostdrop_game.js,
// bundled by tools/bundle_ghostdrop.py) and runs in a sandboxed frame with the studio's
// helper (kart_runtime.js, shared with Möbius Kart). This component is the bridge: the
// drop's shared state (world.gd) goes into the game, and the game's steps, falls, start
// and position reports go out as session actions. The host keeps the round.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { buildGameDocument } from '../kart_runtime.js'
import { GHOSTDROP_HTML } from '../ghostdrop_game.js'
import GHOSTS from '../models_ghosts.js'

const MODELS = Object.fromEntries(Object.entries(GHOSTS).map(([name, glb]) => [`wg_${name}`, glb]))
const SAVES = 'ghostdrop-saves.json'

// The real players in this drop, you first: their outfits dress their ghosts.
export function dropRoster(players, round, you) {
  const ids = new Set(round?.order || [])
  ids.add(you)
  return players
    .filter((p) => ids.has(p.pid))
    .sort((a, b) => (a.pid === you ? -1 : b.pid === you ? 1 : 0))
    .slice(0, 8)
    .map((p) => ({ pid: p.pid, name: p.name, color: p.color, face: p.face, hat: p.hat, neck: p.neck, hold: p.hold }))
}

export default function GhostDrop({ players, round, you, serverNow, send, sendLatest, onClose }) {
  const frameRef = useRef(null)
  const [saves, setSaves] = useState(null)
  const [error, setError] = useState('')
  // A bot plays your ghost once you left a started drop: open it again and you watch, as
  // someone not in the drop would (the game only plays the ghost whose id it is given).
  const leftAtOpen = useRef(!!round?.racers?.[you]?.bot)
  const gameYou = leftAtOpen.current ? `${you}:watching` : you
  const roster = dropRoster(players, round, you)
  const latest = useRef({ roster, round, you: gameYou })
  latest.current = { roster, round, you: gameYou }

  useEffect(() => {
    let alive = true
    Promise.resolve(window.mobius?.storage?.get(SAVES)).catch(() => null)
      .then((value) => { if (alive) setSaves(value && typeof value === 'object' ? value : {}) })
    return () => { alive = false }
  }, [])

  // built once: the frame must not reload when the drop changes
  const srcDoc = useMemo(() => {
    if (!saves) return null
    return buildGameDocument(GHOSTDROP_HTML, { saves, art: { models: MODELS } })
  }, [saves])

  const post = () => frameRef.current?.contentWindow?.postMessage({
    type: 'ghostdrop:round', live: true, you: latest.current.you, now: serverNow(),
    round: latest.current.round, roster: latest.current.roster,
  }, '*')
  // every snapshot brings the drop's latest state: pass it on
  useEffect(post, [round, players]) // eslint-disable-line react-hooks/exhaustive-deps
  // the host handed your ghost to a bot while this was open (the tab slept too long): you left
  useEffect(() => { if (!leftAtOpen.current && round?.racers?.[you]?.bot) onClose() }, [round, you, onClose])

  useEffect(() => {
    function onMessage(event) {
      if (!frameRef.current || event.source !== frameRef.current.contentWindow) return
      const msg = event.data || {}
      if (msg.type === 'ghostdrop:ready') post()
      else if (msg.type === 'ghostdrop:go') send({ t: 'gd_go' })
      else if (msg.type === 'ghostdrop:step') send({ t: 'gd_step', tile: msg.tile })
      else if (msg.type === 'ghostdrop:out') send({ t: 'gd_out', y: msg.y, at: msg.at })
      else if (msg.type === 'ghostdrop:pos') sendLatest({ t: 'gd_pos', x: msg.x, y: msg.y, z: msg.z, r: msg.r })
      else if (msg.type === 'ghostdrop:close') onClose()
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

  // leaving a drop you are in frees your place (in the lobby) or hands your ghost to a bot
  // (mid-drop, a bot takes your ghost on from there)
  useEffect(() => () => {
    const now = latest.current.round
    const mine = now?.racers?.[you]
    if (mine && !mine.bot && mine.out_at == null && now.state !== 'done') send({ t: 'gd_leave' })
  }, [you, send])

  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="mw-kart mw-ghostdrop" role="dialog" aria-label="Ghost Drop">
      {srcDoc
        ? <iframe ref={frameRef} title="Ghost Drop" sandbox="allow-scripts allow-pointer-lock" allow="fullscreen *; gamepad *; autoplay *"
            srcDoc={srcDoc} onLoad={() => frameRef.current?.contentWindow?.focus()} />
        : <div className="mw-status">Dropping the ghosts in…</div>}
      <button type="button" className="mw-btn small mw-kart-close" onClick={onClose}>← Back to the island</button>
      {error && <div className="mw-status" role="alert">The drop hit a problem: {error.slice(0, 140)}</div>}
    </div>
  )
}
