// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 The Slicer Lab authors
// Plain-language explanations of G-code commands, for the G-code viewer and the simulator.
import { KIND } from '../core/gcodeParser.js';

export const COMMANDS = {
  G0: { name: 'Travel move', text: 'Move quickly to a position without extruding. Used to get from one printed line to the next.' },
  G1: { name: 'Linear move', text: 'Move in a straight line. If the E value increases, plastic is extruded along the way; if only E changes, the extruder moves on its own (retraction).' },
  G2: { name: 'Arc (clockwise)', text: 'Move along a clockwise arc. I and J give the centre of the circle relative to the start point.' },
  G3: { name: 'Arc (counter-clockwise)', text: 'Move along a counter-clockwise arc. I and J give the centre of the circle relative to the start point.' },
  G4: { name: 'Dwell', text: 'Wait. P = milliseconds, S = seconds.' },
  G10: { name: 'Firmware retract', text: 'Retract the filament using the distance stored in the printer.' },
  G11: { name: 'Firmware un-retract', text: 'Push the filament back after a firmware retract.' },
  G20: { name: 'Inches', text: 'Coordinates are in inches (almost never used for 3D printing).' },
  G21: { name: 'Millimetres', text: 'Coordinates are in millimetres.' },
  G28: { name: 'Home', text: 'Move each axis until it touches its endstop switch. Now the printer knows where X=0, Y=0, Z=0 are. Must be done before printing.' },
  G29: { name: 'Bed levelling', text: 'Probe the bed at several points to measure how flat it is; the printer then compensates while printing.' },
  G80: { name: 'Mesh bed levelling (Prusa)', text: 'The probe measures the bed height at several points; while printing, Z is adjusted so the first layer is even everywhere. Takes about a minute.' },
  G90: { name: 'Absolute positioning', text: 'X, Y and Z values are coordinates on the bed (not distances from the current position).' },
  G91: { name: 'Relative positioning', text: 'X, Y and Z values are distances from the current position.' },
  G92: { name: 'Set position', text: 'Tell the printer "you are now at this position" without moving. "G92 E0" resets the filament counter to zero.' },
  M82: { name: 'Absolute extrusion', text: 'E values are the total length of filament since the last reset — each E must be larger than the previous one to extrude.' },
  M83: { name: 'Relative extrusion', text: 'E values are the length of filament for this move only.' },
  M862: { name: 'Printer check (Prusa)', text: 'Checks that the G-code was made for this printer model and nozzle size; the printer warns you if not.' },
  M900: { name: 'Linear advance', text: 'Pressure compensation: the extruder pushes a little extra when speeding up and a little less when slowing down, so corners are sharp.' },
  M907: { name: 'Motor current', text: 'Sets the current of the stepper motors (here the extruder).' },
  M84: { name: 'Motors off', text: 'Switch off the stepper motors so the axes can be moved by hand.' },
  M18: { name: 'Motors off', text: 'Switch off the stepper motors.' },
  M104: { name: 'Set nozzle temperature', text: 'Start heating (or cooling) the nozzle to S °C and continue immediately, without waiting.' },
  M109: { name: 'Wait for nozzle temperature', text: 'Set the nozzle temperature to S °C and WAIT until it is reached. Nothing else happens meanwhile — watch the thermometer in the simulator.' },
  M140: { name: 'Set bed temperature', text: 'Start heating the bed to S °C without waiting.' },
  M190: { name: 'Wait for bed temperature', text: 'Set the bed temperature to S °C and WAIT until it is reached. Heating a bed takes minutes.' },
  M106: { name: 'Fan on', text: 'Switch the part-cooling fan on. S is the speed from 0 (off) to 255 (full).' },
  M107: { name: 'Fan off', text: 'Switch the part-cooling fan off.' },
  M105: { name: 'Report temperatures', text: 'Ask the printer to report its temperatures.' },
  M117: { name: 'Display message', text: 'Show a text message on the printer\'s screen.' },
  M73: { name: 'Progress', text: 'Tell the printer how far the print is (for the progress bar on its screen).' },
  M201: { name: 'Max acceleration', text: 'Set the maximum acceleration of each axis.' },
  M203: { name: 'Max feed rate', text: 'Set the maximum speed of each axis.' },
  M204: { name: 'Acceleration', text: 'Set the default acceleration for printing and travel moves.' },
  M205: { name: 'Jerk', text: 'Set the "jerk": the speed change that may happen instantly, e.g. at corners.' },
  M220: { name: 'Speed factor', text: 'Scale all speeds by S percent.' },
  M221: { name: 'Flow factor', text: 'Scale all extrusion by S percent.' },
  M300: { name: 'Beep', text: 'Play a tone.' },
};

