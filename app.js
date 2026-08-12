/* ============================================================
   Collage Studio — Application Logic
   FREE-FORM LAYOUT: drag tag=move, drag center=swap, drag border=resize
   ============================================================ */
'use strict';

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
let library     = [];  // {id, blob, thumbUrl, natW, natH}
let canvasCells = [];  // {assetId, adj, fx, fy, fw, fh}  — fractions 0..1
let selectedIdx = -1;
let frameColor  = '#ffffff';
let strokeWidth = 3;

const defaultAdj = () => ({ brightness:100, contrast:100, r:100, g:100, b:100 });

/* ---- COLOR HELPERS ---- */
function getContrastColor(hex) {
  const r = parseInt(hex.slice(1,3), 16);
  const g = parseInt(hex.slice(3,5), 16);
  const b = parseInt(hex.slice(5,7), 16);
  return `rgb(${255-r},${255-g},${255-b})`;
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

const sGap     = $('#collage-gap');
const sRadius  = $('#border-radius');
const sTagSize = $('#tag-size');
const sRatio   = $('#aspect-ratio');
const vGap     = $('#gap-val');
const vRadius  = $('#radius-val');
const vTagSize = $('#tag-size-val');

const sFrameColor  = $('#frame-color');
const vFrameColor  = $('#frame-color-val');
const sFrameStroke = $('#frame-stroke');
const vFrameStroke = $('#frame-stroke-val');

const adjSliders = {
  brightness: { el: $('#adj-brightness'), val: $('#adj-brightness-val') },
  contrast:   { el: $('#adj-contrast'),   val: $('#adj-contrast-val') },
  r:          { el: $('#adj-r'),          val: $('#adj-r-val') },
  g:          { el: $('#adj-g'),          val: $('#adj-g-val') },
  b:          { el: $('#adj-b'),          val: $('#adj-b-val') },
};

let gap     = 10;
let radius  = 10;
let tagSize = 18;

function getRatio() {
  const v = sRatio.value.split(':').map(Number);
  return v[0] / v[1];
}

/* ---- AUTO LAYOUT (for initial placement) ---- */
function computeLayout(n) {
  if (n === 0) return [];
  if (n === 1) return [{ x:0, y:0, w:1, h:1 }];
  if (n === 2) return [{ x:0,y:0,w:.5,h:1 },{ x:.5,y:0,w:.5,h:1 }];
  if (n === 3) return [{ x:0,y:0,w:.5,h:1 },{ x:.5,y:0,w:.5,h:.5 },{ x:.5,y:.5,w:.5,h:.5 }];
  if (n === 4) return [{ x:0,y:0,w:.5,h:.5 },{ x:.5,y:0,w:.5,h:.5 },{ x:0,y:.5,w:.5,h:.5 },{ x:.5,y:.5,w:.5,h:.5 }];
  if (n === 5) return [{ x:0,y:0,w:1/3,h:.5 },{ x:1/3,y:0,w:1/3,h:.5 },{ x:2/3,y:0,w:1/3,h:.5 },{ x:0,y:.5,w:.5,h:.5 },{ x:.5,y:.5,w:.5,h:.5 }];
  if (n === 6) return [{ x:0,y:0,w:1/3,h:.5 },{ x:1/3,y:0,w:1/3,h:.5 },{ x:2/3,y:0,w:1/3,h:.5 },{ x:0,y:.5,w:1/3,h:.5 },{ x:1/3,y:.5,w:1/3,h:.5 },{ x:2/3,y:.5,w:1/3,h:.5 }];
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const rects = [];
  for (let i = 0; i < n; i++) {
    const c = i % cols, r = Math.floor(i / cols);
    const itemsInRow = (r === rows-1) ? (n - r*cols) : cols;
    const cw = 1/itemsInRow, ch = 1/rows;
    const ox = (r===rows-1 && itemsInRow<cols) ? (1-itemsInRow*cw)/2 : 0;
    rects.push({ x: ox+c*cw, y: r*ch, w: cw, h: ch });
  }
  return rects;
}

function redistributeLayout() {
  const rects = computeLayout(canvasCells.length);
  for (let i = 0; i < canvasCells.length; i++) {
    canvasCells[i].fx = rects[i].x;
    canvasCells[i].fy = rects[i].y;
    canvasCells[i].fw = rects[i].w;
    canvasCells[i].fh = rects[i].h;
  }
}

/* ---- CANVAS FRAME SIZING ---- */
function updateFrameSize() {
  const vp = viewport.getBoundingClientRect();
  const pad = 40;
  const availW = Math.max(200, vp.width - pad*2);
  const availH = Math.max(150, vp.height - pad*2);
  const ratio = getRatio();
  let w, h;
  if (availW/availH > ratio) { h = availH; w = h*ratio; }
  else { w = availW; h = w/ratio; }
  frame.style.width = Math.round(w) + 'px';
  frame.style.height = Math.round(h) + 'px';
}

/* ---- SVG FILTERS ---- */
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

/* ---- RENDER COLLAGE ---- */
function renderCollage() {
  const n = canvasCells.length;
  emptyState.style.display = n === 0 ? 'flex' : 'none';
  collage.innerHTML = '';
  if (n === 0) { canvasInfo.textContent = '0 images'; return; }
  canvasInfo.textContent = n + ' image' + (n>1?'s':'');

  const fw = frame.offsetWidth;
  const fh = frame.offsetHeight;
  const contrastColor = getContrastColor(frameColor);

  for (let i = 0; i < n; i++) {
    const cell = canvasCells[i];
    const asset = library.find(a => a.id === cell.assetId);
    if (!asset) continue;

    // Use stored fractional position
    const px = cell.fx * fw;
    const py = cell.fy * fh;
    const pw = cell.fw * fw;
    const ph = cell.fh * fh;

    // Tag height
    const tagH = Math.round(tagSize * 1.6 + 6);
    const availH = ph - tagH;
    if (availH <= 0) continue;

    // Image bounds (contain)
    const natW = asset.natW || 1, natH = asset.natH || 1;
    const ir = natW/natH, cr = pw/availH;
    let imgW, imgH;
    if (ir > cr) { imgW = pw; imgH = pw/ir; }
    else { imgH = availH; imgW = availH*ir; }

    const frameW = imgW, frameH = tagH + imgH;
    const frameX = (pw - frameW)/2, frameY = (ph - frameH)/2;

    // Cell container
    const div = document.createElement('div');
    div.className = 'cell' + (i===selectedIdx?' selected':'');
    div.style.left = px+'px'; div.style.top = py+'px';
    div.style.width = pw+'px'; div.style.height = ph+'px';
    div.dataset.idx = i;

    // Frame
    const frm = document.createElement('div');
    frm.className = 'cell-frame';
    frm.style.left = frameX+'px'; frm.style.top = frameY+'px';
    frm.style.width = frameW+'px'; frm.style.height = frameH+'px';
    frm.style.border = strokeWidth+'px solid '+frameColor;
    frm.style.borderRadius = radius+'px';

    // Tag
    const tag = document.createElement('div');
    tag.className = 'cell-tag';
    tag.textContent = '@IMAGE'+(i+1);
    tag.style.fontSize = tagSize+'px';
    tag.style.height = tagH+'px'; tag.style.lineHeight = tagH+'px';
    tag.style.padding = '0';
    tag.style.background = frameColor; tag.style.color = contrastColor;
    frm.appendChild(tag);

    // Image
    const img = document.createElement('img');
    img.className = 'cell-img';
    img.src = asset.thumbUrl;
    img.draggable = false;
    img.style.height = imgH+'px';
    const filterVal = buildSVGFilter(cell, i);
    if (filterVal) img.style.filter = filterVal;
    frm.appendChild(img);

    div.appendChild(frm);

    // Controls
    const controls = document.createElement('div');
    controls.className = 'cell-controls';
    controls.style.bottom = (ph - frameY - frameH + 6)+'px';
    controls.style.right = (pw - frameX - frameW + 6)+'px';

    const btnDel = document.createElement('button');
    btnDel.className = 'cell-btn remove';
    btnDel.innerHTML = '✕'; btnDel.title = 'Remove';
    btnDel.addEventListener('click', e => { e.stopPropagation(); removeCell(i); });
    controls.appendChild(btnDel);
    div.appendChild(controls);

    // Click to select
    div.addEventListener('click', e => {
      if (!interaction.didDrag) selectCell(i);
    });

    collage.appendChild(div);
  }
}

/* ---- INTERACTION SYSTEM ---- */
const interaction = {
  active: false,
  mode: null,       // 'move' | 'swap' | 'resize'
  cellIdx: -1,
  startMouseX: 0, startMouseY: 0,
  startFx: 0, startFy: 0, startFw: 0, startFh: 0,
  resizeEdge: '',   // 'e','w','n','s','se','sw','ne','nw'
  didDrag: false,
  swapTarget: -1
};

function getZone(e, cellEl) {
  const frmEl = cellEl.querySelector('.cell-frame');
  const tagEl = cellEl.querySelector('.cell-tag');
  if (!frmEl) return { mode: 'swap', edge: '' };

  const frmR = frmEl.getBoundingClientRect();
  const mx = e.clientX, my = e.clientY;

  // Tag zone → free move
  if (tagEl) {
    const tR = tagEl.getBoundingClientRect();
    if (mx >= tR.left && mx <= tR.right && my >= tR.top && my <= tR.bottom) {
      return { mode: 'move', edge: '' };
    }
  }

  // Frame border zone (10px from edges) → resize
  const bz = 10;
  const onL = mx - frmR.left < bz && mx >= frmR.left - 4;
  const onR = frmR.right - mx < bz && mx <= frmR.right + 4;
  const onT = my - frmR.top < bz && my >= frmR.top - 4;
  const onB = frmR.bottom - my < bz && my <= frmR.bottom + 4;

  if (onR && onB) return { mode: 'resize', edge: 'se' };
  if (onL && onB) return { mode: 'resize', edge: 'sw' };
  if (onR && onT) return { mode: 'resize', edge: 'ne' };
  if (onL && onT) return { mode: 'resize', edge: 'nw' };
  if (onR) return { mode: 'resize', edge: 'e' };
  if (onL) return { mode: 'resize', edge: 'w' };
  if (onB) return { mode: 'resize', edge: 's' };
  if (onT) return { mode: 'resize', edge: 'n' };

  // Center → swap
  return { mode: 'swap', edge: '' };
}

function getCursorForZone(zone) {
  if (zone.mode === 'move') return 'grab';
  if (zone.mode === 'swap') return 'move';
  const map = { e:'ew-resize', w:'ew-resize', n:'ns-resize', s:'ns-resize',
                se:'nwse-resize', nw:'nwse-resize', ne:'nesw-resize', sw:'nesw-resize' };
  return map[zone.edge] || 'default';
}

// Hover cursor
collage.addEventListener('mousemove', e => {
  if (interaction.active) return;
  const cellEl = e.target.closest('.cell');
  if (!cellEl) { collage.style.cursor = 'default'; return; }
  const zone = getZone(e, cellEl);
  collage.style.cursor = getCursorForZone(zone);
});

// Pointer down → start interaction
collage.addEventListener('pointerdown', e => {
  const cellEl = e.target.closest('.cell');
  if (!cellEl || e.target.closest('.cell-btn')) return;
  const idx = parseInt(cellEl.dataset.idx);
  const cell = canvasCells[idx];
  if (!cell) return;

  const zone = getZone(e, cellEl);
  interaction.active = true;
  interaction.mode = zone.mode;
  interaction.cellIdx = idx;
  interaction.startMouseX = e.clientX;
  interaction.startMouseY = e.clientY;
  interaction.startFx = cell.fx;
  interaction.startFy = cell.fy;
  interaction.startFw = cell.fw;
  interaction.startFh = cell.fh;
  interaction.resizeEdge = zone.edge;
  interaction.didDrag = false;
  interaction.swapTarget = -1;

  if (zone.mode === 'move') collage.style.cursor = 'grabbing';
  collage.setPointerCapture(e.pointerId);
  e.preventDefault();
});

// Pointer move → apply interaction
collage.addEventListener('pointermove', e => {
  if (!interaction.active) return;
  const fw = frame.offsetWidth, fh = frame.offsetHeight;
  const dx = e.clientX - interaction.startMouseX;
  const dy = e.clientY - interaction.startMouseY;
  const dfx = dx / fw, dfy = dy / fh;

  if (Math.abs(dx) > 3 || Math.abs(dy) > 3) interaction.didDrag = true;
  if (!interaction.didDrag) return;

  const cell = canvasCells[interaction.cellIdx];
  const minSize = 0.08; // min 8% of canvas

  if (interaction.mode === 'move') {
    // Free move
    cell.fx = clamp(interaction.startFx + dfx, 0, 1 - cell.fw);
    cell.fy = clamp(interaction.startFy + dfy, 0, 1 - cell.fh);
    renderCollage();

  } else if (interaction.mode === 'resize') {
    const edge = interaction.resizeEdge;
    let fx = interaction.startFx, fy = interaction.startFy;
    let fw2 = interaction.startFw, fh2 = interaction.startFh;

    if (edge.includes('e')) fw2 = Math.max(minSize, interaction.startFw + dfx / fw);
    if (edge.includes('w')) { fw2 = Math.max(minSize, interaction.startFw - dfx / fw); fx = interaction.startFx + (interaction.startFw - fw2); }
    if (edge.includes('s')) fh2 = Math.max(minSize, interaction.startFh + dfy / fh);
    if (edge.includes('n')) { fh2 = Math.max(minSize, interaction.startFh - dfy / fh); fy = interaction.startFy + (interaction.startFh - fh2); }

    cell.fx = clamp(fx, 0, 1 - minSize);
    cell.fy = clamp(fy, 0, 1 - minSize);
    cell.fw = Math.min(fw2, 1 - cell.fx);
    cell.fh = Math.min(fh2, 1 - cell.fy);
    renderCollage();

  } else if (interaction.mode === 'swap') {
    // Highlight swap target
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
    // Visual feedback
    cellEls.forEach(el => el.classList.remove('drag-target'));
    if (target >= 0) {
      const tEl = collage.querySelector(`[data-idx="${target}"]`);
      if (tEl) tEl.classList.add('drag-target');
    }
    interaction.swapTarget = target;
    // Move the dragged cell visually
    cell.fx = clamp(interaction.startFx + dfx, 0, 1 - cell.fw);
    cell.fy = clamp(interaction.startFy + dfy, 0, 1 - cell.fh);
    renderCollage();
  }
});

// Pointer up → finalize
collage.addEventListener('pointerup', e => {
  if (!interaction.active) return;
  collage.releasePointerCapture(e.pointerId);
  interaction.active = false;
  collage.style.cursor = 'default';

  if (interaction.mode === 'swap' && interaction.didDrag && interaction.swapTarget >= 0) {
    const a = interaction.cellIdx, b = interaction.swapTarget;
    // Swap positions AND content
    const cellA = canvasCells[a], cellB = canvasCells[b];
    // Swap asset & adj, keep positions
    const tmpAsset = cellA.assetId, tmpAdj = {...cellA.adj};
    cellA.assetId = cellB.assetId; cellA.adj = {...cellB.adj};
    cellB.assetId = tmpAsset; cellB.adj = tmpAdj;
    // Restore A's position (was being dragged)
    cellA.fx = interaction.startFx; cellA.fy = interaction.startFy;
    renderCollage();
  } else if (interaction.mode === 'swap' && interaction.didDrag && interaction.swapTarget < 0) {
    // No target found, snap back
    canvasCells[interaction.cellIdx].fx = interaction.startFx;
    canvasCells[interaction.cellIdx].fy = interaction.startFy;
    renderCollage();
  }

  $$('.cell', collage).forEach(el => el.classList.remove('drag-target'));
});

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

/* ---- CELL OPERATIONS ---- */
function swapCells(a, b) {
  const ca = canvasCells[a], cb = canvasCells[b];
  const tmpA = ca.assetId, tmpAdj = {...ca.adj};
  ca.assetId = cb.assetId; ca.adj = {...cb.adj};
  cb.assetId = tmpA; cb.adj = tmpAdj;
  if (selectedIdx === a) selectedIdx = b;
  else if (selectedIdx === b) selectedIdx = a;
  renderCollage();
}

function removeCell(idx) {
  canvasCells.splice(idx, 1);
  if (selectedIdx === idx) { selectedIdx = -1; hideInspector(); }
  else if (selectedIdx > idx) selectedIdx--;
  redistributeLayout();
  renderCollage();
}

function selectCell(idx) {
  if (selectedIdx === idx) { selectedIdx = -1; hideInspector(); }
  else { selectedIdx = idx; showInspector(idx); }
  renderCollage();
}

/* ---- INSPECTOR ---- */
function showInspector(idx) {
  const cell = canvasCells[idx];
  if (!cell) return;
  adjPanel.hidden = false;
  $('#adj-title').textContent = '@IMAGE'+(idx+1);
  for (const key of Object.keys(adjSliders)) {
    adjSliders[key].el.value = cell.adj[key];
    adjSliders[key].val.textContent = cell.adj[key]+'%';
  }
}

function hideInspector() { adjPanel.hidden = true; }

function updateAdj(key) {
  if (selectedIdx < 0 || !canvasCells[selectedIdx]) return;
  canvasCells[selectedIdx].adj[key] = parseInt(adjSliders[key].el.value);
  adjSliders[key].val.textContent = adjSliders[key].el.value+'%';
  renderCollage();
}

$('#btn-reset-adj').addEventListener('click', () => {
  if (selectedIdx < 0) return;
  canvasCells[selectedIdx].adj = defaultAdj();
  showInspector(selectedIdx);
  renderCollage();
});
$('#btn-remove-cell').addEventListener('click', () => { if (selectedIdx >= 0) removeCell(selectedIdx); });
$('#btn-deselect').addEventListener('click', () => { selectedIdx=-1; hideInspector(); renderCollage(); });
for (const key of Object.keys(adjSliders)) adjSliders[key].el.addEventListener('input', () => updateAdj(key));

/* ---- LIBRARY ---- */
function renderLibrary() {
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

/* ---- FILE UPLOAD ---- */
async function handleFiles(files) {
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;
    const id = Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,7);
    const blob = file;
    const thumbUrl = URL.createObjectURL(blob);
    const dims = await getImageDims(thumbUrl);
    library.push({ id, blob, thumbUrl, natW: dims.w, natH: dims.h });
    try { await dbPut({ id, blob }); } catch(e) { console.warn('DB save failed:', e); }
  }
  renderLibrary();
}

