export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cellSize = 40;
    this.offsetX = 0;
    this.offsetY = 0;
    this.level = null;
    this.swipeHandler = null;
    this.clickHandler = null;
    this.dpr = window.devicePixelRatio || 1;

    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;

    this._lastPinchDist = null;
    this._lastPinchCenter = null;
    this._isPanning = false;
    this._panStartX = 0;
    this._panStartY = 0;
    this._panStartPanX = 0;
    this._panStartPanY = 0;
    this._didPan = false;
    this._didPinch = false;

    this._setupEvents();
  }

  resetView() {
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
  }

  setLevel(level) {
    this.level = level;
    this.resetView();
    this._computeLayout();
  }

  _computeLayout() {
    if (!this.level) return;

    const { shape, cells } = this.level;
    const padding = 40;
    const cssWidth = this.canvas.width / this.dpr;
    const cssHeight = this.canvas.height / this.dpr;

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
      const availW = cssWidth - padding * 2;
      const availH = cssHeight - padding * 2;
      this.cellSize = Math.floor(Math.min(availW / gridW, availH / gridH, 50));
      this.cellSize = Math.max(this.cellSize, 20);
      const totalW = gridW * this.cellSize;
      const totalH = gridH * this.cellSize;
      this.offsetX = (cssWidth - totalW) / 2;
      this.offsetY = (cssHeight - totalH) / 2;
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
      const hexH = maxPy - minPy + this.cellSize * 2;
      const availW = cssWidth - padding * 2;
      const availH = cssHeight - padding * 2;
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
      const tH = tMaxPy - tMinPy + this.cellSize * 2;
      this.offsetX = (cssWidth - tW) / 2 - tMinPx;
      this.offsetY = (cssHeight - tH) / 2 - tMinPy;
      this.hexSize = this.cellSize - 1 / Math.sqrt(3);
    }
  }

  render(state) {
    const ctx = this.ctx;
    const { level } = this;
    if (!level) return;

    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    ctx.save();
    ctx.scale(this.dpr, this.dpr);
    ctx.translate(this.panX, this.panY);
    ctx.scale(this.zoom, this.zoom);

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

    ctx.restore();
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
    const pad = 2;

    if (isBlock && isDest) {
      ctx.fillStyle = '#8B4513';
      ctx.fillRect(x + pad, y + pad, s - pad * 2, s - pad * 2);
      ctx.strokeStyle = '#FFD700';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x + pad, y + pad, s - pad * 2, s - pad * 2);
      ctx.fillStyle = '#FFD700';
      ctx.beginPath();
      ctx.arc(x + s / 2, y + s / 2, s / 4, 0, Math.PI * 2);
      ctx.stroke();
    } else if (isBlock) {
      ctx.fillStyle = '#8B4513';
      ctx.fillRect(x + pad, y + pad, s - pad * 2, s - pad * 2);
      ctx.strokeStyle = '#6B3410';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(x + pad, y + pad, s - pad * 2, s - pad * 2);
      ctx.fillStyle = '#A0522D';
      ctx.fillRect(x + pad + 2, y + pad + 2, s - pad * 2 - 4, s - pad * 2 - 4);
    } else if (isPlayer) {
      ctx.fillStyle = '#2a2a2a';
      ctx.fillRect(x + pad, y + pad, s - pad * 2, s - pad * 2);
      ctx.strokeStyle = '#1a1a1a';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(x + pad, y + pad, s - pad * 2, s - pad * 2);
      ctx.fillStyle = '#4FC3F7';
      ctx.beginPath();
      ctx.arc(x + s / 2, y + s / 2, s / 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#29B6F6';
      ctx.lineWidth = 1;
      ctx.stroke();
    } else if (isDest) {
      ctx.fillStyle = '#222';
      ctx.fillRect(x + pad, y + pad, s - pad * 2, s - pad * 2);
      ctx.strokeStyle = '#FFD700';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x + pad, y + pad, s - pad * 2, s - pad * 2);
      ctx.beginPath();
      ctx.arc(x + s / 2, y + s / 2, s / 4, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.fillStyle = '#333';
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
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else if (isBlock) {
      ctx.fillStyle = '#8B4513';
      ctx.fill();
      ctx.strokeStyle = '#6B3410';
      ctx.lineWidth = 0.5;
      ctx.stroke();
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
      ctx.fillStyle = '#2a2a2a';
      ctx.fill();
      ctx.strokeStyle = '#1a1a1a';
      ctx.lineWidth = 0.5;
      ctx.stroke();
      ctx.fillStyle = '#4FC3F7';
      ctx.beginPath();
      ctx.arc(cx, cy, size * 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#29B6F6';
      ctx.lineWidth = 1;
      ctx.stroke();
    } else if (isDest) {
      ctx.fillStyle = '#222';
      ctx.fill();
      ctx.strokeStyle = '#FFD700';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, size * 0.25, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.fillStyle = '#333';
      ctx.fill();
    }
  }

  _screenToCanvas(sx, sy) {
    return {
      x: (sx - this.panX) / this.zoom,
      y: (sy - this.panY) / this.zoom,
    };
  }

  pixelToCell(px, py) {
    if (!this.level) return null;
    const { shape } = this.level;
    const { x: lx, y: ly } = this._screenToCanvas(px, py);

    if (shape === 'square') {
      const cx = Math.floor((lx - this.offsetX) / this.cellSize) + this.minX;
      const cy = Math.floor((ly - this.offsetY) / this.cellSize) + this.minY;
      const key = `${cx},${cy}`;
      if (this.level.cellSet.has(key)) return { x: cx, y: cy };
      return null;
    }

    const sqrt3 = Math.sqrt(3);
    const r = (ly - this.offsetY) / (this.cellSize * 1.5);
    const q = ((lx - this.offsetX) / (this.cellSize * sqrt3)) - r / 2;

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

  _setupEvents() {
    this.canvas.addEventListener('click', (e) => {
      if (this._didPan || this._didPinch) return;
      const rect = this.canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const cell = this.pixelToCell(px, py);
      if (cell && this.clickHandler) {
        this.clickHandler(cell);
      }
    });

    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      this._zoomAt(mx, my, factor);
    }, { passive: false });

    this.canvas.addEventListener('mousedown', (e) => {
      this._isPanning = true;
      this._didPan = false;
      this._panStartX = e.clientX;
      this._panStartY = e.clientY;
      this._panStartPanX = this.panX;
      this._panStartPanY = this.panY;
    });

    window.addEventListener('mousemove', (e) => {
      if (!this._isPanning) return;
      const dx = e.clientX - this._panStartX;
      const dy = e.clientY - this._panStartY;
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10) this._didPan = true;
      this.panX = this._panStartPanX + dx;
      this.panY = this._panStartPanY + dy;
      this._requestRender();
    });

    window.addEventListener('mouseup', () => {
      this._isPanning = false;
    });

    this.canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (e.touches.length === 2) {
        this._didPinch = true;
        const [t1, t2] = [e.touches[0], e.touches[1]];
        this._lastPinchDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        this._lastPinchCenter = {
          x: (t1.clientX + t2.clientX) / 2,
          y: (t1.clientY + t2.clientY) / 2,
        };
      } else if (e.touches.length === 1) {
        const t = e.touches[0];
        this._isPanning = true;
        this._didPan = false;
        this._panStartX = t.clientX;
        this._panStartY = t.clientY;
        this._panStartPanX = this.panX;
        this._panStartPanY = this.panY;
        this._touchStartTime = Date.now();
      }
    }, { passive: false });

    this.canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      if (e.touches.length === 2) {
        const [t1, t2] = [e.touches[0], e.touches[1]];
        const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        const center = {
          x: (t1.clientX + t2.clientX) / 2,
          y: (t1.clientY + t2.clientY) / 2,
        };
        const rect = this.canvas.getBoundingClientRect();
        const mx = center.x - rect.left;
        const my = center.y - rect.top;

        if (this._lastPinchDist) {
          const factor = dist / this._lastPinchDist;
          const newZoom = Math.max(0.3, Math.min(5, this.zoom * factor));
          const ratio = newZoom / this.zoom;
          this.panX = mx - (mx - this.panX) * ratio;
          this.panY = my - (my - this.panY) * ratio;
          this.zoom = newZoom;
        }

        if (this._lastPinchCenter) {
          this.panX += center.x - this._lastPinchCenter.x;
          this.panY += center.y - this._lastPinchCenter.y;
        }

        this._lastPinchDist = dist;
        this._lastPinchCenter = center;
        this._requestRender();
      } else if (e.touches.length === 1 && this._isPanning) {
        const t = e.touches[0];
        const dx = t.clientX - this._panStartX;
        const dy = t.clientY - this._panStartY;
        if (Math.abs(dx) > 10 || Math.abs(dy) > 10) this._didPan = true;
        this.panX = this._panStartPanX + dx;
        this.panY = this._panStartPanY + dy;
        this._requestRender();
      }
    }, { passive: false });

    this.canvas.addEventListener('touchend', (e) => {
      e.preventDefault();
      if (e.touches.length < 2) {
        this._lastPinchDist = null;
        this._lastPinchCenter = null;
      }
      if (e.touches.length === 0) {
        if (!this._didPan && !this._didPinch && this.clickHandler) {
          const dt = Date.now() - (this._touchStartTime || 0);
          if (dt < 300) {
            const rect = this.canvas.getBoundingClientRect();
            const px = this._panStartX - rect.left;
            const py = this._panStartY - rect.top;
            const cell = this.pixelToCell(px, py);
            if (cell && this.clickHandler) {
              this.clickHandler(cell);
            }
          }
        }
        this._isPanning = false;
        this._didPan = false;
        this._didPinch = false;
      }
    }, { passive: false });
  }

  _zoomAt(mx, my, factor) {
    const newZoom = Math.max(0.3, Math.min(5, this.zoom * factor));
    const ratio = newZoom / this.zoom;
    this.panX = mx - (mx - this.panX) * ratio;
    this.panY = my - (my - this.panY) * ratio;
    this.zoom = newZoom;
    this._requestRender();
  }

  _renderRAF = null;
  _requestRender() {
    if (this._renderRAF) return;
    this._renderRAF = requestAnimationFrame(() => {
      this._renderRAF = null;
      if (this._onRenderRequest) this._onRenderRequest();
    });
  }

  onRenderRequest(handler) {
    this._onRenderRequest = handler;
  }

  onSwipe(handler) {
    this.swipeHandler = handler;
  }

  onClick(handler) {
    this.clickHandler = handler;
  }
}
