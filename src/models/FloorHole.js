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
