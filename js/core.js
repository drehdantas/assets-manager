'use strict';
/* ================= utilities ================= */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'checked' || k === 'value' || k === 'selected' || k === 'disabled') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) { if (c == null || c === false) continue; el.append(c instanceof Node ? c : document.createTextNode(String(c))); }
  return el;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fmtBytes = n => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(2) + ' MB';
const naturalCmp = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
const sanitize = s => String(s).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().replace(/[. ]+$/, '') || 'sem_nome';
const extOf = n => { const i = n.lastIndexOf('.'); return i > 0 ? n.slice(i + 1).toLowerCase() : ''; };
const stem = n => { const i = n.lastIndexOf('.'); return i > 0 ? n.slice(0, i) : n; };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const IMG_EXT = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg', 'avif', 'ico', 'apng'];
const VID_EXT = ['mp4', 'webm', 'mov', 'm4v', 'ogv'];
const MIME = { png: 'image/png', apng: 'image/apng', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml', avif: 'image/avif', ico: 'image/x-icon', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/mp4', ogv: 'video/ogg', json: 'application/json' };
function kindOf(name, type = '') {
  const e = extOf(name);
  if (e === 'gif' || type === 'image/gif') return 'gif';
  if (VID_EXT.includes(e) || type.startsWith('video/')) return 'video';
  if (IMG_EXT.includes(e) || type.startsWith('image/')) return 'image';
  if (e === 'json') return 'json';
  return 'other';
}
const mimeOf = (name, blob) => (blob && blob.type) || MIME[extOf(name)] || '';
function debounce(fn, ms = 120) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
let _uid = 1; const uid = () => _uid++;

/* ================= UI: toasts, modais, ocupado ================= */
function toast(msg, type = 'info', ms = 3400) {
  const t = h('div', { class: 'toast ' + type }, msg);
  $('#toasts').append(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, ms);
}
function modal({ title, body, actions = [{ label: 'OK', value: true, primary: true }], wide = false, onOpen }) {
  return new Promise(res => {
    const back = h('div', { class: 'modal-back' });
    const box = h('div', { class: 'modal' + (wide ? ' wide' : '') });
    const key = e => { if (e.key === 'Escape') close(null); };
    const close = v => { back.remove(); document.removeEventListener('keydown', key); res(v); };
    box.append(h('div', { class: 'modal-head' }, h('h3', {}, title), h('button', { class: 'icon-btn sm', onclick: () => close(null), title: 'Close' }, '✕')));
    const bodyEl = h('div', { class: 'modal-body' });
    if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.append(body);
    box.append(bodyEl);
    if (actions.length) {
      const foot = h('div', { class: 'modal-foot' });
      for (const a of actions) foot.append(h('button', { class: 'btn' + (a.primary ? ' primary' : '') + (a.danger ? ' danger' : ''), onclick: () => close(typeof a.value === 'function' ? a.value(bodyEl) : a.value) }, a.label));
      box.append(foot);
    }
    back.append(box);
    back.addEventListener('mousedown', e => { if (e.target === back) close(null); });
    document.body.append(back);
    document.addEventListener('keydown', key);
    onOpen && onOpen(bodyEl, close);
  });
}
async function askText(title, label, value = '') {
  const inp = h('input', { class: 'input', type: 'text', value });
  const body = h('div', {}, h('label', { class: 'field' }, h('span', {}, label), inp));
  const r = await modal({
    title, body, actions: [{ label: 'Cancel', value: null }, { label: 'OK', primary: true, value: () => inp.value.trim() }],
    onOpen: (b, close) => { setTimeout(() => { inp.focus(); inp.select(); }, 0); inp.addEventListener('keydown', e => { if (e.key === 'Enter') close(inp.value.trim()); }); }
  });
  return r || null;
}
async function confirmBox(title, msg, okLabel = 'Confirm', danger = false) {
  return !!(await modal({ title, body: h('p', {}, msg), actions: [{ label: 'Cancel', value: false }, { label: okLabel, value: true, primary: !danger, danger }] }));
}
let _busyEl = null;
function busy(msg) {
  if (!msg) { _busyEl && _busyEl.remove(); _busyEl = null; return; }
  if (!_busyEl) { _busyEl = h('div', { class: 'busy' }, h('div', {}, h('div', { class: 'spin' }), h('span', {}))); document.body.append(_busyEl); }
  _busyEl.querySelector('span').textContent = msg;
}
async function withBusy(msg, fn) { busy(msg); await sleep(20); try { return await fn(); } catch (e) { console.error(e); toast(e.message || String(e), 'err', 5000); } finally { busy(null); } }

