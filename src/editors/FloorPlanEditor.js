import * as THREE from 'three';
import { GridSystem } from '../GridSystem.js';
import { Building } from '../models/Building.js';
import { Wall } from '../models/Wall.js';
import { WindowElement } from '../models/WindowElement.js';
import { Door } from '../models/Door.js';
import { Balcony } from '../models/Balcony.js';
import { Elevator } from '../models/Elevator.js';
import { Stairs } from '../models/Stairs.js';
import { FloorHole } from '../models/FloorHole.js';

// ─── 2D line/shape helpers ─────────────────────────────────────────────────
function makeLine(pts, color, linewidth = 1) {
  const geo = new THREE.BufferGeometry().setFromPoints(
    pts.map(p => new THREE.Vector3(p.x, 0.01, p.y))
  );
  const mat = new THREE.LineBasicMaterial({ color, linewidth });
  return new THREE.Line(geo, mat);
}

function makeLineLoop(pts, color) {
  const closed = [...pts, pts[0]];
  return makeLine(closed, color);
}

function makeCircle(cx, cz, r, color, segments = 16) {
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push(new THREE.Vector3(cx + Math.cos(a) * r, 0.02, cz + Math.sin(a) * r));
  }
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const mat = new THREE.LineBasicMaterial({ color });
  return new THREE.Line(geo, mat);
}

function makeDashedLine(pts, color) {
  const geo = new THREE.BufferGeometry().setFromPoints(
    pts.map(p => new THREE.Vector3(p.x, 0.015, p.y))
  );
  const mat = new THREE.LineDashedMaterial({ color, dashSize: 0.3, gapSize: 0.2 });
  const line = new THREE.Line(geo, mat);
  line.computeLineDistances();
  return line;
}

function makeFilledRect(cx, cz, w, d, color, yOff = 0.01) {
  const geo = new THREE.PlaneGeometry(w, d);
  const mat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.55 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(cx, yOff, cz);
  return mesh;
}

/**
 * Renders the floor contour as a semi-transparent filled shape (ghost fill).
 */
function makeFilledContour(contour, color, opacity) {
  const shape = new THREE.Shape();
  shape.moveTo(contour[0].x, -contour[0].y);
  for (let i = 1; i < contour.length; i++) {
    shape.lineTo(contour[i].x, -contour[i].y);
  }
  shape.closePath();
  const geo = new THREE.ShapeGeometry(shape);
  const mat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 1;
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.03;
  return mesh;
}

// ──────────────────────────────────────────────────────────────────────────
const SNAP_THRESHOLD = 0.5;
const MAX_ANGLE_DEG  = 359.9;
const ROTATION_HANDLE_OFFSET = 2.5;
const ANGLE_SNAP_THRESHOLD_DEG = 10;
const RIGHT_ANGLE_BOX_SIZE = 0.25;
const ROTATION_HANDLE_HIT_MULTIPLIER = 1.5;

export class FloorPlanEditor {
  constructor(sceneManager, app) {
    this.sm = sceneManager;
    this.app = app;

    this.tool = 'select';
    this.currentFloorIndex = 0;
    this.selectedElement = null;

    this.ghostFill = true;

    this._isDrawingContour = false;
    this._previewPoints = [];
    this._angleSnapActive = false;

    this._isDrawingWall = false;
    this._wallStart = null;

    this._isDrawingFloorHole = false;
    this._floorHolePoints = [];

    this._isPanning = false;
    this._panStart = null;

    this._isDragging = false;
    this._dragTarget = null;

    this._cursorPos = new THREE.Vector2();
    this._snappedCursorPos = new THREE.Vector2();

    this._labelContainer = document.getElementById('canvas-labels');
    this._dimEditPopup    = document.getElementById('dim-edit-popup');
    this._dimEditInput    = document.getElementById('dim-edit-input');
    this._pendingDimEdit  = null;

    const c = this.sm.canvas;
    c.addEventListener('mousedown', e => this.onMouseDown(e));
    c.addEventListener('mousemove', e => this.onMouseMove(e));
    c.addEventListener('mouseup', e => this.onMouseUp(e));
    c.addEventListener('wheel', e => this.onMouseWheel(e), { passive: false });
    c.addEventListener('contextmenu', e => e.preventDefault());
    c.addEventListener('dblclick', e => this.onDblClick(e));

    this.redraw();
  }

  get building() {
    return this.app.building;
  }

  resetState() {
    this._isDrawingContour = false;
    this._previewPoints = [];
    this._angleSnapActive = false;
    this._isDrawingFloorHole = false;
    this._floorHolePoints = [];
    this._isDrawingWall = false;
    this._wallStart = null;
    this._isDragging = false;
    this._dragTarget = null;
    this.selectedElement = null;
    this.currentFloorIndex = this.app.currentFloorIndex;
    if (this.app.ui) this.app.ui.clearProperties();
    this.redraw();
  }

  setTool(tool) {
    this.tool = tool;
    this._isDrawingContour = false;
    this._previewPoints = [];
    this._angleSnapActive = false;
    this._isDrawingFloorHole = false;
    this._floorHolePoints = [];
    this._isDrawingWall = false;
    this._wallStart = null;
    this._isDragging = false;
    this._dragTarget = null;
    this.selectedElement = null;
    if (this.app.ui) this.app.ui.clearProperties();
    this.redraw();
  }

  setFloor(index) {
    this.currentFloorIndex = index;
    this.selectedElement = null;
    if (this.app.ui) this.app.ui.clearProperties();
    this.redraw();
  }

  get currentFloor() {
    return this.building.getFloor(this.currentFloorIndex);
  }

  get activeContour() {
    return this.building.getFloorContour(this.currentFloorIndex);
  }

  _setActiveContour(points) {
    if (this.currentFloorIndex === 0 || !this.currentFloor) {
      this.building.contour = points;
      this.building.normalizeContourWinding();
    } else {
      const floor = this.currentFloor;
      floor.contour = points;
      Building._normalizePoints(floor.contour);
    }
  }

  // ── Mouse events ──────────────────────────────────────────────────────────
  onMouseDown(e) {
    if (this.app.mode !== '2d' && !this.app.splitMode) return;

    this._hideDimEdit();

    const rawPos = this.sm.getWorldPosition(e);
    if (rawPos.x > 99990) return; // outside split editor area
    let pos = this._snapToGrid(rawPos);

    if (this.tool === 'draw-contour' && this._previewPoints.length > 0) {
      pos = this._applyAngleSnap(pos);
    }

    if (e.button === 2 || e.button === 1) {
      this._isPanning = true;
      this._panStart = { x: e.clientX, y: e.clientY };
      return;
    }

    if (e.button !== 0) return;

    switch (this.tool) {
      case 'select':         this._handleSelectDown(pos, e); break;
      case 'move':           this._handleMoveDown(pos); break;
      case 'draw-contour':   this._handleDrawContourDown(pos); break;
      case 'draw-wall':      this._handleDrawWallDown(pos); break;
      case 'add-window':     this._handleAddOpeningDown(pos, 'window'); break;
      case 'add-door':       this._handleAddOpeningDown(pos, 'door'); break;
      case 'add-balcony':    this._handleAddOpeningDown(pos, 'balcony'); break;
      case 'add-elevator':   this._handleAddElevatorDown(pos); break;
      case 'add-stairs':     this._handleAddStairsDown(pos); break;
      case 'add-floor-hole': this._handleAddFloorHoleDown(pos); break;
    }
  }

