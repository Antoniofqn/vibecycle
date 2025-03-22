const express = require('express');
const app = express();
const server = require('http').createServer(app);
const io = require('socket.io')(server);

// Serve static files from 'public'
app.use(express.static('public'));

// Game constants
const GRID_SIZE = 200;
const ARENA_SIZE = GRID_SIZE / 2;
const MOVE_SPEED = 1; // Units per frame
const COLLISION_WIDTH = 0.2; // Trail width for collision detection
const MAX_TRAIL_LENGTH = 50;
const GRID_CELL_SIZE = 10;
const adjectives = [
  "Swift", "Brave", "Mighty", "Clever", "Fierce", "Agile", "Nimble", "Daring",
  "Rapid", "Sleek", "Crafty", "Bold", "Sharp", "Quick", "Smooth", "Vibrant",
  "Witty", "Deft", "Wild", "Keen"
];

const nouns = [
  "Rider", "Racer", "Pilot", "Driver", "Biker", "Runner", "Sprinter", "Chaser",
  "Cruiser", "Drifter", "Glider", "Speeder", "Blazer", "Zoomer", "Voyager",
  "Streak", "Flash", "Bolt", "Rocket", "Arrow"
];

// Generate a random username
function generateUsername() {
  const adjective = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  return `${adjective}-${noun}`;
}

