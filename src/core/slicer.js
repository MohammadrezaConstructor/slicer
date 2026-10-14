// The slicer: turns a 3D mesh into an ordered list of 2D extrusion paths for every layer.
//
//  1. layer heights            computeLayers()
//  2. cut the mesh             sliceMesh()       triangle/plane intersections → closed loops
//  3. regions & islands        Clipper union     loops → filled areas with holes
//  4. walls                    offset inward by one line width per wall
//  5. top/bottom skin          area not covered by the layers above/below → solid fill
//  6. sparse infill            pattern lines clipped to the remaining inside area
//  7. support                  overhangs found by comparing with the layer below
//  8. skirt / brim             offsets around the first layer
//  9. path ordering            nearest-neighbour, seam placement
import { weld } from './mesh.js';
import * as CL from './clip.js';
import { fillRegion, parallelLines } from './infill.js';
import { FEATURE } from './features.js';

/** Layer list: z = top of the layer (where the nozzle is), sliceZ = where we cut the mesh (mid-layer). */
export function computeLayers(zmax, S) {
  const layers = [];
  const h0 = S.firstLayerHeight, h = S.layerHeight;
  layers.push({ z: h0, h: h0, sliceZ: h0 / 2 });
  let z = h0;
  while (z + h / 2 < zmax) {
    z += h;
    layers.push({ z, h, sliceZ: z - h / 2 });
  }
  return layers;
}

/**
 * Cut the welded mesh at each height in `zs` (ascending). Returns, per height, an array of
 * loops (flat [x,y,...] arrays in mm). Loops of solid outer contours run counter-clockwise.
 */
export function sliceMesh(mesh, zs) {
  const { verts, idx, nTris, nVerts } = mesh;
  const tzmin = new Float64Array(nTris), tzmax = new Float64Array(nTris);
  for (let t = 0; t < nTris; t++) {
    const a = verts[idx[t * 3] * 3 + 2], b = verts[idx[t * 3 + 1] * 3 + 2], c = verts[idx[t * 3 + 2] * 3 + 2];
    tzmin[t] = Math.min(a, b, c);
    tzmax[t] = Math.max(a, b, c);
  }
  const order = Array.from({ length: nTris }, (_, i) => i).sort((a, b) => tzmin[a] - tzmin[b]);
  let ptr = 0;
  let active = [];
  const out = [];
  for (const z of zs) {
    while (ptr < nTris && tzmin[order[ptr]] <= z) active.push(order[ptr++]);
    active = active.filter((t) => tzmax[t] > z);
    out.push(sliceActive(verts, idx, nVerts, active, z));
  }
  return out;
}

function sliceActive(verts, idx, nVerts, active, z) {
  const pts = new Map(); // edge key → [x, y]
  const next = new Map(); // segment start edge → end edge
  const ek = (p, q) => (p < q ? p * nVerts + q : q * nVerts + p);
  const point = (key, p, q) => {
    if (pts.has(key)) return;
    if (p > q) [p, q] = [q, p]; // canonical order → identical numbers from both neighbouring triangles
    const zp = verts[p * 3 + 2], zq = verts[q * 3 + 2];
    const t = (z - zp) / (zq - zp);
    pts.set(key, [verts[p * 3] + (verts[q * 3] - verts[p * 3]) * t, verts[p * 3 + 1] + (verts[q * 3 + 1] - verts[p * 3 + 1]) * t]);
  };
  for (const t of active) {
    const v = [idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]];
    let up = -1, down = -1;
    for (let e = 0; e < 3; e++) {
      const p = v[e], q = v[(e + 1) % 3];
      const ap = verts[p * 3 + 2] > z, aq = verts[q * 3 + 2] > z;
      if (ap === aq) continue;
      const key = ek(p, q);
      point(key, p, q);
      // Walking the triangle's edges in winding order: the edge where we go from above to
      // below is where the cut line starts, so that the solid ends up on the left.
      if (!ap && aq) up = key;
      else down = key;
    }
    if (up >= 0 && down >= 0 && up !== down) next.set(down, up);
  }
  // Chain segments into loops. Start with chain ends (broken meshes), then closed loops.
  const targets = new Set(next.values());
  const visited = new Set();
  const loops = [];
  const follow = (start) => {
    const loop = [];
    let cur = start;
    while (cur !== undefined && !visited.has(cur)) {
      visited.add(cur);
      const p = pts.get(cur);
      loop.push(p[0], p[1]);
      cur = next.get(cur);
    }
    if (loop.length >= 6) loops.push(loop);
  };
  for (const k of next.keys()) if (!targets.has(k)) follow(k);
  for (const k of next.keys()) if (!visited.has(k)) follow(k);
  return loops;
}

