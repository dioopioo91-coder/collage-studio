/* ============================================================
   Collage Studio — Application Logic
   ALL LAYOUT IS ABSOLUTE POSITIONED (no flex/grid collapse)
   ============================================================ */
'use strict';

/* ---- HELPERS ---- */
const $ = (s, p) => (p || document).querySelector(s);
const $$ = (s, p) => [...(p || document).querySelectorAll(s)];

/* ---- DB ---- */
const DB_NAME = 'CollageStudioDB_v4';
const DB_VER  = 1;
const STORE   = 'assets';
let db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => { db = req.result; resolve(db); };
    req.onerror = () => reject(req.error);
  });
}
function dbPut(item)  { return new Promise((y,n) => { const t = db.transaction(STORE,'readwrite').objectStore(STORE).put(item); t.onsuccess=()=>y(); t.onerror=()=>n(t.error); }); }
function dbDel(id)    { return new Promise((y,n) => { const t = db.transaction(STORE,'readwrite').objectStore(STORE).delete(id); t.onsuccess=()=>y(); t.onerror=()=>n(t.error); }); }
function dbClear()    { return new Promise((y,n) => { const t = db.transaction(STORE,'readwrite').objectStore(STORE).clear();    t.onsuccess=()=>y(); t.onerror=()=>n(t.error); }); }
function dbGetAll()   { return new Promise((y,n) => { const t = db.transaction(STORE,'readonly' ).objectStore(STORE).getAll();   t.onsuccess=()=>y(t.result); t.onerror=()=>n(t.error); }); }

/* ---- STATE ---- */
let library    = [];   // {id, blob, thumbUrl, natW, natH}
let canvasCells = [];  // {assetId, adj:{brightness,contrast,r,g,b}}
let selectedIdx = -1;
let frameColor  = '#ffffff';
let strokeWidth = 3;

const defaultAdj = () => ({ brightness:100, contrast:100, r:100, g:100, b:100 });

/* ---- COLOR HELPERS ---- */
function getContrastColor(hex) {
  const r = parseInt(hex.slice(1,3), 16);
  const g = parseInt(hex.slice(3,5), 16);
  const b = parseInt(hex.slice(5,7), 16);
  return `rgb(${255 - r}, ${255 - g}, ${255 - b})`;
}

function getImageDims(url) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve({ w: 1, h: 1 });
    img.src = url;
  });
}

/* ---- DOM ---- */
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

// Sliders
const sGap     = $('#collage-gap');
const sRadius  = $('#border-radius');
const sTagSize = $('#tag-size');
const sRatio   = $('#aspect-ratio');

const vGap     = $('#gap-val');
const vRadius  = $('#radius-val');
const vTagSize = $('#tag-size-val');

const adjSliders = {
  brightness: { el: $('#adj-brightness'), val: $('#adj-brightness-val') },
  contrast:   { el: $('#adj-contrast'),   val: $('#adj-contrast-val') },
  r:          { el: $('#adj-r'),          val: $('#adj-r-val') },
  g:          { el: $('#adj-g'),          val: $('#adj-g-val') },
  b:          { el: $('#adj-b'),          val: $('#adj-b-val') },
};

/* ---- COLLAGE SETTINGS ---- */
let gap    = 10;
let radius = 10;
let tagSize = 18;

const sFrameColor  = $('#frame-color');
const vFrameColor  = $('#frame-color-val');
const sFrameStroke = $('#frame-stroke');
const vFrameStroke = $('#frame-stroke-val');

function getRatio() {
  const v = sRatio.value.split(':').map(Number);
  return v[0] / v[1];
}

