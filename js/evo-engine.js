/**
 * Evo-Engine Voxel 3D Editor (v3.0)
 * Full Implementation
 */

// ==========================================
// 1. DATA MODEL
// ==========================================
class VoxelWorldModel {
  constructor(sizeX = 16, sizeY = 16, sizeZ = 16) {
    this.sizeX = sizeX;
    this.sizeY = sizeY; // depth/height depending on axis
    this.sizeZ = sizeZ; 
    
    this.voxels = new Map();
    this.entities = [];
    this.triggers = [];
    this.globalVariables = {};
    this.meta = { id: Date.now().toString(), name: "New World", author: "Player" };
  }

  getKey(x, y, z) { return `${x},${y},${z}`; }
  
  inBounds(x, y, z) {
    return x >= 0 && x < this.sizeX && y >= 0 && y < this.sizeY && z >= 0 && z < this.sizeZ;
  }

  getVoxel(x, y, z) { return this.inBounds(x,y,z) ? (this.voxels.get(this.getKey(x, y, z)) || null) : null; }
  
  setVoxel(x, y, z, data) {
    if (!this.inBounds(x, y, z)) return false;
    this.voxels.set(this.getKey(x, y, z), data);
    return true;
  }

  deleteVoxel(x, y, z) {
    if (!this.inBounds(x, y, z)) return false;
    this.voxels.delete(this.getKey(x, y, z));
    return true;
  }

  hasVoxel(x, y, z) { return this.voxels.has(this.getKey(x, y, z)); }

  // Entities
  addEntity(type, x, y, z) {
    const ent = { id: 'ent_'+Date.now(), type, position: {x,y,z}, variables: {} };
    if(type === 'player_start') {
      this.entities = this.entities.filter(e => e.type !== 'player_start'); // only one
    }
    this.entities.push(ent);
    return ent;
  }
  
  removeEntityAt(x, y, z) {
    const idx = this.entities.findIndex(e => Math.round(e.position.x) === x && Math.round(e.position.y) === y && Math.round(e.position.z) === z);
    if(idx >= 0) {
      this.entities.splice(idx, 1);
      return true;
    }
    return false;
  }

  // Serialization
  toJSON() {
    const vList = [];
    this.voxels.forEach((val, key) => {
      const [x,y,z] = key.split(',').map(Number);
      vList.push({x,y,z, ...val});
    });
    return JSON.stringify({
      meta: this.meta,
      grid: { sizeX: this.sizeX, sizeY: this.sizeY, sizeZ: this.sizeZ, voxels: vList },
      entities: this.entities,
      triggers: this.triggers,
      globalVariables: this.globalVariables
    });
  }

  fromJSON(jsonStr) {
    const data = JSON.parse(jsonStr);
    this.meta = data.meta;
    this.sizeX = data.grid.sizeX; this.sizeY = data.grid.sizeY; this.sizeZ = data.grid.sizeZ;
    this.voxels.clear();
    if(data.grid.voxels) {
      data.grid.voxels.forEach(v => {
        this.voxels.set(this.getKey(v.x, v.y, v.z), { type: v.type, color: v.color });
      });
    }
    this.entities = data.entities || [];
    this.triggers = data.triggers || [];
    this.globalVariables = data.globalVariables || {};
  }
}

// ==========================================
// 2. HISTORY MANAGER (Undo/Redo)
// ==========================================
class HistoryManager {
  constructor(world, renderer) {
    this.world = world;
    this.renderer = renderer;
    this.undoStack = [];
    this.redoStack = [];
    this.maxSize = 30;
  }

  recordAction(action) {
    this.undoStack.push(action);
    if(this.undoStack.length > this.maxSize) this.undoStack.shift();
    this.redoStack = []; // clear redo on new action
  }

  undo() {
    if(this.undoStack.length === 0) return;
    const action = this.undoStack.pop();
    this.redoStack.push(action);
    action.inverse();
    this.renderer.render();
  }

  redo() {
    if(this.redoStack.length === 0) return;
    const action = this.redoStack.pop();
    this.undoStack.push(action);
    action.forward();
    this.renderer.render();
  }
}

