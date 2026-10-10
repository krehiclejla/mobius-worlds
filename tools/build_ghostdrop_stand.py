#!/usr/bin/env python3
"""Build the Ghost Drop stand for the Worlds lobby (a sibling of the Möbius Kart stand).

  python3 tools/build_ghostdrop_stand.py OUT.glb

The stand tells the game at a glance: a round stage over a dark void, a tower of
four floating hex layers in the game's own layer colours with tiles already
gone, a crowned ghost on top, a ghost tumbling through a hole, another peering
over an edge, a big "GHOST DROP" sign and a "TAP TO PLAY" board. Same footprint
and height as the kart stand (about 6.8 m across, 6.4 m tall), facing +Z.

Ghosts, faces and the crown come from tools/build_models.py so they match the
players' ghosts exactly. Uses Game Studio's shape tools (trimesh).
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import numpy as np
import trimesh
from PIL import Image, ImageDraw, ImageFont
from trimesh.visual import TextureVisuals
from trimesh.visual.material import PBRMaterial

HERE = Path(__file__).resolve().parent
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "ghost-drop-stand.glb")

# Borrow the shared ghost parts: run build_models.py's definitions without its build calls,
# and capture what its save() would have written instead of writing files.
src = (HERE / "build_models.py").read_text()
src = src[:src.rindex("\nghost()\n")]
captured: dict[str, list] = {}
bm: dict = {"__name__": "build_models_lib"}
_argv = sys.argv
sys.argv = [str(HERE / "build_models.py"), str(Path("/tmp/_gd_unused"))]
exec(compile(src, "build_models.py", "exec"), bm)
sys.argv = _argv
bm["save"] = lambda name, parts, ground=False: captured.__setitem__(name, parts)
bm["ghost"]()
bm["faces"]()
bm["hats"]()
mat, sphere, sweep, arc, lathe, rot = bm["mat"], bm["sphere"], bm["sweep"], bm["arc"], bm["lathe"], bm["rot"]
box, cylinder, move = bm["box"], bm["cylinder"], bm["move"]
INK, GOLD, WHITE = bm["INK"], bm["GOLD"], bm["WHITE"]

CONFIG = json.loads((HERE.parent / "ghostdrop_config.json").read_text())
hexrgb = lambda h: tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))
LAYER = [hexrgb(c) for c in CONFIG["layerColors"]]

PEARL = (244, 241, 255)     # the kart stand's stage white
VOID = (28, 20, 52)
DUSK = (42, 33, 72)
PINK = (255, 79, 216)
VIOLET = (124, 77, 255)
CYAN = (61, 224, 255)
GLOW_PINK, GLOW_GOLD, GLOW_CYAN = (255, 79, 216), (255, 210, 63), (61, 224, 255)
FONT = "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"

parts: list = []
names: list = []


def add(name, mesh):
  parts.append(mesh)
  names.append(name)


def glow(mesh, color, name="Glow"):
  return mat(mesh, color, name, rough=0.35, emissive=color)


# ---------- signs: textured boards like the kart stand ----------
def board_texture(w, h, lines, border, radius=40, pad=14):
  """A white rounded board with a coloured border; lines = [(text, size_ratio, colour)]."""
  img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
  d = ImageDraw.Draw(img)
  bw = max(8, h // 22)
  d.rounded_rectangle((bw // 2 + 2, bw // 2 + 2, w - bw // 2 - 3, h - bw // 2 - 3), radius=radius, fill=(255, 255, 255, 255), outline=border, width=bw)
  total = sum(int(h * r) for _, r, _ in lines) + pad * (len(lines) - 1)
  y = (h - total) / 2
  for text, ratio, colour in lines:
    size = int(h * ratio)
    font = ImageFont.truetype(FONT, size)
    while d.textlength(text, font=font) + 2 * max(1, size // 22) > w - 2 * (bw + 34) and size > 10:
      size -= 2
      font = ImageFont.truetype(FONT, size)
    tw = d.textlength(text, font=font)
    top = font.getbbox(text)[1]
    d.text(((w - tw) / 2, y - top + (int(h * ratio) - size) / 2), text, font=font, fill=colour, stroke_width=max(1, size // 22), stroke_fill=colour)
    y += int(h * ratio) + pad
  return img


def textured_quad(img, width, height, at, emissive=0.85):
  """A front-facing (+Z) quad showing img, centred at `at`."""
  x, y, z = at
  v = np.array([[-width / 2, -height / 2, 0], [width / 2, -height / 2, 0], [width / 2, height / 2, 0], [-width / 2, height / 2, 0]]) + [x, y, z]
  m = trimesh.Trimesh(v, [[0, 1, 2], [0, 2, 3]], process=False)
  uv = np.array([[0, 0], [1, 0], [1, 1], [0, 1]], float)
  material = PBRMaterial(baseColorTexture=img, emissiveTexture=img, emissiveFactor=[emissive] * 3,
                         metallicFactor=0.0, roughnessFactor=0.6, alphaMode="BLEND", doubleSided=False)
  m.visual = TextureVisuals(uv=uv, material=material)
  return m


def hex_band_texture(w=1024, h=48):
  """The flag band under the sign: a row of hex tiles in the layer colours (the kart has a checker band)."""
  img = Image.new("RGBA", (w, h), (*DUSK, 255))
  d = ImageDraw.Draw(img)
  r = h * 0.46
  step = r * math.sqrt(3) * 1.02
  i, x = 0, step / 2
  while x < w + step:
    c = LAYER[i % 4]
    pts = [(x + r * math.cos(math.radians(60 * k + 30)), h / 2 + r * math.sin(math.radians(60 * k + 30))) for k in range(6)]
    d.polygon(pts, fill=(*c, 255))
    i += 1
    x += step
  return img


# ---------- the stage ----------
STAGE_R, STAGE_H = 3.3, 0.3
add("stage", mat(lathe([(0, 0), (STAGE_R, 0), (STAGE_R + 0.05, 0.12), (STAGE_R, STAGE_H), (0, STAGE_H)], sides=64), PEARL, "Stage", rough=0.45))
add("stage_void", mat(cylinder(STAGE_R - 0.25, 0.02, (0, STAGE_H + 0.01, 0), sides=64), VOID, "Void", rough=0.9))
add("stage_ring", glow(sweep([(math.cos(a) * (STAGE_R - 0.12), STAGE_H + 0.02, math.sin(a) * (STAGE_R - 0.12)) for a in np.linspace(0, 2 * math.pi, 97)], 0.035, sides=8), GLOW_PINK, "GlowPink"))
for i in range(16):
  a = 2 * math.pi * i / 16
  c = (GLOW_GOLD, GLOW_PINK)[i % 2]
  add(f"rim_light_{i}", glow(sphere(0.07, (math.cos(a) * (STAGE_R + 0.03), 0.15, math.sin(a) * (STAGE_R + 0.03))), c))

# A swirl of faint stars in the void under the tower (the game's starry drop).
rng = np.random.default_rng(7)
TOWER = (0.0, -0.25)  # tower centre (x, z)
for i in range(26):
  a, rr = rng.uniform(0, 2 * math.pi), rng.uniform(0.2, 1.9)
  add(f"void_star_{i}", glow(sphere(rng.uniform(0.02, 0.045), (TOWER[0] + math.cos(a) * rr, STAGE_H + 0.03, TOWER[1] + math.sin(a) * rr), sub=1), (235, 230, 255), "Star"))

# ---------- the tower: four hex layers, top layer highest ----------
TS, TILE_H, RINGS = 0.37, 0.22, 2
LAYER_Y = [3.95, 2.95, 1.95, 0.95]          # layer 0 on top, as in the game
SQ3 = math.sqrt(3)


def hex_cells(rings):
  for q in range(-rings, rings + 1):
    for r in range(max(-rings, -q - rings), min(rings, -q + rings) + 1):
      yield q, r


def cell_xz(q, r):
  return TOWER[0] + TS * (SQ3 * q + SQ3 / 2 * r), TOWER[1] + TS * 1.5 * r


# Tiles that are already gone (more on the upper layers, where the drop has been running longest),
# tiles lit up and about to vanish, and the hole the falling ghost went through.
GONE = {
  0: {(1, 0), (0, 1), (-1, 1), (2, -1), (-2, 0), (-1, 2), (1, 1)},
  1: {(0, 0), (1, 0), (-1, 2), (2, -2), (-2, 1)},
  2: {(1, -1), (-2, 2), (2, 0)},
  3: {(0, -2)},
}
LIT = {0: {(0, 0), (-1, 0)}, 1: {(0, 1), (1, 1)}, 2: {(0, 0)}, 3: set()}
hex_tile = trimesh.creation.cylinder(radius=TS * 0.95, height=TILE_H, sections=6)
hex_tile.apply_transform(trimesh.transformations.rotation_matrix(math.pi / 2, (1, 0, 0)))
hex_tile.apply_transform(trimesh.transformations.rotation_matrix(math.radians(30), (0, 1, 0)))  # pointy-top, as in the game
for L, y in enumerate(LAYER_Y):
  col = LAYER[L]
  for q, r in hex_cells(RINGS):
    if (q, r) in GONE[L]:
      continue
    x, z = cell_xz(q, r)
    t = hex_tile.copy()
    t.apply_translation((x, y - TILE_H / 2, z))
    if (q, r) in LIT[L]:
      add(f"tile_{L}_{q}_{r}", mat(t, (255, 250, 255), f"TileLit{L}", rough=0.3, emissive=tuple(min(255, int(c * 0.5 + 128)) for c in col)))
    else:
      add(f"tile_{L}_{q}_{r}", mat(t, col, f"Tile{L}", rough=0.5, emissive=tuple(int(c * 0.18) for c in col)))

# Three slim glowing posts hold the layers up (the game's layers simply float).
POST_R = TS * SQ3 * RINGS + TS * 0.9
for i, deg in enumerate((30, 150, 270)):  # front left open
  a = math.radians(deg)
  px, pz = TOWER[0] + math.cos(a) * POST_R, TOWER[1] + math.sin(a) * POST_R
  add(f"tower_post_{i}", mat(cylinder(0.045, LAYER_Y[0] - STAGE_H + 0.15, (px, (LAYER_Y[0] + STAGE_H) / 2 + 0.07, pz), sides=10), PEARL, "Post", rough=0.35))
  add(f"tower_cap_{i}", glow(sphere(0.1, (px, LAYER_Y[0] + 0.2, pz)), GLOW_CYAN, "GlowCyan"))
  for L, y in enumerate(LAYER_Y):
    inner = (TOWER[0] + math.cos(a) * (POST_R - 0.32), TOWER[1] + math.sin(a) * (POST_R - 0.32))
    add(f"bracket_{i}_{L}", mat(sweep([(inner[0], y - TILE_H * 0.6, inner[1]), (px, y - TILE_H * 0.6, pz)], 0.025, sides=6), PEARL, "Post"))
    add(f"bracket_light_{i}_{L}", glow(sphere(0.05, (px, y - TILE_H * 0.6, pz), sub=1), LAYER[L]))


# ---------- ghosts ----------
def ghost_parts(tint, face, scale, at, yaw=0.0, tilt=(0.0, 0.0), extra=()):
  """The players' ghost (1 m tall, hem at y=0, facing +Z) scaled, tinted and placed."""
  out = []
  for p in [*captured["ghost"], *captured[face], *extra]:
    m = p.copy()
    mname = m.visual.material.name
    if mname == "Body":
      m.visual = TextureVisuals(material=PBRMaterial(name="Body", baseColorFactor=[*[c / 255 for c in tint], 1.0],
                                                      emissiveFactor=[c / 255 * 0.22 for c in tint], metallicFactor=0.0, roughnessFactor=0.5))
    m.apply_scale(scale)
    if tilt[0]:
      m.apply_transform(trimesh.transformations.rotation_matrix(math.radians(tilt[0]), (1, 0, 0), point=(0, 0.5 * scale, 0)))
    if tilt[1]:
      m.apply_transform(trimesh.transformations.rotation_matrix(math.radians(tilt[1]), (0, 0, 1), point=(0, 0.5 * scale, 0)))
    if yaw:
      m.apply_transform(trimesh.transformations.rotation_matrix(math.radians(yaw), (0, 1, 0)))
    m.apply_translation(at)
    out.append(m)
  return out


