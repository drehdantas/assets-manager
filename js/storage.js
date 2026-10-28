/* ================= armazenamento ================= */
const DB_NAME = 'assets-manager-v1';
let _db = null, memMode = false;
const mem = { kv: new Map(), assets: new Map() };
function idbOpen() {
  if (_db) return Promise.resolve(_db);
  return new Promise((res, rej) => {
    let r; try { r = indexedDB.open(DB_NAME, 1); } catch (e) { rej(e); return; }
    r.onupgradeneeded = () => { const d = r.result; if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv'); if (!d.objectStoreNames.contains('assets')) d.createObjectStore('assets', { keyPath: 'key' }); };
    r.onsuccess = () => { _db = r.result; res(_db); };
    r.onerror = () => rej(r.error);
  });
}
const reqP = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
async function st(name, mode) { const db = await idbOpen(); return db.transaction(name, mode).objectStore(name); }
const Store = {
  async init() { try { await idbOpen(); } catch (e) { memMode = true; console.warn('IndexedDB unavailable; using memory'); } },
  async kvGet(k) { if (memMode) return mem.kv.get(k); try { return await reqP((await st('kv', 'readonly')).get(k)); } catch (e) { return undefined; } },
  async kvSet(k, v) { if (memMode) { mem.kv.set(k, v); return; } return reqP((await st('kv', 'readwrite')).put(v, k)); },
  async aAll() { if (memMode) return [...mem.assets.values()]; return reqP((await st('assets', 'readonly')).getAll()); },
  async aGet(key) { if (memMode) return mem.assets.get(key); return reqP((await st('assets', 'readonly')).get(key)); },
  async aPut(rec) { if (memMode) { mem.assets.set(rec.key, rec); return; } return reqP((await st('assets', 'readwrite')).put(rec)); },
  async aDel(key) { if (memMode) { mem.assets.delete(key); return; } return reqP((await st('assets', 'readwrite')).delete(key)); },
};
const DEFAULT_FOLDERS = ['originals', 'trim', 'spritesheets', 'compressed', 'frames', 'exports'];
async function uniqueName(exists, name) {
  if (!(await exists(name))) return name;
  const s = stem(name), e = extOf(name);
  for (let i = 2; i < 100000; i++) { const n = `${s}_${i}${e ? '.' + e : ''}`; if (!(await exists(n))) return n; }
  return name;
}
class BrowserBackend {
  constructor() { this.kind = 'browser'; }
  async _projects() { return (await Store.kvGet('projects')) || []; }
  async _save(p) { await Store.kvSet('projects', p); }
  async listProjects() { return (await this._projects()).map(p => p.name).sort(naturalCmp); }
  async createProject(name) {
    const ps = await this._projects();
    if (ps.some(p => p.name.toLowerCase() === name.toLowerCase())) throw new Error('A project with this name already exists');
    ps.push({ name, folders: [...DEFAULT_FOLDERS] }); await this._save(ps);
  }
  async deleteProject(name) {
    await this._save((await this._projects()).filter(p => p.name !== name));
    for (const a of await Store.aAll()) if (a.project === name) await Store.aDel(a.key);
  }
  async listFolders(p) { const pr = (await this._projects()).find(x => x.name === p); return pr ? [...pr.folders].sort(naturalCmp) : []; }
  async createFolder(p, f) {
    const ps = await this._projects(); let pr = ps.find(x => x.name === p);
    if (!pr) { pr = { name: p, folders: [] }; ps.push(pr); }
    if (!pr.folders.includes(f)) { pr.folders.push(f); await this._save(ps); }
  }
  async deleteFolder(p, f) {
    const ps = await this._projects(); const pr = ps.find(x => x.name === p);
    if (pr) { pr.folders = pr.folders.filter(x => x !== f); await this._save(ps); }
    for (const a of await Store.aAll()) if (a.project === p && a.folder === f) await Store.aDel(a.key);
  }
  async listAssets(p, f) {
    return (await Store.aAll()).filter(a => a.project === p && a.folder === f)
      .map(a => ({ project: p, folder: f, name: a.name, blob: a.blob, meta: a.meta || null, created: a.created }));
  }
  async saveAsset(p, f, name, blob, meta = null, { overwrite = false } = {}) {
    await this.createFolder(p, f); name = sanitize(name);
    if (!overwrite) name = await uniqueName(async n => !!(await Store.aGet(`${p}/${f}/${n}`)), name);
    await Store.aPut({ key: `${p}/${f}/${name}`, project: p, folder: f, name, blob, meta, created: Date.now() });
    return name;
  }
  async deleteAsset(p, f, n) { await Store.aDel(`${p}/${f}/${n}`); }
  async folderStats(p) {
    const out = {};
    for (const a of await Store.aAll()) if (a.project === p) { const s = out[a.folder] || (out[a.folder] = { count: 0, latest: 0 }); s.count++; s.latest = Math.max(s.latest, a.created || 0); }
    return out;
  }
  async renameProject(oldN, newN) {
    const ps = await this._projects();
    if (ps.some(p => p.name.toLowerCase() === newN.toLowerCase() && p.name !== oldN)) throw new Error('A project with this name already exists');
    const pr = ps.find(p => p.name === oldN); if (!pr) throw new Error('Project not found');
    pr.name = newN; await this._save(ps);
    for (const a of await Store.aAll()) if (a.project === oldN) { await Store.aDel(a.key); a.project = newN; a.key = `${newN}/${a.folder}/${a.name}`; await Store.aPut(a); }
  }
}
class DiskBackend {
  constructor(root) { this.root = root; this.kind = 'disk'; }
  async _dirs(hd) { const out = []; for await (const [n, e] of hd.entries()) if (e.kind === 'directory' && !n.startsWith('.')) out.push(n); return out.sort(naturalCmp); }
  async listProjects() { return this._dirs(this.root); }
  async _p(p, create = false) { return this.root.getDirectoryHandle(p, { create }); }
  async _f(p, f, create = false) { return (await this._p(p, create)).getDirectoryHandle(f, { create }); }
  async createProject(name) {
    let exists = false; try { await this.root.getDirectoryHandle(name); exists = true; } catch (e) { }
    if (exists) throw new Error('A project with this name already exists');
    const ph = await this._p(name, true);
    for (const f of DEFAULT_FOLDERS) await ph.getDirectoryHandle(f, { create: true });
  }
  async deleteProject(name) { await this.root.removeEntry(name, { recursive: true }); }
  async listFolders(p) { return this._dirs(await this._p(p)); }
  async createFolder(p, f) { await this._f(p, f, true); }
  async deleteFolder(p, f) { await (await this._p(p)).removeEntry(f, { recursive: true }); }
  async listAssets(p, f) {
    const dh = await this._f(p, f); const files = new Map();
    for await (const [n, e] of dh.entries()) if (e.kind === 'file') files.set(n, e);
    const out = [];
    for (const [n, e] of files) {
      const k = kindOf(n); if (k === 'json' || k === 'other') continue;
      const file = await e.getFile(); let meta = null;
      const j = files.get(stem(n) + '.json');
      if (j) { try { meta = atlasToMeta(JSON.parse(await (await j.getFile()).text())); } catch (er) { } }
      out.push({ project: p, folder: f, name: n, blob: file, meta, created: file.lastModified });
    }
    return out;
  }
  async _exists(dh, n) { try { await dh.getFileHandle(n); return true; } catch { return false; } }
  async _write(dh, n, blob) { const fh = await dh.getFileHandle(n, { create: true }); const w = await fh.createWritable(); await w.write(blob); await w.close(); }
  async saveAsset(p, f, name, blob, meta = null, { overwrite = false } = {}) {
    const dh = await this._f(p, f, true); name = sanitize(name);
    if (!overwrite) name = await uniqueName(async n => (await this._exists(dh, n)) || (meta && meta.atlas ? await this._exists(dh, stem(n) + '.json') : false), name);
    await this._write(dh, name, blob);
    if (meta && meta.atlas) await this._write(dh, stem(name) + '.json', jsonBlob(withImageName(meta.atlas, name)));
    return name;
  }
  async folderStats(p) {
    const out = {}; const ph = await this._p(p);
    for await (const [f, e] of ph.entries()) {
      if (e.kind !== 'directory' || f.startsWith('.')) continue; const s = out[f] = { count: 0, latest: 0 };
      for await (const [n, fe] of e.entries()) { if (fe.kind !== 'file') continue; const k = kindOf(n); if (k === 'json' || k === 'other') continue; s.count++; try { s.latest = Math.max(s.latest, (await fe.getFile()).lastModified); } catch (er) { } }
    }
    return out;
  }
  async _copyDir(src, dst) {
    for await (const [n, e] of src.entries()) {
      if (e.kind === 'directory') await this._copyDir(e, await dst.getDirectoryHandle(n, { create: true }));
      else await this._write(dst, n, await e.getFile());
    }
  }
  async renameProject(oldN, newN) {
    let exists = false; try { await this.root.getDirectoryHandle(newN); exists = true; } catch (e) { }
    if (exists) throw new Error('A project with this name already exists');
    const src = await this._p(oldN);
    if (typeof src.move === 'function') { try { await src.move(newN); return; } catch (e) { } }
    await this._copyDir(src, await this._p(newN, true));
    await this.root.removeEntry(oldN, { recursive: true });
  }
  async deleteAsset(p, f, n) {
    const dh = await this._f(p, f); await dh.removeEntry(n);
    try { if (await this._exists(dh, stem(n) + '.json')) await dh.removeEntry(stem(n) + '.json'); } catch { }
  }
}
function withImageName(atlas, name) { return { ...atlas, meta: { ...(atlas.meta || {}), image: name } }; }
/** Converte um JSON de atlas (formato TexturePacker/Aseprite ou o nosso) em meta com grade */
function atlasToMeta(js) {
  if (!js || typeof js !== 'object') return null;
  if (js.meta && js.meta.am) return { am: js.meta.am, atlas: js };
  let fr = js.frames; if (!fr) return null;
  const list = Array.isArray(fr) ? fr.map(f => f.frame) : Object.values(fr).map(f => f.frame);
  if (!list.length || !list[0]) return { atlas: js };
  const fw = list[0].w, fh = list[0].h;
  if (!list.every(f => f && f.w === fw && f.h === fh)) return { atlas: js };
  const xs = [...new Set(list.map(f => f.x))].sort((a, b) => a - b), ys = [...new Set(list.map(f => f.y))].sort((a, b) => a - b);
  const pad = xs.length > 1 ? xs[1] - xs[0] - fw : ys.length > 1 ? ys[1] - ys[0] - fh : 0;
  const anims = [];
  if (Array.isArray(js.meta && js.meta.frameTags)) js.meta.frameTags.forEach(t => anims.push({ name: t.name, start: t.from, count: t.to - t.from + 1 }));
  return { atlas: js, am: { type: 'sheet', cols: xs.length, rows: ys.length, frameW: fw, frameH: fh, count: list.length, padding: Math.max(0, pad), margin: xs[0] || 0, animations: anims } };
}
