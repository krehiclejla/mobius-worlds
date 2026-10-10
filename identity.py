"""Möbius ID handles for Worlds: this instance's own @handle, and @handle -> hosts.

Both come from the platform's identity bridge (the app's `identity_manage`
permission; Worlds only reads). The bridge asks mobius.you with this
instance's own account link, so lookups work when this Möbius is signed in to
a Möbius account (linked or managed). Results are cached briefly on disk
because every request runs in a fresh process.
"""

from __future__ import annotations

import json
import os
import re
import time
from urllib.parse import quote

import httpx

import store

HANDLE_RE = re.compile(r"^[a-z0-9_]{3,30}$")  # the platform's Möbius ID rule
OWN_TTL = 600
LOOKUP_TTL = 300


class HandleError(Exception):
  def __init__(self, status: int, detail: str):
    super().__init__(detail)
    self.status = status
    self.detail = detail


def clean_handle(value) -> str:
  if not isinstance(value, str):
    return ""
  text = value.strip().lower().lstrip("@")
  return text if HANDLE_RE.match(text) else ""


async def _platform_get(path: str) -> httpx.Response:
  base = os.environ.get("API_BASE_URL", "http://localhost:8080").rstrip("/")
  token = os.environ.get("APP_TOKEN", "")
  async with httpx.AsyncClient(timeout=10, trust_env=False) as client:
    return await client.get(base + path, headers={"Authorization": f"Bearer {token}"})


def _cache_path(name: str):
  return store.root() / name


async def own_handle() -> str:
  """This Möbius owner's @handle, or "" when the instance isn't signed in."""
  cached = store.read_json(_cache_path("identity.json"), None)
  if isinstance(cached, dict) and time.time() - cached.get("at", 0) < OWN_TTL:
    return cached.get("handle") or ""
  handle = ""
  try:
    response = await _platform_get("/api/identity")
    if response.status_code == 200:
      payload = response.json()
      profile = payload.get("profile") if isinstance(payload, dict) else None
      handle = clean_handle((profile or {}).get("handle") or payload.get("handle"))
    elif isinstance(cached, dict):
      return cached.get("handle") or ""
  except (httpx.HTTPError, ValueError):
    return (cached or {}).get("handle") or "" if isinstance(cached, dict) else ""
  store.write_json(_cache_path("identity.json"), {"handle": handle, "at": time.time()})
  return handle


async def resolve(handle: str) -> list[str]:
  """The https origins of every Möbius deployment registered to @handle."""
  handle = clean_handle(handle)
  if not handle:
    raise HandleError(400, "That Möbius ID doesn't look right.")
  cache = store.read_json(_cache_path("handles.json"), {})
  hit = cache.get(handle) if isinstance(cache, dict) else None
  if isinstance(hit, dict) and time.time() - hit.get("at", 0) < LOOKUP_TTL:
    return hit["origins"]
  try:
    response = await _platform_get("/api/identity/handles/" + quote(handle, safe=""))
  except httpx.HTTPError as exc:
    raise HandleError(502, "Couldn't reach the Möbius ID service.") from exc
  if response.status_code == 404:
    raise HandleError(404, f"No one has the Möbius ID @{handle}.")
  if response.status_code == 400:
    raise HandleError(400, f"@{handle} isn't a valid Möbius ID.")
  if response.status_code == 403:
    raise HandleError(403, "Möbius Worlds needs permission to look up Möbius IDs.")
  if response.status_code != 200:
    raise HandleError(502, "The Möbius ID service couldn't look that up right now.")
  payload = response.json()
  if not payload.get("linked"):
    raise HandleError(409, "This Möbius isn't signed in to a Möbius account, so it can't look up @IDs. "
                           "Sign in with Möbius · You, or use the full address.")
  origins = []
  for host in payload.get("hosts") or []:
    if isinstance(host, str) and re.fullmatch(r"[a-z0-9.-]{1,253}(:\d{1,5})?", host.lower()):
      origins.append("https://" + host.lower())
  if not origins:
    raise HandleError(404, f"@{handle} doesn't have a Möbius online right now.")
  cache = cache if isinstance(cache, dict) else {}
  cache[handle] = {"origins": origins[:5], "at": time.time()}
  store.write_json(_cache_path("handles.json"), cache)
  return origins[:5]