def surprised_face():
  """Dot eyes and a round 'o' — the face of a ghost whose tile just vanished."""
  Z, y = bm["Z"], 0.62
  eyes = [mat(sphere(1, (x, y + 0.02, Z(y) - 0.02), (0.055, 0.085, 0.03)), INK, "Ink") for x in (-0.13, 0.13)]
  shine = [mat(sphere(0.02, (x + 0.017, y + 0.055, Z(y) + 0.005)), WHITE, "White") for x in (-0.13, 0.13)]
  mouth = mat(sphere(1, (0, y - 0.13, Z(y - 0.13) - 0.025), (0.05, 0.06, 0.03)), (120, 30, 50), "Mouth")
  cheeks = [mat(sphere(1, (x, y - 0.1, Z(y - 0.1) - 0.02), (0.05, 0.03, 0.02)), (255, 150, 170), "Cheek") for x in (-0.22, 0.22)]
  return [*eyes, *shine, mouth, *cheeks]


captured["face_surprised"] = surprised_face()

# The winner, crowned, on a tile of the top layer.
wx, wz = cell_xz(-1, -1)
for i, p in enumerate(ghost_parts((255, 214, 240), "face_happy", 0.62, (wx, LAYER_Y[0], wz + 0.05), yaw=12, extra=captured["hat_crown"])):
  add(f"winner_ghost_{i}", p)

