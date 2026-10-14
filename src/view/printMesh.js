// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 The Slicer Lab authors
// Renders the parsed G-code: every extrusion move becomes a small "bead" of plastic.
// All beads live in one big indexed mesh in G-code order, so showing "everything printed up to
// move m" (simulation) or "layers a..b" (preview) is just a draw range — very cheap.
import * as THREE from 'three';
import { KIND } from '../core/gcodeParser.js';
import { FEATURE_INFO } from '../core/features.js';

const VPS = 8; // vertices per segment (4-point cross-section at each end)
const IPS = 24; // indices per segment
const MAX_SEGMENTS = 900000;
// cross-section corners (side, up) and their normals
const XS = [[0, 0.5, 0, 1], [0.5, 0, 1, 0], [0, -0.5, 0, -1], [-0.5, 0, -1, 0]];

// sequential ramp (light → dark blue) used for speed and layer time
export const SEQ_RAMP = ['#b7d3f6', '#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#104281', '#0d366b'];
export const STATUS = { ok: '#b9b8b1', bridge: '#fab219', air: '#d03b3b' };

// THREE.Color converts hex (sRGB) to linear; vertex colours are stored linear.
const rgb = (hex) => new THREE.Color(hex);
function rampColor(t) {
  t = Math.max(0, Math.min(1, t)) * (SEQ_RAMP.length - 1);
  const i = Math.min(SEQ_RAMP.length - 2, Math.floor(t));
  return rgb(SEQ_RAMP[i]).lerp(rgb(SEQ_RAMP[i + 1]), t - i);
}

