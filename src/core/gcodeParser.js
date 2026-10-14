// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 The Slicer Lab authors
// G-code parser + "virtual printer". Reads G-code text and produces a timeline of moves that the
// viewer and the simulator use. Times come from a firmware-style motion planner (planner.js),
// a first-order heater model and realistic homing/levelling durations of the selected printer.
// Works for G-code from this app and from other slicers (PrusaSlicer, Cura, Orca…).
import { FEATURE, featureFromComment } from './features.js';
import { MotionPlanner, machineFromProfile } from './planner.js';

export const KIND = { TRAVEL: 0, EXTRUDE: 1, RETRACT: 2, WAIT: 3, HOME: 4 };
export const AMBIENT = 22; // °C

// Used when no printer is given (e.g. tests): Prusa MK3S limits.
export const DEFAULT_MACHINE = {
  flavor: 'marlin',
  limits: {
    maxFeed: [200, 200, 12, 120], maxAccel: [1000, 1000, 200, 5000], jerk: [8, 8, 0.4, 4.5],
    printAccel: 1250, retractAccel: 1250, travelAccel: 1250, maxPrintAccel: 1250, maxRetractAccel: 1250, maxTravelAccel: 0,
  },
  heaters: { nozzle: { max: 400, tau: 120, cool: 160, residency: 3 }, bed: { max: 140, tau: 400, cool: 900, residency: 3 } },
  homing: { parked: [0, 0, 0], feedXY: 50, feedZ: 12, settle: 6 },
  commandTimes: { G29: 60, G80: 55 },
  filamentDiameter: 1.75,
};

// ---------------------------------------------------------------- heater model
// While heating, the heater runs at full power and the temperature approaches `max` exponentially
// (time constant `tau`); it stops at the target. Cooling approaches room temperature (`cool`).
function heaterAdvance(h, T, target, dt) {
  if (dt <= 0) return T;
  const goal = Math.max(target, AMBIENT);
  if (T < goal) {
    const Tn = h.max - (h.max - T) * Math.exp(-dt / h.tau);
    return Math.min(goal, Tn);
  }
  if (T > goal) {
    const Tn = AMBIENT + (T - AMBIENT) * Math.exp(-dt / h.cool);
    return Math.max(goal, Tn);
  }
  return T;
}

/** Seconds to heat from T to target at full power (0 if already there). */
export function heatingTime(h, T, target) {
  if (T >= target) return 0;
  if (target >= h.max - 1) return Infinity;
  return h.tau * Math.log((h.max - T) / (h.max - target));
}

/** Temperature of a heater at time t, replaying the target-change events [{t, target}]. */
export function temperatureAt(events, h, t) {
  let T = AMBIENT, target = 0, last = 0;
  for (const ev of events) {
    if (ev.t > t) break;
    T = heaterAdvance(h, T, target, ev.t - last);
    last = ev.t;
    target = ev.target;
  }
  return { temp: heaterAdvance(h, T, target, t - last), target };
}

/** Value of the most recent event at time t (fan speed). */
export function valueAt(events, t, initial = 0) {
  let v = initial;
  for (const ev of events) {
    if (ev.t > t) break;
    v = ev.value;
  }
  return v;
}

/** "1d 2h 3m 4s" → seconds */
function parseDuration(s) {
  let sec = 0, found = false;
  const re = /(\d+(?:\.\d+)?)\s*(d|h|m|s)/gi;
  let m;
  while ((m = re.exec(s))) {
    found = true;
    sec += parseFloat(m[1]) * { d: 86400, h: 3600, m: 60, s: 1 }[m[2].toLowerCase()];
  }
  return found ? sec : null;
}

// Planner synchronisation (G4, G28, G92 without E, M400…), the move types that choose print /
// travel / retract acceleration, and the comment formats read from other slicers' files follow
// PrusaSlicer's GCodeProcessor (AGPL-3.0, Prusa Research) — see THIRD_PARTY_NOTICES.md.
const KNOWN = new Set(['G0', 'G1', 'G2', 'G3', 'G4', 'G10', 'G11', 'G20', 'G21', 'G28', 'G29', 'G80', 'G90', 'G91', 'G92',
  'M0', 'M1', 'M17', 'M18', 'M73', 'M82', 'M83', 'M84', 'M104', 'M105', 'M106', 'M107', 'M109', 'M110', 'M115', 'M117', 'M118',
  'M140', 'M190', 'M201', 'M203', 'M204', 'M205', 'M220', 'M221', 'M400', 'M862', 'M900', 'M907', 'T0']);

