// script.js - Reorganized with server authority
import * as THREE from 'three';
const socket = io();

// -------------------- Constants & Variables -------------------- //
const GRID_SIZE = 200;
const ARENA_SIZE = GRID_SIZE / 2;

// Game state variables
let playerId = null;
let playerColor = new THREE.Color(Math.random(), Math.random(), Math.random());
const otherPlayers = {};

// Input handling
const keys = { left: false, right: false };
let pendingTurn = null;

// -------------------- Scene Setup -------------------- //
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101010);

const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// Add lighting
scene.add(new THREE.AmbientLight(0xffffff, 0.7));
const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
directionalLight.position.set(10, 20, 5);
scene.add(directionalLight);

// Grid for reference
const gridHelper = new THREE.GridHelper(GRID_SIZE, GRID_SIZE, 0x444444, 0x222222);
scene.add(gridHelper);

// Handle window resizing
window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

// -------------------- Player Class -------------------- //
class Player {
  constructor(id, color, position, isLocalPlayer = false) {
    this.id = id;
    this.isLocalPlayer = isLocalPlayer;

    // Create motorcycle mesh
    this.motorcycle = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.5, 1),
      new THREE.MeshStandardMaterial({ color })
    );
    this.motorcycle.position.copy(position);
    this.motorcycle.position.y = 0.25; // Lift slightly off ground
    scene.add(this.motorcycle);

    // Create trail with simplified geometry
    this.trailMaterial = new THREE.MeshBasicMaterial({
      color,
      side: THREE.DoubleSide
    });

    // Use a group to hold trail segments
    this.trailSegments = new THREE.Group();
    scene.add(this.trailSegments);

    // Camera setup for local player
    if (isLocalPlayer) {
      this.updateCamera();
    }
  }

  updatePosition(position, direction) {
    // Update motorcycle position and rotation
    this.motorcycle.position.copy(position);
    this.motorcycle.rotation.y = direction;

    // Update camera if this is the local player
    if (this.isLocalPlayer) {
      this.updateCamera();
    }
  }

  addTrailSegment(fromPos, toPos) {
    const width = 0.2;
    const height = 0.5;

    // Calculate direction
    const dirX = toPos.x - fromPos.x;
    const dirZ = toPos.z - fromPos.z;

    // Calculate segment length
    const length = Math.sqrt(dirX * dirX + dirZ * dirZ);

    // Create a simple box geometry for the trail segment
    const geometry = new THREE.BoxGeometry(width, height, length);
    const segment = new THREE.Mesh(geometry, this.trailMaterial);

    // Position at midpoint between from and to
    segment.position.set(
      (fromPos.x + toPos.x) / 2,
      height / 2, // Half height off ground
      (fromPos.z + toPos.z) / 2
    );

    // Rotate to align with direction
    segment.rotation.y = Math.atan2(dirX, dirZ);

    // Add to trail group
    this.trailSegments.add(segment);

    const MAX_TRAIL_SEGMENTS = 50; // Match server's MAX_TRAIL_LENGTH
    if (this.trailSegments.children.length > MAX_TRAIL_SEGMENTS) {
      const oldestSegment = this.trailSegments.children[0];
      this.trailSegments.remove(oldestSegment);
      oldestSegment.geometry.dispose();
      oldestSegment.material.dispose();
    }
  }

  clearTrail() {
    // Remove all trail segments
    while (this.trailSegments.children.length > 0) {
      const segment = this.trailSegments.children[0];
      this.trailSegments.remove(segment);
      segment.geometry.dispose();
    }
  }

  updateCamera(instant = false) {
    const direction = this.motorcycle.rotation.y;
    const targetPos = new THREE.Vector3(
      this.motorcycle.position.x - Math.sin(direction) * 10,
      this.motorcycle.position.y + 12,
      this.motorcycle.position.z - Math.cos(direction) * 10
    );

    // Smooth camera movement
    if (instant) {
      // Instantly move camera to proper position
      camera.position.copy(targetPos);
    } else {
      // Smooth camera movement
      camera.position.lerp(targetPos, 0.1);
    }
    camera.lookAt(this.motorcycle.position);
  }

  respawn(position, direction) {
    // Update position and rotation
    this.motorcycle.position.copy(position);
    this.motorcycle.rotation.y = direction;

    // Clear trail
    this.clearTrail();

    // Instantly update camera for local player
    if (this.isLocalPlayer) {
      this.updateCamera(true); // Pass true for instant camera positioning
    }

    // Optional: Show a respawn effect
    this.showRespawnEffect();
  }

  showRespawnEffect() {
    // Create a simple respawn effect (a brief glow)
    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(2, 16, 16),
      new THREE.MeshBasicMaterial({
        color: this.motorcycle.material.color,
        transparent: true,
        opacity: 0.7
      })
    );

    glow.position.copy(this.motorcycle.position);
    glow.position.y = 1;
    scene.add(glow);

    // Animate the glow effect
    const fadeOut = () => {
      if (glow.scale.x <= 0.1) {
        scene.remove(glow);
        glow.geometry.dispose();
        glow.material.dispose();
        return;
      }

      glow.scale.multiplyScalar(0.9);
      glow.material.opacity *= 0.9;

      requestAnimationFrame(fadeOut);
    };

    fadeOut();
  }

  remove() {
    scene.remove(this.motorcycle);
    scene.remove(this.trailSegments);
    this.motorcycle.geometry.dispose();
    this.motorcycle.material.dispose();
    this.clearTrail();
  }

  // Add visual explosion effect on collision
  showCollisionEffect() {
    // Create a simple explosion effect
    const particles = 15;
    const explosionGroup = new THREE.Group();
    scene.add(explosionGroup);

    const geometry = new THREE.BoxGeometry(0.2, 0.2, 0.2);
    const material = new THREE.MeshBasicMaterial({
      color: this.motorcycle.material.color,
      emissive: 0xffffff,
      emissiveIntensity: 1
    });

    // Create particles
    for (let i = 0; i < particles; i++) {
      const particle = new THREE.Mesh(geometry, material);

      // Random position around the motorcycle
      particle.position.copy(this.motorcycle.position);
      particle.position.x += (Math.random() - 0.5) * 2;
      particle.position.y += Math.random() * 2;
      particle.position.z += (Math.random() - 0.5) * 2;

      // Random velocity
      particle.userData.velocity = new THREE.Vector3(
        (Math.random() - 0.5) * 0.3,
        Math.random() * 0.2,
        (Math.random() - 0.5) * 0.3
      );

      explosionGroup.add(particle);
    }

    // Animate the explosion
    const animateExplosion = () => {
      if (explosionGroup.children.length === 0) {
        scene.remove(explosionGroup);
        return;
      }

      for (let i = explosionGroup.children.length - 1; i >= 0; i--) {
        const particle = explosionGroup.children[i];

        // Update position
        particle.position.add(particle.userData.velocity);

        // Apply gravity
        particle.userData.velocity.y -= 0.01;

        // Fade out
        particle.scale.multiplyScalar(0.95);

        // Remove when too small
        if (particle.scale.x < 0.1) {
          explosionGroup.remove(particle);
          particle.geometry.dispose();
          particle.material.dispose();
        }
      }

      requestAnimationFrame(animateExplosion);
    };

    animateExplosion();
  }
}

