"""Möbius Worlds room model: pure, host-authoritative session logic.

A room lives on the instance that started it. Every participant (the host's
own browser and guests relayed from other instances) talks to it through one
coalesced ``sync``: queued actions go up, a viewer-specific snapshot comes
down. There is no background clock. ``advance`` moves timed phases forward
from wall time on every request, so a room that nobody polls simply pauses.

Everything here is I/O free; ``store.py`` owns files and locking.
"""

from __future__ import annotations

import hashlib
import hmac
import math
import re
import random
import secrets
import string
import time
import unicodedata

import world as island

MAX_PLAYERS = 8
MAX_EVENTS = 80
MAX_DISPLAYS = 6  # apps players have put on display next to the App Store stand
AWAY_AFTER_MS = 30_000
# Each ghost's recent path, so everyone can replay its walk smoothly between syncs
# (a guest may sync only every couple of seconds): [server ms, x, y, z, facing].
TRAIL_MS = 5000
TRAIL_MAX = 28
DROP_AFTER_MS = 120_000
# Worlds declares 600 public requests a minute (mobius.json); remote guests share
# 90% of it, since behind a hosting proxy they can all count as one caller.
PUBLIC_BUDGET_PER_MIN = 540
GUEST_FASTEST_MS = 250  # about four syncs a second per guest at most
# Ghost colours offered in the customizer; the first is the Hackaton Rewards pal grey.
GHOST_COLORS = (
  "#c8cdd6", "#f8f9fb", "#c9b8f5", "#9fe3c8", "#9cd3ff", "#ffc7a8",
  "#ffb3cf", "#ffe38a", "#8f6fd1", "#3b3552",
)
# Earlier Worlds releases used these; still accepted from older instances.
LEGACY_COLORS = (
  "#ff6b6b", "#ffa94d", "#ffd43b", "#69db7c", "#38d9a9",
  "#4dabf7", "#748ffc", "#da77f2", "#f783ac", "#e9ecef",
)
COLORS = GHOST_COLORS + LEGACY_COLORS
# Outfit slots. Each value names a model in models.js (slot_value), "none" is empty.
OUTFIT = {
  "face": ("dots", "mystery", "happy", "sleepy", "starry"),
  "hat": ("none", "mobius_cap", "beanie", "crown", "party", "headphones", "mobius_halo"),
  "neck": ("none", "mobius_scarf", "bowtie", "lanyard"),
  "hold": ("none", "mobius_mug", "tote", "pencil", "balloon"),
}
LEGACY_HATS = {"cap": "mobius_cap", "leaf": "none", "bow": "none"}
HATS = OUTFIT["hat"]
# Seats: the Chat Café's private table (two seats) and the plaza benches (two seats each, nothing private). Whatever a seated ghost says goes only to the
# ghosts at the same table (itself included); bubbles and the chat feed never reach anyone else.
SEATS = ("cafe:0", "cafe:1") + tuple(f"bench:{b}:{k}" for b in range(1, 5) for k in range(2))  # benches: two seats each, public chat
EMOTES = ("wave", "heart", "laugh", "wow", "dance", "sleep", "boba", "fireworks")


class RoomError(Exception):
  def __init__(self, status: int, detail: str):
    super().__init__(detail)
    self.status = status
    self.detail = detail


def now_ms() -> int:
  return int(time.time() * 1000)


def new_code(existing: set[str]) -> str:
  alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
  for _ in range(200):
    code = "".join(secrets.choice(alphabet) for _ in range(5))
    if code not in existing:
      return code
  raise RoomError(503, "Could not allocate a room code.")


def _hash_secret(secret: str) -> str:
  return hashlib.sha256(secret.encode()).hexdigest()


def clean_text(value, limit: int) -> str:
  if not isinstance(value, str):
    return ""
  text = unicodedata.normalize("NFC", value)
  text = "".join(ch for ch in text if ch.isprintable())
  return " ".join(text.split())[:limit]


def clean_profile(raw) -> dict:
  raw = raw if isinstance(raw, dict) else {}
  name = clean_text(raw.get("name"), 24) or "Guest"
  color = raw.get("color") if raw.get("color") in COLORS else GHOST_COLORS[0]
  profile = {"name": name, "color": color}
  for slot, options in OUTFIT.items():
    value = raw.get(slot)
    if slot == "hat":
      value = LEGACY_HATS.get(value, value)
    profile[slot] = value if value in options else options[0]
  return profile


def clean_origin(value) -> str:
  """Canonical https origin of a Möbius instance (scheme + host[:port])."""
  if not isinstance(value, str):
    return ""
  text = value.strip().lower()
  if not text:
    return ""
  if "://" not in text:
    text = "https://" + text
  scheme, _, rest = text.partition("://")
  host = rest.split("/", 1)[0].split("?", 1)[0].split("#", 1)[0]
  if scheme not in ("https", "http") or not host or "@" in host:
    return ""
  allowed = set(string.ascii_lowercase + string.digits + ".-:[]")
  if any(ch not in allowed for ch in host) or len(host) > 253:
    return ""
  return f"{scheme}://{host}"


