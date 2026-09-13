const socket = io();

// Lobby screen controls
const landingModal = document.getElementById('landingModal');
const usernameInput = document.getElementById('usernameInput');
const roomCodeInput = document.getElementById('roomCodeInput');
const createRoomBtn = document.getElementById('createRoomBtn');
const joinRoomBtn = document.getElementById('joinRoomBtn');

const waitingLobbyModal = document.getElementById('waitingLobbyModal');
const waitingRoomId = document.getElementById('waitingRoomId');
const waitingPlayerCount = document.getElementById('waitingPlayerCount');
const waitingPlayerList = document.getElementById('waitingPlayerList');
const lobbyCopyInviteBtn = document.getElementById('lobbyCopyInviteBtn');
const difficultySetting = document.getElementById('difficultySetting');
const drawTimeSetting = document.getElementById('drawTimeSetting');
const selectionTimeSetting = document.getElementById('selectionTimeSetting');
const roundsSetting = document.getElementById('roundsSetting');
const startGameBtn = document.getElementById('startGameBtn');
const guestWaitNotice = document.getElementById('guestWaitNotice');

// In-game UI headers and status indicators
const gameScreen = document.getElementById('gameScreen');
const copyInviteBtn = document.getElementById('copyInviteBtn');
const roundDisplay = document.getElementById('roundDisplay');
const timerDisplay = document.getElementById('timerDisplay');
const wordHint = document.getElementById('wordHint');
const drawerStatus = document.getElementById('drawerStatus');
const playerList = document.getElementById('playerList');

// Drawing canvas and toolbar buttons
const canvas = document.getElementById('paintCanvas');
const ctx = canvas ? canvas.getContext('2d', { willReadFrequently: true }) : null;
const brushSize = document.getElementById('brushSize');
const clearBtn = document.getElementById('clearBtn');
const penBtn = document.getElementById('penBtn');
const fillBtn = document.getElementById('fillBtn');
const eraserBtn = document.getElementById('eraserBtn');
const undoBtn = document.getElementById('undoBtn');
const redoBtn = document.getElementById('redoBtn');
const colorBoxes = document.querySelectorAll('.color-box');
const toolbar = document.getElementById('toolbar');

// Choice and endgame overlays
const wordModal = document.getElementById('wordModal');
const modalTimer = document.getElementById('modalTimer');
const wordChoicesContainer = document.getElementById('wordChoices');
const gameOverModal = document.getElementById('gameOverModal');
const podiumList = document.getElementById('podiumList');
const restartTimer = document.getElementById('restartTimer');

// Message feed and input form
const chatForm = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');
const chatMessages = document.getElementById('chatMessages');

let isDrawing = false;
let prevX = 0;
let prevY = 0;
let currentColor = '#000000';
let activeTool = 'pen';
let canDraw = false;
let currentRoomId = '';
let isHost = false;

// Audio helper with graceful failure if blocked by browser autoplay policy
const safeAudio = (src) => {
  try {
    const a = new Audio(encodeURI(src));
    a.preload = 'auto';
    return a;
  } catch (e) {
    return null;
  }
};

const SoundEffects = {
  correct: safeAudio('/audio/correct.mp3'),
  tick: safeAudio('/audio/timetick.mp3'),
  draw: safeAudio('/audio/draw.mp3'),
  join: safeAudio('/audio/joining.mp3'),
  leave: safeAudio('/audio/leave.mp3'),
  everyoneGuessed: safeAudio('/audio/everyone_guessed.mp3'),
  noOneGuessed: safeAudio('/audio/nooneoryouguesscorrectly.mp3'),

  play(audioInstance, volume = 0.5) {
    if (!audioInstance) return;
    try {
      audioInstance.volume = volume;
      audioInstance.currentTime = 0;
      audioInstance.play().catch(() => {});
    } catch (err) {}
  },

  playCorrect() { this.play(this.correct, 0.6); },
  playTick() { this.play(this.tick, 0.4); },
  playDraw() { this.play(this.draw, 0.6); },
  playJoin() { this.play(this.join, 0.5); },
  playLeave() { this.play(this.leave, 0.5); },
  playEveryoneGuessed() { this.play(this.everyoneGuessed, 0.7); },
  playNoOneGuessed() { this.play(this.noOneGuessed, 0.6); }
};