/* ================= arquivos: download e zip ================= */
let downloadsCap = null;
(async () => { try { if (window.claude && typeof claude.use === 'function') downloadsCap = await claude.use('downloads'); } catch (e) { downloadsCap = null; } })();
async function downloadBlob(name, blob) {
  if (downloadsCap) {
    try { await downloadsCap.save({ filename: name, data: blob }); toast('Download: ' + name, 'ok'); return true; }
    catch (e) {
      if (e && e.code === 'declined') { toast('Download canceled'); return false; }
      if (e && e.code === 'rate_limited') { toast('Wait a moment and try again', 'warn'); return false; }
      if (e && e.code === 'rejected_extension') { toast('This file type cannot be downloaded here', 'err'); return false; }
    }
  }
  try {
    const a = h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    return true;
  } catch (e) { toast('Could not download', 'err'); return false; }
}
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
async function makeZip(files) {
  const enc = new TextEncoder(); const parts = [], central = []; let offset = 0;
  const d = new Date();
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const f of files) {
    const data = new Uint8Array(await f.blob.arrayBuffer());
    const name = enc.encode(f.name); const crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
    lh.setUint16(10, time, true); lh.setUint16(12, date, true); lh.setUint32(14, crc, true);
    lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    parts.push(lh.buffer, name, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
    ch.setUint16(12, time, true); ch.setUint16(14, date, true); ch.setUint32(16, crc, true);
    ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true);
    ch.setUint32(42, offset, true);
    central.push(ch.buffer, name);
    offset += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((s, p) => s + p.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
}
const jsonBlob = o => new Blob([JSON.stringify(o, null, 2)], { type: 'application/json' });

/* ================= imagem ================= */
function newCanvas(w, hh) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(hh)); return c; }
function ctx2d(c) { return c.getContext('2d', { willReadFrequently: true }); }
function loadImage(blob) {
  return new Promise((res, rej) => {
    const u = URL.createObjectURL(blob); const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => { URL.revokeObjectURL(u); rej(new Error('Could not read the image')); };
    i.src = u;
  });
}
async function blobToCanvas(blob) {
  const img = await loadImage(blob);
  const w = img.naturalWidth || img.width || 512, hh = img.naturalHeight || img.height || 512;
  const c = newCanvas(w, hh); ctx2d(c).drawImage(img, 0, 0, w, hh);
  URL.revokeObjectURL(img.src);
  return c;
}
function canvasToBlob(c, type = 'image/png', q) { return new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('Failed to generate image')), type, q)); }
function scaleCanvas(src, s, smooth = true) {
  if (s === 1) return src;
  const c = newCanvas(src.width * s, src.height * s); const x = ctx2d(c);
  x.imageSmoothingEnabled = smooth; x.imageSmoothingQuality = 'high';
  if (smooth && s < 0.5) { // reduz em etapas para manter qualidade
    let cur = src;
    while (cur.width * 0.5 > c.width) { const t = newCanvas(cur.width * 0.5, cur.height * 0.5); const tx = ctx2d(t); tx.imageSmoothingQuality = 'high'; tx.drawImage(cur, 0, 0, t.width, t.height); cur = t; }
    x.drawImage(cur, 0, 0, c.width, c.height);
  } else x.drawImage(src, 0, 0, c.width, c.height);
  return c;
}
function thumbCanvas(src, max = 80) {
  const s = Math.min(max / src.width, max / src.height);
  const z = s >= 1 ? Math.min(Math.floor(s), 8) : s;
  const c = newCanvas(src.width * z, src.height * z); const x = ctx2d(c);
  x.imageSmoothingEnabled = z < 1; x.drawImage(src, 0, 0, c.width, c.height); return c;
}
function cropCanvas(src, box, pad = 0) { const c = newCanvas(box.w + pad * 2, box.h + pad * 2); ctx2d(c).drawImage(src, -box.x + pad, -box.y + pad); return c; }
function cropRect(src, x, y, w, hh) { const c = newCanvas(w, hh); ctx2d(c).drawImage(src, x, y, w, hh, 0, 0, w, hh); return c; }
function contentBounds(c, opt = {}) {
  const { mode = 'alpha', thr = 0, tol = 16 } = opt;
  const w = c.width, hh = c.height; const d = ctx2d(c).getImageData(0, 0, w, hh).data;
  let isC;
  if (mode === 'color') {
    const r0 = d[0], g0 = d[1], b0 = d[2], a0 = d[3];
    isC = o => Math.max(Math.abs(d[o] - r0), Math.abs(d[o + 1] - g0), Math.abs(d[o + 2] - b0), Math.abs(d[o + 3] - a0)) > tol;
  } else isC = o => d[o + 3] > thr;
  let top = -1, bottom = -1, left = w, right = -1;
  for (let y = 0; y < hh; y++) {
    const row = y * w * 4; let hit = false;
    for (let x = 0; x < w; x++) if (isC(row + x * 4)) { if (x < left) left = x; hit = true; break; }
    if (!hit) continue;
    if (top < 0) top = y; bottom = y;
    for (let x = w - 1; x > right; x--) if (isC(row + x * 4)) { right = x; break; }
  }
  if (top < 0) return null;
  return { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
}
function unionBox(a, b) { const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y); return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }; }
function roundBox(b, m) {
  if (m <= 1) return b;
  const nw = Math.ceil(b.w / m) * m, nh = Math.ceil(b.h / m) * m;
  return { x: b.x - Math.floor((nw - b.w) / 2), y: b.y - Math.floor((nh - b.h) / 2), w: nw, h: nh };
}
function keyOutColor(c, tol) {
  const x = ctx2d(c); const id = x.getImageData(0, 0, c.width, c.height); const d = id.data;
  const r0 = d[0], g0 = d[1], b0 = d[2];
  for (let o = 0; o < d.length; o += 4) if (Math.max(Math.abs(d[o] - r0), Math.abs(d[o + 1] - g0), Math.abs(d[o + 2] - b0)) <= tol) d[o + 3] = 0;
  x.putImageData(id, 0, 0); return c;
}
function regionEmpty(c, x, y, w, hh) {
  if (w <= 0 || hh <= 0) return true;
  const d = ctx2d(c).getImageData(x, y, w, hh).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return false;
  return true;
}
const nextPow2 = n => { let p = 1; while (p < n) p *= 2; return p; };
function cloneCanvas(src) { const c = newCanvas(src.width, src.height); ctx2d(c).drawImage(src, 0, 0); return c; }

