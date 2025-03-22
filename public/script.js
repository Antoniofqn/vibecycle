import * as THREE from 'three';

// Scene Setup
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101010);

// Camera Setup
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

// Renderer Setup
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// Handle Resize
window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

// Lighting
scene.add(new THREE.AmbientLight(0xffffff, 0.7));
const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
directionalLight.position.set(10, 20, 5);
scene.add(directionalLight);

// Arena (larger grid)
const gridSize = 800;
const gridDivisions = gridSize; // now each square is exactly 1x1 unit
const gridHelper = new THREE.GridHelper(gridSize, gridDivisions, 0x444444, 0x222222);
scene.add(gridHelper);

// Arena Size
const arenaSize = gridSize / 2;

// Keep track of other players
const otherPlayers = {};

// Improved Trail Class with flicker fixes
class Trail {
  constructor(color, maxLength = 100) {
    this.color = color;
    this.maxLength = maxLength;
    this.positions = [];

    // Using fixed size buffers for stability
    // Using triangles instead of indexed geometry to avoid flicker during updates
    this.geometry = new THREE.BufferGeometry();

    // Pre-allocate larger buffers to avoid resizing
    // Each trail segment is 2 triangles (6 vertices) for each visible face (top, left, right)
    // 6 vertices per face * 3 faces = 18 vertices per segment
    // Each vertex has 3 coordinates (x, y, z)
    this.vertexCount = maxLength * 18;
    this.vertices = new Float32Array(this.vertexCount * 3);

    // Add colors to make the trail more visible
    this.colors = new Float32Array(this.vertexCount * 3);
    const colorObj = new THREE.Color(this.color);

    // Fill the color buffer with the trail color
    for (let i = 0; i < this.vertexCount; i++) {
      this.colors[i * 3] = colorObj.r;
      this.colors[i * 3 + 1] = colorObj.g;
      this.colors[i * 3 + 2] = colorObj.b;
    }

    // Setup buffers
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.vertices, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));

    // Create a single material with vertex colors
    this.material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      transparent: false,
      opacity: 1.0 // Ensure full opacity
    });

    // Create a single mesh for the entire trail
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false; // Prevent disappearing when partially off-screen
    this.mesh.position.y = 0.25; // Set the height once

    // Trail segment count
    this.segmentCount = 0;

    // Set draw range to 0 initially
    this.geometry.setDrawRange(0, 0);
  }

  addSegment(fromX, fromZ, toX, toZ) {
    // Store position for collision detection
    this.positions.push({ x: toX, z: toZ });
    if (this.positions.length > this.maxLength) {
      this.positions.shift();
    }

    // If this is the first segment, initialize previous perpendicular vertices
    if (this.positions.length === 1) {
      return;
    }

    const width = 0.2;
    const halfWidth = width / 2;
    const height = 0.5;

    // Calculate direction vector
    const dirX = toX - fromX;
    const dirZ = toZ - fromZ;
    const length = Math.sqrt(dirX * dirX + dirZ * dirZ);

    // Normalize direction
    const normDirX = dirX / length;
    const normDirZ = dirZ / length;

    // Calculate perpendicular offset
    const perpX = -normDirZ * halfWidth;
    const perpZ = normDirX * halfWidth;

    const segmentIndex = this.segmentCount;
    const vertexOffset = segmentIndex * 18 * 3;

    const v = this.vertices;

    // If it's the first rendered segment, calculate from offset points
    if (segmentIndex === 0) {
      this.prevLeftX = fromX + perpX;
      this.prevLeftZ = fromZ + perpZ;
      this.prevRightX = fromX - perpX;
      this.prevRightZ = fromZ - perpZ;
    }

    const currLeftX = toX + perpX;
    const currLeftZ = toZ + perpZ;
    const currRightX = toX - perpX;
    const currRightZ = toZ - perpZ;

    // Top Face (2 triangles)
    // Triangle 1
    v[vertexOffset + 0] = this.prevLeftX; v[vertexOffset + 1] = height; v[vertexOffset + 2] = this.prevLeftZ;
    v[vertexOffset + 3] = currLeftX; v[vertexOffset + 4] = height; v[vertexOffset + 5] = currLeftZ;
    v[vertexOffset + 6] = currRightX; v[vertexOffset + 7] = height; v[vertexOffset + 8] = currRightZ;

    // Triangle 2
    v[vertexOffset + 9] = this.prevLeftX; v[vertexOffset + 10] = height; v[vertexOffset + 11] = this.prevLeftZ;
    v[vertexOffset + 12] = currRightX; v[vertexOffset + 13] = height; v[vertexOffset + 14] = currRightZ;
    v[vertexOffset + 15] = this.prevRightX; v[vertexOffset + 16] = height; v[vertexOffset + 17] = this.prevRightZ;

    // Left Side Face (2 triangles)
    // Triangle 1
    v[vertexOffset + 18] = this.prevLeftX; v[vertexOffset + 19] = height; v[vertexOffset + 20] = this.prevLeftZ;
    v[vertexOffset + 21] = this.prevLeftX; v[vertexOffset + 22] = 0; v[vertexOffset + 23] = this.prevLeftZ;
    v[vertexOffset + 24] = currLeftX; v[vertexOffset + 25] = height; v[vertexOffset + 26] = currLeftZ;

    // Triangle 2
    v[vertexOffset + 27] = currLeftX; v[vertexOffset + 28] = height; v[vertexOffset + 29] = currLeftZ;
    v[vertexOffset + 30] = this.prevLeftX; v[vertexOffset + 31] = 0; v[vertexOffset + 32] = this.prevLeftZ;
    v[vertexOffset + 33] = currLeftX; v[vertexOffset + 34] = 0; v[vertexOffset + 35] = currLeftZ;

    // Right Side Face (2 triangles)
    // Triangle 1
    v[vertexOffset + 36] = this.prevRightX; v[vertexOffset + 37] = height; v[vertexOffset + 38] = this.prevRightZ;
    v[vertexOffset + 39] = currRightX; v[vertexOffset + 40] = height; v[vertexOffset + 41] = currRightZ;
    v[vertexOffset + 42] = this.prevRightX; v[vertexOffset + 43] = 0; v[vertexOffset + 44] = this.prevRightZ;

    // Triangle 2
    v[vertexOffset + 45] = currRightX; v[vertexOffset + 46] = height; v[vertexOffset + 47] = currRightZ;
    v[vertexOffset + 48] = currRightX; v[vertexOffset + 49] = 0; v[vertexOffset + 50] = currRightZ;
    v[vertexOffset + 51] = this.prevRightX; v[vertexOffset + 52] = 0; v[vertexOffset + 53] = this.prevRightZ;

    // Update previous vertices for next segment
    this.prevLeftX = currLeftX;
    this.prevLeftZ = currLeftZ;
    this.prevRightX = currRightX;
    this.prevRightZ = currRightZ;

    // Update geometry
    this.geometry.attributes.position.needsUpdate = true;
    this.segmentCount++;
    this.geometry.setDrawRange(0, this.segmentCount * 18);

    if (this.segmentCount >= this.maxLength - 1) {
      this.shiftGeometry();
    }
  }

  shiftGeometry() {
    // Instead of resetting, shift the geometry back to make room for new segments
    // This prevents the "flicker" that occurs when resetting the entire buffer

    // Keep most recent segments and discard oldest
    const verticesToKeep = (this.maxLength - 10) * 18 * 3; // Keep all but 10 oldest segments
    const newOffset = 10 * 18 * 3; // Discard 10 oldest segments

    // Shift the vertices in the buffer
    for (let i = 0; i < verticesToKeep; i++) {
      this.vertices[i] = this.vertices[i + newOffset];
    }

    // Reduce segment count
    this.segmentCount -= 10;

    // Update geometry
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.setDrawRange(0, this.segmentCount * 18);
  }

  clear() {
    this.positions = [];
    this.segmentCount = 0;
    this.geometry.setDrawRange(0, 0);
    this.geometry.attributes.position.needsUpdate = true;
  }
}