export class PrintMesh {
  constructor(scene3d) {
    this.s = scene3d;
    this.group = scene3d.printGroup;
    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.0, side: THREE.DoubleSide });
    this.travelMat = new THREE.LineBasicMaterial({ color: 0x5b8def, transparent: true, opacity: 0.45 });
    this.retractMat = new THREE.PointsMaterial({ color: 0x6250d6, size: 5, sizeAttenuation: false });
    this.unretractMat = new THREE.PointsMaterial({ color: 0x0ca30c, size: 4, sizeAttenuation: false });
    this.mesh = null;
    this.partial = null;
    this.colorMode = 'feature';
    this.filamentColor = '#eb6834';
  }

  dispose() {
    for (const o of [this.mesh, this.partial, this.travel, this.retracts, this.unretracts]) {
      if (o) {
        this.group.remove(o);
        o.geometry.dispose();
      }
    }
    this.mesh = this.partial = this.travel = this.retracts = this.unretracts = null;
  }

  /** Build all geometry for a parsed G-code. `sag` bends lines printed over air downward. */
  build(P, A, { sag = true } = {}) {
    this.s.invalidate?.();
    this.dispose();
    this.P = P;
    this.A = A;
    this.sag = sag;
    const n = P.n;
    const segBefore = new Uint32Array(n + 1);
    const travelBefore = new Uint32Array(n + 1);
    let segs = 0, travels = 0;
    // very large prints are drawn as thin lines instead of 3D beads to save memory
    let extrusions = 0;
    for (let m = 0; m < n; m++) if (P.kind[m] === KIND.EXTRUDE) extrusions++;
    this.lineMode = extrusions > MAX_SEGMENTS;
    this.vps = this.lineMode ? 2 : VPS;
    const useSag = (m) => !this.lineMode && sag && A && A.sagStart[m] >= 0;
    for (let m = 0; m < n; m++) {
      segBefore[m] = segs;
      travelBefore[m] = travels;
      if (P.kind[m] === KIND.EXTRUDE) segs += useSag(m) ? A.sagCount[m] - 1 : 1;
      else if (P.kind[m] === KIND.TRAVEL) travels++;
    }
    segBefore[n] = segs;
    travelBefore[n] = travels;
    this.segBefore = segBefore;
    this.travelBefore = travelBefore;
    this.tooBig = false;
    if (this.lineMode) return this.buildLines(P, segs, travels);

    const pos = new Float32Array(segs * VPS * 3);
    const nrm = new Int8Array(segs * VPS * 3);
    const col = new Uint8Array(segs * VPS * 3);
    const idx = new Uint32Array(segs * IPS);
    const tpos = new Float32Array(travels * 6);
    const rpos = [], upos = [];

    let s = 0, t = 0;
    for (let m = 0; m < n; m++) {
      const k = P.kind[m];
      if (k === KIND.EXTRUDE) {
        const h = P.layers[P.layer[m]] ? P.layers[P.layer[m]].h || 0.2 : 0.2;
        const w = P.width[m] || 0.4;
        if (useSag(m)) {
          const c = A.sagCount[m], o = A.sagStart[m];
          for (let i = 0; i < c - 1; i++) {
            const f0 = i / (c - 1), f1 = (i + 1) / (c - 1);
            const p0 = lerpMove(P, m, f0), p1 = lerpMove(P, m, f1);
            writeBead(pos, nrm, idx, s++, p0[0], p0[1], p0[2] - A.sagValues[o + i], p1[0], p1[1], p1[2] - A.sagValues[o + i + 1], w, h, i === 0, i === c - 2);
          }
        } else {
          writeBead(pos, nrm, idx, s++, P.px[m], P.py[m], P.pz[m + 1], P.px[m + 1], P.py[m + 1], P.pz[m + 1], w, h, true, true);
        }
      } else if (k === KIND.TRAVEL) {
        tpos.set([P.px[m], P.py[m], P.pz[m], P.px[m + 1], P.py[m + 1], P.pz[m + 1]], t * 6);
        t++;
      } else if (k === KIND.RETRACT) {
        (P.e[m] < 0 ? rpos : upos).push(P.px[m + 1], P.py[m + 1], P.pz[m + 1] + 0.3);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3, true));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3, true));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeBoundingSphere();
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);

    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(tpos, 3));
    this.travel = new THREE.LineSegments(tg, this.travelMat);
    this.travel.frustumCulled = false;
    this.travel.visible = false;
    this.group.add(this.travel);

    // retraction points: where filament is pulled back (purple) and pushed again (green)
    const mkPoints = (arr, mat) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      const p = new THREE.Points(g, mat);
      p.visible = false;
      p.frustumCulled = false;
      this.group.add(p);
      return p;
    };
    this.retracts = mkPoints(rpos, this.retractMat);
    this.unretracts = mkPoints(upos, this.unretractMat);
    // index of retraction points per move, for draw ranges
    this.retractBefore = new Uint32Array(n + 1);
    this.unretractBefore = new Uint32Array(n + 1);
    let rc = 0, uc = 0;
    for (let m = 0; m < n; m++) {
      this.retractBefore[m] = rc;
      this.unretractBefore[m] = uc;
      if (P.kind[m] === KIND.RETRACT) P.e[m] < 0 ? rc++ : uc++;
    }
    this.retractBefore[n] = rc;
    this.unretractBefore[n] = uc;

    // a small mesh for the line currently being printed (grows every frame)
    const pg = new THREE.BufferGeometry();
    const cap = 600;
    pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cap * VPS * 3), 3));
    pg.setAttribute('normal', new THREE.BufferAttribute(new Int8Array(cap * VPS * 3), 3, true));
    pg.setAttribute('color', new THREE.BufferAttribute(new Uint8Array(cap * VPS * 3), 3, true));
    pg.setIndex(new THREE.BufferAttribute(new Uint32Array(cap * IPS), 1));
    pg.setDrawRange(0, 0);
    this.partial = new THREE.Mesh(pg, this.material);
    this.partial.frustumCulled = false;
    this.partialCap = cap;
    this.group.add(this.partial);

    this.applyColors();
  }

  /** Lightweight geometry for huge prints: one coloured line per extrusion move. */
  buildLines(P, segs, travels) {
    const pos = new Float32Array(segs * 6);
    const col = new Uint8Array(segs * 6);
    const tpos = new Float32Array(travels * 6);
    let s = 0, t = 0;
    for (let m = 0; m < P.n; m++) {
      if (P.kind[m] === KIND.EXTRUDE) pos.set([P.px[m], P.py[m], P.pz[m + 1], P.px[m + 1], P.py[m + 1], P.pz[m + 1]], 6 * s++);
      else if (P.kind[m] === KIND.TRAVEL) tpos.set([P.px[m], P.py[m], P.pz[m], P.px[m + 1], P.py[m + 1], P.pz[m + 1]], 6 * t++);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3, true));
    this.mesh = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true }));
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(tpos, 3));
    this.travel = new THREE.LineSegments(tg, this.travelMat);
    this.travel.frustumCulled = false;
    this.travel.visible = false;
    this.group.add(this.travel);
    this.applyColors();
  }

  /** Colour of move m in the current colour mode, as linear RGB. */
  moveColor(m) {
    const P = this.P, A = this.A;
    switch (this.colorMode) {
      case 'speed':
        return rampColor((actualSpeed(P, m) - this.speedRange[0]) / Math.max(1, this.speedRange[1] - this.speedRange[0]));
      case 'layertime': {
        const L = P.layers[P.layer[m]];
        return rampColor((L ? L.time : 0) / Math.max(1, this.layerTimeMax));
      }
      case 'overair':
        if (!A || !A.overAir[m]) return this._ok;
        return A.isBridge[m] ? this._bridge : this._air;
      case 'filament':
        return this._fil;
      default:
        return this._feature[P.type[m]] || this._feature[0];
    }
  }

  setColorMode(mode) {
    this.colorMode = mode;
    this.applyColors();
  }

  setFilamentColor(hex) {
    this.filamentColor = hex;
    if (this.colorMode === 'filament') this.applyColors();
  }

  applyColors() {
    if (!this.mesh) return;
    this.s.invalidate?.();
    const P = this.P;
    this._feature = FEATURE_INFO.map((f) => rgb(f.color));
    this._ok = rgb(STATUS.ok);
    this._bridge = rgb(STATUS.bridge);
    this._air = rgb(STATUS.air);
    this._fil = rgb(this.filamentColor);
    let lo = Infinity, hi = 0, tmax = 0;
    for (let m = 0; m < P.n; m++) {
      if (P.kind[m] !== KIND.EXTRUDE) continue;
      const v = actualSpeed(P, m);
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    for (let i = 1; i < P.layers.length; i++) tmax = Math.max(tmax, P.layers[i].time);
    this.speedRange = [isFinite(lo) ? lo : 0, hi];
    this.layerTimeMax = tmax;
    const col = this.mesh.geometry.attributes.color.array;
    for (let m = 0; m < P.n; m++) {
      if (P.kind[m] !== KIND.EXTRUDE) continue;
      const c = this.moveColor(m);
      const r = Math.round(c.r * 255), g = Math.round(c.g * 255), b = Math.round(c.b * 255);
      for (let s = this.segBefore[m]; s < this.segBefore[m + 1]; s++) {
        for (let v = 0; v < this.vps; v++) {
          const o = (s * this.vps + v) * 3;
          col[o] = r;
          col[o + 1] = g;
          col[o + 2] = b;
        }
      }
    }
    this.mesh.geometry.attributes.color.needsUpdate = true;
  }

  legend() {
    switch (this.colorMode) {
      case 'speed':
        return { kind: 'ramp', title: 'Actual speed (incl. acceleration)', min: `${Math.round(this.speedRange?.[0] || 0)} mm/s`, max: `${Math.round(this.speedRange?.[1] || 0)} mm/s` };
      case 'layertime':
        return { kind: 'ramp', title: 'Layer time', min: '0 s', max: `${Math.round(this.layerTimeMax || 0)} s` };
      case 'overair':
        return {
          kind: 'cat', title: 'Printed over air?', items: [
            { color: STATUS.ok, label: 'Resting on the layer below' },
            { color: STATUS.bridge, label: 'Bridge (both ends supported)' },
            { color: STATUS.air, label: 'Over air → sags / needs support' },
          ],
        };
      case 'filament':
        return null;
      default: {
        const used = new Set();
        if (this.P) for (let m = 0; m < this.P.n; m++) if (this.P.kind[m] === KIND.EXTRUDE) used.add(this.P.type[m]);
        return { kind: 'cat', title: 'Feature type', items: FEATURE_INFO.filter((f) => used.has(f.code)).map((f) => ({ color: f.color, label: f.label })) };
      }
    }
  }

  /**
   * Show only moves in [m0, m1), optionally with a partially printed move m1 up to fraction f.
   * Travel moves and retractions are shown from move `tFrom` (e.g. only the current layer).
   */
  showRange(m0, m1, partialFrac = 0, showTravel = false, tFrom = m0) {
    if (!this.mesh) return;
    this.s.invalidate?.();
    const P = this.P;
    const s0 = this.segBefore[m0], s1 = this.segBefore[m1];
    if (this.lineMode) {
      this.mesh.geometry.setDrawRange(s0 * 2, (s1 - s0) * 2);
      const t0 = this.travelBefore[tFrom];
      this.travel.visible = showTravel;
      this.travel.geometry.setDrawRange(t0 * 2, (this.travelBefore[m1] - t0) * 2);
      return;
    }
    this.mesh.geometry.setDrawRange(s0 * IPS, (s1 - s0) * IPS);
    const t0 = this.travelBefore[tFrom], t1 = this.travelBefore[m1];
    this.travel.visible = showTravel;
    this.travel.geometry.setDrawRange(t0 * 2, (t1 - t0) * 2);
    this.retracts.visible = this.unretracts.visible = showTravel;
    this.retracts.geometry.setDrawRange(this.retractBefore[tFrom], this.retractBefore[m1] - this.retractBefore[tFrom]);
    this.unretracts.geometry.setDrawRange(this.unretractBefore[tFrom], this.unretractBefore[m1] - this.unretractBefore[tFrom]);

    // partially printed current move
    const pg = this.partial.geometry;
    pg.setDrawRange(0, 0);
    if (m1 < P.n && P.kind[m1] === KIND.EXTRUDE && partialFrac > 0) {
      const A = this.A;
      const h = P.layers[P.layer[m1]] ? P.layers[P.layer[m1]].h || 0.2 : 0.2;
      const w = P.width[m1] || 0.4;
      const pos = pg.attributes.position.array, nrm = pg.attributes.normal.array, idx = pg.index.array, col = pg.attributes.color.array;
      const sagging = this.sag && A && A.sagStart[m1] >= 0;
      const c = sagging ? A.sagCount[m1] : 2, o = sagging ? A.sagStart[m1] : 0;
      const sagAt = (f) => {
        if (!sagging) return 0;
        const x = f * (c - 1), i = Math.min(c - 2, Math.floor(x));
        return A.sagValues[o + i] + (A.sagValues[o + i + 1] - A.sagValues[o + i]) * (x - i);
      };
      let count = 0;
      const steps = Math.min(this.partialCap, c - 1);
      for (let i = 0; i < steps; i++) {
        const f0 = i / steps;
        if (f0 >= partialFrac) break;
        const f1 = Math.min(partialFrac, (i + 1) / steps);
        const p0 = lerpMove(P, m1, f0), p1 = lerpMove(P, m1, f1);
        writeBead(pos, nrm, idx, count++, p0[0], p0[1], p0[2] - sagAt(f0), p1[0], p1[1], p1[2] - sagAt(f1), w, h, i === 0, false);
      }
      const cc = this.moveColor(m1);
      for (let v = 0; v < count * VPS; v++) {
        col[v * 3] = cc.r * 255;
        col[v * 3 + 1] = cc.g * 255;
        col[v * 3 + 2] = cc.b * 255;
      }
      pg.attributes.position.needsUpdate = pg.attributes.normal.needsUpdate = pg.attributes.color.needsUpdate = true;
      pg.index.needsUpdate = true;
      pg.setDrawRange(0, count * IPS);
    }
  }
}

