function sqNeighbors(x, y) {
  return [
    [x + 1, y],
    [x - 1, y],
    [x, y + 1],
    [x, y - 1],
  ];
}

function hexNeighbors(q, r) {
  return [
    [q + 1, r],
    [q - 1, r],
    [q, r + 1],
    [q, r - 1],
    [q + 1, r - 1],
    [q - 1, r + 1],
  ];
}

function sqKey(x, y) { return `${x},${y}`; }
function hexKey(q, r) { return `${q},${r}`; }

function rectShape(width, height) {
  const cells = new Set();
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      cells.add(sqKey(x, y));
    }
  }
  return cells;
}

function randomPolyomino(area, neighborsFn, keyFn) {
  const cells = new Set();
  const start = [0, 0];
  cells.add(keyFn(0, 0));
  const frontier = new Map();

  function addFrontier(pos) {
    const nbrs = neighborsFn(pos[0], pos[1]);
    for (const nb of nbrs) {
      const k = keyFn(nb[0], nb[1]);
      if (!cells.has(k) && !frontier.has(k)) {
        frontier.set(k, nb);
      }
    }
  }

  addFrontier(start);

  while (cells.size < area && frontier.size > 0) {
    const entries = Array.from(frontier.entries());
    const [k, pos] = entries[Math.floor(Math.random() * entries.length)];
    cells.add(k);
    frontier.delete(k);
    addFrontier(pos);
  }

  return cells;
}

function hexagonShape(radius) {
  const cells = new Set();
  for (let q = -radius; q <= radius; q++) {
    for (let r = -radius; r <= radius; r++) {
      if (Math.abs(q) <= radius && Math.abs(r) <= radius && Math.abs(q + r) <= radius) {
        cells.add(hexKey(q, r));
      }
    }
  }
  return cells;
}

function removeDeadEnds(cells, neighborsFn, keyFn) {
  const result = new Set(cells);
  let changed = true;
  while (changed) {
    changed = false;
    const toRemove = [];
    for (const key of result) {
      const parts = key.split(',').map(Number);
      const nbrs = neighborsFn(parts[0], parts[1]);
      let count = 0;
      for (const nb of nbrs) {
        if (result.has(keyFn(nb[0], nb[1]))) count++;
      }
      if (count <= 1) {
        toRemove.push(key);
      }
    }
    if (toRemove.length > 0) {
      for (const k of toRemove) result.delete(k);
      changed = true;
    }
  }
  return result;
}

