import { elements, readConfig, clearError, saveConfig, loadConfig } from './config.js';
import { generateLevel, sqNeighbors, sqKey, hexNeighbors, hexKey } from './shapeGenerator.js';
import { Solver } from './solver.js';
import { Renderer } from './renderer.js';

let level = null;
let gameState = null;
let initialState = null;
let undoStack = [];
let redoStack = [];
let moveCount = 0;
let solver = null;
let solutionPath = null;
let hintIndex = -1;
let hintSavedState = null;
let hintSteps = [];
let hintStates = [];
let hintCosts = [];
let hintSimulating = false;
let currentGenConfig = null;
let attemptCount = 0;

const renderer = new Renderer(elements.gameCanvas);
initCanvas();
setupEventListeners();
autoLoad();

if (window.APP_VERSION) {
  document.getElementById('versionDisplay').textContent = 'v' + window.APP_VERSION;
  document.title = 'Sokoban v' + window.APP_VERSION;
}

renderer.onRenderRequest(() => {
  if (gameState) renderer.render(gameState);
});

function initCanvas() {
  const main = document.getElementById('main');
  const rect = main.getBoundingClientRect();
  const w = Math.floor(rect.width - 16);
  const h = Math.floor(rect.height - 100);
  const size = Math.min(w, h);
  const dpr = window.devicePixelRatio || 1;
  elements.gameCanvas.width = Math.max(200, size) * dpr;
  elements.gameCanvas.height = Math.max(200, size) * dpr;
  elements.gameCanvas.style.width = Math.max(200, size) + 'px';
  elements.gameCanvas.style.height = Math.max(200, size) + 'px';
}

function posKey(pos, shape) {
  if (!pos) return '';
  return pos.x !== undefined ? `${pos.x},${pos.y}` : `${pos.q},${pos.r}`;
}

function addPos(a, b, shape) {
  if (shape === 'hexagon') {
    return { q: a.q + b.dq, r: a.r + b.dr };
  }
  return { x: a.x + b.dx, y: a.y + b.dy };
}

function inShape(pos, shape) {
  if (!level) return false;
  return level.cellSet.has(posKey(pos, shape));
}

function hasBlock(pos, shape) {
  if (!gameState) return false;
  return gameState.blocks.some(b => posKey(b, shape) === posKey(pos, shape));
}

function setState(newState) {
  gameState = newState;
  renderer.render(gameState);
  elements.moveCounter.textContent = `Moves: ${moveCount}`;
}

async function generateAndVerify(config) {
  clearError();
  clearLevel();
  currentGenConfig = config;
  saveConfig();

  const maxAttempts = config.maxAttempts;

  elements.solverOverlay.classList.remove('hidden');
  elements.cancelBtn.disabled = false;

  let successfulAttempts = 0;

  while (successfulAttempts < maxAttempts) {
    elements.solverAttempt.textContent = `Attempt ${successfulAttempts + 1}/${maxAttempts}`;
    elements.solverStatus.textContent = 'Generating puzzle...';

    const result = generateLevel(config);
    if (!result) continue;

    successfulAttempts++;

    elements.solverStatus.textContent = 'Verifying solvability...';

    solver = new Solver(result);
    const solveResult = await solver.run((progress) => {
      elements.solverStatus.textContent = `Verifying... (${progress.visited} states)`;
    });

    if (solveResult.cancelled) {
      elements.solverOverlay.classList.add('hidden');
      return;
    }

    if (solveResult.solved) {
      elements.solverOverlay.classList.add('hidden');
      applyLevel(result);
      solutionPath = solveResult.path;
      showStatus(`Found solvable puzzle on attempt ${successfulAttempts}/${maxAttempts} (cost: ${solveResult.cost})`);
      return;
    }
  }

  elements.solverOverlay.classList.add('hidden');
  elements.errorMsg.textContent = `Could not generate a solvable puzzle in ${maxAttempts} attempts.`;
  elements.errorMsg.classList.remove('hidden');
}

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
      const nbPos = shape === 'hexagon'
        ? { q: nb[0], r: nb[1] }
        : { x: nb[0], y: nb[1] };
      const nbKey = posKey(nbPos, shape);

      if (visited.has(nbKey)) continue;
      if (!cellSet.has(nbKey)) continue;
      if (blockSet.has(nbKey)) continue;

      visited.add(nbKey);

      const dir = shape === 'hexagon'
        ? { dq: nb[0] - cx, dr: nb[1] - cy }
        : { dx: nb[0] - cx, dy: nb[1] - cy };
      parent.set(nbKey, { parentKey: cur.key, dir });

      if (nbKey === toKey) {
        const path = [];
        let k = nbKey;
        while (k !== fromKey) {
          const p = parent.get(k);
          path.unshift(p.dir);
          k = p.parentKey;
        }
        return path;
      }

      queue.push({ pos: nbPos, key: nbKey });
    }
  }

  return null;
}

