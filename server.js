const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 1e7 // Support base64 image snapshots for undo/redo
});

app.use(express.static('public'));

const WORDS = [
  'apple', 'banana', 'orange', 'pizza', 'burger', 'guitar', 'piano', 'camera', 'laptop',
  'house', 'tree', 'flower', 'car', 'airplane', 'rocket', 'bicycle', 'train', 'boat',
  'cat', 'dog', 'elephant', 'lion', 'tiger', 'monkey', 'penguin', 'dolphin', 'shark',
  'snake', 'spider', 'butterfly', 'sun', 'moon', 'star', 'cloud', 'mountain', 'beach',
  'bridge', 'castle', 'clock', 'chair', 'table', 'bed', 'door', 'window', 'key',
  'pencil', 'book', 'shoe', 'hat', 'shirt', 'glasses', 'umbrella', 'sword', 'shield',
  'football', 'basketball', 'trophy', 'ice cream', 'cupcake', 'sandwich', 'campfire',
  'tent', 'snowman', 'kite', 'balloon', 'robot', 'alien', 'ghost', 'dragon', 'crown',
  'diamond', 'hammer', 'lightbulb', 'magnet', 'telescope', 'bat', 'box', 'cup', 'egg',
  'rainbow', 'volcano', 'island', 'helicopter', 'submarine', 'cactus', 'mushroom', 'candle',
  'cookie', 'donut', 'lollipop', 'backpack', 'helmet', 'ladder', 'mirror',
  'pillow', 'scissors', 'toothbrush', 'watch', 'whistle', 'zebra', 'giraffe', 'kangaroo'
];

const rooms = {};

function createRoomState(roomId, hostId) {
  return {
    id: roomId,
    hostId: hostId,
    gameStarted: false,
    settings: {
      drawTime: 60,
      selectionTime: 10,
      rounds: 3
    },
    players: [],
    currentDrawerIndex: -1,
    currentRound: 1,
    currentWord: '',
    isSelectingWord: false,
    isGameOver: false,
    currentChoices: [],
    revealedIndices: [],
    roundTimer: null,
    selectionTimer: null,
    timeLeft: 60,
    selectionTimeLeft: 10,
    guessOrder: [],
    currentGameWords: [],
    previousGameWords: []
  };
}

function getLevenshteinDistance(a, b) {
  const matrix = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[a.length][b.length];
}

function broadcastLobbyState(room) {
  io.to(room.id).emit('lobby_state_update', {
    roomId: room.id,
    hostId: room.hostId,
    players: room.players,
    settings: room.settings
  });
}

function broadcastLeaderboard(room) {
  const currentDrawerId = (room.currentDrawerIndex >= 0 && room.currentDrawerIndex < room.players.length)
    ? room.players[room.currentDrawerIndex].id
    : null;

  io.to(room.id).emit('leaderboard_update', {
    players: room.players,
    currentDrawerId: currentDrawerId
  });
}

function getRandomWords(room, count = 3) {
  const blockedWords = new Set([...room.currentGameWords, ...room.previousGameWords]);
  let availableWords = WORDS.filter(w => !blockedWords.has(w));

  if (availableWords.length < count) {
    room.previousGameWords = [];
    availableWords = WORDS.filter(w => !room.currentGameWords.includes(w));
  }

  const shuffled = [...availableWords].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, count);
}

function getMaskedHint(room) {
  if (!room.currentWord) return '';
  return room.currentWord
    .split('')
    .map((char, index) => {
      if (char === ' ') return ' ';
      if (room.revealedIndices.includes(index)) return char.toUpperCase();
      return '_';
    })
    .join(' ');
}

function revealRandomLetter(room) {
  const maxAllowedHints = room.currentWord.length <= 3 ? 1 : 2;
  if (room.revealedIndices.length >= maxAllowedHints) return false;

  const hiddenIndices = [];
  for (let i = 0; i < room.currentWord.length; i++) {
    if (room.currentWord[i] !== ' ' && !room.revealedIndices.includes(i)) {
      hiddenIndices.push(i);
    }
  }

  if (hiddenIndices.length > 1) {
    const randomIndex = hiddenIndices[Math.floor(Math.random() * hiddenIndices.length)];
    room.revealedIndices.push(randomIndex);
    return true;
  }
  return false;
}

