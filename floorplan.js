// Blueprint-style top-down floor plan with pan / pinch-zoom and tap-to-measure.
import { fmtFeet } from './core.js';

const BG = '#0d3270', GRID_MINOR = 'rgba(255,255,255,0.07)', GRID_MAJOR = 'rgba(255,255,255,0.16)';
const INK = '#ffffff', ACCENT = '#ffd166';

function buildImage(an) {
  const c = document.createElement('canvas');
  c.width = an.W; c.height = an.H;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(an.W, an.H);
  const d = img.data;
  for (let i = 0; i < an.W * an.H; i++) {
    const w = an.wall[i], f = an.floor[i], o = i * 4;
    if (w >= an.thr) { d[o] = 255; d[o + 1] = 255; d[o + 2] = 255; d[o + 3] = 255; }
    else if (w > 0) { d[o] = 200; d[o + 1] = 220; d[o + 2] = 255; d[o + 3] = 55 + Math.min(120, (w / an.thr) * 120); }
    else if (f > 0) { d[o] = 120; d[o + 1] = 175; d[o + 2] = 255; d[o + 3] = 60; }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export class FloorPlanView {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.an = null; this.img = null;
    this.scale = 50; this.ox = 0; this.oy = 0;
    this.measure = false;
    this.pts = [];
    this.pointers = new Map();
    this.onChange = null;
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(canvas);
    canvas.addEventListener('pointerdown', (e) => this._down(e));
    canvas.addEventListener('pointermove', (e) => this._move(e));
    canvas.addEventListener('pointerup', (e) => this._up(e));
    canvas.addEventListener('pointercancel', (e) => this._up(e, true));
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      this._zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.cw = r.width; this.ch = r.height;
    this.canvas.width = Math.round(r.width * dpr); this.canvas.height = Math.round(r.height * dpr);
    this.dpr = dpr;
    if (this.an && !this._fitted) this.fit();
    this.draw();
  }

  setAnalysis(an, keepView = false) {
    this.an = an;
    this.img = an ? buildImage(an) : null;
    if (!keepView) { this.pts = []; this._fitted = false; this.fit(); }
    this.draw();
  }

  fit() {
    if (!this.an || !this.cw) return;
    const wb = this.an.wallBounds;
    const w = wb.u1 - wb.u0, h = wb.v1 - wb.v0;
    const pad = 56; // px for dimension labels
    this.scale = Math.min((this.cw - 2 * pad) / w, (this.ch - 2 * pad) / h);
    this.ox = this.cw / 2 - ((wb.u0 + wb.u1) / 2) * this.scale;
    this.oy = this.ch / 2 - ((wb.v0 + wb.v1) / 2) * this.scale;
    this._fitted = true;
    this.draw();
  }

  clearMeasure() { this.pts = []; this.draw(); }

  // ---- interaction
  _local(e) { const r = this.canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  _down(e) {
    this.canvas.setPointerCapture(e.pointerId);
    const p = this._local(e);
    this.pointers.set(e.pointerId, p);
    if (this.pointers.size === 1) { this.tap = { ...p, moved: false }; }
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, scale: this.scale, ox: this.ox, oy: this.oy };
      this.tap = null;
    }
  }
  _move(e) {
    if (!this.pointers.has(e.pointerId)) return;
    const prev = this.pointers.get(e.pointerId), p = this._local(e);
    this.pointers.set(e.pointerId, p);
    if (this.pointers.size === 2 && this.pinch) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const pz = this.pinch;
      const s = Math.max(5, Math.min(2000, pz.scale * (d / pz.d)));
      const pu = (pz.mx - pz.ox) / pz.scale, pv = (pz.my - pz.oy) / pz.scale;
      this.scale = s; this.ox = mx - pu * s; this.oy = my - pv * s;
      this.draw();
    } else if (this.pointers.size === 1) {
      if (this.tap && Math.hypot(p.x - this.tap.x, p.y - this.tap.y) > 8) this.tap.moved = true;
      if (!this.tap || this.tap.moved) { this.ox += p.x - prev.x; this.oy += p.y - prev.y; this.draw(); }
    }
  }
  _up(e, cancel) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    if (!cancel && this.tap && !this.tap.moved && this.pointers.size === 0 && this.measure && this.an) {
      this.pts.push({ u: (this.tap.x - this.ox) / this.scale, v: (this.tap.y - this.oy) / this.scale });
      this.draw();
      if (this.onChange) this.onChange();
    }
    if (this.pointers.size === 0) this.tap = null;
  }
  _zoomAt(x, y, f) {
    const s = Math.max(5, Math.min(2000, this.scale * f));
    const pu = (x - this.ox) / this.scale, pv = (y - this.oy) / this.scale;
    this.scale = s; this.ox = x - pu * s; this.oy = y - pv * s;
    this.draw();
  }

  /** Last completed measurement (pair of taps), in metres. */
  lastMeasure() {
    const n = this.pts.length - (this.pts.length % 2);
    if (n < 2) return null;
    const a = this.pts[n - 2], b = this.pts[n - 1];
    return Math.hypot(a.u - b.u, a.v - b.v);
  }

  draw() {
    if (!this.cw) return;
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this._render(ctx, this.cw, this.ch, this.scale, this.ox, this.oy, true);
  }

  _render(ctx, W, H, scale, ox, oy, interactive) {
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);
    const an = this.an;
    if (!an) {
      ctx.fillStyle = INK; ctx.font = '15px system-ui'; ctx.textAlign = 'center';
      ctx.fillText('Not enough wall data for a floor plan yet', W / 2, H / 2);
      return;
    }
    // grid (metres)
    const u0 = -ox / scale, u1 = (W - ox) / scale, v0 = -oy / scale, v1 = (H - oy) / scale;
    const minor = scale > 60 ? 0.5 : scale > 15 ? 1 : 5, major = minor * (minor === 0.5 ? 2 : 5);
    for (const [stepM, style] of [[minor, GRID_MINOR], [major, GRID_MAJOR]]) {
      ctx.strokeStyle = style; ctx.lineWidth = 1; ctx.beginPath();
      for (let u = Math.ceil(u0 / stepM) * stepM; u <= u1; u += stepM) { const x = Math.round(ox + u * scale) + 0.5; ctx.moveTo(x, 0); ctx.lineTo(x, H); }
      for (let v = Math.ceil(v0 / stepM) * stepM; v <= v1; v += stepM) { const y = Math.round(oy + v * scale) + 0.5; ctx.moveTo(0, y); ctx.lineTo(W, y); }
      ctx.stroke();
    }
    // raster plan
    const pxPerCell = scale * an.cell;
    ctx.imageSmoothingEnabled = pxPerCell < 2.5;
    ctx.drawImage(this.img, ox, oy, an.W * pxPerCell, an.H * pxPerCell);

    // overall dimensions
    const wb = an.wallBounds;
    const X0 = ox + wb.u0 * scale, X1 = ox + wb.u1 * scale, Y0 = oy + wb.v0 * scale, Y1 = oy + wb.v1 * scale;
    ctx.strokeStyle = ACCENT; ctx.fillStyle = ACCENT; ctx.lineWidth = 1.2;
    ctx.font = '600 12px system-ui';
    const dimY = Y0 - 18, dimX = X0 - 18;
    ctx.beginPath();
    ctx.moveTo(X0, dimY); ctx.lineTo(X1, dimY);
    ctx.moveTo(X0, dimY - 5); ctx.lineTo(X0, dimY + 5); ctx.moveTo(X1, dimY - 5); ctx.lineTo(X1, dimY + 5);
    ctx.moveTo(dimX, Y0); ctx.lineTo(dimX, Y1);
    ctx.moveTo(dimX - 5, Y0); ctx.lineTo(dimX + 5, Y0); ctx.moveTo(dimX - 5, Y1); ctx.lineTo(dimX + 5, Y1);
    ctx.stroke();
    const wM = wb.u1 - wb.u0, hM = wb.v1 - wb.v0;
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(`${wM.toFixed(2)} m · ${fmtFeet(wM)}`, (X0 + X1) / 2, dimY - 4);
    ctx.save(); ctx.translate(dimX - 4, (Y0 + Y1) / 2); ctx.rotate(-Math.PI / 2);
    ctx.fillText(`${hM.toFixed(2)} m · ${fmtFeet(hM)}`, 0, 0); ctx.restore();

    // measurements
    ctx.lineWidth = 2;
    for (let i = 0; i < this.pts.length; i++) {
      const p = this.pts[i], x = ox + p.u * scale, y = oy + p.v * scale;
      ctx.fillStyle = '#ff5d73';
      ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
      if (i % 2 === 1) {
        const a = this.pts[i - 1], ax = ox + a.u * scale, ay = oy + a.v * scale;
        ctx.strokeStyle = '#ff5d73'; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(x, y); ctx.stroke();
        const m = Math.hypot(p.u - a.u, p.v - a.v);
        const label = `${m.toFixed(2)} m · ${fmtFeet(m)}`;
        ctx.font = '600 13px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const tw = ctx.measureText(label).width + 10, mx = (ax + x) / 2, my = (ay + y) / 2 - 14;
        ctx.fillStyle = 'rgba(0,0,0,0.65)'; ctx.fillRect(mx - tw / 2, my - 10, tw, 20);
        ctx.fillStyle = '#fff'; ctx.fillText(label, mx, my);
      }
    }

    // scale bar
    const barM = scale > 120 ? 0.5 : scale > 30 ? 1 : scale > 8 ? 5 : 10;
    const bx = 14, by = H - 18;
    ctx.strokeStyle = INK; ctx.fillStyle = INK; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + barM * scale, by);
    ctx.moveTo(bx, by - 5); ctx.lineTo(bx, by + 5); ctx.moveTo(bx + barM * scale, by - 5); ctx.lineTo(bx + barM * scale, by + 5); ctx.stroke();
    ctx.font = '12px system-ui'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText(`${barM} m`, bx, by - 6);
    if (!interactive) {
      ctx.textAlign = 'right';
      ctx.fillText(`HouseScan · ${new Date().toLocaleDateString()} · ceiling ${an.ceilY - an.floorY > 0 ? (an.ceilY - an.floorY).toFixed(2) + ' m' : '?'}`, W - 14, by + 4);
    }
  }

  /** High-resolution PNG of the plan (100 px per metre by default). */
  toPNG(pxPerM = 100) {
    const an = this.an;
    if (!an) return Promise.resolve(null);
    const wb = an.wallBounds, pad = 1.2;
    let s = pxPerM;
    const wM = wb.u1 - wb.u0 + 2 * pad, hM = wb.v1 - wb.v0 + 2 * pad;
    s = Math.min(s, 8000 / wM, 8000 / hM);
    const c = document.createElement('canvas');
    c.width = Math.round(wM * s); c.height = Math.round(hM * s);
    const ox = (pad - wb.u0) * s, oy = (pad - wb.v0) * s;
    this._render(c.getContext('2d'), c.width, c.height, s, ox, oy, false);
    return new Promise((res) => c.toBlob(res, 'image/png'));
  }
}
