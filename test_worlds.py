"""End-to-end service tests: a host and a guest share the Worlds Lobby and race Möbius Kart.

Run: APP_STORAGE_DIR=$(mktemp -d) python3 test_worlds.py
"""

from __future__ import annotations

import asyncio
import os
import tempfile

os.environ.setdefault("APP_STORAGE_DIR", tempfile.mkdtemp())
os.environ["INSTANCE_ORIGIN"] = "https://host.example"

import ghostdrop  # noqa: E402
import world  # noqa: E402
import rooms  # noqa: E402
import identity  # noqa: E402
import service  # noqa: E402

# Möbius IDs without the network: this instance is @benji; @ana has two instances.
HANDLES = {"benji": ["https://host.example"], "ana": ["https://old-ana.example", "https://ana.example"]}


async def _own_handle():
  return "benji"


async def _resolve(handle):
  handle = identity.clean_handle(handle)
  if handle not in HANDLES:
    raise identity.HandleError(404, f"No one has the Möbius ID @{handle}.")
  return HANDLES[handle]


identity.own_handle = _own_handle
identity.resolve = _resolve

clock = {"t": 1_000_000_000_000}
rooms.now_ms = lambda: clock["t"]


def call(path, body=None, method="POST", public=False):
  reply = asyncio.run(service.dispatch({
    "method": method, "path": path, "body": body or {}, "query": {}, "public": public,
  }))
  return reply["status"], reply["body"]


def ok(path, body=None, method="POST", public=False):
  status, body = call(path, body, method, public)
  assert status == 200, (path, status, body)
  return body


def tick(ms):
  clock["t"] += ms