export const PARAMS = {
  X: 'X coordinate (left ↔ right)',
  Y: 'Y coordinate (front ↔ back)',
  Z: 'Z height (nozzle above the bed)',
  E: 'Extruder: filament in mm (with M83 the amount for this move, with M82 the running total)',
  F: 'Feed rate (speed) in mm per minute',
  S: 'Value (temperature in °C, fan speed 0–255, or seconds)',
  P: 'Time in milliseconds',
  I: 'Arc centre X offset',
  J: 'Arc centre Y offset',
  R: 'Temperature to wait for (heating or cooling)',
};

/** Explain one line. `move` is optional parser info for that line: { kind, e, feed }. */
export function explainLine(raw, move) {
  const sc = raw.indexOf(';');
  const comment = sc >= 0 ? raw.slice(sc + 1).trim() : '';
  const code = (sc >= 0 ? raw.slice(0, sc) : raw).trim().toUpperCase();
  if (!code) {
    if (/^LAYER:/.test(comment)) return { title: 'Comment: new layer', text: `Marks the start of layer ${comment.slice(6)}. Comments start with ";" — the printer ignores them, but they help people and viewers.` };
    if (/^TYPE:/.test(comment)) return { title: 'Comment: feature type', text: `The following lines print "${comment.slice(5)}". Slicers add these comments so viewers can colour the lines.` };
    if (comment) return { title: 'Comment', text: 'Text after ";" is a comment. The printer ignores it.' };
    return { title: 'Empty line', text: '' };
  }
  const m = /^([GM]\d+)/.exec(code);
  if (!m) return { title: code, text: 'Unknown command.' };
  const cmd = m[1].replace(/^([GM])0+(\d)/, '$1$2');
  const info = COMMANDS[cmd] || { name: 'Command ' + cmd, text: 'A printer-specific command.' };
  const params = [];
  const re = /([A-Z])\s*([-+]?(?:\d+\.?\d*|\.\d+))/g;
  let p;
  const rest = code.slice(m[1].length);
  while ((p = re.exec(rest))) params.push({ letter: p[1], value: parseFloat(p[2]), meaning: PARAMS[p[1]] || '' });
  const get = (l) => params.find((q) => q.letter === l)?.value;

  let text = info.text;
  if (cmd === 'G0' || cmd === 'G1') {
    const parts = [];
    const xyz = ['X', 'Y', 'Z'].filter((l) => get(l) !== undefined).map((l) => `${l}=${get(l)}`);
    const F = get('F');
    if (move && move.kind === KIND.RETRACT) {
      text = move.e < 0
        ? `Retraction: pull ${Math.abs(move.e).toFixed(2)} mm of filament back so that no plastic oozes out during the next travel.`
        : `Un-retract: push ${Math.abs(move.e).toFixed(2)} mm of filament forward again, ready to print.`;
    } else if (move && move.kind === KIND.EXTRUDE) {
      parts.push(`Print a line to ${xyz.join(', ')}`);
      parts.push(`while pushing ${move.e.toFixed(4)} mm of filament into the hot end`);
      text = parts.join(' ') + '.';
    } else if (xyz.length) {
      text = `Travel to ${xyz.join(', ')} without printing${get('Z') !== undefined && xyz.length === 1 ? ' (change height — usually a new layer)' : ''}.`;
    } else if (F !== undefined) {
      text = 'Only sets the speed for the next moves.';
    }
    if (F !== undefined) text += ` Speed F${F} = ${F} mm/min = ${(F / 60).toFixed(1)} mm/s.`;
  } else if (['M104', 'M109', 'M140', 'M190'].includes(cmd) && get('S') !== undefined) {
    text = info.text.replace('S °C', `${get('S')} °C`);
    if (get('S') === 0) text = `Switch the ${cmd === 'M104' || cmd === 'M109' ? 'nozzle' : 'bed'} heater off.`;
  } else if (cmd === 'M106' && get('S') !== undefined) {
    text = `Part-cooling fan at ${Math.round((get('S') / 255) * 100)}% (S${get('S')} of 255).`;
  } else if (cmd === 'G92' && get('E') !== undefined) {
    text = `Reset the filament counter: from now on the current extruder position is called E=${get('E')}.`;
  }
  if (comment) text += ` (Comment: "${comment}")`;
  return { title: `${cmd} — ${info.name}`, text, params };
}
