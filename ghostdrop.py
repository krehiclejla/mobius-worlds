"""Ghost Drop on the Worlds Lobby: a host-authoritative elimination round.

Ghosts stand on stacked hex layers. A tile lights when someone steps on it and
vanishes a moment later; a ghost left without ground falls to the layer below,
and falling past the bottom layer takes it out. The last ghost standing wins.
When the final ghosts fall together, the one who fell last wins.

The host keeps the round: who is in it, when it starts, which tiles have been
stepped on (and so when they vanish, stamped on the host's clock), who is out,
and the winner. Each player's own game moves their ghost and reports where it
is. The layout and timings come from the Ghost Drop game's config block, which
tools/bundle_ghostdrop.py copies into ghostdrop_config.json.
"""

from __future__ import annotations

import json
import math
import random
import secrets
from pathlib import Path

_CONFIG = json.loads(Path(__file__).with_name("ghostdrop_config.json").read_text(encoding="utf-8"))

# The game caps its arena at ten layers and at least two rings; the rules follow the same numbers.
LAYERS = max(1, min(10, int(_CONFIG["layers"])))
RINGS = max(2, int(_CONFIG["tileRadius"]))
TILE_SIZE = float(_CONFIG["tileSize"])
LAYER_GAP = float(_CONFIG["layerGap"])
TILE_DELAY_MS = int(_CONFIG["tileDelayMs"])
MIN_PLAYERS = max(2, int(_CONFIG["minPlayers"]))
MAX_PLAYERS = int(_CONFIG["maxPlayers"])
COUNTDOWN_MS = int(_CONFIG["countdownMs"])
GRACE_MS = int(_CONFIG["finishGraceMs"])          # time the last ghosts get to fall together
WINNER_MS = int(_CONFIG["winnerMs"])

LOBBY_MS = 5 * 60_000        # an unstarted drop closes after this
SILENT_MS = 30_000           # a ghost that stops reporting (closed tab) falls out
DONE_KEEP_MS = 2 * 60_000    # a finished drop is kept this long, for anyone still watching
VOID_Y = -(LAYERS - 1) * LAYER_GAP - 3.0
SQ3 = math.sqrt(3)

# A ghost whose player leaves a started drop is handed to a bot the host plays from where
# the ghost was: it hops to unlit neighbouring tiles (lighting them as it goes, like anyone),
# falls through holes, and can drop out like anyone. It runs on the host's clock in small
# steps, so every screen sees the same bot through its ordinary position reports.
BOT_SPEED = float(_CONFIG["moveSpeed"]) * 0.8
GRAVITY = float(_CONFIG["gravity"])
FALL_SPEED = float(_CONFIG["fallSpeed"])
BOT_STEP_MS = 50
BOT_CATCHUP_MS = 10_000      # a room nobody polled for a while only replays this much
BOT_PAUSE_MS = 220           # the longest a bot lingers on a tile before moving on
BOT_SLIP = 0.15              # how often a bot picks any open tile rather than the safest
NEIGHBOURS = ((1, 0), (-1, 0), (0, 1), (0, -1), (1, -1), (-1, 1))


def _finite(value) -> bool:
  return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _in_arena(q: int, r: int) -> bool:
  return max(abs(q), abs(r), abs(q + r)) <= RINGS


def _center(q: int, r: int) -> tuple[float, float]:
  """Pointy-top axial hex centre, the same layout the game draws."""
  return TILE_SIZE * (SQ3 * q + SQ3 / 2 * r), TILE_SIZE * 1.5 * r


def _layer_y(layer: int) -> float:
  return -layer * LAYER_GAP


def _hex_at(x: float, z: float):
  """The arena hex under a point, (q, r), or None off the edge: the game's hexAt."""
  r0 = z / (1.5 * TILE_SIZE)
  q0 = (x / TILE_SIZE - SQ3 / 2 * r0) / SQ3
  y0 = -q0 - r0
  q, r, y = round(q0), round(r0), round(y0)
  dq, dy, dr = abs(q - q0), abs(y - y0), abs(r - r0)
  if dq > dy and dq > dr:
    q = -y - r
  elif dy <= dr:
    r = -q - y
  return (q, r) if _in_arena(q, r) else None