  onMouseMove(e) {
    if (this.app.mode !== '2d' && !this.app.splitMode) return;

    const rawPos = this.sm.getWorldPosition(e);
    if (rawPos.x > 99990) return; // outside split editor area
    this._cursorPos.copy(rawPos);
    let pos = this._snapToGrid(rawPos);

    if (this.tool === 'draw-contour' && this._previewPoints.length > 0) {
      pos = this._applyAngleSnap(pos);
    } else {
      this._angleSnapActive = false;
    }
    this._snappedCursorPos.copy(pos);

    if (this.app.ui) {
      this.app.ui.updateStatusBar(`X: ${pos.x.toFixed(1)}  Z: ${pos.y.toFixed(1)}`);
    }

    if (this._isPanning && this._panStart) {
      const dx = e.clientX - this._panStart.x;
      const dy = e.clientY - this._panStart.y;
      this.sm.pan2d(dx, dy);
      this._panStart = { x: e.clientX, y: e.clientY };
      this.redraw();
      return;
    }

    if (this._isDragging && this._dragTarget) {
      if (this.tool === 'move') {
        this._handleMoveDragMove(pos);
      } else {
        this._handleDragMove(pos);
      }
      return;
    }

    if (this.tool === 'draw-contour' && this._previewPoints.length > 0) {
      this.redraw();
      this._drawPreviewContour(pos);
    } else if (this.tool === 'draw-wall' && this._isDrawingWall && this._wallStart) {
      this.redraw();
      this._drawPreviewLine(this._wallStart, pos, 0x8844ff);
    } else if (this.tool === 'add-floor-hole' && this._isDrawingFloorHole && this._floorHolePoints.length > 0) {
      this.redraw();
      this._drawPreviewFloorHole(pos);
    }
  }

  onMouseUp(e) {
    if (e.button === 2 || e.button === 1) {
      this._isPanning = false;
      this._panStart = null;
    }
    if (e.button === 0) {
      this._isDragging = false;
      this._dragTarget = null;
    }
  }

  onMouseWheel(e) {
    if (this.app.mode !== '2d' && !this.app.splitMode) return;
    e.preventDefault();
    this.sm.zoom2d(e.deltaY);
    this.sm.onResize();
    this.redraw();
  }

  onDblClick(e) {
    if (this.app.mode !== '2d' && !this.app.splitMode) return;
    if (this.tool === 'draw-contour' && this._previewPoints.length >= 3) {
      this._closeContour();
    }
    if (this.tool === 'add-floor-hole' && this._floorHolePoints.length >= 3) {
      this._closeFloorHole();
    }
  }

  // ── Draw-contour ──────────────────────────────────────────────────────────
  _handleDrawContourDown(pos) {
    if (!this._isDrawingContour) {
      this._isDrawingContour = true;
      this._previewPoints = [];
    }

    if (this._previewPoints.length >= 3) {
      const first = this._previewPoints[0];
      if (pos.distanceTo(first) < SNAP_THRESHOLD) {
        this._closeContour();
        return;
      }
    }

    this._previewPoints.push(pos.clone());
    this.redraw();
    this._drawPreviewContour(pos);
  }

  _closeContour() {
    this._setActiveContour(this._previewPoints.map(p => p.clone()));
    this._isDrawingContour = false;
    this._previewPoints = [];
    if (this.app.ui) this.app.ui.updateBuildingInfo();
    this.redraw();
    if (this.app.splitMode) this.app.refreshLivePreview?.();
  }

  _drawPreviewContour(cursor) {
    const pts = this._previewPoints;
    if (pts.length === 0) return;

    if (pts.length >= 2) {
      const line = makeLine(pts, 0xaaaaaa);
      this.sm.editGroup.add(line);
    }

    const dashColor = this._angleSnapActive ? 0x00ddff : 0xffffff;
    const dash = makeDashedLine([pts[pts.length - 1], cursor], dashColor);
    this.sm.editGroup.add(dash);

    if (this._angleSnapActive && pts.length >= 2) {
      const last = pts[pts.length - 1];
      const prev = pts[pts.length - 2];
      const d1x = prev.x - last.x, d1y = prev.y - last.y;
      const d1l = Math.sqrt(d1x * d1x + d1y * d1y) || 1;
      const d2x = cursor.x - last.x, d2y = cursor.y - last.y;
      const d2l = Math.sqrt(d2x * d2x + d2y * d2y) || 1;
      const boxSize = RIGHT_ANGLE_BOX_SIZE;
      const n1 = { x: d1x / d1l * boxSize, y: d1y / d1l * boxSize };
      const n2 = { x: d2x / d2l * boxSize, y: d2y / d2l * boxSize };
      const boxPts = [
        new THREE.Vector2(last.x + n1.x, last.y + n1.y),
        new THREE.Vector2(last.x + n1.x + n2.x, last.y + n1.y + n2.y),
        new THREE.Vector2(last.x + n2.x, last.y + n2.y),
      ];
      const boxLine = makeLine(boxPts, 0x00ddff);
      this.sm.editGroup.add(boxLine);
    }

    const fc = makeCircle(pts[0].x, pts[0].y, 0.3, 0x44ff88);
    this.sm.editGroup.add(fc);

    for (const p of pts) {
      const dot = makeCircle(p.x, p.y, 0.12, 0xff8800);
      this.sm.editGroup.add(dot);
    }

    const cc = makeCircle(cursor.x, cursor.y, 0.1, this._angleSnapActive ? 0x00ddff : 0xffffff);
    this.sm.editGroup.add(cc);
  }

  // ── Draw-wall ─────────────────────────────────────────────────────────────
  _handleDrawWallDown(pos) {
    if (!this._isDrawingWall) {
      this._isDrawingWall = true;
      this._wallStart = pos.clone();
    } else {
      const floor = this.currentFloor;
      if (floor && this._wallStart.distanceTo(pos) > 0.1) {
        const wall = new Wall(this._wallStart, pos, this.building.wallThickness);
        floor.internalWalls.push(wall);
        this.selectedElement = wall;
        if (this.app.ui) this.app.ui.showProperties(wall);
        if (this.app.ui) this.app.ui.updateBuildingInfo();
        if (this.app.splitMode) this.app.refreshLivePreview?.();
      }
      this._isDrawingWall = false;
      this._wallStart = null;
      this.redraw();
    }
  }

