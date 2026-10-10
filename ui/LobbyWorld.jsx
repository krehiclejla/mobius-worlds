// The Worlds Lobby from Game Studio, lived in together.
//
// The scene runs in a sandboxed frame with Game Studio's own runtime, as in
// the studio's Play mode. This component adds your ghost to it (see
// lobby_bridge.js), hands it the models, and relays the session both ways:
// your ghost's position goes up as `move`, everyone else comes down from each
// snapshot, and chat and emotes appear as bubbles over the right ghost.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { buildGameDocument } from '../kart_runtime.js'
import { LOBBY, LOBBY_HTML } from '../lobby_game.js'
import { BRIDGE, GHOST_SCALE, PRELUDE } from '../lobby_bridge.js'
import { STORE_APPS } from '../store_featured.js'
import { iconFor } from '../store_live.js'
import GHOSTS from '../models_ghosts.js'
import { LOGO } from '../models.js'

const LOOK_KEYS = ['color', 'face', 'hat', 'neck', 'hold']
const lookOf = (p) => Object.fromEntries(LOOK_KEYS.map((k) => [k, p?.[k]]))

function decode(b64) {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes.buffer
}

// Models load once per app session; remounting the lobby reuses them.
let modelJob = null
function loadModels(appId, onProgress) {
  if (modelJob) return modelJob
  const names = Object.keys(LOBBY.models)
  const total = Object.values(LOBBY.models).reduce((a, b) => a + b, 0)
  let loaded = 0
  modelJob = (async () => {
    const out = {}
    for (const [name, b64] of Object.entries(GHOSTS)) out[`wg_${name}`] = decode(b64)
    await Promise.all(names.map(async (name) => {
      const res = await fetch(`/app-assets/by-id/${appId}/models/${encodeURIComponent(name)}.glb`)
      if (!res.ok) throw new Error(`The lobby's ${name} model didn't load (${res.status}).`)
      out[name] = await res.arrayBuffer()
      loaded += LOBBY.models[name]
      onProgress?.(Math.min(1, loaded / total))
    }))
    return out
  })()
  modelJob.catch(() => { modelJob = null })
  return modelJob
}

// Small, exact edits to the studio's own game code: they only add a place for the
// bridge to hook in (camera, collisions, fireworks). If the studio's code changes
// shape, the edit is skipped with a warning and the lobby still runs as it was made.
function patched(source, from, to, what) {
  if (!source.includes(from)) { console.warn(`Worlds Lobby: could not add ${what}`); return source }
  return source.replace(from, () => to)
}

function patchRuntime(html) {
  // The bridge steers the camera (see lobby_bridge.js), so it needs the controls.
  html = patched(html, 'orbit.enableDamping = true;', 'orbit.enableDamping = true; window.__worldsOrbit = orbit;', 'the fireworks camera')
  // The view stays where you put it: it follows you but no longer swings round behind you by itself.
  html = patched(html, 'if (mag > 0.05 && !viewDragging && performance.now() - viewDraggedAt > 1200) {',
    'if (false) {', 'a camera that stays where you put it')
  // Benches, lamps, the bridge rails and the crystal's fence push you back out (sliding along them).
  html = patched(html, 'if (!blocked) { pos.x = nx; pos.z = nz; }',
    'if (!blocked && window.__worldsCollide) { const c = window.__worldsCollide(nx, nz); nx = c[0]; nz = c[1]; }\n    if (!blocked) { pos.x = nx; pos.z = nz; }', 'solid benches, lamps and rails')
  return html
}

function patchBeatMachine(code) {
  // Fireworks: tell the session, let anyone on the party island watch, and pull the
  // camera back first (the show is aimed at what the camera sees, so it waits for it).
  code = patched(code, `function launchFirework() {
    if (performance.now() < readyAt) return;
    readyAt = performance.now() + COOLDOWN * 1000;`, `window.__worldsFireworks = launchFirework;
  function launchFirework(remote) {
    if (!remote) { if (performance.now() < readyAt) return; readyAt = performance.now() + COOLDOWN * 1000; }
    const ready = window.__worldsShowCam ? window.__worldsShowCam() : null;
    if (ready) ready.then(fireNow); else fireNow();
  }
  function fireNow() {`, 'the fireworks camera')
  code = patched(code, "else if (a === 'fire') launchFirework();",
    "else if (a === 'fire') { if (performance.now() >= readyAt) { el.classList.remove('open'); launchFirework(); parent.postMessage({ type: 'worlds:fireworks' }, '*'); } }", 'shared fireworks')
  return code
}