window.addEventListener('click', () => {
  Object.values(SoundEffects).forEach((item) => {
    if (item && item.load) try { item.load(); } catch (e) {}
  });
}, { once: true });

// History buffers for stroke rollback
let undoStack = [];
let redoStack = [];
const MAX_HISTORY = 15;

function saveCanvasState() {
  if (!canDraw || !canvas) return;
  if (undoStack.length >= MAX_HISTORY) undoStack.shift();
  undoStack.push(canvas.toDataURL());
  redoStack = [];
}

function restoreCanvasFromDataURL(dataUrl) {
  if (!ctx || !canvas) return;
  const img = new Image();
  img.src = dataUrl;
  img.onload = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
  };
}

// Auto-fill room code if joined via shared invite link
try {
  const urlParams = new URLSearchParams(window.location.search);
  const roomParam = urlParams.get('room');
  if (roomParam && roomCodeInput) {
    roomCodeInput.value = roomParam.trim().toUpperCase();
  }
} catch (e) {}

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function enterRoom(roomId) {
  const username = (usernameInput && usernameInput.value.trim()) || 'Player';
  currentRoomId = roomId.toUpperCase();
  socket.emit('join_room', { roomId: currentRoomId, username });
}

if (createRoomBtn) {
  createRoomBtn.addEventListener('click', (e) => {
    e.preventDefault();
    enterRoom(generateRoomCode());
  });
}

if (joinRoomBtn) {
  joinRoomBtn.addEventListener('click', (e) => {
    e.preventDefault();
    const code = roomCodeInput ? roomCodeInput.value.trim() : '';
    if (!code) {
      if (roomCodeInput) {
        roomCodeInput.focus();
        roomCodeInput.placeholder = 'Enter code first!';
        roomCodeInput.style.borderColor = '#ef4444';
        setTimeout(() => {
          if (roomCodeInput) {
            roomCodeInput.placeholder = 'Room Code';
            roomCodeInput.style.borderColor = '';
          }
        }, 2000);
      }
      return;
    }
    enterRoom(code);
  });
}

socket.on('joined_successfully', (data) => {
  if (landingModal) landingModal.classList.add('hidden');
  currentRoomId = data.roomId;
  if (waitingRoomId) waitingRoomId.textContent = data.roomId;

  try {
    const newUrl = `${window.location.protocol}//${window.location.host}${window.location.pathname}?room=${data.roomId}`;
    window.history.replaceState({ path: newUrl }, '', newUrl);
  } catch (err) {}

  if (data.gameStarted) {
    if (gameScreen) gameScreen.classList.remove('hidden');
    if (waitingLobbyModal) waitingLobbyModal.classList.add('hidden');
  } else {
    if (waitingLobbyModal) waitingLobbyModal.classList.remove('hidden');
    if (gameScreen) gameScreen.classList.add('hidden');
  }
});

function emitSettingsUpdate() {
  if (!isHost) return;
  socket.emit('update_settings', {
    drawTime: drawTimeSetting ? drawTimeSetting.value : 60,
    selectionTime: selectionTimeSetting ? selectionTimeSetting.value : 10,
    rounds: roundsSetting ? roundsSetting.value : 3,
    difficulty: difficultySetting ? difficultySetting.value : 'medium'
  });
}

if (difficultySetting) difficultySetting.addEventListener('change', emitSettingsUpdate);
if (drawTimeSetting) drawTimeSetting.addEventListener('change', emitSettingsUpdate);
if (selectionTimeSetting) selectionTimeSetting.addEventListener('change', emitSettingsUpdate);
if (roundsSetting) roundsSetting.addEventListener('change', emitSettingsUpdate);
if (startGameBtn) startGameBtn.addEventListener('click', () => socket.emit('start_game_request'));

