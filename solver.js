// ---------------------------------------------------------------------------
// Constants & direction tables
// ---------------------------------------------------------------------------

const CHUNK = 2000;

const SQ_DIRS = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }];
const HEX_DIRS = [{ q: 1, r: 0 }, { q: -1, r: 0 }, { q: 0, r: 1 }, { q: 0, r: -1 }, { q: 1, r: -1 }, { q: -1, r: 1 }];

function getDirs(shape) { return shape === 'hexagon' ? HEX_DIRS : SQ_DIRS; }

// ---------------------------------------------------------------------------
// Coordinate helpers
// ---------------------------------------------------------------------------

function posKey(pos, shape) {
  return shape === 'hexagon' ? `${pos.q},${pos.r}` : `${pos.x},${pos.y}`;
}

function addPos(a, b) {
  if (a.x !== undefined) return { x: a.x + b.x, y: a.y + b.y };
  return { q: a.q + b.q, r: a.r + b.r };
}

function negPos(p) {
  if (p.x !== undefined) return { x: -p.x, y: -p.y };
  return { q: -p.q, r: -p.r };
}

function inShape(pos, shapeCells, shape) { return shapeCells.has(posKey(pos, shape)); }

// ---------------------------------------------------------------------------
// State serialization (used only inside Solver.run)
// ---------------------------------------------------------------------------

function stateKey(blocks, player) {
  const sorted = Array.from(blocks).sort().join('#');
  return sorted + '|' + player;
}

function parseKey(key, shape) {
  const [bpart, ppart] = key.split('|');
  const blocks = bpart ? bpart.split('#').filter(Boolean) : [];
  const positions = blocks.map(k => {
    const p = k.split(',').map(Number);
    return shape === 'hexagon' ? { q: p[0], r: p[1] } : { x: p[0], y: p[1] };
  });
  const pp = ppart.split(',').map(Number);
  const player = shape === 'hexagon' ? { q: pp[0], r: pp[1] } : { x: pp[0], y: pp[1] };
  return { blocks: positions, player };
}

// ---------------------------------------------------------------------------
// BFS: reachable cells for the player (used by Solver.run)
// ---------------------------------------------------------------------------

function reachableDistances(playerPos, blockSet, shapeCells, shape) {
  const dirs = getDirs(shape);
  const dist = new Map();
  dist.set(posKey(playerPos, shape), 0);
  const queue = [playerPos];

  while (queue.length > 0) {
    const cur = queue.shift();
    const curDist = dist.get(posKey(cur, shape));
    for (const d of dirs) {
      const next = addPos(cur, d);
      const nk = posKey(next, shape);
      if (!dist.has(nk) && inShape(next, shapeCells, shape) && !blockSet.has(nk)) {
        dist.set(nk, curDist + 1);
        queue.push(next);
      }
    }
  }
  return dist;
}

// ---------------------------------------------------------------------------
// A* heuristic: push-distance from every cell to nearest goal (used by Solver.run)
// ---------------------------------------------------------------------------

function precomputeHeuristicDist(shapeCells, dests, shape) {
  const dirs = getDirs(shape);
  const dist = new Map();
  const queue = [];

  for (const d of dests) { dist.set(d, 0); queue.push(d); }

  while (queue.length > 0) {
    const curKey = queue.shift();
    const curDist = dist.get(curKey);
    const parts = curKey.split(',').map(Number);
    const curPos = shape === 'hexagon' ? { q: parts[0], r: parts[1] } : { x: parts[0], y: parts[1] };

    for (const d of dirs) {
      const next = addPos(curPos, d);
      const nk = posKey(next, shape);
      if (shapeCells.has(nk) && !dist.has(nk)) {
        dist.set(nk, curDist + 1);
        queue.push(nk);
      }
    }
  }
  return dist;
}

function stateHeuristic(blocks, heuristicDist) {
  let h = 0;
  for (const bk of blocks) h += heuristicDist.get(bk) || 0;
  return h;
}

// ---------------------------------------------------------------------------
// Deadlock / win detection (used by Solver.run)
// ---------------------------------------------------------------------------