// The studio's game file, with your ghost as its player and the bridge as a script.
function lobbyDocument(spawn) {
  const open = '<script type="application/json" id="scene">'
  const start = LOBBY_HTML.indexOf(open) + open.length
  const end = LOBBY_HTML.indexOf('</script>', start)
  const scene = JSON.parse(LOBBY_HTML.slice(start, end))
  scene.objects = [...(scene.objects || []), {
    type: 'model', id: 'worlds-you', name: 'You', asset: 'wg_ghost', scale: GHOST_SCALE,
    position: [spawn.x, null, spawn.z], rotation: [0, 180, 0],
    behaviors: [{ type: 'player', speed: 4.2, jump: 6.5 }],
  }]
  scene.scripts = [...(scene.scripts || []).map((sc) => (sc.name === 'beat-machine' ? { ...sc, code: patchBeatMachine(sc.code) } : sc)),
    { name: 'worlds-bridge', code: BRIDGE }]
  const json = JSON.stringify(scene).replace(/</g, '\\u003c')
  let html = patchRuntime(LOBBY_HTML.slice(0, start) + json + LOBBY_HTML.slice(end))
  // the scene waits for its models, which arrive by message
  html = html.replace('let SCENE = JSON.parse', () => 'await window.__worldsReady;\nlet SCENE = JSON.parse')
  // If the 3D engine can't be downloaded, the module never runs: say so instead of waiting forever.
  const failed = `parent.postMessage({ type: 'worlds:failed', message: "The 3D engine didn't download. Check your connection and try again." }, '*')`
  html = html.replace('<script type="module">', () => `${PRELUDE}<script type="module" onerror="${failed.replace(/"/g, '&quot;')}">`)
  return buildGameDocument(html, { saves: {}, art: {} })
}

const START_LIMIT_MS = 60_000

// What a failed start looked like, kept in the app's storage so a helper can see
// why without screenshots: the error, the browser's reason, and whether this
// browser can do 3D at all outside the lobby's own frame.
function webglProbe() {
  const probe = {}
  for (const kind of ['webgl2', 'webgl']) {
    try {
      const gl = document.createElement('canvas').getContext(kind)
      probe[kind] = !!gl
      if (gl) gl.getExtension('WEBGL_lose_context')?.loseContext()
    } catch (err) { probe[kind] = `error: ${err.message}` }
  }
  return probe
}

function recordStartFailure(message, reason, probe) {
  window.mobius?.storage?.set('last-start-error.json', {
    at: new Date().toISOString(), message: String(message).slice(0, 300), reason: String(reason || '').slice(0, 300),
    appFrameWebGL: probe, userAgent: navigator.userAgent, dpr: window.devicePixelRatio, size: [innerWidth, innerHeight],
  }).catch(() => {})
}

function startError(message, reason, probe) {
  if (/WebGL/i.test(message) && probe && probe.webgl2 !== true && probe.webgl !== true) {
    return 'Your browser has 3D graphics turned off, so the lobby can\'t be drawn. In Chrome, open Settings > System, turn on "Use graphics acceleration when available", then fully quit Chrome (Cmd+Q on a Mac) and reopen it.'
  }
  if (/WebGL/i.test(message)) {
    const why = String(reason || '').replace(/^THREE\.WebGLRenderer:\s*/, '')
    return `Your browser refused to start 3D graphics for this page.${why ? ` It said: "${why}"` : ''} Fully quitting and reopening the browser usually fixes this.`
  }
  return `Something went wrong while building the island: ${String(message).replace(/^Uncaught\s*/, '').slice(0, 160)}`
}

