export class Roof {
  constructor() {
    this.type = 'gabled';
    this.ridgeHeight = 3.0;
    this.overhang = 0.6;
    this.pitch = 30;
    this.dormers = [];
  }

  addDormer(dormer) { this.dormers.push(dormer); }
  removeDormer(index) { this.dormers.splice(index, 1); }

  toJSON() {
    return {
      type: this.type,
      ridgeHeight: this.ridgeHeight,
      overhang: this.overhang,
      pitch: this.pitch,
      dormers: this.dormers.map(d => d.toJSON()),
    };
  }

  static fromJSON(data) {
    const r = new Roof();
    r.type = data.type || 'gabled';
    r.ridgeHeight = data.ridgeHeight ?? 3.0;
    r.overhang = data.overhang ?? 0.6;
    r.pitch = data.pitch ?? 30;
    r.dormers = (data.dormers || []).map(d => DormerWindow.fromJSON(d));
    return r;
  }
}

export class DormerWindow {
  constructor(wallIndex = 0, offsetAlongWall = 1.0, width = 1.2, height = 1.0) {
    this.wallIndex = wallIndex;
    this.offsetAlongWall = offsetAlongWall;
    this.width = width;
    this.height = height;
  }
  toJSON() {
    return {
      wallIndex: this.wallIndex,
      offsetAlongWall: this.offsetAlongWall,
      width: this.width,
      height: this.height,
    };
  }
  static fromJSON(d) {
    return new DormerWindow(d.wallIndex, d.offsetAlongWall, d.width, d.height);
  }
}
