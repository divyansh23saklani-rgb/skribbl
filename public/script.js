const socket = io();

// 1. Landing & Lobby Elements
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
const drawTimeSetting = document.getElementById('drawTimeSetting');
const selectionTimeSetting = document.getElementById('selectionTimeSetting');
const roundsSetting = document.getElementById('roundsSetting');
const startGameBtn = document.getElementById('startGameBtn');
const guestWaitNotice = document.getElementById('guestWaitNotice');

// 2. Main Game Elements
const gameScreen = document.getElementById('gameScreen');
const copyInviteBtn = document.getElementById('copyInviteBtn');
const roundDisplay = document.getElementById('roundDisplay');
const timerDisplay = document.getElementById('timerDisplay');
const wordHint = document.getElementById('wordHint');
const drawerStatus = document.getElementById('drawerStatus');
const playerList = document.getElementById('playerList');

// 3. Canvas & Tools
const canvas = document.getElementById('paintCanvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const brushSize = document.getElementById('brushSize');
const clearBtn = document.getElementById('clearBtn');
const penBtn = document.getElementById('penBtn');
const fillBtn = document.getElementById('fillBtn');
const eraserBtn = document.getElementById('eraserBtn');
const undoBtn = document.getElementById('undoBtn');
const redoBtn = document.getElementById('redoBtn');
const colorBoxes = document.querySelectorAll('.color-box');
const toolbar = document.getElementById('toolbar');

// 4. Modals
const wordModal = document.getElementById('wordModal');
const modalTimer = document.getElementById('modalTimer');
const wordChoicesContainer = document.getElementById('wordChoices');
const gameOverModal = document.getElementById('gameOverModal');
const podiumList = document.getElementById('podiumList');
const restartTimer = document.getElementById('restartTimer');

// 5. Chat Elements
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

// Undo / Redo Stacks
let undoStack = [];
let redoStack = [];
const MAX_HISTORY = 15;

function saveCanvasState() {
  if (!canDraw) return;
  if (undoStack.length >= MAX_HISTORY) undoStack.shift();
  undoStack.push(canvas.toDataURL());
  redoStack = [];
}

function restoreCanvasFromDataURL(dataUrl) {
  const img = new Image();
  img.src = dataUrl;
  img.onload = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
  };
}

// URL Room Check
const urlParams = new URLSearchParams(window.location.search);
const roomParam = urlParams.get('room');
if (roomParam) {
  roomCodeInput.value = roomParam.trim().toUpperCase();
}

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function enterRoom(roomId) {
  const username = usernameInput.value.trim() || 'Player';
  currentRoomId = roomId.toUpperCase();
  socket.emit('join_room', { roomId: currentRoomId, username });
}

createRoomBtn.addEventListener('click', () => enterRoom(generateRoomCode()));
joinRoomBtn.addEventListener('click', () => {
  const code = roomCodeInput.value.trim();
  if (!code) return alert('Please enter a room code!');
  enterRoom(code);
});

socket.on('joined_successfully', (data) => {
  landingModal.classList.add('hidden');
  currentRoomId = data.roomId;
  waitingRoomId.textContent = data.roomId;

  const newUrl = `${window.location.origin}${window.location.pathname}?room=${data.roomId}`;
  window.history.pushState({ path: newUrl }, '', newUrl);

  if (data.gameStarted) {
    gameScreen.classList.remove('hidden');
    waitingLobbyModal.classList.add('hidden');
  } else {
    waitingLobbyModal.classList.remove('hidden');
    gameScreen.classList.add('hidden');
  }
});

function emitSettingsUpdate() {
  if (!isHost) return;
  socket.emit('update_settings', {
    drawTime: drawTimeSetting.value,
    selectionTime: selectionTimeSetting.value,
    rounds: roundsSetting.value
  });
}

drawTimeSetting.addEventListener('change', emitSettingsUpdate);
selectionTimeSetting.addEventListener('change', emitSettingsUpdate);
roundsSetting.addEventListener('change', emitSettingsUpdate);
startGameBtn.addEventListener('click', () => socket.emit('start_game_request'));

socket.on('lobby_state_update', (data) => {
  isHost = data.hostId === socket.id;
  waitingPlayerCount.textContent = data.players.length;
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

  drawTimeSetting.value = data.settings.drawTime;
  selectionTimeSetting.value = data.settings.selectionTime;
  roundsSetting.value = data.settings.rounds;

  drawTimeSetting.disabled = !isHost;
  selectionTimeSetting.disabled = !isHost;
  roundsSetting.disabled = !isHost;

  if (isHost) {
    startGameBtn.classList.remove('hidden');
    guestWaitNotice.classList.add('hidden');
  } else {
    startGameBtn.classList.add('hidden');
    guestWaitNotice.classList.remove('hidden');
  }
});

