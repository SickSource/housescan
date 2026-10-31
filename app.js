// HouseScan app: AR capture (WebXR depth + camera), 3D viewer, floor plan, export.
import * as C from './core.js';
import { PointRenderer, CameraGrabber } from './gl.js';
import { FloorPlanView } from './floorplan.js';

const $ = (id) => document.getElementById(id);
const fmtInt = (n) => n.toLocaleString('en-US');
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
const DEFAULTS = { voxel: 0.03, maxPoints: 2000000, maxDepth: 3.5, density: 64, depthType: 'smooth', flipColor: false };
const S = (() => {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('housescan.settings') || '{}') }; }
  catch { return { ...DEFAULTS }; }
})();
function saveSettings() { try { localStorage.setItem('housescan.settings', JSON.stringify(S)); } catch {} }
function bindSettings() {
  for (const el of document.querySelectorAll('[data-setting]')) {
    const key = el.dataset.setting;
    if (el.type === 'checkbox') el.checked = !!S[key];
    else el.value = String(S[key]);
    el.addEventListener('change', () => {
      S[key] = el.type === 'checkbox' ? el.checked : isNaN(+el.value) ? el.value : +el.value;
      saveSettings();
    });
  }
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------
function show(screen) { for (const s of ['home', 'scan', 'results']) $(s).classList.toggle('hidden', s !== screen); }
let toastTimer = 0;
function toast(msg, ms = 3500) {
  const t = $('toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), ms);
}
function busy(text) {
  $('busy').classList.toggle('hidden', !text);
  if (text) $('busyText').textContent = text;
}
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}
function stamp() {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

// ---------------------------------------------------------------------------
// Last scan persistence (IndexedDB)
// ---------------------------------------------------------------------------
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('housescan', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('scans');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function saveLast(cloud) {
  try {
    const db = await idb(), n = cloud.count;
    const rec = { date: Date.now(), count: n, voxel: cloud.voxel, pos: cloud.pos.slice(0, n * 3), col: cloud.col.slice(0, n * 3), cnt: cloud.cnt.slice(0, n) };
    await new Promise((res, rej) => { const tx = db.transaction('scans', 'readwrite'); tx.objectStore('scans').put(rec, 'last'); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
    refreshLastButton();
  } catch (e) { console.warn('save failed', e); }
}
async function loadLast(metaOnly) {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction('scans'); const r = tx.objectStore('scans').get('last');
    r.onsuccess = () => res(r.result && metaOnly ? { date: r.result.date, count: r.result.count } : r.result || null);
    r.onerror = () => rej(r.error);
  });
}
async function refreshLastButton() {
  try {
    const m = await loadLast(true);
    const b = $('btnLast');
    b.classList.toggle('hidden', !m);
    if (m) b.textContent = `Reopen last scan · ${new Date(m.date).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })} · ${fmtInt(m.count)} pts`;
  } catch {}
}

// ---------------------------------------------------------------------------
// Support check
// ---------------------------------------------------------------------------
async function checkSupport() {
  const el = $('support'), btn = $('btnScan');
  const bad = (html) => { el.innerHTML = html; el.className = 'card status bad'; btn.disabled = true; };
  if (!window.isSecureContext) return bad('AR needs a secure page. Open this app over <b>https://</b> or from <b>http://localhost</b> (see README).');
  if (!navigator.xr) return bad('This browser has no WebXR. Use <b>Chrome on Android</b> with <b>Google Play Services for AR</b> installed. The demo and file viewer still work.');
  try {
    const ok = await navigator.xr.isSessionSupported('immersive-ar');
    if (!ok) return bad('Chrome reports no AR support on this device (ARCore missing or unsupported). The demo and file viewer still work.');
    el.innerHTML = 'AR is available. Depth support is confirmed when the scan starts.';
    el.className = 'card status good';
    btn.disabled = false;
  } catch (e) { bad('Could not check AR support: ' + e.message); }
}

// ---------------------------------------------------------------------------
// AR scanning
// ---------------------------------------------------------------------------
const scan = { session: null, paused: false, showPoints: true, lastCapture: 0, colorOk: null, blackFrames: 0, depthFrames: 0, depthErrors: 0, status: '', hudTimer: 0 };

async function startScan() {
  const overlay = $('scan');
  show('scan');
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2', { xrCompatible: true, alpha: true, antialias: false, preserveDrawingBuffer: false });
  if (!gl) { show('home'); return toast('WebGL2 is not available'); }
  const init = {
    requiredFeatures: ['depth-sensing'],
    optionalFeatures: ['local-floor', 'dom-overlay', 'camera-access'],
    domOverlay: { root: overlay },
    depthSensing: {
      usagePreference: ['cpu-optimized'],
      dataFormatPreference: ['luminance-alpha', 'float32'],
      depthTypeRequest: [S.depthType],
      matchDepthView: true,
    },
  };
  let session;
  try {
    session = await navigator.xr.requestSession('immersive-ar', init);
  } catch (e) {
    show('home');
    const msg = e.name === 'NotSupportedError'
      ? 'This phone/browser can’t provide AR depth data. It needs an ARCore device that supports the Depth API, and an up-to-date Chrome + Google Play Services for AR.'
      : `Could not start AR: ${e.name} ${e.message}`;
    $('support').innerHTML = msg; $('support').className = 'card status bad';
    return;
  }
  scan.session = session;
  scan.paused = false; scan.showPoints = true; scan.colorOk = null; scan.blackFrames = 0;
  scan.depthFrames = 0; scan.depthErrors = 0; scan.lastCapture = 0; scan.trackingLost = 0;
  $('btnPause').textContent = 'Pause';
  $('btnTogglePts').textContent = 'Hide points';

  session.updateRenderState({ baseLayer: new XRWebGLLayer(session, gl) });
  let refSpace;
  try { refSpace = await session.requestReferenceSpace('local-floor'); }
  catch { refSpace = await session.requestReferenceSpace('local'); }

  let binding = null;
  const features = session.enabledFeatures;
  if (typeof XRWebGLBinding !== 'undefined' && (!features || features.includes('camera-access'))) {
    try { binding = new XRWebGLBinding(session, gl); } catch { binding = null; }
  }
  const hasOverlay = !!session.domOverlayState;

  const cloud = new C.PointCloud(S.voxel, S.maxPoints);
  const renderer = new PointRenderer(gl, S.maxPoints);
  const grabber = new CameraGrabber(gl);
  scan.cloud = cloud;

  if (!hasOverlay) {
    // no HTML overlay: tap the screen to pause/resume, press Back to finish
    session.addEventListener('select', () => { scan.paused = !scan.paused; });
  }

  session.addEventListener('end', async () => {
    clearInterval(scan.hudTimer);
    scan.session = null;
    try { renderer.dispose(); } catch {}
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    if (scan.discard || cloud.count < 200) {
      show('home');
      if (!scan.discard) toast('Scan ended with too few points to use.');
      scan.discard = false;
      return;
    }
    await openResults(cloud, { source: 'scan' });
    saveLast(cloud);
  });

  scan.hudTimer = setInterval(() => updateHud(cloud), 250);

  const onFrame = (t, frame) => {
    const s = frame.session;
    s.requestAnimationFrame(onFrame);
    const pose = frame.getViewerPose(refSpace);
    if (!pose) { scan.status = 'init'; clearLayer(gl, s); return; }
    const tracking = !pose.emulatedPosition;
    scan.status = tracking ? 'ok' : 'lost';
    if (!tracking) scan.trackingLost = t;

    const view = pose.views[0];
    if (!scan.paused && tracking && !cloud.full && t - scan.lastCapture >= 100) {
      scan.lastCapture = t;
      captureFrame(frame, view, cloud, binding, grabber);
      renderer.sync(cloud);
      if (cloud.full) { scan.paused = true; toast('Point budget full — tap Finish (or raise “Max points” in settings).', 6000); }
    }

    const layer = s.renderState.baseLayer;
    gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!scan.showPoints) return;
    for (const v of pose.views) {
      const vp = layer.getViewport(v);
      gl.viewport(vp.x, vp.y, vp.width, vp.height);
      const size = cloud.voxel * 1.4 * v.projectionMatrix[5] * vp.height * 0.5;
      renderer.draw(v.projectionMatrix, v.transform.inverse.matrix, { size });
    }
  };
  session.requestAnimationFrame(onFrame);
}

function clearLayer(gl, session) {
  const layer = session.renderState.baseLayer;
  gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
}

function captureFrame(frame, view, cloud, binding, grabber) {
  let depth;
  try { depth = frame.getDepthInformation(view); }
  catch (e) { scan.depthErrors++; return; }
  if (!depth) return;
  scan.depthFrames++;
  const proj = depth.projectionMatrix || view.projectionMatrix;
  const camToWorld = (depth.transform || view.transform).matrix;
  const aspect = proj[5] / proj[0];
  const gx = S.density, gy = Math.max(16, Math.min(256, Math.round(gx / aspect)));

  let rgba = null;
  if (binding && view.camera && scan.colorOk !== false) {
    try {
      const tex = binding.getCameraImage(view.camera);
      if (tex) {
        rgba = grabber.read(tex, gx, gy);
        // detect an unusable (all-black) camera texture and fall back to grey
        let sum = 0;
        for (let i = 0; i < rgba.length; i += 64) sum += rgba[i] + rgba[i + 1] + rgba[i + 2];
        if (sum === 0) { scan.blackFrames++; rgba = null; if (scan.blackFrames > 15) scan.colorOk = false; }
        else scan.colorOk = true;
      }
    } catch (e) { scan.colorOk = false; rgba = null; }
  }
  C.integrateDepth(cloud, {
    gx, gy, proj, camToWorld, rgba, flipColor: S.flipColor,
    getDepth: (x, y) => depth.getDepthInMeters(x, y),
    minDepth: 0.2, maxDepth: S.maxDepth, edge: 0.06,
  });
}

function updateHud(cloud) {
  const pill = $('hudStatus');
  let label, cls, hint;
  if (scan.status === 'init') { label = 'Starting tracking…'; cls = 'warn'; hint = 'Move the phone slowly side to side.'; }
  else if (scan.status === 'lost') { label = 'Tracking lost'; cls = 'bad'; hint = 'Slow down and point at textured surfaces.'; }
  else if (!scan.depthFrames) { label = 'Waiting for depth…'; cls = 'warn'; hint = 'Keep moving the phone gently — depth needs motion to start.'; }
  else if (scan.paused) { label = 'Paused'; cls = 'warn'; hint = 'Tap Resume to keep capturing.'; }
  else { label = '● Capturing'; cls = 'good'; hint = 'Sweep walls floor-to-ceiling, 0.5–3 m away. Walk slowly; overlap areas.'; }
  pill.textContent = label; pill.className = 'pill ' + cls;
  $('hint').textContent = hint;
  $('hudPoints').textContent = `${fmtInt(cloud.count)} pts`;
  $('hudBar').style.width = `${Math.min(100, (100 * cloud.count) / cloud.capacity).toFixed(1)}%`;
  $('hudColor').textContent = scan.colorOk === true ? 'colour ✓' : scan.colorOk === false ? 'no colour' : 'colour …';
}

// ---------------------------------------------------------------------------
// 3D viewer
// ---------------------------------------------------------------------------
class Viewer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl2', { antialias: true });
    this.renderer = null; this.cloud = null; this.an = null;
    this.yaw = 0.7; this.pitch = 0.9; this.dist = 10; this.target = [0, 0, 0];
    this.opts = { sizeMul: 1, minObs: 3, mode: 0, cutCeiling: true };
    this.pointers = new Map();
    this._pending = false;
    new ResizeObserver(() => this.draw()).observe(canvas);
    canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, b: e.button, shift: e.shiftKey }); this.pinch = null; });
    canvas.addEventListener('pointermove', (e) => this._move(e));
    const up = (e) => { this.pointers.delete(e.pointerId); this.pinch = null; };
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); this.dist = Math.max(0.2, Math.min(500, this.dist * Math.exp(e.deltaY * 0.0012))); this.draw(); }, { passive: false });
  }

  _move(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (this.pointers.size === 1) {
      if (p.b === 2 || p.shift) this._pan(dx, dy);
      else { this.yaw -= dx * 0.008; this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch + dy * 0.008)); }
    } else if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      if (this.pinch) {
        this.dist = Math.max(0.2, Math.min(500, this.dist * (this.pinch.d / Math.max(d, 1))));
        this._pan(mx - this.pinch.mx, my - this.pinch.my);
      }
      this.pinch = { d, mx, my };
    }
    this.draw();
  }

  _pan(dx, dy) {
    const k = this.dist * 0.0018;
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    this.target[0] += -rx * dx * k + fx * dy * k;
    this.target[2] += -rz * dx * k + fz * dy * k;
  }

  setCloud(cloud, an) {
    if (!this.gl) return;
    if (this.renderer) this.renderer.dispose();
    this.renderer = new PointRenderer(this.gl, Math.max(1, cloud.count));
    this.renderer.uploadAll(cloud);
    this.cloud = cloud; this.an = an;
    this.resetView();
  }

  resetView() {
    if (!this.cloud) return;
    const { lo, hi } = this.cloud.bounds(this.opts.minObs);
    if (!isFinite(lo[0])) return;
    this.target = [(lo[0] + hi[0]) / 2, this.an ? this.an.floorY : lo[1], (lo[2] + hi[2]) / 2];
    this.dist = Math.max(1, Math.hypot(hi[0] - lo[0], hi[2] - lo[2]) * 1.0);
    this.yaw = 0.7; this.pitch = 0.95;
    this.draw();
  }

  draw() {
    if (this._pending) return;
    this._pending = true;
    requestAnimationFrame(() => { this._pending = false; this._draw(); });
  }

  _draw() {
    const gl = this.gl, c = this.canvas;
    if (!gl) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
    if (!w || !h) return;
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    gl.viewport(0, 0, w, h);
    gl.clearColor(0.043, 0.07, 0.125, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!this.renderer) return;
    const cp = Math.cos(this.pitch);
    const eye = [this.target[0] + this.dist * cp * Math.sin(this.yaw), this.target[1] + this.dist * Math.sin(this.pitch), this.target[2] + this.dist * cp * Math.cos(this.yaw)];
    const proj = C.mat4Perspective(Math.PI / 3, w / h, Math.max(0.01, this.dist * 0.01), this.dist * 30 + 50);
    const view = C.mat4LookAt(eye, this.target, [0, 1, 0]);
    const an = this.an, o = this.opts;
    const b = an ? null : this.cloud.bounds(1);
    this.renderer.draw(proj, view, {
      size: this.cloud.voxel * 1.5 * proj[5] * h * 0.5 * o.sizeMul,
      minObs: o.minObs,
      clipY: o.cutCeiling && an ? an.ceilY - 0.12 : 1e9,
      mode: o.mode,
      yMin: an ? an.floorY : b.lo[1], yMax: an ? an.ceilY : b.hi[1],
    });
  }
}

