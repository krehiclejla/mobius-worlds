#!/usr/bin/env python3
"""A scripted guest from a *different* Möbius, for end-to-end testing.

It runs this app's own service code with separate storage and a separate
home address, so every call it makes takes the real guest path: its own
service relays over the public internet to the host's public Worlds door.

  python3 tools/guest_bot.py <host-origin> <minutes> [<room-code>]

The bot walks the Worlds Lobby: from the Möbius crystal down the lamp-lit
path, over the party bridge to the dance floor and back, chatting and emoting.
It reports ground height roughly (its own game would land it exactly).
"""

from __future__ import annotations

import asyncio
import json
import math
import os
import random
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE))
os.environ["APP_STORAGE_DIR"] = os.environ.get("BOT_STORAGE") or tempfile.mkdtemp(prefix="worlds-guest-")
os.environ["INSTANCE_ORIGIN"] = os.environ.get("BOT_ORIGIN", "https://guest-mobius.example")

import service  # noqa: E402

LOG = []


def log(*parts):
  line = f"{time.strftime('%H:%M:%S')} " + " ".join(str(p) for p in parts)
  print(line, flush=True)


async def call(path, body=None, method="POST"):
  reply = await service.dispatch({"method": method, "path": path, "body": body or {}, "query": {}, "public": False})
  return reply["status"], reply["body"]


# A walk through the lobby: (x, y, z) waypoints in the scene's metres.
PATH = [(0, 0.6, 9), (0, 0.5, 18), (0, 0.9, 29), (0, 0.6, 42), (0, 0.8, 49.5), (3, 0.8, 47), (0, 0.6, 42), (0, 0.9, 29), (0, 0.5, 18)]
LINES = [("say", "Hi from another Möbius! 👋"), ("emote", "wave"), ("say", "Off to the dance floor"),
         ("emote", "dance"), ("say", "Who's up for a Kart race?"), ("emote", "heart")]
SPEED = 3.0  # metres a second


def walk(t):
  """Where the bot is t seconds into its loop, and which way it faces."""
  legs = [(a, b, math.dist(a, b)) for a, b in zip(PATH, PATH[1:] + PATH[:1])]
  t %= sum(d for *_, d in legs) / SPEED
  for a, b, d in legs:
    if t * SPEED <= d:
      k = t * SPEED / d if d else 0
      return tuple(round(a[i] + (b[i] - a[i]) * k, 2) for i in range(3)), math.atan2(b[0] - a[0], b[2] - a[2])
    t -= d / SPEED
  return PATH[0], 0.0


async def main():
  host, minutes = sys.argv[1], float(sys.argv[2])
  await call("me", {"name": "Ana (guest)", "color": "#ffb3cf", "face": "happy", "hat": "crown", "neck": "lanyard", "hold": "balloon"}, "PUT")
  status, body = await call("friends", {"address": host})
  log("add friend", status, body.get("detail") or body.get("friend", {}).get("label"))
  status, lobby = await call("lobby", method="GET")
  rooms = [r for f in lobby.get("friends", []) for r in f.get("rooms", [])]
  log("lobby: friend rooms", [(r["code"], r["title"], r["players"]) for r in rooms])
  code = sys.argv[3] if len(sys.argv) > 3 else rooms[0]["code"]
  status, joined = await call("join", {"origin": host, "code": code})
  log("join", status, joined)
  since = 0
  requests = 0
  deadline = time.time() + minutes * 60
  start = time.time()
  line = 0
  next_line = time.time() + 2
  while time.time() < deadline:
    (x, y, z), r = walk(time.time() - start)
    actions = [{"t": "move", "x": x, "y": y, "z": z, "r": round(r, 2)}]
    if time.time() >= next_line:
      kind, value = LINES[line % len(LINES)]
      actions.append({"t": "say", "text": value} if kind == "say" else {"t": "emote", "e": value})
      log(kind, value, "at", (x, z))
      line += 1
      next_line = time.time() + 9
    status, snap = await call("sync", {"origin": host, "code": code, "since": since, "actions": actions})
    requests += 1
    if status != 200:
      log("sync", status, snap)
      await asyncio.sleep(3)
      continue
    if snap.get("throttled"):
      log("throttled")
      await asyncio.sleep(snap["poll_ms"] / 1000)
      continue
    since = max([since] + [e["seq"] for e in snap["events"]])
    for e in snap["events"]:
      log("event", e["kind"], e.get("text"))
    await asyncio.sleep(snap["poll_ms"] / 1000)
  log("done; requests sent to host:", requests)
  await call("leave", {"origin": host, "code": code})


asyncio.run(main())
