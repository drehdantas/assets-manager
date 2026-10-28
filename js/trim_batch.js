/* ================= TRIM ================= */
const Trim = {
  items: [],
  init() {
    const rp = debounce(() => this.process(), 140);
    for (const id of ['tr_bgOn', 'tr_bgMode', 'tr_bgPick', 'tr_bgColor', 'tr_tol', 'tr_soft', 'tr_defringe', 'tr_alpha', 'tr_union', 'tr_pad', 'tr_mult']) $('#' + id).addEventListener('input', rp);
    $('#tr_alpha').addEventListener('input', e => $('#tr_alphaV').textContent = e.target.value);
    $('#tr_tol').addEventListener('input', e => $('#tr_tolV').textContent = e.target.value);
    $('#tr_soft').addEventListener('input', e => $('#tr_softV').textContent = e.target.value);
    $('#tr_bgOn').addEventListener('change', () => $('#tr_bgF').classList.toggle('hidden', !$('#tr_bgOn').checked));
    $('#tr_bgPick').addEventListener('change', () => $('#tr_bgCustom').classList.toggle('hidden', $('#tr_bgPick').value !== 'custom'));
    if (!('EyeDropper' in window)) $('#tr_eyedrop').classList.add('hidden');
    $('#tr_eyedrop').onclick = async () => { try { const r = await new EyeDropper().open(); $('#tr_bgColor').value = r.sRGBHex; this.process(); } catch (e) { } };
    $('#tr_add').onclick = async () => { const f = await pickFiles('image/*'); if (f.length) this.addAssets(filesToAssets(f)); };
    $('#tr_addLib').onclick = async () => { const l = await pickAssets({ title: 'Images to trim', kinds: ['image', 'gif'] }); if (l.length) this.addAssets(l); };
    $('#tr_clear').onclick = () => { this.commit('clear', () => { this.items = []; }); };
    $('#tr_save').onclick = () => this.save();
    $('#tr_zip').onclick = () => this.zip();
    $('#tr_toSheet').onclick = () => { if (!this.items.length) return; Sheet.addFrames(this.items.map(it => ({ name: stem(it.name), canvas: cloneCanvas(it.out) }))); showTab('sheet'); };
    bindDrop($('#tr_grid'), f => this.addAssets(filesToAssets(f)));
    this.render();
  },
  snapshot() { return this.items.map(it => ({ it, manual: it.manual ? { ...it.manual } : null })); },
  restore(s) { this.items = s.map(x => { x.it.manual = x.manual ? { ...x.manual } : null; return x.it; }); this.process(); },
  commit(label, fn) {
    const before = this.snapshot(); fn(); const after = this.snapshot();
    History.push('Trim: ' + label, () => this.restore(before), () => this.restore(after), { lib: false });
    this.process();
  },
  async addAssets(list) {
    let gifWarn = false; const add = [];
    for (const a of list) {
      const k = assetKind(a);
      if (k === 'video') { toast('Videos cannot be trimmed here', 'warn'); continue; }
      if (k === 'gif') gifWarn = true;
      try { add.push({ id: uid(), name: a.name, canvas: await blobToCanvas(a.blob), src: a.project ? a : null, manual: null }); } catch (e) { toast(`${a.name}: ${e.message}`, 'err'); }
    }
    if (gifWarn) toast('GIF: only the first frame is trimmed. For every frame, send the GIF to Sprite Sheet with trim on.', 'warn', 6000);
    if (add.length) this.commit(`add ${add.length} image(s)`, () => { this.items.push(...add); });
  },
  opts() {
    return {
      bg: $('#tr_bgOn').checked ? { mode: $('#tr_bgMode').value, tol: +$('#tr_tol').value, soft: +$('#tr_soft').value, defringe: $('#tr_defringe').checked, colors: $('#tr_bgPick').value === 'custom' ? [hexToRgb($('#tr_bgColor').value)] : null } : null,
      alpha: +$('#tr_alpha').value, union: $('#tr_union').value === 'union', pad: numVal('tr_pad'), mult: +$('#tr_mult').value
    };
  },
  process() {
    const o = this.opts(); const bgKey = JSON.stringify(o.bg);
    for (const it of this.items) {
      if (it._bgKey !== bgKey) { it.work = o.bg ? removeBackground(cloneCanvas(it.canvas), o.bg) : it.canvas; it._bgKey = bgKey; it._bk = null; }
      if (it._bk !== o.alpha) { it.box = contentBounds(it.work, { thr: o.alpha }); it._bk = o.alpha; }
    }
    let u = null; if (o.union) for (const it of this.items) if (it.box) u = u ? unionBox(u, it.box) : { ...it.box };
    for (const it of this.items) {
      let b = (o.union ? u : it.box) || { x: 0, y: 0, w: it.canvas.width, h: it.canvas.height };
      b = roundBox({ x: b.x - o.pad, y: b.y - o.pad, w: b.w + 2 * o.pad, h: b.h + 2 * o.pad }, o.mult);
      it.autoBox = b; it.fbox = it.manual || b; it.out = cropCanvas(it.work, it.fbox); it.empty = !it.box && !it.manual;
    }
    this.render();
  },
  async edit(it) {
    const r = await cropEditor(it.work, it.fbox, it.autoBox);
    if (!r) return;
    if (r === 'auto') return this.commit(`auto crop ${it.name}`, () => { it.manual = null; });
    if (r.all) this.commit('manual crop on all images', () => {
      for (const x of this.items) { const W = x.canvas.width, H = x.canvas.height; const bx = clamp(r.box.x, 0, W - 1), by = clamp(r.box.y, 0, H - 1); x.manual = { x: bx, y: by, w: clamp(r.box.w, 1, W - bx), h: clamp(r.box.h, 1, H - by) }; }
    });
    else this.commit(`manual crop ${it.name}`, () => { it.manual = r.box; });
  },
  render() {
    const g = $('#tr_grid'); g.innerHTML = ''; $('#tr_count').textContent = this.items.length ? `${this.items.length} image(s)` : '';
    if (!this.items.length) { g.append(h('div', { class: 'empty small', style: { gridColumn: '1/-1' } }, 'Drop the images exported from your drawing app. Empty space around them is removed automatically — or click "✎ Edit area" to choose the crop yourself.')); $('#tr_sum').textContent = ''; return; }
    let a0 = 0, a1 = 0;
    this.items.forEach(it => {
      if (!it.fbox) return;
      const W = it.canvas.width, H = it.canvas.height; const b = it.fbox;
      const s = Math.min(240 / W, 118 / H, 4);
      const before = newCanvas(W * s, H * s); const bx = ctx2d(before); bx.imageSmoothingEnabled = s < 1; bx.drawImage(it.work, 0, 0, before.width, before.height);
      bx.strokeStyle = it.manual ? '#62b6ff' : '#ff5ea8'; bx.lineWidth = 1.5; bx.setLineDash([4, 3]); bx.strokeRect(b.x * s + .5, b.y * s + .5, b.w * s - 1, b.h * s - 1);
      const after = thumbCanvas(it.out, 118);
      const red = 100 - (b.w * b.h) / (W * H) * 100; a0 += W * H; a1 += b.w * b.h;
      const beforeBox = h('div', { class: 'checker', style: { cursor: 'pointer' }, title: 'Click to edit the crop area', onclick: () => this.edit(it) }, before);
      g.append(h('div', { class: 'tcard' + (it.manual ? ' manual' : '') },
        h('div', { class: 'tb' }, beforeBox, h('div', { class: 'checker' }, after)),
        h('div', { class: 'tm' }, h('span', { class: 'name', title: it.name }, it.name, it.manual ? h('span', { class: 'tag' }, 'MANUAL') : null),
          h('div', { class: 'acts' },
            h('button', { class: 'btn sm', onclick: () => this.edit(it) }, '✎ Edit area'),
            h('button', { class: 'btn sm danger', title: 'Remove', onclick: () => this.commit(`remove ${it.name}`, () => { this.items = this.items.filter(x => x !== it); }) }, '✕'))),
        h('div', { class: 'dims', html: it.empty ? 'empty image (nothing to crop)' : `${W}×${H} → <b>${b.w}×${b.h}</b> · −${Math.max(0, red).toFixed(0)}% area` })));
    });
    $('#tr_sum').textContent = a0 ? `· total area −${(100 - a1 / a0 * 100).toFixed(0)}%` : '';
  },
  outName(it) { return stem(it.name) + ($('#tr_suffix').value || '') + '.png'; },
  async save() {
    if (!this.items.length) return toast('Add images first', 'warn');
    const folder = $('#tr_folder').value, over = $('#tr_overwrite').checked;
    await withBusy('Saving…', async () => {
      const replace = [], copies = [];
      for (const it of this.items) {
        const blob = await canvasToBlob(it.out);
        if (over && it.src) replace.push({ a: it.src, name: stem(it.src.name) + '.png', blob, meta: null });
        else copies.push({ folder, name: this.outName(it), blob });
      }
      if (replace.length) {
        const news = await opReplace(replace, `Trim: replace ${replace.length} original(s)`);
        // keep editing against the new library files
        let i = 0; for (const it of this.items) if (over && it.src) { const n = news[i++]; it.src = { ...it.src, name: n.name, blob: n.blob, meta: null }; }
      }
      if (copies.length) await opSave(copies, `Trim: save ${copies.length} image(s)`);
      toast(`${replace.length + copies.length} image(s) saved` + (replace.length ? ' (originals replaced — Ctrl+Z to undo)' : ` to ${folder}`), 'ok');
    });
  },
  async zip() {
    if (!this.items.length) return;
    const files = []; for (const it of this.items) files.push({ name: this.outName(it), blob: await canvasToBlob(it.out) });
    downloadBlob(files.length === 1 ? files[0].name : 'trim.zip', files.length === 1 ? files[0].blob : await makeZip(files));
  },
};