socket.on('lobby_state_update', (data) => {
  isHost = data.hostId === socket.id;
  if (waitingPlayerCount) waitingPlayerCount.textContent = data.players.length;
  if (waitingPlayerList) {
    waitingPlayerList.innerHTML = '';
    data.players.forEach((p) => {
      const badge = document.createElement('div');
      badge.classList.add('waiting-player-badge');
      if (p.id === data.hostId) badge.classList.add('is-host');

      const hostTag = p.id === data.hostId ? ' 👑 Host' : '';
      const youTag = p.id === socket.id ? ' (You)' : '';

      badge.innerHTML = `<span>${p.name}${youTag}</span><span style="color:#e67e22;font-weight:bold;">${hostTag}</span>`;
      waitingPlayerList.appendChild(badge);
    });
  }

  if (difficultySetting && data.settings.difficulty) {
    difficultySetting.value = data.settings.difficulty;
    difficultySetting.disabled = !isHost;
  }
  if (drawTimeSetting) {
    drawTimeSetting.value = data.settings.drawTime;
    drawTimeSetting.disabled = !isHost;
  }
  if (selectionTimeSetting) {
    selectionTimeSetting.value = data.settings.selectionTime;
    selectionTimeSetting.disabled = !isHost;
  }
  if (roundsSetting) {
    roundsSetting.value = data.settings.rounds;
    roundsSetting.disabled = !isHost;
  }

  if (startGameBtn && guestWaitNotice) {
    if (isHost) {
      startGameBtn.classList.remove('hidden');
      guestWaitNotice.classList.add('hidden');
    } else {
      startGameBtn.classList.add('hidden');
      guestWaitNotice.classList.remove('hidden');
    }
  }
});

socket.on('game_started', () => {
  if (waitingLobbyModal) waitingLobbyModal.classList.add('hidden');
  if (gameScreen) gameScreen.classList.remove('hidden');
});

function fallbackCopyText(text) {
  try {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-9999px';
    textArea.style.top = '-9999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    const success = document.execCommand('copy');
    textArea.remove();
    return success;
  } catch (e) {
    return false;
  }
}

function copyInviteLink(btn) {
  if (!btn) return;
  const inviteUrl = `${window.location.protocol}//${window.location.host}${window.location.pathname}?room=${currentRoomId}`;
  const notifySuccess = () => {
    const prev = btn.textContent;
    btn.textContent = '✅ Copied!';
    setTimeout(() => { btn.textContent = prev; }, 2000);
  };

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(inviteUrl).then(notifySuccess).catch(() => {
      if (fallbackCopyText(inviteUrl)) {
        notifySuccess();
      }
    });
  } else {
    if (fallbackCopyText(inviteUrl)) {
      notifySuccess();
    }
  }
}

if (lobbyCopyInviteBtn) lobbyCopyInviteBtn.addEventListener('click', () => copyInviteLink(lobbyCopyInviteBtn));
if (copyInviteBtn) copyInviteBtn.addEventListener('click', () => copyInviteLink(copyInviteBtn));

function selectTool(tool) {
  activeTool = tool;
  [penBtn, fillBtn, eraserBtn].forEach(b => { if (b) b.classList.remove('active'); });
  if (tool === 'pen' && penBtn) penBtn.classList.add('active');
  if (tool === 'fill' && fillBtn) fillBtn.classList.add('active');
  if (tool === 'eraser' && eraserBtn) eraserBtn.classList.add('active');
}

if (penBtn) penBtn.addEventListener('click', () => selectTool('pen'));
if (fillBtn) fillBtn.addEventListener('click', () => selectTool('fill'));
if (eraserBtn) eraserBtn.addEventListener('click', () => selectTool('eraser'));

colorBoxes.forEach((box) => {
  box.addEventListener('click', () => {
    if (!canDraw) return;
    colorBoxes.forEach((b) => b.classList.remove('selected'));
    box.classList.add('selected');
    currentColor = box.getAttribute('data-color');
    if (activeTool === 'eraser') selectTool('pen');
  });
});

// BFS queue-based paint bucket
function hexToRgba(hex) {
  let c = hex.replace('#', '');
  if (c.length === 3) c = c.split('').map(x => x + x).join('');
  const num = parseInt(c, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255, 255];
}