function showStatus(msg) {
  elements.statusMsg.textContent = msg;
  elements.statusMsg.classList.remove('hidden');
  setTimeout(() => elements.statusMsg.classList.add('hidden'), 4000);
}

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
  initialState = {
    blocks: blocks.map(b => ({ ...b })),
    player: { ...player },
  };
  undoStack = [];
  redoStack = [];
  moveCount = 0;
  solutionPath = null;

  renderer.setLevel(level);
  renderer.render(gameState);
  elements.moveCounter.textContent = 'Moves: 0';
  elements.undoBtn.disabled = true;
  elements.redoBtn.disabled = true;

  saveToStorage();
}

function handleCellClick(cell) {
  if (!gameState || !level) return;
  if (!elements.solverOverlay.classList.contains('hidden')) return;
  if (!elements.winOverlay.classList.contains('hidden')) return;
  const shape = level.shape;
  const player = gameState.player;
  let dir = null;

  if (shape === 'hexagon') {
    const neighbors = hexNeighbors(player.q, player.r);
    for (const nb of neighbors) {
      if (nb[0] === cell.q && nb[1] === cell.r) {
        dir = { dq: nb[0] - player.q, dr: nb[1] - player.r };
        break;
      }
    }
  } else {
    const neighbors = sqNeighbors(player.x, player.y);
    for (const nb of neighbors) {
      if (nb[0] === cell.x && nb[1] === cell.y) {
        dir = { dx: nb[0] - player.x, dy: nb[1] - player.y };
        break;
      }
    }
  }

  if (dir) {
    tryMove(dir);
    return;
  }

  const blockSet = new Set(gameState.blocks.map(b => posKey(b, shape)));
  const cellKey = posKey(cell, shape);
  if (blockSet.has(cellKey)) return;

  const path = computeWalkPath(player, cell, shape, blockSet, level.cellSet);
  if (path) {
    const preBlocks = gameState.blocks.map(b => ({ ...b }));
    const prePlayer = { ...gameState.player };
    const preMoveCount = moveCount;
    for (const step of path) {
      if (!tryMove(step)) break;
    }
    if (!hintSimulating) {
      const movesMade = moveCount - preMoveCount;
      if (movesMade > 1) {
        undoStack.splice(-movesMade, movesMade);
        undoStack.push({ blocks: preBlocks, player: prePlayer, moveCount: preMoveCount });
      }
    }
  }
}

