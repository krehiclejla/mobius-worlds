import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowUp, Copy, X } from '@openai/apps-sdk-ui/components/Icon'
import * as api from '../api.js'
import { EMOTE_GLYPHS } from '../avatar.js'
import LobbyWorld from './LobbyWorld.jsx'
import KartCard, { RaceResults } from './KartCard.jsx'
import StoreCard, { DisplayCard } from './StoreCard.jsx'
import KartRace from './KartRace.jsx'
import GhostDropCard from './GhostDropCard.jsx'
import GhostDrop from './GhostDrop.jsx'

const HOST_MIN_GAP = 500
// A guest's discrete actions (a chat line, a Ghost Drop step, a race finish) may go
// out early, after half the host's cadence, while the last minute's requests stay
// within 1.1x of it: the host budgets 90% of the public door's allowance.
const GUEST_EARLY_SHARE = 0.5
const GUEST_EARLY_ALLOWANCE = 1.1

// One coalesced request per tick: queued actions go up, a snapshot comes down.
// The host decides the cadence (poll_ms) so remote guests stay in budget.
function useRoomSync(session, onEnded, ownOrigin) {
  const [snap, setSnap] = useState(null)
  const [status, setStatus] = useState('connecting')
  const snapRef = useRef(null)
  const pending = useRef([])
  const since = useRef(0)
  const offset = useRef(0)
  const listeners = useRef(new Set())
  const wake = useRef(null)
  const lastRequest = useRef(0)
  const recent = useRef([]) // this minute's request times, for a guest's early sends

  const serverNow = useCallback(() => Date.now() + offset.current, [])

  const send = useCallback((action) => {
    pending.current.push(action)
    wake.current?.(false)
  }, [])
  // Frequent reports (a kart's position): only the newest one waits for the next sync.
  const sendLatest = useCallback((action) => {
    pending.current = pending.current.filter((a) => a.t !== action.t)
    pending.current.push(action)
  }, [])

  useEffect(() => {
    let alive = true
    let failures = 0
    let local = false
    async function tick() {
      const actions = pending.current.splice(0)
      const sentAt = Date.now()
      lastRequest.current = sentAt
      recent.current = [...recent.current.filter((t) => t > sentAt - 60000), sentAt]
      try {
        const next = await api.sync({ origin: session.origin, code: session.code, since: since.current, actions })
        if (!alive) return 0
        if (next.throttled) { setStatus('busy'); return next.poll_ms }
        failures = 0
        const rtt = Date.now() - sentAt
        offset.current = next.now + rtt / 2 - Date.now()
        // the owner's own browser in a session on their Möbius: the private lane
        local = !api.isGuest() && next.host_origin === ownOrigin
        if (next.events?.length) {
          since.current = Math.max(since.current, ...next.events.map((e) => e.seq))
          for (const fn of listeners.current) fn(next.events, next)
        }
        snapRef.current = next
        setSnap(next)
        setStatus('live')
        return document.hidden ? Math.max(next.poll_ms, 5000) : next.poll_ms
      } catch (err) {
        if (!alive) return 0
        if ([403, 404, 410].includes(err.status)) { onEnded(err.message); alive = false; return 0 }
        // Keep chat and interactions; drop stale walking targets.
        pending.current.unshift(...actions.filter((a) => a.t !== 'move' && a.t !== 'race_state'))
        failures += 1
        setStatus(err.status === 429 ? 'busy' : 'reconnecting')
        return Math.min(15000, 1500 * 2 ** Math.min(failures, 3))
      }
    }
    async function run() {
      while (alive) {
        const delay = await tick()
        if (!alive) break
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, delay)
          // The owner's private lane may flush early; a guest's actions go at most half a cadence early.
          let woken = false
          wake.current = () => {
            if (woken) return
            woken = true
            if (!local && recent.current.filter((t) => t > Date.now() - 60000).length >= (60000 / delay) * GUEST_EARLY_ALLOWANCE) return
            const minGap = local ? HOST_MIN_GAP : delay * GUEST_EARLY_SHARE
            const gap = Math.max(0, minGap - (Date.now() - lastRequest.current))
            if (gap >= delay) return
            clearTimeout(timer)
            setTimeout(resolve, gap)
          }
        })
        wake.current = null
      }
    }
    run()
    return () => { alive = false; wake.current = null }
  }, [session.origin, session.code, onEnded, ownOrigin])

  const onEvents = useCallback((fn) => {
    listeners.current.add(fn)
    return () => listeners.current.delete(fn)
  }, [])

  return { snap, snapRef, status, send, sendLatest, serverNow, onEvents }
}

function Feed({ onEvents, players }) {
  const [lines, setLines] = useState([])
  const playersRef = useRef(players)
  playersRef.current = players
  useEffect(() => onEvents((events) => {
    const fresh = events.filter((e) => ['say', 'join', 'leave', 'system', 'guessed'].includes(e.kind))
    if (!fresh.length) return
    setLines((prev) => [...prev, ...fresh].slice(-5))
  }), [onEvents])
  return (
    <div className="mw-feed" aria-live="polite">
      {lines.map((e) => {
        const who = playersRef.current[e.pid]?.name
        const cls = e.kind === 'say' ? '' : e.kind === 'guessed' ? 'good' : 'system'
        return (
          <div key={e.seq} className={`mw-feed-line ${cls}`}>
            {e.kind === 'say' ? <><b>{who || 'Someone'}:</b> {e.text}</> : e.text}
          </div>
        )
      })}
    </div>
  )
}

