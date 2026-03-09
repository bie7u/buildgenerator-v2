import * as THREE from 'three';
import { Floor } from './Floor.js';
import { Roof } from './Roof.js';

export class Building {
  constructor() {
    this.contour = [];           // THREE.Vector2[] - XZ floor plan coordinates
    this.contourCurves = [];     // Array<null|THREE.Vector2> – per-edge Bézier control points
    this.wallThickness = 0.2;    // metres
    this.cornerRadius = 0;       // metres – corner rounding radius (0 = sharp corners)
    this.floors = [new Floor(0, 2.7)];
    this.roof = new Roof();
  }

  addFloor() {
    const idx = this.floors.length;
    this.floors.push(new Floor(idx, 2.7));
  }

  removeFloor() {
    if (this.floors.length > 1) {
      this.floors.pop();
    }
  }

  getFloor(index) {
    return this.floors[index] || null;
  }

  /**
   * Returns the contour that applies for the given floor index.
   * Floor 0 always uses building.contour.
   * Floor N>0 uses its own contour if it has one, otherwise falls back to building.contour.
   */
  getFloorContour(floorIndex) {
    if (floorIndex === 0) return this.contour;
    const floor = this.floors[floorIndex];
    if (floor && floor.contour && floor.contour.length >= 3) {
      return floor.contour;
    }
    return this.contour;
  }

  /**
   * Returns the curve control-point array for the contour that applies at
   * the given floor index (mirrors getFloorContour).
   */
  getFloorContourCurves(floorIndex) {
    if (floorIndex === 0) return this.contourCurves;
    const floor = this.floors[floorIndex];
    if (floor && floor.contour && floor.contour.length >= 3) {
      return floor.contourCurves || [];
    }
    return this.contourCurves;
  }

  /**
   * Normalize winding for all contours (building + per-floor overrides).
   */
  normalizeAllContourWindings() {
    if (this.contour.length >= 3) {
      Building._normalizePoints(this.contour);
    }
    for (const floor of this.floors) {
      if (floor.contour && floor.contour.length >= 3) {
        Building._normalizePoints(floor.contour);
      }
    }
  }

  /**
   * Normalize the building base contour winding in place.
   * Ensures a CCW winding in standard math coords (= CW on screen where Y is down).
   */
  normalizeContourWinding() {
    Building._normalizePoints(this.contour);
  }

  /**
   * Normalize an array of Vector2 points so it has positive signed area
   * (CCW in standard math = CW on screen).
   */
  static _normalizePoints(pts) {
    if (!pts || pts.length < 3) return;
    const area = Building._signedArea(pts);
    if (area < 0) pts.reverse();
  }

  /**
   * Compute the signed area of a polygon (shoelace formula).
   * Positive = CCW in standard math coords.
   */
  static _signedArea(pts) {
    let area = 0;
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      area += pts[i].x * pts[j].y;
      area -= pts[j].x * pts[i].y;
    }
    return area / 2;
  }

  getContourSignedArea() {
    return Building._signedArea(this.contour);
  }

  /**
   * Return the length of wall segment `wallIndex` (0-based, wraps around).
   */
  getWallLength(wallIndex) {
    const n = this.contour.length;
    if (n < 2 || wallIndex >= n) return 0;
    const p1 = this.contour[wallIndex];
    const p2 = this.contour[(wallIndex + 1) % n];
    return p1.distanceTo(p2);
  }

  /** Number of wall segments = number of contour vertices. */
  get numWallSegments() {
    return this.contour.length;
  }

  toJSON() {
    return {
      contour: this.contour.map(p => ({ x: p.x, y: p.y })),
      contourCurves: this.contourCurves.map(cp => cp ? { x: cp.x, y: cp.y } : null),
      wallThickness: this.wallThickness,
      cornerRadius: this.cornerRadius,
      floors: this.floors.map(f => f.toJSON()),
      roof: this.roof ? this.roof.toJSON() : null,
    };
  }

  static fromJSON(data) {
    const b = new Building();
    b.contour = (data.contour || []).map(p => new THREE.Vector2(p.x, p.y));
    b.contourCurves = (data.contourCurves || []).map(cp => cp ? new THREE.Vector2(cp.x, cp.y) : null);
    b.wallThickness = data.wallThickness ?? 0.2;
    b.cornerRadius = data.cornerRadius ?? 0;
    b.floors = (data.floors || [new Floor(0, 2.7)]).map((fd, i) => Floor.fromJSON(fd, i));
    b.roof = data.roof ? Roof.fromJSON(data.roof) : new Roof();
    return b;
  }
}
