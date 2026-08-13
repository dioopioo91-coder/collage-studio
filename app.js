function isMobileUI() {
  return window.innerWidth <= 768 || (window.innerHeight <= 550 && window.innerWidth <= 1100);
}
function isMobileLandscape() {
  return isMobileUI() && window.innerWidth > window.innerHeight;
}

/* Collage Studio — Application Logic */
'use strict';

const $ = (s, p) => (p || document).querySelector(s);
const $$ = (s, p) => [...(p || document).querySelectorAll(s)];

/* ---- DB (FAIL-SAFE FOR WEBVIEWS & PRIVATE BROWSING) ---- */
const DB_NAME = 'CollageStudioDB_v4';
const DB_VER  = 1;
const STORE   = 'assets';
let db = null;

function openDB() {
  return new Promise(resolve => {
    try {
      if (!window.indexedDB) { resolve(null); return; }
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => {
        try { req.result.createObjectStore(STORE, { keyPath: 'id' }); } catch(e) {}
      };
      req.onsuccess = () => { db = req.result; resolve(db); };
      req.onerror = () => { console.warn('IndexedDB blocked'); resolve(null); };
    } catch(e) {
      console.warn('IndexedDB exception:', e);
      resolve(null);
    }
  });
}

function dbPut(item) {
  return new Promise(y => {
    if (!db) return y();
    try {
      const t = db.transaction(STORE, 'readwrite').objectStore(STORE).put(item);
      t.onsuccess = () => y();
      t.onerror = () => y();
    } catch(e) { y(); }
  });
}

function dbDel(id) {
  return new Promise(y => {
    if (!db) return y();
    try {
      const t = db.transaction(STORE, 'readwrite').objectStore(STORE).delete(id);
      t.onsuccess = () => y();
      t.onerror = () => y();
    } catch(e) { y(); }
  });
}

function dbClear() {
  return new Promise(y => {
    if (!db) return y();
    try {
      const t = db.transaction(STORE, 'readwrite').objectStore(STORE).clear();
      t.onsuccess = () => y();
      t.onerror = () => y();
    } catch(e) { y(); }
  });
}

function dbGetAll() {
  return new Promise(y => {
    if (!db) return y([]);
    try {
      const t = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
      t.onsuccess = () => y(t.result || []);
      t.onerror = () => y([]);
    } catch(e) { y([]); }
  });
}

/* STATE  */
let library       = [];  // {id, blob, thumbUrl, natW, natH}
let canvasCells   = [];  // {assetId, adj, fx, fy, fw, fh} — fractional 0..1
let selectedIdx   = -1;
let isSingleEditorMode = false;
let singleCell    = null;
let frameColor    = '#ffffff';
let strokeWidth   = 3;
let tagEnabled    = true;
let strokeEnabled = true;

const defaultAdj = () => ({
  brightness: 100,
  contrast: 100,
  r: 100,
  g: 100,
  b: 100,
  lines: {
    enabled: false,
    mode: 'full',      // 'full' | 'region'
    angle: 0,
    spacing: 30,
    size: 2,
    opacity: 80,
    color: '#ffff00',  // yellow
    box: { x: 10, y: 10, w: 80, h: 80 }
  },
  noise: {
    enabled: false,
    mode: 'full',      // 'full' | 'region'
    amount: 30,
    box: { x: 10, y: 10, w: 80, h: 80 }
  }
});

/* COLOR & EFFECT HELPERS  */
function getContrastColor(hex) {
  const r = parseInt(hex.slice(1,3), 16);
  const g = parseInt(hex.slice(3,5), 16);
  const b = parseInt(hex.slice(5,7), 16);
  return `rgb(${255-r},${255-g},${255-b})`;
}

function getImageDims(url) {
  return new Promise(resolve => {
    let done = false;
    const img = new Image();
    const timer = setTimeout(() => {
      if (!done) { done = true; resolve({ w: 800, h: 600 }); }
    }, 1500);
    img.onload = () => {
      if (!done) {
        done = true; clearTimeout(timer);
        resolve({ w: img.naturalWidth || 800, h: img.naturalHeight || 600 });
      }
    };
    img.onerror = () => {
      if (!done) { done = true; clearTimeout(timer); resolve({ w: 800, h: 600 }); }
    };
    img.src = url;
  });
}

function generateNoiseDataUrl(amount) {
  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const imgData = ctx.createImageData(128, 128);
  const data = imgData.data;
  // 100% amount => alpha 255 => image completely hidden by static noise
  const alpha = Math.round((amount / 100) * 255);
  for (let i = 0; i < data.length; i += 4) {
    const v = Math.random() * 255;
    data[i] = v; data[i+1] = v; data[i+2] = v;
    data[i+3] = alpha;
  }
  ctx.putImageData(imgData, 0, 0);
  return canvas.toDataURL();
}

function drawLinesOnCanvas(canvas, linesObj, width, height) {
  const w = Math.max(10, Math.round(width));
  const h = Math.max(10, Math.round(height));
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.scale(dpr, dpr);

  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();

  ctx.strokeStyle = linesObj.color || '#ffff00';
  ctx.lineWidth = Math.max(1, linesObj.size || 2);
  ctx.globalAlpha = (linesObj.opacity !== undefined ? linesObj.opacity : 80) / 100;

  const angleRad = ((linesObj.angle || 0) * Math.PI) / 180;
  const step = Math.max(2, linesObj.spacing || 30);
  const diag = Math.sqrt(w * w + h * h) * 2;

  ctx.translate(w / 2, h / 2);
  ctx.rotate(angleRad);

  for (let offset = -diag; offset < diag; offset += step) {
    ctx.beginPath();
    ctx.moveTo(-diag, offset);
    ctx.lineTo(diag, offset);
    ctx.stroke();
  }
  ctx.restore();
}

/* DOM  */
const viewport    = $('#canvas-viewport');
const frame       = $('#collage-wrapper');
const collage     = $('#collage');
const emptyState  = $('#empty-state');
const libGrid     = $('#library-grid');
const libEmpty    = $('#library-empty');
const libCount    = $('#lib-count');
const canvasInfo  = $('#canvas-info');
const fileInput   = $('#file-input');
const adjPanel    = $('#adjustments-panel');
const exportModal = $('#export-modal');
const exportProg  = $('#export-progress');
const exportStatus= $('#export-status');

const sGap     = $('#collage-gap');
const nGap     = $('#gap-num');
const sRadius  = $('#border-radius');
const nRadius  = $('#radius-num');
const sTagSize = $('#tag-size');
const nTagSize = $('#tag-size-num');
const sRatio   = $('#aspect-ratio');

const sFrameColor  = $('#frame-color');
const vFrameColor  = $('#frame-color-val');
const sFrameStroke = $('#frame-stroke');
const nFrameStroke = $('#frame-stroke-num');

const adjSliders = {
  brightness: { el: $('#adj-brightness'), num: $('#adj-brightness-num') },
  contrast:   { el: $('#adj-contrast'),   num: $('#adj-contrast-num') },
  r:          { el: $('#adj-r'),          num: $('#adj-r-num') },
  g:          { el: $('#adj-g'),          num: $('#adj-g-num') },
  b:          { el: $('#adj-b'),          num: $('#adj-b-num') },
};

let gap     = 10;
let radius  = 10;
let tagSize = 18;

function getRatio() {
  const v = sRatio.value.split(':').map(Number);
  return v[0] / v[1];
}

/* SMART JUSTIFIED & ADAPTIVE BENTO LAYOUT ENGINE  */
function redistributeLayout() {
  const n = canvasCells.length;
  if (n === 0) return;

  const fw = frame.offsetWidth || 1000;
  const fh = frame.offsetHeight || 800;
  const canvasRatio = fw / fh;
  const tagH = tagEnabled ? Math.round(tagSize * 1.6 + 6) : 0;

  // Gather individual asset aspect ratios (ir = width / height)
  const itemsIr = canvasCells.map(c => {
    const asset = library.find(a => a.id === c.assetId);
    return asset ? (asset.natW / asset.natH) : 1;
  });

  // Candidate row partition generator
  function getPartitions(count) {
    if (count === 1) return [[1]];
    if (count === 2) return (canvasRatio >= 0.9) ? [[2], [1, 1]] : [[1, 1], [2]];
    if (count === 3) return [[3], [2, 1], [1, 2], [1, 1, 1]];
    if (count === 4) return [[2, 2], [3, 1], [1, 3], [4], [2, 1, 1], [1, 2, 1], [1, 1, 2]];
    if (count === 5) return [[3, 2], [2, 3], [2, 2, 1], [1, 2, 2], [2, 1, 2], [1, 3, 1]];
    if (count === 6) return [[3, 3], [2, 2, 2], [2, 4], [4, 2], [2, 3, 1], [1, 3, 2], [1, 2, 3], [3, 2, 1]];
    if (count === 7) return [[4, 3], [3, 4], [3, 2, 2], [2, 3, 2], [2, 2, 3]];
    if (count === 8) return [[4, 4], [3, 3, 2], [3, 2, 3], [2, 3, 3], [2, 4, 2]];
    
    // For n >= 9
    const cols = (canvasRatio < 1.0) ? 2 : (canvasRatio < 1.5 ? 3 : 4);
    const rowsCnt = Math.ceil(count / cols);
    const base = new Array(rowsCnt - 1).fill(cols);
    const rem = count - (cols * (rowsCnt - 1));
    base.push(rem);
    return [base];
  }

  let bestScore = -Infinity;
  let bestBoxes = null;

  const partitions = getPartitions(n);

  for (const partition of partitions) {
    const rowsData = [];
    let idx = 0;
    let valid = true;

    for (const count of partition) {
      const rowIrs = itemsIr.slice(idx, idx + count);
      const sumIr = rowIrs.reduce((a, b) => a + b, 0);
      const availW = fw - (count + 1) * gap;
      if (availW <= 0 || sumIr <= 0) { valid = false; break; }

      const imgH = availW / sumIr;
      const rowH = tagH + imgH;
      const itemWs = rowIrs.map(ir => imgH * ir);

      rowsData.push({
        count,
        irs: rowIrs,
        indices: Array.from({ length: count }, (_, k) => idx + k),
        rowH,
        imgH,
        itemWs
      });
      idx += count;
    }

    if (!valid) continue;

    const numRows = rowsData.length;
    const availH = fh - (numRows + 1) * gap;
    const sumRowsH = rowsData.reduce((sum, r) => sum + r.rowH, 0);
    const scale = (sumRowsH > 0 && availH > 0) ? Math.min(1.0, availH / sumRowsH) : 1.0;

    const scaledTotalH = rowsData.reduce((sum, r) => sum + r.rowH * scale, 0) + (numRows + 1) * gap;
    const startY = (fh - scaledTotalH) / 2 + gap;
    let curY = startY;
    let totalArea = 0;
    const candidateBoxes = new Array(n);

    for (const r of rowsData) {
      const ws = r.itemWs.map(w => w * scale);
      const rowWScaled = ws.reduce((a, b) => a + b, 0) + (r.count - 1) * gap;
      const startX = (fw - rowWScaled) / 2;
      let curX = startX;
      const cardH = r.rowH * scale;

      for (let j = 0; j < r.count; j++) {
        const itemIdx = r.indices[j];
        const bw = ws[j];
        const bh = cardH;
        candidateBoxes[itemIdx] = {
          fx: clamp(curX / fw, 0, 1),
          fy: clamp(curY / fh, 0, 1),
          fw: clamp(bw / fw, 0.02, 1),
          fh: clamp(bh / fh, 0.02, 1)
        };
        totalArea += bw * bh;
        curX += bw + gap;
      }
      curY += cardH + gap;
    }

    const utilization = totalArea / (fw * fh);
    const rowHeights = rowsData.map(r => r.rowH * scale);
    const avgH = rowHeights.reduce((a, b) => a + b, 0) / rowHeights.length;
    const varH = rowHeights.reduce((sum, h) => sum + Math.pow(h - avgH, 2), 0) / rowHeights.length;
    const stdH = Math.sqrt(varH);

    // Score combines max area fill and row height harmony
    const score = (utilization * 100) - (stdH / (avgH || 1)) * 12;

    if (score > bestScore) {
      bestScore = score;
      bestBoxes = candidateBoxes;
    }
  }

  // Assign best layout to canvasCells
  if (bestBoxes) {
    for (let i = 0; i < n; i++) {
      if (bestBoxes[i]) {
        canvasCells[i].fx = bestBoxes[i].fx;
        canvasCells[i].fy = bestBoxes[i].fy;
        canvasCells[i].fw = bestBoxes[i].fw;
        canvasCells[i].fh = bestBoxes[i].fh;
      }
    }
  }
}

