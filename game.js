// === ERROR LOG ===
const errorLog = document.getElementById('error-log');
function logError(msg) {
  errorLog.style.display = 'block';
  errorLog.textContent += msg + '\n';
}
window.addEventListener('error', e => logError('ERR: ' + e.message + ' (' + e.lineno + ')'));
window.addEventListener('unhandledrejection', e => logError('REJ: ' + e.reason));

// === CONSTANTS ===
const COLS = 10, ROWS = 20, CELL = 30;
const SIDE_GAP = 1, SIDE_W = 4;
const PANEL_X = (COLS + SIDE_GAP) * CELL;
const LOCK_DELAY = 400;
const DAS_DELAY  = 167;
const ARR_DELAY  = 33;
const FLASH_DUR  = 300;

// === CANVAS ===
const canvas = document.getElementById('c');
const ctx    = canvas.getContext('2d');
canvas.width  = (COLS + SIDE_GAP + SIDE_W) * CELL;
canvas.height = ROWS * CELL;

function resizeCanvas() {
  const maxW  = window.innerWidth  - 16;
  const maxH  = window.innerHeight - 110;
  const scale = Math.min(maxW / canvas.width, maxH / canvas.height, 1);
  canvas.style.width  = (canvas.width  * scale) + 'px';
  canvas.style.height = (canvas.height * scale) + 'px';
}
window.addEventListener('resize', resizeCanvas);

// === PIECES ===
const PIECES = [
  { color: '#00FFFF', shape: [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]] }, // I
  { color: '#FFD700', shape: [[1,1],[1,1]] },                               // O
  { color: '#CC00FF', shape: [[0,1,0],[1,1,1],[0,0,0]] },                  // T
  { color: '#00EE00', shape: [[0,1,1],[1,1,0],[0,0,0]] },                  // S
  { color: '#FF2222', shape: [[1,1,0],[0,1,1],[0,0,0]] },                  // Z
  { color: '#4488FF', shape: [[1,0,0],[1,1,1],[0,0,0]] },                  // J
  { color: '#FF8800', shape: [[0,0,1],[1,1,1],[0,0,0]] },                  // L
];

// SRS wall kicks (screen coords: +y = down). Indexed by from-rotation.
const KICKS_JLSTZ = [
  [[0,0],[-1,0],[-1,-1],[0,2],[-1,2]],  // 0->1
  [[0,0],[1,0],[1,1],[0,-2],[1,-2]],     // 1->2
  [[0,0],[1,0],[1,-1],[0,2],[1,2]],      // 2->3
  [[0,0],[-1,0],[-1,1],[0,-2],[-1,-2]], // 3->0
];
const KICKS_I = [
  [[0,0],[-2,0],[1,0],[-2,1],[1,-2]],   // 0->1
  [[0,0],[-1,0],[2,0],[-1,-2],[2,1]],   // 1->2
  [[0,0],[2,0],[-1,0],[2,-1],[-1,2]],   // 2->3
  [[0,0],[1,0],[-2,0],[1,2],[-2,-1]],   // 3->0
];

function getKicks(typeIdx, fromRot) {
  if (typeIdx === 0) return KICKS_I[fromRot];
  if (typeIdx === 1) return [[0,0]];
  return KICKS_JLSTZ[fromRot];
}

function rotateMatrix(m) {
  const rows = m.length, cols = m[0].length;
  const r2 = Array.from({ length: cols }, () => Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      r2[c][rows - 1 - r] = m[r][c];
  return r2;
}

function getShape(typeIdx, rotation) {
  let s = PIECES[typeIdx].shape.map(r => [...r]);
  for (let i = 0; i < rotation; i++) s = rotateMatrix(s);
  return s;
}

// === GAME STATE ===
let board, currentPiece, nextTypeIdx, bag;
let score, level, linesCleared;
let dropTimer, softDropping;
let isLocking, lockTimer;
let dasDir, dasTimer, arrTimer;
let flashRows, flashTimer;
let gameState, lastScore;

function getDropInterval() {
  const speeds = [800,717,633,550,467,383,300,217,133,100,83,75,67,60,53,47,42,37,33,30];
  return speeds[Math.min(level - 1, speeds.length - 1)];
}

function createBoard() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(0));
}

