// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 The Slicer Lab authors
// Headless tests of the whole pipeline. Run with: npm test
//  1. motion planner against hand-calculated cases
//  2. print-time and filament estimates against PrusaSlicer 2.9.6 (reference G-code in fixtures/)
//  3. every built-in model on both printers: slice → G-code → simulate → analyse
import fs from 'fs';
import zlib from 'zlib';
import { SAMPLES } from '../src/core/primitives.js';
import { placeOnBed, volume, parseSTL, parseOBJ, toBinarySTL } from '../src/core/mesh.js';
import { profileSettings } from '../src/core/settings.js';
import { slice } from '../src/core/slicer.js';
import { writeGcode, addProgressInfo } from '../src/core/gcodeWriter.js';
import { parseGcode, KIND, heatingTime, temperatureAt } from '../src/core/gcodeParser.js';
import { MotionPlanner, machineFromProfile } from '../src/core/planner.js';
import { analyzeSupport } from '../src/core/analysis.js';
import { machineFor, PRINTER_PROFILES } from '../src/core/printers.js';
import * as CL from '../src/core/clip.js';

let failures = 0;
const check = (cond, msg) => {
  if (!cond) {
    failures++;
    console.log('  FAIL: ' + msg);
  }
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// ---------------------------------------------------------------- 1. planner
{
  const m = machineFromProfile({ maxFeed: [200, 200, 12, 120], maxAccel: [1000, 1000, 200, 5000], jerk: [8, 8, 0.4, 4.5], printAccel: 1000, retractAccel: 1000, travelAccel: 1000 });
  const times = [];
  const pl = new MotionPlanner(m, (id, t) => (times[id] = t));
  // one 100 mm move at 100 mm/s: starts and ends at the jerk speed (8 mm/s), accelerates at 1000 mm/s²
  pl.add([100, 0, 0, 0], 100, 'travel', 0);
  pl.sync();
  const accD = (100 * 100 - 64) / 2000;
  const expect = (2 * (100 - 8)) / 1000 + (100 - 2 * accD) / 100;
  check(near(times[0], expect, 1e-6), `planner: single move ${times[0]} vs ${expect}`);

  // a 300 mm/s request is capped by the 200 mm/s axis limit
  const t2 = [];
  const pl2 = new MotionPlanner(machineFromProfile({ ...m, maxFeed: [200, 200, 12, 120], printAccel: 1000, retractAccel: 1000, travelAccel: 1000 }), (id, t) => (t2[id] = t));
  pl2.add([400, 0, 0, 0], 300, 'travel', 0);
  pl2.sync();
  const accD2 = (200 * 200 - 64) / 2000;
  check(near(t2[0], (2 * (200 - 8)) / 1000 + (400 - 2 * accD2) / 200, 1e-6), 'planner: axis feed-rate limit');

  // two collinear moves behave like one long move (no slow-down at the joint)
  const t3 = [];
  const pl3 = new MotionPlanner(machineFromProfile(m), (id, t) => (t3[id] = t));
  pl3.add([50, 0, 0, 0], 100, 'travel', 0);
  pl3.add([50, 0, 0, 0], 100, 'travel', 1);
  pl3.sync();
  check(near(t3[0] + t3[1], expect, 1e-6), `planner: collinear junction ${t3[0] + t3[1]} vs ${expect}`);

  // a 90° corner must slow down: slower than going straight
  const t4 = [];
  const pl4 = new MotionPlanner(machineFromProfile(m), (id, t) => (t4[id] = t));
  pl4.add([50, 0, 0, 0], 100, 'travel', 0);
  pl4.add([0, 50, 0, 0], 100, 'travel', 1);
  pl4.sync();
  check(t4[0] + t4[1] > expect + 0.05, 'planner: 90° corner is slower than a straight line');
}

// heater model
{
  const bed = PRINTER_PROFILES.ender3.heaters.bed;
  const t60 = heatingTime(bed, 18, 60);
  check(t60 > 150 && t60 < 230, `Ender-3 bed 18→60 °C takes ~3 min (model: ${t60.toFixed(0)} s)`);
  const T = temperatureAt([{ t: 0, target: 60 }], bed, 10000).temp;
  check(near(T, 60, 0.01), 'heater holds at its target');
}

// ---------------------------------------------------------------- 2. against PrusaSlicer
for (const [file, printer] of [['ps_mk3s_cube', 'mk3s'], ['ps_ender3_cube', 'ender3'], ['ps_mk3s_tshape', 'mk3s']]) {
  const text = zlib.gunzipSync(fs.readFileSync(new URL(`./fixtures/${file}.gcode.gz`, import.meta.url))).toString('utf8');
  const S = profileSettings(printer, 'PLA');
  const P = parseGcode(text, { machine: machineFor(S, printer) });
  const ref = P.info.estimate;
  const err = ((P.stats.motionTime - ref) / ref) * 100;
  console.log(`${file.padEnd(16)} PrusaSlicer ${ref.toFixed(0)} s, ours ${P.stats.motionTime.toFixed(1)} s (${err.toFixed(3)}%), filament ${P.stats.filament.toFixed(2)} vs ${P.info.filamentMm} mm`);
  check(Math.abs(err) < 0.5, `${file}: motion time within 0.5% of PrusaSlicer`);
  check(near(P.stats.filament, P.info.filamentMm, 0.5), `${file}: filament length matches PrusaSlicer`);
  check(P.unknown.length === 0, `${file}: all commands understood (${P.unknown.map((u) => u.cmd)})`);
}

// STL round trip
{
  const tris = SAMPLES[0].build();
  const back = parseSTL(toBinarySTL(tris));
  check(back.length === tris.length && Math.abs(back[5] - tris[5]) < 1e-6, 'binary STL round trip');
  const ascii = 'solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid t\n';
  check(parseSTL(new TextEncoder().encode(ascii).buffer).length === 9, 'ascii STL parse');
}

// OBJ
{
  const o = parseOBJ(['v 0 0 0', 'v 10 0 0', 'v 10 10 0', 'v 0 10 0', 'v 0 0 10', 'v 10 0 10', 'v 10 10 10', 'v 0 10 10', 'f 1 4 3 2', 'f 5 6 7 8', 'f 1 2 6 5', 'f 2 3 7 6', 'f 3 4 8 7', 'f 4 1 5 8'].join(String.fromCharCode(10)));
  check(o.length === 12 * 9 && near(volume(o), 1000, 1e-6), 'OBJ cube parses with outward faces');
}

// broken meshes: a cube with missing faces must still give a closed 20 × 20 outline
{
  const S = profileSettings('mk3s', 'PLA');
  for (const [name, drop] of [['one missing face', (x) => x > 130], ['two missing faces', (x) => x > 110]]) {
    const full = placeOnBed(SAMPLES[0].build(), S.bedX, S.bedY);
    const tris = [];
    for (let i = 0; i < full.length; i += 9) {
      const xs = [full[i], full[i + 3], full[i + 6]];
      if (Math.max(...xs) - Math.min(...xs) < 1e-6 && drop(xs[0])) continue;
      for (let k = 0; k < 9; k++) tris.push(full[i + k]);
    }
    const sl = slice(Float32Array.from(tris), S);
    const a = sl.meta.outlines[50].reduce((acc, p) => acc + CL.area([CL.fromXY(p)]), 0);
    check(near(a, 400, 1), `mesh repair (${name}): outline area ${a.toFixed(1)} mm²`);
  }
}

// ---------------------------------------------------------------- 3. full pipeline
function run(sample, printer, extra = {}) {
  const S = { ...profileSettings(printer, 'PLA'), ...extra };
  const machine = machineFor(S, printer);
  const tris = placeOnBed(sample.build(), S.bedX, S.bedY);
  const t0 = performance.now();
  const sl = slice(tris, S);
  let gcode = writeGcode(sl, S);
  gcode = addProgressInfo(gcode, parseGcode(gcode, { machine }), S);
  const P = parseGcode(gcode, { machine });
  const A = analyzeSupport(P);
  return { S, tris, sl, gcode, P, A, ms: performance.now() - t0 };
}

const fmt = (s) => ((r) => `${Math.floor(r / 60)}:${String(r % 60).padStart(2, "0")}`)(Math.round(s));
for (const printer of ['mk3s', 'ender3']) {
  for (const sample of SAMPLES) {
    const { tris, sl, P, A, S, ms } = run(sample, printer);
    const vol = volume(tris);
    const plastic = P.stats.filament * Math.PI * (S.filamentDiameter / 2) ** 2;
    console.log(
      `${printer.padEnd(6)} ${sample.id.padEnd(10)} layers ${String(sl.layers.length).padStart(4)}  motion ${fmt(P.stats.motionTime).padStart(6)}  total ${fmt(P.stats.time).padStart(6)}  ` +
        `filament ${(P.stats.filament / 1000).toFixed(2)} m  retractions ${String(P.stats.retractions).padStart(4)}  over-air ${A.overAirLength.toFixed(0).padStart(4)} mm  [${ms.toFixed(0)} ms]`,
    );
    check(vol > 0, `${sample.id}: positive volume`);
    check(sl.layers.length === P.layers.length, `${printer} ${sample.id}: parser layer count matches slicer (${sl.layers.length} vs ${P.layers.length})`);
    check(P.n > 0 && P.kind.some((k) => k === KIND.EXTRUDE), `${sample.id}: has extrusion moves`);
    check(plastic > 0 && plastic < vol * 1.5 + 2500, `${sample.id}: plausible plastic volume`);
    check(P.unknown.length === 0, `${printer} ${sample.id}: our own G-code is fully understood (${P.unknown.map((u) => u.cmd)})`);
    const a0 = sl.meta.outlines[0].reduce((s, p) => s + CL.area([CL.fromXY(p)]), 0);
    check(a0 > 0, `${sample.id}: first-layer outline has positive area`);
    if (['tshape', 'overhang'].includes(sample.id)) check(A.badLayers > 0, `${sample.id}: unsupported overhang detected`);
  }
}
{
  const { A } = run(SAMPLES.find((s) => s.id === 'tshape'), 'mk3s', { support: true });
  check(A.badLayers === 0, 'tshape: support removes over-air printing');
  const { sl } = run(SAMPLES.find((s) => s.id === 'bridge'), 'mk3s');
  check(sl.layers.some((L) => L.paths.some((p) => p.bridge)), 'bridge test: bridge infill detected');
  const { sl: cube } = run(SAMPLES[0], 'mk3s');
  const L = cube.layers[30];
  const outer = L.paths.filter((p) => p.type === 1);
  check(outer.length === 1, 'cube: one outer wall per layer');
  check(cube.layers[cube.layers.length - 1].paths.some((p) => p.top), 'cube: top surface detected');
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