// ---------------------------------------------------------------- parser
export function parseGcode(text, opts = {}) {
  const machine = opts.machine || DEFAULT_MACHINE;
  const filamentArea = Math.PI * ((machine.filamentDiameter || opts.filamentDiameter || 1.75) / 2) ** 2;
  const lines = text.split('\n');
  const layerMode = text.includes(';LAYER:') ? 'comment' : text.includes(';LAYER_CHANGE') ? 'change' : 'z';

  // growable move storage
  const parked = machine.homing?.parked || [0, 0, 0];
  const px = [parked[0]], py = [parked[1]], pz = [parked[2]];
  const E = [], F = [], K = [], TY = [], LA = [], LN = [], DUR = [], W = [];
  const V0 = [], VC = [], AC = [], AU = [], DA = []; // planner profile per move (entry, peak, accel, accel-until, decel-after)
  const T0 = [];
  const layers = []; // { z, h, first, firstExtrusion, time }

  let x = parked[0], y = parked[1], z = parked[2], e = 0, feed = 1500 / 60;
  let absXYZ = true, absE = true, units = 1;
  let type = FEATURE.OTHER;
  let layer = -1;
  let wiping = false;
  let eSum = 0;

  const tempEvents = { nozzle: [], bed: [] }; // { move, target } → t resolved later
  const fanEvents = [];
  const unknown = new Map();
  const info = { generator: null, printerModel: null, estimate: null, estimateSource: null, filamentMm: null };
  const stats = {
    time: 0, motionTime: 0, heatTime: 0, homeTime: 0, dwellTime: 0,
    filament: 0, extrudeDist: 0, travelDist: 0, retractions: 0,
    timeByType: new Float64Array(8), filamentByType: new Float64Array(8),
    min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity],
  };

  // ---- the clock: planner moves get their duration when the planner finalises them
  let clock = 0, synced = 0;
  const planner = new MotionPlanner(machineFromProfile({ ...machine.limits, flavor: machine.flavor }), (id, sec, b) => {
    DUR[id] = sec;
    V0[id] = b.entry; VC[id] = b.vCruise; AC[id] = b.accel; AU[id] = b.accUntil; DA[id] = b.decAfter;
  });
  const sync = () => {
    planner.sync();
    for (let i = synced; i < K.length; i++) {
      T0[i] = clock;
      if (!(DUR[i] >= 0)) DUR[i] = 0;
      clock += DUR[i];
    }
    synced = K.length;
  };
  const eventTime = (ev) => (ev.move < synced ? T0[ev.move] : clock);
  const resolved = (list) => list.map((ev) => ({ t: eventTime(ev), target: ev.target, value: ev.value }));

  // Extrusions before the first layer marker (e.g. a prime line) go into a provisional layer 0
  // that the first marker then takes over, so layer numbers match the slicer's.
  let provisional = false;
  const startLayer = (zz) => {
    if (provisional) {
      provisional = false;
      const L = layers[layers.length - 1];
      L.firstExtrusion = -1;
      L.z = zz;
      return;
    }
    layer++;
    layers.push({ z: zz, h: 0, first: K.length, firstExtrusion: -1, time: 0, hint: 0 });
  };
  const curLayer = () => (layer < 0 ? 0 : layer);

  const pushMove = (nx, ny, nz, de, kind, lineNo, dur) => {
    px.push(nx); py.push(ny); pz.push(nz);
    E.push(de); F.push(feed); K.push(kind); TY.push(type); LA.push(curLayer()); LN.push(lineNo);
    DUR.push(dur); W.push(0); V0.push(0); VC.push(0); AC.push(0); AU.push(0); DA.push(0);
    return K.length - 1;
  };

  const linearMove = (nx, ny, nz, ne, lineNo) => {
    const dx = nx - x, dy = ny - y, dz = nz - z, de = ne - e;
    const dxy = Math.hypot(dx, dy);
    const dist = Math.hypot(dxy, dz);
    if (dist === 0 && de === 0) return;
    let kind;
    if (dist === 0) kind = KIND.RETRACT;
    else if (de > 0 && dxy > 0) kind = KIND.EXTRUDE;
    else kind = KIND.TRAVEL;

    if (kind === KIND.EXTRUDE && layerMode === 'z' && (layer < 0 || Math.abs(nz - layers[layers.length - 1].z) > 1e-4)) startLayer(nz);
    if (kind === KIND.EXTRUDE && layer < 0) {
      startLayer(nz);
      provisional = layerMode !== 'z';
    }

    const id = pushMove(nx, ny, nz, de, kind, lineNo, NaN);
    // classification the firmware uses to pick the acceleration
    const pkind = wiping && dist > 0 ? 'wipe' : kind === KIND.EXTRUDE ? 'extrude' : kind === KIND.RETRACT ? 'retract' : (de < 0 || de === 0 || dxy === 0) ? 'travel' : 'extrude';
    planner.add([dx, dy, dz, de], feed, pkind, id);

    if (kind === KIND.EXTRUDE) {
      const L = layers[layers.length - 1];
      if (L.firstExtrusion < 0) {
        L.firstExtrusion = K.length - 1;
        L.z = nz;
        L.h = L.hint || (layers.length > 1 ? nz - layers[layers.length - 2].z : nz);
        if (L.h <= 0.001) L.h = nz > 0 ? Math.min(nz, 0.2) : 0.2;
      }
      const h = L.h;
      const perLen = (de * filamentArea) / dxy;
      let width = perLen / h;
      if (perLen > (Math.PI * h * h) / 4) width = (perLen - (Math.PI * h * h) / 4) / h + h;
      W[id] = Math.max(0.05, Math.min(3, width));
      stats.extrudeDist += dxy;
      stats.filamentByType[type] += de;
      // the bounding box (used for framing and the over-air grid) ignores the prime line
      if (type !== FEATURE.PRIME) {
        if (nx < stats.min[0]) stats.min[0] = nx;
        if (ny < stats.min[1]) stats.min[1] = ny;
        if (nz < stats.min[2]) stats.min[2] = nz;
        if (nx > stats.max[0]) stats.max[0] = nx;
        if (ny > stats.max[1]) stats.max[1] = ny;
        if (nz > stats.max[2]) stats.max[2] = nz;
      }
    } else if (kind === KIND.TRAVEL) stats.travelDist += dist;
    else if (de < 0) stats.retractions++;
    // filament used = furthest the filament has been pushed (a final retraction does not 'un-use' it)
    eSum += de;
    if (eSum > stats.filament) stats.filament = eSum;
    x = nx; y = ny; z = nz; e = ne;
  };

  const wait = (seconds, lineNo, bucket) => {
    sync();
    if (!(seconds > 0)) return;
    pushMove(x, y, z, 0, KIND.WAIT, lineNo, seconds);
    stats[bucket] += seconds;
    sync();
  };

  const paramRe = /([A-Z])\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g;

  for (let ln = 0; ln < lines.length; ln++) {
    let line = lines[ln];
    const sc = line.indexOf(';');
    if (sc >= 0) {
      const comment = line.slice(sc + 1).trim();
      line = line.slice(0, sc);
      if (comment) {
        if (/^(TYPE|FEATURE):/i.test(comment)) type = featureFromComment(comment.slice(comment.indexOf(':') + 1));
        else if ((layerMode === 'comment' && /^LAYER:-?\d+/.test(comment)) || (layerMode === 'change' && comment === 'LAYER_CHANGE')) startLayer(z);
        else if (/^HEIGHT:/.test(comment)) {
          // PrusaSlicer/Orca tell the layer height explicitly
          if (layers.length) layers[layers.length - 1].hint = parseFloat(comment.slice(7)) || 0;
        }
        else if (comment === 'WIPE_START') wiping = true;
        else if (comment === 'WIPE_END') wiping = false;
        else if (ln < 80 || ln > lines.length - 400) readInfo(comment, info);
      }
    }
    line = line.trim().toUpperCase();
    if (!line) continue;
    const cmdMatch = /^([GMT])(\d+)(?:\.(\d+))?/.exec(line);
    if (!cmdMatch) {
      // a word like PRINT_START or BED_MESH_CALIBRATE: a Klipper/RepRap macro we cannot simulate
      const w = /^[A-Z_][A-Z0-9_]*/.exec(line);
      if (w) unknown.set(w[0], (unknown.get(w[0]) || 0) + 1);
      continue;
    }
    const cmd = cmdMatch[1] + String(parseInt(cmdMatch[2], 10));
    const P = {};
    if (cmd !== 'M117' && cmd !== 'M118' && cmd !== 'M862') {
      let m;
      const rest = line.slice(cmdMatch[0].length);
      paramRe.lastIndex = 0;
      while ((m = paramRe.exec(rest))) P[m[1]] = parseFloat(m[2]);
    }
    if (!KNOWN.has(cmd) && !/^T\d+$/.test(cmd)) unknown.set(cmd, (unknown.get(cmd) || 0) + 1);

    switch (cmd) {
      case 'G0':
      case 'G1': {
        if (P.F > 0) feed = (P.F * units) / 60;
        const nx = P.X === undefined ? x : absXYZ ? P.X * units : x + P.X * units;
        const ny = P.Y === undefined ? y : absXYZ ? P.Y * units : y + P.Y * units;
        const nz = P.Z === undefined ? z : absXYZ ? P.Z * units : z + P.Z * units;
        const ne = P.E === undefined ? e : absE ? P.E * units : e + P.E * units;
        linearMove(nx, ny, nz, ne, ln);
        break;
      }
      case 'G2':
      case 'G3': {
        if (P.F > 0) feed = (P.F * units) / 60;
        const ex = P.X === undefined ? x : absXYZ ? P.X * units : x + P.X * units;
        const ey = P.Y === undefined ? y : absXYZ ? P.Y * units : y + P.Y * units;
        const ez = P.Z === undefined ? z : absXYZ ? P.Z * units : z + P.Z * units;
        const ee = P.E === undefined ? e : absE ? P.E * units : e + P.E * units;
        let cx, cy;
        if (P.I !== undefined || P.J !== undefined) {
          cx = x + (P.I || 0) * units;
          cy = y + (P.J || 0) * units;
        } else if (P.R !== undefined) {
          // centre from radius: on the perpendicular bisector of the chord
          const r = P.R * units, mx = (x + ex) / 2, my = (y + ey) / 2, dx = ex - x, dy = ey - y;
          const c = Math.hypot(dx, dy) / 2, hgt = Math.sqrt(Math.max(0, r * r - c * c));
          const sgn = (cmd === 'G2') === r > 0 ? -1 : 1;
          cx = mx - (sgn * hgt * dy) / (2 * c || 1);
          cy = my + (sgn * hgt * dx) / (2 * c || 1);
        } else {
          linearMove(ex, ey, ez, ee, ln);
          break;
        }
        const r = Math.hypot(x - cx, y - cy);
        const a0 = Math.atan2(y - cy, x - cx), a1 = Math.atan2(ey - cy, ex - cx);
        let sweep = a1 - a0;
        if (cmd === 'G3' && sweep <= 0) sweep += 2 * Math.PI;
        if (cmd === 'G2' && sweep >= 0) sweep -= 2 * Math.PI;
        const segs = Math.max(1, Math.ceil(Math.abs(sweep * r) / 0.5));
        const sx = z, se = e;
        for (let s = 1; s <= segs; s++) {
          const f = s / segs, a = a0 + sweep * f;
          linearMove(s === segs ? ex : cx + r * Math.cos(a), s === segs ? ey : cy + r * Math.sin(a), sx + (ez - sx) * f, se + (ee - se) * f, ln);
        }
        break;
      }
      case 'G4':
        wait((P.P || 0) / 1000 + (P.S || 0), ln, 'dwellTime');
        break;
      case 'G10':
        sync();
        pushMove(x, y, z, 0, KIND.RETRACT, ln, 0.1);
        stats.retractions++;
        break;
      case 'G11':
        sync();
        pushMove(x, y, z, 0, KIND.RETRACT, ln, 0.1);
        break;
      case 'G20': units = 25.4; break;
      case 'G21': units = 1; break;
      case 'G28': {
        sync();
        const hm = machine.homing || DEFAULT_MACHINE.homing;
        const all = P.X === undefined && P.Y === undefined && P.Z === undefined;
        const nx = all || P.X !== undefined ? 0 : x;
        const ny = all || P.Y !== undefined ? 0 : y;
        const nz = all || P.Z !== undefined ? 0 : z;
        // each axis moves to its endstop, then backs off and touches it again slowly
        const axes = (nx !== x || all || P.X !== undefined) + (ny !== y || all || P.Y !== undefined) + (nz !== z || all || P.Z !== undefined);
        const dur = Math.abs(x - nx) / hm.feedXY + Math.abs(y - ny) / hm.feedXY + Math.abs(z - nz) / hm.feedZ + (hm.settle * axes) / 3;
        pushMove(nx, ny, nz, 0, KIND.HOME, ln, dur);
        stats.homeTime += dur;
        x = nx; y = ny; z = nz;
        sync();
        break;
      }
      case 'G29':
      case 'G80': {
        const sec = (machine.commandTimes || {})[cmd];
        wait(sec || 0, ln, 'homeTime');
        break;
      }
      case 'G90': absXYZ = true; absE = true; break;
      case 'G91': absXYZ = false; absE = false; break;
      case 'M82': absE = true; break;
      case 'M83': absE = false; break;
      case 'G92':
        if (P.X === undefined && P.Y === undefined && P.Z === undefined && P.E === undefined) sync();
        if (P.X !== undefined || P.Y !== undefined || P.Z !== undefined) sync();
        if (P.X !== undefined) x = P.X * units;
        if (P.Y !== undefined) y = P.Y * units;
        if (P.Z !== undefined) z = P.Z * units;
        if (P.E !== undefined) e = P.E * units;
        if (P.X !== undefined || P.Y !== undefined || P.Z !== undefined) {
          px[px.length - 1] = x; py[py.length - 1] = y; pz[pz.length - 1] = z;
        }
        break;
      case 'M0':
      case 'M1':
      case 'M400':
        sync();
        break;
      case 'M104':
      case 'M109':
      case 'M140':
      case 'M190': {
        const h = cmd === 'M104' || cmd === 'M109' ? 'nozzle' : 'bed';
        const target = P.S !== undefined ? P.S : P.R;
        if (target === undefined) break;
        if (cmd === 'M109' || cmd === 'M190') sync();
        tempEvents[h].push({ move: K.length, target });
        if (cmd === 'M109' || cmd === 'M190') {
          const model = machine.heaters[h];
          const now = temperatureAt(resolved(tempEvents[h]), model, clock).temp;
          let wt = 0;
          if (now < target - 0.5) wt = heatingTime(model, now, target) + model.residency;
          else if (P.R !== undefined && now > target + 0.5) wt = model.cool * Math.log((now - AMBIENT) / Math.max(0.5, target - AMBIENT));
          if (!isFinite(wt)) wt = 3600;
          wait(wt, ln, 'heatTime');
        }
        break;
      }
      case 'M106':
        fanEvents.push({ move: K.length, value: Math.max(0, Math.min(1, (P.S === undefined ? 255 : P.S) / 255)) });
        break;
      case 'M107':
        fanEvents.push({ move: K.length, value: 0 });
        break;
      case 'M201':
        planner.setAxisLimits('maxAccel', P);
        break;
      case 'M203':
        planner.setAxisLimits('maxFeed', P);
        break;
      case 'M204':
        planner.setAccel(cmd, P);
        break;
      case 'M205':
        planner.setJerk(P);
        break;
      case 'M220':
        if (P.S !== undefined) planner.m.feedFactor = P.S / 100;
        break;
      case 'M221':
        if (P.S !== undefined) planner.m.extrudeFactor = P.S / 100;
        break;
      case 'M73':
        if (info.estimate === null && P.R !== undefined && P.P === 0) {
          info.estimate = P.R * 60;
          info.estimateSource = 'M73 remaining time';
        }
        break;
      default:
        break;
    }
  }
  sync();

  const N = K.length;
  if (!layers.length) layers.push({ z: 0, h: 0.2, first: 0, firstExtrusion: -1, time: 0 });
  // per-layer and per-feature times (moving only, no waiting)
  for (let i = 0; i < N; i++) {
    const k = K[i];
    if (k === KIND.WAIT || k === KIND.HOME) continue;
    stats.motionTime += DUR[i];
    layers[LA[i]].time += DUR[i];
    if (k === KIND.EXTRUDE) stats.timeByType[TY[i]] += DUR[i];
  }
  stats.time = clock;
  stats.layers = layers.length;
  stats.moves = N;
  for (const l of layers) delete l.hint;
  return {
    n: N,
    px: Float32Array.from(px), py: Float32Array.from(py), pz: Float32Array.from(pz),
    e: Float32Array.from(E), feed: Float32Array.from(F), kind: Uint8Array.from(K), type: Uint8Array.from(TY),
    layer: Uint32Array.from(LA), line: Uint32Array.from(LN), t0: Float64Array.from(T0), dur: Float32Array.from(DUR),
    width: Float32Array.from(W),
    vEntry: Float32Array.from(V0), vPeak: Float32Array.from(VC), accel: Float32Array.from(AC),
    accUntil: Float32Array.from(AU), decAfter: Float32Array.from(DA),
    layers,
    tempEvents: { nozzle: resolved(tempEvents.nozzle), bed: resolved(tempEvents.bed) },
    fanEvents: resolved(fanEvents).map((ev) => ({ t: ev.t, value: ev.value })),
    heaters: machine.heaters,
    info, unknown: [...unknown.entries()].map(([cmd, count]) => ({ cmd, count })),
    stats,
    lineCount: lines.length,
  };
}

