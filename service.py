#!/usr/bin/env python3
"""Möbius Worlds service: the lobby, hosted rooms, and the guest relay.

Two doors, one entry (json-v1, one short process per request):

- Private (this owner's app): profile, friends, lobby, hosting, joining, and
  ``sync``. A sync for a room hosted here is applied locally; a sync for a
  room elsewhere is relayed to that host's public door.
- Public (other instances' Worlds services): ``public/info``,
  ``public/rooms``, ``public/join``, ``public/sync``, ``public/leave``.
  A browser visitor on this app's public link uses the same door as a guest
  with no Möbius of their own: ``public/guest`` welcomes them,
  ``public/join`` with ``browser: true`` seats them, and ``public/host``
  opens a session of their own here, which they host from an ordinary seat.

A joined guest holds a host-issued seat secret. The host trusts a guest's
claimed name and home address the way a party game trusts a room code: the
code is the invitation, the seat secret is the ticket.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import sys

import world  # noqa: F401  (preloaded for forked requests)
import identity
import rooms
import store
import transport

MOBIUS_PRELOAD = True
MAX_HOSTED = 3
# Sessions public-link visitors may host here at once (each closes a couple of
# minutes after its visitor leaves); the owner's own three are counted apart.
MAX_VISITOR_HOSTED = 6
MAX_FRIENDS = 24
INVITE_RE = re.compile(r"([A-Z0-9]{5})$")
# A public-link visitor has no Möbius instance; their seat says so instead of an origin.
BROWSER_HOME = "browser"


class Reply(Exception):
  def __init__(self, status: int, body: dict):
    super().__init__(status)
    self.status = status
    self.body = body


def fail(status: int, detail: str):
  raise Reply(status, {"worlds": True, "detail": detail})


def own_origin() -> str:
  return rooms.clean_origin(os.environ.get("INSTANCE_ORIGIN", "")) or "http://localhost"


def my_profile() -> dict:
  return rooms.clean_profile(store.profile() or {})


def parse_invite(text) -> tuple[str, str, str]:
  """Read an invite: '@handle/ABCDE' (a Möbius ID), 'host.example/ABCDE', a URL, or a bare code.

  Returns (kind, value, code) where kind is "handle", "origin" or "self".
  """
  if not isinstance(text, str) or not text.strip():
    fail(400, "Paste an invite like @friend/ABCDE.")
  raw = text.strip().rstrip("/")
  raw = re.sub(r"^https?://", "", raw)
  match = INVITE_RE.search(raw.upper())
  if not match:
    fail(400, "That invite is missing its 5-character room code.")
  code = match.group(1)
  head = raw[: match.start()].rstrip("/#?= ")
  if not head:
    return "self", own_origin(), code
  if head.startswith("@") or "." not in head.split("/", 1)[0]:
    handle = identity.clean_handle(head.split("/", 1)[0])
    if not handle:
      fail(400, "That invite's Möbius ID doesn't look right.")
    return "handle", handle, code
  origin = rooms.clean_origin(head)
  if not origin:
    fail(400, "That invite's Möbius address doesn't look right.")
  return "origin", origin, code


def invite_for(code: str, handle: str) -> str:
  """Invites name the host's Möbius ID when it has one, else its address."""
  if handle:
    return f"@{handle}/{code}"
  return f"{own_origin().split('://', 1)[1]}/{code}"


async def origins_for(address) -> tuple[list[str], str]:
  """A friend's Möbius instances, from an @ID or an address. Returns (origins, handle)."""
  text = str(address or "").strip()
  first = re.sub(r"^https?://", "", text).split("/", 1)[0]
  if text.startswith("@") or (first and "." not in first and ":" not in first):
    handle = identity.clean_handle(first)
    return await identity.resolve(handle), handle
  origin = rooms.clean_origin(text)
  if not origin:
    fail(400, "Enter a Möbius ID like @friend, or an address like friend.example.")
  return [origin], ""