fileInput.addEventListener('change', e => {
  const files = Array.from(e.target.files);
  fileInput.value = '';
  handleFiles(files);
});
$('#btn-upload').addEventListener('click', () => fileInput.click());

/* ---- DRAG & DROP FILES ---- */
viewport.addEventListener('dragover', e => { e.preventDefault(); frame.classList.add('drag-over'); });
viewport.addEventListener('dragleave', () => frame.classList.remove('drag-over'));
viewport.addEventListener('drop', e => {
  e.preventDefault(); frame.classList.remove('drag-over');
  if (e.dataTransfer.files.length > 0) {
    const files = Array.from(e.dataTransfer.files);
    handleFiles(files);
  }
});

/* ---- TOOLBAR ---- */
sGap.addEventListener('input', () => { gap=parseInt(sGap.value); vGap.textContent=gap+'px'; renderCollage(); });
sRadius.addEventListener('input', () => { radius=parseInt(sRadius.value); vRadius.textContent=radius+'px'; renderCollage(); });
sTagSize.addEventListener('input', () => { tagSize=parseInt(sTagSize.value); vTagSize.textContent=tagSize+'px'; renderCollage(); });
sRatio.addEventListener('change', () => { updateFrameSize(); renderCollage(); });
sFrameColor.addEventListener('input', () => { frameColor=sFrameColor.value; vFrameColor.textContent=frameColor.toUpperCase(); renderCollage(); });
sFrameStroke.addEventListener('input', () => { strokeWidth=parseInt(sFrameStroke.value); vFrameStroke.textContent=strokeWidth+'px'; renderCollage(); });

