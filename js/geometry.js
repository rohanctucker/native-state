import * as THREE from 'three';

/* ------------------------------------------------------------------ */
/* Secondary structure from the CA trace alone (P-SEA style distances) */
/* ------------------------------------------------------------------ */

export const COIL = 0;
export const HELIX = 1;
export const STRAND = 2;

export function assignSecondary(ca, n) {
  const d = (i, j) => {
    const dx = ca[i * 3] - ca[j * 3], dy = ca[i * 3 + 1] - ca[j * 3 + 1], dz = ca[i * 3 + 2] - ca[j * 3 + 2];
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  };
  const ss = new Uint8Array(n);
  const strandish = new Uint8Array(n);
  for (let i = 0; i < n - 4; i++) {
    const d2 = d(i, i + 2), d3 = d(i, i + 3), d4 = d(i, i + 4);
    if (Math.abs(d2 - 5.5) < 0.55 && Math.abs(d3 - 5.3) < 0.6 && Math.abs(d4 - 6.4) < 0.7) {
      for (let k = i; k <= i + 3; k++) ss[k] = HELIX;
    }
    if (Math.abs(d2 - 6.4) < 0.7 && Math.abs(d3 - 9.9) < 1.0 && Math.abs(d4 - 12.4) < 1.2) {
      for (let k = i; k <= i + 2; k++) strandish[k] = 1;
    }
  }
  removeShortRuns(ss, HELIX, 4);

  // A strand needs a partner strand next to it, or it's just an extended loop.
  for (let i = 0; i < n; i++) {
    if (!strandish[i] || ss[i] === HELIX) continue;
    let paired = false;
    for (let j = 0; j < n && !paired; j++) {
      if (Math.abs(i - j) < 3 || !strandish[j]) continue;
      if (d(i, j) < 5.6) paired = true;
    }
    if (paired) ss[i] = STRAND;
  }
  removeShortRuns(ss, STRAND, 3);
  return ss;
}