// ==========================================
// 3. GRID ENGINE (Tools)
// ==========================================
class GridEngine {
  constructor(world, history) {
    this.world = world;
    this.history = history;
    this.clipboard = null;
    this.selection = null; // {minX, minY, minZ, maxX, maxY, maxZ}
  }

  addVoxel(x, y, z, color) {
    if (!this.world.inBounds(x,y,z)) return;
    const oldVoxel = this.world.getVoxel(x, y, z);
    const data = { type: 'solid', color };
    
    this.history.recordAction({
      forward: () => this.world.setVoxel(x, y, z, data),
      inverse: () => {
        if(oldVoxel) this.world.setVoxel(x, y, z, oldVoxel);
        else this.world.deleteVoxel(x, y, z);
      }
    });
    this.world.setVoxel(x, y, z, data);
  }

  deleteVoxel(x, y, z) {
    const oldVoxel = this.world.getVoxel(x, y, z);
    if (!oldVoxel) return;

    this.history.recordAction({
      forward: () => this.world.deleteVoxel(x, y, z),
      inverse: () => this.world.setVoxel(x, y, z, oldVoxel)
    });
    this.world.deleteVoxel(x, y, z);
  }

  // BFS Fill algorithm
  fill(startX, startY, startZ, targetColor) {
    const targetVoxel = this.world.getVoxel(startX, startY, startZ);
    const isTargetEmpty = !targetVoxel;
    const visited = new Set();
    const queue = [[startX, startY, startZ]];
    const changes = []; // to save for history

    while (queue.length > 0 && visited.size < 500) { // Safety limit
      const [x, y, z] = queue.shift();
      const key = this.world.getKey(x, y, z);
      if (visited.has(key)) continue;
      if (!this.world.inBounds(x, y, z)) continue;

      const v = this.world.getVoxel(x, y, z);
      const isEmpty = !v;
      
      if (isTargetEmpty === isEmpty) { // Both empty or both solid
        visited.add(key);
        changes.push({x,y,z, old: v});
        
        // neighbors
        queue.push([x+1, y, z], [x-1, y, z], [x, y+1, z], [x, y-1, z], [x, y, z+1], [x, y, z-1]);
      }
    }

    if(changes.length === 0) return;

    this.history.recordAction({
      forward: () => {
        changes.forEach(c => this.world.setVoxel(c.x, c.y, c.z, {type: 'solid', color: targetColor}));
      },
      inverse: () => {
        changes.forEach(c => {
          if(c.old) this.world.setVoxel(c.x, c.y, c.z, c.old);
          else this.world.deleteVoxel(c.x, c.y, c.z);
        });
      }
    });

    // apply
    changes.forEach(c => this.world.setVoxel(c.x, c.y, c.z, {type: 'solid', color: targetColor}));
  }

  startSelection(x, y, z) {
    this.selection = { minX: x, minY: y, minZ: z, maxX: x, maxY: y, maxZ: z };
  }
  updateSelection(x, y, z) {
    if(!this.selection) return;
    this.selection.maxX = x; this.selection.maxY = y; this.selection.maxZ = z;
  }
  getNormalizedSelection() {
    if(!this.selection) return null;
    return {
      minX: Math.min(this.selection.minX, this.selection.maxX),
      maxX: Math.max(this.selection.minX, this.selection.maxX),
      minY: Math.min(this.selection.minY, this.selection.maxY),
      maxY: Math.max(this.selection.minY, this.selection.maxY),
      minZ: Math.min(this.selection.minZ, this.selection.maxZ),
      maxZ: Math.max(this.selection.minZ, this.selection.maxZ)
    };
  }

  copy() {
    const s = this.getNormalizedSelection();
    if(!s) return;
    this.clipboard = [];
    for(let x=s.minX; x<=s.maxX; x++) {
      for(let y=s.minY; y<=s.maxY; y++) {
        for(let z=s.minZ; z<=s.maxZ; z++) {
          const v = this.world.getVoxel(x,y,z);
          if(v) this.clipboard.push({ dx: x-s.minX, dy: y-s.minY, dz: z-s.minZ, data: v });
        }
      }
    }
    console.log("Copied", this.clipboard.length, "voxels");
  }

