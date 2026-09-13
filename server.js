const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.get('/ping', (req, res) => res.status(200).send('pong'));

// Default fallbacks if words.json isn't available
let wordDatabase = {
  easy: ["cat", "dog", "sun", "tree", "car", "apple"],
  medium: ["airplane", "hospital", "guitar", "sandwich", "bicycle"],
  hard: ["DNA", "zen", "time travel", "black hole", "statue of liberty"]
};

try {
  const fileData = fs.readFileSync(path.join(__dirname, 'words.json'), 'utf8');
  wordDatabase = JSON.parse(fileData);
  console.log(`Loaded words: Easy (${wordDatabase.easy.length}), Med (${wordDatabase.medium.length}), Hard (${wordDatabase.hard.length})`);
} catch (e) {
  console.warn("Could not load words.json, using defaults.");
}

const rooms = {};

// Catch single-letter typos so we can give guessers a hint
function getLevenshteinDistance(a, b) {
  if (a.length < b.length) return getLevenshteinDistance(b, a);
  if (b.length === 0) return a.length;

  let prevRow = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    const currRow = [i + 1];
    for (let j = 0; j < b.length; j++) {
      const cost = a[i] === b[j] ? 0 : 1;
      currRow.push(Math.min(
        currRow[j] + 1,       // Insertion
        prevRow[j + 1] + 1,   // Deletion
        prevRow[j] + cost     // Substitution
      ));
    }
    prevRow = currRow;
  }
  return prevRow[b.length];
}

// Keep hyphens/punctuation legible and pad spaces between words
function getMaskedHint(word, revealedIndices = new Set()) {
  const wordParts = word.split(' ');
  let globalCharIdx = 0;

  const maskedWords = wordParts.map((part) => {
    const chars = [];
    for (let i = 0; i < part.length; i++) {
      const char = part[i];
      if (!/[a-zA-Z0-9]/.test(char)) {
        chars.push(char); // Keep -, ., /, etc. visible
      } else if (revealedIndices.has(globalCharIdx)) {
        chars.push(char.toUpperCase());
      } else {
        chars.push('_');
      }
      globalCharIdx++;
    }
    globalCharIdx++; // Account for the space between words
    return chars.join(' ');
  });

  // Non-breaking spaces keep multi-word gaps visible in HTML
  return maskedWords.join('\u00A0\u00A0\u00A0\u00A0');
}

// Grab 3 random candidates for the drawer
function pickThreeWords(difficulty = 'medium') {
  let list = wordDatabase[difficulty] || wordDatabase.medium;
  if (!list || list.length < 3) list = [...wordDatabase.easy, ...wordDatabase.medium, ...wordDatabase.hard];
  
  const shuffled = [...list].sort(() => 0.5 - Math.random());
  return [shuffled[0], shuffled[1], shuffled[2]];
}

