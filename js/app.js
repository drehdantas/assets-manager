/* ================= app state ================= */
const App = {
  browser: null, backend: null, pendingHandle: null,
  project: null, folder: null, folders: [], stats: {}, seen: {}, newSince: 0,
  assets: [], selected: new Set(), lastClicked: null, filter: '',
  urls: new Map(), tab: 'library',
};
const ROOT_HINT = 'Documents\\Assets Manager';
const SUPPORT_URL = 'https://buymeacoffee.com/drehdantas';
const canPickDir = () => 'showDirectoryPicker' in window && window.self === window.top;
const TABS = ['library', 'sheet', 'trim', 'compress', 'anim', 'batch'];
const assetKey = a => `${a.project}/${a.folder}/${a.name}`;
function assetURL(a) {
  const k = assetKey(a) + '@' + a.blob.size + '@' + (a.created || 0);
  let u = App.urls.get(k); if (!u) { u = URL.createObjectURL(a.blob); App.urls.set(k, u); } return u;
}
const assetKind = a => kindOf(a.name, a.blob.type);
const isSheet = a => !!(a.meta && a.meta.am && a.meta.am.type === 'sheet');

/* ---------- library operations (all recorded in history) ---------- */
async function snap(a) {
  const blob = App.backend.kind === 'disk' ? new Blob([await a.blob.arrayBuffer()], { type: a.blob.type || mimeOf(a.name) }) : a.blob;
  return { project: a.project, folder: a.folder, name: a.name, meta: a.meta || null, blob };
}
async function afterLibChange() { await refreshFolders(App.folder); if (App.backend.kind !== 'disk') updateStorageUI(); }
async function opSave(list, label, { record = true, refresh = true } = {}) {
  const be = App.backend; const done = [];
  for (const it of list) { const p = it.project || App.project; const name = await be.saveAsset(p, it.folder, it.name, it.blob, it.meta || null); done.push({ ...it, project: p, name }); }
  if (record && done.length) History.push(label,
    async () => { for (const d of done) await be.deleteAsset(d.project, d.folder, d.name).catch(() => { }); },
    async () => { for (const d of done) d.name = await be.saveAsset(d.project, d.folder, d.name, d.blob, d.meta || null); });
  if (refresh) await afterLibChange();
  return done;
}
async function opDelete(assets, label) {
  const be = App.backend; const snaps = [];
  for (const a of assets) snaps.push(await snap(a));
  for (const s of snaps) await be.deleteAsset(s.project, s.folder, s.name);
  History.push(label || `Delete ${snaps.length} file(s)`,
    async () => { for (const s of snaps) await be.saveAsset(s.project, s.folder, s.name, s.blob, s.meta, { overwrite: true }); },
    async () => { for (const s of snaps) await be.deleteAsset(s.project, s.folder, s.name).catch(() => { }); });
  App.selected.clear(); await afterLibChange();
}
async function opRelocate(pairs, label) {
  // pairs: [{a, folder, name}] — move and/or rename
  const be = App.backend; const done = [];
  for (const { a, folder, name } of pairs) {
    if (a.folder === folder && a.name === name) continue;
    const s = await snap(a);
    const nn = await be.saveAsset(s.project, folder, name, s.blob, s.meta);
    await be.deleteAsset(s.project, s.folder, s.name);
    done.push({ s, folder, name: nn });
  }
  if (done.length) History.push(label,
    async () => { for (const d of done) { await be.deleteAsset(d.s.project, d.folder, d.name).catch(() => { }); await be.saveAsset(d.s.project, d.s.folder, d.s.name, d.s.blob, d.s.meta, { overwrite: true }); } },
    async () => { for (const d of done) { await be.saveAsset(d.s.project, d.folder, d.name, d.s.blob, d.s.meta, { overwrite: true }); await be.deleteAsset(d.s.project, d.s.folder, d.s.name).catch(() => { }); } });
  App.selected.clear(); await afterLibChange();
  return done;
}
const opMove = (assets, folder) => opRelocate(assets.map(a => ({ a, folder, name: a.name })), `Move ${assets.length} file(s) to ${folder}`);
async function opReplace(pairs, label) {
  // pairs: [{a, name, blob, meta}] — replace content and/or name of library files
  const be = App.backend; const olds = [];
  for (const p of pairs) olds.push(await snap(p.a));
  for (const s of olds) await be.deleteAsset(s.project, s.folder, s.name);
  const news = [];
  for (let i = 0; i < pairs.length; i++) { const s = olds[i], p = pairs[i]; const nn = await be.saveAsset(s.project, s.folder, p.name, p.blob, p.meta === undefined ? s.meta : p.meta); news.push({ project: s.project, folder: s.folder, name: nn, blob: p.blob, meta: p.meta === undefined ? s.meta : p.meta }); }
  History.push(label,
    async () => { for (const n of news) await be.deleteAsset(n.project, n.folder, n.name).catch(() => { }); for (const s of olds) await be.saveAsset(s.project, s.folder, s.name, s.blob, s.meta, { overwrite: true }); },
    async () => { for (const s of olds) await be.deleteAsset(s.project, s.folder, s.name).catch(() => { }); for (const n of news) await be.saveAsset(n.project, n.folder, n.name, n.blob, n.meta, { overwrite: true }); });
  App.selected.clear(); await afterLibChange();
  return news;
}