function floodFill(startX, startY, fillColorHex) {
  if (!ctx || !canvas) return;
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imgData.data;
  const width = canvas.width;
  const height = canvas.height;

  const targetIdx = (startY * width + startX) * 4;
  const targetR = data[targetIdx];
  const targetG = data[targetIdx + 1];
  const targetB = data[targetIdx + 2];
  const targetA = data[targetIdx + 3];

  const fillRgba = hexToRgba(fillColorHex);
  if (
    targetR === fillRgba[0] &&
    targetG === fillRgba[1] &&
    targetB === fillRgba[2] &&
    targetA === fillRgba[3]
  ) return;

  const queue = [[startX, startY]];
  const seen = new Uint8Array(width * height);

  function matchesTarget(idx) {
    return (
      data[idx] === targetR &&
      data[idx + 1] === targetG &&
      data[idx + 2] === targetB &&
      data[idx + 3] === targetA
    );
  }

  while (queue.length > 0) {
    const [x, y] = queue.pop();
    const pixelIdx = y * width + x;
    if (seen[pixelIdx]) continue;
    seen[pixelIdx] = 1;

    const dataIdx = pixelIdx * 4;
    data[dataIdx] = fillRgba[0];
    data[dataIdx + 1] = fillRgba[1];
    data[dataIdx + 2] = fillRgba[2];
    data[dataIdx + 3] = fillRgba[3];

    if (x + 1 < width && !seen[y * width + (x + 1)] && matchesTarget((y * width + (x + 1)) * 4)) queue.push([x + 1, y]);
    if (x - 1 >= 0 && !seen[y * width + (x - 1)] && matchesTarget((y * width + (x - 1)) * 4)) queue.push([x - 1, y]);
    if (y + 1 < height && !seen[(y + 1) * width + x] && matchesTarget(((y + 1) * width + x) * 4)) queue.push([x, y + 1]);
    if (y - 1 >= 0 && !seen[(y - 1) * width + x] && matchesTarget(((y - 1) * width + x) * 4)) queue.push([x, y - 1]);
  }

  ctx.putImageData(imgData, 0, 0);
}

// Unified input normalization for mouse and touch
function getCanvasPos(e) {
  if (!canvas) return { x: 0, y: 0 };
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;

  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;

  return {
    x: Math.floor((clientX - rect.left) * scaleX),
    y: Math.floor((clientY - rect.top) * scaleY)
  };
}

function handlePointerDown(e) {
  if (!canDraw) return;
  const pos = getCanvasPos(e);

  if (activeTool === 'fill') {
    saveCanvasState();
    floodFill(pos.x, pos.y, currentColor);
    socket.emit('flood_fill', { x: pos.x, y: pos.y, color: currentColor });
    return;
  }

  saveCanvasState();
  isDrawing = true;
  prevX = pos.x;
  prevY = pos.y;
}

function handlePointerMove(e) {
  if (!isDrawing || !canDraw || activeTool === 'fill') return;
  if (e.cancelable) e.preventDefault();

  const pos = getCanvasPos(e);
  const strokeData = {
    prevX,
    prevY,
    currentX: pos.x,
    currentY: pos.y,
    color: activeTool === 'eraser' ? '#ffffff' : currentColor,
    size: brushSize ? brushSize.value : 6
  };

  drawLine(strokeData);
  socket.emit('draw', strokeData);

  prevX = pos.x;
  prevY = pos.y;
}

function handlePointerUp() {
  isDrawing = false;
}

if (canvas) {
  canvas.addEventListener('mousedown', handlePointerDown);
  canvas.addEventListener('mousemove', handlePointerMove);
  window.addEventListener('mouseup', handlePointerUp);

  canvas.addEventListener('touchstart', handlePointerDown, { passive: false });
  canvas.addEventListener('touchmove', handlePointerMove, { passive: false });
  window.addEventListener('touchend', handlePointerUp);
  window.addEventListener('touchcancel', handlePointerUp);
}

function drawLine({ prevX, prevY, currentX, currentY, color, size }) {
  if (!ctx) return;
  ctx.beginPath();
  ctx.moveTo(prevX, prevY);
  ctx.lineTo(currentX, currentY);
  ctx.strokeStyle = color;
  ctx.lineWidth = size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.closePath();
}

