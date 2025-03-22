const express = require('express');
const app = express();
const server = require('http').createServer(app);
const io = require('socket.io')(server);

// Serve static files from 'public'
app.use(express.static('public'));

// Game constants
const GRID_SIZE = 800;
const ARENA_SIZE = GRID_SIZE / 2;
const MOVE_SPEED = 1; // Units per frame
const COLLISION_WIDTH = 0.2; // Trail width for collision detection
const MAX_TRAIL_LENGTH = 50;

// Game state (server is the authority)
const gameState = {
  players: {},

  addPlayer(id, color) {
    const position = this.findSafePosition();

    this.players[id] = {
      id,
      position: { x: position.x, y: 0.25, z: position.z },
      color,
      direction: 0, // Initial direction (0 = North, in radians)
      trail: [],
      active: true
    };

    return this.players[id];
  },

  removePlayer(id) {
    delete this.players[id];
  },

  changeDirection(id, turnDirection) {
    const player = this.players[id];
    if (!player || !player.active) return false;

    // Turn left or right (π/2 radians = 90 degrees)
    if (turnDirection === 'left') {
      player.direction += Math.PI / 2;
    } else if (turnDirection === 'right') {
      player.direction -= Math.PI / 2;
    }

    // Normalize direction angle
    player.direction = player.direction % (2 * Math.PI);

    return true;
  },

  updatePlayer(id) {
    const player = this.players[id];
    if (!player || !player.active) return null;

    // Calculate direction vector
    const dirX = Math.round(Math.sin(player.direction));
    const dirZ = Math.round(Math.cos(player.direction));

    // Calculate next position
    const prevX = player.position.x;
    const prevZ = player.position.z;
    const nextX = Math.round(prevX + dirX * MOVE_SPEED);
    const nextZ = Math.round(prevZ + dirZ * MOVE_SPEED);

    // Check for collisions
    if (this.checkCollision(id, nextX, nextZ)) {
      player.active = false;

      // Auto-respawn the player immediately
      setTimeout(() => {
        this.respawnPlayer(id);
      }, 500); // Half-second delay before respawn

      return {
        id,
        status: 'collision',
        position: { x: prevX, y: player.position.y, z: prevZ }
      };
    }

    // Update position
    player.position.x = nextX;
    player.position.z = nextZ;

    // Add new segment to trail only if we've moved
    let newSegment = null;
    if (player.trail.length === 0 ||
        (player.trail[player.trail.length-1].x !== prevX ||
         player.trail[player.trail.length-1].z !== prevZ)) {

      player.trail.push({ x: prevX, z: prevZ });
      if (player.trail.length > MAX_TRAIL_LENGTH) {
        player.trail.shift(); // Remove oldest segment
      }
      newSegment = {
        from: { x: prevX, z: prevZ },
        to: { x: nextX, z: nextZ }
      };
    }

    return {
      id,
      status: 'moved',
      position: { ...player.position },
      direction: player.direction,
      newSegment
    };
  },

  respawnPlayer(id) {
    const player = this.players[id];
    if (!player) return null;

    const position = this.findSafePosition();
    player.position = { x: position.x, y: 0.25, z: position.z };
    player.direction = 0;
    player.trail = [];
    player.active = true;

    const result = {
      id,
      status: 'respawned',
      position: { ...player.position },
      direction: player.direction
    };

    io.emit('playerRespawned', result);
    return result;
  },

  checkCollision(playerId, x, z) {
    // Check arena boundaries
    if (Math.abs(x) > ARENA_SIZE || Math.abs(z) > ARENA_SIZE) {
      return true;
    }

    // Check collisions with all trails (including own)
    for (const id in this.players) {
      // Skip empty trails
      if (this.players[id].trail.length < 2) continue;

      const trail = this.players[id].trail;

      // Check each trail segment
      for (let i = 1; i < trail.length; i++) {
        const from = trail[i-1];
        const to = trail[i];

        // Collision with trail segment
        if (this.segmentCollision(from, to, x, z)) {
          return true;
        }
      }
    }

    return false;
  },

  segmentCollision(from, to, x, z) {
    const halfWidth = COLLISION_WIDTH / 2;

    // Determine bounding box for segment
    const minX = Math.min(from.x, to.x) - halfWidth;
    const maxX = Math.max(from.x, to.x) + halfWidth;
    const minZ = Math.min(from.z, to.z) - halfWidth;
    const maxZ = Math.max(from.z, to.z) + halfWidth;

    // Simple bounding box check
    if (x >= minX && x <= maxX && z >= minZ && z <= maxZ) {
      return true;
    }

    return false;
  },

  findSafePosition() {
    const margin = 5; // Distance from arena boundaries
    let attempts = 0;
    const maxAttempts = 50;

    while (attempts < maxAttempts) {
      const x = Math.floor(Math.random() * (ARENA_SIZE * 2 - margin * 2) - ARENA_SIZE + margin);
      const z = Math.floor(Math.random() * (ARENA_SIZE * 2 - margin * 2) - ARENA_SIZE + margin);

      // Check if position is far enough from all players and trails
      let safe = true;
      const safeDistance = 5; // Minimum distance from others

      for (const id in this.players) {
        const player = this.players[id];

        // Check distance from player
        const dx = player.position.x - x;
        const dz = player.position.z - z;
        const distSquared = dx * dx + dz * dz;

        if (distSquared < safeDistance * safeDistance) {
          safe = false;
          break;
        }

        // Check distance from trail
        for (const pos of player.trail) {
          const dx = pos.x - x;
          const dz = pos.z - z;
          const distSquared = dx * dx + dz * dz;

          if (distSquared < safeDistance * safeDistance) {
            safe = false;
            break;
          }
        }

        if (!safe) break;
      }

      if (safe) {
        return { x, z };
      }

      attempts++;
    }

    // Fallback to a random position if we can't find a safe one
    return {
      x: Math.floor(Math.random() * (ARENA_SIZE - margin) - ARENA_SIZE/2),
      z: Math.floor(Math.random() * (ARENA_SIZE - margin) - ARENA_SIZE/2)
    };
  },

  getInitialState() {
    const state = {};
    for (const id in this.players) {
      const player = this.players[id];
      state[id] = {
        id,
        position: { ...player.position },
        color: player.color,
        direction: player.direction,
        trail: [...player.trail],
        active: player.active
      };
    }
    return state;
  }
};

