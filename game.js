import { elements, readConfig, clearError, saveConfig, loadConfig } from './config.js';
import { generateLevel, sqNeighbors, hexNeighbors } from './shapeGenerator.js';
import { Solver } from './solver.js';
import { Renderer } from './renderer.js';

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let level = null;
let gameState = null;
let initialState = null;
let undoStack = [];
let redoStack = [];
let moveCount = 0;
let solver = null;
let solutionPath = null;
let lastSolveCost = null;
let lastSolveVisited = null;
let hintIndex = -1;
let hintSavedState = null;
let hintSteps = [];
let hintStates = [];
let hintCosts = [];
let hintSimulating = false;
let currentGenConfig = null;
let attemptCount = 0;

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

const renderer = new Renderer(elements.gameCanvas);
initCanvas();
setupEventListeners();
autoLoad();

if (window.APP_VERSION) {
  document.getElementById('versionDisplay').textContent = 'v' + window.APP_VERSION;
  document.title = 'Sokoban v' + window.APP_VERSION;
}

renderer.onRenderRequest(() => { if (gameState) renderer.render(gameState); });

// ---------------------------------------------------------------------------
// Canvas sizing (used at boot + on window resize)
// ---------------------------------------------------------------------------

function initCanvas() {
  const main = document.getElementById('main');
  const rect = main.getBoundingClientRect();
  const size = Math.min(Math.floor(rect.width - 16), Math.floor(rect.height - 100));
  const dpr = window.devicePixelRatio || 1;
  elements.gameCanvas.width = Math.max(200, size) * dpr;
  elements.gameCanvas.height = Math.max(200, size) * dpr;
  elements.gameCanvas.style.width = Math.max(200, size) + 'px';
  elements.gameCanvas.style.height = Math.max(200, size) + 'px';
}

// ---------------------------------------------------------------------------
// Coordinate helpers (used throughout this file)
// ---------------------------------------------------------------------------

function posKey(pos, shape) {
  if (!pos) return '';
  return pos.x !== undefined ? `${pos.x},${pos.y}` : `${pos.q},${pos.r}`;
}

function addPos(a, b, shape) {
  return shape === 'hexagon'
    ? { q: a.q + b.dq, r: a.r + b.dr }
    : { x: a.x + b.dx, y: a.y + b.dy };
}

function inShape(pos, shape) {
  return level ? level.cellSet.has(posKey(pos, shape)) : false;
}

function hasBlock(pos, shape) {
  return gameState ? gameState.blocks.some(b => posKey(b, shape) === posKey(pos, shape)) : false;
}

// ---------------------------------------------------------------------------
// State management (used by tryMove, undo, redo, etc.)
// ---------------------------------------------------------------------------

function setState(newState) {
  gameState = newState;
  renderer.render(gameState);
  elements.moveCounter.textContent = `Moves: ${moveCount}`;
}

function clearLevel() {
  level = null;
  gameState = null;
  initialState = null;
  undoStack = [];
  redoStack = [];
  moveCount = 0;
  solutionPath = null;
  hintIndex = -1;
  hintSavedState = null;
  elements.hintBar.classList.add('hidden');
  elements.notificationBar.classList.add('hidden');
  renderer.setLevel(null);
  const ctx = renderer.canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  ctx.clearRect(0, 0, renderer.canvas.width / dpr, renderer.canvas.height / dpr);
  elements.moveCounter.textContent = 'Moves: 0';
  elements.undoBtn.disabled = true;
  elements.redoBtn.disabled = true;
}

function applyLevel(result) {
  level = result;
  attemptCount = 0;
  solutionPath = null;
  hintIndex = -1;
  hintSavedState = null;
  hintSteps = [];
  hintStates = [];
  hintCosts = [];
  elements.hintBar.classList.add('hidden');

  const blocks = result.blocks.map(b => ({ ...b }));
  const player = { ...result.player };

  gameState = { blocks, player };
  initialState = { blocks: blocks.map(b => ({ ...b })), player: { ...player } };
  undoStack = [];
  redoStack = [];
  moveCount = 0;

  renderer.setLevel(level);
  renderer.render(gameState);
  elements.moveCounter.textContent = 'Moves: 0';
  elements.undoBtn.disabled = true;
  elements.redoBtn.disabled = true;

  saveToStorage();
}