  // ── Add opening (window / door / balcony) ─────────────────────────────────
  _handleAddOpeningDown(pos, type) {
    const result = this._findNearestWallSegment(pos, 2.0);
    if (!result) {
      if (this.app.ui) this.app.ui.showStatusHint('Click closer to a wall segment');
      return;
    }

    const { wallIndex, offset } = result;
    const ac = this.activeContour;
    const wn = ac.length;
    const wallLen = (wn >= 2 && wallIndex < wn)
      ? ac[wallIndex].distanceTo(ac[(wallIndex + 1) % wn])
      : 0;
    const floor = this.currentFloor;

    if (type === 'window') {
      const w = new WindowElement(wallIndex, offset, 1.2, 1.2, 0.9);
      if (offset + w.width > wallLen - 0.1) return;
      floor.windows.push(w);
      this.selectedElement = w;
      if (this.app.ui) this.app.ui.showProperties(w);
    } else if (type === 'door') {
      const d = new Door(wallIndex, offset, 0.9, 2.1, 'in');
      if (offset + d.width > wallLen - 0.1) return;
      floor.doors.push(d);
      this.selectedElement = d;
      if (this.app.ui) this.app.ui.showProperties(d);
    } else if (type === 'balcony') {
      const b = new Balcony(wallIndex, offset, 2.0, 1.2);
      if (offset + b.width > wallLen - 0.1) return;
      floor.balconies.push(b);
      this.selectedElement = b;
      if (this.app.ui) this.app.ui.showProperties(b);
    }

    if (this.app.ui) this.app.ui.updateBuildingInfo();
    if (this.app.splitMode) this.app.refreshLivePreview?.();
    this.redraw();
  }

  // ── Add elevator ──────────────────────────────────────────────────────────
  _handleAddElevatorDown(pos) {
    const floor = this.currentFloor;
    if (!floor) return;
    floor.elevator = new Elevator(pos, 1.5, 1.5);
    this.selectedElement = floor.elevator;
    if (this.app.ui) this.app.ui.showProperties(floor.elevator);
    if (this.app.ui) this.app.ui.updateBuildingInfo();
    if (this.app.splitMode) this.app.refreshLivePreview?.();
    this.redraw();
  }

  // ── Add stairs ────────────────────────────────────────────────────────────
  _handleAddStairsDown(pos) {
    const floor = this.currentFloor;
    if (!floor) return;
    floor.stairs = new Stairs(pos, 1.2, 3.0, 'north');
    this.selectedElement = floor.stairs;
    if (this.app.ui) this.app.ui.showProperties(floor.stairs);
    if (this.app.ui) this.app.ui.updateBuildingInfo();
    if (this.app.splitMode) this.app.refreshLivePreview?.();
    this.redraw();
  }

  // ── Add floor hole (drawn polygon) ───────────────────────────────────────
  _handleAddFloorHoleDown(pos) {
    if (!this._isDrawingFloorHole) {
      this._isDrawingFloorHole = true;
      this._floorHolePoints = [];
    }

    if (this._floorHolePoints.length >= 3) {
      const first = this._floorHolePoints[0];
      if (pos.distanceTo(first) < SNAP_THRESHOLD) {
        this._closeFloorHole();
        return;
      }
    }

    this._floorHolePoints.push(pos.clone());
    this.redraw();
    this._drawPreviewFloorHole(pos);
  }

  _closeFloorHole() {
    const floor = this.currentFloor;
    if (!floor || this._floorHolePoints.length < 3) return;
    const hole = new FloorHole(this._floorHolePoints.map(p => p.clone()));

    // Normalize hole winding to CW (needed for proper slab cutout)
    let holeArea = 0;
    const pts = hole.points;
    for (let j = 0; j < pts.length; j++) {
      const k = (j + 1) % pts.length;
      holeArea += pts[j].x * pts[k].y - pts[k].x * pts[j].y;
    }
    if (holeArea < 0) pts.reverse(); // ensure CW (positive shoelace)

    floor.floorHoles.push(hole);
    this.selectedElement = hole;
    if (this.app.ui) this.app.ui.showProperties(hole);
    if (this.app.ui) this.app.ui.updateBuildingInfo();
    this._isDrawingFloorHole = false;
    this._floorHolePoints = [];
    if (this.app.splitMode) this.app.refreshLivePreview?.();
    this.redraw();
  }

  _drawPreviewFloorHole(cursor) {
    const pts = this._floorHolePoints;
    if (pts.length === 0) return;

    if (pts.length >= 2) {
      const line = makeLine(pts, 0xff4444);
      this.sm.editGroup.add(line);
    }

    const dash = makeDashedLine([pts[pts.length - 1], cursor], 0xff6666);
    this.sm.editGroup.add(dash);

    const fc = makeCircle(pts[0].x, pts[0].y, 0.3, 0xff4444);
    this.sm.editGroup.add(fc);

    for (const p of pts) {
      this.sm.editGroup.add(makeCircle(p.x, p.y, 0.12, 0xff6666));
    }

    this.sm.editGroup.add(makeCircle(cursor.x, cursor.y, 0.1, 0xffffff));
  }

  // ── Select / drag ─────────────────────────────────────────────────────────
  _handleSelectDown(pos, e) {
    const contour = this.activeContour;

    if (contour.length >= 3) {
      const rh = this._getRotationHandlePos(contour);
      if (rh && pos.distanceTo(rh) < SNAP_THRESHOLD * ROTATION_HANDLE_HIT_MULTIPLIER) {
        const cent = this._getContourCentroid(contour);
        this._isDragging = true;
        this._dragTarget = {
          type: 'contour-rotate',
          centroid: cent.clone(),
          lastAngle: Math.atan2(pos.y - cent.y, pos.x - cent.x),
        };
        return;
      }
    }

    const vIdx = this._findNearestContourVertex(pos, SNAP_THRESHOLD);
    if (vIdx !== -1) {
      this._isDragging = true;
      this._dragTarget = { type: 'contour-vertex', index: vIdx };
      return;
    }

    const floor = this.currentFloor;
    if (floor) {
      for (let wi = 0; wi < floor.internalWalls.length; wi++) {
        const wall = floor.internalWalls[wi];
        if (pos.distanceTo(wall.start) < SNAP_THRESHOLD) {
          this._isDragging = true;
          this._dragTarget = { type: 'wall-start', wallIndex: wi };
          this.selectedElement = wall;
          if (this.app.ui) this.app.ui.showProperties(wall);
          return;
        }
        if (pos.distanceTo(wall.end) < SNAP_THRESHOLD) {
          this._isDragging = true;
          this._dragTarget = { type: 'wall-end', wallIndex: wi };
          this.selectedElement = wall;
          if (this.app.ui) this.app.ui.showProperties(wall);
          return;
        }
      }

      if (floor.elevator) {
        const ep = floor.elevator.position;
        if (pos.distanceTo(ep) < 1.0) {
          this._isDragging = true;
          this._dragTarget = { type: 'elevator' };
          this.selectedElement = floor.elevator;
          if (this.app.ui) this.app.ui.showProperties(floor.elevator);
          return;
        }
      }

      if (floor.stairs) {
        const sp = floor.stairs.position;
        if (pos.distanceTo(sp) < 1.5) {
          this._isDragging = true;
          this._dragTarget = { type: 'stairs' };
          this.selectedElement = floor.stairs;
          if (this.app.ui) this.app.ui.showProperties(floor.stairs);
          return;
        }
      }

      for (const win of floor.windows) {
        const wp = this._getElementWorldPos(win);
        if (wp && pos.distanceTo(wp) < 0.8) {
          this.selectedElement = win;
          if (this.app.ui) this.app.ui.showProperties(win);
          this.redraw();
          return;
        }
      }

      for (const door of floor.doors) {
        const dp = this._getElementWorldPos(door);
        if (dp && pos.distanceTo(dp) < 0.8) {
          this.selectedElement = door;
          if (this.app.ui) this.app.ui.showProperties(door);
          this.redraw();
          return;
        }
      }

      for (const bal of floor.balconies) {
        const bp = this._getElementWorldPos(bal);
        if (bp && pos.distanceTo(bp) < 1.2) {
          this.selectedElement = bal;
          if (this.app.ui) this.app.ui.showProperties(bal);
          this.redraw();
          return;
        }
      }

      for (let hi = 0; hi < floor.floorHoles.length; hi++) {
        const hole = floor.floorHoles[hi];
        if (this._pointInPolygon(pos, hole.points)) {
          this._isDragging = true;
          this._dragTarget = { type: 'floor-hole', holeIndex: hi, lastPos: pos.clone() };
          this.selectedElement = hole;
          if (this.app.ui) this.app.ui.showProperties(hole);
          return;
        }
      }
    }

    if (contour.length >= 3 && this._pointInPolygon(pos, contour)) {
      if (this.currentFloorIndex > 0 && floor && !floor.contour) {
        floor.contour = this.building.contour.map(p => p.clone());
        Building._normalizePoints(floor.contour);
      }
      this._isDragging = true;
      this._dragTarget = { type: 'contour-body', lastPos: pos.clone() };
      return;
    }

    this.selectedElement = null;
    if (this.app.ui) this.app.ui.clearProperties();
    this.redraw();
  }