// ---------------------------------------------------------------------------
// Results screen
// ---------------------------------------------------------------------------
let cloud = null, analysis = null, viewer = null, plan = null, source = 'scan';
const planOpts = () => ({ minObs: viewer.opts.minObs, sensitivity: +$('wallSens').value, bandLow: +$('bandLow').value });

async function openResults(c, meta = {}) {
  cloud = c; source = meta.source || 'scan';
  busy('Filtering noise…'); await nextFrame();
  cloud.computeSupport();
  const minObs = source === 'file' ? 1 : 3;
  viewer.opts.minObs = minObs; $('minObs').value = String(minObs);
  busy('Building floor plan…'); await nextFrame();
  analysis = C.analyzeFloorPlan(cloud, planOpts());
  show('results');
  selectTab('view3d');
  await nextFrame();
  viewer.setCloud(cloud, analysis);
  plan.setAnalysis(analysis);
  updateStats();
  busy(null);
}

let recomputeTimer = 0;
function recomputePlan() {
  clearTimeout(recomputeTimer);
  recomputeTimer = setTimeout(() => {
    analysis = C.analyzeFloorPlan(cloud, planOpts());
    viewer.an = analysis; viewer.draw();
    plan.setAnalysis(analysis, true);
    updateStats();
  }, 200);
}