# ---------------------------------------------------------------- creation

def create_room(*, code: str, title: str, listed: bool, host_profile: dict,
                host_origin: str, now: int, host_home: str | None = None) -> tuple[dict, str, str]:
  """A room on this instance. Its owner hosts from seat "h"; a visitor on the
  public link (``host_home="browser"``) hosts from an ordinary seat with a secret."""
  room = {
    "v": 1,
    "code": code,
    "title": clean_text(title, 40) or f"{host_profile['name']}'s place",
    "listed": bool(listed),
    "created": now,
    "host_origin": host_origin,
    "activity": "plaza",
    "seq": 0,
    "players": {},
    "events": [],
    "world": island.new_world(),
  }
  pid, secret = add_player(room, host_profile, host_home or host_origin, now, is_host=True)
  room["host_pid"] = pid
  return room, pid, secret


def host_pid(room: dict) -> str:
  return room.get("host_pid", "h")


def visitor_hosted(room: dict) -> bool:
  """Started by a public-link visitor rather than this instance's owner."""
  return host_pid(room) != "h"


def add_player(room: dict, profile: dict, home: str, now: int, *,
               is_host: bool = False) -> tuple[str, str]:
  active = [p for p in room["players"].values()]
  if len(active) >= MAX_PLAYERS:
    raise RoomError(409, "This session is full.")
  profile = clean_profile(profile)
  pid = "h" if is_host and home == room["host_origin"] else "p" + secrets.token_hex(4)
  while pid in room["players"]:
    pid = "p" + secrets.token_hex(4)
  secret = secrets.token_urlsafe(24)
  # Spawn in a loose ring in front of the Möbius crystal.
  x, y, z, r = island.spawn_point(random.random)
  room["players"][pid] = {
    **profile,
    "home": home,
    "is_host": is_host,
    "secret": _hash_secret(secret),
    "joined": now,
    "seen": now,
    "x": x, "y": y, "z": z, "r": r, "t0": now, "landed": False,
    "emote": None,
    "seat": None,
  }
  push_event(room, now, "join", pid=pid, text=f"{profile['name']} arrived")
  return pid, secret


def authenticate(room: dict, pid, secret) -> dict:
  player = room["players"].get(pid) if isinstance(pid, str) else None
  if player is None or not isinstance(secret, str):
    raise RoomError(403, "You are not in this session.")
  if not hmac.compare_digest(player["secret"], _hash_secret(secret)):
    raise RoomError(403, "You are not in this session.")
  return player


def push_event(room: dict, now: int, kind: str, *, pid: str | None = None,
               text: str = "", to: str | None = None, **extra) -> None:
  room["seq"] += 1
  event = {"seq": room["seq"], "t": now, "kind": kind, "pid": pid, "text": text}
  if to:
    event["to"] = to
  event.update(extra)
  room["events"].append(event)
  if len(room["events"]) > MAX_EVENTS:
    del room["events"][: len(room["events"]) - MAX_EVENTS]


def touch(room: dict) -> None:
  room["seq"] += 1


# ---------------------------------------------------------------- movement

def move(player: dict, action: dict, now: int) -> bool:
  """Take a player's own report of where their ghost is (their game walks it).

  A report may carry ``path``: the samples since the last few syncs, stamped
  on the host's clock. New ones join the player's trail; an older client's
  plain report becomes one sample at arrival time.
  """
  pos = island.clamp_position(action.get("x"), action.get("y"), action.get("z"), action.get("r"))
  if pos is None:
    return False
  player["x"], player["y"], player["z"], player["r"] = pos
  player["t0"] = now
  player["landed"] = True
  trail = player.setdefault("trail", [])
  last = trail[-1][0] if trail else 0
  path = action.get("path") if isinstance(action.get("path"), list) else []
  added = False
  for sample in path[-TRAIL_MAX:]:
    if not isinstance(sample, list) or len(sample) != 5:
      continue
    t = sample[0]
    if not isinstance(t, (int, float)) or isinstance(t, bool) or not math.isfinite(t):
      continue
    t = int(min(now, max(now - TRAIL_MS, t)))
    spot = island.clamp_position(*sample[1:])
    if t <= last or spot is None:
      continue
    trail.append([t, *spot])
    last, added = t, True
  if not added and now > last:
    trail.append([now, *pos])
  player["trail"] = [s for s in trail if s[0] > now - TRAIL_MS][-TRAIL_MAX:]
  return True