$('#btn-clear-canvas').addEventListener('click', () => { canvasCells=[]; selectedIdx=-1; hideInspector(); renderCollage(); });
$('#btn-add-all').addEventListener('click', () => {
  for (const item of library) canvasCells.push({ assetId: item.id, adj: defaultAdj(), fx:0, fy:0, fw:0, fh:0 });
  redistributeLayout();
  renderCollage();
});
$('#btn-clear-lib').addEventListener('click', async () => {
  canvasCells=[]; selectedIdx=-1; hideInspector();
  for (const item of library) if (item.thumbUrl) URL.revokeObjectURL(item.thumbUrl);
  library=[]; await dbClear(); renderLibrary(); renderCollage();
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

  const ratio = getRatio();
  let targetW = 7680, targetH = Math.round(targetW / ratio);
  if (targetW * targetH > 7680*4320) { targetH=4320; targetW=Math.round(targetH*ratio); }

  const canvas = document.createElement('canvas');
  canvas.width = targetW; canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#121215'; ctx.fillRect(0,0,targetW,targetH);

  const n = canvasCells.length;
  const scale = targetW / frame.offsetWidth;
  const radPx = radius * scale;
  const tagPx = tagSize * scale;
  const strokePx = strokeWidth * scale;
  const contrastColor = getContrastColor(frameColor);

  for (let i = 0; i < n; i++) {
    const cell = canvasCells[i];
    const asset = library.find(a => a.id === cell.assetId);
    if (!asset) continue;
    exportProg.style.width = ((i+1)/n*80)+'%';
    exportStatus.textContent = `Rendering image ${i+1} / ${n}…`;

    const px = cell.fx * targetW, py = cell.fy * targetH;
    const pw = cell.fw * targetW, ph = cell.fh * targetH;

    const tagH = Math.round(tagPx*1.6 + 6*scale);
    const availH = ph - tagH;
    if (availH <= 0) continue;

    const natW = asset.natW||1, natH = asset.natH||1;
    const ir = natW/natH, cr = pw/availH;
    let imgW, imgH;
    if (ir > cr) { imgW=pw; imgH=pw/ir; } else { imgH=availH; imgW=availH*ir; }

    const frameW=imgW, frameH=tagH+imgH;
    const frameX=px+(pw-frameW)/2, frameY=py+(ph-frameH)/2;

    const img = await loadImage(asset.blob instanceof Blob ? URL.createObjectURL(asset.blob) : asset.thumbUrl);

    ctx.save();
    roundRect(ctx, frameX, frameY, frameW, frameH, radPx);
    ctx.clip();

    ctx.fillStyle = frameColor;
    ctx.fillRect(frameX, frameY, frameW, tagH);
    ctx.fillStyle = contrastColor;
    ctx.font = `900 ${tagPx}px Inter, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('@IMAGE'+(i+1), frameX+frameW/2, frameY+tagH/2);

    const imgX = frameX, imgY = frameY + tagH;
    const adj = cell.adj;
    ctx.filter = `brightness(${adj.brightness}%) contrast(${adj.contrast}%)`;
    drawContain(ctx, img, imgX, imgY, imgW, imgH);
    ctx.filter = 'none';

    if (adj.r!==100||adj.g!==100||adj.b!==100) {
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = `rgb(${Math.round(adj.r*2.55)},${Math.round(adj.g*2.55)},${Math.round(adj.b*2.55)})`;
      ctx.fillRect(imgX,imgY,imgW,imgH);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();

    ctx.strokeStyle = frameColor; ctx.lineWidth = strokePx;
    ctx.beginPath(); roundRect(ctx, frameX, frameY, frameW, frameH, radPx); ctx.stroke();

    if (asset.blob instanceof Blob) URL.revokeObjectURL(img.src);
    await sleep(10);
  }

  exportProg.style.width = '90%';
  exportStatus.textContent = 'Compressing…';
  await sleep(30);

  let quality = 0.95, blob;
  do {
    blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', quality));
    if (blob.size > 10*1024*1024) quality -= 0.05; else break;
  } while (quality > 0.3);

  exportProg.style.width = '100%';
  exportStatus.textContent = `Done! ${targetW}×${targetH} — ${(blob.size/1024/1024).toFixed(2)} MB`;

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `collage_${targetW}x${targetH}.jpg`;
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
  const ir = img.naturalWidth/img.naturalHeight, cr = w/h;
  let dw,dh,dx,dy;
  if (ir>cr) { dw=w; dh=w/ir; dx=x; dy=y+(h-dh)/2; }
  else { dh=h; dw=h*ir; dx=x+(w-dw)/2; dy=y; }
  ctx.fillStyle = '#111116'; ctx.fillRect(x,y,w,h);
  ctx.drawImage(img, 0,0,img.naturalWidth,img.naturalHeight, dx,dy,dw,dh);
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