# The ghost falling through the hole in layer 1 (between layers 1 and 2), arms up, with a wisp trail.
fx, fz = cell_xz(0, 0)
fx += TS * SQ3 / 2  # between the two vanished tiles (0,0) and (1,0)
fy = LAYER_Y[1] - TILE_H - 0.42
for i, p in enumerate(ghost_parts((90, 214, 255), "face_surprised", 0.5, (fx, fy, fz + 0.05), yaw=-10, tilt=(-14, 18))):
  add(f"falling_ghost_{i}", p)
for i, (dy, r, dx) in enumerate([(0.75, 0.07, 0.02), (0.98, 0.055, -0.05), (1.18, 0.045, 0.04), (1.36, 0.035, -0.02)]):
  add(f"wisp_{i}", glow(sphere(r, (fx + dx, fy + dy, fz + 0.02), sub=1), (200, 240, 255), "Wisp"))
for i, (dx, dy) in enumerate([(-0.42, 0.55), (0.45, 0.4), (-0.3, -0.05), (0.38, 0.95)]):
  add(f"spark_{i}", glow(sphere(0.03, (fx + dx, fy + dy, fz + 0.15), sub=1), GLOW_GOLD, "Spark"))

# A ghost on layer 2 peering down over the edge at the front.
px_, pz_ = cell_xz(-1, 2)
for i, p in enumerate(ghost_parts((185, 140, 255), "face_dots", 0.55, (px_, LAYER_Y[2], pz_), yaw=-20, tilt=(14, 0))):
  add(f"peek_ghost_{i}", p)