/* ---- LAYOUT CALCULATIONS ---- */
// Given N items, compute { rects: [{x,y,w,h}], cols, rows }
// All values in FRACTION of [0..1] range (relative to canvas)
function computeLayout(n) {
  if (n === 0) return { rects: [], cols: 0, rows: 0 };
  if (n === 1) return { rects: [{ x: 0, y: 0, w: 1, h: 1 }], cols: 1, rows: 1 };

  // For 2 items: side by side
  if (n === 2) return {
    rects: [
      { x: 0,   y: 0, w: 0.5, h: 1 },
      { x: 0.5, y: 0, w: 0.5, h: 1 }
    ], cols: 2, rows: 1
  };

  // For 3: left half tall, right half two stacked
  if (n === 3) return {
    rects: [
      { x: 0,   y: 0,   w: 0.5, h: 1 },
      { x: 0.5, y: 0,   w: 0.5, h: 0.5 },
      { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }
    ], cols: 2, rows: 2
  };

  // For 4: 2×2 grid
  if (n === 4) return {
    rects: [
      { x: 0,   y: 0,   w: 0.5, h: 0.5 },
      { x: 0.5, y: 0,   w: 0.5, h: 0.5 },
      { x: 0,   y: 0.5, w: 0.5, h: 0.5 },
      { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }
    ], cols: 2, rows: 2
  };

  // For 5: top row 3, bottom row 2
  if (n === 5) return {
    rects: [
      { x: 0,       y: 0,   w: 1/3, h: 0.5 },
      { x: 1/3,     y: 0,   w: 1/3, h: 0.5 },
      { x: 2/3,     y: 0,   w: 1/3, h: 0.5 },
      { x: 0,       y: 0.5, w: 0.5, h: 0.5 },
      { x: 0.5,     y: 0.5, w: 0.5, h: 0.5 }
    ], cols: 3, rows: 2
  };

  // For 6: 3×2
  if (n === 6) return {
    rects: [
      { x: 0,   y: 0,   w: 1/3, h: 0.5 },
      { x: 1/3, y: 0,   w: 1/3, h: 0.5 },
      { x: 2/3, y: 0,   w: 1/3, h: 0.5 },
      { x: 0,   y: 0.5, w: 1/3, h: 0.5 },
      { x: 1/3, y: 0.5, w: 1/3, h: 0.5 },
      { x: 2/3, y: 0.5, w: 1/3, h: 0.5 }
    ], cols: 3, rows: 2
  };

  // For 7+: auto grid with cols = ceil(sqrt(n)), rows = ceil(n/cols)
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const rects = [];
  for (let i = 0; i < n; i++) {
    const c = i % cols;
    const r = Math.floor(i / cols);
    // last row may have fewer items — center them
    const itemsInRow = (r === rows - 1) ? (n - r * cols) : cols;
    const cellW = 1 / itemsInRow;
    const cellH = 1 / rows;
    const offsetX = (r === rows - 1 && itemsInRow < cols) ? (1 - itemsInRow * cellW) / 2 : 0;
    rects.push({
      x: offsetX + (c * cellW),
      y: r * cellH,
      w: cellW,
      h: cellH
    });
  }
  return { rects, cols, rows };
}


/* ---- CANVAS FRAME SIZING ---- */
function updateFrameSize() {
  const vp = viewport.getBoundingClientRect();
  const pad = 40;
  const availW = Math.max(200, vp.width - pad * 2);
  const availH = Math.max(150, vp.height - pad * 2);
  const ratio  = getRatio();

  let w, h;
  if (availW / availH > ratio) {
    h = availH;
    w = h * ratio;
  } else {
    w = availW;
    h = w / ratio;
  }
  frame.style.width  = Math.round(w) + 'px';
  frame.style.height = Math.round(h) + 'px';
}