// Motorcycle
const playerColor = new THREE.Color(Math.random(), Math.random(), Math.random());
const motorcycle = new THREE.Mesh(
  new THREE.BoxGeometry(0.5, 0.5, 1),
  new THREE.MeshStandardMaterial({ color: playerColor })
);
motorcycle.position.set(0, 0.25, 0);
scene.add(motorcycle);

// Create player trail
const playerTrail = new Trail(playerColor);
scene.add(playerTrail.mesh);

// Movement vars
let speed = 0.8;
let directionAngle = 0;
let moveInterval = 0.1; // Snapping interval

// Keyboard input tracking
const keys = { left: false, right: false };

window.addEventListener('keydown', ({ code }) => {
  if (code === 'ArrowLeft' || code === 'KeyA') keys.left = true;
  if (code === 'ArrowRight' || code === 'KeyD') keys.right = true;
});

window.addEventListener('keyup', ({ code }) => {
  if (code === 'ArrowLeft' || code === 'KeyA') keys.left = false;
  if (code === 'ArrowRight' || code === 'KeyD') keys.right = false;
});

// Collision Detection
// Improved collision check against trail segments
function checkCollision(x, z) {
  // Check boundaries
  if (Math.abs(x) > arenaSize || Math.abs(z) > arenaSize) {
    console.log("Collision with Arena Boundary!");
    return true;
  }

  // Check your own trail segments
  if (segmentCollision(playerTrail.positions, x, z)) {
    console.log("Collision with Your Trail!");
    return true;
  }

  // Check ALL other players' trail segments
  for (const id in otherPlayers) {
    const player = otherPlayers[id];
    if (segmentCollision(player.trail.positions, x, z)) {
      console.log("Collision with Another Player's Trail!");
      return true;
    }
  }

  return false;
}

