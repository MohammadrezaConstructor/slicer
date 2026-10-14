// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 The Slicer Lab authors
// Slicer Lab — application controller: model → slice (in a worker) → preview → simulate → G-code.
import './style.css';
import SlicerWorker from './worker.js?worker&inline';
import { Scene3D, ModelView } from './view/scene.js';
import { PrintMesh, SEQ_RAMP } from './view/printMesh.js';
import { Printer3D } from './view/printer.js';
import { SettingsPanel } from './ui/settingsPanel.js';
import { LayerInspector } from './ui/layerInspector.js';
import { LayerTimeChart, renderFeatureBars } from './ui/charts.js';
import { GcodeView } from './ui/gcodePanel.js';
import { explainLine, COMMANDS } from './ui/gcodeDocs.js';
import { Lessons } from './ui/lessons.js';
import { fmtTime, fmtClock, escapeHtml } from './ui/format.js';
import { profileSettings, MATERIAL_RANGES } from './core/settings.js';
import { PRINTER_PROFILES, materialSettings } from './core/printers.js';
import { SAMPLES } from './core/primitives.js';
import { parseSTL, parseOBJ, parse3MF, toBinarySTL, bbox, volume, transform, placeOnBed, overhangAngles, rotationMatrix, matMul, IDENTITY, weld } from './core/mesh.js';
import { computeLayers, contourAtZ } from './core/slicer.js';
import { SCALE } from './core/clip.js';
import { KIND, moveAtTime, temperatureAt, valueAt, progressAt } from './core/gcodeParser.js';
import { FEATURE_INFO } from './core/features.js';

const $ = (id) => document.getElementById(id);
const STORE_KEY = 'slicerlab.settings.v2';

class App {
  constructor() {
    this.settings = profileSettings('mk3s', 'PLA');
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (saved) for (const k of Object.keys(this.settings)) if (k in saved) this.settings[k] = saved[k];
    } catch { /* storage unavailable: use defaults */ }

    this.mode = 'prepare';
    this.model = null;
    this.result = null;
    this.stale = true;
    this.autoSlice = true;
    this.pv = { layer: 0, single: false, travel: false, sag: true, color: 'feature', step: Infinity, playing: false };
    this.sim = { t: 0, playing: false, speed: 20, follow: false, travel: false, sag: true, color: 'filament', lastLine: -1, lastUi: 0 };
    this.jobId = 0;

    this.scene = new Scene3D($('viewport'));
    this.scene.setBed(this.settings.bedX, this.settings.bedY, this.settings.bedZ);
    this.scene.setTheme(this.isDark());
    this.scene.viewHome();
    this.modelView = new ModelView(this.scene);
    this.printMesh = new PrintMesh(this.scene);
    this.head = new Printer3D(this.scene);
    this.head.build(this.settings.printer, this.settings);
    this.head.setVisible(false);

    this.settingsPanel = new SettingsPanel($('settings-panel'), this.settings, (changes) => this.setSettings(changes));
    this.inspector = new LayerInspector($('inspector'));
    this.layerChart = new LayerTimeChart($('layer-chart'), (i) => this.setLayer(i));
    this.gcodeView = new GcodeView($('gcode-editor'), { onSelect: (n, line) => this.onGcodeLine(n, line) });
    this.lessons = new Lessons($('lessons'), this);