// ---------------------------------------------------------------------------
// Notification bar (used by generateAndVerify, goalBtn, importLevel)
// ---------------------------------------------------------------------------

function showStatus(msg) {
  elements.notificationText.textContent = msg;
  elements.notificationBar.classList.remove('hidden');
}

// ---------------------------------------------------------------------------
// Guide modal (used by guideBtn)
// ---------------------------------------------------------------------------

function updateKeyGuide() {
  const shape = elements.cellShape.value;
  const isMobile = window.innerWidth <= 700;

  const goalSection = `<div class="guide-section"><b>Goal</b></div>
<div class="row" style="color:#ccc">Push all brown blocks onto the golden destinations.</div>`;

  const buttonsSection = `<div class="guide-section" style="margin-top:12px"><b>Buttons</b></div>
<div class="row" style="color:#ccc"><b>Hint</b> — Shows the solution step by step</div>
<div class="row" style="color:#ccc"><b>Undo</b> — Take back your last move</div>
<div class="row" style="color:#ccc"><b>Restart</b> — Reset the puzzle to the beginning</div>`;

  const zoomSection = `<div class="guide-section" style="margin-top:12px"><b>Zoom &amp; Pan</b></div>
<div class="row" style="color:#ccc"><b>+ / -</b> buttons or scroll wheel to zoom</div>
<div class="row" style="color:#ccc">Drag the board to pan</div>
<div class="row" style="color:#ccc"><b>[ ]</b> to fit the puzzle to the screen</div>`;

  let moveSection;
  if (isMobile) {
    moveSection = `<div class="guide-section" style="margin-top:12px"><b>Moving</b></div>
<div class="row" style="color:#ccc">Tap any empty cell to walk there. The player moves automatically along a path.</div>
<div class="row" style="color:#ccc">Tap a cell next to a block to push it one space in that direction.</div>`;
  } else if (shape === 'hexagon') {
    moveSection = `<div class="guide-section" style="margin-top:12px"><b>Moving</b></div>
<div class="row" style="color:#ccc">Click any empty cell to walk there. The player moves automatically along a path.</div>
<div class="row" style="color:#ccc">Click a cell next to a block to push it one space in that direction.</div>`;
  } else {
    moveSection = `<div class="guide-section" style="margin-top:12px"><b>Moving</b></div>
<div class="row"><span class="key">↑</span> <span class="key">↓</span> <span class="key">←</span> <span class="key">→</span> arrow keys</div>
<div class="row" style="margin-top:6px;color:#ccc">Click any empty cell to walk there. Click next to a block to push it.</div>`;
  }

  elements.guideContent.innerHTML = goalSection + moveSection + buttonsSection + zoomSection;
}

// ---------------------------------------------------------------------------
// Puzzle generation + solvability verification (used by newLevelBtn, autoLoad)
// ---------------------------------------------------------------------------

async function generateAndVerify(config) {
  clearError();
  clearLevel();
  currentGenConfig = config;
  saveConfig();

  elements.solverOverlay.classList.remove('hidden');
  elements.cancelBtn.disabled = false;

  for (let i = 0; i < config.maxAttempts; i++) {
    elements.solverAttempt.textContent = `Attempt ${i + 1}/${config.maxAttempts}`;
    elements.solverStatus.textContent = 'Generating puzzle...';

    const result = generateLevel(config);
    if (!result) continue;

    elements.solverStatus.textContent = 'Verifying solvability...';

    solver = new Solver(result);
    const solveResult = await solver.run(p =>
      elements.solverStatus.textContent = `Verifying... (${p.visited} states)`
    );

    if (solveResult.cancelled) { elements.solverOverlay.classList.add('hidden'); return; }

    if (solveResult.solved) {
      elements.solverOverlay.classList.add('hidden');
      applyLevel(result);
      solutionPath = solveResult.path;
      lastSolveCost = solveResult.cost;
      lastSolveVisited = solveResult.visited;
      showStatus(`Found solvable puzzle on attempt ${i + 1}/${config.maxAttempts} (pushes: ${solveResult.cost}, states: ${solveResult.visited})`);
      return;
    }
  }

  elements.solverOverlay.classList.add('hidden');
  elements.errorMsg.textContent = `Could not generate a solvable puzzle in ${config.maxAttempts} attempts.`;
  elements.errorMsg.classList.remove('hidden');
}