function performUndo() {
  if (!canDraw || undoStack.length === 0 || !canvas) return;
  redoStack.push(canvas.toDataURL());
  const prevState = undoStack.pop();
  restoreCanvasFromDataURL(prevState);
  socket.emit('restore_canvas_state', prevState);
}

function performRedo() {
  if (!canDraw || redoStack.length === 0 || !canvas) return;
  undoStack.push(canvas.toDataURL());
  const nextState = redoStack.pop();
  restoreCanvasFromDataURL(nextState);
  socket.emit('restore_canvas_state', nextState);
}

if (undoBtn) undoBtn.addEventListener('click', performUndo);
if (redoBtn) redoBtn.addEventListener('click', performRedo);

window.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key === 'z') {
    e.preventDefault();
    performUndo();
  } else if (e.ctrlKey && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) {
    e.preventDefault();
    performRedo();
  }
});

if (clearBtn) {
  clearBtn.addEventListener('click', () => {
    if (!canDraw || !ctx || !canvas) return;
    saveCanvasState();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    socket.emit('clear');
  });
}

socket.on('draw', (data) => drawLine(data));
socket.on('flood_fill', (data) => floodFill(data.x, data.y, data.color));
socket.on('restore_canvas_state', (dataUrl) => restoreCanvasFromDataURL(dataUrl));
socket.on('clear', () => { if (ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height); });

// Match progression events
socket.on('round_info', (data) => {
  if (roundDisplay) roundDisplay.textContent = `R ${data.currentRound}/${data.totalRounds}`;
});

socket.on('choose_word_prompt', (data) => {
  if (gameOverModal) gameOverModal.classList.add('hidden');
  if (wordModal) wordModal.classList.remove('hidden');
  if (modalTimer) modalTimer.textContent = `${data.timeLeft}s remaining`;
  if (wordChoicesContainer) {
    wordChoicesContainer.innerHTML = '';
    data.words.forEach((w) => {
      const btn = document.createElement('button');
      btn.classList.add('word-btn');
      btn.textContent = w;
      btn.onclick = () => {
        socket.emit('select_word', w);
        if (wordModal) wordModal.classList.add('hidden');
      };
      wordChoicesContainer.appendChild(btn);
    });
  }
});

socket.on('selection_timer_tick', (data) => {
  if (modalTimer) modalTimer.textContent = `${data.timeLeft}s remaining`;
  if (timerDisplay) timerDisplay.textContent = `${data.timeLeft}s`;

  if (data.timeLeft <= 5 && data.timeLeft > 0) {
    SoundEffects.playTick();
  }
});

socket.on('waiting_for_word', (data) => {
  if (wordModal) wordModal.classList.add('hidden');
  if (wordHint) wordHint.textContent = 'CHOOSING...';
  if (drawerStatus) drawerStatus.textContent = `${data.drawerName} is choosing...`;
  if (timerDisplay) timerDisplay.textContent = `${data.timeLeft}s`;
  if (toolbar) {
    toolbar.style.opacity = '0.4';
    toolbar.style.pointerEvents = 'none';
  }
  canDraw = false;
});

socket.on('round_start', (data) => {
  SoundEffects.playDraw();
  if (wordModal) wordModal.classList.add('hidden');
  if (gameOverModal) gameOverModal.classList.add('hidden');
  if (roundDisplay) roundDisplay.textContent = `R ${data.currentRound}/${data.totalRounds}`;
  canDraw = data.drawerId === socket.id;

  undoStack = [];
  redoStack = [];

  if (drawerStatus) drawerStatus.textContent = canDraw ? 'You are Drawing!' : `${data.drawerName} is drawing`;
  if (wordHint) wordHint.textContent = data.hint;

  if (toolbar) {
    toolbar.style.opacity = canDraw ? '1' : '0.4';
    toolbar.style.pointerEvents = canDraw ? 'auto' : 'none';
  }
  if (chatInput) {
    chatInput.placeholder = canDraw ? "You're drawing, can't guess!" : 'Type your guess here...';
    chatInput.disabled = canDraw;
  }
});

socket.on('drawer_word', (data) => {
  if (wordHint) wordHint.textContent = data.word.toUpperCase();
});