socket.on('game_started', () => {
  waitingLobbyModal.classList.add('hidden');
  gameScreen.classList.remove('hidden');
});

function copyInviteLink(btn) {
  const inviteUrl = `${window.location.origin}${window.location.pathname}?room=${currentRoomId}`;
  navigator.clipboard.writeText(inviteUrl).then(() => {
    const prev = btn.textContent;
    btn.textContent = '✅ Copied!';
    setTimeout(() => { btn.textContent = prev; }, 2000);
  });
}

lobbyCopyInviteBtn.addEventListener('click', () => copyInviteLink(lobbyCopyInviteBtn));
copyInviteBtn.addEventListener('click', () => copyInviteLink(copyInviteBtn));

function selectTool(tool) {
  activeTool = tool;
  [penBtn, fillBtn, eraserBtn].forEach(b => b.classList.remove('active'));
  if (tool === 'pen') penBtn.classList.add('active');
  if (tool === 'fill') fillBtn.classList.add('active');
  if (tool === 'eraser') eraserBtn.classList.add('active');
}

penBtn.addEventListener('click', () => selectTool('pen'));
fillBtn.addEventListener('click', () => selectTool('fill'));
eraserBtn.addEventListener('click', () => selectTool('eraser'));

colorBoxes.forEach((box) => {
  box.addEventListener('click', () => {
    if (!canDraw) return;
    colorBoxes.forEach((b) => b.classList.remove('selected'));
    box.classList.add('selected');
    currentColor = box.getAttribute('data-color');
    if (activeTool === 'eraser') selectTool('pen');
  });
});

// Flood Fill (Paint Bucket)
function hexToRgba(hex) {
  let c = hex.replace('#', '');
  if (c.length === 3) c = c.split('').map(x => x + x).join('');
  const num = parseInt(c, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255, 255];
}

function floodFill(startX, startY, fillColorHex) {
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

// Coordinate Mapper for Touch & Mouse
function getCanvasPos(e) {
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
    size: brushSize.value
  };

  drawLine(strokeData);
  socket.emit('draw', strokeData);

  prevX = pos.x;
  prevY = pos.y;
}

function handlePointerUp() {
  isDrawing = false;
}

canvas.addEventListener('mousedown', handlePointerDown);
canvas.addEventListener('mousemove', handlePointerMove);
window.addEventListener('mouseup', handlePointerUp);

canvas.addEventListener('touchstart', handlePointerDown, { passive: false });
canvas.addEventListener('touchmove', handlePointerMove, { passive: false });
window.addEventListener('touchend', handlePointerUp);
window.addEventListener('touchcancel', handlePointerUp);

function drawLine({ prevX, prevY, currentX, currentY, color, size }) {
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
  if (!canDraw || undoStack.length === 0) return;
  redoStack.push(canvas.toDataURL());
  const prevState = undoStack.pop();
  restoreCanvasFromDataURL(prevState);
  socket.emit('restore_canvas_state', prevState);
}

function performRedo() {
  if (!canDraw || redoStack.length === 0) return;
  undoStack.push(canvas.toDataURL());
  const nextState = redoStack.pop();
  restoreCanvasFromDataURL(nextState);
  socket.emit('restore_canvas_state', nextState);
}

undoBtn.addEventListener('click', performUndo);
redoBtn.addEventListener('click', performRedo);

window.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key === 'z') {
    e.preventDefault();
    performUndo();
  } else if (e.ctrlKey && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) {
    e.preventDefault();
    performRedo();
  }
});

clearBtn.addEventListener('click', () => {
  if (!canDraw) return;
  saveCanvasState();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  socket.emit('clear');
});

socket.on('draw', (data) => drawLine(data));
socket.on('flood_fill', (data) => floodFill(data.x, data.y, data.color));
socket.on('restore_canvas_state', (dataUrl) => restoreCanvasFromDataURL(dataUrl));
socket.on('clear', () => ctx.clearRect(0, 0, canvas.width, canvas.height));

// --- Round & Turn Listeners ---
socket.on('round_info', (data) => {
  roundDisplay.textContent = `R ${data.currentRound}/${data.totalRounds}`;
});