# A big starry-eyed ghost at the front of the stage, greeting the next players.
for i, p in enumerate(ghost_parts((255, 255, 255), "face_starry", 0.85, (1.45, STAGE_H, 1.85), yaw=-12, tilt=(-6, 0))):
  add(f"fan_ghost_{i}", p)

# ---------- the big sign: two posts, the board, a hex band ----------
SIGN_Z, SIGN_Y = -1.75, 5.85
for x in (-2.4, 2.4):
  add(f"sign_post_{x}", mat(cylinder(0.08, SIGN_Y + 0.45 - STAGE_H, (x, (SIGN_Y + 0.45 + STAGE_H) / 2, SIGN_Z), sides=12), PEARL, "Post", rough=0.35))
  add(f"sign_post_ball_{x}", glow(sphere(0.16, (x, SIGN_Y + 0.55, SIGN_Z)), GLOW_PINK, "GlowPink"))
add("sign_board", mat(box((4.5, 1.12, 0.1), (0, SIGN_Y, SIGN_Z - 0.06)), DUSK, "Board"))
sign_img = board_texture(1024, 250, [("GHOST DROP", 0.46, (92, 58, 142, 255)), ("LAST GHOST FLOATING WINS", 0.2, (255, 79, 216, 255))], (255, 79, 216, 255), radius=46)
add("sign", textured_quad(sign_img, 4.4, 4.4 * 250 / 1024, (0, SIGN_Y, SIGN_Z + 0.001)))
add("hex_band", textured_quad(hex_band_texture(), 4.4, 0.2, (0, SIGN_Y - 0.68, SIGN_Z - 0.02), emissive=0.6))
# Little ghost silhouettes dangling from the band like bunting.
for i, x in enumerate(np.linspace(-1.9, 1.9, 7)):
  c = LAYER[i % 4]
  add(f"bunting_{i}", mat(sphere(1, (x, SIGN_Y - 0.92, SIGN_Z), (0.1, 0.13, 0.04)), c, "Bunting", emissive=tuple(int(v * 0.3) for v in c)))