def test_session():
  ok("me", {"name": "Benjamin", "color": "#69db7c", "hat": "crown"}, "PUT")
  hosted = ok("host", {"title": "Friday hangout", "listed": True})
  code = hosted["code"]
  assert hosted["invite"] == f"@benji/{code}", "invites use the Möbius ID, not the container address"
  assert ok("public/info", method="GET", public=True)["handle"] == "benji"
  # Joining your own session by its @ID invite stays local.
  own = ok("join", {"invite": hosted["invite"]})
  assert own["origin"] == "https://host.example" and own["invite"] == hosted["invite"]

  listing = ok("public/rooms", method="GET", public=True)["rooms"]
  assert [r["code"] for r in listing] == [code]

  # A guest from another instance joins through the public door.
  status, _ = call("public/join", {"code": code, "profile": {"name": "Ana"},
                                   "home": "https://host.example"}, public=True)
  assert status == 400, "a public caller cannot claim to be the host instance"
  seat = ok("public/join", {"code": code, "profile": {"name": "Ana", "color": "#ff6b6b"},
                            "home": "https://ana.example"}, public=True)
  guest = lambda actions=None, since=0, extra=None: ok("public/sync", {
    "code": code, "pid": seat["pid"], "secret": seat["secret"],
    "actions": actions or [], "since": since, "extra": extra or {},
  }, public=True)
  host = lambda actions=None, since=0, extra=None: ok("sync", {
    "origin": "https://host.example", "code": code,
    "actions": actions or [], "since": since, "extra": extra or {},
  })

  status, _ = call("public/sync", {"code": code, "pid": seat["pid"], "secret": "nope"},
                   public=True)
  assert status == 403
  status, _ = call("public/sync", {"code": code, "pid": "h", "secret": ""}, public=True)
  assert status == 403

  # Hangout: walk and talk. Each player's own game walks their ghost and reports it.
  snap = guest()
  me = next(p for p in snap["players"] if p["pid"] == seat["pid"])
  assert me["landed"] is False and abs(me["z"] - world.SPAWN[1]) < 3, "guests spawn by the crystal"
  snap = guest([{"t": "move", "x": 1.5, "y": 0.4, "z": 30, "r": 1.2}, {"t": "say", "text": "hi there!"}])
  me = next(p for p in snap["players"] if p["pid"] == seat["pid"])
  assert (me["x"], me["y"], me["z"], me["r"], me["landed"]) == (1.5, 0.4, 30, 1.2, True)
  assert snap["poll_ms"] >= rooms.GUEST_FASTEST_MS, "remote guests share the public door's budget"
  hsnap = host()
  assert hsnap["poll_ms"] == 700
  assert any(e["kind"] == "say" and e["text"] == "hi there!" for e in hsnap["events"])

  # ---- Reports stay finite and inside the lobby.
  far = host([{"t": "move", "x": -500, "y": 5, "z": 5000, "r": 99}])
  me = next(p for p in far["players"] if p["pid"] == "h")
  assert (me["x"], me["z"]) == (world.BOUNDS["x"][0], world.BOUNDS["z"][1]) and abs(me["r"]) <= 3.15
  host([{"t": "move", "x": float("nan"), "y": 0, "z": 0}, {"t": "move", "x": "1", "y": 0, "z": 0}])
  me = next(p for p in host()["players"] if p["pid"] == "h")
  assert me["x"] == world.BOUNDS["x"][0], "unusable reports are ignored"
  assert "cool" not in host()["world"]

  # Möbius Kart: a live race. Join from the Kart Stand, a shared start, position reports, checked times.
  guest([{"t": "race_join"}])
  snap = host([{"t": "race_join"}])
  race = snap["world"]["race"]
  assert race["state"] == "lobby" and set(race["racers"]) == {"h", seat["pid"]}
  assert any("opened a Möbius Kart race" in e["text"] for e in snap["events"])
  snap = guest([{"t": "race_state", "p": 50, "d": 0, "v": 30}])
  assert snap["world"]["race"]["racers"][seat["pid"]]["p"] == 0, "no driving before the start"
  snap = host([{"t": "race_go"}])
  race = snap["world"]["race"]
  assert race["state"] == "running" and race["start"] == clock["t"] + world.RACE_LEAD_MS
  status_before = race["start"]
  tick(world.RACE_LEAD_MS + 2000)
  snap = guest([{"t": "race_state", "p": 5000, "d": 20, "v": 30}])
  me = snap["world"]["race"]["racers"][seat["pid"]]
  assert me["p"] <= world.MAX_KART_SPEED * 7 + 20 and me["d"] == 8, "reports are kept plausible"
  late = host()
  assert late["world"]["race"]["state"] == "running"
  # Shared items: a Bug for everyone, a Page Plane aimed at the host, a spin-out others can see.
  snap = guest([{"t": "race_item", "kind": "bug", "p": me["p"] - 3, "d": 1},
                {"t": "race_item", "kind": "bug", "p": me["p"] - 3, "d": 1}])
  assert len(snap["world"]["race"]["items"]) == 1, "items have a short cooldown"
  tick(world.COOLDOWN_MS + 10)
  guest([{"t": "race_item", "kind": "plane", "p": me["p"] + 2, "d": 0, "target": "h"},
         {"t": "race_item", "kind": "rocket", "p": 0, "d": 0}])
  tick(world.COOLDOWN_MS + 10)
  guest([{"t": "race_item", "kind": "bug", "p": 40_000, "d": 0}])
  items = host()["world"]["race"]["items"]
  assert [(i["kind"], i["target"]) for i in items] == [("bug", None), ("plane", "h")], "only real items near the racer"
  bug, plane = items
  host([{"t": "race_item_gone", "id": plane["id"]}, {"t": "race_state", "p": 60, "d": 0, "v": 5, "s": 1}])
  snap = guest([{"t": "race_item_gone", "id": bug["id"]}])
  assert snap["world"]["race"]["items"] == [] and snap["world"]["race"]["racers"]["h"]["spin"] is True
  for lap in range(17):  # both keep reporting while they drive
    tick(10_000)
    guest([{"t": "race_state", "p": 100 * lap, "d": 1, "v": 30}])
    host([{"t": "race_state", "p": 100 * lap + 5, "d": -1, "v": 31}])
  now_elapsed = (clock["t"] - status_before) / 1000
  snap = host([{"t": "race_finish", "time": now_elapsed + 30}])
  assert not snap["world"]["race"]["racers"]["h"]["done"], "nobody finishes faster than the host's clock"
  host([{"t": "race_finish", "time": now_elapsed - 1}])
  guest([{"t": "race_finish", "time": now_elapsed - 0.5}])
  snap = host()
  race = snap["world"]["race"]
  assert race["state"] == "done", "the race is over when every racer finished"
  assert [e["name"] for e in snap["world"]["kart"]] == ["Benjamin", "Ana"]
  assert any("finished 1st in Möbius Kart" in e["text"] for e in snap["events"])
  assert race["racers"][seat["pid"]]["name"] == "Ana", "racers keep their name for the results"
  w = world.new_world()
  for i, t in enumerate((150, 140, 160)):  # the same guest rejoining keeps one line, their best
    world._record_best(w, f"p{i}", {"name": "Ana", "color": "#f00", "home": "https://ana.example"}, t, 1, i)
  assert [(e["name"], e["time"]) for e in w["kart"]] == [("Ana", 140)]
  snap = guest([{"t": "race_join"}])
  assert snap["world"]["race"]["state"] == "lobby" and list(snap["world"]["race"]["racers"]) == [seat["pid"]], "a new race after the last one"
  snap = guest([{"t": "race_leave"}])
  assert snap["world"]["race"] is None, "an empty lobby closes"
  # A racer whose game goes silent mid-race (a closed tab) is handed to a bot, which keeps driving.
  guest([{"t": "race_join"}])
  host([{"t": "race_join"}, {"t": "race_go"}])
  tick(world.RACE_LEAD_MS + 5000)
  guest([{"t": "race_state", "p": 100, "d": 0, "v": 30}])
  tick(world.RACE_SILENT_MS - 4000)
  snap = guest([{"t": "race_state", "p": 900, "d": 0, "v": 30}])
  bot = snap["world"]["race"]["racers"]["h"]
  assert bot["bot"] and bot["name"].endswith("(bot)") and not bot["done"], "the silent host's kart goes on as a bot"
  tick(4000)
  later = guest([{"t": "race_state", "p": 1000, "d": 0, "v": 30}])["world"]["race"]["racers"]["h"]
  assert later["p"] == round(bot["p"] + world.BOT_KART_SPEED * 4, 1) and later["at"] == clock["t"], "the bot drives on"
  # the last real racer leaves: nobody real is racing, so the bots are placed at their pace's finish
  guest([{"t": "race_leave"}])
  race = host()["world"]["race"]
  assert race["state"] == "done" and all(r["bot"] and r["done"] for r in race["racers"].values())

  # ---- Ghost Drop: a host-timed elimination round. The host stamps tile vanishes and decides who is out.
  guest([{"t": "gd_join"}])
  snap = host([{"t": "gd_join"}])
  gd = snap["world"]["gd"]
  assert gd["state"] == "lobby" and gd["order"] == [seat["pid"], "h"], "both ghosts join the drop, in join order"
  snap = host([{"t": "gd_go"}])
  gd = snap["world"]["gd"]
  assert gd["state"] == "countdown" and gd["startAt"] == clock["t"] + ghostdrop.COUNTDOWN_MS
  guest([{"t": "gd_pos", "x": 40, "y": 0, "z": 40, "r": 0}])
  host([{"t": "gd_pos", "x": 0, "y": 0, "z": 0, "r": 0}, {"t": "gd_step", "tile": "0:0:0"}])
  assert host()["world"]["gd"]["tiles"] == {}, "no stepping during the countdown"
  tick(ghostdrop.COUNTDOWN_MS)
  snap = host([{"t": "gd_pos", "x": 0, "y": 0, "z": 0, "r": 0}, {"t": "gd_step", "tile": "0:0:0"}])
  gd = snap["world"]["gd"]
  assert gd["state"] == "running", "the countdown ends on its own"
  assert gd["tiles"] == {"0:0:0": {"stepAt": clock["t"], "vanishAt": clock["t"] + ghostdrop.TILE_DELAY_MS, "by": "h"}}, \
    "the host stamps when a tile lights and when it vanishes"
  # a tile far away, a made-up tile, and a tile that is already lit are all refused
  snap = host([{"t": "gd_step", "tile": "0:3:0"}, {"t": "gd_step", "tile": "9:0:0"}, {"t": "gd_step", "tile": "0:0:0"}])
  assert list(snap["world"]["gd"]["tiles"]) == ["0:0:0"], "tiles must be near the ghost, real, and lit once"
  # the guest is far away: stepping is refused for them too
  guest([{"t": "gd_step", "tile": "0:0:1"}])
  assert list(host()["world"]["gd"]["tiles"]) == ["0:0:0"]
  # a ghost cannot be eliminated while still on the arena
  snap = host([{"t": "gd_out", "y": 0.0}])
  assert snap["world"]["gd"]["racers"]["h"]["out_at"] is None, "only a fall past the void counts"
  snap = host([{"t": "gd_out", "y": -40.0}])
  assert snap["world"]["gd"]["racers"]["h"]["out_at"] is not None
  # one ghost left: it wins once the last ghosts have had their grace to fall together
  snap = guest()
  assert snap["world"]["gd"]["state"] == "running" and snap["world"]["gd"]["closing"] is not None
  tick(ghostdrop.GRACE_MS)
  snap = guest()
  gd = snap["world"]["gd"]
  assert gd["state"] == "done" and gd["winner"] == seat["pid"], "the last ghost standing wins"
  assert any("wins the Ghost Drop" in e["text"] for e in snap["events"])

  # A new drop: two ghosts fall together and the one who fell last wins.
  host([{"t": "gd_join"}])
  guest([{"t": "gd_join"}])
  host([{"t": "gd_go"}])
  tick(ghostdrop.COUNTDOWN_MS)
  host()
  guest([{"t": "gd_out", "y": -40.0, "at": clock["t"] - 100}])
  host([{"t": "gd_out", "y": -40.0, "at": clock["t"] - 500}])
  tick(ghostdrop.GRACE_MS)
  gd = host()["world"]["gd"]
  assert gd["state"] == "done" and gd["winner"] == seat["pid"], "the one who fell last wins a tie"
  # the drop is over and the lobby is open again for the next round
  snap = guest([{"t": "gd_join"}])
  assert snap["world"]["gd"]["state"] == "lobby" and snap["world"]["gd"]["order"] == [seat["pid"]]
  guest([{"t": "gd_leave"}])
  assert host()["world"]["gd"] is None, "an empty lobby closes"

  # Leaving and closing.
  ok("public/leave", {"code": code, "pid": seat["pid"], "secret": seat["secret"]},
     public=True)
  assert all(p["pid"] != seat["pid"] for p in host()["players"])
  ok("leave", {"origin": "https://host.example", "code": code, "close": True})
  assert ok("public/rooms", method="GET", public=True)["rooms"] == []