# ------------------------------------------------------------------ rooms here

def _gc_rooms(now: int) -> None:
  for code in store.room_codes():
    room = store.load_room(code)
    if room is None or not rooms.is_live(room, now):
      store.delete_room(code)


def _local_sync(code: str, pid: str, secret, body: dict, now: int) -> dict:
  with store.locked():
    room = store.load_room(code)
    if room is None or not rooms.is_live(room, now):
      fail(404, "This session has ended.")
    rooms.authenticate(room, pid, secret)
    rooms.advance(room, now)
    if pid not in room["players"]:
      fail(410, "You were disconnected from this session.")
    rooms.apply_actions(room, pid, body.get("actions"), now)
    rooms.advance(room, now)
    store.save_room(room)
  since = body.get("since") if isinstance(body.get("since"), int) else 0
  extra = body.get("extra") if isinstance(body.get("extra"), dict) else {}
  return _with_host_apps(room, rooms.snapshot(room, pid, since, extra, now))


def _with_host_apps(room: dict, snap: dict) -> dict:
  """Rooms this owner hosts carry the apps they feature on the App Store stand."""
  snap["host_apps"] = [] if rooms.visitor_hosted(room) else store.host_apps()
  return snap


# ------------------------------------------------------------------ public door

def _listed_rooms(handle: str, now: int) -> list[dict]:
  with store.locked():
    _gc_rooms(now)
    listed = [
      rooms.listing(room, now)
      for code in store.room_codes()
      if (room := store.load_room(code)) and room.get("listed")
    ]
  for item in listed:
    item["host_handle"] = handle
  return listed


async def public_route(method: str, path: str, body: dict, now: int) -> dict:
  if path == "public/info" and method == "GET":
    profile = my_profile()
    return {"worlds": True, "v": 1, "name": profile["name"], "color": profile["color"],
            "handle": await identity.own_handle()}
  if path == "public/rooms" and method == "GET":
    handle = await identity.own_handle()
    return {"worlds": True, "rooms": _listed_rooms(handle, now), "host": my_profile(),
            "handle": handle}
  if path == "public/guest" and method == "GET":
    handle = await identity.own_handle()
    return {"worlds": True, "origin": own_origin(), "handle": handle, "host": my_profile(),
            "rooms": _listed_rooms(handle, now), "colors": list(rooms.GHOST_COLORS),
            "outfit": {slot: list(options) for slot, options in rooms.OUTFIT.items()}}
  if path == "public/join" and method == "POST":
    code = str(body.get("code") or "").upper()
    if body.get("browser") is True:
      home = BROWSER_HOME
    else:
      home = rooms.clean_origin(body.get("home"))
      if not home or home == own_origin():
        fail(400, "A guest must say which Möbius they come from.")
    with store.locked():
      room = store.load_room(code)
      if room is None or not rooms.is_live(room, now):
        fail(404, "That session isn't open.")
      rooms.advance(room, now)
      pid, secret = rooms.add_player(room, body.get("profile"), home, now)
      store.save_room(room)
    return {"worlds": True, "pid": pid, "secret": secret, "title": room["title"]}
  if path == "public/host" and method == "POST":
    profile = rooms.clean_profile(body.get("profile"))
    with store.locked():
      _gc_rooms(now)
      codes = store.room_codes()
      visitors = [c for c in codes if (r := store.load_room(c)) and rooms.visitor_hosted(r)]
      if len(visitors) >= MAX_VISITOR_HOSTED:
        fail(409, "This island is hosting as many visitor sessions as it can. Join one, or try again in a few minutes.")
      code = rooms.new_code(set(codes))
      room, pid, secret = rooms.create_room(
        code=code, title=body.get("title") or "", listed=body.get("listed", True),
        host_profile=profile, host_origin=own_origin(), now=now, host_home=BROWSER_HOME,
      )
      store.save_room(room)
    return {"worlds": True, "code": code, "pid": pid, "secret": secret, "title": room["title"]}
  if path == "public/sync" and method == "POST":
    code = str(body.get("code") or "").upper()
    pid = body.get("pid")
    if pid == "h":
      fail(403, "You are not in this session.")
    return _local_sync(code, pid, body.get("secret"), body, now)
  if path == "public/leave" and method == "POST":
    code = str(body.get("code") or "").upper()
    with store.locked():
      room = store.load_room(code)
      if room is not None and body.get("pid") != "h":
        rooms.authenticate(room, body.get("pid"), body.get("secret"))
        if body["pid"] == rooms.host_pid(room) and body.get("close"):
          store.delete_room(code)  # a visitor closing the session they host
        else:
          rooms.remove_player(room, body["pid"], now)
          store.save_room(room)
    return {"worlds": True, "ok": True}
  fail(404, "Not found.")