function updateStats() {
  if (!cloud) return;
  const kept = cloud.countWithMinObs(viewer.opts.minObs);
  let s = `${fmtInt(kept)} points`;
  if (analysis) {
    s += ` · ~${analysis.area.toFixed(0)} m² floor seen`;
    if (analysis.ceilDetected) s += ` · ceiling ${(analysis.ceilY - analysis.floorY).toFixed(2)} m`;
  }
  $('stats').textContent = s;
  $('exportCount').textContent = `${fmtInt(kept)} points will be exported`;
  let info = '';
  if (analysis) {
    const wb = analysis.wallBounds, wM = wb.u1 - wb.u0, hM = wb.v1 - wb.v0;
    info = `Overall ${wM.toFixed(2)} × ${hM.toFixed(2)} m (${C.fmtFeet(wM)} × ${C.fmtFeet(hM)}) · floor seen ≈ ${analysis.area.toFixed(1)} m² (${(analysis.area * 10.7639).toFixed(0)} ft²)`;
    info += analysis.ceilDetected ? ` · ceiling ${C.fmtLen(analysis.ceilY - analysis.floorY)}` : ' · ceiling not detected';
    const m = plan.lastMeasure();
    if (m !== null) info += ` · last measure ${C.fmtLen(m)}`;
  } else info = 'Not enough wall data for a floor plan.';
  $('planInfo').textContent = info;
}

