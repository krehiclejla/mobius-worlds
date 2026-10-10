// The lobby for a visitor on Worlds' public link: no Möbius of their own and no
// friends list, but they can host a session of their own on this island, see
// everyone's open sessions here, and join one by code.
import React, { useCallback, useEffect, useState } from 'react'
import { Globe, Plus, Users } from '@openai/apps-sdk-ui/components/Icon'
import * as api from '../api.js'
import ProfileEditor, { GhostPortrait } from './ProfileEditor.jsx'
import { ACTIVITY, HeroScene, HostSheet, SessionArt } from './Lobby.jsx'

const REFRESH_MS = 15000

export default function GuestLobby({ me, setMe, onEnter }) {
  const [rooms, setRooms] = useState(me.rooms || null)
  const [loadError, setLoadError] = useState('')
  const [editing, setEditing] = useState(false)
  const [code, setCode] = useState('')
  const [joinState, setJoinState] = useState({ busy: false, error: '' })
  const [hosting, setHosting] = useState(false)
  const host = me.host?.name || 'the host'

  const refresh = useCallback(async () => {
    try {
      setRooms((await api.getHostRooms()).rooms || [])
      setLoadError('')
    } catch (err) {
      setLoadError(err.message)
    }
  }, [])

  useEffect(() => {
    refresh()
    const timer = setInterval(() => { if (!document.hidden) refresh() }, REFRESH_MS)
    return () => clearInterval(timer)
  }, [refresh])

  async function join(target) {
    setJoinState({ busy: true, error: '' })
    try {
      const joined = await api.guestJoin(target, me.profile)
      window.mobius?.signal?.('session_joined', { guest: true })
      onEnter({ origin: me.origin, code: joined.code, title: joined.title, invite: joined.code })
    } catch (err) {
      setJoinState({ busy: false, error: err.message })
    }
  }

  return (
    <div className="mw-scroll">
      <div className="mw-wrap">
        <div className="mw-hero">
          <HeroScene />
          <div className="mw-hero-text">
            <h1>Möbius Worlds</h1>
            <p>You're visiting {host}'s island as a guest. Join an open session, or host your own and invite friends, to walk around, chat, dance and race Möbius Kart together.</p>
          </div>
          <div className="mw-hero-actions">
            <button className="mw-btn primary" onClick={() => setHosting(true)}><Plus /> Host a session</button>
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
          <h2><Globe /> Open sessions</h2>
          {!rooms && !loadError && <div className="mw-card mw-empty">Loading…</div>}
          {loadError && <div className="mw-card mw-empty">{loadError} <button className="mw-btn small" onClick={refresh}>Retry</button></div>}
          {rooms && rooms.length === 0 && (
            <div className="mw-card mw-empty">Nobody is hosting an open session right now. Host your own, or enter a session code below.</div>
          )}
          <div className="mw-list">
            {(rooms || []).map((room) => (
              <div className="mw-card mw-session" key={room.code}>
                <SessionArt room={room} />
                <div className="mw-grow">
                  <div className="mw-session-title">{room.title}</div>
                  <div className="mw-row mw-small mw-muted" style={{ gap: 6, flexWrap: 'wrap', marginTop: 3 }}>
                    <span className="mw-pill live"><Users /> {room.players}/{room.max_players}</span>
                    <span>{api.hostedByMe(room.code) ? 'Hosted by you' : room.host_name} · {ACTIVITY[room.activity] || ACTIVITY.plaza}</span>
                  </div>
                </div>
                <button className="mw-btn small primary" disabled={joinState.busy || (room.players >= room.max_players && !api.hostedByMe(room.code))}
                  onClick={() => join(room.code)}>{api.hostedByMe(room.code) ? 'Return' : 'Join'}</button>
              </div>
            ))}
          </div>
        </div>

        <div className="mw-section">
          <h2>Join with a code</h2>
          <form className="mw-join" onSubmit={(e) => { e.preventDefault(); if (code.trim()) join(code) }}>
            <input className="mw-input" value={code} onChange={(e) => setCode(e.target.value)}
              placeholder="ABCDE" aria-label="Session code" autoCapitalize="characters" autoCorrect="off" spellCheck={false} />
            <button className="mw-btn primary" disabled={joinState.busy || !code.trim()}>
              {joinState.busy ? 'Joining…' : 'Join'}
            </button>
          </form>
          {joinState.error && <div className="mw-error">{joinState.error}</div>}
          <p className="mw-small mw-muted" style={{ marginTop: 12 }}>
            Guests don't keep a ghost between visits: reloading this page starts fresh.
          </p>
        </div>
      </div>
      {hosting && (
        <HostSheet me={me} onClose={() => setHosting(false)}
          start={(title, listed) => api.guestHost(title, listed, me.profile)}
          listedHint={`Everyone visiting ${host}'s island sees it in their open sessions. Anyone with the code can still join.`}
          note={`It runs on ${host}'s Möbius while you're in it, and closes a couple of minutes after you leave or reload this page. Share its 5-letter code to invite friends.`}
          onHosted={(hosted) => { setHosting(false); onEnter({ origin: me.origin, code: hosted.code, title: hosted.title, invite: hosted.code }) }} />
      )}
    </div>
  )
}