// Checks collision with segments instead of points
function segmentCollision(positions, x, z) {
  const collisionWidth = 0.2; // Trail width, match visual trail width
  const halfWidth = collisionWidth / 2;

  for (let i = 1; i < positions.length; i++) {
    const from = positions[i - 1];
    const to = positions[i];

    // Determine bounding box for each segment
    const minX = Math.min(from.x, to.x) - halfWidth;
    const maxX = Math.max(from.x, to.x) + halfWidth;
    const minZ = Math.min(from.z, to.z) - halfWidth;
    const maxZ = Math.max(from.z, to.z) + halfWidth;

    if (x >= minX && x <= maxX && z >= minZ && z <= maxZ) {
      return true;
    }
  }
  return false;
}

// safe respawn position
function randomSafePosition() {
  let position;
  let safe = false;

  while (!safe) {
    const margin = 5; // Distance from arena boundaries
    const x = Math.floor(THREE.MathUtils.randInt(-arenaSize + margin, arenaSize - margin));
    const z = Math.floor(THREE.MathUtils.randInt(-arenaSize + margin, arenaSize - margin));

    safe = !positionOccupied(x, z);

    if (safe) position = { x, z };
  }
  return position;
}

// check if position is occupied by trail
function positionOccupied(x, z) {
  // Check if position occupied by player trail
  for (const pos of playerTrail.positions) {
    if (Math.abs(pos.x - x) < 1 && Math.abs(pos.z - z) < 1) {
      return true;
    }
  }

  // Check if position occupied by other players' trails
  for (const id in otherPlayers) {
    const player = otherPlayers[id];
    for (const pos of player.trail.positions) {
      if (Math.abs(pos.x - x) < 1 && Math.abs(pos.z - z) < 1) {
        return true;
      }
    }
  }

  return false;
}

// Initial spawn
const initialSpawn = randomSafePosition();
motorcycle.position.set(initialSpawn.x, 0.25, initialSpawn.z);

// Last position tracking to prevent duplicate trail segments
let lastX = motorcycle.position.x;
let lastZ = motorcycle.position.z;