/** Average speed the printer really reaches on move m (length / planned duration). */
function actualSpeed(P, m) {
  const len = Math.hypot(P.px[m + 1] - P.px[m], P.py[m + 1] - P.py[m]);
  return P.dur[m] > 0 ? len / P.dur[m] : P.feed[m];
}

function lerpMove(P, m, f) {
  return [
    P.px[m] + (P.px[m + 1] - P.px[m]) * f,
    P.py[m] + (P.py[m + 1] - P.py[m]) * f,
    P.pz[m + 1],
  ];
}

/** Write one bead segment from A to B (z = top of the bead) into the buffers at slot s. */
function writeBead(pos, nrm, idx, s, ax, ay, az, bx, by, bz, w, h, extA, extB) {
  let dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy) || 1e-6;
  dx /= len;
  dy /= len;
  const sx = -dy, sy = dx;
  const ext = w * 0.3; // overlap at the ends hides gaps at corners
  const ends = [
    [ax - (extA ? dx * ext : 0), ay - (extA ? dy * ext : 0), az - h / 2],
    [bx + (extB ? dx * ext : 0), by + (extB ? dy * ext : 0), bz - h / 2],
  ];
  const v0 = s * VPS;
  for (let e = 0; e < 2; e++) {
    const [cx, cy, cz] = ends[e];
    for (let k = 0; k < 4; k++) {
      const o = (v0 + e * 4 + k) * 3;
      const [side, up, ns, nu] = XS[k];
      pos[o] = cx + sx * side * w;
      pos[o + 1] = cy + sy * side * w;
      pos[o + 2] = cz + up * h;
      nrm[o] = Math.round(sx * ns * 127);
      nrm[o + 1] = Math.round(sy * ns * 127);
      nrm[o + 2] = Math.round(nu * 127);
    }
  }
  const i0 = s * IPS;
  for (let k = 0; k < 4; k++) {
    const k2 = (k + 1) % 4;
    const a0 = v0 + k, a1 = v0 + k2, b0 = v0 + 4 + k, b1 = v0 + 4 + k2;
    idx.set([a0, b0, b1, a0, b1, a1], i0 + k * 6);
  }
}
