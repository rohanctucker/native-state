import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

import {
  ACCESSION, AF_ENTRY, UNIPROT, UNIPROT_ENTRY, UserError,
  fetchStructure, fetchUniprot, fetchWikipedia,
  summaryText, buildFacts, buildMarks, firstSentences, plainLocations, organismLine, isUncharacterized,
} from './data.js';
import { assignSecondary, Ribbon, Atoms, ELEMENTS, patchWobble } from './geometry.js';
import { COLLECTIONS, CREATURES, collectionItems, surpriseCandidates, heldList, recordHeld } from './explore.js';
import { Camera, HAND_LINKS } from './hands.js';
import { exportGLB, loadModelViewer } from './ar.js';
import { FEATURED } from './proteins.js';

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const BANDS = [
  { name: 'Very high', range: '90+', css: '#0053D6', glow: '#4A8DFF', solid: '#2463DB', boost: 1.15, size: 2.3, sharp: 1.0, wobble: 0 },
  { name: 'Confident', range: '70–90', css: '#65CBF3', glow: '#65CBF3', solid: '#65CBF3', boost: 1.0, size: 2.9, sharp: 0.8, wobble: 0.25 },
  { name: 'Low', range: '50–70', css: '#FFDB13', glow: '#FFDB13', solid: '#FFDB13', boost: 0.9, size: 5.2, sharp: 0.35, wobble: 1.0 },
  { name: 'Very low', range: 'under 50', css: '#FF7D45', glow: '#FF7D45', solid: '#FF7D45', boost: 0.95, size: 7.2, sharp: 0.1, wobble: 1.7 },
];
const bandOf = (p) => (p >= 90 ? 0 : p >= 70 ? 1 : p >= 50 ? 2 : 3);
const bandWord = ['very high', 'confident', 'low', 'very low'];

const AMINO = {
  ALA: ['A', 'Alanine'], ARG: ['R', 'Arginine'], ASN: ['N', 'Asparagine'], ASP: ['D', 'Aspartate'],
  CYS: ['C', 'Cysteine'], GLN: ['Q', 'Glutamine'], GLU: ['E', 'Glutamate'], GLY: ['G', 'Glycine'],
  HIS: ['H', 'Histidine'], ILE: ['I', 'Isoleucine'], LEU: ['L', 'Leucine'], LYS: ['K', 'Lysine'],
  MET: ['M', 'Methionine'], PHE: ['F', 'Phenylalanine'], PRO: ['P', 'Proline'], SER: ['S', 'Serine'],
  THR: ['T', 'Threonine'], TRP: ['W', 'Tryptophan'], TYR: ['Y', 'Tyrosine'], VAL: ['V', 'Valine'],
  SEC: ['U', 'Selenocysteine'], PYL: ['O', 'Pyrrolysine'],
};

const PAGE_DX = 3.8;
const PAGE_DY = { glow: 7.2, ribbon: 8.5, atoms: 13 };
const INK_LINEAR = new THREE.Color('#071629');
const FONT_LABEL = '"Sofia Sans Condensed", "Arial Narrow", sans-serif';
const FONT_MONO = '"Atkinson Hyperlegible Mono", ui-monospace, monospace';

/* ------------------------------------------------------------------ */
/* DOM                                                                 */
/* ------------------------------------------------------------------ */

const $ = (s) => document.querySelector(s);
const canvas = $('#scene');
const overlay = $('#overlay');
const octx = overlay.getContext('2d');
const ui = {
  header: $('.top'), dock: $('#dock'), specimen: $('#specimen'), side: $('#side'),
  status: $('#status'), name: $('#name'), meta: $('#meta'), summary: $('#summary'),
  barMini: $('#bar-mini'), bar: $('#bar'), legend: $('#legend'), elements: $('#elements'),
  keyConf: $('#key-conf'), keyAtoms: $('#key-atoms'),
  surprise: $('#surprise'), exploreOpen: $('#explore-open'), detailsOpen: $('#details-open'),
  viewOpen: $('#view-open'), viewClose: $('#view-close'),
  look: $('#look'), cams: $('#cams'), unfold: $('#unfold'), arOpen: $('#ar-open'),
  hint: $('#hint'), sr: $('#sr'), toast: $('#toast'),
  fact: $('#fact'), factTitle: $('#fact-title'), factCount: $('#fact-count'), factBody: $('#fact-body'), factSource: $('#fact-source'),
  search: $('#search'), searchToggle: $('#search-toggle'), form: $('#search-form'), q: $('#q'), results: $('#results'),
  explore: $('#explore'), exploreSurprise: $('#explore-surprise'), collections: $('#collections'),
  held: $('#held'), heldCount: $('#held-count'), heldList: $('#held-list'),
  details: $('#details'), detailsBody: $('#details-body'), detailsCredit: $('#details-credit'), share: $('#share'),
  intro: $('#intro'), introGo: $('#intro-go'), introSurprise: $('#intro-surprise'),
  ar: $('#ar'), arStage: $('#ar-stage'), arNote: $('#ar-note'),
  how: $('#how'), howOpen: $('#how-open'),
};

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = window.matchMedia('(pointer: coarse)').matches;
const narrow = () => innerWidth <= 760;

/* ------------------------------------------------------------------ */
/* Renderer                                                            */
/* ------------------------------------------------------------------ */

const DPR = Math.min(window.devicePixelRatio || 1, 2);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(DPR);
renderer.setClearColor(0x000000, 0);
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x000000, 50, 200);
const camera = new THREE.PerspectiveCamera(35, 1, 0.5, 20000);
scene.add(camera);
const TAN_HALF = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));

// Studio lighting for the solid looks. The lights ride with the camera, so the model is always well lit.
const pmrem = new THREE.PMREMGenerator(renderer);
const envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
const keyLight = new THREE.DirectionalLight(0xffffff, 1.5);
keyLight.position.set(-1.2, 1.6, 2.2);
const rimLight = new THREE.DirectionalLight(0xA8C8FF, 1.1);
rimLight.position.set(1.4, -0.6, -1.6);
camera.add(keyLight, rimLight);