/* CANVAS FRAME SIZING */
function updateFrameSize() {
  const vp = viewport.getBoundingClientRect();
  const isMobile = isMobileUI();
  const isLand = isMobileLandscape();
  const ratio = getRatio();
  let w, h;

  if (isMobile) {
    // Generous high-resolution virtual canvas for mobile (1800px long edge).
    const maxDim = 1800;
    if (ratio <= 1.0) {
      h = maxDim;
      w = Math.round(h * ratio);
    } else {
      w = maxDim;
      h = Math.round(w / ratio);
    }
  } else {
    const availW = Math.max(300, vp.width - 80);
    const availH = Math.max(200, vp.height - 80);
    if (availW / availH > ratio) {
      h = availH;
      w = Math.round(h * ratio);
    } else {
      w = availW;
      h = Math.round(w / ratio);
    }
  }

  frame.style.width = Math.round(w) + 'px';
  frame.style.height = Math.round(h) + 'px';

  // Auto zoom/pan on mobile to fit the large virtual frame seamlessly into screen
  if (isMobile) {
    const padH = isLand ? 10 : 12;
    const padV = isLand ? 8 : 12;
    const availW = Math.max(100, vp.width - padH * 2);
    const availH = Math.max(100, vp.height - padV * 2);
    const fitWScale = availW / w;
    const fitHScale = availH / h;
    zoomScale = Math.round(Math.min(fitWScale, fitHScale) * 1000) / 1000;
    zoomPanX = 0;
    zoomPanY = 0;
    updateZoomTransform();
  }
}

/* SVG FILTERS  */
function buildSVGFilter(cell, idx) {
  const adj = cell.adj;
  const filterId = 'imgf-' + idx;
  const defs = document.querySelector('#svg-filters defs');
  let existing = document.getElementById(filterId);
  if (existing) existing.remove();
  const hasCustom = adj.brightness!==100||adj.contrast!==100||adj.r!==100||adj.g!==100||adj.b!==100;
  if (!hasCustom) return '';
  const b=adj.brightness/100, c=adj.contrast/100, rM=adj.r/100, gM=adj.g/100, bM=adj.b/100;
  const cOff = (1-c)*0.5;
  const filter = document.createElementNS('http://www.w3.org/2000/svg','filter');
  filter.id = filterId;
  filter.innerHTML = `<feColorMatrix type="matrix" values="${(rM*c*b).toFixed(3)} 0 0 0 ${cOff.toFixed(3)} 0 ${(gM*c*b).toFixed(3)} 0 0 ${cOff.toFixed(3)} 0 0 ${(bM*c*b).toFixed(3)} 0 ${cOff.toFixed(3)} 0 0 0 1 0"/>`;
  defs.appendChild(filter);
  return `url(#${filterId})`;
}

/* RENDER COLLAGE  */
function renderCollage() {
  const n = canvasCells.length;
  emptyState.style.display = n === 0 ? 'flex' : 'none';
  collage.innerHTML = '';

  // If no card is selected, make sure inspector panel is hidden
  if (selectedIdx < 0 || selectedIdx >= n) {
    selectedIdx = -1;
    hideInspector();
  }

  if (n === 0) { canvasInfo.textContent = '0 images'; return; }
  canvasInfo.textContent = n + ' image' + (n>1?'s':'');

  const fw = frame.offsetWidth;
  const fh = frame.offsetHeight;
  const contrastColor = getContrastColor(frameColor);
  const tagH = tagEnabled ? Math.round(tagSize * 1.6 + 6) : 0;
  const activeStrokeWidth = strokeEnabled ? strokeWidth : 0;

  for (let i = 0; i < n; i++) {
    const cell = canvasCells[i];
    if (!cell.adj.lines) cell.adj.lines = defaultAdj().lines;
    if (!cell.adj.noise) cell.adj.noise = defaultAdj().noise;

    const asset = library.find(a => a.id === cell.assetId);
    if (!asset) continue;

    const natW = asset.natW || 1, natH = asset.natH || 1;
    const ir = natW / natH;

    const px = Math.round(cell.fx * fw);
    const py = Math.round(cell.fy * fh);
    const pw = Math.round(cell.fw * fw);
    const ph = Math.round(cell.fh * fh);

    // Adapt tag font size proportionally so it fits gracefully within card width without clipping
    const maxTagFont = Math.min(tagSize, Math.floor(pw / 7.5));
    const activeTagSize = Math.max(7, maxTagFont);
    const cellTagH = tagEnabled ? Math.round(activeTagSize * 1.5 + 4) : 0;
    const imgH = Math.max(10, ph - cellTagH);

    // Outer Cell container
    const div = document.createElement('div');
    div.className = 'cell' + (i === selectedIdx ? ' selected' : '');
    div.style.left = px + 'px';
    div.style.top = py + 'px';
    div.style.width = pw + 'px';
    div.style.height = ph + 'px';
    div.dataset.idx = i;

    // Inner Cell frame
    const inner = document.createElement('div');
    inner.className = 'cell-inner';
    inner.style.border = activeStrokeWidth > 0 ? (activeStrokeWidth + 'px solid ' + frameColor) : 'none';
    inner.style.borderRadius = radius + 'px';

    // Tag (Header Bar)
    if (tagEnabled) {
      const tag = document.createElement('div');
      tag.className = 'cell-tag';
      tag.textContent = '@IMAGE' + (i + 1);
      tag.style.fontSize = activeTagSize + 'px';
      tag.style.height = cellTagH + 'px';
      tag.style.lineHeight = cellTagH + 'px';
      tag.style.background = frameColor;
      tag.style.color = contrastColor;
      inner.appendChild(tag);
    }

    // Image & Overlay Wrapper
    const imgWrap = document.createElement('div');
    imgWrap.className = 'cell-img-wrapper';
    imgWrap.style.height = imgH + 'px';

    // Strict Container matching exact visible contain dimension of the image
    // Reuse the outer scope 'ir' variable directly!
    let cw = pw;
    let ch = imgH;
    let cl = 0;
    let ct = 0;
    const cellRatio = pw / imgH;
    if (ir > cellRatio) {
      cw = pw;
      ch = Math.round(pw / ir);
      ct = Math.round((imgH - ch) / 2);
    } else {
      ch = imgH;
      cw = Math.round(imgH * ir);
      cl = Math.round((pw - cw) / 2);
    }

    const imgContainer = document.createElement('div');
    imgContainer.className = 'cell-img-container';
    imgContainer.style.position = 'absolute';
    imgContainer.style.left = cl + 'px';
    imgContainer.style.top = ct + 'px';
    imgContainer.style.width = cw + 'px';
    imgContainer.style.height = ch + 'px';

    const img = document.createElement('img');
    img.className = 'cell-img';
    img.src = asset.thumbUrl;
    img.draggable = false;
    img.style.width = '100%';
    img.style.height = '100%';
    const filterVal = buildSVGFilter(cell, i);
    if (filterVal) img.style.filter = filterVal;
    imgContainer.appendChild(img);

    // Lines Overlay Canvas
    if (cell.adj.lines && cell.adj.lines.enabled) {
      const linesObj = cell.adj.lines;
      const lCanvas = document.createElement('canvas');
      lCanvas.className = 'cell-lines-overlay';
      lCanvas.style.position = 'absolute';
      lCanvas.style.pointerEvents = 'none';
      lCanvas.style.zIndex = '4';

      let boxW = cw, boxH = ch;
      if (linesObj.mode === 'region' && linesObj.box) {
        boxW = Math.round((linesObj.box.w / 100) * cw);
        boxH = Math.round((linesObj.box.h / 100) * ch);
        lCanvas.style.left = linesObj.box.x + '%';
        lCanvas.style.top = linesObj.box.y + '%';
        lCanvas.style.width = linesObj.box.w + '%';
        lCanvas.style.height = linesObj.box.h + '%';
      } else {
        lCanvas.style.left = '0'; lCanvas.style.top = '0';
        lCanvas.style.width = '100%'; lCanvas.style.height = '100%';
      }

      drawLinesOnCanvas(lCanvas, linesObj, boxW, boxH);
      imgContainer.appendChild(lCanvas);
    }

    // Noise Overlay
    if (cell.adj.noise && cell.adj.noise.enabled && cell.adj.noise.amount > 0) {
      const noiseObj = cell.adj.noise;
      const noiseDiv = document.createElement('div');
      noiseDiv.className = 'cell-noise-overlay';
      noiseDiv.style.backgroundImage = `url(${generateNoiseDataUrl(noiseObj.amount)})`;

      if (noiseObj.mode === 'region' && noiseObj.box) {
        noiseDiv.style.left = noiseObj.box.x + '%';
        noiseDiv.style.top = noiseObj.box.y + '%';
        noiseDiv.style.width = noiseObj.box.w + '%';
        noiseDiv.style.height = noiseObj.box.h + '%';
      } else {
        noiseDiv.style.left = '0'; noiseDiv.style.top = '0'; noiseDiv.style.width = '100%'; noiseDiv.style.height = '100%';
      }
      imgContainer.appendChild(noiseDiv);
    }
    
    imgWrap.appendChild(imgContainer);

    // Region Selection Box
    if (i === selectedIdx) {
      const isLinesRegion = (cell.adj.lines && cell.adj.lines.enabled && cell.adj.lines.mode === 'region');
      const isNoiseRegion = (cell.adj.noise && cell.adj.noise.enabled && cell.adj.noise.mode === 'region');

      const activeEffectKey = isLinesRegion ? 'lines' : (isNoiseRegion ? 'noise' : null);
      if (activeEffectKey) {
        const box = cell.adj[activeEffectKey].box || { x:10, y:10, w:80, h:80 };
        const rBox = document.createElement('div');
        rBox.className = 'region-box';
        rBox.style.left = box.x + '%';
        rBox.style.top = box.y + '%';
        rBox.style.width = box.w + '%';
        rBox.style.height = box.h + '%';
        rBox.dataset.effectKey = activeEffectKey;

        const corners = ['nw','ne','sw','se'];
        for (const c of corners) {
          const h = document.createElement('div');
          h.className = `region-box-handle rb-${c}`;
          h.dataset.rbHandle = c;
          h.dataset.effectKey = activeEffectKey;
          rBox.appendChild(h);
        }
        imgWrap.appendChild(rBox);
      }
    }

    inner.appendChild(imgWrap);
    div.appendChild(inner);

    // 4 Corner Handles
    const corners = ['nw', 'ne', 'sw', 'se'];
    for (const c of corners) {
      const hDiv = document.createElement('div');
      hDiv.className = `resize-handle handle-${c}`;
      hDiv.dataset.edge = c;
      div.appendChild(hDiv);
    }

    // Cell Controls (Delete button)
    const controls = document.createElement('div');
    controls.className = 'cell-controls';
    const btnDel = document.createElement('button');
    btnDel.className = 'cell-btn remove';
    btnDel.innerHTML = '✕';
    btnDel.title = 'Remove';
    btnDel.addEventListener('click', e => { e.stopPropagation(); removeCell(i); });
    controls.appendChild(btnDel);
    div.appendChild(controls);

    collage.appendChild(div);
  }
}