socket.on('choose_word_prompt', (data) => {
  gameOverModal.classList.add('hidden');
  wordModal.classList.remove('hidden');
  modalTimer.textContent = `${data.timeLeft}s remaining`;
  wordChoicesContainer.innerHTML = '';

  data.words.forEach((w) => {
    const btn = document.createElement('button');
    btn.classList.add('word-btn');
    btn.textContent = w;
    btn.onclick = () => {
      socket.emit('select_word', w);
      wordModal.classList.add('hidden');
    };
    wordChoicesContainer.appendChild(btn);
  });
});

socket.on('selection_timer_tick', (data) => {
  modalTimer.textContent = `${data.timeLeft}s remaining`;
  timerDisplay.textContent = `${data.timeLeft}s`;
});

socket.on('waiting_for_word', (data) => {
  wordModal.classList.add('hidden');
  wordHint.textContent = 'CHOOSING...';
  drawerStatus.textContent = `${data.drawerName} is choosing...`;
  timerDisplay.textContent = `${data.timeLeft}s`;
  toolbar.style.opacity = '0.4';
  toolbar.style.pointerEvents = 'none';
  canDraw = false;
});

socket.on('round_start', (data) => {
  wordModal.classList.add('hidden');
  gameOverModal.classList.add('hidden');
  roundDisplay.textContent = `R ${data.currentRound}/${data.totalRounds}`;
  canDraw = data.drawerId === socket.id;

  undoStack = [];
  redoStack = [];

  drawerStatus.textContent = canDraw ? 'You are Drawing!' : `${data.drawerName} is drawing`;
  wordHint.textContent = data.hint;
  toolbar.style.opacity = canDraw ? '1' : '0.4';
  toolbar.style.pointerEvents = canDraw ? 'auto' : 'none';
  chatInput.placeholder = canDraw ? "You're drawing, can't guess!" : 'Type your guess here...';
  chatInput.disabled = canDraw;
});

socket.on('drawer_word', (data) => {
  wordHint.textContent = data.word.toUpperCase();
});

socket.on('hint_update', (data) => {
  if (!canDraw) wordHint.textContent = data.hint;
});

socket.on('timer_update', (data) => {
  timerDisplay.textContent = `${data.timeLeft}s`;
});

socket.on('round_end', (data) => {
  wordHint.textContent = data.word.toUpperCase();
  wordModal.classList.add('hidden');
});

// --- Game Over Podium ---
socket.on('game_over', (data) => {
  wordModal.classList.add('hidden');
  gameOverModal.classList.remove('hidden');
  podiumList.innerHTML = '';

  const medals = ['🥇 1st', '🥈 2nd', '🥉 3rd'];
  const rankClasses = ['rank-1', 'rank-2', 'rank-3'];

  data.winners.forEach((p, idx) => {
    const row = document.createElement('div');
    row.classList.add('podium-row', rankClasses[idx] || 'rank-3');
    row.innerHTML = `<span>${medals[idx] || `#${idx + 1}`}: ${p.name}</span><span>${p.score} pts</span>`;
    podiumList.appendChild(row);
  });

  let count = 10;
  const restartInterval = setInterval(() => {
    count--;
    restartTimer.textContent = `New game in ${count}s...`;
    if (count <= 0) {
      clearInterval(restartInterval);
      gameOverModal.classList.add('hidden');
    }
  }, 1000);
});

// --- Leaderboard Sync ---
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

// --- Chat Handling ---
chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;

  socket.emit('send_message', text);
  chatInput.value = '';
});

socket.on('close_guess_notice', (data) => {
  const msgEl = document.createElement('div');
  msgEl.classList.add('message', 'close');
  msgEl.textContent = `💡 ${data.text}`;
  chatMessages.appendChild(msgEl);
  chatMessages.scrollTop = chatMessages.scrollHeight;
});

socket.on('chat_message', (data) => {
  const msgEl = document.createElement('div');
  msgEl.classList.add('message');

  if (data.isCorrect) {
    msgEl.classList.add('correct');
    msgEl.textContent = data.text;
  } else if (data.isSystem) {
    msgEl.classList.add('system');
    msgEl.textContent = data.text;
  } else {
    msgEl.innerHTML = `<strong>${data.user}:</strong> ${data.text}`;
  }

  chatMessages.appendChild(msgEl);
  chatMessages.scrollTop = chatMessages.scrollHeight;
});
