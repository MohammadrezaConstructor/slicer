// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 The Slicer Lab authors
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
export function fillRegion(region, pattern, density, lineWidth, layerIndex, z, opts = {}) {
  if (!region.length || density <= 0) return { open: [], closed: [] };
  const d = Math.min(density, 100) / 100;
  const spacing = (opts.spacing || lineWidth) / d;
  const b = pathsBounds(region);
  let lines = [];
  switch (pattern) {
    case 'solid':
    case 'lines':
      lines = parallelLines(b, opts.angle ?? (layerIndex % 2 ? 135 : 45), spacing);
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
  let open = clipLines(lines, region);
  if (opts.connect) open = connectLines(open, offset(region, lineWidth * 0.6), spacing * 2.2 * ({ grid: 2, triangles: 3, gyroid: 1.5 }[pattern] || 1) + lineWidth);
  return { open, closed: [] };
}

/**
 * Join neighbouring infill lines into zig-zags, like real slicers do: the end of one line is
 * connected to the nearest free end of another line if the connecting move stays inside `region`
 * (so it runs along the wall instead of crossing a hole). Fewer separate lines means fewer travel
 * moves and retractions — and a much more realistic print time.
 * Input/Output: Clipper open paths.
 */
export function connectLines(lines, region, maxGap) {
  if (lines.length < 2) return lines;
  const loops = region.map((p) => {
    const a = new Float64Array(p.length * 2);
    p.forEach((pt, i) => { a[i * 2] = pt.X / SCALE; a[i * 2 + 1] = pt.Y / SCALE; });
    return a;
  });
  const segs = lines.map((l) => l.map((p) => [p.X / SCALE, p.Y / SCALE]));
  const cell = maxGap;
  const grid = new Map();
  const key = (x, y) => Math.floor(x / cell) + ',' + Math.floor(y / cell);
  segs.forEach((s, i) => {
    for (const end of [0, 1]) {
      const p = end ? s[s.length - 1] : s[0];
      const k = key(p[0], p[1]);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push({ i, end });
    }
  });
  const used = new Uint8Array(segs.length);
  const nearestFree = (P) => {
    const cx = Math.floor(P[0] / cell), cy = Math.floor(P[1] / cell);
    const cands = [];
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        for (const c of grid.get(cx + dx + ',' + (cy + dy)) || []) {
          if (used[c.i]) continue;
          const s = segs[c.i], q = c.end ? s[s.length - 1] : s[0];
          const d = Math.hypot(q[0] - P[0], q[1] - P[1]);
          if (d <= maxGap) cands.push({ ...c, d, q });
        }
      }
    cands.sort((a, b) => a.d - b.d);
    for (const c of cands) if (c.d < 1e-6 || connectorInside(loops, P, c.q)) return c;
    return null;
  };
  const extend = (chain) => {
    for (;;) {
      const c = nearestFree(chain[chain.length - 1]);
      if (!c) return;
      used[c.i] = 1;
      const s = segs[c.i];
      const pts = c.end ? s.slice().reverse() : s;
      for (const p of pts) chain.push(p);
    }
  };
  const out = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    let chain = segs[i].slice();
    extend(chain);
    chain.reverse();
    extend(chain);
    out.push(chain.map(([x, y]) => ({ X: Math.round(x * SCALE), Y: Math.round(y * SCALE) })));
  }
  return out;
}

function connectorInside(loops, P, Q) {
  const [ax, ay] = P, [bx, by] = Q;
  const minX = Math.min(ax, bx), maxX = Math.max(ax, bx), minY = Math.min(ay, by), maxY = Math.max(ay, by);
  for (const L of loops) {
    const n = L.length;
    for (let i = 0; i < n; i += 2) {
      const cx = L[i], cy = L[i + 1], dx = L[(i + 2) % n], dy = L[(i + 3) % n];
      if (Math.max(cx, dx) < minX || Math.min(cx, dx) > maxX || Math.max(cy, dy) < minY || Math.min(cy, dy) > maxY) continue;
      const d1 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
      const d2 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
      const d3 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      const d4 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
      if (d1 * d2 < 0 && d3 * d4 < 0) return false;
    }
  }
  // midpoint inside (even-odd)
  const px = (ax + bx) / 2, py = (ay + by) / 2;
  let inside = false;
  for (const L of loops) {
    const n = L.length;
    for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
      const xi = L[i], yi = L[i + 1], xj = L[j], yj = L[j + 1];
      if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/**
 * Bridge direction: try angles and keep the one where most line length is anchored at both
 * ends on the layer below (lines must span the gap, like a rope between two posts).
 */
export function bridgeAngle(zone, below, lineWidth) {
  const b = pathsBounds(zone);
  const belowLoops = below.map((p) => {
    const a = new Float64Array(p.length * 2);
    p.forEach((pt, i) => { a[i * 2] = pt.X / SCALE; a[i * 2 + 1] = pt.Y / SCALE; });
    return a;
  });
  const inBelow = (x, y) => {
    let inside = false;
    for (const L of belowLoops) {
      const n = L.length;
      for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
        const xi = L[i], yi = L[i + 1], xj = L[j], yj = L[j + 1];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
    }
    return inside;
  };
  let best = 0, bestScore = -1;
  for (let a = 0; a < 180; a += 15) {
    const lines = clipLines(parallelLines(b, a, lineWidth * 3), zone);
    let score = 0;
    for (const l of lines) {
      const p = l[0], q = l[l.length - 1];
      const len = Math.hypot(q.X - p.X, q.Y - p.Y) / SCALE;
      if (inBelow(p.X / SCALE, p.Y / SCALE) && inBelow(q.X / SCALE, q.Y / SCALE)) score += len;
    }
    if (score > bestScore + 1e-6) { bestScore = score; best = a; }
  }
  return best;
}