def _spawn_spot(index: int, count: int) -> tuple[int, int]:
  """Where the game spawns the index-th of count ghosts: spread round the second ring."""
  ring = sorted(((q, r) for q in range(-RINGS, RINGS + 1) for r in range(-RINGS, RINGS + 1)
                 if _in_arena(q, r) and max(abs(q), abs(r), abs(q + r)) == 2),
                key=lambda h: math.atan2(_center(*h)[1], _center(*h)[0]))
  return ring[(index * len(ring) // max(1, count)) % len(ring)]


def _parse_tile(text):
  """'L:q:r' inside the arena, or None. Only the canonical spelling is accepted."""
  if not isinstance(text, str):
    return None
  parts = text.split(":")
  if len(parts) != 3:
    return None
  try:
    layer, q, r = (int(part) for part in parts)
  except ValueError:
    return None
  tile = f"{layer}:{q}:{r}"
  if tile != text or not (0 <= layer < LAYERS) or not _in_arena(q, r):
    return None
  return tile, layer, q, r


def _pos(action: dict):
  """A ghost's reported spot, kept finite and inside the Worlds lobby's reach, or None."""
  if not all(_finite(action.get(k)) for k in ("x", "y", "z")):
    return None
  r = action.get("r") if _finite(action.get("r")) else 0.0
  return {
    "x": round(min(500.0, max(-500.0, float(action["x"]))), 2),
    "y": round(min(60.0, max(-300.0, float(action["y"]))), 2),
    "z": round(min(500.0, max(-500.0, float(action["z"]))), 2),
    "r": round(math.remainder(float(r), math.tau), 3),
  }


def _near(pos, layer: int, q: int, r: int) -> bool:
  """A step counts when the ghost is standing on that tile's layer, close to its centre."""
  if pos is None:
    return False
  cx, cz = _center(q, r)
  return math.hypot(pos["x"] - cx, pos["z"] - cz) <= TILE_SIZE * 2.0 and abs(pos["y"] - _layer_y(layer)) <= 1.0


def _new_round(now: int) -> dict:
  return {"id": secrets.token_hex(4), "state": "lobby", "created": now, "startAt": 0,
          "min": MIN_PLAYERS, "max": MAX_PLAYERS,
          "order": [], "racers": {}, "tiles": {}, "winner": None, "closing": None, "ended": None}


def _racer(player: dict, now: int) -> dict:
  return {"name": player["name"], "color": player["color"], "pos": None, "at": now, "out_at": None}


def _phase(rnd: dict, now: int) -> None:
  if rnd["state"] == "countdown" and now >= rnd["startAt"]:
    rnd["state"] = "running"


def _drop(room: dict, rnd: dict, pid: str, when: int, now: int, push_event, text: str) -> None:
  rnd["racers"][pid]["out_at"] = when
  push_event(room, now, "system", pid=pid, text=text)


def _finish(room: dict, rnd: dict, now: int, alive: list[str], push_event) -> None:
  racers = rnd["racers"]
  if alive:
    winner = alive[0]
  else:
    # everyone is out: the one who fell last wins; a dead heat has no winner
    falls = sorted(((r["out_at"], pid) for pid, r in racers.items()), reverse=True)
    winner = falls[0][1] if falls and (len(falls) == 1 or falls[0][0] != falls[1][0]) else None
  rnd.update({"state": "done", "winner": winner, "ended": now})
  if winner:
    push_event(room, now, "system", pid=winner, text=f"{racers[winner]['name']} wins the Ghost Drop!")
  else:
    push_event(room, now, "system", text="Everyone fell together. No winner this drop.")


def _standing(rnd: dict, tile: str, at: float) -> bool:
  """A tile holds a ghost until the moment it vanishes."""
  lit = rnd["tiles"].get(tile)
  return lit is None or at < lit["vanishAt"]


def _hand_ghost_to_bot(room: dict, rnd: dict, pid: str, now: int, push_event) -> None:
  """A player left mid-drop: a bot takes their ghost from where it was."""
  me = rnd["racers"][pid]
  name = me["name"]
  if me["pos"]:
    x, y, z = me["pos"]["x"], me["pos"]["y"], me["pos"]["z"]
  else:
    x, z = _center(*_spawn_spot(rnd["order"].index(pid), len(rnd["order"])))
    y = _layer_y(0)
  layer = min(LAYERS - 1, max(0, round(-y / LAYER_GAP)))
  hex_ = _hex_at(x, z)
  tile = f"{layer}:{hex_[0]}:{hex_[1]}" if hex_ else None
  on_ground = tile is not None and abs(y - _layer_y(layer)) <= 0.6 and _standing(rnd, tile, now)
  me["name"] = f"{name} (bot)"
  me["bot"] = {"x": x, "y": _layer_y(layer) if on_ground else y, "z": z, "vy": 0.0, "layer": layer,
               "ground": tile if on_ground else None, "goal": None, "wait": 0.0,
               "face": me["pos"]["r"] if me["pos"] else 0.0, "t": max(now, rnd["startAt"])}
  push_event(room, now, "system", text=f"{name} left the drop. A bot floats on for them.")


def _bot_goal(rnd: dict, layer: int, q: int, r: int):
  """The next tile to hop to: an unlit neighbour, ideally one with plenty of unlit ground round it."""
  def open_(q2, r2):
    return _in_arena(q2, r2) and f"{layer}:{q2}:{r2}" not in rnd["tiles"]
  choices = [(q + dq, r + dr) for dq, dr in NEIGHBOURS if open_(q + dq, r + dr)]
  if not choices:
    return None
  if random.random() < BOT_SLIP:
    return random.choice(choices)
  room_round = lambda h: sum(open_(h[0] + dq, h[1] + dr) for dq, dr in NEIGHBOURS) + random.random() * 1.5
  return max(choices, key=room_round)


def _bot_step(room: dict, rnd: dict, pid: str, b: dict, t: float, push_event) -> None:
  """Move one bot ghost on by BOT_STEP_MS of host time ending at t."""
  dt = BOT_STEP_MS / 1000
  if b["ground"]:
    hex_ = _hex_at(b["x"], b["z"])
    tile = hex_ and f"{b['layer']}:{hex_[0]}:{hex_[1]}"
    if not tile or not _standing(rnd, tile, t):
      b["ground"], b["vy"], b["goal"] = None, 0.0, None   # the floor went: fall
    else:
      b["ground"] = tile
      if tile not in rnd["tiles"]:
        rnd["tiles"][tile] = {"stepAt": int(t), "vanishAt": int(t) + TILE_DELAY_MS, "by": pid}
      if b["goal"] is None and b["wait"] <= 0:
        b["goal"] = _bot_goal(rnd, b["layer"], *hex_)
      if b["goal"] is not None:
        gx, gz = _center(*b["goal"])
        dx, dz = gx - b["x"], gz - b["z"]
        dist = math.hypot(dx, dz)
        reach = BOT_SPEED * dt
        if dist <= reach:
          b["x"], b["z"], b["goal"] = gx, gz, None
          b["wait"] = random.random() * BOT_PAUSE_MS
        else:
          b["x"] += dx / dist * reach
          b["z"] += dz / dist * reach
          b["face"] = math.atan2(dx, dz)
      else:
        b["wait"] -= BOT_STEP_MS
      return
  prev_y = b["y"]
  b["vy"] = max(-FALL_SPEED, b["vy"] - GRAVITY * dt)
  b["y"] += b["vy"] * dt
  hex_ = _hex_at(b["x"], b["z"])
  if hex_:
    for layer in range(LAYERS):
      top = _layer_y(layer)
      if top > prev_y + 1e-4:
        continue
      if top < b["y"] - 1e-4:
        break
      tile = f"{layer}:{hex_[0]}:{hex_[1]}"
      if _standing(rnd, tile, t):
        b.update(y=top, vy=0.0, layer=layer, ground=tile, goal=None, wait=0.0)
        return
  if b["y"] < VOID_Y:
    _drop(room, rnd, pid, int(t), int(t), push_event, f"{rnd['racers'][pid]['name']} dropped out")


def _run_bots(room: dict, rnd: dict, now: int, push_event) -> None:
  """Play every bot ghost up to now, step by step together, so they share the tiles fairly."""
  bots = [(pid, r) for pid, r in rnd["racers"].items() if r.get("bot") and r["out_at"] is None]
  for _, r in bots:
    r["bot"]["t"] = max(r["bot"]["t"], now - BOT_CATCHUP_MS)
  while True:
    due = [(pid, r) for pid, r in bots if r["out_at"] is None and r["bot"]["t"] + BOT_STEP_MS <= now]
    if not due:
      break
    for pid, r in due:
      r["bot"]["t"] += BOT_STEP_MS
      _bot_step(room, rnd, pid, r["bot"], r["bot"]["t"], push_event)
  for _, r in bots:
    b = r["bot"]
    r["pos"] = {"x": round(b["x"], 2), "y": round(b["y"], 2), "z": round(b["z"], 2), "r": round(b["face"], 3)}
    r["at"] = now


def action(room: dict, world: dict, pid: str, player: dict, act: dict, now: int, push_event) -> bool:
  """Apply one Ghost Drop action. Returns True when the round changed."""
  kind = act["t"]
  rnd = world.get("gd")
  if rnd:
    _phase(rnd, now)
  me = rnd["racers"].get(pid) if rnd else None
  if me and me.get("bot"):
    me = None  # they left this drop: their ghost is the bot's now
  if kind == "gd_join":
    if rnd is None or rnd["state"] == "done":
      rnd = world["gd"] = _new_round(now)
      push_event(room, now, "system", pid=pid, text=f"{player['name']} opened a Ghost Drop. Jump in!")
    if rnd["state"] != "lobby":
      push_event(room, now, "system", to=pid, text="A drop is on. Join the next one!")
      return False
    if pid in rnd["racers"]:
      return False
    if len(rnd["racers"]) >= MAX_PLAYERS:
      push_event(room, now, "system", to=pid, text="This drop is full.")
      return False
    rnd["racers"][pid] = _racer(player, now)
    rnd["order"].append(pid)
    return True
  if kind == "gd_leave":
    if not me or rnd["state"] == "done":
      return False
    if rnd["state"] == "lobby":
      del rnd["racers"][pid]
      rnd["order"].remove(pid)
    elif me["out_at"] is None:
      _hand_ghost_to_bot(room, rnd, pid, now, push_event)
    return True
  if kind == "gd_go":
    if not me or rnd["state"] != "lobby" or len(rnd["racers"]) < MIN_PLAYERS:
      return False
    rnd.update({"state": "countdown", "startAt": now + COUNTDOWN_MS})
    push_event(room, now, "system", pid=pid, text=f"{player['name']} started the Ghost Drop")
    return True
  if kind == "gd_pos":
    pos = _pos(act)
    if not me or me["out_at"] is not None or pos is None or rnd["state"] not in ("countdown", "running"):
      return False
    me.update({"pos": pos, "at": now})
    return True
  if kind == "gd_step":
    if not me or me["out_at"] is not None or rnd["state"] != "running":
      return False
    parsed = _parse_tile(act.get("tile"))
    if parsed is None:
      return False
    tile, layer, q, r = parsed
    # a tile lights once, stamped on the host's clock, and never comes back this round
    if tile in rnd["tiles"] or not _near(me["pos"], layer, q, r):
      return False
    rnd["tiles"][tile] = {"stepAt": now, "vanishAt": now + TILE_DELAY_MS, "by": pid}
    return True
  if kind == "gd_out":
    if not me or me["out_at"] is not None or rnd["state"] != "running":
      return False
    y = act.get("y")
    if not _finite(y) or y > VOID_Y + 1.5:
      return False
    # the time the ghost fell, as its own game saw it, decides who fell last in a tie
    at = act.get("at")
    fell = int(at) if _finite(at) and now - 15_000 <= at <= now + 1_000 else now
    _drop(room, rnd, pid, fell, now, push_event, f"{player['name']} dropped out")
    return True
  return False


def advance(room: dict, now: int, push_event) -> None:
  """Let time move the round: start it, drop the absent, and decide the winner."""
  world = room.get("world") or {}
  rnd = world.get("gd")
  if not rnd:
    return
  racers = rnd["racers"]
  if rnd["state"] == "lobby":
    for pid in [p for p in rnd["order"] if p not in room["players"]]:
      del racers[pid]
      rnd["order"].remove(pid)
    if not racers or now - rnd["created"] > LOBBY_MS:
      world["gd"] = None
    return
  if rnd["state"] == "done":
    if now - rnd["ended"] > DONE_KEEP_MS:
      world["gd"] = None
    return
  _phase(rnd, now)
  for pid, r in racers.items():
    if r["out_at"] is None and not r.get("bot") and (
        pid not in room["players"] or (rnd["state"] == "running" and now - r["at"] > SILENT_MS)):
      _hand_ghost_to_bot(room, rnd, pid, now, push_event)
  if not any(pid in room["players"] and not r.get("bot") for pid, r in racers.items()):
    # everyone real has gone: nobody is watching, so the bots stop and the drop ends
    for r in racers.values():
      if r["out_at"] is None:
        r["out_at"] = now
  elif rnd["state"] == "running":
    _run_bots(room, rnd, now, push_event)
  alive = [pid for pid in rnd["order"] if racers[pid]["out_at"] is None]
  if len(alive) <= 1 and rnd["closing"] is None:
    rnd["closing"] = now
  if rnd["closing"] is not None and now - rnd["closing"] >= GRACE_MS:
    _finish(room, rnd, now, alive, push_event)
