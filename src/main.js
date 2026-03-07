import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { Building } from './models/Building.js';
import { SceneManager } from './SceneManager.js';
import { GridSystem } from './GridSystem.js';
import { FloorPlanEditor } from './editors/FloorPlanEditor.js';
import { BuildingGenerator } from './generators/BuildingGenerator.js';
import { RoofGenerator } from './generators/RoofGenerator.js';
import { UIManager } from './ui/UIManager.js';

const app = {
  buildings: [new Building()],
  currentBuildingIndex: 0,
  currentFloorIndex: 0,
  mode: '2d',
  splitMode: false,
  sceneManager: null,
  grid: null,
  editor: null,
  generator: null,
  roofGenerator: null,
  ui: null,

  get building() {
    return this.buildings[this.currentBuildingIndex];
  },

  setMode(mode) {
    if (mode === 'split') {
      this.splitMode = true;
      this.mode = '2d';
      this.sceneManager.setSplitMode(true);
      document.getElementById('canvas-container').classList.add('split-mode');
      document.getElementById('btn-2d')?.classList.toggle('active', false);
      document.getElementById('btn-3d')?.classList.toggle('active', false);
      document.getElementById('btn-split')?.classList.toggle('active', true);
      this.generate3D(true);
      this.editor.redraw();
      document.getElementById('status-hint').textContent =
        'Split view: left=2D editor, right=3D preview. Edit on left, preview updates automatically.';
      return;
    }

    // Exit split mode
    this.splitMode = false;
    this.sceneManager.setSplitMode(false);
    document.getElementById('canvas-container').classList.remove('split-mode');
    document.getElementById('btn-split')?.classList.toggle('active', false);

    this.mode = mode;
    const is2d = mode === '2d';
    const is3d = mode === '3d';

    this.sceneManager.setMode(is3d ? '3d' : '2d');

    document.getElementById('btn-2d')?.classList.toggle('active', is2d);
    document.getElementById('btn-3d')?.classList.toggle('active', is3d);

    if (is2d) {
      this.editor.redraw();
    } else {
      this.editor._hideDimEdit();
      const lc = document.getElementById('canvas-labels');
      if (lc) lc.innerHTML = '';
    }
  },

  refreshLivePreview() {
    if (!this.splitMode) return;
    const hasValid = this.buildings.some(b => b.contour.length >= 3);
    if (!hasValid) return;
    this.generate3D(true);
  },

  addBuilding() {
    this.buildings.push(new Building());
    this.currentBuildingIndex = this.buildings.length - 1;
    this.currentFloorIndex = 0;
    if (this.editor) this.editor.resetState();
    if (this.ui) {
      this.ui._updateBuildingSelector();
      this.ui._updateFloorSelector();
      this.ui.updateBuildingInfo();
      this.ui.updateRoofPanel();
    }
  },

  removeBuilding() {
    if (this.buildings.length <= 1) return;
    this.buildings.splice(this.currentBuildingIndex, 1);
    this.currentBuildingIndex = Math.min(this.currentBuildingIndex, this.buildings.length - 1);
    this.currentFloorIndex = 0;
    if (this.editor) this.editor.resetState();
    if (this.ui) {
      this.ui._updateBuildingSelector();
      this.ui._updateFloorSelector();
      this.ui._updateBuildingSettingsInputs();
      this.ui.updateBuildingInfo();
      this.ui.updateRoofPanel();
    }
  },

  switchBuilding(index) {
    this.currentBuildingIndex = index;
    this.currentFloorIndex = Math.min(this.currentFloorIndex, this.building.floors.length - 1);
    if (this.editor) this.editor.resetState();
    if (this.ui) {
      this.ui._updateFloorSelector();
      this.ui._updateBuildingSettingsInputs();
      this.ui.updateBuildingInfo();
      this.ui.updateRoofPanel();
    }
  },

  generate3D(stayInCurrentMode = false) {
    const hasValid = this.buildings.some(b => b.contour.length >= 3);
    if (!hasValid) {
      document.getElementById('status-hint').textContent =
        'Draw a floor contour first (at least 3 points).';
      return;
    }
    for (const b of this.buildings) {
      if (b.contour.length >= 3) b.normalizeAllContourWindings();
    }
    this.generator.generateAll(this.buildings);
    // Generate roofs (clearAll resets tracking so each building keeps its own group)
    this.roofGenerator.clearAll();
    for (const b of this.buildings) {
      if (b.contour.length >= 3 && b.roof) {
        const totalH = b.floors.reduce((s, f) => s + f.height, 0);
        this.roofGenerator.generate(b, totalH, this.sceneManager.buildingGroup);
      }
    }
    if (!stayInCurrentMode && !this.splitMode) {
      this.setMode('3d');
      document.getElementById('status-hint').textContent =
        'Use mouse to orbit, scroll to zoom, right-drag to pan.';
    }
  },

  exportGLTF() {
    const exporter = new GLTFExporter();
    exporter.parse(
      this.sceneManager.buildingGroup,
      (gltf) => {
        const blob = new Blob([JSON.stringify(gltf)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'building.gltf';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      },
      err => console.error('GLTF export error:', err),
      { binary: false }
    );
  },
};

function init() {
  const canvas = document.getElementById('canvas');
  app.sceneManager = new SceneManager(canvas);
  app.grid = new GridSystem(null, app.sceneManager.gridGroup);
  app.editor = new FloorPlanEditor(app.sceneManager, app);
  app.generator = new BuildingGenerator(app.sceneManager);
  app.roofGenerator = new RoofGenerator(app.sceneManager);
  app.ui = new UIManager(app);
  app.sceneManager.startLoop();

  document.getElementById('status-hint').textContent =
    'Select "Draw Contour" to start drawing the building outline.';
  document.getElementById('status-mode').textContent = 'Mode: Select';
}

init();
window.app = app;