function triggerGameOver(room) {
  room.isGameOver = true;
  if (room.roundTimer) clearInterval(room.roundTimer);
  if (room.selectionTimer) clearInterval(room.selectionTimer);

  const sortedWinners = [...room.players].sort((a, b) => b.score - a.score);

  io.to(room.id).emit('game_over', {
    winners: sortedWinners.slice(0, 3)
  });

  io.to(room.id).emit('chat_message', {
    user: 'System',
    text: '🏆 Game Over! Check the podium for final winners.',
    isSystem: true
  });

  room.previousGameWords = [...room.currentGameWords];
  room.currentGameWords = [];

  setTimeout(() => {
    if (!rooms[room.id]) return;
    room.players.forEach(p => p.score = 0);
    room.currentRound = 1;
    room.currentDrawerIndex = -1;
    room.isGameOver = false;
    broadcastLeaderboard(room);
    if (room.players.length > 0) {
      prepareNextTurn(room);
    }
  }, 10000);
}

function prepareNextTurn(room) {
  if (room.players.length === 0 || room.isGameOver) return;
  if (room.roundTimer) clearInterval(room.roundTimer);
  if (room.selectionTimer) clearInterval(room.selectionTimer);

  if (room.currentDrawerIndex === 0) {
    room.currentRound++;
    if (room.currentRound > room.settings.rounds) {
      triggerGameOver(room);
      return;
    }
    room.currentDrawerIndex = room.players.length - 1;
  } else if (room.currentDrawerIndex < 0 || room.currentDrawerIndex >= room.players.length) {
    room.currentDrawerIndex = room.players.length - 1;
  } else {
    room.currentDrawerIndex--;
  }

  const drawerPlayer = room.players[room.currentDrawerIndex];
  if (!drawerPlayer) return;

  room.isSelectingWord = true;
  room.guessOrder = [];
  room.revealedIndices = [];
  room.currentWord = '';
  room.currentChoices = getRandomWords(room, 3);
  room.selectionTimeLeft = room.settings.selectionTime;

  io.to(room.id).emit('clear');
  broadcastLeaderboard(room);

  io.to(room.id).emit('round_info', {
    currentRound: room.currentRound,
    totalRounds: room.settings.rounds
  });

  io.to(drawerPlayer.id).emit('choose_word_prompt', {
    words: room.currentChoices,
    timeLeft: room.selectionTimeLeft
  });

  room.players.forEach((p) => {
    if (p.id !== drawerPlayer.id) {
      io.to(p.id).emit('waiting_for_word', {
        drawerName: drawerPlayer.name,
        timeLeft: room.selectionTimeLeft
      });
    }
  });

  room.selectionTimer = setInterval(() => {
    room.selectionTimeLeft--;
    io.to(room.id).emit('selection_timer_tick', { timeLeft: room.selectionTimeLeft });

    if (room.selectionTimeLeft <= 0) {
      clearInterval(room.selectionTimer);
      if (room.isSelectingWord) {
        const autoWord = room.currentChoices[Math.floor(Math.random() * room.currentChoices.length)];
        startRoundWithWord(room, autoWord);
      }
    }
  }, 1000);
}

