import * as THREE from 'three';
import { roundContour, getCornerTrims, expandCurvedContour, bezierAt, bezierTangent } from '../utils/ContourUtils.js';

// Stair geometry constants (all in metres)
const MAX_TREAD_DEPTH_M = 0.30;
const RISER_HEIGHT_M    = 0.17;

// Wall geometry constants
const MIN_WALL_HEIGHT            = 0.01;
const OPENING_BOUNDARY_TOLERANCE = 0.05;
const MIN_BEVEL_SEGMENT_LEN      = 0.001;

// Shared arc-segment count used by both roundContour calls and the corner-fill geometry.
const CORNER_ARC_SEGMENTS = 6;

// Bézier subdivision count for curved wall segments.
const CURVE_WALL_STEPS = 12;

export class BuildingGenerator {
  constructor(sceneManager) {
    this.sm = sceneManager;

    // Fix 1: wall material double-sided
    this.wallMat        = new THREE.MeshLambertMaterial({ color: 0xe8e8e0, side: THREE.DoubleSide });
    this.slabMat        = new THREE.MeshLambertMaterial({ color: 0xd0d0d0 });
    this.internalWallMat = new THREE.MeshLambertMaterial({ color: 0xd8d8d8 });
    this.balconyMat     = new THREE.MeshLambertMaterial({ color: 0xc0d0e0 });
    this.elevatorMat    = new THREE.MeshLambertMaterial({ color: 0x809ab0 });
    this.stairsMat      = new THREE.MeshLambertMaterial({ color: 0xb0a090 });
    this.windowMat      = new THREE.MeshLambertMaterial({ color: 0x88bbff, transparent: true, opacity: 0.4, side: THREE.DoubleSide });
    this.doorFrameMat   = new THREE.MeshLambertMaterial({ color: 0x996633 });
    this.railingMat     = new THREE.MeshLambertMaterial({ color: 0x888888 });
    this.ceilingBevelMat = new THREE.MeshLambertMaterial({ color: 0xd0d0d0, side: THREE.DoubleSide });
  }

  generateAll(buildings) {
    const group = this.sm.buildingGroup;
    while (group.children.length) {
      const child = group.children[0];
      this._disposeObject(child);
      group.remove(child);
    }
    for (const building of buildings) {
      if (building.contour.length >= 3) {
        this._generateBuilding(building, group);
      }
    }
  }

  /** @deprecated - use generateAll() */
  generate(building) {
    this.generateAll([building]);
  }

  _generateBuilding(building, group) {
    let baseY = 0;
    const floorBases = [];
    for (const floor of building.floors) {
      floorBases.push(baseY);
      baseY += floor.height;
    }

    const cr = building.cornerRadius || 0;

    // Pre-compute expanded contours (bezier curves → polyline) for each floor.
    // These are used for slabs only; wall generation receives the original contour + curves.
    const expandedContours = [];
    for (let fi = 0; fi < building.floors.length; fi++) {
      const fc = building.getFloorContour(fi);
      const curves = building.getFloorContourCurves(fi);
      const hasCurves = curves && curves.length > 0 && curves.some(cp => cp !== null);
      expandedContours.push(hasCurves ? expandCurvedContour(fc, curves, CURVE_WALL_STEPS) : fc);
    }

    // Cache rounded-expanded contours for slab use.
    const roundedCache = new Map();
    const getRounded = (contour) => {
      if (!roundedCache.has(contour)) {
        roundedCache.set(contour, roundContour(contour, cr, CORNER_ARC_SEGMENTS));
      }
      return roundedCache.get(contour);
    };

    // Ground floor slab (bottom of building) — use expanded+rounded contour.
    this._addSlab(getRounded(expandedContours[0]), 0, null, group);

    for (let fi = 0; fi < building.floors.length; fi++) {
      const floor = building.floors[fi];
      const floorBaseY = floorBases[fi];
      const floorContour = building.getFloorContour(fi);
      const floorCurves = building.getFloorContourCurves(fi);
      const expandedContour = expandedContours[fi];
      const roundedContour = getRounded(expandedContour);

      this._generateExternalWalls(floorContour, building.wallThickness, floor, floorBaseY, group, cr, floorCurves);
      this._generateInternalWalls(building, floor, floorBaseY, group);
      this._generateWindowPanes(floorContour, floorCurves, floor, floorBaseY, group);
      this._generateBalconies(floorContour, floorCurves, floor, floorBaseY, group);
      this._generateElevator(floor, floorBaseY, group);
      this._generateStairs(floor, floorBaseY, group);

      const ceilingBevelCuts = this._computeCeilingBevelCuts(floorContour, floor, building.wallThickness);
      this._addSlab(roundedContour, floorBaseY + floor.height, floor.floorHoles, group, ceilingBevelCuts);

      this._generateCeilingBevelMeshes(floorContour, floor, floorBaseY, building.wallThickness, group);
    }
  }

