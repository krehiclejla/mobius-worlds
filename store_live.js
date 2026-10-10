// The whole official Möbius App Store for the lobby's stand: the Store's live
// catalog as one searchable list. The bundled snapshot in store_featured.js paints
// first (and is all a guest sees, or what shows if the catalog can't be reached).
// Icons outside the snapshot load lazily through the proxy.
import { STORE_APPS } from './store_featured.js'
import { isGuest, proxied } from './api.js'

const CATALOG_URL = 'https://raw.githubusercontent.com/mobius-os/app-store/main/catalog.json'
export const SHELF_ORDER = ['Play', 'Create', 'Explore', 'Everyday', 'Productivity', 'Developer']
const LABELS = { play: 'Play', create: 'Create', explore: 'Explore', everyday: 'Everyday', productivity: 'Productivity', developer: 'Developer' }

const words = (...parts) => parts.flat().filter(Boolean).join(' ').toLowerCase()
const baked = new Map(STORE_APPS.map((a) => [a.id, a]))

function bakedItem(a) {
  return { ...a, iconUrl: null, text: words(a.name, a.tagline, a.shelf) }
}

function catalogItem(entry) {
  const known = baked.get(entry.id)
  const listing = entry.listing || {}
  const tagline = listing.tagline || entry.summary || entry.description || ''
  return {
    id: entry.id,
    name: entry.name || entry.id,
    tagline,
    shelf: LABELS[entry.collection] || (entry.audience === 'developer' ? 'Developer' : 'Everyday'),
    repo: entry.repo || '',
    featured: !!listing.featured,
    icon: known?.icon || null,
    iconUrl: entry.raw_base ? `${entry.raw_base}icon.png` : null,
    text: words(entry.name, tagline, entry.description, entry.keywords, entry.categories, entry.capabilities, entry.collection),
  }
}

export const snapshotApps = () => STORE_APPS.map(bakedItem)

// Resolves to the full official catalog, or the bundled snapshot if it can't be reached.
export async function loadWholeStore() {
  if (isGuest()) return snapshotApps()
  try {
    const body = await proxied(CATALOG_URL)
    const apps = Array.isArray(body?.apps) ? body.apps.filter((e) => e && typeof e.id === 'string').map(catalogItem) : []
    return apps.length ? apps : snapshotApps()
  } catch {
    return snapshotApps()
  }
}

// Best matches first: a name that starts with the search, then a name that has it, then anything else.
export function searchApps(apps, query, shelf) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const inShelf = apps.filter((a) => shelf === 'All' || a.shelf === shelf)
  if (!terms.length) {
    const order = (a) => (a.host ? -1 : (a.featured ? 0 : 1) * 100 + SHELF_ORDER.indexOf(a.shelf))
    return [...inShelf].sort((a, b) => order(a) - order(b))
  }
  const score = (a) => {
    const name = a.name.toLowerCase()
    if (!terms.every((t) => name.includes(t) || a.text.includes(t))) return -1
    return (name.startsWith(terms[0]) ? 3 : 0) + terms.filter((t) => name.includes(t)).length
  }
  return inShelf.map((a) => [a, score(a)]).filter(([, s]) => s >= 0)
    .sort((x, y) => y[1] - x[1] || x[0].name.localeCompare(y[0].name)).map(([a]) => a)
}

// Icons the snapshot doesn't carry: fetched once through the proxy and kept as a
// small data URL, which both the card and the 3D lobby can show.
const icons = new Map()
export function iconFor(item) {
  if (item.icon) return Promise.resolve(item.icon)
  if (!item.iconUrl || isGuest()) return Promise.resolve(null)
  if (!icons.has(item.iconUrl)) {
    icons.set(item.iconUrl, proxied(item.iconUrl, 'blob').then(shrink).catch(() => null))
  }
  return icons.get(item.iconUrl)
}

async function shrink(blob) {
  const bitmap = await createImageBitmap(blob)
  const size = 96
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const scale = Math.min(size / bitmap.width, size / bitmap.height)
  const w = bitmap.width * scale, h = bitmap.height * scale
  canvas.getContext('2d').drawImage(bitmap, (size - w) / 2, (size - h) / 2, w, h)
  bitmap.close?.()
  return canvas.toDataURL('image/png')
}

// Apps the session's host published: they sit on their own shelf and install from their public link.
export function hostItems(list, hostName) {
  const shelf = `Published by ${hostName || 'the host'}`
  return (Array.isArray(list) ? list : []).map((a) => ({
    id: a.id, name: a.title, tagline: a.tagline || '', shelf, repo: a.repo || '', featured: false,
    icon: null, iconUrl: a.icon_url || null, link: a.link, host: true,
    text: words(a.title, a.tagline, a.repo, shelf),
  }))
}

export function linkDetails(link) {
  const repo = /raw\.githubusercontent\.com\/([^/]+\/[^/]+)\//i.exec(link)?.[1] || ''
  const iconUrl = /\/mobius\.json$/i.test(link) ? link.replace(/mobius\.json$/i, 'icon.png') : ''
  return { repo, iconUrl }
}

