// The App Store stand's card: every official Möbius App Store app, searchable, by shelf.
// An app you already have opens straight away; any other one opens on its App
// Store page, where you can install it.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { STORE_APPS } from '../store_featured.js'
import { getHostApps, installedApps, isGuest, proxied, saveHostApps } from '../api.js'
import { SHELF_ORDER, hostItems, iconFor, linkDetails, loadWholeStore, searchApps, snapshotApps } from '../store_live.js'

// Catalog apps and installed apps share their repository (mobius-os/app-voice).
const sources = (app) => [app.manifest_url, app.source_manifest?.url, app.distribution_manifest?.url]
  .filter(Boolean).map((u) => String(u).toLowerCase())
const fromRepo = (app, repo) => !!repo && sources(app).some((u) => u.includes(`/${repo.toLowerCase()}/`))
const PAGE = 40

function openApp(appId, intent) {
  const message = { type: 'moebius:open-app', appId }
  if (intent) message.intent = intent
  window.parent.postMessage(message, window.location.origin)
}

// Someone else's app installs from its public link: their own Möbius agent does it.
async function copyInstall(item) {
  const text = `Install ${item.name} in Möbius from this link: ${item.link}`
  try { await navigator.clipboard.writeText(text); return true } catch { return false }
}

function useInstalled() {
  const [installed, setInstalled] = useState(null) // null while checking; [] if it can't be told
  useEffect(() => {
    let alive = true
    installedApps().then((list) => { if (alive) setInstalled(Array.isArray(list) ? list : []) })
      .catch(() => { if (alive) setInstalled([]) })
    return () => { alive = false }
  }, [])
  return installed
}

// An app's icon: the bundled one at once, any other once it has loaded, its initial until then.
export function AppIcon({ item, size = 44 }) {
  const [src, setSrc] = useState(item.icon || null)
  useEffect(() => {
    let alive = true
    if (item.icon) setSrc(item.icon)
    else { setSrc(null); iconFor(item).then((url) => { if (alive) setSrc(url) }) }
    return () => { alive = false }
  }, [item.id, item.icon, item.iconUrl]) // eslint-disable-line react-hooks/exhaustive-deps
  return src
    ? <img src={src} alt="" width={size} height={size} />
    : <span className="mw-store-letter" style={{ width: size, height: size }} aria-hidden="true">{(item.name || '?').charAt(0).toUpperCase()}</span>
}