// Game loop
const FPS = 24;
const FRAME_TIME = 1000 / FPS;
let lastUpdateTime = Date.now();

function gameLoop() {
  const now = Date.now();
  const dt = now - lastUpdateTime;

  if (dt >= FRAME_TIME) {
    lastUpdateTime = now;

    // Update all active players
    for (const id in gameState.players) {
      const player = gameState.players[id];
      if (player.active) {
        const update = gameState.updatePlayer(id);
        if (update) {
          if (update.status === 'collision') {
            io.emit('playerCollision', { id });
          } else if (update.status === 'moved' && update.newSegment) {
            io.emit('playerMove', {
              id,
              position: update.position,
              direction: update.direction,
              newSegment: update.newSegment
            });
          }
        }
      }
    }
  }

  setTimeout(gameLoop, 5); // Run loop ~200 times per second for precision
}

// Socket.IO event handlers
io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  socket.on('joinGame', ({ color }) => {
    // Create a new player
    const player = gameState.addPlayer(socket.id, color);

    // Send initial game state to the new player
    socket.emit('gameState', gameState.getInitialState());

    // Notify others about the new player
    socket.broadcast.emit('playerJoined', {
      id: player.id,
      position: player.position,
      color: player.color,
      direction: player.direction,
      trail: player.trail,
      active: player.active
    });
  });

  socket.on('turnLeft', () => {
    if (gameState.changeDirection(socket.id, 'left')) {
      socket.emit('turnConfirmed', { direction: gameState.players[socket.id].direction });
    }
  });

  socket.on('turnRight', () => {
    if (gameState.changeDirection(socket.id, 'right')) {
      socket.emit('turnConfirmed', { direction: gameState.players[socket.id].direction });
    }
  });

  socket.on('disconnect', () => {
    gameState.removePlayer(socket.id);
    io.emit('playerLeft', { id: socket.id });
    console.log(`Player disconnected: ${socket.id}`);
  });
});

// Start the game loop
gameLoop();

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
