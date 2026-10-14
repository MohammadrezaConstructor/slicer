// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 The Slicer Lab authors
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

/** Wavefront OBJ (vertices + faces; polygons are split into triangles). */
export function parseOBJ(text) {
  const v = [];
  const out = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('v ')) {
      const p = line.split(/\s+/);
      v.push([+p[1], +p[2], +p[3]]);
    } else if (line.startsWith('f ')) {
      const idx = line.split(/\s+/).slice(1).map((t) => {
        const i = parseInt(t.split('/')[0], 10);
        return i < 0 ? v.length + i : i - 1;
      });
      for (let k = 1; k + 1 < idx.length; k++) {
        for (const i of [idx[0], idx[k], idx[k + 1]]) {
          const p = v[i];
          if (!p) throw new Error('Bad face index in OBJ');
          out.push(p[0], p[1], p[2]);
        }
      }
    }
  }
  if (!out.length) throw new Error('No faces found in OBJ file');
  return new Float32Array(out);
}

/**
 * 3MF (the project format of PrusaSlicer, Bambu Studio, Cura…): a ZIP file with XML meshes.
 * Supports meshes, components (also in separate files) and build-item transforms.
 */
export async function parse3MF(buffer) {
  const files = await unzip(buffer, (name) => /\.model$/i.test(name));
  const mainName = Object.keys(files).find((n) => /^3D\/3dmodel\.model$/i.test(n)) || Object.keys(files)[0];
  if (!mainName) throw new Error('No 3D model inside the 3MF file');
  const docs = {};
  const doc = (name) => {
    const key = name.replace(/^\//, '');
    if (!docs[key]) {
      const xml = files[Object.keys(files).find((n) => n.toLowerCase() === key.toLowerCase())];
      if (!xml) throw new Error('Missing part ' + name);
      docs[key] = parseModelXML(xml);
    }
    return docs[key];
  };
  const main = doc(mainName);
  const scale = { micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000 }[main.unit] || 1;
  const out = [];
  const emit = (docName, id, M) => {
    const d = doc(docName), obj = d.objects[id];
    if (!obj) return;
    if (obj.vertices) {
      const V = obj.vertices;
      for (const [a, b, c] of obj.triangles) {
        for (const i of [a, b, c]) {
          const x = V[i * 3], y = V[i * 3 + 1], z = V[i * 3 + 2];
          out.push((x * M[0] + y * M[3] + z * M[6] + M[9]) * scale, (x * M[1] + y * M[4] + z * M[7] + M[10]) * scale, (x * M[2] + y * M[5] + z * M[8] + M[11]) * scale);
        }
      }
    }
    for (const c of obj.components || []) emit(c.path || docName, c.objectid, mul3mf(c.transform, M));
  };
  for (const item of main.build) emit(mainName, item.objectid, item.transform);
  if (!out.length) throw new Error('The 3MF file contains no triangles');
  return new Float32Array(out);
}

const ID3 = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
const parseTransform = (s) => (s ? s.trim().split(/\s+/).map(Number) : ID3);
// 3MF matrices are 4x3, applied to row vectors: p' = p · A, then · B
function mul3mf(A, B) {
  const r = new Array(12);
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 3; j++) r[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j] + (i === 3 ? B[9 + j] : 0);
  return r;
}

function parseModelXML(xml) {
  const attrs = (s) => {
    const o = {};
    for (const m of s.matchAll(/([\w:]+)\s*=\s*"([^"]*)"/g)) o[m[1]] = m[2];
    return o;
  };
  const unit = (/<model[^>]*\bunit="([^"]+)"/.exec(xml) || [])[1] || 'millimeter';
  const objects = {};
  for (const m of xml.matchAll(/<object\b([^>]*)>([\s\S]*?)<\/object>/g)) {
    const a = attrs(m[1]);
    const body = m[2];
    const obj = {};
    if (/<mesh/.test(body)) {
      const verts = [];
      for (const v of body.matchAll(/<vertex\b([^>]*)\/?>/g)) {
        const p = attrs(v[1]);
        verts.push(+p.x, +p.y, +p.z);
      }
      obj.vertices = Float64Array.from(verts);
      obj.triangles = [];
      for (const t of body.matchAll(/<triangle\b([^>]*)\/?>/g)) {
        const p = attrs(t[1]);
        obj.triangles.push([+p.v1, +p.v2, +p.v3]);
      }
    }
    obj.components = [...body.matchAll(/<component\b([^>]*)\/?>/g)].map((c) => {
      const p = attrs(c[1]);
      return { objectid: p.objectid, path: p['p:path'] || null, transform: parseTransform(p.transform) };
    });
    objects[a.id] = obj;
  }
  const build = [...xml.matchAll(/<item\b([^>]*)\/?>/g)].map((it) => {
    const p = attrs(it[1]);
    return { objectid: p.objectid, transform: parseTransform(p.transform) };
  });
  return { unit, objects, build };
}

/** Minimal ZIP reader (stored + deflate) using the browser's DecompressionStream. */
async function unzip(buffer, want) {
  const dv = new DataView(buffer);
  let eocd = -1;
  for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a ZIP/3MF file');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = {};
  const dec = new TextDecoder();
  for (let k = 0; k < count; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(buffer, p + 46, nlen));
    p += 46 + nlen + xlen + clen;
    if (!want(name)) continue;
    const dataStart = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const data = new Uint8Array(buffer, dataStart, csize);
    let bytes;
    if (method === 0) bytes = data;
    else if (method === 8) bytes = new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
    else throw new Error('Unsupported compression in 3MF');
    out[name] = dec.decode(bytes);
  }
  return out;
}