/* ---- SVG FILTERS ---- */
function buildSVGFilter(cell, idx) {
  const adj = cell.adj;
  const filterId = 'imgf-' + idx;
  const defs = document.querySelector('#svg-filters defs');
  let existing = document.getElementById(filterId);
  if (existing) existing.remove();

  const hasCustom = adj.brightness !== 100 || adj.contrast !== 100 || adj.r !== 100 || adj.g !== 100 || adj.b !== 100;
  if (!hasCustom) return '';

  const b = adj.brightness / 100;
  const c = adj.contrast / 100;
  const rM = adj.r / 100;
  const gM = adj.g / 100;
  const bM = adj.b / 100;

  // Combine brightness + contrast + RGB via feColorMatrix
  const cOff = (1 - c) * 0.5;
  const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
  filter.id = filterId;
  filter.innerHTML = `
    <feColorMatrix type="matrix" values="
      ${(rM * c * b).toFixed(3)} 0 0 0 ${cOff.toFixed(3)}
      0 ${(gM * c * b).toFixed(3)} 0 0 ${cOff.toFixed(3)}
      0 0 ${(bM * c * b).toFixed(3)} 0 ${cOff.toFixed(3)}
      0 0 0 1 0
    "/>`;
  defs.appendChild(filter);
  return `url(#${filterId})`;
}

/* ---- RENDER COLLAGE ---- */
function renderCollage() {
  const n = canvasCells.length;

  // Show/hide empty state
  emptyState.style.display = n === 0 ? 'flex' : 'none';

  // Clear all cells
  collage.innerHTML = '';

  if (n === 0) {
    canvasInfo.textContent = '0 images';
    return;
  }
  canvasInfo.textContent = n + ' image' + (n > 1 ? 's' : '');

  // Get frame pixel size
  const fw = frame.offsetWidth;
  const fh = frame.offsetHeight;

  const layout = computeLayout(n);

  const contrastColor = getContrastColor(frameColor);

  for (let i = 0; i < n; i++) {
    const cell = canvasCells[i];
    const rect = layout.rects[i];
    const asset = library.find(a => a.id === cell.assetId);
    if (!asset) continue;

    // Cell area (full slot)
    const halfGap = gap / 2;
    const px = rect.x * fw + halfGap;
    const py = rect.y * fh + halfGap;
    const pw = rect.w * fw - gap;
    const ph = rect.h * fh - gap;

    // Tag height (tag sits ABOVE the image, not on it)
    const tagH = Math.round(tagSize * 1.6 + 6);

    // Available height for image (cell height minus tag)
    const availH = ph - tagH;
    if (availH <= 0) continue;

    // Calculate actual image bounds within available area (contain)
    const natW = asset.natW || 1;
    const natH = asset.natH || 1;
    const ir = natW / natH;
    const cr = pw / availH;
    let imgW, imgH;
    if (ir > cr) {
      imgW = pw; imgH = pw / ir;
    } else {
      imgH = availH; imgW = availH * ir;
    }

    // Frame position: centered horizontally, frame = tag + image stacked
    const frameW = imgW;
    const frameH = tagH + imgH;
    const frameX = (pw - frameW) / 2;
    const frameY = (ph - frameH) / 2;

    // Cell container (transparent, just positioning)
    const div = document.createElement('div');
    div.className = 'cell' + (i === selectedIdx ? ' selected' : '');
    div.style.left   = px + 'px';
    div.style.top    = py + 'px';
    div.style.width  = pw + 'px';
    div.style.height = ph + 'px';
    div.dataset.idx = i;

    // Frame — wraps tag + image
    const frm = document.createElement('div');
    frm.className = 'cell-frame';
    frm.style.left   = frameX + 'px';
    frm.style.top    = frameY + 'px';
    frm.style.width  = frameW + 'px';
    frm.style.height = frameH + 'px';
    frm.style.border = strokeWidth + 'px solid ' + frameColor;
    frm.style.borderRadius = radius + 'px';

    // Tag — ABOVE the image, as a header bar
    const tag = document.createElement('div');
    tag.className = 'cell-tag';
    tag.textContent = '@IMAGE' + (i + 1);
    tag.style.fontSize = tagSize + 'px';
    tag.style.height = tagH + 'px';
    tag.style.lineHeight = tagH + 'px';
    tag.style.padding = '0';
    tag.style.background = frameColor;
    tag.style.color = contrastColor;
    frm.appendChild(tag);

    // Image — below the tag, fills remaining frame space
    const img = document.createElement('img');
    img.className = 'cell-img';
    img.src = asset.thumbUrl;
    img.draggable = false;
    img.style.height = imgH + 'px';
    const filterVal = buildSVGFilter(cell, i);
    if (filterVal) img.style.filter = filterVal;
    frm.appendChild(img);

    div.appendChild(frm);

    // Controls (positioned at bottom-right of frame)
    const controls = document.createElement('div');
    controls.className = 'cell-controls';
    controls.style.bottom = (ph - frameY - frameH + 6) + 'px';
    controls.style.right = (pw - frameX - frameW + 6) + 'px';

    if (i > 0) {
      const btnL = document.createElement('button');
      btnL.className = 'cell-btn';
      btnL.innerHTML = '◂';
      btnL.title = 'Move left';
      btnL.addEventListener('click', e => { e.stopPropagation(); swapCells(i, i - 1); });
      controls.appendChild(btnL);
    }
    if (i < n - 1) {
      const btnR = document.createElement('button');
      btnR.className = 'cell-btn';
      btnR.innerHTML = '▸';
      btnR.title = 'Move right';
      btnR.addEventListener('click', e => { e.stopPropagation(); swapCells(i, i + 1); });
      controls.appendChild(btnR);
    }
    const btnDel = document.createElement('button');
    btnDel.className = 'cell-btn remove';
    btnDel.innerHTML = '✕';
    btnDel.title = 'Remove';
    btnDel.addEventListener('click', e => { e.stopPropagation(); removeCell(i); });
    controls.appendChild(btnDel);

    div.appendChild(controls);

    div.addEventListener('click', () => selectCell(i));
    div.draggable = true;
    div.addEventListener('dragstart', e => onCellDragStart(e, i));
    div.addEventListener('dragover',  e => onCellDragOver(e, i));
    div.addEventListener('drop',      e => onCellDrop(e, i));
    div.addEventListener('dragend',   onCellDragEnd);

    collage.appendChild(div);
  }
}