/* INTERACTION & PANNING SYSTEM  */
let panToolActive = false;
let isPanningCanvas = false;
let panStartX = 0, panStartY = 0;
let panInitialX = 0, panInitialY = 0;
let isSpacePressed = false;

window.addEventListener('keydown', e => {
  if (e.code === 'Space' && !e.repeat && document.activeElement.tagName !== 'INPUT') {
    isSpacePressed = true;
    viewport.style.cursor = 'grab';
  }
});
window.addEventListener('keyup', e => {
  if (e.code === 'Space') {
    isSpacePressed = false;
    viewport.style.cursor = panToolActive ? 'grab' : '';
  }
});

const interaction = {
  active: false,
  mode: null,       // 'move' | 'swap' | 'resize' | 'rb_move' | 'rb_resize'
  cellIdx: -1,
  startMouseX: 0, startMouseY: 0,
  startFx: 0, startFy: 0, startFw: 0, startFh: 0,
  resizeEdge: '',
  didDrag: false,
  swapTarget: -1,
  rbEffectKey: '', rbEdge: '',
  startBoxX: 0, startBoxY: 0, startBoxW: 0, startBoxH: 0,
  wrapW: 100, wrapH: 100
};

// Clicking empty canvas deselects and hides inspector panel!
viewport.addEventListener('pointerdown', e => {
  // Never intercept clicks on zoom & pan toolbar buttons!
  if (e.target.closest('.zoom-controls')) return;

  // Check for canvas panning trigger (Middle click = 1, Right click = 2, Space, Hand tool)
  if (panToolActive || isSpacePressed || e.button === 1 || e.button === 2) {
    isPanningCanvas = true;
    panStartX = e.clientX;
    panStartY = e.clientY;
    panInitialX = zoomPanX;
    panInitialY = zoomPanY;
    viewport.style.cursor = 'grabbing';
    viewport.setPointerCapture(e.pointerId);
    e.preventDefault();
    e.stopPropagation();
    return;
  }

  if (e.target === viewport || e.target === frame || e.target === collage || e.target === emptyState) {
    selectedIdx = -1;
    hideInspector();
    renderCollage();
  }
}, true);

viewport.addEventListener('contextmenu', e => {
  if (isPanningCanvas || panToolActive) e.preventDefault();
});

collage.addEventListener('pointerdown', e => {
  if (e.button !== 0 || isPanningCanvas || panToolActive || isSpacePressed) return;

  const rbHandle = e.target.closest('.region-box-handle');
  const rbBox    = e.target.closest('.region-box');

  if (rbBox && selectedIdx >= 0) {
    const effectKey = rbBox.dataset.effectKey || 'lines';
    const imgWrap = rbBox.closest('.cell-img-wrapper');
    const wrapRect = imgWrap.getBoundingClientRect();
    const boxState = canvasCells[selectedIdx].adj[effectKey].box || { x:10, y:10, w:80, h:80 };

    interaction.active = true;
    interaction.cellIdx = selectedIdx;
    interaction.mode = rbHandle ? 'rb_resize' : 'rb_move';
    interaction.rbEdge = rbHandle ? rbHandle.dataset.rbHandle : '';
    interaction.rbEffectKey = effectKey;
    interaction.startMouseX = e.clientX;
    interaction.startMouseY = e.clientY;
    interaction.startBoxX = boxState.x;
    interaction.startBoxY = boxState.y;
    interaction.startBoxW = boxState.w;
    interaction.startBoxH = boxState.h;
    interaction.wrapW = wrapRect.width || 100;
    interaction.wrapH = wrapRect.height || 100;

    collage.setPointerCapture(e.pointerId);
    e.preventDefault();
    return;
  }

  const handleEl = e.target.closest('.resize-handle');
  const tagEl    = e.target.closest('.cell-tag');
  const cellEl   = e.target.closest('.cell');

  if (!cellEl || e.target.closest('.cell-btn')) return;
  const idx = parseInt(cellEl.dataset.idx);
  const cell = canvasCells[idx];
  if (!cell) return;

  interaction.active = true;
  interaction.cellIdx = idx;
  interaction.startMouseX = e.clientX;
  interaction.startMouseY = e.clientY;
  interaction.startFx = cell.fx;
  interaction.startFy = cell.fy;
  interaction.startFw = cell.fw;
  interaction.startFh = cell.fh;
  interaction.didDrag = false;
  interaction.swapTarget = -1;

  if (handleEl) {
    interaction.mode = 'resize';
    interaction.resizeEdge = handleEl.dataset.edge;
  } else if (tagEl) {
    interaction.mode = 'move';
  } else {
    interaction.mode = 'swap';
  }

  cellEl.classList.add('active-drag');
  collage.setPointerCapture(e.pointerId);
  e.preventDefault();
});

viewport.addEventListener('pointermove', e => {
  if (isPanningCanvas) {
    const dx = e.clientX - panStartX;
    const dy = e.clientY - panStartY;
    zoomPanX = panInitialX + (dx / zoomScale);
    zoomPanY = panInitialY + (dy / zoomScale);
    updateZoomTransform();
    return;
  }
});

collage.addEventListener('pointermove', e => {
  if (isPanningCanvas || !interaction.active) return;
  const fw = frame.offsetWidth, fh = frame.offsetHeight;
  const dx = e.clientX - interaction.startMouseX;
  const dy = e.clientY - interaction.startMouseY;

  if (Math.abs(dx) > 3 || Math.abs(dy) > 3) interaction.didDrag = true;

  if (interaction.mode === 'rb_move' || interaction.mode === 'rb_resize') {
    const dxPct = (dx / interaction.wrapW) * 100;
    const dyPct = (dy / interaction.wrapH) * 100;
    const cell = canvasCells[interaction.cellIdx];

    const keysToUpdate = [];
    if (cell.adj.lines && cell.adj.lines.mode === 'region') keysToUpdate.push('lines');
    if (cell.adj.noise && cell.adj.noise.mode === 'region') keysToUpdate.push('noise');
    if (keysToUpdate.length === 0) keysToUpdate.push(interaction.rbEffectKey);

    for (const k of keysToUpdate) {
      const boxState = cell.adj[k].box || { x:10, y:10, w:80, h:80 };
      if (interaction.mode === 'rb_move') {
        boxState.x = clamp(interaction.startBoxX + dxPct, 0, 100 - boxState.w);
        boxState.y = clamp(interaction.startBoxY + dyPct, 0, 100 - boxState.h);
      } else if (interaction.mode === 'rb_resize') {
        const edge = interaction.rbEdge;
        if (edge === 'se') {
          boxState.w = clamp(interaction.startBoxW + dxPct, 10, 100 - boxState.x);
          boxState.h = clamp(interaction.startBoxH + dyPct, 10, 100 - boxState.y);
        } else if (edge === 'sw') {
          const newW = clamp(interaction.startBoxW - dxPct, 10, interaction.startBoxX + interaction.startBoxW);
          boxState.x = interaction.startBoxX + (interaction.startBoxW - newW);
          boxState.w = newW;
          boxState.h = clamp(interaction.startBoxH + dyPct, 10, 100 - boxState.y);
        } else if (edge === 'ne') {
          boxState.w = clamp(interaction.startBoxW + dxPct, 10, 100 - boxState.x);
          const newH = clamp(interaction.startBoxH - dyPct, 10, interaction.startBoxY + interaction.startBoxH);
          boxState.y = interaction.startBoxY + (interaction.startBoxH - newH);
          boxState.h = newH;
        } else if (edge === 'nw') {
          const newW = clamp(interaction.startBoxW - dxPct, 10, interaction.startBoxX + interaction.startBoxW);
          const newH = clamp(interaction.startBoxH - dyPct, 10, interaction.startBoxY + interaction.startBoxH);
          boxState.x = interaction.startBoxX + (interaction.startBoxW - newW);
          boxState.y = interaction.startBoxY + (interaction.startBoxH - newH);
          boxState.w = newW;
          boxState.h = newH;
        }
      }
    }
    renderCollage();
    return;
  }

  if (!interaction.didDrag) return;

  const cell = canvasCells[interaction.cellIdx];
  const asset = library.find(a => a.id === cell.assetId);
  const ir = asset ? (asset.natW / asset.natH) : 1;
  const tagH = tagEnabled ? Math.round(tagSize * 1.6 + 6) : 0;
  const dfx = dx / fw, dfy = dy / fh;

  if (interaction.mode === 'move') {
    cell.fx = clamp(interaction.startFx + dfx, 0, 1 - cell.fw);
    cell.fy = clamp(interaction.startFy + dfy, 0, 1 - cell.fh);
    renderCollage();

  } else if (interaction.mode === 'resize') {
    const edge = interaction.resizeEdge;
    const startPx = interaction.startFw * fw;
    let newPw = startPx;

    if (edge === 'se' || edge === 'ne') {
      newPw = Math.max(60, startPx + dx);
    } else if (edge === 'sw' || edge === 'nw') {
      newPw = Math.max(60, startPx - dx);
    }

    const newFw = newPw / fw;
    const newImgH = newPw / ir;
    const newPh = tagH + newImgH;
    const newFh = newPh / fh;

    if (edge === 'se') {
      cell.fw = Math.min(newFw, 1 - cell.fx);
      cell.fh = newFh;
    } else if (edge === 'sw') {
      const fx = clamp(interaction.startFx + (interaction.startFw - newFw), 0, 1);
      cell.fx = fx;
      cell.fw = newFw;
      cell.fh = newFh;
    } else if (edge === 'ne') {
      const fy = clamp(interaction.startFy + (interaction.startFh - newFh), 0, 1);
      cell.fy = fy;
      cell.fw = Math.min(newFw, 1 - cell.fx);
      cell.fh = newFh;
    } else if (edge === 'nw') {
      const fx = clamp(interaction.startFx + (interaction.startFw - newFw), 0, 1);
      const fy = clamp(interaction.startFy + (interaction.startFh - newFh), 0, 1);
      cell.fx = fx;
      cell.fy = fy;
      cell.fw = newFw;
      cell.fh = newFh;
    }

    renderCollage();

  } else if (interaction.mode === 'swap') {
    const cellEls = $$('.cell', collage);
    let target = -1;
    for (const el of cellEls) {
      const idx = parseInt(el.dataset.idx);
      if (idx === interaction.cellIdx) continue;
      const r = el.getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
        target = idx; break;
      }
    }

    cellEls.forEach(el => el.classList.remove('drag-target'));
    if (target >= 0) {
      const tEl = collage.querySelector(`[data-idx="${target}"]`);
      if (tEl) tEl.classList.add('drag-target');
    }
    interaction.swapTarget = target;

    const activeEl = collage.querySelector(`[data-idx="${interaction.cellIdx}"] .cell-img`);
    if (activeEl) activeEl.classList.add('swapping-img');

    cell.fx = clamp(interaction.startFx + dfx, 0, 1 - cell.fw);
    cell.fy = clamp(interaction.startFy + dfy, 0, 1 - cell.fh);
    renderCollage();
  }
});

