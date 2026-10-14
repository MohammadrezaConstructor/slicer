// Slicer settings: schema, defaults, presets and the teaching text shown next to each setting.
// Units: mm, mm/s, °C, %, seconds.

export const GROUPS = [
  { id: 'printer', label: 'Printer' },
  { id: 'material', label: 'Material' },
  { id: 'quality', label: 'Quality (layers)' },
  { id: 'walls', label: 'Walls' },
  { id: 'topbottom', label: 'Top / Bottom' },
  { id: 'infill', label: 'Infill' },
  { id: 'speed', label: 'Speed' },
  { id: 'travel', label: 'Travel & Retraction' },
  { id: 'cooling', label: 'Cooling' },
  { id: 'support', label: 'Support' },
  { id: 'adhesion', label: 'Bed Adhesion' },
  { id: 'gcode', label: 'G-code' },
];

// level: 'basic' settings are always visible, 'expert' only in expert view.
export const SCHEMA = [
  // ---------------- Printer ----------------
  { key: 'bedX', group: 'printer', label: 'Bed width (X)', type: 'number', unit: 'mm', default: 220, min: 50, max: 1000, step: 1, level: 'expert',
    help: 'Size of the printable area along X. The slicer warns you when the model does not fit.' },
  { key: 'bedY', group: 'printer', label: 'Bed depth (Y)', type: 'number', unit: 'mm', default: 220, min: 50, max: 1000, step: 1, level: 'expert',
    help: 'Size of the printable area along Y.' },
  { key: 'bedZ', group: 'printer', label: 'Max height (Z)', type: 'number', unit: 'mm', default: 250, min: 50, max: 1000, step: 1, level: 'expert',
    help: 'How tall a part the printer can build.' },
  { key: 'nozzle', group: 'printer', label: 'Nozzle diameter', type: 'number', unit: 'mm', default: 0.4, min: 0.1, max: 1.2, step: 0.05, level: 'basic',
    help: 'The hole the molten plastic comes out of. 0.4 mm is the most common. A bigger nozzle prints faster but with less detail. Line width and layer height are chosen relative to this number: line width ≈ 100–120 % of the nozzle, layer height ≤ 75 % of the nozzle.' },
  { key: 'filamentDiameter', group: 'printer', label: 'Filament diameter', type: 'number', unit: 'mm', default: 1.75, min: 1, max: 3.2, step: 0.05, level: 'expert',
    help: 'Diameter of the plastic wire fed into the printer (1.75 mm or 2.85 mm). The slicer needs it to convert "volume of plastic I need" into "millimetres of filament to push" (the E value in G-code).' },

  // ---------------- Material ----------------
  { key: 'material', group: 'material', label: 'Material preset', type: 'select', default: 'PLA', level: 'basic',
    options: [['PLA', 'PLA'], ['PETG', 'PETG'], ['ABS', 'ABS'], ['TPU', 'TPU (flexible)']],
    help: 'Choosing a material loads typical temperatures, fan and retraction values for it. PLA is easiest; PETG is tougher; ABS needs a hot bed and no fan (it warps); TPU is rubbery and must be printed slowly.' },
  { key: 'nozzleTemp', group: 'material', label: 'Nozzle temperature', type: 'number', unit: '°C', default: 210, min: 150, max: 300, step: 5, level: 'basic',
    help: 'Temperature of the hot end. Too cold → under-extrusion and weak layer bonding. Too hot → stringing, oozing and drooping overhangs. Watch the start of the simulation: the printer waits (M109) until this temperature is reached.' },
  { key: 'bedTemp', group: 'material', label: 'Bed temperature', type: 'number', unit: '°C', default: 60, min: 0, max: 120, step: 5, level: 'basic',
    help: 'A heated bed keeps the first layers soft and sticky so the part does not curl up at the corners (warping). Heating the bed is slow — watch the M190 wait in the simulation.' },
  { key: 'flow', group: 'material', label: 'Flow', type: 'number', unit: '%', default: 100, min: 50, max: 150, step: 1, level: 'expert',
    help: 'Multiplies every E (extrusion) value. Used to calibrate a printer that pushes a bit too much or too little plastic.' },
  { key: 'filamentDensity', group: 'material', label: 'Material density', type: 'number', unit: 'g/cm³', default: 1.24, min: 0.5, max: 3, step: 0.01, level: 'expert',
    help: 'Used to convert the length of filament into weight (grams).' },
  { key: 'filamentCost', group: 'material', label: 'Spool price', type: 'number', unit: 'per kg', default: 20, min: 0, max: 500, step: 1, level: 'expert',
    help: 'Used for the cost estimate.' },

  // ---------------- Quality ----------------
  { key: 'layerHeight', group: 'quality', label: 'Layer height', type: 'number', unit: 'mm', default: 0.2, min: 0.04, max: 1, step: 0.02, level: 'basic',
    help: 'Thickness of each layer. THE most important trade-off in 3D printing: thinner layers = smoother curved/sloped surfaces but many more layers, so a much longer print. Try 0.1 vs 0.3 and compare the print time and the "staircase" on the sphere.' },
  { key: 'firstLayerHeight', group: 'quality', label: 'First layer height', type: 'number', unit: 'mm', default: 0.25, min: 0.05, max: 1, step: 0.01, level: 'expert',
    help: 'The first layer is often a bit thicker: it squeezes the plastic onto the bed and hides small bed-levelling errors.' },
  { key: 'lineWidth', group: 'quality', label: 'Line width', type: 'number', unit: 'mm', default: 0.42, min: 0.1, max: 2, step: 0.01, level: 'expert',
    help: 'How wide each extruded line (bead) is. Usually a little wider than the nozzle, because the nozzle squashes the plastic flat. Walls thinner than one line width cannot be printed.' },

  // ---------------- Walls ----------------
  { key: 'wallCount', group: 'walls', label: 'Wall count', type: 'number', unit: 'lines', default: 2, min: 0, max: 20, step: 1, level: 'basic',
    help: 'Number of outline loops (perimeters) around every layer. Walls give a part most of its strength — more walls is usually stronger than more infill. Each wall is the outline shrunk ("offset") inward by one line width.' },
  { key: 'outerWallFirst', group: 'walls', label: 'Print outer wall first', type: 'bool', default: false, level: 'expert',
    help: 'Printing the outer wall first gives more accurate dimensions; printing it last (default) gives a nicer surface and better overhangs because the outer wall can lean on the inner walls.' },
  { key: 'seam', group: 'walls', label: 'Seam position', type: 'select', default: 'aligned', level: 'expert',
    options: [['aligned', 'Aligned (back)'], ['nearest', 'Nearest (fastest)'], ['random', 'Random']],
    help: 'Every closed loop must start and end somewhere, leaving a small blob — the seam. Aligned puts all seams on one line at the back; nearest saves travel time but scatters seams; random hides them as noise. Look at the outer wall starting points in the layer view.' },

  // ---------------- Top / Bottom ----------------
  { key: 'topLayers', group: 'topbottom', label: 'Top layers', type: 'number', unit: 'layers', default: 4, min: 0, max: 50, step: 1, level: 'basic',
    help: 'Number of solid layers on upward-facing surfaces. The first top layers have to bridge over the sparse infill, so you need several to get a closed, smooth top. Try 1 and look at the top in the preview.' },
  { key: 'bottomLayers', group: 'topbottom', label: 'Bottom layers', type: 'number', unit: 'layers', default: 3, min: 0, max: 50, step: 1, level: 'basic',
    help: 'Number of solid layers on downward-facing surfaces (including the bottom of the part).' },

  // ---------------- Infill ----------------
  { key: 'infillDensity', group: 'infill', label: 'Infill density', type: 'number', unit: '%', default: 20, min: 0, max: 100, step: 1, level: 'basic',
    help: 'How much of the inside is filled with plastic. 0 % = hollow, 100 % = solid. 15–25 % is typical for decorative parts; functional parts use more. Watch how time and material change.' },
  { key: 'infillPattern', group: 'infill', label: 'Infill pattern', type: 'select', default: 'grid', level: 'basic',
    options: [['lines', 'Lines'], ['grid', 'Grid'], ['triangles', 'Triangles'], ['gyroid', 'Gyroid'], ['concentric', 'Concentric']],
    help: 'Shape of the inside structure. Lines is fastest but weak in one direction. Grid and triangles are stronger. Gyroid is a wavy 3D structure that is equally strong in all directions. Concentric follows the outline.' },
  { key: 'infillOverlap', group: 'infill', label: 'Infill/wall overlap', type: 'number', unit: '%', default: 15, min: 0, max: 50, step: 1, level: 'expert',
    help: 'How far the infill lines reach into the innermost wall, so they bond to it.' },

  // ---------------- Speed ----------------
  { key: 'infillSpeed', group: 'speed', label: 'Infill speed', type: 'number', unit: 'mm/s', default: 60, min: 5, max: 500, step: 5, level: 'basic',
    help: 'Infill is hidden, so it is printed fastest.' },
  { key: 'outerWallSpeed', group: 'speed', label: 'Outer wall speed', type: 'number', unit: 'mm/s', default: 30, min: 5, max: 500, step: 5, level: 'basic',
    help: 'The outer wall is what you see, so it is printed slowly for quality.' },
  { key: 'innerWallSpeed', group: 'speed', label: 'Inner wall speed', type: 'number', unit: 'mm/s', default: 45, min: 5, max: 500, step: 5, level: 'expert',
    help: 'Speed of the inner perimeters.' },
  { key: 'skinSpeed', group: 'speed', label: 'Top/bottom speed', type: 'number', unit: 'mm/s', default: 40, min: 5, max: 500, step: 5, level: 'expert',
    help: 'Speed of solid top and bottom layers.' },
  { key: 'supportSpeed', group: 'speed', label: 'Support speed', type: 'number', unit: 'mm/s', default: 50, min: 5, max: 500, step: 5, level: 'expert',
    help: 'Speed of support structures.' },
  { key: 'firstLayerSpeed', group: 'speed', label: 'First layer speed', type: 'number', unit: 'mm/s', default: 20, min: 5, max: 200, step: 1, level: 'basic',
    help: 'The first layer is printed slowly so that it sticks well to the bed. A failed first layer means a failed print.' },
  { key: 'travelSpeed', group: 'speed', label: 'Travel speed', type: 'number', unit: 'mm/s', default: 150, min: 10, max: 1000, step: 10, level: 'basic',
    help: 'Speed of moves without extruding (G0). Fast travel reduces oozing and print time.' },
  { key: 'acceleration', group: 'speed', label: 'Acceleration', type: 'number', unit: 'mm/s²', default: 1000, min: 50, max: 20000, step: 50, level: 'expert',
    help: 'How quickly the print head reaches its speed. With short lines the printer never reaches full speed, which is why doubling the speed rarely halves the print time. Used by the time estimate.' },

  // ---------------- Travel ----------------
  { key: 'retraction', group: 'travel', label: 'Enable retraction', type: 'bool', default: true, level: 'basic',
    help: 'Before travelling, pull the filament back a little so molten plastic does not ooze out and leave "strings". In the G-code this is a G1 move that only changes E (negative).' },
  { key: 'retractDistance', group: 'travel', label: 'Retraction distance', type: 'number', unit: 'mm', default: 2, min: 0, max: 10, step: 0.1, level: 'basic',
    help: 'How much filament to pull back. Direct-drive extruders need ~0.5–2 mm; Bowden tubes need 4–7 mm.' },
  { key: 'retractSpeed', group: 'travel', label: 'Retraction speed', type: 'number', unit: 'mm/s', default: 35, min: 1, max: 100, step: 1, level: 'expert',
    help: 'How fast the filament is pulled back and pushed again.' },
  { key: 'retractMinTravel', group: 'travel', label: 'Min. travel for retraction', type: 'number', unit: 'mm', default: 1.5, min: 0, max: 20, step: 0.1, level: 'expert',
    help: 'Short travels are not worth a retraction.' },
  { key: 'combing', group: 'travel', label: 'Combing (avoid retract inside part)', type: 'bool', default: true, level: 'expert',
    help: 'If a travel move stays inside the part, any string would be hidden inside — so no retraction is needed. Saves time and filament wear.' },
  { key: 'zHop', group: 'travel', label: 'Z-hop when retracted', type: 'number', unit: 'mm', default: 0, min: 0, max: 5, step: 0.1, level: 'expert',
    help: 'Lift the nozzle during travels so it does not scrape over the printed part.' },

  // ---------------- Cooling ----------------
  { key: 'fanSpeed', group: 'cooling', label: 'Fan speed', type: 'number', unit: '%', default: 100, min: 0, max: 100, step: 5, level: 'basic',
    help: 'The part-cooling fan solidifies the plastic right after it leaves the nozzle. Essential for overhangs and bridges with PLA; ABS prefers little or no fan (it cracks).' },
  { key: 'fanStartLayer', group: 'cooling', label: 'Fan full from layer', type: 'number', unit: '', default: 2, min: 1, max: 50, step: 1, level: 'expert',
    help: 'The fan is off for the first layer(s) so they stay hot and stick to the bed.' },
  { key: 'minLayerTime', group: 'cooling', label: 'Minimum layer time', type: 'number', unit: 's', default: 8, min: 0, max: 60, step: 1, level: 'expert',
    help: 'Small layers are printed so fast that the plastic below is still soft. The slicer slows down such layers so each one takes at least this long. Compare the tip of the cone with and without this.' },
  { key: 'minSpeed', group: 'cooling', label: 'Minimum speed', type: 'number', unit: 'mm/s', default: 10, min: 1, max: 100, step: 1, level: 'expert',
    help: 'The slow-down for cooling never goes below this speed.' },

  // ---------------- Support ----------------
  { key: 'support', group: 'support', label: 'Generate support', type: 'bool', default: false, level: 'basic',
    help: 'Plastic cannot be printed in mid-air. Support structures hold up overhangs and are removed after printing. Turn this off on the T-shape or overhang test and simulate to see what happens!' },
  { key: 'supportAngle', group: 'support', label: 'Overhang angle', type: 'number', unit: '°', default: 55, min: 0, max: 89, step: 1, level: 'basic',
    help: 'Measured from vertical: 0° is a vertical wall, 90° is a flat ceiling. Surfaces leaning out more than this get support. Each layer can stick out a little past the one below (the "45° rule"), so moderate overhangs print fine without support.' },
  { key: 'supportPlacement', group: 'support', label: 'Placement', type: 'select', default: 'everywhere', level: 'expert',
    options: [['everywhere', 'Everywhere'], ['buildplate', 'Touching build plate only']],
    help: 'Build-plate-only never puts support on top of the model (no scars on the part) but some overhangs stay unsupported.' },
  { key: 'supportDensity', group: 'support', label: 'Support density', type: 'number', unit: '%', default: 15, min: 5, max: 100, step: 1, level: 'expert',
    help: 'Denser support holds overhangs better but is harder to remove and uses more material.' },
  { key: 'supportRoofLayers', group: 'support', label: 'Support roof layers', type: 'number', unit: 'layers', default: 2, min: 0, max: 10, step: 1, level: 'expert',
    help: 'The top layers of the support (the "interface" or "roof") are printed densely, so the bottom of the overhang has a flat surface to sit on. With 0 the bottom surface sags between the sparse support lines — try it and look at the over-air colour mode.' },
  { key: 'supportXYGap', group: 'support', label: 'Support XY distance', type: 'number', unit: 'mm', default: 0.7, min: 0, max: 5, step: 0.1, level: 'expert',
    help: 'Horizontal gap between support and walls so the support does not fuse to the part.' },
  { key: 'supportZGap', group: 'support', label: 'Support Z distance', type: 'number', unit: 'layers', default: 1, min: 0, max: 5, step: 1, level: 'expert',
    help: 'Empty layers between the top of the support and the part, so the support can be broken off.' },

  // ---------------- Adhesion ----------------
  { key: 'adhesion', group: 'adhesion', label: 'Adhesion type', type: 'select', default: 'skirt', level: 'basic',
    options: [['none', 'None'], ['skirt', 'Skirt'], ['brim', 'Brim']],
    help: 'Skirt: a loop around the part that primes the nozzle (it does not touch the part). Brim: extra loops attached to the part that increase the area touching the bed — helps small or tall parts and materials that warp.' },
  { key: 'skirtDistance', group: 'adhesion', label: 'Skirt distance', type: 'number', unit: 'mm', default: 3, min: 0.5, max: 20, step: 0.5, level: 'expert',
    help: 'Gap between the skirt and the part.' },
  { key: 'skirtLines', group: 'adhesion', label: 'Skirt lines', type: 'number', unit: 'lines', default: 2, min: 1, max: 10, step: 1, level: 'expert',
    help: 'Number of skirt loops.' },
  { key: 'brimWidth', group: 'adhesion', label: 'Brim width', type: 'number', unit: 'mm', default: 6, min: 1, max: 30, step: 0.5, level: 'expert',
    help: 'How far the brim extends from the part.' },

  // ---------------- G-code ----------------
  { key: 'teachingComments', group: 'gcode', label: 'Explain G-code with comments', type: 'bool', default: true, level: 'basic',
    help: 'Adds comments (text after ";") to the G-code that explain what the start and end sequences do. Printers ignore comments.' },
  { key: 'primeLine', group: 'gcode', label: 'Prime (purge) line', type: 'bool', default: true, level: 'expert',
    help: 'Draws a line at the front of the bed before printing so the nozzle is full of fresh plastic.' },
];