const BackgroundShader = {
  uniforms: {
    tDiffuse: { value: null },
    uVideo: { value: null },
    uHas: { value: 0 },
    uMirror: { value: 1 },
    uDuotone: { value: 1 },
    uSolid: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uVid: { value: new THREE.Vector2(1, 1) },
    uInk: { value: new THREE.Color('#0A1F3A') },
    uShadow: { value: new THREE.Color('#04101F') },
    uSteel: { value: new THREE.Color('#4F6F96') },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse, uVideo;
    uniform float uHas, uMirror, uDuotone, uSolid;
    uniform vec2 uRes, uVid;
    uniform vec3 uInk, uShadow, uSteel;
    varying vec2 vUv;
    void main() {
      vec2 d = vUv - 0.5;
      d.x *= uRes.x / uRes.y;
      float vig = 1.0 - smoothstep(0.25, 1.15, length(d));
      vec3 col = mix(uShadow, uInk, 0.45 + 0.55 * vig);
      if (uHas > 0.5) {
        vec2 px = vec2(vUv.x * uRes.x, (1.0 - vUv.y) * uRes.y);
        float s = max(uRes.x / uVid.x, uRes.y / uVid.y);
        vec2 size = uVid * s;
        vec2 off = (uRes - size) * 0.5;
        float sx = mix(px.x, uRes.x - px.x, uMirror);
        vec2 t = vec2((sx - off.x) / size.x, (px.y - off.y) / size.y);
        vec3 v = texture2D(uVideo, vec2(t.x, 1.0 - t.y)).rgb;
        float l = sqrt(dot(v, vec3(0.2126, 0.7152, 0.0722)));
        vec3 duo = mix(uShadow, uSteel, smoothstep(0.06, 0.92, l));
        vec3 natural = v * 0.82;
        col = mix(natural, duo, uDuotone) * (0.82 + 0.18 * vig);
      }
      vec4 fg = texture2D(tDiffuse, vUv);
      vec3 solid = col * (1.0 - fg.a) + fg.rgb;
      vec3 glow = col + fg.rgb;
      gl_FragColor = vec4(mix(glow, solid, uSolid), 1.0);
    }
  `,
};

const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, target);
const mainPass = new RenderPass(scene, camera);
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.62, 0.5, 0.18);
const bgPass = new ShaderPass(BackgroundShader);
const bgU = bgPass.uniforms;
composer.addPass(mainPass);
composer.addPass(bloom);
composer.addPass(bgPass);
composer.addPass(new OutputPass());

// Glow look: points with soft falloff.
const pointMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  uniforms: { uScale: { value: 400 }, uFogNear: { value: 50 }, uFogFar: { value: 200 } },
  vertexShader: /* glsl */`
    attribute vec3 aColor; attribute float aSize; attribute float aSharp;
    uniform float uScale, uFogNear, uFogFar;
    varying vec3 vColor; varying float vSharp; varying float vFog;
    void main() {
      vColor = aColor; vSharp = aSharp;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mv;
      gl_PointSize = aSize * uScale / -mv.z;
      vFog = 1.0 - smoothstep(uFogNear, uFogFar, -mv.z);
    }`,
  fragmentShader: /* glsl */`
    varying vec3 vColor; varying float vSharp; varying float vFog;
    void main() {
      vec2 c = gl_PointCoord - 0.5;
      float r2 = dot(c, c) * 4.0;
      if (r2 > 1.0) discard;
      float a = exp(-r2 * mix(2.6, 10.0, vSharp)) * mix(0.42, 1.0, vSharp) * vFog;
      gl_FragColor = vec4(vColor * a, a);
    }`,
});

// Solid looks share wobble uniforms.
const wobble = { uTime: { value: 0 }, uWob: { value: 1 } };
const ribbonMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.0, envMapIntensity: 0.9 });
patchWobble(ribbonMat, wobble);
const atomMat = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.0, envMapIntensity: 0.8 });
patchWobble(atomMat, wobble);

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

let W = innerWidth;
let H = innerHeight;
let free = { top: 0, bottom: H, h: H, cy: H / 2 };
let P = null;
let loadToken = 0;
let style = 'ribbon';
try { style = localStorage.getItem('native-state.style') || 'ribbon'; } catch { /* private mode */ }
if (!['ribbon', 'atoms', 'glow'].includes(style)) style = 'ribbon';

const qUser = new THREE.Quaternion();
const qIdentity = new THREE.Quaternion();
const qTmp = new THREE.Quaternion();
const AX = new THREE.Vector3(1, 0, 0);
const AY = new THREE.Vector3(0, 1, 0);
const spin = { x: 0, y: 0 };
const pan = new THREE.Vector2();
let zoom = 1;
let camDist = 120;
let lastInteract = 0;
let userActed = false;
let lastMoveAt = 0;
let time = 0;
const unfold = { value: 0, target: 0, vel: 0, source: null };
let lastE = -1;
let refoldNoticeShown = false;
let letterHintShown = false;
let picked = null;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const touchedNow = () => { lastInteract = performance.now(); };
const acted = () => { userActed = true; touchedNow(); };
const fmt = (n) => Math.round(n).toLocaleString();

/* ------------------------------------------------------------------ */
/* Status, hints, toasts                                               */
/* ------------------------------------------------------------------ */

function setStatus(text, kind = '', retry = null) {
  ui.status.className = `status ${kind}`;
  ui.status.textContent = text;
  ui.status.hidden = !text;
  if (retry) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = 'Try again';
    b.addEventListener('click', retry);
    ui.status.append(' ', b);
  }
}

let hintTimer = 0;
function showHint(text, ms = 6000) {
  ui.hint.textContent = text;
  ui.hint.classList.toggle('on', !!text);
  clearTimeout(hintTimer);
  if (text && ms) hintTimer = setTimeout(() => ui.hint.classList.remove('on'), ms);
}
let hintHidden = false;
function hideHintSoon() {
  if (hintHidden) return;
  hintHidden = true;
  setTimeout(() => ui.hint.classList.remove('on'), 400);
}

let toastTimer = 0;
function toast(text) {
  ui.toast.textContent = text;
  ui.toast.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.remove('on'), 2200);
}

/* ------------------------------------------------------------------ */
/* Building a protein                                                  */
/* ------------------------------------------------------------------ */

function orientBasis(xyz, n, landscape) {
  const cov = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    const x = xyz[i * 3], y = xyz[i * 3 + 1], z = xyz[i * 3 + 2];
    cov[0] += x * x; cov[1] += x * y; cov[2] += x * z; cov[3] += y * y; cov[4] += y * z; cov[5] += z * z;
  }
  const mul = (v) => [
    cov[0] * v[0] + cov[1] * v[1] + cov[2] * v[2],
    cov[1] * v[0] + cov[3] * v[1] + cov[4] * v[2],
    cov[2] * v[0] + cov[4] * v[1] + cov[5] * v[2],
  ];
  const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  let a = norm([1, 0.3, 0.2]);
  for (let k = 0; k < 40; k++) a = norm(mul(a));
  let b = norm([0.2, 1, 0.4]);
  for (let k = 0; k < 40; k++) {
    b = mul(b);
    const d = b[0] * a[0] + b[1] * a[1] + b[2] * a[2];
    b = norm([b[0] - d * a[0], b[1] - d * a[1], b[2] - d * a[2]]);
  }
  const c = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  return landscape ? [a, b, c] : [b, a, [-c[0], -c[1], -c[2]]];
}

function buildProtein(acc, data, feat) {
  const { residues, entry } = data;
  const n = residues.length;
  let cx = 0, cy = 0, cz = 0;
  for (const r of residues) { cx += r.ca[0]; cy += r.ca[1]; cz += r.ca[2]; }
  cx /= n; cy /= n; cz /= n;
  const raw = new Float32Array(n * 3);
  residues.forEach((r, i) => { raw[i * 3] = r.ca[0] - cx; raw[i * 3 + 1] = r.ca[1] - cy; raw[i * 3 + 2] = r.ca[2] - cz; });
  const [ex, ey, ez] = orientBasis(raw, n, W >= free.h);
  const rot = (x, y, z, out, o) => {
    out[o] = x * ex[0] + y * ex[1] + z * ex[2];
    out[o + 1] = x * ey[0] + y * ey[1] + z * ey[2];
    out[o + 2] = x * ez[0] + y * ez[1] + z * ez[2];
  };
  const folded = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) rot(raw[i * 3], raw[i * 3 + 1], raw[i * 3 + 2], folded, i * 3);

  // Atoms, as offsets from their residue's CA, in the same rotated frame.
  const atoms = [];
  const tmp = new Float32Array(3);
  residues.forEach((r, i) => {
    for (const a of r.atoms) {
      rot(a.x - cx, a.y - cy, a.z - cz, tmp, 0);
      atoms.push({ res: i, el: ELEMENTS[a.el] ? a.el : 'X', rel: [tmp[0] - folded[i * 3], tmp[1] - folded[i * 3 + 1], tmp[2] - folded[i * 3 + 2]] });
    }
  });

  const dists = new Float32Array(n);
  for (let i = 0; i < n; i++) dists[i] = Math.hypot(folded[i * 3], folded[i * 3 + 1], folded[i * 3 + 2]);
  const sorted = Float32Array.from(dists).sort();
  const radius = Math.max(8, sorted[Math.floor((n - 1) * 0.93)] * 1.05);

  const plddt = new Float32Array(n);
  const band = new Uint8Array(n);
  const amp = new Float32Array(n);
  const counts = [0, 0, 0, 0];
  let seq = '';
  let sum = 0;
  residues.forEach((r, i) => {
    const p = Number.isFinite(r.b) ? r.b : 0;
    plddt[i] = p;
    sum += p;
    band[i] = bandOf(p);
    counts[band[i]]++;
    amp[i] = reducedMotion ? 0 : BANDS[band[i]].wobble;
    seq += (AMINO[r.res] || ['X'])[0];
  });

  const group = new THREE.Group();
  scene.add(group);
  const prot = {
    acc, feat, entry, residues, n, first: residues[0].num, seq, folded, atoms, radius,
    page: new Float32Array(n * 3), base: new Float32Array(folded), cur: new Float32Array(folded),
    plddt, band, amp, counts, mean: sum / n,
    ss: null, glow: null, ribbon: null, atomsRep: null, group,
    info: null, wiki: null, facts: [], marks: [],
    reveal: reducedMotion ? 1 : 0, bornAt: performance.now(),
    screenBox: { minX: 0, maxX: 0, minY: 0, maxY: 0 },
  };
  prot.marks = buildMarks({ prot, info: null, feat });
  prot.facts = buildFacts({ prot, info: null, wiki: null, feat });
  return prot;
}

function ensureGlow(prot) {
  if (prot.glow) return prot.glow;
  const { n, band, folded } = prot;
  const SUB = 4;
  const M = (n - 1) * SUB + 1;
  const color = new THREE.Color();
  const lineColor = new Float32Array(M * 3);
  for (let k = 0; k < M; k++) {
    const B = BANDS[band[Math.min(n - 1, Math.round(k / SUB))]];
    color.set(B.glow).multiplyScalar(B.boost * 0.85);
    lineColor.set([color.r, color.g, color.b], k * 3);
  }
  const smooth = new Float32Array(M * 3);
  catmull(folded, n, smooth, SUB);
  const lineGeo = new LineGeometry();
  lineGeo.setPositions(smooth);
  lineGeo.setColors(lineColor);
  const lineMat = new LineMaterial({ linewidth: coarse ? 2.0 : 2.4, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending });
  lineMat.fog = true;
  const line = new Line2(lineGeo, lineMat);
  line.frustumCulled = false;

  const pc = new Float32Array(n * 3);
  const ps = new Float32Array(n);
  const sh = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const B = BANDS[band[i]];
    color.set(B.glow).multiplyScalar(B.boost);
    pc.set([color.r, color.g, color.b], i * 3);
    ps[i] = B.size;
    sh[i] = B.sharp;
  }
  const pointGeo = new THREE.BufferGeometry();
  pointGeo.setAttribute('position', new THREE.BufferAttribute(prot.cur, 3));
  pointGeo.setAttribute('aColor', new THREE.BufferAttribute(pc, 3));
  pointGeo.setAttribute('aSize', new THREE.BufferAttribute(ps, 1));
  pointGeo.setAttribute('aSharp', new THREE.BufferAttribute(sh, 1));
  const points = new THREE.Points(pointGeo, pointMat);
  points.frustumCulled = false;
  const obj = new THREE.Group();
  obj.add(line, points);
  prot.group.add(obj);
  prot.glow = { obj, line, lineGeo, lineMat, segBuf: lineGeo.attributes.instanceStart.data, points, pointGeo, smooth, M, SUB };
  return prot.glow;
}

function ensureRibbon(prot) {
  if (prot.ribbon) return prot.ribbon;
  prot.ss = prot.ss || assignSecondary(prot.folded, prot.n);
  // Darken buried residues a little: baked ambient occlusion.
  const ao = burialCA(prot.folded, prot.n);
  const colors = new Float32Array(prot.n * 3);
  const c = new THREE.Color();
  for (let i = 0; i < prot.n; i++) {
    c.set(BANDS[prot.band[i]].solid).multiplyScalar(ao[i]);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  const ribbon = new Ribbon(prot.n, prot.ss, colors, prot.amp);
  ribbon.update(prot.base, 0);
  const mesh = new THREE.Mesh(ribbon.geometry, ribbonMat);
  mesh.frustumCulled = false;
  prot.group.add(mesh);
  prot.ribbon = { ribbon, mesh };
  return prot.ribbon;
}

function burialCA(xyz, n) {
  const out = new Float32Array(n);
  const r2 = 12 * 12;
  for (let i = 0; i < n; i++) {
    let c = 0;
    for (let j = 0; j < n; j++) {
      const dx = xyz[j * 3] - xyz[i * 3], dy = xyz[j * 3 + 1] - xyz[i * 3 + 1], dz = xyz[j * 3 + 2] - xyz[i * 3 + 2];
      if (dx * dx + dy * dy + dz * dz < r2) c++;
    }
    out[i] = c;
  }
  const s = Float32Array.from(out).sort();
  const lo = s[Math.floor(n * 0.1)];
  const hi = s[Math.floor(n * 0.95)] || lo + 1;
  for (let i = 0; i < n; i++) out[i] = 1 - 0.42 * smoothstep(lo, Math.max(lo + 1, hi), out[i]);
  return out;
}

function ensureAtoms(prot) {
  if (prot.atomsRep) return prot.atomsRep;
  const rep = new Atoms(prot.atoms, prot.folded, prot.amp, atomMat);
  rep.update(prot.base);
  prot.group.add(rep.mesh);
  prot.atomsRep = rep;
  return rep;
}

function disposeProtein(prot) {
  if (!prot) return;
  scene.remove(prot.group);
  if (prot.glow) { prot.glow.lineGeo.dispose(); prot.glow.lineMat.dispose(); prot.glow.pointGeo.dispose(); }
  if (prot.ribbon) prot.ribbon.ribbon.dispose();
  if (prot.atomsRep) prot.atomsRep.dispose();
}

function catmull(src, n, out, SUB) {
  let o = 0;
  for (let i = 0; i < n - 1; i++) {
    const i0 = (i > 0 ? i - 1 : 0) * 3, i1 = i * 3, i2 = (i + 1) * 3, i3 = (i + 2 < n ? i + 2 : n - 1) * 3;
    for (let s = 0; s < SUB; s++) {
      const t = s / SUB, t2 = t * t, t3 = t2 * t;
      for (let k = 0; k < 3; k++) {
        const p0 = src[i0 + k], p1 = src[i1 + k], p2 = src[i2 + k], p3 = src[i3 + k];
        out[o++] = 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (3 * p1 - p0 - 3 * p2 + p3) * t3);
      }
    }
  }
  out[o++] = src[(n - 1) * 3];
  out[o++] = src[(n - 1) * 3 + 1];
  out[o] = src[(n - 1) * 3 + 2];
}

// Unfolded layout: the chain snakes back and forth in rows, like lines of text.
function layoutPage(prot) {
  const n = prot.n;
  const dy = PAGE_DY[style];
  const fw = Math.max(200, W * 0.9);
  const fh = Math.max(160, free.h * 0.82);
  let cols = Math.round(Math.sqrt((n * (fw / fh) * dy) / PAGE_DX));
  cols = clamp(cols, 6, Math.max(6, Math.floor(fw / 11)));
  cols = Math.min(cols, n);
  const rows = Math.ceil(n / cols);
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const col = r % 2 === 0 ? c : cols - 1 - c;
    prot.page[i * 3] = (col - (cols - 1) / 2) * PAGE_DX;
    prot.page[i * 3 + 1] = ((rows - 1) / 2 - r) * dy;
    prot.page[i * 3 + 2] = 0;
  }
  prot.cols = cols;
  prot.rows = rows;
  prot.pageDY = dy;
  prot.pageHalfW = ((cols - 1) / 2) * PAGE_DX + PAGE_DX * 2;
  prot.pageHalfH = ((rows - 1) / 2) * dy + dy;
  lastE = -1;
}

/* ------------------------------------------------------------------ */
/* Looks                                                               */
/* ------------------------------------------------------------------ */

function applyStyle() {
  for (const b of ui.look.querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.style === style));
  const solid = style !== 'glow';
  bloom.enabled = !solid;
  bgU.uSolid.value = solid ? 1 : 0;
  bgU.uDuotone.value = solid ? 0 : 1;
  renderer.toneMapping = solid ? THREE.NeutralToneMapping : THREE.NoToneMapping;
  scene.environment = solid ? envMap : null;
  scene.fog = solid ? (cam.on ? null : new THREE.Fog(INK_LINEAR, 50, 200)) : new THREE.Fog(0x000000, 50, 200);
  ui.keyConf.hidden = style === 'atoms';
  ui.keyAtoms.hidden = style !== 'atoms';
  if (P) {
    if (style === 'glow') ensureGlow(P);
    if (style === 'ribbon') ensureRibbon(P);
    if (style === 'atoms') ensureAtoms(P);
    if (P.glow) P.glow.obj.visible = style === 'glow';
    if (P.ribbon) P.ribbon.mesh.visible = style === 'ribbon';
    if (P.atomsRep) P.atomsRep.mesh.visible = style === 'atoms';
    layoutPage(P);
  }
  try { localStorage.setItem('native-state.style', style); } catch { /* ignore */ }
}

ui.look.addEventListener('click', (ev) => {
  const b = ev.target.closest('button[data-style]');
  if (!b || b.dataset.style === style) return;
  style = b.dataset.style;
  applyStyle();
  acted();
});

function buildElementKey() {
  ui.elements.replaceChildren(...['C', 'O', 'N', 'S'].map((el) => {
    const li = document.createElement('li');
    const sw = document.createElement('span');
    sw.className = 'sw';
    sw.style.background = ELEMENTS[el].color;
    const name = document.createElement('span');
    name.textContent = ELEMENTS[el].name;
    li.append(sw, name);
    return li;
  }));
}

/* ------------------------------------------------------------------ */
/* Loading                                                             */
/* ------------------------------------------------------------------ */

async function loadProtein(accRaw, { quiet = false, label = null } = {}) {
  const acc = accRaw.toUpperCase();
  const token = ++loadToken;
  const feat = FEATURED.find((f) => f.id === acc);
  setStatus(`Loading ${label || (feat ? feat.short : acc)} from AlphaFold DB`, 'busy');
  try {
    const data = await fetchStructure(acc);
    if (token !== loadToken) return false;
    const prot = buildProtein(acc, data, feat);
    disposeProtein(P);
    P = prot;
    qUser.setFromEuler(new THREE.Euler(-0.3, 0.45, 0, 'YXZ'));
    spin.x = spin.y = 0;
    unfold.value = unfold.target = unfold.vel = 0;
    unfold.source = null;
    zoom = 1;
    pan.set(0, 0);
    picked = null;
    fact.i = -1;
    hideFact(true);
    applyStyle();
    camDist = fitDistance(0) * 1.15;
    P.bornAt = performance.now();
    renderInfo();
    setStatus('');
    touchedNow();
    if (location.hash.slice(1).toUpperCase() !== acc) history.replaceState(null, '', `#${acc}`);
    recordHeld({ acc, name: titleOf(P), organism: organismShort(P) });

    fetchUniprot(acc).then((info) => {
      if (P?.acc !== acc || !info) return;
      P.info = info;
      refreshKnowledge();
    });
    fetchWikipedia(acc).then((wiki) => {
      if (P?.acc !== acc || !wiki) return;
      P.wiki = wiki;
      refreshKnowledge();
    });
    return true;
  } catch (err) {
    if (token !== loadToken) return false;
    if (quiet) return false;
    const msg = err instanceof UserError ? err.message : 'Couldn’t reach AlphaFold DB. Check your connection and try again.';
    setStatus(msg, 'error', err instanceof UserError ? null : () => loadProtein(acc));
    if (!P) { ui.name.textContent = feat ? feat.title : acc; ui.meta.textContent = ''; ui.summary.textContent = ''; }
    return false;
  }
}