/** Contour at a single height, as Clipper islands (used by the "how slicing works" view). */
export function contourAtZ(mesh, z) {
  const loops = sliceMesh(mesh, [z])[0];
  return CL.islands(CL.clean(loops.map(CL.fromXY), 0.005));
}

// ---------------------------------------------------------------------------------------

/**
 * Main entry. `tris` must already be placed on the bed (z ≥ 0).
 * Returns { layers: [{ z, h, paths: [{ type, closed, pts }], comb }], meta, warnings }.
 */
export function slice(tris, S, progress = () => {}) {
  const w = S.lineWidth;
  progress('Welding mesh', 0);
  const mesh = weld(tris);
  let zmax = 0;
  for (let i = 2; i < mesh.verts.length; i += 3) zmax = Math.max(zmax, mesh.verts[i]);
  const layers = computeLayers(zmax, S);
  const n = layers.length;

  // --- 2+3: cut and build regions ---
  progress('Cutting layers', 0.05);
  const raw = sliceMesh(mesh, layers.map((l) => l.sliceZ));
  const regions = new Array(n);
  const islandsPer = new Array(n);
  for (let i = 0; i < n; i++) {
    const paths = CL.clean(raw[i].map(CL.fromXY), 0.005);
    islandsPer[i] = CL.islands(paths);
    regions[i] = islandsPer[i].flat();
  }

  // --- 4: walls, inner area, thin features that will be lost ---
  progress('Walls', 0.15);
  const islandData = new Array(n);
  const innerAll = new Array(n);
  const lostPer = new Array(n);
  let lostLayers = 0, lostArea = 0;
  for (let i = 0; i < n; i++) {
    const list = [];
    const inners = [];
    const lost = [];
    for (const island of islandsPer[i]) {
      const walls = [];
      for (let k = 0; k < S.wallCount; k++) {
        const loops = CL.offset(island, -(w / 2 + k * w));
        if (!loops.length) break;
        walls.push(loops);
      }
      const inner = S.wallCount > 0 ? CL.offset(island, -S.wallCount * w) : island;
      // Anything thinner than one line width cannot hold even a single line.
      const printable = CL.offset(CL.offset(island, -w / 2), w / 2);
      const thin = CL.dropSmall(CL.difference(island, printable), w * w);
      if (thin.length) lost.push(...thin);
      list.push({ island, walls, inner });
      inners.push(...inner);
    }
    islandData[i] = list;
    innerAll[i] = inners;
    lostPer[i] = lost;
    if (lost.length) {
      lostLayers++;
      lostArea += CL.area(lost);
    }
    if (i % 20 === 0) progress('Walls', 0.15 + 0.15 * (i / n));
  }

  // --- 5: top/bottom skin ---
  progress('Top / bottom skin', 0.3);
  const skin = new Array(n), sparse = new Array(n);
  for (let i = 0; i < n; i++) {
    const inner = innerAll[i];
    if (!inner.length) { skin[i] = []; sparse[i] = []; continue; }
    // Area that has material in ALL of the next `topLayers` layers is not a top surface.
    let above = inner;
    for (let j = i + 1; j <= i + S.topLayers && above.length; j++) above = j < n ? CL.intersection(above, innerAll[j]) : [];
    let below = inner;
    for (let j = i - 1; j >= i - S.bottomLayers && below.length; j--) below = j >= 0 ? CL.intersection(below, innerAll[j]) : [];
    const covered = CL.intersection(above, below);
    let sk = CL.difference(inner, covered);
    sk = CL.dropSmall(CL.opening(sk, w * 0.3), w * w);
    skin[i] = sk;
    sparse[i] = sk.length ? CL.difference(inner, sk) : inner;
    if (i % 20 === 0) progress('Top / bottom skin', 0.3 + 0.15 * (i / n));
  }

  // --- 7: support ---
  progress('Support', 0.45);
  const support = new Array(n).fill(null).map(() => []);
  let supportLayers = 0;
  if (S.support) {
    const step = layers.length > 1 ? S.layerHeight * Math.tan((S.supportAngle * Math.PI) / 180) : 0;
    const overhang = new Array(n).fill(null).map(() => []);
    for (let i = 1; i < n; i++) {
      const oh = CL.difference(regions[i], CL.offset(regions[i - 1], step));
      overhang[i] = CL.dropSmall(CL.opening(oh, w * 0.25), 0.05);
    }
    const g = Math.max(0, Math.round(S.supportZGap));
    let carry = [];
    for (let i = n - 1; i >= 0; i--) {
      const src = i + 1 + g;
      let need = carry;
      if (src < n && overhang[src].length) need = CL.union(need, CL.offset(overhang[src], w / 2));
      if (!need.length) { carry = []; continue; }
      let s = CL.difference(need, CL.offset(regions[i], S.supportXYGap));
      // keep a z gap where the support would sit on the model
      for (let k = 1; k <= g && i - k >= 0; k++) s = CL.difference(s, regions[i - k]);
      carry = s;
      support[i] = s;
    }
    if (S.supportPlacement === 'buildplate') {
      let shadow = [];
      for (let i = 0; i < n; i++) {
        if (i > 0) shadow = CL.union(shadow, regions[i - 1]);
        if (support[i].length && shadow.length) support[i] = CL.difference(support[i], CL.offset(shadow, S.supportXYGap));
      }
    }
    for (let i = 0; i < n; i++) {
      support[i] = CL.dropSmall(CL.opening(support[i], w * 0.5), w * w * 2);
      if (support[i].length) supportLayers++;
    }
  }

  // --- 8 + 9: assemble ordered paths per layer ---
  progress('Paths', 0.6);
  const out = [];
  let pos = [0, 0];
  const overlap = (S.infillOverlap / 100) * w;
  for (let i = 0; i < n; i++) {
    const L = layers[i];
    const paths = [];
    const add = (type, closed, list) => {
      const r = orderPaths(list.map((p) => ({ type, closed, pts: CL.toFloat(p) })).filter((p) => p.pts.length >= 4), pos, S.seam, i);
      paths.push(...r);
      if (r.length) pos = endOf(r[r.length - 1]);
    };

    if (i === 0) {
      const base = CL.union(regions[0], support[0]);
      if (S.adhesion === 'skirt') {
        const loops = [];
        for (let k = S.skirtLines - 1; k >= 0; k--) loops.push(...CL.offset(base, S.skirtDistance + w / 2 + k * w, 'round').filter(CL.isOuter));
        add(FEATURE.SKIRT, true, loops);
      } else if (S.adhesion === 'brim') {
        const outers = base.filter(CL.isOuter);
        const loops = [];
        const lines = Math.max(1, Math.round(S.brimWidth / w));
        for (let k = lines - 1; k >= 0; k--) loops.push(...CL.union(CL.offset(outers, w / 2 + k * w, 'round')).filter(CL.isOuter));
        add(FEATURE.SKIRT, true, loops);
      }
    }

    if (support[i].length) {
      const inside = CL.offset(support[i], -w / 2);
      add(FEATURE.SUPPORT, true, inside);
      const area = CL.offset(inside, -w / 2);
      if (area.length) {
        // Roof (interface): the top layers of the support, right under the model, are dense so
        // the model's bottom surface has something flat to be printed on.
        let roof = [];
        if (S.supportRoofLayers > 0) {
          const g = Math.max(0, Math.round(S.supportZGap));
          let above = [];
          for (let k = i + 1 + g; k <= i + g + S.supportRoofLayers && k < n; k++) above = above.concat(regions[k]);
          if (above.length) roof = CL.intersection(area, CL.offset(CL.union(above), w));
        }
        const sparseArea = roof.length ? CL.difference(area, roof) : area;
        // sparse support lines all run along X in every layer, so the structure breaks away easily
        const spacing = w / (Math.max(1, S.supportDensity) / 100);
        if (sparseArea.length) add(FEATURE.SUPPORT, false, CL.clipLines(parallelLines(CL.pathsBounds(sparseArea), 0, spacing), sparseArea));
        if (roof.length) add(FEATURE.SUPPORT, false, CL.clipLines(parallelLines(CL.pathsBounds(roof), 90, w / 0.8), roof));
      }
    }

    // islands, nearest first
    const todo = islandData[i].slice();
    while (todo.length) {
      let best = 0, bd = Infinity;
      for (let k = 0; k < todo.length; k++) {
        const p = todo[k].island[0][0];
        const d = (p.X / CL.SCALE - pos[0]) ** 2 + (p.Y / CL.SCALE - pos[1]) ** 2;
        if (d < bd) { bd = d; best = k; }
      }
      const isl = todo.splice(best, 1)[0];
      const order = isl.walls.map((_, k) => k);
      if (!S.outerWallFirst) order.reverse();
      for (const k of order) add(k === 0 ? FEATURE.OUTER : FEATURE.INNER, true, isl.walls[k]);

      if (isl.inner.length) {
        const clipInner = CL.offset(isl.inner, S.wallCount > 0 ? -w / 2 + overlap : -w / 2);
        if (clipInner.length) {
          const sk = skin[i].length ? CL.intersection(skin[i], clipInner) : [];
          const sp = sparse[i].length ? CL.intersection(sparse[i], clipInner) : [];
          if (sk.length) add(FEATURE.SKIN, false, fillRegion(sk, 'solid', 100, w, i, L.z).open);
          if (sp.length && S.infillDensity > 0) {
            const solid = S.infillDensity >= 99;
            const f = fillRegion(sp, solid ? 'solid' : S.infillPattern, solid ? 100 : S.infillDensity, w, i, L.z);
            add(solid ? FEATURE.SKIN : FEATURE.FILL, false, f.open);
            add(FEATURE.FILL, true, f.closed);
          }
        }
      }
    }

    const comb = CL.offset(regions[i], -w / 2).map(CL.toFloat);
    out.push({ z: L.z, h: L.h, paths, comb });
    if (i % 10 === 0) progress('Paths', 0.6 + 0.35 * (i / n));
  }

  const meta = {
    layerZ: layers.map((l) => l.z),
    outlines: regions.map((r) => r.map(CL.toFloat)),
    lost: lostPer.map((r) => r.map(CL.toFloat)),
    support: support.map((r) => r.map(CL.toFloat)),
  };
  const warnings = [];
  if (lostLayers) {
    warnings.push({
      level: 'warn',
      text: `Thin features are lost in ${lostLayers} layer(s) (${lostArea.toFixed(1)} mm² in total): parts of the model are thinner than one line width (${w} mm) and cannot be printed. They are shown in red in the layer inspector.`,
    });
  }
  if (S.support && !supportLayers) warnings.push({ level: 'info', text: 'Support is enabled, but no overhang steeper than the overhang angle was found.' });
  progress('Done', 1);
  return { layers: out, meta, warnings, stats: { layers: n, supportLayers } };
}

