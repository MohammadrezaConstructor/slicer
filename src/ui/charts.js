// Small charts for the Preview panel (plain SVG/HTML, no library).
import { FEATURE_INFO } from '../core/features.js';
import { fmtTime } from './format.js';

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};

/**
 * Time per layer: one bar per layer (or an area for many layers), a dashed reference line at the
 * minimum layer time, the selected layer highlighted, hover tooltip, click to select.
 */
export class LayerTimeChart {
  constructor(root, onSelect) {
    this.root = root;
    this.onSelect = onSelect;
    this.tip = document.createElement('div');
    this.tip.className = 'chart-tip';
    this.tip.hidden = true;
  }

  setData(times, minLayerTime) {
    this.times = times;
    this.minLayerTime = minLayerTime;
    this.render();
  }

  render() {
    const times = this.times || [];
    const root = this.root;
    root.innerHTML = '';
    if (!times.length) return;
    const W = 300, H = 120, padL = 30, padB = 18, padT = 6;
    const max = Math.max(this.minLayerTime || 0, ...times) * 1.1 || 1;
    const n = times.length;
    const bw = (W - padL) / n;
    const y = (v) => padT + (H - padT - padB) * (1 - v / max);
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Time per layer' });
    const style = getComputedStyle(document.documentElement);
    const grid = style.getPropertyValue('--grid'), muted = style.getPropertyValue('--muted');
    // gridlines + y labels
    for (const v of [0, max / 2, max]) {
      svg.appendChild(el('line', { x1: padL, x2: W, y1: y(v), y2: y(v), stroke: grid, 'stroke-width': 1 }));
      const t = el('text', { x: padL - 4, y: y(v) + 3, 'text-anchor': 'end', 'font-size': 9, fill: muted });
      t.textContent = v >= 60 ? `${Math.round(v / 60)}m` : `${Math.round(v)}s`;
      svg.appendChild(t);
    }
    const color = '#2a78d6', sel = '#104281';
    if (bw >= 2.5) {
      const gap = bw > 6 ? 1 : 0;
      times.forEach((v, i) => {
        const h = Math.max(0.5, y(0) - y(v));
        const r = Math.min(3, (bw - gap) / 2);
        svg.appendChild(el('path', { d: roundedTop(padL + i * bw + gap / 2, y(0) - h, bw - gap, h, r), fill: i === this.selected ? sel : color, 'data-i': i }));
      });
    } else {
      let d = `M${padL},${y(0)}`;
      times.forEach((v, i) => (d += ` L${padL + i * bw},${y(v)} L${padL + (i + 1) * bw},${y(v)}`));
      d += ` L${W},${y(0)} Z`;
      svg.appendChild(el('path', { d, fill: color, opacity: 0.85 }));
      if (this.selected !== undefined) {
        const x = padL + (this.selected + 0.5) * bw;
        svg.appendChild(el('line', { x1: x, x2: x, y1: padT, y2: y(0), stroke: sel, 'stroke-width': 2 }));
      }
    }
    if (this.minLayerTime > 0) {
      svg.appendChild(el('line', { x1: padL, x2: W, y1: y(this.minLayerTime), y2: y(this.minLayerTime), stroke: '#d03b3b', 'stroke-dasharray': '4 3', 'stroke-width': 1.2 }));
      const t = el('text', { x: W, y: y(this.minLayerTime) - 3, 'text-anchor': 'end', 'font-size': 9, fill: muted });
      t.textContent = `minimum layer time ${this.minLayerTime}s`;
      svg.appendChild(t);
    }
    svg.appendChild(el('line', { x1: padL, x2: W, y1: y(0), y2: y(0), stroke: muted, 'stroke-width': 1 }));
    const lab = (x, txt, anchor) => {
      const t = el('text', { x, y: H - 4, 'text-anchor': anchor, 'font-size': 9, fill: muted });
      t.textContent = txt;
      svg.appendChild(t);
    };
    lab(padL, 'layer 1', 'start');
    lab(W, `layer ${n}`, 'end');
    // invisible hit area for hover & click (bigger than the bars)
    const hit = el('rect', { x: padL, y: 0, width: W - padL, height: H, fill: 'transparent', style: 'cursor:pointer' });
    const idxAt = (ev) => {
      const r = svg.getBoundingClientRect();
      const fx = ((ev.clientX - r.left) / r.width) * W;
      return Math.max(0, Math.min(n - 1, Math.floor((fx - padL) / bw)));
    };
    hit.addEventListener('mousemove', (ev) => {
      const i = idxAt(ev);
      const r = svg.getBoundingClientRect(), pr = root.getBoundingClientRect();
      this.tip.hidden = false;
      this.tip.textContent = `Layer ${i + 1}: ${fmtTime(times[i])}`;
      this.tip.style.left = `${ev.clientX - pr.left}px`;
      this.tip.style.top = `${(y(times[i]) / H) * r.height}px`;
    });
    hit.addEventListener('mouseleave', () => (this.tip.hidden = true));
    hit.addEventListener('click', (ev) => this.onSelect(idxAt(ev)));
    svg.appendChild(hit);
    root.appendChild(svg);
    root.appendChild(this.tip);
  }

  select(i) {
    if (this.selected === i) return;
    this.selected = i;
    if (!this.times) return;
    const bars = this.root.querySelectorAll('path[data-i]');
    if (bars.length) bars.forEach((b) => b.setAttribute('fill', +b.dataset.i === i ? '#104281' : '#2a78d6'));
    else this.render();
  }
}

function roundedTop(x, y, w, h, r) {
  r = Math.min(r, h);
  return `M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h} Z`;
}

/** Horizontal bars: share of print time and of filament per feature type. */
export function renderFeatureBars(root, stats, filamentToGrams) {
  const rows = FEATURE_INFO.filter((f) => stats.timeByType[f.code] > 0 || stats.filamentByType[f.code] > 0);
  const totalT = rows.reduce((s, f) => s + stats.timeByType[f.code], 0) || 1;
  const totalF = rows.reduce((s, f) => s + Math.max(0, stats.filamentByType[f.code]), 0) || 1;
  const block = (title, val, total, fmt) => {
    const sorted = rows.slice().sort((a, b) => val(b) - val(a));
    return `<h4>${title}</h4>` + sorted.map((f) => {
      const v = val(f);
      return `<div class="bar-row" title="${f.label}: ${fmt(v)} (${Math.round((v / total) * 100)}%)">
        <span>${f.label}</span>
        <div class="track"><div class="fill" style="width:${(v / total) * 100}%;background:${f.color}"></div></div>
        <span class="val">${Math.round((v / total) * 100)}%</span></div>`;
    }).join('');
  };
  root.className = 'bars';
  root.innerHTML =
    block('Printing time', (f) => stats.timeByType[f.code], totalT, fmtTime) +
    block('Plastic', (f) => Math.max(0, stats.filamentByType[f.code]), totalF, (v) => `${filamentToGrams(v).toFixed(1)} g`) +
    `<p class="muted small">Travel moves, heating and waiting take the remaining ${fmtTime(Math.max(0, stats.time - totalT))}.</p>`;
}