# ---------------------------------------------------------------- lifecycle

def advance(room: dict, now: int) -> None:
  """Expire idle players and close races that are over."""
  room.setdefault("world", island.new_world())
  gone = [
    pid for pid, p in room["players"].items()
    if not p["is_host"] and now - p["seen"] > DROP_AFTER_MS
  ]
  for pid in gone:
    remove_player(room, pid, now, reason="timed out")
  island.advance(room, now, push_event)


def remove_player(room: dict, pid: str, now: int, *, reason: str = "left") -> None:
  player = room["players"].pop(pid, None)
  if player is None:
    return
  word = "left" if reason == "left" else "wandered off"
  push_event(room, now, "leave", pid=pid, text=f"{player['name']} {word}")


def is_away(player: dict, now: int) -> bool:
  return now - player["seen"] > AWAY_AFTER_MS


# ---------------------------------------------------------------- actions

def sit(room: dict, pid: str, player: dict, seat) -> bool:
  """Take a seat at the private table (None stands up). A taken seat is refused."""
  if seat is None:
    changed = player.get("seat") is not None
    player["seat"] = None
    return changed
  if seat not in SEATS:
    return False
  if any(p.get("seat") == seat for key, p in room["players"].items() if key != pid):
    return False
  player["seat"] = seat
  return True


APP_ID_RE = re.compile(r"[a-z0-9][a-z0-9_-]{0,39}")
REPO_RE = re.compile(r"[A-Za-z0-9_.-]{1,60}/[A-Za-z0-9_.-]{1,80}")
ICON_URL_RE = re.compile(r"https://[A-Za-z0-9.-]+/[^\s\"'<>]{1,380}")


def display_meta(action: dict) -> dict:
  """What the room needs to show an app it may not know: its name, line, icon and repository."""
  meta = {}
  title = clean_text(action.get("title"), 60)
  tagline = clean_text(action.get("tagline"), 140)
  icon_url = action.get("icon_url")
  repo = action.get("repo")
  if title:
    meta["title"] = title
  if tagline:
    meta["tagline"] = tagline
  if isinstance(icon_url, str) and ICON_URL_RE.fullmatch(icon_url):
    meta["icon_url"] = icon_url
  if isinstance(repo, str) and REPO_RE.fullmatch(repo):
    meta["repo"] = repo
  link = action.get("link")
  if isinstance(link, str) and ICON_URL_RE.fullmatch(link):
    meta["link"] = link
  return meta


MAX_HOST_APPS = 8
LINK_RE = re.compile(r"https://[A-Za-z0-9.-]+/[^\s\"'<>]{1,380}")


def clean_host_apps(value) -> list[dict]:
  """The apps a host features on their stand: a name, a line, and the public link to install it."""
  out, seen = [], set()
  for raw in value if isinstance(value, list) else []:
    if not isinstance(raw, dict):
      continue
    slug = re.sub(r"[^a-z0-9-]", "-", str(raw.get("id") or "").lower()).strip("-")
    while slug.startswith("host-"):  # a saved entry coming back keeps its id
      slug = slug[5:]
    slug = slug[:34].strip("-")
    title = clean_text(raw.get("title"), 60)
    link = raw.get("link")
    if not slug or not title or not isinstance(link, str) or not LINK_RE.fullmatch(link) or slug in seen:
      continue
    seen.add(slug)
    item = {"id": f"host-{slug}", "title": title, "link": link}
    tagline = clean_text(raw.get("tagline"), 140)
    if tagline:
      item["tagline"] = tagline
    icon_url = raw.get("icon_url")
    if isinstance(icon_url, str) and ICON_URL_RE.fullmatch(icon_url):
      item["icon_url"] = icon_url
    repo = raw.get("repo")
    if isinstance(repo, str) and REPO_RE.fullmatch(repo):
      item["repo"] = repo
    out.append(item)
    if len(out) == MAX_HOST_APPS:
      break
  return out


def display(room: dict, pid: str, player: dict, app, now: int, meta: dict | None = None) -> bool:
  """Put an App Store app on display (any player). The oldest goes when the row is full."""
  if not isinstance(app, str) or not APP_ID_RE.fullmatch(app):
    return False
  shown = room.setdefault("displays", [])
  if any(d["app"] == app for d in shown):
    return False
  shown.append({"app": app, "by": pid, "name": player["name"], "t": now, **(meta or {})})
  del shown[: max(0, len(shown) - MAX_DISPLAYS)]
  return True


def undisplay(room: dict, pid: str, player: dict, app) -> bool:
  """Take an app off display: whoever put it there, or the host."""
  shown = room.setdefault("displays", [])
  for d in shown:
    if d["app"] == app and (d["by"] == pid or player["is_host"]):
      shown.remove(d)
      return True
  return False