io.on('connection', (socket) => {
  socket.on('join_room', ({ roomId, username }) => {
    const rId = roomId.toUpperCase();
    socket.join(rId);

    if (!rooms[rId]) {
      rooms[rId] = {
        id: rId,
        hostId: socket.id,
        players: [],
        settings: {
          drawTime: 60,
          selectionTime: 10,
          rounds: 3,
          difficulty: 'medium' // standard default
        },
        gameState: 'LOBBY',
        currentRound: 1,
        drawerIndex: 0,
        currentWord: '',
        currentHint: '',
        revealedIndices: new Set(),
        turnTimer: null,
        selectionTimer: null,
        hintInterval: null,
        correctGuessers: new Set()
      };
    }

    const room = rooms[rId];
    const existingPlayer = room.players.find(p => p.id === socket.id);
    if (!existingPlayer) {
      room.players.push({
        id: socket.id,
        name: username || `Player ${room.players.length + 1}`,
        score: 0
      });
    }

    socket.emit('joined_successfully', {
      roomId: rId,
      gameStarted: room.gameState !== 'LOBBY'
    });

    broadcastLobbyState(rId);
    broadcastLeaderboard(rId);

    io.to(rId).emit('chat_message', {
      isSystem: true,
      text: `${username || 'A player'} joined the room!`
    });
  });

  socket.on('update_settings', (newSettings) => {
    const rId = findRoomBySocket(socket.id);
    if (!rId) return;
    const room = rooms[rId];
    if (room.hostId !== socket.id || room.gameState !== 'LOBBY') return;

    room.settings.drawTime = parseInt(newSettings.drawTime) || 60;
    room.settings.selectionTime = parseInt(newSettings.selectionTime) || 10;
    room.settings.rounds = parseInt(newSettings.rounds) || 3;
    if (['easy', 'medium', 'hard'].includes(newSettings.difficulty)) {
      room.settings.difficulty = newSettings.difficulty;
    }

    broadcastLobbyState(rId);
  });

  socket.on('start_game_request', () => {
    const rId = findRoomBySocket(socket.id);
    if (!rId) return;
    const room = rooms[rId];
    if (room.hostId !== socket.id || room.gameState !== 'LOBBY') return;

    room.gameState = 'PLAYING';
    room.currentRound = 1;
    room.drawerIndex = 0;
    room.players.forEach(p => p.score = 0);

    io.to(rId).emit('game_started');
    startTurn(rId);
  });

  function startTurn(rId) {
    const room = rooms[rId];
    if (!room || room.players.length === 0) return;

    clearRoomTimers(room);

    if (room.drawerIndex >= room.players.length) {
      room.drawerIndex = 0;
      room.currentRound++;
    }

    if (room.currentRound > room.settings.rounds) {
      endGame(rId);
      return;
    }

    const currentDrawer = room.players[room.drawerIndex];
    room.correctGuessers = new Set();
    room.revealedIndices = new Set();
    room.wordChoices = pickThreeWords(room.settings.difficulty);

    let timeLeft = room.settings.selectionTime;

    io.to(rId).emit('clear');
    io.to(rId).emit('round_info', {
      currentRound: room.currentRound,
      totalRounds: room.settings.rounds
    });

    broadcastLeaderboard(rId);

    // Tell everyone else who is on the clock
    socket.to(rId).emit('waiting_for_word', {
      drawerName: currentDrawer.name,
      timeLeft
    });

    // Only send word options to the active drawer
    io.to(currentDrawer.id).emit('choose_word_prompt', {
      words: room.wordChoices,
      timeLeft
    });

    room.selectionTimer = setInterval(() => {
      timeLeft--;
      io.to(rId).emit('selection_timer_tick', { timeLeft });

      if (timeLeft <= 0) {
        clearInterval(room.selectionTimer);
        // Drawer ran out of time, pick first option
        beginDrawingPhase(rId, room.wordChoices[0]);
      }
    }, 1000);
  }

  socket.on('select_word', (chosenWord) => {
    const rId = findRoomBySocket(socket.id);
    if (!rId) return;
    const room = rooms[rId];
    const currentDrawer = room.players[room.drawerIndex];

    if (currentDrawer && currentDrawer.id === socket.id && room.selectionTimer) {
      clearInterval(room.selectionTimer);
      beginDrawingPhase(rId, chosenWord);
    }
  });

  function beginDrawingPhase(rId, word) {
    const room = rooms[rId];
    if (!room) return;

    room.currentWord = word;
    room.revealedIndices = new Set();
    const currentDrawer = room.players[room.drawerIndex];

    let drawTimeLeft = room.settings.drawTime;
    const initialHint = getMaskedHint(word, room.revealedIndices);

    io.to(rId).emit('round_start', {
      drawerId: currentDrawer.id,
      drawerName: currentDrawer.name,
      hint: initialHint,
      currentRound: room.currentRound,
      totalRounds: room.settings.rounds
    });

    io.to(currentDrawer.id).emit('drawer_word', { word: room.currentWord });

    // Don't waste hint reveals on hyphens or punctuation
    const lettersOnly = [];
    for (let i = 0; i < word.length; i++) {
      if (/[a-zA-Z0-9]/.test(word[i])) {
        lettersOnly.push(i);
      }
    }

    const maxHints = Math.max(1, Math.floor(lettersOnly.length / 3));

    room.hintInterval = setInterval(() => {
      if (room.revealedIndices.size < maxHints && drawTimeLeft > 10) {
        const unrevealed = lettersOnly.filter((i) => !room.revealedIndices.has(i));
        if (unrevealed.length > 0) {
          const randIdx = unrevealed[Math.floor(Math.random() * unrevealed.length)];
          room.revealedIndices.add(randIdx);
          const updatedHint = getMaskedHint(word, room.revealedIndices);
          io.to(rId).emit('hint_update', { hint: updatedHint });
        }
      }
    }, Math.floor((room.settings.drawTime * 1000) / (maxHints + 1)));

    room.turnTimer = setInterval(() => {
      drawTimeLeft--;
      io.to(rId).emit('timer_update', { timeLeft: drawTimeLeft });

      if (drawTimeLeft <= 0) {
        endTurn(rId, `Time's up! The word was: ${room.currentWord}`);
      }
    }, 1000);
  }

  function endTurn(rId, reason) {
    const room = rooms[rId];
    if (!room) return;

    clearRoomTimers(room);

    io.to(rId).emit('round_end', {
      word: room.currentWord,
      reason
    });

    broadcastLeaderboard(rId);

    setTimeout(() => {
      room.drawerIndex++;
      startTurn(rId);
    }, 4000);
  }

  function endGame(rId) {
    const room = rooms[rId];
    if (!room) return;

    clearRoomTimers(room);
    room.gameState = 'GAME_OVER';

    const winners = [...room.players].sort((a, b) => b.score - a.score);
    io.to(rId).emit('game_over', { winners });

    // 10s podium screen before cycling into the next game
    setTimeout(() => {
      const activeRoom = rooms[rId];
      if (!activeRoom || activeRoom.players.length === 0) return;

      // Wipe match state for the next match
      activeRoom.gameState = 'PLAYING';
      activeRoom.currentRound = 1;
      activeRoom.drawerIndex = 0;
      activeRoom.players.forEach(p => p.score = 0);

      // Spin up round 1
      io.to(rId).emit('game_started');
      startTurn(rId);
    }, 10000);
  }

  function clearRoomTimers(room) {
    if (room.turnTimer) clearInterval(room.turnTimer);
    if (room.selectionTimer) clearInterval(room.selectionTimer);
    if (room.hintInterval) clearInterval(room.hintInterval);
  }

  // Chat and guess validation
  socket.on('send_message', (msgText) => {
    const rId = findRoomBySocket(socket.id);
    if (!rId) return;
    const room = rooms[rId];
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    const currentDrawer = room.players[room.drawerIndex];

    if (
      room.gameState === 'PLAYING' &&
      room.currentWord &&
      currentDrawer &&
      currentDrawer.id !== socket.id
    ) {
      const cleanGuess = msgText.trim().toLowerCase();
      const targetWord = room.currentWord.trim().toLowerCase();

      // Lock out already-correct players so they don't spoil it
      if (room.correctGuessers.has(socket.id)) {
        return;
      }

      // Exact match
      if (cleanGuess === targetWord) {
        room.correctGuessers.add(socket.id);
        
        // Faster guessers grab more points
        const pointsAwarded = Math.max(50, 100 + (10 - room.correctGuessers.size) * 10);
        player.score += pointsAwarded;
        currentDrawer.score += 25; // Tip the drawer for a good clue

        io.to(rId).emit('chat_message', {
          isCorrect: true,
          text: `${player.name} guessed the word! (+${pointsAwarded} pts)`
        });

        broadcastLeaderboard(rId);

        // Everyone guessed, wrap up the turn early
        if (room.correctGuessers.size >= room.players.length - 1) {
          endTurn(rId, `Everyone guessed the word!`);
        }
        return;
      }

      // One letter off, send a nudge
      const distance = getLevenshteinDistance(cleanGuess, targetWord);
      if (distance === 1 && targetWord.length > 2) {
        socket.emit('close_guess_notice', {
          text: `'${msgText.trim()}' is very close!`
        });
      }
    }

    // Regular chat relay
    io.to(rId).emit('chat_message', {
      user: player.name,
      text: msgText
    });
  });

  // Canvas event relays
  socket.on('draw', (data) => socket.to(findRoomBySocket(socket.id)).emit('draw', data));
  socket.on('flood_fill', (data) => socket.to(findRoomBySocket(socket.id)).emit('flood_fill', data));
  socket.on('restore_canvas_state', (data) => socket.to(findRoomBySocket(socket.id)).emit('restore_canvas_state', data));
  socket.on('clear', () => socket.to(findRoomBySocket(socket.id)).emit('clear'));

  socket.on('disconnect', () => {
    const rId = findRoomBySocket(socket.id);
    if (!rId) return;
    const room = rooms[rId];
    const leftPlayer = room.players.find(p => p.id === socket.id);

    room.players = room.players.filter(p => p.id !== socket.id);

    if (room.players.length === 0) {
      clearRoomTimers(room);
      delete rooms[rId];
      return;
    }

    if (room.hostId === socket.id) {
      room.hostId = room.players[0].id;
    }

    io.to(rId).emit('chat_message', {
      isSystem: true,
      text: `${leftPlayer ? leftPlayer.name : 'A player'} left the room.`
    });

    broadcastLobbyState(rId);
    broadcastLeaderboard(rId);
  });

  function broadcastLobbyState(rId) {
    const room = rooms[rId];
    if (!room) return;
    io.to(rId).emit('lobby_state_update', {
      hostId: room.hostId,
      players: room.players,
      settings: room.settings
    });
  }

  function broadcastLeaderboard(rId) {
    const room = rooms[rId];
    if (!room) return;
    const sorted = [...room.players].sort((a, b) => b.score - a.score);
    const currentDrawer = room.players[room.drawerIndex];
    io.to(rId).emit('leaderboard_update', {
      players: sorted,
      currentDrawerId: currentDrawer ? currentDrawer.id : null
    });
  }

  function findRoomBySocket(sId) {
    for (const rId in rooms) {
      if (rooms[rId].players.some(p => p.id === sId)) return rId;
    }
    return null;
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
