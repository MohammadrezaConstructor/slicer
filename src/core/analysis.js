// "Physics-lite" analysis: is every extruded line resting on something?
//
// We rasterise each printed layer into an occupancy grid. For every line of the next layer we
// measure how far it is from material in the layer below. A line may stick out about half a
// line width (that is why ~45–60° overhangs still work); beyond that it is printed over air.
// Lines over air sag: cantilevers a lot, bridges (supported at both ends) only a little.
import { KIND } from './gcodeParser.js';

const SAMPLE = 0.5; // mm between sag samples along a line
const LONG_BRIDGE = 10; // mm; longer bridges are reported

export function analyzeSupport(P) {
  const n = P.n;
  const overAir = new Float32Array(n); // max distance beyond allowance (mm), 0 = fine
  const isBridge = new Uint8Array(n); // 1 = supported at both ends
  const sagStart = new Int32Array(n).fill(-1); // index into sagValues for moves that sag
  const sagCount = new Uint16Array(n);
  const sagValues = [];
  const result = {
    overAir, isBridge, sagStart, sagCount, sagValues: null,
    overAirLength: 0, // cantilever length printed over air (needs support)
    longBridgeLength: 0, // bridges spanning more than LONG_BRIDGE
    overAirLayers: [], badLayers: 0,
  };
  if (!n) { result.sagValues = new Float32Array(0); return result; }

  // grid over the extrusion bounding box
  const { min, max } = P.stats;
  if (!isFinite(min[0])) { result.sagValues = new Float32Array(0); return result; }
  const margin = 2;
  const x0 = min[0] - margin, y0 = min[1] - margin;
  const area = (max[0] - min[0] + 2 * margin) * (max[1] - min[1] + 2 * margin);
  const cell = Math.max(0.2, Math.sqrt(area / 2.5e6));
  const gw = Math.ceil((max[0] - min[0] + 2 * margin) / cell) + 1;
  const gh = Math.ceil((max[1] - min[1] + 2 * margin) / cell) + 1;
  // occupancy of the two layers below (two, so that support with a one-layer Z gap still counts)
  let below2 = new Uint8Array(gw * gh);
  let below1 = new Uint8Array(gw * gh);
  let cur = new Uint8Array(gw * gh);
  // material in the current layer that can anchor the end of a bridge (supported lines and bridges)
  const anchor = new Uint8Array(gw * gh);
  const dist = new Float32Array(gw * gh);
  let distReady = false;

  const gx = (x) => Math.floor((x - x0) / cell);
  const gy = (y) => Math.floor((y - y0) / cell);

  const stamp = (grid, ax, ay, bx, by, w) => {
    const len = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(1, Math.ceil(len / (cell * 0.5)));
    const r = Math.max(1, Math.round(w / 2 / cell));
    for (let s = 0; s <= steps; s++) {
      const cx = gx(ax + ((bx - ax) * s) / steps), cy = gy(ay + ((by - ay) * s) / steps);
      for (let dy = -r; dy <= r; dy++) {
        const yy = cy + dy;
        if (yy < 0 || yy >= gh) continue;
        for (let dx = -r; dx <= r; dx++) {
          const xx = cx + dx;
          if (xx < 0 || xx >= gw || dx * dx + dy * dy > r * r + r) continue;
          grid[yy * gw + xx] = 1;
        }
      }
    }
  };

  // Chamfer distance transform (in cells) of the occupancy below.
  const computeDist = () => {
    const INF = 1e9, D1 = 1, D2 = Math.SQRT2;
    for (let i = 0; i < dist.length; i++) dist[i] = below1[i] | below2[i] ? 0 : INF;
    for (let y = 0; y < gh; y++)
      for (let x = 0; x < gw; x++) {
        const i = y * gw + x;
        let d = dist[i];
        if (d === 0) continue;
        if (x > 0) d = Math.min(d, dist[i - 1] + D1);
        if (y > 0) {
          d = Math.min(d, dist[i - gw] + D1);
          if (x > 0) d = Math.min(d, dist[i - gw - 1] + D2);
          if (x < gw - 1) d = Math.min(d, dist[i - gw + 1] + D2);
        }
        dist[i] = d;
      }
    for (let y = gh - 1; y >= 0; y--)
      for (let x = gw - 1; x >= 0; x--) {
        const i = y * gw + x;
        let d = dist[i];
        if (d === 0) continue;
        if (x < gw - 1) d = Math.min(d, dist[i + 1] + D1);
        if (y < gh - 1) {
          d = Math.min(d, dist[i + gw] + D1);
          if (x < gw - 1) d = Math.min(d, dist[i + gw + 1] + D2);
          if (x > 0) d = Math.min(d, dist[i + gw - 1] + D2);
        }
        dist[i] = d;
      }
    distReady = true;
  };
  const distAt = (x, y) => {
    const cx = gx(x), cy = gy(y);
    if (cx < 0 || cy < 0 || cx >= gw || cy >= gh) return 50;
    return Math.min(50, dist[cy * gw + cx] * cell);
  };
  const near = (x, y, r, test) => {
    const cx = gx(x), cy = gy(y), rr = Math.ceil(r / cell);
    for (let dy = -rr; dy <= rr; dy++)
      for (let dx = -rr; dx <= rr; dx++) {
        const xx = cx + dx, yy = cy + dy;
        if (xx >= 0 && yy >= 0 && xx < gw && yy < gh && test(yy * gw + xx)) return true;
      }
    return false;
  };
  const occupiedNear = (x, y, r) => near(x, y, r, (i) => below1[i] | below2[i]);
  const anchoredNear = (x, y, r) => near(x, y, r, (i) => anchor[i]);

  const L = P.layers;
  for (let li = 0; li < L.length; li++) {
    const first = L[li].first;
    const last = li + 1 < L.length ? L[li + 1].first : n;
    distReady = false;
    let layerBad = false;
    for (let m = first; m < last; m++) {
      if (P.kind[m] !== KIND.EXTRUDE) continue;
      const ax = P.px[m], ay = P.py[m], bx = P.px[m + 1], by = P.py[m + 1];
      const w = P.width[m] || 0.4;
      if (li > 0) {
        // A line may stick out ~1/4 line width past the line below (≈ the 55–60° overhang limit).
        const allow = w * 0.25;
        const len = Math.hypot(bx - ax, by - ay);
        const ns = Math.max(1, Math.ceil(len / SAMPLE));
        // quick test: all samples have material close below?
        let ok = true;
        for (let s = 0; s <= ns && ok; s++) ok = occupiedNear(ax + ((bx - ax) * s) / ns, ay + ((by - ay) * s) / ns, allow);
        if (!ok) {
          if (!distReady) computeDist();
          const ds = new Float32Array(ns + 1);
          let worst = 0;
          for (let s = 0; s <= ns; s++) {
            ds[s] = Math.max(0, distAt(ax + ((bx - ax) * s) / ns, ay + ((by - ay) * s) / ns) - allow);
            worst = Math.max(worst, ds[s]);
          }
          // the ends of a line may also rest on supported lines printed earlier in this layer
          if (ds[0] > 0 && anchoredNear(ax, ay, allow)) ds[0] = 0;
          if (ds[ns] > 0 && anchoredNear(bx, by, allow)) ds[ns] = 0;
          if (worst > 0.05) {
            overAir[m] = worst;
            // Three cases:
            //  overhang line: runs along an overhanging edge, partly unsupported over its whole length → curls down
            //  bridge: spans a gap, both ends rest on something → sags a little in the middle
            //  cantilever: sticks out into the air → droops a lot
            let unsupported = 0;
            for (let s = 0; s <= ns; s++) if (ds[s] > 0) unsupported++;
            const overhangLine = worst < 1.5 * w && unsupported > 0.8 * (ns + 1);
            const bridge = !overhangLine && ds[0] === 0 && ds[ns] === 0;
            isBridge[m] = bridge ? 1 : 0;
            if (!bridge) {
              result.overAirLength += len * Math.min(1, worst / 0.5);
              layerBad = true;
            } else if (worst > LONG_BRIDGE / 2) result.longBridgeLength += len;
            sagStart[m] = sagValues.length;
            sagCount[m] = ns + 1;
            const z = P.pz[m + 1];
            for (let s = 0; s <= ns; s++) {
              const sag = bridge ? Math.min(0.8, ds[s] * 0.1) : ds[s] > 0 ? Math.min(4, 0.3 + ds[s] * 1.5) : 0;
              sagValues.push(Math.min(sag, Math.max(0, z - 0.05)));
            }
          }
        }
      }
      stamp(cur, ax, ay, bx, by, w);
      if (!overAir[m] || isBridge[m]) stamp(anchor, ax, ay, bx, by, w);
    }
    if (layerBad) result.overAirLayers.push(li);
    // next layer rests on this one
    const tmp = below2; below2 = below1; below1 = cur; cur = tmp;
    cur.fill(0);
    anchor.fill(0);
  }
  result.badLayers = result.overAirLayers.length;
  result.sagValues = Float32Array.from(sagValues);
  return result;
}
