// Three.js scene: printer bed, build volume, axes, the model, and the "slicing plane" demo.
// The scene is Z-up, exactly like the printer: X right, Y to the back, Z up.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export class Scene3D {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.localClippingEnabled = true;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.5, 5000);
    this.camera.up.set(0, 0, 1);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.screenSpacePanning = true;

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(-120, -200, 300);
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0xffffff, 0.5);
    fill.position.set(200, 250, 120);
    this.scene.add(fill);

    this.bedGroup = new THREE.Group();
    this.scene.add(this.bedGroup);
    this.modelGroup = new THREE.Group();
    this.scene.add(this.modelGroup);
    this.printGroup = new THREE.Group();
    this.scene.add(this.printGroup);

    this.frameCallbacks = [];
    this.setTheme(false);

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    // Render on demand: only when something changed (saves CPU and battery on student laptops).
    this.dirty = 2;
    let last = performance.now();
    const loop = () => {
      requestAnimationFrame(loop);
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      for (const cb of this.frameCallbacks) cb(dt);
      const moved = this.controls.update();
      if (moved || this.dirty > 0) {
        this.renderer.render(this.scene, this.camera);
        this.dirty = Math.max(0, this.dirty - 1);
      }
    };
    loop();
    // any interaction may change what is shown
    for (const ev of ['pointerdown', 'pointermove', 'wheel', 'keydown', 'input', 'change', 'click']) {
      window.addEventListener(ev, () => this.invalidate(), { passive: true, capture: true });
    }
  }

  /** Request a redraw on the next frames. */
  invalidate(frames = 2) {
    this.dirty = Math.max(this.dirty, frames);
  }

  setTheme(dark) {
    this.scene.background = new THREE.Color(dark ? 0x1b1f24 : 0xe9edf1);
    this.dark = dark;
    if (this.bed) this.setBed(this.bed.x, this.bed.y, this.bed.z);
  }

  onFrame(cb) {
    this.frameCallbacks.push(cb);
  }

  resize() {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h);
    this.invalidate();
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Build plate with a 10 mm grid, the build volume outline and coordinate axes. */
  setBed(x, y, z) {
    this.bed = { x, y, z };
    this.bedGroup.clear();
    const plateMat = new THREE.MeshStandardMaterial({ color: this.dark ? 0x30363d : 0x3a3f45, roughness: 0.85, metalness: 0.1, emissive: 0xff3300, emissiveIntensity: 0 });
    this.plateMat = plateMat;
    const plate = new THREE.Mesh(new THREE.BoxGeometry(x, y, 2), plateMat);
    plate.position.set(x / 2, y / 2, -1.01);
    this.bedGroup.add(plate);

    const grid = [];
    for (let gx = 0; gx <= x + 1e-6; gx += 10) grid.push(gx, 0, 0.02, gx, y, 0.02);
    for (let gy = 0; gy <= y + 1e-6; gy += 10) grid.push(0, gy, 0.02, x, gy, 0.02);
    const gridGeo = new THREE.BufferGeometry();
    gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(grid, 3));
    this.bedGroup.add(new THREE.LineSegments(gridGeo, new THREE.LineBasicMaterial({ color: 0x6b737c, transparent: true, opacity: 0.55 })));

    const vol = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(x, y, z)),
      new THREE.LineDashedMaterial({ color: this.dark ? 0x8899aa : 0x7a8794, dashSize: 4, gapSize: 3, transparent: true, opacity: 0.6 }),
    );
    vol.position.set(x / 2, y / 2, z / 2);
    vol.computeLineDistances();
    this.bedGroup.add(vol);

    // axes at the origin (front-left corner): where X=0, Y=0, Z=0 is after homing (G28)
    const L = Math.min(x, y) * 0.18;
    const axis = (dir, color, label) => {
      const arrow = new THREE.ArrowHelper(dir, new THREE.Vector3(0, 0, 0.1), L, color, 5, 3);
      this.bedGroup.add(arrow);
      const s = textSprite(label, color);
      s.position.copy(dir.clone().multiplyScalar(L + 7));
      this.bedGroup.add(s);
    };
    axis(new THREE.Vector3(1, 0, 0), 0xe03131, 'X');
    axis(new THREE.Vector3(0, 1, 0), 0x2f9e44, 'Y');
    axis(new THREE.Vector3(0, 0, 1), 0x1c7ed6, 'Z');
    const front = textSprite('FRONT', this.dark ? 0x9aa5b1 : 0x56606b, 0.6);
    front.position.set(x / 2, -10, 0);
    this.bedGroup.add(front);
  }

  setBedHeat(fraction) {
    this.invalidate();
    if (this.plateMat) this.plateMat.emissiveIntensity = Math.max(0, Math.min(1, fraction)) * 0.14;
  }

  viewHome() {
    const { x, y, z } = this.bed;
    const r = Math.max(x, y, z * 0.8);
    this.controls.target.set(x / 2, y / 2, Math.min(z, 40) / 3);
    this.camera.position.set(x / 2 - r * 0.15, -r * 0.95, r * 0.85);
  }

  /** Point the camera at a box {min,max}. */
  frame(min, max) {
    const c = new THREE.Vector3((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
    const size = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2], 20);
    const dist = size * 3.4;
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    // always look from above and in front (also when the camera was moved under the bed)
    if (dir.lengthSq() < 0.5 || dir.z < 0.2 || dir.z > 0.98) dir.set(-0.15, -0.8, 0.6).normalize();
    this.controls.target.copy(c);
    this.camera.position.copy(c.clone().add(dir.multiplyScalar(dist)));
    this.invalidate();
  }

  viewTop() {
    const t = this.controls.target;
    this.camera.position.set(t.x, t.y - 0.01, t.z + Math.max(this.bed.x, this.bed.y) * 1.3);
  }
}

