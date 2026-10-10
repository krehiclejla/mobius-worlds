#!/usr/bin/env python3
"""Build Möbius Worlds' 3D models with Game Studio's shape tools.

  python3 tools/build_models.py OUT_DIR

Every model shares one frame: the ghost is 1 m tall, its hem at y=0, facing +Z.
Accessories are modelled in place around that ghost, so the app simply adds
them as children. Materials are plain colours named for their role: "Body" is
tinted with the player's colour at runtime, and "Logo" receives the Möbius logo
texture at runtime (so no GLB carries an embedded image).

Uses /data/apps/game-studio/shapes.py (trimesh) for parts and GLB export.
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, "/data/apps/game-studio")
import numpy as np  # noqa: E402
import trimesh  # noqa: E402
from trimesh.visual import TextureVisuals  # noqa: E402
from trimesh.visual.material import PBRMaterial  # noqa: E402
from shapes import box, cylinder, move, slab, tube  # noqa: E402,F401

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "models")
OUT.mkdir(parents=True, exist_ok=True)

MOBIUS = (91, 58, 142)
MOBIUS_PINK = (224, 113, 154)
NAVY = (43, 31, 92)
GOLD = (255, 204, 64)
WHITE = (250, 250, 252)
INK = (31, 36, 48)
SILVER = (196, 202, 212)
SKIN = (246, 164, 124)


def mat(mesh, color, name, metal=0.0, rough=0.7, emissive=None):
  kwargs = dict(name=name, baseColorFactor=[*[c / 255 for c in color], 1.0],
                metallicFactor=metal, roughnessFactor=rough)
  if emissive:
    kwargs["emissiveFactor"] = [c / 255 for c in emissive]
  mesh.visual = TextureVisuals(material=PBRMaterial(**kwargs))
  return mesh


def save(name, parts, ground=False):
  scene = trimesh.Scene()
  shift = np.zeros(3)
  if ground:
    lo = np.min([p.bounds[0] for p in parts], 0)
    hi = np.max([p.bounds[1] for p in parts], 0)
    shift = np.array([-(lo[0] + hi[0]) / 2, -lo[1], -(lo[2] + hi[2]) / 2])
  for i, p in enumerate(parts):
    p = p.copy()
    p.apply_translation(shift)
    scene.add_geometry(p, geom_name=f"{name}_{i}", node_name=f"{name}_{i}")
  path = OUT / f"{name}.glb"
  scene.export(path)
  print(f"{name}: {path.stat().st_size} bytes, {sum(len(p.faces) for p in parts)} faces")


def sphere(r, at=(0, 0, 0), scale=(1, 1, 1), sub=2):
  m = trimesh.creation.icosphere(subdivisions=sub, radius=r)
  m.apply_scale(scale)
  return move(m, at)


def sweep(points, radius, sides=10, closed=False):
  """A round tube along a 3D polyline (arcs, handles, strings, scarves)."""
  P = np.asarray(points, float)
  n = len(P)
  verts, faces = [], []
  prev_normal = None
  for i in range(n):
    if closed:
      t = P[(i + 1) % n] - P[i - 1]
    else:
      t = P[min(i + 1, n - 1)] - P[max(i - 1, 0)]
    t /= np.linalg.norm(t) or 1
    if prev_normal is None:
      ref = np.array([0, 1, 0]) if abs(t[1]) < 0.9 else np.array([1, 0, 0])
      normal = np.cross(t, ref)
    else:
      normal = prev_normal - np.dot(prev_normal, t) * t
    normal /= np.linalg.norm(normal) or 1
    prev_normal = normal
    binormal = np.cross(t, normal)
    for k in range(sides):
      a = 2 * math.pi * k / sides
      verts.append(P[i] + radius * (math.cos(a) * normal + math.sin(a) * binormal))
  rings = n if closed else n - 1
  for i in range(rings):
    j = (i + 1) % n
    for k in range(sides):
      k2 = (k + 1) % sides
      a, b, c, d = i * sides + k, i * sides + k2, j * sides + k2, j * sides + k
      faces += [[a, b, c], [a, c, d]]
  if not closed:
    verts += [P[0], P[-1]]
    s, e = len(verts) - 2, len(verts) - 1
    for k in range(sides):
      k2 = (k + 1) % sides
      faces.append([s, k2, k])
      faces.append([e, (n - 1) * sides + k, (n - 1) * sides + k2])
  m = trimesh.Trimesh(np.array(verts), np.array(faces), process=True)
  m.fix_normals()
  return m


def arc(center, radius, start_deg, end_deg, plane="xy", steps=24):
  cx, cy, cz = center
  pts = []
  for i in range(steps + 1):
    a = math.radians(start_deg + (end_deg - start_deg) * i / steps)
    u, v = radius * math.cos(a), radius * math.sin(a)
    pts.append((cx + u, cy + v, cz) if plane == "xy" else (cx + u, cy, cz + v))
  return pts


def lathe(profile, sides=40):
  """Revolve (radius, y) points about Y into a closed surface."""
  verts, faces = [], []
  n = len(profile)
  for r, y in profile:
    for k in range(sides):
      a = 2 * math.pi * k / sides
      verts.append((r * math.cos(a), y, r * math.sin(a)))
  for i in range(n - 1):
    for k in range(sides):
      k2 = (k + 1) % sides
      a, b, c, d = i * sides + k, i * sides + k2, (i + 1) * sides + k2, (i + 1) * sides + k
      faces += [[a, c, b], [a, d, c]]
  m = trimesh.Trimesh(np.array(verts), np.array(faces), process=True)
  m.fix_normals()
  return m


def star_outline(r_out, r_in, points=5, rot=90):
  out = []
  for i in range(points * 2):
    r = r_out if i % 2 == 0 else r_in
    a = math.radians(rot + i * 180 / points)
    out.append((r * math.cos(a), r * math.sin(a)))
  return out


def facing(mesh, z, y, x=0.0):
  """Turn a Game Studio slab (outlined in ZY, thickness along X) to face +Z and
  stand it on the ghost's front at height y."""
  mesh.apply_transform(trimesh.transformations.rotation_matrix(math.pi / 2, (0, 1, 0)))
  return move(mesh, (x, y, z))


