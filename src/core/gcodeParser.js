// G-code parser + "virtual printer". Reads G-code text and produces a time line of moves that
// the viewer and the simulator use. Works for G-code from this app and from other slicers.
import { FEATURE, featureFromComment } from './features.js';

export const KIND = { TRAVEL: 0, EXTRUDE: 1, RETRACT: 2, WAIT: 3, HOME: 4 };

// A very simple heater model: linear heating/cooling rates in °C per second.
export const HEATERS = {
  nozzle: { up: 2.5, down: 1.2 },
  bed: { up: 0.75, down: 0.25 },
  ambient: 22,
};

/** Temperature of a heater at time t, replaying the target-change events [{t, target}]. */
export function temperatureAt(events, model, t) {
  let temp = HEATERS.ambient, target = 0, last = 0;
  const step = (until) => {
    const dt = until - last;
    if (dt <= 0) return;
    const goal = Math.max(target, HEATERS.ambient);
    if (temp < goal) temp = Math.min(goal, temp + model.up * dt);
    else if (temp > goal) temp = Math.max(goal, temp - model.down * dt);
    last = until;
  };
  for (const ev of events) {
    if (ev.t > t) break;
    step(ev.t);
    target = ev.target;
  }
  step(t);
  return { temp, target };
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

export function parseGcode(text, opts = {}) {
  const filamentArea = Math.PI * ((opts.filamentDiameter || 1.75) / 2) ** 2;
  let accel = opts.acceleration || 1000;
  let jerk = opts.jerk || 8;

  const lines = text.split('\n');
  const layerMode = text.includes(';LAYER:') ? 'comment' : text.includes(';LAYER_CHANGE') ? 'change' : 'z';

  // growable move storage
  const px = [0], py = [0], pz = [0];
  const E = [], F = [], K = [], TY = [], LA = [], LN = [], T0 = [], DUR = [], W = [];
  const layers = []; // { z, h, first, firstExtrusion, time }

  let x = 0, y = 0, z = 0, e = 0, feed = 1500 / 60;
  let absXYZ = true, absE = true;
  let type = FEATURE.OTHER;
  let layer = -1; // becomes 0 at the first layer marker / extrusion
  let t = 0;
  const heat = { nozzle: { temp: HEATERS.ambient, target: 0, t: 0 }, bed: { temp: HEATERS.ambient, target: 0, t: 0 } };
  const tempEvents = { nozzle: [], bed: [] };
  const fanEvents = [];
  const stats = {
    time: 0, filament: 0, extrudeDist: 0, travelDist: 0, retractions: 0,
    timeByType: new Float64Array(8), filamentByType: new Float64Array(8),
    min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity],
  };

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
    layers.push({ z: zz, h: 0, first: K.length, firstExtrusion: -1, time: 0 });
  };
  const curLayer = () => (layer < 0 ? 0 : layer);

  const advanceHeater = (h, now) => {
    const m = HEATERS[h === heat.nozzle ? 'nozzle' : 'bed'];
    const dt = now - h.t;
    const goal = Math.max(h.target, HEATERS.ambient);
    if (h.temp < goal) h.temp = Math.min(goal, h.temp + m.up * dt);
    else if (h.temp > goal) h.temp = Math.max(goal, h.temp - m.down * dt);
    h.t = now;
  };

  const moveTime = (dist, v) => {
    // trapezoid profile: accelerate from `jerk` to v, cruise, decelerate back to `jerk`
    if (dist <= 0 || v <= 0) return 0;
    const j = Math.min(jerk, v);
    const accDist = (v * v - j * j) / accel;
    if (dist >= accDist) return (2 * (v - j)) / accel + (dist - accDist) / v;
    const vp = Math.sqrt(j * j + accel * dist);
    return (2 * (vp - j)) / accel;
  };

  const pushMove = (nx, ny, nz, de, kind, lineNo, dur) => {
    px.push(nx); py.push(ny); pz.push(nz);
    E.push(de); F.push(feed); K.push(kind); TY.push(type); LA.push(curLayer()); LN.push(lineNo);
    T0.push(t); DUR.push(dur); W.push(0);
    t += dur;
    // layer time counts only moving, not heating/homing waits
    if (layers.length && kind !== KIND.WAIT && kind !== KIND.HOME) layers[layers.length - 1].time += dur;
    stats.timeByType[type] += kind === KIND.EXTRUDE ? dur : 0;
  };

  const linearMove = (nx, ny, nz, ne, lineNo) => {
    const dx = nx - x, dy = ny - y, dz = nz - z, de = ne - e;
    const dxy = Math.hypot(dx, dy);
    const dist = Math.hypot(dxy, dz);
    if (dist < 1e-9 && Math.abs(de) < 1e-9) return;
    let kind;
    if (dist < 1e-9) kind = KIND.RETRACT;
    else if (de > 1e-9 && dxy > 1e-9) kind = KIND.EXTRUDE;
    else kind = KIND.TRAVEL;

    if (kind === KIND.EXTRUDE && layerMode === 'z' && (layer < 0 || Math.abs(nz - layers[layers.length - 1].z) > 1e-4)) startLayer(nz);
    if (kind === KIND.EXTRUDE && layer < 0) {
      startLayer(nz);
      provisional = layerMode !== 'z';
    }

    let v = feed;
    if (kind === KIND.TRAVEL && dxy < 1e-9) v = Math.min(v, 15); // Z axis is slow on most printers
    const dur = kind === KIND.RETRACT ? Math.abs(de) / Math.max(1, Math.min(v, 100)) : moveTime(dist, v);

    pushMove(nx, ny, nz, de, kind, lineNo, dur);
    if (kind === KIND.EXTRUDE) {
      const L = layers[layers.length - 1];
      if (L.firstExtrusion < 0) {
        L.firstExtrusion = K.length - 1;
        L.z = nz;
        L.h = layers.length > 1 ? nz - layers[layers.length - 2].z : nz;
        if (L.h <= 0.001) L.h = nz > 0 ? Math.min(nz, 0.2) : 0.2;
      }
      const h = L.h;
      const perLen = (de * filamentArea) / dxy;
      let width = perLen / h;
      if (perLen > (Math.PI * h * h) / 4) width = (perLen - (Math.PI * h * h) / 4) / h + h;
      W[W.length - 1] = Math.max(0.05, Math.min(3, width));
      stats.extrudeDist += dxy;
      stats.filamentByType[type] += de;
      // the bounding box (used for framing and the over-air grid) ignores the prime line
      if (type !== FEATURE.PRIME) for (const [k, val] of [[0, nx], [1, ny], [2, nz]]) {
        if (val < stats.min[k]) stats.min[k] = val;
        if (val > stats.max[k]) stats.max[k] = val;
      }
    } else if (kind === KIND.TRAVEL) stats.travelDist += dist;
    else if (de < 0) stats.retractions++;
    stats.filament += de;
    x = nx; y = ny; z = nz; e = ne;
  };

  const wait = (seconds, lineNo) => {
    if (seconds <= 0) return;
    pushMove(x, y, z, 0, KIND.WAIT, lineNo, seconds);
  };

  const paramRe = /([A-Z])\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g;

  for (let ln = 0; ln < lines.length; ln++) {
    let line = lines[ln];
    const sc = line.indexOf(';');
    if (sc >= 0) {
      const comment = line.slice(sc + 1).trim();
      line = line.slice(0, sc);
      if (/^(TYPE|FEATURE):/i.test(comment)) type = featureFromComment(comment.slice(comment.indexOf(':') + 1));
      else if ((layerMode === 'comment' && /^LAYER:-?\d+/.test(comment)) || (layerMode === 'change' && comment === 'LAYER_CHANGE')) startLayer(z);
    }
    line = line.trim().toUpperCase();
    if (!line) continue;
    const cmdMatch = /^([GMT])(\d+)(?:\.(\d+))?/.exec(line);
    if (!cmdMatch) continue;
    const cmd = cmdMatch[1] + cmdMatch[2];
    const P = {};
    if (cmd !== 'M117' && cmd !== 'M118') {
      let m;
      const rest = line.slice(cmdMatch[0].length);
      paramRe.lastIndex = 0;
      while ((m = paramRe.exec(rest))) P[m[1]] = parseFloat(m[2]);
    }

    switch (cmd) {
      case 'G0':
      case 'G1': {
        if (P.F !== undefined && P.F > 0) feed = P.F / 60;
        const nx = P.X === undefined ? x : absXYZ ? P.X : x + P.X;
        const ny = P.Y === undefined ? y : absXYZ ? P.Y : y + P.Y;
        const nz = P.Z === undefined ? z : absXYZ ? P.Z : z + P.Z;
        const ne = P.E === undefined ? e : absE ? P.E : e + P.E;
        linearMove(nx, ny, nz, ne, ln);
        break;
      }
      case 'G2':
      case 'G3': {
        if (P.F !== undefined && P.F > 0) feed = P.F / 60;
        const ex = P.X === undefined ? x : absXYZ ? P.X : x + P.X;
        const ey = P.Y === undefined ? y : absXYZ ? P.Y : y + P.Y;
        const ez = P.Z === undefined ? z : absXYZ ? P.Z : z + P.Z;
        const ee = P.E === undefined ? e : absE ? P.E : e + P.E;
        const cx = x + (P.I || 0), cy = y + (P.J || 0);
        const r = Math.hypot(x - cx, y - cy);
        let a0 = Math.atan2(y - cy, x - cx), a1 = Math.atan2(ey - cy, ex - cx);
        let sweep = a1 - a0;
        if (cmd === 'G3' && sweep <= 0) sweep += 2 * Math.PI;
        if (cmd === 'G2' && sweep >= 0) sweep -= 2 * Math.PI;
        if (r < 1e-6 || (P.I === undefined && P.J === undefined)) { linearMove(ex, ey, ez, ee, ln); break; }
        const segs = Math.max(2, Math.ceil(Math.abs(sweep * r) / 0.8));
        const sx = x, sy = y, sz = z, se = e;
        for (let s = 1; s <= segs; s++) {
          const f = s / segs;
          const a = a0 + sweep * f;
          linearMove(s === segs ? ex : cx + r * Math.cos(a), s === segs ? ey : cy + r * Math.sin(a), sz + (ez - sz) * f, se + (ee - se) * f, ln);
        }
        break;
      }
      case 'G4':
        wait((P.P || 0) / 1000 + (P.S || 0), ln);
        break;
      case 'G10': // firmware retract
        pushMove(x, y, z, 0, KIND.RETRACT, ln, 0.1);
        stats.retractions++;
        break;
      case 'G11':
        pushMove(x, y, z, 0, KIND.RETRACT, ln, 0.1);
        break;
      case 'G28': {
        const all = P.X === undefined && P.Y === undefined && P.Z === undefined;
        const nx = all || P.X !== undefined ? 0 : x;
        const ny = all || P.Y !== undefined ? 0 : y;
        const nz = all || P.Z !== undefined ? 0 : z;
        const dist = Math.hypot(nx - x, ny - y, nz - z);
        pushMove(nx, ny, nz, 0, KIND.HOME, ln, Math.max(3, dist / 40 + 4));
        x = nx; y = ny; z = nz;
        break;
      }
      case 'G29':
        wait(25, ln); // bed levelling probe sequence
        break;
      case 'G90': absXYZ = true; absE = true; break;
      case 'G91': absXYZ = false; absE = false; break;
      case 'M82': absE = true; break;
      case 'M83': absE = false; break;
      case 'G92':
        if (P.X !== undefined) x = P.X;
        if (P.Y !== undefined) y = P.Y;
        if (P.Z !== undefined) z = P.Z;
        if (P.E !== undefined) e = P.E;
        if (P.X !== undefined || P.Y !== undefined || P.Z !== undefined) {
          px[px.length - 1] = x; py[py.length - 1] = y; pz[pz.length - 1] = z;
        }
        break;
      case 'M104':
      case 'M109':
      case 'M140':
      case 'M190': {
        const h = cmd === 'M104' || cmd === 'M109' ? 'nozzle' : 'bed';
        const target = P.S !== undefined ? P.S : P.R;
        if (target === undefined) break;
        advanceHeater(heat[h], t);
        heat[h].target = target;
        tempEvents[h].push({ t, target });
        if (cmd === 'M109' || cmd === 'M190') {
          const st = heat[h], m = HEATERS[h];
          let wt = 0;
          if (st.temp < target) wt = (target - st.temp) / m.up;
          else if (P.R !== undefined && st.temp > target) wt = (st.temp - target) / m.down;
          wait(wt, ln);
          advanceHeater(heat.nozzle, t);
          advanceHeater(heat.bed, t);
        }
        break;
      }
      case 'M106':
        fanEvents.push({ t, value: Math.max(0, Math.min(1, (P.S === undefined ? 255 : P.S) / 255)) });
        break;
      case 'M107':
        fanEvents.push({ t, value: 0 });
        break;
      case 'M204':
        if (P.P !== undefined) accel = P.P;
        else if (P.S !== undefined) accel = P.S;
        break;
      case 'M205':
        if (P.X !== undefined) jerk = P.X;
        break;
      default:
        break;
    }
  }

  const N = K.length;
  if (!layers.length) layers.push({ z: 0, h: 0.2, first: 0, firstExtrusion: -1, time: 0 });
  stats.time = t;
  stats.layers = layers.length;
  stats.moves = N;
  return {
    n: N,
    px: Float32Array.from(px), py: Float32Array.from(py), pz: Float32Array.from(pz),
    e: Float32Array.from(E), feed: Float32Array.from(F), kind: Uint8Array.from(K), type: Uint8Array.from(TY),
    layer: Uint32Array.from(LA), line: Uint32Array.from(LN), t0: Float64Array.from(T0), dur: Float32Array.from(DUR),
    width: Float32Array.from(W),
    layers,
    tempEvents, fanEvents, stats,
    lineCount: lines.length,
  };
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
