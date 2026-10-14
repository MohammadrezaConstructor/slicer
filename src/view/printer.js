// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 The Slicer Lab authors
//
// Simplified 3D models of the two printers (print head, X gantry, frame), roughly to scale (mm),
// built from basic shapes for this project; no manufacturer CAD files, drawings or logos are used.
// Both are "bed slingers": the head moves in X, the gantry in Z, and the BED moves in Y.
// So the head stays at one Y position and the bed (with the print) slides under it.
import * as THREE from 'three';

const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0, ...o });
const MATS = () => ({
  brass: mat(0xc9a227, { metalness: 0.85, roughness: 0.3, emissive: 0xff4400, emissiveIntensity: 0 }),
  alu: mat(0xc3c8ce, { metalness: 0.7, roughness: 0.35 }),
  steel: mat(0xd9dde2, { metalness: 0.9, roughness: 0.2 }),
  extrusion: mat(0x2b2e33, { metalness: 0.5, roughness: 0.45 }),
  black: mat(0x1f2124, { roughness: 0.7 }),
  silicone: mat(0x2a2a2a, { roughness: 0.95 }),
  prusaOrange: mat(0xfa6831, { roughness: 0.55 }),
  fanBeige: mat(0xd8c3a0, { roughness: 0.7 }),
  fanBrown: mat(0x7b4f3a, { roughness: 0.7 }),
  fanBlade: mat(0x3a3d42, { roughness: 0.6 }),
  ptfe: mat(0xf2f2ee, { roughness: 0.5, transparent: true, opacity: 0.85 }),
  filament: mat(0xeb6834, { roughness: 0.4 }),
  frame: mat(0x24262a, { metalness: 0.4, roughness: 0.5 }),
});

const DARK = new THREE.MeshStandardMaterial({ color: 0x0c0d0f, roughness: 0.9 });

/** Box with its centre at (x, y, z). */
function box(w, d, h, m, x, y, z) {
  const b = new THREE.Mesh(new THREE.BoxGeometry(w, d, h), m);
  b.position.set(x, y, z);
  return b;
}

/** Cylinder of radius r (r2 at the far end) and length len along `axis`, centred at (x, y, z). */
function cyl(r, len, m, axis, x, y, z, segs = 24, r2 = r) {
  const c = new THREE.Mesh(new THREE.CylinderGeometry(r2, r, len, segs), m);
  if (axis === 'z') c.rotation.x = Math.PI / 2;
  if (axis === 'x') c.rotation.z = -Math.PI / 2;
  c.position.set(x, y, z);
  return c;
}

/** Axial fan facing -Y: frame, hub and blades (returned so they can spin). */
function fan(size, frameMat, bladeMat, x, y, z) {
  const g = new THREE.Group();
  g.add(box(size, 10, size, frameMat, 0, 0, 0));
  // dark round opening in the frame, with the blades inside it
  g.add(cyl(size * 0.46, 1, DARK, 'y', 0, -5.2, 0, 32));
  const blades = new THREE.Group();
  blades.position.y = -5.6;
  blades.add(cyl(size * 0.15, 1.6, bladeMat, 'y', 0, 0, 0, 20));
  for (let i = 0; i < 9; i++) {
    const pivot = new THREE.Group();
    pivot.rotation.y = (i / 9) * Math.PI * 2;
    const b = box(size * 0.29, 0.5, size * 0.11, bladeMat, size * 0.29, 0, 0);
    b.rotation.x = 0.6;
    pivot.add(b);
    blades.add(pivot);
  }
  g.add(blades);
  g.position.set(x, y, z);
  return { group: g, blades };
}

/** Hot end below the extruder: brass nozzle, heater block, heat break. Nozzle tip at the origin. */
function hotEnd(M, sock) {
  const g = new THREE.Group();
  // CylinderGeometry(radiusTop, radiusBottom): along +Z after rotation the "bottom" end points down
  g.add(cyl(0.5, 2.5, M.brass, 'z', 0, 0, 1.25, 24, 2.8)); // nozzle tip (narrow end at the bottom)
  g.add(cyl(4, 3, M.brass, 'z', 0, 0, 4, 6)); // nozzle hex
  if (sock) g.add(box(19, 22, 13, M.silicone, 2, 1, 11.5)); // silicone sock over the heater block
  else {
    g.add(box(20, 20, 10, M.alu, 3, 0, 10.5)); // aluminium heater block
    g.add(cyl(3, 22, M.steel, 'y', 7, 0, 10.5, 16)); // heater cartridge
  }
  g.add(cyl(1.6, 4, M.steel, 'z', 0, 0, 19.5, 12)); // heat break
  return g;
}

export class Printer3D {
  constructor(scene3d) {
    this.s = scene3d;
    this.M = MATS();
    this.head = new THREE.Group();
    this.gantry = new THREE.Group(); // moves in Z
    this.frame = new THREE.Group(); // fixed
    this.group = new THREE.Group();
    this.group.add(this.head, this.gantry, this.frame);
    scene3d.scene.add(this.group);
    this.carriage = new THREE.Group(); // under the bed, moves with it in Y
    scene3d.scene.add(this.carriage);
    this.fanSpin = [];
    this.fanAngle = 0;
    this.see = [];
    this.xray = false;
  }