  // ── Floor slabs ───────────────────────────────────────────────────────────
  _addSlab(contour, yTop, floorHoles, group, bevelCuts = []) {
    if (contour.length < 3) return;

    const shape = new THREE.Shape();
    shape.moveTo(contour[0].x, -contour[0].y);
    for (let i = 1; i < contour.length; i++) {
      shape.lineTo(contour[i].x, -contour[i].y);
    }
    shape.closePath();

    // Fix 3: floor hole winding fix
    if (floorHoles && floorHoles.length > 0) {
      for (const hole of floorHoles) {
        if (!hole.points || hole.points.length < 3) continue;

        // Use the canonical normalizer: ensure positive world-space area so
        // that after the y-negation (shape_y = -world_z) the hole path has
        // negative (CW) area in shape space — as required by THREE.js.
        hole.normalizeWorldWindingCCW();
        const pts = hole.points;

        const path = new THREE.Path();
        path.moveTo(pts[0].x, -pts[0].y);
        for (let i = 1; i < pts.length; i++) {
          path.lineTo(pts[i].x, -pts[i].y);
        }
        path.closePath();
        shape.holes.push(path);
      }
    }

    for (const cut of bevelCuts) {
      shape.holes.push(cut);
    }

    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.15, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, this.slabMat);
    mesh.position.y = yTop;
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    group.add(mesh);
  }

  // ── External walls ────────────────────────────────────────────────────────
  _generateExternalWalls(contour, wallThick, floor, floorBaseY, group, cornerRadius = 0, curves = null) {
    const n = contour.length;
    const floorH = floor.height;
    const trims = getCornerTrims(contour, cornerRadius);

    for (let i = 0; i < n; i++) {
      const cp = curves && curves[i];
      if (cp) {
        // ── Curved segment: subdivide along the Bézier and generate mini-walls. ──
        const segWindows = floor.windows.filter(w => w.wallIndex === i);
        const segDoors   = floor.doors.filter(d => d.wallIndex === i);
        this._generateCurvedWallSegment(
          contour[i], cp, contour[(i + 1) % n],
          wallThick, floorH, floorBaseY, group,
          segWindows, segDoors,
        );
        continue;
      }

      const p1o = contour[i];
      const p2o = contour[(i + 1) % n];

      const dx = p2o.x - p1o.x;
      const dz = p2o.y - p1o.y;
      const wallLenFull = Math.sqrt(dx * dx + dz * dz);
      if (wallLenFull < 0.01) continue;

      const ndx = dx / wallLenFull;
      const ndz = dz / wallLenFull;

      // Trim this wall segment at both ends to make room for corner arcs.
      const startTrim = trims[i];
      const endTrim   = trims[(i + 1) % n];
      const wallLen   = wallLenFull - startTrim - endTrim;
      if (wallLen < 0.01) continue;

      // Actual world-space start of the trimmed wall.
      const p1 = cornerRadius > 0
        ? { x: p1o.x + ndx * startTrim, y: p1o.y + ndz * startTrim }
        : p1o;

      const bevels = floor.wallBevels
        .filter(b => b.wallIndex === i)
        .sort((a, b) => a.offsetStart - b.offsetStart);

      const rawProfile = this._computeTopProfile(bevels, wallLen, floorH);
      const ceilingConstr = (floor.ceilingBevels || []).filter(cb => cb.wallIndex === i);
      const topProfile = ceilingConstr.length > 0
        ? this._capProfileToCeilingBevels(rawProfile, ceilingConstr, wallLen, floorH)
        : rawProfile;

      const shape = new THREE.Shape();
      shape.moveTo(0, 0);
      shape.lineTo(wallLen, 0);
      for (let j = topProfile.length - 1; j >= 0; j--) {
        shape.lineTo(topProfile[j].x, topProfile[j].h);
      }
      shape.closePath();

      shape.holes = this._getWallHoles(floor, i, topProfile, wallLen, floorH, startTrim);

      const geo = new THREE.ExtrudeGeometry(shape, { depth: wallThick, bevelEnabled: false });

      const m = new THREE.Matrix4();
      m.set(
        ndx,  0,  ndz,  p1.x,
        0,    1,  0,    floorBaseY,
        ndz,  0, -ndx,  p1.y,
        0,    0,  0,    1
      );
      geo.applyMatrix4(m);

      const mesh = new THREE.Mesh(geo, this.wallMat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);

      if (bevels.length > 0) {
        this._generateWallBevelFillPanels(bevels, wallLen, floorH, wallThick, p1, ndx, ndz, floorBaseY, group);
      }
    }

    // Corner fills / arc pieces.
    if (cornerRadius > 0) {
      this._generateRoundedCornerFills(contour, trims, wallThick, floorH, floorBaseY, group);
    } else {
      this._generateCornerFills(contour, wallThick, floorH, floorBaseY, group);
    }
  }

  /**
   * Generates 3D wall geometry for a single curved contour edge by subdividing
   * the quadratic Bézier into `CURVE_WALL_STEPS` straight mini-segments.
   * Windows and doors are mapped via chord-fraction parameterization (t = offset / chordLen).
   */
  _generateCurvedWallSegment(p0, cp, p1, wallThick, floorH, floorBaseY, group, windows = [], doors = []) {
    const chordLen = Math.sqrt((p1.x - p0.x) ** 2 + (p1.y - p0.y) ** 2);

    for (let j = 0; j < CURVE_WALL_STEPS; j++) {
      const t0 = j / CURVE_WALL_STEPS;
      const t1 = (j + 1) / CURVE_WALL_STEPS;
      const mt0 = 1 - t0, mt1 = 1 - t1;

      // Bézier evaluation at t0 and t1.
      const ax = mt0 * mt0 * p0.x + 2 * mt0 * t0 * cp.x + t0 * t0 * p1.x;
      const az = mt0 * mt0 * p0.y + 2 * mt0 * t0 * cp.y + t0 * t0 * p1.y;
      const bx = mt1 * mt1 * p0.x + 2 * mt1 * t1 * cp.x + t1 * t1 * p1.x;
      const bz = mt1 * mt1 * p0.y + 2 * mt1 * t1 * cp.y + t1 * t1 * p1.y;

      const dx = bx - ax, dz = bz - az;
      const segLen = Math.sqrt(dx * dx + dz * dz);
      if (segLen < 0.001) continue;
      const ndx = dx / segLen, ndz = dz / segLen;

      const shape = new THREE.Shape();
      shape.moveTo(0, 0);
      shape.lineTo(segLen, 0);
      shape.lineTo(segLen, floorH);
      shape.lineTo(0, floorH);
      shape.closePath();

      // Cut holes for windows and doors that fall within this mini-segment.
      if (chordLen > 0.001 && (windows.length > 0 || doors.length > 0)) {
        const holes = [];
        const dtInv = CURVE_WALL_STEPS; // 1 / (t1 - t0)

        for (const win of windows) {
          const tLeft  = win.offsetAlongWall / chordLen;
          const tRight = (win.offsetAlongWall + win.width) / chordLen;
          const tLo = Math.max(tLeft, t0);
          const tHi = Math.min(tRight, t1);
          if (tLo >= tHi) continue;
          const x0 = Math.max(0.001, segLen * (tLo - t0) * dtInv);
          const x1 = Math.min(segLen - 0.001, segLen * (tHi - t0) * dtInv);
          if (x0 >= x1) continue;
          const y0 = win.sillHeight;
          const y1 = y0 + win.height;
          if (y1 > floorH - OPENING_BOUNDARY_TOLERANCE) continue;
          const hole = new THREE.Path();
          hole.moveTo(x0, y0);
          hole.lineTo(x1, y0);
          hole.lineTo(x1, y1);
          hole.lineTo(x0, y1);
          hole.closePath();
          holes.push(hole);
        }

        for (const door of doors) {
          const tLeft  = door.offsetAlongWall / chordLen;
          const tRight = (door.offsetAlongWall + door.width) / chordLen;
          const tLo = Math.max(tLeft, t0);
          const tHi = Math.min(tRight, t1);
          if (tLo >= tHi) continue;
          const x0 = Math.max(0.001, segLen * (tLo - t0) * dtInv);
          const x1 = Math.min(segLen - 0.001, segLen * (tHi - t0) * dtInv);
          if (x0 >= x1) continue;
          const y1 = door.height;
          if (y1 > floorH - OPENING_BOUNDARY_TOLERANCE) continue;
          const hole = new THREE.Path();
          hole.moveTo(x0, 0);
          hole.lineTo(x1, 0);
          hole.lineTo(x1, y1);
          hole.lineTo(x0, y1);
          hole.closePath();
          holes.push(hole);
        }

        shape.holes = holes;
      }

      const geo = new THREE.ExtrudeGeometry(shape, { depth: wallThick, bevelEnabled: false });
      const m = new THREE.Matrix4();
      m.set(
        ndx, 0,  ndz, ax,
        0,   1,  0,   floorBaseY,
        ndz, 0, -ndx, az,
        0,   0,  0,   1,
      );
      geo.applyMatrix4(m);

      const mesh = new THREE.Mesh(geo, this.wallMat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }

  // Fix 2: Corner fill pieces at each contour vertex
  _generateCornerFills(contour, wallThick, floorH, floorBaseY, group) {
    const n = contour.length;
    for (let i = 0; i < n; i++) {
      const prev = contour[(i - 1 + n) % n];
      const curr = contour[i];
      const next = contour[(i + 1) % n];

      const d1x = curr.x - prev.x, d1z = curr.y - prev.y;
      const len1 = Math.sqrt(d1x * d1x + d1z * d1z);
      if (len1 < 0.001) continue;
      const nd1x = d1x / len1, nd1z = d1z / len1;

      const d2x = next.x - curr.x, d2z = next.y - curr.y;
      const len2 = Math.sqrt(d2x * d2x + d2z * d2z);
      if (len2 < 0.001) continue;
      const nd2x = d2x / len2, nd2z = d2z / len2;

      // Inward normals
      const in1x = nd1z, in1z = -nd1x;
      const in2x = nd2z, in2z = -nd2x;

      const cornerX = curr.x + (in1x + in2x) * wallThick * 0.5;
      const cornerZ = curr.y + (in1z + in2z) * wallThick * 0.5;

      const geo = new THREE.BoxGeometry(wallThick, floorH, wallThick);
      const mesh = new THREE.Mesh(geo, this.wallMat);
      mesh.position.set(cornerX, floorBaseY + floorH / 2, cornerZ);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }

  /**
   * Replaces the box corner fill with an arc-shaped prism when cornerRadius > 0.
   * Generates a vertical extruded "pie-slice" from tp1 along the Bezier arc to tp2
   * and back to the original corner vertex.  This fills the gap between trimmed
   * wall segments and gives the building its rounded outer corners.
   */
  _generateRoundedCornerFills(contour, trims, wallThick, floorH, floorBaseY, group) {
    const n = contour.length;

    for (let i = 0; i < n; i++) {
      const r = trims[i];
      if (r <= 0) {
        // No rounding at this corner — fall back to box fill.
        const prev = contour[(i - 1 + n) % n];
        const curr = contour[i];
        const next = contour[(i + 1) % n];
        const d1x = curr.x - prev.x, d1z = curr.y - prev.y;
        const len1 = Math.sqrt(d1x * d1x + d1z * d1z);
        if (len1 < 0.001) continue;
        const nd1x = d1x / len1, nd1z = d1z / len1;
        const d2x = next.x - curr.x, d2z = next.y - curr.y;
        const len2 = Math.sqrt(d2x * d2x + d2z * d2z);
        if (len2 < 0.001) continue;
        const nd2x = d2x / len2, nd2z = d2z / len2;
        const in1x = nd1z, in1z = -nd1x;
        const in2x = nd2z, in2z = -nd2x;
        const cornerX = curr.x + (in1x + in2x) * wallThick * 0.5;
        const cornerZ = curr.y + (in1z + in2z) * wallThick * 0.5;
        const geo = new THREE.BoxGeometry(wallThick, floorH, wallThick);
        const mesh = new THREE.Mesh(geo, this.wallMat);
        mesh.position.set(cornerX, floorBaseY + floorH / 2, cornerZ);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
        continue;
      }

      const prev = contour[(i - 1 + n) % n];
      const curr = contour[i];
      const next = contour[(i + 1) % n];

      // Directions from curr toward each adjacent vertex.
      const d1x = prev.x - curr.x, d1y = prev.y - curr.y;
      const len1 = Math.sqrt(d1x * d1x + d1y * d1y);
      const d2x = next.x - curr.x, d2y = next.y - curr.y;
      const len2 = Math.sqrt(d2x * d2x + d2y * d2y);
      if (len1 < 0.001 || len2 < 0.001) continue;

      // Tangent points at radius r from the corner vertex.
      const tp1x = curr.x + (d1x / len1) * r;
      const tp1y = curr.y + (d1y / len1) * r;
      const tp2x = curr.x + (d2x / len2) * r;
      const tp2y = curr.y + (d2y / len2) * r;

      // Build the cross-section polygon: arc from tp1→tp2 (Bezier) + close to curr.
      // In THREE.Shape coordinates we negate Y so that shape_y = -world_z.
      const shape = new THREE.Shape();
      shape.moveTo(tp1x, -tp1y);
      for (let j = 1; j <= CORNER_ARC_SEGMENTS; j++) {
        const t  = j / CORNER_ARC_SEGMENTS;
        const mt = 1 - t;
        const ax = mt * mt * tp1x + 2 * mt * t * curr.x + t * t * tp2x;
        const ay = mt * mt * tp1y + 2 * mt * t * curr.y + t * t * tp2y;
        shape.lineTo(ax, -ay);
      }
      shape.lineTo(curr.x, -curr.y);
      shape.closePath();

      // Extrude vertically.  After rotateX(-PI/2), depth extends in +Y (upward from mesh.position.y).
      const geo = new THREE.ExtrudeGeometry(shape, { depth: floorH, bevelEnabled: false });
      geo.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geo, this.wallMat);
      mesh.position.y = floorBaseY;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }

  _generateWallBevelFillPanels(bevels, wallLen, floorH, wallThick, p1, ndx, ndz, floorBaseY, group) {
    for (const bv of bevels) {
      const oStart  = Math.max(0, Math.min(wallLen, bv.offsetStart));
      const rawOEnd = bv.offsetEnd !== null ? bv.offsetEnd : wallLen;
      const oEnd    = Math.max(oStart + MIN_BEVEL_SEGMENT_LEN, Math.min(wallLen, rawOEnd));
      const hS      = Math.max(MIN_WALL_HEIGHT, Math.min(floorH, bv.heightStart));
      const hE      = Math.max(MIN_WALL_HEIGHT, Math.min(floorH, bv.heightEnd));

      if (hS >= floorH - MIN_BEVEL_SEGMENT_LEN && hE >= floorH - MIN_BEVEL_SEGMENT_LEN) continue;

      const wpos = (lx, ly, lz) => [
        ndx * lx + ndz * lz + p1.x,
        ly + floorBaseY,
        ndz * lx - ndx * lz + p1.y,
      ];

      const [BLx, BLy, BLz] = wpos(oStart, hS,     wallThick);
      const [BRx, BRy, BRz] = wpos(oEnd,   hE,     wallThick);
      const [TRx, TRy, TRz] = wpos(oEnd,   floorH, wallThick);
      const [TLx, TLy, TLz] = wpos(oStart, floorH, wallThick);

      const positions = new Float32Array([
        BLx, BLy, BLz,   BRx, BRy, BRz,   TRx, TRy, TRz,
        BLx, BLy, BLz,   TRx, TRy, TRz,   TLx, TLy, TLz,
      ]);

      const fillGeo = new THREE.BufferGeometry();
      fillGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      fillGeo.computeVertexNormals();

      const fillMesh = new THREE.Mesh(fillGeo, this.wallMat);
      fillMesh.castShadow    = true;
      fillMesh.receiveShadow = true;
      group.add(fillMesh);
    }
  }

  _computeTopProfile(bevels, wallLen, floorH) {
    if (bevels.length === 0) {
      return [{ x: 0, h: floorH }, { x: wallLen, h: floorH }];
    }

    const pts = [];
    let prevEnd = 0;

    for (const bv of bevels) {
      const oStart = Math.max(0, Math.min(wallLen, bv.offsetStart));
      const oEnd   = Math.max(oStart + 0.001, Math.min(wallLen, bv.offsetEnd !== null ? bv.offsetEnd : wallLen));
      const hS = Math.max(MIN_WALL_HEIGHT, bv.heightStart);
      const hE = Math.max(MIN_WALL_HEIGHT, bv.heightEnd);

      if (oStart > prevEnd + 0.001) {
        if (prevEnd > 0.001) {
          pts.push({ x: prevEnd, h: floorH });
        } else {
          pts.push({ x: 0, h: floorH });
        }
        pts.push({ x: oStart, h: floorH });
      }

      pts.push({ x: oStart, h: hS });
      pts.push({ x: oEnd,   h: hE });
      prevEnd = oEnd;
    }

    if (prevEnd < wallLen - 0.001) {
      pts.push({ x: prevEnd, h: floorH });
      pts.push({ x: wallLen, h: floorH });
    }

    return pts;
  }

  _topProfileHeightAt(topProfile, x) {
    for (let i = 0; i < topProfile.length - 1; i++) {
      const a = topProfile[i], b = topProfile[i + 1];
      if (x >= a.x - 0.0001 && x <= b.x + 0.0001) {
        const span = b.x - a.x;
        if (span < 0.0001) return Math.min(a.h, b.h);
        return a.h + (b.h - a.h) * ((x - a.x) / span);
      }
    }
    return topProfile[topProfile.length - 1]?.h ?? 0;
  }

  _ceilingHeightAt(ceilingBevels, wallLen, floorH, x) {
    let h = floorH;
    for (const cb of ceilingBevels) {
      const oStart = Math.max(0, Math.min(wallLen, cb.offsetStart));
      const oEnd   = Math.max(oStart + 0.001, Math.min(wallLen, cb.offsetEnd !== null ? cb.offsetEnd : wallLen));
      if (x < oStart - 0.0001 || x > oEnd + 0.0001) continue;
      const span = oEnd - oStart;
      const t    = span > 0.0001 ? Math.max(0, Math.min(1, (x - oStart) / span)) : 0;
      const hCeil = Math.max(MIN_WALL_HEIGHT, cb.heightStart + (cb.heightEnd - cb.heightStart) * t);
      h = Math.min(h, hCeil);
    }
    return h;
  }

  _capProfileToCeilingBevels(topProfile, ceilingBevels, wallLen, floorH) {
    if (ceilingBevels.length === 0) return topProfile;

    const xSet = new Set(topProfile.map(pt => pt.x));
    for (const cb of ceilingBevels) {
      xSet.add(Math.max(0, Math.min(wallLen, cb.offsetStart)));
      const oEnd = cb.offsetEnd !== null ? cb.offsetEnd : wallLen;
      xSet.add(Math.max(0, Math.min(wallLen, oEnd)));
    }

    const xs = [...xSet].sort((a, b) => a - b);
    const result = [];
    for (const x of xs) {
      const wh = this._topProfileHeightAt(topProfile, x);
      const ch = this._ceilingHeightAt(ceilingBevels, wallLen, floorH, x);
      const h  = Math.min(wh, ch);
      result.push({ x, h });
    }
    return result;
  }

  _getWallHoles(floor, wallIndex, topProfile, wallLen, floorH, startTrim = 0) {
    const holes = [];
    const maxYAtX = (x) => this._topProfileHeightAt(topProfile, x);

    for (const win of floor.windows) {
      if (win.wallIndex !== wallIndex) continue;
      // Adjust offset to account for the trimmed wall start.
      const x0 = win.offsetAlongWall - startTrim;
      const x1 = x0 + win.width;
      const y0 = win.sillHeight;
      const y1 = y0 + win.height;
      if (x0 < OPENING_BOUNDARY_TOLERANCE || x1 > wallLen - OPENING_BOUNDARY_TOLERANCE) continue;
      const topLimit = Math.min(maxYAtX(x0), maxYAtX(x1));
      if (y1 > topLimit - OPENING_BOUNDARY_TOLERANCE) continue;
      const hole = new THREE.Path();
      hole.moveTo(x0, y0);
      hole.lineTo(x1, y0);
      hole.lineTo(x1, y1);
      hole.lineTo(x0, y1);
      hole.closePath();
      holes.push(hole);
    }

    for (const door of floor.doors) {
      if (door.wallIndex !== wallIndex) continue;
      // Adjust offset to account for the trimmed wall start.
      const x0 = door.offsetAlongWall - startTrim;
      const x1 = x0 + door.width;
      const y1 = door.height;
      if (x0 < OPENING_BOUNDARY_TOLERANCE || x1 > wallLen - OPENING_BOUNDARY_TOLERANCE) continue;
      const topLimit = Math.min(maxYAtX(x0), maxYAtX(x1));
      if (y1 > topLimit - OPENING_BOUNDARY_TOLERANCE) continue;
      const hole = new THREE.Path();
      hole.moveTo(x0, 0.0);
      hole.lineTo(x1, 0.0);
      hole.lineTo(x1, y1);
      hole.lineTo(x0, y1);
      hole.closePath();
      holes.push(hole);
    }

    return holes;
  }

  _computeBevelCuts(contour, floor, wallThick) {
    const cuts = [];
    const n = contour.length;

    for (const bevel of floor.wallBevels) {
      const i = bevel.wallIndex;
      if (i >= n) continue;

      const p1 = contour[i];
      const p2 = contour[(i + 1) % n];
      const dx = p2.x - p1.x, dz = p2.y - p1.y;
      const wallLen = Math.sqrt(dx * dx + dz * dz);
      if (wallLen < 0.01) continue;

      const ndx = dx / wallLen, ndz = dz / wallLen;

      const oStart = Math.max(0, Math.min(wallLen, bevel.offsetStart));
      const oEnd   = Math.max(oStart + 0.001, Math.min(wallLen, bevel.offsetEnd !== null ? bevel.offsetEnd : wallLen));

      const ax = p1.x + oStart * ndx,       ay = -(p1.y + oStart * ndz);
      const bx = p1.x + oEnd   * ndx,       by = -(p1.y + oEnd   * ndz);
      const cx = bx + ndz * wallThick,       cy = by + ndx * wallThick;
      const ddx = ax + ndz * wallThick,      ddy = ay + ndx * wallThick;

      const path = new THREE.Path();
      path.moveTo(ax,  ay);
      path.lineTo(ddx, ddy);
      path.lineTo(cx,  cy);
      path.lineTo(bx,  by);
      path.closePath();
      cuts.push(path);
    }

    return cuts;
  }

  _computeCeilingBevelCuts(contour, floor, wallThick) {
    const cuts = [];
    const n = contour.length;

    for (const cb of (floor.ceilingBevels || [])) {
      const i = cb.wallIndex;
      if (i >= n) continue;

      const p1 = contour[i];
      const p2 = contour[(i + 1) % n];
      const dx = p2.x - p1.x, dz = p2.y - p1.y;
      const wallLen = Math.sqrt(dx * dx + dz * dz);
      if (wallLen < 0.01) continue;

      const ndx = dx / wallLen, ndz = dz / wallLen;

      const oStart = Math.max(0, Math.min(wallLen, cb.offsetStart));
      const oEnd   = Math.max(oStart + 0.001, Math.min(wallLen, cb.offsetEnd !== null ? cb.offsetEnd : wallLen));
      const depth  = Math.max(0.1, cb.depth);

      const innerSpan = depth - wallThick;
      if (innerSpan <= 0) continue;

      const ax = p1.x + oStart * ndx + ndz * wallThick,   ay = -(p1.y + oStart * ndz) + ndx * wallThick;
      const bx = p1.x + oEnd   * ndx + ndz * wallThick,   by = -(p1.y + oEnd   * ndz) + ndx * wallThick;
      const cx = bx + ndz * innerSpan,   cy = by + ndx * innerSpan;
      const Dx = ax + ndz * innerSpan,   Dy = ay + ndx * innerSpan;

      const path = new THREE.Path();
      path.moveTo(ax, ay);
      path.lineTo(Dx, Dy);
      path.lineTo(cx, cy);
      path.lineTo(bx, by);
      path.closePath();
      cuts.push(path);
    }

    return cuts;
  }

  _generateCeilingBevelMeshes(contour, floor, baseY, wallThick, group) {
    const n = contour.length;
    const floorH = floor.height;

    for (const cb of (floor.ceilingBevels || [])) {
      const i = cb.wallIndex;
      if (i >= n) continue;

      const p1 = contour[i];
      const p2 = contour[(i + 1) % n];
      const dx = p2.x - p1.x, dz = p2.y - p1.y;
      const wallLen = Math.sqrt(dx * dx + dz * dz);
      if (wallLen < 0.01) continue;

      const ndx = dx / wallLen, ndz = dz / wallLen;

      const oStart = Math.max(0, Math.min(wallLen, cb.offsetStart));
      const oEnd   = Math.max(oStart + 0.001, Math.min(wallLen, cb.offsetEnd !== null ? cb.offsetEnd : wallLen));
      const hS     = Math.max(MIN_WALL_HEIGHT, Math.min(floorH, cb.heightStart));
      const hE     = Math.max(MIN_WALL_HEIGHT, Math.min(floorH, cb.heightEnd));
      const depth  = Math.max(0.1, cb.depth);

      const Z_FIGHT_OFFSET = 0.001;
      const Ax = p1.x + oStart * ndx,   Ay = baseY + hS,                       Az = p1.y + oStart * ndz;
      const Bx = p1.x + oEnd   * ndx,   By = baseY + hE,                       Bz = p1.y + oEnd   * ndz;
      const Cx = Bx + ndz * depth,      Cy = baseY + floorH - Z_FIGHT_OFFSET,  Cz = Bz - ndx * depth;
      const Dx = Ax + ndz * depth,      Dy = baseY + floorH - Z_FIGHT_OFFSET,  Dz = Az - ndx * depth;

      const positions = new Float32Array([
        Ax, Ay, Az,   Cx, Cy, Cz,   Bx, By, Bz,
        Ax, Ay, Az,   Dx, Dy, Dz,   Cx, Cy, Cz,
      ]);

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.computeVertexNormals();

      const mesh = new THREE.Mesh(geo, this.ceilingBevelMat);
      mesh.castShadow  = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }

  // ── Internal walls ────────────────────────────────────────────────────────
  _generateInternalWalls(building, floor, floorBaseY, group) {
    for (const wall of floor.internalWalls) {
      const dx = wall.end.x - wall.start.x;
      const dz = wall.end.y - wall.start.y;
      const wallLen = wall.length;
      if (wallLen < 0.01) continue;

      const angle = Math.atan2(dz, dx);

      const geo = new THREE.BoxGeometry(wallLen, floor.height, wall.thickness);
      const mesh = new THREE.Mesh(geo, this.internalWallMat);

      const mx = (wall.start.x + wall.end.x) / 2;
      const mz = (wall.start.y + wall.end.y) / 2;
      mesh.position.set(mx, floorBaseY + floor.height / 2, mz);
      mesh.rotation.y = -angle;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }

  // ── Window panes ──────────────────────────────────────────────────────────
  _generateWindowPanes(contour, curves, floor, floorBaseY, group) {
    const n = contour.length;

    for (const win of floor.windows) {
      if (win.wallIndex >= n) continue;
      const p1 = contour[win.wallIndex];
      const p2 = contour[(win.wallIndex + 1) % n];
      const dx = p2.x - p1.x, dz = p2.y - p1.y;
      const chordLen = Math.sqrt(dx * dx + dz * dz);
      if (chordLen < 0.01) continue;

      const cp = curves && curves[win.wallIndex];
      const centerOffset = win.offsetAlongWall + win.width / 2;
      let cx, cz, ndx, ndz;

      if (cp) {
        // Curved wall: evaluate Bézier at chord-fraction parameter.
        const t = centerOffset / chordLen;
        const pos = bezierAt(p1, cp, p2, t);
        cx = pos.x; cz = pos.y;
        const tan = bezierTangent(p1, cp, p2, t);
        ndx = tan.x; ndz = tan.y;
      } else {
        ndx = dx / chordLen; ndz = dz / chordLen;
        cx = p1.x + ndx * centerOffset;
        cz = p1.y + ndz * centerOffset;
      }

      const cy = floorBaseY + win.sillHeight + win.height / 2;

      const geo = new THREE.PlaneGeometry(win.width, win.height);
      const mesh = new THREE.Mesh(geo, this.windowMat);
      mesh.position.set(cx, cy, cz);
      const wallAngle = Math.atan2(ndz, ndx);
      mesh.rotation.y = -wallAngle;
      group.add(mesh);
    }
  }

  // ── Balconies ─────────────────────────────────────────────────────────────
  _generateBalconies(contour, curves, floor, floorBaseY, group) {
    const n = contour.length;

    for (const bal of floor.balconies) {
      if (bal.wallIndex >= n) continue;
      const p1 = contour[bal.wallIndex];
      const p2 = contour[(bal.wallIndex + 1) % n];
      const dx = p2.x - p1.x, dz = p2.y - p1.y;
      const chordLen = Math.sqrt(dx * dx + dz * dz);
      if (chordLen < 0.01) continue;

      const cp = curves && curves[bal.wallIndex];
      const midOffset = bal.offsetAlongWall + bal.width / 2;

      let cx, cz, ndx, ndz;

      if (cp) {
        // Curved wall: evaluate Bézier at chord-fraction parameter.
        const t = midOffset / chordLen;
        const pos = bezierAt(p1, cp, p2, t);
        const tan = bezierTangent(p1, cp, p2, t);
        ndx = tan.x; ndz = tan.y;
        // Outward normal (right perp).
        const ox = ndz, oz = -ndx;
        cx = pos.x + ox * bal.depth / 2;
        cz = pos.y + oz * bal.depth / 2;
      } else {
        ndx = dx / chordLen; ndz = dz / chordLen;
        // Outward normal (right perp for CW-on-screen contour = away from building)
        const ox = ndz, oz = -ndx;
        cx = p1.x + ndx * midOffset + ox * bal.depth / 2;
        cz = p1.y + ndz * midOffset + oz * bal.depth / 2;
      }

      const cy = floorBaseY;

      const slabGeo = new THREE.BoxGeometry(bal.width, 0.12, bal.depth);
      const slab = new THREE.Mesh(slabGeo, this.balconyMat);
      slab.position.set(cx, cy + 0.06, cz);
      const wallAngle = Math.atan2(ndz, ndx);
      slab.rotation.y = -wallAngle;
      slab.castShadow = true;
      slab.receiveShadow = true;
      group.add(slab);

      this._addBalconyRailing(cx, cy, cz, bal.width, bal.depth, wallAngle, group);
    }
  }

  _addBalconyRailing(cx, cy, cz, width, depth, wallAngle, group) {
    const railH = 1.0;
    const postThick = 0.05;
    const railY = cy + railH;

    // Derive wall-parallel and outward unit vectors from wallAngle.
    // Three.js rotation.y = -wallAngle maps local +X to world (ndx, 0, ndz).
    // Outward normal (right-perp for CW-on-screen contour): (ox, oz) = (ndz, -ndx).
    const ndx = Math.cos(wallAngle), ndz = Math.sin(wallAngle);
    const ox = ndz, oz = -ndx;

    // World XZ position of a point at (aw) along-wall and (od) outward from slab centre.
    const wPos = (aw, od) => ({
      x: cx + ndx * aw + ox * od,
      z: cz + ndz * aw + oz * od,
    });

    const hw = width / 2, hd = depth / 2;

    // Four corner posts
    for (const aw of [-hw, hw]) {
      for (const od of [-hd, hd]) {
        const p = wPos(aw, od);
        const geo = new THREE.BoxGeometry(postThick, railH, postThick);
        const mesh = new THREE.Mesh(geo, this.railingMat);
        mesh.position.set(p.x, cy + railH / 2, p.z);
        group.add(mesh);
      }
    }

    // Front rail along the outer edge (outward = +hd)
    const fp = wPos(0, hd);
    const frontRailGeo = new THREE.BoxGeometry(width, postThick, postThick);
    const frontRail = new THREE.Mesh(frontRailGeo, this.railingMat);
    frontRail.position.set(fp.x, railY, fp.z);
    frontRail.rotation.y = -wallAngle;
    group.add(frontRail);

    // Side rails spanning the full depth (outer ↔ inner)
    for (const side of [-1, 1]) {
      const sp = wPos(side * hw, 0);
      const sideRailGeo = new THREE.BoxGeometry(postThick, postThick, depth);
      const sideRail = new THREE.Mesh(sideRailGeo, this.railingMat);
      sideRail.position.set(sp.x, railY, sp.z);
      sideRail.rotation.y = -wallAngle;
      group.add(sideRail);
    }
  }

  // ── Elevator shaft ────────────────────────────────────────────────────────
  _generateElevator(floor, floorBaseY, group) {
    if (!floor.elevator) return;
    const ev = floor.elevator;
    const cx = ev.position.x, cz = ev.position.y;
    const ew = ev.width, ed = ev.depth;
    const h = floor.height + 0.15;
    const t = 0.08;

    const panels = [
      { pos: [cx, floorBaseY + h / 2, cz - ed / 2], size: [ew + t * 2, h, t] },
      { pos: [cx, floorBaseY + h / 2, cz + ed / 2], size: [ew + t * 2, h, t] },
      { pos: [cx - ew / 2, floorBaseY + h / 2, cz], size: [t, h, ed] },
      { pos: [cx + ew / 2, floorBaseY + h / 2, cz], size: [t, h, ed] },
    ];

    for (const p of panels) {
      const geo = new THREE.BoxGeometry(...p.size);
      const mesh = new THREE.Mesh(geo, this.elevatorMat);
      mesh.position.set(...p.pos);
      mesh.castShadow = true;
      group.add(mesh);
    }

    const botGeo = new THREE.BoxGeometry(ew, 0.1, ed);
    const botMesh = new THREE.Mesh(botGeo, this.elevatorMat);
    botMesh.position.set(cx, floorBaseY + 0.05, cz);
    group.add(botMesh);

    const topGeo = new THREE.BoxGeometry(ew, 0.1, ed);
    const topMesh = new THREE.Mesh(topGeo, this.elevatorMat);
    topMesh.position.set(cx, floorBaseY + h, cz);
    group.add(topMesh);
  }

  // ── Stairs ────────────────────────────────────────────────────────────────
  _generateStairs(floor, floorBaseY, group) {
    if (!floor.stairs) return;
    const stairs = floor.stairs;
    const px = stairs.position.x, pz = stairs.position.y;
    const w = stairs.width;
    const runLen = stairs.runLength;
    // Use the stairs' own height (total rise); fall back to floor height for
    // legacy serialised data that predates the height property.
    const totalRise = stairs.height > 0 ? stairs.height : floor.height;

    const numSteps = Math.max(3, Math.round(totalRise / RISER_HEIGHT_M));
    const riserH = totalRise / numSteps;
    const treadD = Math.min(runLen / numSteps, MAX_TREAD_DEPTH_M);

    const dirMap = {
      north: 0,
      south: Math.PI,
      east: Math.PI / 2,
      west: -Math.PI / 2
    };
    const rotY = dirMap[stairs.direction] || 0;

    for (let i = 0; i < numSteps; i++) {
      const stepH = riserH * (i + 1);
      const stepGeo = new THREE.BoxGeometry(w, stepH, treadD);
      const mesh = new THREE.Mesh(stepGeo, this.stairsMat);

      const localX = 0;
      const localY = stepH / 2;
      const localZ = i * treadD + treadD / 2;

      const cos = Math.cos(rotY), sin = Math.sin(rotY);
      const wx = localX * cos - localZ * sin + px;
      const wz = localX * sin + localZ * cos + pz;

      mesh.position.set(wx, floorBaseY + localY, wz);
      mesh.rotation.y = rotY;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }

  // ── Disposal ──────────────────────────────────────────────────────────────
  _disposeObject(obj) {
    obj.traverse(child => {
      if (child.isMesh) {
        child.geometry?.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach(m => m.dispose());
        } else {
          child.material?.dispose();
        }
      }
    });
  }
}
