// 2D top-down drawing of one layer: outline, lost thin areas, support area, and every move in order.
// Students can step through the moves to see the order in which the nozzle visits everything.
import { KIND } from '../core/gcodeParser.js';
import { FEATURE_INFO } from '../core/features.js';

export class LayerInspector {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.P = null;
  }

  setData(P, meta) {
    this.P = P;
    this.meta = meta;
    if (!P) return;
    const { min, max } = P.stats;
    const pad = 3;
    this.bounds = isFinite(min[0]) ? [min[0] - pad, min[1] - pad, max[0] + pad, max[1] + pad] : [0, 0, 100, 100];
  }

  layerRange(li) {
    const L = this.P.layers;
    return [L[li].first, li + 1 < L.length ? L[li + 1].first : this.P.n];
  }

  /** Draw layer `li`, showing moves up to `step` (count of moves from the layer start). */
  draw(li, step = Infinity) {
    const P = this.P;
    const c = this.canvas, ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    const cssW = c.clientWidth || 300;
    if (c.width !== Math.round(cssW * dpr)) {
      c.width = Math.round(cssW * dpr);
      c.height = Math.round(cssW * dpr);
    }
    const W = c.width, H = c.height;
    const style = getComputedStyle(document.documentElement);
    ctx.clearRect(0, 0, W, H);
    if (!P || !P.layers[li]) return null;

    const [x0, y0, x1, y1] = this.bounds;
    const scale = Math.min(W / (x1 - x0), H / (y1 - y0));
    const ox = (W - (x1 - x0) * scale) / 2, oy = (H - (y1 - y0) * scale) / 2;
    const X = (x) => ox + (x - x0) * scale;
    const Y = (y) => H - (oy + (y - y0) * scale); // Y up, like the printer bed

    // grid
    const gstep = scale * 10 > 40 * dpr ? (scale > 40 * dpr ? 1 : 5) : 10;
    ctx.strokeStyle = style.getPropertyValue('--grid');
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let gx = Math.ceil(x0 / gstep) * gstep; gx <= x1; gx += gstep) { ctx.moveTo(X(gx), 0); ctx.lineTo(X(gx), H); }
    for (let gy = Math.ceil(y0 / gstep) * gstep; gy <= y1; gy += gstep) { ctx.moveTo(0, Y(gy)); ctx.lineTo(W, Y(gy)); }
    ctx.stroke();

    const fillLoops = (loops, color, hatch) => {
      if (!loops || !loops.length) return;
      ctx.beginPath();
      for (const L of loops) {
        ctx.moveTo(X(L[0]), Y(L[1]));
        for (let i = 2; i < L.length; i += 2) ctx.lineTo(X(L[i]), Y(L[i + 1]));
        ctx.closePath();
      }
      ctx.fillStyle = color;
      ctx.fill('evenodd');
      if (hatch) {
        ctx.save();
        ctx.clip('evenodd');
        ctx.strokeStyle = hatch;
        ctx.lineWidth = 1.5 * dpr;
        ctx.beginPath();
        for (let d = -H; d < W; d += 6 * dpr) { ctx.moveTo(d, H); ctx.lineTo(d + H, 0); }
        ctx.stroke();
        ctx.restore();
      }
    };
    if (this.meta) {
      fillLoops(this.meta.outlines[li], 'rgba(137,135,129,0.22)');
      fillLoops(this.meta.support[li], 'rgba(232,123,164,0.15)');
      fillLoops(this.meta.lost[li], 'rgba(208,59,59,0.25)', 'rgba(208,59,59,0.8)');
    }

    const [m0, m1] = this.layerRange(li);
    const end = Math.min(m1, m0 + step);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    let lastType = -1;
    for (let m = m0; m < end; m++) {
      const k = P.kind[m];
      const ax = X(P.px[m]), ay = Y(P.py[m]), bx = X(P.px[m + 1]), by = Y(P.py[m + 1]);
      if (k === KIND.EXTRUDE) {
        ctx.setLineDash([]);
        ctx.strokeStyle = FEATURE_INFO[P.type[m]]?.color || '#888';
        ctx.lineWidth = Math.max(1, (P.width[m] || 0.4) * scale * 0.85);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
        // mark where each wall loop starts: the seam
        if (P.type[m] === 1 && (m === m0 || P.kind[m - 1] !== KIND.EXTRUDE || lastType !== 1)) {
          ctx.fillStyle = style.getPropertyValue('--text');
          ctx.beginPath();
          ctx.arc(ax, ay, 2.5 * dpr, 0, 7);
          ctx.fill();
        }
        lastType = P.type[m];
      } else if (k === KIND.TRAVEL && (ax !== bx || ay !== by)) {
        ctx.setLineDash([4 * dpr, 4 * dpr]);
        ctx.strokeStyle = 'rgba(91,141,239,0.75)';
        ctx.lineWidth = 1 * dpr;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
        lastType = -1;
      } else if (k === KIND.RETRACT && P.e[m] < 0) {
        ctx.setLineDash([]);
        ctx.strokeStyle = '#6250d6';
        ctx.lineWidth = 1.5 * dpr;
        ctx.beginPath();
        ctx.arc(bx, by, 4 * dpr, 0, 7);
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);
    // nozzle position
    if (end > m0) {
      const nx = X(P.px[end]), ny = Y(P.py[end]);
      ctx.fillStyle = '#d03b3b';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      ctx.arc(nx, ny, 5 * dpr, 0, 7);
      ctx.fill();
      ctx.stroke();
    }
    // scale bar
    ctx.fillStyle = style.getPropertyValue('--text-2');
    ctx.font = `${11 * dpr}px system-ui, sans-serif`;
    const bar = gstep * scale;
    ctx.fillRect(10 * dpr, H - 14 * dpr, bar, 2 * dpr);
    ctx.fillText(`${gstep} mm`, 10 * dpr, H - 18 * dpr);
    return { m0, m1, end };
  }
}