function setupEventListeners() {
  document.addEventListener('keydown', (e) => {
    const key = e.key;
    const dirs = [];

    if (level && level.shape === 'hexagon') return;

    if (key === 'ArrowUp') {
      dirs.push({ dx: 0, dy: -1 });
    } else if (key === 'ArrowDown') {
      dirs.push({ dx: 0, dy: 1 });
    } else if (key === 'ArrowLeft') {
      dirs.push({ dx: -1, dy: 0 });
    } else if (key === 'ArrowRight') {
      dirs.push({ dx: 1, dy: 0 });
    }

    if (dirs.length > 0) {
      e.preventDefault();
      if (!elements.solverOverlay.classList.contains('hidden')) return;
      if (!elements.winOverlay.classList.contains('hidden')) return;
      for (const d of dirs) {
        if (tryMove(d)) break;
      }
    }
  });

  elements.newLevelBtn.addEventListener('click', async () => {
    const config = readConfig();
    if (config) await generateAndVerify(config);
  });

  elements.restartBtn.addEventListener('click', restart);

  elements.undoBtn.addEventListener('click', undo);

  elements.redoBtn.addEventListener('click', redo);

  elements.hintBtn.addEventListener('click', startSolve);

  elements.exportBtn.addEventListener('click', exportLevel);

  elements.importBtn.addEventListener('click', () => {
    elements.importPanel.classList.toggle('hidden');
  });

  elements.loadBtn.addEventListener('click', () => {
    const str = elements.importText.value.trim();
    if (str) importLevel(str);
  });

  elements.shareBtn.addEventListener('click', share);

  elements.zoomIn.addEventListener('click', () => renderer.zoomIn());
  elements.zoomOut.addEventListener('click', () => renderer.zoomOut());
  elements.fitView.addEventListener('click', () => renderer.fitView());

  elements.cancelBtn.addEventListener('click', () => {
    if (confirm('Are you sure you want to cancel the search? The puzzle might be solvable if you continue.')) {
      if (solver) {
        solver.cancel();
      }
    }
  });

  elements.guideBtn.addEventListener('click', () => {
    updateKeyGuide();
    elements.guideModal.classList.remove('hidden');
  });

  elements.guideClose.addEventListener('click', () => {
    elements.guideModal.classList.add('hidden');
  });

  elements.hintClose.addEventListener('click', () => {
    elements.hintBar.classList.add('hidden');
  });

  elements.hintPrev.addEventListener('click', () => {
    if (hintIndex > -1) {
      hintIndex--;
      applyHintStep();
    }
  });

  elements.hintNext.addEventListener('click', () => {
    if (hintIndex < hintSteps.length - 1) {
      hintIndex++;
      applyHintStep();
    }
  });

  elements.newLevelWinBtn.addEventListener('click', async () => {
    elements.winOverlay.classList.add('hidden');
    const config = readConfig();
    if (config) await generateAndVerify(config);
  });

  elements.winCloseBtn.addEventListener('click', () => {
    elements.winOverlay.classList.add('hidden');
  });

  renderer.onClick(handleCellClick);

  window.addEventListener('resize', () => {
    initCanvas();
    if (level) {
      renderer.setLevel(level);
      if (gameState) renderer.render(gameState);
    }
  });

  elements.sidebarToggle.addEventListener('click', () => {
    elements.sidebar.classList.toggle('open');
    elements.sidebarOverlay.classList.toggle('hidden');
  });

  elements.sidebarOverlay.addEventListener('click', () => {
    elements.sidebar.classList.remove('open');
    elements.sidebarOverlay.classList.add('hidden');
  });
}

function tryMove(dir) {
  if (!gameState || !level) return false;
  if (elements.solverOverlay.classList.contains('hidden') === false) return false;
  if (elements.winOverlay.classList.contains('hidden') === false) return false;

  if (!hintSimulating && !elements.hintBar.classList.contains('hidden')) {
    elements.hintBar.classList.add('hidden');
    hintIndex = -1;
    hintSavedState = null;
    hintSteps = [];
    hintStates = [];
    hintCosts = [];
  }

  const shape = level.shape;
  const playerPos = gameState.player;
  const target = addPos(playerPos, dir, shape);

  if (!inShape(target, shape)) return false;

  if (hasBlock(target, shape)) {
    const beyond = addPos(target, dir, shape);
    if (!inShape(beyond, shape) || hasBlock(beyond, shape)) return false;

    const newBlocks = gameState.blocks.map(b => ({ ...b }));
    const idx = newBlocks.findIndex(b => posKey(b, shape) === posKey(target, shape));
    if (idx !== -1) {
      if (shape === 'hexagon') {
        newBlocks[idx] = { q: beyond.q, r: beyond.r };
      } else {
        newBlocks[idx] = { x: beyond.x, y: beyond.y };
      }
    }
    const newPlayer = { ...target };

    if (!hintSimulating) {
      undoStack.push({
        blocks: gameState.blocks.map(b => ({ ...b })),
        player: { ...gameState.player },
        moveCount,
      });
      redoStack = [];
    }
    moveCount++;

    setState({ blocks: newBlocks, player: newPlayer });
    if (!hintSimulating) {
      elements.undoBtn.disabled = false;
      elements.redoBtn.disabled = true;
    }

    checkWin();
    return true;
  }

  if (!hintSimulating) {
    undoStack.push({
      blocks: gameState.blocks.map(b => ({ ...b })),
      player: { ...gameState.player },
      moveCount,
    });
    redoStack = [];
  }
  moveCount++;

  setState({ blocks: [...gameState.blocks], player: { ...target } });
  if (!hintSimulating) {
    elements.undoBtn.disabled = false;
    elements.redoBtn.disabled = true;
  }
  return true;
}

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