// A non-goal cell is "dead" if a box there can never reach a goal: every
// possible push out of it lands on a cell where the box is permanently stuck.
// Frozen cells (a box there has zero possible pushes) are the base; we then
// propagate to cells whose every achievable exit is frozen or dead, until a
// fixpoint. Exits that land on a goal keep a cell live. Computed once per
// solve, then used as a cheap Set lookup in hasDeadlock.
function computeDeadCells(shapeCells, dests, shape) {
  const dirs = getDirs(shape);
  const dead = new Set();
  let changed = true;

  while (changed) {
    changed = false;
    for (const ck of shapeCells) {
      if (dests.has(ck) || dead.has(ck)) continue;
      const parts = ck.split(',').map(Number);
      const pos = shape === 'hexagon' ? { q: parts[0], r: parts[1] } : { x: parts[0], y: parts[1] };
      let liveExit = false;

      for (const d of dirs) {
        const land = addPos(pos, d);
        const stand = addPos(pos, negPos(d));
        if (inShape(land, shapeCells, shape) && inShape(stand, shapeCells, shape)) {
          const landK = posKey(land, shape);
          if (dests.has(landK) || !dead.has(landK)) { liveExit = true; break; }
        }
      }

      if (!liveExit) { dead.add(ck); changed = true; }
    }
  }

  return dead;
}

// Static upper bound on the cells a box can ever occupy: starting from the
// initial box positions, push a box across the floor while letting the player
// walk through boxes and boxes push through boxes. Any cell outside the
// resulting set can never hold a box in any reachable state.
function computeBoxReachable(initialBlocks, shapeCells, shape) {
  const dirs = getDirs(shape);
  const reach = new Set();
  const queue = [];

  for (const k of initialBlocks) { reach.add(k); queue.push(k); }

  while (queue.length > 0) {
    const ck = queue.shift();
    const parts = ck.split(',').map(Number);
    const pos = shape === 'hexagon' ? { q: parts[0], r: parts[1] } : { x: parts[0], y: parts[1] };

    for (const d of dirs) {
      const land = addPos(pos, d);
      const stand = addPos(pos, negPos(d));
      if (!inShape(land, shapeCells, shape) || !inShape(stand, shapeCells, shape)) continue;
      const landK = posKey(land, shape);
      if (!reach.has(landK)) { reach.add(landK); queue.push(landK); }
    }
  }

  return reach;
}

// Situational freeze deadlock: repeatedly drop boxes that have at least one
// free push destination (wall-free and not blocked by another remaining box).
// Whatever is left is a rigid, permanently-locked cluster: if any box in it is
// off a goal, the state can never be solved.
function freezeDeadlock(blocks, shapeCells, shape) {
  const dirs = getDirs(shape);
  const remaining = new Set(blocks);
  let changed = true;

  while (changed) {
    changed = false;
    for (const bk of Array.from(remaining)) {
      const parts = bk.split(',').map(Number);
      const pos = shape === 'hexagon' ? { q: parts[0], r: parts[1] } : { x: parts[0], y: parts[1] };
      let movable = false;

      for (const d of dirs) {
        const dest = addPos(pos, d);
        const destK = posKey(dest, shape);
        if (inShape(dest, shapeCells, shape) && !remaining.has(destK)) { movable = true; break; }
      }

      if (movable) { remaining.delete(bk); changed = true; }
    }
  }

  return remaining;
}

function hasDeadlock(blocks, shapeCells, dests, shape, deadCells, boxReachable) {
  for (const bk of blocks) {
    if (dests.has(bk)) continue;
    if (deadCells.has(bk)) return true;
    if (!boxReachable.has(bk)) return true;
  }

  const frozen = freezeDeadlock(blocks, shapeCells, shape);
  for (const bk of frozen) {
    if (!dests.has(bk)) return true;
  }

  return false;
}

