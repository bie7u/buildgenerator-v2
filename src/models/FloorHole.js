import * as THREE from 'three';
export class FloorHole {
  constructor(points) {
    this.points = points.map(p => p.clone());
  }

  get position() {
    const n = this.points.length;
    if (n === 0) return new THREE.Vector2();
    return new THREE.Vector2(
      this.points.reduce((s, p) => s + p.x, 0) / n,
      this.points.reduce((s, p) => s + p.y, 0) / n
    );
  }

  get radius() {
    const c = this.position;
    return Math.max(...this.points.map(p => p.distanceTo(c)));
  }

  translate(dx, dy) {
    for (const p of this.points) { p.x += dx; p.y += dy; }
  }

  toJSON() {
    return { points: this.points.map(p => ({ x: p.x, y: p.y })) };
  }

  /**
   * Normalize the hole's point winding so that the polygon has positive
   * signed area in world-space (CCW in standard math coords, x-right y-up).
   *
   * THREE.js ShapeGeometry/ExtrudeGeometry expects hole paths to be CW in
   * shape space where shape_y = -world_z.  Negating y flips the sign of
   * the area, so a positive world-space area becomes a negative (CW)
   * shape-space area — exactly what THREE.js needs for a hole path.
   */
  normalizeWorldWindingCCW() {
    const pts = this.points;
    let area = 0;
    for (let j = 0; j < pts.length; j++) {
      const k = (j + 1) % pts.length;
      area += pts[j].x * pts[k].y - pts[k].x * pts[j].y;
    }
    if (area < 0) pts.reverse();
  }

  static fromJSON(d) {
    if (d.position && d.width !== undefined) {
      const hw = d.width / 2, hd = d.depth / 2;
      const cx = d.position.x, cy = d.position.y;
      return new FloorHole([
        new THREE.Vector2(cx - hw, cy - hd),
        new THREE.Vector2(cx + hw, cy - hd),
        new THREE.Vector2(cx + hw, cy + hd),
        new THREE.Vector2(cx - hw, cy + hd),
      ]);
    }
    return new FloorHole(d.points.map(p => new THREE.Vector2(p.x, p.y)));
  }
}