// Studio game ids that a lobby object can launch (its "launch" value).
const GHOST_DROP_GAME = 'g-be99773c'

// Your walk goes up as a short path (host-clock samples), not just the last spot,
// so everyone else can replay it smoothly however far apart the syncs are.
const PATH_MS = 4000
const PATH_MAX = 24

export default function LobbyWorld({ appId, snap, me, sendLatest, serverNow, onEvents, onKart, onStore, onBoba, onGhostDrop, onFireworks, onNear, sips, hidden }) {
  const frameRef = useRef(null)
  const boot = useRef('idle') // idle -> loading -> sent, per frame load
  const readyRef = useRef(false)
  const webglReason = useRef('')
  const [attempt, setAttempt] = useState(0)
  const [progress, setProgress] = useState(0)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const latest = useRef({ snap, me })
  latest.current = { snap, me }
  const you = snap.you
  const mine = snap.players.find((p) => p.pid === you)

  // Built once per visit: later snapshots travel by message, never by reloading the scene.
  const srcDoc = useMemo(() => lobbyDocument({ x: mine?.x ?? 0, z: mine?.z ?? 13.5 }), [attempt]) // eslint-disable-line react-hooks/exhaustive-deps

  function retry() {
    boot.current = 'idle'
    readyRef.current = false
    setError('')
    setProgress(0)
    setReady(false)
    setAttempt((n) => n + 1)
  }

  const post = (message) => frameRef.current?.contentWindow?.postMessage(message, '*')
  const postPlayers = () => post({ type: 'worlds:players', players: latest.current.snap.players, now: serverNow() })
  const path = useRef([])

  useEffect(() => {
    function onMessage(event) {
      if (!frameRef.current || event.source !== frameRef.current.contentWindow) return
      const msg = event.data || {}
      if (msg.type === 'worlds:need-boot') {
        if (msg.probe) webglReason.current = String(msg.probe)
        // The frame asks until it is answered; answer once per load (the models are large).
        if (boot.current === 'loading') return
        boot.current = 'loading'
        loadModels(appId, setProgress).then((models) => {
          const self = latest.current.snap.players.find((p) => p.pid === latest.current.snap.you)
          post({ type: 'worlds:boot', models, look: lookOf(self || latest.current.me.profile), logo: LOGO, you: latest.current.snap.you, apps: STORE_APPS.map((a) => a.icon), appIds: STORE_APPS.map((a) => a.id), appNames: STORE_APPS.map((a) => a.name) })
          boot.current = 'sent'
        }).catch((err) => { boot.current = 'idle'; setError(err.message) })
      } else if (msg.type === 'worlds:failed') {
        setError(String(msg.message || 'The lobby could not start.'))
      } else if (msg.type === 'worlds:ready') {
        readyRef.current = true
        setReady(true)
        postPlayers()
        frameRef.current?.contentWindow?.focus()
      } else if (msg.type === 'worlds:pos') {
        const t = Math.round(serverNow())
        path.current = [...path.current.filter((s) => s[0] > t - PATH_MS), [t, msg.x, msg.y, msg.z, msg.r]].slice(-PATH_MAX)
        sendLatest({ t: 'move', x: msg.x, y: msg.y, z: msg.z, r: msg.r, path: path.current })
      } else if (msg.type === 'worlds:near') {
        onNear?.(msg.near || null)
      } else if (msg.type === 'studio:open-game' && msg.game === 'mobius-kart') {
        onKart?.()
      } else if (msg.type === 'studio:open-game' && msg.game === 'app-store') {
        onStore?.()
      } else if (msg.type === 'studio:open-game' && msg.game === 'boba') {
        onBoba?.()
      } else if (msg.type === 'studio:open-game' && msg.game === GHOST_DROP_GAME) {
        onGhostDrop?.()
      } else if (msg.type === 'worlds:fireworks') {
        onFireworks?.()
      } else if (msg.type === 'studio:error') {
        // Once the lobby runs, a studio script hiccup is not fatal. Before it
        // starts, an uncaught error means it never will: say why.
        console.warn('Worlds Lobby:', msg.message)
        if (!readyRef.current && /^Uncaught/.test(String(msg.message))) {
          const probe = webglProbe()
          setError(startError(msg.message, webglReason.current, probe))
          recordStartFailure(msg.message, webglReason.current, probe)
        }
      } else if (msg.type === 'worlds:webgl') {
        webglReason.current = String(msg.reason || '')
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [appId, sendLatest, onKart, onStore, onBoba, onGhostDrop, onFireworks, onNear]) // eslint-disable-line react-hooks/exhaustive-deps

  // A lobby that makes no progress for a minute says so, with a way to try again
  // (a slow download keeps going as long as it keeps moving).
  useEffect(() => {
    if (ready || error) return undefined
    const timer = setTimeout(() => setError('The lobby is taking too long to start.'), START_LIMIT_MS)
    return () => clearTimeout(timer)
  }, [ready, error, attempt, progress])

  // Everyone else, from every snapshot.
  useEffect(() => { if (ready) postPlayers() }, [snap, ready]) // eslint-disable-line react-hooks/exhaustive-deps
  // The apps on display next to the App Store stand.
  const displaysKey = JSON.stringify(snap?.displays || [])
  // Apps outside the bundled stand bring their own name; their icon loads first so each plinth is built once.
  useEffect(() => {
    if (!ready) return undefined
    let alive = true
    const list = JSON.parse(displaysKey)
    Promise.all(list.map(async (d) => {
      if (STORE_APPS.some((a) => a.id === d.app)) return d
      const icon = await iconFor({ id: d.app, icon: null, iconUrl: d.icon_url || null })
      return { ...d, icon: icon || undefined }
    })).then((displays) => { if (alive) post({ type: 'worlds:displays', displays }) })
    return () => { alive = false }
  }, [displaysKey, ready]) // eslint-disable-line react-hooks/exhaustive-deps
  // Your own outfit, when you change it.
  const lookKey = mine ? LOOK_KEYS.map((k) => mine[k]).join('|') : ''
  useEffect(() => { if (ready && mine) post({ type: 'worlds:look', look: lookOf(mine) }) }, [lookKey, ready]) // eslint-disable-line react-hooks/exhaustive-deps
  // Chat and emotes as bubbles.
  useEffect(() => onEvents((events) => {
    for (const e of events) {
      if (e.kind === 'say') post({ type: 'worlds:say', pid: e.pid, text: e.text })
      else if (e.kind === 'emote' && e.text === 'boba') { if (e.pid !== latest.current.snap.you) post({ type: 'worlds:boba', pid: e.pid }) }
      else if (e.kind === 'emote' && e.text === 'fireworks') { if (e.pid !== latest.current.snap.you) post({ type: 'worlds:fireworks', pid: e.pid }) }
      else if (e.kind === 'emote') post({ type: 'worlds:say', pid: e.pid, emote: e.text })
    }
  }), [onEvents])
  useEffect(() => { if (!hidden && ready) frameRef.current?.contentWindow?.focus() }, [hidden, ready])
  // Your own boba plays at once; everyone else sees it when the emote reaches them.
  useEffect(() => { if (ready && sips) post({ type: 'worlds:boba', pid: you }) }, [sips]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="mw-lobby-world" style={hidden ? { visibility: 'hidden' } : undefined}>
      <iframe key={attempt} ref={frameRef} title="Worlds Lobby" sandbox="allow-scripts allow-pointer-lock"
        allow="fullscreen *; gamepad *; autoplay *" srcDoc={srcDoc} />
      {!ready && (
        <div className="mw-arrive" role="status">
          {error
            ? <><b>The lobby couldn't open.</b><span>{error}</span>
                <button type="button" className="mw-btn primary" onClick={retry}>Try again</button></>
            : <><b>Floating over to the Worlds Lobby…</b>
                <span className="mw-arrive-bar" aria-hidden="true"><i style={{ width: `${Math.round(8 + progress * 92)}%` }} /></span>
                <span>{progress < 1 ? `Bringing the island over: ${Math.round(progress * 100)}%` : 'Building the island…'}</span></>}
        </div>
      )}
    </div>
  )
}