  paste(targetX, targetY, targetZ) {
    if(!this.clipboard || this.clipboard.length === 0) return;
    const changes = [];
    this.clipboard.forEach(c => {
      const nx = targetX + c.dx;
      const ny = targetY + c.dy;
      const nz = targetZ + c.dz;
      if(this.world.inBounds(nx, ny, nz)) {
        changes.push({x: nx, y: ny, z: nz, old: this.world.getVoxel(nx,ny,nz), new: c.data});
      }
    });

    this.history.recordAction({
      forward: () => changes.forEach(c => this.world.setVoxel(c.x, c.y, c.z, c.new)),
      inverse: () => changes.forEach(c => {
        if(c.old) this.world.setVoxel(c.x, c.y, c.z, c.old);
        else this.world.deleteVoxel(c.x, c.y, c.z);
      })
    });
    changes.forEach(c => this.world.setVoxel(c.x, c.y, c.z, c.new));
  }
}

// ==========================================
// 4. RENDER SYSTEM (3D + 2D Fallbacks)
// ==========================================
class RenderSystem {
  constructor(container, world) {
    this.container = container;
    this.world = world;
    this.voxelSize = 40;
    this.viewMode = '3d'; // '3d', 'top', 'side'
    this.activeLayer = -1; // -1 means all layers
    this.selectionRef = null;
  }

  setViewMode(mode) {
    this.viewMode = mode;
    const parent = this.container.parentElement;
    if (mode === 'top') {
      this.container.style.transform = 'rotateX(90deg) rotateY(0deg) rotateZ(0deg)';
      parent.style.perspective = 'none';
    } else if (mode === 'side') {
      this.container.style.transform = 'rotateX(0deg) rotateY(0deg) rotateZ(0deg)';
      parent.style.perspective = 'none';
    } else {
      parent.style.perspective = '800px';
      // Reset to default orbit
      this.container.style.transform = 'rotateX(-30deg) rotateY(45deg)';
    }
    this.render();
  }

  setActiveLayer(z) {
    this.activeLayer = z;
    this.render();
  }

