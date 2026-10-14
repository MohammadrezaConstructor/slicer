// Built-in teaching models, generated procedurally so the app works offline without files.
import * as THREE from 'three';

/** Convert a three.js geometry to a triangle soup. Three.js geometries are Y-up; printers are Z-up. */
function soup(geometry, yUp = true) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const p = g.attributes.position.array;
  const out = new Float32Array(p.length);
  for (let i = 0; i < p.length; i += 3) {
    if (yUp) {
      out[i] = p[i];
      out[i + 1] = -p[i + 2];
      out[i + 2] = p[i + 1];
    } else {
      out[i] = p[i];
      out[i + 1] = p[i + 1];
      out[i + 2] = p[i + 2];
    }
  }
  return out;
}

function merge(...parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Float32Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Axis-aligned box from (x0,y0,z0) with size (sx,sy,sz), in printer coordinates. */
function box(x0, y0, z0, sx, sy, sz) {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  g.translate(x0 + sx / 2, y0 + sy / 2, z0 + sz / 2);
  return soup(g, false);
}

/** Extrude a 2D profile drawn in the X/Z plane by `depth` along Y (a standing part). */
function standingProfile(shape, depth) {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 48 });
  return soup(g, true); // shape Y becomes printer Z
}

/** Extrude a 2D footprint drawn in X/Y up to `height` along Z. */
function footprint(shape, height) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, curveSegments: 64 });
  return soup(g, false);
}

function rect(shapeOrPath, x, y, w, h) {
  shapeOrPath.moveTo(x, y);
  shapeOrPath.lineTo(x + w, y);
  shapeOrPath.lineTo(x + w, y + h);
  shapeOrPath.lineTo(x, y + h);
  shapeOrPath.lineTo(x, y);
  return shapeOrPath;
}

export const SAMPLES = [
  {
    id: 'cube',
    name: 'Calibration cube (20 mm)',
    about: 'The classic first print. Simple walls, flat top and bottom: perfect to learn walls, top/bottom layers and infill.',
    build: () => box(0, 0, 0, 20, 20, 20),
  },
  {
    id: 'cylinder',
    name: 'Cylinder',
    about: 'A round part. Notice that curved outlines become many short straight segments in the G-code.',
    build: () => soup(new THREE.CylinderGeometry(10, 10, 30, 96)),
  },
  {
    id: 'sphere',
    name: 'Sphere',
    about: 'Shows the "staircase effect" of layers on curved surfaces (compare 0.1 mm and 0.3 mm layers) and the overhang at the bottom.',
    build: () => soup(new THREE.SphereGeometry(15, 96, 48)),
  },
  {
    id: 'cone',
    name: 'Cone',
    about: 'Layers get smaller towards the tip, so they are printed very quickly — the reason for the "minimum layer time" cooling setting.',
    build: () => soup(new THREE.CylinderGeometry(0.4, 15, 30, 96)),
  },
  {
    id: 'invcone',
    name: 'Inverted cone (45°)',
    about: 'A 45° overhang all around. Usually prints without support — try raising the overhang angle threshold.',
    build: () => soup(new THREE.CylinderGeometry(20, 2, 18, 96)),
  },
  {
    id: 'overhang',
    name: 'Overhang test (20°–80°)',
    about: 'One side leans out more and more: 20°, 35°, 50°, 65°, 80° from vertical. Simulate without support and see where the plastic starts to sag.',
    build: () => {
      const s = new THREE.Shape();
      const angles = [20, 35, 50, 65, 80];
      const step = 4;
      s.moveTo(0, 0);
      let x = 12, z = 0;
      s.lineTo(x, z);
      for (const a of angles) {
        x += step * Math.tan((a * Math.PI) / 180);
        z += step;
        s.lineTo(x, z);
      }
      s.lineTo(x, z + 2);
      s.lineTo(0, z + 2);
      s.lineTo(0, 0);
      return standingProfile(s, 10);
    },
  },
  {
    id: 'bridge',
    name: 'Bridge test (20 mm gap)',
    about: 'Two pillars joined by a flat top. The first top layer must be stretched across 20 mm of air — a "bridge". Short bridges work without support.',
    build: () => merge(box(0, 0, 0, 6, 10, 12), box(26, 0, 0, 6, 10, 12), box(0, 0, 12, 32, 10, 2)),
  },
  {
    id: 'tshape',
    name: 'T-shape (needs support)',
    about: 'A flat bar sticking out 16 mm in the air on both sides. Impossible without support. Compare the simulation with support off and on.',
    build: () => merge(box(16, 0, 0, 8, 8, 20), box(0, 0, 20, 40, 8, 4)),
  },
  {
    id: 'arch',
    name: 'Arch',
    about: 'The arch starts as gentle overhangs and becomes a flat bridge at the top. The overhang view shows where support would be placed.',
    build: () => {
      const s = new THREE.Shape();
      s.moveTo(0, 0);
      s.lineTo(7, 0);
      s.absarc(20, 0, 13, Math.PI, 0, true);
      s.lineTo(40, 0);
      s.lineTo(40, 25);
      s.lineTo(0, 25);
      s.lineTo(0, 0);
      return standingProfile(s, 10);
    },
  },
  {
    id: 'hollowbox',
    name: 'Open box (cup)',
    about: 'A 2 mm thick wall with a floor. With 0.42 mm lines, how many walls fit in 2 mm? Is there room for infill?',
    build: () => {
      const s = rect(new THREE.Shape(), 0, 0, 30, 30);
      s.holes.push(rect(new THREE.Path(), 2, 2, 26, 26));
      return merge(footprint(s, 20), box(0, 0, 0, 30, 30, 2));
    },
  },
  {
    id: 'thinwalls',
    name: 'Thin wall test',
    about: 'Walls of 0.2, 0.4, 0.6, 0.8, 1.2 and 2.0 mm. Walls thinner than the line width disappear when sliced — check the warnings and the layer view.',
    build: () => {
      const parts = [box(0, 0, 0, 52, 12, 1)];
      const t = [0.2, 0.4, 0.6, 0.8, 1.2, 2.0];
      let x = 3;
      for (const w of t) {
        parts.push(box(x, 1, 1, w, 10, 10));
        x += w + 7;
      }
      return merge(...parts);
    },
  },
  {
    id: 'torus',
    name: 'Ring (torus)',
    about: 'Overhangs on both the outside and inside of the ring.',
    build: () => soup(new THREE.TorusGeometry(14, 5, 32, 128), false),
  },
];

export function buildSample(id) {
  const s = SAMPLES.find((x) => x.id === id);
  if (!s) throw new Error('Unknown sample ' + id);
  return s.build();
}