  _handleDragMove(pos) {
    const dt = this._dragTarget;
    const floor = this.currentFloor;

    if (dt.type === 'contour-vertex') {
      if (this.currentFloorIndex > 0 && floor && !floor.contour) {
        floor.contour = this.building.contour.map(p => p.clone());
        Building._normalizePoints(floor.contour);
      }
      this.activeContour[dt.index].copy(pos);
    } else if (dt.type === 'contour-body') {
      const dx = pos.x - dt.lastPos.x;
      const dy = pos.y - dt.lastPos.y;
      const c = this.activeContour;
      for (const v of c) { v.x += dx; v.y += dy; }
      dt.lastPos.copy(pos);
    } else if (dt.type === 'contour-rotate') {
      const c = this.activeContour;
      const newAngle = Math.atan2(pos.y - dt.centroid.y, pos.x - dt.centroid.x);
      const delta = newAngle - dt.lastAngle;
      const cosD = Math.cos(delta), sinD = Math.sin(delta);
      for (const v of c) {
        const rx = v.x - dt.centroid.x;
        const rz = v.y - dt.centroid.y;
        v.x = dt.centroid.x + rx * cosD - rz * sinD;
        v.y = dt.centroid.y + rx * sinD + rz * cosD;
      }
      dt.lastAngle = newAngle;
    } else if (dt.type === 'wall-start' && floor) {
      floor.internalWalls[dt.wallIndex].start.copy(pos);
    } else if (dt.type === 'wall-end' && floor) {
      floor.internalWalls[dt.wallIndex].end.copy(pos);
    } else if (dt.type === 'elevator' && floor && floor.elevator) {
      floor.elevator.position.copy(pos);
    } else if (dt.type === 'stairs' && floor && floor.stairs) {
      floor.stairs.position.copy(pos);
    } else if (dt.type === 'floor-hole' && floor && floor.floorHoles[dt.holeIndex]) {
      const dx = pos.x - dt.lastPos.x;
      const dy = pos.y - dt.lastPos.y;
      floor.floorHoles[dt.holeIndex].translate(dx, dy);
      dt.lastPos.copy(pos);
    }
    this.redraw();
  }

  // ── Move tool ─────────────────────────────────────────────────────────────
  _handleMoveDown(pos) {
    const floor = this.currentFloor;
    if (!floor) return;

    if (floor.elevator) {
      const ev = floor.elevator;
      const hw = ev.width / 2 + 0.2, hd = ev.depth / 2 + 0.2;
      if (Math.abs(pos.x - ev.position.x) <= hw && Math.abs(pos.y - ev.position.y) <= hd) {
        this._isDragging = true;
        this._dragTarget = { type: 'elevator', lastPos: pos.clone() };
        this.selectedElement = ev;
        if (this.app.ui) this.app.ui.showProperties(ev);
        return;
      }
    }

    if (floor.stairs) {
      const st = floor.stairs;
      const cx = st.position.x + st.width / 2;
      const cz = st.position.y + st.runLength / 2;
      if (Math.abs(pos.x - cx) <= st.width / 2 + 0.3 && Math.abs(pos.y - cz) <= st.runLength / 2 + 0.3) {
        this._isDragging = true;
        this._dragTarget = { type: 'stairs', lastPos: pos.clone() };
        this.selectedElement = st;
        if (this.app.ui) this.app.ui.showProperties(st);
        return;
      }
    }

    for (let hi = 0; hi < floor.floorHoles.length; hi++) {
      const hole = floor.floorHoles[hi];
      if (this._pointInPolygon(pos, hole.points)) {
        this._isDragging = true;
        this._dragTarget = { type: 'floor-hole', holeIndex: hi, lastPos: pos.clone() };
        this.selectedElement = hole;
        if (this.app.ui) this.app.ui.showProperties(hole);
        return;
      }
    }

    for (let wi = 0; wi < floor.windows.length; wi++) {
      const win = floor.windows[wi];
      const wp = this._getElementWorldPos(win);
      if (wp && pos.distanceTo(wp) < 0.8) {
        this._isDragging = true;
        this._dragTarget = { type: 'window', elementIndex: wi };
        this.selectedElement = win;
        if (this.app.ui) this.app.ui.showProperties(win);
        return;
      }
    }

    for (let di = 0; di < floor.doors.length; di++) {
      const door = floor.doors[di];
      const dp = this._getElementWorldPos(door);
      if (dp && pos.distanceTo(dp) < 0.8) {
        this._isDragging = true;
        this._dragTarget = { type: 'door', elementIndex: di };
        this.selectedElement = door;
        if (this.app.ui) this.app.ui.showProperties(door);
        return;
      }
    }

    for (let bi = 0; bi < floor.balconies.length; bi++) {
      const bal = floor.balconies[bi];
      const bp = this._getElementWorldPos(bal);
      if (bp && pos.distanceTo(bp) < 1.2) {
        this._isDragging = true;
        this._dragTarget = { type: 'balcony', elementIndex: bi };
        this.selectedElement = bal;
        if (this.app.ui) this.app.ui.showProperties(bal);
        return;
      }
    }
  }