let surprising = false;
async function surprise() {
  if (surprising) return;
  surprising = true;
  ui.surprise.disabled = true;
  ui.exploreSurprise.disabled = true;
  setStatus('Finding a protein', 'busy');
  try {
    const { label, items } = await surpriseCandidates();
    const pool = items.filter((i) => !P || i.acc !== P.acc);
    let ok = false;
    for (const item of pool) {
      ok = await loadProtein(item.acc, { quiet: true, label: `${item.name}` });
      if (ok) {
        toast(`From ${label}`);
        break;
      }
    }
    if (!ok) setStatus('Couldn’t find one just now. Try again.', 'error', surprise);
  } finally {
    surprising = false;
    ui.surprise.disabled = false;
    ui.exploreSurprise.disabled = false;
  }
}

function titleOf(prot) {
  if (prot.feat) return prot.feat.title;
  return prot.info?.name || prot.entry.uniprotDescription || prot.acc;
}

function organismShort(prot) {
  if (prot.feat) return prot.feat.organism;
  const o = prot.info?.organism;
  if (o?.common) return `${o.common[0].toUpperCase()}${o.common.slice(1)} (${o.scientific})`;
  return o?.scientific || prot.entry.organismScientificName || '';
}

/* ------------------------------------------------------------------ */
/* Info panel, facts and details                                       */
/* ------------------------------------------------------------------ */

function renderInfo() {
  const prot = P;
  const title = titleOf(prot);
  ui.name.textContent = title;
  const org = organismShort(prot);
  ui.meta.textContent = `${org ? `${org}, ` : ''}${fmt(prot.n)} amino acids`;
  ui.meta.append(document.createElement('br'));
  const link = document.createElement('a');
  link.href = AF_ENTRY + prot.acc;
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = `${prot.acc} on AlphaFold DB`;
  ui.meta.append(link);
  ui.summary.textContent = summaryText({ info: prot.info, wiki: prot.wiki, feat: prot.feat }) || '';
  document.title = `${title} | Native State`;
  canvas.setAttribute('aria-label', `3D model of ${title}. Drag or use arrow keys to turn it.`);

  for (const bar of [ui.bar, ui.barMini]) {
    bar.replaceChildren(...prot.counts.map((c, b) => {
      const seg = document.createElement('span');
      seg.style.background = BANDS[b].css;
      seg.style.flex = `${c} 1 0`;
      if (!c) seg.style.display = 'none';
      return seg;
    }));
  }
  ui.legend.replaceChildren(...prot.counts.map((c, b) => {
    const li = document.createElement('li');
    const sw = document.createElement('span');
    sw.className = 'sw';
    sw.style.background = BANDS[b].css;
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = `${BANDS[b].name} `;
    const range = document.createElement('span');
    range.className = 'range';
    range.textContent = BANDS[b].range;
    name.append(range);
    const pct = document.createElement('span');
    pct.className = 'pct';
    pct.textContent = `${Math.round((100 * c) / prot.n)}%`;
    li.append(sw, name, pct);
    return li;
  }));
  const breakdown = prot.counts.map((c, b) => `${Math.round((100 * c) / prot.n)}% ${bandWord[b]}`).join(', ');
  ui.bar.setAttribute('aria-label', `Confidence: ${breakdown}. Average ${Math.round(prot.mean)} out of 100.`);
  if (ui.details.open) renderDetails();
  requestAnimationFrame(measureFree);
}