function readInfo(c, info) {
  let m;
  if ((m = /generated (?:by|with) ([A-Za-z_]+[\w .-]*?)(?:\s+on\b|$)/i.exec(c)) && !info.generator) info.generator = m[1].trim();
  else if ((m = /^Generated with (.+)$/i.exec(c)) && !info.generator) info.generator = m[1].trim();
  else if ((m = /^FLAVOR:/.exec(c)) && !info.generator) info.generator = 'Cura';
  if ((m = /^printer_model\s*=\s*(.+)$/.exec(c)) || (m = /^TARGET_MACHINE\.NAME:(.+)$/.exec(c))) info.printerModel = m[1].trim();
  if ((m = /estimated printing time \(normal mode\)\s*=\s*(.+)$/.exec(c))) {
    info.estimate = parseDuration(m[1]);
    info.estimateSource = 'slicer estimate (normal mode)';
  } else if ((m = /^TIME:(\d+)/.exec(c))) {
    info.estimate = parseInt(m[1], 10);
    info.estimateSource = 'slicer estimate (;TIME)';
  } else if ((m = /total estimated time:\s*([^;]+)/i.exec(c))) {
    info.estimate = parseDuration(m[1]);
    info.estimateSource = 'slicer estimate';
  }
  if ((m = /^filament used \[mm\]\s*=\s*([\d.]+)/.exec(c))) info.filamentMm = parseFloat(m[1]);
  else if ((m = /^Filament used:\s*([\d.]+)m/.exec(c))) info.filamentMm = parseFloat(m[1]) * 1000;
}