// ---------------------------------------------------------------------------
// Player-walk BFS (used by handleCellClick, showHint)
// ---------------------------------------------------------------------------

function computeWalkPath(from, to, shape, blockSet, cellSet) {
  const fromKey = posKey(from, shape);
  const toKey = posKey(to, shape);
  if (fromKey === toKey) return [];

  const getNeighbors = shape === 'hexagon' ? hexNeighbors : sqNeighbors;
  const visited = new Set([fromKey]);
  const queue = [{ pos: from, key: fromKey }];
  const parent = new Map();

  while (queue.length > 0) {
    const cur = queue.shift();
    const cx = shape === 'hexagon' ? cur.pos.q : cur.pos.x;
    const cy = shape === 'hexagon' ? cur.pos.r : cur.pos.y;

    for (const nb of getNeighbors(cx, cy)) {
      const nbPos = shape === 'hexagon' ? { q: nb[0], r: nb[1] } : { x: nb[0], y: nb[1] };
      const nbKey = posKey(nbPos, shape);
      if (visited.has(nbKey) || !cellSet.has(nbKey) || blockSet.has(nbKey)) continue;

      visited.add(nbKey);
      const dir = shape === 'hexagon' ? { dq: nb[0] - cx, dr: nb[1] - cy } : { dx: nb[0] - cx, dy: nb[1] - cy };
      parent.set(nbKey, { parentKey: cur.key, dir });

      if (nbKey === toKey) {
        const path = [];
        let k = nbKey;
        while (k !== fromKey) { const p = parent.get(k); path.unshift(p.dir); k = p.parentKey; }
        return path;
      }
      queue.push({ pos: nbPos, key: nbKey });
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Click / keyboard input (used by renderer.onClick + keydown listener)
// ---------------------------------------------------------------------------

function handleCellClick(cell) {
  if (!gameState || !level) return;
  if (!elements.solverOverlay.classList.contains('hidden')) return;
  if (!elements.winOverlay.classList.contains('hidden')) return;

  const shape = level.shape;
  const player = gameState.player;
  let dir = null;

  const neighbors = shape === 'hexagon' ? hexNeighbors(player.q, player.r) : sqNeighbors(player.x, player.y);
  for (const nb of neighbors) {
    const match = shape === 'hexagon' ? (nb[0] === cell.q && nb[1] === cell.r) : (nb[0] === cell.x && nb[1] === cell.y);
    if (match) {
      dir = shape === 'hexagon' ? { dq: nb[0] - player.q, dr: nb[1] - player.r } : { dx: nb[0] - player.x, dy: nb[1] - player.y };
      break;
    }
  }

  if (dir) { tryMove(dir); return; }

  const blockSet = new Set(gameState.blocks.map(b => posKey(b, shape)));
  if (blockSet.has(posKey(cell, shape))) return;

  const path = computeWalkPath(player, cell, shape, blockSet, level.cellSet);
  if (!path) return;

  const preBlocks = gameState.blocks.map(b => ({ ...b }));
  const prePlayer = { ...gameState.player };
  const preMoveCount = moveCount;
  const preUndoLen = undoStack.length;

  for (const step of path) { if (!tryMove(step)) break; }

  if (!hintSimulating) {
    const entriesAdded = undoStack.length - preUndoLen;
    if (entriesAdded > 1) {
      undoStack.splice(preUndoLen, entriesAdded);
      undoStack.push({ blocks: preBlocks, player: prePlayer, moveCount: preMoveCount });
    }
  }
}

function tryMove(dir) {
  if (!gameState || !level) return false;
  if (!elements.solverOverlay.classList.contains('hidden')) return false;
  if (!elements.winOverlay.classList.contains('hidden')) return false;

  if (!hintSimulating && !elements.hintBar.classList.contains('hidden')) {
    elements.hintBar.classList.add('hidden');
    hintIndex = -1; hintSavedState = null; hintSteps = []; hintStates = []; hintCosts = [];
  }

  const shape = level.shape;
  const target = addPos(gameState.player, dir, shape);
  if (!inShape(target, shape)) return false;

  if (hasBlock(target, shape)) {
    const beyond = addPos(target, dir, shape);
    if (!inShape(beyond, shape) || hasBlock(beyond, shape)) return false;

    const newBlocks = gameState.blocks.map(b => ({ ...b }));
    const idx = newBlocks.findIndex(b => posKey(b, shape) === posKey(target, shape));
    if (idx !== -1) {
      newBlocks[idx] = shape === 'hexagon' ? { q: beyond.q, r: beyond.r } : { x: beyond.x, y: beyond.y };
    }

    if (!hintSimulating) {
      undoStack.push({ blocks: gameState.blocks.map(b => ({ ...b })), player: { ...gameState.player }, moveCount });
      redoStack = [];
    }
    moveCount++;

    setState({ blocks: newBlocks, player: { ...target } });
    if (!hintSimulating) { elements.undoBtn.disabled = false; elements.redoBtn.disabled = true; }
    checkWin();
    return true;
  }

  if (!hintSimulating) {
    undoStack.push({ blocks: gameState.blocks.map(b => ({ ...b })), player: { ...gameState.player }, moveCount });
    redoStack = [];
  }

  setState({ blocks: [...gameState.blocks], player: { ...target } });
  if (!hintSimulating) { elements.undoBtn.disabled = false; elements.redoBtn.disabled = true; }
  return true;
}

// ---------------------------------------------------------------------------
// Win detection (used by tryMove)
// ---------------------------------------------------------------------------

function checkWin() {
  if (!level || !gameState) return;
  const shape = level.shape;
  const destSet = new Set(level.destinations.map(d => posKey(d, shape)));
  const blockSet = new Set(gameState.blocks.map(b => posKey(b, shape)));
  if (destSet.size === blockSet.size && [...destSet].every(k => blockSet.has(k))) {
    elements.winMoves.textContent = `Moves: ${moveCount}`;
    elements.winOverlay.classList.remove('hidden');
  }
}

// ---------------------------------------------------------------------------
// Navigation: restart, undo, redo (used by their respective buttons)
// ---------------------------------------------------------------------------

function restart() {
  if (!initialState) return;
  gameState = { blocks: initialState.blocks.map(b => ({ ...b })), player: { ...initialState.player } };
  undoStack = []; redoStack = []; moveCount = 0;
  solutionPath = null; hintIndex = -1; hintSavedState = null; hintSteps = []; hintStates = []; hintCosts = [];
  elements.hintBar.classList.add('hidden');
  renderer.render(gameState);
  elements.moveCounter.textContent = 'Moves: 0';
  elements.undoBtn.disabled = true; elements.redoBtn.disabled = true;
}

function undo() {
  if (undoStack.length === 0) return;
  const prev = undoStack.pop();
  redoStack.push({ blocks: gameState.blocks.map(b => ({ ...b })), player: { ...gameState.player }, moveCount });
  moveCount = prev.moveCount;
  setState({ blocks: prev.blocks.map(b => ({ ...b })), player: { ...prev.player } });
  elements.redoBtn.disabled = false;
  if (undoStack.length === 0) elements.undoBtn.disabled = true;
}

function redo() {
  if (redoStack.length === 0) return;
  const next = redoStack.pop();
  undoStack.push({ blocks: gameState.blocks.map(b => ({ ...b })), player: { ...gameState.player }, moveCount });
  moveCount = next.moveCount;
  setState({ blocks: next.blocks.map(b => ({ ...b })), player: { ...next.player } });
  elements.undoBtn.disabled = false;
  if (redoStack.length === 0) elements.redoBtn.disabled = true;
}

// ---------------------------------------------------------------------------
// Hint system (used by hintBtn, hintPrev/Next)
// ---------------------------------------------------------------------------

async function startSolve() {
  if (!level || !gameState) return;
  if (solutionPath) { showHint(); return; }

  elements.solverOverlay.classList.remove('hidden');
  elements.cancelBtn.disabled = false;
  elements.solverStatus.textContent = 'Solving...';
  elements.solverAttempt.textContent = '';

  solver = new Solver(level);
  const result = await solver.run(p => elements.solverStatus.textContent = `Solving... (${p.visited} states)`);
  elements.solverOverlay.classList.add('hidden');

  if (result.cancelled) return;
  if (result.solved) {
    solutionPath = result.path;
    lastSolveCost = result.cost;
    lastSolveVisited = result.visited;
    showHint();
  } else {
    elements.errorMsg.textContent = 'This puzzle appears to be unsolvable.';
    elements.errorMsg.classList.remove('hidden');
  }
}

function showHint() {
  if (!solutionPath || solutionPath.length === 0) return;

  gameState = { blocks: initialState.blocks.map(b => ({ ...b })), player: { ...initialState.player } };
  moveCount = 0; undoStack = []; redoStack = [];
  elements.moveCounter.textContent = 'Moves: 0';
  renderer.render(gameState);

  hintIndex = -1;
  hintSavedState = { blocks: initialState.blocks.map(b => ({ ...b })), player: { ...initialState.player } };

  const shape = level.shape;
  hintSteps = [];
  hintStates = [{ blocks: initialState.blocks.map(b => ({ ...b })), player: { ...initialState.player } }];
  hintCosts = [0];
  let simBlocks = initialState.blocks.map(b => ({ ...b }));
  let simPlayer = { ...initialState.player };

  for (const push of solutionPath) {
    const behindBlock = shape === 'hexagon'
      ? { q: push.blockFrom.q - push.direction.dq, r: push.blockFrom.r - push.direction.dr }
      : { x: push.blockFrom.x - push.direction.dx, y: push.blockFrom.y - push.direction.dy };

    const blockSet = new Set(simBlocks.map(b => posKey(b, shape)));
    const walkPath = computeWalkPath(simPlayer, behindBlock, shape, blockSet, level.cellSet);
    if (walkPath && walkPath.length > 0) hintSteps.push({ ...behindBlock });
    hintSteps.push({ ...push.blockFrom });

    simBlocks = simBlocks.filter(b => posKey(b, shape) !== posKey(push.blockFrom, shape)).map(b => ({ ...b }));
    simBlocks.push({ ...push.blockTo });
    simPlayer = { ...push.blockFrom };
  }

  elements.hintBar.classList.remove('hidden');
  updateHintUI();
}

function updateHintUI() {
  if (!solutionPath) return;
  const total = hintSteps.length;
  elements.hintStep.textContent = `Step ${hintIndex + 1} / ${total}`;
  elements.hintDesc.textContent = '';
  elements.hintPrev.disabled = hintIndex < 0;
  elements.hintNext.disabled = hintIndex >= total - 1;
}

function applyHintStep() {
  if (!solutionPath || hintIndex < -1 || hintIndex >= hintSteps.length) { updateHintUI(); return; }

  if (hintIndex === -1) {
    setState({ blocks: hintSavedState.blocks.map(b => ({ ...b })), player: { ...hintSavedState.player } });
    moveCount = 0;
    elements.moveCounter.textContent = 'Moves: 0';
    updateHintUI();
    return;
  }

  if (hintIndex < hintStates.length - 1) {
    const state = hintStates[hintIndex + 1];
    moveCount = hintCosts[hintIndex + 1];
    setState({ blocks: state.blocks.map(b => ({ ...b })), player: { ...state.player } });
    updateHintUI();
    return;
  }

  hintSimulating = true;
  handleCellClick(hintSteps[hintIndex]);
  hintSimulating = false;

  hintStates.push({ blocks: gameState.blocks.map(b => ({ ...b })), player: { ...gameState.player } });
  hintCosts.push(moveCount);
  updateHintUI();
}

// ---------------------------------------------------------------------------
// Export / Import (used by exportBtn, importBtn, loadBtn, autoLoad)
// ---------------------------------------------------------------------------

function exportLevel() {
  if (!level || !gameState) return;

  const shape = level.shape;
  const data = { shape, cells: level.cells, destinations: level.destinations, blocks: gameState.blocks, player: gameState.player };

  try {
    const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(data))));
    navigator.clipboard.writeText(encoded).catch(() => {});
    elements.errorMsg.textContent = 'Level copied to clipboard!';
    elements.errorMsg.classList.remove('hidden');
    setTimeout(() => elements.errorMsg.classList.add('hidden'), 2000);
  } catch (e) {
    elements.errorMsg.textContent = 'Export failed.';
    elements.errorMsg.classList.remove('hidden');
  }
}