function nextFromBag() {
  if (!bag || bag.length === 0) {
    bag = [0,1,2,3,4,5,6];
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
  }
  return bag.pop();
}

function isValid(piece, dx, dy, newRot) {
  const rot   = newRot !== undefined ? newRot : piece.rotation;
  const shape = getShape(piece.typeIdx, rot);
  const nx = piece.x + dx, ny = piece.y + dy;
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const br = ny + r, bc = nx + c;
      if (bc < 0 || bc >= COLS || br >= ROWS) return false;
      if (br >= 0 && board[br][bc]) return false;
    }
  }
  return true;
}

function tryMove(dx, dy) {
  if (!currentPiece || !isValid(currentPiece, dx, dy)) return false;
  currentPiece.x += dx;
  currentPiece.y += dy;
  if (dx !== 0 && isLocking) lockTimer = Math.max(lockTimer, LOCK_DELAY);
  return true;
}

function tryRotate(dir) {
  if (!currentPiece) return;
  const newRot = (currentPiece.rotation + dir + 4) % 4;
  const kicks  = dir === 1 ? getKicks(currentPiece.typeIdx, currentPiece.rotation) : [[0,0]];
  for (const [kx, ky] of kicks) {
    if (isValid(currentPiece, kx, ky, newRot)) {
      currentPiece.x += kx;
      currentPiece.y += ky;
      currentPiece.rotation = newRot;
      if (isLocking) lockTimer = Math.max(lockTimer, LOCK_DELAY);
      return;
    }
  }
}

function getGhostY() {
  let gy = currentPiece.y;
  while (isValid(currentPiece, 0, gy - currentPiece.y + 1)) gy++;
  return gy;
}

function hardDrop() {
  if (!currentPiece || flashTimer > 0) return;
  const gy = getGhostY();
  score += (gy - currentPiece.y) * 2;
  currentPiece.y = gy;
  lockPiece();
}

function lockPiece() {
  const shape = getShape(currentPiece.typeIdx, currentPiece.rotation);
  const color = PIECES[currentPiece.typeIdx].color;
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const br = currentPiece.y + r, bc = currentPiece.x + c;
      if (br >= 0 && br < ROWS && bc >= 0 && bc < COLS) board[br][bc] = color;
    }
  }
  isLocking = false;
  currentPiece = null;

  const full = [];
  for (let r = 0; r < ROWS; r++) {
    if (board[r].every(c => c !== 0)) full.push(r);
  }
  if (full.length > 0) {
    flashRows  = full;
    flashTimer = FLASH_DUR;
  } else {
    spawnPiece();
  }
}

function clearLines() {
  const n = flashRows.length;
  // Remove full rows from bottom to top (high index first keeps lower indices valid)
  for (let i = flashRows.length - 1; i >= 0; i--) board.splice(flashRows[i], 1);
  for (let i = 0; i < n; i++) board.unshift(Array(COLS).fill(0));
  const pts = [0, 100, 300, 500, 800];
  score += (pts[n] || 0) * level;
  linesCleared += n;
  level = Math.floor(linesCleared / 10) + 1;
  flashRows = [];
  updateHUD();
  spawnPiece();
}

function spawnPiece() {
  const typeIdx = nextTypeIdx;
  nextTypeIdx   = nextFromBag();
  const shape   = getShape(typeIdx, 0);
  currentPiece  = {
    typeIdx,
    rotation: 0,
    x: Math.floor((COLS - shape[0].length) / 2),
    y: 0,
  };
  if (!isValid(currentPiece, 0, 0)) {
    currentPiece = null;
    gameOver();
    return;
  }
  isLocking  = false;
  lockTimer  = 0;
  dropTimer  = 0;
}

