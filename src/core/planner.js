// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 The Slicer Lab authors
//
// Derived from PrusaSlicer, src/libslic3r/GCode/GCodeProcessor.cpp (PrusaSlicer 2.9.6),
// https://github.com/prusa3d/PrusaSlicer, licensed under the GNU AGPL v3 or later:
//   Copyright (c) Prusa Research 2020 - 2023 Enrico Turri, Vojtěch Bubník, Pavel Mikuš,
//   Lukáš Matěna, Filip Sykala, Oleksandra Iushchenko
//   Copyright (c) SuperSlicer 2023 Remi Durand
// which re-implements the motion planner of the Marlin firmware (GPL v3), itself based on Grbl.
// Changes: translated from C++ to JavaScript, restructured into a class with callbacks,
// classic-jerk mode only. See THIRD_PARTY_NOTICES.md.
//
// Motion planner: computes how long the printer really needs for every move.
//
// A printer cannot change speed instantly. The firmware (Marlin, Prusa firmware) plans every
// move ("block") as a trapezoid: accelerate → cruise → decelerate. How fast it may pass a corner
// is limited by the "jerk" setting (the speed change that may happen instantly), and how far it
// can see ahead is limited by its buffer of upcoming moves.
//
// Like PrusaSlicer's estimator, it applies per-axis feed-rate and acceleration limits,
// jerk-limited junctions, reverse + forward planning passes, and a look-ahead window of
// 64 blocks refreshed every 256, so the times can be validated against PrusaSlicer.

const QUEUE = 64; // blocks kept for look-ahead
const REFRESH = QUEUE * 4; // recompute when this many blocks are buffered
const PREV_THRESHOLD = 0.0001;

/** Machine limits. All speeds mm/s, accelerations mm/s². Arrays are [X, Y, Z, E]. */
export function machineFromProfile(p) {
  return {
    maxFeed: p.maxFeed.slice(),
    maxAccel: p.maxAccel.slice(),
    jerk: p.jerk.slice(),
    minExtrudeFeed: p.minExtrudeFeed || 0,
    minTravelFeed: p.minTravelFeed || 0,
    maxPrintAccel: p.maxPrintAccel || 0, // clamps M204 values (0 = no clamp)
    maxRetractAccel: p.maxRetractAccel || 0,
    maxTravelAccel: p.maxTravelAccel || 0,
    accel: p.printAccel,
    retractAccel: p.retractAccel,
    travelAccel: p.travelAccel,
    flavor: p.flavor || 'marlin', // 'marlin' = legacy M204 S/T, 'marlin2' = M204 P/R/T
    extrudeFactor: 1, // M221
    feedFactor: 1, // M220
  };
}

const sqr = (v) => v * v;
const speedFromDistance = (v0, d, a) => Math.sqrt(Math.max(0, v0 * v0 + 2 * a * d));
const maxAllowableSpeed = (a, vTarget, d) => Math.sqrt(Math.max(0, vTarget * vTarget - 2 * a * d));
const accelDistance = (v0, v1, a) => (a === 0 ? 0 : (v1 * v1 - v0 * v0) / (2 * a));
const intersectionDistance = (v0, v1, a, d) => (a === 0 ? 0 : (2 * a * d - v0 * v0 + v1 * v1) / (4 * a));
const accelTime = (v0, d, a) => (a !== 0 ? (speedFromDistance(v0, d, a) - v0) / a : 0);

function trapezoid(b) {
  let accD = Math.max(0, accelDistance(b.entry, b.cruise, b.accel));
  const decD = Math.max(0, accelDistance(b.cruise, b.exit, -b.accel));
  let cruiseD = b.distance - accD - decD;
  let vc = b.cruise;
  if (cruiseD < 0) {
    // the block is too short to reach full speed: accelerate, then brake right away
    accD = Math.min(b.distance, Math.max(0, intersectionDistance(b.entry, b.exit, b.accel, b.distance)));
    cruiseD = 0;
    vc = speedFromDistance(b.entry, accD, b.accel);
  }
  b.accUntil = accD;
  b.decAfter = accD + cruiseD;
  b.vCruise = vc;
}

