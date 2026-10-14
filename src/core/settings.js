// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 The Slicer Lab authors
// Slicer settings: schema, defaults, presets and the teaching text shown next to each setting.
// Units: mm, mm/s, mm/s², °C, %, seconds. Defaults are the Prusa MK3S+ profile with PLA
// (see printers.js for where the numbers come from).
import { PRINTER_PROFILES, materialSettings } from './printers.js';

export const GROUPS = [
  { id: 'printer', label: 'Printer' },
  { id: 'material', label: 'Material' },
  { id: 'quality', label: 'Quality (layers)' },
  { id: 'walls', label: 'Walls' },
  { id: 'topbottom', label: 'Top / Bottom' },
  { id: 'infill', label: 'Infill' },
  { id: 'speed', label: 'Speed' },
  { id: 'accel', label: 'Acceleration' },
  { id: 'travel', label: 'Travel & Retraction' },
  { id: 'cooling', label: 'Cooling' },
  { id: 'support', label: 'Support' },
  { id: 'adhesion', label: 'Bed Adhesion' },
  { id: 'machine', label: 'Machine limits (firmware)' },
  { id: 'gcode', label: 'G-code' },
];

const num = (key, group, label, unit, def, min, max, step, level, help) => ({ key, group, label, type: 'number', unit, default: def, min, max, step, level, help });

