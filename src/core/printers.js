// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 The Slicer Lab authors
// Real printer and material profiles.
//
// Sources (details and licences in THIRD_PARTY_NOTICES.md):
//   PrusaSlicer system profiles as shipped in the PrusaSlicer 2.9.6 release (resources/profiles:
//   PrusaResearch.ini config 2.4.14, Creality.ini config 1.1.0), AGPL-3.0, Prusa Research,
//   https://github.com/prusa3d/PrusaSlicer. The start/end G-code below
//   is taken from these profiles, with PrusaSlicer placeholders replaced by settings.
//
// Machine limits, print speeds/accelerations, start/end G-code and filament data are taken from
// the official PrusaSlicer 2.9 system profiles:
//   - "Original Prusa i3 MK3S & MK3S+" + "0.20mm QUALITY @MK3" + "Prusament PLA" (PrusaResearch bundle)
//   - "Creality Ender-3 (0.4 mm nozzle)" + "0.20 mm NORMAL (0.4 mm nozzle) @CREALITY" + "Generic PLA @CREALITY"
// Heater and homing behaviour is not in those profiles; it is modelled from typical measurements
// (see VALIDATION.md) and marked as an estimate in the app.

export const PRINTER_PROFILES = {
  mk3s: {
    label: 'Prusa i3 MK3S+',
    description: 'Direct-drive extruder, all-metal hot end, Marlin-based firmware with classic jerk, mesh bed levelling with an inductive probe (G80).',
    flavor: 'marlin',
    settings: {
      bedX: 250, bedY: 210, bedZ: 210, nozzle: 0.4, filamentDiameter: 1.75,
      // machine limits (M201/M203/M204/M205)
      maxFeedX: 200, maxFeedY: 200, maxFeedZ: 12, maxFeedE: 120,
      maxAccelX: 1000, maxAccelY: 1000, maxAccelZ: 200, maxAccelE: 5000,
      jerkX: 8, jerkY: 8, jerkZ: 0.4, jerkE: 4.5,
      maxPrintAccel: 1250, retractAccel: 1250,
      // print profile "0.20mm QUALITY @MK3"
      layerHeight: 0.2, firstLayerHeight: 0.2, lineWidth: 0.45, firstLayerLineWidth: 0.42,
      wallCount: 2, topLayers: 5, bottomLayers: 4, infillDensity: 15, infillPattern: 'gyroid', infillOverlap: 15,
      outerWallSpeed: 25, innerWallSpeed: 45, infillSpeed: 80, skinSpeed: 80, topSkinSpeed: 40, supportSpeed: 50,
      bridgeSpeed: 25, smallPerimeterSpeed: 25, firstLayerSpeed: 20, travelSpeed: 180,
      defaultAccel: 1000, wallAccel: 800, infillAccel: 1000, bridgeAccel: 1000, firstLayerAccel: 800,
      retraction: true, retractDistance: 0.8, retractSpeed: 35, retractMinTravel: 1, zHop: 0.4, retractLayerChange: true, combing: false,
      seam: 'aligned', adhesion: 'skirt', skirtLines: 1, skirtDistance: 2,
    },
    heaters: {
      // first-order model: heating at full power approaches `max` with time constant `tau` (s)
      nozzle: { max: 400, tau: 120, cool: 160, residency: 3 },
      bed: { max: 140, tau: 400, cool: 900, residency: 3 },
    },
    homing: { parked: [0, 200, 70], feedXY: 50, feedZ: 13.3, settle: 6 },
    commandTimes: { G80: 55, G29: 55 },
    start: (S, b) => [
      'M862.3 P "MK3S" ; printer model check',
      `M862.1 P${S.nozzle} ; nozzle diameter check`,
      'G90 ; use absolute coordinates',
      'M83 ; extruder relative mode',
      `M104 S${S.firstLayerNozzleTemp} ; set extruder temp`,
      `M140 S${S.firstLayerBedTemp} ; set bed temp`,
      `M190 S${S.firstLayerBedTemp} ; wait for bed temp`,
      `M109 S${S.firstLayerNozzleTemp} ; wait for extruder temp`,
      'G28 W ; home all without mesh bed level',
      `G80 X${b.minX.toFixed(2)} Y${b.minY.toFixed(2)} W${(b.maxX - b.minX).toFixed(2)} H${(b.maxY - b.minY).toFixed(2)} ; mesh bed levelling`,
      'G1 Z0.2 F720',
      'G1 Y-3 F1000 ; go outside print area',
      'G92 E0',
      'G1 X60 E9 F1000 ; intro line',
      'G1 X100 E12.5 F1000 ; intro line',
      'G92 E0',
    ],
    end: (S, maxZ) => [
      `G1 Z${Math.min(maxZ + 1, S.bedZ).toFixed(2)} F720 ; move print head up`,
      'G1 X0 Y200 F3600 ; park',
      `G1 Z${Math.min(maxZ + 49, S.bedZ).toFixed(2)} F720 ; move print head further up`,
      'G4 ; wait',
      'M104 S0 ; turn off temperature',
      'M140 S0 ; turn off heatbed',
      'M107 ; turn off fan',
      'M84 ; disable motors',
    ],
  },

  ender3: {
    label: 'Creality Ender-3',
    description: 'Bowden extruder (long PTFE tube → long retractions), PTFE-lined hot end, Marlin with classic jerk, no automatic bed levelling.',
    flavor: 'marlin',
    settings: {
      bedX: 220, bedY: 220, bedZ: 250, nozzle: 0.4, filamentDiameter: 1.75,
      maxFeedX: 500, maxFeedY: 500, maxFeedZ: 10, maxFeedE: 60,
      maxAccelX: 500, maxAccelY: 500, maxAccelZ: 100, maxAccelE: 5000,
      jerkX: 8, jerkY: 8, jerkZ: 0.4, jerkE: 5,
      maxPrintAccel: 500, retractAccel: 1000,
      // print profile "0.20 mm NORMAL (0.4 mm nozzle) @CREALITY"
      layerHeight: 0.2, firstLayerHeight: 0.2, lineWidth: 0.44, firstLayerLineWidth: 0.42,
      wallCount: 3, topLayers: 5, bottomLayers: 4, infillDensity: 15, infillPattern: 'grid', infillOverlap: 15,
      outerWallSpeed: 25, innerWallSpeed: 40, infillSpeed: 50, skinSpeed: 40, topSkinSpeed: 30, supportSpeed: 40,
      bridgeSpeed: 25, smallPerimeterSpeed: 25, firstLayerSpeed: 20, travelSpeed: 150,
      defaultAccel: 500, wallAccel: 500, infillAccel: 500, bridgeAccel: 250, firstLayerAccel: 500,
      retraction: true, retractDistance: 5, retractSpeed: 60, retractMinTravel: 2, zHop: 0, retractLayerChange: true, combing: false,
      seam: 'nearest', adhesion: 'skirt', skirtLines: 1, skirtDistance: 3,
    },
    heaters: {
      // calibrated to user measurements: bed 18→60 °C ≈ 3 min, →110 °C ≈ 12 min; nozzle →210 °C ≈ 1.7 min
      // (3DPrinterly, https://3dprinterly.com/3d-printer-heated-bed-max-temperatures-real-examples/)
      nozzle: { max: 400, tau: 150, cool: 180, residency: 10 },
      bed: { max: 135, tau: 450, cool: 1000, residency: 10 },
    },
    homing: { parked: [5, 187, 150], feedXY: 50, feedZ: 4, settle: 6 },
    commandTimes: { G29: 75 },
    start: (S) => [
      'G90 ; use absolute coordinates',
      'M83 ; extruder relative mode',
      'M104 S150 ; set temporary nozzle temp to prevent oozing during homing',
      `M140 S${S.firstLayerBedTemp} ; set final bed temp`,
      'G4 S30 ; allow partial nozzle warmup',
      'G28 ; home all axis',
      'G1 Z50 F240',
      'G1 X2.0 Y10 F3000',
      `M104 S${S.firstLayerNozzleTemp} ; set final nozzle temp`,
      `M190 S${S.firstLayerBedTemp} ; wait for bed temp to stabilize`,
      `M109 S${S.firstLayerNozzleTemp} ; wait for nozzle temp to stabilize`,
      'G1 Z0.28 F240',
      'G92 E0',
      'G1 X2.0 Y140 E10 F1500 ; prime the nozzle',
      'G1 X2.3 Y140 F5000',
      'G92 E0',
      'G1 X2.3 Y10 E10 F1200 ; prime the nozzle',
      'G92 E0',
    ],
    end: (S, maxZ) => [
      `G1 Z${Math.min(maxZ + 2, S.bedZ).toFixed(2)} F600 ; move print head up`,
      `G1 X5 Y${(S.bedY * 0.85).toFixed(0)} F${S.travelSpeed * 60} ; present print`,
      `G1 Z${Math.max(Math.min(maxZ + 70, S.bedZ - 10), S.bedZ * 0.6).toFixed(2)} F600 ; move print head further up`,
      'M140 S0 ; turn off heatbed',
      'M104 S0 ; turn off temperature',
      'M107 ; turn off fan',
      'M84 X Y E ; disable motors',
    ],
  },
};