async function importLevel(str) {
  try {
    const data = JSON.parse(decodeURIComponent(escape(atob(str))));
    if (!data.shape || !data.cells || !data.destinations || !data.blocks || !data.player) throw new Error('Invalid format');

    const cellSet = new Set(data.cells.map(c => posKey(c, data.shape)));
    level = { shape: data.shape, cells: data.cells, cellSet, destinations: data.destinations, blocks: data.blocks, player: data.player, neighborsFn: null, keyFn: null };

    gameState = { blocks: data.blocks.map(b => ({ ...b })), player: { ...data.player } };
    initialState = { blocks: data.blocks.map(b => ({ ...b })), player: { ...data.player } };
    undoStack = []; redoStack = []; moveCount = 0;
    solutionPath = null; hintIndex = -1; lastSolveCost = null; lastSolveVisited = null;

    renderer.setLevel(level);
    renderer.render(gameState);
    elements.moveCounter.textContent = 'Moves: 0';
    elements.undoBtn.disabled = true; elements.redoBtn.disabled = true;
    elements.importPanel.classList.add('hidden');
    elements.importText.value = '';

    saveToStorage();

    elements.solverOverlay.classList.remove('hidden');
    elements.cancelBtn.disabled = false;
    elements.solverStatus.textContent = 'Solving...';
    elements.solverAttempt.textContent = '';
    solver = new Solver(level);
    const result = await solver.run(p => elements.solverStatus.textContent = `Solving... (${p.visited} states)`);
    elements.solverOverlay.classList.add('hidden');
    if (result.cancelled) return;
    if (result.solved) {
      solutionPath = result.path; lastSolveCost = result.cost; lastSolveVisited = result.visited;
      showStatus(`Pushes: ${lastSolveCost}, States explored: ${lastSolveVisited}`);
    } else {
      showStatus('This puzzle appears to be unsolvable.');
    }
  } catch (e) {
    elements.errorMsg.textContent = 'Import failed: invalid level string.';
    elements.errorMsg.classList.remove('hidden');
  }
}

