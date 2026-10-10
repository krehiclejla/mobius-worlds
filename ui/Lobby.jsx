import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Copy, Globe, Plus, Trash, UserAdd, Users } from '@openai/apps-sdk-ui/components/Icon'
import * as api from '../api.js'
import { drawAvatar } from '../avatar.js'
import ProfileEditor, { GhostPortrait } from './ProfileEditor.jsx'

export const ACTIVITY = { plaza: 'Hanging out in the lobby' }
const CRITTERS = ['#c8cdd6', '#ffb3cf', '#9fe3c8', '#9cd3ff', '#c9b8f5', '#ffe38a']

export function HeroScene() {
  const ref = useRef(null)
  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas.getContext('2d')
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const critters = CRITTERS.map((color, i) => ({
      color, x: 0.58 + i * 0.07, y: 0.8 + (i % 2) * 0.1, tx: 0.58 + i * 0.07, speed: 0.03 + Math.random() * 0.03,
    }))
    let frame
    let last = performance.now()
    const draw = (t) => {
      const dpr = window.devicePixelRatio || 1
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      if (canvas.width !== w * dpr) { canvas.width = w * dpr; canvas.height = h * dpr }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      // stars
      for (let i = 0; i < 40; i++) {
        const x = (i * 97.3) % w
        const y = ((i * 53.1) % (h * 0.5))
        ctx.fillStyle = `rgba(255,255,255,${0.25 + 0.35 * Math.abs(Math.sin(t / 900 + i))})`
        ctx.fillRect(x, y, 2, 2)
      }
      // hill
      ctx.fillStyle = 'rgba(255,255,255,0.10)'
      ctx.beginPath(); ctx.ellipse(w * 0.5, h * 1.25, w * 0.75, h * 0.55, 0, 0, Math.PI * 2); ctx.fill()
      const dt = Math.min(0.05, (t - last) / 1000); last = t
      const s = Math.max(14, Math.min(26, w / 30))
      for (const c of critters) {
        if (!reduce) {
          if (Math.abs(c.tx - c.x) < 0.01 && Math.random() < 0.01) c.tx = (w < 560 ? 0.12 : 0.56) + Math.random() * (w < 560 ? 0.8 : 0.4)
          const dir = Math.sign(c.tx - c.x)
          c.x += dir * Math.min(Math.abs(c.tx - c.x), c.speed * dt)
          c.facing = dir || c.facing || 1
        }
        const walking = Math.abs(c.tx - c.x) > 0.01
        drawAvatar(ctx, c.x * w, (w < 560 ? 0.1 + c.y * 0.2 : c.y) * h, s, { color: c.color, walking, t, facing: c.facing || 1, face: c.color === '#c8cdd6' ? 'mystery' : 'dots' })
      }
      if (!reduce) frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [])
  return <canvas ref={ref} aria-hidden="true" />
}

export function SessionArt({ room }) {
  const color = room.host_color || '#c8cdd6'
  return (
    <div className="mw-session-art" style={{ background: `color-mix(in srgb, ${color} 34%, var(--surface-2))` }}>
      <GhostPortrait profile={{ color, ...(room.host_look || {}) }} size={46} />
    </div>
  )
}

// Starting a session. The owner hosts on their own Möbius; a public-link visitor
// hosts on the island they're visiting (start = api.guestHost, with its own words).
export function HostSheet({ me, onClose, onHosted, start = null, listedHint = null, note = null }) {
  const [title, setTitle] = useState(`${me.profile.name}'s place`)
  const [listed, setListed] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(event) {
    event.preventDefault()
    setBusy(true); setError('')
    try {
      const hosted = start ? await start(title, listed) : await api.hostSession(title, listed)
      window.mobius?.signal?.('item_created', { type: 'session' })
      onHosted({ origin: hosted.origin, code: hosted.code, title: hosted.title, invite: hosted.invite })
    } catch (err) {
      setError(err.message); setBusy(false)
    }
  }
  return (
    <div className="mw-scrim" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form className="mw-sheet" onSubmit={submit} role="dialog" aria-modal="true" aria-label="Start a session">
        <h3>Start a session</h3>
        <label className="mw-small mw-muted" htmlFor="mw-title">Name</label>
        <input id="mw-title" className="mw-input" value={title} maxLength={40} autoFocus
          onChange={(e) => setTitle(e.target.value)} />
        <label className="mw-toggle">
          <span>
            <strong>{listedHint ? 'Show in open sessions' : 'Show to friends'}</strong><br />
            <span className="mw-small mw-muted">{listedHint || 'People who added your Möbius see it in their lobby. Anyone with the invite can still join.'}</span>
          </span>
          <input type="checkbox" checked={listed} onChange={(e) => setListed(e.target.checked)} />
        </label>
        <p className="mw-small mw-muted" style={{ margin: '4px 0 14px' }}>
          {note || "The session runs on your Möbius. It stays open while you're in it and closes a couple of minutes after you leave."}
        </p>
        {error && <div className="mw-error">{error}</div>}
        <div className="mw-row">
          <button className="mw-btn primary mw-grow" disabled={busy}>{busy ? 'Opening…' : 'Open the lobby'}</button>
          <button type="button" className="mw-btn ghost" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </div>
  )
}