# ---------- "TAP TO PLAY" board at the front, like the kart's ----------
TAP = (-2.0, 2.45)
add("tap_post", mat(cylinder(0.05, 1.6, (TAP[0], 0.8 + STAGE_H / 2, TAP[1] - 0.04), sides=10), PEARL, "Post", rough=0.35))
add("tap_board", mat(box((1.42, 0.56, 0.06), (TAP[0], 1.72, TAP[1] - 0.04)), DUSK, "Board"))
tap_img = board_texture(512, 200, [("TAP TO PLAY", 0.4, (255, 79, 216, 255))], (124, 77, 255, 255), radius=40)
add("tap_sign", textured_quad(tap_img, 1.36, 1.36 * 200 / 512, (TAP[0], 1.72, TAP[1] - 0.005)))

# ---------- side lanterns: poles topped by floating hex tiles ----------
for side in (-1, 1):
  x, z = side * 3.0, -0.4
  add(f"lantern_pole_{side}", mat(cylinder(0.05, 2.6, (x, 1.3 + STAGE_H / 2, z), sides=10), PEARL, "Post", rough=0.35))
  for k, (dy, L) in enumerate([(2.95, 0 if side < 0 else 2), (3.25, 1 if side < 0 else 3)]):
    t = hex_tile.copy()
    t.apply_scale((0.75, 1, 0.75))
    t.apply_transform(trimesh.transformations.rotation_matrix(math.radians(18 * side * (k + 1)), (0, 0, 1)))
    t.apply_translation((x, dy, z))
    add(f"lantern_tile_{side}_{k}", mat(t, LAYER[L], f"Tile{L}", emissive=tuple(int(c * 0.55) for c in LAYER[L])))
  add(f"lantern_orb_{side}", glow(sphere(0.09, (x, 2.75, z)), GLOW_GOLD, "GlowGold"))

# ---------- save ----------
scene = trimesh.Scene()
for name, p in zip(names, parts):
  scene.add_geometry(p, geom_name=name, node_name=name)
scene.export(OUT)
lo, hi = scene.bounds
print(json.dumps({"out": str(OUT), "bytes": OUT.stat().st_size, "parts": len(parts),
                  "faces": int(sum(len(p.faces) for p in parts)), "bounds": [np.round(lo, 2).tolist(), np.round(hi, 2).tolist()]}))
