// The session bridge that runs inside the Game Studio "Worlds Lobby" scene.
//
// ui/LobbyWorld.jsx builds the scene's document from the studio's own game file
// and adds three things, leaving the scene as it was made:
//   1. PRELUDE waits for the models (sent by Worlds) before the scene builds;
//   2. a player object, your ghost, which the scene runtime walks, jumps and
//      follows with its camera exactly as in the studio's Play mode;
//   3. BRIDGE, a scene script that dresses your ghost, reports where it is,
//      and draws everyone else from the session's snapshots.

export const GHOST_SCALE = 1.35

export const PRELUDE = String.raw`<script>
// The 3D engine logs the browser's reason when it can't start 3D; pass it on.
(function () {
  var err = console.error;
  console.error = function () {
    try {
      var text = Array.prototype.map.call(arguments, String).join(' ');
      if (/WebGL|context/i.test(text)) parent.postMessage({ type: 'worlds:webgl', reason: text.slice(0, 300) }, '*');
    } catch (e) {}
    return err.apply(console, arguments);
  };
  // Ask for 3D once up front: if the browser refuses, its event says why.
  try {
    var probe = document.createElement('canvas');
    probe.addEventListener('webglcontextcreationerror', function (e) {
      window.__worldsProbe = 'frame probe: ' + (e.statusMessage || 'no reason given');
    });
    var gl = probe.getContext('webgl2') || probe.getContext('webgl');
    if (gl) { var lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext(); }
    else window.__worldsProbe = window.__worldsProbe || 'frame probe: no WebGL in this frame';
  } catch (e) { window.__worldsProbe = 'frame probe error: ' + e.message; }
})();
window.__worldsReady = new Promise(function (resolve) {
  var booted = false;
  addEventListener('message', function boot(ev) {
    var m = ev.data || {};
    if (m.type !== 'worlds:boot') return;
    booted = true;
    removeEventListener('message', boot);
    var bufs = m.models || {};
    var base = window.studio.model;
    window.studio.model = function (name) { return bufs[name] ? bufs[name].slice(0) : base(name); };
    window.__worlds = { look: m.look, logo: m.logo, you: m.you, apps: m.apps || [], players: [] };
    resolve();
  });
  // Ask until Worlds answers: this frame can start before Worlds is listening.
  (function ask() {
    if (booted) return;
    try { parent.postMessage({ type: 'worlds:need-boot', probe: window.__worldsProbe || '' }, '*'); } catch (e) {}
    setTimeout(ask, 400);
  })();
});
</script>`

