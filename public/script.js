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
const gridHelper = new THREE.GridHelper(gridSize, 400, 0x444444, 0x222222);
scene.add(gridHelper);

// Arena Size
const arenaSize = gridSize / 2;

// Motorcycle// Motorcycle
const playerColor = new THREE.Color(Math.random(), Math.random(), Math.random());
const motorcycle = new THREE.Mesh(
  new THREE.BoxGeometry(0.5, 0.5, 1),
  new THREE.MeshStandardMaterial({ color: playerColor })
);
motorcycle.position.set(0, 0.25, 0);
scene.add(motorcycle);


// Trail variables
const trailMaterial = new THREE.MeshBasicMaterial({ color: playerColor });

const trailSegments = [];
const maxTrailLength = 100;
const trailPositions = [];
const trailSegmentGeometry = new THREE.BoxGeometry(0.2, 0.5, 1);
const maxTrailSegments = 100; // adjust as needed
const trailInstancedMesh = new THREE.InstancedMesh(trailSegmentGeometry, trailMaterial, maxTrailSegments);
scene.add(trailInstancedMesh);
let currentTrailIndex = 0;


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

// Collision Detection
function checkCollision(x, z) {
  // Check boundaries
  if (Math.abs(x) > arenaSize || Math.abs(z) > arenaSize) {
    console.log("Collision with Arena Boundary!");
    return true;
  }

  // Check your own trail positions clearly
  for (const pos of trailPositions) {
    if (pos.x === x && pos.z === z) {
      console.log("Collision with Your Trail!");
      return true;
    }
  }

  // Check ALL other players' trail positions clearly
  for (const id in otherPlayers) {
    const player = otherPlayers[id];
    for (const pos of player.trailPositions) {
      if (pos.x === x && pos.z === z) {
        console.log("Collision with Another Player's Trail!");
        return true;
      }
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
  return trailPositions.some(pos => pos.x === x && pos.z === z);
}

// Initial spawn
const initialSpawn = randomSafePosition();
motorcycle.position.set(initialSpawn.x, 0.25, initialSpawn.z);

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

    // Clear existing trails visually
    trailPositions.length = 0;
    for (let i = 0; i < maxTrailSegments; i++) {
      trailInstancedMesh.setMatrixAt(i, new THREE.Matrix4().setPosition(0, -1000, 0)); // move off-screen
    }
    trailInstancedMesh.instanceMatrix.needsUpdate = true;
    currentTrailIndex = 0;

    // Reset motorcycle
    const newSpawn = randomSafePosition();
    motorcycle.position.set(newSpawn.x, 0.25, newSpawn.z);
    motorcycle.rotation.y = 0;
    directionAngle = 0;

    socket.emit('playerCollision', {
      position: motorcycle.position,
      trail: trailPositions,
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

  const matrix = new THREE.Matrix4();
  const fromX = prevX;
  const fromZ = prevZ;
  const toX = motorcycle.position.x;
  const toZ = motorcycle.position.z;
  const distance = Math.sqrt((toX - fromX) ** 2 + (toZ - fromZ) ** 2);

  // Midpoint for position
  const midX = (fromX + toX) / 2;
  const midZ = (fromZ + toZ) / 2;

  const position = new THREE.Vector3(midX, 0.25, midZ);
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, distance);

  const lookAtTarget = new THREE.Vector3(toX, 0.25, toZ);
  const direction = lookAtTarget.clone().sub(position).normalize();
  quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction);

  // set matrix for instanced mesh
  matrix.compose(position, quaternion, scale);
  trailInstancedMesh.setMatrixAt(currentTrailIndex % maxTrailSegments, matrix);
  trailInstancedMesh.instanceMatrix.needsUpdate = true;
  currentTrailIndex++;

  // Manage trail positions for collision
  trailPositions.push({ x: motorcycle.position.x, z: motorcycle.position.z });
  if (trailPositions.length > maxTrailSegments) {
    trailPositions.shift();
  }

  socket.emit('playerMove', {
    position: motorcycle.position,
    trail: trailPositions,
  });
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

// Keep track of other players
const otherPlayers = {};

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

      otherPlayers[id] = {
        motorcycle: otherMotorcycle,
        trailSegments: [],
        color: data.color,
        trailPositions: []
      };
    }

    const player = otherPlayers[id];
    player.motorcycle.position.set(data.position.x, data.position.y, data.position.z);
    player.trailPositions = data.trail; // clearly store positions

    updateOtherPlayerTrails(player);
  }

  // Remove disconnected players
  for (const id in otherPlayers) {
    if (!players[id]) {
      removeOtherPlayer(id);
    }
  }
});

// Helper functions
// Optimized handling for other players' trails using InstancedMesh
function updateOtherPlayerTrails(player) {
  const maxSegments = 100;

  // Initialize instanced mesh if not yet created for this player
  if (!player.trailInstancedMesh) {
    const geometry = new THREE.BoxGeometry(0.2, 0.5, 1);
    const material = new THREE.MeshBasicMaterial({ color: player.color });

    player.trailInstancedMesh = new THREE.InstancedMesh(geometry, material, maxSegments);
    player.currentTrailIndex = 0;
    scene.add(player.trailInstancedMesh);
  }

  const positions = player.trailPositions;

  for (let i = 1; i < positions.length && i < maxSegments; i++) {
    const from = positions[i - 1];
    const to = positions[i];

    const distance = Math.sqrt((to.x - from.x) ** 2 + (to.z - from.z) ** 2);
    const midX = (from.x + to.x) / 2;
    const midZ = (from.z + to.z) / 2;

    const position = new THREE.Vector3(midX, 0.25, midZ);
    const scale = new THREE.Vector3(1, 1, distance);
    const quaternion = new THREE.Quaternion();

    const direction = new THREE.Vector3(to.x - from.x, 0, to.z - from.z).normalize();
    quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction);

    const matrix = new THREE.Matrix4();
    matrix.compose(position, quaternion, scale);

    player.trailInstancedMesh.setMatrixAt((player.currentTrailIndex + i) % maxSegments, matrix);
  }

  // Clear unused instances (hide them below arena)
  for (let i = positions.length; i < maxSegments; i++) {
    const offscreenMatrix = new THREE.Matrix4().setPosition(0, -1000, 0);
    player.trailInstancedMesh.setMatrixAt((player.currentTrailIndex + i) % maxSegments, offscreenMatrix);
  }

  player.trailInstancedMesh.instanceMatrix.needsUpdate = true;
}


function removeOtherPlayer(id) {
  const player = otherPlayers[id];
  scene.remove(player.motorcycle);
  if (player.trailInstancedMesh) {
    scene.remove(player.trailInstancedMesh);
  }
  delete otherPlayers[id];
}

animate();