function blockTime(b) {
  const tAcc = accelTime(b.entry, b.accUntil, b.accel);
  const tCruise = b.vCruise !== 0 ? (b.decAfter - b.accUntil) / b.vCruise : 0;
  const tDec = accelTime(b.vCruise, b.distance - b.decAfter, -b.accel);
  return tAcc + tCruise + tDec;
}

export class MotionPlanner {
  /** onTime(id, seconds, block) is called for every block once its time is final. */
  constructor(machine, onTime) {
    this.m = machine;
    this.onTime = onTime;
    this.blocks = [];
    this.prev = { feedrate: 0, safe: 0, axis: [0, 0, 0, 0] };
  }

  /**
   * Add a straight move. d = [dx, dy, dz, de] (mm), feed = requested speed (mm/s),
   * kind: 'travel' | 'extrude' | 'retract' | 'wipe'.
   */
  add(d, feed, kind, id) {
    const m = this.m;
    const xyz2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
    const distance = xyz2 > 0 ? Math.sqrt(xyz2) : Math.abs(d[3]);
    if (!(distance > 0)) return false;
    const inv = 1 / distance;
    const eOnly = d[0] === 0 && d[1] === 0 && d[2] === 0 && d[3] !== 0;

    let feedrate = feed * m.feedFactor;
    feedrate = d[3] === 0 ? Math.max(feedrate, m.minTravelFeed) : Math.max(feedrate, m.minExtrudeFeed);

    // cruise speed: no axis may exceed its maximum feed rate
    const axis = [0, 0, 0, 0];
    let factor = 1;
    for (let a = 0; a < 4; a++) {
      axis[a] = feedrate * d[a] * inv * (a === 3 ? m.extrudeFactor : 1);
      const abs = Math.abs(axis[a]);
      if (abs !== 0 && m.maxFeed[a] > 0) factor = Math.min(factor, m.maxFeed[a] / abs);
    }
    const cruise = factor * feedrate;
    if (factor < 1) for (let a = 0; a < 4; a++) axis[a] *= factor;

    // acceleration: depends on the move type, and no axis may exceed its own maximum
    let accel = kind === 'travel' ? m.travelAccel : eOnly ? m.retractAccel : m.accel;
    for (let a = 0; a < 4; a++) {
      const scale = Math.abs(d[a]) * inv;
      if (m.maxAccel[a] > 0 && accel * scale > m.maxAccel[a]) accel = m.maxAccel[a] / scale;
    }

    // safe speed: the speed at which this move could start/stop instantly (within jerk)
    let safe = cruise;
    for (let a = 0; a < 4; a++) if (Math.abs(axis[a]) > m.jerk[a]) safe = Math.min(safe, m.jerk[a]);

    // junction speed with the previous move, limited by the jerk of every axis
    let vmaxJ = safe;
    const prev = this.prev;
    if (this.blocks.length && prev.feedrate > PREV_THRESHOLD) {
      const prevLarger = prev.feedrate > cruise;
      const smallerFactor = prevLarger ? cruise / prev.feedrate : prev.feedrate / cruise;
      vmaxJ = prevLarger ? cruise : prev.feedrate;
      let vFactor = 1, limited = false;
      for (let a = 0; a < 4; a++) {
        let vExit = prev.axis[a], vEntry = axis[a];
        if (prevLarger) vExit *= smallerFactor;
        if (limited) {
          vExit *= vFactor;
          vEntry *= vFactor;
        }
        const jerk = vExit > vEntry
          ? (vEntry > 0 || vExit < 0 ? vExit - vEntry : Math.max(vExit, -vEntry))
          : (vEntry < 0 || vExit > 0 ? vEntry - vExit : Math.max(-vExit, vEntry));
        if (jerk > m.jerk[a]) {
          vFactor *= m.jerk[a] / jerk;
          limited = true;
        }
      }
      if (limited) vmaxJ *= vFactor;
      const threshold = vmaxJ * 0.99;
      if (prev.safe > threshold && safe > threshold) vmaxJ = safe;
    }

    const vAllow = maxAllowableSpeed(-accel, safe, distance);
    const b = {
      id, distance, accel, cruise, safe,
      entry: Math.min(vmaxJ, vAllow), exit: safe, maxEntry: vmaxJ,
      nominal: cruise <= vAllow, recalc: true,
      accUntil: 0, decAfter: 0, vCruise: cruise,
    };
    trapezoid(b);
    this.prev = { feedrate, safe, axis };
    this.blocks.push(b);
    if (this.blocks.length > REFRESH) this.calculate(QUEUE);
    return true;
  }