// Game state (server is the authority)
const gameState = {
  players: {},
  // Store all trail segments separately from player trails
  segments: [],

  // Add this to track which segments belong to which player
  segmentOwners: new Map(),

  // Spatial grid for efficient collision detection
  spatialGrid: {
    cells: {}, // Will store segments by cell location

    // Get cell key for a position
    getCellKey(x, z) {
      const cellX = Math.floor(x / GRID_CELL_SIZE);
      const cellZ = Math.floor(z / GRID_CELL_SIZE);
      return `${cellX},${cellZ}`;
    },

    // Add a segment to the grid
    addSegment(segment) {
      // Register segment in cells along the line from 'from' to 'to'
      // For best performance, we should register in all cells the line passes through
      // Here we'll use a simplified approach with just endpoints for clarity
      const fromKey = this.getCellKey(segment.from.x, segment.from.z);
      const toKey = this.getCellKey(segment.to.x, segment.to.z);

      // Store which cells this segment is in (for later removal)
      segment.cells = new Set();

      // Add to 'from' cell
      if (!this.cells[fromKey]) {
        this.cells[fromKey] = new Set();
      }
      this.cells[fromKey].add(segment);
      segment.cells.add(fromKey);

      // Add to 'to' cell if different
      if (fromKey !== toKey) {
        if (!this.cells[toKey]) {
          this.cells[toKey] = new Set();
        }
        this.cells[toKey].add(segment);
        segment.cells.add(toKey);
      }

      // For more accuracy, we would also add to cells along the line
      // This implementation is simplified for clarity
    },

    // Remove segment from the grid
    removeSegment(segment) {
      if (!segment.cells) return;

      for (const key of segment.cells) {
        if (this.cells[key]) {
          this.cells[key].delete(segment);

          // Clean up empty cells
          if (this.cells[key].size === 0) {
            delete this.cells[key];
          }
        }
      }

      segment.cells.clear();
    },

    // Get segments near a position (in current cell and adjacent cells)
    getNearbySegments(x, z) {
      const centerX = Math.floor(x / GRID_CELL_SIZE);
      const centerZ = Math.floor(z / GRID_CELL_SIZE);
      const segments = new Set();

      // Check 3x3 grid of cells around the position
      for (let i = -1; i <= 1; i++) {
        for (let j = -1; j <= 1; j++) {
          const key = `${centerX + i},${centerZ + j}`;
          if (this.cells[key]) {
            for (const segment of this.cells[key]) {
              segments.add(segment);
            }
          }
        }
      }

      return segments;
    },

    // Clear all segments for a player from the grid
    clearPlayerSegments(playerId) {
      // For each cell in the grid
      for (const key in this.cells) {
        const cell = this.cells[key];

        // Find and remove segments belonging to this player
        for (const segment of cell) {
          if (segment.playerId === playerId) {
            this.removeSegment(segment);
          }
        }
      }
    },

    // Clear all cells
    clear() {
      this.cells = {};
    }
  },

  // Add a new player
  addPlayer(id, color) {
    const position = this.findSafePosition();

    this.players[id] = {
      id,
      username: generateUsername(),
      position: { x: position.x, y: 0.25, z: position.z },
      color,
      direction: 0, // Initial direction (0 = North, in radians)
      trail: [],
      active: true,
      score: 0
    };

    return this.players[id];
  },

  // Remove a player
  removePlayer(id) {
    // Clear player's segments from the grid
    this.spatialGrid.clearPlayerSegments(id);

    // Remove player's segments from the array
    this.segments = this.segments.filter(segment => segment.playerId !== id);

    // Delete the player
    delete this.players[id];
  },

  // Change player direction
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

  // Add trail segment with grid registration
  addTrailSegment(playerId, fromX, fromZ, toX, toZ) {
    // Create segment object
    const segment = {
      playerId,
      from: { x: fromX, z: fromZ },
      to: { x: toX, z: toZ }
    };

    // Add to segments array
    this.segments.push(segment);

    // Register segment in spatial grid
    this.spatialGrid.addSegment(segment);

    // Store ownership for scoring
    this.segmentOwners.set(segment, playerId);

    // If we exceed maximum segments, remove oldest ones
    if (this.segments.length > MAX_TRAIL_LENGTH * Object.keys(this.players).length) {
      const oldestSegment = this.segments.shift();
      this.spatialGrid.removeSegment(oldestSegment);
      this.segmentOwners.delete(oldestSegment);
    }

    return segment;
  },

  // Update player position and trail
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

     // Check for collisions using optimized grid-based collision detection
     const collisionResult = this.checkCollision(id, nextX, nextZ);

    // Check for collisions using optimized grid-based collision detection
    if (collisionResult.collision) {
      player.active = false;

      // Award points to the owner of the segment that caused the collision
      // Only if it's not a suicide (boundary or self-collision)
      const collidedWithPlayerId = collisionResult.collidedWith;

      if (collidedWithPlayerId && collidedWithPlayerId !== id) {
        const scorer = this.players[collidedWithPlayerId];
        if (scorer) {
          scorer.score += 1;

          // Broadcast the score update
          io.emit('scoreUpdate', {
            id: collidedWithPlayerId,
            username: scorer.username,
            score: scorer.score,
            color: scorer.color
          });
        }
      }

      // Auto-respawn the player after a delay
      setTimeout(() => {
        this.respawnPlayer(id);
      }, 500);

      return {
        id,
        status: 'collision',
        position: { x: prevX, y: player.position.y, z: prevZ },
        collidedWith: collidedWithPlayerId
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

      // Add to player's trail positions for tracking
      player.trail.push({ x: prevX, z: prevZ });

      // Limit trail length
      if (player.trail.length > MAX_TRAIL_LENGTH) {
        player.trail.shift();
      }

      // Create actual segment and add to spatial grid
      newSegment = this.addTrailSegment(
        id,
        prevX, prevZ,
        nextX, nextZ
      );

      // Create segment object for client
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

  // Respawn a player
  respawnPlayer(id) {
    const player = this.players[id];
    if (!player) return null;

    const position = this.findSafePosition();
    player.position = { x: position.x, y: 0.25, z: position.z };
    player.direction = 0;

    // Clear player's trail
    player.trail = [];

    // Clear player's segments from the grid
    this.spatialGrid.clearPlayerSegments(id);

    // Clear ownership for segments
    for (const [segment, ownerId] of this.segmentOwners.entries()) {
      if (ownerId === id) {
        this.segmentOwners.delete(segment);
      }
    }

    // Remove player's segments from the array
    this.segments = this.segments.filter(segment => segment.playerId !== id);

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

  // Optimized collision detection using spatial grid
  checkCollision(playerId, x, z) {
    // Check arena boundaries
    if (Math.abs(x) > ARENA_SIZE || Math.abs(z) > ARENA_SIZE) {
      return { collision: true, collidedWith: null };
    }

    // Get segments from nearby grid cells
    const nearbySegments = this.spatialGrid.getNearbySegments(x, z);

    // Check collision with each nearby segment
    for (const segment of nearbySegments) {
      // Skip very recent segments from the player to prevent self-collisions
      if (segment.playerId === playerId && this.isRecentSegment(playerId, segment)) {
        continue;
      }

      // Check collision
      if (this.segmentCollision(segment.from, segment.to, x, z)) {
        return { collision: true, collidedWith: segment.playerId };
      }
    }

    return { collision: false };
  },

  // Check if a segment is very recent (to prevent immediate self-collision)
  isRecentSegment(playerId, segment) {
    const player = this.players[playerId];
    if (!player || player.trail.length === 0) return false;

    // Check against the most recent trail position
    const lastTrailPos = player.trail[player.trail.length - 1];

    // If segment starts at the player's last position, it's recent
    return (segment.from.x === lastTrailPos.x && segment.from.z === lastTrailPos.z);
  },

  // Collision detection with a segment
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

  // Find a safe position for spawning
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

      // Check distance from all players
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
      }

      // If already unsafe, try again
      if (!safe) {
        attempts++;
        continue;
      }

      // Check distance from nearby trail segments using spatial grid
      const nearbySegments = this.spatialGrid.getNearbySegments(x, z);

      for (const segment of nearbySegments) {
        // Simple distance check from segment endpoints
        // For better accuracy, we'd check distance to the line segment

        // Check distance to 'from' endpoint
        const dx1 = segment.from.x - x;
        const dz1 = segment.from.z - z;
        const distSquared1 = dx1 * dx1 + dz1 * dz1;

        // Check distance to 'to' endpoint
        const dx2 = segment.to.x - x;
        const dz2 = segment.to.z - z;
        const distSquared2 = dx2 * dx2 + dz2 * dz2;

        if (distSquared1 < safeDistance * safeDistance ||
            distSquared2 < safeDistance * safeDistance) {
          safe = false;
          break;
        }
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

  // Get state for new clients
  getInitialState() {
    const state = {};
    for (const id in this.players) {
      const player = this.players[id];
      state[id] = {
        id,
        username: player.username,
        position: { ...player.position },
        color: player.color,
        direction: player.direction,
        trail: [...player.trail],
        active: player.active,
        score: player.score
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

    // Send initial scores to the new player
    const scores = [];
    for (const id in gameState.players) {
      const player = gameState.players[id];
      scores.push({
        id,
        username: player.username,
        score: player.score,
        color: player.color
      });
    }
    socket.emit('scoreBoard', scores);

    // Notify others about the new player
    socket.broadcast.emit('playerJoined', {
      id: player.id,
      username: player.username,
      position: player.position,
      color: player.color,
      direction: player.direction,
      trail: player.trail,
      active: player.active,
      score: player.score
    });

    // Broadcast the new player to the score board
    io.emit('scoreUpdate', {
      id: player.id,
      username: player.username,
      score: player.score,
      color: player.color
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
    const player = gameState.players[socket.id];
    if (player) {
      const username = player.username;
      gameState.removePlayer(socket.id);

      // Notify others about the player's departure
      io.emit('playerLeft', { id: socket.id, username });
    }

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
