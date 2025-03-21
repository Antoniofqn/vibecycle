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

// Motorcycle// Motorcycle
const playerColor = new THREE.Color(Math.random(), Math.random(), Math.random());
const motorcycle = new THREE.Mesh(
  new THREE.BoxGeometry(0.5, 0.5, 1),
  new THREE.MeshStandardMaterial({ color: playerColor })
);
motorcycle.position.set(0, 0.25, 0);
scene.add(motorcycle);


// Trail variables
const trailMaterial = new THREE.MeshStandardMaterial({
  color: playerColor.clone().lerp(new THREE.Color(0xffffff), 0.5),
  emissive: playerColor,
  emissiveIntensity: 0.8,
});

const trailSegments = [];
const maxTrailLength = 100;


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

// update trail line
function addTrailSegment(fromX, fromZ, toX, toZ) {
  const distance = Math.sqrt((toX - fromX) ** 2 + (toZ - fromZ) ** 2);
  const geometry = new THREE.BoxGeometry(0.2, 0.5, distance);

  const segment = new THREE.Mesh(geometry, trailMaterial);

  segment.position.set(
    (fromX + toX) / 2,
    0.25,
    (fromZ + toZ) / 2
  );

  segment.lookAt(new THREE.Vector3(toX, 0.25, toZ));

  scene.add(segment);
  trailSegments.push(segment);

  if (trailSegments.length > maxTrailLength) {
    const oldest = trailSegments.shift();
    scene.remove(oldest);
  }
}

// Collision Detection
function checkCollision(x, z) {
  // Boundary collision
  if (Math.abs(x) > arenaSize || Math.abs(z) > arenaSize) {
    console.log("Collision with Arena Boundary!");
    return true;
  }

  // Trail collision (check exact positions occupied by segments)
  for (const segment of trailSegments) {
    const segmentPos = segment.position;
    const segLength = segment.geometry.parameters.depth / 2;

    const dir = new THREE.Vector3();
    segment.getWorldDirection(dir);

    const start = segmentPos.clone().add(dir.clone().multiplyScalar(-segLength));
    const end = segmentPos.clone().add(dir.clone().multiplyScalar(segLength));

    // Check if next position matches any segment endpoints or is on segment
    if ((Math.abs(start.x - x) < 0.1 && Math.abs(start.z - z) < 0.1) ||
        (Math.abs(end.x - x) < 0.1 && Math.abs(end.z - z) < 0.1)) {
      console.log("Collision with Trail!");
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
  // Check if position occupied by trails
  for (const segment of trailSegments) {
    if (segment.position.distanceTo(new THREE.Vector3(x, segment.position.y, z)) < 1) {
      return true;
    }
  }
  return false;
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
    trailSegments.forEach(segment => scene.remove(segment));
    trailSegments.length = 0;

    // Reset motorcycle
    const newSpawn = randomSafePosition();
    motorcycle.position.set(newSpawn.x, 0.25, newSpawn.z);
    motorcycle.rotation.y = 0;
    directionAngle = 0;

    socket.emit('playerCollision', {
      position: motorcycle.position,
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

  addTrailSegment(prevX, prevZ, motorcycle.position.x, motorcycle.position.z);

  socket.emit('playerMove', {
    position: motorcycle.position,
    trail: trailSegments.map(segment => ({
      x: segment.position.x,
      y: segment.position.y,
      z: segment.position.z
    }))
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

    // Add new players
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
      };
    }

    // Update other players' positions
    otherPlayers[id].motorcycle.position.set(
      data.position.x,
      data.position.y,
      data.position.z
    );

    // Update trails visually for other players
    updateOtherPlayerTrails(id, data.trail);
  }

  // Remove disconnected players
  for (const id in otherPlayers) {
    if (!players[id]) {
      removeOtherPlayer(id);
    }
  }
});

// Helper functions
function updateOtherPlayerTrails(id, trailPositions) {
  const player = otherPlayers[id];
  player.trailSegments.forEach(segment => scene.remove(segment));
  player.trailSegments = [];

  for (let i = 1; i < trailPositions.length; i++) {
    const from = trailPositions[i - 1];
    const to = trailPositions[i];

    const geometry = new THREE.BoxGeometry(0.2, 0.5, 1);
    const segment = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({ color: player.color })
    );
    segment.position.set((from.x + to.x)/2, 0.25, (from.z + to.z)/2);
    segment.lookAt(new THREE.Vector3(to.x, 0.25, to.z));
    scene.add(segment);
    player.trailSegments.push(segment);
  }
}

function removeOtherPlayer(id) {
  const player = otherPlayers[id];
  scene.remove(player.motorcycle);
  player.trailSegments.forEach(segment => scene.remove(segment));
  delete otherPlayers[id];
}

animate();
