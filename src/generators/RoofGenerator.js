import * as THREE from 'three';

export class RoofGenerator {
  constructor(sceneManager) {
    this.sm = sceneManager;
    this.roofMat      = new THREE.MeshLambertMaterial({ color: 0x8b4513, side: THREE.DoubleSide });
    this.roofFrameMat = new THREE.MeshLambertMaterial({ color: 0x5c3317 });
    this.dormerWallMat   = new THREE.MeshLambertMaterial({ color: 0xe8e8e0 });
    this.dormerWindowMat = new THREE.MeshLambertMaterial({
      color: 0x88bbff, transparent: true, opacity: 0.4, side: THREE.DoubleSide
    });
    this._roofGroup = null;
  }

  generate(building, totalHeight, parentGroup) {
    if (this._roofGroup && this._roofGroup.parent) {
      this._disposeObject(this._roofGroup);
      parentGroup.remove(this._roofGroup);
    }
    this._roofGroup = new THREE.Group();
    parentGroup.add(this._roofGroup);

    const roof = building.roof;
    if (!roof || roof.type === 'flat') {
      this._generateFlatRoof(building, totalHeight, roof?.overhang ?? 0, this._roofGroup);
      return;
    }

    const contour = building.contour;
    if (contour.length < 3) return;

    switch (roof.type) {
      case 'gabled':  this._generateGabledRoof(building, contour, totalHeight, roof, this._roofGroup); break;
      case 'hip':     this._generateHipRoof(building, contour, totalHeight, roof, this._roofGroup); break;
      case 'shed':    this._generateShedRoof(building, contour, totalHeight, roof, this._roofGroup); break;
      case 'gambrel': this._generateGambrelRoof(building, contour, totalHeight, roof, this._roofGroup); break;
      default:        this._generateGabledRoof(building, contour, totalHeight, roof, this._roofGroup);
    }

    if (roof.dormers && roof.dormers.length > 0) {
      this._generateDormers(contour, totalHeight, roof, this._roofGroup);
    }
  }

