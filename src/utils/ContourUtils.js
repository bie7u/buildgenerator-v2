/**
 * Rounds the corners of a polygon using quadratic Bezier arcs.
 * Returns an array of plain {x, y} objects (no THREE dependency).
 *
 * Each corner is replaced by `segments+1` arc points, so the result polygon
 * has N*(segments+1) vertices for an N-vertex input.
 *
 * @param {Array<{x:number, y:number}>} pts - original contour vertices
 * @param {number} radius  - corner rounding radius in metres (0 = no rounding)
 * @param {number} segments - arc subdivisions per corner (default 6)
 * @returns {Array<{x:number, y:number}>}
 */
export function roundContour(pts, radius, segments = 6) {
  if (radius <= 0 || pts.length < 3) return pts.map(p => ({ x: p.x, y: p.y }));

  const n = pts.length;
  const result = [];

  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n];
    const curr = pts[i];
    const next = pts[(i + 1) % n];

    const d1x = prev.x - curr.x, d1y = prev.y - curr.y;
    const len1 = Math.sqrt(d1x * d1x + d1y * d1y);
    const d2x = next.x - curr.x, d2y = next.y - curr.y;
    const len2 = Math.sqrt(d2x * d2x + d2y * d2y);

    if (len1 < 0.001 || len2 < 0.001) {
      result.push({ x: curr.x, y: curr.y });
      continue;
    }

    // Clamp radius so tangent points don't exceed 45% of either edge length.
    const r = Math.min(radius, len1 * 0.45, len2 * 0.45);

    // Tangent points (where the arc meets each adjacent edge).
    const tp1x = curr.x + (d1x / len1) * r;
    const tp1y = curr.y + (d1y / len1) * r;
    const tp2x = curr.x + (d2x / len2) * r;
    const tp2y = curr.y + (d2y / len2) * r;

    // Quadratic Bezier from tp1 → tp2 with control point = curr.
    for (let j = 0; j <= segments; j++) {
      const t  = j / segments;
      const mt = 1 - t;
      result.push({
        x: mt * mt * tp1x + 2 * mt * t * curr.x + t * t * tp2x,
        y: mt * mt * tp1y + 2 * mt * t * curr.y + t * t * tp2y,
      });
    }
  }

  return result;
}

/**
 * Expands a contour with optional per-edge quadratic Bézier curves into a
 * polyline of straight segments, suitable for rendering and 3D generation.
 *
 * For edge i (from contour[i] to contour[(i+1)%n]):
 *   - curves[i] == null  → straight segment (only the start vertex is added)
 *   - curves[i] == {x,y} → quadratic Bézier with that control point;
 *                           `segments-1` intermediate waypoints are inserted
 *
 * @param {Array<{x:number, y:number}>} contour - original polygon vertices
 * @param {Array<null|{x:number,y:number}>} curves - control points (same length as contour)
 * @param {number} segments - Bézier subdivisions per curved edge (default 12)
 * @returns {Array<{x:number, y:number}>}
 */
export function expandCurvedContour(contour, curves, segments = 12) {
  const n = contour.length;
  if (n < 2) return contour.map(p => ({ x: p.x, y: p.y }));
  if (!curves || curves.length === 0 || curves.every(c => !c)) {
    return contour.map(p => ({ x: p.x, y: p.y }));
  }

  const result = [];
  for (let i = 0; i < n; i++) {
    const p0 = contour[i];
    const cp = curves[i];
    result.push({ x: p0.x, y: p0.y });
    if (cp) {
      const p1 = contour[(i + 1) % n];
      for (let j = 1; j < segments; j++) {
        const t = j / segments;
        const mt = 1 - t;
        result.push({
          x: mt * mt * p0.x + 2 * mt * t * cp.x + t * t * p1.x,
          y: mt * mt * p0.y + 2 * mt * t * cp.y + t * t * p1.y,
        });
      }
    }
  }
  return result;
}

/**
 * Returns the trim distance at each corner vertex for rounded walls.
 * Each value is the distance along both adjacent edges where the arc begins/ends.
 *
 * @param {Array<{x:number, y:number}>} pts
 * @param {number} radius
 * @returns {number[]}  one entry per vertex
 */
export function getCornerTrims(pts, radius) {
  if (radius <= 0) return pts.map(() => 0);
  const n = pts.length;
  return pts.map((curr, i) => {
    const prev = pts[(i - 1 + n) % n];
    const next = pts[(i + 1) % n];
    const d1x = prev.x - curr.x, d1y = prev.y - curr.y;
    const len1 = Math.sqrt(d1x * d1x + d1y * d1y);
    const d2x = next.x - curr.x, d2y = next.y - curr.y;
    const len2 = Math.sqrt(d2x * d2x + d2y * d2y);
    if (len1 < 0.001 || len2 < 0.001) return 0;
    return Math.min(radius, len1 * 0.45, len2 * 0.45);
  });
}

/**
 * Evaluate a quadratic Bézier curve at parameter `t` ∈ [0, 1].
 * Returns a plain `{x, y}` point.
 *
 * @param {{x:number,y:number}} p0 - start point
 * @param {{x:number,y:number}} cp - control point
 * @param {{x:number,y:number}} p1 - end point
 * @param {number} t
 * @returns {{x:number, y:number}}
 */
export function bezierAt(p0, cp, p1, t) {
  const mt = 1 - t;
  return {
    x: mt * mt * p0.x + 2 * mt * t * cp.x + t * t * p1.x,
    y: mt * mt * p0.y + 2 * mt * t * cp.y + t * t * p1.y,
  };
}

/**
 * Evaluate the normalised tangent direction of a quadratic Bézier at parameter `t`.
 * Returns a plain `{x, y}` unit vector, or `{x:1, y:0}` for degenerate curves.
 *
 * @param {{x:number,y:number}} p0
 * @param {{x:number,y:number}} cp
 * @param {{x:number,y:number}} p1
 * @param {number} t
 * @returns {{x:number, y:number}}
 */
export function bezierTangent(p0, cp, p1, t) {
  const dtx = 2 * (1 - t) * (cp.x - p0.x) + 2 * t * (p1.x - cp.x);
  const dty = 2 * (1 - t) * (cp.y - p0.y) + 2 * t * (p1.y - cp.y);
  const len = Math.sqrt(dtx * dtx + dty * dty);
  if (len < 1e-9) return { x: 1, y: 0 };
  return { x: dtx / len, y: dty / len };
}