# ---------------------------------------------------------------- ghost

R = 0.42      # body radius
DOME = 0.56   # where the round top starts
FRONT = lambda y: R * math.sqrt(max(0.0, 1 - ((y - DOME) / (1 - DOME)) ** 2)) if y > DOME else R


def ghost_body():
  sides, rows = 56, 40
  verts, faces = [], []
  ys = []
  for i in range(rows + 1):
    t = i / rows
    ys.append(t)
  for i, y in enumerate(ys):
    if y <= DOME:
      r = R * (1.06 - 0.06 * (y / DOME))  # a gentle skirt toward the hem
    else:
      r = FRONT(y)
    for k in range(sides):
      a = 2 * math.pi * k / sides
      yy = y
      if i == 0:
        yy = 0.055 * math.cos(5 * a) + 0.02  # the Rewards-pal scalloped hem
      elif i == 1:
        yy = y + 0.03 * math.cos(5 * a)
      verts.append((max(r, 1e-4) * math.sin(a), yy, max(r, 1e-4) * math.cos(a)))
  for i in range(rows):
    for k in range(sides):
      k2 = (k + 1) % sides
      a, b, c, d = i * sides + k, i * sides + k2, (i + 1) * sides + k2, (i + 1) * sides + k
      faces += [[a, b, c], [a, c, d]]
  # a slightly hollow underside so the hem reads from below
  centre = len(verts)
  verts.append((0, 0.12, 0))
  for k in range(sides):
    faces.append([centre, (k + 1) % sides, k])
  m = trimesh.Trimesh(np.array(verts), np.array(faces), process=True)
  m.fix_normals()
  return m


def ghost():
  body = mat(ghost_body(), (200, 205, 214), "Body", rough=0.55)
  arms = []
  for side in (-1, 1):
    arm = sphere(1, sub=2)
    arm.apply_scale((0.13, 0.085, 0.09))
    arm.apply_transform(trimesh.transformations.rotation_matrix(math.radians(-28 * side), (0, 0, 1)))
    arms.append(mat(move(arm, (side * 0.44, 0.40, 0.04)), (200, 205, 214), "Body", rough=0.55))
  sheen = sphere(1, sub=2)
  sheen.apply_scale((0.07, 0.11, 0.03))
  sheen.apply_transform(trimesh.transformations.rotation_matrix(math.radians(-25), (0, 0, 1)))
  sy = 0.82
  sheen = mat(move(sheen, (-0.2, sy, Z(sy) - 0.12)), (255, 255, 255), "Sheen", rough=0.2)
  save("ghost", [body, *arms, sheen])


Z = lambda y: FRONT(y) + 0.005  # just proud of the front surface


def faces():
  y = 0.62
  # dots: classic friendly ghost
  eyes = [mat(sphere(1, (x, y, Z(y) - 0.02), (0.05, 0.075, 0.03)), INK, "Ink") for x in (-0.13, 0.13)]
  shine = [mat(sphere(0.018, (x + 0.015, y + 0.03, Z(y) + 0.005)), WHITE, "White") for x in (-0.13, 0.13)]
  smile = mat(sweep(arc((0, y - 0.05, Z(y - 0.1) - 0.01), 0.06, 200, 340, steps=12), 0.013), INK, "Ink")
  cheeks = [mat(sphere(1, (x, y - 0.1, Z(y - 0.1) - 0.02), (0.05, 0.03, 0.02)), (255, 150, 170), "Cheek") for x in (-0.22, 0.22)]
  save("face_dots", [*eyes, *shine, smile, *cheeks])
  # mystery: the Hackaton Rewards "?"
  q = sweep(arc((0, y + 0.06, Z(y + 0.06) + 0.005), 0.085, 165, -65, steps=20), 0.028)
  stem = sweep([(0.036, y - 0.017, Z(y) + 0.005), (0.0, y - 0.055, Z(y - 0.05) + 0.005), (0.0, y - 0.1, Z(y - 0.1) + 0.005)], 0.028)
  dot = sphere(0.032, (0, y - 0.18, Z(y - 0.18)))
  save("face_mystery", [mat(q, WHITE, "White"), mat(stem, WHITE, "White"), mat(dot, WHITE, "White")])
  # happy: ^ ^ and an open grin
  hap = [mat(sweep(arc((x, y - 0.02, Z(y) - 0.005), 0.055, 20, 160, steps=10), 0.016), INK, "Ink") for x in (-0.13, 0.13)]
  mouth = mat(sphere(1, (0, y - 0.13, Z(y - 0.13) - 0.03), (0.08, 0.05, 0.04)), (120, 30, 50), "Mouth")
  tongue = mat(sphere(1, (0, y - 0.155, Z(y - 0.15) - 0.015), (0.045, 0.022, 0.02)), (255, 120, 140), "Tongue")
  save("face_happy", [*hap, mouth, tongue, *[c.copy() for c in cheeks]])
  # sleepy: closed lids and a little "o"
  lids = [mat(sweep(arc((x, y + 0.03, Z(y) - 0.005), 0.05, 200, 340, steps=10), 0.014), INK, "Ink") for x in (-0.13, 0.13)]
  o = mat(sweep(arc((0, y - 0.12, Z(y - 0.12) - 0.004), 0.026, 0, 360, steps=16), 0.01), INK, "Ink")
  save("face_sleepy", [*lids, o])
  # starry: star eyes
  stars = [mat(facing(slab(star_outline(0.075, 0.032), back=0.015, front=0.01), Z(y) - 0.01, y + 0.01, x), GOLD, "Gold", rough=0.4) for x in (-0.14, 0.14)]
  grin = mat(sweep(arc((0, y - 0.07, Z(y - 0.1) - 0.01), 0.07, 205, 335, steps=12), 0.014), INK, "Ink")
  save("face_starry", [*stars, grin])