function endOf(p) {
  if (p.closed) return [p.pts[0], p.pts[1]];
  return [p.pts[p.pts.length - 2], p.pts[p.pts.length - 1]];
}

/** Greedy nearest-neighbour ordering; also picks the seam (start point) of each closed loop. */
function orderPaths(paths, start, seam, layerIndex) {
  const res = [];
  let pos = start;
  const left = paths.slice();
  let rnd = (layerIndex * 9301 + 49297) % 233280;
  while (left.length) {
    let best = -1, bd = Infinity, bestStart = 0, rev = false;
    for (let k = 0; k < left.length; k++) {
      const p = left[k].pts;
      if (left[k].closed) {
        // distance to nearest vertex
        for (let v = 0; v < p.length; v += 2) {
          const d = (p[v] - pos[0]) ** 2 + (p[v + 1] - pos[1]) ** 2;
          if (d < bd) { bd = d; best = k; bestStart = v / 2; }
        }
      } else {
        const d0 = (p[0] - pos[0]) ** 2 + (p[1] - pos[1]) ** 2;
        const d1 = (p[p.length - 2] - pos[0]) ** 2 + (p[p.length - 1] - pos[1]) ** 2;
        if (d0 < bd) { bd = d0; best = k; rev = false; }
        if (d1 < bd) { bd = d1; best = k; rev = true; }
      }
    }
    const path = left.splice(best, 1)[0];
    if (path.closed) {
      const nv = path.pts.length / 2;
      let s = bestStart;
      if (seam === 'aligned') {
        // the vertex furthest to the back (max Y), ties broken by min X
        let by = -Infinity, bx = Infinity;
        for (let v = 0; v < nv; v++) {
          const x = path.pts[v * 2], y = path.pts[v * 2 + 1];
          if (y > by + 1e-6 || (Math.abs(y - by) <= 1e-6 && x < bx)) { by = y; bx = x; s = v; }
        }
      } else if (seam === 'random') {
        rnd = (rnd * 9301 + 49297) % 233280;
        s = Math.floor((rnd / 233280) * nv);
      }
      path.pts = rotate(path.pts, s);
    } else if (rev) {
      path.pts = reversePts(path.pts);
    }
    res.push(path);
    pos = endOf(path);
  }
  return res;
}

function rotate(pts, s) {
  if (!s) return pts;
  const out = new Float64Array(pts.length);
  out.set(pts.subarray(s * 2), 0);
  out.set(pts.subarray(0, s * 2), pts.length - s * 2);
  return out;
}

function reversePts(pts) {
  const out = new Float64Array(pts.length);
  for (let i = 0; i < pts.length; i += 2) {
    out[i] = pts[pts.length - 2 - i];
    out[i + 1] = pts[pts.length - 1 - i];
  }
  return out;
}