function selectTab(name) {
  for (const b of document.querySelectorAll('.tabs button')) b.classList.toggle('active', b.dataset.tab === name);
  for (const t of ['view3d', 'plan', 'export']) $('tab-' + t).classList.toggle('hidden', t !== name);
  if (name === 'view3d') viewer.draw();
  if (name === 'plan') requestAnimationFrame(() => plan.resize());
}

function exportOptions() {
  return {
    format: document.querySelector('input[name=fmt]:checked').value,
    up: document.querySelector('input[name=up]:checked').value,
    align: $('expAlign').checked,
    mirror: $('expMirror').checked,
  };
}

async function doExport() {
  const o = exportOptions();
  busy('Writing file…'); await nextFrame();
  try {
    const opt = { minObs: viewer.opts.minObs, align: o.align && !!analysis, analysis, up: o.up, mirror: o.mirror };
    const blob = o.format === 'xyz' ? C.exportXYZ(cloud, opt) : C.exportPLY(cloud, opt);
    download(blob, `housescan-${stamp()}.${o.format}`);
    toast(`Saved ${(blob.size / 1048576).toFixed(1)} MB to Downloads`);
  } catch (e) { toast('Export failed: ' + e.message); }
  busy(null);
}

function setPreset(fmt, up) {
  document.querySelector(`input[name=fmt][value=${fmt}]`).checked = true;
  document.querySelector(`input[name=up][value=${up}]`).checked = true;
}