/* ================= BATCH ================= */
function splitWords(s) { return s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[\s_\-.]+/).filter(Boolean); }
function applyCase(s, mode) {
  const w = splitWords(s);
  switch (mode) {
    case 'lower': return s.toLowerCase();
    case 'upper': return s.toUpperCase();
    case 'snake': return w.map(x => x.toLowerCase()).join('_');
    case 'kebab': return w.map(x => x.toLowerCase()).join('-');
    case 'camel': return w.map((x, i) => i ? x[0].toUpperCase() + x.slice(1).toLowerCase() : x.toLowerCase()).join('');
    case 'pascal': return w.map(x => x[0].toUpperCase() + x.slice(1).toLowerCase()).join('');
    default: return s;
  }
}
const Batch = {
  items: [], dragId: null,
  init() {
    const rr = debounce(() => this.render(), 80);
    for (const id of ['bt_pattern', 'bt_start', 'bt_step', 'bt_pad', 'bt_find', 'bt_repl', 'bt_regex', 'bt_case', 'bt_format', 'bt_resize', 'bt_rval']) $('#' + id).addEventListener('input', rr);
    $('#bt_format').addEventListener('change', () => $('#bt_qF').classList.toggle('hidden', !['webp', 'jpg'].includes($('#bt_format').value)));
    $('#bt_q').addEventListener('input', e => $('#bt_qV').textContent = e.target.value);
    $('#bt_resize').addEventListener('change', () => { const v = $('#bt_resize').value; $('#bt_resizeF').classList.toggle('hidden', v === 'none'); $('#bt_rLbl').firstChild.textContent = v === 'max' ? 'Max width/height (px)' : 'Percent'; $('#bt_rval').value = v === 'max' ? 512 : 50; this.render(); });
    $('#bt_add').onclick = async () => { const f = await pickFiles(); if (f.length) this.addAssets(filesToAssets(f)); };
    $('#bt_addLib').onclick = async () => { const l = await pickAssets({ title: 'Files to rename / convert' }); if (l.length) this.addAssets(l); };
    $('#bt_sortName').onclick = () => { this.items.sort((a, b) => naturalCmp(a.name, b.name)); this.render(); };
    $('#bt_sortDate').onclick = () => { this.items.sort((a, b) => (a.created || 0) - (b.created || 0)); this.render(); };
    $('#bt_rev').onclick = () => { this.items.reverse(); this.render(); };
    $('#bt_clear').onclick = () => { this.items = []; this.render(); };
    $('#bt_inplace').onclick = () => this.applyInPlace();
    $('#bt_copies').onclick = () => this.saveCopies();
    $('#bt_zip').onclick = () => this.zip();
    bindDrop($('#bt_list'), f => this.addAssets(filesToAssets(f)));
    this.render();
  },
  async addAssets(list) {
    for (const a of list) {
      if (this.items.some(x => x.src === a || (a.project && x.src && assetKey(x.src) === assetKey(a)))) continue;
      const it = { id: uid(), name: a.name, blob: a.blob, src: a.project ? a : null, kind: assetKind(a), created: a.created || 0, url: URL.createObjectURL(a.blob), w: a.w || 0, h: a.h || 0 };
      if (!it.w && it.kind !== 'video') { try { const img = await loadImage(a.blob); it.w = img.naturalWidth; it.h = img.naturalHeight; } catch (e) { } }
      this.items.push(it);
    }
    this.render();
  },
  opts() {
    return {
      pattern: $('#bt_pattern').value || '{name}', start: +$('#bt_start').value || 0, step: +$('#bt_step').value || 1, pad: clamp(+$('#bt_pad').value || 1, 1, 8),
      find: $('#bt_find').value, repl: $('#bt_repl').value, regex: $('#bt_regex').checked, kase: $('#bt_case').value,
      format: $('#bt_format').value, q: +$('#bt_q').value / 100, resize: $('#bt_resize').value, rval: Math.max(1, +$('#bt_rval').value || 1), smooth: $('#bt_smooth').checked
    };
  },
  outExt(it, o) {
    const e0 = extOf(it.name);
    if (it.kind !== 'image' || e0 === 'svg') return e0;
    if (o.format !== 'keep') return o.format;
    if (o.resize !== 'none' && !['png', 'jpg', 'jpeg', 'webp'].includes(e0)) return 'png';
    return e0;
  },
  newName(it, i, o) {
    const n = String(o.start + i * o.step).padStart(o.pad, '0');
    let s = o.pattern.replace(/\{name\}/g, stem(it.name)).replace(/\{n\}/g, n).replace(/\{folder\}/g, it.src ? it.src.folder : '').replace(/\{w\}/g, it.w || '').replace(/\{h\}/g, it.h || '');
    if (o.find) {
      if (o.regex) { try { s = s.replace(new RegExp(o.find, 'g'), o.repl); this.reErr = null; } catch (e) { this.reErr = e.message; } }
      else s = s.split(o.find).join(o.repl);
    }
    s = applyCase(s, o.kase);
    return sanitize(s) + (this.outExt(it, o) ? '.' + this.outExt(it, o) : '');
  },
  changesContent(it, o) { return it.kind === 'image' && extOf(it.name) !== 'svg' && (o.resize !== 'none' || this.outExt(it, o) !== extOf(it.name)); },
  async outBlob(it, o) {
    if (!this.changesContent(it, o)) return it.blob;
    let c = await blobToCanvas(it.blob);
    if (o.resize === 'scale') c = scaleCanvas(c, o.rval / 100, o.smooth);
    else if (o.resize === 'max') { const s = Math.min(1, o.rval / Math.max(c.width, c.height)); c = scaleCanvas(c, s, o.smooth); }
    const ext = this.outExt(it, o); const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png';
    if (mime === 'image/jpeg') { const f = newCanvas(c.width, c.height); const x = ctx2d(f); x.fillStyle = '#fff'; x.fillRect(0, 0, f.width, f.height); x.drawImage(c, 0, 0); c = f; }
    return canvasToBlob(c, mime, mime === 'image/png' ? undefined : o.q);
  },
  render() {
    const box = $('#bt_list'); box.innerHTML = ''; const o = this.opts();
    $('#bt_count').textContent = this.items.length ? `${this.items.length} file(s)` : '';
    if (!this.items.length) { box.append(h('div', { class: 'empty small' }, 'Add files from the library (Library → Send to → Batch) or drop them here. Drag rows to change the numbering order.')); $('#bt_warn').textContent = ''; return; }
    this.reErr = null;
    const names = this.items.map((it, i) => this.newName(it, i, o));
    const lc = names.map(n => n.toLowerCase()); const dup = new Set(lc.filter((n, i) => lc.indexOf(n) !== i));
    $('#bt_warn').textContent = this.reErr ? ` · invalid regex: ${this.reErr}` : dup.size ? ` · ${dup.size} duplicate name(s) — they will get a suffix` : '';
    const t = h('table', { class: 'bt' }, h('tr', {}, h('th', {}, '#'), h('th', {}, ''), h('th', {}, 'Current name'), h('th', {}, 'New name'), h('th', {}, 'Info'), h('th', {}, '')));
    this.items.forEach((it, i) => {
      const thumb = it.kind === 'video' ? h('span', { class: 'badge b-video', style: { position: 'static' } }, 'VID') : h('img', { src: it.url, class: it.w && it.w < 64 ? 'pix' : '' });
      const nn = names[i];
      const tr = h('tr', { draggable: 'true' },
        h('td', { class: 'mono muted' }, i + 1),
        h('td', { class: 'th' }, h('div', { class: 'checker' }, thumb)),
        h('td', { class: 'old' }, it.name, it.src ? h('div', { class: 'muted', style: { fontSize: '10.5px' } }, it.src.folder) : null),
        h('td', { class: 'new' + (nn === it.name ? ' same' : '') + (dup.has(nn.toLowerCase()) ? ' dup' : '') }, nn),
        h('td', { class: 'mono muted', style: { fontSize: '11px' } }, `${it.w ? it.w + '×' + it.h + ' · ' : ''}${fmtBytes(it.blob.size)}`, this.changesContent(it, o) ? h('div', { style: { color: 'var(--blue)' } }, 'will be converted') : null),
        h('td', {}, h('button', { class: 'btn sm danger', title: 'Remove from list', onclick: () => { this.items.splice(i, 1); this.render(); } }, '✕')));
      tr.addEventListener('dragstart', e => { this.dragId = it.id; e.dataTransfer.setData('text/x-batch', String(it.id)); e.dataTransfer.effectAllowed = 'move'; });
      tr.addEventListener('dragover', e => { if (this.dragId == null) return; e.preventDefault(); tr.classList.add('drag-over'); });
      tr.addEventListener('dragleave', () => tr.classList.remove('drag-over'));
      tr.addEventListener('drop', e => {
        if (this.dragId == null) return; e.preventDefault(); e.stopPropagation();
        const from = this.items.findIndex(x => x.id === this.dragId); const [m] = this.items.splice(from, 1);
        const to = this.items.findIndex(x => x.id === it.id); this.items.splice(to < 0 ? this.items.length : to, 0, m); this.dragId = null; this.render();
      });
      tr.addEventListener('dragend', () => { this.dragId = null; });
      t.append(tr);
    });
    box.append(t);
  },
  async build() {
    const o = this.opts(); const out = [];
    for (let i = 0; i < this.items.length; i++) { busy(`Processing ${i + 1}/${this.items.length}…`); const it = this.items[i]; out.push({ it, name: this.newName(it, i, o), blob: await this.outBlob(it, o), converted: this.changesContent(it, o) }); }
    return out;
  },
  async applyInPlace() {
    const lib = this.items.filter(it => it.src);
    if (!lib.length) return toast('In-place rename only works for files that came from the library. Use "Save as copies" or ZIP.', 'warn', 6000);
    if (lib.length < this.items.length) toast(`${this.items.length - lib.length} uploaded file(s) are not in the library and will be skipped`, 'warn');
    if (!(await confirmBox('Rename in library', `Rename${this.opts().format !== 'keep' || this.opts().resize !== 'none' ? ' and convert' : ''} ${lib.length} file(s) in the library? You can undo with Ctrl+Z.`, 'Apply'))) return;
    let res;
    try {
      res = await this.build();
      const pairs = res.filter(r => r.it.src).map(r => ({ a: r.it.src, name: r.name, blob: r.blob, meta: r.converted ? null : undefined }));
      busy('Renaming…');
      const news = await opReplace(pairs, `Batch rename ${pairs.length} file(s)`);
      let k = 0; for (const r of res) if (r.it.src) { const n = news[k++]; r.it.src = { ...r.it.src, name: n.name, blob: n.blob, meta: n.meta }; r.it.name = n.name; r.it.blob = n.blob; }
      toast(`${pairs.length} file(s) renamed`, 'ok');
    } catch (e) { console.error(e); toast(e.message, 'err'); } finally { busy(null); }
    $('#bt_pattern').value = '{name}'; $('#bt_find').value = ''; $('#bt_repl').value = ''; $('#bt_case').value = 'keep'; $('#bt_format').value = 'keep'; $('#bt_resize').value = 'none'; $('#bt_resizeF').classList.add('hidden');
    this.render();
  },
  async saveCopies() {
    if (!this.items.length) return toast('Add files first', 'warn');
    const folder = $('#bt_folder').value;
    try { const res = await this.build(); busy('Saving…'); await opSave(res.map(r => ({ folder, name: r.name, blob: r.blob, meta: r.converted ? null : (r.it.src && r.it.src.meta) })), `Batch: save ${res.length} copies to ${folder}`); toast(`${res.length} file(s) saved to ${folder}`, 'ok'); }
    catch (e) { console.error(e); toast(e.message, 'err'); } finally { busy(null); }
  },
  async zip() {
    if (!this.items.length) return toast('Add files first', 'warn');
    let res; try { res = await this.build(); } finally { busy(null); }
    const used = new Set(); const files = res.map(r => { let n = r.name, i = 2; while (used.has(n.toLowerCase())) n = `${stem(r.name)}_${i++}.${extOf(r.name)}`; used.add(n.toLowerCase()); return { name: n, blob: r.blob }; });
    downloadBlob('renamed.zip', await makeZip(files));
  },
};