// ---------------------------------------------------------------------------
// LocalStorage persistence (used by applyLevel, importLevel)
// ---------------------------------------------------------------------------

function saveToStorage() {
  if (!level || !initialState) return;
  try {
    const encoded = btoa(unescape(encodeURIComponent(JSON.stringify({
      shape: level.shape, cells: level.cells, destinations: level.destinations,
      blocks: initialState.blocks, player: initialState.player,
    }))));
    localStorage.setItem('sokoban_level', encoded);
  } catch (e) { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Event wiring (run once at boot)
// ---------------------------------------------------------------------------

function setupEventListeners() {
  document.addEventListener('keydown', e => {
    if (level && level.shape === 'hexagon') return;
    const dirMap = { ArrowUp: { dx: 0, dy: -1 }, ArrowDown: { dx: 0, dy: 1 }, ArrowLeft: { dx: -1, dy: 0 }, ArrowRight: { dx: 1, dy: 0 } };
    const dir = dirMap[e.key];
    if (!dir) return;
    e.preventDefault();
    if (!elements.solverOverlay.classList.contains('hidden') || !elements.winOverlay.classList.contains('hidden')) return;
    tryMove(dir);
  });

  elements.newLevelBtn.addEventListener('click', async () => { const c = readConfig(); if (c) await generateAndVerify(c); });
  elements.restartBtn.addEventListener('click', restart);
  elements.undoBtn.addEventListener('click', undo);
  elements.redoBtn.addEventListener('click', redo);
  elements.hintBtn.addEventListener('click', startSolve);
  elements.exportBtn.addEventListener('click', exportLevel);
  elements.importBtn.addEventListener('click', () => elements.importPanel.classList.toggle('hidden'));
  elements.loadBtn.addEventListener('click', async () => { const s = elements.importText.value.trim(); if (s) await importLevel(s); });
  elements.zoomIn.addEventListener('click', () => renderer.zoomIn());
  elements.zoomOut.addEventListener('click', () => renderer.zoomOut());
  elements.fitView.addEventListener('click', () => renderer.fitView());

  elements.cancelBtn.addEventListener('click', () => {
    if (confirm('Are you sure you want to cancel the search? The puzzle might be solvable if you continue.')) solver?.cancel();
  });

  elements.guideBtn.addEventListener('click', () => { updateKeyGuide(); elements.guideModal.classList.remove('hidden'); });

  elements.goalBtn.addEventListener('click', async () => {
    if (lastSolveCost !== null) { showStatus(`Pushes: ${lastSolveCost}, States explored: ${lastSolveVisited}`); return; }
    if (!level || !gameState) { showStatus('No puzzle loaded.'); return; }

    elements.solverOverlay.classList.remove('hidden');
    elements.cancelBtn.disabled = false;
    elements.solverStatus.textContent = 'Solving...';
    elements.solverAttempt.textContent = '';
    solver = new Solver(level);
    const result = await solver.run(p => elements.solverStatus.textContent = `Solving... (${p.visited} states)`);
    elements.solverOverlay.classList.add('hidden');
    if (result.cancelled) return;
    if (result.solved) {
      solutionPath = result.path; lastSolveCost = result.cost; lastSolveVisited = result.visited;
      showStatus(`Pushes: ${lastSolveCost}, States explored: ${lastSolveVisited}`);
    } else {
      showStatus('This puzzle appears to be unsolvable.');
    }
  });

  elements.notificationClose.addEventListener('click', () => elements.notificationBar.classList.add('hidden'));
  elements.guideClose.addEventListener('click', () => elements.guideModal.classList.add('hidden'));
  elements.hintClose.addEventListener('click', () => elements.hintBar.classList.add('hidden'));
  elements.hintPrev.addEventListener('click', () => { if (hintIndex > -1) { hintIndex--; applyHintStep(); } });
  elements.hintNext.addEventListener('click', () => { if (hintIndex < hintSteps.length - 1) { hintIndex++; applyHintStep(); } });

  elements.newLevelWinBtn.addEventListener('click', async () => {
    elements.winOverlay.classList.add('hidden');
    const c = readConfig();
    if (c) await generateAndVerify(c);
  });
  elements.winCloseBtn.addEventListener('click', () => elements.winOverlay.classList.add('hidden'));

  renderer.onClick(handleCellClick);

  window.addEventListener('resize', () => {
    initCanvas();
    if (level) { renderer.setLevel(level); if (gameState) renderer.render(gameState); }
  });

  elements.sidebarToggle.addEventListener('click', () => { elements.sidebar.classList.toggle('open'); elements.sidebarOverlay.classList.toggle('hidden'); });
  elements.sidebarOverlay.addEventListener('click', () => { elements.sidebar.classList.remove('open'); elements.sidebarOverlay.classList.add('hidden'); });
}

// ---------------------------------------------------------------------------
// Startup: load persisted level or generate a new one
// ---------------------------------------------------------------------------

async function autoLoad() {
  loadConfig();

  const hash = window.location.hash;
  if (hash.startsWith('#level=')) { await importLevel(hash.substring(7)); return; }

  const stored = localStorage.getItem('sokoban_level');
  if (stored) { await importLevel(stored); return; }

  const config = readConfig() || { shape: 'square', type: 'rectangular', numBlocks: 3, maxAttempts: 100, dimensions: { width: 8, height: 8, area: 64 } };
  currentGenConfig = config;
  await generateAndVerify(config);
}