  render(gridEngineSelection = null) {
    this.container.innerHTML = '';
    let drawnFaces = 0;
    let drawnVoxels = 0;

    const offsetX = (this.world.sizeX * this.voxelSize) / 2;
    const offsetY = (this.world.sizeY * this.voxelSize) / 2;
    const offsetZ = (this.world.sizeZ * this.voxelSize) / 2;

    // Render Grid Floor
    const floor = document.createElement('div');
    floor.className = 'grid-floor';
    floor.style.width = `${this.world.sizeX * this.voxelSize}px`;
    floor.style.height = `${this.world.sizeY * this.voxelSize}px`;
    let floorZ = this.activeLayer >= 0 ? this.activeLayer : 0;
    floor.style.transform = `translate(-50%, -50%) rotateX(90deg) translateZ(${-(floorZ * this.voxelSize - offsetZ + this.voxelSize/2)}px)`;
    this.container.appendChild(floor);

    // Render Voxels
    for (const [key, voxel] of this.world.voxels.entries()) {
      const [x, y, z] = key.split(',').map(Number);
      
      // Layer filtering
      if (this.activeLayer !== -1 && z !== this.activeLayer && this.viewMode === 'top') continue; // In top view, only show active layer if set

      // Culling for Side View (only show specific Y plane if needed, but for now show all with Z-index sorting implicitly via CSS 3D even if perspective is none)
      
      const el = document.createElement('div');
      el.className = 'voxel';
      if (this.activeLayer !== -1 && z !== this.activeLayer) {
        el.style.opacity = '0.2'; // Ghost out other layers
      }
      
      const posX = x * this.voxelSize - offsetX + this.voxelSize/2;
      const posY = -(z * this.voxelSize) + offsetZ - this.voxelSize/2; 
      const posZ = y * this.voxelSize - offsetY + this.voxelSize/2;

      el.style.transform = `translate3d(${posX}px, ${posY}px, ${posZ}px)`;
      el.dataset.x = x; el.dataset.y = y; el.dataset.z = z;

      // Faces
      const faces = [
        { dir: 'top', dx: 0, dy: 0, dz: 1 },
        { dir: 'bottom', dx: 0, dy: 0, dz: -1 },
        { dir: 'front', dx: 0, dy: 1, dz: 0 },
        { dir: 'back', dx: 0, dy: -1, dz: 0 },
        { dir: 'right', dx: 1, dy: 0, dz: 0 },
        { dir: 'left', dx: -1, dy: 0, dz: 0 }
      ];

      let hasVisibleFaces = false;
      faces.forEach(f => {
        // Face Culling: if neighbor exists AND we are not ghosting this layer
        let drawFace = true;
        if (this.world.hasVoxel(x + f.dx, y + f.dy, z + f.dz)) {
           // check if we are slicing layers
           if (this.activeLayer !== -1 && (z + f.dz) !== this.activeLayer) {
             drawFace = true; // neighbor is ghosted, so we need to draw our face
           } else {
             drawFace = false;
           }
        }

        if (drawFace) {
          const faceEl = document.createElement('div');
          faceEl.className = `face ${f.dir}`;
          faceEl.style.backgroundColor = voxel.color;
          faceEl.dataset.dir = f.dir;
          el.appendChild(faceEl);
          hasVisibleFaces = true;
          drawnFaces++;
        }
      });

      if (hasVisibleFaces) {
        this.container.appendChild(el);
        drawnVoxels++;
      }
    }

    // Render Entities
    this.world.entities.forEach(ent => {
      // similar to voxel positioning
      const x = ent.position.x, y = ent.position.y, z = ent.position.z;
      const el = document.createElement('div');
      el.className = 'entity-sprite';
      el.innerText = ent.type === 'player_start' ? '🧍' : '👾';
      const posX = x * this.voxelSize - offsetX + this.voxelSize/2;
      const posY = -(z * this.voxelSize) + offsetZ - this.voxelSize/2; 
      const posZ = y * this.voxelSize - offsetY + this.voxelSize/2;
      el.style.transform = `translate3d(${posX}px, ${posY}px, ${posZ}px) rotateX(90deg)`;
      el.dataset.type = 'entity';
      el.dataset.id = ent.id;
      this.container.appendChild(el);
    });

    // Render Selection Box
    if (gridEngineSelection) {
      const s = gridEngineSelection;
      const w = (s.maxX - s.minX + 1) * this.voxelSize;
      const h = (s.maxZ - s.minZ + 1) * this.voxelSize;
      const d = (s.maxY - s.minY + 1) * this.voxelSize;
      
      const cx = (s.minX + s.maxX) / 2 * this.voxelSize - offsetX + this.voxelSize/2;
      const cy = -((s.minZ + s.maxZ) / 2 * this.voxelSize) + offsetZ - this.voxelSize/2;
      const cz = (s.minY + s.maxY) / 2 * this.voxelSize - offsetY + this.voxelSize/2;

      const selEl = document.createElement('div');
      selEl.className = 'selection-box';
      selEl.style.width = `${w}px`;
      selEl.style.height = `${d}px`; // mapping
      selEl.style.transform = `translate3d(${cx - w/2}px, ${cy}px, ${cz - d/2}px) rotateX(90deg)`;
      this.container.appendChild(selEl);
    }

    const info = document.getElementById('debug-info');
    if(info) info.innerText = `Mode: ${this.viewMode.toUpperCase()} | Voxels: ${drawnVoxels} | Faces: ${drawnFaces} | Layer: ${this.activeLayer === -1 ? 'All' : this.activeLayer}`;
  }
}

// ==========================================
// 5. TEST MODE (Physics)
// ==========================================
class PhysicsEngine {
  constructor(world, renderer) {
    this.world = world;
    this.renderer = renderer;
    this.isRunning = false;
    this.player = null;
    this.playerEl = null;
  }

  start() {
    const pStart = this.world.entities.find(e => e.type === 'player_start');
    if(!pStart) {
      alert("Немає Player Start на сцені!");
      return;
    }
    this.isRunning = true;
    this.player = {
      x: pStart.position.x, y: pStart.position.y, z: pStart.position.z,
      vx: 0, vy: 0, vz: 0,
      width: 0.8, height: 1.8, depth: 0.8
    };

    // Create player DOM
    this.playerEl = document.createElement('div');
    this.playerEl.className = 'player-model';
    this.playerEl.style.width = `${this.player.width * 40}px`;
    this.playerEl.style.height = `${this.player.height * 40}px`;
    this.renderer.container.appendChild(this.playerEl);

    document.getElementById('test-controls').style.display = 'flex';
    this.lastTime = performance.now();
    this.loop();
  }

