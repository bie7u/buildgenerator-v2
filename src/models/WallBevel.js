export class WallBevel {
  constructor(wallIndex, heightStart, heightEnd, offsetStart = 0, offsetEnd = null) {
    this.wallIndex = wallIndex;
    this.heightStart = heightStart;
    this.heightEnd = heightEnd;
    this.offsetStart = offsetStart;
    this.offsetEnd = offsetEnd;
  }
  toJSON() {
    return {
      wallIndex: this.wallIndex,
      heightStart: this.heightStart,
      heightEnd: this.heightEnd,
      offsetStart: this.offsetStart,
      offsetEnd: this.offsetEnd,
    };
  }
  static fromJSON(d) {
    return new WallBevel(d.wallIndex, d.heightStart, d.heightEnd, d.offsetStart ?? 0, d.offsetEnd ?? null);
  }
}