// ---------------------------------------------------------------------------
// Demo & file loading
// ---------------------------------------------------------------------------
async function runDemo() {
  const c = new C.PointCloud(0.03, 1_000_000);
  busy('Simulating a walk through a 4-room house…');
  await nextFrame();
  let i = 0;
  for (const p of C.simulateScan(c)) {
    if (++i % 6 === 0) { $('busyText').textContent = `Simulating a scan… ${Math.round(p * 100)}%`; await nextFrame(); }
  }
  await openResults(c, { source: 'demo' });
}

async function openFile(file) {
  if (!file) return;
  busy('Reading ' + file.name + '…'); await nextFrame();
  try {
    const { count, pos, col, comments } = C.parsePLY(await file.arrayBuffer());
    C.normalizeLoadedAxes(pos, count, comments);
    const cnt = new Uint16Array(count).fill(1);
    await openResults(C.PointCloud.fromArrays(pos, col, cnt, count, S.voxel), { source: 'file' });
  } catch (e) { busy(null); toast('Could not open file: ' + e.message, 6000); }
}

async function openLast() {
  busy('Loading last scan…'); await nextFrame();
  try {
    const r = await loadLast(false);
    if (!r) { busy(null); return toast('No saved scan'); }
    await openResults(C.PointCloud.fromArrays(r.pos, r.col, r.cnt, r.count, r.voxel), { source: 'scan' });
  } catch (e) { busy(null); toast('Could not load: ' + e.message); }
}

