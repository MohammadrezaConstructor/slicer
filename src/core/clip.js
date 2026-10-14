// Thin wrapper around the Clipper polygon library.
// Clipper works with integer coordinates, so millimetres are multiplied by SCALE (1 unit = 1 µm).
// A "region" is an array of closed paths; outer contours run counter-clockwise, holes clockwise.
import ClipperLib from 'clipper-lib';

const C = ClipperLib;
export const SCALE = 1000;

const JOIN = { miter: C.JoinType.jtMiter, round: C.JoinType.jtRound, square: C.JoinType.jtSquare };

/** Grow (delta > 0) or shrink (delta < 0) a region by `delta` millimetres. */
export function offset(paths, delta, join = 'miter') {
  if (!paths.length) return [];
  const co = new C.ClipperOffset(2, 0.01 * SCALE);
  co.AddPaths(paths, JOIN[join], C.EndType.etClosedPolygon);
  const out = new C.Paths();
  co.Execute(out, delta * SCALE);
  return out;
}

function boolOp(type, a, b, fill = C.PolyFillType.pftNonZero) {
  const c = new C.Clipper();
  if (a.length) c.AddPaths(a, C.PolyType.ptSubject, true);
  if (b && b.length) c.AddPaths(b, C.PolyType.ptClip, true);
  const out = new C.Paths();
  c.Execute(type, out, fill, fill);
  return out;
}

export const union = (a, b = []) => (a.length || b.length ? boolOp(C.ClipType.ctUnion, a, b) : []);
export const difference = (a, b) => (!a.length ? [] : !b.length ? a : boolOp(C.ClipType.ctDifference, a, b));
export const intersection = (a, b) => (!a.length || !b.length ? [] : boolOp(C.ClipType.ctIntersection, a, b));

/** Union that returns a tree, so we can find islands (an outer contour plus its holes). */
export function islands(paths) {
  const c = new C.Clipper();
  c.AddPaths(paths, C.PolyType.ptSubject, true);
  const tree = new C.PolyTree();
  c.Execute(C.ClipType.ctUnion, tree, C.PolyFillType.pftNonZero, C.PolyFillType.pftNonZero);
  const result = [];
  const visit = (node) => {
    for (const child of node.Childs()) {
      // child is an outer contour; its children are holes; holes' children are new islands.
      const island = [child.Contour()];
      for (const hole of child.Childs()) {
        island.push(hole.Contour());
        visit(hole);
      }
      result.push(island);
    }
  };
  visit(tree);
  return result;
}

/** Clip open polylines (e.g. infill lines) by a region; returns the pieces that lie inside. */
export function clipLines(lines, region) {
  if (!lines.length || !region.length) return [];
  const c = new C.Clipper();
  c.AddPaths(lines, C.PolyType.ptSubject, false);
  c.AddPaths(region, C.PolyType.ptClip, true);
  const tree = new C.PolyTree();
  c.Execute(C.ClipType.ctIntersection, tree, C.PolyFillType.pftNonZero, C.PolyFillType.pftNonZero);
  return C.Clipper.OpenPathsFromPolyTree(tree);
}

/** Area in mm² (holes count negative). */
export function area(paths) {
  let a = 0;
  for (const p of paths) a += C.Clipper.Area(p);
  return a / (SCALE * SCALE);
}

/** Remove tiny islands/holes and vertices closer than `dist` mm. */
export function clean(paths, dist = 0.005) {
  return C.Clipper.CleanPolygons(paths, dist * SCALE).filter((p) => p.length >= 3);
}

/** Drop pieces whose absolute area is below minArea (mm²). Use only where losing holes is fine. */
export function dropSmall(paths, minArea) {
  const lim = minArea * SCALE * SCALE;
  return paths.filter((p) => Math.abs(C.Clipper.Area(p)) >= lim);
}

/** Morphological opening: removes features narrower than 2·r. */
export function opening(paths, r) {
  return offset(offset(paths, -r), r);
}

export function pathsBounds(paths) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of paths)
    for (const pt of p) {
      if (pt.X < minX) minX = pt.X;
      if (pt.Y < minY) minY = pt.Y;
      if (pt.X > maxX) maxX = pt.X;
      if (pt.Y > maxY) maxY = pt.Y;
    }
  return { minX, minY, maxX, maxY };
}

/** Convert a Clipper path to a flat Float64Array [x0,y0,x1,y1,...] in mm. */
export function toFloat(path) {
  const out = new Float64Array(path.length * 2);
  for (let i = 0; i < path.length; i++) {
    out[i * 2] = path[i].X / SCALE;
    out[i * 2 + 1] = path[i].Y / SCALE;
  }
  return out;
}

export function fromXY(xy) {
  const out = [];
  for (let i = 0; i < xy.length; i += 2) out.push({ X: Math.round(xy[i] * SCALE), Y: Math.round(xy[i + 1] * SCALE) });
  return out;
}

export function isOuter(path) {
  return C.Clipper.Orientation(path);
}