function startRoundWithWord(room, chosenWord) {
  if (room.selectionTimer) clearInterval(room.selectionTimer);
  room.isSelectingWord = false;
  room.currentWord = chosenWord;
  room.timeLeft = room.settings.drawTime;
  room.currentGameWords.push(chosenWord);

  const drawerPlayer = room.players[room.currentDrawerIndex];
  if (!drawerPlayer) return;

  io.to(room.id).emit('round_start', {
    drawerName: drawerPlayer.name,
    drawerId: drawerPlayer.id,
    hint: getMaskedHint(room),
    currentRound: room.currentRound,
    totalRounds: room.settings.rounds
  });

  io.to(drawerPlayer.id).emit('drawer_word', { word: room.currentWord });

  io.to(room.id).emit('chat_message', {
    user: 'System',
    text: `--- Round ${room.currentRound} (Turn: ${drawerPlayer.name}) Started! ---`,
    isSystem: true
  });

  const timeThird = Math.floor(room.settings.drawTime / 3);

  room.roundTimer = setInterval(() => {
    room.timeLeft--;
    io.to(room.id).emit('timer_update', { timeLeft: room.timeLeft });

    if (room.currentWord.length <= 3) {
      if (room.timeLeft === Math.floor(room.settings.drawTime / 2)) {
        if (revealRandomLetter(room)) io.to(room.id).emit('hint_update', { hint: getMaskedHint(room) });
      }
    } else {
      if (room.timeLeft === timeThird * 2 || room.timeLeft === timeThird) {
        if (revealRandomLetter(room)) io.to(room.id).emit('hint_update', { hint: getMaskedHint(room) });
      }
    }

    if (room.timeLeft <= 0) {
      endTurn(room, `Time is up! The word was "${room.currentWord}".`);
    }
  }, 1000);
}

function endTurn(room, reason) {
  if (room.roundTimer) clearInterval(room.roundTimer);
  if (room.selectionTimer) clearInterval(room.selectionTimer);

  io.to(room.id).emit('round_end', {
    reason,
    word: room.currentWord
  });

  io.to(room.id).emit('chat_message', {
    user: 'System',
    text: reason,
    isSystem: true
  });

  broadcastLeaderboard(room);

  setTimeout(() => {
    if (rooms[room.id] && room.players.length > 0 && !room.isGameOver) {
      prepareNextTurn(room);
    }
  }, 4000);
}