async function decodeAnimated(blob, type) {
  if (!('ImageDecoder' in window)) return null;
  type = type || blob.type || 'image/gif';
  try {
    if (!(await ImageDecoder.isTypeSupported(type))) return null;
    const dec = new ImageDecoder({ data: await blob.arrayBuffer(), type });
    await dec.tracks.ready;
    const tr = dec.tracks.selectedTrack; const n = tr ? tr.frameCount : 1;
    const frames = [];
    for (let i = 0; i < n; i++) {
      const r = await dec.decode({ frameIndex: i }); const vf = r.image;
      const c = newCanvas(vf.displayWidth, vf.displayHeight); ctx2d(c).drawImage(vf, 0, 0);
      frames.push({ c, dur: vf.duration ? Math.max(20, vf.duration / 1000) : 100 });
      vf.close();
    }
    dec.close();
    return frames;
  } catch (e) { console.warn('decodeAnimated', e); return null; }
}
function seekVideo(v, t) {
  return new Promise(res => {
    let done = false; const fin = () => { if (done) return; done = true; v.removeEventListener('seeked', fin); res(); };
    v.addEventListener('seeked', fin); setTimeout(fin, 3000); v.currentTime = t;
  });
}
async function loadVideo(blob) {
  const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto';
  v.src = URL.createObjectURL(blob);
  await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error('This video format is not supported by the browser')); });
  return v;
}
async function extractVideoFrames(blob, { fps = 12, start = 0, end = 0, max = 120, key = false } = {}, onProgress) {
  const v = await loadVideo(blob);
  const dur = v.duration || 0; const stop = end > 0 ? Math.min(end, dur) : dur;
  const out = []; const step = 1 / fps;
  for (let t = start; t < stop - 1e-4 && out.length < max; t += step) {
    await seekVideo(v, Math.max(0.001, t));
    const c = newCanvas(v.videoWidth, v.videoHeight); ctx2d(c).drawImage(v, 0, 0);
    if (key) removeBackground(c, { mode: 'flood', tol: 28, soft: 16 });
    out.push(c); onProgress && onProgress(out.length, Math.ceil((stop - start) * fps));
  }
  URL.revokeObjectURL(v.src);
  return out;
}