// Filament data from PrusaSlicer's generic filament profiles (temperatures in °C, cost per kg,
// maximum volumetric speed in mm³/s for a standard V6/MK8 class hot end).
export const MATERIAL_PROFILES = {
  PLA: { nozzleTemp: 210, firstLayerNozzleTemp: 215, bedTemp: 60, firstLayerBedTemp: 60, filamentDensity: 1.24, filamentCost: 25.4, maxVolumetric: 15, fanSpeed: 100, fanOffLayers: 1, bridgeFan: 100, minLayerTime: 12, minSpeed: 15 },
  PETG: { nozzleTemp: 240, firstLayerNozzleTemp: 240, bedTemp: 90, firstLayerBedTemp: 85, filamentDensity: 1.27, filamentCost: 27.82, maxVolumetric: 8, fanSpeed: 50, fanOffLayers: 3, bridgeFan: 50, minLayerTime: 15, minSpeed: 15, retractDistanceDirect: 1, zHopDirect: 0.2 },
  ABS: { nozzleTemp: 255, firstLayerNozzleTemp: 255, bedTemp: 110, firstLayerBedTemp: 100, filamentDensity: 1.04, filamentCost: 27.82, maxVolumetric: 11, fanSpeed: 15, fanOffLayers: 4, bridgeFan: 25, minLayerTime: 20, minSpeed: 15 },
  ASA: { nozzleTemp: 260, firstLayerNozzleTemp: 260, bedTemp: 110, firstLayerBedTemp: 105, filamentDensity: 1.07, filamentCost: 35.28, maxVolumetric: 11, fanSpeed: 20, fanOffLayers: 4, bridgeFan: 20, minLayerTime: 15, minSpeed: 15 },
  TPU: { nozzleTemp: 240, firstLayerNozzleTemp: 240, bedTemp: 50, firstLayerBedTemp: 50, filamentDensity: 1.22, filamentCost: 82, maxVolumetric: 1.2, fanSpeed: 90, fanOffLayers: 3, bridgeFan: 80, minLayerTime: 15, minSpeed: 15, retractDistanceDirect: 0 },
};

