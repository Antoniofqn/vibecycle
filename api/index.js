const { Server } = require('socket.io');

module.exports = (req, res) => {
  if (!res.socket.server.io) {
    console.log('Socket.IO server is initializing...');
    const io = new Server(res.socket.server, {
      path: '/api/socket.io',
    });

    const players = {};

    io.on('connection', socket => {
      console.log(`Player connected: ${socket.id}`);

      socket.on('newPlayer', playerData => {
        players[socket.id] = playerData;
        io.emit('updatePlayers', players);
      });

      socket.on('playerMove', playerData => {
        if (players[socket.id]) {
          players[socket.id].position = playerData.position;
          players[socket.id].trail = playerData.trail;
          io.emit('updatePlayers', players);
        }
      });

      socket.on('playerCollision', playerData => {
        players[socket.id].position = playerData.position;
        players[socket.id].trail = [];
        io.emit('updatePlayers', players);
      });

      socket.on('disconnect', () => {
        delete players[socket.id];
        io.emit('updatePlayers', players);
        console.log(`Player disconnected: ${socket.id}`);
      });
    });

    res.socket.server.io = io;
  }
  res.end();
};