  _handleMoveDragMove(pos) {
    const dt = this._dragTarget;
    const floor = this.currentFloor;
    if (!floor || !dt) return;

    if (dt.type === 'elevator' && floor.elevator) {
      const dx = pos.x - dt.lastPos.x;
      const dy = pos.y - dt.lastPos.y;
      floor.elevator.position.x += dx;
      floor.elevator.position.y += dy;
      dt.lastPos.copy(pos);
    } else if (dt.type === 'stairs' && floor.stairs) {
      const dx = pos.x - dt.lastPos.x;
      const dy = pos.y - dt.lastPos.y;
      floor.stairs.position.x += dx;
      floor.stairs.position.y += dy;
      dt.lastPos.copy(pos);
    } else if (dt.type === 'floor-hole' && floor.floorHoles[dt.holeIndex]) {
      const dx = pos.x - dt.lastPos.x;
      const dy = pos.y - dt.lastPos.y;
      floor.floorHoles[dt.holeIndex].translate(dx, dy);
      dt.lastPos.copy(pos);
    } else if (dt.type === 'window' && floor.windows[dt.elementIndex]) {
      const result = this._findNearestWallSegment(pos, 4.0);
      if (result) {
        const el = floor.windows[dt.elementIndex];
        el.wallIndex = result.wallIndex;
        el.offsetAlongWall = Math.max(0, result.offset - el.width / 2);
      }
    } else if (dt.type === 'door' && floor.doors[dt.elementIndex]) {
      const result = this._findNearestWallSegment(pos, 4.0);
      if (result) {
        const el = floor.doors[dt.elementIndex];
        el.wallIndex = result.wallIndex;
        el.offsetAlongWall = Math.max(0, result.offset - el.width / 2);
      }
    } else if (dt.type === 'balcony' && floor.balconies[dt.elementIndex]) {
      const result = this._findNearestWallSegment(pos, 4.0);
      if (result) {
        const el = floor.balconies[dt.elementIndex];
        el.wallIndex = result.wallIndex;
        el.offsetAlongWall = Math.max(0, result.offset - el.width / 2);
      }
    }
    this.redraw();
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  _pointInPolygon(point, polygon) {
    if (!polygon || polygon.length < 3) return false;
    let inside = false;
    const px = point.x, py = point.y;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].x, yi = polygon[i].y;
      const xj = polygon[j].x, yj = polygon[j].y;
      const intersect = ((yi > py) !== (yj > py)) &&
        (px < (xj - xi) * (py - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  _snapToGrid(v) {
    return GridSystem.snap(v);
  }

  _getContourCentroid(c) {
    const cx = c.reduce((s, p) => s + p.x, 0) / c.length;
    const cy = c.reduce((s, p) => s + p.y, 0) / c.length;
    return new THREE.Vector2(cx, cy);
  }

  _getRotationHandlePos(c) {
    if (!c || c.length < 3) return null;
    const cent = this._getContourCentroid(c);
    return new THREE.Vector2(cent.x, cent.y - ROTATION_HANDLE_OFFSET);
  }

  _applyAngleSnap(gridPos) {
    const THRESH_RAD = ANGLE_SNAP_THRESHOLD_DEG * Math.PI / 180;
    const pts = this._previewPoints;
    if (pts.length === 0) { this._angleSnapActive = false; return gridPos; }

    const last = pts[pts.length - 1];
    const toPos = new THREE.Vector2().subVectors(gridPos, last);
    const toPosLen = toPos.length();
    if (toPosLen < 0.01) { this._angleSnapActive = false; return gridPos; }
    const toN = toPos.clone().divideScalar(toPosLen);

    let snapDirs;
    if (pts.length >= 2) {
      const prev = pts[pts.length - 2];
      const prevDx = last.x - prev.x, prevDy = last.y - prev.y;
      const prevLen = Math.sqrt(prevDx * prevDx + prevDy * prevDy);
      if (prevLen < 0.001) { this._angleSnapActive = false; return gridPos; }
      const px = prevDx / prevLen, py = prevDy / prevLen;
      snapDirs = [
        new THREE.Vector2( px,  py),
        new THREE.Vector2(-py,  px),
        new THREE.Vector2(-px, -py),
        new THREE.Vector2( py, -px),
      ];
    } else {
      snapDirs = [
        new THREE.Vector2(1, 0), new THREE.Vector2(-1, 0),
        new THREE.Vector2(0, 1), new THREE.Vector2(0, -1),
      ];
    }

    let bestDir = null, bestDot = Math.cos(THRESH_RAD);
    for (const dir of snapDirs) {
      const dot = toN.dot(dir);
      if (dot > bestDot) { bestDot = dot; bestDir = dir; }
    }

    if (bestDir) {
      this._angleSnapActive = true;
      return new THREE.Vector2(
        last.x + bestDir.x * toPosLen,
        last.y + bestDir.y * toPosLen,
      );
    }
    this._angleSnapActive = false;
    return gridPos;
  }

  _findNearestContourVertex(pos, radius) {
    const contour = this.activeContour;
    let best = -1, bestDist = radius;
    for (let i = 0; i < contour.length; i++) {
      const d = pos.distanceTo(contour[i]);
      if (d < bestDist) { bestDist = d; best = i; }
    }
    return best;
  }

  _findNearestWallSegment(pos, maxDist) {
    const contour = this.activeContour;
    const n = contour.length;
    if (n < 2) return null;

    let bestDist = maxDist;
    let bestWallIndex = -1;
    let bestOffset = 0;

    for (let i = 0; i < n; i++) {
      const p1 = contour[i];
      const p2 = contour[(i + 1) % n];
      const segDir = new THREE.Vector2().subVectors(p2, p1);
      const segLen = segDir.length();
      if (segLen < 0.001) continue;
      const segDirN = segDir.clone().divideScalar(segLen);

      const toPos = new THREE.Vector2().subVectors(pos, p1);
      let t = toPos.dot(segDirN);
      t = Math.max(0, Math.min(segLen, t));

      const closest = new THREE.Vector2(
        p1.x + segDirN.x * t,
        p1.y + segDirN.y * t
      );
      const dist = pos.distanceTo(closest);
      if (dist < bestDist) {
        bestDist = dist;
        bestWallIndex = i;
        bestOffset = t;
      }
    }

    if (bestWallIndex === -1) return null;
    return { wallIndex: bestWallIndex, offset: Math.round(bestOffset * 10) / 10 };
  }

  _getWallWorldPositions(wallIndex) {
    const contour = this.activeContour;
    const n = contour.length;
    if (n < 2 || wallIndex >= n) return null;
    const p1 = contour[wallIndex];
    const p2 = contour[(wallIndex + 1) % n];
    return { p1, p2 };
  }

  _getElementWorldPos(el) {
    const wp = this._getWallWorldPositions(el.wallIndex);
    if (!wp) return null;
    const { p1, p2 } = wp;
    const dir = new THREE.Vector2().subVectors(p2, p1).normalize();
    const midOff = el.offsetAlongWall + (el.width || 0) / 2;
    return new THREE.Vector2(p1.x + dir.x * midOff, p1.y + dir.y * midOff);
  }

  // ── Dimension labels ──────────────────────────────────────────────────────
  _interiorAngleDeg(prev, curr, next) {
    const d1x = curr.x - prev.x, d1y = curr.y - prev.y;
    const d1len = Math.sqrt(d1x * d1x + d1y * d1y);
    if (d1len < 0.001) return 0;
    const d2x = next.x - curr.x, d2y = next.y - curr.y;
    const d2len = Math.sqrt(d2x * d2x + d2y * d2y);
    if (d2len < 0.001) return 0;
    const rx = -d1x / d1len, ry = -d1y / d1len;
    const ox = d2x / d2len, oy = d2y / d2len;
    const dot   = rx * ox + ry * oy;
    const cross = rx * oy - ry * ox;
    let angle = Math.acos(Math.max(-1, Math.min(1, dot)));
    if (cross < 0) angle = 2 * Math.PI - angle;
    return angle * 180 / Math.PI;
  }

  _worldToScreen(wx, wz) {
    return this.sm.worldToScreen(wx, wz);
  }

  _updateContourLabels() {
    const container = this._labelContainer;
    if (!container) return;
    container.innerHTML = '';
    if (this.app.mode !== '2d' && !this.app.splitMode) return;

    const canEdit = (this.tool === 'select' || this.tool === 'move');
    const isPreview = this._isDrawingContour && this._previewPoints.length >= 1;

    const pts = isPreview ? this._previewPoints : (() => {
      const c = this.activeContour;
      return (c && c.length >= 2) ? c : null;
    })();
    if (!pts) return;

    const n = pts.length;

    // Segment length labels
    const segCount = isPreview ? (n - 1) : n;
    for (let i = 0; i < segCount; i++) {
      const p1 = pts[i];
      const p2 = pts[(i + 1) % n];
      const dx = p2.x - p1.x, dz = p2.y - p1.y;
      const len = Math.sqrt(dx * dx + dz * dz);
      if (len < 0.01) continue;

      const mx = (p1.x + p2.x) / 2 + (dz / len) * 0.35;
      const mz = (p1.y + p2.y) / 2 + (-dx / len) * 0.35;
      const sc = this._worldToScreen(mx, mz);

      const lbl = document.createElement('div');
      lbl.className = 'dim-label' + (canEdit && !isPreview ? ' clickable' : '');
      lbl.textContent = len.toFixed(2) + ' m';
      lbl.style.left = sc.x + 'px';
      lbl.style.top  = sc.y + 'px';
      if (canEdit && !isPreview) {
        const si = i;
        lbl.addEventListener('click', e => {
          e.stopPropagation();
          this._showDimEdit(sc.x, sc.y, len, 'length', si);
        });
      }
      container.appendChild(lbl);
    }

    // Preview: length label for cursor→last-point
    if (isPreview) {
      const last   = pts[n - 1];
      const cursor = this._snappedCursorPos;
      const dx = cursor.x - last.x, dz = cursor.y - last.y;
      const len = Math.sqrt(dx * dx + dz * dz);
      if (len > 0.01) {
        const sc = this._worldToScreen((last.x + cursor.x) / 2, (last.y + cursor.y) / 2);
        const lbl = document.createElement('div');
        lbl.className = 'dim-label dim-preview';
        lbl.textContent = len.toFixed(2) + ' m';
        lbl.style.left = sc.x + 'px';
        lbl.style.top  = sc.y + 'px';
        container.appendChild(lbl);
      }
    }

    // Angle labels at vertices
    if (!isPreview && n >= 3) {
      for (let i = 0; i < n; i++) {
        const prev  = pts[(i - 1 + n) % n];
        const curr  = pts[i];
        const next  = pts[(i + 1) % n];
        const angle = this._interiorAngleDeg(prev, curr, next);

        const d1x = -(curr.x - prev.x), d1y = -(curr.y - prev.y);
        const d2x =  (next.x - curr.x), d2y =  (next.y - curr.y);
        const d1l = Math.sqrt(d1x * d1x + d1y * d1y) || 1;
        const d2l = Math.sqrt(d2x * d2x + d2y * d2y) || 1;
        const bx  = d1x / d1l + d2x / d2l;
        const by  = d1y / d1l + d2y / d2l;
        const bl  = Math.sqrt(bx * bx + by * by) || 1;
        const OFF = 0.8;
        const sc  = this._worldToScreen(curr.x + bx / bl * OFF, curr.y + by / bl * OFF);

        const lbl = document.createElement('div');
        lbl.className = 'dim-label-angle' + (canEdit ? ' clickable' : '');
        lbl.textContent = angle.toFixed(1) + '°';
        lbl.style.left = sc.x + 'px';
        lbl.style.top  = sc.y + 'px';
        if (canEdit) {
          const vi = i;
          lbl.addEventListener('click', e => {
            e.stopPropagation();
            this._showDimEdit(sc.x, sc.y, angle, 'angle', vi);
          });
        }
        container.appendChild(lbl);
      }
    }

    // Preview: live angle label at last vertex
    if (isPreview && n >= 2) {
      const prev   = pts[n - 2];
      const curr   = pts[n - 1];
      const cursor = this._snappedCursorPos;
      const dx = cursor.x - curr.x, dz = cursor.y - curr.y;
      if (Math.sqrt(dx * dx + dz * dz) > 0.01) {
        const angle = this._interiorAngleDeg(prev, curr, cursor);
        const sc    = this._worldToScreen(curr.x, curr.y);
        const lbl   = document.createElement('div');
        const is90  = this._angleSnapActive;
        lbl.className = 'dim-label-angle dim-preview' + (is90 ? ' snap-highlight' : '');
        lbl.textContent = (is90 ? '⊾ ' : '') + angle.toFixed(1) + '°';
        lbl.style.left = (sc.x + 10) + 'px';
        lbl.style.top  = (sc.y - 10) + 'px';
        container.appendChild(lbl);
      }
    }
  }

  _showDimEdit(sx, sy, currentVal, type, index) {
    const popup = this._dimEditPopup;
    const input = this._dimEditInput;
    if (!popup || !input) return;

    const labelEl = popup.querySelector('.dim-edit-type-label');
    if (labelEl) labelEl.textContent = type === 'length' ? 'Length (m):' : 'Angle (°):';

    input.step = type === 'length' ? '0.01' : '1';
    input.min  = type === 'length' ? '0.01' : '0.1';
    input.max  = type === 'angle'  ? String(MAX_ANGLE_DEG) : '';
    input.value = currentVal.toFixed(type === 'length' ? 2 : 1);

    popup.style.display = 'block';
    popup.style.left    = sx + 'px';
    popup.style.top     = sy + 'px';

    this._pendingDimEdit = { type, index };

    input.onkeydown = e => {
      if (e.key === 'Enter') {
        const v = parseFloat(input.value);
        if (!isNaN(v)) {
          const contour = this.activeContour;
          if (type === 'length') {
            this._applySegmentLengthEdit(contour, index, v);
          } else {
            this._applyAngleEdit(contour, index, v);
          }
          this.redraw();
          if (this.app.ui) this.app.ui.updateBuildingInfo();
        }
        this._hideDimEdit();
      } else if (e.key === 'Escape') {
        this._hideDimEdit();
      }
      e.stopPropagation();
    };

    setTimeout(() => { input.focus(); input.select(); }, 0);
  }

  _hideDimEdit() {
    if (this._dimEditPopup) this._dimEditPopup.style.display = 'none';
    this._pendingDimEdit = null;
  }

  _applySegmentLengthEdit(contour, segIndex, newLen) {
    if (!contour || newLen < 0.01) return;
    const n = contour.length;
    const p1 = contour[segIndex];
    const farIdx = (segIndex + 1) % n;
    const p2 = contour[farIdx];
    const dx = p2.x - p1.x, dz = p2.y - p1.y;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len < 0.001) return;

    const scale  = newLen / len;
    const newP2x = p1.x + dx * scale;
    const newP2z = p1.y + dz * scale;
    const deltaX = newP2x - p2.x;
    const deltaZ = newP2z - p2.y;

    if (farIdx === 0) {
      for (let i = 0; i < n - 1; i++) {
        contour[i].x += deltaX;
        contour[i].y += deltaZ;
      }
    } else {
      for (let i = segIndex + 1; i < n; i++) {
        contour[i].x += deltaX;
        contour[i].y += deltaZ;
      }
    }
  }

  _applyAngleEdit(contour, vertexIndex, newAngleDeg) {
    if (!contour) return;
    const clampedAngle = Math.max(0.1, Math.min(MAX_ANGLE_DEG, newAngleDeg));
    const n    = contour.length;
    const prev = contour[(vertexIndex - 1 + n) % n];
    const curr = contour[vertexIndex];
    const next = contour[(vertexIndex + 1) % n];

    const currAngle = this._interiorAngleDeg(prev, curr, next);
    const delta     = clampedAngle - currAngle;
    const rotRad    = delta * Math.PI / 180;

    const dx = next.x - curr.x, dz = next.y - curr.y;
    const cosR = Math.cos(rotRad), sinR = Math.sin(rotRad);
    contour[(vertexIndex + 1) % n].set(
      curr.x + dx * cosR - dz * sinR,
      curr.y + dx * sinR + dz * cosR,
    );
  }

  redraw() {
    while (this.sm.editGroup.children.length) {
      const child = this.sm.editGroup.children[0];
      child.geometry?.dispose();
      child.material?.dispose();
      this.sm.editGroup.remove(child);
    }

    this._drawContourAndVertices();

    const floor = this.currentFloor;
    if (floor) {
      this._drawFloorElements(floor);
    }

    this._updateContourLabels();
  }

  _drawContourAndVertices() {
    for (let bi = 0; bi < this.app.buildings.length; bi++) {
      if (bi === this.app.currentBuildingIndex) continue;
      const b = this.app.buildings[bi];
      const bc = b.contour;
      if (bc.length < 2) continue;
      if (this.ghostFill && bc.length >= 3) {
        const fill = makeFilledContour(bc, 0x555566, 0.09);
        this.sm.editGroup.add(fill);
      }
      this.sm.editGroup.add(makeLineLoop(bc, 0x556655));
      const cx = bc.reduce((s, p) => s + p.x, 0) / bc.length;
      const cz = bc.reduce((s, p) => s + p.y, 0) / bc.length;
      this.sm.editGroup.add(makeCircle(cx, cz, 0.2, 0x556655));
    }

    const base = this.building.contour;
    const floor = this.currentFloor;
    const hasFloorOverride = floor && floor.contour && floor.contour.length >= 3;
    const c = hasFloorOverride ? floor.contour : base;

    if (base.length === 0 && !hasFloorOverride) return;

    if (hasFloorOverride && base.length >= 2) {
      if (this.ghostFill && base.length >= 3) {
        this.sm.editGroup.add(makeFilledContour(base, 0x445566, 0.10));
      }
      this.sm.editGroup.add(makeLineLoop(base, 0x557799));
    }

    if (c.length === 0) return;

    if (this.ghostFill && c.length >= 3) {
      const fill = makeFilledContour(c, hasFloorOverride ? 0xaaffcc : 0xaaccff, 0.18);
      this.sm.editGroup.add(fill);
    }

    if (c.length >= 2) {
      const lineColor = hasFloorOverride ? 0x44ffaa : 0xffcc00;
      const loop = makeLineLoop(c, lineColor);
      this.sm.editGroup.add(loop);
    }

    for (let i = 0; i < c.length; i++) {
      const isSelected = (
        this._isDragging &&
        this._dragTarget?.type === 'contour-vertex' &&
        this._dragTarget?.index === i
      );
      const color = isSelected ? 0x44aaff : (hasFloorOverride ? 0x44ff88 : 0xff8800);
      const circle = makeCircle(c[i].x, c[i].y, 0.15, color);
      this.sm.editGroup.add(circle);
    }

    const n = c.length;
    if (n >= 3) {
      for (let i = 0; i < n; i++) {
        const p1 = c[i], p2 = c[(i + 1) % n];
        const mx = (p1.x + p2.x) / 2, mz = (p1.y + p2.y) / 2;
        const dx = p2.x - p1.x, dz = p2.y - p1.y;
        const len = Math.sqrt(dx * dx + dz * dz);
        if (len < 0.001) continue;
        const nx = dz / len, nz = -dx / len;
        const tickLen = 0.25;
        const tickPts = [
          new THREE.Vector2(mx, mz),
          new THREE.Vector2(mx + nx * tickLen, mz + nz * tickLen)
        ];
        const tick = makeLine(tickPts, hasFloorOverride ? 0x448844 : 0x888844);
        this.sm.editGroup.add(tick);
      }
    }

    if (n >= 3 && this.tool === 'select') {
      const rh = this._getRotationHandlePos(c);
      const cent = this._getContourCentroid(c);
      if (rh) {
        const isRotating = this._isDragging && this._dragTarget?.type === 'contour-rotate';
        const rhColor = isRotating ? 0xffffff : 0x00ddff;
        this.sm.editGroup.add(makeDashedLine([cent, rh], 0x00aacc));
        this.sm.editGroup.add(makeCircle(rh.x, rh.y, 0.22, rhColor));
        const ARC_R        = 0.35;
        const ARC_SEGMENTS = 8;
        const ARC_SWEEP    = 1.4;
        const ARC_START    = -0.4;
        const arcPts1 = [], arcPts2 = [];
        for (let i = 0; i <= ARC_SEGMENTS; i++) {
          const a = ARC_START + i / ARC_SEGMENTS * ARC_SWEEP;
          arcPts1.push(new THREE.Vector2(rh.x + Math.cos(a) * ARC_R, rh.y + Math.sin(a) * ARC_R));
        }
        for (let i = 0; i <= ARC_SEGMENTS; i++) {
          const a = Math.PI + ARC_START + i / ARC_SEGMENTS * ARC_SWEEP;
          arcPts2.push(new THREE.Vector2(rh.x + Math.cos(a) * ARC_R, rh.y + Math.sin(a) * ARC_R));
        }
        this.sm.editGroup.add(makeLine(arcPts1, rhColor));
        this.sm.editGroup.add(makeLine(arcPts2, rhColor));
      }
    }
  }

  _drawFloorElements(floor) {
    for (const wall of floor.internalWalls) {
      const line = makeLine([wall.start, wall.end], 0x8844ff, 2);
      this.sm.editGroup.add(line);
      const isSelStart = (
        this._isDragging && this._dragTarget?.type === 'wall-start' &&
        this._dragTarget?.wallIndex === floor.internalWalls.indexOf(wall)
      );
      const isSelEnd = (
        this._isDragging && this._dragTarget?.type === 'wall-end' &&
        this._dragTarget?.wallIndex === floor.internalWalls.indexOf(wall)
      );
      this.sm.editGroup.add(makeCircle(wall.start.x, wall.start.y, 0.12, isSelStart ? 0x44aaff : 0xaa88ff));
      this.sm.editGroup.add(makeCircle(wall.end.x, wall.end.y, 0.12, isSelEnd ? 0x44aaff : 0xaa88ff));
    }

    for (const win of floor.windows) {
      this._drawOpeningMarker(win, 0x44ffff, 'window');
    }

    for (const door of floor.doors) {
      this._drawOpeningMarker(door, 0xffff44, 'door');
    }

    for (const bal of floor.balconies) {
      this._drawBalconyMarker(bal);
    }

    if (floor.elevator) {
      const ev = floor.elevator;
      const rect = makeFilledRect(ev.position.x, ev.position.y, ev.width, ev.depth, 0xff4444, 0.02);
      this.sm.editGroup.add(rect);
      const outline = makeLineLoop([
        new THREE.Vector2(ev.position.x - ev.width / 2, ev.position.y - ev.depth / 2),
        new THREE.Vector2(ev.position.x + ev.width / 2, ev.position.y - ev.depth / 2),
        new THREE.Vector2(ev.position.x + ev.width / 2, ev.position.y + ev.depth / 2),
        new THREE.Vector2(ev.position.x - ev.width / 2, ev.position.y + ev.depth / 2)
      ], 0xff6666);
      this.sm.editGroup.add(outline);
      this.sm.editGroup.add(makeLine([
        new THREE.Vector2(ev.position.x - ev.width / 2, ev.position.y - ev.depth / 2),
        new THREE.Vector2(ev.position.x + ev.width / 2, ev.position.y + ev.depth / 2)
      ], 0xff6666));
      this.sm.editGroup.add(makeLine([
        new THREE.Vector2(ev.position.x + ev.width / 2, ev.position.y - ev.depth / 2),
        new THREE.Vector2(ev.position.x - ev.width / 2, ev.position.y + ev.depth / 2)
      ], 0xff6666));
    }

    if (floor.stairs) {
      const st = floor.stairs;
      const px = st.position.x, pz = st.position.y;
      const rect = makeFilledRect(px + st.width / 2, pz + st.runLength / 2, st.width, st.runLength, 0xff8844, 0.02);
      this.sm.editGroup.add(rect);
      const outline = makeLineLoop([
        new THREE.Vector2(px, pz),
        new THREE.Vector2(px + st.width, pz),
        new THREE.Vector2(px + st.width, pz + st.runLength),
        new THREE.Vector2(px, pz + st.runLength)
      ], 0xffaa66);
      this.sm.editGroup.add(outline);
      const numLines = 5;
      for (let i = 1; i < numLines; i++) {
        const t = (i / numLines) * st.runLength;
        this.sm.editGroup.add(makeLine([
          new THREE.Vector2(px, pz + t),
          new THREE.Vector2(px + st.width, pz + t)
        ], 0xffaa66));
      }
    }

    for (const hole of floor.floorHoles) {
      if (!hole.points || hole.points.length < 3) continue;
      const fill = makeFilledContour(hole.points, 0x110000, 0.70);
      fill.position.y = 0.02;
      this.sm.editGroup.add(fill);
      this.sm.editGroup.add(makeLineLoop(hole.points, 0xff4444));
      const c = hole.position;
      const r = hole.radius * 0.5;
      this.sm.editGroup.add(makeLine([
        new THREE.Vector2(c.x - r, c.y - r),
        new THREE.Vector2(c.x + r, c.y + r)
      ], 0xff4444));
      this.sm.editGroup.add(makeLine([
        new THREE.Vector2(c.x + r, c.y - r),
        new THREE.Vector2(c.x - r, c.y + r)
      ], 0xff4444));
      if (this.selectedElement === hole) {
        this.sm.editGroup.add(makeCircle(c.x, c.y, 0.2, 0x44aaff));
      }
    }
  }

  _drawOpeningMarker(el, color, type) {
    const wp = this._getWallWorldPositions(el.wallIndex);
    if (!wp) return;
    const { p1, p2 } = wp;
    const dir = new THREE.Vector2().subVectors(p2, p1);
    dir.normalize();

    const startP = new THREE.Vector2(
      p1.x + dir.x * el.offsetAlongWall,
      p1.y + dir.y * el.offsetAlongWall
    );
    const endP = new THREE.Vector2(
      p1.x + dir.x * (el.offsetAlongWall + el.width),
      p1.y + dir.y * (el.offsetAlongWall + el.width)
    );

    const nx = dir.y, nz = -dir.x;
    const inset = 0.15;
    const startIn = new THREE.Vector2(startP.x + nx * inset, startP.y + nz * inset);
    const endIn = new THREE.Vector2(endP.x + nx * inset, endP.y + nz * inset);

    this.sm.editGroup.add(makeLine([startP, endP], color, 2));
    this.sm.editGroup.add(makeLine([startIn, endIn], color));
    this.sm.editGroup.add(makeLine([startP, startIn], color));
    this.sm.editGroup.add(makeLine([endP, endIn], color));

    if (this.selectedElement === el) {
      const midP = new THREE.Vector2((startP.x + endP.x) / 2, (startP.y + endP.y) / 2);
      this.sm.editGroup.add(makeCircle(midP.x, midP.y, 0.2, 0x44aaff));
    }
  }

  _drawBalconyMarker(bal) {
    const wp = this._getWallWorldPositions(bal.wallIndex);
    if (!wp) return;
    const { p1, p2 } = wp;
    const dir = new THREE.Vector2().subVectors(p2, p1).normalize();

    const ox = -dir.y, oz = dir.x;

    const startP = new THREE.Vector2(
      p1.x + dir.x * bal.offsetAlongWall,
      p1.y + dir.y * bal.offsetAlongWall
    );
    const endP = new THREE.Vector2(
      p1.x + dir.x * (bal.offsetAlongWall + bal.width),
      p1.y + dir.y * (bal.offsetAlongWall + bal.width)
    );

    const startOut = new THREE.Vector2(startP.x + ox * bal.depth, startP.y + oz * bal.depth);
    const endOut = new THREE.Vector2(endP.x + ox * bal.depth, endP.y + oz * bal.depth);

    const corners = [startP, endP, endOut, startOut];
    this.sm.editGroup.add(makeLineLoop(corners, 0x44ff88));
    const cx = (startP.x + endP.x + startOut.x + endOut.x) / 4;
    const cz = (startP.y + endP.y + startOut.y + endOut.y) / 4;
    const fill = makeFilledRect(cx, cz, bal.width, bal.depth, 0x44ff88, 0.018);
    this.sm.editGroup.add(fill);

    if (this.selectedElement === bal) {
      this.sm.editGroup.add(makeCircle(cx, cz, 0.2, 0x44aaff));
    }
  }

  _drawPreviewLine(a, b, color) {
    const dash = makeDashedLine([a, b], color);
    this.sm.editGroup.add(dash);
    this.sm.editGroup.add(makeCircle(b.x, b.y, 0.1, color));
  }
}