function gameOver() {
  lastScore = score;
  if (qualifiesForLeaderboard(score)) {
    const saved = localStorage.getItem('tetris-last-name') || 'AAA';
    nameChars   = [...saved.slice(0,3).padEnd(3,' ').toUpperCase()];
    nameCursor  = 0;
    gameState   = 'nameentry';
  } else {
    gameState = 'highscore';
  }
}

function updateHUD() {
  document.getElementById('score-val').textContent = score;
  document.getElementById('level-val').textContent = level;
}

// === LEADERBOARD ===
let leaderboard = JSON.parse(localStorage.getItem('tetris-leaderboard') || '[]');
let lastScoreVal = 0;
const NAME_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ ';
let nameChars = ['A','A','A'], nameCursor = 0;

function saveLeaderboard()   { localStorage.setItem('tetris-leaderboard', JSON.stringify(leaderboard)); }
function qualifiesForLeaderboard(s) {
  return s > 0 && (leaderboard.length < 10 || s > leaderboard[leaderboard.length - 1].score);
}
function addToLeaderboard(name, s) {
  leaderboard.push({ name, score: s });
  leaderboard.sort((a, b) => b.score - a.score);
  if (leaderboard.length > 10) leaderboard.length = 10;
  saveLeaderboard();
}
function cycleNameChar(dir) {
  const i = NAME_CHARS.indexOf(nameChars[nameCursor]);
  nameChars[nameCursor] = NAME_CHARS[(i + dir + NAME_CHARS.length) % NAME_CHARS.length];
}
function advanceNameCursor(dir) {
  if (dir > 0 && nameCursor === 2) { confirmName(); return; }
  nameCursor = Math.max(0, Math.min(2, nameCursor + dir));
}
function confirmName() {
  const name = nameChars.join('').trimEnd() || '???';
  localStorage.setItem('tetris-last-name', name);
  addToLeaderboard(name, lastScore);
  gameState = 'highscore';
}

// === CONTROLS ===
const isMobile    = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
let controlMode   = isMobile ? 'swipe' : 'keys';
const modeBtn     = document.getElementById('mode-btn');
const helpBtn     = document.getElementById('help-btn');
const helpOverlay = document.getElementById('help-overlay');
const helpModeHintBtn = document.getElementById('mode-hint-btn');
let swipeStart = null;

document.addEventListener('touchstart', e => {
  if (helpOverlay.contains(e.target)) return;
  if (e.target.closest('button')) return;
  e.preventDefault();
  swipeStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
}, { passive: false });

document.addEventListener('touchend', e => {
  if (helpOverlay.contains(e.target)) return;
  if (e.target.closest('button')) return;
  e.preventDefault();
  if (helpOpen) return;
  if (!swipeStart) return;
  const dx = e.changedTouches[0].clientX - swipeStart.x;
  const dy = e.changedTouches[0].clientY - swipeStart.y;
  swipeStart = null;

  if (gameState === 'nameentry') {
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10) { advanceNameCursor(1); }
    else if (Math.abs(dy) > Math.abs(dx)) { cycleNameChar(dy > 0 ? 1 : -1); }
    else { advanceNameCursor(dx > 0 ? 1 : -1); }
    return;
  }

  if (Math.abs(dx) < 15 && Math.abs(dy) < 15) {
    if (gameState === 'playing') tryRotate(1);
    else handleStart();
    return;
  }
  if (controlMode !== 'swipe') return;
  if (gameState !== 'playing' || flashTimer > 0) { handleStart(); return; }

  if (Math.abs(dx) > Math.abs(dy)) {
    // Horizontal: move left/right
    if (dx > 20)  tryMove(1, 0);
    if (dx < -20) tryMove(-1, 0);
  } else {
    // Vertical: swipe down = hard drop, swipe up = rotate
    if (dy > 30) {
      hardDrop();
    } else if (dy < -30) {
      tryRotate(-1);
    }
  }
}, { passive: false });

