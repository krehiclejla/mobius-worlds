"""Outbound calls from this instance's Worlds service to another instance's.

Guests' browsers can only reach their own Möbius, so their service relays each
coalesced sync to the host's public Worlds door. Every destination comes from
user input, so each request is DNS-validated and pinned against the shared
SSRF blocklist (``net_utils.py``, from Social), never follows redirects,
ignores ambient proxies, and caps the response size.
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

import httpx

MAX_RESPONSE_BYTES = 1024 * 1024
_RESOLVER = Path(__file__).with_name("dns_resolver.py")
SERVICE_PATH = "/api/app-services/mobius-worlds/public/"


class PeerError(Exception):
  def __init__(self, status: int, detail: str):
    super().__init__(detail)
    self.status = status
    self.detail = detail


async def _resolve(url: str) -> tuple[list[str], str, str]:
  process = await asyncio.create_subprocess_exec(
    sys.executable, str(_RESOLVER), url,
    stdin=asyncio.subprocess.DEVNULL,
    stdout=asyncio.subprocess.PIPE,
    stderr=asyncio.subprocess.DEVNULL,
  )
  try:
    stdout, _ = await process.communicate()
  except BaseException:
    if process.returncode is None:
      process.kill()
    await process.wait()
    raise
  try:
    payload = json.loads(stdout)
  except (UnicodeDecodeError, json.JSONDecodeError) as exc:
    raise PeerError(502, "Could not look up that Möbius address.") from exc
  if not isinstance(payload, dict) or payload.get("ok") is not True:
    detail = payload.get("detail") if isinstance(payload, dict) else None
    raise PeerError(400, f"That Möbius address can't be reached ({detail or 'lookup failed'}).")
  return payload["pinned_urls"], payload["host_header"], payload["sni_host"]


async def call(origin: str, path: str, *, method: str = "GET", body=None,
               timeout: float = 8.0) -> dict:
  """Call ``<origin>/api/app-services/mobius-worlds/public/<path>``; return its JSON."""
  url = origin.rstrip("/") + SERVICE_PATH + path.lstrip("/")
  try:
    async with asyncio.timeout(timeout):
      pinned, host_header, sni = await _resolve(url)
      async with httpx.AsyncClient(follow_redirects=False, timeout=timeout,
                                   trust_env=False) as client:
        upstream = None
        last_error = None
        for pinned_url in pinned:
          request = client.build_request(method, pinned_url, json=body)
          request.headers["host"] = host_header
          request.extensions["sni_hostname"] = sni
          try:
            upstream = await client.send(request, stream=True)
            break
          except (httpx.ConnectError, httpx.ConnectTimeout) as exc:
            last_error = exc
        if upstream is None:
          raise PeerError(502, "That Möbius didn't answer.") from last_error
        try:
          data = bytearray()
          async for chunk in upstream.aiter_bytes():
            data.extend(chunk)
            if len(data) > MAX_RESPONSE_BYTES:
              raise PeerError(502, "That Möbius sent too much data.")
        finally:
          await upstream.aclose()
  except TimeoutError as exc:
    raise PeerError(504, "That Möbius took too long to answer.") from exc
  except httpx.HTTPError as exc:
    raise PeerError(502, "That Möbius couldn't be reached.") from exc
  status = upstream.status_code
  if 300 <= status < 400:
    raise PeerError(502, "That Möbius redirected; Worlds doesn't follow redirects.")
  try:
    value = json.loads(bytes(data))
  except (UnicodeDecodeError, json.JSONDecodeError):
    value = None
  if status == 404 and not (isinstance(value, dict) and value.get("worlds")):
    raise PeerError(404, "That Möbius doesn't have Möbius Worlds installed.")
  if status == 429:
    raise PeerError(429, "The host is busy; slowing down.")
  if not isinstance(value, dict):
    raise PeerError(502, "That Möbius sent an unexpected reply.")
  if status >= 400:
    raise PeerError(status, str(value.get("detail") or "The host refused the request."))
  return value
