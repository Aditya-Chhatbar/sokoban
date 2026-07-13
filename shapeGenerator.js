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

function detectCorners(cells, shape, neighborsFn, keyFn, threshold) {
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

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
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

  const corners = detectCorners(cleanCells, cleanCells, neighborsFn, keyFn, threshold);
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

  const availableBlocks = shuffle(Array.from(nonCorners));
  const blockKeys = availableBlocks.slice(0, numBlocks);
  const blockSet = new Set(blockKeys);

  const remaining = shuffle(allKeys).filter(k => !blockSet.has(k) && !destSet.has(k));
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
    corners,
    destinations: destKeys.map(parseCoord),
    blocks: blockKeys.map(parseCoord),
    player: parseCoord(playerKey),
    parseCoord,
    neighborsFn,
    keyFn,
  };
}

export function parseCoord(shape, key) {
  const parts = key.split(',').map(Number);
  if (shape === 'square') {
    return { x: parts[0], y: parts[1] };
  }
  return { q: parts[0], r: parts[1] };
}

export { sqKey, hexKey, sqNeighbors, hexNeighbors };
