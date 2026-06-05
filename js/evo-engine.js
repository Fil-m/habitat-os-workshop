/**
 * Evo-Engine Voxel 3D Editor (PoC)
 * Handles grid logic, CSS 3D rendering with face culling, and camera orbit.
 */

class VoxelWorldModel {
  constructor(sizeX = 8, sizeY = 8, sizeZ = 8) {
    this.sizeX = sizeX;
    this.sizeY = sizeY;
    this.sizeZ = sizeZ;
    this.voxels = new Map(); // key: "x,y,z", value: { type, color }
  }

  getKey(x, y, z) {
    return `${x},${y},${z}`;
  }

  inBounds(x, y, z) {
    return x >= 0 && x < this.sizeX &&
           y >= 0 && y < this.sizeY &&
           z >= 0 && z < this.sizeZ;
  }

  getVoxel(x, y, z) {
    if (!this.inBounds(x, y, z)) return null;
    return this.voxels.get(this.getKey(x, y, z)) || null;
  }

  setVoxel(x, y, z, color) {
    if (!this.inBounds(x, y, z)) return false;
    this.voxels.set(this.getKey(x, y, z), { type: 'solid', color });
    return true;
  }

  deleteVoxel(x, y, z) {
    if (!this.inBounds(x, y, z)) return false;
    this.voxels.delete(this.getKey(x, y, z));
    return true;
  }

  hasVoxel(x, y, z) {
    return this.voxels.has(this.getKey(x, y, z));
  }
}

class RenderSystem {
  constructor(container, world) {
    this.container = container;
    this.world = world;
    this.voxelSize = 40; // matches CSS
    this.elements = new Map();
  }

  // Face culling logic: only draw faces that border empty space
  render() {
    this.container.innerHTML = '';
    this.elements.clear();
    let drawnFaces = 0;

    // Grid floor offset (center of grid)
    const offsetX = (this.world.sizeX * this.voxelSize) / 2;
    const offsetY = (this.world.sizeY * this.voxelSize) / 2;
    const offsetZ = (this.world.sizeZ * this.voxelSize) / 2;

    for (const [key, voxel] of this.world.voxels.entries()) {
      const [x, y, z] = key.split(',').map(Number);
      
      const el = document.createElement('div');
      el.className = 'voxel';
      
      // Map grid coordinates to 3D space
      // x -> x
      // y -> z (depth in CSS 3D typically, but we use Z for height here. Let's map Y to CSS Y, Z to CSS Z)
      // Actually standard: X = right, Y = up/down, Z = towards screen.
      // Let's use X, Y (horizontal plane), Z (up).
      // CSS Translate: X is right, Y is down, Z is towards viewer.
      // So posZ = -Y (CSS Y), posY = -Z (CSS Z)
      const posX = x * this.voxelSize - offsetX + this.voxelSize/2;
      const posY = -(z * this.voxelSize) + offsetZ - this.voxelSize/2; 
      const posZ = y * this.voxelSize - offsetY + this.voxelSize/2;

      el.style.transform = `translate3d(${posX}px, ${posY}px, ${posZ}px)`;
      el.dataset.x = x;
      el.dataset.y = y;
      el.dataset.z = z;

      // Add faces with culling
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
        if (!this.world.hasVoxel(x + f.dx, y + f.dy, z + f.dz)) {
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
        this.elements.set(key, el);
      }
    }

    document.getElementById('debug-info').innerText = `Voxels: ${this.world.voxels.size} | Faces: ${drawnFaces}`;
  }
}

class CameraControl {
  constructor(sceneEl) {
    this.scene = sceneEl;
    this.rotX = -30;
    this.rotY = 45;
    this.isDragging = false;
    this.lastMouseX = 0;
    this.lastMouseY = 0;

    this.bindEvents();
    this.update();
  }

