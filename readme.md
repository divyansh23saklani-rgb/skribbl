# 🎨 Skribbl.io Clone (Real-Time Multiplayer Drawing & Guessing Game)

A full-stack, real-time multiplayer drawing and word-guessing web application inspired by Skribbl.io. Built with native HTML5 Canvas, WebSockets (Socket.io), and Node.js.

---

## ✨ Features

- **Real-Time Canvas Engine:**
  - Low-latency vector stroke synchronization via WebSockets.
  - 16-color curated palette, dynamic brush sizing, and eraser.
  - **Flood Fill (Paint Bucket)** tool using Breadth-First Search (BFS) on raw pixel buffer arrays.
  - **Full Undo / Redo history stack** (`Ctrl + Z` / `Ctrl + Y`) synchronized across all connected players.
  - Complete **Mobile & Tablet Touch Support** (`touchstart`, `touchmove`, `touchend`).

- **Game Mechanics & State Machine:**
  - **Custom Private Rooms:** Host custom lobbies with shareable 1-click invite links (`?room=CODE`).
  - **Pre-Game Waiting Lobby & Host Controls:** Configurable Draw Time (30s–120s), Word Choice Time (10s–20s), and Match Rounds (2–6 rounds).
  - **3-Word Selection System:** Drawer gets 3 random word choices at turn start with a 10s countdown auto-picker.
  - **Progressive Letter Hints:** Automatically uncovers random characters over the round duration based on word length.
  - **2-Game No-Repeat Word Memory:** Prevents chosen words from appearing in the selection pool for at least 2 consecutive matches (100+ word bank).
  - **Dynamic Skribbl.io Scoring Engine:** Speed-scaled rewards for guessers, rank position multipliers, and drawer bonuses.
  - **Fuzzy Guess Matching:** Private *"You are close!"* prompt using Levenshtein Distance ($d = 1$) visible only to the guesser.
  - **Match Podium:** Top 3 winners (🥇, 🥈, 🥉) ceremony at the end of the match before auto-resetting.

---

## 🛠️ Tech Stack

- **Frontend:** Vanilla JavaScript (ES6+), HTML5 Canvas API, CSS3
- **Backend:** Node.js, Express.js
- **Real-Time Protocol:** Socket.io (WebSockets)

---

## 📁 Project Structure

```text
skribbl/
├── server.js            # Node.js + Socket.io backend & game state machine
├── package.json         # Project metadata and dependencies
└── public/
    ├── index.html       # Game layout, modals, and canvas wrapper
    ├── style.css        # Responsive styling and modal overlays
    └── script.js        # Canvas drawing algorithms, touch handling, and client socket events