/* ---------- projects & folders ---------- */
async function refreshProjects(select) {
  let list = [];
  try { list = await App.backend.listProjects(); } catch (e) { console.error(e); toast('Could not read projects: ' + e.message, 'err'); }
  if (!list.length) { await App.backend.createProject('My Game'); list = ['My Game']; }
  const last = select || App.project || (await Store.kvGet('lastProject'));
  App.project = list.includes(last) ? last : list[0];
  const sel = $('#projSel'); sel.innerHTML = '';
  for (const p of list) sel.append(h('option', { value: p, selected: p === App.project }, p));
  Store.kvSet('lastProject', App.project).catch(() => { });
  await refreshFolders();
}
const seenKey = f => `${App.backend.kind}:${App.project}/${f}`;
function isNew(f) { const st = App.stats[f], s = App.seen[seenKey(f)]; if (!st || !s) return false; return st.latest > s.t || st.count > s.count; }
function markSeen(f) { const st = App.stats[f] || { count: 0, latest: 0 }; App.seen[seenKey(f)] = { t: Math.max(st.latest, Date.now()), count: st.count }; Store.kvSet('seen', App.seen).catch(() => { }); }
async function refreshFolders(select) {
  try { App.folders = await App.backend.listFolders(App.project); } catch (e) { App.folders = []; }
  if (!App.folders.length) { for (const f of DEFAULT_FOLDERS) await App.backend.createFolder(App.project, f); App.folders = await App.backend.listFolders(App.project); }
  const want = select || App.folder;
  const prev = App.folder;
  try { App.stats = await App.backend.folderStats(App.project); } catch (e) { App.stats = {}; }
  const cnt = f => (App.stats[f] || {}).count || 0;
  const orig = App.folders.find(f => /^origina/i.test(f));
  App.folder = App.folders.includes(want) ? want : (orig && cnt(orig) ? orig : (App.folders.find(f => cnt(f) > 0) || orig || App.folders[0]));
  for (const f of App.folders) if (!App.seen[seenKey(f)]) { const st = App.stats[f] || { count: 0, latest: 0 }; App.seen[seenKey(f)] = { t: st.latest, count: st.count }; }
  if (prev !== App.folder || !App.newSince) { const s = App.seen[seenKey(App.folder)]; App.newSince = s ? s.t : Date.now(); }
  markSeen(App.folder);
  renderFolders(); refreshFolderSelects();
  await refreshAssets();
}
function renderFolders() {
  const ul = $('#folderList'); ul.innerHTML = '';
  for (const f of App.folders) {
    const st = App.stats[f] || { count: 0 };
    const li = h('li', { class: f === App.folder ? 'active' : '', title: f + (isNew(f) ? ' — new files' : '') },
      h('span', {}, '📁'), h('span', { class: 'fname' }, f),
      isNew(f) && f !== App.folder ? h('span', { class: 'new-dot', title: 'New files' }) : null,
      h('span', { class: 'fcount' }, st.count),
      h('button', { class: 'del', title: 'Delete folder', onclick: async e => { e.stopPropagation(); await deleteFolder(f); } }, '✕'));
    li.addEventListener('click', async () => { if (f === App.folder && App.tab === 'library') return; App.selected.clear(); await refreshFolders(f); showTab('library'); });
    li.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('text/x-assets') || e.dataTransfer.types.includes('Files')) { e.preventDefault(); li.classList.add('drop'); } });
    li.addEventListener('dragleave', () => li.classList.remove('drop'));
    li.addEventListener('drop', async e => {
      e.preventDefault(); e.stopPropagation(); li.classList.remove('drop'); $('#libBody').classList.remove('dragging-files');
      if (e.dataTransfer.files.length) { await uploadFiles([...e.dataTransfer.files], f); return; }
      const names = JSON.parse(e.dataTransfer.getData('text/x-assets') || '[]');
      if (f !== App.folder) await opMove(App.assets.filter(a => names.includes(a.name)), f);
    });
    ul.append(li);
  }
}
async function deleteFolder(f) {
  if (!(await confirmBox('Delete folder', `Delete the folder "${f}" and every file inside it? (You can undo this.)`, 'Delete', true))) return;
  const be = App.backend, p = App.project;
  try {
    const snaps = []; for (const a of await be.listAssets(p, f)) snaps.push(await snap(a));
    await be.deleteFolder(p, f);
    History.push(`Delete folder ${f}`,
      async () => { await be.createFolder(p, f); for (const s of snaps) await be.saveAsset(p, f, s.name, s.blob, s.meta, { overwrite: true }); },
      async () => { await be.deleteFolder(p, f); });
    toast('Folder deleted', 'ok'); if (App.folder === f) App.folder = null; await refreshFolders();
  } catch (e) { toast(e.message, 'err'); }
}
function refreshFolderSelects() {
  for (const sel of $$('select[data-folder-default]')) {
    const def = sel.dataset.folderDefault; const cur = sel.value || def;
    const names = [...new Set([...App.folders, def, cur])].sort(naturalCmp);
    sel.innerHTML = '';
    for (const n of names) sel.append(h('option', { value: n, selected: n === cur }, n + (App.folders.includes(n) ? '' : ' (new)')));
  }
}