function isWin(blocks, dests) {
  if (blocks.size !== dests.size) return false;
  for (const b of blocks) if (!dests.has(b)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Path reconstruction (used by Solver.run)
// ---------------------------------------------------------------------------

function reconstructPath(endKey, parent, moveInfo, shape) {
  const path = [];
  let current = endKey;

  while (parent.has(current)) {
    const info = moveInfo.get(current);
    let blockFrom, blockTo, direction;

    if (shape === 'hexagon') {
      blockFrom = { q: info.blockFrom.q, r: info.blockFrom.r };
      blockTo = { q: info.blockTo.q, r: info.blockTo.r };
      direction = { dq: info.direction.q, dr: info.direction.r };
    } else {
      blockFrom = { x: info.blockFrom.x, y: info.blockFrom.y };
      blockTo = { x: info.blockTo.x, y: info.blockTo.y };
      direction = { dx: info.direction.x, dy: info.direction.y };
    }

    path.unshift({ blockFrom, blockTo, direction, cost: info.cost });
    current = parent.get(current);
  }
  return path;
}

// ---------------------------------------------------------------------------
// Solver — public API (used by game.js)
// ---------------------------------------------------------------------------

export class Solver {
  constructor(level) {
    this.level = level;
    this.cancelled = false;
  }

  cancel() { this.cancelled = true; }

  async run(onProgress) {
    const shape = this.level.shape;
    const dirs = getDirs(shape);
    const shapeCells = this.level.cellSet;

    const initialBlocks = new Set(this.level.blocks.map(b => posKey(b, shape)));
    const initialPlayer = posKey(this.level.player, shape);
    const destSet = new Set(this.level.destinations.map(d => posKey(d, shape)));

    const heuristicDist = precomputeHeuristicDist(shapeCells, destSet, shape);
    const deadCells = computeDeadCells(shapeCells, destSet, shape);
    const boxReachable = computeBoxReachable(initialBlocks, shapeCells, shape);
    const startKey = stateKey(initialBlocks, initialPlayer);
    const dist = new Map();
    dist.set(startKey, 0);

    const queue = [{ blocks: initialBlocks, player: initialPlayer, key: startKey, cost: 0, f: stateHeuristic(initialBlocks, heuristicDist) }];
    const parent = new Map();
    const moveInfo = new Map();

    let idx = 0;

    while (queue.length > 0 && !this.cancelled) {
      queue.sort((a, b) => a.f - b.f);
      const state = queue.shift();
      idx++;

      if (idx % CHUNK === 0) {
        onProgress?.({ visited: dist.size, queueSize: queue.length });
        await new Promise(r => setTimeout(r, 0));
        if (this.cancelled) break;
      }

      if (state.cost > dist.get(state.key)) continue;

      if (isWin(state.blocks, destSet)) {
        const path = reconstructPath(state.key, parent, moveInfo, shape);
        return { solved: true, path, visited: dist.size, cost: state.cost };
      }

      const reachable = reachableDistances(parseKey(state.key, shape).player, state.blocks, shapeCells, shape);

      for (const [playerReachableKey] of reachable) {
        const parts = playerReachableKey.split(',').map(Number);
        const playerReachablePos = shape === 'hexagon'
          ? { q: parts[0], r: parts[1] }
          : { x: parts[0], y: parts[1] };

        for (const d of dirs) {
          const blockPos = addPos(playerReachablePos, d);
          const blockKey = posKey(blockPos, shape);

          if (!state.blocks.has(blockKey)) continue;

          const pushPos = addPos(blockPos, d);
          const pushKey = posKey(pushPos, shape);

          if (!inShape(pushPos, shapeCells, shape) || state.blocks.has(pushKey)) continue;

          const newBlocks = new Set(state.blocks);
          newBlocks.delete(blockKey);
          newBlocks.add(pushKey);

          const newStateKey = stateKey(newBlocks, blockKey);
          const newCost = state.cost + 1;

          if (dist.has(newStateKey) && dist.get(newStateKey) <= newCost) continue;
          if (hasDeadlock(newBlocks, shapeCells, destSet, shape, deadCells, boxReachable)) continue;

          dist.set(newStateKey, newCost);
          parent.set(newStateKey, state.key);

          const h = stateHeuristic(newBlocks, heuristicDist);
          moveInfo.set(newStateKey, { blockFrom: blockPos, blockTo: pushPos, direction: d, cost: 1 });
          queue.push({ blocks: newBlocks, player: blockKey, key: newStateKey, cost: newCost, f: newCost + h });
        }
      }
    }

    return { solved: false, cancelled: this.cancelled, exhausted: !this.cancelled, visited: dist.size };
  }
}