function refreshKnowledge() {
  P.marks = buildMarks({ prot: P, info: P.info, feat: P.feat });
  P.facts = buildFacts({ prot: P, info: P.info, wiki: P.wiki, feat: P.feat });
  if (fact.i >= P.facts.length) fact.i = P.facts.length - 1;
  renderInfo();
  if (!P.feat) recordHeld({ acc: P.acc, name: titleOf(P), organism: organismShort(P) });
}

const fact = { i: -1, shownAt: 0, holding: false, timer: 0, visible: false };

function grabStart() {
  if (!P || !P.facts.length) return;
  fact.holding = true;
  clearTimeout(fact.timer);
  const now = performance.now();
  if (!fact.visible || now - fact.shownAt > 1400) nextFact();
}

function grabEnd() {
  if (!fact.holding) return;
  fact.holding = false;
  clearTimeout(fact.timer);
  fact.timer = setTimeout(() => hideFact(), 6000);
}

function nextFact() {
  if (!P || !P.facts.length) return;
  fact.i = (fact.i + 1) % P.facts.length;
  const f = P.facts[fact.i];
  ui.factTitle.textContent = f.title;
  ui.factCount.textContent = `${fact.i + 1} of ${P.facts.length}`;
  ui.factBody.textContent = f.body;
  ui.factSource.textContent = `Source: ${f.source}`;
  ui.fact.hidden = false;
  fact.visible = true;
  fact.shownAt = performance.now();
  positionFact();
  requestAnimationFrame(() => ui.fact.classList.add('on'));
}

function hideFact(now = false) {
  fact.visible = false;
  ui.fact.classList.remove('on');
  if (now) ui.fact.hidden = true;
  else setTimeout(() => { if (!fact.visible) ui.fact.hidden = true; }, 300);
}

ui.fact.addEventListener('click', () => {
  nextFact();
  clearTimeout(fact.timer);
  fact.timer = setTimeout(() => hideFact(), 8000);
});

function positionFact() {
  if (!fact.visible || !P) return;
  const cw = ui.fact.offsetWidth || 320;
  const ch = ui.fact.offsetHeight || 140;
  const pad = 16;
  let x;
  let y;
  if (narrow()) {
    x = (W - cw) / 2;
    y = free.top + 2;
  } else {
    const box = P.screenBox;
    const roomR = W - pad - box.maxX;
    const roomL = box.minX - pad;
    if (roomR >= cw + 24 || roomR >= roomL) x = Math.min(W - pad - cw, Math.max(box.maxX + 24, W * 0.5 + 40));
    else x = Math.max(pad, box.minX - 24 - cw);
    y = clamp(box.minY, free.top + 6, free.bottom - ch - 6);
  }
  ui.fact.style.left = `${Math.round(x)}px`;
  ui.fact.style.top = `${Math.round(y)}px`;
}

function section(title, body, source) {
  const frag = document.createDocumentFragment();
  const h = document.createElement('h3');
  h.textContent = title;
  frag.append(h);
  if (typeof body === 'string') {
    const p = document.createElement('p');
    p.textContent = body;
    frag.append(p);
  } else {
    frag.append(body);
  }
  if (source) {
    const s = document.createElement('p');
    s.className = 'source';
    s.textContent = `Source: ${source}`;
    frag.append(s);
  }
  return frag;
}

function list(items) {
  const ul = document.createElement('ul');
  for (const t of items) {
    const li = document.createElement('li');
    li.textContent = t;
    ul.append(li);
  }
  return ul;
}

function renderDetails() {
  if (!P) return;
  const { info, wiki, feat } = P;
  const body = ui.detailsBody;
  body.replaceChildren();
  const h = document.createElement('p');
  h.className = 'details-title';
  const name = document.createElement('strong');
  name.textContent = titleOf(P);
  h.append(name);
  body.append(h);

  if (feat) body.append(section('Why it’s famous', feat.fact));
  if (info && isUncharacterized(info)) body.append(section('Never studied', 'No scientist has studied this protein yet. AlphaFold predicted its shape anyway, from its sequence alone.', 'UniProt'));
  if (wiki) body.append(section('In short', firstSentences(wiki.extract, 4, 600), 'Wikipedia'));
  if (info?.functions?.length) body.append(section('What it does', info.functions.slice(0, 2).map((t) => firstSentences(t, 4, 520)).join(' '), 'UniProt'));
  if (info?.locations?.length || info?.tissue) {
    const where = info.locations.length ? `It works ${plainLocations(info.locations).join(' and ')}.` : '';
    body.append(section('Where it works', `${where} ${info.tissue ? firstSentences(info.tissue, 2, 300) : ''}`.trim(), 'UniProt'));
  }
  if (info?.diseases?.length) body.append(section('Linked to', list(info.diseases.slice(0, 10)), 'UniProt'));
  if (info?.drugs?.length) body.append(section('Medicines and compounds that act on it', list(info.drugs.slice(0, 12)), 'DrugBank, via UniProt'));
  if (info) {
    body.append(section('Seen in a lab', info.pdbCount
      ? `Its real shape has been measured ${fmt(info.pdbCount)} ${info.pdbCount === 1 ? 'time' : 'times'} and shared in the Protein Data Bank.`
      : 'No one has measured its shape in a lab. This AlphaFold prediction is the best look anyone has.', 'UniProt'));
  }
  const sizeFact = P.facts.find((f) => f.title === 'How big it is');
  if (sizeFact) body.append(section('How big it is', sizeFact.body));
  const org = organismLine(info?.organism);
  if (org) body.append(section('Who makes it', org, 'UniProt'));
  const sure = Math.round((100 * (P.counts[0] + P.counts[1])) / P.n);
  body.append(section('How sure AlphaFold is', `Confident about ${sure}% of the chain. Average confidence ${Math.round(P.mean)} out of 100.`, 'AlphaFold DB'));

  const links = document.createElement('p');
  const mk = (href, text) => { const a = document.createElement('a'); a.href = href; a.target = '_blank'; a.rel = 'noopener'; a.textContent = text; return a; };
  links.append(mk(UNIPROT_ENTRY + P.acc, 'UniProt entry'), document.createTextNode(', '), mk(AF_ENTRY + P.acc, 'AlphaFold DB entry'));
  if (wiki) links.append(document.createTextNode(', '), mk(wiki.url, 'Wikipedia article'));
  body.append(section('Read more', links));
  if (!info) body.append(section('More details', 'Still loading from UniProt, or UniProt is unreachable right now.'));
  ui.detailsCredit.textContent = `Structure from AlphaFold DB (CC BY 4.0). Annotations from UniProt (CC BY 4.0)${wiki ? '. Summary from Wikipedia (CC BY-SA 4.0)' : ''}.`;
}

ui.detailsOpen.addEventListener('click', () => { renderDetails(); ui.details.showModal(); });
ui.summary.addEventListener('click', () => { if (narrow()) { renderDetails(); ui.details.showModal(); } });