/* ---------- library ---------- */
async function refreshAssets() {
  try { App.assets = (await App.backend.listAssets(App.project, App.folder)).sort((a, b) => naturalCmp(a.name, b.name)); }
  catch (e) { App.assets = []; console.error(e); }
  for (const k of [...App.selected]) if (!App.assets.some(a => a.name === k)) App.selected.delete(k);
  renderLibrary();
}
function visibleAssets() { const f = App.filter.toLowerCase(); return f ? App.assets.filter(a => a.name.toLowerCase().includes(f)) : App.assets; }
function selectedAssets() { return App.assets.filter(a => App.selected.has(a.name)); }
function assetCard(a, { onClick, onDbl, selected, draggable, showNew } = {}) {
  const k = assetKind(a); const url = assetURL(a);
  let media;
  if (k === 'video') { media = h('video', { src: url, preload: 'metadata' }); media.muted = true; media.addEventListener('mouseenter', () => media.play().catch(() => { })); media.addEventListener('mouseleave', () => media.pause()); }
  else media = h('img', { src: url, loading: 'lazy', draggable: 'false' });
  const sub = h('div', { class: 'sub' }, fmtBytes(a.blob.size));
  const setDims = (w, hh) => { a.w = w; a.h = hh; sub.textContent = `${w}×${hh} · ${fmtBytes(a.blob.size)}`; };
  if (a.w) setDims(a.w, a.h);
  else if (k === 'video') media.addEventListener('loadedmetadata', () => setDims(media.videoWidth, media.videoHeight));
  else media.addEventListener('load', () => { setDims(media.naturalWidth, media.naturalHeight); if (media.naturalWidth < 150 && media.naturalHeight < 150) media.classList.add('px'); });
  if (a.w && a.w < 150 && a.h < 150 && media.tagName === 'IMG') media.classList.add('px');
  const badge = k === 'gif' ? h('span', { class: 'badge b-gif' }, 'GIF') : k === 'video' ? h('span', { class: 'badge b-video' }, extOf(a.name).toUpperCase()) : isSheet(a) ? h('span', { class: 'badge b-sheet' }, `SHEET ${a.meta.am.cols}×${a.meta.am.rows}`) : null;
  const card = h('div', { class: 'card' + (selected ? ' sel' : ''), title: a.name },
    h('div', { class: 'thumb checker' }, media), badge, showNew ? h('span', { class: 'badge b-new' }, 'NEW') : null, h('div', { class: 'chk' }, '✓'),
    h('div', { class: 'meta' }, h('div', { class: 'name' }, a.name), sub));
  if (onClick) card.addEventListener('click', e => onClick(e, a, card));
  if (onDbl) card.addEventListener('dblclick', () => onDbl(a));
  if (draggable) {
    card.draggable = true;
    card.addEventListener('dragstart', e => {
      if (!App.selected.has(a.name)) { App.selected.clear(); App.selected.add(a.name); updateSelectionUI(); }
      e.dataTransfer.setData('text/x-assets', JSON.stringify([...App.selected])); e.dataTransfer.effectAllowed = 'move';
    });
  }
  return card;
}
function renderLibrary() {
  const grid = $('#libGrid'); grid.innerHTML = '';
  const list = visibleAssets();
  $('#libEmpty').classList.toggle('hidden', list.length > 0);
  $('#dropFolder').textContent = `${App.project} / ${App.folder}`;
  for (const a of list) {
    const card = assetCard(a, {
      selected: App.selected.has(a.name), draggable: true, showNew: (a.created || 0) > App.newSince,
      onClick: (e, asset) => {
        const vis = visibleAssets().map(x => x.name);
        if (e.shiftKey && App.lastClicked) {
          const i1 = vis.indexOf(App.lastClicked), i2 = vis.indexOf(asset.name);
          if (i1 >= 0 && i2 >= 0) for (let i = Math.min(i1, i2); i <= Math.max(i1, i2); i++) App.selected.add(vis[i]);
        } else if (e.ctrlKey || e.metaKey || e.target.classList.contains('chk')) {
          App.selected.has(asset.name) ? App.selected.delete(asset.name) : App.selected.add(asset.name);
        } else {
          const only = App.selected.size === 1 && App.selected.has(asset.name);
          App.selected.clear(); if (!only) App.selected.add(asset.name);
        }
        App.lastClicked = asset.name; updateSelectionUI();
      },
      onDbl: a2 => previewAsset(a2),
    });
    card.dataset.name = a.name;
    grid.append(card);
  }
  updateSelectionUI();
}
function updateSelectionUI() {
  for (const c of $$('#libGrid .card')) c.classList.toggle('sel', App.selected.has(c.dataset.name));
  const n = App.selected.size;
  $('#libSelInfo').textContent = `${App.assets.length} file(s)` + (n ? ` · ${n} selected` : ' · click to select, double-click to open');
  for (const b of $$('#libActions button')) b.disabled = !n;
}
async function uploadFiles(files, folder = App.folder) {
  const jsons = new Map();
  for (const f of files) if (extOf(f.name) === 'json') { try { jsons.set(stem(f.name), atlasToMeta(JSON.parse(await f.text()))); } catch (e) { } }
  const list = []; let skipped = 0;
  for (const f of files) {
    const k = kindOf(f.name, f.type);
    if (k === 'json') continue;
    if (k === 'other') { skipped++; continue; }
    list.push({ folder, name: f.name, blob: f, meta: jsons.get(stem(f.name)) || null });
  }
  if (list.length) { await withBusy('Uploading…', () => opSave(list, `Upload ${list.length} file(s) to ${folder}`)); toast(`${list.length} file(s) uploaded to ${folder}`, 'ok'); }
  if (skipped) toast(`${skipped} file(s) skipped (unsupported format)`, 'warn');
}
async function libAction(act) {
  const sel = selectedAssets(); if (!sel.length) return;
  if (act === 'sheet') { showTab('sheet'); await Sheet.addAssets(sel); }
  else if (act === 'trim') { showTab('trim'); await Trim.addAssets(sel); }
  else if (act === 'compress') { showTab('compress'); await Compress.addAssets(sel); }
  else if (act === 'anim') { showTab('anim'); await Anim.open(sel[0]); }
  else if (act === 'batch') { showTab('batch'); await Batch.addAssets(sel); }
  else if (act === 'download') await downloadAssets(sel);
  else if (act === 'delete') {
    if (!(await confirmBox('Delete files', `Delete ${sel.length} file(s) from "${App.folder}"? You can undo this with Ctrl+Z.`, 'Delete', true))) return;
    await opDelete(sel); toast('Files deleted — Ctrl+Z to undo', 'ok');
  }
}
function sendToMenu(btn) {
  const sel = selectedAssets(); if (!sel.length) return;
  const others = App.folders.filter(f => f !== App.folder);
  openMenu(btn, [
    { header: `Open ${sel.length} file(s) in` },
    { icon: '▦', label: 'Sprite Sheet', onClick: () => libAction('sheet') },
    { icon: '✂', label: 'Trim / remove background', onClick: () => libAction('trim') },
    { icon: '⇣', label: 'Compress', onClick: () => libAction('compress') },
    { icon: '▶', label: 'Animation player / export', onClick: () => libAction('anim') },
    { icon: '☰', label: 'Batch rename & convert', onClick: () => libAction('batch') },
    '-',
    { header: 'Move to folder' },
    ...others.map(f => ({ icon: '📁', label: f, key: String((App.stats[f] || {}).count || 0), onClick: () => opMove(sel, f).then(() => toast(`Moved to ${f}`, 'ok')) })),
    { icon: '+', label: 'New folder…', onClick: async () => { const n = await askText('New folder', 'Folder name'); if (n) { await opMove(sel, sanitize(n)); toast(`Moved to ${sanitize(n)}`, 'ok'); } } },
  ]);
}
async function assetFiles(a) {
  const out = [{ name: a.name, blob: a.blob }];
  if (a.meta && a.meta.atlas) out.push({ name: stem(a.name) + '.json', blob: jsonBlob(withImageName(a.meta.atlas, a.name)) });
  return out;
}
async function downloadAssets(list) {
  const files = (await Promise.all(list.map(assetFiles))).flat();
  if (files.length === 1) return downloadBlob(files[0].name, files[0].blob);
  return downloadBlob(`${sanitize(App.project)}_${sanitize(App.folder)}.zip`, await makeZip(files));
}
async function previewAsset(a) {
  const k = assetKind(a); const box = h('div', { class: 'preview-big checker' });
  let media;
  if (k === 'video') { media = h('video', { src: assetURL(a), controls: true, loop: true, autoplay: true }); media.muted = true; }
  else media = h('img', { src: assetURL(a), class: (a.w && a.w < 300) ? 'pix' : '' });
  box.append(media);
  const setZoom = z => { if (media.tagName === 'IMG' && media.naturalWidth) { media.style.width = media.naturalWidth * z + 'px'; media.classList.toggle('pix', z >= 1); } };
  media.addEventListener('load', () => { const fit = Math.min(900 / media.naturalWidth, (innerHeight * 0.58) / media.naturalHeight); setZoom(fit >= 1 ? Math.min(8, Math.floor(fit)) : fit); });
  const info = h('p', { class: 'mono', style: { marginTop: '10px' } }, `${a.w ? a.w + '×' + a.h + ' · ' : ''}${fmtBytes(a.blob.size)} · ${a.project}/${a.folder}/${a.name}` + (isSheet(a) ? ` · grid ${a.meta.am.cols}×${a.meta.am.rows}, frame ${a.meta.am.frameW}×${a.meta.am.frameH}` : ''));
  const zoomRow = media.tagName === 'IMG' ? h('div', { class: 'row', style: { marginTop: '8px' } }, h('span', { class: 'muted' }, 'Zoom'), ...[0.25, 0.5, 1, 2, 4, 8].map(z => h('button', { class: 'btn sm', onclick: () => setZoom(z) }, z + '×'))) : null;
  const r = await modal({
    title: a.name, wide: true, body: h('div', {}, box, zoomRow, info),
    actions: [
      { label: 'Delete', value: 'del', danger: true },
      { label: 'Rename', value: 'ren' },
      { label: 'Download', value: 'dl' },
      (k !== 'image' || isSheet(a)) ? { label: '▶ Open in player', value: 'anim', primary: true } : { label: 'Trim', value: 'trim', primary: true },
    ]
  });
  if (r === 'dl') downloadAssets([a]);
  else if (r === 'anim') { showTab('anim'); Anim.open(a); }
  else if (r === 'trim') { showTab('trim'); Trim.addAssets([a]); }
  else if (r === 'del') { if (await confirmBox('Delete', `Delete "${a.name}"?`, 'Delete', true)) await opDelete([a], `Delete ${a.name}`); }
  else if (r === 'ren') {
    const nn = await askText('Rename file', 'New name', a.name); if (!nn || nn === a.name) return;
    let name = sanitize(nn); if (!extOf(name)) name += '.' + extOf(a.name);
    const d = await opRelocate([{ a, folder: a.folder, name }], `Rename ${a.name} → ${name}`); toast('Renamed to ' + (d[0] ? d[0].name : name), 'ok');
  }
}
/* library picker used by the tools */
async function pickAssets({ title = 'Choose from library', multiple = true, kinds = ['image', 'gif', 'video'] } = {}) {
  let folder = App.folder; let list = []; const chosen = new Set();
  const grid = h('div', { class: 'picker-grid' });
  const folderSel = h('select', { class: 'input sm', onchange: async e => { folder = e.target.value; chosen.clear(); await load(); } }, App.folders.map(f => h('option', { value: f, selected: f === folder }, f)));
  const allBtn = h('button', { class: 'btn sm', onclick: () => { list.forEach(a => chosen.add(a.name)); draw(); } }, 'Select all');
  const load = async () => { list = (await App.backend.listAssets(App.project, folder)).filter(a => kinds.includes(assetKind(a))).sort((a, b) => naturalCmp(a.name, b.name)); draw(); };
  const draw = () => {
    grid.innerHTML = '';
    if (!list.length) grid.append(h('div', { class: 'empty small' }, 'No compatible files in this folder.'));
    for (const a of list) grid.append(assetCard(a, {
      selected: chosen.has(a.name), onClick: (e, x, card) => {
        if (!multiple) chosen.clear();
        chosen.has(x.name) ? chosen.delete(x.name) : chosen.add(x.name);
        if (!multiple) draw(); else card.classList.toggle('sel', chosen.has(x.name));
      }
    }));
  };
  await load();
  const body = h('div', {}, h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Folder'), folderSel, multiple ? allBtn : null), grid);
  const r = await modal({ title, wide: true, body, actions: [{ label: 'Cancel', value: null }, { label: 'Add', primary: true, value: () => true }] });
  if (!r) return [];
  return list.filter(a => chosen.has(a.name));
}
function pickFiles(accept = 'image/*,video/*,.gif,.json', multiple = true) {
  return new Promise(res => {
    const inp = h('input', { type: 'file', accept, multiple });
    inp.addEventListener('change', () => res([...inp.files]));
    inp.click();
  });
}
const filesToAssets = files => files.filter(f => !['other', 'json'].includes(kindOf(f.name, f.type))).map(f => ({ project: null, folder: null, name: f.name, blob: f, meta: null, created: f.lastModified }));
async function saveToProject(folder, name, blob, meta, label) {
  const d = await opSave([{ folder, name, blob, meta }], label || `Save ${folder}/${name}`);
  return d[0].name;
}
async function askVideoExtract(a) {
  const v = await loadVideo(a.blob).catch(e => { toast(e.message, 'err'); return null; }); if (!v) return null;
  const dur = v.duration; URL.revokeObjectURL(v.src);
  const fps = h('input', { type: 'number', class: 'input', value: 12, min: 1, max: 60 });
  const st0 = h('input', { type: 'number', class: 'input', value: 0, min: 0, step: 0.1 });
  const en = h('input', { type: 'number', class: 'input', value: Math.min(dur, 10).toFixed(2), min: 0, step: 0.1 });
  const mx = h('input', { type: 'number', class: 'input', value: 120, min: 1 });
  const key = h('input', { type: 'checkbox' });
  const body = h('div', {}, h('p', {}, `${a.name} · ${v.videoWidth}×${v.videoHeight} · ${dur.toFixed(2)} s`),
    h('div', { class: 'field two' }, h('label', {}, 'FPS', fps), h('label', {}, 'Max frames', mx)),
    h('div', { class: 'field two' }, h('label', {}, 'Start (s)', st0), h('label', {}, 'End (s)', en)),
    h('label', { class: 'check' }, key, 'Remove background (flood from edges)'));
  return modal({ title: 'Extract video frames', body, actions: [{ label: 'Cancel', value: null }, { label: 'Extract', primary: true, value: () => ({ fps: +fps.value || 12, start: +st0.value || 0, end: +en.value || 0, max: +mx.value || 120, key: key.checked }) }] });
}
async function assetsToFrames(list) {
  const out = [];
  for (const a of list) {
    const k = assetKind(a);
    if (k === 'gif') {
      const fr = await decodeAnimated(a.blob, 'image/gif');
      if (fr && fr.length) { fr.forEach((f, i) => out.push({ name: `${stem(a.name)}_${String(i).padStart(3, '0')}`, canvas: f.c, dur: f.dur })); continue; }
    }
    if (k === 'video') {
      const opts = await askVideoExtract(a); if (!opts) continue;
      busy('Extracting video frames…');
      try { const cs = await extractVideoFrames(a.blob, opts, (n, t) => busy(`Extracting frames… ${n}/${t}`)); cs.forEach((c, i) => out.push({ name: `${stem(a.name)}_${String(i).padStart(3, '0')}`, canvas: c })); }
      finally { busy(null); }
      continue;
    }
    try { out.push({ name: stem(a.name), canvas: await blobToCanvas(a.blob) }); } catch (e) { toast(`${a.name}: ${e.message}`, 'err'); }
  }
  return out;
}

/* ---------- tabs ---------- */
function showTab(t) {
  App.tab = t;
  for (const b of $$('#tabs button')) b.classList.toggle('active', b.dataset.tab === t);
  for (const s of $$('.tab-panel')) s.classList.toggle('active', s.id === 'tab-' + t);
  try { if (location.hash !== '#' + t) history.replaceState(null, '', '#' + t); } catch (e) { }
  window.dispatchEvent(new Event('resize'));
}

/* ---------- storage: local folder ---------- */
function updateStorageUI() {
  const disk = App.backend.kind === 'disk';
  $('#storageBadge').innerHTML = '';
  $('#storageBadge').append(h('span', { class: 'dot' + (disk ? ' ok' : '') }), disk ? `Local folder: ${App.backend.root.name}` : 'Saving in this browser');
  const p = $('#storagePanel'); p.innerHTML = '';
  p.append(h('div', { class: 'side-title' }, 'Storage'));
  if (disk) {
    p.append(h('p', {}, 'Files are written straight to your computer:'),
      h('div', { class: 'path' }, `${App.backend.root.name}\\${App.project}\\…`),
      h('div', { class: 'stack' },
        h('button', { class: 'btn sm', onclick: copyBrowserToDisk }, 'Copy browser projects → folder'),
        h('button', { class: 'btn sm', onclick: disconnectFolder }, 'Disconnect folder')));
  } else {
    const direct = canPickDir();
    const changesBtn = h('button', { class: 'btn sm', onclick: downloadChanges, title: 'Download what changed since the last import/sync as a ZIP with the same folder structure' }, '⬇ Download changes');
    p.append(h('p', {}, direct ? 'Projects are stored in this browser. Connect a folder (e.g. ' : 'Projects are stored in this browser. This browser can\'t write to folders directly, so sync with your ', direct ? h('span', { class: 'mono' }, ROOT_HINT) : h('b', {}, 'Assets Manager folder'), direct ? ') to save straight to disk.' : ' using Import / Download changes.'),
      h('div', { class: 'stack' },
        direct && App.pendingHandle ? h('button', { class: 'btn sm primary', onclick: reconnectFolder }, `Reconnect "${App.pendingHandle.name}"`) : null,
        direct ? h('button', { class: 'btn sm' + (App.pendingHandle ? '' : ' primary'), onclick: connectFolder }, '📁 Connect computer folder') : null,
        h('div', { class: 'row' },
          h('button', { class: 'btn sm' + (direct ? '' : ' primary'), style: { flex: 1 }, onclick: importFolder, title: 'Read a folder from your computer (works in every browser)' }, '📂 Import folder'),
          changesBtn)));
    syncChangeCount().then(n => { changesBtn.textContent = `⬇ Changes (${n})`; changesBtn.disabled = !n; }).catch(() => { });
  }
  p.append(h('a', { class: 'support-link', href: SUPPORT_URL, target: '_blank', rel: 'noopener' }, '☕ Support us — buy me a coffee'));
}

/* ---------- any-browser folder sync: import a folder, download what changed ---------- */
function pickDirectory() {
  return new Promise(res => {
    const inp = h('input', { type: 'file', multiple: true }); inp.webkitdirectory = true;
    inp.addEventListener('change', () => res([...inp.files]));
    inp.addEventListener('cancel', () => res([]));
    inp.click();
  });
}
async function getSyncBase() { return (await Store.kvGet('syncBase')) || {}; }
async function setSyncBase(project, data) { const b = await getSyncBase(); b[project] = { ...(b[project] || {}), ...data }; await Store.kvSet('syncBase', b); }
async function syncChangeCount() {
  const base = (await getSyncBase())[App.project]; const t = base ? base.t : 0;
  return (await Store.aAll()).filter(a => a.project === App.project && (a.created || 0) > t).length;
}
async function importFolder() {
  const files = (await pickDirectory()).filter(f => !['other'].includes(kindOf(f.name, f.type)));
  if (!files.some(f => kindOf(f.name, f.type) !== 'json')) { if (files.length) toast('No images or videos found in that folder', 'warn'); return; }
  const rel = f => (f.webkitRelativePath || f.name).split('/');
  const root = rel(files[0])[0];
  const depth = Math.max(...files.map(f => rel(f).length));
  const def = depth >= 4 ? 'projects' : depth === 3 ? 'project' : 'current';
  const opt = (v, title, desc) => h('label', { class: 'check', style: { alignItems: 'flex-start' } }, h('input', { type: 'radio', name: 'imode', value: v, checked: v === def }), h('span', {}, h('b', {}, title), h('br'), h('small', {}, desc)));
  const repl = h('input', { type: 'checkbox', checked: true });
  const body = h('div', {},
    h('p', {}, `Found ${files.filter(f => kindOf(f.name, f.type) !== 'json').length} file(s) in "${root}". How should it be imported?`),
    opt('projects', `"${root}" contains my projects`, `e.g. the Assets Manager folder: ${root}/<project>/<folder>/files`),
    opt('project', `"${root}" is one project`, `${root}/<folder>/files becomes the project "${root}"`),
    opt('current', `Add into the current project (${App.project})`, `${root}/files becomes the folder "${root}"`),
    h('label', { class: 'check', style: { marginTop: '10px' } }, repl, 'Replace files that already exist with the same name'));
  const mode = await modal({ title: 'Import folder', body, actions: [{ label: 'Cancel', value: null }, { label: 'Import', primary: true, value: b => b.querySelector('input[name=imode]:checked').value }] });
  if (!mode) return;
  const target = f => {
    const parts = rel(f); const name = parts[parts.length - 1]; let project, fp;
    if (mode === 'projects') { project = parts.length >= 3 ? parts[1] : App.project; fp = parts.slice(2, -1); }
    else if (mode === 'project') { project = root; fp = parts.slice(1, -1); }
    else { project = App.project; fp = parts.slice(0, -1); }
    return { project: sanitize(project), folder: fp.length ? sanitize(fp.join('-')) : 'originals', name };
  };
  const be = App.browser; const existing = new Set(await be.listProjects());
  const jsons = new Map();
  for (const f of files) if (kindOf(f.name) === 'json') { const t = target(f); try { jsons.set(`${t.project}/${t.folder}/${stem(t.name)}`, atlasToMeta(JSON.parse(await f.text()))); } catch (e) { } }
  const done = [], overwritten = [], projects = new Set();
  await withBusy('Importing folder…', async () => {
    let i = 0; const list = files.filter(f => kindOf(f.name, f.type) !== 'json');
    for (const f of list) {
      const t = target(f); projects.add(t.project);
      if (!existing.has(t.project)) { await be.createProject(t.project).catch(() => { }); existing.add(t.project); }
      if (repl.checked) { const old = await Store.aGet(`${t.project}/${t.folder}/${t.name}`); if (old) overwritten.push(old); }
      const name = await be.saveAsset(t.project, t.folder, t.name, f, jsons.get(`${t.project}/${t.folder}/${stem(t.name)}`) || null, { overwrite: repl.checked });
      done.push({ project: t.project, folder: t.folder, name });
      if (++i % 20 === 0) busy(`Importing folder… ${i}/${list.length}`);
    }
  });
  const now = Date.now() + 1;
  for (const pr of projects) await setSyncBase(pr, { t: now, root, mode });
  History.push(`Import folder ${root} (${done.length} files)`,
    async () => { for (const d of done) await be.deleteAsset(d.project, d.folder, d.name).catch(() => { }); for (const o of overwritten) await Store.aPut(o); },
    async () => { toast('Re-import the folder to redo this', 'warn'); });
  toast(`Imported ${done.length} file(s) into ${projects.size} project(s)`, 'ok', 5000);
  App.folder = null; await refreshProjects(projects.has(App.project) ? App.project : [...projects].sort(naturalCmp)[0]); updateStorageUI();
}
async function downloadChanges() {
  const base = (await getSyncBase())[App.project]; const t = base ? base.t : 0;
  const changed = (await Store.aAll()).filter(a => a.project === App.project && (a.created || 0) > t);
  if (!changed.length) return toast('No changes since the last sync', 'info');
  const files = [];
  for (const a of changed) for (const x of await assetFiles(a)) files.push({ name: `${App.project}/${a.folder}/${x.name}`, blob: x.blob });
  const d = new Date(), pad = n => String(n).padStart(2, '0');
  const zipName = `${sanitize(App.project)}_changes_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}.zip`;
  const ok = await downloadBlob(zipName, await makeZip(files));
  if (!ok) return;
  await setSyncBase(App.project, { t: Date.now() + 1 });
  updateStorageUI();
  modal({
    title: 'Changes downloaded', body: h('div', {},
      h('p', {}, `${changed.length} new or changed file(s) were saved in `, h('b', {}, zipName), '.'),
      h('p', {}, 'Extract the ZIP ', h('b', {}, `into the folder that contains "${App.project}"`), ` (for example ${ROOT_HINT}) and choose "Replace" when asked. The files land in the right project sub-folders.`),
      h('p', {}, 'Deleted or renamed files are not removed from your computer automatically; delete the old ones by hand if needed.')),
    actions: [{ label: 'OK', primary: true, value: true }]
  });
}

async function useDisk(handle) {
  App.backend = new DiskBackend(handle); App.pendingHandle = null;
  try { await Store.kvSet('rootHandle', handle); } catch (e) { }
  App.folder = null; await refreshProjects(); updateStorageUI();
  toast(`Connected to folder "${handle.name}"`, 'ok');
}
async function connectFolder() {
  if (!canPickDir()) return folderHelp('This browser does not allow direct folder access.');
  try { await useDisk(await window.showDirectoryPicker({ id: 'assets-manager', mode: 'readwrite', startIn: 'documents' })); }
  catch (e) { if (e && e.name === 'AbortError') return; folderHelp('Folder access is blocked in this window (' + (e && e.name || 'error') + ').'); }
}
async function reconnectFolder() {
  try { const p = await App.pendingHandle.requestPermission({ mode: 'readwrite' }); if (p === 'granted') await useDisk(App.pendingHandle); else toast('Permission denied', 'warn'); }
  catch (e) { folderHelp('Could not reconnect (' + e.name + ').'); }
}
async function disconnectFolder() {
  App.backend = App.browser; try { await Store.kvSet('rootHandle', null); } catch (e) { }
  App.folder = null; await refreshProjects(); updateStorageUI(); toast('Using browser storage');
}
function folderHelp(reason) {
  return modal({
    title: 'Save straight to your computer folder', body: h('div', {},
      h('p', {}, reason),
      h('p', {}, h('b', {}, 'To write straight to a folder: '), 'open the app in Chrome or Edge (online at drehdantas.github.io/assets-manager, or the single-file version), click "Connect computer folder" and choose your Assets Manager folder. Each project becomes a sub-folder.'),
      h('p', {}, 'In other browsers (Firefox, Safari…) use ', h('b', {}, '📂 Import folder'), ' to load your folder and ', h('b', {}, '⬇ Changes'), ' to download what changed as a ZIP with the same structure.')),
    actions: [{ label: 'Got it', primary: true, value: true }]
  });
}
async function copyBrowserToDisk() {
  const projects = await App.browser.listProjects(); if (!projects.length) return toast('Nothing to copy');
  if (!(await confirmBox('Copy from browser', `Copy ${projects.length} project(s) from the browser into the connected folder? Files with the same name get a suffix.`, 'Copy'))) return;
  let n = 0;
  await withBusy('Copying…', async () => {
    for (const p of projects) for (const f of await App.browser.listFolders(p)) {
      await App.backend.root.getDirectoryHandle(p, { create: true }); await App.backend.createFolder(p, f);
      for (const a of await App.browser.listAssets(p, f)) { await App.backend.saveAsset(p, f, a.name, a.blob, a.meta); n++; }
    }
  });
  toast(`${n} file(s) copied`, 'ok'); await refreshProjects();
}
async function exportProject() {
  const files = [];
  await withBusy('Building project ZIP…', async () => {
    for (const f of App.folders) for (const a of await App.backend.listAssets(App.project, f))
      for (const x of await assetFiles(a)) files.push({ name: `${App.project}/${f}/${x.name}`, blob: x.blob });
  });
  if (!files.length) return toast('Project is empty', 'warn');
  downloadBlob(`${sanitize(App.project)}.zip`, await makeZip(files));
}
async function renameProject() {
  const old = App.project; const n = await askText('Rename project', 'New project name', old); if (!n) return;
  const nn = sanitize(n); if (nn === old) return;
  const be = App.backend;
  try {
    await withBusy('Renaming project…', () => be.renameProject(old, nn));
    try { const sb = await getSyncBase(); if (sb[old]) { sb[nn] = sb[old]; delete sb[old]; await Store.kvSet('syncBase', sb); } } catch (e) { }
    History.push(`Rename project ${old} → ${nn}`, async () => { await be.renameProject(nn, old); App.project = old; await refreshProjects(old); }, async () => { await be.renameProject(old, nn); App.project = nn; await refreshProjects(nn); });
    App.project = nn; await refreshProjects(nn); updateStorageUI(); toast('Project renamed', 'ok');
  } catch (e) { toast(e.message, 'err'); }
}

/* ---------- init ---------- */
async function init() {
  await Store.init();
  App.browser = new BrowserBackend(); App.backend = App.browser;
  App.seen = (await Store.kvGet('seen')) || {};
  try {
    const hd = await Store.kvGet('rootHandle');
    if (hd && hd.queryPermission) { const p = await hd.queryPermission({ mode: 'readwrite' }); if (p === 'granted') App.backend = new DiskBackend(hd); else App.pendingHandle = hd; }
  } catch (e) { }
  for (const b of $$('#tabs button')) b.addEventListener('click', () => showTab(b.dataset.tab));
  $('#projSel').addEventListener('change', async e => { App.project = e.target.value; App.folder = null; App.selected.clear(); Store.kvSet('lastProject', App.project).catch(() => { }); await refreshFolders(); updateStorageUI(); });
  $('#newProj').addEventListener('click', async () => {
    const n = await askText('New project', 'Project name (e.g. your game name)'); if (!n) return;
    const be = App.backend, nn = sanitize(n);
    try {
      await be.createProject(nn);
      History.push(`Create project ${nn}`, async () => { await be.deleteProject(nn); await refreshProjects(); }, async () => { await be.createProject(nn); await refreshProjects(nn); }, { lib: false });
      await refreshProjects(nn); updateStorageUI(); toast('Project created with the default folders', 'ok');
    } catch (e) { toast(e.message, 'err'); }
  });
  $('#renameProj').addEventListener('click', renameProject);
  $('#delProj').addEventListener('click', async () => {
    if (!(await confirmBox('Delete project', `Delete the project "${App.project}" and ALL its files? (You can undo this during this session.)`, 'Delete project', true))) return;
    const be = App.backend, p = App.project; const backup = [];
    await withBusy('Deleting…', async () => {
      for (const f of await be.listFolders(p)) { const as = []; for (const a of await be.listAssets(p, f)) as.push(await snap(a)); backup.push({ f, as }); }
      await be.deleteProject(p);
    });
    History.push(`Delete project ${p}`,
      async () => { await be.createProject(p).catch(() => { }); for (const { f, as } of backup) { await be.createFolder(p, f); for (const s of as) await be.saveAsset(p, f, s.name, s.blob, s.meta, { overwrite: true }); } await refreshProjects(p); },
      async () => { await be.deleteProject(p); await refreshProjects(); }, { lib: false });
    App.project = null; await refreshProjects(); updateStorageUI();
  });
  $('#exportProj').addEventListener('click', exportProject);
  $('#newFolder').addEventListener('click', async () => {
    const n = await askText('New folder', 'Folder name (e.g. characters, scenery, ui)'); if (!n) return;
    const be = App.backend, p = App.project, f = sanitize(n);
    await be.createFolder(p, f);
    History.push(`Create folder ${f}`, async () => { await be.deleteFolder(p, f); }, async () => { await be.createFolder(p, f); });
    await refreshFolders(f);
  });
  $('#libUpload').addEventListener('click', async () => { const f = await pickFiles(); if (f.length) uploadFiles(f); });
  $('#libSearch').addEventListener('input', e => { App.filter = e.target.value; renderLibrary(); });
  $('#libSendTo').addEventListener('click', e => sendToMenu(e.currentTarget));
  $('#libDownload').addEventListener('click', () => libAction('download'));
  $('#libDelete').addEventListener('click', () => libAction('delete'));
  $('#undoBtn').addEventListener('click', () => History.undo());
  $('#redoBtn').addEventListener('click', () => History.redo());
  $('#historyBtn').addEventListener('click', e => History.menu(e.currentTarget));
  const lb = $('#libBody'); let dragDepth = 0;
  lb.addEventListener('dragenter', e => { if (e.dataTransfer.types.includes('Files')) { dragDepth++; lb.classList.add('dragging-files'); } });
  lb.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) lb.classList.remove('dragging-files'); });
  lb.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });
  lb.addEventListener('drop', e => { e.preventDefault(); dragDepth = 0; lb.classList.remove('dragging-files'); if (e.dataTransfer.files.length) uploadFiles([...e.dataTransfer.files]); });
  document.addEventListener('dragover', e => e.preventDefault());
  document.addEventListener('drop', e => e.preventDefault());
  document.addEventListener('keydown', e => {
    const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement && document.activeElement.tagName) || $('.modal-back');
    if (typing) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? History.redo() : History.undo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); History.redo(); return; }
    if (App.tab === 'library') {
      if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); App.selected = new Set(visibleAssets().map(a => a.name)); updateSelectionUI(); }
      if (e.key === 'Delete' && App.selected.size) libAction('delete');
      if (e.key === 'Escape') { App.selected.clear(); updateSelectionUI(); }
    } else if (App.tab === 'anim' || App.tab === 'sheet') {
      const p = App.tab === 'anim' ? Anim.player : Sheet.player;
      if (e.key === ' ') { e.preventDefault(); p.toggle(); } else if (e.key === 'ArrowRight') p.step(1); else if (e.key === 'ArrowLeft') p.step(-1);
    }
  });
  Sheet.init(); Trim.init(); Compress.init(); Anim.init(); Batch.init();
  History.render();
  await refreshProjects(); updateStorageUI();
  const t = (location.hash || '').slice(1); if (TABS.includes(t)) showTab(t);
}
document.addEventListener('DOMContentLoaded', () => init().catch(e => { console.error(e); toast('Startup error: ' + e.message, 'err', 8000); }));