const keysDown = new Set();

document.addEventListener('keydown', e => {
  if (helpOpen) {
    if (e.code === 'Escape') { closeHelp(); e.preventDefault(); }
    return;
  }
  if (e.code === 'Space') {
    e.preventDefault();
    if (gameState === 'playing' && flashTimer <= 0) hardDrop();
    else handleStart();
    return;
  }
  if (gameState === 'nameentry') {
    e.preventDefault();
    if (e.code === 'ArrowUp'   || e.code === 'KeyW') cycleNameChar(-1);
    if (e.code === 'ArrowDown' || e.code === 'KeyS') cycleNameChar(1);
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') advanceNameCursor(-1);
    if (e.code === 'ArrowRight'|| e.code === 'KeyD') advanceNameCursor(1);
    if (e.code === 'Enter') confirmName();
    return;
  }
  if (gameState !== 'playing' || flashTimer > 0) return;
  if (controlMode !== 'keys') return;

  if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
    e.preventDefault();
    if (!keysDown.has('left')) { tryMove(-1, 0); dasDir = -1; dasTimer = DAS_DELAY; arrTimer = ARR_DELAY; }
    keysDown.add('left');
  }
  if (e.code === 'ArrowRight' || e.code === 'KeyD') {
    e.preventDefault();
    if (!keysDown.has('right')) { tryMove(1, 0); dasDir = 1; dasTimer = DAS_DELAY; arrTimer = ARR_DELAY; }
    keysDown.add('right');
  }
  if (e.code === 'ArrowDown' || e.code === 'KeyS') {
    e.preventDefault();
    softDropping = true;
    dropTimer = Math.max(dropTimer, getDropInterval() - 50);
  }
  if (e.code === 'ArrowUp' || e.code === 'KeyW' || e.code === 'KeyX') {
    e.preventDefault(); tryRotate(1);
  }
  if (e.code === 'KeyZ') {
    e.preventDefault(); tryRotate(-1);
  }
});

document.addEventListener('keyup', e => {
  if (e.code === 'ArrowLeft'  || e.code === 'KeyA') { keysDown.delete('left');  if (dasDir === -1) { dasDir = 0; } }
  if (e.code === 'ArrowRight' || e.code === 'KeyD') { keysDown.delete('right'); if (dasDir ===  1) { dasDir = 0; } }
  if (e.code === 'ArrowDown'  || e.code === 'KeyS') { softDropping = false; }
});

// Tilt
let tiltPermissionGranted = false;
let tiltEventReceived = false, tiltCheckTimer = null;
const tiltIndicator = document.getElementById('tilt-indicator');
let lastTiltMove = 0;

async function requestTiltPermission() {
  if (typeof DeviceOrientationEvent === 'undefined') return false;
  if (typeof DeviceOrientationEvent.requestPermission === 'function') {
    try { return (await DeviceOrientationEvent.requestPermission()) === 'granted'; }
    catch { return false; }
  }
  return true;
}

function handleOrientation(e) {
  if (controlMode !== 'tilt') return;
  tiltEventReceived = true;
  const beta = e.beta ?? 0, gamma = e.gamma ?? 0;
  tiltIndicator.textContent = `b${beta.toFixed(0)} g${gamma.toFixed(0)}`;
  if (gameState !== 'playing' || flashTimer > 0) return;
  const now = Date.now();
  if (now - lastTiltMove < 250) return;
  const THRESH = 12;
  if (Math.abs(gamma) > THRESH) {
    if (gamma > 0) tryMove(1, 0); else tryMove(-1, 0);
    lastTiltMove = now;
  }
}
window.addEventListener('deviceorientation', handleOrientation);
window.addEventListener('deviceorientationabsolute', handleOrientation);

const MODES = ['keys', 'swipe', 'tilt'];
const MODE_LABELS = { keys: '⌨ KEYS', swipe: '👆 SWIPE', tilt: '📱 TILT' };
modeBtn.textContent = MODE_LABELS[controlMode];