/* ---- CELL OPERATIONS ---- */
function swapCells(a, b) {
  [canvasCells[a], canvasCells[b]] = [canvasCells[b], canvasCells[a]];
  if (selectedIdx === a) selectedIdx = b;
  else if (selectedIdx === b) selectedIdx = a;
  renderCollage();
}

function removeCell(idx) {
  canvasCells.splice(idx, 1);
  if (selectedIdx === idx) { selectedIdx = -1; hideInspector(); }
  else if (selectedIdx > idx) selectedIdx--;
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

/* ---- DRAG REORDER ---- */
let dragSrcIdx = -1;
function onCellDragStart(e, idx) {
  dragSrcIdx = idx;
  e.dataTransfer.effectAllowed = 'move';
  requestAnimationFrame(() => {
    const el = collage.querySelector(`[data-idx="${idx}"]`);
    if (el) el.classList.add('dragging');
  });
}
function onCellDragOver(e, idx) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  $$('.cell', collage).forEach(c => c.classList.remove('drag-target'));
  const el = collage.querySelector(`[data-idx="${idx}"]`);
  if (el && idx !== dragSrcIdx) el.classList.add('drag-target');
}
function onCellDrop(e, idx) {
  e.preventDefault();
  if (dragSrcIdx >= 0 && dragSrcIdx !== idx) {
    swapCells(dragSrcIdx, idx);
  }
  dragSrcIdx = -1;
}
function onCellDragEnd() {
  dragSrcIdx = -1;
  $$('.cell', collage).forEach(c => { c.classList.remove('dragging'); c.classList.remove('drag-target'); });
}