export default function Session({ appId, me, session, onExit }) {
  const [ended, setEnded] = useState('')
  const onEnded = useCallback((message) => setEnded(message || 'This session has ended.'), [])
  const room = useRoomSync(session, onEnded, me.origin)
  const { snap, send } = room
  const [text, setText] = useState('')
  const [showEmotes, setShowEmotes] = useState(false)
  const [copied, setCopied] = useState(false)

  const players = useMemo(() => {
    const map = {}
    for (const p of snap?.players || []) map[p.pid] = p
    return map
  }, [snap])
  // The Chat Café's private table: your seat (the host's word, from the snapshot) and who shares it.
  const mySeat = players[snap?.you]?.seat || null
  const atCafe = !!mySeat && mySeat.startsWith('cafe:')
  const tablemate = atCafe ? (snap.players.find((p) => p.pid !== snap.you && (p.seat || '').startsWith('cafe:')) || null) : null

  const isHost = !!players[snap?.you]?.is_host
  const invite = session.invite || `${session.origin.replace(/^https?:\/\//, '')}/${session.code}`
  const [card, setCard] = useState(null) // 'kart' | 'store' | 'ghostdrop' | null
  const [near, setNear] = useState(null) // the stand you're standing by: 'kart' | 'store' | 'ghostdrop' | null
  const [racing, setRacing] = useState(false)
  const [dropping, setDropping] = useState(false) // a Ghost Drop frame is open (joined or watching)
  const openKart = useCallback(() => setCard('kart'), [])
  // The App Store stands install into your own Möbius, which a public-link guest doesn't have.
  const guest = api.isGuest()
  const openStore = useCallback(() => { if (!guest) setCard('store') }, [guest])
  // Boba tea at the juice stand: one sip every couple of seconds at most.
  const [sips, setSips] = useState(0)
  const lastSip = useRef(0)
  const drinkBoba = useCallback(() => {
    if (Date.now() - lastSip.current < 2000) return
    lastSip.current = Date.now()
    setSips((n) => n + 1)
    send({ t: 'emote', e: 'boba' })
  }, [send])
  // A firework show from the DJ set is announced to the island, so everyone there can watch.
  const shareFireworks = useCallback(() => send({ t: 'emote', e: 'fireworks' }), [send])
  const endRace = useCallback(() => setRacing(false), [])
  const endDrop = useCallback(() => setDropping(false), [])
  const openGhostDropCard = useCallback(() => setCard('ghostdrop'), [])
  // Jump in while the drop is open for joining; once it is on, you watch from the island's frame.
  const openGhostDrop = useCallback(() => {
    const gd = snap?.world?.gd
    if (!gd || gd.state === 'lobby' || gd.state === 'done') send({ t: 'gd_join' })
    setCard(null)
    setDropping(true)
  }, [snap, send])
  function joinRace() {
    send({ t: 'race_join' })
    setCard(null)
    setRacing(true)
  }

  function say(event) {
    event.preventDefault()
    const value = text.trim()
    if (!value) return
    send({ t: 'say', text: value })
    setText('')
  }

  async function copyInvite() {
    const ok = await window.mobius?.clipboard?.writeText(invite)
    setCopied(!!ok)
    setTimeout(() => setCopied(false), 1600)
  }

  async function leave(close = false) {
    if (!isHost || close) await api.leave(session.origin, session.code, close).catch(() => {})
    onExit()
  }

  if (ended) {
    return (
      <div className="mw-scroll"><div className="mw-wrap">
        <div className="mw-card mw-empty" style={{ marginTop: 40 }}>
          <h2 style={{ justifyContent: 'center' }}>The lights are off</h2>
          <p>{ended}</p>
          <button className="mw-btn primary" onClick={() => leave(false)}>Back to the lobby</button>
        </div>
      </div></div>
    )
  }

  return (
    <div className="mw-session-root">
      <div className="mw-topbar">
        <button className="mw-btn small ghost" onClick={() => leave(false)} aria-label={isHost ? 'Back to lobby' : 'Leave session'}>
          <ArrowLeft />
        </button>
        <div className="mw-grow">
          <div className="mw-title">{snap?.title || session.title || 'Session'}</div>
          <div className="mw-small mw-muted">
            {room.status === 'live' ? `${snap.players.length} here` : room.status === 'busy' ? 'Host is busy, slowing down…' : room.status === 'reconnecting' ? 'Reconnecting…' : 'Connecting…'}
          </div>
        </div>
        <div className="mw-people" aria-hidden="true">
          {(snap?.players || []).slice(0, 6).map((p) => (
            <span key={p.pid} className="mw-dot" style={{ background: p.color, opacity: p.away ? 0.4 : 1 }} title={p.name} />
          ))}
        </div>
        <button className="mw-btn small" onClick={copyInvite} aria-label={`Copy invite ${invite}`}>
          <Copy /> {copied ? 'Copied' : session.code}
        </button>
        {isHost && (
          <button className="mw-btn small ghost danger" onClick={() => leave(true)} aria-label="Close session for everyone"><X /></button>
        )}
      </div>

      <div className="mw-stage">
        {snap && (
          <LobbyWorld appId={appId} snap={snap} me={me} sendLatest={room.sendLatest} serverNow={room.serverNow} onEvents={room.onEvents}
            onKart={openKart} onStore={openStore} onBoba={drinkBoba} onGhostDrop={openGhostDropCard}onFireworks={shareFireworks} onNear={setNear} sips={sips} hidden={racing || dropping} />
        )}
        {!snap && <div className="mw-status">Walking over to {session.title || 'the lobby'}…</div>}
        {snap && <Feed onEvents={room.onEvents} players={players} />}
        {snap && near && !mySeat && !card && !racing && !dropping && !(guest && (near === 'store' || near.startsWith('display:'))) && (
          <button type="button" className="mw-btn primary mw-kart-nudge"
            onClick={() => (near === 'boba' ? drinkBoba() : near.startsWith('display:') ? setCard(near) : /^(cafe|bench):/.test(near) ? send({ t: 'seat', seat: near }) : setCard(near))}>
            {near === 'store' ? 'App Store' : near === 'boba' ? 'Drink boba tea' : near === 'ghostdrop' ? 'Ghost Drop' : near.startsWith('cafe:') ? 'Sit at the private table' : near.startsWith('bench:') ? 'Sit on the bench' : near.startsWith('display:') ? 'App on display' : 'Möbius Kart'}
          </button>
        )}
        {snap && mySeat && !racing && (
          <div className="mw-seat-bar" role="status">
            <span>{!atCafe ? 'Taking a seat' : tablemate ? `Private chat with ${tablemate.name}` : 'Private table: waiting for a friend to join'}</span>
            <button type="button" className="mw-btn small" onClick={() => send({ t: 'seat', seat: null })}>Stand up</button>
          </div>
        )}
        {snap && <RaceResults race={snap.world?.race} you={snap.you} hidden={racing || dropping || !!card} />}
        {snap && card === 'kart' && !racing && <KartCard snap={snap} onRace={joinRace} onClose={() => setCard(null)} />}
        {snap && card === 'ghostdrop' && !dropping && <GhostDropCard snap={snap} onOpen={openGhostDrop} onClose={() => setCard(null)} />}
        {snap && card === 'store' && !racing && (
          <StoreCard onClose={() => setCard(null)} displayed={(snap.displays || []).map((d) => d.app)}
            onDisplay={(item) => send({ t: 'display', app: item.id, title: item.name, tagline: item.tagline, icon_url: item.iconUrl || undefined, repo: item.repo || undefined, link: item.link || undefined })}
            hostApps={snap.host_apps || []} hostName={(snap.players || []).find((p) => p.is_host)?.name || ''} canFeature={isHost && !guest} />
        )}
        {snap && typeof card === 'string' && card.startsWith('display:') && !racing && (() => {
          const d = (snap.displays || []).find((x) => x.app === card.slice(8))
          return d ? (
            <DisplayCard display={d} by={d.name} canRemove={d.by === snap.you || isHost}
              onRemove={() => { send({ t: 'undisplay', app: d.app }); setCard(null) }} onClose={() => setCard(null)} />
          ) : null
        })()}
        {snap && racing && (
          <KartRace players={snap.players} race={snap.world?.race} you={snap.you} serverNow={room.serverNow}
            send={send} sendLatest={room.sendLatest} onClose={endRace} />
        )}
        {snap && dropping && (
          <GhostDrop players={snap.players} round={snap.world?.gd} you={snap.you} serverNow={room.serverNow}
            send={send} sendLatest={room.sendLatest} onClose={endDrop} />
        )}
      </div>

      {showEmotes && (
        <div className="mw-emotes" role="group" aria-label="Emotes">
          {Object.entries(EMOTE_GLYPHS).map(([key, glyph]) => (
            <button key={key} className="mw-emote" aria-label={key}
              onClick={() => { send({ t: 'emote', e: key }); setShowEmotes(false) }}>{glyph}</button>
          ))}
        </div>
      )}
      <form className="mw-bottombar" onSubmit={say}>
        <button type="button" className="mw-btn small" aria-label="Emotes" aria-expanded={showEmotes}
          onClick={() => setShowEmotes((v) => !v)} style={{ fontSize: 18 }}>😊</button>
        <input className="mw-input" value={text} maxLength={140} onChange={(e) => setText(e.target.value)}
          placeholder="Say something…"
          aria-label="Message" />
        <button className="mw-btn primary small" aria-label="Send" disabled={!text.trim()} style={{ minHeight: 44 }}><ArrowUp /></button>
      </form>
    </div>
  )
}
