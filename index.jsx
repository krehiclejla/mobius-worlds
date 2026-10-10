import React, { useEffect, useRef, useState } from 'react'
import { CSS } from './theme.js'
import * as api from './api.js'
import Lobby from './ui/Lobby.jsx'
import GuestLobby from './ui/GuestLobby.jsx'
import Session from './ui/Session.jsx'
import ProfileEditor from './ui/ProfileEditor.jsx'

export default function App({ appId, token }) {
  api.setToken(token)
  const [me, setMe] = useState(null)
  const [error, setError] = useState('')
  const [session, setSession] = useState(null) // { origin, code, title }
  const readySignalled = useRef(false)

  const guest = api.isGuest()

  useEffect(() => {
    let alive = true
    Promise.all([
      guest ? guestWelcome() : api.getMe(),
      guest ? null : window.mobius?.storage?.get('current.json').catch(() => null),
    ]).then(([profile, current]) => {
      if (!alive) return
      setMe(profile)
      if (current?.origin && current?.code) setSession(current)
      if (!readySignalled.current) {
        readySignalled.current = true
        window.mobius?.signal?.('app_ready', { configured: !!profile.configured })
      }
    }).catch((err) => {
      if (alive) setError(err.message)
      window.mobius?.signal?.('error', { message: err.message, source: 'load' })
    })
    return () => { alive = false }
  }, [])

  // A guest's seat is only good for this page, so only the owner remembers the open session.
  function enter(next) {
    setSession(next)
    if (!guest) window.mobius?.storage?.set('current.json', next).catch(() => {})
  }
  function exit() {
    setSession(null)
    if (!guest) window.mobius?.storage?.remove('current.json').catch(() => {})
  }

  let body
  if (error) {
    body = (
      <div className="mw-wrap"><div className="mw-card mw-empty">
        <p>Möbius Worlds couldn't start: {error}</p>
        <button className="mw-btn" onClick={() => location.reload()}>Try again</button>
      </div></div>
    )
  } else if (!me) {
    body = <div className="mw-wrap"><div className="mw-empty">Opening the gates…</div></div>
  } else if (!me.configured) {
    body = (
      <div className="mw-scroll"><div className="mw-wrap">
        <div className="mw-section" style={{ marginTop: 8 }}>
          <h2>Make your ghost</h2>
          <p className="mw-muted" style={{ marginTop: 0 }}>{guest
            ? `You're visiting ${me.host?.name || 'a friend'}'s Möbius Worlds. This is how everyone on the island will see you.`
            : 'This is how people from other Möbius instances will see you.'}</p>
          <ProfileEditor me={me} onSaved={(profile) => setMe({ ...me, profile, configured: true })} first />
        </div>
      </div></div>
    )
  } else if (session) {
    body = <Session appId={appId} me={me} session={session} onExit={exit} />
  } else {
    body = guest
      ? <GuestLobby me={me} setMe={setMe} onEnter={enter} />
      : <Lobby me={me} setMe={setMe} onEnter={enter} />
  }

  return (
    <div className="mw-root">
      <style>{CSS}</style>
      {body}
    </div>
  )
}

// A public-link visitor starts from the host's welcome with an unsaved ghost.
async function guestWelcome() {
  const welcome = await api.getGuestWelcome()
  const pick = (list) => list[Math.floor(Math.random() * list.length)]
  const profile = { name: 'Guest', color: pick(welcome.colors) }
  for (const [slot, options] of Object.entries(welcome.outfit || {})) profile[slot] = options[0]
  return { ...welcome, profile, configured: false, guest: true }
}