// Printer-specific filament adjustments that the vendor profiles make.
export const MATERIAL_OVERRIDES = {
  ender3: { PLA: { nozzleTemp: 205, firstLayerNozzleTemp: 210, minLayerTime: 20 } },
  mk3s: { PLA: { nozzleTemp: 215, firstLayerNozzleTemp: 215, filamentCost: 27.99 } },
};

/** Settings for a material on a given printer. */
export function materialSettings(printerId, material) {
  const base = { ...MATERIAL_PROFILES[material], ...(MATERIAL_OVERRIDES[printerId]?.[material] || {}) };
  const out = { material };
  for (const [k, v] of Object.entries(base)) if (!k.endsWith('Direct')) out[k] = v;
  if (printerId === 'mk3s') {
    if (base.retractDistanceDirect !== undefined) out.retractDistance = base.retractDistanceDirect;
    if (base.zHopDirect !== undefined) out.zHop = base.zHopDirect;
  }
  if (material === 'TPU') out.retraction = printerId === 'mk3s' ? false : true;
  return out;
}

/** Everything the G-code parser needs to simulate a printer. */
export function machineFor(S, printerId) {
  const prof = PRINTER_PROFILES[printerId] || PRINTER_PROFILES.mk3s;
  return {
    flavor: prof.flavor,
    limits: {
      maxFeed: [S.maxFeedX, S.maxFeedY, S.maxFeedZ, S.maxFeedE],
      maxAccel: [S.maxAccelX, S.maxAccelY, S.maxAccelZ, S.maxAccelE],
      jerk: [S.jerkX, S.jerkY, S.jerkZ, S.jerkE],
      printAccel: S.maxPrintAccel, retractAccel: S.retractAccel, travelAccel: 1250,
      maxPrintAccel: S.maxPrintAccel, maxRetractAccel: S.retractAccel, maxTravelAccel: 0,
      flavor: prof.flavor,
    },
    heaters: prof.heaters,
    homing: prof.homing,
    commandTimes: prof.commandTimes,
    filamentDiameter: S.filamentDiameter,
  };
}