ui.share.addEventListener('click', async () => {
  if (!P) return;
  const url = `${location.origin}${location.pathname}#${P.acc}`;
  const title = `${titleOf(P)} on Native State`;
  if (navigator.share) {
    try { await navigator.share({ title, text: `Hold ${titleOf(P)} in your hands.`, url }); return; } catch (err) { if (err.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { toast(url); }
});

/* ------------------------------------------------------------------ */
/* Explore                                                             */
/* ------------------------------------------------------------------ */

function itemButton(item) {
  const li = document.createElement('li');
  const b = document.createElement('button');
  b.type = 'button';
  const s = document.createElement('strong');
  s.textContent = item.name;
  const sp = document.createElement('span');
  sp.textContent = [item.organism, item.length ? `${fmt(item.length)} amino acids` : ''].filter(Boolean).join(', ');
  b.append(s, sp);
  b.addEventListener('click', () => {
    ui.explore.close();
    if (P?.acc === item.acc) return;
    location.hash = item.acc;
  });
  li.append(b);
  return li;
}

function buildExplore() {
  ui.collections.replaceChildren(...COLLECTIONS.map((col) => {
    const wrap = document.createElement('div');
    wrap.className = 'collection';
    const head = document.createElement('button');
    head.type = 'button';
    head.setAttribute('aria-expanded', 'false');
    const t = document.createElement('strong');
    t.textContent = col.title;
    const bl = document.createElement('span');
    bl.textContent = col.blurb;
    head.append(t, bl);
    const body = document.createElement('div');
    body.className = 'collection-body';
    body.hidden = true;
    const items = document.createElement('ul');
    items.className = 'items';
    let creature = CREATURES[0];
    const chips = document.createElement('div');
    if (col.creatures) {
      chips.className = 'chips';
      chips.replaceChildren(...CREATURES.map((c) => {
        const cb = document.createElement('button');
        cb.type = 'button';
        cb.textContent = c.name;
        cb.setAttribute('aria-pressed', String(c === creature));
        cb.addEventListener('click', () => {
          creature = c;
          for (const x of chips.children) x.setAttribute('aria-pressed', String(x === cb));
          fill();
        });
        return cb;
      }));
      body.append(chips);
    }
    body.append(items);
    const tools = document.createElement('div');
    tools.className = 'collection-tools';
    if (!col.famous) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'link-button';
      more.textContent = 'Show different ones';
      more.addEventListener('click', fill);
      tools.append(more);
      body.append(tools);
    }
    let token = 0;
    async function fill() {
      const my = ++token;
      const note = document.createElement('li');
      note.className = 'note';
      note.textContent = 'Loading from UniProt';
      items.replaceChildren(note);
      try {
        const list2 = await collectionItems(col, { creature });
        if (my !== token) return;
        if (!list2.length) {
          note.textContent = 'Nothing came back this time. Try different ones.';
          return;
        }
        items.replaceChildren(...list2.map(itemButton));
      } catch {
        if (my !== token) return;
        note.textContent = 'UniProt isn’t responding. Try again in a moment.';
      }
    }
    head.addEventListener('click', () => {
      const open = body.hidden;
      body.hidden = !open;
      head.setAttribute('aria-expanded', String(open));
      if (open && !items.children.length) fill();
    });
    wrap.append(head, body);
    return wrap;
  }));
}

function renderHeld() {
  const list2 = heldList();
  ui.held.hidden = !list2.length;
  ui.heldCount.textContent = `${fmt(list2.length)} so far, out of more than 200 million.`;
  ui.heldList.replaceChildren(...list2.slice(0, 30).map((h) => itemButton({ acc: h.acc, name: h.name, organism: h.organism })));
}

ui.exploreOpen.addEventListener('click', () => { renderHeld(); ui.explore.showModal(); });
ui.exploreSurprise.addEventListener('click', () => { ui.explore.close(); surprise(); });
ui.surprise.addEventListener('click', () => surprise());
for (const d of [ui.explore, ui.details, ui.how, ui.ar]) {
  d.addEventListener('click', (ev) => { if (ev.target === d) d.close(); });
}
ui.howOpen.addEventListener('click', () => ui.how.showModal());

/* ------------------------------------------------------------------ */
/* View sheet (phones)                                                 */
/* ------------------------------------------------------------------ */

function setViewSheet(open) {
  ui.side.classList.toggle('open', open);
  ui.viewOpen.setAttribute('aria-expanded', String(open));
  if (open) prepareAR();
}
ui.viewOpen.addEventListener('click', () => setViewSheet(!ui.side.classList.contains('open')));
ui.viewClose.addEventListener('click', () => setViewSheet(false));

/* ------------------------------------------------------------------ */
/* Layout                                                              */
/* ------------------------------------------------------------------ */

function measureFree() {
  W = innerWidth;
  H = innerHeight;
  const top = ui.header.getBoundingClientRect().bottom + 12;
  const spec = ui.specimen.getBoundingClientRect();
  const side = ui.side.getBoundingClientRect();
  const sideVisible = !narrow();
  const dockTop = sideVisible ? Math.min(spec.top, side.top) : spec.top;
  let bottom = dockTop - 16;
  if (bottom - top < H * 0.3) bottom = Math.min(H, top + H * 0.3);
  free = { top, bottom, h: bottom - top, cy: (top + bottom) / 2 };
  camera.aspect = W / H;
  camera.setViewOffset(W, H, 0, H / 2 - free.cy, W, H);
  camera.updateProjectionMatrix();
  const gap = side.left - spec.right;
  if (sideVisible && gap >= 280) {
    ui.hint.style.left = `${(spec.right + side.left) / 2}px`;
    ui.hint.style.bottom = `${H - spec.bottom + 6}px`;
    ui.hint.style.maxWidth = `${gap - 32}px`;
  } else {
    ui.hint.style.left = `${W / 2}px`;
    ui.hint.style.bottom = `${H - dockTop + 10}px`;
    ui.hint.style.maxWidth = '';
  }
  if (P) layoutPage(P);
}

function resize() {
  W = innerWidth;
  H = innerHeight;
  renderer.setSize(W, H, false);
  composer.setSize(W, H);
  overlay.width = Math.round(W * DPR);
  overlay.height = Math.round(H * DPR);
  octx.setTransform(DPR, 0, 0, DPR, 0, 0);
  bgU.uRes.value.set(W, H);
  pointMat.uniforms.uScale.value = (H * DPR * 0.5) / TAN_HALF;
  measureFree();
}

function fitDistance(e) {
  if (!P) return 120;
  const r = style === 'atoms' ? P.radius + 2.5 : P.radius;
  const hx = lerp(r, P.pageHalfW, e);
  const hy = lerp(r, P.pageHalfH, e);
  const dV = (hy * H) / (2 * TAN_HALF * free.h * 0.46);
  const dH = (hx * H) / (2 * TAN_HALF * W * 0.44);
  return Math.max(dV, dH, 20);
}

/* ------------------------------------------------------------------ */
/* Per frame                                                           */
/* ------------------------------------------------------------------ */

function rotateBy(ay, ax) {
  qTmp.setFromAxisAngle(AY, ay);
  qUser.premultiply(qTmp);
  qTmp.setFromAxisAngle(AX, ax);
  qUser.premultiply(qTmp);
}

function updateUnfold(dt) {
  if (unfold.source) {
    unfold.value = lerp(unfold.value, unfold.target, 1 - Math.exp(-dt * 18));
    unfold.vel = 0;
  } else {
    const k = reducedMotion ? 90 : 48;
    const damp = reducedMotion ? 18 : 7.5;
    unfold.vel += (unfold.target - unfold.value) * k * dt;
    unfold.vel *= Math.exp(-damp * dt);
    unfold.value += unfold.vel * dt;
    if (Math.abs(unfold.value) < 0.0005 && Math.abs(unfold.vel) < 0.001) unfold.value = unfold.vel = 0;
  }
}

function updateRotation(dt, e) {
  const holding = pointers.size > 0 || hands.one.active;
  if (e < 0.98 && !holding) {
    rotateBy(spin.y * dt, spin.x * dt);
    const decay = Math.exp(-dt * 2.6);
    spin.x *= decay;
    spin.y *= decay;
    if (performance.now() - lastInteract > 2600 && !reducedMotion && e < 0.02) rotateBy(0.14 * dt, 0);
  }
  if (holding && performance.now() - lastMoveAt > 90) { spin.x = 0; spin.y = 0; }
  if (e < 0.5) pan.multiplyScalar(Math.exp(-dt * 6));
}

function updateModel(e, now) {
  const { n, folded, page, base, cur, amp } = P;
  const changed = Math.abs(e - lastE) > 1e-5;
  if (changed) {
    for (let j = 0; j < n * 3; j++) base[j] = folded[j] + (page[j] - folded[j]) * e;
    lastE = e;
  }
  const w = reducedMotion ? 0 : 1 - e;
  for (let i = 0; i < n; i++) {
    const j = i * 3;
    const a = amp[i] * w;
    if (a > 0) {
      cur[j] = base[j] + a * Math.sin(time * 0.9 + i * 0.37);
      cur[j + 1] = base[j + 1] + a * Math.sin(time * 1.13 + i * 0.51 + 1.7);
      cur[j + 2] = base[j + 2] + a * Math.sin(time * 0.77 + i * 0.29 + 3.1);
    } else {
      cur[j] = base[j]; cur[j + 1] = base[j + 1]; cur[j + 2] = base[j + 2];
    }
  }
  wobble.uTime.value = time;
  wobble.uWob.value = w;

  const rv = P.reveal;
  if (style === 'glow' && P.glow) {
    const g = P.glow;
    catmull(cur, n, g.smooth, g.SUB);
    const s = g.smooth;
    const seg = g.segBuf.array;
    for (let k = 0, M = g.M - 1; k < M; k++) {
      const a = k * 3, b = k * 6;
      seg[b] = s[a]; seg[b + 1] = s[a + 1]; seg[b + 2] = s[a + 2];
      seg[b + 3] = s[a + 3]; seg[b + 4] = s[a + 4]; seg[b + 5] = s[a + 5];
    }
    g.segBuf.needsUpdate = true;
    g.pointGeo.attributes.position.needsUpdate = true;
    g.lineGeo.instanceCount = Math.max(1, Math.floor((g.M - 1) * rv));
    g.pointGeo.setDrawRange(0, Math.max(1, Math.ceil(n * rv)));
  }
  if (style === 'ribbon' && P.ribbon) {
    const r = P.ribbon.ribbon;
    if (changed || P.ribbon.lastE !== lastE) { r.update(base, e); P.ribbon.lastE = lastE; }
    r.geometry.setDrawRange(0, Math.floor((r.R - 1) * rv) * r.rs * 6);
  }
  if (style === 'atoms' && P.atomsRep) {
    const a = P.atomsRep;
    if (changed || a.lastE !== lastE) { a.update(base); a.lastE = lastE; }
    a.mesh.count = Math.max(1, Math.floor(a.count * rv));
  }
  P.group.quaternion.slerpQuaternions(qUser, qIdentity, e);
}

function updateCamera(dt, e) {
  const t = fitDistance(e) / zoom;
  camDist = reducedMotion ? t : lerp(camDist, t, 1 - Math.exp(-dt * 5));
  camera.position.set(pan.x, pan.y, camDist);
  camera.lookAt(pan.x, pan.y, 0);
  if (scene.fog) {
    const r = lerp(P ? P.radius : 30, P ? Math.max(P.pageHalfW, P.pageHalfH) * 0.3 : 30, e);
    const solid = style !== 'glow';
    scene.fog.near = camDist - r * (solid ? 0.1 : 0.4);
    scene.fog.far = camDist + r * (solid ? 3.4 : 2.2);
    pointMat.uniforms.uFogNear.value = scene.fog.near;
    pointMat.uniforms.uFogFar.value = scene.fog.far;
  }
}

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  time += dt;
  updateHands(now);
  updateUnfold(dt);
  const e = ease(clamp(unfold.value, 0, 1));
  syncSlider();
  updateRotation(dt, e);
  if (P) {
    if (P.reveal < 1) P.reveal = Math.min(1, (now - P.bornAt) / 1500);
    updateModel(e, now);
  }
  updateCamera(dt, e);
  composer.render();
  drawOverlay(e);
  if (fact.visible) positionFact();
}

/* ------------------------------------------------------------------ */
/* Overlay drawing                                                     */
/* ------------------------------------------------------------------ */

const v3 = new THREE.Vector3();
function project(i, out) {
  v3.set(P.cur[i * 3], P.cur[i * 3 + 1], P.cur[i * 3 + 2]).applyMatrix4(P.group.matrixWorld).project(camera);
  out.x = (v3.x + 1) * 0.5 * W;
  out.y = (1 - v3.y) * 0.5 * H;
  out.z = v3.z;
  return out;
}

function screenBox() {
  const box = P.screenBox;
  box.minX = box.minY = Infinity;
  box.maxX = box.maxY = -Infinity;
  const step = Math.max(1, Math.floor(P.n / 240));
  const s = {};
  for (let i = 0; i < P.n; i += step) {
    project(i, s);
    if (s.x < box.minX) box.minX = s.x;
    if (s.x > box.maxX) box.maxX = s.x;
    if (s.y < box.minY) box.minY = s.y;
    if (s.y > box.maxY) box.maxY = s.y;
  }
  const grow = style === 'atoms' ? 14 : style === 'ribbon' ? 6 : 0;
  box.minX -= grow; box.maxX += grow; box.minY -= grow; box.maxY += grow;
  return box;
}

function drawOverlay(e) {
  octx.clearRect(0, 0, W, H);
  if (P) {
    P.group.updateMatrixWorld();
    const box = screenBox();
    let labelAlpha = (1 - smoothstep(0.05, 0.35, e)) * smoothstep(0.75, 1, P.reveal);
    if (fact.visible && narrow()) labelAlpha *= 0.3;
    if (labelAlpha > 0.01) drawLabels(box, labelAlpha);
    const seqAlpha = smoothstep(0.82, 1, e);
    if (seqAlpha > 0.01) drawSequence(seqAlpha);
    if (picked && performance.now() < picked.until) drawPicked();
  }
  if (cam.on) drawHands();
}

function drawLabels(box, alpha) {
  const fontSize = W < 600 ? 13 : 15;
  octx.font = `500 ${fontSize}px ${FONT_LABEL}`;
  const items = [];
  const s = {};
  for (const m of P.marks) {
    let x = 0, y = 0, k = 0;
    for (let i = m.a; i <= m.b; i += Math.max(1, Math.floor((m.b - m.a) / 20))) { project(i, s); x += s.x; y += s.y; k++; }
    x /= k; y /= k;
    if (!Number.isFinite(x)) continue;
    items.push({ text: m.text, ax: x, ay: y, w: octx.measureText(m.text).width });
  }
  const cx = (box.minX + box.maxX) / 2;
  const gap = W < 600 ? 12 : 26;
  // Keep labels clear of the fact card on wide screens.
  const factRect = fact.visible && !narrow() ? ui.fact.getBoundingClientRect() : null;
  for (const it of items) {
    it.side = it.ax < cx ? -1 : 1;
    const leftCol = box.minX - gap;
    const rightCol = box.maxX + gap;
    const roomL = leftCol - 8 - it.w >= 10;
    const roomR = rightCol + 8 + it.w <= W - 10 && !(factRect && factRect.left < rightCol + it.w + 8);
    if (it.side < 0 && !roomL && roomR) it.side = 1;
    else if (it.side > 0 && !roomR && roomL) it.side = -1;
    it.colX = it.side < 0 ? Math.max(leftCol, 10 + it.w + 8) : Math.min(rightCol, W - 10 - it.w - 8);
  }
  const step = fontSize + 10;
  for (const side of [-1, 1]) {
    const col = items.filter((i) => i.side === side).sort((a, b) => a.ay - b.ay);
    let y = free.top + 8;
    for (const it of col) { it.y = Math.max(it.ay, y); y = it.y + step; }
    let maxY = free.bottom - 6;
    for (let k = col.length - 1; k >= 0; k--) { if (col[k].y > maxY) col[k].y = maxY; maxY = col[k].y - step; }
  }
  octx.save();
  octx.globalAlpha = alpha;
  octx.lineWidth = 1;
  octx.strokeStyle = 'rgba(230, 237, 243, 0.6)';
  octx.fillStyle = '#E6EDF3';
  octx.textBaseline = 'middle';
  for (const it of items) {
    octx.beginPath();
    octx.moveTo(it.ax, it.ay);
    octx.lineTo(it.colX, it.y);
    octx.lineTo(it.colX + it.side * 4, it.y);
    octx.stroke();
    octx.beginPath();
    octx.arc(it.ax, it.ay, 2.5, 0, Math.PI * 2);
    octx.fill();
  }
  octx.shadowColor = 'rgba(4, 16, 31, 0.95)';
  octx.shadowBlur = 8;
  for (const it of items) {
    octx.textAlign = it.side < 0 ? 'right' : 'left';
    octx.fillText(it.text, it.colX + it.side * 8, it.y);
  }
  octx.restore();
}

function drawSequence(alpha) {
  const pxPerUnit = (H * 0.5) / (camDist * TAN_HALF);
  const size = Math.min(20, PAGE_DX * pxPerUnit * 0.66);
  if (size < 6.5) {
    if (alpha > 0.9 && !letterHintShown) {
      letterHintShown = true;
      const held = unfold.source === 'slider';
      showHint(coarse
        ? (held ? 'The letters are too small at this size. Pinch to zoom in, drag to move around.' : 'The letters are too small at this size. Set Unfold all the way, then pinch to zoom in.')
        : 'The letters are too small at this size. Scroll to zoom in, drag to move around.', 6000);
    }
    return;
  }
  const lift = P.pageDY * pxPerUnit * (style === 'atoms' ? 0.5 : 0.42);
  const s = {};
  octx.save();
  octx.globalAlpha = alpha;
  octx.font = `500 ${size}px ${FONT_MONO}`;
  octx.textAlign = 'center';
  octx.textBaseline = 'middle';
  octx.shadowColor = 'rgba(4, 16, 31, 0.9)';
  octx.shadowBlur = style === 'glow' ? 0 : 4;
  for (let i = 0; i < P.n; i++) {
    project(i, s);
    if (s.x < -20 || s.x > W + 20 || s.y < -20 || s.y > H + 20) continue;
    octx.fillStyle = style === 'atoms' ? '#E6EDF3' : BANDS[P.band[i]].glow;
    octx.fillText(P.seq[i], s.x, s.y - lift);
  }
  if (size >= 10) {
    octx.font = `500 ${Math.max(10, size * 0.62)}px ${FONT_LABEL}`;
    octx.fillStyle = 'rgba(169, 188, 208, 0.9)';
    for (let r = 0; r < P.rows; r++) {
      const i = r * P.cols;
      if (i >= P.n) break;
      project(i, s);
      const ltr = r % 2 === 0;
      octx.textAlign = ltr ? 'right' : 'left';
      octx.fillText(String(P.residues[i].num), s.x + (ltr ? -size : size), s.y - lift);
    }
  }
  octx.restore();
}

function drawPicked() {
  const i = picked.index;
  const s = project(i, {});
  const r = P.residues[i];
  const name = (AMINO[r.res] || ['X', r.res])[1];
  const text = `${name} ${r.num}, confidence ${Math.round(P.plddt[i])}`;
  const fontSize = W < 600 ? 14 : 16;
  octx.save();
  octx.font = `600 ${fontSize}px ${FONT_LABEL}`;
  const w = octx.measureText(text).width;
  const toRight = s.x + 40 + w < W - 12;
  const lx = toRight ? s.x + 34 : s.x - 34;
  const ly = Math.max(free.top + 12, s.y - 34);
  octx.strokeStyle = '#E6EDF3';
  octx.lineWidth = 1.5;
  octx.beginPath();
  octx.arc(s.x, s.y, 9, 0, Math.PI * 2);
  octx.stroke();
  octx.lineWidth = 1;
  octx.beginPath();
  octx.moveTo(s.x + (toRight ? 6.5 : -6.5), s.y - 6.5);
  octx.lineTo(lx, ly);
  octx.stroke();
  octx.fillStyle = '#E6EDF3';
  octx.textAlign = toRight ? 'left' : 'right';
  octx.textBaseline = 'middle';
  octx.shadowColor = 'rgba(4, 16, 31, 0.95)';
  octx.shadowBlur = 8;
  octx.fillText(text, lx + (toRight ? 6 : -6), ly);
  octx.restore();
}

/* ------------------------------------------------------------------ */
/* Pointer, touch and keyboard                                         */
/* ------------------------------------------------------------------ */

const pointers = new Map();
let pinch0 = null;
let dragMoved = 0;
let hadMulti = false;
let grabTimer = 0;
let grabbing = false;

function startGrab() {
  if (grabbing) return;
  grabbing = true;
  grabStart();
}
function endGrab() {
  clearTimeout(grabTimer);
  if (!grabbing) return;
  grabbing = false;
  grabEnd();
}

canvas.addEventListener('pointerdown', (ev) => {
  canvas.setPointerCapture(ev.pointerId);
  pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  if (pointers.size === 1) {
    dragMoved = 0;
    hadMulti = false;
    clearTimeout(grabTimer);
    grabTimer = setTimeout(startGrab, 260);
  }
  spin.x = spin.y = 0;
  acted();
  if (narrow() && ui.side.classList.contains('open')) setViewSheet(false);
  if (pointers.size === 2) { hadMulti = true; startPinch(); startGrab(); }
});

canvas.addEventListener('pointermove', (ev) => {
  const p = pointers.get(ev.pointerId);
  if (!p) return;
  const dx = ev.clientX - p.x;
  const dy = ev.clientY - p.y;
  p.x = ev.clientX;
  p.y = ev.clientY;
  lastMoveAt = performance.now();
  touchedNow();
  if (pointers.size === 1) {
    dragMoved += Math.abs(dx) + Math.abs(dy);
    if (dragMoved > 6) startGrab();
    if (pageMode()) {
      panBy(dx, dy);
    } else {
      const k = (Math.PI * 2.2) / Math.min(W, 900);
      rotateBy(dx * k, dy * k);
      spin.y = lerp(spin.y, (dx * k) / 0.016, 0.5);
      spin.x = lerp(spin.x, (dy * k) / 0.016, 0.5);
    }
  } else if (pointers.size === 2 && pinch0) {
    const d = pointerDistance();
    if (pinch0.mode === 'zoom') {
      zoom = clamp(pinch0.zoom * (d / pinch0.d), 0.6, 6);
    } else {
      unfold.source = 'gesture';
      unfold.target = clamp(pinch0.u + (d - pinch0.d) / (0.45 * Math.min(W, H)), 0, 1);
      hideHintSoon();
    }
  }
});

function endPointer(ev) {
  if (!pointers.has(ev.pointerId)) return;
  pointers.delete(ev.pointerId);
  if (pointers.size < 2 && pinch0) {
    if (pinch0.mode === 'unfold' && unfold.source === 'gesture') releaseUnfold();
    pinch0 = null;
  }
  if (pointers.size === 0) {
    endGrab();
    if (!hadMulti && dragMoved < 6 && ev.type === 'pointerup') pickAt(ev.clientX, ev.clientY);
  }
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

function pointerDistance() {
  const [a, b] = [...pointers.values()];
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function startPinch() {
  const holdingPage = unfold.source === 'slider' && unfold.value > 0.97;
  pinch0 = holdingPage ? { mode: 'zoom', d: pointerDistance(), zoom } : { mode: 'unfold', d: pointerDistance(), u: unfold.value };
}

const pageMode = () => unfold.value > 0.97;

function panBy(dx, dy) {
  const unitsPerPx = (2 * camDist * TAN_HALF) / H;
  pan.x -= dx * unitsPerPx;
  pan.y += dy * unitsPerPx;
  if (P) {
    pan.x = clamp(pan.x, -P.pageHalfW, P.pageHalfW);
    pan.y = clamp(pan.y, -P.pageHalfH, P.pageHalfH);
  }
}

function releaseUnfold() {
  unfold.source = null;
  unfold.target = 0;
  if (!refoldNoticeShown && unfold.value > 0.3) {
    refoldNoticeShown = true;
    showHint('Let go and it folds back by itself.', 3500);
  }
}

canvas.addEventListener('wheel', (ev) => {
  ev.preventDefault();
  zoom = clamp(zoom * Math.exp(-ev.deltaY * 0.0015), 0.6, 6);
  acted();
}, { passive: false });

canvas.addEventListener('keydown', (ev) => {
  const step = 0.18;
  const keys = {
    ArrowLeft: () => rotateBy(-step, 0),
    ArrowRight: () => rotateBy(step, 0),
    ArrowUp: () => rotateBy(0, -step),
    ArrowDown: () => rotateBy(0, step),
    '+': () => { zoom = clamp(zoom * 1.15, 0.6, 6); },
    '=': () => { zoom = clamp(zoom * 1.15, 0.6, 6); },
    '-': () => { zoom = clamp(zoom / 1.15, 0.6, 6); },
    ' ': () => nextFact(),
  };
  if (keys[ev.key]) { ev.preventDefault(); keys[ev.key](); acted(); }
});

function pickAt(x, y) {
  if (!P || P.reveal < 1) return;
  const s = {};
  let best = -1;
  let bestD = 26 * 26;
  for (let i = 0; i < P.n; i++) {
    project(i, s);
    const d = (s.x - x) ** 2 + (s.y - y) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  if (best < 0) { picked = null; return; }
  picked = { index: best, until: performance.now() + 5000 };
  const r = P.residues[best];
  ui.sr.textContent = `${(AMINO[r.res] || ['X', r.res])[1]} ${r.num}, confidence ${Math.round(P.plddt[best])} out of 100.`;
}

ui.unfold.addEventListener('input', () => {
  const v = Number(ui.unfold.value) / 1000;
  unfold.target = v;
  unfold.source = v > 0 ? 'slider' : null;
  if (v === 0) unfold.vel = 0;
  ui.unfold.style.setProperty('--fill', `${v * 100}%`);
  hideHintSoon();
  acted();
});

function syncSlider() {
  const v = clamp(unfold.value, 0, 1);
  const iv = Math.round(v * 1000);
  if (Number(ui.unfold.value) !== iv && document.activeElement !== ui.unfold) {
    ui.unfold.value = String(iv);
    ui.unfold.style.setProperty('--fill', `${v * 100}%`);
  }
}

/* ------------------------------------------------------------------ */
/* Camera and hands                                                    */
/* ------------------------------------------------------------------ */

const cam = new Camera($('#cam'));
const hands = { list: [], pinch: new Map(), one: { active: false, key: null, x: 0, y: 0 }, two: { active: false, d0: 0, u0: 0 }, seenAt: 0 };
let videoTexture = null;

function setCamButtons(mode) {
  for (const b of ui.cams.querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.cam === mode));
}

ui.cams.addEventListener('click', async (ev) => {
  const b = ev.target.closest('button[data-cam]');
  if (!b) return;
  const mode = b.dataset.cam;
  if (mode === 'off') stopCamera();
  else await startCamera(mode);
});

async function startCamera(facing) {
  setStatus('Starting camera', 'busy');
  try {
    await cam.start(facing);
  } catch (err) {
    setCamButtons(cam.on ? cam.facing : 'off');
    const blocked = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
    setStatus(err?.name === 'NotSupportedError'
      ? 'This browser can’t use a camera here. You can still drag to turn the protein.'
      : blocked ? 'Camera access is blocked. Allow it in your browser’s site settings, or drag to turn the protein.'
        : facing === 'environment' ? 'Couldn’t open the back camera. Try Front.' : 'No camera found. You can still drag to turn the protein.', 'error');
    return;
  }
  setCamButtons(facing);
  if (!videoTexture) {
    videoTexture = new THREE.VideoTexture(cam.video);
    videoTexture.colorSpace = THREE.SRGBColorSpace;
  }
  bgU.uVideo.value = videoTexture;
  bgU.uVid.value.set(cam.video.videoWidth || 1280, cam.video.videoHeight || 720);
  bgU.uHas.value = 1;
  bgU.uMirror.value = cam.mirrored ? 1 : 0;
  applyStyle();
  if (await Camera.hasBackCamera()) ui.cams.querySelector('[data-cam="environment"]').hidden = false;

  if (!cam.landmarker) {
    setStatus('Loading hand tracking. The first time takes a few seconds.', 'busy');
    try {
      await cam.loadModel();
    } catch {
      setStatus('Hand tracking couldn’t load. Check your connection, or drag to turn the protein.', 'error');
      return;
    }
  }
  if (!cam.on) return;
  setStatus('');
  hands.seenAt = performance.now();
  showHint(facing === 'environment'
    ? 'Hold a hand up in front of the camera. Pinch to turn it, pinch with both hands and pull apart to unfold it.'
    : 'Raise a hand and pinch to turn it. Pinch with both hands and pull apart to unfold it.', 9000);
}

function stopCamera() {
  cam.stop();
  bgU.uHas.value = 0;
  bgU.uVideo.value = null;
  applyStyle();
  hands.list = [];
  if (hands.two.active && unfold.source === 'hands') releaseUnfold();
  hands.two.active = false;
  if (hands.one.active) endGrab();
  hands.one.active = false;
  setCamButtons('off');
  setStatus('');
  showHint('');
}

function videoToScreen(lm) {
  const vw = cam.video.videoWidth || 1280;
  const vh = cam.video.videoHeight || 720;
  const s = Math.max(W / vw, H / vh);
  const ox = (W - vw * s) / 2;
  const oy = (H - vh * s) / 2;
  const x = ox + lm.x * vw * s;
  return { x: cam.mirrored ? W - x : x, y: oy + lm.y * vh * s };
}

function updateHands(now) {
  const raw = cam.detect(now);
  if (!raw) return;
  if (cam.video.videoWidth && bgU.uVid.value.x !== cam.video.videoWidth) bgU.uVid.value.set(cam.video.videoWidth, cam.video.videoHeight);
  const list2 = raw.map(({ key, lms }) => {
    const pts = lms.map(videoToScreen);
    const size = Math.hypot(pts[0].x - pts[9].x, pts[0].y - pts[9].y) || 1;
    const gap = Math.hypot(pts[4].x - pts[8].x, pts[4].y - pts[8].y) / size;
    const was = hands.pinch.get(key) || false;
    const pinching = was ? gap < 0.48 : gap < 0.3;
    hands.pinch.set(key, pinching);
    return { key, pts, pinching, px: (pts[4].x + pts[8].x) / 2, py: (pts[4].y + pts[8].y) / 2 };
  });
  hands.list = list2;
  if (list2.length) { hands.seenAt = now; acted(); }
  else if (now - hands.seenAt > 5000 && !ui.hint.classList.contains('on')) {
    hands.seenAt = now;
    showHint('Hold a hand where the camera can see it.', 4000);
  }

  const pinching = list2.filter((h) => h.pinching);
  if (pinching.length >= 2) {
    const [a, b] = pinching;
    const d = Math.hypot(a.px - b.px, a.py - b.py);
    if (!hands.two.active) {
      hands.two = { active: true, d0: d, u0: unfold.value };
      hideHintSoon();
      startGrab();
    }
    unfold.source = 'hands';
    unfold.target = clamp(hands.two.u0 + (d - hands.two.d0) / (0.4 * W), 0, 1);
    hands.one.active = false;
    return;
  }
  if (hands.two.active) {
    hands.two.active = false;
    if (unfold.source === 'hands') releaseUnfold();
    if (!pinching.length) endGrab();
  }
  if (pinching.length === 1) {
    const h = pinching[0];
    if (hands.one.active && hands.one.key === h.key) {
      const dx = h.px - hands.one.x;
      const dy = h.py - hands.one.y;
      if (pageMode()) {
        panBy(dx, dy);
      } else {
        const k = (Math.PI * 2.6) / W;
        rotateBy(dx * k, dy * k);
        spin.y = lerp(spin.y, (dx * k) / 0.033, 0.4);
        spin.x = lerp(spin.x, (dy * k) / 0.033, 0.4);
        lastMoveAt = now;
      }
    } else {
      hideHintSoon();
      startGrab();
    }
    Object.assign(hands.one, { active: true, key: h.key, x: h.px, y: h.py });
  } else if (hands.one.active) {
    hands.one.active = false;
    endGrab();
  }
}

function drawHands() {
  if (!hands.list.length) return;
  octx.save();
  octx.lineWidth = 1.5;
  octx.lineCap = 'round';
  for (const h of hands.list) {
    octx.strokeStyle = 'rgba(230, 237, 243, 0.6)';
    octx.beginPath();
    for (const [a, b] of HAND_LINKS) { octx.moveTo(h.pts[a].x, h.pts[a].y); octx.lineTo(h.pts[b].x, h.pts[b].y); }
    octx.stroke();
    octx.fillStyle = 'rgba(230, 237, 243, 0.9)';
    for (const p of h.pts) { octx.beginPath(); octx.arc(p.x, p.y, 2.2, 0, Math.PI * 2); octx.fill(); }
    if (h.pinching) {
      octx.strokeStyle = '#E6EDF3';
      octx.lineWidth = 2;
      octx.beginPath();
      octx.arc(h.px, h.py, 16, 0, Math.PI * 2);
      octx.stroke();
      octx.lineWidth = 1.5;
    }
  }
  const pin = hands.list.filter((h) => h.pinching);
  if (hands.two.active && pin.length >= 2) {
    octx.setLineDash([4, 6]);
    octx.strokeStyle = 'rgba(230, 237, 243, 0.6)';
    octx.beginPath();
    octx.moveTo(pin[0].px, pin[0].py);
    octx.lineTo(pin[1].px, pin[1].py);
    octx.stroke();
  }
  octx.restore();
}

/* ------------------------------------------------------------------ */
/* See it in your room                                                 */
/* ------------------------------------------------------------------ */

let arState = { acc: null, url: null };

function prepareAR() {
  ui.arOpen.hidden = !coarse;
}

ui.arOpen.addEventListener('click', async () => {
  if (!P) return;
  ui.ar.showModal();
  const sizeNm = (P.radius * 2) / 10;
  const times = 0.3 / (sizeNm * 1e-9);
  ui.arNote.textContent = 'Building the model…';
  try {
    await loadModelViewer();
    if (arState.acc !== P.acc) {
      const tmp = new Ribbon(P.n, P.ss || (P.ss = assignSecondary(P.folded, P.n)), new Float32Array(P.n * 3), new Float32Array(P.n));
      tmp.update(P.folded, 0);
      if (arState.url) URL.revokeObjectURL(arState.url);
      arState = { acc: P.acc, url: await exportGLB({ ribbon: tmp, band: P.band, colors: BANDS.map((b) => b.solid), radius: P.radius }) };
      tmp.dispose();
    }
    ui.arStage.replaceChildren();
    const mv = document.createElement('model-viewer');
    mv.setAttribute('src', arState.url);
    mv.setAttribute('alt', `3D model of ${titleOf(P)}`);
    mv.setAttribute('ar', '');
    mv.setAttribute('ar-modes', 'webxr quick-look');
    mv.setAttribute('ar-scale', 'auto');
    mv.setAttribute('camera-controls', '');
    mv.setAttribute('auto-rotate', '');
    mv.setAttribute('shadow-intensity', '1');
    mv.setAttribute('environment-image', 'neutral');
    const btn = document.createElement('button');
    btn.slot = 'ar-button';
    btn.className = 'pill primary';
    btn.textContent = 'Place it in your room';
    btn.style.cssText = 'position:absolute;left:50%;bottom:12px;transform:translateX(-50%);';
    mv.append(btn);
    ui.arStage.append(mv);
    await new Promise((res) => { mv.addEventListener('load', res, { once: true }); setTimeout(res, 8000); });
    ui.arNote.textContent = mv.canActivateAR
      ? `It will be about 30 cm across, roughly ${fmt(times / 1e6)} million times bigger than the real thing.`
      : 'Your device can’t open AR from this browser, but you can spin the model here. On iPhone, try Safari; on Android, try Chrome.';
  } catch {
    ui.arNote.textContent = 'Couldn’t load the AR viewer. Check your connection and try again.';
  }
});

/* ------------------------------------------------------------------ */
/* Search                                                              */
/* ------------------------------------------------------------------ */

let searchTimer = 0;
let searchCtrl = null;
let options = [];
let activeOption = -1;

ui.searchToggle.addEventListener('click', () => {
  const open = !ui.search.classList.contains('open');
  ui.search.classList.toggle('open', open);
  ui.searchToggle.setAttribute('aria-expanded', String(open));
  if (open) ui.q.focus(); else closeResults();
});
ui.q.addEventListener('input', () => { pendingSubmit = false; clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 280); });
ui.q.addEventListener('keydown', (ev) => {
  if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
    if (!options.length) return;
    ev.preventDefault();
    activeOption = (activeOption + (ev.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
    paintActive();
  } else if (ev.key === 'Escape') {
    closeResults();
    if (ui.search.classList.contains('open')) {
      ui.search.classList.remove('open');
      ui.searchToggle.setAttribute('aria-expanded', 'false');
      ui.searchToggle.focus();
    }
  }
});
let pendingSubmit = false;
ui.form.addEventListener('submit', (ev) => {
  ev.preventDefault();
  const q = ui.q.value.trim();
  if (activeOption >= 0 && options[activeOption]) choose(options[activeOption].acc);
  else if (ACCESSION.test(q)) choose(q.toUpperCase());
  else if (options.length) choose(options[0].acc);
  else if (q) {
    // Results haven't arrived yet: open the first one as soon as they do.
    pendingSubmit = true;
    clearTimeout(searchTimer);
    runSearch();
  }
});
document.addEventListener('pointerdown', (ev) => { if (!ui.search.contains(ev.target)) closeResults(); });

function choose(acc) {
  pendingSubmit = false;
  closeResults();
  ui.q.value = '';
  ui.q.blur();
  ui.search.classList.remove('open');
  ui.searchToggle.setAttribute('aria-expanded', 'false');
  location.hash = acc;
}

async function runSearch() {
  const q = ui.q.value.trim();
  searchCtrl?.abort();
  if (!q) { closeResults(); return; }
  if (ACCESSION.test(q)) { renderResults([{ acc: q.toUpperCase(), name: `Open ${q.toUpperCase()}`, sub: 'UniProt ID' }]); return; }
  searchCtrl = new AbortController();
  const url = `${UNIPROT}/search?query=${encodeURIComponent(`(${q}) AND (reviewed:true)`)}&fields=accession,protein_name,organism_name,length&size=8&format=json`;
  renderNote('Searching UniProt');
  try {
    const res = await fetch(url, { signal: searchCtrl.signal });
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    const found = (data.results || []).map((r) => {
      const pd = r.proteinDescription || {};
      const name = pd.recommendedName?.fullName?.value || pd.submissionNames?.[0]?.fullName?.value || r.primaryAccession;
      const org = r.organism?.commonName || r.organism?.scientificName || '';
      const len = r.sequence?.length;
      return { acc: r.primaryAccession, name, sub: [org, len ? `${len.toLocaleString()} amino acids` : ''].filter(Boolean).join(', ') };
    });
    if (!found.length) renderNote(`No reviewed proteins match “${q}”. Try a gene name like TP53, or paste a UniProt ID.`);
    else renderResults(found);
  } catch (err) {
    if (err.name === 'AbortError') return;
    renderNote('Search isn’t responding. Paste a UniProt ID instead, like P69905.');
  }
}

function renderResults(found) {
  if (pendingSubmit && found.length) { choose(found[0].acc); return; }
  options = found;
  activeOption = -1;
  ui.results.replaceChildren(...found.map((o, i) => {
    const li = document.createElement('li');
    li.id = `opt-${i}`;
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', 'false');
    const strong = document.createElement('strong');
    strong.textContent = o.name;
    const span = document.createElement('span');
    span.textContent = `${o.sub}${o.sub ? ', ' : ''}${o.acc}`;
    li.append(strong, span);
    li.addEventListener('click', () => choose(o.acc));
    return li;
  }));
  openResults();
}

function renderNote(text) {
  options = [];
  activeOption = -1;
  const li = document.createElement('li');
  li.className = 'note';
  li.textContent = text;
  ui.results.replaceChildren(li);
  openResults();
}

function paintActive() {
  [...ui.results.children].forEach((li, i) => li.setAttribute('aria-selected', String(i === activeOption)));
  ui.q.setAttribute('aria-activedescendant', activeOption >= 0 ? `opt-${activeOption}` : '');
  ui.results.children[activeOption]?.scrollIntoView({ block: 'nearest' });
}
function openResults() { ui.results.hidden = false; ui.q.setAttribute('aria-expanded', 'true'); }
function closeResults() { ui.results.hidden = true; ui.q.setAttribute('aria-expanded', 'false'); ui.q.removeAttribute('aria-activedescendant'); }

/* ------------------------------------------------------------------ */
/* Start                                                               */
/* ------------------------------------------------------------------ */

function routeFromHash() {
  const id = decodeURIComponent(location.hash.slice(1)).trim();
  if (id && ACCESSION.test(id)) {
    if (!P || P.acc !== id.toUpperCase()) loadProtein(id);
  } else if (!P) {
    loadProtein(FEATURED[0].id);
  }
}

let introSeen = false;
try { introSeen = !!localStorage.getItem('native-state.intro'); } catch { introSeen = true; }
function maybeIntro() {
  if (introSeen || location.hash.length > 1) return;
  introSeen = true;
  try { localStorage.setItem('native-state.intro', '1'); } catch { /* ignore */ }
  ui.intro.showModal();
}
ui.introGo.addEventListener('click', () => ui.intro.close());
ui.introSurprise.addEventListener('click', () => { ui.intro.close(); surprise(); });

window.addEventListener('hashchange', routeFromHash);
window.addEventListener('resize', resize);
new ResizeObserver(() => measureFree()).observe(ui.dock);
document.addEventListener('visibilitychange', () => { last = performance.now(); });

if (coarse) ui.cams.querySelector('[data-cam="environment"]').hidden = false;
buildElementKey();
buildExplore();
prepareAR();
resize();
applyStyle();
maybeIntro();
routeFromHash();
requestAnimationFrame(frame);

setTimeout(() => {
  if (!userActed && !cam.on && !ui.intro.open) {
    showHint(coarse ? 'Drag to turn it. Each grab shows a new fact. Spread two fingers to pull it apart.' : 'Drag to turn it. Each grab shows a new fact. Slide Unfold to pull it apart.', 7000);
  }
}, 2400);

window.nativeState = {
  async testExportAR() {
    const tmp = new Ribbon(P.n, P.ss || (P.ss = assignSecondary(P.folded, P.n)), new Float32Array(P.n * 3), new Float32Array(P.n));
    tmp.update(P.folded, 0);
    const url = await exportGLB({ ribbon: tmp, band: P.band, colors: BANDS.map((b) => b.solid), radius: P.radius });
    const blob = await (await fetch(url)).blob();
    return blob.size;
  },
  loadProtein, surprise, get protein() { return P; }, screenOf: (i) => (P ? project(i, {}) : null), setStyle: (s) => { style = s; applyStyle(); } };
