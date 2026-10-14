// Headless test of the whole pipeline on every built-in model: slice → G-code → parse → analyse.
// Run with: npm test
import { SAMPLES } from '../src/core/primitives.js';
import { placeOnBed, volume, bbox, parseSTL, toBinarySTL } from '../src/core/mesh.js';
import { defaultSettings } from '../src/core/settings.js';
import { slice } from '../src/core/slicer.js';
import { writeGcode } from '../src/core/gcodeWriter.js';
import { parseGcode, KIND } from '../src/core/gcodeParser.js';
import { analyzeSupport } from '../src/core/analysis.js';
import { area, offset } from '../src/core/clip.js';
import * as CL from '../src/core/clip.js';

let failures = 0;
const check = (cond, msg) => {
  if (!cond) {
    failures++;
    console.log('  FAIL: ' + msg);
  }
};

// STL round trip
{
  const tris = SAMPLES[0].build();
  const back = parseSTL(toBinarySTL(tris));
  check(back.length === tris.length && Math.abs(back[5] - tris[5]) < 1e-6, 'binary STL round trip');
  const ascii = 'solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid t\n';
  check(parseSTL(new TextEncoder().encode(ascii).buffer).length === 9, 'ascii STL parse');
}

const variants = [
  { name: 'default', s: {} },
  { name: 'support+brim', s: { support: true, adhesion: 'brim' } },
];

for (const sample of SAMPLES) {
  for (const v of variants) {
    if (v.name !== 'default' && !['tshape', 'overhang', 'sphere', 'cube'].includes(sample.id)) continue;
    const S = { ...defaultSettings(), ...v.s };
    const tris = placeOnBed(sample.build(), S.bedX, S.bedY);
    const vol = volume(tris);
    const t0 = performance.now();
    const sl = slice(tris, S);
    const t1 = performance.now();
    const gcode = writeGcode(sl, S);
    const t2 = performance.now();
    const P = parseGcode(gcode, S);
    const t3 = performance.now();
    const A = analyzeSupport(P);
    const t4 = performance.now();
    const filamentVol = P.stats.filament * Math.PI * (S.filamentDiameter / 2) ** 2;
    const extr = P.kind.reduce((n, k) => n + (k === KIND.EXTRUDE), 0);
    console.log(
      `${sample.id.padEnd(10)} ${v.name.padEnd(13)} vol ${vol.toFixed(0).padStart(6)} mm³  layers ${String(sl.layers.length).padStart(4)} (parsed ${P.layers.length})  ` +
        `moves ${String(P.n).padStart(6)}  time ${(P.stats.time / 60).toFixed(1).padStart(6)} min  fil ${(P.stats.filament / 1000).toFixed(2)} m  ` +
        `plastic ${filamentVol.toFixed(0)} mm³  overAir ${A.overAirLength.toFixed(0)} mm in ${A.badLayers} layers  ` +
        `[slice ${(t1 - t0).toFixed(0)} ms, gcode ${(t2 - t1).toFixed(0)}, parse ${(t3 - t2).toFixed(0)}, analyse ${(t4 - t3).toFixed(0)}]`,
    );
    for (const w of sl.warnings) console.log('   warn: ' + w.text.slice(0, 110));
    check(vol > 0, `${sample.id}: positive volume (outward normals)`);
    check(sl.layers.length === P.layers.length, `${sample.id}: parser layer count matches slicer (${sl.layers.length} vs ${P.layers.length})`);
    check(extr > 0, `${sample.id}: has extrusion moves`);
    check(filamentVol > 0 && filamentVol < vol * 1.5 + 2000, `${sample.id}: plausible plastic volume`);
    // outline of first layer must be counter-clockwise (positive area) and match the footprint
    const a0 = sl.meta.outlines[0].reduce((s, p) => s + CL.area([CL.fromXY(p)]), 0);
    check(a0 > 0, `${sample.id}: first-layer outline has positive area (${a0.toFixed(1)})`);
    if (v.name === 'default' && ['tshape', 'overhang'].includes(sample.id)) check(A.badLayers > 0, `${sample.id}: unsupported overhang detected`);
    if (v.name !== 'default' && sample.id === 'tshape') check(A.badLayers < 3, `${sample.id}: support removes over-air printing (bad layers ${A.badLayers})`);
  }
}

// cube sanity: 20 mm cube with 2 walls → outer wall loop length ≈ 4 × (20 − 0.42)
{
  const S = defaultSettings();
  const tris = placeOnBed(SAMPLES[0].build(), S.bedX, S.bedY);
  const sl = slice(tris, S);
  const L = sl.layers[30];
  const outer = L.paths.filter((p) => p.type === 1);
  check(outer.length === 1, 'cube: one outer wall per layer');
  let len = 0;
  const p = outer[0].pts;
  for (let i = 2; i < p.length; i += 2) len += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
  len += Math.hypot(p[0] - p[p.length - 2], p[1] - p[p.length - 1]);
  check(Math.abs(len - 4 * (20 - S.lineWidth)) < 0.05, `cube: outer wall length ${len.toFixed(3)}`);
  console.log('cube layer 30 paths:', L.paths.map((p) => p.type).join(''));
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