function detectCorners(cells, neighborsFn, keyFn, threshold) {
  const corners = new Set();
  for (const key of cells) {
    const parts = key.split(',').map(Number);
    let boundary = 0;
    const nbrs = neighborsFn(parts[0], parts[1]);
    for (const nb of nbrs) {
      if (!cells.has(keyFn(nb[0], nb[1]))) {
        boundary++;
      }
    }
    if (boundary >= threshold) {
      corners.add(key);
    }
  }
  return corners;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function generateLevel(config) {
  const { shape, type, numBlocks, dimensions } = config;
  let cells;
  let neighborsFn;
  let keyFn;
  let threshold;

  if (shape === 'square') {
    neighborsFn = sqNeighbors;
    keyFn = sqKey;
    threshold = 2;
    if (type === 'rectangular') {
      cells = rectShape(dimensions.width, dimensions.height);
    } else {
      cells = randomPolyomino(dimensions.area, sqNeighbors, sqKey);
    }
  } else {
    neighborsFn = hexNeighbors;
    keyFn = hexKey;
    threshold = 3;
    if (type === 'hexagon') {
      cells = hexagonShape(dimensions.radius);
    } else {
      cells = randomPolyomino(dimensions.area, hexNeighbors, hexKey);
    }
  }

  const cleanCells = removeDeadEnds(cells, neighborsFn, keyFn);

  if (cleanCells.size < numBlocks + 1) {
    return null;
  }

  const corners = detectCorners(cleanCells, neighborsFn, keyFn, threshold);
  const nonCorners = new Set();
  for (const key of cleanCells) {
    if (!corners.has(key)) {
      nonCorners.add(key);
    }
  }

  if (nonCorners.size < numBlocks) {
    return null;
  }

  const allKeys = Array.from(cleanCells);

  const destKeys = shuffle(allKeys).slice(0, numBlocks);
  const destSet = new Set(destKeys);

  const blockCandidates = shuffle(Array.from(nonCorners).filter(k => !destSet.has(k)));
  if (blockCandidates.length < numBlocks) {
    return null;
  }
  const blockKeys = blockCandidates.slice(0, numBlocks);
  const blockSet = new Set(blockKeys);

  const remaining = shuffle(allKeys).filter(k => !blockSet.has(k));
  if (remaining.length === 0) {
    return null;
  }
  const playerKey = remaining[0];

  const parseCoord = shape === 'square'
    ? (k) => { const [x, y] = k.split(',').map(Number); return { x, y }; }
    : (k) => { const [q, r] = k.split(',').map(Number); return { q, r }; };

  return {
    shape,
    cells: Array.from(cleanCells).map(parseCoord),
    cellSet: cleanCells,
    destinations: destKeys.map(parseCoord),
    blocks: blockKeys.map(parseCoord),
    player: parseCoord(playerKey),
  };
}

// ---------------------------------------------------------------------------
// Level string format: human-readable ASCII level editor format
//   First char: s = square, h = hexagon
//   Tiles: n=wall, e=empty, b=box, E=goal, B=box on goal, p=player, P=player on goal
//   ,  = row separator (hex rows auto-offset by half cell)
//   Whitespace is ignored
// ---------------------------------------------------------------------------

export function parseLevelString(str) {
  const clean = str.replace(/\s+/g, '');
  if (clean.length < 2) return null;

  const shape = clean[0] === 'h' ? 'hexagon' : 'square';
  const rows = clean.substring(1).split(',');

  const cells = [];
  const destinations = [];
  const blocks = [];
  let player = null;

  for (let row = 0; row < rows.length; row++) {
    const cs = rows[row];
    for (let col = 0; col < cs.length; col++) {
      const ch = cs[col];
      if (ch === 'n') continue;

      const pos = shape === 'hexagon' ? { q: col, r: row } : { x: col, y: row };

      cells.push(pos);
      if (ch === 'E' || ch === 'B' || ch === 'P') destinations.push({ ...pos });
      if (ch === 'b' || ch === 'B') blocks.push({ ...pos });
      if (ch === 'p' || ch === 'P') player = { ...pos };
    }
  }

  if (!player) return null;

  const keyFn = shape === 'hexagon' ? hexKey : sqKey;
  const cellSet = new Set(cells.map(c => keyFn(c.x ?? c.q, c.y ?? c.r)));

  return { shape, cells, cellSet, destinations, blocks, player };
}

export function formatLevel(level, gameState) {
  const shape = level.shape;
  const keyFn = shape === 'hexagon' ? hexKey : sqKey;
  const destSet = new Set(level.destinations.map(d => keyFn(d.x ?? d.q, d.y ?? d.r)));

  const blockSet = gameState
    ? new Set(gameState.blocks.map(b => keyFn(b.x ?? b.q, b.y ?? b.r)))
    : new Set();

  const playerKey = gameState
    ? keyFn(gameState.player.x ?? gameState.player.q, gameState.player.y ?? gameState.player.r)
    : null;

  let minCol = Infinity, minRow = Infinity, maxCol = -Infinity, maxRow = -Infinity;
  const grid = new Map();

  for (const cell of level.cells) {
    const col = shape === 'hexagon' ? cell.q : cell.x;
    const row = shape === 'hexagon' ? cell.r : cell.y;
    minCol = Math.min(minCol, col);
    minRow = Math.min(minRow, row);
    maxCol = Math.max(maxCol, col);
    maxRow = Math.max(maxRow, row);
  }

  for (const cell of level.cells) {
    const col = (shape === 'hexagon' ? cell.q : cell.x) - minCol;
    const row = (shape === 'hexagon' ? cell.r : cell.y) - minRow;
    const origCol = shape === 'hexagon' ? cell.q : cell.x;
    const origRow = shape === 'hexagon' ? cell.r : cell.y;
    const ck = keyFn(origCol, origRow);
    const k = `${col},${row}`;

    let ch;
    if (ck === playerKey) ch = destSet.has(ck) ? 'P' : 'p';
    else if (blockSet.has(ck)) ch = destSet.has(ck) ? 'B' : 'b';
    else if (destSet.has(ck)) ch = 'E';
    else ch = 'e';
    grid.set(k, ch);
  }

  const rows = [];
  for (let row = 0; row <= maxRow - minRow; row++) {
    let line = '';
    for (let col = 0; col <= maxCol - minCol; col++) {
      line += grid.get(`${col},${row}`) || 'n';
    }
    line = line.replace(/n+$/, '');
    if (line.length > 0) rows.push(line);
  }

  return (shape === 'hexagon' ? 'h' : 's') + rows.join(',');
}

export { sqKey, hexKey, sqNeighbors, hexNeighbors };