  bindEvents() {
    const viewport = document.getElementById('viewport');
    
    viewport.addEventListener('mousedown', (e) => {
      // Only rotate on middle click or if we hold a modifier. Let's do right click or middle click
      if (e.button === 0 && e.target.classList.contains('face')) return; // Left click on voxel is for tools
      this.isDragging = true;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isDragging) return;
      const deltaX = e.clientX - this.lastMouseX;
      const deltaY = e.clientY - this.lastMouseY;
      
      this.rotY += deltaX * 0.5;
      this.rotX -= deltaY * 0.5;
      
      this.rotX = Math.max(-89, Math.min(89, this.rotX)); // restrict pitch
      
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
      this.update();
    });

    window.addEventListener('mouseup', () => {
      this.isDragging = false;
    });

    // Touch support for orbit
    viewport.addEventListener('touchstart', (e) => {
      if(e.touches.length === 1) {
        if(e.target.classList.contains('face')) return; // let tap through
        this.isDragging = true;
        this.lastMouseX = e.touches[0].clientX;
        this.lastMouseY = e.touches[0].clientY;
      }
    }, {passive: false});

    viewport.addEventListener('touchmove', (e) => {
      if (!this.isDragging || e.touches.length !== 1) return;
      const deltaX = e.touches[0].clientX - this.lastMouseX;
      const deltaY = e.touches[0].clientY - this.lastMouseY;
      
      this.rotY += deltaX * 0.5;
      this.rotX -= deltaY * 0.5;
      this.rotX = Math.max(-89, Math.min(89, this.rotX));
      
      this.lastMouseX = e.touches[0].clientX;
      this.lastMouseY = e.touches[0].clientY;
      this.update();
    }, {passive: true});

    viewport.addEventListener('touchend', () => {
      this.isDragging = false;
    });
  }

  update() {
    this.scene.style.transform = `rotateX(${this.rotX}deg) rotateY(${this.rotY}deg)`;
  }
}

// Main App Initialization
document.addEventListener('DOMContentLoaded', () => {
  const world = new VoxelWorldModel(8, 8, 8);
  const sceneEl = document.getElementById('scene');
  const renderer = new RenderSystem(sceneEl, world);
  const camera = new CameraControl(sceneEl);

  let activeColor = '#00f0ff';
  let activeTool = 'add'; // 'add' or 'erase'

  // Pre-fill a base 4x4 platform
  for(let x=2; x<6; x++) {
    for(let y=2; y<6; y++) {
      world.setVoxel(x, y, 0, '#262b50');
    }
  }
  renderer.render();

  // Handle Palette clicks
  document.querySelectorAll('.color-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeColor = btn.dataset.color;
    });
  });

  // Handle Tools
  document.getElementById('tool-add').addEventListener('click', (e) => {
    activeTool = 'add';
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
    e.target.classList.add('active');
  });

  document.getElementById('tool-erase').addEventListener('click', (e) => {
    activeTool = 'erase';
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
    e.target.classList.add('active');
  });

  // Handle clicking on faces to add/remove
  sceneEl.addEventListener('click', (e) => {
    if (!e.target.classList.contains('face')) return;
    
    const voxelEl = e.target.parentElement;
    const x = parseInt(voxelEl.dataset.x);
    const y = parseInt(voxelEl.dataset.y);
    const z = parseInt(voxelEl.dataset.z);
    
    if (activeTool === 'erase') {
      world.deleteVoxel(x, y, z);
      renderer.render();
    } else if (activeTool === 'add') {
      const dir = e.target.dataset.dir;
      let nx = x, ny = y, nz = z;
      if (dir === 'top') nz++;
      if (dir === 'bottom') nz--;
      if (dir === 'front') ny++;
      if (dir === 'back') ny--;
      if (dir === 'right') nx++;
      if (dir === 'left') nx--;

      if (world.setVoxel(nx, ny, nz, activeColor)) {
        renderer.render();
      }
    }
  });

  // Handle tab switching
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      
      tab.classList.add('active');
      document.getElementById(tab.dataset.target).classList.add('active');
    });
  });
});