// ---------------------------------------------------------------------------
// Wire up
// ---------------------------------------------------------------------------
function init() {
  bindSettings();
  viewer = new Viewer($('viewCanvas'));
  plan = new FloorPlanView($('planCanvas'));
  plan.onChange = updateStats;
  if (!viewer.gl) toast('WebGL2 not available — 3D view disabled');

  $('btnScan').onclick = startScan;
  $('btnDemo').onclick = runDemo;
  $('btnLast').onclick = openLast;
  $('filePly').onchange = (e) => openFile(e.target.files[0]);
  $('scan').addEventListener('beforexrselect', (e) => e.preventDefault());
  $('btnPause').onclick = () => { scan.paused = !scan.paused; $('btnPause').textContent = scan.paused ? 'Resume' : 'Pause'; };
  $('btnTogglePts').onclick = () => { scan.showPoints = !scan.showPoints; $('btnTogglePts').textContent = scan.showPoints ? 'Hide points' : 'Show points'; };
  $('btnFinish').onclick = () => scan.session && scan.session.end();
  $('btnDiscard').onclick = () => { if (scan.session && confirm('Discard this scan?')) { scan.discard = true; scan.session.end(); } };

  for (const b of document.querySelectorAll('.tabs button')) b.onclick = () => selectTab(b.dataset.tab);
  $('btnNew').onclick = () => { show('home'); refreshLastButton(); };

  $('ptSize').oninput = (e) => { viewer.opts.sizeMul = +e.target.value; viewer.draw(); };
  $('minObs').oninput = (e) => { viewer.opts.minObs = +e.target.value; viewer.draw(); updateStats(); recomputePlan(); };
  $('colorMode').onchange = (e) => { viewer.opts.mode = +e.target.value; viewer.draw(); };
  $('cutCeiling').onchange = (e) => { viewer.opts.cutCeiling = e.target.checked; viewer.draw(); };
  $('btnResetView').onclick = () => viewer.resetView();

  $('wallSens').oninput = recomputePlan;
  $('bandLow').oninput = (e) => { $('bandLowVal').textContent = (+e.target.value).toFixed(1) + ' m'; recomputePlan(); };
  $('btnMeasure').onclick = () => {
    plan.measure = !plan.measure;
    $('btnMeasure').classList.toggle('primary', plan.measure);
    $('btnMeasure').textContent = plan.measure ? 'Measuring: tap 2 points' : 'Measure';
  };
  $('btnClearMeasure').onclick = () => { plan.clearMeasure(); updateStats(); };
  $('btnFit').onclick = () => plan.fit();
  $('btnPlanPng').onclick = async () => {
    const blob = await plan.toPNG();
    if (blob) download(blob, `housescan-plan-${stamp()}.png`); else toast('No floor plan to export');
  };

  $('btnExport').onclick = doExport;
  $('presetUnreal').onclick = () => setPreset('xyz', 'z');
  $('presetBlender').onclick = () => setPreset('ply', 'z');
  $('presetUnity').onclick = () => setPreset('ply', 'y');

  checkSupport();
  refreshLastButton();
}

init();
