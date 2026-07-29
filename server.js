import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { Server } from 'socket.io';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

const PORT = 3000;

app.use(express.static(__dirname));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Real-time rooms state
const rooms = {};

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  socket.on('createRoom', ({ room, colorIdx, customPositions }) => {
    rooms[room] = {
      id: room,
      p1: { id: socket.id, colorIdx: colorIdx, ready: false, customPositions: customPositions || [] },
      p2: null,
      settings: {
        maxGoalsToWin: 3,
        enableCoinToss: true,
        showCollisionBtn: true
      },
      state: 'LOBBY'
    };
    socket.join(room);
    console.log(`Room created: ${room} by player ${socket.id}`);
    socket.emit('roomCreated', rooms[room]);
  });

  socket.on('joinRoom', ({ room, colorIdx, customPositions }) => {
    const r = rooms[room];
    if (!r) {
      socket.emit('errorMsg', 'Комната не найдена!');
      return;
    }
    if (r.p2) {
      socket.emit('errorMsg', 'Комната уже заполнена!');
      return;
    }
    let p2Color = colorIdx;
    if (r.p1 && p2Color === r.p1.colorIdx) {
      p2Color = (r.p1.colorIdx + 1) % 11;
    }
    r.p2 = { id: socket.id, colorIdx: p2Color, ready: false, customPositions: customPositions || [] };
    socket.join(room);
    console.log(`Player ${socket.id} joined room ${room}`);
    io.to(room).emit('roomJoined', r);
  });

  socket.on('changeColor', ({ room, colorIdx, role }) => {
    const r = rooms[room];
    if (!r) return;
    if (role === 'PLAYER1' && r.p1) {
      if (r.p2 && colorIdx === r.p2.colorIdx) return;
      r.p1.colorIdx = colorIdx;
    } else if (role === 'PLAYER2' && r.p2) {
      if (r.p1 && colorIdx === r.p1.colorIdx) return;
      r.p2.colorIdx = colorIdx;
    }
    io.to(room).emit('colorChanged', { p1ColorIdx: r.p1 ? r.p1.colorIdx : 0, p2ColorIdx: r.p2 ? r.p2.colorIdx : 1 });
  });

  socket.on('updateCustomTactic', ({ room, role, customPositions }) => {
    const r = rooms[room];
    if (!r) return;
    if (role === 'PLAYER1' && r.p1) {
      r.p1.customPositions = customPositions || [];
    } else if (role === 'PLAYER2' && r.p2) {
      r.p2.customPositions = customPositions || [];
    }
  });

  socket.on('updateSettings', ({ room, maxGoalsToWin, enableCoinToss, showCollisionBtn }) => {
    const r = rooms[room];
    if (!r) return;
    if (r.p1 && r.p1.id === socket.id) {
      r.settings = {
        maxGoalsToWin: Math.max(1, Math.min(5, parseInt(maxGoalsToWin) || 3)),
        enableCoinToss: !!enableCoinToss,
        showCollisionBtn: !!showCollisionBtn
      };
      io.to(room).emit('settingsUpdated', r.settings);
    }
  });

  socket.on('toggleReady', ({ room, role, ready, customPositions }) => {
    const r = rooms[room];
    if (!r) return;
    if (role === 'PLAYER1' && r.p1) {
      r.p1.ready = ready;
      if (customPositions) r.p1.customPositions = customPositions;
    } else if (role === 'PLAYER2' && r.p2) {
      r.p2.ready = ready;
      if (customPositions) r.p2.customPositions = customPositions;
    }
    io.to(room).emit('readyChanged', { p1Ready: r.p1 ? r.p1.ready : false, p2Ready: r.p2 ? r.p2.ready : false });

    // If both players are ready, start the match!
    if (r.p1 && r.p2 && r.p1.ready && r.p2.ready) {
      r.state = 'GAME';
      io.to(room).emit('matchStart', {
        p1ColorIdx: r.p1.colorIdx,
        p2ColorIdx: r.p2.colorIdx,
        p1CustomPositions: r.p1.customPositions || [],
        p2CustomPositions: r.p2.customPositions || [],
        settings: r.settings
      });
    }
  });

  socket.on('shoot', ({ room, index, forceX, forceY }) => {
    socket.to(room).emit('opponentShoot', { index, forceX, forceY });
  });

  socket.on('sync', ({ room, positions }) => {
    socket.to(room).emit('syncPositions', { positions });
  });

  socket.on('goalScored', ({ room, scoringTeam, nextTurnTeam, isAutoGoal, p1Goals, p2Goals }) => {
    socket.to(room).emit('opponentGoalScored', { scoringTeam, nextTurnTeam, isAutoGoal, p1Goals, p2Goals });
  });

  socket.on('rematch', ({ room }) => {
    const r = rooms[room];
    if (!r) return;
    if (r.p1) r.p1.ready = false;
    if (r.p2) r.p2.ready = false;
    r.state = 'LOBBY';
    io.to(room).emit('rematchTriggered');
  });

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    for (const roomCode in rooms) {
      const r = rooms[roomCode];
      if (r.p1 && r.p1.id === socket.id) {
        io.to(roomCode).emit('opponentDisconnected');
        delete rooms[roomCode];
      } else if (r.p2 && r.p2.id === socket.id) {
        io.to(roomCode).emit('opponentDisconnected');
        r.p2 = null;
        r.state = 'LOBBY';
      }
    }
  });
});

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
