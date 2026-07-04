export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cellSize = 40;
    this.offsetX = 0;
    this.offsetY = 0;
    this.level = null;
    this.touchStart = null;
    this.swipeHandler = null;
    this._setupTouch();
  }

  setLevel(level) {
    this.level = level;
    this._computeLayout();
  }

  _computeLayout() {
    if (!this.level) return;

    const { shape, cells } = this.level;
    const padding = 40;

    if (shape === 'square') {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const c of cells) {
        if (c.x < minX) minX = c.x;
        if (c.x > maxX) maxX = c.x;
        if (c.y < minY) minY = c.y;
        if (c.y > maxY) maxY = c.y;
      }
      const gridW = (maxX - minX + 1);
      const gridH = (maxY - minY + 1);
      const availW = this.canvas.width - padding * 2;
      const availH = this.canvas.height - padding * 2;
      this.cellSize = Math.floor(Math.min(availW / gridW, availH / gridH, 50));
      this.cellSize = Math.max(this.cellSize, 20);
      const totalW = gridW * this.cellSize;
      const totalH = gridH * this.cellSize;
      this.offsetX = (this.canvas.width - totalW) / 2;
      this.offsetY = (this.canvas.height - totalH) / 2;
      this.minX = minX;
      this.minY = minY;
    } else {
      const sqrt3 = Math.sqrt(3);
      let minPx = Infinity, maxPx = -Infinity, minPy = Infinity, maxPy = -Infinity;
      for (const c of cells) {
        const px = this.cellSize * (sqrt3 * c.q + sqrt3 / 2 * c.r);
        const py = this.cellSize * (1.5 * c.r);
        if (px < minPx) minPx = px;
        if (px > maxPx) maxPx = px;
        if (py < minPy) minPy = py;
        if (py > maxPy) maxPy = py;
      }
      const hexW = maxPx - minPx + this.cellSize * sqrt3;
      const hexH = maxPy - minPy + this.cellSize * 1.5;
      const availW = this.canvas.width - padding * 2;
      const availH = this.canvas.height - padding * 2;
      const scaleW = availW / hexW;
      const scaleH = availH / hexH;
      const scale = Math.min(scaleW, scaleH, 1);
      this.cellSize = Math.max(20, Math.floor(this.cellSize * scale));

      let tMinPx = Infinity, tMaxPx = -Infinity, tMinPy = Infinity, tMaxPy = -Infinity;
      for (const c of cells) {
        const px = this.cellSize * (sqrt3 * c.q + sqrt3 / 2 * c.r);
        const py = this.cellSize * (1.5 * c.r);
        if (px < tMinPx) tMinPx = px;
        if (px > tMaxPx) tMaxPx = px;
        if (py < tMinPy) tMinPy = py;
        if (py > tMaxPy) tMaxPy = py;
      }
      const tW = tMaxPx - tMinPx + this.cellSize * sqrt3;
      const tH = tMaxPy - tMinPy + this.cellSize * 1.5;
      this.offsetX = (this.canvas.width - tW) / 2 - tMinPx;
      this.offsetY = (this.canvas.height - tH) / 2 - tMinPy;
      this.hexSize = this.cellSize / 2;
    }
  }

  render(state) {
    const ctx = this.ctx;
    const { level } = this;
    if (!level) return;

    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    const blockSet = new Set(state.blocks.map(b => this._posKey(b)));
    const playerKey = this._posKey(state.player);
    const destSet = new Set(level.destinations.map(d => this._posKey(d)));

    for (const cell of level.cells) {
      const key = this._posKey(cell);
      const isBlock = blockSet.has(key);
      const isDest = destSet.has(key);
      const isPlayer = key === playerKey;

      if (level.shape === 'square') {
        this._drawSquareCell(cell, isPlayer, isBlock, isDest);
      } else {
        this._drawHexCell(cell, isPlayer, isBlock, isDest);
      }
    }
  }

  _posKey(pos) {
    if (pos.x !== undefined) return `${pos.x},${pos.y}`;
    return `${pos.q},${pos.r}`;
  }

  _drawSquareCell(cell, isPlayer, isBlock, isDest) {
    const ctx = this.ctx;
    const s = this.cellSize;
    const x = this.offsetX + (cell.x - this.minX) * s;
    const y = this.offsetY + (cell.y - this.minY) * s;
    const pad = 1;

    if (isBlock && isDest) {
      ctx.fillStyle = '#8B4513';
      ctx.fillRect(x + pad, y + pad, s - pad * 2, s - pad * 2);
      ctx.fillStyle = '#FFD700';
      ctx.beginPath();
      ctx.arc(x + s / 2, y + s / 2, s / 4, 0, Math.PI * 2);
      ctx.stroke();
    } else if (isBlock) {
      ctx.fillStyle = '#8B4513';
      ctx.fillRect(x + pad, y + pad, s - pad * 2, s - pad * 2);
      ctx.fillStyle = '#A0522D';
      ctx.fillRect(x + pad + 2, y + pad + 2, s - pad * 2 - 4, s - pad * 2 - 4);
    } else if (isPlayer) {
      ctx.fillStyle = '#444';
      ctx.fillRect(x + pad, y + pad, s - pad * 2, s - pad * 2);
      ctx.fillStyle = '#4FC3F7';
      ctx.beginPath();
      ctx.arc(x + s / 2, y + s / 2, s / 3, 0, Math.PI * 2);
      ctx.fill();
    } else if (isDest) {
      ctx.fillStyle = '#333';
      ctx.fillRect(x + pad, y + pad, s - pad * 2, s - pad * 2);
      ctx.strokeStyle = '#FFD700';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x + s / 2, y + s / 2, s / 4, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.fillStyle = '#3a3a3a';
      ctx.fillRect(x + pad, y + pad, s - pad * 2, s - pad * 2);
    }
  }

  _drawHexCell(cell, isPlayer, isBlock, isDest) {
    const ctx = this.ctx;
    const size = this.hexSize;
    const sqrt3 = Math.sqrt(3);
    const cx = this.offsetX + this.cellSize * (sqrt3 * cell.q + sqrt3 / 2 * cell.r);
    const cy = this.offsetY + this.cellSize * (1.5 * cell.r);

    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const angle = Math.PI / 6 + i * Math.PI / 3;
      const px = cx + size * Math.cos(angle);
      const py = cy + size * Math.sin(angle);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();

    if (isBlock && isDest) {
      ctx.fillStyle = '#8B4513';
      ctx.fill();
      ctx.strokeStyle = '#FFD700';
      ctx.lineWidth = 2;
      ctx.stroke();
    } else if (isBlock) {
      ctx.fillStyle = '#8B4513';
      ctx.fill();
      ctx.fillStyle = '#A0522D';
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const angle = Math.PI / 6 + i * Math.PI / 3;
        const px = cx + size * 0.7 * Math.cos(angle);
        const py = cy + size * 0.7 * Math.sin(angle);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
    } else if (isPlayer) {
      ctx.fillStyle = '#333';
      ctx.fill();
      ctx.fillStyle = '#4FC3F7';
      ctx.beginPath();
      ctx.arc(cx, cy, size * 0.4, 0, Math.PI * 2);
      ctx.fill();
    } else if (isDest) {
      ctx.fillStyle = '#2a2a2a';
      ctx.fill();
      ctx.strokeStyle = '#FFD700';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, size * 0.25, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.fillStyle = '#3a3a3a';
      ctx.fill();
    }
  }

  pixelToCell(px, py) {
    if (!this.level) return null;
    const { shape } = this.level;

    if (shape === 'square') {
      const cx = Math.floor((px - this.offsetX) / this.cellSize) + this.minX;
      const cy = Math.floor((py - this.offsetY) / this.cellSize) + this.minY;
      const key = `${cx},${cy}`;
      if (this.level.cellSet.has(key)) return { x: cx, y: cy };
      return null;
    }

    const sqrt3 = Math.sqrt(3);
    const r = (py - this.offsetY) / (this.cellSize * 1.5);
    const q = ((px - this.offsetX) / (this.cellSize * sqrt3)) - r / 2;

    const qr = Math.round(q);
    const rr = Math.round(r);
    const sr = Math.round(-q - r);

    const qd = Math.abs(qr - q);
    const rd = Math.abs(rr - r);
    const sd = Math.abs(sr - (-q - r));

    let fq = qr, fr = rr;
    if (qd > rd && qd > sd) {
      fq = -rr - sr;
    } else if (rd > sd) {
      fr = -qr - sr;
    }
    const key = `${fq},${fr}`;
    if (this.level.cellSet.has(key)) return { q: fq, r: fr };
    return null;
  }

  onClick(handler) {
    this.clickHandler = handler;
    this.canvas.addEventListener('click', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const cell = this.pixelToCell(px, py);
      if (cell && this.clickHandler) {
        this.clickHandler(cell);
      }
    });
  }

  _setupTouch() {
    this.canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const t = e.touches[0];
      this.touchStart = { x: t.clientX, y: t.clientY, time: Date.now() };
    }, { passive: false });

    this.canvas.addEventListener('touchend', (e) => {
      e.preventDefault();
      if (!this.touchStart || !this.swipeHandler) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - this.touchStart.x;
      const dy = t.clientY - this.touchStart.y;
      const dt = Date.now() - this.touchStart.time;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > 20 && dt < 500) {
        const absDx = Math.abs(dx);
        const absDy = Math.abs(dy);
        let dir;

        if (this.level && this.level.shape === 'hexagon') {
          const angle = Math.atan2(dy, dx);
          const snap = Math.round(angle / (Math.PI / 3)) % 6;
          const hexDirs = [
            { dq: 1, dr: 0 },
            { dq: 0, dr: 1 },
            { dq: -1, dr: 1 },
            { dq: -1, dr: 0 },
            { dq: 0, dr: -1 },
            { dq: 1, dr: -1 },
          ];
          dir = hexDirs[(snap + 6) % 6];
        } else {
          if (absDx > absDy) {
            dir = { dx: dx > 0 ? 1 : -1, dy: 0 };
          } else {
            dir = { dx: 0, dy: dy > 0 ? 1 : -1 };
          }
        }

        this.swipeHandler(dir);
      }
      this.touchStart = null;
    }, { passive: false });
  }

  onSwipe(handler) {
    this.swipeHandler = handler;
  }
}