def _session(title):
  """A hosted session with one guest (Ana, from another Möbius): (code, guest_pid, host, guest)."""
  code = ok("host", {"title": title})["code"]
  seat = ok("public/join", {"code": code, "home": "https://ana.example",
                            "profile": {"name": "Ana", "color": "#ff8787"}}, public=True)
  host = lambda actions=None: ok("sync", {"origin": "https://host.example", "code": code, "actions": actions or []})
  guest = lambda actions=None: ok("public/sync", {"code": code, "pid": seat["pid"], "secret": seat["secret"],
                                                  "actions": actions or []}, public=True)
  return code, seat, host, guest


def test_kart_racer_who_leaves_mid_race_is_replaced_by_a_bot():
  code, seat, host, guest = _session("Bot kart")
  # leaving the lobby before the start just frees the place
  guest([{"t": "race_join"}])
  host([{"t": "race_join"}])
  guest([{"t": "race_leave"}])
  assert set(host()["world"]["race"]["racers"]) == {"h"}, "a lobby leaver is gone, not a bot"
  guest([{"t": "race_join"}])
  host([{"t": "race_go"}])
  tick(world.RACE_LEAD_MS + 10_000)
  guest([{"t": "race_state", "p": 250, "d": 1, "v": 30}])
  host([{"t": "race_state", "p": 260, "d": 0, "v": 31}])
  # Ana leaves the whole session mid-race: her kart drives on as a bot
  ok("public/leave", {"code": code, "pid": seat["pid"], "secret": seat["secret"]}, public=True)
  snap = host()
  bot = snap["world"]["race"]["racers"][seat["pid"]]
  assert bot["bot"] and bot["name"] == "Ana (bot)" and bot["p"] == 250
  assert any("A bot drives their kart home" in e["text"] for e in snap["events"])
  # the bot ignores the departed racer's reports (a stale tab) and keeps its own pace
  tick(20_000)
  bot = host([{"t": "race_state", "p": 270, "d": 0, "v": 31}])["world"]["race"]["racers"][seat["pid"]]
  assert bot["p"] == 250 + world.BOT_KART_SPEED * 20 and bot["v"] == world.BOT_KART_SPEED
  # the host races on and finishes first; the race waits for nobody, so the bot is placed behind
  elapsed = (clock["t"] - snap["world"]["race"]["start"]) / 1000
  host([{"t": "race_state", "p": 520, "d": 0, "v": 31}])
  snap = host([{"t": "race_finish", "time": elapsed - 0.5}])
  race = snap["world"]["race"]
  bot = race["racers"][seat["pid"]]
  assert race["state"] == "done" and bot["done"] and bot["time"] > race["racers"]["h"]["time"]
  finish = bot["bot_at"] + (world.KART_FINISH_M - 250) / world.BOT_KART_SPEED * 1000
  assert abs(bot["time"] - (finish - race["start"]) / 1000) < 0.05, "placed at the time its pace brings it home"
  assert any("Ana (bot) finished 2nd" in e["text"] for e in snap["events"])
  assert all("bot" not in e["name"] for e in snap["world"]["kart"]), "bots never set best times"
  ok("leave", {"origin": "https://host.example", "code": code, "close": True})


