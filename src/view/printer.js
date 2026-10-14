// A simple Cartesian printer head: nozzle, heater block, heat sink, fan, carriage and the X rail.
// The whole X rail moves in Y and Z, the head moves along X — enough to see how the axes move.
import * as THREE from 'three';

export class PrinterHead {
  constructor(scene3d) {
    this.s = scene3d;
    this.group = new THREE.Group();
    this.head = new THREE.Group();
    this.rail = new THREE.Group();
    this.group.add(this.head, this.rail);
    scene3d.scene.add(this.group);

    const brass = new THREE.MeshStandardMaterial({ color: 0xc9a227, metalness: 0.8, roughness: 0.3 });
    this.blockMat = new THREE.MeshStandardMaterial({ color: 0xb8bcc2, metalness: 0.6, roughness: 0.4, emissive: 0xff2200, emissiveIntensity: 0 });
    const sinkMat = new THREE.MeshStandardMaterial({ color: 0x8c939b, metalness: 0.7, roughness: 0.35 });
    const plastic = new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.7 });
    this.fanMat = new THREE.MeshStandardMaterial({ color: 0x4dabf7, roughness: 0.5 });

    // nozzle tip at the group origin, pointing down
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 3, 4, 24), brass);
    tip.rotation.x = Math.PI / 2;
    tip.position.z = 2;
    const hex = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 3, 6), brass);
    hex.rotation.x = Math.PI / 2;
    hex.position.z = 5.5;
    const block = new THREE.Mesh(new THREE.BoxGeometry(16, 20, 10), this.blockMat);
    block.position.set(0, 3, 12);
    const sink = new THREE.Group();
    for (let i = 0; i < 9; i++) {
      const fin = new THREE.Mesh(new THREE.CylinderGeometry(11, 11, 1, 32), sinkMat);
      fin.rotation.x = Math.PI / 2;
      fin.position.z = 20 + i * 2.6;
      sink.add(fin);
    }
    const shroud = new THREE.Mesh(new THREE.BoxGeometry(34, 30, 34), plastic);
    shroud.position.set(0, 4, 32);
    shroud.material = plastic.clone();
    shroud.material.transparent = true;
    shroud.material.opacity = 0.35;
    // part-cooling fan duct: the blue piece blows air at the fresh plastic
    const duct = new THREE.Mesh(new THREE.BoxGeometry(5, 5, 10), this.fanMat);
    duct.position.set(-14, 0, 9);
    duct.rotation.y = -0.5;
    this.fanBlades = new THREE.Mesh(new THREE.BoxGeometry(1, 16, 2), this.fanMat);
    this.fanBlades.position.set(-17.5, 4, 32);
    const carriage = new THREE.Mesh(new THREE.BoxGeometry(44, 10, 40), plastic);
    carriage.position.set(0, 24, 40);
    this.head.add(tip, hex, block, sink, shroud, duct, this.fanBlades, carriage);
    this.headMeshes = [shroud, carriage];

    this.railBar = new THREE.Mesh(new THREE.BoxGeometry(1, 8, 8), sinkMat);
    this.rail.add(this.railBar);
    this.setBed(scene3d.bed.x);
    this.fanAngle = 0;
  }

  setBed(bedX) {
    const len = bedX + 80;
    this.railBar.geometry.dispose();
    this.railBar.geometry = new THREE.BoxGeometry(len, 8, 8);
    this.railBar.position.set(bedX / 2, 32, 40);
  }

  setPosition(x, y, z) {
    this.s.invalidate();
    this.head.position.set(x, y, z);
    this.rail.position.set(0, y, z);
  }

  setVisible(v) {
    this.s.invalidate();
    this.group.visible = v;
  }

  /** Show heat as a red glow, and spin the fan. */
  update(dt, nozzleTemp, fan) {
    const hot = Math.max(0, Math.min(1, (nozzleTemp - 40) / 200));
    this.blockMat.emissiveIntensity = hot * 0.6;
    if (fan > 0 || this._lastHot !== hot) this.s.invalidate(1);
    this._lastHot = hot;
    this.fanAngle += dt * fan * 40;
    this.fanBlades.rotation.x = this.fanAngle;
  }

  /** Fade the big parts of the head so students can see the nozzle at work. */
  setXray(on) {
    for (const m of this.headMeshes) {
      m.material.transparent = true;
      m.material.opacity = on ? 0.18 : 0.6;
    }
  }
}