viewport.addEventListener('pointerup', e => {
  if (isPanningCanvas) {
    isPanningCanvas = false;
    viewport.releasePointerCapture(e.pointerId);
    viewport.style.cursor = panToolActive ? 'grab' : '';
    return;
  }
});

collage.addEventListener('pointerup', e => {
  if (!interaction.active) return;
  collage.releasePointerCapture(e.pointerId);

  const idx = interaction.cellIdx;
  const wasDragged = interaction.didDrag;
  const mode = interaction.mode;
  const target = interaction.swapTarget;

  interaction.active = false;

  if (mode === 'rb_move' || mode === 'rb_resize') {
    return;
  }

  if (mode === 'swap' && wasDragged && target >= 0) {
    const a = idx, b = target;
    // Swap cells in array
    const temp = canvasCells[a];
    canvasCells[a] = canvasCells[b];
    canvasCells[b] = temp;

    // Automatically recalculate optimal justified layout so both images reshape to their aspect ratios!
    redistributeLayout();
    renderCollage();
    selectCell(b);
  } else if (mode === 'swap' && wasDragged && target < 0) {
    // Restore layout if dropped outside
    redistributeLayout();
    renderCollage();
  } else if (!wasDragged) {
    selectCell(idx);
  }

  $$('.cell', collage).forEach(el => {
    el.classList.remove('drag-target');
    el.classList.remove('active-drag');
  });
  $$('.cell-img', collage).forEach(el => el.classList.remove('swapping-img'));
});

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

/* CELL OPERATIONS  */
function removeCell(idx) {
  canvasCells.splice(idx, 1);
  if (selectedIdx === idx) { selectedIdx = -1; hideInspector(); }
  else if (selectedIdx > idx) selectedIdx--;
  redistributeLayout();
  renderCollage();
}

function selectCell(idx) {
  if (selectedIdx === idx) {
    selectedIdx = -1;
    hideInspector();
  } else {
    selectedIdx = idx;
    showInspector(idx);
  }
  renderCollage();
}

/* ---- BI-DIRECTIONAL SLIDER & NUMBER SYNC ---- */
function bindSliderAndNum(sliderEl, numEl, onChange) {
  if (!sliderEl || !numEl) return;
  sliderEl.addEventListener('input', () => {
    numEl.value = sliderEl.value;
    onChange(parseInt(sliderEl.value));
  });
  numEl.addEventListener('input', () => {
    let val = parseInt(numEl.value) || 0;
    val = Math.max(parseInt(sliderEl.min), Math.min(parseInt(sliderEl.max), val));
    sliderEl.value = val;
    numEl.value = val;
    onChange(val);
  });
}

function syncSegmentedBtns(containerId, activeMode) {
  $$(`#${containerId} .segment-btn`).forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === activeMode);
  });
}

/* INSPECTOR  */
function showInspector(idx) {
  const cell = isSingleEditorMode ? singleCell : canvasCells[idx];
  if (!cell) { hideInspector(); return; }
  adjPanel.hidden = false;

  for (const key of Object.keys(adjSliders)) {
    adjSliders[key].el.value = cell.adj[key];
    adjSliders[key].num.value = cell.adj[key];
  }

  if (!cell.adj.lines) cell.adj.lines = defaultAdj().lines;
  if (!cell.adj.noise) cell.adj.noise = defaultAdj().noise;

  // Lines bindings
  const l = cell.adj.lines;
  $('#lines-enable').checked = !!l.enabled;
  const lMode = l.mode || 'full';
  $('#lines-mode-full')?.classList.toggle('active', lMode === 'full');
  $('#lines-mode-region')?.classList.toggle('active', lMode === 'region');

  $('#lines-angle').value = l.angle; $('#lines-angle-num').value = l.angle;
  $('#lines-spacing').value = l.spacing; $('#lines-spacing-num').value = l.spacing;
  $('#lines-size').value = l.size; $('#lines-size-num').value = l.size;
  $('#lines-opacity').value = l.opacity; $('#lines-opacity-num').value = l.opacity;
  $('#lines-color').value = l.color || '#ffff00';
  $('#lines-color-hex').textContent = (l.color || '#ffff00').toUpperCase();

  // Noise bindings
  const nObj = cell.adj.noise;
  $('#noise-enable').checked = !!nObj.enabled;
  const nMode = nObj.mode || 'full';
  $('#noise-mode-full')?.classList.toggle('active', nMode === 'full');
  $('#noise-mode-region')?.classList.toggle('active', nMode === 'region');

  $('#noise-amount').value = nObj.amount; $('#noise-amount-num').value = nObj.amount;
}

function hideInspector() { adjPanel.hidden = true; }

// Direct Segmented Mode Handler (Exposed globally for onclick)
window.setEffectMode = function(effectKey, mode) {
  const cell = getActiveCell();
  if (!cell) return;

  if (effectKey === 'lines') {
    if (!cell.adj.lines) cell.adj.lines = defaultAdj().lines;
    cell.adj.lines.enabled = true;
    cell.adj.lines.mode = mode;
    $('#lines-enable').checked = true;
  } else if (effectKey === 'noise') {
    if (!cell.adj.noise) cell.adj.noise = defaultAdj().noise;
    cell.adj.noise.enabled = true;
    cell.adj.noise.mode = mode;
    $('#noise-enable').checked = true;
  }

  showInspector(isSingleEditorMode ? -1 : selectedIdx);
  refreshImageEffects();
};

// Inspector Tabs Switcher
$$('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.tab-btn').forEach(b => b.classList.remove('active'));
    $$('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    const target = $('#' + btn.dataset.tab);
    if (target) target.classList.add('active');
  });
});

// Helper to get active cell in editor or collage mode
function getActiveCell() {
  return isSingleEditorMode ? singleCell : (selectedIdx >= 0 ? canvasCells[selectedIdx] : null);
}

function refreshImageEffects() {
  if (editorOverlay && !editorOverlay.hasAttribute('hidden')) {
    renderEditorImage();
  }
  if (!isSingleEditorMode) {
    renderCollage();
  }
}

for (const key of Object.keys(adjSliders)) {
  const { el, num } = adjSliders[key];
  bindSliderAndNum(el, num, val => {
    const cell = getActiveCell();
    if (!cell) return;
    cell.adj[key] = val;
    refreshImageEffects();
  });
}

// Auto-enable helpers
function autoEnableLines() {
  const cell = getActiveCell();
  if (!cell) return;
  cell.adj.lines.enabled = true;
  $('#lines-enable').checked = true;
}

// Ensure noise auto-enables on input change
function autoEnableNoise() {
  const cell = getActiveCell();
  if (!cell) return;
  cell.adj.noise.enabled = true;
  $('#noise-enable').checked = true;
}

// Lines Effect Listeners
$('#lines-enable').addEventListener('change', e => {
  const cell = getActiveCell();
  if (!cell) return;
  cell.adj.lines.enabled = e.target.checked;
  refreshImageEffects();
});

bindSliderAndNum($('#lines-angle'), $('#lines-angle-num'), val => {
  const cell = getActiveCell();
  if (!cell) return;
  autoEnableLines();
  cell.adj.lines.angle = val;
  refreshImageEffects();
});
bindSliderAndNum($('#lines-spacing'), $('#lines-spacing-num'), val => {
  const cell = getActiveCell();
  if (!cell) return;
  autoEnableLines();
  cell.adj.lines.spacing = val;
  refreshImageEffects();
});
bindSliderAndNum($('#lines-size'), $('#lines-size-num'), val => {
  const cell = getActiveCell();
  if (!cell) return;
  autoEnableLines();
  cell.adj.lines.size = val;
  refreshImageEffects();
});
bindSliderAndNum($('#lines-opacity'), $('#lines-opacity-num'), val => {
  const cell = getActiveCell();
  if (!cell) return;
  autoEnableLines();
  cell.adj.lines.opacity = val;
  refreshImageEffects();
});
$('#lines-color').addEventListener('input', e => {
  const cell = getActiveCell();
  if (!cell) return;
  autoEnableLines();
  const hex = e.target.value;
  cell.adj.lines.color = hex;
  $('#lines-color-hex').textContent = hex.toUpperCase();
  refreshImageEffects();
});

// Noise Effect Listeners
$('#noise-enable').addEventListener('change', e => {
  const cell = getActiveCell();
  if (!cell) return;
  cell.adj.noise.enabled = e.target.checked;
  refreshImageEffects();
});

bindSliderAndNum($('#noise-amount'), $('#noise-amount-num'), val => {
  const cell = getActiveCell();
  if (!cell) return;
  autoEnableNoise();
  cell.adj.noise.amount = val;
  refreshImageEffects();
});

$('#btn-reset-adj').addEventListener('click', () => {
  const cell = getActiveCell();
  if (!cell) return;
  cell.adj = defaultAdj();
  showInspector(isSingleEditorMode ? -1 : selectedIdx);
  refreshImageEffects();
});
$('#btn-remove-cell').addEventListener('click', () => { if (selectedIdx >= 0) removeCell(selectedIdx); });
$('#btn-deselect').addEventListener('click', () => { selectedIdx=-1; hideInspector(); renderCollage(); });

/* LIBRARY  */
function renderLibrary() {
  libCount.textContent = library.length;
  const mobCount = $('#mobile-lib-count');
  if (mobCount) mobCount.textContent = library.length;
  libGrid.innerHTML = '';
  libEmpty.style.display = library.length === 0 ? 'block' : 'none';
  libCount.textContent = library.length;
  for (const item of library) {
    const card = document.createElement('div');
    card.className = 'lib-card';
    const img = document.createElement('img');
    img.src = item.thumbUrl; img.loading = 'lazy';
    card.appendChild(img);
    const del = document.createElement('button');
    del.className = 'lib-del-btn'; del.textContent = '✕';
    del.addEventListener('click', e => { e.stopPropagation(); removeFromLibrary(item.id); });
    card.appendChild(del);
    card.addEventListener('click', () => addToCollage(item.id));
    libGrid.appendChild(card);
  }
}

function addToCollage(assetId) {
  canvasCells.push({ assetId, adj: defaultAdj(), fx:0, fy:0, fw:0, fh:0 });
  redistributeLayout();
  renderCollage();
}

async function removeFromLibrary(id) {
  canvasCells = canvasCells.filter(c => c.assetId !== id);
  if (selectedIdx >= canvasCells.length) { selectedIdx = -1; hideInspector(); }
  const item = library.find(a => a.id === id);
  if (item && item.thumbUrl) URL.revokeObjectURL(item.thumbUrl);
  library = library.filter(a => a.id !== id);
  await dbDel(id);
  redistributeLayout();
  renderLibrary();
  renderCollage();
}

/* FILE UPLOAD  */
async function handleFiles(files) {
  if (!files || files.length === 0) return;
  const newAssetIds = [];
  for (const file of files) {
    const isImg = (file.type && file.type.startsWith('image/')) ||
                  (file.name && file.name.match(/\.(jpg|jpeg|png|webp|heic|heif|gif|bmp|svg)$/i)) ||
                  (!file.type && file.size > 0);
    if (!isImg) continue;

    const id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
    const blob = file;
    const thumbUrl = URL.createObjectURL(blob);
    const dims = await getImageDims(thumbUrl);
    library.push({ id, blob, thumbUrl, natW: dims.w, natH: dims.h });
    newAssetIds.push(id);
    try { await dbPut({ id, blob }); } catch(e) { console.warn('DB save failed:', e); }
  }
  renderLibrary();
}

const globalFileInput = document.getElementById('global-file-input');
if (globalFileInput) {
  globalFileInput.addEventListener('change', e => {
    const files = Array.from(e.target.files);
    globalFileInput.value = '';
    if (files.length > 0) handleFiles(files);
  });
}