// -------------------- Input Handling -------------------- //
function setupControls() {
  window.addEventListener('keydown', (event) => {
    if (event.repeat) return; // Ignore key repeats

    if (event.code === 'ArrowLeft' || event.code === 'KeyA') {
      socket.emit('turnLeft');
      pendingTurn = 'left';
    }
    else if (event.code === 'ArrowRight' || event.code === 'KeyD') {
      socket.emit('turnRight');
      pendingTurn = 'right';
    }
  });
}

// -------------------- Socket Event Handlers -------------------- //
function setupSocketHandlers() {
  // Connect to the game
  socket.on('connect', () => {
    playerId = socket.id;
    socket.emit('joinGame', { color: playerColor.getHex() });
  });

  // Receive initial game state
  socket.on('gameState', (state) => {
    // Create all existing players
    for (const id in state) {
      const playerData = state[id];

      if (id === playerId) {
        // Create local player
        const position = new THREE.Vector3(
          playerData.position.x,
          playerData.position.y,
          playerData.position.z
        );
        otherPlayers[id] = new Player(id, playerData.color, position, true);
      } else {
        // Create other players
        const position = new THREE.Vector3(
          playerData.position.x,
          playerData.position.y,
          playerData.position.z
        );
        otherPlayers[id] = new Player(id, playerData.color, position, false);
      }

      // Add existing trail segments
      if (playerData.trail.length > 1) {
        for (let i = 1; i < playerData.trail.length; i++) {
          const from = playerData.trail[i-1];
          const to = playerData.trail[i];
          otherPlayers[id].addTrailSegment(
            { x: from.x, z: from.z },
            { x: to.x, z: to.z }
          );
        }
      }
    }
  });

  // Player joined
  socket.on('playerJoined', (data) => {
    if (data.id !== playerId && !otherPlayers[data.id]) {
      const position = new THREE.Vector3(
        data.position.x,
        data.position.y,
        data.position.z
      );
      otherPlayers[data.id] = new Player(data.id, data.color, position, false);
    }
  });

  // Player movement update
  socket.on('playerMove', (data) => {
    if (otherPlayers[data.id]) {
      const position = new THREE.Vector3(
        data.position.x,
        data.position.y,
        data.position.z
      );

      otherPlayers[data.id].updatePosition(position, data.direction);

      // Add new trail segment if provided
      if (data.newSegment) {
        otherPlayers[data.id].addTrailSegment(
          data.newSegment.from,
          data.newSegment.to
        );
      }
    }
  });

  // Turn confirmation
  socket.on('turnConfirmed', (data) => {
    if (otherPlayers[playerId]) {
      otherPlayers[playerId].motorcycle.rotation.y = data.direction;
      pendingTurn = null; // Clear pending turn
    }
  });

  // Player collision
  socket.on('playerCollision', (data) => {
    if (otherPlayers[data.id]) {
      // Show collision effect
      otherPlayers[data.id].showCollisionEffect();
      console.log(`Player ${data.id} collided!`);
    }
  });

  // Player respawned automatically
  socket.on('playerRespawned', (data) => {
    if (otherPlayers[data.id]) {
      const position = new THREE.Vector3(
        data.position.x,
        data.position.y,
        data.position.z
      );

      otherPlayers[data.id].respawn(position, data.direction);
    }
  });

  // Player left
  socket.on('playerLeft', (data) => {
    if (otherPlayers[data.id]) {
      otherPlayers[data.id].remove();
      delete otherPlayers[data.id];
    }
  });
}

// -------------------- Animation Loop -------------------- //
function animate() {
  requestAnimationFrame(animate);
  renderer.render(scene, camera);
}

// -------------------- Initialize Game -------------------- //
function initGame() {
  setupControls();
  setupSocketHandlers();
  animate();
}

// Start the game
initGame();