function removeShortRuns(ss, type, min) {
  let start = -1;
  for (let i = 0; i <= ss.length; i++) {
    const on = i < ss.length && ss[i] === type;
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      if (i - start < min) for (let k = start; k < i; k++) ss[k] = COIL;
      start = -1;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Burial: how many neighbors are close. Used as baked ambient occlusion */
/* ------------------------------------------------------------------ */

export function burial(xyz, count, radius) {
  const r2 = radius * radius;
  const cell = radius;
  const grid = new Map();
  const key = (x, y, z) => `${x},${y},${z}`;
  for (let i = 0; i < count; i++) {
    const k = key(Math.floor(xyz[i * 3] / cell), Math.floor(xyz[i * 3 + 1] / cell), Math.floor(xyz[i * 3 + 2] / cell));
    let list = grid.get(k);
    if (!list) grid.set(k, (list = []));
    list.push(i);
  }
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const x = xyz[i * 3], y = xyz[i * 3 + 1], z = xyz[i * 3 + 2];
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
    let c = 0;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let e = -1; e <= 1; e++) {
      const list = grid.get(key(cx + a, cy + b, cz + e));
      if (!list) continue;
      for (const j of list) {
        const dx = xyz[j * 3] - x, dy = xyz[j * 3 + 1] - y, dz = xyz[j * 3 + 2] - z;
        if (dx * dx + dy * dy + dz * dz < r2) c++;
      }
    }
    out[i] = c;
  }
  // Map counts to a darkening factor between 1 (exposed) and ~0.5 (buried).
  const sorted = Float32Array.from(out).sort();
  const lo = sorted[Math.floor(count * 0.1)];
  const hi = sorted[Math.floor(count * 0.92)] || lo + 1;
  for (let i = 0; i < count; i++) {
    const t = Math.min(1, Math.max(0, (out[i] - lo) / Math.max(1, hi - lo)));
    out[i] = 1 - 0.5 * t * t * (3 - 2 * t);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Wobble in the vertex shader, so shaky parts move without CPU work   */
/* ------------------------------------------------------------------ */

export function patchWobble(material, shared) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = shared.uTime;
    shader.uniforms.uWob = shared.uWob;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aRes;
        attribute float aAmp;
        uniform float uTime;
        uniform float uWob;
        vec3 wobOffset() {
          float a = aAmp * uWob;
          return a * vec3(sin(uTime * 0.9 + aRes * 0.37), sin(uTime * 1.13 + aRes * 0.51 + 1.7), sin(uTime * 0.77 + aRes * 0.29 + 3.1));
        }`)
      .replace('#include <project_vertex>', `
        vec4 mvPosition = vec4( transformed, 1.0 );
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
        #endif
        mvPosition.xyz += wobOffset();
        mvPosition = modelViewMatrix * mvPosition;
        gl_Position = projectionMatrix * mvPosition;`);
  };
  material.customProgramCacheKey = () => 'wobble';
}

/* ------------------------------------------------------------------ */
/* Cartoon ribbon                                                       */
/* ------------------------------------------------------------------ */

const PROFILE = {
  [COIL]: [0.42, 0.42],
  [HELIX]: [1.35, 0.3],
  [STRAND]: [1.15, 0.36],
};
const ARROW_W = 2.0;

export class Ribbon {
  // colors: Float32Array n*3 (linear), amp: Float32Array n
  constructor(n, ss, colors, amp, sub = 6, radial = 10) {
    this.n = n;
    this.ss = ss;
    this.sub = sub;
    this.rs = radial;
    const R = (this.R = (n - 1) * sub + 1);
    const V = R * radial;

    this.hw = new Float32Array(R);
    this.ht = new Float32Array(R);
    for (let k = 0; k < R; k++) {
      const i = Math.min(n - 1, Math.floor(k / sub));
      const t = (k % sub) / sub;
      const j = Math.min(n - 1, i + 1);
      const a = PROFILE[ss[i]];
      const b = PROFILE[ss[j]];
      const s = t * t * (3 - 2 * t);
      let hw = a[0] + (b[0] - a[0]) * s;
      let ht = a[1] + (b[1] - a[1]) * s;
      if (ss[i] === STRAND && ss[j] !== STRAND) {
        // Arrowhead over the last residue of a strand.
        hw = ARROW_W + (PROFILE[COIL][0] - ARROW_W) * t;
        ht = PROFILE[STRAND][1] + (PROFILE[COIL][1] - PROFILE[STRAND][1]) * t;
      }
      this.hw[k] = hw;
      this.ht[k] = ht;
    }

    const geo = (this.geometry = new THREE.BufferGeometry());
    this.position = new THREE.BufferAttribute(new Float32Array(V * 3), 3);
    this.normal = new THREE.BufferAttribute(new Float32Array(V * 3), 3);
    this.position.setUsage(THREE.DynamicDrawUsage);
    this.normal.setUsage(THREE.DynamicDrawUsage);
    const color = new Float32Array(V * 3);
    const aRes = new Float32Array(V);
    const aAmp = new Float32Array(V);
    for (let k = 0; k < R; k++) {
      const rp = k / sub;
      const i = Math.min(n - 1, Math.round(rp));
      const i0 = Math.min(n - 1, Math.floor(rp));
      const i1 = Math.min(n - 1, i0 + 1);
      const f = rp - i0;
      const am = amp[i0] * (1 - f) + amp[i1] * f;
      for (let r = 0; r < radial; r++) {
        const v = k * radial + r;
        color[v * 3] = colors[i * 3];
        color[v * 3 + 1] = colors[i * 3 + 1];
        color[v * 3 + 2] = colors[i * 3 + 2];
        aRes[v] = rp;
        aAmp[v] = am;
      }
    }
    const index = new Uint32Array((R - 1) * radial * 6);
    let o = 0;
    for (let k = 0; k < R - 1; k++) {
      for (let r = 0; r < radial; r++) {
        const a = k * radial + r;
        const b = k * radial + ((r + 1) % radial);
        const c = (k + 1) * radial + r;
        const d = (k + 1) * radial + ((r + 1) % radial);
        index[o++] = a; index[o++] = b; index[o++] = c;
        index[o++] = b; index[o++] = d; index[o++] = c;
      }
    }
    geo.setAttribute('position', this.position);
    geo.setAttribute('normal', this.normal);
    geo.setAttribute('color', new THREE.BufferAttribute(color, 3));
    geo.setAttribute('aRes', new THREE.BufferAttribute(aRes, 1));
    geo.setAttribute('aAmp', new THREE.BufferAttribute(aAmp, 1));
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    this.ringBand = null;

    this.P = new Float32Array(R * 3);
    this.b = new Float32Array(n * 3);
  }

  // base: Float32Array n*3 of current CA positions (no wobble). e: unfold amount 0..1.
  update(base, e) {
    const { n, sub, R, rs, P, b, hw, ht } = this;
    // 1. Spline through the CA atoms.
    let o = 0;
    for (let i = 0; i < n - 1; i++) {
      const i0 = (i > 0 ? i - 1 : 0) * 3, i1 = i * 3, i2 = (i + 1) * 3, i3 = (i + 2 < n ? i + 2 : n - 1) * 3;
      for (let s = 0; s < sub; s++) {
        const t = s / sub, t2 = t * t, t3 = t2 * t;
        for (let c = 0; c < 3; c++) {
          const p0 = base[i0 + c], p1 = base[i1 + c], p2 = base[i2 + c], p3 = base[i3 + c];
          P[o++] = 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (3 * p1 - p0 - 3 * p2 + p3) * t3);
        }
      }
    }
    P[o++] = base[(n - 1) * 3]; P[o++] = base[(n - 1) * 3 + 1]; P[o] = base[(n - 1) * 3 + 2];

    // 2. Side vector per residue: cross product of neighboring bonds, kept pointing the same way.
    let px = 0, py = 0, pz = 1;
    for (let i = 1; i < n - 1; i++) {
      const ax = base[i * 3] - base[(i - 1) * 3], ay = base[i * 3 + 1] - base[(i - 1) * 3 + 1], az = base[i * 3 + 2] - base[(i - 1) * 3 + 2];
      const bx = base[(i + 1) * 3] - base[i * 3], by = base[(i + 1) * 3 + 1] - base[i * 3 + 1], bz = base[(i + 1) * 3 + 2] - base[i * 3 + 2];
      let cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
      let len = Math.hypot(cx, cy, cz);
      if (len < 0.05) { cx = px; cy = py; cz = pz; len = Math.hypot(cx, cy, cz) || 1; }
      cx /= len; cy /= len; cz /= len;
      if (cx * px + cy * py + cz * pz < 0) { cx = -cx; cy = -cy; cz = -cz; }
      b[i * 3] = cx; b[i * 3 + 1] = cy; b[i * 3 + 2] = cz;
      px = cx; py = cy; pz = cz;
    }
    b[0] = b[3]; b[1] = b[4]; b[2] = b[5];
    b[(n - 1) * 3] = b[(n - 2) * 3]; b[(n - 1) * 3 + 1] = b[(n - 2) * 3 + 1]; b[(n - 1) * 3 + 2] = b[(n - 2) * 3 + 2];
    // Smooth strands, whose side vectors zigzag.
    for (let i = 1; i < n - 1; i++) {
      if (this.ss[i] !== STRAND) continue;
      for (let c = 0; c < 3; c++) b[i * 3 + c] = (b[(i - 1) * 3 + c] + 2 * b[i * 3 + c] + b[(i + 1) * 3 + c]) / 4;
    }

    // 3. Rings.
    const pos = this.position.array;
    const nor = this.normal.array;
    for (let k = 0; k < R; k++) {
      const kp = Math.max(0, k - 1), kn = Math.min(R - 1, k + 1);
      let tx = P[kn * 3] - P[kp * 3], ty = P[kn * 3 + 1] - P[kp * 3 + 1], tz = P[kn * 3 + 2] - P[kp * 3 + 2];
      const tl = Math.hypot(tx, ty, tz) || 1;
      tx /= tl; ty /= tl; tz /= tl;

      const rp = k / sub;
      const i0 = Math.min(n - 1, Math.floor(rp)), i1 = Math.min(n - 1, i0 + 1), f = rp - i0;
      let wx = b[i0 * 3] * (1 - f) + b[i1 * 3] * f;
      let wy = b[i0 * 3 + 1] * (1 - f) + b[i1 * 3 + 1] * f;
      let wz = b[i0 * 3 + 2] * (1 - f) + b[i1 * 3 + 2] * f;
      if (e > 0) {
        // Unfolded, the ribbon lies flat facing the viewer: side = tangent x Z.
        let fx = ty, fy = -tx;
        if (fx * wx + fy * wy < 0) { fx = -fx; fy = -fy; }
        wx += (fx - wx) * e; wy += (fy - wy) * e; wz += (0 - wz) * e;
      }
      const dt = wx * tx + wy * ty + wz * tz;
      wx -= dt * tx; wy -= dt * ty; wz -= dt * tz;
      let wl = Math.hypot(wx, wy, wz);
      if (wl < 1e-4) {
        // Any perpendicular will do.
        wx = -ty; wy = tx; wz = 0;
        wl = Math.hypot(wx, wy, wz) || 1;
      }
      wx /= wl; wy /= wl; wz /= wl;
      const nx = ty * wz - tz * wy, ny = tz * wx - tx * wz, nz = tx * wy - ty * wx;

      const w = hw[k], h = ht[k];
      const cx = P[k * 3], cy = P[k * 3 + 1], cz = P[k * 3 + 2];
      for (let r = 0; r < rs; r++) {
        const th = (r / rs) * Math.PI * 2;
        const c = Math.cos(th), s = Math.sin(th);
        const v = (k * rs + r) * 3;
        pos[v] = cx + wx * w * c + nx * h * s;
        pos[v + 1] = cy + wy * w * c + ny * h * s;
        pos[v + 2] = cz + wz * w * c + nz * h * s;
        let mx = wx * (c / w) + nx * (s / h), my = wy * (c / w) + ny * (s / h), mz = wz * (c / w) + nz * (s / h);
        const ml = Math.hypot(mx, my, mz) || 1;
        nor[v] = mx / ml; nor[v + 1] = my / ml; nor[v + 2] = mz / ml;
      }
    }
    this.position.needsUpdate = true;
    this.normal.needsUpdate = true;
  }

  // Split triangles by confidence band (one mesh per color), for AR export where vertex colors aren't safe.
  bandIndices(band) {
    const { R, rs, sub, n } = this;
    const lists = [[], [], [], []];
    for (let k = 0; k < R - 1; k++) {
      const bnd = band[Math.min(n - 1, Math.round((k + 0.5) / sub))];
      for (let r = 0; r < rs; r++) {
        const a = k * rs + r, b2 = k * rs + ((r + 1) % rs), c = (k + 1) * rs + r, d = (k + 1) * rs + ((r + 1) % rs);
        lists[bnd].push(a, b2, c, b2, d, c);
      }
    }
    return lists;
  }

  dispose() { this.geometry.dispose(); }
}

/* ------------------------------------------------------------------ */
/* Space-filling atoms                                                  */
/* ------------------------------------------------------------------ */

export const ELEMENTS = {
  C: { r: 1.7, color: '#939CA7', name: 'Carbon' },
  N: { r: 1.55, color: '#4A69E2', name: 'Nitrogen' },
  O: { r: 1.52, color: '#DC4B3B', name: 'Oxygen' },
  S: { r: 1.8, color: '#EBBE3F', name: 'Sulfur' },
  X: { r: 1.7, color: '#C9A3F0', name: 'Other' },
};

export class Atoms {
  // atoms: [{ res, el, rel:[x,y,z] }] where rel is the offset from the residue's CA.
  constructor(atoms, foldedCA, amp, material, detail = 2) {
    const count = (this.count = atoms.length);
    this.res = new Uint32Array(count);
    this.rel = new Float32Array(count * 3);
    this.scale = new Float32Array(count);
    const abs = new Float32Array(count * 3);
    atoms.forEach((a, j) => {
      this.res[j] = a.res;
      this.rel.set(a.rel, j * 3);
      this.scale[j] = (ELEMENTS[a.el] || ELEMENTS.X).r;
      abs[j * 3] = foldedCA[a.res * 3] + a.rel[0];
      abs[j * 3 + 1] = foldedCA[a.res * 3 + 1] + a.rel[1];
      abs[j * 3 + 2] = foldedCA[a.res * 3 + 2] + a.rel[2];
    });
    const ao = burial(abs, count, 8);
    const sphere = new THREE.IcosahedronGeometry(1, detail);
    const mesh = (this.mesh = new THREE.InstancedMesh(sphere, material, count));
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const color = new THREE.Color();
    const aRes = new Float32Array(count);
    const aAmp = new Float32Array(count);
    for (let j = 0; j < count; j++) {
      color.set((ELEMENTS[atoms[j].el] || ELEMENTS.X).color).multiplyScalar(ao[j]);
      mesh.setColorAt(j, color);
      aRes[j] = this.res[j];
      aAmp[j] = amp[this.res[j]];
    }
    mesh.instanceColor.needsUpdate = true;
    sphere.setAttribute('aRes', new THREE.InstancedBufferAttribute(aRes, 1));
    sphere.setAttribute('aAmp', new THREE.InstancedBufferAttribute(aAmp, 1));
  }

  update(base) {
    const m = this.mesh.instanceMatrix.array;
    const { res, rel, scale, count } = this;
    for (let j = 0; j < count; j++) {
      const r = res[j] * 3;
      const s = scale[j];
      const o = j * 16;
      m[o] = s; m[o + 1] = 0; m[o + 2] = 0; m[o + 3] = 0;
      m[o + 4] = 0; m[o + 5] = s; m[o + 6] = 0; m[o + 7] = 0;
      m[o + 8] = 0; m[o + 9] = 0; m[o + 10] = s; m[o + 11] = 0;
      m[o + 12] = base[r] + rel[j * 3];
      m[o + 13] = base[r + 1] + rel[j * 3 + 1];
      m[o + 14] = base[r + 2] + rel[j * 3 + 2];
      m[o + 15] = 1;
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.dispose();
  }
}