/* ---- INSPECTOR ---- */
function showInspector(idx) {
  const cell = canvasCells[idx];
  if (!cell) return;
  adjPanel.hidden = false;
  $('#adj-title').textContent = '@IMAGE' + (idx + 1);
  for (const key of Object.keys(adjSliders)) {
    adjSliders[key].el.value = cell.adj[key];
    adjSliders[key].val.textContent = cell.adj[key] + '%';
  }
}

function hideInspector() {
  adjPanel.hidden = true;
}

function updateAdj(key) {
  if (selectedIdx < 0 || !canvasCells[selectedIdx]) return;
  canvasCells[selectedIdx].adj[key] = parseInt(adjSliders[key].el.value);
  adjSliders[key].val.textContent = adjSliders[key].el.value + '%';
  renderCollage();
}

$('#btn-reset-adj').addEventListener('click', () => {
  if (selectedIdx < 0) return;
  canvasCells[selectedIdx].adj = defaultAdj();
  showInspector(selectedIdx);
  renderCollage();
});

$('#btn-remove-cell').addEventListener('click', () => {
  if (selectedIdx >= 0) removeCell(selectedIdx);
});

$('#btn-deselect').addEventListener('click', () => {
  selectedIdx = -1;
  hideInspector();
  renderCollage();
});

for (const key of Object.keys(adjSliders)) {
  adjSliders[key].el.addEventListener('input', () => updateAdj(key));
}

/* ---- LIBRARY ---- */
function renderLibrary() {
  libGrid.innerHTML = '';
  libEmpty.style.display = library.length === 0 ? 'block' : 'none';
  libCount.textContent = library.length;
  for (const item of library) {
    const card = document.createElement('div');
    card.className = 'lib-card';

    const img = document.createElement('img');
    img.src = item.thumbUrl;
    img.loading = 'lazy';
    card.appendChild(img);

    const del = document.createElement('button');
    del.className = 'lib-del-btn';
    del.textContent = '✕';
    del.addEventListener('click', e => { e.stopPropagation(); removeFromLibrary(item.id); });
    card.appendChild(del);

    card.addEventListener('click', () => addToCollage(item.id));
    libGrid.appendChild(card);
  }
}

function addToCollage(assetId) {
  canvasCells.push({ assetId, adj: defaultAdj() });
  renderCollage();
}

async function removeFromLibrary(id) {
  // Remove from canvas first
  canvasCells = canvasCells.filter(c => c.assetId !== id);
  if (selectedIdx >= canvasCells.length) { selectedIdx = -1; hideInspector(); }
  // Remove from library
  const item = library.find(a => a.id === id);
  if (item && item.thumbUrl) URL.revokeObjectURL(item.thumbUrl);
  library = library.filter(a => a.id !== id);
  await dbDel(id);
  renderLibrary();
  renderCollage();
}

/* ---- FILE UPLOAD (BATCH: multiple files, library only) ---- */
async function handleFiles(files) {
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;
    const id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
    const blob = file;
    const thumbUrl = URL.createObjectURL(blob);
    const dims = await getImageDims(thumbUrl);
    const item = { id, blob, thumbUrl, natW: dims.w, natH: dims.h };
    library.push(item);
    try { await dbPut({ id, blob }); } catch(e) { console.warn('DB save failed:', e); }
  }
  renderLibrary();
}

fileInput.addEventListener('change', e => {
  const files = Array.from(e.target.files);  // snapshot — FileList is live, must copy before clearing
  fileInput.value = '';
  handleFiles(files);
});
$('#btn-upload').addEventListener('click', () => fileInput.click());

/* ---- DRAG & DROP FILES ONTO CANVAS ---- */
viewport.addEventListener('dragover', e => { e.preventDefault(); frame.classList.add('drag-over'); });
viewport.addEventListener('dragleave', () => frame.classList.remove('drag-over'));
viewport.addEventListener('drop', e => {
  e.preventDefault();
  frame.classList.remove('drag-over');
  if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
});

