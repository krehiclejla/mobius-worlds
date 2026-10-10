// The Kart Stand's card: the shared race's state, a way in, and the best times.
// Also the island's results card, shown to everyone in the session when a race ends.
import React, { useEffect, useRef, useState } from 'react'

const raceTime = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, '0')}`
const ord = (n) => n + (['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] || 'th')

// A race's real racers in finishing order: finishers by time, then anyone who didn't finish.
export function raceStandings(race) {
  return Object.entries(race?.racers || {})
    .map(([pid, r]) => ({ pid, name: r.name, color: r.color, done: !!r.done, time: r.time, p: r.p || 0 }))
    .sort((a, b) => (a.done && b.done) ? a.time - b.time : a.done ? -1 : b.done ? 1 : b.p - a.p)
}

function StandingsList({ rows, you }) {
  return (
    <ol className="mw-kart-board mw-results-list">
      {rows.map((r, i) => (
        <li key={r.pid} className={r.pid === you ? 'you' : ''}>
          <span className="mw-place">{r.done ? ord(i + 1) : '–'}</span>
          <span className="mw-kart-dot" style={{ background: r.color }} />
          <b>{r.name}{r.pid === you ? ' (you)' : ''}</b>
          <span>{r.done ? raceTime(r.time) : 'did not finish'}</span>
        </li>
      ))}
    </ol>
  )
}

// When a race on the island ends, everyone in the session gets the final places.
export function RaceResults({ race, you, hidden }) {
  const [shown, setShown] = useState(null)
  const seen = useRef(race?.state === 'done' ? race.id : null) // a race already over when you arrived
  useEffect(() => {
    if (race?.state !== 'done' || seen.current === race.id) return
    seen.current = race.id
    const rows = raceStandings(race)
    if (rows.some((r) => r.done)) setShown({ id: race.id, rows })
  }, [race])
  useEffect(() => {
    if (!shown) return undefined
    const timer = setTimeout(() => setShown(null), 30000)
    return () => clearTimeout(timer)
  }, [shown])
  if (!shown || hidden) return null
  const mine = shown.rows.findIndex((r) => r.pid === you)
  const winner = shown.rows[0]
  return (
    <div className="mw-portal-card mw-results" role="status" aria-label="Möbius Kart results">
      <button type="button" className="mw-card-x" aria-label="Close results" onClick={() => setShown(null)}>×</button>
      <h4>Möbius Kart results</h4>
      <p>{mine >= 0 && shown.rows[mine].done
        ? (mine === 0 ? 'You won the race!' : `You finished ${ord(mine + 1)}. ${winner.name} won.`)
        : `${winner.name} won the race.`}</p>
      <StandingsList rows={shown.rows} you={you} />
    </div>
  )
}

export default function KartCard({ snap, onRace, onClose }) {
  const world = snap.world || {}
  const board = world.kart || []
  const race = world.race
  const names = (ids) => ids.map((pid) => snap.players.find((p) => p.pid === pid)?.name || race?.racers?.[pid]?.name).filter(Boolean).join(', ')
  const racerIds = Object.keys(race?.racers || {})
  const inRace = racerIds.includes(snap.you)
  let status = null
  let button = <button type="button" className="mw-btn primary mw-wide" onClick={onRace}>Start a race</button>
  if (race?.state === 'lobby') {
    status = <p className="mw-small"><b>Race lobby:</b> {names(racerIds)}. Join before someone presses Start.</p>
    button = <button type="button" className="mw-btn primary mw-wide" onClick={onRace}>{inRace ? 'Back to the race lobby' : 'Join the race'}</button>
  } else if (race?.state === 'running') {
    status = <p className="mw-small"><b>Race on:</b> {names(racerIds)}. The next one opens when they finish.</p>
    button = <button type="button" className="mw-btn mw-wide" disabled>Race in progress</button>
  } else if (race?.state === 'done') {
    const rows = raceStandings(race)
    if (rows.some((r) => r.done)) status = <><p className="mw-small" style={{ marginBottom: 4 }}><b>Last race</b></p><StandingsList rows={rows} you={snap.you} /><div style={{ height: 12 }} /></>
  }
  return (
    <div className="mw-portal-card mw-action" role="dialog" aria-label="Möbius Kart">
      <button type="button" className="mw-card-x" aria-label="Close" onClick={onClose}>×</button>
      <h4>Möbius Kart</h4>
      <p>Race everyone in the lobby around the Möbius Twist Circuit. Every other lap runs upside down.</p>
      {status}
      {button}
      <p className="mw-small mw-muted">You drive your own ghost and see the other racers live. Computer ghosts fill the empty places.</p>
      {board.length > 0
        ? <><p className="mw-small"><b>Best times</b></p><ol className="mw-kart-board">{board.map((e) => (
            <li key={e.who || e.pid}><span className="mw-kart-dot" style={{ background: e.color }} /><b>{e.name}</b><span>{raceTime(e.time)}</span></li>
          ))}</ol></>
        : <p className="mw-small mw-muted">No times yet. Set the first one!</p>}
    </div>
  )
}
