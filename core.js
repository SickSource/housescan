// HouseScan core — math, voxel point store, depth→3D integration,
// floor-plan analysis, PLY/XYZ import/export and a simulated demo scan.
// No DOM / WebGL in here so it can be unit-tested in Node.

export const VERSION = '1.0.0';

// ---------------------------------------------------------------------------
// 4x4 matrices, column-major (same layout as WebGL / WebXR Float32Arrays)
// ---------------------------------------------------------------------------
export function mat4Multiply(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return o;
}

export function mat4Invert(a) {
  const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
  const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
  const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
  const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return null;
  det = 1 / det;
  const o = new Float32Array(16);
  o[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
  o[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  o[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
  o[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  o[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
  o[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  o[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
  o[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  o[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
  o[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
  o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  o[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
  o[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
  o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return o;
}

export function mat4Perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  const o = new Float32Array(16);
  o[0] = f / aspect;
  o[5] = f;
  o[10] = (far + near) / (near - far);
  o[11] = -1;
  o[14] = (2 * far * near) / (near - far);
  return o;
}

export function mat4LookAt(eye, center, up) {
  let z0 = eye[0] - center[0], z1 = eye[1] - center[1], z2 = eye[2] - center[2];
  let len = Math.hypot(z0, z1, z2) || 1;
  z0 /= len; z1 /= len; z2 /= len;
  let x0 = up[1] * z2 - up[2] * z1, x1 = up[2] * z0 - up[0] * z2, x2 = up[0] * z1 - up[1] * z0;
  len = Math.hypot(x0, x1, x2) || 1;
  x0 /= len; x1 /= len; x2 /= len;
  const y0 = z1 * x2 - z2 * x1, y1 = z2 * x0 - z0 * x2, y2 = z0 * x1 - z1 * x0;
  const o = new Float32Array(16);
  o[0] = x0; o[1] = y0; o[2] = z0;
  o[4] = x1; o[5] = y1; o[6] = z1;
  o[8] = x2; o[9] = y2; o[10] = z2;
  o[12] = -(x0 * eye[0] + x1 * eye[1] + x2 * eye[2]);
  o[13] = -(y0 * eye[0] + y1 * eye[1] + y2 * eye[2]);
  o[14] = -(z0 * eye[0] + z1 * eye[1] + z2 * eye[2]);
  o[15] = 1;
  return o;
}

/** Camera-to-world matrix from position + yaw (about +Y) + pitch (about camera X). yaw=0 looks down -Z. */
export function mat4FromYawPitch(px, py, pz, yaw, pitch) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const o = new Float32Array(16);
  o[0] = cy; o[1] = 0; o[2] = -sy;
  o[4] = sy * sp; o[5] = cp; o[6] = cy * sp;
  o[8] = sy * cp; o[9] = -sp; o[10] = cy * cp;
  o[12] = px; o[13] = py; o[14] = pz; o[15] = 1;
  return o;
}

// ---------------------------------------------------------------------------
// Voxel-deduplicated point cloud.
// Each occupied voxel keeps one point: running-average position & colour,
// plus how many times it was observed (used to reject noise / flying pixels).
// ---------------------------------------------------------------------------
const OFF = 65536, SPAN = 131072; // ±65536 voxels per axis (±1.9 km at 3 cm)

export class PointCloud {
  constructor(voxel = 0.03, capacity = 2_000_000) {
    this.voxel = voxel;
    this.invVoxel = 1 / voxel;
    this.capacity = capacity;
    this.count = 0;
    this.full = false;
    this.pos = new Float32Array(capacity * 3);
    this.col = new Uint8Array(capacity * 3);
    this.cnt = new Uint16Array(capacity);
    this._keys = null;
    this._vals = null;
    this._mask = 0;
  }

  static fromArrays(pos, col, cnt, count, voxel = 0.03) {
    const pc = Object.create(PointCloud.prototype);
    pc.voxel = voxel; pc.invVoxel = 1 / voxel;
    pc.capacity = count; pc.count = count; pc.full = true;
    pc.pos = pos; pc.col = col; pc.cnt = cnt;
    pc._keys = null; pc._vals = null; pc._mask = 0;
    return pc;
  }

  _initHash() {
    let size = 1024;
    while (size < this.capacity / 0.6) size *= 2;
    this._keys = new Float64Array(size).fill(-1);
    this._vals = new Int32Array(size);
    this._mask = size - 1;
    // re-index anything already present (e.g. after fromArrays)
    const n = this.count; this.count = 0;
    for (let i = 0; i < n; i++) {
      const p = i * 3;
      this._insertExisting(this.pos[p], this.pos[p + 1], this.pos[p + 2], i);
    }
    this.count = n;
  }

  _insertExisting(x, y, z, idx) {
    const iv = this.invVoxel;
    const ix = Math.floor(x * iv), iy = Math.floor(y * iv), iz = Math.floor(z * iv);
    const key = ((ix + OFF) * SPAN + (iy + OFF)) * SPAN + (iz + OFF);
    let h = this._hash(ix, iy, iz);
    while (this._keys[h] !== -1 && this._keys[h] !== key) h = (h + 1) & this._mask;
    this._keys[h] = key; this._vals[h] = idx;
  }

  _hash(ix, iy, iz) {
    let h = Math.imul(ix, 73856093) ^ Math.imul(iy, 19349663) ^ Math.imul(iz, 83492791);
    h ^= h >>> 16; h = Math.imul(h, 0x45d9f3b); h ^= h >>> 16;
    return h & this._mask;
  }

  /** Returns 1 if a new voxel was created, 0 otherwise. */
  add(x, y, z, r, g, b) {
    if (this._keys === null) this._initHash();
    const iv = this.invVoxel;
    const ix = Math.floor(x * iv), iy = Math.floor(y * iv), iz = Math.floor(z * iv);
    if (ix <= -OFF || ix >= OFF || iy <= -OFF || iy >= OFF || iz <= -OFF || iz >= OFF) return 0;
    const key = ((ix + OFF) * SPAN + (iy + OFF)) * SPAN + (iz + OFF);
    const keys = this._keys, mask = this._mask;
    let h = this._hash(ix, iy, iz);
    for (;;) {
      const k = keys[h];
      if (k === key) {
        const i = this._vals[h], n = this.cnt[i];
        const w = 1 / (Math.min(n, 20) + 1);
        const p = i * 3, P = this.pos, C = this.col;
        P[p] += (x - P[p]) * w; P[p + 1] += (y - P[p + 1]) * w; P[p + 2] += (z - P[p + 2]) * w;
        C[p] = Math.round(C[p] + (r - C[p]) * w);
        C[p + 1] = Math.round(C[p + 1] + (g - C[p + 1]) * w);
        C[p + 2] = Math.round(C[p + 2] + (b - C[p + 2]) * w);
        if (n < 65535) this.cnt[i] = n + 1;
        return 0;
      }
      if (k === -1) {
        if (this.count >= this.capacity) { this.full = true; return 0; }
        const i = this.count++;
        keys[h] = key; this._vals[h] = i;
        const p = i * 3;
        this.pos[p] = x; this.pos[p + 1] = y; this.pos[p + 2] = z;
        this.col[p] = r; this.col[p + 1] = g; this.col[p + 2] = b;
        this.cnt[i] = 1;
        return 1;
      }
      h = (h + 1) & mask;
    }
  }

  _find(ix, iy, iz) {
    const key = ((ix + OFF) * SPAN + (iy + OFF)) * SPAN + (iz + OFF);
    let h = this._hash(ix, iy, iz);
    for (;;) {
      const k = this._keys[h];
      if (k === key) return this._vals[h];
      if (k === -1) return -1;
      h = (h + 1) & this._mask;
    }
  }

  /**
   * Noise filter score per point: total observations in its 3×3×3 voxel
   * neighbourhood. Points on real surfaces have many observed neighbours;
   * stray "flying pixels" are isolated. Stored in this.sup.
   */
  computeSupport() {
    if (this._keys === null) this._initHash();
    const n = this.count, P = this.pos, Cn = this.cnt, iv = this.invVoxel;
    const sup = new Uint16Array(n);
    for (let i = 0; i < n; i++) {
      const p = i * 3;
      const ix = Math.floor(P[p] * iv), iy = Math.floor(P[p + 1] * iv), iz = Math.floor(P[p + 2] * iv);
      let s = 0;
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
        const j = this._find(ix + a, iy + b, iz + c);
        if (j >= 0) s += Cn[j];
      }
      sup[i] = Math.min(s, 65535);
    }
    this.sup = sup;
    return sup;
  }

  /** Per-point score used by "minObs"-style filters (support if computed, else raw count). */
  get score() { return this.sup && this.sup.length === this.count ? this.sup : this.cnt; }

  countWithMinObs(minObs) {
    if (minObs <= 1) return this.count;
    let n = 0;
    const C = this.score;
    for (let i = 0; i < this.count; i++) if (C[i] >= minObs) n++;
    return n;
  }

  bounds(minObs = 1) {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    const P = this.pos, C = this.score;
    for (let i = 0; i < this.count; i++) {
      if (C[i] < minObs) continue;
      const p = i * 3;
      for (let a = 0; a < 3; a++) {
        const v = P[p + a];
        if (v < lo[a]) lo[a] = v;
        if (v > hi[a]) hi[a] = v;
      }
    }
    return { lo, hi };
  }
}

// ---------------------------------------------------------------------------
// Depth integration: one depth frame → world-space points.
//
//   frame.getDepth(x, y)   depth in metres at normalized view coords
//                          (origin top-left, y down, 0..1), 0 = invalid.
//                          Value is distance from the camera plane (z-depth).
//   frame.proj             view projection matrix (column-major)
//   frame.camToWorld       view transform (camera → reference space)
//   frame.gx, frame.gy     sample grid size
//   frame.rgba             optional Uint8Array(gx*gy*4) colours, rows bottom-up
//                          (as returned by gl.readPixels); flipColor if top-down
// ---------------------------------------------------------------------------
let _rayKey = '', _rays = null, _depthBuf = new Float32Array(0);

function getRays(proj, gx, gy) {
  let key = gx + 'x' + gy;
  for (let i = 0; i < 16; i++) key += ',' + proj[i].toFixed(5);
  if (key === _rayKey) return _rays;
  const inv = mat4Invert(proj);
  const rays = new Float32Array(gx * gy * 2);
  for (let j = 0; j < gy; j++) {
    for (let i = 0; i < gx; i++) {
      const nx = 2 * ((i + 0.5) / gx) - 1;
      const ny = 1 - 2 * ((j + 0.5) / gy);
      const X = inv[0] * nx + inv[4] * ny - inv[8] + inv[12];
      const Y = inv[1] * nx + inv[5] * ny - inv[9] + inv[13];
      const Z = inv[2] * nx + inv[6] * ny - inv[10] + inv[14];
      const W = inv[3] * nx + inv[7] * ny - inv[11] + inv[15];
      const px = X / W, py = Y / W, pz = Z / W;
      const k = (j * gx + i) * 2;
      rays[k] = px / -pz;
      rays[k + 1] = py / -pz;
    }
  }
  _rayKey = key; _rays = rays;
  return rays;
}

export function integrateDepth(cloud, f) {
  const { gx, gy, getDepth, proj, camToWorld: M, rgba } = f;
  const minDepth = f.minDepth ?? 0.2, maxDepth = f.maxDepth ?? 4.0, edge = f.edge ?? 0.06;
  const flip = !!f.flipColor;
  const rays = getRays(proj, gx, gy);
  const n = gx * gy;
  if (_depthBuf.length < n) _depthBuf = new Float32Array(n);
  const D = _depthBuf;
  for (let j = 0; j < gy; j++) {
    const y = (j + 0.5) / gy;
    for (let i = 0; i < gx; i++) {
      const d = getDepth((i + 0.5) / gx, y);
      D[j * gx + i] = d >= minDepth && d <= maxDepth ? d : 0;
    }
  }
  let added = 0, used = 0;
  for (let j = 0; j < gy; j++) {
    for (let i = 0; i < gx; i++) {
      const k = j * gx + i;
      const d = D[k];
      if (d === 0) continue;
      // reject "flying pixels" at depth discontinuities
      const lim = edge * d;
      if (i > 0 && D[k - 1] && Math.abs(D[k - 1] - d) > lim) continue;
      if (i < gx - 1 && D[k + 1] && Math.abs(D[k + 1] - d) > lim) continue;
      if (j > 0 && D[k - gx] && Math.abs(D[k - gx] - d) > lim) continue;
      if (j < gy - 1 && D[k + gx] && Math.abs(D[k + gx] - d) > lim) continue;
      const vx = rays[k * 2] * d, vy = rays[k * 2 + 1] * d, vz = -d;
      const wx = M[0] * vx + M[4] * vy + M[8] * vz + M[12];
      const wy = M[1] * vx + M[5] * vy + M[9] * vz + M[13];
      const wz = M[2] * vx + M[6] * vy + M[10] * vz + M[14];
      let r = 190, g = 190, b = 190;
      if (rgba) {
        const row = flip ? j : gy - 1 - j;
        const c = (row * gx + i) * 4;
        r = rgba[c]; g = rgba[c + 1]; b = rgba[c + 2];
      }
      added += cloud.add(wx, wy, wz, r, g, b);
      used++;
    }
  }
  return { added, used };
}

// ---------------------------------------------------------------------------
// Floor plan analysis
// ---------------------------------------------------------------------------
function quantiles(values, n, qs) {
  const a = Float32Array.from(values.subarray ? values.subarray(0, n) : values.slice(0, n));
  a.sort();
  return qs.map((q) => a[Math.min(a.length - 1, Math.max(0, Math.floor(q * (a.length - 1))))]);
}

function sampleAxis(P, ids, axis, max = 200000) {
  const step = Math.max(1, Math.floor(ids.length / max));
  const out = new Float32Array(Math.ceil(ids.length / step));
  let n = 0;
  for (let k = 0; k < ids.length; k += step) out[n++] = P[ids[k] * 3 + axis];
  return out.subarray(0, n);
}

/**
 * Dominant wall direction (radians, in the X/Z plane), modulo 90°.
 * Walls aligned with the axes produce sharp spikes when the points are
 * projected onto each axis, so we search for the rotation that maximises
 * the "spikiness" (sum of squared histogram bins) of both projections.
 */
export function estimateOrientation(P, ids) {
  if (ids.length < 50) return 0;
  const step = Math.max(1, Math.floor(ids.length / 60000));
  const xs = [], zs = [];
  for (let k = 0; k < ids.length; k += step) { xs.push(P[ids[k] * 3]); zs.push(P[ids[k] * 3 + 2]); }
  const m = xs.length;
  let cx = 0, cz = 0;
  for (let k = 0; k < m; k++) { cx += xs[k]; cz += zs[k]; }
  cx /= m; cz /= m;
  let R = 0;
  for (let k = 0; k < m; k++) R = Math.max(R, Math.abs(xs[k] - cx), Math.abs(zs[k] - cz));
  R = Math.min(R * 1.5 + 0.1, 60);
  const bin = 0.03, nb = Math.ceil((2 * R) / bin) + 1;
  const hu = new Float64Array(nb), hv = new Float64Array(nb);
  const score = (th) => {
    const c = Math.cos(th), s = Math.sin(th);
    hu.fill(0); hv.fill(0);
    for (let k = 0; k < m; k++) {
      const x = xs[k] - cx, z = zs[k] - cz;
      const u = Math.floor((x * c + z * s + R) / bin), v = Math.floor((-x * s + z * c + R) / bin);
      if (u >= 0 && u < nb) hu[u]++;
      if (v >= 0 && v < nb) hv[v]++;
    }
    let e = 0;
    for (let i = 0; i < nb; i++) e += hu[i] * hu[i] + hv[i] * hv[i];
    return e;
  };
  const deg = Math.PI / 180;
  let best = 0, bestS = -1;
  for (let a = -45; a < 45; a += 1) { const sc = score(a * deg); if (sc > bestS) { bestS = sc; best = a; } }
  let fine = best;
  for (let a = best - 1; a <= best + 1; a += 0.1) { const sc = score(a * deg); if (sc > bestS) { bestS = sc; fine = a; } }
  return fine * deg;
}

/**
 * Builds a top-down blueprint from the point cloud.
 * Returns null if there is too little data.
 */
export function analyzeFloorPlan(cloud, opt = {}) {
  const minObs = opt.minObs ?? 2;
  const cell = opt.cell ?? 0.04;
  const bandLow = opt.bandLow ?? 1.0; // metres above floor where the wall slice starts
  const bandTop = opt.bandTop ?? 0.3; // metres below ceiling where it ends
  const sens = opt.sensitivity ?? 0.5;
  const P = cloud.pos, Cn = cloud.score, N = cloud.count;

  let ids = new Uint32Array(N), n = 0;
  for (let i = 0; i < N; i++) if (Cn[i] >= minObs) ids[n++] = i;
  if (n < 300) return null;
  ids = ids.subarray(0, n);

  // --- floor & ceiling from the height histogram
  const ysS = sampleAxis(P, ids, 1);
  const [ylo, yhi] = quantiles(ysS, ysS.length, [0.001, 0.999]);
  const bin = 0.02;
  const nb = Math.max(3, Math.ceil((yhi - ylo) / bin) + 1);
  const hist = new Float64Array(nb);
  for (let k = 0; k < n; k++) {
    const b = Math.floor((P[ids[k] * 3 + 1] - ylo) / bin);
    if (b >= 0 && b < nb) hist[b]++;
  }
  const sm = new Float64Array(nb);
  let maxH = 0;
  for (let b = 0; b < nb; b++) {
    sm[b] = ((b > 0 ? hist[b - 1] : 0) + 2 * hist[b] + (b < nb - 1 ? hist[b + 1] : 0)) / 4;
    if (sm[b] > maxH) maxH = sm[b];
  }
  const isPeak = (b, frac) =>
    sm[b] >= frac * maxH && (b === 0 || sm[b] >= sm[b - 1]) && (b === nb - 1 || sm[b] >= sm[b + 1]);
  let floorY = ylo;
  for (let b = 0; b < nb; b++) if (isPeak(b, 0.2)) { floorY = ylo + (b + 0.5) * bin; break; }
  let ceilY = null;
  for (let b = nb - 1; b >= 0; b--) {
    const y = ylo + (b + 0.5) * bin;
    if (y < floorY + 1.8) break;
    if (isPeak(b, 0.1)) { ceilY = y; break; }
  }
  const ceilDetected = ceilY !== null;
  if (!ceilDetected) ceilY = Math.max(floorY + 2.0, yhi);

  // --- wall slice + floor slice
  let b0 = floorY + bandLow, b1 = ceilY - bandTop;
  if (b1 < b0 + 0.3) b1 = b0 + 0.3;
  let band = new Uint32Array(n), nBand = 0, flo = new Uint32Array(n), nFlo = 0;
  for (let k = 0; k < n; k++) {
    const i = ids[k], y = P[i * 3 + 1];
    if (y >= b0 && y <= b1) band[nBand++] = i;
    else if (Math.abs(y - floorY) < 0.06) flo[nFlo++] = i;
  }
  if (nBand < 100) { // fall back to everything above knee height
    nBand = 0;
    for (let k = 0; k < n; k++) { const i = ids[k]; if (P[i * 3 + 1] > floorY + 0.4) band[nBand++] = i; }
  }
  band = band.subarray(0, nBand);
  flo = flo.subarray(0, nFlo);
  if (nBand < 50) return null;

  // --- align to dominant wall direction
  const angle = estimateOrientation(P, band);
  const c = Math.cos(angle), s = Math.sin(angle);

  // rotated bounds
  const step = Math.max(1, Math.floor((nBand + nFlo) / 200000));
  const us = [], vs = [];
  const both = [band, flo];
  for (const arr of both) {
    for (let k = 0; k < arr.length; k += step) {
      const p = arr[k] * 3, x = P[p], z = P[p + 2];
      us.push(x * c + z * s); vs.push(-x * s + z * c);
    }
  }
  let [u0, u1] = quantiles(us, us.length, [0.001, 0.999]);
  let [v0, v1] = quantiles(vs, vs.length, [0.001, 0.999]);
  const margin = 0.6;
  u0 -= margin; v0 -= margin; u1 += margin; v1 += margin;
  let cs = cell;
  while (((u1 - u0) / cs) * ((v1 - v0) / cs) > 4e6) cs *= 1.25;
  const W = Math.ceil((u1 - u0) / cs), H = Math.ceil((v1 - v0) / cs);
  const wall = new Uint16Array(W * H), floor = new Uint16Array(W * H);
  const raster = (arr, grid) => {
    for (let k = 0; k < arr.length; k++) {
      const p = arr[k] * 3, x = P[p], z = P[p + 2];
      const gu = Math.floor((x * c + z * s - u0) / cs), gv = Math.floor((-x * s + z * c - v0) / cs);
      if (gu >= 0 && gu < W && gv >= 0 && gv < H) { const q = gv * W + gu; if (grid[q] < 65535) grid[q]++; }
    }
  };
  raster(band, wall);
  raster(flo, floor);

  // --- wall threshold relative to typical wall-cell density
  const nz = [];
  for (let i = 0; i < wall.length; i++) if (wall[i]) nz.push(wall[i]);
  nz.sort((a, b) => a - b);
  const p90 = nz.length ? nz[Math.floor(0.9 * (nz.length - 1))] : 1;
  const thr = Math.max(2, Math.round(p90 * (0.6 + (0.03 - 0.6) * sens)));

  let wu0 = Infinity, wu1 = -Infinity, wv0 = Infinity, wv1 = -Infinity, floorCells = 0;
  for (let gv = 0; gv < H; gv++) {
    for (let gu = 0; gu < W; gu++) {
      const q = gv * W + gu;
      if (wall[q] >= thr) {
        if (gu < wu0) wu0 = gu; if (gu > wu1) wu1 = gu;
        if (gv < wv0) wv0 = gv; if (gv > wv1) wv1 = gv;
      }
      if (floor[q]) floorCells++;
    }
  }
  const wallBounds = wu1 >= wu0
    ? { u0: wu0 * cs, u1: (wu1 + 1) * cs, v0: wv0 * cs, v1: (wv1 + 1) * cs }
    : { u0: 0, u1: W * cs, v0: 0, v1: H * cs };

  return {
    floorY, ceilY, ceilDetected, angle, cos: c, sin: s,
    u0, v0, cell: cs, W, H, wall, floor, thr, wallBounds,
    area: floorCells * cs * cs, bandLow: b0, bandHigh: b1, pointCount: n,
  };
}

/** Maps world → "aligned" coords: floor at y=0, walls on the axes, plan centred at origin. */
export function makeAligner(an) {
  if (!an) return (x, y, z, o) => { o[0] = x; o[1] = y; o[2] = z; };
  const { cos: c, sin: s, wallBounds: wb } = an;
  const cu = an.u0 + (wb.u0 + wb.u1) / 2, cv = an.v0 + (wb.v0 + wb.v1) / 2, fy = an.floorY;
  return (x, y, z, o) => {
    o[0] = x * c + z * s - cu;
    o[1] = y - fy;
    o[2] = -x * s + z * c - cv;
  };
}

// ---------------------------------------------------------------------------
// Export / import
// ---------------------------------------------------------------------------
function forEachExportPoint(cloud, opt, fn) {
  const minObs = opt.minObs ?? 1;
  const al = makeAligner(opt.align ? opt.analysis : null);
  const zUp = opt.up === 'z', mirror = !!opt.mirror;
  const t = [0, 0, 0], P = cloud.pos, C = cloud.col, Cn = cloud.score;
  for (let i = 0; i < cloud.count; i++) {
    if (Cn[i] < minObs) continue;
    const p = i * 3;
    al(P[p], P[p + 1], P[p + 2], t);
    let X = t[0], Y = t[1], Z = t[2];
    if (zUp) { const up = Y; Y = -Z; Z = up; } // right-handed Y-up → right-handed Z-up
    if (mirror) X = -X;
    fn(X, Y, Z, C[p], C[p + 1], C[p + 2]);
  }
}

export function exportPLY(cloud, opt = {}) {
  const n = cloud.countWithMinObs(opt.minObs ?? 1);
  const header =
    'ply\nformat binary_little_endian 1.0\n' +
    `comment HouseScan ${VERSION} ${opt.up === 'z' ? 'Z-up' : 'Y-up'} metres${opt.mirror ? ' mirrored' : ''}\n` +
    `element vertex ${n}\n` +
    'property float x\nproperty float y\nproperty float z\n' +
    'property uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n';
  const body = new ArrayBuffer(n * 15);
  const dv = new DataView(body);
  let o = 0;
  forEachExportPoint(cloud, opt, (x, y, z, r, g, b) => {
    dv.setFloat32(o, x, true); dv.setFloat32(o + 4, y, true); dv.setFloat32(o + 8, z, true);
    dv.setUint8(o + 12, r); dv.setUint8(o + 13, g); dv.setUint8(o + 14, b);
    o += 15;
  });
  return new Blob([header, body], { type: 'application/octet-stream' });
}

/** Plain-text "X Y Z R G B" (metres) — importable by Unreal's LiDAR Point Cloud plugin, CloudCompare, etc. */
export function exportXYZ(cloud, opt = {}) {
  const parts = [];
  let lines = [];
  forEachExportPoint(cloud, opt, (x, y, z, r, g, b) => {
    lines.push(`${x.toFixed(4)} ${y.toFixed(4)} ${z.toFixed(4)} ${r} ${g} ${b}`);
    if (lines.length >= 50000) { parts.push(lines.join('\n') + '\n'); lines = []; }
  });
  if (lines.length) parts.push(lines.join('\n') + '\n');
  return new Blob(parts, { type: 'text/plain' });
}

const PLY_TYPES = {
  char: ['getInt8', 1], int8: ['getInt8', 1], uchar: ['getUint8', 1], uint8: ['getUint8', 1],
  short: ['getInt16', 2], int16: ['getInt16', 2], ushort: ['getUint16', 2], uint16: ['getUint16', 2],
  int: ['getInt32', 4], int32: ['getInt32', 4], uint: ['getUint32', 4], uint32: ['getUint32', 4],
  float: ['getFloat32', 4], float32: ['getFloat32', 4], double: ['getFloat64', 8], float64: ['getFloat64', 8],
};

/** Parses vertex positions (+ optional colours) from ASCII or binary PLY. */
export function parsePLY(buffer) {
  const bytes = new Uint8Array(buffer);
  const marker = 'end_header';
  let headerEnd = -1;
  const scan = Math.min(bytes.length, 65536);
  const headText = new TextDecoder().decode(bytes.subarray(0, scan));
  const mi = headText.indexOf(marker);
  if (!headText.startsWith('ply') || mi < 0) throw new Error('Not a PLY file');
  let after = mi + marker.length;
  if (headText[after] === '\r') after++;
  if (headText[after] === '\n') after++;
  headerEnd = new TextEncoder().encode(headText.slice(0, after)).length;
  const lines = headText.slice(0, mi).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let format = 'ascii', elements = [], cur = null;
  const comments = [];
  for (const l of lines) {
    const t = l.split(/\s+/);
    if (t[0] === 'comment') comments.push(l.slice(8));
    else if (t[0] === 'format') format = t[1];
    else if (t[0] === 'element') { cur = { name: t[1], count: +t[2], props: [] }; elements.push(cur); }
    else if (t[0] === 'property' && cur) {
      if (t[1] === 'list') cur.props.push({ list: true, countType: t[2], type: t[3], name: t[4] });
      else cur.props.push({ type: t[1], name: t[2] });
    }
  }
  const vi = elements.findIndex((e) => e.name === 'vertex');
  if (vi < 0) throw new Error('PLY has no vertex element');
  const vert = elements[vi];
  if (vert.props.some((p) => p.list)) throw new Error('Unsupported PLY vertex layout');
  const pIdx = (names) => vert.props.findIndex((p) => names.includes(p.name));
  const ix = pIdx(['x']), iy = pIdx(['y']), iz = pIdx(['z']);
  const ir = pIdx(['red', 'r', 'diffuse_red']), ig = pIdx(['green', 'g', 'diffuse_green']), ib = pIdx(['blue', 'b', 'diffuse_blue']);
  if (ix < 0 || iy < 0 || iz < 0) throw new Error('PLY vertices lack x/y/z');
  const n = vert.count;
  const pos = new Float32Array(n * 3), col = new Uint8Array(n * 3);
  const hasCol = ir >= 0 && ig >= 0 && ib >= 0;
  const colScale = (t) => (t === 'float' || t === 'float32' || t === 'double' || t === 'float64' ? 255 : t.includes('16') || t.includes('short') ? 1 / 257 : 1);

  if (format === 'ascii') {
    const text = new TextDecoder().decode(bytes.subarray(headerEnd));
    const rows = text.split(/\r?\n/);
    let r = 0;
    for (let e = 0; e < vi; e++) r += elements[e].count;
    for (let k = 0; k < n; k++) {
      const t = rows[r + k].trim().split(/\s+/).map(Number);
      pos[k * 3] = t[ix]; pos[k * 3 + 1] = t[iy]; pos[k * 3 + 2] = t[iz];
      if (hasCol) for (const [a, ci] of [[0, ir], [1, ig], [2, ib]]) col[k * 3 + a] = Math.max(0, Math.min(255, Math.round(t[ci] * colScale(vert.props[ci].type))));
      else col.fill(190, k * 3, k * 3 + 3);
    }
  } else {
    const le = format === 'binary_little_endian';
    if (!le && format !== 'binary_big_endian') throw new Error('Unknown PLY format ' + format);
    if (vi !== 0 && elements.slice(0, vi).some((e) => e.props.some((p) => p.list))) throw new Error('Unsupported PLY element order');
    let off = headerEnd;
    for (let e = 0; e < vi; e++) off += elements[e].count * elements[e].props.reduce((s, p) => s + PLY_TYPES[p.type][1], 0);
    const offs = [];
    let stride = 0;
    for (const p of vert.props) {
      if (!PLY_TYPES[p.type]) throw new Error('Unknown PLY type ' + p.type);
      offs.push(stride); stride += PLY_TYPES[p.type][1];
    }
    const dv = new DataView(buffer, 0);
    const rd = (base, pi) => dv[PLY_TYPES[vert.props[pi].type][0]](base + offs[pi], le);
    for (let k = 0; k < n; k++) {
      const base = off + k * stride;
      pos[k * 3] = rd(base, ix); pos[k * 3 + 1] = rd(base, iy); pos[k * 3 + 2] = rd(base, iz);
      if (hasCol) for (const [a, ci] of [[0, ir], [1, ig], [2, ib]]) col[k * 3 + a] = Math.max(0, Math.min(255, Math.round(rd(base, ci) * colScale(vert.props[ci].type))));
      else col.fill(190, k * 3, k * 3 + 3);
    }
  }
  return { count: n, pos, col, comments };
}

/**
 * Converts a loaded cloud to the app's Y-up frame in place.
 * HouseScan files say their axes in a comment; for other files the up axis
 * is guessed as whichever of Y/Z has the smaller extent (houses are wider than tall).
 */
export function normalizeLoadedAxes(pos, count, comments = []) {
  const tag = comments.find((c) => c.startsWith('HouseScan')) || '';
  let zUp;
  if (tag) zUp = tag.includes('Z-up');
  else {
    let y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < count; i++) {
      const y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
    zUp = z1 - z0 < y1 - y0;
  }
  const mirrored = tag.includes('mirrored');
  for (let i = 0; i < count; i++) {
    const p = i * 3;
    if (mirrored) pos[p] = -pos[p];
    if (zUp) { const Y = pos[p + 1], Z = pos[p + 2]; pos[p + 1] = Z; pos[p + 2] = -Y; }
  }
  return zUp ? 'z' : 'y';
}

// ---------------------------------------------------------------------------
// Demo: a synthetic 4-room house, "scanned" by a virtual depth camera walking
// through it. Uses the exact same integrateDepth() path as the real AR scan.
// ---------------------------------------------------------------------------
export function buildDemoHouse() {
  const boxes = [];
  const H = 2.4, T = 0.06;
  const add = (x0, y0, z0, x1, y1, z1, color, kind = 'obj') =>
    boxes.push({ min: [Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)], max: [Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)], color, kind });
  const wallX = (z, x0, x1, gaps, col) => {
    let cur = x0;
    for (const [a, b] of gaps || []) { add(cur, 0, z - T, a, H, z + T, col, 'wall'); add(a, 2.05, z - T, b, H, z + T, col, 'wall'); cur = b; }
    add(cur, 0, z - T, x1, H, z + T, col, 'wall');
  };
  const wallZ = (x, z0, z1, gaps, col) => {
    let cur = z0;
    for (const [a, b] of gaps || []) { add(x - T, 0, cur, x + T, H, a, col, 'wall'); add(x - T, 2.05, a, x + T, H, b, col, 'wall'); cur = b; }
    add(x - T, 0, cur, x + T, H, z1, col, 'wall');
  };
  const beige = [222, 212, 190], sage = [170, 196, 170], blue = [168, 190, 220], rose = [222, 186, 180];
  add(-0.3, -0.05, -0.3, 8.8, 0, 7.8, [150, 104, 68], 'floor');
  add(-0.3, H, -0.3, 8.8, H + 0.05, 7.8, [242, 242, 238], 'ceiling');
  wallX(0, -T, 8.5 + T, [], beige);
  wallX(7.5, -T, 8.5 + T, [], beige);
  wallZ(0, 0, 7.5, [], beige);
  wallZ(8.5, 0, 7.5, [], sage);
  wallZ(5, 0, 4, [[1.5, 2.4]], sage);              // living | kitchen
  wallX(4, 0, 8.5, [[1.0, 1.9], [6.0, 6.9]], blue); // front | back rooms
  wallZ(4, 4, 7.5, [[5.5, 6.4]], rose);             // bedroom | office
  // furniture
  add(0.3, 0, 3.0, 2.3, 0.85, 3.85, [90, 96, 120]);      // sofa
  add(2.0, 0.72, 0.8, 3.2, 0.76, 1.6, [120, 80, 50]);    // table top
  add(7.9, 0, 0.3, 8.44, 0.92, 3.5, [200, 200, 205]);    // kitchen counter
  add(5.2, 0, 0.1, 5.9, 1.8, 0.8, [235, 235, 235]);      // fridge
  add(0.2, 0, 5.6, 1.8, 0.55, 7.4, [230, 225, 240]);     // bed
  add(7.0, 0.72, 6.7, 8.3, 0.76, 7.4, [140, 100, 60]);   // desk
  add(4.2, 0, 7.1, 5.4, 2.0, 7.44, [110, 75, 45]);       // bookshelf
  const path = [
    { p: [2.5, 2.0], spin: true }, { p: [4.0, 1.95] }, { p: [6.0, 1.95] },
    { p: [6.8, 2.0], spin: true }, { p: [6.45, 3.2] }, { p: [6.45, 4.8] },
    { p: [6.3, 5.8], spin: true }, { p: [4.9, 5.95] }, { p: [3.2, 5.95] },
    { p: [2.6, 5.5], spin: true }, { p: [1.45, 4.8] }, { p: [1.45, 3.2] }, { p: [2.5, 2.0] },
  ];
  return { boxes, path, height: H };
}

function raycastBoxes(ox, oy, oz, dx, dy, dz, boxes) {
  let best = Infinity, hit = null, axis = 0;
  const ix = 1 / dx, iy = 1 / dy, iz = 1 / dz;
  for (const b of boxes) {
    let t0 = (b.min[0] - ox) * ix, t1 = (b.max[0] - ox) * ix;
    if (t0 > t1) { const t = t0; t0 = t1; t1 = t; }
    let tmin = t0, tmax = t1, ax = 0;
    t0 = (b.min[1] - oy) * iy; t1 = (b.max[1] - oy) * iy;
    if (t0 > t1) { const t = t0; t0 = t1; t1 = t; }
    if (t0 > tmin) { tmin = t0; ax = 1; }
    if (t1 < tmax) tmax = t1;
    t0 = (b.min[2] - oz) * iz; t1 = (b.max[2] - oz) * iz;
    if (t0 > t1) { const t = t0; t0 = t1; t1 = t; }
    if (t0 > tmin) { tmin = t0; ax = 2; }
    if (t1 < tmax) tmax = t1;
    if (tmax >= tmin && tmin > 0 && tmin < best) { best = tmin; hit = b; axis = ax; }
  }
  return hit ? { t: best, box: hit, axis } : null;
}

function makeRng(seed) {
  let s = seed >>> 0 || 1;
  const u = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  return { u, gauss: () => Math.sqrt(-2 * Math.log(u() + 1e-12)) * Math.cos(2 * Math.PI * u()) };
}

/** Camera poses for the demo walk-through. */
export function demoPoses(house, { step = 0.3, spinFrames = 30, eye = 1.4 } = {}) {
  const poses = [];
  const path = house.path;
  for (let w = 0; w < path.length; w++) {
    const { p, spin } = path[w];
    if (spin) {
      for (let k = 0; k < spinFrames; k++) {
        const yaw = (2 * Math.PI * k) / spinFrames;
        poses.push({ x: p[0], y: eye, z: p[1], yaw, pitch: -0.15 + 0.45 * Math.sin(k * 1.3) });
      }
    }
    if (w < path.length - 1) {
      const q = path[w + 1].p, dx = q[0] - p[0], dz = q[1] - p[1], len = Math.hypot(dx, dz);
      const yaw = Math.atan2(-dx, -dz);
      const steps = Math.max(1, Math.round(len / step));
      for (let k = 0; k < steps; k++) {
        const t = k / steps;
        poses.push({ x: p[0] + dx * t, y: eye, z: p[1] + dz * t, yaw, pitch: -0.2 + 0.25 * Math.sin(k * 0.8) });
      }
    }
  }
  return poses;
}

/** Generator: integrates one synthetic depth frame per step, yields progress 0..1. */
export function* simulateScan(cloud, opt = {}) {
  const gx = opt.gx ?? 40, aspect = opt.aspect ?? 0.5, gy = Math.round(gx / aspect);
  const fovy = opt.fovy ?? 1.1, noise = opt.noise ?? 0.004;
  const house = opt.house ?? buildDemoHouse();
  const poses = opt.poses ?? demoPoses(house);
  const proj = mat4Perspective(fovy, aspect, 0.1, 100);
  const rng = makeRng(opt.seed ?? 7);
  const depth = new Float32Array(gx * gy), rgba = new Uint8Array(gx * gy * 4);
  const ty = Math.tan(fovy / 2), tx = ty * aspect;
  const L = [0.4, 0.8, 0.45];
  for (let f = 0; f < poses.length; f++) {
    const ps = poses[f];
    const M = mat4FromYawPitch(ps.x, ps.y, ps.z, ps.yaw, ps.pitch);
    for (let j = 0; j < gy; j++) {
      for (let i = 0; i < gx; i++) {
        // independent pinhole model (does NOT use the projection-matrix inverse)
        const cx = (2 * ((i + 0.5) / gx) - 1) * tx, cy = (1 - 2 * ((j + 0.5) / gy)) * ty;
        const dx = M[0] * cx + M[4] * cy - M[8], dy = M[1] * cx + M[5] * cy - M[9], dz = M[2] * cx + M[6] * cy - M[10];
        const h = raycastBoxes(ps.x, ps.y, ps.z, dx, dy, dz, house.boxes);
        const k = j * gx + i, row = gy - 1 - j, c = (row * gx + i) * 4;
        if (!h) { depth[k] = 0; continue; }
        depth[k] = h.t * (1 + noise * rng.gauss());
        const hx = ps.x + dx * h.t, hz = ps.z + dz * h.t;
        const nrm = [0, 0, 0]; nrm[h.axis] = 1;
        let shade = 0.72 + 0.28 * Math.abs(nrm[0] * L[0] + nrm[1] * L[1] + nrm[2] * L[2]);
        if (h.box.kind === 'floor') shade *= (Math.floor(hx * 6.5) & 1 ? 0.9 : 1.0) * (0.95 + 0.05 * Math.sin(hz * 9));
        const col = h.box.color;
        rgba[c] = Math.min(255, col[0] * shade); rgba[c + 1] = Math.min(255, col[1] * shade);
        rgba[c + 2] = Math.min(255, col[2] * shade); rgba[c + 3] = 255;
      }
    }
    integrateDepth(cloud, {
      gx, gy, proj, camToWorld: M, rgba,
      getDepth: (x, y) => depth[Math.min(gy - 1, (y * gy) | 0) * gx + Math.min(gx - 1, (x * gx) | 0)],
      minDepth: 0.2, maxDepth: opt.maxDepth ?? 5,
    });
    yield (f + 1) / poses.length;
  }
}

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------
export function fmtFeet(m) {
  let inches = Math.round(m / 0.0254);
  const ft = Math.floor(inches / 12);
  inches -= ft * 12;
  return `${ft}′ ${inches}″`;
}
export const fmtLen = (m) => `${m.toFixed(2)} m (${fmtFeet(m)})`;