def hug(y0, grow=1.08, lift=0.015, rows=10, top_lift=0.03):
  """A lathe profile that follows the ghost's dome from y0 up to the crown."""
  pts = [(FRONT(y0) * grow + lift, y0 - 0.01)]
  for i in range(rows + 1):
    y = y0 + (1.0 - y0) * i / rows
    pts.append((FRONT(y) * grow + lift, y + lift * (i / rows)))
  pts.append((0.0, 1.0 + top_lift))
  return pts


def on_dome(mesh, y, x_deg=0.0, out=0.02):
  """Place a flat decal/patch on the dome's front at height y, tilted to the surface."""
  slope = math.degrees(math.atan2((y - DOME) / (1 - DOME), max(1e-3, math.sqrt(max(0.0, 1 - ((y - DOME) / (1 - DOME)) ** 2)))))
  mesh.apply_transform(trimesh.transformations.rotation_matrix(math.radians(-slope), (1, 0, 0)))
  return move(mesh, (0, y, FRONT(y) + out))


def hats():
  top = 1.0
  # Möbius cap: navy crown, brim forward, logo patch
  crown = mat(lathe(hug(0.8, 1.07, 0.012)), NAVY, "Hat")
  brim = cylinder(1, 1, sides=32)
  brim.apply_scale((0.25, 0.022, 0.2))
  brim.apply_transform(trimesh.transformations.rotation_matrix(math.radians(12), (1, 0, 0)))
  brim = mat(move(brim, (0, 0.8, FRONT(0.8) * 1.07 + 0.05)), NAVY, "Hat")
  button = mat(sphere(0.03, (0, top + 0.035, 0)), MOBIUS_PINK, "Accent")
  patch = mat(on_dome(box((0.17, 0.17, 0.01)), 0.88, out=0.035), WHITE, "Logo")
  save("hat_mobius_cap", [crown, brim, button, patch])
  # Beanie with pompom
  beanie = mat(lathe(hug(0.74, 1.09, 0.015, top_lift=0.06)), MOBIUS, "Hat")
  band = mat(sweep(arc((0, 0.75, 0), FRONT(0.75) * 1.09 + 0.02, 0, 360, plane="xz", steps=40), 0.045), MOBIUS_PINK, "Accent")
  pom = mat(sphere(0.075, (0, top + 0.1, 0)), WHITE, "White")
  save("hat_beanie", [beanie, band, pom])
  # Crown
  cy = 0.9
  cr = FRONT(cy) + 0.015
  ring = mat(lathe([(cr - 0.01, cy), (cr + 0.012, cy), (cr + 0.012, cy + 0.09), (cr - 0.01, cy + 0.09)], sides=40), GOLD, "Gold", metal=0.25, rough=0.35)
  spikes = []
  for k in range(6):
    a = 2 * math.pi * k / 6
    s = trimesh.creation.cone(radius=0.045, height=0.11, sections=8)
    s.apply_translation((cr * math.sin(a), cy + 0.14, cr * math.cos(a)))
    spikes.append(mat(s, GOLD, "Gold", metal=0.25, rough=0.35))
    spikes.append(mat(sphere(0.024, (cr * math.sin(a), cy + 0.2, cr * math.cos(a))), MOBIUS_PINK, "Gem", rough=0.2))
  save("hat_crown", [ring, *spikes])
  # Party hat
  cone = trimesh.creation.cone(radius=0.17, height=0.34, sections=24)
  cone.apply_transform(trimesh.transformations.rotation_matrix(-math.pi / 2, (1, 0, 0)))
  cone.apply_transform(trimesh.transformations.rotation_matrix(math.radians(12), (0, 0, 1)))
  cone.apply_translation((0.06, top - 0.07, 0))
  party = mat(cone, (255, 212, 59), "Hat")
  tip = mat(sphere(0.045, (0.095, top + 0.27, 0)), MOBIUS_PINK, "Accent")
  save("hat_party", [party, tip])
  # Headphones
  band = mat(sweep(arc((0, 0.66, 0), 0.43, 10, 170, steps=24), 0.03), MOBIUS, "Hat", rough=0.4)
  cups = [mat(cylinder(0.1, 0.07, (x, 0.64, 0), sides=20, axis="x"), NAVY, "Accent", rough=0.4) for x in (-0.43, 0.43)]
  pads = [mat(cylinder(0.075, 0.03, (x, 0.64, 0), sides=20, axis="x"), MOBIUS_PINK, "Accent") for x in (-0.47, 0.47)]
  save("hat_headphones", [band, *cups, *pads])