# ------------------------------------------------------------------ owner door

async def _friend_rooms(friend: dict) -> dict:
  try:
    reply = await transport.call(friend["origin"], "rooms", timeout=5)
    listed = reply.get("rooms") if isinstance(reply.get("rooms"), list) else []
    host = rooms.clean_profile(reply.get("host"))
    handle = identity.clean_handle(reply.get("handle")) or friend.get("handle", "")
    return {**friend, "handle": handle, "online": True, "host": host, "rooms": listed[:6]}
  except transport.PeerError as exc:
    return {**friend, "online": False, "error": exc.detail, "rooms": []}


async def private_route(method: str, path: str, body: dict, query: dict, now: int) -> dict:
  origin = own_origin()
  if path == "me" and method == "GET":
    raw = store.profile()
    return {"profile": my_profile(), "configured": raw is not None, "origin": origin,
            "handle": await identity.own_handle(),
            "colors": list(rooms.GHOST_COLORS),
            "outfit": {slot: list(options) for slot, options in rooms.OUTFIT.items()}}
  if path == "me" and method == "PUT":
    profile = rooms.clean_profile(body)
    with store.locked():
      store.save_profile(profile)
      # Keep this owner's avatar current in rooms they host.
      for code in store.room_codes():
        room = store.load_room(code)
        if room and "h" in room["players"]:
          room["players"]["h"].update(profile)
          rooms.touch(room)
          store.save_room(room)
    return {"profile": profile}

  if path == "host-apps" and method == "GET":
    return {"apps": store.host_apps()}
  if path == "host-apps" and method == "PUT":
    apps = rooms.clean_host_apps(body.get("apps"))
    with store.locked():
      store.save_host_apps(apps)
    return {"apps": apps}

  if path == "lobby" and method == "GET":
    handle = await identity.own_handle()
    with store.locked():
      _gc_rooms(now)
      hosted, visitors = [], []
      for code in store.room_codes():
        room = store.load_room(code)
        if room:
          (visitors if rooms.visitor_hosted(room) else hosted).append(
            {**rooms.listing(room, now), "listed": room["listed"],
             "origin": origin, "invite": invite_for(code, handle)})
    friends = store.friends()
    results = await asyncio.gather(*(_friend_rooms(f) for f in friends[:MAX_FRIENDS]))
    return {
      "origin": origin,
      "handle": handle,
      "profile": my_profile(),
      "hosted": sorted(hosted, key=lambda r: -r["created"]),
      "visitors": sorted(visitors, key=lambda r: -r["created"]),
      "friends": results,
    }

  if path == "friends" and method == "POST":
    candidates, handle = await origins_for(body.get("address"))
    candidates = [o for o in candidates if o != origin]
    if not candidates:
      fail(400, "That's your own Möbius.")
    info, friend_origin, last = None, None, None
    for candidate in candidates:
      try:
        info = await transport.call(candidate, "info", timeout=6)
        friend_origin = candidate
        break
      except transport.PeerError as exc:
        last = exc
    if info is None:
      raise last
    handle = handle or identity.clean_handle(info.get("handle"))
    label = rooms.clean_text(body.get("label"), 24) or rooms.clean_text(info.get("name"), 24)
    with store.locked():
      current = [f for f in store.friends() if f.get("origin") != friend_origin]
      if len(current) >= MAX_FRIENDS:
        fail(409, "Your friends list is full.")
      current.append({"origin": friend_origin, "handle": handle, "label": label or friend_origin, "added": now})
      store.save_friends(current)
    return {"ok": True, "friend": current[-1]}
  if path == "friends" and method == "DELETE":
    target = rooms.clean_origin((query.get("origin") or [""])[0])
    with store.locked():
      store.save_friends([f for f in store.friends() if f.get("origin") != target])
    return {"ok": True}

  if path == "host" and method == "POST":
    with store.locked():
      _gc_rooms(now)
      codes = store.room_codes()
      if sum(1 for c in codes if (r := store.load_room(c)) and not rooms.visitor_hosted(r)) >= MAX_HOSTED:
        fail(409, "You already host three sessions. Close one first.")
      code = rooms.new_code(set(codes))
      room, pid, secret = rooms.create_room(
        code=code, title=body.get("title") or "", listed=body.get("listed", True),
        host_profile=my_profile(), host_origin=origin, now=now,
      )
      store.save_room(room)
    return {"origin": origin, "code": code, "invite": invite_for(code, await identity.own_handle()),
            "title": room["title"]}

  if path == "join" and method == "POST":
    handle = ""
    if body.get("origin") and body.get("code"):
      targets = [rooms.clean_origin(body["origin"])]
      code = str(body["code"]).upper()
      handle = identity.clean_handle(body.get("handle"))
    else:
      kind, value, code = parse_invite(body.get("invite"))
      if kind == "handle":
        handle = value
        targets = await identity.resolve(value)
      else:
        targets = [value]
    invite = f"@{handle}/{code}" if handle else f"{targets[0].split('://', 1)[1]}/{code}"
    if origin in targets and store.load_room(code) is not None:
      with store.locked():
        room = store.load_room(code)
        if room is None or not rooms.is_live(room, now):
          fail(404, "That session isn't open.")
        if rooms.visitor_hosted(room) and _own_seat(room, code) is None:
          # a visitor hosts this one: the owner takes an ordinary seat in it
          rooms.advance(room, now)
          pid, secret = rooms.add_player(room, my_profile(), origin, now)
          store.save_room(room)
          store.save_seat(origin, code, {"origin": origin, "code": code, "pid": pid,
                                         "secret": secret, "title": room["title"], "joined": now})
      return {"origin": origin, "code": code, "title": room["title"],
              "invite": invite_for(code, await identity.own_handle())}
    last = None
    for target in [t for t in targets if t != origin]:
      seat = store.load_seat(target, code)
      if seat is None:
        try:
          reply = await transport.call(target, "join", method="POST", body={
            "code": code, "profile": my_profile(), "home": origin,
          })
        except transport.PeerError as exc:
          last = exc
          if exc.status in (404, 502, 504):
            continue  # try this person's other Möbius instances
          raise
        seat = {"origin": target, "code": code, "pid": reply["pid"],
                "secret": reply["secret"], "title": rooms.clean_text(reply.get("title"), 40),
                "joined": now}
        store.save_seat(target, code, seat)
      return {"origin": target, "code": code, "title": seat.get("title"), "invite": invite}
    if last is not None:
      raise last
    fail(404, "That session isn't open.")

  if path == "sync" and method == "POST":
    target = rooms.clean_origin(body.get("origin"))
    code = str(body.get("code") or "").upper()
    if target == origin:
      room = store.load_room(code)
      if room is not None and rooms.visitor_hosted(room):
        seat = _own_seat(room, code)
        if seat is None:
          fail(404, "You haven't joined that session.")
        return _local_sync(code, seat["pid"], seat["secret"], body, now)
      return _host_sync(code, body, now)
    seat = store.load_seat(target, code)
    if seat is None:
      fail(404, "You haven't joined that session.")
    try:
      reply = await transport.call(target, "sync", method="POST", body={
        "code": code, "pid": seat["pid"], "secret": seat["secret"],
        "since": body.get("since"), "extra": body.get("extra"),
        "actions": body.get("actions"),
      })
    except transport.PeerError as exc:
      if exc.status in (403, 404, 410):
        store.delete_seat(target, code)
      if exc.status == 429:
        return {"throttled": True, "poll_ms": 6000}
      raise
    return reply

  if path == "leave" and method == "POST":
    target = rooms.clean_origin(body.get("origin"))
    code = str(body.get("code") or "").upper()
    if target == origin:
      with store.locked():
        room = store.load_room(code)
        seat = store.load_seat(origin, code)
        store.delete_seat(origin, code)
        if room is not None and body.get("close"):
          store.delete_room(code)  # the owner may close any session on their island
        elif room is not None and seat and seat["pid"] in room["players"]:
          rooms.remove_player(room, seat["pid"], now)
          store.save_room(room)
      return {"ok": True}
    seat = store.load_seat(target, code)
    store.delete_seat(target, code)
    if seat:
      try:
        await transport.call(target, "leave", method="POST", body={
          "code": code, "pid": seat["pid"], "secret": seat["secret"],
        }, timeout=5)
      except transport.PeerError:
        pass
    return {"ok": True}

  fail(404, "Not found.")


