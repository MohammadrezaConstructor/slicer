// Mesh utilities. A mesh is a "triangle soup": Float32Array with 9 numbers per triangle
// (x0 y0 z0 x1 y1 z1 x2 y2 z2). This is exactly what an STL file stores.

/** Parse a binary or ASCII STL file into a triangle soup. */
export function parseSTL(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes.length >= 84) {
    const view = new DataView(buffer);
    const n = view.getUint32(80, true);
    if (84 + n * 50 === bytes.length) return parseBinarySTL(view, n);
  }
  const head = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 512)));
  if (/^\s*solid/i.test(head) && /facet|vertex/i.test(new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 4096))))) {
    return parseAsciiSTL(new TextDecoder().decode(bytes));
  }
  if (bytes.length >= 84) {
    // Some exporters write a slightly wrong size; trust the triangle count if it fits.
    const view = new DataView(buffer);
    const n = Math.min(view.getUint32(80, true), Math.floor((bytes.length - 84) / 50));
    return parseBinarySTL(view, n);
  }
  throw new Error('Not a valid STL file');
}

function parseBinarySTL(view, n) {
  const out = new Float32Array(n * 9);
  let o = 84;
  for (let i = 0; i < n; i++) {
    o += 12; // skip stored normal: we recompute it from the vertex order
    for (let k = 0; k < 9; k++) {
      out[i * 9 + k] = view.getFloat32(o, true);
      o += 4;
    }
    o += 2;
  }
  return out;
}

function parseAsciiSTL(text) {
  const re = /vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g;
  const vals = [];
  let m;
  while ((m = re.exec(text))) vals.push(+m[1], +m[2], +m[3]);
  const n = Math.floor(vals.length / 9);
  return new Float32Array(vals.slice(0, n * 9));
}

/** Write a binary STL (used to export the built-in models). */
export function toBinarySTL(tris) {
  const n = tris.length / 9;
  const buf = new ArrayBuffer(84 + n * 50);
  const view = new DataView(buf);
  for (let i = 0; i < n; i++) {
    const o = 84 + i * 50;
    const nrm = faceNormal(tris, i);
    view.setFloat32(o, nrm[0], true);
    view.setFloat32(o + 4, nrm[1], true);
    view.setFloat32(o + 8, nrm[2], true);
    for (let k = 0; k < 9; k++) view.setFloat32(o + 12 + k * 4, tris[i * 9 + k], true);
  }
  view.setUint32(80, n, true);
  return buf;
}

export function bbox(tris) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < tris.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = tris[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  return { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
}

/** Unit normal of triangle i, from the right-hand rule on its vertex order. */
export function faceNormal(tris, i) {
  const o = i * 9;
  const ux = tris[o + 3] - tris[o], uy = tris[o + 4] - tris[o + 1], uz = tris[o + 5] - tris[o + 2];
  const vx = tris[o + 6] - tris[o], vy = tris[o + 7] - tris[o + 1], vz = tris[o + 8] - tris[o + 2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

/** Signed volume (mm³) via the divergence theorem. Positive for a correctly oriented closed mesh. */
export function volume(tris) {
  let v = 0;
  for (let o = 0; o < tris.length; o += 9) {
    const ax = tris[o], ay = tris[o + 1], az = tris[o + 2];
    const bx = tris[o + 3], by = tris[o + 4], bz = tris[o + 5];
    const cx = tris[o + 6], cy = tris[o + 7], cz = tris[o + 8];
    v += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return v / 6;
}

/** Apply a 3x3 matrix (row-major array of 9) and a translation to a soup, returning a new soup. */
export function transform(tris, m, t = [0, 0, 0]) {
  const out = new Float32Array(tris.length);
  for (let i = 0; i < tris.length; i += 3) {
    const x = tris[i], y = tris[i + 1], z = tris[i + 2];
    out[i] = m[0] * x + m[1] * y + m[2] * z + t[0];
    out[i + 1] = m[3] * x + m[4] * y + m[5] * z + t[1];
    out[i + 2] = m[6] * x + m[7] * y + m[8] * z + t[2];
  }
  // A mirroring matrix (negative determinant) flips triangle winding; fix it so normals stay outward.
  const det = m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
  if (det < 0) {
    for (let o = 0; o < out.length; o += 9) {
      for (let k = 0; k < 3; k++) {
        const a = out[o + 3 + k];
        out[o + 3 + k] = out[o + 6 + k];
        out[o + 6 + k] = a;
      }
    }
  }
  return out;
}

/** Move the mesh so it sits on the bed (z = 0), centred on the bed plus an optional XY offset. */
export function placeOnBed(tris, bedX, bedY, offsetXY = [0, 0]) {
  const b = bbox(tris);
  const t = [
    bedX / 2 + offsetXY[0] - (b.min[0] + b.max[0]) / 2,
    bedY / 2 + offsetXY[1] - (b.min[1] + b.max[1]) / 2,
    -b.min[2],
  ];
  return transform(tris, IDENTITY, t);
}

export function matMul(a, b) {
  const r = new Array(9);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  return r;
}

export const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function rotationMatrix(axis, deg) {
  const r = (deg * Math.PI) / 180, c = Math.round(Math.cos(r) * 1e12) / 1e12, s = Math.round(Math.sin(r) * 1e12) / 1e12;
  if (axis === 'x') return [1, 0, 0, 0, c, -s, 0, s, c];
  if (axis === 'y') return [c, 0, s, 0, 1, 0, -s, 0, c];
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}

/**
 * Weld the triangle soup into shared vertices. The slicer needs to know which triangles
 * share an edge, so that the line segments it cuts out can be chained into closed loops.
 */
export function weld(tris, tolerance = 1e-4) {
  const nT = tris.length / 9;
  const map = new Map();
  const verts = [];
  const idx = new Uint32Array(nT * 3);
  const q = 1 / tolerance;
  for (let i = 0; i < nT * 3; i++) {
    const x = tris[i * 3], y = tris[i * 3 + 1], z = tris[i * 3 + 2];
    const key = Math.round(x * q) + ',' + Math.round(y * q) + ',' + Math.round(z * q);
    let id = map.get(key);
    if (id === undefined) {
      id = verts.length / 3;
      map.set(key, id);
      verts.push(x, y, z);
    }
    idx[i] = id;
  }
  return { verts: new Float64Array(verts), idx, nTris: nT, nVerts: verts.length / 3 };
}

/**
 * Overhang angle of every face, in degrees from vertical (0 = vertical wall, 90 = flat ceiling).
 * Upward faces get a negative value. Faces lying on the bed are not overhangs.
 */
export function overhangAngles(tris, bedZ = 0) {
  const n = tris.length / 9;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const nz = faceNormal(tris, i)[2];
    const zmax = Math.max(tris[i * 9 + 2], tris[i * 9 + 5], tris[i * 9 + 8]);
    if (zmax < bedZ + 0.05) out[i] = -90;
    else out[i] = (Math.asin(Math.max(-1, Math.min(1, -nz))) * 180) / Math.PI;
  }
  return out;
}
