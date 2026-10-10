// The 3D ghost library: parses the bundled models once, then builds a ghost
// dressed in a profile's outfit. Shared by the plaza, the customizer and the
// portrait renderer so a person looks the same everywhere.
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { LOGO, MODELS } from './models.js'

export const SLOTS = ['face', 'hat', 'neck', 'hold']
export const OPTION_LABELS = {
  face: { dots: 'Friendly', mystery: 'Mystery ?', happy: 'Happy', sleepy: 'Sleepy', starry: 'Starry' },
  hat: { none: 'None', mobius_cap: 'Möbius cap', beanie: 'Beanie', crown: 'Crown', party: 'Party hat', headphones: 'Headphones', mobius_halo: 'Möbius halo' },
  neck: { none: 'None', mobius_scarf: 'Möbius scarf', bowtie: 'Bow tie', lanyard: 'Hackaton lanyard' },
  hold: { none: 'Nothing', mobius_mug: 'Möbius mug', tote: 'Möbius tote', pencil: 'Logo pencil', balloon: 'Möbius balloon' },
}
export const MERCH = new Set(['mobius_cap', 'mobius_halo', 'mobius_scarf', 'lanyard', 'mobius_mug', 'tote', 'pencil', 'balloon'])

let library = null

function decode(b64) {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes.buffer
}

function loadLogo() {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const texture = new THREE.Texture(img)
      texture.colorSpace = THREE.SRGBColorSpace
      texture.needsUpdate = true
      resolve(texture)
    }
    img.onerror = () => resolve(null)
    img.src = LOGO
  })
}

// Parse every model once; later calls share the same promise.
export function loadLibrary() {
  if (library) return library
  library = (async () => {
    const loader = new GLTFLoader()
    const logo = await loadLogo()
    const scenes = {}
    await Promise.all(Object.entries(MODELS).map(([name, b64]) => new Promise((resolve, reject) => {
      loader.parse(decode(b64), '', (gltf) => { scenes[name] = gltf.scene; resolve() }, reject)
    })))
    for (const [name, scene] of Object.entries(scenes)) {
      scene.traverse((o) => {
        if (!o.isMesh) return
        const m = o.material
        // glTF treats an unspecified metalness as fully metallic; with no
        // environment map that renders Kenney's props black. They are matte.
        if (name.startsWith('k_') && m) { m.metalness = 0; m.roughness = 0.9 }
        if (m?.name === 'Logo' && logo) {
          o.material = m.clone()
          o.material.map = logo
          o.material.transparent = true
          o.material.alphaTest = 0.05
          o.material.color.set('#ffffff')
        }
        if (m?.name === 'Glow') { m.emissiveIntensity = 1.4 }
      })
    }
    return { scenes, logo }
  })()
  return library
}

export function cloneModel(lib, name) {
  const src = lib.scenes[name]
  return src ? src.clone(true) : null
}

// A ghost group: `root` bobs and turns; `update(profile)` re-dresses it.
export function makeGhost(lib) {
  const root = new THREE.Group()
  const body = cloneModel(lib, 'ghost')
  const tint = new THREE.Color()
  const bodyMaterials = []
  body.traverse((o) => {
    if (o.isMesh && o.material?.name === 'Body') {
      o.material = o.material.clone()
      bodyMaterials.push(o.material)
    }
    if (o.isMesh && o.material?.name === 'Sheen') {
      o.material = o.material.clone()
      o.material.transparent = true
      o.material.opacity = 0.55
    }
  })
  root.add(body)
  const worn = {}
  let current = {}
  function update(profile) {
    if (profile.color !== current.color) {
      tint.set(profile.color || '#c8cdd6')
      for (const m of bodyMaterials) {
        m.color.copy(tint)
        m.transparent = true
        m.opacity = 0.94
      }
    }
    for (const slot of SLOTS) {
      const value = profile[slot] || (slot === 'face' ? 'dots' : 'none')
      if (value === current[slot]) continue
      if (worn[slot]) { root.remove(worn[slot]); worn[slot] = null }
      if (value !== 'none') {
        const piece = cloneModel(lib, `${slot}_${value}`)
        if (piece) { root.add(piece); worn[slot] = piece }
      }
    }
    current = { ...profile }
  }
  return { root, update }
}

// Small still portraits of a ghost (for the 2D games and lists), cached per outfit.
const portraits = new Map()
let portraitRenderer = null
let portraitScene = null
let portraitCamera = null

export function portraitKey(p) {
  return [p.color, p.face, p.hat, p.neck, p.hold].join('|')
}

export async function portrait(profile, size = 192) {
  const key = `${portraitKey(profile)}@${size}`
  if (portraits.has(key)) return portraits.get(key)
  const job = (async () => {
    const lib = await loadLibrary()
    if (!portraitRenderer) {
      portraitRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
      portraitRenderer.setPixelRatio(1)
      portraitRenderer.outputColorSpace = THREE.SRGBColorSpace
      portraitScene = new THREE.Scene()
      portraitScene.add(new THREE.HemisphereLight('#ffffff', '#b9a8d8', 2.2))
      const sun = new THREE.DirectionalLight('#ffffff', 1.6)
      sun.position.set(2, 4, 5)
      portraitScene.add(sun)
      portraitCamera = new THREE.PerspectiveCamera(30, 1, 0.1, 20)
      portraitCamera.position.set(0.35, 0.95, 3.4)
      portraitCamera.lookAt(0, 0.62, 0)
    }
    portraitRenderer.setSize(size, size, false)
    const ghost = makeGhost(lib)
    ghost.update(profile)
    ghost.root.rotation.y = -0.18
    portraitScene.add(ghost.root)
    portraitRenderer.render(portraitScene, portraitCamera)
    portraitScene.remove(ghost.root)
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    canvas.getContext('2d').drawImage(portraitRenderer.domElement, 0, 0)
    return canvas
  })()
  portraits.set(key, job)
  return job
}
