// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 The Slicer Lab authors
// Feature types: what each extruded line is for. Codes are shared by the slicer, the G-code
// writer/parser (via ";TYPE:" comments) and the viewer.
export const FEATURE = { OTHER: 0, OUTER: 1, INNER: 2, SKIN: 3, FILL: 4, SUPPORT: 5, SKIRT: 6, PRIME: 7 };

// Colours: a colour-blind-checked categorical palette, in fixed order (always shown with text labels).
export const FEATURE_INFO = [
  { code: 0, tag: 'CUSTOM', label: 'Other', color: '#898781' },
  { code: 1, tag: 'WALL-OUTER', label: 'Outer wall', color: '#2a78d6' },
  { code: 2, tag: 'WALL-INNER', label: 'Inner wall', color: '#eb6834' },
  { code: 3, tag: 'SKIN', label: 'Top/bottom skin', color: '#1baf7a' },
  { code: 4, tag: 'FILL', label: 'Infill', color: '#eda100' },
  { code: 5, tag: 'SUPPORT', label: 'Support', color: '#e87ba4' },
  { code: 6, tag: 'SKIRT', label: 'Skirt / brim', color: '#008300' },
  { code: 7, tag: 'PRIME', label: 'Prime line', color: '#6250d6' },
];

/** Map a ";TYPE:" comment from any common slicer (Cura, PrusaSlicer, Orca/Bambu…) to a feature code. */
export function featureFromComment(text) {
  const t = text.trim().toLowerCase();
  if (t.includes('support')) return FEATURE.SUPPORT;
  if (t.includes('skirt') || t.includes('brim')) return FEATURE.SKIRT;
  if (t.includes('outer') || t.includes('external') || t.includes('overhang perimeter')) return FEATURE.OUTER;
  if (t.includes('wall') || t.includes('perimeter')) return FEATURE.INNER;
  if (t.includes('skin') || t.includes('solid') || t.includes('top') || t.includes('bottom') || t.includes('bridge') || t.includes('ironing')) return FEATURE.SKIN;
  if (t.includes('fill')) return FEATURE.FILL;
  if (t.includes('prime') || t.includes('purge') || t.includes('wipe')) return FEATURE.PRIME;
  return FEATURE.OTHER;
}