def mobius_strip(radius=0.5, width=0.18, thickness=0.02, steps=96, twists=1, span=(0.0, 1.0)):
  verts, faces_ = [], []
  for i in range(steps):
    u = 2 * math.pi * i / steps
    for s, off in ((-1, 0), (1, 0)):
      pass
  # sample as a thin ribbon with two faces (top/bottom) offset by thickness
  rows = []
  a0, a1 = span
  for i in range(steps + 1):
    u = 2 * math.pi * (a0 + (a1 - a0) * i / steps)
    ring = []
    for v in (-width / 2, width / 2):
      x = (radius + v * math.cos(twists * u / 2)) * math.cos(u)
      z = (radius + v * math.cos(twists * u / 2)) * math.sin(u)
      y = v * math.sin(twists * u / 2)
      ring.append((x, y, z))
    rows.append(ring)
  for side in (-1, 1):
    base = len(verts)
    for i, (a, b) in enumerate(rows):
      u = 2 * math.pi * (a0 + (a1 - a0) * i / steps)
      nx = math.cos(u) * math.sin(twists * u / 2) * -1
      ny = math.cos(twists * u / 2)
      nz = math.sin(u) * math.sin(twists * u / 2) * -1
      n = np.array([nx, ny, nz]) * thickness / 2 * side
      verts += [tuple(np.array(a) + n), tuple(np.array(b) + n)]
    for i in range(steps):
      a, b, c, d = base + 2 * i, base + 2 * i + 1, base + 2 * i + 3, base + 2 * i + 2
      faces_ += [[a, b, c], [a, c, d]] if side > 0 else [[a, c, b], [a, d, c]]
  m = trimesh.Trimesh(np.array(verts), np.array(faces_), process=False)
  return m


def halo():
  strip = mobius_strip(0.24, 0.09, 0.014)
  strip.apply_transform(trimesh.transformations.rotation_matrix(math.radians(28), (1, 0, 0)))
  strip.apply_translation((0, 1.22, 0))
  save("hat_mobius_halo", [mat(strip, GOLD, "Gold", metal=0.2, rough=0.3, emissive=(150, 110, 20))])


def necks():
  y = 0.42
  # Möbius scarf: alternating purple/pink segments plus a tail
  segs = []
  for k in range(12):
    pts = arc((0, y, 0), 0.445, k * 30, k * 30 + 31, plane="xz", steps=5)
    segs.append(mat(sweep(pts, 0.05, sides=12), MOBIUS if k % 2 else MOBIUS_PINK, "Scarf"))
  tail = mat(box((0.12, 0.26, 0.04), (0.18, y - 0.14, 0.43)), MOBIUS, "Scarf")
  tail.apply_transform(trimesh.transformations.rotation_matrix(math.radians(8), (0, 0, 1), point=(0.18, y, 0.43)))
  fringe = [mat(box((0.02, 0.05, 0.03), (0.13 + i * 0.033, y - 0.29, 0.43)), MOBIUS_PINK, "Scarf") for i in range(4)]
  save("neck_mobius_scarf", [*segs, tail, *fringe])
  # Bow tie
  wings = [mat(facing(slab(o, back=0.02, front=0.02), Z(y) + 0.03, y + 0.02), MOBIUS_PINK, "Accent")
           for o in ([(0, 0), (0.13, -0.065), (0.13, 0.065)], [(0, 0), (-0.13, 0.065), (-0.13, -0.065)])]
  knot = mat(sphere(0.038, (0, y + 0.02, Z(y) + 0.05)), MOBIUS, "Accent")
  save("neck_bowtie", [*wings, knot])
  # Hackaton lanyard with a logo badge
  cord = mat(sweep([(-0.38, y + 0.04, 0.2), (-0.2, y - 0.04, Z(y) + 0.01), (0, y - 0.1, Z(y) + 0.03), (0.2, y - 0.04, Z(y) + 0.01), (0.38, y + 0.04, 0.2)], 0.012), (40, 60, 200), "Accent")
  card = mat(box((0.16, 0.2, 0.012), (0, y - 0.22, Z(y - 0.2) + 0.04)), WHITE, "Card")
  logo = mat(box((0.12, 0.12, 0.004), (0, y - 0.2, Z(y - 0.2) + 0.048)), WHITE, "Logo")
  strip = mat(box((0.16, 0.035, 0.014), (0, y - 0.3, Z(y - 0.2) + 0.041)), (40, 60, 200), "Accent")
  save("neck_lanyard", [cord, card, logo, strip])


HAND = (0.5, 0.36, 0.1)