modeBtn.addEventListener('click', async () => {
  const next = MODES[(MODES.indexOf(controlMode) + 1) % MODES.length];
  if (next === 'tilt' && !tiltPermissionGranted) {
    tiltPermissionGranted = await requestTiltPermission();
    if (!tiltPermissionGranted) { document.getElementById('message').textContent = 'TILT NOT AVAILABLE'; return; }
  }
  controlMode = next;
  modeBtn.textContent = MODE_LABELS[controlMode];
  modeBtn.classList.toggle('tilt-active', controlMode === 'tilt');
  tiltIndicator.textContent = controlMode === 'tilt' ? 'TILT ACTIVE' : '';
  clearTimeout(tiltCheckTimer);
  if (controlMode === 'tilt') {
    tiltEventReceived = false;
    tiltCheckTimer = setTimeout(() => {
      if (controlMode === 'tilt' && !tiltEventReceived)
        tiltIndicator.textContent = 'TILT BLOCKED - CHECK BROWSER SETTINGS';
    }, 2000);
  }
});

// Help modal
let helpOpen = false;
function openHelp()  {
  helpOpen = true;
  helpModeHintBtn.textContent = modeBtn.textContent;
  modeBtn.classList.add('help-highlight');
  helpOverlay.classList.add('open');
}
function closeHelp() {
  helpOpen = false;
  modeBtn.classList.remove('help-highlight');
  helpOverlay.classList.remove('open');
}
helpBtn.addEventListener('click', openHelp);
document.getElementById('help-close').addEventListener('click', closeHelp);
helpOverlay.addEventListener('click', e => { if (e.target === helpOverlay) closeHelp(); });

// === GAME INIT ===
function handleStart() {
  if (gameState === 'playing') return;
  startGame();
}

function startGame() {
  board        = createBoard();
  score        = 0;
  level        = 1;
  linesCleared = 0;
  dropTimer    = 0;
  softDropping = false;
  isLocking    = false;
  lockTimer    = 0;
  dasDir       = 0;
  dasTimer     = 0;
  arrTimer     = 0;
  flashRows    = [];
  flashTimer   = 0;
  bag          = [];
  nextTypeIdx  = nextFromBag();
  updateHUD();
  spawnPiece();
  gameState = 'playing';
  document.getElementById('message').textContent = '';
}

// === UPDATE ===
function update(dt) {
  if (gameState !== 'playing') return;

  // Line-clear flash — pause all movement
  if (flashTimer > 0) {
    flashTimer -= dt;
    if (flashTimer <= 0) clearLines();
    return;
  }

  if (!currentPiece) return;

  // DAS / ARR
  if (dasDir !== 0 && controlMode === 'keys') {
    dasTimer -= dt;
    if (dasTimer <= 0) {
      arrTimer -= dt;
      if (arrTimer <= 0) {
        tryMove(dasDir, 0);
        arrTimer += ARR_DELAY;
      }
    }
  }

  // Gravity
  const interval = softDropping ? Math.min(50, getDropInterval()) : getDropInterval();
  dropTimer += dt;
  if (dropTimer >= interval) {
    dropTimer -= interval;
    if (dropTimer > interval) dropTimer = 0;
    const moved = tryMove(0, 1);
    if (moved && softDropping) { score++; updateHUD(); }
    if (!moved) {
      if (!isLocking) { isLocking = true; lockTimer = LOCK_DELAY; }
    } else {
      isLocking = false;
    }
  }

  // Lock delay
  if (isLocking) {
    lockTimer -= dt;
    if (lockTimer <= 0) lockPiece();
  }
}

// === RENDER ===
function drawCellPx(px, py, color, alpha) {
  const sz = CELL - 2;
  ctx.globalAlpha = alpha ?? 1;
  ctx.fillStyle = color;
  ctx.fillRect(px + 1, py + 1, sz, sz);
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fillRect(px + 1, py + 1, sz, 3);
  ctx.fillRect(px + 1, py + 1, 3, sz);
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fillRect(px + sz - 2, py + 1, 3, sz);
  ctx.fillRect(px + 1, py + sz - 2, sz, 3);
  ctx.globalAlpha = 1;
}