/* ---- TOOLBAR EVENTS ---- */
sGap.addEventListener('input', () => { gap = parseInt(sGap.value); vGap.textContent = gap + 'px'; renderCollage(); });
sRadius.addEventListener('input', () => { radius = parseInt(sRadius.value); vRadius.textContent = radius + 'px'; renderCollage(); });
sTagSize.addEventListener('input', () => { tagSize = parseInt(sTagSize.value); vTagSize.textContent = tagSize + 'px'; renderCollage(); });
sRatio.addEventListener('change', () => { updateFrameSize(); renderCollage(); });
sFrameColor.addEventListener('input', () => { frameColor = sFrameColor.value; vFrameColor.textContent = frameColor.toUpperCase().replace(/^#(.)\1(.)\2(.)\3$/, '#$1$2$3'); renderCollage(); });
sFrameStroke.addEventListener('input', () => { strokeWidth = parseInt(sFrameStroke.value); vFrameStroke.textContent = strokeWidth + 'px'; renderCollage(); });

$('#btn-clear-canvas').addEventListener('click', () => {
  canvasCells = [];
  selectedIdx = -1;
  hideInspector();
  renderCollage();
});

$('#btn-add-all').addEventListener('click', () => {
  for (const item of library) {
    // Avoid duplicating if already in canvas
    canvasCells.push({ assetId: item.id, adj: defaultAdj() });
  }
  renderCollage();
});

$('#btn-clear-lib').addEventListener('click', async () => {
  canvasCells = [];
  selectedIdx = -1;
  hideInspector();
  for (const item of library) {
    if (item.thumbUrl) URL.revokeObjectURL(item.thumbUrl);
  }
  library = [];
  await dbClear();
  renderLibrary();
  renderCollage();
});

/* ---- EXPORT 8K ---- */
$('#btn-export').addEventListener('click', exportCollage);
$('#btn-close-modal').addEventListener('click', () => { exportModal.hidden = true; });

async function exportCollage() {
  if (canvasCells.length === 0) return;
  exportModal.hidden = false;
  $('#btn-close-modal').hidden = true;
  exportProg.style.width = '0%';
  exportStatus.textContent = 'Preparing canvas…';

  await sleep(50);

  // Target: 8K width (7680) at current aspect ratio
  const ratio = getRatio();
  let targetW = 7680;
  let targetH = Math.round(targetW / ratio);

  // If too wide/tall > cap
  if (targetW * targetH > 7680 * 4320) {
    targetH = 4320;
    targetW = Math.round(targetH * ratio);
  }

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#121215';
  ctx.fillRect(0, 0, targetW, targetH);

  const n = canvasCells.length;
  const layout = computeLayout(n);
  const scale = targetW / frame.offsetWidth;
  const gapPx = gap * scale;
  const halfGap = gapPx / 2;
  const radPx = radius * scale;
  const tagPx = tagSize * scale;
  const strokePx = strokeWidth * scale;
  const contrastColor = getContrastColor(frameColor);

  for (let i = 0; i < n; i++) {
    const cell = canvasCells[i];
    const rect = layout.rects[i];
    const asset = library.find(a => a.id === cell.assetId);
    if (!asset) continue;

    exportProg.style.width = ((i + 1) / n * 80) + '%';
    exportStatus.textContent = `Rendering image ${i + 1} / ${n}…`;

    const px = rect.x * targetW + halfGap;
    const py = rect.y * targetH + halfGap;
    const pw = rect.w * targetW - gapPx;
    const ph = rect.h * targetH - gapPx;

    // Tag above image — same calculation as preview
    const tagH = Math.round(tagPx * 1.6 + 6 * scale);
    const availH = ph - tagH;
    if (availH <= 0) continue;

    const natW = asset.natW || 1;
    const natH = asset.natH || 1;
    const ir = natW / natH;
    const cr = pw / availH;
    let imgW, imgH;
    if (ir > cr) { imgW = pw; imgH = pw / ir; }
    else { imgH = availH; imgW = availH * ir; }

    const frameW = imgW;
    const frameH = tagH + imgH;
    const frameX = px + (pw - frameW) / 2;
    const frameY = py + (ph - frameH) / 2;

    // Load full image from blob
    const img = await loadImage(asset.blob instanceof Blob ? URL.createObjectURL(asset.blob) : asset.thumbUrl);

    // Draw frame background (clipped to rounded rect)
    ctx.save();
    roundRect(ctx, frameX, frameY, frameW, frameH, radPx);
    ctx.clip();

    // Tag header
    ctx.fillStyle = frameColor;
    ctx.fillRect(frameX, frameY, frameW, tagH);
    ctx.fillStyle = contrastColor;
    ctx.font = `900 ${tagPx}px Inter, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('@IMAGE' + (i + 1), frameX + frameW / 2, frameY + tagH / 2);

    // Image below tag
    const imgX = frameX;
    const imgY = frameY + tagH;
    const adj = cell.adj;
    ctx.filter = `brightness(${adj.brightness}%) contrast(${adj.contrast}%)`;
    drawContain(ctx, img, imgX, imgY, imgW, imgH);
    ctx.filter = 'none';

    if (adj.r !== 100 || adj.g !== 100 || adj.b !== 100) {
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = `rgb(${Math.round(adj.r * 2.55)}, ${Math.round(adj.g * 2.55)}, ${Math.round(adj.b * 2.55)})`;
      ctx.fillRect(imgX, imgY, imgW, imgH);
      ctx.globalCompositeOperation = 'source-over';
    }

    ctx.restore();

    // Frame border
    ctx.strokeStyle = frameColor;
    ctx.lineWidth = strokePx;
    ctx.beginPath();
    roundRect(ctx, frameX, frameY, frameW, frameH, radPx);
    ctx.stroke();

    if (asset.blob instanceof Blob) URL.revokeObjectURL(img.src);
    await sleep(10);
  }

  exportProg.style.width = '90%';
  exportStatus.textContent = 'Compressing…';
  await sleep(30);

  // JPEG quality loop to stay under 10 MB
  let quality = 0.95;
  let blob;
  do {
    blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', quality));
    if (blob.size > 10 * 1024 * 1024) quality -= 0.05;
    else break;
  } while (quality > 0.3);

  exportProg.style.width = '100%';
  const sizeMB = (blob.size / 1024 / 1024).toFixed(2);
  exportStatus.textContent = `Done! ${targetW}×${targetH} — ${sizeMB} MB`;

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `collage_${targetW}x${targetH}.jpg`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
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
  // Draw image fully visible (no crop), centered in cell with background
  const ir = img.naturalWidth / img.naturalHeight;
  const cr = w / h;
  let dw, dh, dx, dy;
  if (ir > cr) {
    // Image wider than cell — fit to width
    dw = w;
    dh = w / ir;
    dx = x;
    dy = y + (h - dh) / 2;
  } else {
    // Image taller than cell — fit to height
    dh = h;
    dw = h * ir;
    dx = x + (w - dw) / 2;
    dy = y;
  }
  // Fill cell background first
  ctx.fillStyle = '#111116';
  ctx.fillRect(x, y, w, h);
  ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, dx, dy, dw, dh);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/* ---- WINDOW RESIZE ---- */
window.addEventListener('resize', () => { updateFrameSize(); renderCollage(); });

/* ---- INIT ---- */
(async function init() {
  await openDB();
  const items = await dbGetAll();
  for (const item of items) {
    const thumbUrl = URL.createObjectURL(item.blob);
    const dims = await getImageDims(thumbUrl);
    library.push({ id: item.id, blob: item.blob, thumbUrl, natW: dims.w, natH: dims.h });
  }
  renderLibrary();
  updateFrameSize();
  renderCollage();
})();