def _own_seat(room: dict, code: str) -> dict | None:
  """The owner's ordinary seat in a visitor's session here, while it is still theirs."""
  seat = store.load_seat(own_origin(), code)
  return seat if seat and seat.get("pid") in room["players"] else None


def _host_sync(code: str, body: dict, now: int) -> dict:
  """The owner's own seat in a room hosted here: seat 'h', no secret needed."""
  with store.locked():
    room = store.load_room(code)
    if room is None:
      fail(404, "This session has ended.")
    rooms.advance(room, now)
    rooms.apply_actions(room, "h", body.get("actions"), now)
    rooms.advance(room, now)
    store.save_room(room)
  since = body.get("since") if isinstance(body.get("since"), int) else 0
  extra = body.get("extra") if isinstance(body.get("extra"), dict) else {}
  return _with_host_apps(room, rooms.snapshot(room, "h", since, extra, now))


# ------------------------------------------------------------------ adapter

async def dispatch(request: dict) -> dict:
  method = str(request.get("method") or "GET").upper()
  path = str(request.get("path") or "").strip("/")
  body = request.get("body") if isinstance(request.get("body"), dict) else {}
  query = request.get("query") if isinstance(request.get("query"), dict) else {}
  now = rooms.now_ms()
  try:
    if request.get("public"):
      result = await public_route(method, path, body, now)
    elif path.startswith("public/"):
      # The owner's app may probe its own public door (e.g. info) too.
      result = await public_route(method, path, body, now)
    else:
      result = await private_route(method, path, body, query, now)
    return {"status": 200, "body": result}
  except Reply as reply:
    return {"status": reply.status, "body": reply.body}
  except rooms.RoomError as exc:
    return {"status": exc.status, "body": {"worlds": True, "detail": exc.detail}}
  except transport.PeerError as exc:
    status = exc.status if 400 <= exc.status < 600 else 502
    return {"status": status, "body": {"worlds": True, "detail": exc.detail}}
  except identity.HandleError as exc:
    return {"status": exc.status, "body": {"worlds": True, "detail": exc.detail}}


if __name__ == "__main__":
  try:
    envelope = json.load(sys.stdin)
    print(json.dumps(asyncio.run(dispatch(envelope)), ensure_ascii=False,
                     separators=(",", ":")))
  except Exception as exc:  # the platform logs stderr and answers 502
    print(f"Worlds service failed: {exc!r}", file=sys.stderr)
    raise SystemExit(1)