def holds():
  hx, hy, hz = HAND
  # Möbius mug
  body = lathe([(0.0, 0.0), (0.075, 0.0), (0.075, 0.16), (0.068, 0.16), (0.068, 0.012), (0.0, 0.012)], sides=28)
  body.apply_translation((hx + 0.04, hy - 0.08, hz + 0.02))
  coffee = cylinder(0.066, 0.01, (hx + 0.04, hy + 0.06, hz + 0.02), sides=20)
  handle = sweep(arc((hx + 0.12, hy, hz + 0.02), 0.045, -80, 80, steps=12), 0.013)
  logo = box((0.08, 0.08, 0.004), (hx + 0.04, hy + 0.005, hz + 0.097))
  save("hold_mobius_mug", [mat(body, WHITE, "Mug", rough=0.3), mat(coffee, (110, 70, 40), "Coffee"), mat(handle, WHITE, "Mug", rough=0.3), mat(logo, WHITE, "Logo")])
  # Tote bag
  bag = box((0.24, 0.26, 0.06), (hx + 0.06, hy - 0.2, hz + 0.05))
  straps = [sweep(arc((hx + 0.06 + dx, hy - 0.07, hz + 0.05), 0.07, 10, 170, steps=10), 0.01) for dx in (-0.04, 0.04)]
  logo = box((0.15, 0.15, 0.004), (hx + 0.06, hy - 0.2, hz + 0.082))
  save("hold_tote", [mat(bag, (236, 224, 200), "Canvas"), *[mat(s, (236, 224, 200), "Canvas") for s in straps], mat(logo, WHITE, "Logo")])
  # The logo's pencil
  pencil = cylinder(0.022, 0.32, (0, 0, 0), sides=6)
  tip = trimesh.creation.cone(radius=0.022, height=0.06, sections=6)
  tip.apply_transform(trimesh.transformations.rotation_matrix(-math.pi / 2, (1, 0, 0)))
  tip.apply_translation((0, 0.16, 0))
  lead = trimesh.creation.cone(radius=0.008, height=0.022, sections=6)
  lead.apply_transform(trimesh.transformations.rotation_matrix(-math.pi / 2, (1, 0, 0)))
  lead.apply_translation((0, 0.2, 0))
  eraser = cylinder(0.022, 0.04, (0, -0.18, 0), sides=12)
  parts = [mat(pencil, (230, 170, 60), "Wood"), mat(tip, (240, 210, 170), "Wood"), mat(lead, INK, "Ink"), mat(eraser, MOBIUS_PINK, "Accent")]
  for p in parts:
    p.apply_transform(trimesh.transformations.rotation_matrix(math.radians(-35), (0, 0, 1)))
    p.apply_translation((hx + 0.03, hy + 0.02, hz + 0.05))
  save("hold_pencil", parts)
  # Balloon on a string
  balloon = sphere(1, (hx + 0.12, hy + 0.85, hz), (0.15, 0.18, 0.15))
  knot = trimesh.creation.cone(radius=0.025, height=0.04, sections=8)
  knot.apply_transform(trimesh.transformations.rotation_matrix(math.pi / 2, (1, 0, 0)))
  knot.apply_translation((hx + 0.12, hy + 0.66, hz))
  string = sweep([(hx + 0.12, hy + 0.66, hz), (hx + 0.06, hy + 0.4, hz), (hx + 0.02, hy + 0.1, hz), (hx, hy, hz)], 0.004, sides=5)
  logo = box((0.1, 0.1, 0.004), (hx + 0.12, hy + 0.86, hz + 0.152))
  save("hold_balloon", [mat(balloon, MOBIUS, "Balloon", rough=0.25), mat(knot, MOBIUS, "Balloon"), mat(string, (240, 240, 240), "String"), mat(logo, WHITE, "Logo")])


# ---------------------------------------------------------------- world pieces

def world():
  # The Möbius monument: a silver-and-skin strip (the robot hand and the human hand) on a plinth
  plinth = lathe([(0.0, 0.0), (1.1, 0.0), (1.1, 0.25), (0.95, 0.3), (0.8, 0.3), (0.8, 0.55), (0.9, 0.62), (0.0, 0.62)], sides=48)
  # Half human (skin), half robot (chrome), like the logo's two drawing hands.
  halves = []
  for span, color, name, metal in (((0.0, 0.5), SKIN, "Skin", 0.0), ((0.5, 1.0), SILVER, "Chrome", 0.4)):
    half = mobius_strip(1.0, 0.42, 0.08, steps=64, span=span)
    half.apply_transform(trimesh.transformations.rotation_matrix(math.radians(90), (1, 0, 0)))
    half.apply_transform(trimesh.transformations.rotation_matrix(math.radians(35), (0, 1, 0)))
    half.apply_translation((0, 1.9, 0))
    halves.append(mat(half, color, name, metal=metal, rough=0.35))
  pond = lathe([(2.2, 0.0), (2.6, 0.0), (2.6, 0.3), (2.35, 0.3), (2.35, 0.08), (2.2, 0.08)], sides=64)
  water = cylinder(2.36, 0.06, (0, 0.14, 0), sides=64)
  save("monument", [mat(plinth, (214, 208, 196), "Stone"), *halves,
                    mat(pond, (190, 184, 172), "Stone"), mat(water, (116, 192, 252), "Water", rough=0.1)])
  # Lamp post
  pole = cylinder(0.05, 2.4, (0, 1.2, 0), sides=10)
  base = cylinder(0.14, 0.12, (0, 0.06, 0), sides=12)
  lamp = sphere(0.17, (0, 2.5, 0))
  cap = trimesh.creation.cone(radius=0.2, height=0.14, sections=12)
  cap.apply_transform(trimesh.transformations.rotation_matrix(-math.pi / 2, (1, 0, 0)))
  cap.apply_translation((0, 2.62, 0))
  save("lamp", [mat(pole, (73, 80, 87), "Iron", metal=0.5), mat(base, (52, 58, 64), "Iron", metal=0.5),
                mat(lamp, (255, 236, 170), "Glow", emissive=(255, 214, 120)), mat(cap, (52, 58, 64), "Iron", metal=0.5)], ground=True)
  # Bench
  seat = [box((1.6, 0.06, 0.16), (0, 0.46, z)) for z in (-0.1, 0.1)]
  backrest = [box((1.6, 0.14, 0.05), (0, 0.72 + i * 0.18, -0.24)) for i in range(2)]
  legs = [box((0.07, 0.46, 0.4), (x, 0.23, 0)) for x in (-0.65, 0.65)]
  posts = [box((0.06, 0.5, 0.06), (x, 0.72, -0.24)) for x in (-0.65, 0.65)]
  save("bench", [*[mat(s, (181, 101, 29), "Wood") for s in seat + backrest], *[mat(l, (52, 58, 64), "Iron", metal=0.5) for l in legs + posts]], ground=True)


