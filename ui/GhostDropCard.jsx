// The Ghost Drop Stand's card: the drop's state, who is in it, and a way in (or to watch).
import React from 'react'

export default function GhostDropCard({ snap, onOpen, onClose }) {
  const gd = snap.world?.gd || null
  const order = gd?.order || []
  const racers = gd?.racers || {}
  const names = (ids) => ids.map((pid) => racers[pid]?.name || snap.players.find((p) => p.pid === pid)?.name).filter(Boolean).join(', ')
  const inDrop = order.includes(snap.you)
  const min = gd?.min ?? 2
  const max = gd?.max ?? 8
  const winner = gd?.state === 'done' && gd.winner ? racers[gd.winner]?.name : null
  let status = null
  let button = <button type="button" className="mw-btn primary mw-wide" onClick={onOpen}>Start a drop</button>
  if (gd?.state === 'lobby') {
    const more = min - order.length
    status = <p className="mw-small"><b>Drop lobby ({order.length}/{max}):</b> {names(order) || 'nobody yet'}. {more > 0 ? `Needs ${more} more to start.` : 'Ready to start.'}</p>
    button = <button type="button" className="mw-btn primary mw-wide" onClick={onOpen}>{inDrop ? 'Back to the drop lobby' : 'Jump in'}</button>
  } else if (gd?.state === 'countdown') {
    status = <p className="mw-small"><b>Starting:</b> {names(order)}. Ghosts are lining up on the top layer.</p>
    button = <button type="button" className="mw-btn mw-wide" disabled>Starting soon</button>
  } else if (gd?.state === 'running') {
    status = <p className="mw-small"><b>Drop on:</b> {names(order)}. You can watch, or jump in when the next one opens.</p>
    button = <button type="button" className="mw-btn primary mw-wide" onClick={onOpen}>Watch the drop</button>
  } else if (winner) {
    status = <p className="mw-small"><b>Last drop:</b> {winner} won.</p>
  }
  return (
    <div className="mw-portal-card mw-action" role="dialog" aria-label="Ghost Drop">
      <button type="button" className="mw-card-x" aria-label="Close" onClick={onClose}>×</button>
      <h4>Ghost Drop</h4>
      <p>Tiles light up under your feet and then vanish. Keep moving, or fall to the layer below. The last ghost standing wins.</p>
      {status}
      {button}
      <p className="mw-small mw-muted">No timer: a drop ends when one ghost is left, or when the last ones fall together.</p>
    </div>
  )
}
