/* ================= shared tool helpers ================= */
function bindDrop(el, cb) {
  el.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); el.classList.add('over'); } });
  el.addEventListener('dragleave', () => el.classList.remove('over'));
  el.addEventListener('drop', e => { if (!e.dataTransfer.files.length) return; e.preventDefault(); e.stopPropagation(); el.classList.remove('over'); cb([...e.dataTransfer.files]); });
}
function fitZoom(view, w, hh, zoom) {
  if (zoom !== 'fit') return +zoom;
  const vw = Math.max(60, view.clientWidth - 24), vh = Math.max(200, view.clientHeight - 24);
  let z = Math.min(vw / w, vh / hh); if (z >= 1) z = Math.min(8, Math.floor(z)); return Math.max(z, 0.02);
}
function showStage(stage, view, canvas, zoom, rects, grid) {
  stage.innerHTML = ''; if (!canvas) return;
  const z = fitZoom(view, canvas.width, canvas.height, zoom);
  const W = Math.round(canvas.width * z), H = Math.round(canvas.height * z);
  canvas.classList.add('pix'); canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  stage.append(canvas);
  if (grid && rects && rects.length && W * H < 25e6) {
    const ov = newCanvas(W, H); ov.className = 'overlay';
    const x = ov.getContext('2d'); x.lineWidth = 1; x.setLineDash([4, 3]);
    for (const r of rects) { x.strokeStyle = r.empty ? 'rgba(255,255,255,.18)' : 'rgba(139,227,107,.8)'; x.strokeRect(Math.round(r.x * z) + .5, Math.round(r.y * z) + .5, Math.max(1, Math.round(r.w * z) - 1), Math.max(1, Math.round(r.h * z) - 1)); }
    stage.append(ov);
  }
}
function uniqueNames(names) {
  const seen = new Map();
  return names.map(n => { n = n || 'frame'; const c = seen.get(n) || 0; seen.set(n, c + 1); return c ? `${n}_${c}` : n; });
}
function packCells(cells, { cols, cw, ch, pad = 0, margin = 0, pot = false, bg = null, align = 'center', scale = 1, smooth = false }) {
  const n = Math.max(1, cells.length); cols = Math.max(1, Math.min(cols || 1, n)); const rows = Math.ceil(n / cols);
  const CW = Math.max(1, Math.round(cw * scale)), CH = Math.max(1, Math.round(ch * scale));
  let W = margin * 2 + cols * CW + (cols - 1) * pad, H = margin * 2 + rows * CH + (rows - 1) * pad;
  if (pot) { W = nextPow2(W); H = nextPow2(H); }
  const c = newCanvas(W, H); const x = ctx2d(c);
  if (bg) { x.fillStyle = bg; x.fillRect(0, 0, W, H); }
  x.imageSmoothingEnabled = smooth; x.imageSmoothingQuality = 'high';
  const rects = [];
  cells.forEach((cell, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const cx = margin + col * (CW + pad), cy = margin + row * (CH + pad);
    rects.push({ x: cx, y: cy, w: CW, h: CH, i, name: cell && cell.name, empty: !cell });
    if (!cell) return;
    const dw = Math.round(cell.canvas.width * scale), dh = Math.round(cell.canvas.height * scale);
    let dx, dy;
    if (align === 'topleft') { dx = cx; dy = cy; }
    else { dx = cx + Math.floor((CW - dw) / 2); dy = align === 'bottom' ? cy + CH - dh : cy + Math.floor((CH - dh) / 2); }
    x.save(); x.beginPath(); x.rect(cx, cy, CW, CH); x.clip(); x.drawImage(cell.canvas, dx, dy, dw, dh); x.restore();
  });
  return { canvas: c, rects, cols, rows, CW, CH };
}
function makeAtlas(rects, { image, W, H, scale = 1, am, animations }) {
  const frames = {}; const dur = am && am.fps ? Math.round(1000 / am.fps) : 100;
  for (const r of rects) { if (r.empty) continue; frames[r.name] = { frame: { x: r.x, y: r.y, w: r.w, h: r.h }, rotated: false, trimmed: false, spriteSourceSize: { x: 0, y: 0, w: r.w, h: r.h }, sourceSize: { w: r.w, h: r.h }, duration: dur }; }
  return { frames, animations: animations || {}, meta: { app: 'Assets Manager', version: '1.0', image, format: 'RGBA8888', size: { w: W, h: H }, scale: String(scale), am } };
}
async function exportResult(result, name, folder, how) {
  if (!result) return toast('Nothing to export yet', 'warn');
  name = sanitize(name || 'spritesheet');
  const png = await canvasToBlob(result.canvas); const atlas = withImageName(result.atlas, name + '.png');
  if (how === 'save') { const saved = await saveToProject(folder, name + '.png', png, { am: result.am, atlas }, `Save sprite sheet ${name}.png`); toast(`Saved ${App.project}/${folder}/${saved} (+ .json)`, 'ok'); }
  else if (how === 'png') downloadBlob(name + '.png', png);
  else if (how === 'json') downloadBlob(name + '.json', jsonBlob(atlas));
  else if (how === 'zip') downloadBlob(name + '.zip', await makeZip([{ name: name + '.png', blob: png }, { name: name + '.json', blob: jsonBlob(atlas) }]));
}
const numVal = (id, min = 0) => Math.max(min, Math.floor(+$('#' + id).value || 0));
/* ================= SPRITE SHEET ================= */
const Sheet = {
  frames: [], result: null, player: null, ui: null, dragId: null, named: false,
  init() {
    this.player = new Player($('#sh_animView')); this.ui = buildPlayerUI($('#sh_animCtrls'), this.player, {});
    const rb = debounce(() => this.rebuild(), 90);
    for (const id of ['sh_layout', 'sh_cols', 'sh_cell', 'sh_cw', 'sh_ch', 'sh_align', 'sh_trim', 'sh_alpha', 'sh_pad', 'sh_margin', 'sh_scale', 'sh_smooth', 'sh_pot', 'sh_bgOn', 'sh_bg']) $('#' + id).addEventListener('input', rb);
    $('#sh_cell').addEventListener('change', () => $('#sh_customCell').classList.toggle('hidden', $('#sh_cell').value !== 'custom'));
    $('#sh_layout').addEventListener('change', () => { $('#sh_cols').disabled = $('#sh_layout').value !== 'grid'; });
    $('#sh_alpha').addEventListener('input', e => $('#sh_alphaV').textContent = e.target.value);
    $('#sh_name').addEventListener('input', () => { this.named = true; });
    $('#sh_grid').addEventListener('change', () => this.show());
    $('#sh_zoom').addEventListener('change', () => this.show());
    $('#sh_add').onclick = async () => { const f = await pickFiles(); if (f.length) this.addAssets(filesToAssets(f)); };
    $('#sh_addLib').onclick = async () => { const l = await pickAssets({ title: 'Add frames' }); if (l.length) this.addAssets(l); };
    $('#sh_export').onclick = () => exportAnimationDialog({ frames: this.player.frames, fps: this.player.fps, ping: this.player.ping, name: this.opts().name });
    $('#sh_sort').onclick = () => { this.frames.sort((a, b) => naturalCmp(a.name, b.name)); this.changed('sort A→Z'); };
    $('#sh_rev').onclick = () => { this.frames.reverse(); this.changed('reverse order'); };
    $('#sh_clear').onclick = () => { this.frames = []; this.named = false; this.changed('clear frames'); };
    bindDrop($('#sh_frames'), files => this.addAssets(filesToAssets(files)));
    const ex = how => exportResult(this.result, $('#sh_name').value, $('#sh_folder').value, how).catch(e => toast(e.message, 'err'));
    $('#sh_save').onclick = () => ex('save'); $('#sh_dlPng').onclick = () => ex('png'); $('#sh_dlJson').onclick = () => ex('json'); $('#sh_dlZip').onclick = () => ex('zip');
    this.player.listeners.push(p => { $$('#sh_frames .frame').forEach((el, i) => el.style.borderColor = i === p.i ? 'var(--accent)' : ''); });
    this.ui.fps.addEventListener('change', () => this.rebuild());
    window.addEventListener('resize', debounce(() => this.show(), 150));
    this.renderFrames();
  },
  async addAssets(list) {
    const fr = await assetsToFrames(list);
    if (!fr.length) return;
    if (!this.named && !this.frames.length) $('#sh_name').value = sanitize(stem(list[0].name).replace(/[_\-\s]*\d+$/, '') || 'spritesheet');
    this.addFrames(fr, false);
  },
  addFrames(fr, notify = true) {
    for (const f of fr) this.frames.push({ id: uid(), name: f.name, canvas: f.canvas });
    if (notify) toast(`${fr.length} frame(s) added to Sprite Sheet`, 'ok');
    this.changed(`add ${fr.length} frame(s)`);
  },
  changed(label) {
    const before = this._last || [], after = this.frames.slice(); this._last = after;
    if (label) History.push('Sprite Sheet: ' + label, () => this.restore(before), () => this.restore(after), { lib: false });
    this.renderFrames(); this.rebuild();
  },
  restore(arr) { this.frames = arr.slice(); this._last = arr.slice(); this.renderFrames(); this.rebuild(); },
  move(i, j) { if (j < 0 || j >= this.frames.length) return; const [x] = this.frames.splice(i, 1); this.frames.splice(j, 0, x); this.changed('move frame'); },
  renderFrames() {
    const box = $('#sh_frames'); box.innerHTML = ''; $('#sh_count').textContent = this.frames.length ? `${this.frames.length} frame(s)` : '';
    if (!this.frames.length) { box.append(h('div', { class: 'empty small' }, 'Drop images, GIFs or videos here (or use the buttons above). Then drag the frames to set the order.')); return; }
    this.frames.forEach((f, i) => {
      if (!f.thumb) f.thumb = thumbCanvas(f.canvas, 72);
      const item = h('div', { class: 'frame', draggable: 'true', title: `${f.name} (${f.canvas.width}×${f.canvas.height}) — drag to reorder` },
        h('div', { class: 'ft checker' }, f.thumb),
        h('div', { class: 'fi' }, h('span', {}, '#' + (i + 1)), h('span', {}, f.name)),
        h('div', { class: 'fx' },
          h('button', { title: 'Move left', onclick: e => { e.stopPropagation(); this.move(i, i - 1); } }, '◀'),
          h('button', { title: 'Duplicate', onclick: e => { e.stopPropagation(); this.frames.splice(i + 1, 0, { ...f, id: uid(), thumb: null }); this.changed('duplicate frame'); } }, '⧉'),
          h('button', { title: 'Move right', onclick: e => { e.stopPropagation(); this.move(i, i + 1); } }, '▶'),
          h('button', { title: 'Remove', onclick: e => { e.stopPropagation(); this.frames.splice(i, 1); this.changed('remove frame'); } }, '✕')));
      item.addEventListener('click', () => this.player.seek(i));
      item.addEventListener('dragstart', e => { this.dragId = f.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/x-frame', String(f.id)); item.classList.add('dragging'); });
      item.addEventListener('dragend', () => { this.dragId = null; item.classList.remove('dragging'); $$('.frame', box).forEach(x => x.classList.remove('drop-before', 'drop-after')); });
      const side = e => { const r = item.getBoundingClientRect(); return e.clientX > r.left + r.width / 2; };
      item.addEventListener('dragover', e => { if (this.dragId == null) return; e.preventDefault(); const a = side(e); item.classList.toggle('drop-after', a); item.classList.toggle('drop-before', !a); });
      item.addEventListener('dragleave', () => item.classList.remove('drop-after', 'drop-before'));
      item.addEventListener('drop', e => {
        if (this.dragId == null) return; e.preventDefault(); e.stopPropagation();
        const after = side(e); const from = this.frames.findIndex(x => x.id === this.dragId); if (from < 0) return;
        const [m] = this.frames.splice(from, 1); let to = this.frames.findIndex(x => x.id === f.id); if (to < 0) to = this.frames.length; else if (after) to++;
        this.frames.splice(to, 0, m); this.dragId = null; this.changed('reorder frames');
      });
      box.append(item);
    });
  },
  opts() {
    return {
      layout: $('#sh_layout').value, cols: numVal('sh_cols'), cell: $('#sh_cell').value, cw: numVal('sh_cw', 1), ch: numVal('sh_ch', 1),
      align: $('#sh_align').value, trim: $('#sh_trim').value, alpha: +$('#sh_alpha').value, pad: numVal('sh_pad'), margin: numVal('sh_margin'),
      scale: +$('#sh_scale').value, smooth: $('#sh_smooth').checked, pot: $('#sh_pot').checked, bg: $('#sh_bgOn').checked ? $('#sh_bg').value : null,
      fps: this.player.fps, name: sanitize($('#sh_name').value || 'spritesheet')
    };
  },
  trimmed(o) {
    if (o.trim === 'none') return this.frames.map(f => ({ name: f.name, canvas: f.canvas }));
    for (const f of this.frames) if (!f._b || f._bk !== o.alpha) { f._b = contentBounds(f.canvas, { thr: o.alpha }); f._bk = o.alpha; }
    if (o.trim === 'union') {
      let u = null; for (const f of this.frames) if (f._b) u = u ? unionBox(u, f._b) : { ...f._b };
      if (!u) return this.frames.map(f => ({ name: f.name, canvas: f.canvas }));
      return this.frames.map(f => ({ name: f.name, canvas: cropCanvas(f.canvas, u) }));
    }
    return this.frames.map(f => ({ name: f.name, canvas: f._b ? cropCanvas(f.canvas, f._b) : newCanvas(1, 1) }));
  },
  rebuild() {
    if (!this.frames.length) { this.result = null; this.show(); this.player.setFrames([]); $('#sh_info').textContent = ''; return; }
    const o = this.opts(); const P = this.trimmed(o); const n = P.length;
    const cw = o.cell === 'custom' ? o.cw : Math.max(...P.map(p => p.canvas.width));
    const ch = o.cell === 'custom' ? o.ch : Math.max(...P.map(p => p.canvas.height));
    const cols = o.layout === 'row' ? n : o.layout === 'col' ? 1 : (o.cols > 0 ? o.cols : Math.ceil(Math.sqrt(n)));
    const names = uniqueNames(P.map(p => p.name));
    const pk = packCells(P.map((p, i) => ({ canvas: p.canvas, name: names[i] })), { cols, cw, ch, pad: o.pad, margin: o.margin, pot: o.pot, bg: o.bg, align: o.align, scale: o.scale, smooth: o.smooth });
    const am = { type: 'sheet', cols: pk.cols, rows: pk.rows, frameW: pk.CW, frameH: pk.CH, count: n, padding: o.pad, margin: o.margin, fps: o.fps, animations: [{ name: o.name, start: 0, count: n }] };
    const atlas = makeAtlas(pk.rects, { image: o.name + '.png', W: pk.canvas.width, H: pk.canvas.height, scale: o.scale, am, animations: { [o.name]: names } });
    this.result = { canvas: pk.canvas, rects: pk.rects, am, atlas };
    const big = Math.max(pk.canvas.width, pk.canvas.height) > 4096 ? ' ⚠ larger than 4096px' : '';
    $('#sh_info').textContent = `${pk.canvas.width}×${pk.canvas.height}px · ${pk.cols}×${pk.rows} · cell ${pk.CW}×${pk.CH}${big}`;
    this.show();
    this.player.setFrames(pk.rects.filter(r => !r.empty).map(r => ({ c: cropRect(pk.canvas, r.x, r.y, r.w, r.h) })), { keepIndex: true });
  },
  show() { if (App.tab !== 'sheet' && this.result) { this._pending = true; } showStage($('#sh_stage'), $('#sh_view'), this.result && this.result.canvas, $('#sh_zoom').value, this.result && this.result.rects, $('#sh_grid').checked); },
};

/* ================= COMPRESS ================= */
function qLabel(v) {
  if (v.lossless) return ['Identical', 'q-lossless'];
  const p = v.psnr;
  if (p >= 45) return ['Imperceptible', 'q-great'];
  if (p >= 40) return ['Excellent', 'q-good'];
  if (p >= 35) return ['Good', 'q-ok'];
  return ['Visible loss', 'q-bad'];
}
const Compress = {
  items: [], cur: null, viewVar: null, pos: 0.5,
  init() {
    const reset = () => { for (const it of this.items) it.res = null; if (this.cur) this.select(this.cur); this.renderList(); };
    for (const id of ['cp_scale', 'cp_smooth', 'cp_dither']) $('#' + id).addEventListener('change', reset);
    for (const id of ['cp_level', 'cp_lossy']) $('#' + id).addEventListener('change', () => { if (this.cur && this.cur.res) { this.renderTable(); this.view(this.recommend(this.cur.res)); } this.renderList(); });
    $('#cp_add').onclick = async () => { const f = await pickFiles('image/*'); if (f.length) this.addAssets(filesToAssets(f)); };
    $('#cp_addLib').onclick = async () => { const l = await pickAssets({ title: 'Images to compress', kinds: ['image'] }); if (l.length) this.addAssets(l); };
    $('#cp_clear').onclick = () => { this.items = []; this.cur = null; this.viewVar = null; this.renderList(); this.renderTable(); this.renderCompare(); };
    $('#cp_view').addEventListener('change', () => this.renderCompare());
    $('#cp_zoom').addEventListener('change', () => this.renderCompare());
    $('#cp_saveOne').onclick = () => this.saveOne();
    $('#cp_dlOne').onclick = () => { const v = this.viewVar; if (v) downloadBlob(this.outName(this.cur, v), v.blob); };
    $('#cp_saveAll').onclick = () => this.saveAll(false);
    $('#cp_zipAll').onclick = () => this.saveAll(true);
    bindDrop($('#cp_list'), f => this.addAssets(filesToAssets(f)));
    window.addEventListener('resize', debounce(() => { if (App.tab === 'compress') this.renderCompare(); }, 150));
    this.renderList(); this.renderTable();
  },
  async addAssets(list) {
    for (const a of list) {
      const k = assetKind(a), e = extOf(a.name);
      if (k !== 'image' || e === 'svg') { toast(`${a.name}: compression supports PNG, JPG, WebP, BMP and AVIF`, 'warn'); continue; }
      try { this.items.push({ id: uid(), name: a.name, blob: a.blob, src: a, canvas: await blobToCanvas(a.blob), res: null }); } catch (er) { toast(`${a.name}: ${er.message}`, 'err'); }
    }
    this.renderList();
    if (!this.cur && this.items.length) this.select(this.items[0]);
  },
  settings() { return { scale: +$('#cp_scale').value, smooth: $('#cp_smooth').checked, dither: $('#cp_dither').checked }; },
  async analyze(it) {
    const s = this.settings(); const key = JSON.stringify(s);
    if (it.res && it.res.key === key) return it.res;
    const refC = s.scale === 1 ? it.canvas : scaleCanvas(it.canvas, s.scale, s.smooth);
    const W = refC.width, H = refC.height; const ref = ctx2d(refC).getImageData(0, 0, W, H);
    const info = analyzeImage(ref); const V = []; let ext = extOf(it.name) || 'png'; if (ext === 'jpeg') ext = 'jpg';
    const add = (label, blob, ext2, lossless, extra = {}) => V.push({ id: V.length, label, blob, size: blob.size, ext: ext2, lossless, ...extra });
    if (s.scale === 1) add(`Original (${ext.toUpperCase()})`, it.blob, ext, true, { original: true });
    await sleep(0);
    add('PNG lossless (optimized)', await encodePNGRGBA(ref, info.hasAlpha), 'png', true);
    if (info.exact) { const q = exactIndexed(ref, info.exact); add(`PNG-8 lossless · ${info.unique} colors`, await encodePNGIndexed(W, H, q.idx, q.palette), 'png', true); }
    for (const k of [256, 128, 64, 32, 16]) {
      if (info.exact && k >= info.unique) continue;
      await sleep(0); const q = quantize(ref, k, s.dither);
      add(`PNG-8 · ${k} colors` + (s.dither ? ' · dithered' : ''), await encodePNGIndexed(W, H, q.idx, q.palette), 'png', false);
    }
    for (const q of [1, 0.9, 0.8, 0.7]) {
      const b = await canvasToBlob(refC, 'image/webp', q).catch(() => null);
      if (!b || b.type !== 'image/webp') break;
      add(`WebP · quality ${Math.round(q * 100)}`, b, 'webp', false);
    }
    if (!info.hasAlpha) for (const q of [0.92, 0.85, 0.75]) add(`JPEG · quality ${Math.round(q * 100)}`, await canvasToBlob(refC, 'image/jpeg', q), 'jpg', false);
    for (const v of V) {
      if (v.lossless) { v.psnr = Infinity; continue; }
      await sleep(0); v.data = await blobToImageData(v.blob, W, H); v.psnr = psnr(ref, v.data); if (v.psnr === Infinity) v.lossless = true;
    }
    it.res = { key, refC, ref, W, H, info, variants: V, base: it.blob.size, origExt: ext };
    return it.res;
  },
  recommend(res) {
    const level = $('#cp_level').value, lossy = $('#cp_lossy').checked;
    const thr = { lossless: Infinity, high: 45, balanced: 40, aggressive: 35 }[level];
    const oext = (res.variants.find(v => v.original) || {}).ext || res.origExt;
    const ok = res.variants.filter(v => (lossy || v.ext === 'png' || v.original || v.ext === oext) && (v.lossless || v.psnr >= thr)).sort((a, b) => a.size - b.size);
    return ok[0] || res.variants[0];
  },
  renderList() {
    const box = $('#cp_list'); box.innerHTML = ''; $('#cp_count').textContent = this.items.length ? `${this.items.length} file(s)` : '';
    if (!this.items.length) { box.append(h('div', { class: 'empty small' }, 'Drop PNGs/JPGs here or send them from the library. The tool builds several versions and recommends the smallest one without visible loss.')); $('#cp_total').textContent = ''; return; }
    let t0 = 0, t1 = 0;
    for (const it of this.items) {
      if (!it.thumb) it.thumb = thumbCanvas(it.canvas, 40);
      const best = it.res ? this.recommend(it.res) : null;
      if (best) { t0 += it.blob.size; t1 += best.size; }
      const red = best ? Math.round((1 - best.size / it.blob.size) * 100) : 0;
      box.append(h('div', { class: 'citem' + (it === this.cur ? ' active' : ''), onclick: () => this.select(it) },
        h('div', { class: 'ct checker' }, it.thumb),
        h('div', { class: 'cn', title: it.name }, it.name),
        h('div', { class: 'cs', html: best ? `${fmtBytes(it.blob.size)} → <b>${fmtBytes(best.size)}</b> (${red > 0 ? '−' + red : '+' + (-red)}%)` : `${fmtBytes(it.blob.size)} · not analyzed` })));
    }
    $('#cp_total').textContent = t0 ? `· total ${fmtBytes(t0)} → ${fmtBytes(t1)}` : '';
  },
  async select(it) {
    this.cur = it; this.renderList();
    $('#cp_cur').textContent = it.name; $('#cp_table').innerHTML = '<tr><td class="muted">Analyzing variants…</td></tr>'; $('#cp_rec').innerHTML = '';
    await sleep(30);
    try { await this.analyze(it); } catch (e) { console.error(e); toast('Analysis error: ' + e.message, 'err'); return; }
    if (this.cur !== it) return;
    this.renderTable(); this.renderList(); this.view(this.recommend(it.res));
  },
  renderTable() {
    const t = $('#cp_table'), rb = $('#cp_rec'); t.innerHTML = ''; rb.innerHTML = '';
    const it = this.cur; if (!it || !it.res) { t.append(h('tr', {}, h('td', { class: 'muted' }, 'Select a file to see its variants.'))); return; }
    const res = it.res, rec = this.recommend(res);
    const red = Math.round((1 - rec.size / res.base) * 100);
    const [ql] = qLabel(rec);
    const notes = [];
    if (res.info.exact) notes.push(`This image has only ${res.info.unique} colors (pixel art / flat art): PNG-8 is completely lossless.`);
    if (rec.original) notes.push('The original file is already the smallest within the chosen quality target.');
    if (res.W !== it.canvas.width) notes.push(`Compared at ${res.W}×${res.H} (resized).`);
    rb.append(h('div', { class: 'rec-box', html: `<b>★ Recommended:</b> ${rec.label} — <b>${fmtBytes(rec.size)}</b> (${red >= 0 ? '−' + red : '+' + (-red)}% vs original), quality <b>${ql}</b>${rec.lossless ? '' : ` (${rec.psnr.toFixed(1)} dB)`}.` + (notes.length ? `<br><span class="muted">${notes.join(' ')}</span>` : '') }));
    t.append(h('tr', {}, h('th', {}, 'Format'), h('th', { style: { textAlign: 'right' } }, 'Size'), h('th', { style: { textAlign: 'right' } }, 'Saving'), h('th', {}, 'Quality')));
    for (const v of [...res.variants].sort((a, b) => a.size - b.size)) {
      const [lbl, cls] = qLabel(v); const r = Math.round((1 - v.size / res.base) * 100);
      const tr = h('tr', { class: (v === rec ? 'rec ' : '') + (v === this.viewVar ? 'viewing' : ''), onclick: () => this.view(v) },
        h('td', {}, v === rec ? h('span', { class: 'star' }, '★ ') : null, v.label),
        h('td', { class: 'num' }, fmtBytes(v.size)),
        h('td', { class: 'num' }, r >= 0 ? `−${r}%` : `+${-r}%`),
        h('td', { class: cls }, lbl, v.lossless ? null : h('span', { class: 'db' }, `${v.psnr.toFixed(1)} dB`)));
      t.append(tr);
    }
  },
  view(v) {
    this.viewVar = v; $('#cp_sel').textContent = v ? `${v.label} · ${fmtBytes(v.size)}` : '';
    $$('#cp_table tr').forEach(tr => tr.classList.remove('viewing'));
    this.renderTable(); this.renderCompare();
  },
  async renderCompare() {
    const vp = $('#cp_viewport'); vp.innerHTML = '';
    const it = this.cur, v = this.viewVar; if (!it || !it.res || !v) return;
    const res = it.res, W = res.W, H = res.H;
    if (!v.canvas) { v.data = v.data || await blobToImageData(v.blob, W, H); const c = newCanvas(W, H); ctx2d(c).putImageData(v.data, 0, 0); v.canvas = c; }
    const z = fitZoom(vp, W, H, $('#cp_zoom').value); const dw = Math.round(W * z) + 'px', dh = Math.round(H * z) + 'px';
    const sz = c => { c.style.width = dw; c.style.height = dh; return c; };
    if ($('#cp_view').value === 'diff') {
      const d = newCanvas(W, H); const x = ctx2d(d); const id = x.createImageData(W, H); const A = res.ref.data, B = v.data.data, O = id.data;
      for (let i = 0; i < A.length; i += 4) { const e = Math.min(255, (Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]) + Math.abs(A[i + 3] - B[i + 3])) * 2); O[i] = e; O[i + 1] = e * 0.4; O[i + 2] = 255 - e > 200 ? 30 : 0; O[i + 3] = 255; }
      x.putImageData(id, 0, 0); vp.append(h('div', { class: 'compare' }, sz(d))); return;
    }
    const base = cloneCanvas(res.refC); const top = v.canvas; top.className = 'cv';
    const div = h('div', { class: 'divider' });
    const wrap = h('div', { class: 'compare' }, sz(base), sz(top), div, h('span', { class: 'lbl', style: { left: '6px' } }, 'ORIGINAL'), h('span', { class: 'lbl', style: { right: '6px' } }, 'VARIANT'));
    const setPos = p => { this.pos = clamp(p, 0, 1); top.style.clipPath = `inset(0 0 0 ${this.pos * 100}%)`; div.style.left = `calc(${this.pos * 100}% - 1px)`; };
    wrap.addEventListener('pointermove', e => { const r = wrap.getBoundingClientRect(); setPos((e.clientX - r.left) / r.width); });
    setPos(this.pos); vp.append(wrap);
  },
  outName(it, v) { return stem(it.name) + '.' + v.ext; },
  async saveOne() {
    const it = this.cur, v = this.viewVar; if (!it || !v) return toast('Choose a variant', 'warn');
    const folder = $('#cp_folder').value; const saved = await saveToProject(folder, this.outName(it, v), v.blob, it.src && it.src.meta, `Compress ${it.name}`);
    toast(`Saved ${folder}/${saved}`, 'ok');
  },
  async saveAll(zip) {
    if (!this.items.length) return toast('Add images first', 'warn');
    const files = [], saves = []; const folder = $('#cp_folder').value; let before = 0, after = 0;
    try {
      for (let i = 0; i < this.items.length; i++) {
        const it = this.items[i]; busy(`Analyzing ${i + 1}/${this.items.length}: ${it.name}`); await sleep(20);
        const res = await this.analyze(it); const v = this.recommend(res); before += it.blob.size; after += v.size;
        if (zip) files.push({ name: this.outName(it, v), blob: v.blob });
        else saves.push({ folder, name: this.outName(it, v), blob: v.blob, meta: it.src && it.src.meta });
      }
    } catch (e) { console.error(e); toast(e.message, 'err'); } finally { busy(null); }
    this.renderList(); if (this.cur) this.renderTable();
    if (zip && files.length) downloadBlob('comprimidos.zip', await makeZip(files));
    if (!zip && saves.length) { await opSave(saves, `Compress ${saves.length} file(s)`); toast(`${saves.length} file(s) saved to ${folder}: ${fmtBytes(before)} → ${fmtBytes(after)}`, 'ok', 5000); }
  },
};

