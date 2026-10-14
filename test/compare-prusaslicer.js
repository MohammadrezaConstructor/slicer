// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 The Slicer Lab authors
// Compare Slicer Lab with PrusaSlicer on the same models and printer profiles.
//
//   node test/compare-prusaslicer.js <dir>
//
// <dir> must contain G-code made by PrusaSlicer named ps_<printer>_<model>.gcode, e.g.
//   prusa-slicer-console --export-gcode --load mk3s.ini --center 110,110 cube.stl -o ps_mk3s_cube.gcode
// (mk3s.ini = "Original Prusa i3 MK3S & MK3S+" + "0.20mm QUALITY @MK3" + "Prusament PLA";
//  ender3.ini = "Creality Ender-3 (0.4 mm nozzle)" + "0.20 mm NORMAL (0.4 mm nozzle) @CREALITY" + "Generic PLA @CREALITY").
// The models are the built-in samples (export them with "Save STL" in the app).
//
// It reports two things:
//   1. our time estimate for PrusaSlicer's own G-code vs PrusaSlicer's estimate (tests the motion planner)
//   2. our slicer's G-code vs PrusaSlicer's G-code for the same model (tests the slicing)
import fs from 'fs';
import { SAMPLES } from '../src/core/primitives.js';
import { placeOnBed } from '../src/core/mesh.js';
import { profileSettings } from '../src/core/settings.js';
import { slice } from '../src/core/slicer.js';
import { writeGcode } from '../src/core/gcodeWriter.js';
import { parseGcode } from '../src/core/gcodeParser.js';
import { machineFor } from '../src/core/printers.js';

const dir = process.argv[2];
if (!dir) {
  console.log('usage: node test/compare-prusaslicer.js <dir with ps_<printer>_<model>.gcode files>');
  process.exit(1);
}
const mmss = (s) => ((r) => `${Math.floor(r / 60)}:${String(r % 60).padStart(2, "0")}`)(Math.round(s));
const pct = (a, b) => `${a >= b ? '+' : ''}${(((a - b) / b) * 100).toFixed(1)}%`;
console.log('file'.padEnd(24), 'PS estimate', 'our estimate of PS file', '| our slicer: time', 'filament');
for (const f of fs.readdirSync(dir).filter((n) => /^ps_(mk3s|ender3)_\w+\.gcode$/.test(n)).sort()) {
  const [, printer, model] = /^ps_(mk3s|ender3)_(\w+)\.gcode$/.exec(f);
  const S = profileSettings(printer, 'PLA');
  const machine = machineFor(S, printer);
  const ref = parseGcode(fs.readFileSync(`${dir}/${f}`, 'utf8'), { machine });
  const sample = SAMPLES.find((s) => s.id === model);
  let ours = '';
  if (sample) {
    const P = parseGcode(writeGcode(slice(placeOnBed(sample.build(), S.bedX, S.bedY), S), S), { machine });
    ours = `${mmss(P.stats.motionTime)} (${pct(P.stats.motionTime, ref.info.estimate)})  ${(P.stats.filament / 1000).toFixed(3)} m (${pct(P.stats.filament, ref.info.filamentMm)})`;
  }
  console.log(f.padEnd(24), mmss(ref.info.estimate).padStart(11), `${mmss(ref.stats.motionTime)} (${pct(ref.stats.motionTime, ref.info.estimate)})`.padStart(23), '|', ours);
}