  /** Build the model of printer `id` ('mk3s', 'ender3' or 'custom') for the given bed size. */
  build(id, S) {
    for (const g of [this.head, this.gantry, this.frame, this.carriage]) g.clear();
    this.fanSpin = [];
    this.see = [];
    this.bowden = null;
    this.id = id;
    this.bed = { x: S.bedX, y: S.bedY, z: S.bedZ };
    this.yRef = S.bedY / 2; // the nozzle's fixed Y position in the frame
    if (id === 'mk3s') this.buildMK3S();
    else this.buildEnder3();
    this.setXray(this.xray);
    this.setPosition(S.bedX / 2, S.bedY / 2, 10);
  }

  buildMK3S() {
    const M = this.M, H = this.head, { x: bx, z: bz } = this.bed, y0 = this.yRef;
    H.add(hotEnd(M, true));
    // extruder body (orange printed parts) with the heat sink inside, filament sensor on top
    const body = new THREE.Group();
    body.add(box(50, 36, 52, M.prusaOrange, 0, 6, 50), box(16, 14, 8, M.prusaOrange, 0, 4, 80));
    // 40 mm hot-end fan on the front
    const f = fan(40, M.fanBeige, M.fanBrown, 0, -17, 46);
    this.fanSpin.push({ blades: f.blades, hotend: true });
    // part-cooling blower on the left, with its duct pointing at the nozzle
    const blower = new THREE.Group();
    blower.add(box(15, 46, 46, M.black, -32, 6, 49), box(12, 12, 20, M.black, -33, -2, 16), box(26, 12, 7, M.black, -20, -2, 7.5));
    // extruder motor (NEMA 17) at the back
    const motor = new THREE.Group();
    motor.add(box(42, 22, 42, M.black, 0, 35, 62), box(43, 3, 43, M.alu, 0, 46.5, 62));
    H.add(body, f.group, blower, motor);
    // P.I.N.D.A. probe: measures the bed for mesh levelling (G80)
    H.add(cyl(4, 36, M.steel, 'z', 24, 0, 22, 16), cyl(4.2, 4, M.black, 'z', 24, 0, 2.5, 16));
    // filament going in from the top
    H.add(cyl(0.9, 70, M.filament, 'z', 0, 4, 119, 8));
    this.see.push(body, f.group, blower, motor);

    // gantry: two smooth X rods between orange X-ends
    const yr = y0 + 30;
    this.gantry.add(cyl(4, bx + 70, M.steel, 'x', bx / 2, yr, 28), cyl(4, bx + 70, M.steel, 'x', bx / 2, yr, 73));
    this.gantry.add(box(26, 36, 70, M.prusaOrange, -36, yr, 50), box(26, 36, 70, M.prusaOrange, bx + 36, yr, 50));
    // frame: Z rods, top parts and the black aluminium frame plate with its window
    for (const xs of [-36, bx + 36]) {
      this.frame.add(cyl(4, bz + 110, M.steel, 'z', xs - 6, yr, (bz + 110) / 2 - 40), cyl(4, bz + 110, M.steel, 'z', xs + 6, yr + 8, (bz + 110) / 2 - 40));
      this.frame.add(box(30, 30, 18, M.prusaOrange, xs, yr, bz + 78));
    }
    const plate = new THREE.Shape();
    plate.moveTo(-60, -70); plate.lineTo(bx + 60, -70); plate.lineTo(bx + 60, bz + 90); plate.lineTo(-60, bz + 90); plate.lineTo(-60, -70);
    const hole = new THREE.Path();
    hole.moveTo(-15, -20); hole.lineTo(bx + 15, -20); hole.lineTo(bx + 15, bz + 60); hole.lineTo(-15, bz + 60); hole.lineTo(-15, -20);
    plate.holes.push(hole);
    const pg = new THREE.ExtrudeGeometry(plate, { depth: 6, bevelEnabled: false });
    pg.rotateX(Math.PI / 2);
    const pm = new THREE.Mesh(pg, M.frame);
    pm.position.set(0, yr + 36, 0);
    this.frame.add(pm);
    this.addYAxis(M.steel);
  }