io.on('connection', (socket) => {
  let userRoomId = null;

  socket.on('join_room', ({ roomId, username }) => {
    const cleanRoomId = roomId.trim().toLowerCase();
    const cleanUsername = username.trim() || 'Player ' + socket.id.slice(0, 4);

    socket.join(cleanRoomId);
    userRoomId = cleanRoomId;

    if (!rooms[cleanRoomId]) {
      rooms[cleanRoomId] = createRoomState(cleanRoomId, socket.id);
    }

    const room = rooms[cleanRoomId];
    const newPlayer = { id: socket.id, name: cleanUsername, score: 0 };
    room.players.push(newPlayer);

    console.log(`+ ${cleanUsername} entered Room [${cleanRoomId}]. Total: ${room.players.length}`);

    socket.emit('joined_successfully', {
      roomId: cleanRoomId,
      username: cleanUsername,
      gameStarted: room.gameStarted
    });

    if (!room.gameStarted) {
      broadcastLobbyState(room);
    } else {
      broadcastLeaderboard(room);
      if (room.currentWord) {
        socket.emit('round_start', {
          drawerName: room.players[room.currentDrawerIndex]?.name || 'Player',
          drawerId: room.players[room.currentDrawerIndex]?.id,
          hint: getMaskedHint(room),
          currentRound: room.currentRound,
          totalRounds: room.settings.rounds
        });
      }
    }
  });

  socket.on('update_settings', (newSettings) => {
    const room = rooms[userRoomId];
    if (room && room.hostId === socket.id && !room.gameStarted) {
      room.settings.drawTime = parseInt(newSettings.drawTime) || 60;
      room.settings.selectionTime = parseInt(newSettings.selectionTime) || 10;
      room.settings.rounds = parseInt(newSettings.rounds) || 3;
      broadcastLobbyState(room);
    }
  });

  socket.on('start_game_request', () => {
    const room = rooms[userRoomId];
    if (room && room.hostId === socket.id && !room.gameStarted) {
      if (room.players.length < 2) {
        socket.emit('chat_message', {
          user: 'System',
          text: '⚠️ You need at least 2 players to start!',
          isSystem: true
        });
        return;
      }

      room.gameStarted = true;
      io.to(room.id).emit('game_started');
      broadcastLeaderboard(room);

      setTimeout(() => {
        prepareNextTurn(room);
      }, 500);
    }
  });

  socket.on('select_word', (word) => {
    const room = rooms[userRoomId];
    if (room && room.players[room.currentDrawerIndex]?.id === socket.id && room.isSelectingWord) {
      startRoundWithWord(room, word);
    }
  });

  // Relay standard drawing line strokes
  socket.on('draw', (data) => {
    const room = rooms[userRoomId];
    if (room && room.players[room.currentDrawerIndex]?.id === socket.id && !room.isSelectingWord) {
      socket.to(userRoomId).emit('draw', data);
    }
  });

  // Relay Flood Fill Bucket events
  socket.on('flood_fill', (data) => {
    const room = rooms[userRoomId];
    if (room && room.players[room.currentDrawerIndex]?.id === socket.id && !room.isSelectingWord) {
      socket.to(userRoomId).emit('flood_fill', data);
    }
  });

  // Relay Canvas Snapshot (Undo / Redo state restore)
  socket.on('restore_canvas_state', (dataUrl) => {
    const room = rooms[userRoomId];
    if (room && room.players[room.currentDrawerIndex]?.id === socket.id && !room.isSelectingWord) {
      socket.to(userRoomId).emit('restore_canvas_state', dataUrl);
    }
  });

  socket.on('clear', () => {
    const room = rooms[userRoomId];
    if (room && room.players[room.currentDrawerIndex]?.id === socket.id && !room.isSelectingWord) {
      io.to(userRoomId).emit('clear');
    }
  });

  socket.on('send_message', (msgText) => {
    const room = rooms[userRoomId];
    if (!room) return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    const cleanMsg = msgText.trim().toLowerCase();
    const targetWord = room.currentWord.toLowerCase();
    const isDrawer = room.players[room.currentDrawerIndex]?.id === socket.id;

    if (!isDrawer && room.currentWord && !room.isSelectingWord && !room.isGameOver) {
      if (cleanMsg === targetWord && !room.guessOrder.includes(socket.id)) {
        room.guessOrder.push(socket.id);
        const guessPosition = room.guessOrder.length;

        const basePoints = Math.floor((room.timeLeft / room.settings.drawTime) * 400) + 100;
        const rankMultiplier = Math.max(0.4, 1 - (guessPosition - 1) * 0.2);
        const earned = Math.round(basePoints * rankMultiplier);
        player.score += earned;

        const drawer = room.players[room.currentDrawerIndex];
        if (drawer) drawer.score += 50;

        broadcastLeaderboard(room);

        io.to(userRoomId).emit('chat_message', {
          user: 'System',
          text: `🎉 ${player.name} guessed the word! (+${earned} pts)`,
          isCorrect: true
        });

        const totalGuessers = room.players.length - 1;
        if (room.guessOrder.length >= totalGuessers && totalGuessers > 0) {
          endTurn(room, `Everyone guessed the word! It was "${room.currentWord}".`);
        }
        return;
      }

      if (targetWord.length > 2 && getLevenshteinDistance(cleanMsg, targetWord) === 1) {
        socket.emit('close_guess_notice', {
          text: `"${msgText}" is very close!`
        });
      }
    }

    io.to(userRoomId).emit('chat_message', {
      user: player.name,
      text: msgText,
      isSystem: false
    });
  });

  socket.on('disconnect', () => {
    const room = rooms[userRoomId];
    if (!room) return;

    const playerIdx = room.players.findIndex(p => p.id === socket.id);
    if (playerIdx === -1) return;

    const disconnectedPlayer = room.players[playerIdx];
    const wasDrawer = room.currentDrawerIndex === playerIdx;
    const wasHost = room.hostId === socket.id;

    room.players.splice(playerIdx, 1);

    if (wasHost && room.players.length > 0) {
      room.hostId = room.players[0].id;
    }

    io.to(userRoomId).emit('chat_message', {
      user: 'System',
      text: `${disconnectedPlayer.name} left the room.`,
      isSystem: true
    });

    if (!room.gameStarted) {
      broadcastLobbyState(room);
    } else {
      broadcastLeaderboard(room);
    }

    if (room.players.length === 0) {
      if (room.roundTimer) clearInterval(room.roundTimer);
      if (room.selectionTimer) clearInterval(room.selectionTimer);
      delete rooms[userRoomId];
      console.log(`- Cleaned up Room [${userRoomId}]`);
    } else if (room.gameStarted && wasDrawer) {
      endTurn(room, 'The drawer left the game!');
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});