/** Shows the model; faces steeper than the overhang angle are coloured; optional cut plane. */
export class ModelView {
  constructor(scene3d) {
    this.s = scene3d;
    this.group = scene3d.modelGroup;
    this.clipPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 1e6);
    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.55, metalness: 0.05, side: THREE.DoubleSide, clippingPlanes: [this.clipPlane],
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    });
    this.ghostMat = new THREE.MeshStandardMaterial({ color: 0x9fb4c7, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide });
    this.mesh = null;
    this.ghost = null;
    this.cutGroup = new THREE.Group();
    this.group.add(this.cutGroup);
  }

  setModel(tris, overhang, threshold, highlight, outOfBounds) {
    this.s.invalidate();
    if (this.mesh) {
      this.group.remove(this.mesh, this.ghost);
      this.mesh.geometry.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(tris, 3));
    geo.computeVertexNormals();
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(tris.length), 3));
    this.mesh = new THREE.Mesh(geo, this.material);
    this.ghost = new THREE.Mesh(geo, this.ghostMat);
    this.ghost.visible = false;
    this.group.add(this.mesh, this.ghost);
    this.overhang = overhang;
    this.recolor(threshold, highlight, outOfBounds);
  }

  recolor(threshold, highlight, outOfBounds) {
    this.s.invalidate();
    if (!this.mesh) return;
    const col = this.mesh.geometry.attributes.color.array;
    const lin = (hex) => new THREE.Color(hex).toArray();
    const base = lin(outOfBounds ? '#c3c2b7' : '#86b6ef'), warn = lin('#fab219'), bad = lin('#d03b3b');
    for (let i = 0; i < this.overhang.length; i++) {
      const a = this.overhang[i];
      let c = base;
      if (highlight) {
        if (a > threshold) c = bad;
        else if (a > threshold - 15) c = warn;
      }
      for (let v = 0; v < 3; v++) col.set(c, i * 9 + v * 3);
    }
    this.mesh.geometry.attributes.color.needsUpdate = true;
  }

  setVisible(v) {
    this.s.invalidate();
    if (this.mesh) this.mesh.visible = v;
  }

  setGhost(v) {
    if (this.ghost) this.ghost.visible = v;
  }

  /** Cut the model at height z and draw the cross-section (islands in Clipper coordinates). */
  setCut(z, islands, scale) {
    this.s.invalidate();
    this.cutGroup.clear();
    if (z === null) {
      this.clipPlane.constant = 1e6;
      return;
    }
    this.clipPlane.constant = z;
    const shapes = [];
    const lines = [];
    for (const island of islands) {
      const toV = (p) => p.map((pt) => new THREE.Vector2(pt.X / scale, pt.Y / scale));
      const shape = new THREE.Shape(toV(island[0]));
      for (let h = 1; h < island.length; h++) shape.holes.push(new THREE.Path(toV(island[h])));
      shapes.push(shape);
      for (const loop of island) {
        for (let i = 0; i < loop.length; i++) {
          const a = loop[i], b = loop[(i + 1) % loop.length];
          lines.push(a.X / scale, a.Y / scale, z + 0.05, b.X / scale, b.Y / scale, z + 0.05);
        }
      }
    }
    if (shapes.length) {
      const cap = new THREE.Mesh(new THREE.ShapeGeometry(shapes), new THREE.MeshBasicMaterial({ color: 0x1c7ed6, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
      cap.position.z = z;
      this.cutGroup.add(cap);
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
    this.cutGroup.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x0b3d91 })));
    // a translucent plane showing the cutting height
    const { x, y } = this.s.bed;
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(x, y), new THREE.MeshBasicMaterial({ color: 0x4dabf7, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }));
    plane.position.set(x / 2, y / 2, z);
    this.cutGroup.add(plane);
  }
}

export function textSprite(text, color = 0x333333, scale = 1) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext('2d');
  ctx.font = 'bold 72px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#' + new THREE.Color(color).getHexString();
  ctx.fillText(text, 128, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(16 * scale, 8 * scale, 1);
  return s;
}
