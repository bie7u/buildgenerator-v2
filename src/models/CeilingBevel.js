export class CeilingBevel {
  constructor(wallIndex, heightStart, heightEnd, offsetStart = 0, offsetEnd = null, depth = 2.0) {
    this.wallIndex = wallIndex;
    this.heightStart = heightStart;
    this.heightEnd = heightEnd;
    this.offsetStart = offsetStart;
    this.offsetEnd = offsetEnd;
    this.depth = depth;
  }
  toJSON() {
    return {
      wallIndex: this.wallIndex,
      heightStart: this.heightStart,
      heightEnd: this.heightEnd,
      offsetStart: this.offsetStart,
      offsetEnd: this.offsetEnd,
      depth: this.depth,
    };
  }
  static fromJSON(d) {
    return new CeilingBevel(
      d.wallIndex, d.heightStart, d.heightEnd,
      d.offsetStart ?? 0, d.offsetEnd ?? null, d.depth ?? 2.0
    );
  }
}