export default function Lobby({ me, setMe, onEnter }) {
  const [lobby, setLobby] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [hosting, setHosting] = useState(false)
  const [editing, setEditing] = useState(false)
  const [invite, setInvite] = useState('')
  const [joinState, setJoinState] = useState({ busy: false, error: '' })
  const [friendAddress, setFriendAddress] = useState('')
  const [friendState, setFriendState] = useState({ busy: false, error: '' })
  const [copied, setCopied] = useState('')

  const refresh = useCallback(async () => {
    try {
      setLobby(await api.getLobby())
      setLoadError('')
    } catch (err) {
      setLoadError(err.message)
    }
  }, [])

  useEffect(() => {
    refresh()
    const timer = setInterval(() => { if (!document.hidden) refresh() }, 20000)
    return () => clearInterval(timer)
  }, [refresh])

  async function join(body) {
    setJoinState({ busy: true, error: '' })
    try {
      const joined = await api.joinSession(body)
      window.mobius?.signal?.('session_joined', { remote: joined.origin !== lobby?.origin })
      onEnter({ origin: joined.origin, code: joined.code, title: joined.title, invite: joined.invite })
    } catch (err) {
      setJoinState({ busy: false, error: err.message })
    }
  }

  async function addFriend(event) {
    event.preventDefault()
    if (!friendAddress.trim()) return
    setFriendState({ busy: true, error: '' })
    try {
      await api.addFriend(friendAddress.trim())
      setFriendAddress('')
      setFriendState({ busy: false, error: '' })
      refresh()
    } catch (err) {
      setFriendState({ busy: false, error: err.message })
    }
  }

  async function copy(text) {
    const ok = await window.mobius?.clipboard?.writeText(text)
    setCopied(ok ? text : '')
    setTimeout(() => setCopied(''), 1800)
  }

  const friends = lobby?.friends || []
  const friendRooms = friends.flatMap((f) => (f.rooms || []).map((r) => ({ ...r, origin: f.origin, friend: f })))

  return (
    <div className="mw-scroll">
      <div className="mw-wrap">
        <div className="mw-hero">
          <HeroScene />
          <div className="mw-hero-text">
            <h1>Möbius Worlds</h1>
            <p>The Worlds Lobby, built in Game Studio: a night-time island where ghosts from different Möbius instances meet, dance on the party island, make beats at the DJ set and race Möbius Kart.</p>
          </div>
          <div className="mw-hero-actions">
            <button className="mw-btn primary" onClick={() => setHosting(true)}><Plus /> Start a session</button>
            <button className="mw-btn" onClick={() => setEditing((v) => !v)}>
              <span style={{ width: 30, height: 30, display: 'inline-block', marginLeft: -8 }}><GhostPortrait profile={me.profile} size={30} /></span>
              {me.profile.name}
            </button>
          </div>
        </div>

        {editing && (
          <div className="mw-section">
            <ProfileEditor me={me} onCancel={() => setEditing(false)}
              onSaved={(profile) => { setMe({ ...me, profile }); setEditing(false) }} />
          </div>
        )}

        <div className="mw-section">
          <h2>Join with an invite</h2>
          <form className="mw-join" onSubmit={(e) => { e.preventDefault(); if (invite.trim()) join({ invite }) }}>
            <input className="mw-input" value={invite} onChange={(e) => setInvite(e.target.value)}
              placeholder="@friend/ABCDE" aria-label="Invite" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
            <button className="mw-btn primary" disabled={joinState.busy || !invite.trim()}>
              {joinState.busy ? 'Joining…' : 'Join'}
            </button>
          </form>
          {joinState.error && <div className="mw-error">{joinState.error}</div>}
        </div>

        <div className="mw-section">
          <h2><Globe /> Your sessions</h2>
          {!lobby && !loadError && <div className="mw-card mw-empty">Loading…</div>}
          {loadError && <div className="mw-card mw-empty">{loadError} <button className="mw-btn small" onClick={refresh}>Retry</button></div>}
          {lobby && lobby.hosted.length === 0 && (
            <div className="mw-card mw-empty">You're not hosting anything yet. Start a session and share the invite with a friend.</div>
          )}
          <div className="mw-list">
            {lobby?.hosted.map((room) => (
              <div className="mw-card mw-session" key={room.code}>
                <SessionArt room={room} />
                <div className="mw-grow">
                  <div className="mw-session-title">{room.title}</div>
                  <div className="mw-row mw-small mw-muted" style={{ gap: 6, flexWrap: 'wrap', marginTop: 3 }}>
                    <span className="mw-pill live"><Users /> {room.players}/{room.max_players}</span>
                    <span>{ACTIVITY[room.activity] || ACTIVITY.plaza}</span>
                  </div>
                </div>
                <button className="mw-btn small" onClick={() => copy(room.invite)} aria-label={`Copy invite ${room.invite}`}>
                  <Copy /> {copied === room.invite ? 'Copied' : room.code}
                </button>
                <button className="mw-btn small primary" onClick={() => onEnter({ origin: room.origin, code: room.code, title: room.title, invite: room.invite })}>Enter</button>
              </div>
            ))}
          </div>
        </div>

        {lobby?.visitors?.length > 0 && (
          <div className="mw-section">
            <h2><Users /> Visitors' sessions</h2>
            <p className="mw-small mw-muted" style={{ marginTop: -4 }}>Started by people visiting through your Worlds link. They run on your Möbius, and you can close any of them.</p>
            <div className="mw-list">
              {lobby.visitors.map((room) => (
                <div className="mw-card mw-session" key={room.code}>
                  <SessionArt room={room} />
                  <div className="mw-grow">
                    <div className="mw-session-title">{room.title}</div>
                    <div className="mw-row mw-small mw-muted" style={{ gap: 6, flexWrap: 'wrap', marginTop: 3 }}>
                      <span className="mw-pill live"><Users /> {room.players}/{room.max_players}</span>
                      <span>{room.host_name} · {ACTIVITY[room.activity] || ACTIVITY.plaza}</span>
                    </div>
                  </div>
                  <button className="mw-btn small ghost danger" aria-label={`Close ${room.title}`}
                    onClick={() => api.leave(room.origin, room.code, true).catch(() => {}).then(refresh)}><Trash /></button>
                  <button className="mw-btn small primary" disabled={joinState.busy || room.players >= room.max_players}
                    onClick={() => join({ origin: room.origin, code: room.code })}>Join</button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mw-section">
          <h2><Users /> Friends' sessions</h2>
          {lobby && friendRooms.length === 0 && (
            <div className="mw-card mw-empty">
              {friends.length === 0
                ? 'Add a friend’s Möbius ID below. Their open sessions will show up here.'
                : 'None of your friends are hosting right now.'}
            </div>
          )}
          <div className="mw-list">
            {friendRooms.map((room) => (
              <div className="mw-card mw-session" key={`${room.origin}/${room.code}`}>
                <SessionArt room={room} />
                <div className="mw-grow">
                  <div className="mw-session-title">{room.title}</div>
                  <div className="mw-row mw-small mw-muted" style={{ gap: 6, flexWrap: 'wrap', marginTop: 3 }}>
                    <span className="mw-pill live"><Users /> {room.players}/{room.max_players}</span>
                    <span>{room.host_name} · {ACTIVITY[room.activity] || ACTIVITY.plaza}</span>
                  </div>
                </div>
                <button className="mw-btn small primary" disabled={joinState.busy || room.players >= room.max_players}
                  onClick={() => join({ origin: room.origin, code: room.code })}>Join</button>
              </div>
            ))}
          </div>
        </div>

        <div className="mw-section">
          <h2><UserAdd /> Friends</h2>
          <form className="mw-join" onSubmit={addFriend}>
            <input className="mw-input" value={friendAddress} onChange={(e) => setFriendAddress(e.target.value)}
              placeholder="@their-id" aria-label="Friend's Möbius ID or address" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
            <button className="mw-btn" disabled={friendState.busy || !friendAddress.trim()}>
              {friendState.busy ? 'Checking…' : 'Add'}
            </button>
          </form>
          {friendState.error && <div className="mw-error">{friendState.error}</div>}
          <div className="mw-list" style={{ marginTop: 10 }}>
            {friends.map((f) => (
              <div className="mw-card mw-session" key={f.origin} style={{ padding: 10 }}>
                <span style={{ width: 12, height: 12, borderRadius: '50%', flex: 'none', background: f.online ? '#2f9e44' : 'var(--border)' }} />
                <div className="mw-grow">
                  <div className="mw-session-title">{f.label}</div>
                  <div className="mw-small mw-muted">{f.handle ? `@${f.handle}` : f.origin.replace('https://', '')}{f.online ? '' : ` · ${f.error || 'offline'}`}</div>
                </div>
                <button className="mw-btn small ghost danger" aria-label={`Remove ${f.label}`}
                  onClick={async () => { await api.removeFriend(f.origin).catch(() => {}); refresh() }}><Trash /></button>
              </div>
            ))}
          </div>
          {lobby && (
            <p className="mw-small mw-muted" style={{ marginTop: 12 }}>
              {lobby.handle
                ? <>Your Möbius ID is <strong>@{lobby.handle}</strong>. Friends add it to see your sessions, and your invites use it.</>
                : <>Your address is <strong>{lobby.origin.replace('https://', '')}</strong>. Sign in with Möbius · You to use your @ID instead.</>}
            </p>
          )}
        </div>
      </div>
      {hosting && <HostSheet me={me} onClose={() => setHosting(false)} onHosted={onEnter} />}
    </div>
  )
}