/** Index of the move that is running at time t (binary search on start times). */
export function moveAtTime(P, t) {
  let lo = 0, hi = P.n - 1;
  if (hi < 0) return 0;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (P.t0[mid] <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * Fraction of move m's length covered after `tau` seconds, following the planned
 * accelerate–cruise–decelerate profile (so the simulated nozzle slows down at corners).
 */
export function progressAt(P, m, tau) {
  const dur = P.dur[m];
  if (!(dur > 0)) return 1;
  if (tau >= dur) return 1;
  const k = P.kind[m];
  if (k === KIND.WAIT || k === KIND.HOME || !(P.accel[m] > 0)) return Math.max(0, tau / dur);
  const a = P.accel[m], v0 = P.vEntry[m], vc = P.vPeak[m], au = P.accUntil[m], da = P.decAfter[m];
  const dist = Math.hypot(P.px[m + 1] - P.px[m], P.py[m + 1] - P.py[m], P.pz[m + 1] - P.pz[m]) || Math.abs(P.e[m]);
  if (!(dist > 0)) return tau / dur;
  const tAcc = vc > v0 ? (vc - v0) / a : 0;
  const tCruise = vc > 0 ? (da - au) / vc : 0;
  let s;
  if (tau <= tAcc) s = v0 * tau + 0.5 * a * tau * tau;
  else if (tau <= tAcc + tCruise) s = au + vc * (tau - tAcc);
  else {
    const td = tau - tAcc - tCruise;
    s = da + vc * td - 0.5 * a * td * td;
  }
  return Math.max(0, Math.min(1, s / dist));
}