/* ================= PNG encoders and quantization ================= */
async function zlibDeflate(u8) {
  const cs = new CompressionStream('deflate');
  const stream = new Blob([u8]).stream().pipeThrough(cs);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
function pngChunk(type, data) {
  const out = new Uint8Array(12 + data.length); const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
function ihdr(w, hh, bd, ct) { const d = new Uint8Array(13); const dv = new DataView(d.buffer); dv.setUint32(0, w); dv.setUint32(4, hh); d[8] = bd; d[9] = ct; return d; }
const PNG_SIG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
async function encodePNGRGBA(img, alpha = true) {
  const { width: w, height: hh, data } = img; const bpp = alpha ? 4 : 3; const rb = w * bpp;
  const raw = new Uint8Array((rb + 1) * hh);
  let prev = new Uint8Array(rb), cur = new Uint8Array(rb);
  const cand = [0, 1, 2, 3, 4].map(() => new Uint8Array(rb));
  for (let y = 0; y < hh; y++) {
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4, d = x * bpp;
      if (alpha && data[s + 3] === 0) { cur[d] = cur[d + 1] = cur[d + 2] = cur[d + 3] = 0; continue; }
      cur[d] = data[s]; cur[d + 1] = data[s + 1]; cur[d + 2] = data[s + 2]; if (alpha) cur[d + 3] = data[s + 3];
    }
    let best = 0, bestSum = Infinity;
    for (let f = 0; f < 5; f++) {
      const o = cand[f]; let sum = 0;
      for (let i = 0; i < rb; i++) {
        const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
        let v;
        if (f === 0) v = cur[i];
        else if (f === 1) v = cur[i] - a;
        else if (f === 2) v = cur[i] - b;
        else if (f === 3) v = cur[i] - ((a + b) >> 1);
        else { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v = cur[i] - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); }
        v &= 255; o[i] = v; sum += v < 128 ? v : 256 - v;
        if (sum >= bestSum) break;
      }
      if (sum < bestSum) { bestSum = sum; best = f; }
    }
    // recalcula o melhor filtro completo (o laço acima pode ter parado cedo)
    const o = cand[best];
    for (let i = 0; i < rb; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0; let v;
      if (best === 0) v = cur[i]; else if (best === 1) v = cur[i] - a; else if (best === 2) v = cur[i] - b; else if (best === 3) v = cur[i] - ((a + b) >> 1);
      else { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v = cur[i] - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); }
      o[i] = v & 255;
    }
    raw[y * (rb + 1)] = best; raw.set(o, y * (rb + 1) + 1);
    const t = prev; prev = cur; cur = t;
  }
  const z = await zlibDeflate(raw);
  return new Blob([PNG_SIG, pngChunk('IHDR', ihdr(w, hh, 8, alpha ? 6 : 2)), pngChunk('IDAT', z), pngChunk('IEND', new Uint8Array(0))], { type: 'image/png' });
}
async function encodePNGIndexed(w, hh, idx, palette) {
  // ordena paleta: entradas com alfa < 255 primeiro (tRNS menor)
  const order = palette.map((p, i) => i).sort((a, b) => (palette[a][3] === 255) - (palette[b][3] === 255));
  const remap = new Uint8Array(palette.length); order.forEach((old, ni) => remap[old] = ni);
  const pal = order.map(i => palette[i]);
  const n = pal.length; const bd = n <= 2 ? 1 : n <= 4 ? 2 : n <= 16 ? 4 : 8;
  const rowBytes = Math.ceil(w * bd / 8); const raw = new Uint8Array((rowBytes + 1) * hh);
  const ppb = 8 / bd;
  for (let y = 0; y < hh; y++) {
    const o = y * (rowBytes + 1) + 1;
    for (let x = 0; x < w; x++) {
      const v = remap[idx[y * w + x]];
      if (bd === 8) raw[o + x] = v;
      else raw[o + Math.floor(x / ppb)] |= v << (8 - bd * ((x % ppb) + 1));
    }
  }
  const plte = new Uint8Array(n * 3); pal.forEach((p, i) => { plte[i * 3] = p[0]; plte[i * 3 + 1] = p[1]; plte[i * 3 + 2] = p[2]; });
  let lastA = -1; pal.forEach((p, i) => { if (p[3] < 255) lastA = i; });
  const chunks = [PNG_SIG, pngChunk('IHDR', ihdr(w, hh, bd, 3)), pngChunk('PLTE', plte)];
  if (lastA >= 0) chunks.push(pngChunk('tRNS', new Uint8Array(pal.slice(0, lastA + 1).map(p => p[3]))));
  chunks.push(pngChunk('IDAT', await zlibDeflate(raw)), pngChunk('IEND', new Uint8Array(0)));
  return new Blob(chunks, { type: 'image/png' });
}
function analyzeImage(img) {
  const d = img.data; const set = new Set(); let hasAlpha = false, anyTransparent = false;
  for (let o = 0; o < d.length; o += 4) {
    const a = d[o + 3];
    if (a < 255) { hasAlpha = true; if (a === 0) { anyTransparent = true; set.add(0); continue; } }
    if (set.size <= 256) set.add(((d[o] << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | a) >>> 0);
  }
  return { unique: set.size, hasAlpha, anyTransparent, exact: set.size <= 256 ? set : null };
}
function exactIndexed(img, set) {
  const pal = [], map = new Map(); const d = img.data;
  for (const k of set) { map.set(k, pal.length); pal.push(k === 0 ? [0, 0, 0, 0] : [k >>> 24, (k >>> 16) & 255, (k >>> 8) & 255, k & 255]); }
  const idx = new Uint8Array(img.width * img.height);
  for (let i = 0, o = 0; i < idx.length; i++, o += 4) {
    const a = d[o + 3]; idx[i] = a === 0 ? map.get(0) : map.get(((d[o] << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | a) >>> 0);
  }
  return { idx, palette: pal };
}
const W_R = 2, W_G = 4, W_B = 3, W_A = 3;
function nearestIdx(pal, start, r, g, b, a) {
  let best = start, bd = Infinity;
  for (let j = start; j < pal.length; j++) {
    const p = pal[j]; const dr = r - p[0], dg = g - p[1], db = b - p[2], da = a - p[3];
    const dist = W_R * dr * dr + W_G * dg * dg + W_B * db * db + W_A * da * da;
    if (dist < bd) { bd = dist; best = j; if (dist === 0) break; }
  }
  return best;
}
function quantize(img, k, dither = false) {
  const { data: d, width: w, height: hh } = img; const N = w * hh;
  let anyT = false;
  const build = sh => {
    const m = new Map();
    for (let i = 0, o = 0; i < N; i++, o += 4) {
      const a = d[o + 3]; if (a === 0) { anyT = true; continue; }
      const key = (((d[o] >> sh) << 24) | ((d[o + 1] >> sh) << 16) | ((d[o + 2] >> sh) << 8) | (a >> sh)) >>> 0;
      let e = m.get(key); if (!e) { e = [0, 0, 0, 0, 0]; m.set(key, e); }
      e[0] += d[o]; e[1] += d[o + 1]; e[2] += d[o + 2]; e[3] += a; e[4]++;
    }
    return m;
  };
  let hist = build(0); if (hist.size > 32768) hist = build(2); if (hist.size > 32768) hist = build(3);
  const entries = [...hist.values()].map(e => [e[0] / e[4], e[1] / e[4], e[2] / e[4], e[3] / e[4], e[4]]);
  const kk = Math.max(1, anyT ? k - 1 : k);
  let pal;
  if (entries.length <= kk) pal = entries.map(e => [e[0], e[1], e[2], e[3]]);
  else {
    const mk = list => {
      const mn = [255, 255, 255, 255], mx = [0, 0, 0, 0]; let cnt = 0;
      for (const e of list) { for (let c = 0; c < 4; c++) { if (e[c] < mn[c]) mn[c] = e[c]; if (e[c] > mx[c]) mx[c] = e[c]; } cnt += e[4]; }
      const wts = [1, 1.2, 0.9, 1]; let ch = 0, rg = -1;
      for (let c = 0; c < 4; c++) { const r = (mx[c] - mn[c]) * wts[c]; if (r > rg) { rg = r; ch = c; } }
      return { e: list, ch, range: rg, count: cnt };
    };
    const boxes = [mk(entries)];
    while (boxes.length < kk) {
      let bi = -1, bs = -1;
      for (let i = 0; i < boxes.length; i++) { const b = boxes[i]; if (b.e.length < 2 || b.range <= 0) continue; const s = b.range * Math.sqrt(b.count); if (s > bs) { bs = s; bi = i; } }
      if (bi < 0) break;
      const b = boxes[bi]; const ch = b.ch; b.e.sort((x, y) => x[ch] - y[ch]);
      let acc = 0, cut = 0; const half = b.count / 2;
      for (; cut < b.e.length - 2; cut++) { acc += b.e[cut][4]; if (acc >= half) break; }
      boxes.splice(bi, 1, mk(b.e.slice(0, cut + 1)), mk(b.e.slice(cut + 1)));
    }
    pal = boxes.map(b => { let r = 0, g = 0, bb = 0, a = 0, c = 0; for (const e of b.e) { r += e[0] * e[4]; g += e[1] * e[4]; bb += e[2] * e[4]; a += e[3] * e[4]; c += e[4]; } return [r / c, g / c, bb / c, a / c]; });
    // refinamento k-means
    const iters = entries.length * pal.length > 6e6 ? 1 : 3;
    for (let it = 0; it < iters; it++) {
      const s = pal.map(() => [0, 0, 0, 0, 0]);
      for (const e of entries) { const j = nearestIdx(pal, 0, e[0], e[1], e[2], e[3]); const t = s[j]; t[0] += e[0] * e[4]; t[1] += e[1] * e[4]; t[2] += e[2] * e[4]; t[3] += e[3] * e[4]; t[4] += e[4]; }
      pal = pal.map((p, j) => s[j][4] ? [s[j][0] / s[j][4], s[j][1] / s[j][4], s[j][2] / s[j][4], s[j][3] / s[j][4]] : p);
    }
  }
  pal = pal.map(p => p.map(v => clamp(Math.round(v), 0, 255)));
  const start = anyT ? 1 : 0;
  if (anyT) pal.unshift([0, 0, 0, 0]);
  const idx = new Uint8Array(N); const cache = new Map();
  const near = (r, g, b, a) => { const key = ((r << 24) | (g << 16) | (b << 8) | a) >>> 0; let j = cache.get(key); if (j === undefined) { j = nearestIdx(pal, start, r, g, b, a); cache.set(key, j); } return j; };
  if (!dither) {
    for (let i = 0, o = 0; i < N; i++, o += 4) idx[i] = d[o + 3] === 0 ? 0 : near(d[o], d[o + 1], d[o + 2], d[o + 3]);
  } else {
    const er = new Float32Array(d.length); for (let i = 0; i < d.length; i++) er[i] = d[i];
    const add = (x, y, f, e0, e1, e2, e3) => { if (x < 0 || x >= w || y >= hh) return; const o = (y * w + x) * 4; if (d[o + 3] === 0) return; er[o] += e0 * f; er[o + 1] += e1 * f; er[o + 2] += e2 * f; er[o + 3] += e3 * f; };
    for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, o = i * 4;
      if (d[o + 3] === 0) { idx[i] = 0; continue; }
      const r = clamp(Math.round(er[o]), 0, 255), g = clamp(Math.round(er[o + 1]), 0, 255), b = clamp(Math.round(er[o + 2]), 0, 255), a = clamp(Math.round(er[o + 3]), 1, 255);
      const j = near(r, g, b, a); idx[i] = j; const p = pal[j];
      const e0 = r - p[0], e1 = g - p[1], e2 = b - p[2], e3 = a - p[3];
      add(x + 1, y, 7 / 16, e0, e1, e2, e3); add(x - 1, y + 1, 3 / 16, e0, e1, e2, e3); add(x, y + 1, 5 / 16, e0, e1, e2, e3); add(x + 1, y + 1, 1 / 16, e0, e1, e2, e3);
    }
  }
  return { idx, palette: pal };
}
function psnr(a, b) {
  if (a.width !== b.width || a.height !== b.height) return 0;
  const A = a.data, B = b.data; let se = 0, n = 0;
  for (let i = 0; i < A.length; i += 4) {
    if (A[i + 3] === 0 && B[i + 3] === 0) continue;
    const aa = A[i + 3] / 255, ba = B[i + 3] / 255;
    const dr = A[i] * aa - B[i] * ba, dg = A[i + 1] * aa - B[i + 1] * ba, db = A[i + 2] * aa - B[i + 2] * ba, da = A[i + 3] - B[i + 3];
    se += dr * dr + dg * dg + db * db + da * da; n += 4;
  }
  if (se === 0 || n === 0) return Infinity;
  return 10 * Math.log10(65025 / (se / n));
}
async function blobToImageData(blob, w, hh) {
  const c = await blobToCanvas(blob);
  if (w && (c.width !== w || c.height !== hh)) { const t = newCanvas(w, hh); ctx2d(t).drawImage(c, 0, 0, w, hh); return ctx2d(t).getImageData(0, 0, w, hh); }
  return ctx2d(c).getImageData(0, 0, c.width, c.height);
}
