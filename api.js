// Every call goes to this instance's Worlds service. Rooms hosted elsewhere are
// relayed by that service; the browser never talks to another Möbius directly.
//
// Opened from the app's public link, the visitor is a guest: there is no owner
// session, so every call goes through the service's public door (the same one
// other Möbius instances use) and the guest holds its own seat tickets here.

let bearer = null
let guest = false
const seats = new Map() // code -> { pid, secret, title, host? } for a guest's joined sessions
const ticket = (code) => { const s = seats.get(code); return s ? { pid: s.pid, secret: s.secret } : {} }

function isPublicLinkToken(token) {
  try {
    const part = String(token || '').split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(atob(part)).scope === 'public_app'
  } catch {
    return false
  }
}

export function setToken(token) {
  bearer = token
  guest = isPublicLinkToken(token)
}
export const isGuest = () => guest

export async function call(path, { method = 'GET', body } = {}) {
  const url = guest ? `/api/app-services/mobius-worlds/${path}` : `/api/services/mobius-worlds/${path}`
  const response = await fetch(url, {
    method,
    headers: {
      ...(guest ? {} : { Authorization: `Bearer ${bearer}` }),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  let data = null
  try { data = await response.json() } catch { /* empty or opaque */ }
  if (!response.ok) {
    const error = new Error(
      data?.detail || (response.status === 429
        ? 'Möbius is busy. Trying again shortly.'
        : `Something went wrong (${response.status}).`),
    )
    error.status = response.status
    throw error
  }
  return data
}

export const getMe = () => call('me')
// A guest's ghost lives only in this page; the host cleans it up when they join.
export const saveMe = (profile) => (guest
  ? Promise.resolve({ profile: { ...profile, name: String(profile.name || '').trim().slice(0, 24) } })
  : call('me', { method: 'PUT', body: profile }))
export const getLobby = () => call('lobby')
export const getHostApps = () => call('host-apps')
export const saveHostApps = (apps) => call('host-apps', { method: 'PUT', body: { apps } })
export const addFriend = (address) => call('friends', { method: 'POST', body: { address } })
export const removeFriend = (origin) =>
  call(`friends?origin=${encodeURIComponent(origin)}`, { method: 'DELETE' })
export const hostSession = (title, listed) =>
  call('host', { method: 'POST', body: { title, listed } })
export const joinSession = (body) => call('join', { method: 'POST', body })
export const sync = (body) => (guest
  ? call('public/sync', { method: 'POST', body: { ...body, ...ticket(body.code) } })
  : call('sync', { method: 'POST', body }))
export const leave = (origin, code, close = false) => {
  if (!guest) return call('leave', { method: 'POST', body: { origin, code, close } })
  const seat = ticket(code)
  seats.delete(code)
  return seat.pid ? call('public/leave', { method: 'POST', body: { code, close, ...seat } }) : Promise.resolve({ ok: true })
}

// A public-link guest: the host's welcome (who they're visiting, open sessions,
// ghost options) and a seat in one of the host's sessions.
export const getGuestWelcome = () => call('public/guest')
export const getHostRooms = () => call('public/rooms')
export async function guestJoin(code, profile) {
  const clean = String(code || '').trim().toUpperCase().replace(/^.*\//, '')
  if (seats.has(clean)) return { code: clean, title: seats.get(clean).title } // back to a seat you still hold
  const reply = await call('public/join', { method: 'POST', body: { code: clean, profile, browser: true } })
  seats.set(clean, { pid: reply.pid, secret: reply.secret, title: reply.title })
  return { code: clean, title: reply.title }
}
// A visitor hosts a session of their own on this island; it lasts while they're around.
export async function guestHost(title, listed, profile) {
  const reply = await call('public/host', { method: 'POST', body: { title, listed, profile } })
  seats.set(reply.code, { pid: reply.pid, secret: reply.secret, title: reply.title, host: true })
  return { code: reply.code, title: reply.title }
}
export const hostedByMe = (code) => !!seats.get(code)?.host

// The apps installed on this Möbius (the platform's own list, not the Worlds service).
export async function installedApps() {
  if (guest) return [] // a guest has no Möbius of their own here
  const response = await fetch('/api/apps/', { headers: { Authorization: `Bearer ${bearer}` } })
  if (!response.ok) throw new Error(`Installed apps could not be loaded (${response.status}).`)
  return response.json()
}

// The Möbius App Store's live catalog and icons, read through this instance's
// proxy (outside hosts are blocked in the app frame). Not for guests.
export async function proxied(url, as = 'json') {
  if (guest) throw new Error('Guests browse the stand only.')
  const response = await fetch(`/api/proxy?url=${encodeURIComponent(url)}`, { headers: { Authorization: `Bearer ${bearer}` } })
  if (!response.ok) throw new Error(`Could not reach ${new URL(url).host} (${response.status}).`)
  return as === 'blob' ? response.blob() : response.json()
}
