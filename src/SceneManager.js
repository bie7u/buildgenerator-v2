import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export class SceneManager {
  constructor(canvas) {
    this.canvas = canvas;
    this.mode = '2d';
    this.splitMode = false;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x2c2c2c);

    const w = canvas.clientWidth || 800;
    const h = canvas.clientHeight || 600;
    const aspect = w / h;
    const half = 15;

    this.camera2d = new THREE.OrthographicCamera(
      -half * aspect, half * aspect, half, -half, 0.1, 1000
    );
    this.camera2d.position.set(0, 50, 0);
    this.camera2d.lookAt(0, 0, 0);
    this.camera2d.up.set(0, 0, -1);

    this.camera3d = new THREE.PerspectiveCamera(60, aspect, 0.1, 10000);
    this.camera3d.position.set(20, 15, 25);
    this.camera3d.lookAt(0, 0, 0);

    this.orbitControls = new OrbitControls(this.camera3d, this.renderer.domElement);
    this.orbitControls.enableDamping = true;
    this.orbitControls.enabled = false;

    this._setupLighting();

    this.buildingGroup = new THREE.Group();
    this.scene.add(this.buildingGroup);

    this.editGroup = new THREE.Group();
    this.scene.add(this.editGroup);

    this.gridGroup = new THREE.Group();
    this.scene.add(this.gridGroup);

    window.addEventListener('resize', () => this.onResize());
    this.onResize();
  }

  _setupLighting() {
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambient);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
    dirLight.position.set(30, 50, 30);
    dirLight.castShadow = true;
    dirLight.shadow.camera.near = 0.1;
    dirLight.shadow.camera.far = 200;
    dirLight.shadow.camera.left = -50;
    dirLight.shadow.camera.right = 50;
    dirLight.shadow.camera.top = 50;
    dirLight.shadow.camera.bottom = -50;
    this.scene.add(dirLight);

    const hemi = new THREE.HemisphereLight(0x87ceeb, 0x556677, 0.4);
    this.scene.add(hemi);
  }

  setMode(mode) {
    this.mode = mode;
    if (mode === '3d') {
      this.scene.background = new THREE.Color(0x1a1a2e);
      this.orbitControls.enabled = true;
      this.buildingGroup.visible = true;
      this.editGroup.visible = false;
      this.gridGroup.visible = false;
    } else {
      this.scene.background = new THREE.Color(0x2c2c2c);
      this.orbitControls.enabled = false;
      this.buildingGroup.visible = false;
      this.editGroup.visible = true;
      this.gridGroup.visible = true;
    }
  }

  setSplitMode(enabled) {
    this.splitMode = enabled;
    if (enabled) {
      this.scene.background = new THREE.Color(0x2c2c2c);
      this.buildingGroup.visible = true;
      this.editGroup.visible = true;
      this.gridGroup.visible = true;
      this.orbitControls.enabled = true;
    }
  }

  get currentCamera() {
    return this.mode === '3d' ? this.camera3d : this.camera2d;
  }

  onResize() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    const half = 15 / this.camera2d.zoom;
    this.camera2d.left = -half * aspect;
    this.camera2d.right = half * aspect;
    this.camera2d.top = half;
    this.camera2d.bottom = -half;
    this.camera2d.updateProjectionMatrix();
    this.camera3d.aspect = aspect;
    this.camera3d.updateProjectionMatrix();
  }

  render() {
    if (this.splitMode) {
      this._renderSplit();
    } else {
      if (this.mode === '3d') this.orbitControls.update();
      this.renderer.render(this.scene, this.currentCamera);
    }
  }

  _renderSplit() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const hw = Math.floor(w / 2);

    // Update 2D camera aspect for half-width
    const half2d = 15 / this.camera2d.zoom;
    const aspect2d = hw / h;
    this.camera2d.left = -half2d * aspect2d;
    this.camera2d.right = half2d * aspect2d;
    this.camera2d.top = half2d;
    this.camera2d.bottom = -half2d;
    this.camera2d.updateProjectionMatrix();

    // Update 3D camera aspect for half-width
    this.camera3d.aspect = hw / h;
    this.camera3d.updateProjectionMatrix();

    this.renderer.setScissorTest(true);

    // Left half: 2D editor
    this.renderer.setViewport(0, 0, hw, h);
    this.renderer.setScissor(0, 0, hw, h);
    this.scene.background = new THREE.Color(0x2c2c2c);
    this.buildingGroup.visible = false;
    this.editGroup.visible = true;
    this.gridGroup.visible = true;
    this.renderer.render(this.scene, this.camera2d);

    // Right half: 3D preview
    this.renderer.setViewport(hw, 0, hw, h);
    this.renderer.setScissor(hw, 0, hw, h);
    this.scene.background = new THREE.Color(0x1a1a2e);
    this.buildingGroup.visible = true;
    this.editGroup.visible = false;
    this.gridGroup.visible = false;
    this.orbitControls.update();
    this.renderer.render(this.scene, this.camera3d);

    this.renderer.setScissorTest(false);
    this.renderer.setViewport(0, 0, w, h);
  }

  startLoop() {
    const loop = () => {
      requestAnimationFrame(loop);
      this.render();
    };
    loop();
  }

  getWorldPosition(event) {
    const rect = this.canvas.getBoundingClientRect();
    let x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    if (this.splitMode) {
      const hw = rect.width / 2;
      if (x > hw) return new THREE.Vector2(99999, 99999); // outside editor
      const ndc = new THREE.Vector2((x / hw) * 2 - 1, -(y / rect.height) * 2 + 1);
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(ndc, this.camera2d);
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const target = new THREE.Vector3();
      raycaster.ray.intersectPlane(plane, target);
      return new THREE.Vector2(target.x, target.z);
    }

    const ndc = new THREE.Vector2((x / rect.width) * 2 - 1, -(y / rect.height) * 2 + 1);
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, this.camera2d);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const target = new THREE.Vector3();
    raycaster.ray.intersectPlane(plane, target);
    return new THREE.Vector2(target.x, target.z);
  }

  zoom2d(delta) {
    this.camera2d.zoom = Math.max(0.1, Math.min(10, this.camera2d.zoom * (1 - delta * 0.001)));
    this.camera2d.updateProjectionMatrix();
    this.onResize();
  }

  pan2d(dx, dy) {
    const rect = this.canvas.getBoundingClientRect();
    const half = 15 / this.camera2d.zoom;
    const worldPerPx = (half * 2) / rect.height;
    this.camera2d.position.x -= dx * worldPerPx;
    this.camera2d.position.z += dy * worldPerPx;
    this.camera2d.lookAt(this.camera2d.position.x, 0, this.camera2d.position.z);
  }

  worldToScreen(wx, wz) {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w === 0 || h === 0) return { x: 0, y: 0 };
    const vec = new THREE.Vector3(wx, 0, wz);
    vec.project(this.camera2d);
    if (this.splitMode) {
      const hw = Math.floor(w / 2);
      return {
        x: (vec.x + 1) / 2 * hw,
        y: (-vec.y + 1) / 2 * h,
      };
    }
    return {
      x: (vec.x + 1) / 2 * w,
      y: (-vec.y + 1) / 2 * h,
    };
  }
}