function restart() {
  if (!initialState) return;
  gameState = {
    blocks: initialState.blocks.map(b => ({ ...b })),
    player: { ...initialState.player },
  };
  undoStack = [];
  redoStack = [];
  moveCount = 0;
  solutionPath = null;
  hintIndex = -1;
  hintSavedState = null;
  hintSteps = [];
  hintStates = [];
  hintCosts = [];
  elements.hintBar.classList.add('hidden');
  renderer.render(gameState);
  elements.moveCounter.textContent = 'Moves: 0';
  elements.undoBtn.disabled = true;
  elements.redoBtn.disabled = true;
}

function undo() {
  if (undoStack.length === 0) return;
  const prev = undoStack.pop();
  redoStack.push({
    blocks: gameState.blocks.map(b => ({ ...b })),
    player: { ...gameState.player },
    moveCount,
  });
  moveCount = prev.moveCount;
  setState({
    blocks: prev.blocks.map(b => ({ ...b })),
    player: { ...prev.player },
  });
  elements.redoBtn.disabled = false;
  if (undoStack.length === 0) elements.undoBtn.disabled = true;
}

function redo() {
  if (redoStack.length === 0) return;
  const next = redoStack.pop();
  undoStack.push({
    blocks: gameState.blocks.map(b => ({ ...b })),
    player: { ...gameState.player },
    moveCount,
  });
  moveCount = next.moveCount;
  setState({
    blocks: next.blocks.map(b => ({ ...b })),
    player: { ...next.player },
  });
  elements.undoBtn.disabled = false;
  if (redoStack.length === 0) elements.redoBtn.disabled = true;
}

async function startSolve() {
  if (!level || !gameState) return;

  if (solutionPath) {
    showHint();
    return;
  }

  elements.solverOverlay.classList.remove('hidden');
  elements.cancelBtn.disabled = false;
  elements.solverStatus.textContent = 'Solving...';
  elements.solverAttempt.textContent = '';

  solver = new Solver(level);
  const result = await solver.run((progress) => {
    elements.solverStatus.textContent = `Solving... (${progress.visited} states)`;
  });

  elements.solverOverlay.classList.add('hidden');

  if (result.cancelled) return;

  if (result.solved) {
    solutionPath = result.path;
    showHint();
  } else {
    elements.errorMsg.textContent = 'This puzzle appears to be unsolvable.';
    elements.errorMsg.classList.remove('hidden');
  }
}

function showHint() {
  if (!solutionPath || solutionPath.length === 0) {
    return;
  }

  gameState = {
    blocks: initialState.blocks.map(b => ({ ...b })),
    player: { ...initialState.player },
  };
  moveCount = 0;
  undoStack = [];
  redoStack = [];
  elements.moveCounter.textContent = 'Moves: 0';
  renderer.render(gameState);

  hintIndex = -1;
  hintSavedState = {
    blocks: initialState.blocks.map(b => ({ ...b })),
    player: { ...initialState.player },
  };

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

    if (walkPath && walkPath.length > 0) {
      hintSteps.push({ ...behindBlock });
    }

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
  if (!solutionPath || hintIndex < -1 || hintIndex >= hintSteps.length) {
    updateHintUI();
    return;
  }

  if (hintIndex === -1) {
    setState({
      blocks: hintSavedState.blocks.map(b => ({ ...b })),
      player: { ...hintSavedState.player },
    });
    moveCount = 0;
    elements.moveCounter.textContent = 'Moves: 0';
    updateHintUI();
    return;
  }

  if (hintIndex < hintStates.length - 1) {
    const state = hintStates[hintIndex + 1];
    moveCount = hintCosts[hintIndex + 1];
    setState({
      blocks: state.blocks.map(b => ({ ...b })),
      player: { ...state.player },
    });
    updateHintUI();
    return;
  }

  hintSimulating = true;
  handleCellClick(hintSteps[hintIndex]);
  hintSimulating = false;

  hintStates.push({
    blocks: gameState.blocks.map(b => ({ ...b })),
    player: { ...gameState.player },
  });
  hintCosts.push(moveCount);

  updateHintUI();
}

