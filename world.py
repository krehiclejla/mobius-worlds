"""Möbius Worlds on the Worlds Lobby: where ghosts may be, the shared Kart race and Ghost Drop.

Pure data and rules, no I/O. The world itself is Game Studio's "Worlds Lobby"
scene, which every player's browser runs; positions are that scene's metres
(x and z across the ground, y up). Each player's own game keeps them on the
ground and out of solid things, so the host only keeps reports finite and
inside the lobby's bounds.

The Kart Stand opens Möbius Kart. Races are host-authoritative: the host keeps
the shared start, the racers' reports and the best-times board. The Ghost Drop
Stand opens Ghost Drop (ghostdrop.py): the host keeps the round, the tiles and
who is out, and each player's own game moves their ghost.
"""

from __future__ import annotations

import math
import secrets

import ghostdrop

# Everything the lobby holds (main island, bridge, party island), with room to fall.
BOUNDS = {"x": (-70.0, 70.0), "y": (-40.0, 60.0), "z": (-60.0, 90.0)}
SPAWN = (0.0, 13.5)      # on the lamp-lit path, facing the Möbius crystal
SPAWN_SPREAD = 1.2       # (the camera starts 6 m behind: this keeps it clear of the lamps)
MAX_KART = 8          # best race times kept on the Möbius Kart board
# Live Möbius Kart races. Every racer drives their own copy of the game and reports
# where they are on the track (metres along it, lane, speed); everyone else draws them
# from those reports. The host only keeps the shared start and checks the times.
RACE_LEAD_MS = 5000          # from "Start" to the green light, so every guest hears about it
RACE_LOBBY_MS = 5 * 60_000   # an unstarted lobby closes after this
RACE_MAX_MS = 12 * 60_000    # a race is over after this, finished or not
RACE_SILENT_MS = 30_000      # a racer who stops reporting (closed the race) drops out
# Shared items: a Bug lies on the track until someone drives into it; a Page Plane
# chases its target. Each racer's own game decides whether it was hit.
ITEM_KINDS = ("bug", "plane")
ITEM_LIFE_MS = {"bug": 90_000, "plane": 12_000}
MAX_ITEMS = 30
MAX_RACERS = 8
MAX_KART_SPEED = 70          # metres a second, generous: boosts top out near 45
COOLDOWN_MS = 1200
# A racer who leaves a started race hands their kart to a bot the host drives: it keeps
# a steady computer-kart pace from where they were, weaving gently, and every screen draws
# it from the host's reports like any other kart. The finish line must match the game:
# CFG.LAPS (3) laps of the Möbius Twist Circuit (1761 m, as tools/race_bot.py drives).
KART_FINISH_M = 3 * 1761
BOT_KART_SPEED = 27.0        # an AI kart's ~30 m/s top speed, less the curves


def new_world() -> dict:
  return {"kart": [], "race": None, "cool": {}}


def spawn_point(rand) -> tuple[float, float, float, float]:
  """A spot near the crystal: (x, y, z, facing). y is unknown until the game lands it."""
  return (round(SPAWN[0] + (rand() * 2 - 1) * SPAWN_SPREAD, 2), 0.0,
          round(SPAWN[1] + (rand() * 2 - 1) * SPAWN_SPREAD, 2), 0.0)


def clamp_position(x, y, z, r):
  """A reported position kept finite and inside the lobby, or None when unusable."""
  values = (x, y, z)
  if not all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in values):
    return None
  fit = lambda v, key: round(min(BOUNDS[key][1], max(BOUNDS[key][0], float(v))), 2)
  facing = float(r) if isinstance(r, (int, float)) and not isinstance(r, bool) and math.isfinite(r) else 0.0
  return fit(x, "x"), fit(y, "y"), fit(z, "z"), round(math.remainder(facing, math.tau), 3)


def _cool(world: dict, key: str, now: int) -> bool:
  """True when the thing is ready again (and starts its cooldown)."""
  if now - world["cool"].get(key, 0) < COOLDOWN_MS:
    return False
  world["cool"][key] = now
  return True


def _race_time(seconds: float) -> str:
  return f"{int(seconds // 60)}:{seconds % 60:05.2f}"


def _num(value, lo: float, hi: float):
  if isinstance(value, bool) or not isinstance(value, (int, float)) or value != value:
    return None
  return max(lo, min(hi, float(value)))


def _place_word(race: dict, me: dict) -> str:
  place = 1 + sum(1 for r in race["racers"].values() if r["done"] and r["time"] < me["time"])
  return {1: "1st", 2: "2nd", 3: "3rd"}.get(place, f"{place}th")


