// The settings form, generated from the schema. Every setting has an "i" button with its explanation.
import { GROUPS, SCHEMA, MATERIALS, QUALITY_PRESETS, PRINTERS, defaultSettings } from '../core/settings.js';

const OPEN_BY_DEFAULT = new Set(['quality', 'walls', 'infill', 'support']);

export class SettingsPanel {
  constructor(root, settings, onChange) {
    this.root = root;
    this.settings = settings;
    this.onChange = onChange; // (changes: object) => void
    this.level = 'basic';
    try { this.level = localStorage.getItem('slicerlab.level') || 'basic'; } catch { /* storage unavailable */ }
    this.inputs = {};
    this.build();
  }

  build() {
    const r = this.root;
    r.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'settings-head';
    head.innerHTML = `
      <h2>Slicer settings</h2>
      <div class="preset-row">
        <select id="preset-printer" aria-label="Printer">${Object.entries(PRINTERS).map(([k, p]) => `<option value="${k}">${p.label}</option>`).join('')}<option value="custom">Custom printer</option></select>
        <select id="preset-quality" aria-label="Quality preset">${Object.entries(QUALITY_PRESETS).map(([k, p]) => `<option value="${k}">${p.label}</option>`).join('')}<option value="custom">Custom quality</option></select>
      </div>
      <div class="seg" role="group" aria-label="Detail level">
        <button data-level="basic">Beginner</button><button data-level="expert">All settings</button><button data-reset title="Restore all defaults">Reset</button>
      </div>`;
    r.appendChild(head);
    head.querySelector('#preset-printer').addEventListener('change', (e) => {
      if (PRINTERS[e.target.value]) this.emit({ ...PRINTERS[e.target.value], label: undefined });
    });
    head.querySelector('#preset-quality').addEventListener('change', (e) => {
      if (QUALITY_PRESETS[e.target.value]) this.emit({ ...QUALITY_PRESETS[e.target.value], label: undefined });
    });
    head.querySelectorAll('[data-level]').forEach((b) =>
      b.addEventListener('click', () => {
        this.level = b.dataset.level;
        try { localStorage.setItem('slicerlab.level', this.level); } catch { /* ignore */ }
        this.applyLevel();
      }),
    );
    head.querySelector('[data-reset]').addEventListener('click', () => this.emit(defaultSettings()));

    for (const g of GROUPS) {
      const det = document.createElement('details');
      det.className = 'group';
      det.dataset.group = g.id;
      det.open = OPEN_BY_DEFAULT.has(g.id);
      det.innerHTML = `<summary>${g.label}</summary><div class="items"></div>`;
      const items = det.querySelector('.items');
      for (const s of SCHEMA.filter((x) => x.group === g.id)) items.appendChild(this.row(s));
      r.appendChild(det);
    }
    this.applyLevel();
    this.refresh();
  }

  row(s) {
    const div = document.createElement('div');
    div.className = 'setting';
    div.dataset.level = s.level;
    div.dataset.key = s.key;
    const id = 'set-' + s.key;
    let input;
    if (s.type === 'select') {
      input = `<select id="${id}">${s.options.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>`;
    } else if (s.type === 'bool') {
      input = `<input type="checkbox" id="${id}" />`;
    } else {
      input = `<input type="number" id="${id}" min="${s.min}" max="${s.max}" step="${s.step}" />`;
    }
    div.innerHTML = `
      <div class="line">
        <label for="${id}">${s.label}</label>${input}<span class="unit">${s.unit || ''}</span>
        <button class="info-btn" aria-label="What is ${s.label}?" aria-expanded="false">i</button>
      </div>
      <div class="help" hidden>${s.help}</div>`;
    const el = div.querySelector('#' + id);
    this.inputs[s.key] = el;
    const info = div.querySelector('.info-btn');
    const help = div.querySelector('.help');
    info.addEventListener('click', () => {
      help.hidden = !help.hidden;
      info.setAttribute('aria-expanded', String(!help.hidden));
    });
    el.addEventListener('change', () => {
      let v;
      if (s.type === 'bool') v = el.checked;
      else if (s.type === 'select') v = el.value;
      else {
        v = parseFloat(el.value);
        if (!isFinite(v)) { this.refresh(); return; }
        v = Math.max(s.min, Math.min(s.max, v));
      }
      const changes = { [s.key]: v };
      if (s.key === 'material' && MATERIALS[v]) Object.assign(changes, MATERIALS[v]);
      if (s.key === 'nozzle') changes.lineWidth = Math.round(v * 1.05 * 100) / 100;
      this.emit(changes);
    });
    return div;
  }

  emit(changes) {
    const clean = {};
    for (const [k, v] of Object.entries(changes)) if (v !== undefined && k in this.settings) clean[k] = v;
    this.onChange(clean);
  }

  applyLevel() {
    this.root.querySelectorAll('[data-level]').forEach((b) => {
      if (b.tagName === 'BUTTON') b.classList.toggle('on', b.dataset.level === this.level);
    });
    this.root.querySelectorAll('.setting').forEach((d) => {
      d.hidden = this.level === 'basic' && d.dataset.level === 'expert';
    });
    this.root.querySelectorAll('.group').forEach((g) => {
      g.hidden = ![...g.querySelectorAll('.setting')].some((d) => !d.hidden);
    });
  }

  /** Sync the form with the current settings (after presets, lessons, resets). */
  refresh() {
    const S = this.settings;
    const defs = defaultSettings();
    for (const s of SCHEMA) {
      const el = this.inputs[s.key];
      if (!el) continue;
      if (s.type === 'bool') el.checked = !!S[s.key];
      else el.value = S[s.key];
      el.closest('.setting').classList.toggle('changed', S[s.key] !== defs[s.key]);
    }
    const match = (preset) => Object.entries(preset).every(([k, v]) => k === 'label' || S[k] === v);
    const pp = Object.entries(PRINTERS).find(([, p]) => match(p));
    this.root.querySelector('#preset-printer').value = pp ? pp[0] : 'custom';
    const qp = Object.entries(QUALITY_PRESETS).find(([, p]) => match(p));
    this.root.querySelector('#preset-quality').value = qp ? qp[0] : 'custom';
  }

  /** Open a setting's group and flash it (used by lessons). */
  highlight(key) {
    const row = this.root.querySelector(`.setting[data-key="${key}"]`);
    if (!row) return;
    if (row.hidden) {
      this.level = 'expert';
      this.applyLevel();
    }
    row.closest('details').open = true;
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    row.animate([{ background: 'var(--accent-soft)' }, { background: 'transparent' }], { duration: 1600 });
  }
}
