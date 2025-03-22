const express = require('express');
const app = express();
const server = require('http').createServer(app);
const io = require('socket.io')(server);

// Serve static files from 'public'
app.use(express.static('public'));

// Store connected players minimally
const players = {};

io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  socket.on('newPlayer', (playerData) => {
    players[socket.id] = {
      position: playerData.position,
      color: playerData.color,
    };
    io.emit('updatePlayers', players);
  });

  socket.on('playerMove', (playerData) => {
    if (players[socket.id]) {
      players[socket.id].position = playerData.position;
      io.emit('updatePlayers', players);
    }
  });

  socket.on('playerCollision', (playerData) => {
    if (players[socket.id]) {
      players[socket.id].position = playerData.position;
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