# ---------------------------------------------------------------- Möbius landmarks

WOOD = (181, 101, 29)
DARKWOOD = (120, 78, 50)
IRON = (52, 58, 64)
STONE = (214, 208, 196)
CORK = (196, 150, 98)
APP_COLORS = [(91, 58, 142), (224, 113, 154), (77, 171, 247), (105, 219, 124), (255, 212, 59), (255, 146, 43)]


def rot(mesh, deg, axis=(0, 1, 0), point=(0, 0, 0)):
  mesh.apply_transform(trimesh.transformations.rotation_matrix(math.radians(deg), axis, point=point))
  return mesh


def awning(width, depth, y, z0, stripes=8, tilt=18):
  """A striped Möbius-coloured awning sloping toward +z."""
  parts = []
  w = width / stripes
  for i in range(stripes):
    strip = box((w, 0.05, depth), (-width / 2 + w * (i + 0.5), y, z0 + depth / 2))
    rot(strip, tilt, (1, 0, 0), point=(0, y, z0))
    parts.append(mat(strip, MOBIUS if i % 2 else MOBIUS_PINK, "Awning"))
    scallop = sphere(1, (-width / 2 + w * (i + 0.5), y - math.sin(math.radians(tilt)) * depth - 0.04, z0 + depth * math.cos(math.radians(tilt))), (w / 2, 0.08, 0.03))
    parts.append(mat(scallop, MOBIUS if i % 2 else MOBIUS_PINK, "Awning"))
  return parts