// level: 'basic' settings are always visible, 'expert' only in "All settings".
export const SCHEMA = [
  // ---------------- Printer ----------------
  { key: 'printer', group: 'printer', label: 'Printer', type: 'select', default: 'mk3s', level: 'basic',
    options: [['mk3s', 'Prusa i3 MK3S+'], ['ender3', 'Creality Ender-3'], ['custom', 'Custom']],
    help: 'Loads the real machine limits, speeds, accelerations, retraction and start/end G-code of this printer (from the official PrusaSlicer profiles). The print time estimate uses the same motion planning as the printer firmware.' },
  num('bedX', 'printer', 'Bed width (X)', 'mm', 250, 50, 1000, 1, 'expert', 'Size of the printable area along X. The slicer warns you when the model does not fit.'),
  num('bedY', 'printer', 'Bed depth (Y)', 'mm', 210, 50, 1000, 1, 'expert', 'Size of the printable area along Y.'),
  num('bedZ', 'printer', 'Max height (Z)', 'mm', 210, 50, 1000, 1, 'expert', 'How tall a part the printer can build.'),
  num('nozzle', 'printer', 'Nozzle diameter', 'mm', 0.4, 0.1, 1.2, 0.05, 'basic',
    'The hole the molten plastic comes out of. 0.4 mm is the most common. A bigger nozzle prints faster but with less detail. Line width ≈ 100–120 % of the nozzle, layer height ≤ 75 % of the nozzle.'),
  num('filamentDiameter', 'printer', 'Filament diameter', 'mm', 1.75, 1, 3.2, 0.05, 'expert',
    'Diameter of the plastic wire (1.75 mm or 2.85 mm). Needed to convert "volume of plastic" into "millimetres of filament to push" (the E value in G-code).'),

  // ---------------- Material ----------------
  { key: 'material', group: 'material', label: 'Material', type: 'select', default: 'PLA', level: 'basic',
    options: [['PLA', 'PLA'], ['PETG', 'PETG'], ['ABS', 'ABS'], ['ASA', 'ASA'], ['TPU', 'TPU (flexible)']],
    help: 'Loads typical temperatures, cooling, flow limit and price for the material (PrusaSlicer generic profiles). PLA is easiest; PETG is tougher; ABS/ASA need a hot bed and little fan (they warp); TPU is rubbery and must be printed very slowly.' },
  num('nozzleTemp', 'material', 'Nozzle temperature', '°C', 215, 150, 300, 5, 'basic',
    'Temperature of the hot end after the first layer. Too cold → under-extrusion and weak layers. Too hot → stringing, oozing and drooping overhangs.'),
  num('firstLayerNozzleTemp', 'material', 'Nozzle temp. 1st layer', '°C', 215, 150, 300, 5, 'expert',
    'Often a bit hotter for better adhesion. The printer waits (M109) until it is reached before starting.'),
  num('bedTemp', 'material', 'Bed temperature', '°C', 60, 0, 120, 5, 'basic',
    'A heated bed keeps the first layers soft and sticky so the part does not curl up (warping). Heating a bed takes minutes — watch the M190 wait in the simulation.'),
  num('firstLayerBedTemp', 'material', 'Bed temp. 1st layer', '°C', 60, 0, 120, 5, 'expert', 'Bed temperature while printing the first layer.'),
  num('maxVolumetric', 'material', 'Max volumetric speed', 'mm³/s', 15, 0.5, 60, 0.5, 'expert',
    'How much plastic the hot end can melt per second. Faster printing needs more melted plastic: speed × line width × layer height. Above this limit the slicer automatically slows down — often the real limit of print speed! PLA ≈ 15, PETG ≈ 8, TPU ≈ 1–3 mm³/s on a standard hot end.'),
  num('flow', 'material', 'Flow', '%', 100, 50, 150, 1, 'expert', 'Multiplies every E (extrusion) value. Used to calibrate a printer that pushes a bit too much or too little plastic.'),
  num('filamentDensity', 'material', 'Material density', 'g/cm³', 1.24, 0.5, 3, 0.01, 'expert', 'Converts the length of filament into weight (grams).'),
  num('filamentCost', 'material', 'Spool price', 'per kg', 27.99, 0, 500, 1, 'expert', 'Used for the cost estimate.'),

  // ---------------- Quality ----------------
  num('layerHeight', 'quality', 'Layer height', 'mm', 0.2, 0.04, 1, 0.02, 'basic',
    'Thickness of each layer. THE most important trade-off: thinner layers = smoother curved and sloped surfaces but many more layers, so a much longer print.'),
  num('firstLayerHeight', 'quality', 'First layer height', 'mm', 0.2, 0.05, 1, 0.01, 'expert',
    'The first layer is often a bit thicker: it squeezes the plastic onto the bed and hides small bed-levelling errors.'),
  num('lineWidth', 'quality', 'Line width', 'mm', 0.45, 0.1, 2, 0.01, 'expert',
    'How wide each extruded line is. Usually a little wider than the nozzle, because the nozzle squashes the plastic flat. Walls thinner than one line width cannot be printed.'),
  num('firstLayerLineWidth', 'quality', 'First layer line width', 'mm', 0.42, 0.1, 2, 0.01, 'expert', 'Line width on the first layer.'),

  // ---------------- Walls ----------------
  num('wallCount', 'walls', 'Wall count', 'lines', 2, 0, 20, 1, 'basic',
    'Number of outline loops (perimeters) around every layer. Walls give a part most of its strength — more walls is usually stronger than more infill.'),
  { key: 'outerWallFirst', group: 'walls', label: 'Print outer wall first', type: 'bool', default: false, level: 'expert',
    help: 'Outer wall first gives more accurate dimensions; outer wall last (default) gives a nicer surface and better overhangs because it can lean on the inner walls.' },
  { key: 'seam', group: 'walls', label: 'Seam position', type: 'select', default: 'aligned', level: 'expert',
    options: [['aligned', 'Aligned (back)'], ['nearest', 'Nearest (fastest)'], ['random', 'Random']],
    help: 'Every loop starts and ends somewhere, leaving a small blob — the seam. Aligned puts all seams on one line at the back; nearest saves travel; random hides them as noise.' },

  // ---------------- Top / Bottom ----------------
  num('topLayers', 'topbottom', 'Top layers', 'layers', 5, 0, 50, 1, 'basic',
    'Solid layers on upward-facing surfaces. The first ones have to bridge over the sparse infill, so you need several for a closed, smooth top.'),
  num('bottomLayers', 'topbottom', 'Bottom layers', 'layers', 4, 0, 50, 1, 'basic', 'Solid layers on downward-facing surfaces (including the bottom of the part).'),

  // ---------------- Infill ----------------
  num('infillDensity', 'infill', 'Infill density', '%', 15, 0, 100, 1, 'basic',
    'How much of the inside is filled. 0 % = hollow, 100 % = solid. 15–25 % is typical for decorative parts; functional parts use more.'),
  { key: 'infillPattern', group: 'infill', label: 'Infill pattern', type: 'select', default: 'gyroid', level: 'basic',
    options: [['lines', 'Lines'], ['grid', 'Grid'], ['triangles', 'Triangles'], ['gyroid', 'Gyroid'], ['concentric', 'Concentric']],
    help: 'Shape of the inside structure. Lines is fastest but weak in one direction. Grid and triangles are stronger. Gyroid is a wavy 3D structure that is equally strong in all directions.' },
  { key: 'connectInfill', group: 'infill', label: 'Connect infill lines', type: 'bool', default: true, level: 'expert',
    help: 'Join neighbouring infill lines along the walls into zig-zags. Saves travel moves and retractions — real slicers do this.' },
  num('infillOverlap', 'infill', 'Infill/wall overlap', '%', 15, 0, 50, 1, 'expert', 'How far the infill reaches into the innermost wall, so they bond.'),

  // ---------------- Speed ----------------
  num('outerWallSpeed', 'speed', 'Outer wall speed', 'mm/s', 25, 5, 500, 5, 'basic', 'The outer wall is what you see, so it is printed slowly for quality.'),
  num('innerWallSpeed', 'speed', 'Inner wall speed', 'mm/s', 45, 5, 500, 5, 'expert', 'Speed of the inner perimeters.'),
  num('smallPerimeterSpeed', 'speed', 'Small perimeter speed', 'mm/s', 25, 5, 500, 5, 'expert', 'Loops shorter than 41 mm (holes, thin pins) are printed slowly so they do not get deformed.'),
  num('infillSpeed', 'speed', 'Infill speed', 'mm/s', 80, 5, 500, 5, 'basic', 'Infill is hidden, so it is printed fastest.'),
  num('skinSpeed', 'speed', 'Solid infill speed', 'mm/s', 80, 5, 500, 5, 'expert', 'Speed of solid infill (bottom layers and solid layers under the top).'),
  num('topSkinSpeed', 'speed', 'Top surface speed', 'mm/s', 40, 5, 500, 5, 'expert', 'The visible top surface is printed slower for a smooth finish.'),
  num('bridgeSpeed', 'speed', 'Bridge speed', 'mm/s', 25, 5, 500, 5, 'expert', 'Lines printed across air (bridges) are printed slowly with full cooling so they do not sag.'),
  num('supportSpeed', 'speed', 'Support speed', 'mm/s', 50, 5, 500, 5, 'expert', 'Speed of support structures.'),
  num('firstLayerSpeed', 'speed', 'First layer speed', 'mm/s', 20, 5, 200, 1, 'basic', 'The first layer is printed slowly so that it sticks well to the bed. A failed first layer means a failed print.'),
  num('travelSpeed', 'speed', 'Travel speed', 'mm/s', 180, 10, 1000, 10, 'basic', 'Speed of moves without extruding. Fast travel reduces oozing and print time — but the printer may not reach it (see machine limits).'),

  // ---------------- Acceleration ----------------
  num('defaultAccel', 'accel', 'Default acceleration', 'mm/s²', 1000, 50, 20000, 50, 'expert',
    'How quickly the head reaches its speed. With short lines the printer never reaches full speed — which is why doubling the speed rarely halves the print time. Written into the G-code as M204 S….'),
  num('wallAccel', 'accel', 'Wall acceleration', 'mm/s²', 800, 50, 20000, 50, 'expert', 'Lower acceleration on walls reduces ringing (ghosting) on the visible surface.'),
  num('infillAccel', 'accel', 'Infill acceleration', 'mm/s²', 1000, 50, 20000, 50, 'expert', 'Acceleration for infill and solid infill.'),
  num('bridgeAccel', 'accel', 'Bridge acceleration', 'mm/s²', 1000, 50, 20000, 50, 'expert', 'Acceleration for bridges.'),
  num('firstLayerAccel', 'accel', 'First layer acceleration', 'mm/s²', 800, 50, 20000, 50, 'expert', 'Acceleration on the first layer.'),

  // ---------------- Travel ----------------
  { key: 'retraction', group: 'travel', label: 'Enable retraction', type: 'bool', default: true, level: 'basic',
    help: 'Before travelling, pull the filament back a little so molten plastic does not ooze out and leave "strings". In the G-code this is a G1 move that only changes E (negative).' },
  num('retractDistance', 'travel', 'Retraction distance', 'mm', 0.8, 0, 10, 0.1, 'basic',
    'How much filament to pull back. Direct-drive extruders (MK3S) need ~0.5–1 mm; Bowden tubes (Ender-3) need 4–7 mm because the filament can move inside the long tube.'),
  num('retractSpeed', 'travel', 'Retraction speed', 'mm/s', 35, 1, 120, 1, 'expert', 'How fast the filament is pulled back and pushed again. The firmware limit for the extruder axis (max E feed rate) may cap it.'),
  num('retractMinTravel', 'travel', 'Min. travel for retraction', 'mm', 1, 0, 20, 0.1, 'expert', 'Short travels are not worth a retraction.'),
  { key: 'retractLayerChange', group: 'travel', label: 'Retract on layer change', type: 'bool', default: true, level: 'expert', help: 'Retract every time the nozzle moves up to the next layer.' },
  { key: 'combing', group: 'travel', label: 'Combing (no retract inside part)', type: 'bool', default: false, level: 'expert',
    help: 'If a travel stays inside the part, any string would be hidden inside — so no retraction is needed. Saves time. (Cura calls this combing.)' },
  num('zHop', 'travel', 'Z-hop when retracted', 'mm', 0.4, 0, 5, 0.1, 'expert', 'Lift the nozzle during travels so it does not scrape over the printed part.'),

  // ---------------- Cooling ----------------
  num('fanSpeed', 'cooling', 'Fan speed', '%', 100, 0, 100, 5, 'basic',
    'The part-cooling fan solidifies the plastic right after it leaves the nozzle. Essential for overhangs and bridges with PLA; ABS prefers little or no fan (it cracks).'),
  num('fanOffLayers', 'cooling', 'Fan off for first', 'layers', 1, 0, 20, 1, 'expert', 'The fan stays off for the first layer(s) so they stay hot and stick to the bed.'),
  num('bridgeFan', 'cooling', 'Bridge fan speed', '%', 100, 0, 100, 5, 'expert', 'Fan speed while printing bridges.'),
  num('minLayerTime', 'cooling', 'Minimum layer time', 's', 12, 0, 120, 1, 'expert',
    'Small layers are printed so fast that the plastic below is still soft. The slicer slows such layers down so each takes at least this long.'),
  num('minSpeed', 'cooling', 'Minimum print speed', 'mm/s', 15, 1, 100, 1, 'expert', 'The cooling slow-down never goes below this speed.'),

  // ---------------- Support ----------------
  { key: 'support', group: 'support', label: 'Generate support', type: 'bool', default: false, level: 'basic',
    help: 'Plastic cannot be printed in mid-air. Supports hold up overhangs and are removed after printing.' },
  num('supportAngle', 'support', 'Overhang angle', '°', 55, 0, 89, 1, 'basic',
    'Measured from vertical: 0° is a vertical wall, 90° is a flat ceiling. Surfaces leaning out more than this get support. (PrusaSlicer measures from horizontal: its 50° ≈ our 40°.)'),
  { key: 'supportPlacement', group: 'support', label: 'Placement', type: 'select', default: 'everywhere', level: 'expert',
    options: [['everywhere', 'Everywhere'], ['buildplate', 'Touching build plate only']],
    help: 'Build-plate-only never puts support on top of the model (no scars) but some overhangs stay unsupported.' },
  num('supportDensity', 'support', 'Support density', '%', 15, 5, 100, 1, 'expert', 'Denser support holds overhangs better but is harder to remove and uses more material.'),
  num('supportRoofLayers', 'support', 'Support roof layers', 'layers', 2, 0, 10, 1, 'expert',
    'The top layers of the support (the "interface" or roof) are dense so the overhang has a flat surface to sit on. With 0 the bottom surface sags between the sparse support lines.'),
  num('supportXYGap', 'support', 'Support XY distance', 'mm', 0.7, 0, 5, 0.1, 'expert', 'Horizontal gap between support and walls so the support does not fuse to the part.'),
  num('supportZGap', 'support', 'Support Z distance', 'layers', 1, 0, 5, 1, 'expert', 'Empty layers between the top of the support and the part, so the support can be broken off.'),

  // ---------------- Adhesion ----------------
  { key: 'adhesion', group: 'adhesion', label: 'Adhesion type', type: 'select', default: 'skirt', level: 'basic',
    options: [['none', 'None'], ['skirt', 'Skirt'], ['brim', 'Brim']],
    help: 'Skirt: a loop around the part that primes the nozzle. Brim: extra loops attached to the part that increase the area touching the bed — helps small or tall parts and materials that warp.' },
  num('skirtDistance', 'adhesion', 'Skirt distance', 'mm', 2, 0.5, 20, 0.5, 'expert', 'Gap between the skirt and the part.'),
  num('skirtLines', 'adhesion', 'Skirt lines', 'lines', 1, 1, 10, 1, 'expert', 'Number of skirt loops.'),
  num('brimWidth', 'adhesion', 'Brim width', 'mm', 5, 1, 30, 0.5, 'expert', 'How far the brim extends from the part.'),

  // ---------------- Machine limits ----------------
  num('maxFeedX', 'machine', 'Max speed X', 'mm/s', 200, 10, 2000, 10, 'expert', 'Fastest the X axis may move (M203). If you ask for more, the printer simply moves at this speed.'),
  num('maxFeedY', 'machine', 'Max speed Y', 'mm/s', 200, 10, 2000, 10, 'expert', 'Fastest the Y axis may move (M203).'),
  num('maxFeedZ', 'machine', 'Max speed Z', 'mm/s', 12, 1, 100, 1, 'expert', 'The Z axis uses a fine lead screw, so it is slow. Layer changes and Z-hops are limited by this.'),
  num('maxFeedE', 'machine', 'Max speed E', 'mm/s', 120, 1, 200, 1, 'expert', 'Fastest the extruder motor may turn. Limits retraction speed.'),
  num('maxAccelX', 'machine', 'Max acceleration X', 'mm/s²', 1000, 50, 50000, 50, 'expert', 'Highest acceleration the X axis may use (M201), whatever the slicer asks for.'),
  num('maxAccelY', 'machine', 'Max acceleration Y', 'mm/s²', 1000, 50, 50000, 50, 'expert', 'Highest acceleration the Y axis may use. On a "bed slinger" (Ender-3, MK3S) the whole bed moves in Y.'),
  num('maxAccelZ', 'machine', 'Max acceleration Z', 'mm/s²', 200, 10, 5000, 10, 'expert', 'Highest acceleration of the Z axis.'),
  num('maxAccelE', 'machine', 'Max acceleration E', 'mm/s²', 5000, 100, 50000, 100, 'expert', 'Highest acceleration of the extruder.'),
  num('maxPrintAccel', 'machine', 'Max print acceleration', 'mm/s²', 1250, 50, 50000, 50, 'expert', 'Upper limit for M204 values while printing.'),
  num('retractAccel', 'machine', 'Retract acceleration', 'mm/s²', 1250, 50, 50000, 50, 'expert', 'Acceleration of retraction moves.'),
  num('jerkX', 'machine', 'Jerk X', 'mm/s', 8, 0.1, 50, 0.1, 'expert',
    'Speed change the printer may make instantly, without accelerating (M205). Higher jerk = faster corners but more vibration (ringing).'),
  num('jerkY', 'machine', 'Jerk Y', 'mm/s', 8, 0.1, 50, 0.1, 'expert', 'Instant speed change allowed on Y.'),
  num('jerkZ', 'machine', 'Jerk Z', 'mm/s', 0.4, 0.05, 10, 0.05, 'expert', 'Instant speed change allowed on Z.'),
  num('jerkE', 'machine', 'Jerk E', 'mm/s', 4.5, 0.1, 50, 0.1, 'expert', 'Instant speed change allowed on the extruder.'),

  // ---------------- G-code ----------------
  { key: 'teachingComments', group: 'gcode', label: 'Explain G-code with comments', type: 'bool', default: true, level: 'basic',
    help: 'Adds comments (text after ";") that explain what the G-code does. Printers ignore comments.' },
];