  _generateFlatRoof(building, totalHeight, overhang, group) {
    const contour = building.contour;
    if (contour.length < 3) return;

    const expanded = this._expandContour(contour, overhang);

    const shape = new THREE.Shape();
    shape.moveTo(expanded[0].x, -expanded[0].y);
    for (let i = 1; i < expanded.length; i++) {
      shape.lineTo(expanded[i].x, -expanded[i].y);
    }
    shape.closePath();

    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.2, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, this.roofMat);
    mesh.position.y = totalHeight;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  _generateGabledRoof(building, contour, totalHeight, roof, group) {
    // Compute bounding box to find ridge axis
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of contour) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.y); maxZ = Math.max(maxZ, p.y);
    }

    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const hw = (maxX - minX) / 2 + roof.overhang;
    const hd = (maxZ - minZ) / 2 + roof.overhang;
    const ridgeY = totalHeight + roof.ridgeHeight;
    const baseY = totalHeight;
    const ov = roof.overhang;

    const width = maxX - minX + 2 * ov;
    const depth = maxZ - minZ + 2 * ov;

    if (width >= depth) {
      // Ridge along X axis
      const ridgeLeft  = new THREE.Vector3(cx - hw, ridgeY, cz);
      const ridgeRight = new THREE.Vector3(cx + hw, ridgeY, cz);
      const frontLeft  = new THREE.Vector3(cx - hw, baseY, cz - hd);
      const frontRight = new THREE.Vector3(cx + hw, baseY, cz - hd);
      const backLeft   = new THREE.Vector3(cx - hw, baseY, cz + hd);
      const backRight  = new THREE.Vector3(cx + hw, baseY, cz + hd);

      // Front slope
      group.add(this._makeQuadMesh([frontLeft, frontRight, ridgeRight, ridgeLeft], this.roofMat));
      // Back slope
      group.add(this._makeQuadMesh([backRight, backLeft, ridgeLeft, ridgeRight], this.roofMat));
      // Left gable end
      group.add(this._makeTriMesh([frontLeft, ridgeLeft, backLeft], this.roofMat));
      // Right gable end
      group.add(this._makeTriMesh([frontRight, backRight, ridgeRight], this.roofMat));
    } else {
      // Ridge along Z axis
      const ridgeFront = new THREE.Vector3(cx, ridgeY, cz - hd);
      const ridgeBack  = new THREE.Vector3(cx, ridgeY, cz + hd);
      const leftFront  = new THREE.Vector3(cx - hw, baseY, cz - hd);
      const leftBack   = new THREE.Vector3(cx - hw, baseY, cz + hd);
      const rightFront = new THREE.Vector3(cx + hw, baseY, cz - hd);
      const rightBack  = new THREE.Vector3(cx + hw, baseY, cz + hd);

      // Left slope
      group.add(this._makeQuadMesh([leftBack, leftFront, ridgeFront, ridgeBack], this.roofMat));
      // Right slope
      group.add(this._makeQuadMesh([rightFront, rightBack, ridgeBack, ridgeFront], this.roofMat));
      // Front gable
      group.add(this._makeTriMesh([leftFront, rightFront, ridgeFront], this.roofMat));
      // Back gable
      group.add(this._makeTriMesh([rightBack, leftBack, ridgeBack], this.roofMat));
    }
  }

  _generateHipRoof(building, contour, totalHeight, roof, group) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of contour) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.y); maxZ = Math.max(maxZ, p.y);
    }

    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const ov = roof.overhang;
    const hw = (maxX - minX) / 2 + ov;
    const hd = (maxZ - minZ) / 2 + ov;
    const ridgeY = totalHeight + roof.ridgeHeight;
    const baseY = totalHeight;

    // Ridge half-length
    const ridgeHL = Math.max(0.5, Math.abs(hw - hd));

    const frontLeft  = new THREE.Vector3(cx - hw, baseY, cz - hd);
    const frontRight = new THREE.Vector3(cx + hw, baseY, cz - hd);
    const backLeft   = new THREE.Vector3(cx - hw, baseY, cz + hd);
    const backRight  = new THREE.Vector3(cx + hw, baseY, cz + hd);

    if (hw >= hd) {
      // Ridge along X
      const ridgeLeft  = new THREE.Vector3(cx - ridgeHL, ridgeY, cz);
      const ridgeRight = new THREE.Vector3(cx + ridgeHL, ridgeY, cz);

      // Front slope (trapezoid)
      group.add(this._makeQuadMesh([frontLeft, frontRight, ridgeRight, ridgeLeft], this.roofMat));
      // Back slope (trapezoid)
      group.add(this._makeQuadMesh([backRight, backLeft, ridgeLeft, ridgeRight], this.roofMat));
      // Left hip (triangle)
      group.add(this._makeTriMesh([frontLeft, ridgeLeft, backLeft], this.roofMat));
      // Right hip (triangle)
      group.add(this._makeTriMesh([frontRight, backRight, ridgeRight], this.roofMat));
    } else {
      // Ridge along Z
      const ridgeFront = new THREE.Vector3(cx, ridgeY, cz - ridgeHL);
      const ridgeBack  = new THREE.Vector3(cx, ridgeY, cz + ridgeHL);

      // Left slope (trapezoid)
      group.add(this._makeQuadMesh([backLeft, frontLeft, ridgeFront, ridgeBack], this.roofMat));
      // Right slope (trapezoid)
      group.add(this._makeQuadMesh([frontRight, backRight, ridgeBack, ridgeFront], this.roofMat));
      // Front hip (triangle)
      group.add(this._makeTriMesh([frontLeft, frontRight, ridgeFront], this.roofMat));
      // Back hip (triangle)
      group.add(this._makeTriMesh([backRight, backLeft, ridgeBack], this.roofMat));
    }
  }

  _generateShedRoof(building, contour, totalHeight, roof, group) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of contour) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.y); maxZ = Math.max(maxZ, p.y);
    }

    const ov = roof.overhang;
    const x0 = minX - ov, x1 = maxX + ov;
    const z0 = minZ - ov, z1 = maxZ + ov;
    const baseY = totalHeight;
    const ridgeY = totalHeight + roof.ridgeHeight;

    // Shed: low at front (z0), high at back (z1)
    const fl = new THREE.Vector3(x0, baseY,  z0);
    const fr = new THREE.Vector3(x1, baseY,  z0);
    const bl = new THREE.Vector3(x0, ridgeY, z1);
    const br = new THREE.Vector3(x1, ridgeY, z1);

    // Main sloped surface
    group.add(this._makeQuadMesh([fl, fr, br, bl], this.roofMat));
    // Left triangular end
    group.add(this._makeTriMesh([fl, bl, new THREE.Vector3(x0, baseY, z1)], this.roofMat));
    // Right triangular end
    group.add(this._makeTriMesh([fr, new THREE.Vector3(x1, baseY, z1), br], this.roofMat));
  }

  _generateGambrelRoof(building, contour, totalHeight, roof, group) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of contour) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.y); maxZ = Math.max(maxZ, p.y);
    }

    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const ov = roof.overhang;
    const hw = (maxX - minX) / 2 + ov;
    const hd = (maxZ - minZ) / 2 + ov;
    const baseY = totalHeight;
    const ridgeY = totalHeight + roof.ridgeHeight;
    // Break point: 50% height, 50% inward
    const breakY = totalHeight + roof.ridgeHeight * 0.5;
    const breakInset = hd * 0.5;

    // Front side
    const frontEaveLeft   = new THREE.Vector3(cx - hw, baseY,  cz - hd);
    const frontEaveRight  = new THREE.Vector3(cx + hw, baseY,  cz - hd);
    const frontBreakLeft  = new THREE.Vector3(cx - hw, breakY, cz - hd + breakInset);
    const frontBreakRight = new THREE.Vector3(cx + hw, breakY, cz - hd + breakInset);
    const ridgeLeft  = new THREE.Vector3(cx - hw, ridgeY, cz);
    const ridgeRight = new THREE.Vector3(cx + hw, ridgeY, cz);

    // Back side (mirror of front)
    const backEaveLeft   = new THREE.Vector3(cx - hw, baseY,  cz + hd);
    const backEaveRight  = new THREE.Vector3(cx + hw, baseY,  cz + hd);
    const backBreakLeft  = new THREE.Vector3(cx - hw, breakY, cz + hd - breakInset);
    const backBreakRight = new THREE.Vector3(cx + hw, breakY, cz + hd - breakInset);

    // Front lower slope
    group.add(this._makeQuadMesh([frontEaveLeft, frontEaveRight, frontBreakRight, frontBreakLeft], this.roofMat));
    // Front upper slope
    group.add(this._makeQuadMesh([frontBreakLeft, frontBreakRight, ridgeRight, ridgeLeft], this.roofMat));
    // Back lower slope
    group.add(this._makeQuadMesh([backEaveRight, backEaveLeft, backBreakLeft, backBreakRight], this.roofMat));
    // Back upper slope
    group.add(this._makeQuadMesh([backBreakRight, backBreakLeft, ridgeLeft, ridgeRight], this.roofMat));

    // Gable ends (left and right)
    // Left gable: compose of two triangles + trapezoid
    group.add(this._makeTriMesh([frontEaveLeft, frontBreakLeft, backBreakLeft], this.roofMat));
    group.add(this._makeTriMesh([frontEaveLeft, backBreakLeft, backEaveLeft], this.roofMat));
    group.add(this._makeTriMesh([frontBreakLeft, ridgeLeft, backBreakLeft], this.roofMat));
    // Right gable
    group.add(this._makeTriMesh([frontEaveRight, backBreakRight, frontBreakRight], this.roofMat));
    group.add(this._makeTriMesh([frontEaveRight, backEaveRight, backBreakRight], this.roofMat));
    group.add(this._makeTriMesh([frontBreakRight, backBreakRight, ridgeRight], this.roofMat));
  }

  _generateDormers(contour, totalHeight, roof, group) {
    if (!contour || contour.length < 2) return;
    const n = contour.length;
    const ridgeY = totalHeight + roof.ridgeHeight;
    const midRoofY = totalHeight + roof.ridgeHeight * 0.6;

    for (const dormer of roof.dormers) {
      const wi = dormer.wallIndex % n;
      const p1 = contour[wi];
      const p2 = contour[(wi + 1) % n];
      const dx = p2.x - p1.x, dz = p2.y - p1.y;
      const wallLen = Math.sqrt(dx * dx + dz * dz);
      if (wallLen < 0.01) continue;
      const ndx = dx / wallLen, ndz = dz / wallLen;

      const offset = Math.max(0, Math.min(dormer.offsetAlongWall, wallLen - dormer.width));
      const midOffset = offset + dormer.width / 2;

      const midX = p1.x + ndx * midOffset;
      const midZ = p1.y + ndz * midOffset;

      // Inward normal
      const inX = ndz, inZ = -ndx;
      const depth = 1.0;

      const dormerBaseY = totalHeight + roof.ridgeHeight * 0.3;

      // Dormer front wall box
      const wallGeo = new THREE.BoxGeometry(dormer.width, dormer.height, 0.15);
      const wallMesh = new THREE.Mesh(wallGeo, this.dormerWallMat);
      wallMesh.position.set(
        midX + inX * depth,
        dormerBaseY + dormer.height / 2,
        midZ + inZ * depth
      );
      const wallAngle = Math.atan2(ndz, ndx);
      wallMesh.rotation.y = -wallAngle;
      wallMesh.castShadow = true;
      group.add(wallMesh);

      // Dormer window (transparent plane)
      const winGeo = new THREE.PlaneGeometry(dormer.width * 0.7, dormer.height * 0.6);
      const winMesh = new THREE.Mesh(winGeo, this.dormerWindowMat);
      winMesh.position.set(
        midX + inX * (depth + 0.08),
        dormerBaseY + dormer.height * 0.5,
        midZ + inZ * (depth + 0.08)
      );
      winMesh.rotation.y = -wallAngle;
      group.add(winMesh);

      // Dormer mini roof (shed style)
      const roofW = dormer.width + 0.2;
      const roofD = 0.8;
      const rfl = new THREE.Vector3(
        midX + inX * depth - ndx * roofW / 2,
        dormerBaseY + dormer.height,
        midZ + inZ * depth - ndz * roofW / 2
      );
      const rfr = new THREE.Vector3(
        midX + inX * depth + ndx * roofW / 2,
        dormerBaseY + dormer.height,
        midZ + inZ * depth + ndz * roofW / 2
      );
      const rbl = new THREE.Vector3(
        rfl.x + inX * roofD,
        dormerBaseY + dormer.height + 0.6,
        rfl.z + inZ * roofD
      );
      const rbr = new THREE.Vector3(
        rfr.x + inX * roofD,
        dormerBaseY + dormer.height + 0.6,
        rfr.z + inZ * roofD
      );
      group.add(this._makeQuadMesh([rfl, rfr, rbr, rbl], this.roofMat));
    }
  }

  _expandContour(contour, amount) {
    if (amount <= 0) return contour.map(p => p.clone());
    const n = contour.length;
    const result = [];
    for (let i = 0; i < n; i++) {
      const prev = contour[(i - 1 + n) % n];
      const curr = contour[i];
      const next = contour[(i + 1) % n];

      const d1x = curr.x - prev.x, d1z = curr.y - prev.y;
      const len1 = Math.sqrt(d1x * d1x + d1z * d1z) || 1;
      const d2x = next.x - curr.x, d2z = next.y - curr.y;
      const len2 = Math.sqrt(d2x * d2x + d2z * d2z) || 1;

      // Outward normals (left perp for CCW)
      const on1x = -d1z / len1, on1z = d1x / len1;
      const on2x = -d2z / len2, on2z = d2x / len2;

      const bx = on1x + on2x;
      const bz = on1z + on2z;
      const bl = Math.sqrt(bx * bx + bz * bz) || 1;

      result.push({ x: curr.x + (bx / bl) * amount, y: curr.y + (bz / bl) * amount });
    }
    return result;
  }

  _makeQuadMesh(pts, mat) {
    // pts: [p0, p1, p2, p3] - quad (two triangles)
    const positions = new Float32Array([
      pts[0].x, pts[0].y, pts[0].z,
      pts[1].x, pts[1].y, pts[1].z,
      pts[2].x, pts[2].y, pts[2].z,
      pts[0].x, pts[0].y, pts[0].z,
      pts[2].x, pts[2].y, pts[2].z,
      pts[3].x, pts[3].y, pts[3].z,
    ]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  _makeTriMesh(pts, mat) {
    const positions = new Float32Array([
      pts[0].x, pts[0].y, pts[0].z,
      pts[1].x, pts[1].y, pts[1].z,
      pts[2].x, pts[2].y, pts[2].z,
    ]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

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