def landmarks():
  # Chat Café: a kiosk with a striped awning and a giant speech bubble
  kiosk = [mat(box((2.6, 2.2, 1.8), (0, 1.1, 0)), (250, 244, 236), "Wall"),
           mat(box((2.8, 0.14, 2.0), (0, 2.27, 0)), MOBIUS, "Roof"),
           mat(box((2.4, 1.0, 0.3), (0, 0.5, 1.05)), WOOD, "Counter"),
           mat(box((2.6, 0.08, 0.5), (0, 1.02, 1.1)), DARKWOOD, "Counter"),
           mat(box((1.6, 0.8, 0.02), (0, 1.62, 0.91)), (60, 40, 70), "Window")]
  kiosk += awning(2.8, 0.9, 2.2, 0.95)
  bubble = sphere(1, (0, 3.25, 0.2), (1.1, 0.72, 0.28))
  tail = trimesh.creation.cone(radius=0.25, height=0.5, sections=12)
  rot(tail, 180, (1, 0, 0))
  rot(tail, -25, (0, 0, 1))
  tail.apply_translation((-0.55, 2.7, 0.2))
  dots = [mat(sphere(0.13, (x, 3.25, 0.5)), MOBIUS, "Ink") for x in (-0.4, 0, 0.4)]
  cups = [mat(lathe([(0.0, 0.0), (0.07, 0.0), (0.08, 0.16), (0.0, 0.16)], sides=16), WHITE, "Mug") for _ in range(2)]
  cups[0].apply_translation((-0.7, 1.06, 1.1)); cups[1].apply_translation((0.6, 1.06, 1.15))
  save("cafe", [*kiosk, mat(bubble, WHITE, "Bubble", rough=0.4), mat(tail, WHITE, "Bubble", rough=0.4), *dots, *cups], ground=True)
  # Café table and chair
  top = cylinder(0.5, 0.06, (0, 0.76, 0), sides=28)
  stem = cylinder(0.05, 0.72, (0, 0.38, 0), sides=10)
  foot = cylinder(0.3, 0.04, (0, 0.02, 0), sides=20)
  save("table", [mat(top, (250, 244, 236), "Table"), mat(stem, IRON, "Iron", metal=0.4), mat(foot, IRON, "Iron", metal=0.4)], ground=True)
  seat = box((0.46, 0.06, 0.46), (0, 0.46, 0))
  back = box((0.46, 0.5, 0.05), (0, 0.72, -0.21))
  legs = [box((0.04, 0.46, 0.04), (x, 0.23, z)) for x in (-0.19, 0.19) for z in (-0.19, 0.19)]
  save("chair", [mat(seat, MOBIUS_PINK, "Seat"), mat(back, MOBIUS, "Seat"), *[mat(l, IRON, "Iron", metal=0.4) for l in legs]], ground=True)
  # Jukebox
  body = box((0.9, 1.3, 0.55), (0, 0.65, 0))
  crown = cylinder(0.45, 0.55, (0, 1.3, 0), sides=28, axis="z")
  panel = box((0.62, 0.42, 0.02), (0, 1.05, 0.285))
  grill = [mat(cylinder(0.12, 0.02, (x, 0.45, 0.285), sides=18, axis="z"), IRON, "Grill", metal=0.3) for x in (-0.2, 0.2)]
  arch = mat(sweep(arc((0, 1.3, 0.29), 0.38, 0, 180, steps=18), 0.035), GOLD, "Glow", emissive=(255, 190, 70))
  save("jukebox", [mat(body, MOBIUS, "Body2"), mat(crown, MOBIUS_PINK, "Body2"), mat(panel, (60, 30, 90), "Screen", emissive=(120, 60, 200)), *grill, arch], ground=True)
  # Game Studio arcade cabinet (screen and marquee are lit at runtime)
  side = [box((0.06, 1.9, 0.8), (x, 0.95, 0)) for x in (-0.4, 0.4)]
  cab = box((0.74, 1.9, 0.72), (0, 0.95, -0.04))
  screen = rot(box((0.6, 0.5, 0.02), (0, 1.35, 0.3)), -12, (1, 0, 0), point=(0, 1.35, 0.3))
  shelf = rot(box((0.74, 0.05, 0.36), (0, 0.98, 0.42)), 10, (1, 0, 0), point=(0, 0.98, 0.25))
  stick = cylinder(0.015, 0.14, (-0.15, 1.08, 0.45), sides=8)
  knob = sphere(0.04, (-0.15, 1.16, 0.45))
  buttons = [mat(cylinder(0.035, 0.03, (x, 1.03, 0.45), sides=12), c, "Button", emissive=tuple(v // 3 for v in c)) for x, c in ((0.05, (255, 107, 107)), (0.15, (255, 212, 59)), (0.25, (77, 171, 247)))]
  marquee = box((0.7, 0.24, 0.04), (0, 1.78, 0.38))
  logo = box((0.2, 0.2, 0.004), (0, 1.78, 0.405))
  save("arcade", [*[mat(p, MOBIUS, "Cabinet") for p in side], mat(cab, (35, 30, 55), "Cabinet"), mat(screen, (20, 20, 30), "Screen", emissive=(40, 40, 80)),
                  mat(shelf, (35, 30, 55), "Cabinet"), mat(stick, IRON, "Iron"), mat(knob, (255, 107, 107), "Button"), *buttons,
                  mat(marquee, MOBIUS_PINK, "Marquee", emissive=(120, 50, 80)), mat(logo, WHITE, "Logo")], ground=True)
  # Social notice board (notes are pinned at runtime on the "Cork" face)
  posts = [box((0.14, 2.6, 0.14), (x, 1.3, 0)) for x in (-1.7, 1.7)]
  frame = box((3.3, 1.9, 0.12), (0, 1.55, 0))
  cork = box((3.1, 1.7, 0.02), (0, 1.55, 0.07))
  roof = rot(box((3.8, 0.08, 0.6), (0, 2.7, 0.05)), 0, (1, 0, 0))
  header = box((1.4, 0.3, 0.04), (0, 2.45, 0.08))
  save("board", [*[mat(p, DARKWOOD, "Wood") for p in posts], mat(frame, WOOD, "Wood"), mat(cork, CORK, "Cork", rough=0.95),
                 mat(roof, MOBIUS, "Roof"), mat(header, WHITE, "Header")], ground=True)
  # Memory graph pedestal (the orbs and links are added at runtime)
  base = lathe([(0.0, 0.0), (1.3, 0.0), (1.3, 0.2), (1.1, 0.26), (0.5, 0.3), (0.35, 0.45), (0.3, 1.2), (0.45, 1.3), (0.0, 1.3)], sides=40)
  ring = sweep(arc((0, 0.28, 0), 1.15, 0, 360, plane="xz", steps=48), 0.04)
  save("memory_base", [mat(base, STONE, "Stone"), mat(ring, (159, 227, 200), "Glow", emissive=(60, 160, 120))])
  # Hackaton podium, like the Rewards tab (01 in the middle)
  steps = [(0.0, 0.7, (255, 204, 64)), (-1.35, 0.45, (196, 202, 212)), (1.35, 0.3, (205, 127, 50))]
  pod = []
  for x, h, trim in steps:
    pod.append(mat(box((1.3, h, 1.1), (x, h / 2, 0)), (236, 236, 233), "Stone"))
    pod.append(mat(box((1.32, 0.06, 1.12), (x, h + 0.03, 0)), trim, "Trim", metal=0.2))
  save("podium", pod, ground=True)
  # Hackaton gong
  frame = [box((0.12, 2.2, 0.12), (x, 1.1, 0)) for x in (-0.8, 0.8)]
  bar = box((1.8, 0.14, 0.14), (0, 2.2, 0))
  disc = cylinder(0.62, 0.06, (0, 1.3, 0), sides=40, axis="z")
  boss = sphere(1, (0, 1.3, 0.04), (0.16, 0.16, 0.06))
  ropes = [box((0.02, 0.3, 0.02), (x, 2.0, 0)) for x in (-0.3, 0.3)]
  save("gong", [*[mat(f, (180, 40, 40), "Lacquer") for f in frame], mat(bar, (180, 40, 40), "Lacquer"), mat(disc, (230, 170, 60), "Gold", metal=0.35, rough=0.35),
                mat(boss, (250, 200, 90), "Gold", metal=0.35), *[mat(r, (240, 230, 200), "Rope") for r in ropes]], ground=True)
  # App Store stall: counter, poles, striped roof, crates of app-coloured boxes, logo sign
  counter = box((2.8, 1.0, 1.0), (0, 0.5, 0))
  counter_top = box((3.0, 0.08, 1.1), (0, 1.04, 0))
  poles = [cylinder(0.05, 2.5, (x, 1.25, z), sides=8) for x in (-1.4, 1.4) for z in (-0.5, 0.5)]
  roof = awning(3.2, 1.3, 2.5, -0.6, stripes=10, tilt=8)
  icons = []
  for i, c in enumerate(APP_COLORS):
    b = box((0.34, 0.34, 0.34), (-1.05 + i * 0.42, 1.25, 0.1))
    rot(b, (i * 17) % 30 - 15, (0, 1, 0), point=(-1.05 + i * 0.42, 0, 0.1))
    icons.append(mat(b, c, "Icon", rough=0.4))
  sign = box((1.2, 0.5, 0.06), (0, 2.85, -0.2))
  logo = box((0.42, 0.42, 0.004), (0, 2.85, -0.165))
  save("stall", [mat(counter, WOOD, "Wood"), mat(counter_top, DARKWOOD, "Wood"), *[mat(p, IRON, "Iron", metal=0.4) for p in poles], *roof, *icons,
                 mat(sign, WHITE, "Header"), mat(logo, WHITE, "Logo")], ground=True)
  # Day/night lever: a base and a separate handle that the app tilts
  lbase = [mat(box((0.6, 0.35, 0.4), (0, 0.175, 0)), IRON, "Iron", metal=0.4), mat(box((0.5, 0.04, 0.08), (0, 0.37, 0)), (20, 20, 25), "Slot"),
           mat(sphere(0.07, (-0.22, 0.4, 0.14)), (255, 212, 59), "Sun", emissive=(160, 120, 20)), mat(sphere(0.07, (0.22, 0.4, 0.14)), (160, 170, 255), "Moon", emissive=(60, 70, 160))]
  save("lever_base", lbase)
  handle = [mat(cylinder(0.03, 0.7, (0, 0.35, 0), sides=10), (220, 220, 225), "Chrome", metal=0.5), mat(sphere(0.09, (0, 0.72, 0)), MOBIUS_PINK, "Knob")]
  save("lever_handle", handle)
  # The island fence: purple posts with gold caps and two white rails (2 m long)
  post = [mat(box((0.16, 0.9, 0.16), (0, 0.45, 0)), MOBIUS, "Post"), mat(sphere(0.1, (0, 0.98, 0)), GOLD, "Gold", metal=0.25)]
  rails = [mat(box((2.0, 0.07, 0.06), (1.0, h, 0)), WHITE, "Rail") for h in (0.35, 0.7)]
  save("fence", [*post, *rails])
  lantern = [mat(box((0.18, 1.5, 0.18), (0, 0.75, 0)), MOBIUS, "Post"), mat(box((0.3, 0.3, 0.3), (0, 1.65, 0)), (255, 236, 170), "Glow", emissive=(255, 214, 120)),
             mat(trimesh.creation.cone(radius=0.26, height=0.2, sections=4), IRON, "Iron")]
  lantern[-1].apply_transform(trimesh.transformations.rotation_matrix(-math.pi / 2, (1, 0, 0)))
  lantern[-1].apply_translation((0, 1.9, 0))
  save("fence_lantern", lantern)
  # Welcome gate (south): two pillars, a Möbius arch and a logo sign
  pillars = [mat(box((0.5, 3.0, 0.5), (x, 1.5, 0)), STONE, "Stone") for x in (-2.0, 2.0)]
  caps = [mat(sphere(0.3, (x, 3.2, 0)), GOLD, "Gold", metal=0.25) for x in (-2.0, 2.0)]
  archway = mat(sweep(arc((0, 3.0, 0), 2.0, 0, 180, steps=32), 0.16), MOBIUS, "Arch")
  plate = mat(box((1.9, 0.6, 0.1), (0, 5.45, 0)), WHITE, "Header")
  glogo = mat(box((0.5, 0.5, 0.004), (0, 5.45, 0.055)), WHITE, "Logo")
  save("gate", [*pillars, *caps, archway, plate, glogo])
  # Signpost: a post and a blank plank (the app paints the landmark's name)
  save("signpost", [mat(box((0.1, 1.5, 0.1), (0, 0.75, 0)), DARKWOOD, "Wood"), mat(box((1.3, 0.4, 0.06), (0, 1.35, 0.06)), (250, 244, 236), "SignFace")])


ghost()
faces()
hats()
halo()
necks()
holds()
world()
landmarks()