function drawCell(col, row, color, alpha) {
  drawCellPx(col * CELL, row * CELL, color, alpha);
}

function render() {
  ctx.fillStyle = '#0a0a0f';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Board border
  ctx.strokeStyle = '#333355';
  ctx.lineWidth   = 1;
  ctx.strokeRect(0.5, 0.5, COLS * CELL, ROWS * CELL);

  // Subtle grid
  ctx.strokeStyle = '#111122';
  ctx.lineWidth   = 0.5;
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath(); ctx.moveTo(0, r * CELL); ctx.lineTo(COLS * CELL, r * CELL); ctx.stroke();
  }
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath(); ctx.moveTo(c * CELL, 0); ctx.lineTo(c * CELL, ROWS * CELL); ctx.stroke();
  }

  // Locked board cells
  const flashPhase = Math.floor(flashTimer / 70) % 2 === 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (!board[r][c]) continue;
      const isFlash = flashRows.includes(r);
      if (isFlash) {
        drawCell(c, r, flashPhase ? '#FFFFFF' : board[r][c]);
      } else {
        drawCell(c, r, board[r][c]);
      }
    }
  }

  // Ghost piece
  if (currentPiece && flashTimer <= 0) {
    const gy    = getGhostY();
    const shape = getShape(currentPiece.typeIdx, currentPiece.rotation);
    const col   = PIECES[currentPiece.typeIdx].color;
    if (gy > currentPiece.y) {
      for (let r = 0; r < shape.length; r++)
        for (let c = 0; c < shape[r].length; c++)
          if (shape[r][c] && gy + r >= 0) drawCell(currentPiece.x + c, gy + r, col, 0.22);
    }
  }

  // Active piece
  if (currentPiece && flashTimer <= 0) {
    const shape = getShape(currentPiece.typeIdx, currentPiece.rotation);
    const col   = PIECES[currentPiece.typeIdx].color;
    for (let r = 0; r < shape.length; r++)
      for (let c = 0; c < shape[r].length; c++)
        if (shape[r][c] && currentPiece.y + r >= 0)
          drawCell(currentPiece.x + c, currentPiece.y + r, col);
  }

  drawSidePanel();

  if (gameState === 'highscore') drawHighscore();
  else if (gameState === 'nameentry') drawNameEntry();
}

function drawSidePanel() {
  const px = PANEL_X + 6;

  ctx.textAlign = 'left';
  ctx.font = `7px 'Press Start 2P', monospace`;
  ctx.fillStyle = '#888899';
  ctx.fillText('NEXT', px, 18);

  // Next piece preview (centered in side panel)
  if (nextTypeIdx !== undefined) {
    const shape = getShape(nextTypeIdx, 0);
    const pc    = PIECES[nextTypeIdx].color;
    const preW  = shape[0].length * CELL;
    const preH  = shape.length    * CELL;
    const ox    = PANEL_X + Math.floor((SIDE_W * CELL - preW) / 2);
    const oy    = 24;
    for (let r = 0; r < shape.length; r++)
      for (let c = 0; c < shape[r].length; c++)
        if (shape[r][c]) drawCellPx(ox + c * CELL, oy + r * CELL, pc);
  }

  // Stats below preview
  const sy = 24 + 4 * CELL + 16;
  ctx.font = `7px 'Press Start 2P', monospace`;

  ctx.fillStyle = '#888899';
  ctx.fillText('LINES', px, sy);
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText(String(linesCleared), px, sy + 16);

  ctx.fillStyle = '#888899';
  ctx.fillText('LEVEL', px, sy + 40);
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText(String(level), px, sy + 56);
}

function overlayBg() {
  ctx.fillStyle = 'rgba(10,10,15,0.88)';
  ctx.fillRect(0, 0, COLS * CELL, ROWS * CELL);
}