    this.bindUI();
    this.scene.onFrame((dt) => this.frame(dt));
    this.loadSample('cube');
    this.setMode('prepare');
  }

  isDark() {
    const t = document.documentElement.dataset.theme;
    return t ? t === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  // ------------------------------------------------------------------ UI wiring
  bindUI() {
    document.querySelectorAll('#modes button').forEach((b) => b.addEventListener('click', () => this.setMode(b.dataset.mode)));
    $('btn-slice').addEventListener('click', async () => {
      await this.slice();
      if (this.mode === 'prepare') this.setMode('preview');
    });
    $('auto-slice').addEventListener('change', (e) => (this.autoSlice = e.target.checked));
    $('btn-lessons').addEventListener('click', () => this.lessons.toggle());
    $('btn-about').addEventListener('click', () => showAbout());
    $('btn-theme').addEventListener('click', () => {
      document.documentElement.dataset.theme = this.isDark() ? 'light' : 'dark';
      this.scene.setTheme(this.isDark());
      this.refreshPreviewPanel();
    });
    document.querySelectorAll('#view-buttons button').forEach((b) =>
      b.addEventListener('click', () => {
        if (b.dataset.view === 'home') this.mode === 'simulate' ? this.scene.viewPrinter() : this.scene.viewHome();
        else if (b.dataset.view === 'top') this.scene.viewTop();
        else this.fitView();
      }),
    );

    // ---- prepare
    const list = $('sample-list');
    for (const s of SAMPLES) {
      const b = document.createElement('button');
      b.textContent = s.name;
      b.dataset.id = s.id;
      b.addEventListener('click', () => this.loadSample(s.id));
      list.appendChild(b);
    }
    $('btn-open').addEventListener('click', () => $('file-input').click());
    $('file-input').addEventListener('change', (e) => {
      if (e.target.files[0]) this.openFile(e.target.files[0]);
      e.target.value = '';
    });
    $('btn-save-stl').addEventListener('click', () => {
      if (this.model) download(new Blob([toBinarySTL(this.model.placed)]), `${slug(this.model.name)}.stl`);
    });
    $('scale').addEventListener('change', (e) => {
      const v = parseFloat(e.target.value);
      if (v > 0) this.setTransform({ scale: v / 100 });
    });
    document.querySelectorAll('[data-rot]').forEach((b) =>
      b.addEventListener('click', () => this.setTransform({ rot: matMul(rotationMatrix(b.dataset.rot, 90), this.model.rot) })),
    );
    $('btn-reset-transform').addEventListener('click', () => this.setTransform({ rot: IDENTITY, scale: 1, offset: [0, 0] }));
    $('move-x').addEventListener('change', (e) => this.setTransform({ offset: [parseFloat(e.target.value) || 0, this.model.offset[1]] }));
    $('move-y').addEventListener('change', (e) => this.setTransform({ offset: [this.model.offset[0], parseFloat(e.target.value) || 0] }));
    $('show-overhang').addEventListener('change', () => this.recolorModel());
    $('show-cut').addEventListener('change', () => this.updateCut());
    $('cut-height').addEventListener('input', () => {
      $('show-cut').checked = true;
      this.updateCut();
    });

    // ---- drag & drop
    const center = document.querySelector('.center');
    center.addEventListener('dragover', (e) => {
      e.preventDefault();
      $('drop-hint').hidden = false;
    });
    center.addEventListener('dragleave', (e) => {
      if (!center.contains(e.relatedTarget)) $('drop-hint').hidden = true;
    });
    center.addEventListener('drop', (e) => {
      e.preventDefault();
      $('drop-hint').hidden = true;
      if (e.dataTransfer.files[0]) this.openFile(e.dataTransfer.files[0]);
    });

    // ---- preview
    $('layer-range').addEventListener('input', (e) => this.setLayer(+e.target.value));
    $('pv-single').addEventListener('change', (e) => { this.pv.single = e.target.checked; this.updatePreview(); });
    $('pv-travel').addEventListener('change', (e) => { this.pv.travel = e.target.checked; this.updatePreview(); });
    $('pv-sag').addEventListener('change', (e) => { this.pv.sag = this.sim.sag = e.target.checked; $('sim-sag').checked = e.target.checked; this.rebuildPrintMesh(); });
    $('pv-color').addEventListener('change', (e) => this.setColorMode(e.target.value));
    $('insp-step').addEventListener('input', (e) => {
      this.pv.step = +e.target.value;
      this.pv.playing = false;
      $('insp-play').textContent = '▶';
      this.drawInspector();
    });
    $('insp-play').addEventListener('click', () => {
      this.pv.playing = !this.pv.playing;
      $('insp-play').textContent = this.pv.playing ? '⏸' : '▶';
      if (this.pv.playing && this.pv.step >= +$('insp-step').max) this.pv.step = 0;
      this.pv.stepF = this.pv.step;
    });
    $('insp-big').addEventListener('click', () => {
      $('inspector').classList.toggle('big');
      this.drawInspector();
    });
    $('inspector').addEventListener('click', () => {
      if ($('inspector').classList.contains('big')) {
        $('inspector').classList.remove('big');
        this.drawInspector();
      }
    });

    // ---- simulate
    $('sim-play').addEventListener('click', () => this.simPlay(!this.sim.playing));
    $('sim-restart').addEventListener('click', () => this.simSeek(0));
    $('sim-prev').addEventListener('click', () => this.simLayer(-1));
    $('sim-next').addEventListener('click', () => this.simLayer(1));
    $('sim-speed').addEventListener('change', (e) => (this.sim.speed = +e.target.value));
    $('time-range').addEventListener('input', (e) => this.simSeek((+e.target.value / 1000) * this.totalTime()));
    $('sim-follow').addEventListener('change', (e) => (this.sim.follow = e.target.checked));
    $('sim-travel').addEventListener('change', (e) => { this.sim.travel = e.target.checked; this.updateSim(true); });
    $('sim-xray').addEventListener('change', (e) => this.head.setXray(e.target.checked));
    $('sim-sag').addEventListener('change', (e) => { this.pv.sag = this.sim.sag = e.target.checked; $('pv-sag').checked = e.target.checked; this.rebuildPrintMesh(); });
    $('sim-color').addEventListener('change', (e) => this.setColorMode(e.target.value));
    $('sim-filament').addEventListener('input', (e) => {
      this.printMesh.setFilamentColor(e.target.value);
      this.head.setFilamentColor(e.target.value);
    });
    this.buildReadouts();

    // ---- g-code
    $('gc-edit').addEventListener('click', () => {
      const on = !this.gcodeView.editing;
      this.gcodeView.setEditing(on);
      $('gc-edit').textContent = on ? 'Cancel' : 'Edit';
      $('gc-apply').hidden = !on;
    });
    $('gc-apply').addEventListener('click', async () => {
      const text = this.gcodeView.editedText();
      this.gcodeView.setEditing(false);
      $('gc-edit').textContent = 'Edit';
      $('gc-apply').hidden = true;
      await this.runGcode(text, 'edited', (this.model ? this.model.name : 'G-code') + ' (edited)');
      this.setMode('simulate');
    });
    $('gc-download').addEventListener('click', () => {
      if (this.result) download(new Blob([this.result.gcode], { type: 'text/plain' }), `${slug(this.result.name || 'print')}.gcode`);
    });
    $('gc-import').addEventListener('click', () => $('file-input').click());
    $('gc-search').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.gcodeView.search(e.target.value);
    });
    $('gc-simulate-here').addEventListener('click', () => {
      if (!this.result) return;
      const m = this.moveForLine(this.gcodeView.sel);
      this.setMode('simulate');
      this.simSeek(m >= 0 ? this.result.parsed.t0[m] : 0);
    });
    $('gc-reference').innerHTML = Object.entries(COMMANDS)
      .map(([k, v]) => `<div><code>${k}</code> <b>${v.name}</b> — ${escapeHtml(v.text)}</div>`)
      .join('');

    // ---- keyboard
    window.addEventListener('keydown', (e) => {
      if (e.target.closest?.('input, select, textarea')) return;
      if (this.mode === 'simulate' && e.code === 'Space') {
        e.preventDefault();
        this.simPlay(!this.sim.playing);
      } else if (this.mode === 'preview' && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        this.setLayer(this.pv.layer + (e.key === 'ArrowUp' ? 1 : -1));
      }
    });
  }

  // ------------------------------------------------------------------ settings
  setSettings(changes, { silent = false } = {}) {
    const bedChanged = ['bedX', 'bedY', 'bedZ'].some((k) => k in changes && changes[k] !== this.settings[k]);
    Object.assign(this.settings, changes);
    try { localStorage.setItem(STORE_KEY, JSON.stringify(this.settings)); } catch { /* ignore */ }
    this.settingsPanel.refresh();
    if (bedChanged) {
      this.scene.setBed(this.settings.bedX, this.settings.bedY, this.settings.bedZ);
      this.updateModel();
    }
    if (bedChanged || 'printer' in changes) this.head.build(this.settings.printer, this.settings);
    if ('supportAngle' in changes) this.recolorModel();
    if (!silent) this.markStale();
  }

  /** Load the real profile of a printer (keeps the material). */
  setPrinter(id) {
    this.setSettings(profileSettings(id, this.settings.material));
  }

  /** Switch material, with the values this printer's profile uses for it. */
  setMaterial(material) {
    this.setSettings({ material, ...materialSettings(this.settings.printer, material) });
  }

  markStale() {
    this.stale = true;
    document.querySelectorAll('#modes button').forEach((b) => b.classList.toggle('stale', b.dataset.mode !== 'prepare' && !!this.result));
    $('st-msg').textContent = this.result ? 'Settings changed — slice again to update.' : '';
    if (this.autoSlice && this.mode !== 'prepare' && (!this.result || this.result.source === 'slicer')) {
      clearTimeout(this.sliceTimer);
      this.sliceTimer = setTimeout(() => this.slice(), 350);
    }
  }

  // ------------------------------------------------------------------ model
  loadSample(id) {
    const s = SAMPLES.find((x) => x.id === id);
    this.setModel(s.build(), s.name, s.about, id);
  }

  async openFile(file) {
    const name = file.name.replace(/\.[^.]+$/, '');
    if (/\.(gcode|gco|g)$/i.test(file.name)) {
      const text = await file.text();
      await this.runGcode(text, 'imported', name);
      this.setMode('preview');
      return;
    }
    try {
      const buf = await file.arrayBuffer();
      const tris = /.3mf$/i.test(file.name) ? await parse3MF(buf) : /.obj$/i.test(file.name) ? parseOBJ(new TextDecoder().decode(buf)) : parseSTL(buf);
      if (!tris.length) throw new Error('The file contains no triangles.');
      this.setModel(tris, name, `Your model "${file.name}" (${(tris.length / 9).toLocaleString()} triangles).`, null);
      this.setMode('prepare');
    } catch (err) {
      this.toast(`Could not read ${file.name}: ${err.message}`);
    }
  }

  setModel(tris, name, about, sampleId) {
    // Large imported models are often in the wrong units or orientation; we keep them as-is.
    this.model = { base: tris, name, about, rot: IDENTITY, scale: 1, offset: [0, 0] };
    this.pvKeep = false; // a new model starts the preview at the top layer
    document.querySelectorAll('#sample-list button').forEach((b) => b.classList.toggle('on', b.dataset.id === sampleId));
    $('sample-about').textContent = about || '';
    $('st-model').textContent = name;
    this.updateModel();
    this.fitView();
    if (this.mode === 'gcode' || (this.result && this.result.source !== 'slicer')) this.result = null;
    this.markStale();
  }

  setTransform({ rot, scale, offset }) {
    if (!this.model) return;
    if (rot) this.model.rot = rot;
    if (scale) this.model.scale = scale;
    if (offset) this.model.offset = offset;
    this.updateModel();
    this.markStale();
  }

  updateModel() {
    const M = this.model;
    if (!M) return;
    const S = this.settings;
    const m = M.rot.map((v) => v * M.scale);
    M.placed = placeOnBed(transform(M.base, m), S.bedX, S.bedY, M.offset);
    M.bbox = bbox(M.placed);
    M.volume = volume(M.placed);
    M.overhang = overhangAngles(M.placed);
    M.welded = null;
    const b = M.bbox;
    M.fits = b.min[0] >= -1e-6 && b.min[1] >= -1e-6 && b.max[0] <= S.bedX + 1e-6 && b.max[1] <= S.bedY + 1e-6 && b.max[2] <= S.bedZ + 1e-6;
    $('model-size').textContent = b.size.map((v) => v.toFixed(1)).join(' × ') + ' mm';
    $('model-volume').textContent = `${(Math.abs(M.volume) / 1000).toFixed(2)} cm³`;
    $('model-tris').textContent = (M.placed.length / 9).toLocaleString();
    $('scale').value = Math.round(M.scale * 1000) / 10;
    $('move-x').value = M.offset[0];
    $('move-y').value = M.offset[1];
    // Models are often exported in the wrong unit: offer the usual fixes.
    const big = Math.max(...b.size);
    let hint = '';
    if (big < 3) hint = `The model is only ${big.toFixed(2)} mm big. Was it made in inches or centimetres? <button data-scale="25.4">× 25.4 (inch)</button> <button data-scale="10">× 10 (cm)</button>`;
    else if (!M.fits) {
      const fit = Math.floor(Math.min((S.bedX - 10) / b.size[0], (S.bedY - 10) / b.size[1], (S.bedZ - 1) / b.size[2]) * M.scale * 100);
      hint = `The model does not fit in the build volume (${S.bedX} × ${S.bedY} × ${S.bedZ} mm). <button data-scale-abs="${fit / 100}">Scale to fit (${fit}%)</button>`;
    }
    $('fit-warning').hidden = !hint;
    $('fit-warning').innerHTML = hint;
    $('fit-warning').querySelectorAll('[data-scale]').forEach((btn) => (btn.onclick = () => this.setTransform({ scale: M.scale * +btn.dataset.scale })));
    $('fit-warning').querySelectorAll('[data-scale-abs]').forEach((btn) => (btn.onclick = () => this.setTransform({ scale: +btn.dataset.scaleAbs })));
    this.modelView.setModel(M.placed, M.overhang, S.supportAngle, $('show-overhang').checked, !M.fits);
    this.recolorModel();
    this.updateCut();
  }

  recolorModel() {
    const M = this.model;
    if (!M) return;
    const a = this.settings.supportAngle;
    $('oh-angle').textContent = a;
    this.modelView.recolor(a, $('show-overhang').checked, !M.fits);
    let total = 0, over = 0;
    for (let i = 0; i < M.overhang.length; i++) {
      const o = i * 9, t = M.placed;
      const ux = t[o + 3] - t[o], uy = t[o + 4] - t[o + 1], uz = t[o + 5] - t[o + 2];
      const vx = t[o + 6] - t[o], vy = t[o + 7] - t[o + 1], vz = t[o + 8] - t[o + 2];
      const ar = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
      total += ar;
      if (M.overhang[i] > a) over += ar;
    }
    $('overhang-stat').textContent = over > 0
      ? `${((over / total) * 100).toFixed(1)}% of the surface (${over.toFixed(0)} mm²) overhangs more than ${a}°. ${this.settings.support ? 'Support is ON.' : 'Support is OFF — these areas will be printed in mid-air.'}`
      : `No surface overhangs more than ${a}°: this model can be printed without support.`;
  }

  updateCut() {
    const M = this.model;
    if (!M) return;
    if (!$('show-cut').checked || this.mode !== 'prepare') {
      this.modelView.setCut(null);
      this.modelView.setGhost(false);
      return;
    }
    if (!M.welded) M.welded = weld(M.placed);
    const zmax = M.bbox.max[2];
    const layers = computeLayers(zmax, this.settings);
    const li = Math.min(layers.length - 1, Math.floor((+$('cut-height').value / 1000) * layers.length));
    const L = layers[li];
    const islands = contourAtZ(M.welded, L.sliceZ);
    this.modelView.setCut(L.sliceZ, islands, SCALE);
    this.modelView.setGhost(true);
    const holes = islands.reduce((n, isl) => n + isl.length - 1, 0);
    $('cut-info').innerHTML = `Layer <b>${li + 1}</b> of <b>${layers.length}</b>, cut at Z = ${L.sliceZ.toFixed(2)} mm (the middle of the layer). ` +
      `The cross-section has <b>${islands.length}</b> separate island${islands.length === 1 ? '' : 's'}${holes ? ` and <b>${holes}</b> hole${holes === 1 ? '' : 's'}` : ''}. ` +
      `With ${this.settings.layerHeight} mm layers the printer stacks ${layers.length} of these shapes on top of each other.`;
  }

  fitView() {
    if (this.mode !== 'prepare' && this.result && isFinite(this.result.parsed.stats.min[0])) {
      const s = this.result.parsed.stats;
      this.scene.frame(s.min, s.max);
    } else if (this.model) this.scene.frame(this.model.bbox.min, this.model.bbox.max);
  }

  // ------------------------------------------------------------------ slicing
  /**
   * Run a job in a fresh worker. A newer job cancels an older one; everybody waiting on any of
   * them is resolved when the newest job finishes (only the newest job's `finish` handles data).
   */
  runWorker(msg, transfer, finish) {
    if (this.worker) this.worker.terminate(); // cancel any slice still running
    this.waiters = this.waiters || [];
    const id = ++this.jobId;
    const worker = (this.worker = new SlicerWorker());
    $('progress').hidden = false;
    $('progress-text').textContent = 'Starting…';
    $('progress-bar').style.width = '0%';
    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve, reject });
      worker.onmessage = (ev) => {
        const d = ev.data;
        if (d.id !== id) return;
        if (d.type === 'progress') {
          $('progress-text').textContent = d.stage + '…';
          $('progress-bar').style.width = `${Math.round(d.frac * 100)}%`;
        } else {
          $('progress').hidden = true;
          worker.terminate();
          if (this.worker === worker) this.worker = null;
          const waiters = this.waiters.splice(0);
          if (d.type === 'error') {
            console.error(d.message);
            this.toast('Something went wrong: ' + d.message.split('\n')[0]);
            waiters.forEach((w) => w.reject(new Error(d.message)));
          } else {
            try {
              finish(d);
              waiters.forEach((w) => w.resolve());
            } catch (err) {
              console.error(err);
              waiters.forEach((w) => w.reject(err));
            }
          }
        }
      };
      worker.onerror = (ev) => {
        ev.preventDefault();
        $('progress').hidden = true;
        const message = ev.message || 'The slicing worker could not start.';
        console.error(message);
        this.toast('Something went wrong: ' + message);
        this.waiters.splice(0).forEach((w) => w.reject(new Error(message)));
      };
      worker.postMessage({ ...msg, id }, transfer);
    });
  }

  async slice() {
    if (!this.model) return;
    clearTimeout(this.sliceTimer);
    const tris = this.model.placed.slice();
    const settings = { ...this.settings };
    const name = this.model.name;
    await this.runWorker({ cmd: 'slice', tris, settings }, [tris.buffer], (res) => this.setResult({ ...res, source: 'slicer', name, settings }));
  }

  async runGcode(text, source, name) {
    const settings = { ...this.settings };
    await this.runWorker({ cmd: 'parse', gcode: text, settings }, [], (res) => this.setResult({ ...res, source, name, settings }));
  }

  setResult(res) {
    this.result = res;
    this.stale = false;
    document.querySelectorAll('#modes button').forEach((b) => b.classList.remove('stale'));
    const P = res.parsed;
    this.gcodeLines = res.gcode.split('\n');
    this.lineToMove = new Int32Array(this.gcodeLines.length).fill(-1);
    for (let m = P.n - 1; m >= 0; m--) this.lineToMove[P.line[m]] = m;
    this.inspector.setData(P, res.meta);
    this.rebuildPrintMesh();
    this.gcodeView.setText(res.gcode, res.name || 'G-code');

    // stats bar
    const S = this.settings;
    const grams = this.filamentGrams(P.stats.filament);
    $('st-time').textContent = fmtTime(P.stats.time);
    $('st-time').title = `Moving ${fmtTime(P.stats.motionTime)} + heating ${fmtTime(P.stats.heatTime)} + homing/levelling ${fmtTime(P.stats.homeTime)} + waiting ${fmtTime(P.stats.dwellTime)}`;
    this.renderTimeBreakdown();
    $('st-fil').textContent = `${(P.stats.filament / 1000).toFixed(2)} m`;
    $('st-weight').textContent = `${grams.toFixed(1)} g`;
    $('st-cost').textContent = (grams / 1000 * S.filamentCost).toFixed(2);
    $('st-layers').textContent = P.layers.length;
    $('st-msg').textContent = res.source === 'imported' ? 'Imported G-code' : res.source === 'edited' ? 'Edited G-code' : '';
    $('st-model').textContent = res.name || '';

    // preview panel
    const range = $('layer-range');
    range.max = P.layers.length - 1;
    $('layer-top-label').textContent = P.layers.length;
    this.layerChart.setData(P.layers.map((l) => l.time), res.source === 'slicer' ? S.minLayerTime : 0);
    renderFeatureBars($('feature-chart'), P.stats, (mm) => this.filamentGrams(mm));
    this.renderWarnings();
    const keepLayer = this.pvKeep && this.pv.layer < P.layers.length;
    this.pvKeep = true;
    this.setLayer(keepLayer ? this.pv.layer : P.layers.length - 1);
    this.sim.t = Math.min(this.sim.t, P.stats.time);
    if (this.mode === 'simulate') this.updateSim(true);
    this.applyModeVisibility();
    this.lessons.notify('sliced');
  }

  rebuildPrintMesh() {
    if (!this.result) return;
    this.printMesh.colorMode = this.mode === 'simulate' ? this.sim.color : this.pv.color;
    this.printMesh.build(this.result.parsed, this.result.analysis, { sag: this.mode === 'simulate' ? this.sim.sag : this.pv.sag });
    if (this.printMesh.lineMode) this.toast('Large print: shown as thin lines instead of 3D plastic to save memory.');
    this.updateLegend();
    if (this.mode === 'simulate') this.updateSim(true);
    else this.updatePreview();
  }

  filamentGrams(mm) {
    const S = this.settings;
    return ((Math.max(0, mm) * Math.PI * (S.filamentDiameter / 2) ** 2) / 1000) * S.filamentDensity;
  }

  setColorMode(mode) {
    if (this.mode === 'simulate') this.sim.color = mode;
    else this.pv.color = mode;
    $('pv-color').value = this.pv.color;
    $('sim-color').value = this.sim.color;
    this.printMesh.setColorMode(mode);
    this.updateLegend();
    this.lessons.notify('color:' + mode);
  }

  updateLegend() {
    const lg = $('legend');
    const data = this.mode === 'prepare' || this.mode === 'gcode' || !this.result ? null : this.printMesh.legend();
    lg.hidden = !data;
    if (!data) return;
    if (data.kind === 'cat') {
      lg.innerHTML = `<b>${data.title}</b>` + data.items.map((it) => `<div class="item"><i style="background:${it.color}"></i>${it.label}</div>`).join('');
    } else {
      lg.innerHTML = `<b>${data.title}</b><div class="ramp" style="background:linear-gradient(90deg,${SEQ_RAMP.join(',')})"></div><div class="ramp-labels"><span>${data.min}</span><span>${data.max}</span></div>`;
    }
  }

  renderWarnings() {
    const res = this.result, P = res.parsed, A = res.analysis, S = res.settings;
    const W = [];
    const add = (level, text) => W.push({ level, text });
    if (res.source === 'slicer') {
      if (this.model && !this.model.fits) add('bad', 'The model is outside the build volume. A real printer would crash into its frame or skip this part.');
      for (const w of res.warnings || []) add(w.level, w.text);
      const r = MATERIAL_RANGES[S.material];
      if (r && (S.nozzleTemp < r.nozzle[0] || S.nozzleTemp > r.nozzle[1])) add('warn', `${S.nozzleTemp} °C is outside the usual ${r.nozzle[0]}–${r.nozzle[1]} °C for ${S.material}: expect ${S.nozzleTemp < r.nozzle[0] ? 'clogging, under-extrusion and weak layers' : 'stringing, oozing and burnt plastic'}.`);
      if (r && (S.bedTemp < r.bed[0] || S.bedTemp > r.bed[1])) add('warn', `Bed at ${S.bedTemp} °C is outside the usual ${r.bed[0]}–${r.bed[1]} °C for ${S.material}: ${S.bedTemp < r.bed[0] ? 'the part may warp or come loose' : 'the first layers may get soft and deform ("elephant foot")'}.`);
      if (S.layerHeight > S.nozzle * 0.8) add('warn', `Layer height ${S.layerHeight} mm is more than 80% of the nozzle (${S.nozzle} mm): the layers will not be squeezed together and will bond poorly.`);
      if (S.lineWidth < S.nozzle * 0.9 || S.lineWidth > S.nozzle * 1.6) add('warn', `Line width ${S.lineWidth} mm is unusual for a ${S.nozzle} mm nozzle (typical: ${(S.nozzle * 1.0).toFixed(2)}–${(S.nozzle * 1.25).toFixed(2)} mm).`);
      if (S.infillDensity < 10 && S.topLayers < 4 && S.infillDensity > 0) add('info', 'Low infill with few top layers: the top surface has to bridge long gaps and may show holes ("pillowing").');
      if (S.infillDensity === 0) add('info', 'Infill is 0%: the part is hollow. The top layers have nothing to rest on.');
      if (S.adhesion === 'none' && P.layers[0] && this.firstLayerArea() < 150) add('info', 'The part touches the bed only with a small area and has no brim: it might come loose during printing.');
      if (S.fanSpeed === 0 && A.longBridgeLength + A.overAirLength > 0) add('info', 'The fan is off but there are bridges/overhangs: without cooling they sag even more.');
      // the hot end can only melt so much plastic per second
      const bead = (S.lineWidth - S.layerHeight) * S.layerHeight + (Math.PI * S.layerHeight ** 2) / 4;
      const vMax = S.maxVolumetric / bead;
      const capped = [['infill', S.infillSpeed], ['solid infill', S.skinSpeed], ['inner wall', S.innerWallSpeed], ['outer wall', S.outerWallSpeed]].filter(([, v]) => v > vMax + 0.5);
      if (capped.length) add('info', `The hot end can melt at most ${S.maxVolumetric} mm³/s of ${S.material}. With ${S.lineWidth} × ${S.layerHeight} mm lines that is ${vMax.toFixed(0)} mm/s, so the ${capped.map((c) => c[0]).join(', ')} speed is reduced to ${vMax.toFixed(0)} mm/s.`);
      if (S.travelSpeed > Math.min(S.maxFeedX, S.maxFeedY)) add('info', `Travel speed ${S.travelSpeed} mm/s is above the printer's limit (${Math.min(S.maxFeedX, S.maxFeedY)} mm/s, set by M203): the firmware moves at its limit instead.`);
      if (S.retraction && S.retractSpeed > S.maxFeedE) add('info', `Retraction speed ${S.retractSpeed} mm/s is above the extruder limit (${S.maxFeedE} mm/s): the firmware retracts more slowly.`);
    }
    if (res.source !== 'slicer') {
      const macros = P.unknown.filter((u) => /^[A-Z_]{4,}/.test(u.cmd));
      if (macros.length) add('warn', `This G-code calls printer macros (${macros.map((u) => u.cmd).slice(0, 4).join(', ')}) that run code stored in the printer. The simulator cannot know what they do; their time is not included.`);
      if (P.info.printerModel) add('info', `The file was made for "${P.info.printerModel}". The simulation uses the ${PRINTER_PROFILES[S.printer]?.label || 'custom'} limits unless the file sets its own (M201/M203/M204/M205).`);
    }
    if (A.overAirLength > 30) {
      const ls = A.overAirLayers;
      add('bad', `About ${A.overAirLength.toFixed(0)} mm of lines are printed in mid-air (layers ${ls[0] + 1}–${ls[ls.length - 1] + 1}). They will droop or fail. ${res.source === 'slicer' && !S.support ? 'Turn on support,' : 'Use more support,'} rotate the model, or reduce the overhang. Colour by "Over air?" to see where.`);
    } else if (res.source === 'slicer' && S.support) add('good', 'Every line rests on something: support works.');
    if (A.longBridgeLength > 20) add('info', `There are long bridges (${A.longBridgeLength.toFixed(0)} mm of lines span more than 10 mm). Bridges work if printed fast and with full cooling, but they sag a little.`);
    const shortLayers = P.layers.filter((l, i) => i > 0 && l.time > 0 && l.time < S.minLayerTime * 0.95).length;
    if (res.source === 'slicer' && S.minLayerTime > 0 && shortLayers > 0) add('info', `${shortLayers} layer(s) still take less than ${S.minLayerTime} s (the minimum speed limits the slow-down). The plastic may not cool enough.`);
    if (!W.length) add('good', 'No problems found.');
    $('warnings').innerHTML = W.map((w) => `<li class="${w.level}"><span>${escapeHtml(w.text)}</span></li>`).join('');
  }

  renderTimeBreakdown() {
    const res = this.result, P = res.parsed, st = P.stats;
    const prof = PRINTER_PROFILES[res.settings.printer];
    const row = (label, v, bold) => `<div class="kv"><span>${label}</span>${bold ? '<b>' : '<span>'}${v}${bold ? '</b>' : '</span>'}</div>`;
    let html = row('Moving (printing + travel)', fmtTime(st.motionTime)) +
      row('Heating up (M190 / M109)', fmtTime(st.heatTime)) +
      row('Homing and bed levelling', fmtTime(st.homeTime)) +
      (st.dwellTime > 0 ? row('Waiting (G4)', fmtTime(st.dwellTime)) : '') +
      row('Total, start to finish', fmtTime(st.time), true);
    // how much speed is lost to acceleration: the printer rarely reaches the speed in the G-code
    let d = 0, tReal = 0, tNominal = 0;
    for (let m = 0; m < P.n; m++) {
      if (P.kind[m] !== KIND.EXTRUDE) continue;
      const len = Math.hypot(P.px[m + 1] - P.px[m], P.py[m + 1] - P.py[m]);
      d += len;
      tReal += P.dur[m];
      tNominal += len / P.feed[m];
    }
    if (tReal > 0) html += `<p class="small">Printing moves reach on average <b>${Math.round((tNominal / tReal) * 100)}%</b> of the speed set in the G-code: every line has to accelerate and slow down again at corners.</p>`;
    if (P.info.estimate && res.source !== 'slicer') {
      const diff = ((st.motionTime - P.info.estimate) / P.info.estimate) * 100;
      html += `<p class="small">The file's own estimate (${escapeHtml(P.info.generator || 'slicer')}): <b>${fmtTime(P.info.estimate)}</b> (${P.info.estimateSource}). Our moving time differs by ${diff >= 0 ? '+' : ''}${diff.toFixed(1)}%.</p>`;
    }
    html += `<p class="muted small">Moving time follows the firmware's motion planning (acceleration, jerk and speed limits of the ${prof ? prof.label : 'custom printer'}); it matches PrusaSlicer's estimator within 0.1%. Heating and homing are typical values for this printer${res.source === 'slicer' ? '' : '; select the printer the file was made for in the settings'}.</p>`;
    $('time-breakdown').innerHTML = html;
  }

  firstLayerArea() {
    const m = this.result && this.result.meta;
    if (!m || !m.outlines[0]) return Infinity;
    let a = 0;
    for (const L of m.outlines[0]) {
      for (let i = 0, j = L.length - 2; i < L.length; j = i, i += 2) a += (L[j] + L[i]) * (L[j + 1] - L[i + 1]);
    }
    return Math.abs(a / 2);
  }

  // ------------------------------------------------------------------ modes
  async setMode(mode) {
    const prev = this.mode;
    if (mode !== 'prepare' && (!this.result || (this.stale && this.result.source === 'slicer'))) {
      if (!this.model) return;
      this.mode = mode; // set early so the stale-check in slice() uses the right mode
      try {
        await this.slice();
      } catch {
        mode = 'prepare';
      }
    }
    if (prev === 'simulate' && mode !== 'simulate') this.simPlay(false);
    this.mode = mode;
    document.querySelectorAll('#modes button').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
    document.querySelectorAll('#right-panel > [data-panel]').forEach((p) => (p.hidden = p.dataset.panel !== mode));
    if ((prev === 'simulate') !== (mode === 'simulate') && this.result) {
      // the preview and the simulation can use different colour modes / sag options
      this.printMesh.colorMode = mode === 'simulate' ? this.sim.color : this.pv.color;
      if (this.pv.sag !== this.sim.sag) this.rebuildPrintMesh();
      else this.printMesh.applyColors();
    }
    $('pv-color').value = this.pv.color;
    $('sim-color').value = this.sim.color;
    this.applyModeVisibility();
    this.updateLegend();
    if (mode === 'preview') this.updatePreview();
    if (mode === 'simulate') {
      if (prev !== 'simulate') this.scene.viewPrinter();
      this.updateSim(true);
    }
    if (mode === 'prepare') this.updateCut();
    else this.modelView.setCut(null);
    if (mode === 'gcode') this.gcodeView.render();
    this.lessons.notify('mode:' + mode);
  }

  applyModeVisibility() {
    const m = this.mode;
    const hasPrint = !!this.result;
    $('gcode-editor').hidden = m !== 'gcode';
    $('viewport').style.visibility = m === 'gcode' ? 'hidden' : 'visible';
    $('view-buttons').hidden = m === 'gcode';
    $('layer-slider').hidden = m !== 'preview' || !hasPrint;
    $('timeline').hidden = m !== 'simulate' || !hasPrint;
    $('hud').hidden = !(m === 'preview' || m === 'simulate') || !hasPrint;
    this.modelView.setVisible(m === 'prepare');
    this.scene.printGroup.visible = m === 'preview' || m === 'simulate';
    this.scene.invalidate();
    this.head.setVisible(m === 'simulate');
    if (m !== 'simulate') this.scene.setBedHeat(0);
  }

  // ------------------------------------------------------------------ preview
  layerEnd(i) {
    const P = this.result.parsed;
    return i + 1 < P.layers.length ? P.layers[i + 1].first : P.n;
  }

  setLayer(i) {
    if (!this.result) return;
    const P = this.result.parsed;
    i = Math.max(0, Math.min(P.layers.length - 1, i));
    this.pv.layer = i;
    $('layer-range').value = i;
    const [m0, m1] = [P.layers[i].first, this.layerEnd(i)];
    $('insp-step').max = m1 - m0;
    this.pv.step = m1 - m0;
    $('insp-step').value = this.pv.step;
    this.updatePreview();
    this.lessons.notify('layer');
  }

  updatePreview() {
    if (!this.result || this.mode !== 'preview') return;
    const P = this.result.parsed;
    const i = (this.pv.layer = Math.min(this.pv.layer, P.layers.length - 1)), L = P.layers[i];
    const start = this.pv.single ? L.first : 0;
    const end = Math.min(this.layerEnd(i), L.first + this.pv.step);
    this.printMesh.showRange(start, end, 0, this.pv.travel, L.first);
    $('pv-layer').textContent = `${i + 1} / ${P.layers.length}`;
    $('pv-z').textContent = `${L.z.toFixed(2)} mm`;
    $('pv-h').textContent = `${(L.h || 0).toFixed(2)} mm`;
    $('pv-time').textContent = fmtTime(L.time);
    $('hud').textContent = `Layer ${i + 1} / ${P.layers.length} · Z ${L.z.toFixed(2)} mm`;
    this.layerChart.select(i);
    this.drawInspector();
  }

  refreshPreviewPanel() {
    if (!this.result) return;
    this.layerChart.render();
    this.drawInspector();
  }

  drawInspector() {
    if (!this.result) return;
    const P = this.result.parsed;
    const info = this.inspector.draw(this.pv.layer, this.pv.step);
    if (!info) return;
    const { m0, m1, end } = info;
    let text = `${end - m0} of ${m1 - m0} moves in this layer.`;
    const m = end - 1;
    if (m >= m0 && m < P.n) {
      const k = P.kind[m];
      const len = Math.hypot(P.px[m + 1] - P.px[m], P.py[m + 1] - P.py[m]);
      const avg = P.dur[m] > 0 ? len / P.dur[m] : 0;
      const sp = `${P.feed[m].toFixed(0)} mm/s requested, ${avg.toFixed(0)} mm/s average (acceleration), ${P.dur[m].toFixed(2)} s`;
      if (k === KIND.EXTRUDE) text = `Move ${end - m0}/${m1 - m0}: printing <b>${FEATURE_INFO[P.type[m]].label.toLowerCase()}</b>, ${len.toFixed(1)} mm: ${sp}.`;
      else if (k === KIND.TRAVEL) text = `Move ${end - m0}/${m1 - m0}: <b>travel</b> ${len.toFixed(1)} mm (no plastic): ${sp}.`;
      else if (k === KIND.RETRACT) text = `Move ${end - m0}/${m1 - m0}: <b>${P.e[m] < 0 ? 'retract' : 'un-retract'}</b> ${Math.abs(P.e[m]).toFixed(2)} mm of filament.`;
    }
    $('insp-info').innerHTML = text;
    const used = new Set();
    for (let k = m0; k < m1; k++) if (P.kind[k] === KIND.EXTRUDE) used.add(P.type[k]);
    let lg = [...used].sort().map((c) => `<span><i style="background:${FEATURE_INFO[c].color}"></i>${FEATURE_INFO[c].label}</span>`).join('');
    lg += '<span><i style="border:1.5px dashed #5b8def"></i>travel</span><span><i style="border:1.5px solid #6250d6;border-radius:50%"></i>retraction</span><span><i style="background:var(--text);border-radius:50%;transform:scale(.5)"></i>seam</span>';
    if (this.result.meta && this.result.meta.lost[this.pv.layer]?.length) lg += '<span><i style="background:rgba(208,59,59,.5)"></i>too thin — lost</span>';
    $('insp-legend').className = 'mini-legend inline';
    $('insp-legend').innerHTML = lg;
  }

  // ------------------------------------------------------------------ simulation
  totalTime() {
    return this.result ? this.result.parsed.stats.time : 0;
  }

  simPlay(on) {
    if (on && this.sim.t >= this.totalTime() - 1e-6) this.sim.t = 0;
    this.sim.playing = on && !!this.result;
    $('sim-play').textContent = this.sim.playing ? '⏸ Pause' : '▶ Play';
    if (this.sim.playing) this.lessons.notify('sim:play');
  }

  simSeek(t) {
    this.sim.t = Math.max(0, Math.min(this.totalTime(), t));
    this.updateSim(true);
  }

  simLayer(dir) {
    if (!this.result) return;
    const P = this.result.parsed;
    const m = moveAtTime(P, this.sim.t);
    let li = P.layer[m] + dir;
    if (dir < 0 && this.sim.t > P.t0[P.layers[P.layer[m]].firstExtrusion > 0 ? P.layers[P.layer[m]].firstExtrusion : P.layers[P.layer[m]].first] + 0.5) li = P.layer[m];
    li = Math.max(0, Math.min(P.layers.length - 1, li));
    const L = P.layers[li];
    this.simSeek(P.t0[L.firstExtrusion >= 0 ? L.firstExtrusion : L.first]);
  }

  frame(dt) {
    if (this.mode === 'simulate' && this.sim.playing) {
      this.sim.t += dt * this.sim.speed;
      if (this.sim.t >= this.totalTime()) {
        this.sim.t = this.totalTime();
        this.simPlay(false);
        this.lessons.notify('sim:end');
      }
      this.updateSim(false);
    }
    if (this.mode === 'preview' && this.pv.playing && this.result) {
      const max = +$('insp-step').max;
      this.pv.stepF = (this.pv.stepF || 0) + dt * Math.max(8, max / 6);
      this.pv.step = Math.min(max, Math.floor(this.pv.stepF));
      $('insp-step').value = this.pv.step;
      if (this.pv.step >= max) {
        this.pv.playing = false;
        $('insp-play').textContent = '▶';
      }
      this.updatePreview();
    }
    if (this.mode === 'simulate' && this.result) {
      const P = this.result.parsed;
      const nz = temperatureAt(P.tempEvents.nozzle, P.heaters.nozzle, this.sim.t).temp;
      this.head.update(dt, nz, valueAt(P.fanEvents, this.sim.t));
    }
  }

  updateSim(force) {
    if (!this.result || this.mode !== 'simulate') return;
    const P = this.result.parsed;
    const t = this.sim.t;
    const m = moveAtTime(P, t);
    // position along the move follows the planned accelerate–cruise–decelerate profile
    const f = P.n ? progressAt(P, m, t - P.t0[m]) : 0;
    const done = f >= 1 ? m + 1 : m;
    const x = P.px[m] + (P.px[m + 1] - P.px[m]) * f;
    const y = P.py[m] + (P.py[m + 1] - P.py[m]) * f;
    const z = P.pz[m] + (P.pz[m + 1] - P.pz[m]) * f;
    const li = P.layer[m] || 0;
    this.printMesh.showRange(0, done, f < 1 ? f : 0, this.sim.travel, P.layers[li].first);
    this.head.setPosition(x, y, z);
    if (this.sim.follow) {
      const tgt = this.scene.controls.target;
      // the bed moves in Y, so follow the nozzle where it really is: fixed Y, moving X and Z
      const nw = this.head.nozzleWorld();
      const dx = nw.x - tgt.x, dy = nw.y - tgt.y, dz = nw.z - tgt.z;
      const k = force ? 1 : 0.08;
      tgt.set(tgt.x + dx * k, tgt.y + dy * k, tgt.z + dz * k);
      this.scene.camera.position.set(this.scene.camera.position.x + dx * k, this.scene.camera.position.y + dy * k, this.scene.camera.position.z + dz * k);
    }
    const bedT = temperatureAt(P.tempEvents.bed, P.heaters.bed, t);
    this.scene.setBedHeat((bedT.temp - 25) / 80);

    // DOM updates at ~12 fps
    const now = performance.now();
    if (!force && now - this.sim.lastUi < 80) return;
    this.sim.lastUi = now;
    const total = this.totalTime();
    $('time-range').value = total ? Math.round((t / total) * 1000) : 0;
    $('time-now').textContent = fmtClock(t);
    $('time-total').textContent = fmtClock(total);
    const nozT = temperatureAt(P.tempEvents.nozzle, P.heaters.nozzle, t);
    const fan = valueAt(P.fanEvents, t);
    const k = P.kind[m];
    let doing = 'Idle';
    if (k === KIND.EXTRUDE) doing = `Printing ${FEATURE_INFO[P.type[m]].label.toLowerCase()}`;
    else if (k === KIND.TRAVEL) doing = 'Travelling';
    else if (k === KIND.RETRACT) doing = P.e[m] < 0 ? 'Retracting filament' : 'Un-retracting';
    else if (k === KIND.WAIT) doing = /M109/i.test(this.gcodeLines[P.line[m]]) ? 'Waiting: nozzle heating' : /M190/i.test(this.gcodeLines[P.line[m]]) ? 'Waiting: bed heating' : 'Waiting';
    else if (k === KIND.HOME) doing = 'Homing axes';
    const r = this.readouts;
    r.doing.textContent = doing;
    r.layer.textContent = `${li + 1} / ${P.layers.length}`;
    r.pos.textContent = `${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(2)}`;
    r.speed.textContent = k === KIND.WAIT || k === KIND.HOME ? '–' : `${speedNow(P, m, t - P.t0[m]).toFixed(0)} of ${P.feed[m].toFixed(0)} mm/s`;
    let fil = 0;
    // filament used so far: cumulative sum is cheap enough to compute lazily via a prefix array
    if (!this.filPrefix || this.filPrefix.P !== P) {
      const pre = new Float64Array(P.n + 1);
      for (let i = 0; i < P.n; i++) pre[i + 1] = pre[i] + P.e[i];
      this.filPrefix = { P, pre };
    }
    fil = this.filPrefix.pre[m] + P.e[m] * f;
    r.fil.textContent = `${(fil / 1000).toFixed(2)} m · ${this.filamentGrams(fil).toFixed(1)} g`;
    r.nozzle.textContent = `${nozT.temp.toFixed(0)} °C / ${nozT.target.toFixed(0)}`;
    r.nozzleBar.style.width = `${Math.min(100, (nozT.temp / 300) * 100)}%`;
    r.nozzleTarget.style.left = `${Math.min(100, (nozT.target / 300) * 100)}%`;
    r.bed.textContent = `${bedT.temp.toFixed(0)} °C / ${bedT.target.toFixed(0)}`;
    r.bedBar.style.width = `${Math.min(100, (bedT.temp / 120) * 100)}%`;
    r.bedTarget.style.left = `${Math.min(100, (bedT.target / 120) * 100)}%`;
    r.fan.textContent = `${Math.round(fan * 100)}%`;
    r.remaining.textContent = fmtTime(total - t);
    $('hud').textContent = `${doing} · layer ${li + 1}/${P.layers.length} · ${fmtClock(t)} / ${fmtClock(total)}`;

    const line = P.line[m];
    if (line !== this.sim.lastLine) {
      this.sim.lastLine = line;
      const lo = Math.max(0, line - 3), hi = Math.min(this.gcodeLines.length, line + 4);
      let html = '';
      for (let i = lo; i < hi; i++) {
        const txt = escapeHtml(this.gcodeLines[i] || ' ');
        html += i === line ? `<span class="cur">${txt}</span>` : `<span class="dim">${txt}</span>\n`;
      }
      $('sim-gcode').innerHTML = html;
      const ex = explainLine(this.gcodeLines[line] || '', { kind: P.kind[m], e: P.e[m] });
      $('sim-explain').innerHTML = `<b>${escapeHtml(ex.title)}</b><br>${escapeHtml(ex.text)}`;
    }
  }

  buildReadouts() {
    const box = $('readouts');
    const cell = (key, label, wide = false, thermo = false) =>
      `<div class="readout${wide ? ' wide' : ''}"><em>${label}</em><b data-r="${key}">–</b>${thermo ? `<div class="thermo"><div class="fill" data-r="${key}Bar"></div><div class="target" data-r="${key}Target"></div></div>` : ''}</div>`;
    box.innerHTML =
      cell('doing', 'Now', true) + cell('layer', 'Layer') + cell('speed', 'Speed') + cell('pos', 'Nozzle X, Y, Z', true) +
      cell('nozzle', 'Nozzle temp', false, true) + cell('bed', 'Bed temp', false, true) + cell('fan', 'Part fan') + cell('remaining', 'Remaining') +
      cell('fil', 'Filament used', true);
    this.readouts = {};
    box.querySelectorAll('[data-r]').forEach((e) => (this.readouts[e.dataset.r] = e));
  }

  // ------------------------------------------------------------------ g-code
  moveForLine(n) {
    if (!this.lineToMove) return -1;
    for (let i = Math.max(0, n); i < this.lineToMove.length; i++) if (this.lineToMove[i] >= 0) return this.lineToMove[i];
    return -1;
  }

  onGcodeLine(n, line) {
    const m = this.lineToMove ? this.lineToMove[n] : -1;
    const P = this.result && this.result.parsed;
    const ex = explainLine(line, m >= 0 && P ? { kind: P.kind[m], e: P.e[m] } : null);
    let html = `<pre class="gcode-ticker"><span class="cur">${escapeHtml(line || ' ')}</span></pre><p><b>${escapeHtml(ex.title)}</b></p><p class="small">${escapeHtml(ex.text)}</p>`;
    if (ex.params && ex.params.length) html += `<table class="params">${ex.params.map((p) => `<tr><td>${p.letter}</td><td>${p.value}</td><td>${escapeHtml(p.meaning)}</td></tr>`).join('')}</table>`;
    if (m >= 0 && P) html += `<p class="muted small">Line ${n + 1} · happens ${fmtClock(P.t0[m])} into the print, in layer ${P.layer[m] + 1}.</p>`;
    $('gc-explain').innerHTML = html;
    this.lessons.notify('gcode:line');
  }

  // ------------------------------------------------------------------ misc
  toast(msg) {
    $('st-msg').textContent = msg;
    $('st-msg').animate([{ color: 'var(--bad)' }, { color: 'var(--muted)' }], { duration: 3000 });
  }

  /** Used by lessons: highlight a setting in the settings panel. */
  showSetting(key) {
    this.settingsPanel.highlight(key);
  }
}

