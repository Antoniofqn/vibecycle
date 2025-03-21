const express = require('express');
const app = express();
const server = require('http').createServer(app);
const io = require('socket.io')(server);

const MAX_TRAIL_LENGTH = 20;

// Serve static files from 'public'
app.use(express.static('public'));

// Store connected players
const players = {};

io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  socket.on('newPlayer', (playerData) => {
    players[socket.id] = playerData;
    io.emit('updatePlayers', players);
  });

  socket.on('playerMove', (playerData) => {
    if (players[socket.id]) {
      players[socket.id].position = playerData.position;
      players[socket.id].trail.push(playerData.position);

      if (players[socket.id].trail.length > MAX_TRAIL_LENGTH) {
        players[socket.id].trail.shift(); // remove oldest segment
      }

      io.emit('updatePlayers', players);
    }
  });

  socket.on('playerCollision', (playerData) => {
    if (players[socket.id]) {
      players[socket.id].position = playerData.position;
      players[socket.id].trail = [];
      io.emit('updatePlayers', players);
    }
  });

  socket.on('disconnect', () => {
    delete players[socket.id];
    io.emit('updatePlayers', players);
    console.log(`Player disconnected: ${socket.id}`);
  });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