// Simple quality presets: they only change the layer structure, not the printer.
export const QUALITY_PRESETS = {
  draft: { label: 'Draft 0.30 mm', layerHeight: 0.3, topLayers: 4, bottomLayers: 3 },
  normal: { label: 'Normal 0.20 mm', layerHeight: 0.2, topLayers: 5, bottomLayers: 4 },
  fine: { label: 'Fine 0.10 mm', layerHeight: 0.1, topLayers: 8, bottomLayers: 6 },
};

// Typical temperature windows, used for warnings.
export const MATERIAL_RANGES = {
  PLA: { nozzle: [190, 230], bed: [0, 70] },
  PETG: { nozzle: [220, 260], bed: [60, 95] },
  ABS: { nozzle: [235, 270], bed: [90, 115] },
  ASA: { nozzle: [240, 275], bed: [90, 115] },
  TPU: { nozzle: [210, 250], bed: [0, 60] },
};

/** Settings for a printer + material, starting from the schema defaults. */
export function profileSettings(printerId = 'mk3s', material = 'PLA') {
  const s = {};
  for (const item of SCHEMA) s[item.key] = item.default;
  const prof = PRINTER_PROFILES[printerId];
  if (prof) Object.assign(s, prof.settings);
  Object.assign(s, materialSettings(printerId in PRINTER_PROFILES ? printerId : 'mk3s', material));
  s.printer = printerId;
  return s;
}

export function defaultSettings() {
  return profileSettings('mk3s', 'PLA');
}

export function schemaFor(key) {
  return SCHEMA.find((s) => s.key === key);
}