def say(room: dict, pid: str, player: dict, text: str, now: int) -> None:
  """Public chat, or private to the table when the speaker is seated at one."""
  seat = player.get("seat")
  if not seat or not seat.startswith("cafe:"):
    push_event(room, now, "say", pid=pid, text=text)
    return
  table = seat.split(":")[0]
  for key, other in room["players"].items():
    if (other.get("seat") or "").split(":")[0] == table:
      push_event(room, now, "say", pid=pid, text=text, to=key, private=True)


def apply_actions(room: dict, pid: str, actions, now: int) -> None:
  player = room["players"][pid]
  player["seen"] = now
  if not isinstance(actions, list):
    return
  for action in actions[:64]:
    if not isinstance(action, dict):
      continue
    kind = action.get("t")
    if kind == "move":
      if move(player, action, now):
        touch(room)
    elif kind == "say":
      text = clean_text(action.get("text"), 140)
      if text:
        say(room, pid, player, text, now)
    elif kind == "display":
      if display(room, pid, player, action.get("app"), now, display_meta(action)):
        touch(room)
    elif kind == "undisplay":
      if undisplay(room, pid, player, action.get("app")):
        touch(room)
    elif kind == "seat":
      if sit(room, pid, player, action.get("seat")):
        touch(room)
    elif kind == "emote" and action.get("e") in EMOTES:
      player["emote"] = {"e": action["e"], "t": now}
      push_event(room, now, "emote", pid=pid, text=action["e"])
    elif kind == "profile":
      profile = clean_profile({**player, **action})
      player.update(profile)
      touch(room)
    elif island.interact(room, pid, action, now, push_event):
      touch(room)


# ---------------------------------------------------------------- views

def poll_interval(room: dict, viewer: dict, now: int) -> int:
  """Coalesced sync cadence that keeps every remote guest inside the budget.

  The host's public door accepts the requests a minute Worlds declares, and
  behind a shared proxy every guest may count as the same caller. Split a safe
  share of it between remote guests; the host's own browser uses its private lane.
  """
  remote = sum(
    1 for p in room["players"].values()
    if p["home"] != room["host_origin"] and not is_away(p, now)
  )
  if viewer["home"] == room["host_origin"]:
    return 700
  per_guest = 60_000 * max(1, remote) / PUBLIC_BUDGET_PER_MIN
  return int(min(8000, max(GUEST_FASTEST_MS, per_guest)))


def snapshot(room: dict, pid: str, since: int, extra: dict | None, now: int) -> dict:
  viewer = room["players"][pid]
  players = []
  for key, p in room["players"].items():
    players.append({
      "pid": key,
      "name": p["name"], "color": p["color"],
      **{slot: p.get(slot, options[0]) for slot, options in OUTFIT.items()},
      "home": p["home"], "is_host": p["is_host"],
      "away": is_away(p, now),
      "x": p["x"], "y": p["y"], "z": p["z"], "r": p["r"], "t0": p["t0"], "landed": p.get("landed", False),
      "trail": [s for s in p.get("trail", ()) if s[0] > now - TRAIL_MS] if key != pid else [],
      "emote": p["emote"] if p["emote"] and now - p["emote"]["t"] < 4000 else None,
      "seat": p.get("seat"),
    })
  events = [
    e for e in room["events"]
    if e["seq"] > since and (not e.get("to") or e["to"] == pid)
  ]
  return {
    "code": room["code"],
    "title": room["title"],
    "listed": room["listed"],
    "host_origin": room["host_origin"],
    "activity": room["activity"],
    "seq": room["seq"],
    "now": now,
    "you": pid,
    "players": players,
    "events": events,
    "displays": [{"app": d["app"], "by": d["by"], "name": d["name"],
                  **{k: d[k] for k in ("title", "tagline", "icon_url", "repo", "link") if k in d}}
                 for d in room.get("displays", [])],
    "world": island.view(room),
    "poll_ms": poll_interval(room, viewer, now),
  }


def listing(room: dict, now: int) -> dict:
  host = next((p for p in room["players"].values() if p["is_host"]), None)
  return {
    "code": room["code"],
    "title": room["title"],
    "host_name": host["name"] if host else "",
    "host_color": host["color"] if host else GHOST_COLORS[0],
    "host_look": {slot: host.get(slot, options[0]) for slot, options in OUTFIT.items()} if host else {},
    "activity": room["activity"],
    "players": sum(1 for p in room["players"].values() if not is_away(p, now)),
    "max_players": MAX_PLAYERS,
    "created": room["created"],
    "by_visitor": visitor_hosted(room),
  }


def is_live(room: dict, now: int) -> bool:
  """A room is open while its host has been around recently."""
  host = room["players"].get(host_pid(room))
  return host is not None and now - host["seen"] < DROP_AFTER_MS