/* DRAG & DROP FILES  */
viewport.addEventListener('dragover', e => { e.preventDefault(); frame.classList.add('drag-over'); });
viewport.addEventListener('dragleave', () => frame.classList.remove('drag-over'));
viewport.addEventListener('drop', e => {
  e.preventDefault(); frame.classList.remove('drag-over');
  if (e.dataTransfer.files.length > 0) {
    const files = Array.from(e.dataTransfer.files);
    handleFiles(files);
  }
});

/* TOOLBAR LISTENERS & TOGGLES  */
$('#tag-enable').addEventListener('change', e => {
  tagEnabled = e.target.checked;
  redistributeLayout();
  renderCollage();
});

$('#stroke-enable').addEventListener('change', e => {
  strokeEnabled = e.target.checked;
  renderCollage();
});

bindSliderAndNum(sGap, nGap, val => { gap = val; redistributeLayout(); renderCollage(); });
bindSliderAndNum(sRadius, nRadius, val => { radius = val; renderCollage(); });
bindSliderAndNum(sTagSize, nTagSize, val => { tagSize = val; redistributeLayout(); renderCollage(); });
bindSliderAndNum(sFrameStroke, nFrameStroke, val => { strokeWidth = val; renderCollage(); });
$$('.ratio-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.ratio-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const val = btn.dataset.ratio;
    if (sRatio) {
      sRatio.value = val;
      updateFrameSize();
      redistributeLayout();
      renderCollage();
    }
  });
});

sRatio?.addEventListener('change', () => {
  const val = sRatio.value;
  $$('.ratio-btn').forEach(b => b.classList.toggle('active', b.dataset.ratio === val));
  updateFrameSize();
  redistributeLayout();
  renderCollage();
});
sFrameColor.addEventListener('input', () => { frameColor=sFrameColor.value; vFrameColor.textContent=frameColor.toUpperCase(); renderCollage(); });

$('#btn-clear-canvas').addEventListener('click', () => { canvasCells=[]; selectedIdx=-1; hideInspector(); renderCollage(); });
$('#btn-add-all').addEventListener('click', () => {
  for (const item of library) canvasCells.push({ assetId: item.id, adj: defaultAdj(), fx:0, fy:0, fw:0, fh:0 });
  redistributeLayout();
  renderCollage();
});
$('#btn-clear-lib').addEventListener('click', async () => {
  const msg = currentLang === 'ru'
    ? 'Вы уверены? Все изображения и холст будут удалены!'
    : 'Are you sure? All images and canvas will be deleted!';
  if (!confirm(msg)) return;
  canvasCells=[]; selectedIdx=-1; hideInspector();
  for (const item of library) if (item.thumbUrl) URL.revokeObjectURL(item.thumbUrl);
  library=[]; await dbClear(); renderLibrary(); renderCollage();
});

/* EXPORT MODAL & RENDERING  */
const exportFormStep     = $('#export-form-step');
const exportProgressStep = $('#export-progress-step');

$('#btn-export').addEventListener('click', () => {
  if (canvasCells.length === 0) return;
  exportModal.hidden = false;
  exportFormStep.hidden = false;
  exportProgressStep.hidden = true;
});

$('#btn-modal-x').addEventListener('click', () => { exportModal.hidden = true; });
$('#btn-close-modal').addEventListener('click', () => { exportModal.hidden = true; });

$('#btn-start-export').addEventListener('click', () => {
  const resPreset = parseInt($('input[name="res-preset"]:checked').value) || 7680;
  const format = $('input[name="export-fmt"]:checked').value || 'image/jpeg';
  exportFormStep.hidden = true;
  exportProgressStep.hidden = false;
  $('#btn-close-modal').hidden = true;
  runExportProcess(resPreset, format);
});