// Snapped Motorcycle Movement
function updateMotorcycle() {
  const prevX = motorcycle.position.x;
  const prevZ = motorcycle.position.z;

  if (keys.left) {
    directionAngle += Math.PI / 2;
    keys.left = false;
  }
  if (keys.right) {
    directionAngle -= Math.PI / 2;
    keys.right = false;
  }

  directionAngle = directionAngle % (2 * Math.PI); // Keep angles clean

  const dirX = Math.round(Math.sin(directionAngle));
  const dirZ = Math.round(Math.cos(directionAngle));

  const nextX = Math.round(motorcycle.position.x) + dirX;
  const nextZ = Math.round(motorcycle.position.z) + dirZ;

  // Check collision at next position BEFORE moving
  if (checkCollision(nextX, nextZ)) {
    console.log("Collision Detected! Resetting Game.");

    // Clear existing trail
    playerTrail.clear();

    // Reset motorcycle
    const newSpawn = randomSafePosition();
    motorcycle.position.set(newSpawn.x, 0.25, newSpawn.z);
    motorcycle.rotation.y = 0;
    directionAngle = 0;

    // Update last positions
    lastX = motorcycle.position.x;
    lastZ = motorcycle.position.z;

    socket.emit('playerCollision', {
      position: motorcycle.position,
      trail: playerTrail.positions,
    });

    return;
  }

  // Move exactly 1 unit per step, ensuring alignment
  motorcycle.position.x = Math.round(motorcycle.position.x) + dirX;
  motorcycle.position.z = Math.round(motorcycle.position.z) + dirZ;

  // Correctly snap rotation angle
  motorcycle.rotation.y = directionAngle;

  // Force precise snapping on grid (integers)
  motorcycle.position.x = Math.round(motorcycle.position.x);
  motorcycle.position.z = Math.round(motorcycle.position.z);

  // Only add trail segment if we've actually moved
  if (prevX !== lastX || prevZ !== lastZ) {
    playerTrail.addSegment(prevX, prevZ, motorcycle.position.x, motorcycle.position.z);

    // Update last position
    lastX = motorcycle.position.x;
    lastZ = motorcycle.position.z;

    socket.emit('playerMove', {
      position: motorcycle.position,
      trail: playerTrail.positions,
    });
  }
}

// Camera Follow
function updateCamera() {
  camera.position.lerp(
    new THREE.Vector3(
      motorcycle.position.x - Math.sin(directionAngle) * 10,
      motorcycle.position.y + 12,
      motorcycle.position.z - Math.cos(directionAngle) * 10
    ),
    0.1
  );
  camera.lookAt(motorcycle.position);
}

// Animation loop
function animate() {
  requestAnimationFrame(animate);
  updateMotorcycle();
  updateCamera();
  renderer.render(scene, camera);
}

// Socket
const socket = io();

// Initialize player on connect
socket.emit('newPlayer', {
  position: motorcycle.position,
  color: playerColor.getHex(),
  trail: [],
});

socket.on('updatePlayers', (players) => {
  for (const id in players) {
    if (id === socket.id) continue;

    const data = players[id];

    if (!otherPlayers[id]) {
      const otherMotorcycle = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.5, 1),
        new THREE.MeshStandardMaterial({ color: data.color })
      );
      scene.add(otherMotorcycle);

      const otherTrail = new Trail(data.color);
      scene.add(otherTrail.mesh);

      otherPlayers[id] = {
        motorcycle: otherMotorcycle,
        trail: otherTrail,
        lastPos: { x: data.position.x, z: data.position.z }
      };
    }

    const player = otherPlayers[id];
    player.motorcycle.position.set(data.position.x, data.position.y, data.position.z);

    // Update other player trail
    if (data.trail && data.trail.length > 0) {
      // Only process if we have new trail positions
      const lastReceivedPos = data.trail[data.trail.length - 1];

      // Check if we have a new position to add
      if (player.lastPos.x !== lastReceivedPos.x || player.lastPos.z !== lastReceivedPos.z) {
        // Find the starting point - go backwards from the end to find where we left off
        let startIdx = 0;
        for (let i = data.trail.length - 1; i > 0; i--) {
          if (data.trail[i].x === player.lastPos.x && data.trail[i].z === player.lastPos.z) {
            startIdx = i;
            break;
          }
        }

        // Add new segments
        for (let i = startIdx; i < data.trail.length - 1; i++) {
          const from = data.trail[i];
          const to = data.trail[i + 1];
          player.trail.addSegment(from.x, from.z, to.x, to.z);
        }

        // Update last position
        player.lastPos = { ...lastReceivedPos };
      }
    }
  }

  // Remove disconnected players
  for (const id in otherPlayers) {
    if (!players[id]) {
      removeOtherPlayer(id);
    }
  }
});

// Remove other player
function removeOtherPlayer(id) {
  const player = otherPlayers[id];
  scene.remove(player.motorcycle);
  scene.remove(player.trail.mesh);
  delete otherPlayers[id];
}

animate();
