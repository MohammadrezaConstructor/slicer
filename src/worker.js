// Runs the heavy work off the main thread so the UI stays responsive.
import { slice } from './core/slicer.js';
import { writeGcode } from './core/gcodeWriter.js';
import { parseGcode } from './core/gcodeParser.js';
import { analyzeSupport } from './core/analysis.js';

function parseAndAnalyse(gcode, settings, id, progress) {
  progress('Reading G-code', 0.9);
  const parsed = parseGcode(gcode, settings);
  progress('Checking overhangs', 0.95);
  const analysis = analyzeSupport(parsed);
  return { parsed, analysis };
}

function transferables(parsed, analysis) {
  const list = [];
  for (const k of ['px', 'py', 'pz', 'e', 'feed', 'kind', 'type', 'layer', 'line', 't0', 'dur', 'width']) list.push(parsed[k].buffer);
  for (const k of ['overAir', 'isBridge', 'sagStart', 'sagCount', 'sagValues']) list.push(analysis[k].buffer);
  return list;
}

self.onmessage = (ev) => {
  const { cmd, id } = ev.data;
  const progress = (stage, frac) => self.postMessage({ type: 'progress', id, stage, frac });
  try {
    if (cmd === 'slice') {
      const { tris, settings } = ev.data;
      const sl = slice(tris, settings, (stage, f) => progress(stage, f * 0.8));
      progress('Writing G-code', 0.85);
      const gcode = writeGcode(sl, settings);
      const { parsed, analysis } = parseAndAnalyse(gcode, settings, id, progress);
      self.postMessage(
        { type: 'result', id, gcode, meta: sl.meta, warnings: sl.warnings, sliceStats: sl.stats, parsed, analysis },
        transferables(parsed, analysis),
      );
    } else if (cmd === 'parse') {
      const { gcode, settings } = ev.data;
      const { parsed, analysis } = parseAndAnalyse(gcode, settings, id, progress);
      self.postMessage({ type: 'result', id, gcode, meta: null, warnings: [], parsed, analysis }, transferables(parsed, analysis));
    }
  } catch (err) {
    self.postMessage({ type: 'error', id, message: err && err.stack ? err.stack : String(err) });
  }
};