function exportLevel() {
  if (!level || !gameState) return;

  const shape = level.shape;
  const data = {
    shape: shape,
    cells: level.cells,
    destinations: level.destinations,
    blocks: gameState.blocks,
    player: gameState.player,
  };

  try {
    const str = JSON.stringify(data);
    const encoded = btoa(unescape(encodeURIComponent(str)));
    navigator.clipboard.writeText(encoded).catch(() => {});
    elements.errorMsg.textContent = 'Level copied to clipboard!';
    elements.errorMsg.classList.remove('hidden');
    setTimeout(() => elements.errorMsg.classList.add('hidden'), 2000);
  } catch (e) {
    elements.errorMsg.textContent = 'Export failed.';
    elements.errorMsg.classList.remove('hidden');
  }
}

function importLevel(str) {
  try {
    const decoded = decodeURIComponent(escape(atob(str)));
    const data = JSON.parse(decoded);

    if (!data.shape || !data.cells || !data.destinations || !data.blocks || !data.player) {
      throw new Error('Invalid format');
    }

    const cellSet = new Set(data.cells.map(c => posKey(c, data.shape)));
    level = {
      shape: data.shape,
      cells: data.cells,
      cellSet: cellSet,
      destinations: data.destinations,
      blocks: data.blocks,
      player: data.player,
      neighborsFn: null,
      keyFn: null,
    };

    gameState = {
      blocks: data.blocks.map(b => ({ ...b })),
      player: { ...data.player },
    };
    initialState = {
      blocks: data.blocks.map(b => ({ ...b })),
      player: { ...data.player },
    };
    undoStack = [];
    redoStack = [];
    moveCount = 0;
    solutionPath = null;
    hintIndex = -1;

    renderer.setLevel(level);
    renderer.render(gameState);
    elements.moveCounter.textContent = 'Moves: 0';
    elements.undoBtn.disabled = true;
    elements.redoBtn.disabled = true;
    elements.importPanel.classList.add('hidden');
    elements.importText.value = '';

    saveToStorage();
  } catch (e) {
    elements.errorMsg.textContent = 'Import failed: invalid level string.';
    elements.errorMsg.classList.remove('hidden');
  }
}

function share() {
  exportLevel();
  const hash = window.location.hash;
  setTimeout(() => {
    const stored = localStorage.getItem('sokoban_level');
    if (stored) {
      window.location.hash = '#level=' + stored;
    }
  }, 100);
}

function saveToStorage() {
  if (!level || !initialState) return;
  const data = {
    shape: level.shape,
    cells: level.cells,
    destinations: level.destinations,
    blocks: initialState.blocks,
    player: initialState.player,
  };
  try {
    const str = JSON.stringify(data);
    const encoded = btoa(unescape(encodeURIComponent(str)));
    localStorage.setItem('sokoban_level', encoded);
  } catch (e) { /* ignore */ }
}

async function autoLoad() {
  loadConfig();

  const hash = window.location.hash;

  if (hash.startsWith('#level=')) {
    importLevel(hash.substring(7));
    return;
  }

  const stored = localStorage.getItem('sokoban_level');
  if (stored) {
    importLevel(stored);
    return;
  }

  const config = readConfig();
  if (config) {
    currentGenConfig = config;
    await generateAndVerify(config);
  } else {
    const fallback = {
      shape: 'square',
      type: 'rectangular',
      numBlocks: 3,
      maxAttempts: 100,
      dimensions: { width: 8, height: 8, area: 64 },
    };
    currentGenConfig = fallback;
    await generateAndVerify(fallback);
  }
}