socket.on('hint_update', (data) => {
  if (!canDraw && wordHint) {
    wordHint.textContent = data.hint;
  }
});

socket.on('timer_update', (data) => {
  if (timerDisplay) timerDisplay.textContent = `${data.timeLeft}s`;

  if (data.timeLeft <= 10 && data.timeLeft > 0) {
    SoundEffects.playTick();
  }
});

socket.on('round_end', (data) => {
  if (wordHint) wordHint.textContent = data.word.toUpperCase();
  if (wordModal) wordModal.classList.add('hidden');

  if (data.reason && data.reason.includes('Everyone guessed')) {
    SoundEffects.playEveryoneGuessed();
  } else {
    SoundEffects.playNoOneGuessed();
  }
});

// Post-match summary and rematch countdown
socket.on('game_over', (data) => {
  if (wordModal) wordModal.classList.add('hidden');
  if (gameOverModal) gameOverModal.classList.remove('hidden');
  
  if (podiumList) {
    podiumList.innerHTML = '';
    const medals = ['🥇 1st', '🥈 2nd', '🥉 3rd'];
    const rankClasses = ['rank-1', 'rank-2', 'rank-3'];

    data.winners.forEach((p, idx) => {
      const row = document.createElement('div');
      row.classList.add('podium-row', rankClasses[idx] || 'rank-3');
      row.innerHTML = `<span>${medals[idx] || `#${idx + 1}`}: ${p.name}</span><span>${p.score} pts</span>`;
      podiumList.appendChild(row);
    });
  }

  let count = 10;
  if (restartTimer) restartTimer.textContent = `New game in ${count}s...`;

  const restartInterval = setInterval(() => {
    count--;
    if (restartTimer) restartTimer.textContent = `New game in ${count}s...`;
    if (count <= 0) {
      clearInterval(restartInterval);
      if (gameOverModal) gameOverModal.classList.add('hidden');
    }
  }, 1000);
});

// Active roster and score sync
socket.on('leaderboard_update', (data) => {
  if (!playerList) return;
  playerList.innerHTML = '';

  if (!data.players || data.players.length === 0) {
    playerList.innerHTML = '<div style="padding:10px; color:#888;">No players</div>';
    return;
  }

  data.players.forEach((p) => {
    const card = document.createElement('div');
    card.classList.add('player-card');

    if (p.id === data.currentDrawerId) card.classList.add('is-drawer');
    if (p.id === socket.id) card.classList.add('is-you');

    const isDrawingIcon = p.id === data.currentDrawerId ? ' ✏️' : '';
    const youTag = p.id === socket.id ? ' (You)' : '';

    card.innerHTML = `<span>${p.name}${youTag}${isDrawingIcon}</span><span class="player-score">${p.score} pts</span>`;
    playerList.appendChild(card);
  });
});

// Guess submission and message dispatch
if (chatForm) {
  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!chatInput) return;
    const text = chatInput.value.trim();
    if (!text) return;

    socket.emit('send_message', text);
    chatInput.value = '';
  });
}

socket.on('close_guess_notice', (data) => {
  if (!chatMessages) return;
  const msgEl = document.createElement('div');
  msgEl.classList.add('message', 'close');
  msgEl.textContent = `💡 ${data.text}`;
  chatMessages.appendChild(msgEl);
  chatMessages.scrollTop = chatMessages.scrollHeight;
});

socket.on('chat_message', (data) => {
  if (!chatMessages) return;
  const msgEl = document.createElement('div');
  msgEl.classList.add('message');

  if (data.isCorrect) {
    SoundEffects.playCorrect();
    msgEl.classList.add('correct');
    msgEl.textContent = data.text;
  } else if (data.isSystem) {
    if (data.text.includes('joined the room')) {
      SoundEffects.playJoin();
    } else if (data.text.includes('left the room')) {
      SoundEffects.playLeave();
    }
    msgEl.classList.add('system');
    msgEl.textContent = data.text;
  } else {
    msgEl.innerHTML = `<strong>${data.user}:</strong> ${data.text}`;
  }

  chatMessages.appendChild(msgEl);
  chatMessages.scrollTop = chatMessages.scrollHeight;
});
