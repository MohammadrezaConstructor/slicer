// Infill pattern generators. Each pattern is generated over the bounding box of the region and
// then clipped to the region with Clipper, which keeps only the parts of the lines that are inside.
import { SCALE, clipLines, offset, pathsBounds } from './clip.js';

/**
 * Parallel lines at `angleDeg`, `spacing` mm apart, covering the bounds.
 * Lines are anchored to the world origin so that consecutive layers line up (important for grid).
 */
export function parallelLines(bounds, angleDeg, spacing, phase = 0) {
  const a = (angleDeg * Math.PI) / 180;
  const dx = Math.cos(a), dy = Math.sin(a); // along the line
  const nx = -dy, ny = dx; // across the lines
  const corners = [
    [bounds.minX, bounds.minY], [bounds.maxX, bounds.minY],
    [bounds.maxX, bounds.maxY], [bounds.minX, bounds.maxY],
  ];
  let nMin = Infinity, nMax = -Infinity, dMin = Infinity, dMax = -Infinity;
  for (const [x, y] of corners) {
    const n = x * nx + y * ny, d = x * dx + y * dy;
    nMin = Math.min(nMin, n); nMax = Math.max(nMax, n);
    dMin = Math.min(dMin, d); dMax = Math.max(dMax, d);
  }
  const s = spacing * SCALE, ph = phase * SCALE;
  const lines = [];
  dMin -= SCALE; dMax += SCALE;
  for (let k = Math.ceil((nMin - ph) / s); k * s + ph <= nMax; k++) {
    const n = k * s + ph;
    lines.push([
      { X: Math.round(n * nx + dMin * dx), Y: Math.round(n * ny + dMin * dy) },
      { X: Math.round(n * nx + dMax * dx), Y: Math.round(n * ny + dMax * dy) },
    ]);
  }
  return lines;
}

/** Gyroid: a 3D wavy surface; each layer is a slice through it. Traced with marching squares. */
function gyroidLines(bounds, spacing, z) {
  // Line length per area of a gyroid slice ≈ 2.43 / period, so this period gives ≈ the same
  // amount of material as straight lines `spacing` apart.
  const period = 2.43 * spacing;
  const k = (2 * Math.PI) / period;
  const r = period / 16; // grid resolution in mm
  const x0 = bounds.minX / SCALE - r, y0 = bounds.minY / SCALE - r;
  const nx = Math.ceil((bounds.maxX / SCALE - x0) / r) + 2;
  const ny = Math.ceil((bounds.maxY / SCALE - y0) / r) + 2;
  if (nx * ny > 4e6) return parallelLines(bounds, 45, spacing); // too big: fall back
  const W = nx + 1;
  const sz = Math.sin(z * k), cz = Math.cos(z * k);
  const f = new Float64Array(W * (ny + 1));
  for (let j = 0; j <= ny; j++) {
    const Y = (y0 + j * r) * k, sy = Math.sin(Y), cy = Math.cos(Y);
    for (let i = 0; i <= nx; i++) {
      const X = (x0 + i * r) * k;
      f[j * W + i] = Math.sin(X) * cy + sy * cz + sz * Math.cos(X);
    }
  }
  const V = W * (ny + 1); // offset for vertical-edge keys
  const pts = new Map();
  const adj = new Map();
  const edgePoint = (key) => {
    if (pts.has(key)) return;
    let i, j, fa, fb, ax, ay, bx, by;
    if (key < V) { j = Math.floor(key / W); i = key % W; fa = f[key]; fb = f[key + 1]; ax = i; ay = j; bx = i + 1; by = j; }
    else { const kk = key - V; j = Math.floor(kk / W); i = kk % W; fa = f[kk]; fb = f[kk + W]; ax = i; ay = j; bx = i; by = j + 1; }
    const t = fa / (fa - fb);
    pts.set(key, [x0 + (ax + (bx - ax) * t) * r, y0 + (ay + (by - ay) * t) * r]);
  };
  const link = (a, b) => {
    edgePoint(a); edgePoint(b);
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a).push(b);
    adj.get(b).push(a);
  };
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const a = f[j * W + i] > 0, b = f[j * W + i + 1] > 0, c = f[(j + 1) * W + i + 1] > 0, d = f[(j + 1) * W + i] > 0;
      const bottom = j * W + i, top = (j + 1) * W + i, left = V + j * W + i, right = V + j * W + i + 1;
      const e = [];
      if (a !== b) e.push(bottom);
      if (b !== c) e.push(right);
      if (c !== d) e.push(top);
      if (d !== a) e.push(left);
      if (e.length === 2) link(e[0], e[1]);
      else if (e.length === 4) {
        const center = (f[j * W + i] + f[j * W + i + 1] + f[(j + 1) * W + i + 1] + f[(j + 1) * W + i]) / 4 > 0;
        if (center === a) { link(bottom, right); link(top, left); }
        else { link(bottom, left); link(top, right); }
      }
    }
  }
  // Chain edge points into polylines: start at open ends first, then remaining closed loops.
  const used = new Set();
  const lines = [];
  const walk = (start) => {
    const line = [];
    let prev = -1, cur = start;
    while (cur !== undefined && !used.has(cur)) {
      used.add(cur);
      const p = pts.get(cur);
      line.push({ X: Math.round(p[0] * SCALE), Y: Math.round(p[1] * SCALE) });
      const nb = adj.get(cur);
      const next = nb.find((n) => n !== prev && !used.has(n));
      prev = cur;
      cur = next;
    }
    if (line.length >= 2) lines.push(line);
  };
  for (const [key, nb] of adj) if (nb.length === 1 && !used.has(key)) walk(key);
  for (const key of adj.keys()) if (!used.has(key)) walk(key);
  return lines;
}

/**
 * Generate infill for `region` (already shrunk to where line centres may go).
 * Returns { open: [paths], closed: [paths] } in Clipper integer coordinates.
 */
export function fillRegion(region, pattern, density, lineWidth, layerIndex, z) {
  if (!region.length || density <= 0) return { open: [], closed: [] };
  const d = Math.min(density, 100) / 100;
  const spacing = lineWidth / d;
  const b = pathsBounds(region);
  let lines = [];
  switch (pattern) {
    case 'solid':
    case 'lines':
      lines = parallelLines(b, layerIndex % 2 ? 135 : 45, spacing);
      break;
    case 'grid':
      lines = [...parallelLines(b, 45, spacing * 2), ...parallelLines(b, 135, spacing * 2)];
      break;
    case 'triangles':
      lines = [0, 60, 120].flatMap((a) => parallelLines(b, a, spacing * 3));
      break;
    case 'gyroid':
      lines = gyroidLines(b, spacing, z);
      break;
    case 'concentric': {
      const closed = [];
      let cur = region;
      for (let i = 0; i < 1000 && cur.length; i++) {
        closed.push(...cur);
        cur = offset(cur, -spacing);
      }
      return { open: [], closed };
    }
    default:
      lines = parallelLines(b, 45, spacing);
  }
  return { open: clipLines(lines, region), closed: [] };
}