def _hand_kart_to_bot(room: dict, race: dict, pid: str, now: int, push_event) -> None:
  """A racer left mid-race: a bot takes their kart from where it was."""
  r = race["racers"][pid]
  name = r["name"]
  r.update(bot=True, name=f"{name} (bot)", spin=False, bot_from=r["p"], bot_at=max(now, race["start"]),
           lane=sum(map(ord, pid)) % 7)
  push_event(room, now, "system", text=f"{name} left the race. A bot drives their kart home.")


def _bot_finish(room: dict, race: dict, r: dict, crossed: float, now: int, push_event) -> None:
  r.update(p=float(KART_FINISH_M), v=0.0, done=True, time=round((crossed - race["start"]) / 1000, 2), at=now)
  push_event(room, now, "system", text=f"{r['name']} finished {_place_word(race, r)} in Möbius Kart ({_race_time(r['time'])})")


def _bot_crossing(race: dict, r: dict) -> float:
  """When (host clock) this bot's kart reaches the finish at its steady pace."""
  return max(r["bot_at"], race["start"]) + (KART_FINISH_M - r["bot_from"]) / BOT_KART_SPEED * 1000


def _drive_kart_bots(room: dict, race: dict, now: int, push_event) -> None:
  if now < race["start"]:
    return
  for r in sorted(race["racers"].values(), key=lambda r: r.get("bot_at", 0)):
    if not r.get("bot") or r["done"]:
      continue
    crossed = _bot_crossing(race, r)
    if now >= crossed:
      _bot_finish(room, race, r, crossed, now, push_event)
      continue
    p = r["bot_from"] + BOT_KART_SPEED * (now - max(r["bot_at"], race["start"])) / 1000
    r.update(p=round(p, 1), v=BOT_KART_SPEED, at=now, d=round(2.5 * math.sin(now / 2300 + r["lane"]), 2))


def race_advance(room: dict, now: int, push_event) -> None:
  """Seat bots for racers who left mid-race, drive them, and close lobbies and races that are over."""
  world = room.setdefault("world", new_world())
  race = world.get("race")
  if not race:
    return
  racers = race["racers"]
  gone = [pid for pid, r in racers.items() if pid not in room["players"] and not r["done"] and not r.get("bot")]
  if race["state"] == "lobby":
    for pid in gone:  # leaving before the start just frees the place
      del racers[pid]
  elif race["state"] == "running":
    silent = [pid for pid, r in racers.items()
              if not r["done"] and not r.get("bot") and now - max(r["at"], race["start"]) > RACE_SILENT_MS]
    for pid in dict.fromkeys(gone + silent):
      _hand_kart_to_bot(room, race, pid, now, push_event)
    _drive_kart_bots(room, race, now, push_event)
  if race.get("items"):
    race["items"] = [i for i in race["items"] if now - i["at"] < ITEM_LIFE_MS[i["kind"]]]
  if race["state"] == "lobby" and (not racers or now - race["created"] > RACE_LOBBY_MS):
    world["race"] = None
  elif race["state"] == "running" and (not racers or now - race["start"] > RACE_MAX_MS
                                       or not any(pid in room["players"] and not r["done"] and not r.get("bot")
                                                  for pid, r in racers.items())
                                       or all(r["done"] for r in racers.values())):
    # nobody real is still racing: the bots are placed at the times their pace would bring them home
    for r in sorted((r for r in racers.values() if r.get("bot") and not r["done"]), key=lambda r: _bot_crossing(race, r)):
      if now - race["start"] <= RACE_MAX_MS:
        _bot_finish(room, race, r, max(now, _bot_crossing(race, r)), now, push_event)
    race["state"] = "done"
    race["ended"] = now


def _record_best(world: dict, pid: str, player: dict, seconds: float, place: int, now: int) -> None:
  # one line per person: a guest who rejoins gets a new seat but is the same ghost
  who = f"{player.get('home', '')}|{player['name']}"
  board = world.setdefault("kart", [])
  entry = {"pid": pid, "who": who, "name": player["name"], "color": player["color"],
           "time": round(seconds, 2), "place": place, "t": now}
  best = next((e for e in board if e.get("who", e["pid"]) == who), None)
  if best is None or entry["time"] < best["time"]:
    board[:] = [e for e in board if e.get("who", e["pid"]) != who] + [entry]
    board.sort(key=lambda e: e["time"])
    del board[MAX_KART:]


