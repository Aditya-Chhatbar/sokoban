export const elements = {
  cellShape: document.getElementById('cellShape'),
  gridType: document.getElementById('gridType'),
  width: document.getElementById('width'),
  height: document.getElementById('height'),
  area: document.getElementById('area'),
  radius: document.getElementById('radius'),
  blocks: document.getElementById('blocks'),
  maxAttempts: document.getElementById('maxAttempts'),

  errorMsg: document.getElementById('errorMsg'),
  notificationBar: document.getElementById('notificationBar'),
  notificationText: document.getElementById('notificationText'),
  notificationClose: document.getElementById('notificationClose'),
  goalBtn: document.getElementById('goalBtn'),
  guideBtn: document.getElementById('guideBtn'),
  guideModal: document.getElementById('guideModal'),
  guideContent: document.getElementById('guideContent'),
  guideClose: document.getElementById('guideClose'),
  gameCanvas: document.getElementById('gameCanvas'),
  moveCounter: document.getElementById('moveCounter'),
  newLevelBtn: document.getElementById('newLevelBtn'),
  restartBtn: document.getElementById('restartBtn'),
  undoBtn: document.getElementById('undoBtn'),
  redoBtn: document.getElementById('redoBtn'),
  hintBtn: document.getElementById('hintBtn'),
  exportBtn: document.getElementById('exportBtn'),
  importBtn: document.getElementById('importBtn'),
  importPanel: document.getElementById('importPanel'),
  importText: document.getElementById('importText'),
  loadBtn: document.getElementById('loadBtn'),
  solverOverlay: document.getElementById('solverOverlay'),
  solverStatus: document.getElementById('solverStatus'),
  solverAttempt: document.getElementById('solverAttempt'),
  cancelBtn: document.getElementById('cancelBtn'),
  winOverlay: document.getElementById('winOverlay'),
  winMoves: document.getElementById('winMoves'),
  newLevelWinBtn: document.getElementById('newLevelWinBtn'),
  winCloseBtn: document.getElementById('winCloseBtn'),
  hintBar: document.getElementById('hintBar'),
  hintStep: document.getElementById('hintStep'),
  hintPrev: document.getElementById('hintPrev'),
  hintNext: document.getElementById('hintNext'),
  hintDesc: document.getElementById('hintDesc'),
  hintClose: document.getElementById('hintClose'),
  paramsRect: document.getElementById('paramsRect'),
  paramsArea: document.getElementById('paramsArea'),
  paramsHex: document.getElementById('paramsHex'),
  sidebarToggle: document.getElementById('sidebarToggle'),
  sidebar: document.getElementById('sidebar'),
  sidebarOverlay: document.getElementById('sidebarOverlay'),
  zoomIn: document.getElementById('zoomIn'),
  zoomOut: document.getElementById('zoomOut'),
  fitView: document.getElementById('fitView'),
};

function showError(msg) {
  elements.errorMsg.textContent = msg;
  elements.errorMsg.classList.remove('hidden');
}

export function saveConfig() {
  const data = {
    cellShape: elements.cellShape.value,
    gridType: elements.gridType.value,
    width: elements.width.value,
    height: elements.height.value,
    area: elements.area.value,
    radius: elements.radius.value,
    blocks: elements.blocks.value,
    maxAttempts: elements.maxAttempts.value,
  };
  try {
    localStorage.setItem('sokoban_config', JSON.stringify(data));
  } catch (e) { /* ignore */ }
}

export function loadConfig() {
  try {
    const raw = localStorage.getItem('sokoban_config');
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (data.cellShape) elements.cellShape.value = data.cellShape;
    populateGridTypes();
    if (data.gridType) elements.gridType.value = data.gridType;
    updateParamVisibility();
    if (data.width) elements.width.value = data.width;
    if (data.height) elements.height.value = data.height;
    if (data.area) elements.area.value = data.area;
    if (data.radius) elements.radius.value = data.radius;
    if (data.blocks) elements.blocks.value = data.blocks;
    if (data.maxAttempts) elements.maxAttempts.value = data.maxAttempts;
    return true;
  } catch (e) { return false; }
}

export function clearError() {
  elements.errorMsg.classList.add('hidden');
}

function updateParamVisibility() {
  const shape = elements.cellShape.value;
  const type = elements.gridType.value;

  elements.paramsRect.classList.add('hidden');
  elements.paramsArea.classList.add('hidden');
  elements.paramsHex.classList.add('hidden');

  if (shape === 'square') {
    if (type === 'rectangular') {
      elements.paramsRect.classList.remove('hidden');
    } else {
      elements.paramsArea.classList.remove('hidden');
    }
  } else {
    if (type === 'hexagon') {
      elements.paramsHex.classList.remove('hidden');
    } else {
      elements.paramsArea.classList.remove('hidden');
    }
  }
}

function populateGridTypes() {
  const shape = elements.cellShape.value;
  const current = elements.gridType.value;
  elements.gridType.innerHTML = '';
  if (shape === 'square') {
    elements.gridType.add(new Option('Rectangular', 'rectangular'));
    elements.gridType.add(new Option('Random', 'random'));
  } else {
    elements.gridType.add(new Option('Hexagon', 'hexagon'));
    elements.gridType.add(new Option('Random', 'random'));
  }
  if (Array.from(elements.gridType.options).some(o => o.value === current)) {
    elements.gridType.value = current;
  }
  updateParamVisibility();
}

export function readConfig() {
  clearError();
  const shape = elements.cellShape.value;
  const type = elements.gridType.value;
  const numBlocks = parseInt(elements.blocks.value, 10);
  const maxAttempts = parseInt(elements.maxAttempts.value, 10);

  let dimensions = {};

  if (shape === 'square') {
    if (type === 'rectangular') {
      const w = parseInt(elements.width.value, 10);
      const h = parseInt(elements.height.value, 10);
      if (w < 2 || h < 2) {
        showError('Width and height must be at least 2.');
        return null;
      }
      dimensions = { width: w, height: h, area: w * h };
    } else {
      const a = parseInt(elements.area.value, 10);
      if (a < 4) {
        showError('Area must be at least 4.');
        return null;
      }
      dimensions = { area: a };
    }
  } else {
    if (type === 'hexagon') {
      const r = parseInt(elements.radius.value, 10);
      if (r < 1) {
        showError('Radius must be at least 1.');
        return null;
      }
      const total = 3 * r * (r + 1) + 1;
      dimensions = { radius: r, area: total };
    } else {
      const a = parseInt(elements.area.value, 10);
      if (a < 1) {
        showError('Area must be at least 1.');
        return null;
      }
      dimensions = { area: a };
    }
  }

  if (numBlocks < 1) {
    showError('Number of blocks must be at least 1.');
    return null;
  }

  if (dimensions.area < numBlocks + 1) {
    showError(`Area (${dimensions.area}) must be at least blocks+1 (${numBlocks + 1}) to fit the player.`);
    return null;
  }

  return { shape, type, numBlocks, maxAttempts, dimensions };
}

elements.cellShape.addEventListener('change', () => {
  populateGridTypes();
  saveConfig();
});

elements.gridType.addEventListener('change', () => {
  updateParamVisibility();
  saveConfig();
});

['width', 'height', 'area', 'radius', 'blocks', 'maxAttempts'].forEach(id => {
  elements[id].addEventListener('change', saveConfig);
});

populateGridTypes();
