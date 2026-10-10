"""File-backed state for the Worlds service.

Private (owner) and public (guest) requests run on separate serialized lanes,
so both can touch the same room at once. One advisory lock guards every
read-modify-write; each critical section is a few milliseconds of JSON.
"""

from __future__ import annotations

import contextlib
import fcntl
import json
import os
import re
from pathlib import Path

CODE_RE = re.compile(r"^[A-Z0-9]{5}$")


def root() -> Path:
  base = Path(os.environ.get("APP_STORAGE_DIR") or "./.worlds-data") / "svc"
  (base / "rooms").mkdir(parents=True, exist_ok=True)
  (base / "seats").mkdir(parents=True, exist_ok=True)
  return base


@contextlib.contextmanager
def locked():
  path = root() / ".lock"
  with open(path, "a+") as handle:
    fcntl.flock(handle, fcntl.LOCK_EX)
    try:
      yield
    finally:
      fcntl.flock(handle, fcntl.LOCK_UN)


def read_json(path: Path, default):
  try:
    with open(path, encoding="utf-8") as handle:
      return json.load(handle)
  except (FileNotFoundError, json.JSONDecodeError):
    return default


def write_json(path: Path, value) -> None:
  tmp = path.with_suffix(path.suffix + ".tmp")
  with open(tmp, "w", encoding="utf-8") as handle:
    json.dump(value, handle, ensure_ascii=False, separators=(",", ":"))
  os.replace(tmp, path)


def room_path(code: str) -> Path:
  if not CODE_RE.match(code or ""):
    raise KeyError(code)
  return root() / "rooms" / f"{code}.json"


def load_room(code: str) -> dict | None:
  try:
    return read_json(room_path(code), None)
  except KeyError:
    return None


def save_room(room: dict) -> None:
  write_json(room_path(room["code"]), room)


def delete_room(code: str) -> None:
  with contextlib.suppress(KeyError, FileNotFoundError):
    room_path(code).unlink()


def room_codes() -> list[str]:
  return [p.stem for p in (root() / "rooms").glob("*.json")]


def _seat_path(origin: str, code: str) -> Path:
  host = re.sub(r"[^a-z0-9.-]", "_", origin.split("://", 1)[-1])
  return root() / "seats" / f"{host}__{code}.json"


def load_seat(origin: str, code: str) -> dict | None:
  return read_json(_seat_path(origin, code), None)


def save_seat(origin: str, code: str, seat: dict) -> None:
  write_json(_seat_path(origin, code), seat)


def delete_seat(origin: str, code: str) -> None:
  with contextlib.suppress(FileNotFoundError):
    _seat_path(origin, code).unlink()


def seats() -> list[dict]:
  out = []
  for path in (root() / "seats").glob("*.json"):
    seat = read_json(path, None)
    if isinstance(seat, dict):
      out.append(seat)
  return out


def profile() -> dict | None:
  return read_json(root() / "profile.json", None)


def save_profile(value: dict) -> None:
  write_json(root() / "profile.json", value)


def friends() -> list[dict]:
  value = read_json(root() / "friends.json", [])
  return value if isinstance(value, list) else []


def save_friends(value: list[dict]) -> None:
  write_json(root() / "friends.json", value)


def host_apps() -> list[dict]:
  value = read_json(root() / "host_apps.json", [])
  return value if isinstance(value, list) else []


def save_host_apps(value: list[dict]) -> None:
  write_json(root() / "host_apps.json", value)