  stop() {
    this.isRunning = false;
    if(this.playerEl) this.playerEl.remove();
    document.getElementById('test-controls').style.display = 'none';
    this.renderer.render(); // reset
  }

  loop() {
    if(!this.isRunning) return;
    requestAnimationFrame(() => this.loop());
    const now = performance.now();
    const dt = Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;

    // Gravity
    this.player.vz -= 9.8 * dt;

    // Movement (WASD hook would go here, currently hardcoded generic or bound to UI)
    const speed = 5;
    if (window.inputState) {
      if(window.inputState.up) this.player.vy -= speed * dt;
      if(window.inputState.down) this.player.vy += speed * dt;
      if(window.inputState.left) this.player.vx -= speed * dt;
      if(window.inputState.right) this.player.vx += speed * dt;
      if(window.inputState.jump && this.onGround) {
        this.player.vz = 5;
        this.onGround = false;
      }
    }

    // Move Z
    this.player.z += this.player.vz * dt;
    this.checkCollision('z');

    // Move X
    this.player.x += this.player.vx * dt;
    this.checkCollision('x');

    // Move Y
    this.player.y += this.player.vy * dt;
    this.checkCollision('y');

    // Update DOM
    const offsetX = (this.world.sizeX * 40) / 2;
    const offsetY = (this.world.sizeY * 40) / 2;
    const offsetZ = (this.world.sizeZ * 40) / 2;
    
    const posX = this.player.x * 40 - offsetX;
    const posY = -(this.player.z * 40) + offsetZ - (this.player.height*40)/2; 
    const posZ = this.player.y * 40 - offsetY;
    
    this.playerEl.style.transform = `translate3d(${posX}px, ${posY}px, ${posZ}px)`;
  }

  checkCollision(axis) {
    this.onGround = false;
    // Simple AABB vs Voxel Grid check
    const minX = Math.floor(this.player.x - this.player.width/2);
    const maxX = Math.floor(this.player.x + this.player.width/2);
    const minY = Math.floor(this.player.y - this.player.depth/2);
    const maxY = Math.floor(this.player.y + this.player.depth/2);
    const minZ = Math.floor(this.player.z);
    const maxZ = Math.floor(this.player.z + this.player.height);

    for(let x = minX; x <= maxX; x++) {
      for(let y = minY; y <= maxY; y++) {
        for(let z = minZ; z <= maxZ; z++) {
          if(this.world.hasVoxel(x, y, z)) {
            // resolve
            if(axis === 'z') {
              if(this.player.vz < 0) { // falling
                this.player.z = z + 1;
                this.player.vz = 0;
                this.onGround = true;
              } else {
                this.player.z = z - this.player.height;
                this.player.vz = 0;
              }
            }
            if(axis === 'x') {
              this.player.x = this.player.vx > 0 ? x - this.player.width/2 : x + 1 + this.player.width/2;
              this.player.vx = 0;
            }
            if(axis === 'y') {
              this.player.y = this.player.vy > 0 ? y - this.player.depth/2 : y + 1 + this.player.depth/2;
              this.player.vy = 0;
            }
          }
        }
      }
    }
  }
}