export default function StoreCard({ onClose, displayed = [], onDisplay, hostApps = [], hostName = '', canFeature = false }) {
  const installed = useInstalled()
  const [apps, setApps] = useState(snapshotApps)
  const [loading, setLoading] = useState(!isGuest())
  const [shelf, setShelf] = useState('All')
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(PAGE)
  const listRef = useRef(null)
  const [copied, setCopied] = useState(null) // { name, ok } after a host app's Get
  const [picking, setPicking] = useState(false)

  useEffect(() => {
    let alive = true
    loadWholeStore().then((all) => { if (alive) setApps(all) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])
  useEffect(() => { setLimit(PAGE); if (listRef.current) listRef.current.scrollTop = 0 }, [query, shelf])

  const store = useMemo(() => (installed || []).find((a) => fromRepo(a, 'mobius-os/app-store')) || null, [installed])
  const owned = (item) => (installed || []).find((a) => fromRepo(a, item.repo) || (item.host && a.slug === item.id.replace(/^host-/, ''))) || null
  const fromHost = useMemo(() => hostItems(hostApps, hostName), [hostApps, hostName])
  const everything = useMemo(() => [...fromHost, ...apps], [fromHost, apps])
  const shelves = ['All', ...(fromHost.length ? [fromHost[0].shelf] : []), ...SHELF_ORDER.filter((name) => apps.some((a) => a.shelf === name))]
  const shown = useMemo(() => searchApps(everything, query, shelf), [everything, query, shelf])
  const get = async (item) => {
    if (!item.host) { openInStore(item); return }
    setCopied({ name: item.name, link: item.link, ok: await copyInstall(item) })
  }
  const openInStore = (item) => openApp(store ? store.id : 'store', item ? `app:${item.id}` : '')
  const total = everything.length

  if (picking) return <FeaturePicker onDone={() => setPicking(false)} onClose={onClose} />

  return (
    <div className="mw-portal-card mw-action mw-store" role="dialog" aria-label="Möbius App Store">
      <button type="button" className="mw-card-x" aria-label="Close" onClick={onClose}>×</button>
      <h4>Möbius App Store</h4>
      <p>{loading ? 'Stocking the stand with every app…' : `All ${total} apps. Search, open the ones you have, or get new ones. Tap Display to show one off in the lobby.`}</p>
      <label className="mw-store-search">
        <span className="mw-sr">Search the App Store</span>
        <input type="search" className="mw-input" placeholder="Search every app" value={query} enterKeyHint="search"
          onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape' && query) { e.stopPropagation(); setQuery('') } }} />
      </label>
      <div className="mw-store-shelves" role="tablist" aria-label="Shelves">
        {shelves.map((name) => (
          <button key={name} type="button" role="tab" aria-selected={shelf === name}
            className={`mw-store-chip${shelf === name ? ' on' : ''}`} onClick={() => setShelf(name)}>{name}</button>
        ))}
      </div>
      <ul className="mw-store-list" ref={listRef} aria-live="polite">
        {shown.slice(0, limit).map((item) => {
          const mine = owned(item)
          return (
            <li key={item.id} className="mw-store-row">
              <AppIcon item={item} />
              <div className="mw-grow">
                <b>{item.name}{item.featured && <span className="mw-store-pick">Pick</span>}</b>
                <span>{item.tagline}</span>
              </div>
              {installed === null
                ? <span className="mw-store-wait" aria-label="Checking" />
                : mine
                  ? <button type="button" className="mw-btn small" onClick={() => openApp(mine.id)} aria-label={`Open ${item.name}`}>Open</button>
                  : <button type="button" className="mw-btn small primary" onClick={() => get(item)} aria-label={item.host ? `Copy the install link for ${item.name}` : `Get ${item.name} in the App Store`}>Get</button>}
              {onDisplay && (displayed.includes(item.id)
                ? <span className="mw-store-wait" title="On display in the lobby">On display</span>
                : <button type="button" className="mw-btn small ghost" onClick={() => onDisplay(item)} title="Put it on display in the lobby so others can get it" aria-label={`Put ${item.name} on display in the lobby`}>Display</button>)}
            </li>
          )
        })}
        {!shown.length && (
          <li className="mw-store-empty">
            {loading ? 'Still loading the rest of the Store…' : <>No app matches “{query}”.{query && <button type="button" className="mw-btn small ghost" onClick={() => setQuery('')}>Clear search</button>}</>}
          </li>
        )}
        {shown.length > limit && (
          <li className="mw-store-empty"><button type="button" className="mw-btn small" onClick={() => setLimit((n) => n + PAGE)}>Show {Math.min(PAGE, shown.length - limit)} more</button></li>
        )}
      </ul>
      {copied && (
        <p className="mw-store-note" role="status">
          {copied.ok
            ? <>Install message for <b>{copied.name}</b> copied. Paste it into a new chat with your Möbius agent and it will install it.</>
            : <>Couldn't copy. Ask your Möbius agent to install {copied.name} from {copied.link}</>}
        </p>
      )}
      <div className="mw-row">
        {canFeature && <button type="button" className="mw-btn mw-grow" onClick={() => setPicking(true)}>Your published apps</button>}
        <button type="button" className="mw-btn mw-grow" onClick={() => openInStore(null)}>Open the App Store</button>
      </div>
    </div>
  )
}

// The host lists the apps they published, by each one's public link, for the stand's "Published by <host>" shelf.
function FeaturePicker({ onDone, onClose }) {
  const [chosen, setChosen] = useState(null) // the saved list, null while loading
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    getHostApps().then((r) => { if (alive) setChosen(r.apps || []) }).catch(() => { if (alive) setChosen([]) })
    return () => { alive = false }
  }, [])

  const save = async (next) => {
    setBusy(true); setError('')
    try { setChosen((await saveHostApps(next)).apps || []) } catch (err) { setError(err.message) }
    setBusy(false)
  }
  const addLink = async () => {
    const url = link.trim()
    if (!/^https:\/\/\S+mobius\.json$/i.test(url)) { setError("Paste the public link to your app's mobius.json."); return }
    setBusy(true); setError('')
    try {
      const manifest = await proxied(url)
      if (!manifest?.name) throw new Error('That link is not a Möbius app.')
      const { repo, iconUrl } = linkDetails(url)
      const entry = { id: manifest.id || manifest.name, title: manifest.name, tagline: manifest.store?.tagline || manifest.description || '', link: url, repo, icon_url: iconUrl }
      await save([...(chosen || []).filter((a) => a.link !== url), entry])
      setLink('')
    } catch (err) { setError(err.message); setBusy(false) }
  }

  return (
    <div className="mw-portal-card mw-action mw-store" role="dialog" aria-label="Your published apps">
      <button type="button" className="mw-card-x" aria-label="Close" onClick={onClose}>×</button>
      <h4>Your published apps</h4>
      <p>Apps you published show on the stand in sessions you host. Visitors copy the link and their Möbius agent installs it.</p>
      <ul className="mw-store-list">
        {chosen === null && <li className="mw-store-empty">Loading…</li>}
        {chosen !== null && !chosen.length && <li className="mw-store-empty">None yet. Paste the link of an app you published below.</li>}
        {(chosen || []).map((a) => (
          <li key={a.link} className="mw-store-row">
            <AppIcon item={{ id: a.id, name: a.title, icon: null, iconUrl: a.icon_url || null }} />
            <div className="mw-grow"><b>{a.title}</b><span>{a.tagline || a.link}</span></div>
            <button type="button" className="mw-btn small" disabled={busy} onClick={() => save(chosen.filter((x) => x.link !== a.link))} aria-label={`Remove ${a.title}`}>Remove</button>
          </li>
        ))}
      </ul>
      <div className="mw-row" style={{ marginBottom: 8 }}>
        <input className="mw-input mw-grow" placeholder="https://…/mobius.json" value={link} onChange={(e) => setLink(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') addLink() }} aria-label="Public link to an app you published" autoCapitalize="none" autoCorrect="off" />
        <button type="button" className="mw-btn" disabled={busy || !link.trim()} onClick={addLink}>Add</button>
      </div>
      {error && <p className="mw-store-note" role="alert">{error}</p>}
      <button type="button" className="mw-btn mw-wide" onClick={onDone}>Done</button>
    </div>
  )
}

export function DisplayCard({ display, by, canRemove, onRemove, onClose }) {
  const installed = useInstalled()
  const known = STORE_APPS.find((a) => a.id === display.app)
  const item = known
    ? { ...known, iconUrl: null }
    : { id: display.app, name: display.title || 'An app', tagline: display.tagline || '', repo: display.repo || '', icon: null, iconUrl: display.icon_url || null, link: display.link || '', host: !!display.link }
  const [copied, setCopied] = useState(null)
  const store = (installed || []).find((a) => fromRepo(a, 'mobius-os/app-store')) || null
  const mine = (installed || []).find((a) => fromRepo(a, item.repo)) || null
  return (
    <div className="mw-portal-card mw-action mw-store" role="dialog" aria-label={`${item.name} on display`}>
      <button type="button" className="mw-card-x" aria-label="Close" onClick={onClose}>×</button>
      <div className="mw-store-row" style={{ border: 0, paddingLeft: 0 }}>
        <AppIcon item={item} size={56} />
        <div className="mw-grow">
          <b>{item.name}</b>
          <span>{item.tagline}</span>
          <span>Shown by {by || 'someone'}</span>
        </div>
      </div>
      {installed === null || isGuest() ? null : mine
        ? <button type="button" className="mw-btn primary mw-wide" onClick={() => openApp(mine.id)}>Open {item.name}</button>
        : item.host
          ? <button type="button" className="mw-btn primary mw-wide" onClick={async () => setCopied(await copyInstall(item))}>Get {item.name}</button>
          : <button type="button" className="mw-btn primary mw-wide" onClick={() => openApp(store ? store.id : 'store', `app:${item.id}`)}>Get {item.name}</button>}
      {copied !== null && (
        <p className="mw-store-note" role="status">{copied
          ? 'Install message copied. Paste it into a new chat with your Möbius agent and it will install it.'
          : `Couldn't copy. Ask your Möbius agent to install ${item.name} from ${item.link}`}</p>
      )}
      {canRemove && <button type="button" className="mw-btn mw-wide" onClick={onRemove}>Take it off display</button>}
    </div>
  )
}