async function runExportProcess(baseW, mimeType) {
  exportProg.style.width = '0%';
  exportStatus.textContent = 'Preparing canvas…';
  await sleep(50);

  const ratio = getRatio();
  let targetW = baseW;
  let targetH = Math.round(targetW / ratio);

  const canvas = document.createElement('canvas');
  canvas.width = targetW; canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#121215'; ctx.fillRect(0,0,targetW,targetH);

  const n = canvasCells.length;
  const scale = targetW / frame.offsetWidth;
  const radPx = radius * scale;
  const tagPx = tagSize * scale;
  const strokePx = strokeEnabled ? (strokeWidth * scale) : 0;
  const contrastColor = getContrastColor(frameColor);

  for (let i = 0; i < n; i++) {
    const cell = canvasCells[i];
    const asset = library.find(a => a.id === cell.assetId);
    if (!asset) continue;
    exportProg.style.width = ((i+1)/n*80)+'%';
    exportStatus.textContent = `Rendering image ${i+1} / ${n}…`;

    const natW = asset.natW || 1, natH = asset.natH || 1;
    const ir = natW / natH;

    const px = cell.fx * targetW;
    const py = cell.fy * targetH;
    const pw = cell.fw * targetW;
    const ph = cell.fh * targetH;

    const tagH = tagEnabled ? Math.round(tagPx*1.6 + 6*scale) : 0;
    const imgH = Math.max(10, ph - tagH);

    const img = await loadImage(asset.blob instanceof Blob ? URL.createObjectURL(asset.blob) : asset.thumbUrl);

    ctx.save();
    roundRect(ctx, px, py, pw, ph, radPx);
    ctx.clip();

    // Tag header
    if (tagEnabled) {
      ctx.fillStyle = frameColor;
      ctx.fillRect(px, py, pw, tagH);
      ctx.fillStyle = contrastColor;
      ctx.font = `900 ${tagPx}px Inter, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('@IMAGE'+(i+1), px+pw/2, py+tagH/2);
    }

    // Image
    const imgX = px, imgY = py + tagH;
    const adj = cell.adj;
    ctx.filter = `brightness(${adj.brightness}%) contrast(${adj.contrast}%)`;
    drawContain(ctx, img, imgX, imgY, pw, imgH);
    ctx.filter = 'none';

    if (adj.r!==100||adj.g!==100||adj.b!==100) {
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = `rgb(${Math.round(adj.r*2.55)},${Math.round(adj.g*2.55)},${Math.round(adj.b*2.55)})`;
      ctx.fillRect(imgX,imgY,pw,imgH);
      ctx.globalCompositeOperation = 'source-over';
    }

    // High-Res Lines Render
    if (adj.lines && adj.lines.enabled) {
      const l = adj.lines;
      ctx.save();
      let lX = imgX, lY = imgY, lW = pw, lH = imgH;
      if (l.mode === 'region' && l.box) {
        lX = imgX + (l.box.x / 100) * pw;
        lY = imgY + (l.box.y / 100) * imgH;
        lW = (l.box.w / 100) * pw;
        lH = (l.box.h / 100) * imgH;
      }
      ctx.beginPath(); ctx.rect(lX, lY, lW, lH); ctx.clip();

      ctx.strokeStyle = l.color || '#ffff00';
      ctx.lineWidth = Math.max(1, (l.size || 2) * scale);
      ctx.globalAlpha = (l.opacity !== undefined ? l.opacity : 80) / 100;

      const angleRad = ((l.angle || 0) * Math.PI) / 180;
      const step = Math.max(2, (l.spacing || 30) * scale);
      const diag = Math.sqrt(targetW * targetW + targetH * targetH);

      ctx.translate(lX + lW/2, lY + lH/2);
      ctx.rotate(angleRad);

      for (let offset = -diag; offset < diag; offset += step) {
        ctx.beginPath();
        ctx.moveTo(-diag, offset);
        ctx.lineTo(diag, offset);
        ctx.stroke();
      }
      ctx.restore();
    }

    // High-Res Noise Render
    if (adj.noise && adj.noise.enabled && adj.noise.amount > 0) {
      const nObj = adj.noise;
      ctx.save();
      let nX = imgX, nY = imgY, nW = pw, nH = imgH;
      if (nObj.mode === 'region' && nObj.box) {
        nX = imgX + (nObj.box.x / 100) * pw;
        nY = imgY + (nObj.box.y / 100) * imgH;
        nW = (nObj.box.w / 100) * pw;
        nH = (nObj.box.h / 100) * imgH;
      }
      ctx.beginPath(); ctx.rect(nX, nY, nW, nH); ctx.clip();

      const noiseCanvas = document.createElement('canvas');
      noiseCanvas.width = 128; noiseCanvas.height = 128;
      const nCtx = noiseCanvas.getContext('2d');
      const imgData = nCtx.createImageData(128, 128);
      const data = imgData.data;
      const alpha = (nObj.amount / 100) * 180;
      for (let k = 0; k < data.length; k += 4) {
        const v = Math.random() * 255;
        data[k] = v; data[k+1] = v; data[k+2] = v;
        data[k+3] = Math.random() < 0.5 ? alpha : alpha * 0.4;
      }
      nCtx.putImageData(imgData, 0, 0);

      const pattern = ctx.createPattern(noiseCanvas, 'repeat');
      ctx.fillStyle = pattern;
      ctx.globalCompositeOperation = 'overlay';
      ctx.fillRect(nX, nY, nW, nH);
      ctx.restore();
    }

    ctx.restore();

    // Outer stroke
    if (strokeEnabled && strokePx > 0) {
      ctx.strokeStyle = frameColor; ctx.lineWidth = strokePx;
      ctx.beginPath(); roundRect(ctx, px, py, pw, ph, radPx); ctx.stroke();
    }

    if (asset.blob instanceof Blob) URL.revokeObjectURL(img.src);
    await sleep(10);
  }

  exportProg.style.width = '90%';
  exportStatus.textContent = 'Generating file…';
  await sleep(30);

  let blob, ext;
  if (mimeType === 'image/png') {
    ext = 'png';
    blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
  } else {
    ext = 'jpg';
    let quality = 0.95;
    do {
      blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', quality));
      if (blob.size > 15*1024*1024) quality -= 0.05; else break;
    } while (quality > 0.3);
  }

  const resName = baseW >= 15000 ? '16K' : baseW >= 9000 ? '10K' : baseW >= 7000 ? '8K' : '4K';
  exportProg.style.width = '100%';
  exportStatus.textContent = `Done! ${targetW}×${targetH} (${resName}) — ${(blob.size/1024/1024).toFixed(2)} MB`;

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `collage_${resName}_${targetW}x${targetH}.${ext}`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  $('#btn-close-modal').hidden = false;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function drawContain(ctx, img, x, y, w, h) {
  ctx.fillStyle = '#111116'; ctx.fillRect(x,y,w,h);
  ctx.drawImage(img, 0,0,img.naturalWidth,img.naturalHeight, x,y,w,h);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y);
  ctx.quadraticCurveTo(x+w,y,x+w,y+r); ctx.lineTo(x+w,y+h-r);
  ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h); ctx.lineTo(x+r,y+h);
  ctx.quadraticCurveTo(x,y+h,x,y+h-r); ctx.lineTo(x,y+r);
  ctx.quadraticCurveTo(x,y,x+r,y); ctx.closePath();
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/* WINDOW RESIZE  */
window.addEventListener('resize', () => { updateFrameSize(); renderCollage(); });

/* CANVAS ZOOM & PAN SYSTEM */
let zoomScale = 1.0;
let zoomPanX = 0;
let zoomPanY = 0;

function getFitScale() {
  const vp = viewport.getBoundingClientRect();
  const fw = parseFloat(frame.style.width) || 1000;
  const fh = parseFloat(frame.style.height) || 800;
  const isMobile = isMobileUI();
  const pad = isMobile ? 10 : 40;
  const fitW = (vp.width - pad * 2) / fw;
  const fitH = (vp.height - pad * 2) / fh;
  return Math.max(0.05, Math.min(fitW, fitH));
}

function resetZoom() {
  const isMobile = isMobileUI();
  zoomScale = isMobile ? Math.round(getFitScale() * 1000) / 1000 : 1.0;
  zoomPanX = 0;
  zoomPanY = 0;
  updateZoomTransform();
}

function updateZoomTransform() {
  frame.style.transform = `scale(${zoomScale}) translate(${zoomPanX}px, ${zoomPanY}px)`;
  const zoomValEl = $('#zoom-val');
  if (zoomValEl) {
    const isMobile = window.innerWidth <= 768;
    const baseScale = isMobile ? getFitScale() : 1.0;
    const relZoom = Math.round((zoomScale / (baseScale || 1)) * 100);
    zoomValEl.textContent = relZoom + '%';
  }
}

viewport.addEventListener('wheel', e => {
  e.preventDefault();
  const delta = e.deltaY < 0 ? 0.08 : -0.08;
  const minZ = Math.min(0.05, getFitScale() * 0.4);
  zoomScale = Math.max(minZ, Math.min(4.0, Math.round((zoomScale + delta) * 100) / 100));
  updateZoomTransform();
}, { passive: false });

$('#btn-zoom-in')?.addEventListener('click', () => {
  zoomScale = Math.min(4.0, Math.round((zoomScale + 0.1) * 100) / 100);
  updateZoomTransform();
});
$('#btn-zoom-out')?.addEventListener('click', () => {
  const minZ = Math.min(0.05, getFitScale() * 0.4);
  zoomScale = Math.max(minZ, Math.round((zoomScale - 0.1) * 100) / 100);
  updateZoomTransform();
});
$('#btn-zoom-reset')?.addEventListener('click', resetZoom);

const selectBtn = $('#btn-select-tool');
const panBtn    = $('#btn-pan-tool');

function setNavigationMode(isPan) {
  panToolActive = isPan;
  if (selectBtn) selectBtn.classList.toggle('active', !isPan);
  if (panBtn) panBtn.classList.toggle('active', isPan);
  viewport.style.cursor = isPan ? 'grab' : '';
  updateTopModeSwitcher(isPan);
}
const btnModeSelect = document.getElementById('btn-mode-select');
const btnModePan = document.getElementById('btn-mode-pan');

function updateTopModeSwitcher(isPan) {
  if (btnModeSelect) btnModeSelect.classList.toggle('active', !isPan);
  if (btnModePan) btnModePan.classList.toggle('active', isPan);
}

btnModeSelect?.addEventListener('click', () => {
  setNavigationMode(false);
});
btnModePan?.addEventListener('click', () => {
  setNavigationMode(true);
});

selectBtn?.addEventListener('click', () => setNavigationMode(false));
panBtn?.addEventListener('click', () => setNavigationMode(true));

viewport.addEventListener('dblclick', e => {
  if (e.target === viewport || e.target === frame) {
    resetZoom();
  }
});

/* ---- MOBILE TOUCH GESTURES (PINCH TO ZOOM & 2-FINGER PAN) ---- */
let touchStartDist = 0;
let touchStartScale = 1.0;
let touchStartPanX = 0, touchStartPanY = 0;
let touchMidX = 0, touchMidY = 0;

viewport.addEventListener('touchstart', e => {
  if (e.target.closest('.zoom-controls') || e.target.closest('.mobile-bottom-bar') || e.target.closest('.studio-sidebar') || e.target.closest('.inspector-section')) return;

  if (e.touches.length === 2) {
    isPanningCanvas = true;
    const t1 = e.touches[0];
    const t2 = e.touches[1];
    touchStartDist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
    touchStartScale = zoomScale;
    touchMidX = (t1.clientX + t2.clientX) / 2;
    touchMidY = (t1.clientY + t2.clientY) / 2;
    touchStartPanX = zoomPanX;
    touchStartPanY = zoomPanY;
    if (e.cancelable) e.preventDefault();
  }
}, { passive: false });

viewport.addEventListener('touchmove', e => {
  if (e.touches.length === 2 && touchStartDist > 0) {
    const t1 = e.touches[0];
    const t2 = e.touches[1];
    const distNow = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
    const factor = distNow / touchStartDist;
    const minZ = Math.min(0.05, getFitScale() * 0.4);
    zoomScale = Math.max(minZ, Math.min(4.0, Math.round((touchStartScale * factor) * 1000) / 1000));

    const curMidX = (t1.clientX + t2.clientX) / 2;
    const curMidY = (t1.clientY + t2.clientY) / 2;
    zoomPanX = touchStartPanX + (curMidX - touchMidX);
    zoomPanY = touchStartPanY + (curMidY - touchMidY);

    updateZoomTransform();
    if (e.cancelable) e.preventDefault();
  }
}, { passive: false });

viewport.addEventListener('touchend', e => {
  if (e.touches.length < 2) {
    touchStartDist = 0;
    isPanningCanvas = false;
  }
});

/* MOBILE BOTTOM DRAWER CONTROLS  */
const btnMobileAssets    = $('#btn-mobile-assets');
const btnMobileLayout    = $('#btn-mobile-layout');
const btnMobileInspector = $('#btn-mobile-inspector');
const mobileOverlay      = $('#mobile-overlay');
const sidebarPanel       = $('.studio-sidebar');
const navbarCenter       = $('.navbar-center');
const zoomControls       = $('.zoom-controls');

/* Move inspector-section to body level so it is always accessible and never trapped */
if (adjPanel) {
  document.body.insertBefore(adjPanel, document.querySelector('.mobile-drawer-overlay') || document.body.firstChild);
}

const allDrawers = [sidebarPanel, adjPanel, navbarCenter].filter(Boolean);
const allTabs    = [btnMobileAssets, btnMobileLayout, btnMobileInspector].filter(Boolean);

function closeMobileDrawers() {
  allDrawers.forEach(d => { d.classList.remove('mobile-open'); d.style.transform = ''; });
  allTabs.forEach(t => t.classList.remove('active'));
  mobileOverlay?.classList.remove('active');
}

function openMobileDrawer(drawer, tab) {
  const isOpening = !drawer?.classList.contains('mobile-open');
  closeMobileDrawers();
  if (isOpening) {
    drawer?.classList.add('mobile-open');
    mobileOverlay?.classList.add('active');
    tab?.classList.add('active');
  }
}

btnMobileAssets?.addEventListener('click', () => openMobileDrawer(sidebarPanel, btnMobileAssets));
btnMobileLayout?.addEventListener('click', () => openMobileDrawer(navbarCenter, btnMobileLayout));
btnMobileInspector?.addEventListener('click', () => {
  if (selectedIdx < 0 || selectedIdx >= canvasCells.length) {
    openFullscreenEditor(-1);
    return;
  }
  openFullscreenEditor(selectedIdx);
});
mobileOverlay?.addEventListener('click', closeMobileDrawers);

/* ---- SWIPE-TO-DISMISS DRAWERS ---- */
let swipeDrawer = null;
let swipeStartY = 0;
let swipeDeltaY = 0;

function initSwipeDismiss(drawerEl) {
  if (!drawerEl) return;
  drawerEl.addEventListener('touchstart', e => {
    // Only start swipe from the drawer-handle or top 40px of drawer
    const handle = drawerEl.querySelector('.drawer-handle');
    const rect = drawerEl.getBoundingClientRect();
    const touchY = e.touches[0].clientY;
    const isNearTop = (touchY - rect.top) < 40;
    const isHandle = handle && e.target === handle;
    if (!isHandle && !isNearTop) return;
    if (!drawerEl.classList.contains('mobile-open')) return;
    swipeDrawer = drawerEl;
    swipeStartY = e.touches[0].clientY;
    swipeDeltaY = 0;
    drawerEl.style.transition = 'none';
  }, { passive: true });

  drawerEl.addEventListener('touchmove', e => {
    if (swipeDrawer !== drawerEl) return;
    swipeDeltaY = e.touches[0].clientY - swipeStartY;
    if (swipeDeltaY < 0) swipeDeltaY = 0; // Only allow downward swipe
    drawerEl.style.transform = `translateY(${swipeDeltaY}px)`;
  }, { passive: true });

  drawerEl.addEventListener('touchend', () => {
    if (swipeDrawer !== drawerEl) return;
    drawerEl.style.transition = '';
    if (swipeDeltaY > 80) {
      closeMobileDrawers();
    } else {
      drawerEl.style.transform = '';
    }
    swipeDrawer = null;
    swipeDeltaY = 0;
  });
}

// Initialize swipe-to-dismiss on all drawers
allDrawers.forEach(d => initSwipeDismiss(d));

/* ---- DOUBLE-TAP CANVAS FOR FULLSCREEN PREVIEW ---- */
let lastTapTime = 0;
const appEl = document.querySelector('.app');

viewport.addEventListener('touchend', e => {
  if (e.touches.length > 0) return; // Still has fingers down
  // Only trigger on empty canvas area, not on cells
  if (e.target !== viewport && e.target !== frame && e.target.id !== 'empty-state' && !e.target.closest('.empty-canvas')) return;
  
  const now = Date.now();
  if (now - lastTapTime < 350) {
    // Double-tap detected
    appEl?.classList.toggle('fullscreen-preview');
    lastTapTime = 0;
  } else {
    lastTapTime = now;
  }
});

/* MOBILE EXPORT BUTTON  */
const btnExportMobile = $('#btn-export-mobile');
btnExportMobile?.addEventListener('click', () => {
  document.getElementById('export-modal')?.removeAttribute('hidden');
});

/* INTERNATIONALIZATION (i18n) SYSTEM — RU / EN */
const i18n = {
  ru: {
    ratio: "ПРОПОРЦИИ",
    gap: "ОТСТУП",
    radius: "СКРУГЛЕНИЕ",
    tag: "ТЕГ",
    stroke: "РАМКА",
    clear: "Очистить",
    export: "Экспорт",
    assets: "АССЕТЫ",
    upload: "Загрузить фото",
    noImages: "Нет изображений",
    tabColor: "Цвет",
    tabEffects: "Линии & Шум",
    brightness: "Яркость",
    contrast: "Контраст",
    red: "Красный",
    green: "Зелёный",
    blue: "Синий",
    reset: "Сброс",
    delete: "Удалить",
    lines: "Линии",
    noise: "Шум",
    area: "Область",
    fullPhoto: "Всё фото",
    selectedRegion: "Выделенный участок",
    angle: "Угол",
    spacing: "Отступ",
    size: "Размер",
    opacity: "Прозр.",
    color: "Цвет",
    level: "Уровень",
    exportTitle: "Экспорт коллажа",
    resolution: "РАЗРЕШЕНИЕ",
    format: "ФОРМАТ",
    startDownload: "Скачать",
    done: "Готово",
    emptyNotice: "Перетащите фото или выберите из библиотеки",
    layout: "МАКЕТ",
    settings: "НАСТРОЙКИ",
    editor: "РЕДАКТОР",
    modeSelect: "Фото",
    modePan: "Холст",
    uploadPhoto: "Выбрать фото"
  },
  en: {
    ratio: "RATIO",
    gap: "GAP",
    radius: "RADIUS",
    tag: "TAG",
    stroke: "STROKE",
    clear: "Clear",
    export: "Export",
    assets: "ASSETS",
    upload: "Upload Images",
    noImages: "No images yet",
    tabColor: "Color",
    tabEffects: "Lines & Noise",
    brightness: "Brightness",
    contrast: "Contrast",
    red: "Red",
    green: "Green",
    blue: "Blue",
    reset: "Reset",
    delete: "Delete",
    lines: "Lines",
    noise: "Noise",
    area: "Area",
    fullPhoto: "Full photo",
    selectedRegion: "Selected Region",
    angle: "Angle",
    spacing: "Spacing",
    size: "Size",
    opacity: "Opacity",
    color: "Color",
    level: "Amount",
    exportTitle: "Export Collage",
    resolution: "RESOLUTION",
    format: "FORMAT",
    startDownload: "Start Download",
    done: "Done",
    emptyNotice: "Drop images or click from library",
    layout: "LAYOUT",
    settings: "SETTINGS",
    editor: "EDITOR",
    modeSelect: "Photo",
    modePan: "Canvas",
    uploadPhoto: "Upload Photo"
  }
};

let currentLang = localStorage.getItem('collage_lang') || 'ru';

function applyLanguage(lang) {
  currentLang = lang;
  localStorage.setItem('collage_lang', lang);

  $$('.lang-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.lang === lang);
  });

  const dict = i18n[lang] || i18n.ru;
  $$('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    if (dict[key]) {
      el.textContent = dict[key];
    }
  });
}

$$('.lang-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    applyLanguage(btn.dataset.lang);
  });
});

/* INIT  */
(async function init() {
  try {
    await openDB();
    const items = await dbGetAll();
    if (Array.isArray(items)) {
      for (const item of items) {
        if (!item || !item.blob) continue;
        const thumbUrl = URL.createObjectURL(item.blob);
        const dims = await getImageDims(thumbUrl);
        library.push({ id: item.id, blob: item.blob, thumbUrl, natW: dims.w, natH: dims.h });
      }
    }
  } catch(e) {
    console.warn('Init error:', e);
  }
  renderLibrary();
  updateFrameSize();
  renderCollage();
  applyLanguage(currentLang);
})();






/* FULLSCREEN PHOTO EDITOR LOGIC  */
let editorScale = 1.0;
let editorPanX = 0;
let editorPanY = 0;

const editorOverlay = document.getElementById('editor-mode-overlay');
const editorViewport = document.getElementById('editor-viewport');
const editorWrapper = document.getElementById('editor-canvas-wrapper');
const editorImgContainer = document.getElementById('editor-image-container');
const editorUploadBtn = document.getElementById('editor-upload-btn');
const editorFileInput = document.getElementById('editor-file-input');
const btnEditorChangePhoto = document.getElementById('btn-editor-change-photo');
const btnEditorDownload = document.getElementById('btn-editor-download');

const btnEditorClose = document.getElementById('btn-editor-close');
const btnEditorSave = document.getElementById('btn-editor-save');

function openFullscreenEditor(idx) {
  document.body.classList.add('in-editor-mode');
  editorOverlay.removeAttribute('hidden');

  if (idx === -1) {
    isSingleEditorMode = true;
    selectedIdx = -1;
    // Session persistence: if singleCell already loaded, show it
    if (singleCell) {
      if (editorUploadBtn) editorUploadBtn.setAttribute('hidden', 'true');
      if (btnEditorChangePhoto) {
        btnEditorChangePhoto.style.display = 'flex';
        btnEditorChangePhoto.removeAttribute('hidden');
      }
      showInspector(-1);
      if (adjPanel) {
        adjPanel.removeAttribute('hidden');
        adjPanel.classList.remove('no-selection');
      }
      renderEditorImage();
    } else {
      if (editorUploadBtn) editorUploadBtn.removeAttribute('hidden');
      if (btnEditorChangePhoto) {
        btnEditorChangePhoto.style.display = 'none';
        btnEditorChangePhoto.setAttribute('hidden', 'true');
      }
      if (editorImgContainer) editorImgContainer.innerHTML = '';
      hideInspector();
    }
  } else {
    isSingleEditorMode = false;
    selectedIdx = idx;
    if (editorUploadBtn) editorUploadBtn.setAttribute('hidden', 'true');
    if (btnEditorChangePhoto) {
      btnEditorChangePhoto.style.display = 'none';
      btnEditorChangePhoto.setAttribute('hidden', 'true');
    }
    showInspector(idx);
    if (adjPanel) {
      adjPanel.removeAttribute('hidden');
      adjPanel.classList.remove('no-selection');
    }
    renderEditorImage();
  }

  editorScale = 1.0;
  editorPanX = 0;
  editorPanY = 0;
  updateEditorTransform();
}

async function closeFullscreenEditor(saveClicked) {
  if (isSingleEditorMode) {
    if (saveClicked && singleCell) {
      await exportSingleImage(singleCell);
      singleCell = null;
      isSingleEditorMode = false;
    }
    // On X (cancel): keep singleCell in memory for session persistence
  } else {
    // Collage mode — just close
  }
  document.body.classList.remove('in-editor-mode');
  editorOverlay.setAttribute('hidden', 'true');
  hideInspector();
  selectedIdx = -1;
  renderCollage();
}

btnEditorClose?.addEventListener('click', () => closeFullscreenEditor(false));
btnEditorSave?.addEventListener('click', () => closeFullscreenEditor(true));

// Download button — export in original quality without closing editor
btnEditorDownload?.addEventListener('click', async () => {
  const cell = getActiveCell();
  if (!cell) return;
  btnEditorDownload.style.opacity = '0.5';
  btnEditorDownload.style.pointerEvents = 'none';
  try { await exportSingleImage(cell); } finally {
    btnEditorDownload.style.opacity = '1';
    btnEditorDownload.style.pointerEvents = '';
  }
});

// File picker inside single editor
editorFileInput?.addEventListener('change', async e => {
  const file = e.target.files[0];
  editorFileInput.value = '';
  if (!file) return;

  const id = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
  const thumbUrl = URL.createObjectURL(file);
  const dims = await getImageDims(thumbUrl);

  const asset = { id, blob: file, thumbUrl, natW: dims.w, natH: dims.h };
  library.push(asset);
  renderLibrary();
  try { await dbPut({ id, blob: file }); } catch(err) { console.warn('DB save:', err); }

  singleCell = { assetId: id, adj: defaultAdj() };
  if (editorUploadBtn) editorUploadBtn.setAttribute('hidden', 'true');
  if (btnEditorChangePhoto) {
    btnEditorChangePhoto.style.display = 'flex';
    btnEditorChangePhoto.removeAttribute('hidden');
  }
  showInspector(-1);
  if (adjPanel) {
    adjPanel.removeAttribute('hidden');
    adjPanel.classList.remove('no-selection');
  }
  renderEditorImage();
});

function updateEditorTransform() {
  if (editorWrapper) {
    editorWrapper.style.transform = `scale(${editorScale}) translate(${editorPanX}px, ${editorPanY}px)`;
  }
}

function renderEditorImage() {
  if (!editorImgContainer) return;
  editorImgContainer.innerHTML = '';

  const cell = isSingleEditorMode ? singleCell : canvasCells[selectedIdx];
  if (!cell) return;

  const asset = library.find(a => a.id === cell.assetId);
  if (!asset) return;

  const isMobile = window.innerWidth <= 768;
  const vpW = editorViewport.offsetWidth || window.innerWidth;
  const totalH = editorViewport.offsetHeight || window.innerHeight;
  const reservedBottom = (adjPanel && !adjPanel.hidden) ? (isMobile ? 300 : 0) : 0;
  const vpH = Math.max(200, totalH - reservedBottom - 48);
  const natW = asset.natW || 1, natH = asset.natH || 1;
  const ir = natW / natH;

  const activeTagSize = Math.max(8, Math.round(tagSize * 0.6));
  const tagH = (tagEnabled && !isSingleEditorMode) ? Math.round(activeTagSize * 1.5 + 4) : 0;
  const contrastColor = getContrastColor(frameColor);

  let pw, ph, imgH;
  if (ir > vpW / vpH) {
    pw = Math.max(100, vpW - 48);
    imgH = Math.round(pw / ir);
  } else {
    imgH = Math.max(100, vpH - tagH);
    pw = Math.round(imgH * ir);
  }
  ph = tagH + imgH;

  const inner = document.createElement('div');
  inner.className = 'cell-inner';
  inner.style.width = pw + 'px';
  inner.style.height = ph + 'px';
  inner.style.borderRadius = isSingleEditorMode ? '0px' : (radius + 'px');
  inner.style.border = (strokeEnabled && strokeWidth > 0 && !isSingleEditorMode)
    ? (strokeWidth + 'px solid ' + frameColor) : 'none';

  if (tagEnabled && !isSingleEditorMode) {
    const tag = document.createElement('div');
    tag.className = 'cell-tag';
    tag.textContent = '@IMAGE' + (selectedIdx + 1);
    tag.style.fontSize = activeTagSize + 'px';
    tag.style.height = tagH + 'px';
    tag.style.lineHeight = tagH + 'px';
    tag.style.background = frameColor;
    tag.style.color = contrastColor;
    inner.appendChild(tag);
  }

  const imgWrap = document.createElement('div');
  imgWrap.className = 'cell-img-wrapper';
  imgWrap.style.height = imgH + 'px';

  const imgContainer = document.createElement('div');
  imgContainer.className = 'cell-img-container';
  imgContainer.style.position = 'absolute';
  imgContainer.style.left = '0'; imgContainer.style.top = '0';
  imgContainer.style.width = pw + 'px'; imgContainer.style.height = imgH + 'px';

  const img = document.createElement('img');
  img.className = 'cell-img';
  img.src = asset.thumbUrl;
  img.draggable = false;
  img.style.width = '100%'; img.style.height = '100%';
  const filterVal = buildSVGFilter(cell, isSingleEditorMode ? 9999 : selectedIdx);
  if (filterVal) img.style.filter = filterVal;
  imgContainer.appendChild(img);

  // Lines overlay
  if (cell.adj.lines && cell.adj.lines.enabled) {
    const lo = cell.adj.lines;
    const lc = document.createElement('canvas');
    lc.className = 'cell-lines-overlay';
    lc.style.position = 'absolute'; lc.style.pointerEvents = 'none'; lc.style.zIndex = '4';
    let bw = pw, bh = imgH;
    if (lo.mode === 'region' && lo.box) {
      bw = Math.round((lo.box.w / 100) * pw);
      bh = Math.round((lo.box.h / 100) * imgH);
      lc.style.left = lo.box.x + '%'; lc.style.top = lo.box.y + '%';
      lc.style.width = lo.box.w + '%'; lc.style.height = lo.box.h + '%';
    } else {
      lc.style.left = '0'; lc.style.top = '0'; lc.style.width = '100%'; lc.style.height = '100%';
    }
    drawLinesOnCanvas(lc, lo, bw, bh);
    imgContainer.appendChild(lc);
  }

  // Noise overlay
  if (cell.adj.noise && cell.adj.noise.enabled && cell.adj.noise.amount > 0) {
    const no = cell.adj.noise;
    const nd = document.createElement('div');
    nd.className = 'cell-noise-overlay';
    nd.style.backgroundImage = `url(${generateNoiseDataUrl(no.amount)})`;
    if (no.mode === 'region' && no.box) {
      nd.style.left = no.box.x + '%'; nd.style.top = no.box.y + '%';
      nd.style.width = no.box.w + '%'; nd.style.height = no.box.h + '%';
    } else {
      nd.style.left = '0'; nd.style.top = '0'; nd.style.width = '100%'; nd.style.height = '100%';
    }
    imgContainer.appendChild(nd);
  }

  // Region selection box
  const isLR = cell.adj.lines && cell.adj.lines.enabled && cell.adj.lines.mode === 'region';
  const isNR = cell.adj.noise && cell.adj.noise.enabled && cell.adj.noise.mode === 'region';
  const ek = isLR ? 'lines' : (isNR ? 'noise' : null);
  if (ek) {
    const box = cell.adj[ek].box || { x:10, y:10, w:80, h:80 };
    const rb = document.createElement('div');
    rb.className = 'region-box'; rb.dataset.effectKey = ek;
    rb.style.left = box.x + '%'; rb.style.top = box.y + '%';
    rb.style.width = box.w + '%'; rb.style.height = box.h + '%';
    ['nw','ne','sw','se'].forEach(pos => {
      const hd = document.createElement('div');
      hd.className = `region-box-handle rb-${pos}`; hd.dataset.rbHandle = pos;
      rb.appendChild(hd);
    });
    imgContainer.appendChild(rb);
  }

  imgWrap.appendChild(imgContainer);
  inner.appendChild(imgWrap);
  editorImgContainer.appendChild(inner);
}

// High-res export for a single cell
async function exportSingleImage(cell) {
  const asset = library.find(a => a.id === cell.assetId);
  if (!asset) return;

  const img = new Image();
  img.src = asset.thumbUrl;
  await new Promise(r => { img.onload = r; if (img.complete) r(); });

  const w = img.naturalWidth || asset.natW || img.width;
  const h = img.naturalHeight || asset.natH || img.height;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');

  // Color adjustments via SVG filter
  const fId = 'export-single-filter';
  let oldF = document.getElementById(fId); if (oldF) oldF.remove();
  const adj = cell.adj;
  const b = adj.brightness/100, c = adj.contrast/100;
  const rM = adj.r/100, gM = adj.g/100, bM = adj.b/100;
  const cOff = (1 - c) * 0.5;
  const filter = document.createElementNS('http://www.w3.org/2000/svg','filter');
  filter.id = fId;
  filter.innerHTML = `<feColorMatrix type="matrix" values="${(rM*c*b).toFixed(3)} 0 0 0 ${cOff.toFixed(3)} 0 ${(gM*c*b).toFixed(3)} 0 0 ${cOff.toFixed(3)} 0 0 ${(bM*c*b).toFixed(3)} 0 ${cOff.toFixed(3)} 0 0 0 1 0"/>`;
  document.querySelector('#svg-filters defs').appendChild(filter);

  ctx.filter = `url(#${fId})`;
  ctx.drawImage(img, 0, 0, w, h);
  ctx.filter = 'none';

  // Lines
  if (adj.lines && adj.lines.enabled) {
    let bw = w, bh = h, ox = 0, oy = 0;
    if (adj.lines.mode === 'region' && adj.lines.box) {
      bw = Math.round((adj.lines.box.w/100)*w);
      bh = Math.round((adj.lines.box.h/100)*h);
      ox = Math.round((adj.lines.box.x/100)*w);
      oy = Math.round((adj.lines.box.y/100)*h);
    }
    const lc = document.createElement('canvas');
    drawLinesOnCanvas(lc, adj.lines, bw, bh);
    ctx.drawImage(lc, ox, oy, bw, bh);
  }

  // Noise
  if (adj.noise && adj.noise.enabled && adj.noise.amount > 0) {
    let bw = w, bh = h, ox = 0, oy = 0;
    if (adj.noise.mode === 'region' && adj.noise.box) {
      bw = Math.round((adj.noise.box.w/100)*w);
      bh = Math.round((adj.noise.box.h/100)*h);
      ox = Math.round((adj.noise.box.x/100)*w);
      oy = Math.round((adj.noise.box.y/100)*h);
    }
    const ni = new Image();
    ni.src = generateNoiseDataUrl(adj.noise.amount);
    await new Promise(r => { ni.onload = r; if (ni.complete) r(); });
    ctx.drawImage(ni, ox, oy, bw, bh);
  }

  const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.95));
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `photo-edited-${Date.now()}.jpg`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  filter.remove();
}



/* ---- Editor Zoom & Pan (PointerEvents multi-touch) ---- */
let isPanningEditor = false;
let activePointers = [];
let prevDiff = -1;
let startScale = 1.0;
let startPanX = 0, startPanY = 0;
let startMidX = 0, startMidY = 0;
let edPanStartX = 0, edPanStartY = 0;
let edPanInitX = 0, edPanInitY = 0;

editorViewport?.addEventListener('pointerdown', e => {
  const rbHandle = e.target.closest('.region-box-handle');
  const rbBox    = e.target.closest('.region-box');
  const cell = getActiveCell();

  // 1-FINGER TOUCH / CLICK ON REGION BOX OR HANDLES
  if (rbBox && cell && activePointers.length === 0) {
    const effectKey = rbBox.dataset.effectKey || 'lines';
    const imgWrap = rbBox.closest('.cell-img-wrapper');
    const wr = imgWrap ? imgWrap.getBoundingClientRect() : { width: 100, height: 100 };
    const bs = cell.adj[effectKey].box || { x:10, y:10, w:80, h:80 };

    interaction.active = true;
    interaction.cellIdx = isSingleEditorMode ? -1 : selectedIdx;
    interaction.mode = rbHandle ? 'rb_resize' : 'rb_move';
    interaction.rbEdge = rbHandle ? rbHandle.dataset.rbHandle : '';
    interaction.rbEffectKey = effectKey;
    interaction.startMouseX = e.clientX; interaction.startMouseY = e.clientY;
    interaction.startBoxX = bs.x; interaction.startBoxY = bs.y;
    interaction.startBoxW = bs.w; interaction.startBoxH = bs.h;
    interaction.wrapW = wr.width || 100; interaction.wrapH = wr.height || 100;
    try { editorViewport.setPointerCapture(e.pointerId); } catch(_){}
    e.preventDefault();
    return;
  }

  activePointers.push(e);

  if (activePointers.length === 2) {
    // 2-FINGERS GESTURE: Pan & Pinch-to-zoom the whole image
    interaction.active = false;
    isPanningEditor = true;
    const p1 = activePointers[0], p2 = activePointers[1];
    prevDiff = Math.hypot(p1.clientX - p2.clientX, p1.clientY - p2.clientY);
    startScale = editorScale;
    startMidX = (p1.clientX + p2.clientX)/2; startMidY = (p1.clientY + p2.clientY)/2;
    startPanX = editorPanX; startPanY = editorPanY;
  } else if (activePointers.length === 1 && e.pointerType === 'mouse') {
    // Desktop mouse: 1-click drag pans the image if not on region box
    isPanningEditor = true;
    edPanStartX = e.clientX; edPanStartY = e.clientY;
    edPanInitX = editorPanX; edPanInitY = editorPanY;
    editorViewport.style.cursor = 'grabbing';
  }
  try { editorViewport.setPointerCapture(e.pointerId); } catch(_){}
  e.preventDefault();
});

editorViewport?.addEventListener('pointermove', e => {
  const idx = activePointers.findIndex(p => p.pointerId === e.pointerId);
  if (idx >= 0) activePointers[idx] = e;
  const cell = getActiveCell();

  // 1-FINGER REGION BOX MANIPULATION
  if (interaction.active && cell) {
    const dx = e.clientX - interaction.startMouseX;
    const dy = e.clientY - interaction.startMouseY;
    const dxP = (dx / (interaction.wrapW * editorScale)) * 100;
    const dyP = (dy / (interaction.wrapH * editorScale)) * 100;

    const keys = [];
    if (cell.adj.lines && cell.adj.lines.mode === 'region') keys.push('lines');
    if (cell.adj.noise && cell.adj.noise.mode === 'region') keys.push('noise');
    if (!keys.length) keys.push(interaction.rbEffectKey);

    for (const k of keys) {
      const b = cell.adj[k].box || { x:10, y:10, w:80, h:80 };
      if (interaction.mode === 'rb_move') {
        b.x = clamp(interaction.startBoxX + dxP, 0, 100 - b.w);
        b.y = clamp(interaction.startBoxY + dyP, 0, 100 - b.h);
      } else {
        const edge = interaction.rbEdge;
        if (edge === 'se') {
          b.w = clamp(interaction.startBoxW + dxP, 10, 100 - b.x);
          b.h = clamp(interaction.startBoxH + dyP, 10, 100 - b.y);
        } else if (edge === 'sw') {
          const nw = clamp(interaction.startBoxW - dxP, 10, interaction.startBoxX + interaction.startBoxW);
          b.x = interaction.startBoxX + (interaction.startBoxW - nw); b.w = nw;
          b.h = clamp(interaction.startBoxH + dyP, 10, 100 - b.y);
        } else if (edge === 'ne') {
          b.w = clamp(interaction.startBoxW + dxP, 10, 100 - b.x);
          const nh = clamp(interaction.startBoxH - dyP, 10, interaction.startBoxY + interaction.startBoxH);
          b.y = interaction.startBoxY + (interaction.startBoxH - nh); b.h = nh;
        } else if (edge === 'nw') {
          const nw = clamp(interaction.startBoxW - dxP, 10, interaction.startBoxX + interaction.startBoxW);
          const nh = clamp(interaction.startBoxH - dyP, 10, interaction.startBoxY + interaction.startBoxH);
          b.x = interaction.startBoxX + (interaction.startBoxW - nw); b.w = nw;
          b.y = interaction.startBoxY + (interaction.startBoxH - nh); b.h = nh;
        }
      }
    }
    renderEditorImage();
    return;
  }

  // 2-FINGERS (Touch) OR 1-Mouse Drag IMAGE PANNING & PINCH-ZOOMING
  if (activePointers.length === 2) {
    const p1 = activePointers[0], p2 = activePointers[1];
    const cd = Math.hypot(p1.clientX - p2.clientX, p1.clientY - p2.clientY);
    if (prevDiff > 0) {
      editorScale = Math.max(0.4, Math.min(4.0, Math.round(startScale * (cd / prevDiff) * 100) / 100));
    }
    const cmx = (p1.clientX + p2.clientX)/2, cmy = (p1.clientY + p2.clientY)/2;
    editorPanX = startPanX + (cmx - startMidX);
    editorPanY = startPanY + (cmy - startMidY);
    updateEditorTransform();
  } else if (activePointers.length === 1 && isPanningEditor && e.pointerType === 'mouse') {
    editorPanX = edPanInitX + (e.clientX - edPanStartX) / editorScale;
    editorPanY = edPanInitY + (e.clientY - edPanStartY) / editorScale;
    updateEditorTransform();
  }
});

editorViewport?.addEventListener('pointerup', e => {
  activePointers = activePointers.filter(p => p.pointerId !== e.pointerId);
  if (activePointers.length < 2) prevDiff = -1;
  if (!activePointers.length) { isPanningEditor = false; editorViewport.style.cursor = ''; }
  if (interaction.active) interaction.active = false;
  try { editorViewport.releasePointerCapture(e.pointerId); } catch(_){}
});

editorViewport?.addEventListener('pointercancel', e => {
  activePointers = activePointers.filter(p => p.pointerId !== e.pointerId);
  if (activePointers.length < 2) prevDiff = -1;
  if (!activePointers.length) { isPanningEditor = false; editorViewport.style.cursor = ''; }
  interaction.active = false;
});

editorViewport?.addEventListener('wheel', e => {
  e.preventDefault();
  editorScale = Math.max(0.4, Math.min(4.0, Math.round((editorScale + (e.deltaY < 0 ? 0.1 : -0.1)) * 10) / 10));
  updateEditorTransform();
}, { passive: false });


const btnMobileExportDock = $('#btn-mobile-export-dock');
btnMobileExportDock?.addEventListener('click', () => {
  document.getElementById('export-modal')?.removeAttribute('hidden');
});

window.addEventListener('resize', () => {
  if (isMobileUI()) {
    updateFrameSize();
  }
});
window.addEventListener('orientationchange', () => {
  setTimeout(() => {
    updateFrameSize();
  }, 150);
});