// ==========================================
// 6. MAIN CONTROLLER
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  const world = new VoxelWorldModel(16, 16, 16);
  const sceneEl = document.getElementById('scene');
  const renderer = new RenderSystem(sceneEl, world);
  const history = new HistoryManager(world, renderer);
  const engine = new GridEngine(world, history);
  const physics = new PhysicsEngine(world, renderer);

  let activeColor = '#00f0ff';
  let activeTool = 'add'; // add, erase, fill, select, entity
  let activeEntity = 'player_start';

  // Load from LS if exists
  const saved = localStorage.getItem('evo_scene_latest');
  if (saved && window.LZString) {
    try {
      world.fromJSON(LZString.decompressFromUTF16(saved));
    } catch(e) { console.error("Load failed", e); }
  } else if (saved) { // fallback
    try { world.fromJSON(saved); } catch(e) {}
  } else {
    // Default platform
    for(let x=4; x<12; x++) {
      for(let y=4; y<12; y++) {
        world.setVoxel(x, y, 0, {type:'solid', color:'#262b50'});
      }
    }
  }
  renderer.render();

  // --- UI BINDINGS ---
  const bindBtn = (id, fn) => document.getElementById(id)?.addEventListener('click', fn);

  // Tools
  document.querySelectorAll('.tool-btn').forEach(btn => {
    if(btn.dataset.tool) {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.tool-btn[data-tool]').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        activeTool = e.target.dataset.tool;
      });
    }
  });

  // Color Palette
  document.querySelectorAll('.color-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      activeColor = e.target.dataset.color;
    });
  });

  // Entities Palette
  document.querySelectorAll('.entity-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.entity-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      activeEntity = e.target.dataset.entity;
      activeTool = 'entity';
      document.querySelectorAll('.tool-btn[data-tool]').forEach(b => b.classList.remove('active'));
    });
  });

  // Views
  bindBtn('view-3d', () => renderer.setViewMode('3d'));
  bindBtn('view-top', () => renderer.setViewMode('top'));
  bindBtn('view-side', () => renderer.setViewMode('side'));

  // Layers
  const layerInput = document.getElementById('layer-input');
  bindBtn('layer-all', () => { renderer.setActiveLayer(-1); layerInput.value = 'All'; });
  bindBtn('layer-up', () => { 
    let l = renderer.activeLayer === -1 ? 0 : renderer.activeLayer;
    if(l < world.sizeZ-1) renderer.setActiveLayer(l+1);
    layerInput.value = renderer.activeLayer;
  });
  bindBtn('layer-down', () => {
    let l = renderer.activeLayer === -1 ? 0 : renderer.activeLayer;
    if(l > 0) renderer.setActiveLayer(l-1);
    layerInput.value = renderer.activeLayer;
  });

  // Undo/Redo
  bindBtn('btn-undo', () => history.undo());
  bindBtn('btn-redo', () => history.redo());

  // Copy / Paste
  bindBtn('btn-copy', () => engine.copy());
  bindBtn('btn-paste', () => activeTool = 'paste');

  // Save
  bindBtn('btn-save', () => {
    const json = world.toJSON();
    const compressed = window.LZString ? LZString.compressToUTF16(json) : json;
    localStorage.setItem('evo_scene_latest', compressed);
    alert('Збережено локально!');
  });

  // Share
  bindBtn('btn-share', () => {
    const json = world.toJSON();
    const compressed = window.LZString ? LZString.compressToEncodedURIComponent(json) : encodeURIComponent(json);
    const url = window.location.href.split('?')[0] + '?load=' + compressed;
    navigator.clipboard.writeText(url).then(() => alert('Посилання скопійовано!'));
  });

  // Test Mode
  bindBtn('btn-test', () => physics.start());
  bindBtn('btn-test-stop', () => physics.stop());

  // --- INTERACTION LOGIC ---
  let isDragging = false;
  let lastFaceX = -1, lastFaceY = -1, lastFaceZ = -1;

  sceneEl.addEventListener('mousedown', (e) => {
    if(physics.isRunning) return;
    if(e.button !== 0) return; // only left click
    isDragging = true;
    handleInteraction(e.target);
  });
  
  sceneEl.addEventListener('mousemove', (e) => {
    if(!isDragging) return;
    handleInteraction(e.target);
  });
  
  window.addEventListener('mouseup', () => {
    isDragging = false;
    lastFaceX = -1; lastFaceY = -1; lastFaceZ = -1;
  });

  function handleInteraction(target) {
    if(physics.isRunning) return;
    
    let x, y, z;
    if (target.classList.contains('face')) {
      const voxelEl = target.parentElement;
      x = parseInt(voxelEl.dataset.x);
      y = parseInt(voxelEl.dataset.y);
      z = parseInt(voxelEl.dataset.z);
      
      // Calculate adjacent block for "add" tool
      if(activeTool === 'add' || activeTool === 'paste' || activeTool === 'entity') {
        const dir = target.dataset.dir;
        if (dir === 'top') z++;
        if (dir === 'bottom') z--;
        if (dir === 'front') y++;
        if (dir === 'back') y--;
        if (dir === 'right') x++;
        if (dir === 'left') x--;
      }
    } else if (target.classList.contains('grid-floor')) {
       // Clicked on floor directly
       // To do this perfectly we need raycasting, but for PoC we approximate
       return; 
    } else {
      return;
    }

    if(x === lastFaceX && y === lastFaceY && z === lastFaceZ) return;
    lastFaceX = x; lastFaceY = y; lastFaceZ = z;

    if (activeTool === 'erase') {
      engine.deleteVoxel(x, y, z);
      renderer.render(engine.getNormalizedSelection());
    } else if (activeTool === 'add') {
      engine.addVoxel(x, y, z, activeColor);
      renderer.render(engine.getNormalizedSelection());
    } else if (activeTool === 'fill') {
      engine.fill(x, y, z, activeColor);
      renderer.render(engine.getNormalizedSelection());
    } else if (activeTool === 'select') {
      // Just single block selection for now to keep PoC simple via mouse drag
      if(!engine.selection || !isDragging) engine.startSelection(x, y, z);
      else engine.updateSelection(x, y, z);
      renderer.render(engine.getNormalizedSelection());
    } else if (activeTool === 'paste') {
      engine.paste(x, y, z);
      renderer.render(engine.getNormalizedSelection());
      isDragging = false; // only paste once per click
    } else if (activeTool === 'entity') {
      world.addEntity(activeEntity, x, y, z);
      renderer.render(engine.getNormalizedSelection());
      isDragging = false;
    }
  }

  // --- CAMERA ORBIT (Right click or touches) ---
  let camDragging = false, lastX, lastY;
  let rotX = -30, rotY = 45;

  sceneEl.addEventListener('mousedown', (e) => {
    if(e.button === 2) { camDragging = true; lastX = e.clientX; lastY = e.clientY; }
  });
  window.addEventListener('mousemove', (e) => {
    if(camDragging && renderer.viewMode === '3d') {
      rotY += (e.clientX - lastX) * 0.5;
      rotX -= (e.clientY - lastY) * 0.5;
      rotX = Math.max(-89, Math.min(89, rotX));
      lastX = e.clientX; lastY = e.clientY;
      sceneEl.style.transform = `rotateX(${rotX}deg) rotateY(${rotY}deg)`;
    }
  });
  window.addEventListener('mouseup', () => camDragging = false);
  sceneEl.addEventListener('contextmenu', e => e.preventDefault());

  // Input State for Test Mode
  window.inputState = { up: false, down: false, left: false, right: false, jump: false };
  window.addEventListener('keydown', e => {
    if(e.code === 'KeyW') window.inputState.up = true;
    if(e.code === 'KeyS') window.inputState.down = true;
    if(e.code === 'KeyA') window.inputState.left = true;
    if(e.code === 'KeyD') window.inputState.right = true;
    if(e.code === 'Space') window.inputState.jump = true;
    if(e.code === 'KeyZ' && e.ctrlKey) history.undo();
    if(e.code === 'KeyY' && e.ctrlKey) history.redo();
  });
  window.addEventListener('keyup', e => {
    if(e.code === 'KeyW') window.inputState.up = false;
    if(e.code === 'KeyS') window.inputState.down = false;
    if(e.code === 'KeyA') window.inputState.left = false;
    if(e.code === 'KeyD') window.inputState.right = false;
    if(e.code === 'Space') window.inputState.jump = false;
  });

  // Check URL for shared level
  const urlParams = new URLSearchParams(window.location.search);
  const loadParam = urlParams.get('load');
  if(loadParam && window.LZString) {
    try {
      const json = LZString.decompressFromEncodedURIComponent(loadParam);
      world.fromJSON(json);
      renderer.render();
      alert("Світ завантажено з посилання!");
    } catch(e) { alert("Помилка завантаження світу з посилання."); }
  }

  // Auto-save interval
  setInterval(() => {
    if(!physics.isRunning) {
      const json = world.toJSON();
      const compressed = window.LZString ? LZString.compressToUTF16(json) : json;
      localStorage.setItem('evo_scene_auto', compressed);
    }
  }, 5000);
});
