const CHUNK = 2000;
const MAX_VISITED = 500000;

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

function posKey(pos, shape) {
  if (shape === 'hexagon') {
    return `${pos.q},${pos.r}`;
  }
  return `${pos.x},${pos.y}`;
}

function addPos(a, b) {
  if (a.x !== undefined) {
    return { x: a.x + b.x, y: a.y + b.y };
  }
  return { q: a.q + b.q, r: a.r + b.r };
}

function eqPos(a, b) {
  if (a.x !== undefined) {
    return a.x === b.x && a.y === b.y;
  }
  return a.q === b.q && a.r === b.r;
}

const SQ_DIRS = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }];
const HEX_DIRS = [{ q: 1, r: 0 }, { q: -1, r: 0 }, { q: 0, r: 1 }, { q: 0, r: -1 }, { q: 1, r: -1 }, { q: -1, r: 1 }];

function getDirs(shape) {
  return shape === 'hexagon' ? HEX_DIRS : SQ_DIRS;
}

function inShape(pos, shapeCells, shape) {
  return shapeCells.has(posKey(pos, shape));
}

function reachableDistances(playerPos, blockSet, shapeCells, shape) {
  const dirs = getDirs(shape);
  const dist = new Map();
  const key = posKey(playerPos, shape);
  const queue = [playerPos];
  dist.set(key, 0);

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

export class Solver {
  constructor(level) {
    this.level = level;
    this.cancelled = false;
    this.solutionPath = null;
    this.solutionCost = 0;
  }

  cancel() {
    this.cancelled = true;
  }

  async run(onProgress) {
    const { cells, neighborsFn, keyFn } = this.level;
    const shape = this.level.shape;
    const dirs = getDirs(shape);
    const shapeCells = this.level.cellSet;

    const initialBlocks = new Set(this.level.blocks.map(b => posKey(b, shape)));
    const initialPlayer = posKey(this.level.player, shape);
    const destSet = new Set(this.level.destinations.map(d => posKey(d, shape)));

    const startKey = stateKey(initialBlocks, initialPlayer);
    const dist = new Map();
    dist.set(startKey, 0);
    const queue = [{ blocks: initialBlocks, player: initialPlayer, key: startKey, cost: 0 }];
    const visited = new Set([startKey]);
    const parent = new Map();
    const moveInfo = new Map();

    let idx = 0;

    while (queue.length > 0 && !this.cancelled) {
      queue.sort((a, b) => a.cost - b.cost);
      const state = queue.shift();
      idx++;

      if (idx % CHUNK === 0) {
        if (onProgress) {
          onProgress({ visited: visited.size, queueSize: queue.length });
        }
        await new Promise(r => setTimeout(r, 0));
        if (this.cancelled) break;
      }

      if (state.cost > dist.get(state.key)) continue;

      const reachable = reachableDistances(
        parseKey(state.key, shape).player,
        state.blocks,
        shapeCells,
        shape
      );

      for (const [playerReachableKey, walkDist] of reachable) {
        const parts = playerReachableKey.split(',').map(Number);
        const playerReachablePos = shape === 'hexagon'
          ? { q: parts[0], r: parts[1] }
          : { x: parts[0], y: parts[1] };

for (const d of dirs) {
            const blockPos = addPos(playerReachablePos, d);
            const blockKey = posKey(blockPos, shape);

            if (!state.blocks.has(blockKey)) continue;

            let pushPos = addPos(blockPos, d);
            let pushKey = posKey(pushPos, shape);
            let pushDistance = 1;
            while (inShape(pushPos, shapeCells, shape) && !state.blocks.has(pushKey)) {
              const newBlocks = new Set(state.blocks);
              newBlocks.delete(blockKey);
              newBlocks.add(pushKey);

              const playerEndKey = blockKey;
              const newStateKey = stateKey(newBlocks, playerEndKey);

              if (!visited.has(newStateKey)) {
                visited.add(newStateKey);
                if (visited.size > MAX_VISITED) {
                  return { solved: false, exhausted: true, visited: visited.size };
                }

                const stepCost = walkDist + pushDistance;
                const newCost = state.cost + stepCost;

                parent.set(newStateKey, state.key);
                moveInfo.set(newStateKey, {
                  blockFrom: blockPos,
                  blockTo: pushPos,
                  direction: d,
                  cost: stepCost,
                });

                if (isWin(newBlocks, destSet)) {
                  this.solutionPath = reconstructPath(newStateKey, parent, moveInfo, shape);
                  this.solutionCost = newCost;
                  return { solved: true, path: this.solutionPath, visited: visited.size, cost: this.solutionCost };
                }

                if (hasDeadlock(newBlocks, shapeCells, destSet, shape)) continue;

                dist.set(newStateKey, newCost);
                queue.push({ blocks: newBlocks, player: playerEndKey, key: newStateKey, cost: newCost });
              }

              pushPos = addPos(pushPos, d);
              pushKey = posKey(pushPos, shape);
              pushDistance++;
            }
        }
      }
    }

    if (this.cancelled) {
      return { solved: false, cancelled: true, visited: visited.size };
    }

    return { solved: false, exhausted: true, visited: visited.size };
  }
}

function hasDeadlock(blocks, shapeCells, dests, shape) {
  for (const bk of blocks) {
    if (dests.has(bk)) continue;
    const parts = bk.split(',').map(Number);
    let canPush = false;

    if (shape === 'square') {
      const x = parts[0], y = parts[1];
      const checks = [
        [-1, 0], [1, 0], [0, -1], [0, 1]
      ];
      for (const [dx, dy] of checks) {
        const behind = `${x-dx},${y-dy}`;
        const ahead = `${x+dx},${y+dy}`;
        if (shapeCells.has(behind) && shapeCells.has(ahead)) {
          canPush = true;
          break;
        }
      }
    } else {
      const q = parts[0], r = parts[1];
      const checks = [
        [-1, 0], [1, 0], [0, -1], [0, 1], [-1, 1], [1, -1]
      ];
      for (const [dq, dr] of checks) {
        const behind = `${q-dq},${r-dr}`;
        const ahead = `${q+dq},${r+dr}`;
        if (shapeCells.has(behind) && shapeCells.has(ahead)) {
          canPush = true;
          break;
        }
      }
    }

    if (!canPush) return true;
  }
  return false;
}

function isWin(blocks, dests) {
  if (blocks.size !== dests.size) return false;
  for (const b of blocks) {
    if (!dests.has(b)) return false;
  }
  return true;
}

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

export function applyMove(state, move, shape) {
  const blocks = new Set(state.blocks.map(b => posKey(b, shape)));
  const playerKey = posKey(state.player, shape);

  const blockFromKey = posKey(move.blockFrom, shape);
  const blockToKey = posKey(move.blockTo, shape);

  blocks.delete(blockFromKey);
  blocks.add(blockToKey);

  const newPlayerPos = shape === 'hexagon'
    ? { q: move.blockFrom.q - move.direction.dq, r: move.blockFrom.r - move.direction.dr }
    : { x: move.blockFrom.x - move.direction.x, y: move.blockFrom.y - move.direction.y };

  return {
    blocks: Array.from(blocks).map(k => {
      const p = k.split(',').map(Number);
      return shape === 'hexagon' ? { q: p[0], r: p[1] } : { x: p[0], y: p[1] };
    }),
    player: newPlayerPos,
  };
}