/* ================= ANIMAÇÃO ================= */
/* ================= ANIMATION ================= */
const Anim = {
  player: null, ui: null, src: null, type: null, sheet: null, am: null, frames: [], video: null, fallback: null,
  init() {
    this.player = new Player($('#an_view')); this.ui = buildPlayerUI($('#an_ctrls'), this.player, { dur: true });
    $('#an_open').onclick = async () => { const f = await pickFiles('image/*,video/*,.gif,.json'); if (f.length) this.openFiles(f); };
    $('#an_openLib').onclick = async () => { const l = await pickAssets({ title: 'Open in player', multiple: false }); if (l.length) this.open(l[0]); };
    const rs = debounce(() => this.slice(), 80);
    for (const id of ['an_cols', 'an_rows', 'an_pad', 'an_margin', 'an_start', 'an_end']) $('#' + id).addEventListener('input', rs);
    for (const id of ['an_cols', 'an_rows']) $('#' + id).addEventListener('input', () => { $('#an_end').value = numVal('an_cols', 1) * numVal('an_rows', 1); });
    $('#an_animSel').addEventListener('change', e => { const a = (this.am.animations || [])[+e.target.value]; if (!a) return; $('#an_start').value = a.start + 1; $('#an_end').value = a.start + a.count; this.slice(); });
    $('#an_detect').onclick = () => {
      const g = this.grid(); let last = 0;
      for (let i = g.total - 1; i >= 0; i--) { const r = this.cell(g, i); if (!regionEmpty(this.sheet, r.x, r.y, r.w, r.h)) { last = i; break; } }
      $('#an_end').value = last + 1; this.slice(); toast(`${last + 1} frame(s) with content`, 'ok');
    };
    $('#an_vspeed').addEventListener('change', e => { if (this.video) this.video.playbackRate = +e.target.value; });
    const loopChk = h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: true, id: 'an_vloop', onchange: e => { if (this.video) this.video.loop = e.target.checked; } }), 'Loop');
    $('#an_vspeed').closest('.field').after(loopChk);
    $('#an_vextract').onclick = () => this.extractVideo();
    $('#an_toSheet').onclick = () => { if (!this.frames.length) return; Sheet.addFrames(this.frames.map((f, i) => ({ name: `${this.baseName()}_${String(i).padStart(3, '0')}`, canvas: cloneCanvas(f.c) }))); if (!Sheet.named) $('#sh_name').value = this.baseName(); showTab('sheet'); };
    $('#an_saveFrames').onclick = () => this.saveFrames();
    $('#an_export').onclick = () => exportAnimationDialog({ frames: this.frames, fps: this.player.fps, useDur: this.player.useDur, ping: this.player.ping, name: this.baseName() });
    bindDrop($('#an_view'), f => this.openFiles(f));
    this.player.listeners.push(() => this.drawMapHighlight());
    this.reset();
  },
  baseName() { return sanitize(stem((this.src && this.src.name) || 'anim')); },
  async openFiles(files) {
    const jsons = new Map();
    for (const f of files) if (extOf(f.name) === 'json') { try { jsons.set(stem(f.name), atlasToMeta(JSON.parse(await f.text()))); } catch (e) { } }
    const as = filesToAssets(files); if (!as.length) return;
    as[0].meta = jsons.get(stem(as[0].name)) || null; this.open(as[0]);
  },
  reset() {
    if (this.video) { this.video.pause(); this.video.remove(); this.video = null; }
    if (this.fallback) { this.fallback.remove(); this.fallback = null; }
    this.player.canvas.classList.remove('hidden'); $('#an_ctrls').classList.remove('hidden');
    for (const id of ['an_sheetOpts', 'an_videoOpts', 'an_frameActs', 'an_mapPanel', 'an_animSelF']) $('#' + id).classList.add('hidden');
    this.player.pause(); this.frames = []; this.player.setFrames([]); this.sheet = null; this.am = null;
  },
  async open(a) {
    if (!a) return; this.reset(); this.src = a; const k = assetKind(a);
    $('#an_title').textContent = a.name; $('#an_meta').textContent = '';
    if (k === 'video') return this.openVideo(a);
    if (k === 'gif') {
      const fr = await decodeAnimated(a.blob, 'image/gif');
      if (fr && fr.length) {
        this.type = 'gif'; this.frames = fr.map(f => ({ c: f.c, dur: f.dur }));
        this.ui.setDurAvailable(true); this.ui.dur.checked = true; this.player.useDur = true; this.ui.fps.disabled = true;
        const total = fr.reduce((s, f) => s + f.dur, 0);
        this.ui.setFps(Math.round(1000 / (total / fr.length)) || 10);
        $('#an_meta').textContent = `GIF · ${fr.length} frames · ${fr[0].c.width}×${fr[0].c.height} · ${(total / 1000).toFixed(2)} s`;
        $('#an_srcInfo').textContent = 'GIF decoded frame by frame. Untick "GIF timing" to try another FPS.';
        $('#an_frameActs').classList.remove('hidden');
        this.player.setFrames(this.frames); this.player.play(); return;
      }
      this.player.canvas.classList.add('hidden'); $('#an_ctrls').classList.add('hidden');
      this.fallback = h('img', { src: URL.createObjectURL(a.blob), class: 'pix', style: { margin: 'auto' } }); $('#an_view').append(this.fallback);
      $('#an_srcInfo').textContent = 'This browser cannot decode GIFs frame by frame. Use Chrome or Edge for play/pause/loop.';
      return;
    }
    let c; try { c = await blobToCanvas(a.blob); } catch (e) { return toast(e.message, 'err'); }
    this.openCanvas(c, a.meta && a.meta.am, a.name, true);
  },
  openCanvas(canvas, am, name, already) {
    if (!already) { this.reset(); this.src = { name: name + '.png' }; $('#an_title').textContent = name; }
    this.type = 'sheet'; this.sheet = canvas; this.am = am || null;
    this.ui.setDurAvailable(false);
    let cols = 1, rows = 1, pad = 0, margin = 0, count;
    if (am && am.type === 'sheet') { cols = am.cols; rows = am.rows; pad = am.padding || 0; margin = am.margin || 0; count = am.count; if (am.fps) this.ui.setFps(am.fps); }
    else { const w = canvas.width, hh = canvas.height; if (w > hh && w % hh === 0) cols = w / hh; else if (hh > w && hh % w === 0) rows = hh / w; }
    $('#an_cols').value = cols; $('#an_rows').value = rows; $('#an_pad').value = pad; $('#an_margin').value = margin;
    $('#an_start').value = 1; $('#an_end').value = count || cols * rows;
    const anims = (am && am.animations) || [];
    const sel = $('#an_animSel'); sel.innerHTML = '';
    if (am && am.type === 'sheet' && anims.length > 1) {
      anims.forEach((a, i) => sel.append(h('option', { value: i }, `${a.name} (${a.count} frames)`)));
      $('#an_animSelF').classList.remove('hidden'); $('#an_start').value = anims[0].start + 1; $('#an_end').value = anims[0].start + anims[0].count;
    }
    $('#an_srcInfo').textContent = am && am.type === 'sheet' ? 'Grid read from the sprite sheet JSON.' : 'Set the sprite sheet columns and rows. For a single image keep 1×1.';
    $('#an_sheetOpts').classList.remove('hidden'); $('#an_frameActs').classList.remove('hidden'); $('#an_mapPanel').classList.remove('hidden');
    this.slice(); if (this.frames.length > 1) this.player.play();
  },
  grid() {
    const cols = numVal('an_cols', 1), rows = numVal('an_rows', 1), pad = numVal('an_pad'), margin = numVal('an_margin');
    const fw = Math.max(1, Math.floor((this.sheet.width - 2 * margin - (cols - 1) * pad) / cols));
    const fh = Math.max(1, Math.floor((this.sheet.height - 2 * margin - (rows - 1) * pad) / rows));
    return { cols, rows, pad, margin, fw, fh, total: cols * rows };
  },
  cell(g, i) { const col = i % g.cols, row = Math.floor(i / g.cols); return { x: g.margin + col * (g.fw + g.pad), y: g.margin + row * (g.fh + g.pad), w: g.fw, h: g.fh }; },
  slice() {
    if (this.type !== 'sheet' || !this.sheet) return;
    const g = this.grid();
    const s = clamp(numVal('an_start', 1), 1, g.total), e = clamp(numVal('an_end', 1), s, g.total);
    this.range = [s - 1, e - 1];
    this.frames = []; for (let i = s - 1; i <= e - 1; i++) { const r = this.cell(g, i); this.frames.push({ c: cropRect(this.sheet, r.x, r.y, r.w, r.h) }); }
    this.player.setFrames(this.frames, { keepIndex: true });
    $('#an_frameSize').textContent = `frame ${g.fw}×${g.fh} px · ${g.total} cells · playing ${s}–${e}`;
    $('#an_meta').textContent = `${this.sheet.width}×${this.sheet.height} · ${this.frames.length} frames`;
    this.drawMap();
  },
  drawMap() {
    const box = $('#an_map'); box.innerHTML = ''; if (!this.sheet) return;
    const maxW = Math.max(200, box.clientWidth - 20 || 600);
    let z = Math.min(maxW / this.sheet.width, 280 / this.sheet.height); if (z >= 1) z = Math.min(4, Math.floor(z));
    const c = cloneCanvas(this.sheet); c.className = 'pix'; c.style.width = this.sheet.width * z + 'px'; c.style.height = this.sheet.height * z + 'px';
    const ov = newCanvas(this.sheet.width * z, this.sheet.height * z); ov.className = 'overlay'; ov.style.width = ov.width + 'px'; ov.style.height = ov.height + 'px';
    const wrap = h('div', { class: 'stagewrap' }, c, ov); box.append(wrap);
    this._map = { ov, z };
    wrap.addEventListener('click', e => {
      const r = wrap.getBoundingClientRect(); const x = (e.clientX - r.left) / z, y = (e.clientY - r.top) / z; const g = this.grid();
      const col = Math.floor((x - g.margin) / (g.fw + g.pad)), row = Math.floor((y - g.margin) / (g.fh + g.pad));
      if (col < 0 || row < 0 || col >= g.cols || row >= g.rows) return;
      const idx = row * g.cols + col;
      if (idx < this.range[0] || idx > this.range[1]) { $('#an_start').value = 1; $('#an_end').value = g.total; this.slice(); }
      this.player.seek(idx - this.range[0]);
    });
    this.drawMapHighlight();
  },
  drawMapHighlight() {
    if (!this._map || this.type !== 'sheet' || !this.sheet) return;
    const { ov, z } = this._map; const x = ov.getContext('2d'); x.clearRect(0, 0, ov.width, ov.height);
    const g = this.grid();
    for (let i = 0; i < g.total; i++) {
      const r = this.cell(g, i); const inR = i >= this.range[0] && i <= this.range[1]; const cur = i === this.range[0] + this.player.i;
      x.strokeStyle = cur ? '#ffc35a' : inR ? 'rgba(139,227,107,.8)' : 'rgba(255,255,255,.2)'; x.lineWidth = cur ? 2 : 1;
      if (cur) { x.fillStyle = 'rgba(255,195,90,.18)'; x.fillRect(r.x * z, r.y * z, r.w * z, r.h * z); }
      x.strokeRect(r.x * z + .5, r.y * z + .5, r.w * z - 1, r.h * z - 1);
    }
  },
  async openVideo(a) {
    this.type = 'video';
    this.player.canvas.classList.add('hidden'); $('#an_ctrls').classList.add('hidden');
    const v = h('video', { class: 'vplayer', src: URL.createObjectURL(a.blob), controls: true, autoplay: true, playsinline: true });
    v.muted = true; v.loop = $('#an_vloop').checked; v.playbackRate = +$('#an_vspeed').value;
    this.video = v; $('#an_view').append(v);
    v.addEventListener('loadedmetadata', () => { $('#an_meta').textContent = `${v.videoWidth}×${v.videoHeight} · ${v.duration.toFixed(2)} s`; $('#an_vend').value = Math.min(v.duration, 10).toFixed(2); });
    v.addEventListener('error', () => toast('This video format is not supported by the browser (try MP4 H.264 or WebM)', 'err', 6000));
    $('#an_videoOpts').classList.remove('hidden');
    $('#an_srcInfo').textContent = 'Use the video controls. To turn it into a sprite sheet or re-export it, extract the frames.';
  },
  async extractVideo() {
    if (!this.src) return;
    const opts = { fps: numVal('an_vfps', 1), max: numVal('an_vmax', 1), start: +$('#an_vstart').value || 0, end: +$('#an_vend').value || 0, key: $('#an_vkey').checked };
    let cs = [];
    try { busy('Extracting frames…'); cs = await extractVideoFrames(this.src.blob, opts, (n, t) => busy(`Extracting frames… ${n}/${t}`)); }
    catch (e) { toast(e.message, 'err'); } finally { busy(null); }
    if (!cs.length) return;
    const src = this.src; this.reset(); this.src = src; this.type = 'frames';
    this.frames = cs.map(c => ({ c })); this.ui.setFps(opts.fps);
    $('#an_meta').textContent = `${cs.length} frames extracted · ${cs[0].width}×${cs[0].height} · ${opts.fps} fps`;
    $('#an_srcInfo').textContent = 'Frames extracted from the video. Open the video again to go back to the original player.';
    $('#an_frameActs').classList.remove('hidden');
    this.player.setFrames(this.frames); this.player.play();
  },
  async saveFrames() {
    if (!this.frames.length) return;
    const def = this.baseName();
    const folder = await askText('Save frames', `Destination folder (inside "${App.project}")`, 'frames');
    if (!folder) return;
    const list = []; for (let i = 0; i < this.frames.length; i++) list.push({ folder: sanitize(folder), name: `${def}_${String(i).padStart(3, '0')}.png`, blob: await canvasToBlob(this.frames[i].c) });
    await withBusy('Saving frames…', () => opSave(list, `Save ${list.length} frames`));
    toast(`${list.length} frames saved to ${folder}`, 'ok');
  },
};