def _race_action(room: dict, world: dict, pid: str, player: dict, action: dict, now: int, push_event) -> bool:
  kind = action["t"]
  race = world.get("race")
  me = race["racers"].get(pid) if race else None
  if me and me.get("bot"):
    me = None  # they left this race: their kart is the bot's now
  if kind == "race_join":
    if race and race["state"] == "running":
      push_event(room, now, "system", to=pid, text="A race is on. Join the next one!")
      return False
    if not race or race["state"] == "done":
      race = world["race"] = {"id": secrets.token_hex(4), "state": "lobby", "created": now, "racers": {}}
      push_event(room, now, "system", pid=pid, text=f"{player['name']} opened a Möbius Kart race. Join at the track!")
    if pid not in race["racers"]:
      if len(race["racers"]) >= MAX_RACERS:
        push_event(room, now, "system", to=pid, text="This race is full.")
        return False
      race["racers"][pid] = {"name": player["name"], "color": player["color"],
                             "p": 0.0, "d": 0.0, "v": 0.0, "at": now, "done": False, "time": None}
    return True
  if kind == "race_leave":
    if not me or me["done"]:
      return False
    if race["state"] == "running":
      _hand_kart_to_bot(room, race, pid, now, push_event)
    else:
      del race["racers"][pid]
    race_advance(room, now, push_event)
    return True
  if kind == "race_go":
    if not me or race["state"] != "lobby":
      return False
    race["state"] = "running"
    race["start"] = now + RACE_LEAD_MS
    push_event(room, now, "system", pid=pid, text=f"{player['name']} started the Möbius Kart race")
    return True
  if kind == "race_item":
    if not me or me["done"] or race["state"] != "running" or now < race["start"]:
      return False
    item_kind, target = action.get("kind"), action.get("target")
    p = _num(action.get("p"), -60, 50_000)
    d = _num(action.get("d"), -8, 8)
    if item_kind not in ITEM_KINDS or p is None or d is None or abs(p - me["p"]) > 200:
      return False
    if target is not None and (target == pid or target not in race["racers"]):
      target = None
    if not _cool(world, f"item:{pid}", now):
      return False
    items = race.setdefault("items", [])
    items.append({"id": secrets.token_hex(3), "kind": item_kind, "by": pid, "p": round(p, 1), "d": round(d, 2),
                  "target": target, "at": now})
    del items[:-MAX_ITEMS]
    return True
  if kind == "race_item_gone":
    items = race.get("items", []) if race else []
    before = len(items)
    # a Bug is gone for everyone once someone drove into it; a plane once it hit its target
    items[:] = [i for i in items if not (i["id"] == action.get("id") and (i["kind"] == "bug" or i["target"] == pid))]
    return len(items) != before
  if kind == "race_state":
    if not me or me["done"] or race["state"] != "running" or now < race["start"]:
      return False
    p = _num(action.get("p"), -60, 50_000)
    d = _num(action.get("d"), -8, 8)
    v = _num(action.get("v"), -15, MAX_KART_SPEED)
    if p is None or d is None or v is None:
      return False
    # nobody drives faster than a boosted kart between two reports
    reach = me["p"] + MAX_KART_SPEED * max(0, now - me["at"]) / 1000 + 20
    me.update({"p": round(min(p, reach), 1), "d": round(d, 2), "v": round(v, 1), "at": now, "spin": bool(action.get("s"))})
    return True
  if kind == "race_finish":
    if not me or me["done"] or race["state"] != "running":
      return False
    seconds = _num(action.get("time"), 0, 3600)
    elapsed = (now - race["start"]) / 1000
    # the time is the racer's own clock from the shared start: it cannot beat the
    # host's clock, and a report may arrive a few syncs late
    if seconds is None or seconds < 20 or seconds > elapsed + 2 or seconds < elapsed - 30:
      return False
    me.update({"done": True, "time": round(seconds, 2), "at": now})
    place = 1 + sum(1 for r in race["racers"].values() if r["done"] and r["time"] < me["time"])
    _record_best(world, pid, player, seconds, place, now)
    word = {1: "1st", 2: "2nd", 3: "3rd"}.get(place, f"{place}th")
    push_event(room, now, "system", pid=pid,
               text=f"{player['name']} finished {word} in Möbius Kart ({_race_time(me['time'])})")
    race_advance(room, now, push_event)
    return True
  return False


def interact(room: dict, pid: str, action: dict, now: int, push_event) -> bool:
  """Apply one shared action. Returns True when the world changed."""
  world = room.setdefault("world", new_world())
  kind = action.get("t")
  if isinstance(kind, str) and kind.startswith("race_"):
    return _race_action(room, world, pid, room["players"][pid], action, now, push_event)
  if isinstance(kind, str) and kind.startswith("gd_"):
    return ghostdrop.action(room, world, pid, room["players"][pid], action, now, push_event)
  return False


def advance(room: dict, now: int, push_event) -> None:
  """Move every shared game on the island along: races close, Ghost Drop rounds turn."""
  race_advance(room, now, push_event)
  ghostdrop.advance(room, now, push_event)


def view(room: dict) -> dict:
  world = room.get("world") or new_world()
  return {k: v for k, v in world.items() if k != "cool"}