export const MATERIALS = {
  PLA: { nozzleTemp: 210, bedTemp: 60, fanSpeed: 100, filamentDensity: 1.24, retractDistance: 2, minLayerTime: 8 },
  PETG: { nozzleTemp: 240, bedTemp: 80, fanSpeed: 40, filamentDensity: 1.27, retractDistance: 2.5, minLayerTime: 10 },
  ABS: { nozzleTemp: 250, bedTemp: 100, fanSpeed: 0, filamentDensity: 1.04, retractDistance: 2, minLayerTime: 15 },
  TPU: { nozzleTemp: 225, bedTemp: 50, fanSpeed: 60, filamentDensity: 1.21, retractDistance: 0.5, minLayerTime: 10,
    infillSpeed: 25, outerWallSpeed: 20, innerWallSpeed: 25, skinSpeed: 20, supportSpeed: 25 },
};

// Typical temperature windows, used for warnings.
export const MATERIAL_RANGES = {
  PLA: { nozzle: [185, 230], bed: [0, 70] },
  PETG: { nozzle: [220, 260], bed: [60, 90] },
  ABS: { nozzle: [230, 270], bed: [90, 115] },
  TPU: { nozzle: [200, 240], bed: [0, 60] },
};

export const QUALITY_PRESETS = {
  draft: { label: 'Draft 0.3 mm', layerHeight: 0.3, firstLayerHeight: 0.3, wallCount: 2, topLayers: 3, bottomLayers: 3, infillDensity: 15 },
  normal: { label: 'Normal 0.2 mm', layerHeight: 0.2, firstLayerHeight: 0.25, wallCount: 2, topLayers: 4, bottomLayers: 3, infillDensity: 20 },
  fine: { label: 'Fine 0.1 mm', layerHeight: 0.1, firstLayerHeight: 0.2, wallCount: 3, topLayers: 7, bottomLayers: 5, infillDensity: 20 },
};

export const PRINTERS = {
  small: { label: 'Small printer (180 × 180 × 180)', bedX: 180, bedY: 180, bedZ: 180 },
  medium: { label: 'Medium printer (220 × 220 × 250)', bedX: 220, bedY: 220, bedZ: 250 },
  large: { label: 'Large printer (300 × 300 × 300)', bedX: 300, bedY: 300, bedZ: 300 },
};

export function defaultSettings() {
  const s = {};
  for (const item of SCHEMA) s[item.key] = item.default;
  return s;
}

export function schemaFor(key) {
  return SCHEMA.find((s) => s.key === key);
}