// Runs as a scene script: new Function('api', 'THREE', BRIDGE).
export const BRIDGE = String.raw`
const W = window.__worlds || {};
const post = (m) => { try { parent.postMessage(m, '*'); } catch (e) {} };
const SLOTS = ['face', 'hat', 'neck', 'hold'];
const SCALE = ${GHOST_SCALE};

const env = { logo: null, loader: null, scenes: {}, map: null };
async function library() {
  if (env.loader) return env;
  const { GLTFLoader } = await import('https://esm.sh/three@0.180.0/examples/jsm/loaders/GLTFLoader.js');
  env.loader = new GLTFLoader();
  if (W.logo) {
    env.logo = await new Promise((res) => { const img = new Image(); img.onload = () => { const t = new THREE.Texture(img); t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; res(t); }; img.onerror = () => res(null); img.src = W.logo; });
  }
  return env;
}
function parsed(name) {
  if (!env.scenes[name]) {
    const buf = window.studio.model('wg_' + name);
    env.scenes[name] = buf ? new Promise((res) => env.loader.parse(buf, '', (g) => res(g.scene), () => res(null))) : Promise.resolve(null);
  }
  return env.scenes[name];
}
// The lobby's toy look: glossy clear-coated plastic, like the rest of the scene.
function toy(m) {
  const p = new THREE.MeshPhysicalMaterial({ color: m.color, map: m.map || null, transparent: m.transparent, opacity: m.opacity, emissive: m.emissive || new THREE.Color(0),
    emissiveIntensity: m.emissiveIntensity ?? 1, side: m.side, roughness: 0.4, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.12, envMap: env.map, envMapIntensity: 0.4 });
  p.name = m.name || '';
  return p;
}
function dressMaterial(mesh) {
  // some outfit pieces ship without normals; lit materials need them or they render black
  if (mesh.geometry && !mesh.geometry.attributes.normal) mesh.geometry.computeVertexNormals();
  const m = mesh.material;
  if (!m) return;
  if (m.name === 'Logo' && env.logo) {
    mesh.material = toy(m); mesh.material.map = env.logo; mesh.material.transparent = true; mesh.material.alphaTest = 0.05; mesh.material.color.set('#ffffff');
  } else if (m.name === 'Glow') { mesh.material = toy(m); mesh.material.emissiveIntensity = 1.4; }
  else mesh.material = toy(m);
  mesh.castShadow = true;
}

// A ghost dressed in a look: holder is the group the pieces go in (model space).
function outfitter(holder) {
  const worn = {};
  let current = {}, token = 0;
  const bodies = [];
  holder.traverse((n) => { if (n.isMesh && n.material && (n.material.name === 'Body')) { n.material = n.material.clone(); bodies.push(n.material); } });
  return async function wear(look) {
    look = look || {};
    const mine = ++token;
    if (look.color !== current.color) for (const m of bodies) { m.color.set(look.color || '#c8cdd6'); m.transparent = true; m.opacity = 0.94; }
    for (const slot of SLOTS) {
      const value = look[slot] || (slot === 'face' ? 'dots' : 'none');
      if (value === current[slot]) continue;
      const src = value === 'none' ? null : await parsed(slot + '_' + value);
      if (mine !== token) return;
      if (worn[slot]) { holder.remove(worn[slot]); worn[slot] = null; }
      if (src) { const piece = src.clone(true); piece.traverse((n) => { if (n.isMesh) dressMaterial(n); }); holder.add(piece); worn[slot] = piece; }
    }
    current = { ...look };
  };
}

// A label or bubble drawn on a canvas, always facing the camera.
function tag(text, opts) {
  const o = opts || {};
  const c = document.createElement('canvas'), g = c.getContext('2d');
  const font = (o.size || 44) + 'px system-ui, -apple-system, Segoe UI, sans-serif';
  g.font = '600 ' + font;
  const lines = wrap(g, text, o.width || 520);
  const w = Math.min(560, Math.max(...lines.map((l) => g.measureText(l).width)) + 44), lh = (o.size || 44) * 1.2, h = lines.length * lh + 26;
  c.width = Math.ceil(w); c.height = Math.ceil(h + (o.tail ? 18 : 0));
  g.font = '600 ' + font;
  g.fillStyle = o.bg || 'rgba(20,15,51,.78)';
  round(g, 0, 0, c.width, h, 22); g.fill();
  if (o.tail) { g.beginPath(); g.moveTo(c.width / 2 - 14, h); g.lineTo(c.width / 2, h + 18); g.lineTo(c.width / 2 + 14, h); g.fill(); }
  g.fillStyle = o.fg || '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  lines.forEach((l, i) => g.fillText(l, c.width / 2, 13 + lh * (i + 0.5)));
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  const k = (o.scale || 0.0042);
  s.scale.set(c.width * k, c.height * k, 1);
  s.center.set(0.5, 0);
  s.renderOrder = 10;
  return s;
}
function wrap(g, text, max) {
  const words = String(text).split(/\s+/), lines = [];
  let line = '';
  for (const w of words) { const t = line ? line + ' ' + w : w; if (g.measureText(t).width > max && line) { lines.push(line); line = w; } else line = t; }
  if (line) lines.push(line);
  return lines.slice(0, 4);
}
function round(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
const EMOTE = { wave: '👋', heart: '❤️', laugh: '😂', wow: '😮', dance: '💃', sleep: '💤' };

// ---------- you ----------
const me = api.player;
const meInner = me && me.object.children[0];
const meBase = meInner ? meInner.position.y : 0;
let wearMe = null;
const others = new Map(); // pid -> { root, inner, wear, label, target, look, bubble, buf, delay }
// Everyone else replays their walk from its timed samples, a little behind live:
// just far enough back that the next samples have arrived before they're needed.
let clockOffset = 0;
const serverNow = () => Date.now() + clockOffset;
function addSamples(o, p) {
  const samples = Array.isArray(p.trail) && p.trail.length ? p.trail : [[p.t0 || serverNow(), p.x, p.y, p.z, p.r || 0]];
  let first = null;
  for (const s of samples) {
    const last = o.buf[o.buf.length - 1];
    if (!Array.isArray(s) || (last && s[0] <= last[0])) continue;
    // after standing still, stay put until the walk actually starts
    if (last && s[0] - last[0] > 600) o.buf.push([s[0] - 200, last[1], last[2], last[3], last[4]]);
    o.buf.push(s);
    if (!first) first = s;
  }
  if (first && o.seen) {
    // how long the oldest new sample took to reach us: replay at least that far behind
    const need = Math.min(6000, Math.max(120, serverNow() - first[0] + 90));
    o.need = need > o.need ? need : o.need * 0.8 + need * 0.2;
  }
  o.seen = true;
}
function playback(o, dt) {
  // ease the replay delay toward what the news cadence needs, never faster than ±35% speed
  o.delay += Math.max(-0.35 * dt * 1000, Math.min(0.35 * dt * 1000, o.need - o.delay));
  const at = serverNow() - o.delay, b = o.buf;
  while (b.length > 2 && b[1][0] < at - 500) b.shift();
  if (!b.length) return;
  let s = b[b.length - 1], yaw = s[4];
  if (at <= b[0][0]) { s = b[0]; yaw = s[4]; o.root.position.set(s[1], s[2], s[3]); }
  else if (at >= s[0]) o.root.position.set(s[1], s[2], s[3]);
  else {
    let i = 0; while (b[i + 1][0] < at) i++;
    const a = b[i], c = b[i + 1], k = (at - a[0]) / Math.max(1, c[0] - a[0]);
    // a long gap between samples (a jump of more than a few metres) is a teleport, not a walk
    if (Math.hypot(c[1] - a[1], c[3] - a[3]) > 12) o.root.position.set(c[1], c[2], c[3]);
    else o.root.position.set(a[1] + (c[1] - a[1]) * k, a[2] + (c[2] - a[2]) * k, a[3] + (c[3] - a[3]) * k);
    let d = c[4] - a[4]; d = Math.atan2(Math.sin(d), Math.cos(d)); yaw = a[4] + d * k;
  }
  o.yaw = yaw;
}
const bubbles = new Map(); // pid -> { sprite, until, holder }

library().catch((err) => post({ type: 'studio:error', message: 'Worlds library: ' + (err && err.message) })).then(() => {
  // borrow the studio light the scene gives its toy materials, so every ghost is lit alike
  if (meInner) meInner.traverse((n) => { if (!env.map && n.isMesh && n.material && n.material.envMap) env.map = n.material.envMap; });
  if (meInner) {
    meInner.traverse((n) => { if (n.isMesh && n.material && n.material.name === 'Sheen') { n.material = n.material.clone(); n.material.transparent = true; n.material.opacity = 0.55; } });
    wearMe = outfitter(meInner);
    wearMe(W.look);
  }
  post({ type: 'worlds:ready' });
});

async function makeOther(p) {
  const root = new THREE.Group(), inner = new THREE.Group();
  root.add(inner);
  root.scale.setScalar(SCALE);
  const body = await parsed('ghost');
  if (body) { const b = body.clone(true); b.traverse((n) => { if (n.isMesh) dressMaterial(n); if (n.isMesh && n.material.name === 'Sheen') { n.material.transparent = true; n.material.opacity = 0.55; } }); inner.add(b); }
  const o = { root, inner, wear: outfitter(inner), label: null, name: null, target: new THREE.Vector3(p.x, p.y, p.z), yaw: p.r || 0, away: false, buf: [], need: 400, delay: 400 };
  root.position.copy(o.target);
  api.world.add(root);
  return o;
}
function setLabel(o, name, away) {
  if (o.name === name && o.away === away) return;
  if (o.label) { o.root.remove(o.label); o.label.material.map.dispose(); }
  o.label = tag(away ? name + ' · away' : name, { size: 40, bg: 'rgba(20,15,51,.62)', scale: 0.0034 });
  o.label.position.y = 1.18;
  o.root.add(o.label);
  o.name = name; o.away = away;
}

const pending = new Set();
async function sync(list) {
  const seen = new Set();
  const mine = list.find((p) => p.pid === W.you);
  mySeat = mine ? (mine.seat || null) : null;
  takenSeats = new Set(list.filter((p) => p.seat).map((p) => p.seat));
  for (const p of list) {
    if (p.pid === W.you || !p.landed) continue;
    seen.add(p.pid);
    let o = others.get(p.pid);
    if (!o) {
      if (pending.has(p.pid)) continue;
      pending.add(p.pid);
      o = await makeOther(p);
      pending.delete(p.pid);
      others.set(p.pid, o);
    }
    addSamples(o, p);
    o.target.set(p.x, p.y, p.z); o.seated = !!p.seat;
    if (o.seated) o.yaw = p.r || 0;
    o.wear({ color: p.color, face: p.face, hat: p.hat, neck: p.neck, hold: p.hold });
    setLabel(o, p.name, !!p.away);
    o.inner.traverse((n) => { if (n.isMesh && n.material && n.material.name === 'Body') { n.material.transparent = true; n.material.opacity = p.away ? 0.45 : 0.94; } });
  }
  for (const [pid, o] of others) if (!seen.has(pid) && !pending.has(pid)) { api.world.remove(o.root); others.delete(pid); }
}

function holderFor(pid) {
  if (pid === W.you) return me ? me.object : null;
  const o = others.get(pid);
  return o ? o.root : null;
}
function say(pid, text) {
  const holder = holderFor(pid);
  if (!holder) return;
  const old = bubbles.get(pid);
  if (old) old.holder.remove(old.sprite);
  const emoji = [...String(text)].length <= 2 && /\p{Extended_Pictographic}/u.test(text);
  const sprite = tag(text, { tail: true, bg: 'rgba(255,255,255,.95)', fg: '#1d1640', size: emoji ? 72 : 40, scale: 0.0032 });
  // both ghosts are scaled the same (yours by its scene object); others wear a name label below
  sprite.position.y = pid === W.you ? 1.3 : 1.5;
  holder.add(sprite);
  bubbles.set(pid, { sprite, holder, until: performance.now() + (emoji ? 3000 : 6000) });
}

addEventListener('message', (ev) => {
  const m = ev.data || {};
  if (m.type === 'worlds:players') { W.players = m.players || []; if (typeof m.now === 'number') clockOffset = m.now - Date.now(); if (env.loader) sync(W.players).catch((err) => post({ type: 'studio:error', message: 'Worlds players: ' + (err && err.message), detail: String(err && err.stack).slice(0, 400) })); }
  else if (m.type === 'worlds:look' && wearMe) wearMe(m.look);
  else if (m.type === 'worlds:boba') drink(m.pid);
  else if (m.type === 'worlds:displays') syncDisplays(m.displays || []);
  else if (m.type === 'worlds:fireworks') { if (onParty() && performance.now() > CAM.showUntil && window.__worldsFireworks) window.__worldsFireworks(true); }
  else if (m.type === 'worlds:say') say(m.pid, m.emote ? (EMOTE[m.emote] || m.emote) : m.text);
});

// ---------- the Chat Café: a private table for two ----------
// One glowing table with two seats. Walk up to a free seat and the app offers "Sit at the private table".
// Seated, you stay put and everything you say goes only to the ghost across from you (the host
// routes it; see rooms.py), under a soft bubble. The marquee over the front says what the café is for.
const cafe = api.get('chat-cafe');
const SEAT_LOCAL = [[-0.55, 1.6], [0.95, 1.6]], TABLE_LOCAL = [0.2, 1.6];
const seatAt = {}; // seat id -> { x, z, yaw }
let mySeat = null;            // 'cafe:0' | 'cafe:1' | null, the host's word (from the players list)
let takenSeats = new Set();
let swirl = [], swirlTex = [], swirlLevel = 0;
if (cafe) {
  const root = cafe.object;
  root.updateWorldMatrix(true, true);
  const tableAt = root.localToWorld(new THREE.Vector3(TABLE_LOCAL[0], 0, TABLE_LOCAL[1]));
  SEAT_LOCAL.forEach(([x, z], k) => {
    const at = root.localToWorld(new THREE.Vector3(x, 0, z));
    seatAt['cafe:' + k] = { x: at.x, z: at.z, yaw: Math.atan2(tableAt.x - at.x, tableAt.z - at.z) };
  });
  // one table only: the two plain tables and their chairs go away
  root.traverse((n) => { if (/^(table|table_leg|table_foot|light_candle)_[02]$|^chair(_leg|_back)?_[02]_-?1$/.test(n.name)) n.visible = false; });
  root.traverse((n) => {
    if (!n.isMesh || !/^(table|table_leg|table_foot|chair|chair_leg|chair_back)(_1)(_-?1)?$/.test(n.name)) return;
    n.material = n.material.clone();
    if (/^table(_foot|_leg)?_1$/.test(n.name)) n.material.color.set('#b99cff');
    else n.material.color.set('#ffd6ea');
  });
  const glow = new THREE.MeshStandardMaterial({ color: '#c9b8ff', emissive: '#9a7dff', emissiveIntensity: 1.8, roughness: 0.3 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.03, 8, 64), glow);
  ring.rotation.x = Math.PI / 2; ring.scale.y = 0.68; ring.position.set(TABLE_LOCAL[0], 0.24, TABLE_LOCAL[1]); root.add(ring); // an oval: the floor ends 0.9 in front of the table
  // Scrambled letters circling the table while it is taken: what bystanders see instead of the chat.
  const GLYPHS = 'ABCDEFGHIJKLMNOPRSTUVWYZ?!'.split(''), HUES = ['#ff8fc0', '#b99cff', '#7fe0ff', '#ffd98a', '#9ee8b4'];
  const glyphTex = GLYPHS.map((ch, k) => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 96; const cg = cv.getContext('2d');
    cg.font = '800 72px "Trebuchet MS", system-ui, sans-serif'; cg.textAlign = 'center'; cg.textBaseline = 'middle';
    cg.lineWidth = 10; cg.strokeStyle = 'rgba(255,255,255,.85)'; cg.strokeText(ch, 48, 52);
    cg.fillStyle = HUES[k % HUES.length]; cg.fillText(ch, 48, 52);
    const tx = new THREE.CanvasTexture(cv); tx.colorSpace = THREE.SRGBColorSpace; return tx;
  });
  swirl = [];
  for (let i = 0; i < 30; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glyphTex[0], transparent: true, opacity: 0, depthWrite: false }));
    sp.visible = false; root.add(sp);
    swirl.push({ sp, a: (i / 30) * 6.283, w: (0.5 + Math.random() * 0.5) * (i % 2 ? 1 : -1), ph: Math.random() * 6.283, h: 0.5 + Math.random() * 1.0, k: -1 });
  }
  swirlTex = glyphTex;
  // the marquee on the front of the café
  const c = document.createElement('canvas'); c.width = 1024; c.height = 220; const g = c.getContext('2d');
  // baby-pink pennant with a scalloped hem, a cream stitched border, and soft rose lettering
  const bg = g.createLinearGradient(0, 0, 0, 220); bg.addColorStop(0, '#ffe3ee'); bg.addColorStop(1, '#ffc6dc');
  g.fillStyle = bg; g.beginPath(); g.moveTo(24, 0); g.lineTo(1000, 0); g.quadraticCurveTo(1024, 0, 1024, 24); g.lineTo(1024, 170);
  for (let i = 0; i < 16; i++) { const x0 = 1024 - i * 64; g.quadraticCurveTo(x0 - 32, 232, x0 - 64, 170); }
  g.lineTo(0, 24); g.quadraticCurveTo(0, 0, 24, 0); g.fill();
  g.strokeStyle = '#fff8f0'; g.lineWidth = 5; g.setLineDash([16, 12]); round(g, 16, 14, 992, 150, 26); g.stroke(); g.setLineDash([]);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = 'rgba(255,255,255,.9)'; g.shadowBlur = 0; g.shadowOffsetY = 4;
  g.fillStyle = '#c2457a'; g.font = '800 74px "Trebuchet MS", system-ui, sans-serif'; g.fillText('Chat Café', 512, 62);
  g.shadowOffsetY = 0;
  g.fillStyle = '#d9648f'; g.font = '600 31px system-ui, sans-serif'; g.fillText('a private table for two  ·  take a seat and talk', 512, 128);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 0.945), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, transparent: true, alphaTest: 0.05, side: THREE.DoubleSide }));
  banner.position.set(0, 3.05, 2.55); root.add(banner);
}
// The plaza benches: two seats each, facing the way the bench does. Chat there stays public.
for (let b = 1; b <= 4; b++) {
  const h = api.get('bench-' + b);
  if (!h) continue;
  h.object.updateWorldMatrix(true, true);
  const front = h.object.localToWorld(new THREE.Vector3(0, 0, 1)), mid = h.object.localToWorld(new THREE.Vector3(0, 0, 0));
  const yaw = Math.atan2(front.x - mid.x, front.z - mid.z);
  [-0.45, 0.45].forEach((x, k) => { const at = h.object.localToWorld(new THREE.Vector3(x, 0, 0.02)); seatAt['bench:' + b + ':' + k] = { x: at.x, z: at.z, yaw }; });
}
// The free seat you are standing next to (a chair at the café or a place on a bench), or null.
function seatNear(p) {
  let best = null, bd = 1.7;
  for (const [id, s] of Object.entries(seatAt)) { const d = Math.hypot(p.x - s.x, p.z - s.z); if (d < bd && !takenSeats.has(id)) { bd = d; best = id; } }
  return best;
}

// ---------- apps on display ----------
// Players put apps on display from the App Store card; each gets a small stand in a row in front of
// the App Store stand: a plinth, the app's icon floating over it, its name and who showed it.
// Walking up offers the app (rooms.py keeps the list: six at most, oldest replaced).
const displayAt = new Map(); // app id -> { group, x, z, collider }
function syncDisplays(list) {
  const base = api.get('app-store-stand');
  if (!base) return;
  const keep = new Set(list.map((d) => d.app));
  for (const [id, d] of displayAt) {
    if (keep.has(id)) continue;
    base.object.remove(d.group);
    const i = circles.indexOf(d.collider); if (i >= 0) circles.splice(i, 1);
    displayAt.delete(id);
  }
  base.object.updateWorldMatrix(true, true);
  const SLOTS = [-3.5, -2.1, -0.7, 0.7, 2.1, 3.5];
  const used = new Set([...displayAt.values()].map((d) => d.slot));
  list.forEach((d) => {
    if (displayAt.has(d.app)) return;
    let slot = SLOTS.findIndex((_, k) => !used.has(k)); if (slot < 0) return;
    used.add(slot);
    const group = new THREE.Group(); group.position.set(SLOTS[slot], 0, 4.0);
    const lilac = new THREE.MeshStandardMaterial({ color: '#b99cff', roughness: 0.4 });
    const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 0.6, 24), lilac); plinth.position.y = 0.3; group.add(plinth);
    const glowM = new THREE.MeshStandardMaterial({ color: '#fff', emissive: '#9a7dff', emissiveIntensity: 1.8 });
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.03, 8, 32), glowM); rim.rotation.x = Math.PI / 2; rim.position.y = 0.62; group.add(rim);
    const idx = (W.appIds || []).indexOf(d.app);
    const img = new Image(); const tex = new THREE.Texture(img); tex.colorSpace = THREE.SRGBColorSpace;
    img.onload = () => { tex.needsUpdate = true; }; const iconSrc = idx >= 0 ? W.apps[idx] : d.icon; if (iconSrc) img.src = iconSrc;
    const icon = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 0.85), new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide }));
    icon.position.y = 1.35; group.add(icon);
    const name = (W.appNames || [])[idx] || d.title || d.app;
    const label = tag(name, { size: 36, bg: 'rgba(60,40,120,.88)', scale: 0.0032 }); label.position.y = 1.95; group.add(label);
    const by = tag('shown by ' + (d.name || 'someone'), { size: 24, bg: 'rgba(255,255,255,.85)', fg: '#3b2a7a', scale: 0.0028 }); by.position.y = 0.72; by.position.z = 0.05; group.add(by);
    base.object.add(group);
    const wp = base.object.localToWorld(new THREE.Vector3(SLOTS[slot], 0, 4.0));
    const collider = { x: wp.x, z: wp.z, r: 0.55 + (ghostHalf || BODY) }; circles.push(collider); // the plinth is 0.5 across
    displayAt.set(d.app, { group, icon, x: wp.x, z: wp.z, collider, slot });
  });
}
function displayNear(p) {
  for (const [id, d] of displayAt) if (Math.hypot(p.x - d.x, p.z - d.z) < 1.9) return 'display:' + id;
  return null;
}

// ---------- every frame ----------
let t = 0, lastSent = 0, sent = null, nearStand = null;
// Stands you can walk up to: the card for the one you're next to is offered.
const STANDS = [['kart', api.get('kart-stand'), 5.5], ['store', api.get('app-store-stand'), 7.5], ['boba', api.get('snack-bar'), 4.5], ['ghostdrop', api.get('ghost-drop-stand'), 5.5]].filter((s) => s[1]);

// App icons from the Möbius App Store float in a slow ring above the App Store stand.
const iconRing = new THREE.Group();
const storeStand = api.get('app-store-stand');
if (storeStand && (W.apps || []).length) {
  const box = new THREE.Box3().setFromObject(storeStand.object);
  iconRing.position.set(storeStand.position.x, box.min.y + (box.max.y - box.min.y) * 0.72, storeStand.position.z);
  const icons = W.apps.slice(0, 10);
  icons.forEach((src, i) => {
    const img = new Image();
    const tex = new THREE.Texture(img); tex.colorSpace = THREE.SRGBColorSpace;
    img.onload = () => { tex.needsUpdate = true; };
    img.src = src;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    const a = (i / icons.length) * Math.PI * 2;
    sprite.position.set(Math.cos(a) * 3.6, 0, Math.sin(a) * 3.6);
    sprite.scale.setScalar(0.85);
    sprite.userData.phase = a;
    iconRing.add(sprite);
  });
  api.world.add(iconRing);
}
// ---------- boba tea ----------
// A cup of milk tea with dark pearls and a straw, built from simple shapes (about 0.2 tall).
function bobaCup() {
  const cup = new THREE.Group();
  const clear = new THREE.MeshPhysicalMaterial({ color: '#ffffff', transparent: true, opacity: 0.16, roughness: 0.08, clearcoat: 1, depthWrite: false });
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.055, 0.2, 20, 1, true), clear);
  shell.position.y = 0.1; cup.add(shell);
  const tea = new THREE.Mesh(new THREE.CylinderGeometry(0.064, 0.052, 0.17, 20), new THREE.MeshStandardMaterial({ color: '#dba46a', emissive: '#5a3418', roughness: 0.4 }) /* milk tea */);
  tea.geometry.translate(0, 0.085, 0); tea.position.y = 0.008; tea.renderOrder = 1; cup.add(tea);
  const pearl = new THREE.MeshStandardMaterial({ color: '#1b1210', roughness: 0.25 });
  const pearls = [];
  for (let i = 0; i < 64; i++) { // a heap of pearls at the bottom, in rings that shrink as they climb
    const layer = Math.floor(i / 16), k = i % 16, ring = k < 10 ? 0.042 : k < 15 ? 0.022 : 0;
    const a = k * 2.4 + layer * 0.7;
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.0135, 8, 6), pearl);
    b.position.set(Math.cos(a) * ring, 0.018 + layer * 0.022, Math.sin(a) * ring); cup.add(b); pearls.push(b);
  }
  const lid = new THREE.Mesh(new THREE.SphereGeometry(0.071, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2), clear);
  lid.scale.y = 0.35; lid.position.y = 0.2; lid.renderOrder = 2; shell.renderOrder = 2; cup.add(lid);
  const straw = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.26, 8), new THREE.MeshStandardMaterial({ color: '#ff4fd8', roughness: 0.4 }));
  straw.position.set(0.012, 0.23, 0); straw.rotation.z = -0.18; cup.add(straw);
  cup.userData.tea = tea; cup.userData.pearls = pearls;
  return cup;
}
// The snack bar is a boba tea stand: a brown-sugar, taro, matcha and strawberry striped
// kiosk with a giant cup on the roof, a few cups and a bowl of pearls on the counter, and a sign.
const juiceStand = api.get('snack-bar');
if (juiceStand) {
  const stand = juiceStand.object;
  const paint = (name, color) => {
    const n = stand.getObjectByName(name);
    if (!n || !n.isMesh) return;
    n.material = n.material.clone(); n.material.color.set(color);
  };
  ['popcorn', 'pop_0', 'pop_1', 'pop_2', 'pop_3', 'pop_4', 'pop_5', 'roof_ball'].forEach((n) => { const o = stand.getObjectByName(n); if (o) o.visible = false; });
  const stripes = ['#c0773f', '#fff1dc', '#b99cff', '#fff1dc', '#9ed99a', '#fff1dc'];
  stripes.forEach((c, k) => paint('stripe_' + k, c));
  paint('roof', '#c0773f'); paint('top', '#fff1dc'); paint('kiosk', '#6b4226');
  // a giant cup on the roof, fixed in place
  const big = bobaCup(); big.scale.setScalar(6); big.position.set(0, 3.55, 0); stand.add(big);
  // cups on the counter
  [-0.6, 0, 0.6].forEach((x, k) => { const c = bobaCup(); c.scale.setScalar(2.6); c.position.set(x, 1.2, -0.25); c.rotation.y = k; stand.add(c); });
  // a bowl of tapioca pearls
  const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#fff1dc', roughness: 0.4, side: THREE.DoubleSide }));
  bowl.position.set(1.0, 1.35, -0.2); stand.add(bowl);
  const pearlMat = new THREE.MeshStandardMaterial({ color: '#1b1210', roughness: 0.25 });
  for (let k = 0; k < 24; k++) { const b = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), pearlMat); const a = k * 2.4, r = 0.03 + (k % 4) * 0.035; b.position.set(1.0 + Math.cos(a) * r, 1.17 + (k % 3) * 0.02, -0.2 + Math.sin(a) * r); stand.add(b); }
  // a small wooden sign standing on the counter's left end
  const c = document.createElement('canvas'); c.width = 256; c.height = 112; const g = c.getContext('2d');
  g.fillStyle = '#6b4226'; round(g, 0, 0, 256, 112, 18); g.fill();
  g.strokeStyle = '#fff1dc'; g.lineWidth = 4; round(g, 7, 7, 242, 98, 12); g.stroke();
  g.fillStyle = '#fff1dc'; g.font = '700 46px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('Boba Tea', 128, 58);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.22), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, side: THREE.DoubleSide }));
  sign.position.set(-1.0, 1.32, 0.35); sign.rotation.x = -0.25; stand.add(sign);
}

// Drinking: the cup comes up to the ghost, tilts and empties in about a second and a
// half, then black pearl dots pop out all over the ghost for five seconds.
const drinks = new Map(); // pid -> { holder, inner, cup, dots, t }
function innerFor(pid) {
  if (pid === W.you) return meInner;
  const o = others.get(pid);
  return o ? o.inner : null;
}
function spotsOn(inner, count) {
  // points on the ghost's body: rays from all around, aimed at its middle
  const bodies = [];
  inner.traverse((n) => { if (n.isMesh && n.material && n.material.name === 'Body') bodies.push(n); });
  if (!bodies.length) return [];
  inner.updateWorldMatrix(true, true);
  const box = new THREE.Box3(); for (const b of bodies) box.expandByObject(b);
  const mid = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
  const ray = new THREE.Raycaster(), out = [];
  for (let i = 0; i < count * 3 && out.length < count; i++) {
    const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    const dir = new THREE.Vector3(s * Math.cos(a), u * 0.8, s * Math.sin(a)).normalize();
    const from = mid.clone().addScaledVector(dir, size.length());
    ray.set(from, dir.clone().negate());
    const hit = ray.intersectObjects(bodies, false)[0];
    if (hit) out.push(hit.point);
  }
  return out;
}
function drink(pid) {
  const holder = holderFor(pid), inner = innerFor(pid);
  if (!holder || !inner) return;
  const old = drinks.get(pid);
  if (old) { old.holder.remove(old.cup); clearBody(old); }
  const cup = bobaCup();
  cup.scale.setScalar(1.8);
  cup.position.set(0.7, 0.24, 0.12); // at the ghost's hand (the ghost is about 1.1 wide)
  holder.add(cup);
  const d = { holder, inner, cup, fills: [], t: 0 };
  fillBody(d);
  drinks.set(pid, d);
  api.sound && api.sound([1.2, , 180, .02, .25, .2, 1, .6, , , , , .05, , , .2]);
}
// The tea ends up inside the ghost: its body fills from the bottom up with milk tea
// (and a few dark pearls) as the cup empties, holds a few seconds, then drains away.
function fillBody(d) {
  d.fills = [];
  d.inner.updateWorldMatrix(true, true);
  const bodies = [];
  d.inner.traverse((n) => { if (n.isMesh && n.material && n.material.name === 'Body') bodies.push(n); });
  if (!bodies.length) return;
  const inv = new THREE.Matrix4().copy(d.inner.matrixWorld).invert();
  const box = new THREE.Box3();
  for (const b of bodies) box.expandByObject(b);
  box.applyMatrix4(inv);
  const uni = { uLevel: { value: 0 }, uInv: { value: inv }, uLo: { value: box.min.y }, uHi: { value: box.max.y } };
  for (const m of bodies) {
    const orig = m.material, mat = orig.clone();
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uni);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vFillW;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvFillW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vFillW;\nuniform float uLevel, uLo, uHi;\nuniform mat4 uInv;')
        .replace('#include <color_fragment>', '#include <color_fragment>' + '\n' +
          '{ vec3 q = (uInv * vec4(vFillW, 1.0)).xyz;' + '\n' +
          'float surf = uLo + (uHi - uLo) * uLevel + sin(q.x * 14.0 + q.z * 9.0) * 0.012 * (uHi - uLo);' + '\n' +
          'if (uLevel > 0.001 && q.y < surf) {' + '\n' +
          'vec3 tea = vec3(0.60, 0.34, 0.17);' + '\n' +
          'vec3 c3 = floor(q * 11.0);' + '\n' +
          'float h = fract(sin(dot(c3, vec3(12.9898, 78.233, 37.719))) * 43758.5453);' + '\n' +
          'vec3 f3 = fract(q * 11.0) - 0.5;' + '\n' +
          'if (h > 0.72 && dot(f3, f3) < 0.12) tea = vec3(0.05, 0.03, 0.025);' + '\n' +
          'diffuseColor.rgb = mix(diffuseColor.rgb, tea, 0.92);' + '\n' +
          'if (q.y > surf - 0.03 * (uHi - uLo)) diffuseColor.rgb += vec3(0.12, 0.08, 0.05);' + '\n' +
          '} }');
    };
    mat.customProgramCacheKey = () => 'boba-fill';
    m.material = mat;
    d.fills.push({ mesh: m, orig, mat });
  }
  d.uni = uni;
}
function clearBody(d) {
  for (const f of d.fills || []) { f.mesh.material = f.orig; f.mat.dispose(); }
  d.fills = [];
}
function updateDrinks(dt) {
  for (const [pid, d] of drinks) {
    d.t += dt;
    if (d.uni) d.uni.uInv.value.copy(d.inner.matrixWorld).invert();
    if (d.cup.parent) {
      // held at the side (seen from behind too), up to the head, tilted in to sip
      const k = Math.min(1, d.t / 0.35);
      d.cup.position.set(0.7 - 0.26 * k, 0.24 + 0.8 * k, 0.12 + 0.16 * k); // ends up by the top of the head
      d.cup.rotation.z = 0.75 * Math.min(1, Math.max(0, (d.t - 0.3) / 0.3));
      const sip = Math.min(1, Math.max(0, (d.t - 0.45) / 0.8));
      d.cup.userData.tea.scale.y = Math.max(0.04, 1 - sip); // slurp
      d.cup.userData.pearls.forEach((b, i) => b.scale.setScalar(Math.max(0, Math.min(1, 1.6 - sip * 1.6 - (i % 8) * 0.04)))); // the pearls go with the tea
      if (d.uni) d.uni.uLevel.value = sip; // ...and the ghost fills up
      if (d.t > 1.4) { d.cup.userData.pearls.forEach((b) => b.scale.setScalar(0)); d.holder.remove(d.cup); if (d.uni) d.uni.uLevel.value = 1; api.sound && api.sound([.8, , 520, , .03, .06, 1, 1.8, , , 300, .02]); }
    } else {
      if (d.uni) { d.uni.uLevel.value = Math.min(1, Math.max(0, (6.4 - d.t) / 0.8)); }
      if (d.t > 6.4) { clearBody(d); drinks.delete(pid); }
    }
  }
}

// ---------- camera ----------
// A third-person chase camera, as in Second Life: close behind and a little above your
// ghost, swinging round behind it as you walk; drag to look around, pinch or scroll to
// come closer or go farther. While fireworks go off on the party island it pulls back
// and tilts up at the sky, then settles back to where it was.
const CAM = { init: false, base: null, show: 0, showUntil: 0, saved: null, pitch: 16 * Math.PI / 180, dist: 8.5, skyPitch: 8 * Math.PI / 180, skyDist: 28 };
const PARTY_Z = 32; // the party island starts here
const onParty = () => !!me && me.position.z > PARTY_Z;
function steerCamera(dt) {
  const orbit = window.__worldsOrbit, camera = api.camera;
  if (!orbit || !me) return;
  const p = me.position;
  if (!CAM.init) {
    CAM.init = true;
    orbit.minDistance = 5;
    orbit.target.set(p.x, p.y + 1.5, p.z);
    camera.position.set(p.x, p.y + 1.5 + Math.sin(CAM.pitch) * CAM.dist, p.z + Math.cos(CAM.pitch) * CAM.dist);
  }
  const now = performance.now();
  const before = CAM.show;
  CAM.show = Math.min(1, Math.max(0, CAM.show + (now < CAM.showUntil ? dt : -dt) / 1.1));
  orbit.maxDistance = CAM.show > 0 ? 32 : 11;
  if (CAM.show > 0 && before === 0) { // the show starts: remember the view to come back to
    CAM.saved = camera.position.clone().sub(orbit.target);
    CAM.base = orbit.target.clone();
  }
  if (showReady && CAM.show > 0.92) { showReady(); showReady = null; }
  if (CAM.show === 0) { CAM.saved = null; return; }
  CAM.base.lerp(new THREE.Vector3(p.x, p.y + 1.5, p.z), Math.min(1, dt * 8));
  const e = CAM.show * CAM.show * (3 - 2 * CAM.show);
  const flat = Math.hypot(CAM.saved.x, CAM.saved.z) || 1, p0 = Math.atan2(CAM.saved.y, flat), d0 = CAM.saved.length();
  const pitch = p0 + (CAM.skyPitch - p0) * e, dist = d0 + (CAM.skyDist - d0) * e;
  const look = CAM.base.clone(); look.y += 6.5 * e;
  orbit.target.copy(look);
  camera.position.set(look.x + (CAM.saved.x / flat) * Math.cos(pitch) * dist, look.y + Math.sin(pitch) * dist, look.z + (CAM.saved.z / flat) * Math.cos(pitch) * dist);
}
// A show on the party island: the rockets are aimed at what the camera sees, so they wait
// until it has pulled back and looked up (or a few seconds, whichever comes first).
let showReady = null;
window.__worldsShowCam = () => {
  if (!onParty()) return null;
  CAM.showUntil = performance.now() + 15500;
  return new Promise((resolve) => { showReady = resolve; setTimeout(resolve, 3500); });
};

// ---------- things you can't walk through ----------
// Every collider keeps your middle (the ghost is about 0.3 wide) out of its shape and slides you along it.
const BODY = 0.3;
const circles = [], boxes = [], walls = [];
function ground(h) { return h ? h.object.position.y : 0; }
for (let i = 1; i <= 12; i++) { const h = api.get('street-lamp-' + i); if (h) circles.push({ x: h.position.x, z: h.position.z, r: 0.25 + BODY }); }
for (let i = 1; i <= 4; i++) {
  const h = api.get('bench-' + i);
  if (h) boxes.push({ x: h.position.x, z: h.position.z, c: Math.cos(h.object.rotation.y), s: Math.sin(h.object.rotation.y), hx: 0.95 + BODY, hz: 0.32 + BODY });
}
// The buildings. Footprints are measured from each model, in its own space (x across, z front-to-back), and
// rotated with the building. Only the structure is solid: walls, counters, posts, booths, stage speakers, the
// kart ramp, the café's table, the lighthouse. Open floors, chairs and platforms stay walkable.
// box = [x0, x1, z0, z1], circle = [x, z, radius]
const BUILDINGS = {
  'chat-cafe': { boxes: [[-3.55, 3.55, -2.25, -0.08], [-0.3, 0.7, 1.1, 2.1]], circles: [[-3.2, 2.2, 0.16], [3.2, 2.2, 0.16]] },
  'app-store-stand': {
    boxes: [[-1.8, 1.8, -1.2, 0.93], [-3.05, -2.15, 0.45, 1.35], [2.15, 3.05, 0.45, 1.35]],
    circles: [[-2.1, -1.3, 0.16], [2.1, -1.3, 0.16], [-2.1, 1.25, 0.16], [2.1, 1.25, 0.16]],
  },
  'kart-stand': {
    boxes: [[-2.6, 2.2, -0.5, 0.5], [-2.15, -0.85, 2.54, 2.66], [-2.6, 2.6, -1.95, -1.65]],
    circles: [[-2.4, -1.8, 0.2], [2.4, -1.8, 0.2], [2.7, 1.2, 0.3], [-3, -0.6, 0.12], [3, -0.6, 0.12]],
  },
  // Ghost Drop: the hex tower (its lowest layer is head height), the sign posts, the tap board and side lanterns.
  'ghost-drop-stand': {
    boxes: [],
    circles: [[0, -0.25, 1.75], [-2.4, -1.75, 0.12], [2.4, -1.75, 0.12], [-2, 2.41, 0.1], [-3, -0.4, 0.1], [3, -0.4, 0.1], [1.45, 1.85, 0.38]],
  },
  'snack-bar': { boxes: [[-1.4, 1.4, -0.75, 0.75]], circles: [[-0.8, 1.1, 0.25], [0.8, 1.1, 0.25]] },
  'dj-set': { boxes: [[-1.7, 1.7, -0.73, 0.73], [-2.97, -1.92, -0.5, 0.5], [1.92, 2.97, -0.5, 0.5]], circles: [] },
  'lighthouse': { boxes: [], circles: [[0, 0, 1.1], [0.2, 0, 2.9]] },
};
for (const [id, shape] of Object.entries(BUILDINGS)) {
  const h = api.get(id);
  if (!h) continue;
  const ry = h.object.rotation.y, c = Math.cos(ry), s = Math.sin(ry);
  const toWorld = (lx, lz) => [h.position.x + lx * c + lz * s, h.position.z - lx * s + lz * c];
  for (const [x0, x1, z0, z1] of shape.boxes) {
    const [x, z] = toWorld((x0 + x1) / 2, (z0 + z1) / 2);
    boxes.push({ x, z, c, s, hx: (x1 - x0) / 2 + BODY, hz: (z1 - z0) / 2 + BODY });
  }
  for (const [lx, lz, r] of shape.circles) { const [x, z] = toWorld(lx, lz); circles.push({ x, z, r: r + BODY }); }
}
// the bridge: rails on both sides from shore to shore (the deck itself is open at both ends)
const bridge = api.get('party-bridge');
// The deck's inner face of the rails is 1.38 from the middle. The ghost's real width is measured once it
// has loaded, so its whole body (not just its middle) stays clear of the rails.
const RAIL_IN = 1.38;
const bridgeWalls = [];
if (bridge) {
  const bx = bridge.position.x, bz = bridge.position.z;
  for (const side of [-1, 1]) { const w = { side, bx, z0: bz - 12.1, z1: bz + 12.1, x0: 0, x1: 0 }; walls.push(w); bridgeWalls.push(w); }
}
let ghostHalf = 0;
function fitBridgeWalls() {
  if (ghostHalf || !meInner || !bridgeWalls.length) return;
  const box = new THREE.Box3(); let any = false;
  meInner.updateWorldMatrix(true, true);
  meInner.traverse((n) => { if (n.isMesh && n.material && (n.material.name === 'Body' || n.material.name === 'Sheen')) { box.expandByObject(n); any = true; } });
  if (!any) return;
  ghostHalf = Math.min(0.8, Math.max(0.3, Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2)) + 0.04;
  // Everything solid (lamps, benches, the crystal fence, app stands) was sized for a ghost 0.3 wide; grow it to the real width.
  const grow = ghostHalf - BODY;
  for (const c of circles) c.r += grow;
  for (const b of boxes) { b.hx += grow; b.hz += grow; }
  for (const w of bridgeWalls) {
    const edge = RAIL_IN - ghostHalf;
    if (w.side > 0) { w.x0 = w.bx + edge; w.x1 = w.bx + 2.6; } else { w.x0 = w.bx - 2.6; w.x1 = w.bx - edge; }
  }
}
// The deck is a rising arch of tilted planks. The ground under your middle is right, but the front of a wide
// ghost would sink into the next plank, so the ghost rides up to the highest plank under its whole footprint.
const rayDown = new THREE.Raycaster(), DOWN = new THREE.Vector3(0, -1, 0), FOOTPR = [[0, 0]];
for (let i = 0; i < 8; i++) FOOTPR.push([Math.cos(i * Math.PI / 4), Math.sin(i * Math.PI / 4)]);
function deckLift(x, y, z) {
  if (!bridge || !ghostHalf || Math.abs(x - bridge.position.x) > RAIL_IN || Math.abs(z - bridge.position.z) > 12.5) return 0;
  let top = y;
  for (const [dx, dz] of FOOTPR) {
    rayDown.set(new THREE.Vector3(x + dx * ghostHalf * 0.8, y + 0.4, z + dz * ghostHalf * 0.8), DOWN);
    const h = rayDown.intersectObject(bridge.object, true)[0];
    if (h && h.point.y > top) top = h.point.y;
  }
  return Math.min(0.6, top - y);
}
// a low glowing fence round the Möbius crystal, so nobody can climb its pedestal
const crystal = api.get('mobius-crystal');
const FENCE_R = 3.5;
if (crystal) {
  circles.push({ x: crystal.position.x, z: crystal.position.z, r: FENCE_R + 0.12 + BODY });
  const fence = new THREE.Group();
  const post = new THREE.MeshStandardMaterial({ color: '#efeaff', roughness: 0.35 });
  const glow = new THREE.MeshStandardMaterial({ color: '#7fe9ff', emissive: '#4fd2ff', emissiveIntensity: 1.6, roughness: 0.3 });
  const N = 28;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.8, 8), post);
    pole.position.set(Math.cos(a) * FENCE_R, 0.4, Math.sin(a) * FENCE_R);
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 8), glow);
    orb.position.set(pole.position.x, 0.88, pole.position.z);
    pole.castShadow = true;
    fence.add(pole, orb);
  }
  for (const y of [0.3, 0.62]) {
    const rail = new THREE.Mesh(new THREE.TorusGeometry(FENCE_R, 0.035, 8, 96), y > 0.5 ? glow : post);
    rail.rotation.x = Math.PI / 2; rail.position.y = y; fence.add(rail);
  }
  fence.position.set(crystal.position.x, ground(crystal), crystal.position.z);
  api.world.add(fence);
}
window.__worldsCollide = (nx, nz) => {
  if (mySeat && seatAt[mySeat]) return [seatAt[mySeat].x, seatAt[mySeat].z]; // seated: stay in the chair
  for (let pass = 0; pass < 2; pass++) {
    for (const c of circles) {
      const dx = nx - c.x, dz = nz - c.z, d = Math.hypot(dx, dz);
      if (d < c.r) { if (d > 1e-4) { nx = c.x + (dx / d) * c.r; nz = c.z + (dz / d) * c.r; } else nx = c.x + c.r; }
    }
    for (const b of boxes) {
      const dx = nx - b.x, dz = nz - b.z;
      const lx = dx * b.c - dz * b.s, lz = dx * b.s + dz * b.c;
      if (Math.abs(lx) < b.hx && Math.abs(lz) < b.hz) {
        let ux = lx, uz = lz;
        if (b.hx - Math.abs(lx) < b.hz - Math.abs(lz)) ux = (lx < 0 ? -1 : 1) * b.hx; else uz = (lz < 0 ? -1 : 1) * b.hz;
        nx = b.x + ux * b.c + uz * b.s; nz = b.z - ux * b.s + uz * b.c;
      }
    }
    for (const w of walls) {
      if (nx > w.x0 && nx < w.x1 && nz > w.z0 && nz < w.z1) {
        const left = nx - w.x0, right = w.x1 - nx;
        nx = left < right ? w.x0 : w.x1;
      }
    }
  }
  return [nx, nz];
};

// ---------- dancing ----------
// Step onto the dance floor and your ghost dances: it hops to the beat, sways side to side,
// and swings round. Everyone sees everyone's dance, since each ghost's
// position is already shared; stepping off eases back to floating.
const FLOOR = api.get('dance-floor');
const onFloor = (x, z) => !!FLOOR && Math.abs(x - FLOOR.position.x) < 3.4 && Math.abs(z - FLOOR.position.z) < 3.4;
const meDance = { w: 0 };
let meLift = 0;
function danceStep(d, on, dt) { d.w += ((on ? 1 : 0) - d.w) * (1 - Math.exp(-dt * 6)); return d.w < 0.01 ? 0 : d.w; }
function applyDance(inner, w, seed = 0) {
  if (!w) { inner.rotation.set(0, 0, 0); inner.scale.set(1, 1, 1); return; }
  const beat = (window.__party && window.__party.playing) ? 1 : 0.8;
  const ph = t * 7 * beat + seed;
  inner.rotation.z = Math.sin(ph * 0.5) * 0.35 * w;
  inner.rotation.x = Math.sin(ph) * 0.08 * w;
  inner.rotation.y = Math.sin(t * 1.3 + seed) * 0.9 * w;
  const sq = 1 + Math.sin(ph + 1.5) * 0.07 * w;
  inner.scale.set(1 / sq, sq, 1 / sq);
}

api.onUpdate((dt) => {
  t += dt;
  updateDrinks(dt);
  steerCamera(dt);
  if (meInner) {
    const w = danceStep(meDance, me && onFloor(me.position.x, me.position.z), dt);
    fitBridgeWalls();
    const want = mySeat ? 0.4 : me ? deckLift(me.position.x, me.position.y, me.position.z) : 0;
    meLift += (want - meLift) * Math.min(1, dt * 14);
    meInner.position.y = meBase + 0.08 + meLift + Math.sin(t * 2.2) * 0.06 * (1 - w) + w * Math.abs(Math.sin(t * 7)) * 0.22;
    applyDance(meInner, w);
  }
  for (const o of others.values()) {
    if (o.seated) { o.root.position.lerp(o.target, 1 - Math.exp(-dt * 8)); o.buf.length = 0; }
    else playback(o, dt);
    let r = o.yaw - o.root.rotation.y; r = Math.atan2(Math.sin(r), Math.cos(r));
    o.root.rotation.y += r * Math.min(1, dt * 12);
    const w = danceStep(o.dance || (o.dance = { w: 0 }), onFloor(o.target.x, o.target.z), dt);
    o.lift = (o.lift || 0) + ((o.seated ? 0.4 : deckLift(o.root.position.x, o.root.position.y, o.root.position.z)) - (o.lift || 0)) * Math.min(1, dt * 14);
    o.inner.position.y = 0.06 + o.lift + Math.sin(t * 2.2 + o.root.id) * 0.045 * (1 - w) + w * Math.abs(Math.sin(t * 7 + o.root.id)) * 0.22;
    applyDance(o.inner, w, o.root.id);
  }
  if (swirl.length) {
    const cafeTaken = [...takenSeats].some((k) => k.startsWith('cafe:'));
    swirlLevel += ((cafeTaken ? 1 : 0) - swirlLevel) * Math.min(1, dt * 3);
    for (const l of swirl) {
      const prev = l.a; l.a += dt * l.w;
      l.sp.visible = swirlLevel > 0.02;
      if (l.k < 0 || Math.floor(prev * 1.2) !== Math.floor(l.a * 1.2)) { l.k = Math.floor(Math.random() * swirlTex.length); l.sp.material.map = swirlTex[l.k]; }
      const wob = 1 + Math.sin(t * 1.5 + l.ph) * 0.06;
      l.sp.position.set(TABLE_LOCAL[0] + Math.cos(l.a) * 1.75 * wob, 0.55 + l.h * 1.5 + Math.sin(t * 1.2 + l.ph) * 0.15, TABLE_LOCAL[1] + Math.sin(l.a) * 0.88 * wob);
      l.sp.scale.setScalar(0.34 + 0.06 * Math.sin(t * 2 + l.ph));
      l.sp.material.opacity = swirlLevel * (0.75 + 0.25 * Math.sin(t * 1.7 + l.ph));
    }
  }
  for (const d of displayAt.values()) { d.icon.position.y = 1.35 + Math.sin(t * 1.6 + d.slot) * 0.06; d.icon.rotation.y = Math.sin(t * 0.8 + d.slot) * 0.35; }
  iconRing.rotation.y = t * 0.25;
  for (const s of iconRing.children) s.position.y = Math.sin(t * 1.6 + s.userData.phase * 3) * 0.18;
  const now = performance.now();
  for (const [pid, b] of bubbles) if (now > b.until) { b.holder.remove(b.sprite); bubbles.delete(pid); }
  if (me) {
    const p = me.position, r = me.object.rotation.y;
    if (now - lastSent > 200) {
      const cur = [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2), +r.toFixed(2)];
      if (!sent || cur.some((v, i) => Math.abs(v - sent[i]) > 0.04)) { sent = cur; post({ type: 'worlds:pos', x: cur[0], y: cur[1], z: cur[2], r: cur[3] }); }
      lastSent = now;
    }
    if (mySeat && seatAt[mySeat]) { const s = seatAt[mySeat]; me.position.x = s.x; me.position.z = s.z; me.object.rotation.y = s.yaw; }
    const stand = STANDS.find(([, s, r]) => Math.hypot(p.x - s.position.x, p.z - s.position.z) < r);
    const near = mySeat ? null : (seatNear(p) || displayNear(p) || (stand ? stand[0] : null));
    if (near !== nearStand) { nearStand = near; post({ type: 'worlds:near', near }); }
  }
});
`
