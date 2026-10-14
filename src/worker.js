// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 The Slicer Lab authors
// Runs the heavy work off the main thread so the UI stays responsive.
import { slice } from './core/slicer.js';
import { writeGcode, addProgressInfo } from './core/gcodeWriter.js';
import { parseGcode } from './core/gcodeParser.js';
import { analyzeSupport } from './core/analysis.js';
import { machineFor } from './core/printers.js';

function transferables(parsed, analysis) {
  const list = [];
  for (const k of ['px', 'py', 'pz', 'e', 'feed', 'kind', 'type', 'layer', 'line', 't0', 'dur', 'width', 'vEntry', 'vPeak', 'accel', 'accUntil', 'decAfter']) list.push(parsed[k].buffer);
  for (const k of ['overAir', 'isBridge', 'sagStart', 'sagCount', 'sagValues']) list.push(analysis[k].buffer);
  return list;
}

self.onmessage = (ev) => {
  const { cmd, id, settings } = ev.data;
  const progress = (stage, frac) => self.postMessage({ type: 'progress', id, stage, frac });
  const machine = machineFor(settings, settings.printer);
  try {
    if (cmd === 'slice') {
      const sl = slice(ev.data.tris, settings, (stage, f) => progress(stage, f * 0.8));
      progress('Writing G-code', 0.82);
      let gcode = writeGcode(sl, settings);
      progress('Simulating the printer', 0.86);
      // first pass for the time estimate, then add progress info (M73) and parse the final file
      gcode = addProgressInfo(gcode, parseGcode(gcode, { machine }), settings);
      const parsed = parseGcode(gcode, { machine });
      progress('Checking overhangs', 0.95);
      const analysis = analyzeSupport(parsed);
      self.postMessage(
        { type: 'result', id, gcode, meta: sl.meta, warnings: sl.warnings, sliceStats: sl.stats, parsed, analysis },
        transferables(parsed, analysis),
      );
    } else if (cmd === 'parse') {
      progress('Simulating the printer', 0.5);
      const parsed = parseGcode(ev.data.gcode, { machine });
      progress('Checking overhangs', 0.9);
      const analysis = analyzeSupport(parsed);
      self.postMessage({ type: 'result', id, gcode: ev.data.gcode, meta: null, warnings: [], parsed, analysis }, transferables(parsed, analysis));
    }
  } catch (err) {
    self.postMessage({ type: 'error', id, message: err && err.stack ? err.stack : String(err) });
  }
};