function drawHighscore() {
  overlayBg();
  const cx = COLS * CELL / 2;
  ctx.textAlign = 'center';

  ctx.font = `9px 'Press Start 2P', monospace`;
  ctx.fillStyle = '#00FFFF';
  ctx.fillText('HIGH SCORES', cx, 35);

  if (leaderboard.length === 0) {
    ctx.font = `7px 'Press Start 2P', monospace`;
    ctx.fillStyle = '#444466';
    ctx.fillText('NO SCORES YET', cx, 100);
  } else {
    ctx.font = `7px 'Press Start 2P', monospace`;
    leaderboard.slice(0, 8).forEach((e, i) => {
      const y = 58 + i * 22;
      ctx.fillStyle = i === 0 ? '#FFD700' : '#AAAACC';
      ctx.textAlign = 'left';
      ctx.fillText(`${i + 1}. ${e.name}`, cx - 75, y);
      ctx.textAlign = 'right';
      ctx.fillText(String(e.score), cx + 75, y);
    });
  }

  ctx.font = `7px 'Press Start 2P', monospace`;
  ctx.fillStyle = '#888899';
  ctx.textAlign = 'center';
  ctx.fillText('PRESS SPACE / TAP', cx, ROWS * CELL - 36);
  ctx.fillText('TO PLAY', cx, ROWS * CELL - 18);
}

function drawNameEntry() {
  overlayBg();
  const cx = COLS * CELL / 2;
  ctx.textAlign = 'center';

  ctx.font = `9px 'Press Start 2P', monospace`;
  ctx.fillStyle = '#FFD700';
  ctx.fillText('NEW RECORD!', cx, 65);

  ctx.font = `8px 'Press Start 2P', monospace`;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText(String(lastScore), cx, 90);

  ctx.font = `7px 'Press Start 2P', monospace`;
  ctx.fillStyle = '#888899';
  ctx.fillText('ENTER YOUR NAME', cx, 125);

  // Name entry boxes
  const charW = 28, gap = 10;
  const totalW = 3 * charW + 2 * gap;
  const bx = cx - totalW / 2;

  for (let i = 0; i < 3; i++) {
    const x = bx + i * (charW + gap);
    const active = i === nameCursor;
    ctx.strokeStyle = active ? '#00FFFF' : '#444466';
    ctx.lineWidth   = active ? 2 : 1;
    ctx.strokeRect(x, 140, charW, 30);
    ctx.font = `12px 'Press Start 2P', monospace`;
    ctx.fillStyle = active ? '#00FFFF' : '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.fillText(nameChars[i], x + charW / 2, 162);
  }

  ctx.font = `6px 'Press Start 2P', monospace`;
  ctx.fillStyle = '#666688';
  ctx.textAlign = 'center';
  ctx.fillText('UP/DOWN: CHANGE', cx, 200);
  ctx.fillText('LEFT/RIGHT: MOVE', cx, 214);
  ctx.fillText('ENTER/RIGHT AT END: DONE', cx, 228);
}

// === GAME LOOP ===
let lastTime = 0;
function loop(ts) {
  requestAnimationFrame(loop);
  const dt = ts - lastTime;
  if (dt < 14) return;
  lastTime = ts;
  if (gameState === 'playing' && !helpOpen) update(dt);
  render();
}

function initGame() {
  board        = createBoard();
  score        = 0;
  level        = 1;
  linesCleared = 0;
  flashTimer   = 0;
  flashRows    = [];
  bag          = [];
  nextTypeIdx  = nextFromBag();
  currentPiece = null;
  dasDir       = 0;
  softDropping = false;
  isLocking    = false;
  gameState    = 'highscore';
  updateHUD();
}

document.fonts.ready.then(() => {
  try { resizeCanvas(); initGame(); requestAnimationFrame(loop); }
  catch(e) { logError('BOOT: ' + e.message); }
}).catch(e => logError('FONTS: ' + e.message));