  /** Plan the buffered blocks and emit the times of all but the last `keep` blocks. */
  calculate(keep) {
    const B = this.blocks;
    if (!B.length) return;
    // reverse pass: make sure every block can decelerate in time for the next one
    for (let i = B.length - 1; i > 0; i--) {
      const cur = B[i - 1], next = B[i];
      if (cur.entry !== cur.maxEntry || next.recalc) {
        const e = cur.nominal ? cur.maxEntry : Math.min(cur.maxEntry, maxAllowableSpeed(-cur.accel, next.entry, cur.distance));
        if (cur.entry !== e) {
          cur.entry = e;
          cur.recalc = true;
        }
      }
    }
    // forward pass: a block can only reach the speed it can accelerate to
    for (let i = 0; i + 1 < B.length; i++) {
      const prev = B[i], cur = B[i + 1];
      if (!prev.nominal && prev.entry < cur.entry) {
        const e = maxAllowableSpeed(-prev.accel, prev.entry, prev.distance);
        if (e < cur.entry) {
          cur.entry = e;
          cur.recalc = true;
        }
      }
    }
    // trapezoids
    for (let i = 0; i + 1 < B.length; i++) {
      const cur = B[i], next = B[i + 1];
      if (cur.recalc || next.recalc) {
        cur.exit = next.entry;
        trapezoid(cur);
        cur.recalc = false;
      }
    }
    const last = B[B.length - 1];
    last.exit = last.safe;
    trapezoid(last);
    last.recalc = false;

    const n = B.length - keep;
    for (let i = 0; i < n; i++) this.onTime(B[i].id, blockTime(B[i]), B[i]);
    B.splice(0, n);
  }

  /** The printer waits until all moves are done (dwell, heating, homing, end of file). */
  sync() {
    this.calculate(0);
  }

  // --- G-code commands that change the limits ---
  setAccel(cmd, P) {
    const m = this.m;
    const clamp = (v, max) => (max > 0 ? Math.min(v, max) : v);
    if (P.S !== undefined) {
      // legacy format (Marlin 1.x / Prusa firmware): S = printing and travel, T = retract
      m.accel = clamp(P.S, m.maxPrintAccel);
      m.travelAccel = clamp(P.S, m.maxTravelAccel);
      if (P.T !== undefined) m.retractAccel = clamp(P.T, m.maxRetractAccel);
    } else {
      // upstream Marlin 2 format: P = printing, R = retract, T = travel
      if (P.P !== undefined) m.accel = clamp(P.P, m.maxPrintAccel);
      if (P.R !== undefined) m.retractAccel = clamp(P.R, m.maxRetractAccel);
      if (P.T !== undefined) m.travelAccel = clamp(P.T, m.maxTravelAccel);
    }
  }

  setAxisLimits(target, P) {
    const keys = ['X', 'Y', 'Z', 'E'];
    keys.forEach((k, i) => {
      if (P[k] !== undefined) this.m[target][i] = P[k];
    });
  }

  setJerk(P) {
    const m = this.m;
    if (P.X !== undefined) m.jerk[0] = m.jerk[1] = P.X;
    if (P.Y !== undefined) m.jerk[1] = P.Y;
    if (P.Z !== undefined) m.jerk[2] = P.Z;
    if (P.E !== undefined) m.jerk[3] = P.E;
    if (P.S !== undefined) m.minExtrudeFeed = P.S;
    if (P.T !== undefined) m.minTravelFeed = P.T;
  }
}