/** Instantaneous speed (mm/s) tau seconds into move m, from the planned trapezoid. */
function speedNow(P, m, tau) {
  const a = P.accel[m], v0 = P.vEntry[m], vc = P.vPeak[m];
  if (!(a > 0)) return P.dur[m] > 0 ? Math.hypot(P.px[m + 1] - P.px[m], P.py[m + 1] - P.py[m], P.pz[m + 1] - P.pz[m]) / P.dur[m] : 0;
  const tAcc = vc > v0 ? (vc - v0) / a : 0;
  const tCruise = vc > 0 ? (P.decAfter[m] - P.accUntil[m]) / vc : 0;
  if (tau <= tAcc) return v0 + a * tau;
  if (tau <= tAcc + tCruise) return vc;
  return Math.max(0, vc - a * (tau - tAcc - tCruise));
}

const SOURCE_URL = 'https://github.com/MohammadrezaConstructor/slicer';

/** Licence notice, source code link and credits (required by the AGPL for interactive programs). */
function showAbout() {
  const modal = $('modal');
  modal.innerHTML = `<div class="box" role="dialog" aria-modal="true" aria-labelledby="about-title">
    <h2 id="about-title">Slicer Lab</h2>
    <p>A teaching slicer and 3D-printing simulator.<br>Copyright © 2026 The Slicer Lab authors.</p>
    <p>This program is free software: you can redistribute it and/or modify it under the terms of the
      <b>GNU Affero General Public License</b> as published by the Free Software Foundation, either version 3 of the
      License, or (at your option) any later version. It is distributed WITHOUT ANY WARRANTY; without even the implied
      warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
      <a href="https://www.gnu.org/licenses/agpl-3.0.html" target="_blank" rel="noopener">GNU AGPL v3</a> for details.</p>
    <p>Source code: <a href="${SOURCE_URL}" target="_blank" rel="noopener">${SOURCE_URL}</a></p>
    <h3>Based on and with thanks to</h3>
    <ul>
      <li><a href="https://github.com/prusa3d/PrusaSlicer" target="_blank" rel="noopener">PrusaSlicer</a> (AGPL-3.0, © Prusa Research and contributors; Slic3r © Alessandro Ranellucci):
        the print-time estimator is derived from its GCodeProcessor; its cooling logic and line-spacing formula are used.</li>
      <li><a href="https://github.com/MarlinFirmware/Marlin" target="_blank" rel="noopener">Marlin</a> and <a href="https://github.com/grbl/grbl" target="_blank" rel="noopener">Grbl</a> (GPL-3.0): the motion planning algorithm.</li>
      <li>PrusaSlicer 2.9.6 system profiles (AGPL-3.0): the machine limits, print settings, start/end G-code and material data of the two printers.</li>
      <li><a href="https://threejs.org" target="_blank" rel="noopener">three.js</a> (MIT, © three.js authors): 3D graphics.</li>
      <li><a href="https://www.angusj.com" target="_blank" rel="noopener">Clipper</a> by Angus Johnson, JavaScript translation by Timo (Boost Software License 1.0): polygon operations.</li>
      <li>Heater measurements: <a href="https://3dprinterly.com/3d-printer-heated-bed-max-temperatures-real-examples/" target="_blank" rel="noopener">3DPrinterly</a>.</li>
    </ul>
    <p class="small"><b>Trademarks:</b> Prusa, Original Prusa, PrusaSlicer and Prusament are trademarks of Prusa Research a.s.; Creality and Ender are trademarks of Shenzhen Creality 3D Technology Co., Ltd.; other names belong to their owners. They are used only to identify printers and programs. Slicer Lab is <b>not affiliated with or endorsed by</b> these companies. The printers shown are simplified models made from basic shapes; no manufacturer drawings or logos are used.</p>
    <details><summary>Third-party notices and licence texts</summary><pre class="licence-text" id="about-third"></pre></details>
    <details><summary>GNU Affero General Public License v3</summary><pre class="licence-text" id="about-agpl"></pre></details>
    <p style="text-align:right"><button class="primary" id="about-close">Close</button></p>
  </div>`;
  const text = (id) => document.getElementById(id)?.textContent.trim() || 'See the source code repository.';
  $('about-third').textContent = text('licence-third-party');
  $('about-agpl').textContent = text('licence-agpl');
  modal.hidden = false;
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const close = () => {
    modal.hidden = true;
    window.removeEventListener('keydown', onKey);
  };
  window.addEventListener('keydown', onKey);
  $('about-close').onclick = close;
  modal.onclick = (e) => { if (e.target === modal) close(); };
  $('about-close').focus();
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'model';
}

window.app = new App();
