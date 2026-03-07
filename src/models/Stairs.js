import * as THREE from 'three';
export class Stairs {
  constructor(position, width = 1.2, runLength = 3.0, direction = 'north', height = 2.7) {
    this.position = position.clone();
    this.width = width;
    this.runLength = runLength;
    this.direction = direction;
    this.height = height;   // total rise (metres); stairs climb from 0 to this height
  }
  toJSON() {
    return {
      position: { x: this.position.x, y: this.position.y },
      width: this.width,
      runLength: this.runLength,
      direction: this.direction,
      height: this.height,
    };
  }
  static fromJSON(d) {
    return new Stairs(
      new THREE.Vector2(d.position.x, d.position.y),
      d.width, d.runLength, d.direction,
      d.height ?? 2.7
    );
  }
}