  buildEnder3() {
    const M = this.M, H = this.head, { x: bx, z: bz } = this.bed, y0 = this.yRef;
    H.add(hotEnd(M, false));
    // black hot-end cover with the heat-sink fan on the front
    const shroud = box(44, 34, 42, M.black, 0, 2, 39);
    const f = fan(40, M.black, M.fanBlade, 0, -20, 39);
    this.fanSpin.push({ blades: f.blades, hotend: true });
    // part-cooling blower on the right and its duct
    const blower = new THREE.Group();
    blower.add(box(14, 40, 40, M.black, 29, 8, 40), box(22, 12, 10, M.black, 18, -2, 12));
    H.add(shroud, f.group, blower);
    // carriage plate and V-wheels running on the aluminium beam
    const yb = y0 + 34;
    H.add(box(66, 5, 72, M.alu, 0, 22, 42));
    for (const [wx, wz] of [[-22, 62], [22, 62], [0, 18]]) H.add(cyl(11.5, 10, M.black, 'y', wx, 34, wz, 24));
    this.see.push(shroud, f.group, blower);

    // gantry: 2020 aluminium beam
    this.gantry.add(box(bx + 90, 20, 20, M.extrusion, bx / 2, yb, 40));
    // frame: two 2040 uprights, top bar, extruder on the left upright
    for (const xs of [-45, bx + 45]) this.frame.add(box(20, 40, bz + 130, M.extrusion, xs, yb, (bz + 130) / 2 - 60));
    this.frame.add(box(bx + 110, 20, 20, M.extrusion, bx / 2, yb, bz + 70));
    this.extruderPos = new THREE.Vector3(-75, yb, bz * 0.62);
    this.frame.add(box(42, 42, 42, M.black, -75, yb, bz * 0.62 - 25), box(34, 30, 22, M.extrusion, -75, yb - 2, bz * 0.62 + 6));
    // Bowden tube: white PTFE from the extruder to the hot end (bent again as the head moves)
    this.bowden = new THREE.Mesh(new THREE.BufferGeometry(), M.ptfe);
    this.frame.add(this.bowden);
    this.addYAxis(M.extrusion);
  }

  /** Y axis under the bed (fixed) and the bed carriage (moves with the bed). */
  addYAxis(railMat) {
    const { x: bx, y: by } = this.bed;
    this.frame.add(box(40, by + 160, 40, railMat, bx / 2, by / 2, -48));
    this.frame.add(box(bx + 120, 20, 40, railMat, bx / 2, -80, -48), box(bx + 120, 20, 40, railMat, bx / 2, by + 80, -48));
    this.carriage.add(box(bx * 0.75, by * 0.75, 4, this.M.alu, bx / 2, by / 2, -14));
    for (const [fx, fy] of [[0.12, 0.12], [0.88, 0.12], [0.12, 0.88], [0.88, 0.88]]) this.carriage.add(cyl(5, 10, this.M.steel, 'z', bx * fx, by * fy, -7, 12));
  }

  /** Nozzle at G-code position (x, y, z): head moves in X, gantry in Z, bed in Y. */
  setPosition(x, y, z) {
    this.head.position.set(x, this.yRef, z);
    this.gantry.position.set(0, 0, z);
    const dy = this.group.visible ? this.yRef - y : 0;
    this.s.setBedOffset(dy);
    this.carriage.position.y = dy;
    if (this.bowden) this.updateBowden();
    this.s.invalidate();
  }

  /** World position of the nozzle tip (for the camera that follows the nozzle). */
  nozzleWorld() {
    return this.head.position.clone();
  }

  updateBowden() {
    const a = this.extruderPos, h = this.head.position;
    const top = new THREE.Vector3(h.x, h.y, h.z + 60);
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(a.x + 12, a.y, a.z + 17), new THREE.Vector3(a.x + 28, a.y - 4, a.z + 70),
      new THREE.Vector3((a.x + h.x) / 2, (a.y + h.y) / 2, Math.max(a.z, top.z) + 70), new THREE.Vector3(h.x, h.y, top.z + 40), top,
    ]);
    this.bowden.geometry.dispose();
    this.bowden.geometry = new THREE.TubeGeometry(curve, 40, 2, 8, false);
  }

  setVisible(v) {
    this.group.visible = v;
    this.carriage.visible = v;
    this.s.volumeGroup.visible = !v;
    if (!v) {
      this.s.setBedOffset(0);
      this.carriage.position.y = 0;
    }
    this.s.invalidate();
  }

  setFilamentColor(hex) {
    this.M.filament.color.set(hex);
    this.s.invalidate();
  }

  /** Glowing nozzle when hot; the hot-end fan spins whenever the nozzle is warm. */
  update(dt, nozzleTemp, partFan) {
    const hot = Math.max(0, Math.min(1, (nozzleTemp - 60) / 180));
    if (Math.abs(this.M.brass.emissiveIntensity - hot * 0.35) > 0.005) {
      this.M.brass.emissiveIntensity = hot * 0.35;
      this.s.invalidate(1);
    }
    if (nozzleTemp > 50) {
      this.fanAngle += dt * 30;
      for (const f of this.fanSpin) f.blades.rotation.y = this.fanAngle;
      this.s.invalidate(1);
    }
  }

  /** Make the big parts of the head see-through so the nozzle stays visible. */
  setXray(on) {
    this.xray = on;
    for (const part of this.see) {
      part.traverse((c) => {
        if (!c.material) return;
        if (!c.userData.ownMat) {
          c.material = c.material.clone();
          c.userData.ownMat = true;
        }
        c.material.transparent = on;
        c.material.opacity = on ? 0.22 : 1;
        c.material.depthWrite = !on;
      });
    }
    this.s.invalidate();
  }
}
