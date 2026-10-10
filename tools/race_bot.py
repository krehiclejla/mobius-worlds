#!/usr/bin/env python3
"""A scripted guest who races Möbius Kart, for end-to-end testing of live races.

  python3 tools/race_bot.py <host-origin> <session-code> [--start] [--speed 31] [--laps 3] [--items]

Like guest_bot.py it runs this app's own service with separate storage and a
separate home address, so every call takes the real guest path through the
host's public Worlds door. It floats to the kart track, joins the race
(presses Start with --start), then drives three laps at a steady ~31 m/s,
weaving across the road, reporting its position like the game does, and
finishes. It prints what it sees of the other racers.
"""

from __future__ import annotations

import asyncio
import math
import os
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE))
os.environ["APP_STORAGE_DIR"] = os.environ.get("BOT_STORAGE") or tempfile.mkdtemp(prefix="worlds-racer-")
os.environ["INSTANCE_ORIGIN"] = os.environ.get("BOT_ORIGIN", "https://racer-mobius.example")

import service  # noqa: E402

TRACK = 1761      # metres in one lap of the Möbius Twist Circuit
LAPS = 3
SPEED = 31


def log(*parts):
  print(time.strftime("%H:%M:%S"), *parts, flush=True)


async def call(path, body=None, method="POST"):
  reply = await service.dispatch({"method": method, "path": path, "body": body or {}, "query": {}, "public": False})
  return reply["status"], reply["body"]


async def main():
  host, code = sys.argv[1], sys.argv[2]
  press_start = "--start" in sys.argv
  arg = lambda name, default: float(sys.argv[sys.argv.index(name) + 1]) if name in sys.argv else default
  speed, laps = arg("--speed", SPEED), int(arg("--laps", LAPS))
  items, dropped, fired = "--items" in sys.argv, False, False
  await call("me", {"name": "Ana (racer)", "color": "#ffb3cf", "face": "happy", "hat": "crown", "neck": "mobius_scarf", "hold": "balloon"}, "PUT")
  status, joined = await call("join", {"origin": host, "code": code})
  log("join", status, joined.get("detail") or joined.get("code"))
  since = 0
  offset = 0

  async def sync(actions=()):
    nonlocal since, offset
    status, snap = await call("sync", {"origin": host, "code": code, "since": since, "actions": list(actions)})
    if status != 200:
      log("sync", status, snap.get("detail"))
      return None
    offset = snap["now"] - int(time.time() * 1000)
    for e in snap.get("events", []):
      since = max(since, e["seq"])
      if e["kind"] == "system":
        log("event:", e["text"])
    return snap

  snap = await sync([{"t": "move", "x": -12.5, "y": 0.6, "z": 11, "r": 0}, {"t": "say", "text": "Race me!"}])
  await asyncio.sleep(2)
  snap = await sync([{"t": "race_join"}])
  log("race", snap["world"]["race"])
  started = False
  finished = False
  deadline = time.time() + 15 * 60
  while time.time() < deadline and not finished:
    await asyncio.sleep((snap or {}).get("poll_ms", 2000) / 1000)
    race = (snap or {}).get("world", {}).get("race") or {}
    actions = []
    if race.get("state") == "lobby" and press_start and not started:
      others = [pid for pid in race.get("racers", {}) if pid != snap["you"]]
      if others:
        actions.append({"t": "race_go"})
        started = True
    if race.get("state") == "running":
      now = int(time.time() * 1000) + offset
      elapsed = (now - race["start"]) / 1000
      if elapsed > 0:
        p = min(speed * elapsed, TRACK * laps + 5)
        d = 3.5 * math.sin(elapsed / 3)
        if p >= TRACK * laps:
          actions.append({"t": "race_finish", "time": round(TRACK * laps / speed, 2)})
          finished = True
        else:
          actions.append({"t": "race_state", "p": round(p, 1), "d": round(d, 2), "v": speed})
          # --items: drop a Bug early on, and fire a Page Plane at the first rival it overtakes
          chaser = next((r for pid, r in race["racers"].items() if pid != snap["you"] and 8 < p - r["p"] < 45), None)
          if items and not dropped and chaser:
            actions.append({"t": "race_item", "kind": "bug", "p": round(p - 3, 1), "d": chaser["d"]})
            dropped = True
            log("dropped a Bug in the chaser's lane at", round(p - 3, 1), chaser["d"])
          rival = next((pid for pid, r in race["racers"].items() if pid != snap["you"] and 0 < r["p"] - p < 60), None)
          if items and not fired and rival:
            actions.append({"t": "race_item", "kind": "plane", "p": round(p + 2.5, 1), "d": round(d, 2), "target": rival})
            fired = True
            log("fired a Page Plane at", rival)
        others = {pid: (r["p"], r["v"], r["done"], r.get("spin")) for pid, r in race["racers"].items() if pid != snap["you"]}
        if race.get("items"):
          log("items on track:", [(i["kind"], i["by"], i["target"]) for i in race["items"]])
        log(f"t={elapsed:6.1f}s me p={p:7.1f}  others={others}")
    elif race.get("state") == "done":
      break
    snap = await sync(actions) or snap
  snap = await sync()
  if snap is None:
    log("the session ended")
    return
  log("final race", snap["world"]["race"])
  log("board", snap["world"].get("kart"))
  await call("leave", {"origin": host, "code": code})


if __name__ == "__main__":
  asyncio.run(main())