def test_kart_bot_crosses_the_finish_on_its_own():
  code, seat, host, guest = _session("Bot finish")
  guest([{"t": "race_join"}])
  host([{"t": "race_join"}, {"t": "race_go"}])
  tick(world.RACE_LEAD_MS)
  guest([{"t": "race_leave"}])
  race = host()["world"]["race"]
  assert race["racers"][seat["pid"]]["bot"] and race["state"] == "running", "the host still races the bot"
  lap_ms = world.KART_FINISH_M / world.BOT_KART_SPEED * 1000
  for _ in range(int(lap_ms // 20_000) + 1):
    tick(20_000)
    host([{"t": "race_state", "p": 1, "d": 0, "v": 1}])
  race = host()["world"]["race"]
  bot = race["racers"][seat["pid"]]
  assert bot["done"] and abs(bot["time"] - lap_ms / 1000) < 0.05 and race["state"] == "running", \
    "the bot finishes at its pace while a real racer is still out there"
  ok("leave", {"origin": "https://host.example", "code": code, "close": True})


def test_ghost_who_leaves_mid_drop_is_replaced_by_a_bot():
  code, seat, host, guest = _session("Bot drop")
  # leaving the lobby before the start just frees the place
  guest([{"t": "gd_join"}])
  host([{"t": "gd_join"}])
  guest([{"t": "gd_leave"}])
  assert host()["world"]["gd"]["order"] == ["h"], "a lobby leaver is gone, not a bot"
  guest([{"t": "gd_join"}])
  host([{"t": "gd_go"}])
  tick(ghostdrop.COUNTDOWN_MS)
  x, z = ghostdrop._center(0, 0)
  guest([{"t": "gd_pos", "x": x, "y": 0, "z": z, "r": 0}])
  host([{"t": "gd_pos", "x": 0, "y": -27, "z": 6, "r": 0}])   # the host waits on the bottom layer
  # Ana closes the drop mid-round: a bot takes her ghost on from the middle tile
  snap = guest([{"t": "gd_leave"}])
  me = snap["world"]["gd"]["racers"][seat["pid"]]
  assert me["bot"] and me["name"] == "Ana (bot)" and me["out_at"] is None
  assert any("A bot floats on for them" in e["text"] for e in snap["events"])
  # her stale tab's reports and steps are ignored now
  guest([{"t": "gd_out", "y": -40.0}])
  assert host()["world"]["gd"]["racers"][seat["pid"]]["out_at"] is None, "only the bot decides now"
  # the bot hops about, lighting tiles as it goes, and its position is shared like anyone's
  moves = set()
  for _ in range(6):
    tick(400)
    snap = host([{"t": "gd_pos", "x": 0, "y": -27, "z": 6, "r": 0}])
    pos = snap["world"]["gd"]["racers"][seat["pid"]]["pos"]
    moves.add((pos["x"], pos["z"]))
  gd = snap["world"]["gd"]
  lit_by_bot = [t for t, rec in gd["tiles"].items() if rec["by"] == seat["pid"]]
  assert len(moves) > 3 and len(lit_by_bot) >= 4, (moves, lit_by_bot)
  assert all(rec["vanishAt"] - rec["stepAt"] == ghostdrop.TILE_DELAY_MS for rec in gd["tiles"].values())
  # it plays on until it drops through the bottom or wins; the host stands still and falls last
  for _ in range(600):
    if gd["state"] == "done":
      break
    tick(500)
    gd = host([{"t": "gd_pos", "x": 0, "y": -27, "z": 6, "r": 0}])["world"]["gd"]
  assert gd["state"] == "done", "the bot's drop ends"
  assert gd["racers"][seat["pid"]]["out_at"] is not None or gd["winner"] == seat["pid"]
  ok("leave", {"origin": "https://host.example", "code": code, "close": True})


def test_drop_ends_when_every_real_player_has_gone():
  code, seat, host, guest = _session("Empty drop")
  guest([{"t": "gd_join"}])
  host([{"t": "gd_join"}, {"t": "gd_go"}])
  tick(ghostdrop.COUNTDOWN_MS)
  guest([{"t": "gd_leave"}])
  room = service.store.load_room(code)
  room["players"].pop("h")       # the host's own seat goes too (nobody left watching)
  ghostdrop.advance(room, clock["t"], rooms.push_event)
  tick(ghostdrop.GRACE_MS)
  ghostdrop.advance(room, clock["t"], rooms.push_event)
  assert room["world"]["gd"]["state"] == "done", "bots do not play on for nobody"
  ok("leave", {"origin": "https://host.example", "code": code, "close": True})


def test_outfits():
  profile = rooms.clean_profile({"name": "Old", "color": "#4dabf7", "hat": "cap"})
  assert profile["hat"] == "mobius_cap" and profile["face"] == "dots", "old profiles upgrade cleanly"
  bad = rooms.clean_profile({"name": "X", "hat": "rocket", "neck": "chain", "hold": "sword", "face": "evil"})
  assert (bad["hat"], bad["neck"], bad["hold"], bad["face"]) == ("none", "none", "none", "dots")
  ok("me", {"name": "Dress", "color": "#9cd3ff", "face": "mystery", "hat": "mobius_halo",
            "neck": "mobius_scarf", "hold": "balloon"}, "PUT")
  code = ok("host", {"title": "Fashion"})["code"]
  snap = ok("sync", {"origin": "https://host.example", "code": code, "actions": [
    {"t": "profile", "hold": "mobius_mug"}]})
  me = next(p for p in snap["players"] if p["pid"] == "h")
  assert (me["face"], me["hat"], me["neck"], me["hold"]) == ("mystery", "mobius_halo", "mobius_scarf", "mobius_mug")
  listing = ok("public/rooms", method="GET", public=True)["rooms"]
  assert listing[0]["host_look"]["hat"] == "mobius_halo"
  ok("leave", {"origin": "https://host.example", "code": code, "close": True})


def test_invites():
  assert service.parse_invite("@ana/abcde") == ("handle", "ana", "ABCDE")
  assert service.parse_invite("ana/ABCDE") == ("handle", "ana", "ABCDE")
  assert service.parse_invite("friend.example/ABCDE") == ("origin", "https://friend.example", "ABCDE")
  assert service.parse_invite("https://friend.example/#abcde") == ("origin", "https://friend.example", "ABCDE")
  assert service.parse_invite("ABCDE") == ("self", "https://host.example", "ABCDE")
  status, body = call("join", {"invite": "@nobody/ABCDE"})
  assert status == 404 and "@nobody" in body["detail"]
  status, body = call("join", {"invite": "@no-such-person/ABCDE"})
  assert status == 400, "dashes aren't allowed in Möbius IDs"


def test_join_by_handle_tries_each_instance():
  """@ana has two Möbius instances; the room lives on the second one."""
  tried = []

  async def fake_call(origin, path, *, method="GET", body=None, timeout=8.0):
    tried.append((origin, path))
    if origin == "https://old-ana.example":
      raise service.transport.PeerError(404, "That session isn't open.")
    if path == "join":
      return {"worlds": True, "pid": "p1", "secret": "s", "title": "Ana's place"}
    if path == "info":
      return {"worlds": True, "name": "Ana", "handle": "ana"}
    raise AssertionError(path)

  real = service.transport.call
  service.transport.call = fake_call
  try:
    joined = ok("join", {"invite": "@ana/QWERT"})
    assert joined["origin"] == "https://ana.example" and joined["invite"] == "@ana/QWERT"
    assert [o for o, _ in tried] == ["https://old-ana.example", "https://ana.example"]
    tried.clear()
    added = ok("friends", {"address": "@ana"})["friend"]
    assert added["handle"] == "ana" and added["origin"] == "https://ana.example", "skips the instance that did not answer"
  finally:
    service.transport.call = real


def test_private_table():
  room, hid, _ = rooms.create_room(code="CAFE1", title="Cafe", listed=False,
                                   host_profile=rooms.clean_profile({"name": "Host"}), host_origin="", now=1000)
  ana, _ = rooms.add_player(room, {"name": "Ana"}, "", 1000)
  bob, _ = rooms.add_player(room, {"name": "Bob"}, "", 1000)
  seen = lambda pid: [e["text"] for e in rooms.snapshot(room, pid, 0, None, 1001)["events"] if e["kind"] == "say"]
  rooms.apply_actions(room, hid, [{"t": "seat", "seat": "cafe:0"}], 1001)
  rooms.apply_actions(room, ana, [{"t": "seat", "seat": "cafe:0"}], 1001)
  assert room["players"][ana]["seat"] is None, "a taken seat is refused"
  rooms.apply_actions(room, ana, [{"t": "seat", "seat": "cafe:1"}, {"t": "seat", "seat": "bar:9"}], 1001)
  assert room["players"][ana]["seat"] == "cafe:1", "an unknown seat is refused, a free one taken"
  rooms.apply_actions(room, hid, [{"t": "say", "text": "secret"}], 1002)
  rooms.apply_actions(room, bob, [{"t": "say", "text": "hello all"}], 1002)
  assert "secret" in seen(hid) and "secret" in seen(ana), "the table hears itself"
  assert "secret" not in seen(bob), "nobody else gets a private chat"
  assert "hello all" in seen(hid) and "hello all" in seen(ana), "seated ghosts still hear public chat"
  assert all(e.get("private") for e in rooms.snapshot(room, ana, 0, None, 1003)["events"] if e["text"] == "secret")
  rooms.apply_actions(room, bob, [{"t": "seat", "seat": "bench:2:1"}, {"t": "say", "text": "from a bench"}], 1003)
  assert room["players"][bob]["seat"] == "bench:2:1" and "from a bench" in seen(hid), "a bench seat keeps chat public"
  rooms.apply_actions(room, ana, [{"t": "seat", "seat": "bench:2:1"}], 1003)
  assert room["players"][ana]["seat"] == "cafe:1", "a taken bench seat is refused"
  rooms.apply_actions(room, bob, [{"t": "seat", "seat": None}], 1003)
  rooms.apply_actions(room, hid, [{"t": "seat", "seat": None}, {"t": "say", "text": "back"}], 1003)
  assert "back" in seen(bob), "standing up makes chat public again"
  assert next(p for p in rooms.snapshot(room, bob, 0, None, 1003)["players"] if p["pid"] == ana)["seat"] == "cafe:1"


def test_host_features_apps_on_the_stand():
  apps = rooms.clean_host_apps([
    {"id": "Ball Game", "title": "Ball Game", "tagline": "Roll.", "link": "https://raw.githubusercontent.com/o/ball/main/mobius.json",
     "icon_url": "https://raw.githubusercontent.com/o/ball/main/icon.png", "repo": "o/ball"},
    {"id": "ball-game", "title": "Twice", "link": "https://raw.githubusercontent.com/o/ball/main/mobius.json"},
    {"id": "nolink", "title": "No link"},
    {"id": "bad", "title": "Bad", "link": "javascript:alert(1)"},
  ])
  assert [a["id"] for a in apps] == ["host-ball-game"], "one entry per app, and only with a public https link"
  assert apps[0]["repo"] == "o/ball" and apps[0]["tagline"] == "Roll."
  assert rooms.clean_host_apps(apps) == apps, "saving the list again leaves it unchanged"
  assert len(rooms.clean_host_apps([{"id": f"a{i}", "title": "A", "link": "https://x.example/m.json"} for i in range(20)])) == rooms.MAX_HOST_APPS


def test_app_displays():
  room, hid, _ = rooms.create_room(code="DISP1", title="Store", listed=False,
                                   host_profile=rooms.clean_profile({"name": "Host"}), host_origin="", now=1000)
  ana, _ = rooms.add_player(room, {"name": "Ana"}, "", 1000)
  bob, _ = rooms.add_player(room, {"name": "Bob"}, "", 1000)
  shown = lambda: [d["app"] for d in rooms.snapshot(room, bob, 0, None, 1001)["displays"]]
  rooms.apply_actions(room, ana, [{"t": "display", "app": "voice"}, {"t": "display", "app": "voice"}, {"t": "display", "app": "Bad Id!"}], 1001)
  assert shown() == ["voice"], "any player can display an app; repeats and junk ids are ignored"
  rooms.apply_actions(room, bob, [{"t": "undisplay", "app": "voice"}], 1001)
  assert shown() == ["voice"], "only its owner or the host can take it down"
  rooms.apply_actions(room, ana, [{"t": "display", "app": f"app{i}"} for i in range(7)], 1002)
  assert len(shown()) == 6 and "voice" not in shown() and "app6" in shown(), "six stands at most, oldest replaced"
  rooms.apply_actions(room, hid, [{"t": "undisplay", "app": "app6"}], 1003)
  rooms.apply_actions(room, ana, [{"t": "undisplay", "app": "app5"}], 1003)
  assert shown() == ["app1", "app2", "app3", "app4"], "the host and the owner can both remove"
  assert next(d for d in rooms.snapshot(room, bob, 0, None, 1003)["displays"])["name"] == "Ana"
  rooms.apply_actions(room, ana, [{"t": "display", "app": "editor", "title": "Editor", "tagline": "Edit files.",
                                    "icon_url": "https://raw.githubusercontent.com/o/r/main/icon.png", "repo": "o/r"}], 1004)
  meta = next(d for d in rooms.snapshot(room, bob, 0, None, 1004)["displays"] if d["app"] == "editor")
  assert (meta["title"], meta["repo"], meta["icon_url"].startswith("https://")) == ("Editor", "o/r", True), \
    "an app outside the bundled stand goes on display with its own name and icon"


def test_browser_guest_from_public_link():
  # A visitor on the app's public link has no Möbius: welcome, join, play, leave.
  ok("me", {"name": "Benjamin", "color": "#69db7c"}, "PUT")
  code = ok("host", {"title": "Link party", "listed": True})["code"]
  welcome = ok("public/guest", method="GET", public=True)
  assert welcome["origin"] == "https://host.example" and welcome["handle"] == "benji"
  assert welcome["host"]["name"] == "Benjamin" and welcome["colors"] and welcome["outfit"]["hat"]
  assert code in [r["code"] for r in welcome["rooms"]]
  status, _ = call("public/join", {"code": code, "profile": {"name": "Visitor"}}, public=True)
  assert status == 400, "a guest that is neither a browser nor another Möbius is refused"
  seat = ok("public/join", {"code": code, "profile": {"name": "Visitor", "color": "#ff6b6b"},
                            "browser": True}, public=True)
  snap = ok("public/sync", {"code": code, "pid": seat["pid"], "secret": seat["secret"],
                            "actions": [{"t": "say", "text": "hi from a browser"}], "since": 0},
            public=True)
  me = next(p for p in snap["players"] if p["pid"] == seat["pid"])
  assert me["name"] == "Visitor" and me["home"] == "browser" and snap["you"] == seat["pid"]
  assert snap["poll_ms"] >= rooms.GUEST_FASTEST_MS, "browser guests share the public door's budget"
  assert snap["poll_ms"] == rooms.GUEST_FASTEST_MS, "a lone guest syncs about four times a second"
  ok("public/leave", {"code": code, "pid": seat["pid"], "secret": seat["secret"]}, public=True)
  host_view = ok("sync", {"origin": "https://host.example", "code": code, "actions": [], "since": 0})
  assert seat["pid"] not in [p["pid"] for p in host_view["players"]]
  ok("leave", {"origin": "https://host.example", "code": code, "close": True})


def test_visitor_hosts_from_public_link():
  # Anyone on the public link can host: other visitors and the owner find and join it.
  ok("me", {"name": "Benjamin", "color": "#69db7c"}, "PUT")
  hosted = ok("public/host", {"title": "Mia's beach", "listed": True,
                              "profile": {"name": "Mia", "color": "#ffb3cf"}}, public=True)
  code, mia = hosted["code"], {"pid": hosted["pid"], "secret": hosted["secret"]}
  assert hosted["title"] == "Mia's beach" and mia["pid"] != "h"
  listed = ok("public/rooms", method="GET", public=True)["rooms"]
  room = next(r for r in listed if r["code"] == code)
  assert room["host_name"] == "Mia" and room["by_visitor"]
  # another visitor joins it
  leo = ok("public/join", {"code": code, "profile": {"name": "Leo"}, "browser": True}, public=True)
  snap = ok("public/sync", {"code": code, **mia, "since": 0, "actions": [{"t": "say", "text": "welcome"}]}, public=True)
  host = next(p for p in snap["players"] if p["pid"] == mia["pid"])
  assert host["is_host"] and host["home"] == "browser" and len(snap["players"]) == 2
  # the owner sees it apart from their own sessions and can drop in with an ordinary seat
  lobby = ok("lobby", method="GET")
  assert code in [r["code"] for r in lobby["visitors"]] and code not in [r["code"] for r in lobby["hosted"]]
  ok("join", {"origin": "https://host.example", "code": code})
  owner_view = ok("sync", {"origin": "https://host.example", "code": code, "actions": [], "since": 0})
  assert owner_view["you"] != "h" and len(owner_view["players"]) == 3
  assert owner_view["poll_ms"] < 1500, "the owner keeps the private lane in a visitor's session"
  ok("join", {"origin": "https://host.example", "code": code})  # rejoining keeps the same seat
  assert len(ok("sync", {"origin": "https://host.example", "code": code, "since": 0})["players"]) == 3
  ok("leave", {"origin": "https://host.example", "code": code})
  assert len(ok("public/sync", {"code": code, **mia, "since": 0}, public=True)["players"]) == 2
  # visitor sessions don't use up the owner's three
  for _ in range(3):
    ok("host", {"title": "mine"})
  # a guest leaving doesn't end it; the visitor host closing it does
  ok("public/leave", {"code": code, "pid": leo["pid"], "secret": leo["secret"]}, public=True)
  ok("public/sync", {"code": code, **mia, "since": 0}, public=True)
  status, _ = call("public/leave", {"code": code, "pid": leo["pid"], "secret": "nope", "close": True}, public=True)
  assert status == 403
  ok("public/leave", {"code": code, **mia, "close": True}, public=True)
  status, _ = call("public/sync", {"code": code, **mia, "since": 0}, public=True)
  assert status == 404
  # a visitor session ends a couple of minutes after its host goes quiet
  other = ok("public/host", {"title": "", "profile": {"name": "Zed"}}, public=True)
  assert other["title"] == "Zed's place"
  tick(rooms.DROP_AFTER_MS + 1000)
  assert other["code"] not in [r["code"] for r in ok("public/rooms", method="GET", public=True)["rooms"]]
  for room in ok("lobby", method="GET")["hosted"]:
    ok("leave", {"origin": "https://host.example", "code": room["code"], "close": True})


def test_walk_trail_for_smooth_replay():
  # A walk goes up as timed samples; everyone else gets the recent trail to replay.
  room, host_pid, _ = rooms.create_room(code="TRAIL", title="", listed=False, host_profile={"name": "H"},
                                        host_origin="https://host.example", now=clock["t"])
  guest, _ = rooms.add_player(room, {"name": "G"}, "browser", clock["t"])
  t = clock["t"]
  path = [[t - 600, 0, 0, 10, 0], [t - 400, 0.5, 0, 10, 0], [t - 200, 1.0, 0, 10, 0.2], [t + 5000, 1.5, 0, 10, 0.3]]
  rooms.apply_actions(room, guest, [{"t": "move", "x": 1.5, "y": 0, "z": 10, "r": 0.3, "path": path}], t)
  rooms.apply_actions(room, guest, [{"t": "move", "x": 1.5, "y": 0, "z": 10, "r": 0.3, "path": path}], t)
  trail = next(p for p in rooms.snapshot(room, host_pid, 0, None, t)["players"] if p["pid"] == guest)["trail"]
  assert [s[0] for s in trail] == [t - 600, t - 400, t - 200, t], "resent samples join once; future stamps are clamped"
  assert trail[1][1] == 0.5
  mine = next(p for p in rooms.snapshot(room, guest, 0, None, t)["players"] if p["pid"] == guest)
  assert mine["trail"] == [], "your own trail isn't sent back to you"
  # an older client's plain report is one sample at arrival
  rooms.apply_actions(room, guest, [{"t": "move", "x": 3, "y": 0, "z": 10, "r": 0}], t + 300)
  trail = next(p for p in rooms.snapshot(room, host_pid, 0, None, t + 300)["players"] if p["pid"] == guest)["trail"]
  assert trail[-1] == [t + 300, 3.0, 0.0, 10.0, 0.0]
  later = rooms.snapshot(room, host_pid, 0, None, t + rooms.TRAIL_MS + 400)
  assert next(p for p in later["players"] if p["pid"] == guest)["trail"] == []


def test_private_routes_refuse_public_callers():
  status, _ = call("host", {"title": "x"}, public=True)
  assert status == 404


if __name__ == "__main__":
  test_invites()
  test_join_by_handle_tries_each_instance()
  test_outfits()
  test_private_table()
  test_app_displays()
  test_host_features_apps_on_the_stand()
  test_private_routes_refuse_public_callers()
  test_browser_guest_from_public_link()
  test_visitor_hosts_from_public_link()
  test_walk_trail_for_smooth_replay()
  test_session()
  test_kart_racer_who_leaves_mid_race_is_replaced_by_a_bot()
  test_kart_bot_crosses_the_finish_on_its_own()
  test_ghost_who_leaves_mid_drop_is_replaced_by_a_bot()
  test_drop_ends_when_every_real_player_has_gone()
  print("worlds service: all tests passed")
