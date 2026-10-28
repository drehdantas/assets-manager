/* ================= background removal ================= */
function cornerColors(d, W, H) {
  const pts = [[0, 0], [W - 1, 0], [0, H - 1], [W - 1, H - 1]]; const out = [];
  for (const [x, y] of pts) {
    const o = (y * W + x) * 4; if (d[o + 3] === 0) continue;
    const c = [d[o], d[o + 1], d[o + 2]];
    if (!out.some(e => Math.max(Math.abs(e[0] - c[0]), Math.abs(e[1] - c[1]), Math.abs(e[2] - c[2])) < 12)) out.push(c);
  }
  return out;
}
const hexToRgb = hx => { const n = parseInt(hx.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
/** Removes a solid background. mode 'flood' = only regions connected to the borders; 'global' = every matching pixel. */
function removeBackground(c, { mode = 'flood', tol = 24, soft = 16, colors = null, defringe = true } = {}) {
  const W = c.width, H = c.height; const x = ctx2d(c); const id = x.getImageData(0, 0, W, H); const d = id.data; const N = W * H;
  const refs = colors && colors.length ? colors : cornerColors(d, W, H);
  if (!refs.length) return c; // already transparent corners
  const dist = o => {
    if (d[o + 3] === 0) return 0;
    let best = 1e9;
    for (const r of refs) { const v = Math.max(Math.abs(d[o] - r[0]), Math.abs(d[o + 1] - r[1]), Math.abs(d[o + 2] - r[2])); if (v < best) best = v; }
    return best;
  };
  const alpha = new Float32Array(N).fill(1);
  const edge = soft > 0 ? tol + soft : tol;
  const partial = d2 => soft > 0 ? clamp((d2 - tol) / soft, 0, 1) : 1;
  if (mode === 'global') {
    for (let i = 0; i < N; i++) { const dv = dist(i * 4); if (dv <= tol) alpha[i] = 0; else if (dv < edge) alpha[i] = partial(dv); }
  } else {
    const seen = new Uint8Array(N); const q = new Int32Array(N); let qh = 0, qt = 0;
    const seed = i => { if (seen[i]) return; const dv = dist(i * 4); if (dv <= tol) { seen[i] = 1; q[qt++] = i; } };
    for (let xx = 0; xx < W; xx++) { seed(xx); seed((H - 1) * W + xx); }
    for (let yy = 0; yy < H; yy++) { seed(yy * W); seed(yy * W + W - 1); }
    while (qh < qt) {
      const i = q[qh++]; alpha[i] = 0; const px = i % W, py = (i / W) | 0;
      const nb = [px > 0 ? i - 1 : -1, px < W - 1 ? i + 1 : -1, py > 0 ? i - W : -1, py < H - 1 ? i + W : -1];
      for (const n of nb) {
        if (n < 0 || seen[n]) continue; seen[n] = 1;
        const dv = dist(n * 4);
        if (dv <= tol) q[qt++] = n; else if (dv < edge) alpha[n] = Math.min(alpha[n], partial(dv));
      }
    }
  }
  for (let i = 0; i < N; i++) {
    const a = alpha[i]; if (a >= 1) continue; const o = i * 4;
    if (a <= 0) { d[o + 3] = 0; continue; }
    if (defringe) {
      let r = refs[0], bd = 1e9;
      for (const rr of refs) { const v = Math.abs(d[o] - rr[0]) + Math.abs(d[o + 1] - rr[1]) + Math.abs(d[o + 2] - rr[2]); if (v < bd) { bd = v; r = rr; } }
      for (let k = 0; k < 3; k++) d[o + k] = clamp(Math.round((d[o + k] - r[k] * (1 - a)) / a), 0, 255);
    }
    d[o + 3] = Math.round(d[o + 3] * a);
  }
  x.putImageData(id, 0, 0); return c;
}

/* ================= GIF encoder ================= */
function lzwEncode(pixels, minCode) {
  const out = []; const clearCode = 1 << minCode, eoi = clearCode + 1;
  let codeSize = minCode + 1, maxcode = (1 << codeSize) - 1, next = eoi + 1, clearFlag = false;
  let cur = 0, bits = 0; const dict = new Map();
  const write = code => {
    cur |= code << bits; bits += codeSize;
    while (bits >= 8) { out.push(cur & 255); cur >>>= 8; bits -= 8; }
    if (next > maxcode || clearFlag) {
      if (clearFlag) { codeSize = minCode + 1; maxcode = (1 << codeSize) - 1; clearFlag = false; }
      else { codeSize++; maxcode = codeSize === 12 ? 4096 : (1 << codeSize) - 1; }
    }
  };
  write(clearCode);
  let ent = pixels[0];
  for (let i = 1; i < pixels.length; i++) {
    const c = pixels[i]; const key = (c << 12) | ent; const v = dict.get(key);
    if (v !== undefined) { ent = v; continue; }
    write(ent); ent = c;
    if (next < 4096) dict.set(key, next++);
    else { dict.clear(); next = eoi + 1; clearFlag = true; write(clearCode); }
  }
  write(ent); write(eoi);
  if (bits > 0) out.push(cur & 255);
  return out;
}
async function encodeGIF(seq, { W, H, render, transparent, repeat = 0 }, onProgress) {
  const cv = newCanvas(W, H); const x = ctx2d(cv);
  // 1) global palette from a sample of frames
  const step = Math.max(1, Math.ceil(seq.length * W * H / 2.5e6));
  const sampleFrames = seq.filter((_, i) => i % step === 0).slice(0, 48);
  const sh = Math.max(1, Math.round(Math.sqrt(W * H * sampleFrames.length / 1.2e6)));
  const sw = Math.max(1, Math.round(W / sh)), shh = Math.max(1, Math.round(H / sh));
  const sample = newCanvas(sw, shh * sampleFrames.length); const sx = ctx2d(sample); sx.imageSmoothingEnabled = false;
  sampleFrames.forEach((f, i) => { render(x, f.c); sx.drawImage(cv, 0, i * shh, sw, shh); });
  const sd = sx.getImageData(0, 0, sample.width, sample.height);
  for (let i = 3; i < sd.data.length; i += 4) { if (sd.data[i] < 128) { sd.data[i - 3] = sd.data[i - 2] = sd.data[i - 1] = sd.data[i] = 0; } else sd.data[i] = 255; }
  let { palette } = quantize(sd, 256, false);
  const hasT = transparent && palette.length && palette[0][3] === 0;
  if (transparent && !hasT) palette.unshift([0, 0, 0, 0]);
  if (palette.length > 256) palette = palette.slice(0, 256);
  const start = transparent ? 1 : 0;
  let bitsN = 1; while ((1 << bitsN) < palette.length) bitsN++;
  const tableSize = 1 << bitsN; const minCode = Math.max(2, bitsN);
  const bytes = [];
  const push16 = v => bytes.push(v & 255, (v >> 8) & 255);
  for (const ch of 'GIF89a') bytes.push(ch.charCodeAt(0));
  push16(W); push16(H); bytes.push(0xF0 | (bitsN - 1), 0, 0);
  for (let i = 0; i < tableSize; i++) { const p = palette[i] || [0, 0, 0]; bytes.push(p[0], p[1], p[2]); }
  if (repeat != null) { bytes.push(0x21, 0xFF, 0x0B); for (const ch of 'NETSCAPE2.0') bytes.push(ch.charCodeAt(0)); bytes.push(0x03, 0x01); push16(repeat); bytes.push(0x00); }
  const cache = new Map(); let t = 0;
  const parts = [new Uint8Array(bytes)];
  for (let fi = 0; fi < seq.length; fi++) {
    const f = seq[fi]; render(x, f.c);
    const d = x.getImageData(0, 0, W, H).data; const idx = new Uint8Array(W * H);
    for (let i = 0, o = 0; i < idx.length; i++, o += 4) {
      if (transparent && d[o + 3] < 128) { idx[i] = 0; continue; }
      const key = ((d[o] << 16) | (d[o + 1] << 8) | d[o + 2]) >>> 0;
      let j = cache.get(key); if (j === undefined) { j = nearestIdx(palette, start, d[o], d[o + 1], d[o + 2], 255); cache.set(key, j); }
      idx[i] = j;
    }
    const cs0 = Math.round(t / 10); t += f.dur; const delay = Math.max(2, Math.round(t / 10) - cs0);
    const fb = [0x21, 0xF9, 0x04, ((transparent ? 2 : 1) << 2) | (transparent ? 1 : 0), delay & 255, (delay >> 8) & 255, 0, 0,
      0x2C, 0, 0, 0, 0, W & 255, (W >> 8) & 255, H & 255, (H >> 8) & 255, 0, minCode];
    const lz = lzwEncode(idx, minCode);
    const sub = [];
    for (let i = 0; i < lz.length; i += 255) { const n = Math.min(255, lz.length - i); sub.push(n); for (let k = 0; k < n; k++) sub.push(lz[i + k]); }
    sub.push(0);
    parts.push(new Uint8Array(fb), new Uint8Array(sub));
    onProgress && onProgress(fi + 1, seq.length);
    if (fi % 3 === 2) await sleep(0);
  }
  parts.push(new Uint8Array([0x3B]));
  return new Blob(parts, { type: 'image/gif' });
}

/* ================= video encoder (WebCodecs) ================= */
const VIDEO_CODECS = { mp4: ['avc1.640028', 'avc1.4d0028', 'avc1.42E028', 'avc1.42001f'], webm: ['vp09.00.40.08', 'vp09.00.10.08', 'vp8'] };
async function findVideoConfig(format, W, H, fps, alpha = false) {
  if (!('VideoEncoder' in window)) return null;
  const bitrate = Math.round(clamp(W * H * fps * 0.14, 1.5e6, 24e6));
  for (const codec of VIDEO_CODECS[format]) {
    const cfg = { codec, width: W, height: H, bitrate, framerate: fps };
    if (format === 'mp4') cfg.avc = { format: 'avc' };
    if (alpha) cfg.alpha = 'keep';
    try { const s = await VideoEncoder.isConfigSupported(cfg); if (s.supported) return cfg; } catch (e) { }
  }
  return null;
}
async function encodeVideo(seq, { W, H, render, format, loops = 1, alpha = false, fps = 12 }, onProgress) {
  const cfg = await findVideoConfig(format, W, H, fps, alpha);
  if (!cfg) throw new Error(format === 'mp4' ? 'This browser cannot encode MP4 (H.264). Try WebM or use Chrome/Edge.' : 'This browser cannot encode WebM. Use Chrome or Edge.');
  const isMp4 = format === 'mp4';
  const muxer = isMp4
    ? new Mp4Muxer.Muxer({ target: new Mp4Muxer.ArrayBufferTarget(), video: { codec: 'avc', width: W, height: H, frameRate: fps }, fastStart: 'in-memory', firstTimestampBehavior: 'offset' })
    : new WebMMuxer.Muxer({ target: new WebMMuxer.ArrayBufferTarget(), video: { codec: cfg.codec.startsWith('vp8') ? 'V_VP8' : 'V_VP9', width: W, height: H, frameRate: fps, alpha }, firstTimestampBehavior: 'offset' });
  let err = null;
  const enc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: e => { err = e; } });
  enc.configure(cfg);
  const cv = newCanvas(W, H); const x = cv.getContext('2d');
  let t = 0, lastKey = -1e12, n = 0; const total = loops * seq.length;
  for (let l = 0; l < loops; l++) for (const f of seq) {
    if (err) throw err;
    render(x, f.c);
    const dur = Math.round(f.dur * 1000);
    const vf = new VideoFrame(cv, { timestamp: Math.round(t), duration: dur, alpha: alpha ? 'keep' : 'discard' });
    const key = t - lastKey >= 2e6; if (key) lastKey = t;
    enc.encode(vf, { keyFrame: key }); vf.close();
    t += f.dur * 1000; n++;
    while (enc.encodeQueueSize > 6) await sleep(2);
    if (n % 4 === 0) { onProgress && onProgress(n, total); await sleep(0); }
  }
  if (!isMp4 && seq.length) { // WebM duration = last timestamp: add a 1 ms tail frame so the final frame keeps its full time
    render(x, seq[seq.length - 1].c);
    const vf = new VideoFrame(cv, { timestamp: Math.round(t) - 1000, duration: 1000, alpha: alpha ? 'keep' : 'discard' });
    enc.encode(vf, { keyFrame: false }); vf.close();
  }
  await enc.flush(); enc.close(); if (err) throw err;
  muxer.finalize();
  return new Blob([muxer.target.buffer], { type: isMp4 ? 'video/mp4' : 'video/webm' });
}

/* ================= export dialog ================= */
const SOCIAL = [
  { id: 'ig-1x1', name: 'Instagram post · 1:1', w: 1080, h: 1080, max: 60 },
  { id: 'ig-4x5', name: 'Instagram post · 4:5', w: 1080, h: 1350, max: 60 },
  { id: 'reels', name: 'Reels / TikTok / Shorts · 9:16', w: 1080, h: 1920, max: 90 },
  { id: 'stories', name: 'Instagram / Facebook Stories · 9:16', w: 1080, h: 1920, max: 60 },
  { id: 'yt', name: 'YouTube video · 16:9 (1080p)', w: 1920, h: 1080, max: 600 },
  { id: 'x169', name: 'X / Twitter · 16:9', w: 1280, h: 720, max: 140 },
  { id: 'x11', name: 'X / Twitter · 1:1', w: 1080, h: 1080, max: 140 },
  { id: 'li', name: 'LinkedIn · 1:1', w: 1080, h: 1080, max: 600 },
  { id: 'fb', name: 'Facebook feed · 4:5', w: 1080, h: 1350, max: 240 },
  { id: 'bsky', name: 'Bluesky · 16:9', w: 1280, h: 720, max: 60 },
  { id: 'discord', name: 'Discord / chat GIF · 1:1 (480)', w: 480, h: 480, max: 30 },
  { id: 'steam', name: 'Steam store GIF · 616×353', w: 616, h: 353, max: 30 },
  { id: 'itch', name: 'itch.io cover · 630×500', w: 630, h: 500, max: 30 },
];
function buildSequence(frames, { fps, useDur, ping }) {
  const base = frames.map(f => ({ c: f.c, dur: useDur && f.dur ? f.dur : 1000 / fps }));
  return ping && base.length > 2 ? base.concat(base.slice(1, -1).reverse()) : base;
}
async function exportAnimationDialog({ frames, fps = 12, useDur = false, ping = false, name = 'animation' }) {
  if (!frames || !frames.length) return toast('No frames to export', 'warn');
  const seq = buildSequence(frames, { fps, useDur, ping });
  const loopMs = seq.reduce((s, f) => s + f.dur, 0);
  let fw = 1, fh = 1; for (const f of frames) { fw = Math.max(fw, f.c.width); fh = Math.max(fh, f.c.height); }
  const avgFps = Math.max(1, Math.round(1000 / (loopMs / seq.length)));
  const support = { mp4: !!(await findVideoConfig('mp4', 640, 640, avgFps)), webm: !!(await findVideoConfig('webm', 640, 640, avgFps)), webmAlpha: !!(await findVideoConfig('webm', 640, 640, avgFps, true)) };
  const st = { format: 'gif', mode: 'original', scale: Math.max(1, Math.min(8, Math.floor(512 / Math.max(fw, fh)))) || 1, preset: 'ig-1x1', fit: 'contain', size: 80, pixel: true, bg: '#1b1f27', transparent: true, loops: 1, gifForever: true };
  const segBtns = {}; const seg = h('div', { class: 'seg' });
  for (const [k, l] of [['gif', 'GIF'], ['mp4', 'MP4'], ['webm', 'WebM']]) {
    const b = h('button', { onclick: () => { st.format = k; sync(); }, disabled: (k === 'mp4' && !support.mp4) || (k === 'webm' && !support.webm), title: (k === 'mp4' && !support.mp4) || (k === 'webm' && !support.webm) ? 'Not supported by this browser — use Chrome or Edge' : '' }, l);
    segBtns[k] = b; seg.append(b);
  }
  const modeSeg = h('div', { class: 'seg' }); const modeBtns = {};
  for (const [k, l] of [['original', 'Sprite size'], ['social', 'Social media']]) { const b = h('button', { onclick: () => { st.mode = k; if (k === 'social') { const p = SOCIAL.find(x => x.id === st.preset); st.loops = defaultLoops(p.max); } sync(); } }, l); modeBtns[k] = b; modeSeg.append(b); }
  const scaleSel = h('select', { onchange: e => { st.scale = +e.target.value; sync(); } }, [1, 2, 3, 4, 6, 8, 12, 16].map(z => h('option', { value: z, selected: z === st.scale }, `${z}× — ${fw * z}×${fh * z}px`)));
  const presetSel = h('select', { onchange: e => { st.preset = e.target.value; const p = SOCIAL.find(x => x.id === st.preset); st.loops = defaultLoops(p.max); sync(); } }, SOCIAL.map(p => h('option', { value: p.id }, `${p.name} — ${p.w}×${p.h}`)));
  const fitSel = h('select', { onchange: e => { st.fit = e.target.value; sync(); } }, h('option', { value: 'contain' }, 'Fit inside (letterbox)'), h('option', { value: 'cover' }, 'Fill frame (crop)'));
  const sizeR = h('input', { type: 'range', min: 10, max: 100, value: st.size, oninput: e => { st.size = +e.target.value; sizeV.textContent = st.size + '%'; drawPrev(); } }); const sizeV = h('b', {}, st.size + '%');
  const pixelC = h('input', { type: 'checkbox', checked: st.pixel, onchange: e => { st.pixel = e.target.checked; sync(); } });
  const transC = h('input', { type: 'checkbox', checked: st.transparent, onchange: e => { st.transparent = e.target.checked; sync(); } });
  const bgC = h('input', { type: 'color', value: st.bg, oninput: e => { st.bg = e.target.value; drawPrev(); } });
  const loopsSel = h('select', { onchange: e => { st.loops = +e.target.value; sync(); } });
  const foreverC = h('input', { type: 'checkbox', checked: st.gifForever, onchange: e => { st.gifForever = e.target.checked; sync(); } });
  const nameI = h('input', { type: 'text', value: sanitize(name) });
  const folderSel = h('select', {}, [...new Set([...App.folders, 'exports'])].sort(naturalCmp).map(f => h('option', { value: f, selected: f === 'exports' }, f)));
  const prevBox = h('div', { class: 'exp-prev checker' }); const prevC = h('canvas', { class: 'pix' }); prevBox.append(prevC);
  const sum = h('div', { class: 'exp-sum' }); const prog = h('div', { class: 'progress hidden' }, h('div', {}));
  const rowScale = h('label', { class: 'field' }, h('span', {}, 'Scale (nearest-neighbor keeps pixel art crisp)'), scaleSel);
  const rowPreset = h('div', {}, h('label', { class: 'field' }, h('span', {}, 'Platform & resolution'), presetSel), h('label', { class: 'field' }, h('span', {}, 'Framing'), fitSel), h('label', { class: 'field' }, h('span', {}, h('span', {}, 'Sprite size in frame'), sizeV), sizeR));
  const rowTrans = h('label', { class: 'check' }, transC, h('span', {}, 'Transparent background'));
  const rowBg = h('label', { class: 'check' }, h('span', {}, 'Background color'), bgC);
  const rowLoops = h('label', { class: 'field' }, h('span', {}, 'Length (whole loops only)'), loopsSel);
  const rowForever = h('label', { class: 'check' }, foreverC, 'GIF repeats forever');
  function maxSec() { return st.mode === 'social' ? SOCIAL.find(x => x.id === st.preset).max : 120; }
  function defaultLoops(max) { const target = Math.min(max, 6) * 1000; return Math.max(1, Math.min(Math.floor(max * 1000 / loopMs) || 1, Math.ceil(target / loopMs))); }
  function dims() {
    if (st.mode === 'social') { const p = SOCIAL.find(x => x.id === st.preset); return { W: p.w, H: p.h }; }
    let W = fw * st.scale, H = fh * st.scale;
    if (st.format !== 'gif') { W += W % 2; H += H % 2; }
    return { W, H };
  }
  function canAlpha() { return st.format === 'gif' || (st.format === 'webm' && support.webmAlpha); }
  function makeRender(W, H) {
    const useAlpha = canAlpha() && st.transparent;
    return (x, src) => {
      x.clearRect(0, 0, W, H);
      if (!useAlpha) { x.fillStyle = st.bg; x.fillRect(0, 0, W, H); }
      let z;
      if (st.mode === 'social') {
        z = (st.fit === 'cover' ? Math.max(W / fw, H / fh) : Math.min(W / fw, H / fh)) * st.size / 100;
        if (st.pixel && z >= 1) z = Math.floor(z);
      } else z = st.scale;
      x.imageSmoothingEnabled = !st.pixel; x.imageSmoothingQuality = 'high';
      const dw = src.width * z, dh = src.height * z;
      x.drawImage(src, Math.round((W - dw) / 2), Math.round((H - dh) / 2), Math.round(dw), Math.round(dh));
    };
  }
  let anim = null, ai = 0, lastT = 0, alive = true;
  function drawPrev() {
    const { W, H } = dims(); const s = Math.min(280 / W, 280 / H, st.mode === 'original' ? 8 : 1);
    prevC.width = W; prevC.height = H; prevC.style.width = Math.round(W * s) + 'px'; prevC.style.height = Math.round(H * s) + 'px';
    makeRender(W, H)(prevC.getContext('2d'), seq[ai % seq.length].c);
  }
  const tick = t => { if (!alive) return; const f = seq[ai % seq.length]; if (t - lastT >= f.dur) { lastT = t; ai++; drawPrev(); } anim = requestAnimationFrame(tick); };
  function sync() {
    for (const k in segBtns) segBtns[k].classList.toggle('on', k === st.format);
    for (const k in modeBtns) modeBtns[k].classList.toggle('on', k === st.mode);
    rowScale.classList.toggle('hidden', st.mode !== 'original'); rowPreset.classList.toggle('hidden', st.mode !== 'social');
    const alphaOk = canAlpha(); rowTrans.classList.toggle('hidden', !alphaOk);
    rowBg.classList.toggle('hidden', alphaOk && st.transparent);
    const isGifForever = st.format === 'gif' && st.gifForever;
    rowForever.classList.toggle('hidden', st.format !== 'gif');
    rowLoops.classList.toggle('hidden', isGifForever);
    const max = maxSec(); const maxLoops = Math.max(1, Math.min(200, Math.floor(max * 1000 / loopMs)));
    st.loops = clamp(st.loops, 1, maxLoops);
    loopsSel.innerHTML = '';
    for (let n = 1; n <= maxLoops; n++) loopsSel.append(h('option', { value: n, selected: n === st.loops }, `${n} loop${n > 1 ? 's' : ''} — ${(n * loopMs / 1000).toFixed(2)} s`));
    const { W, H } = dims();
    const over = loopMs / 1000 > max ? `<br><span style="color:var(--warn)">One loop (${(loopMs / 1000).toFixed(2)} s) is longer than this platform's ${max} s limit.</span>` : '';
    sum.innerHTML = `Output: <b>${st.format.toUpperCase()}</b> · <b>${W}×${H}</b><br>One loop: <b>${(loopMs / 1000).toFixed(2)} s</b> (${seq.length} frames · ~${avgFps} fps${ping ? ' · ping-pong' : ''})<br>` +
      (isGifForever ? 'Plays forever' : `Total: <b>${(st.loops * loopMs / 1000).toFixed(2)} s</b> (${st.loops}× loop)`) + (st.mode === 'social' ? ` · platform max ${max} s` : '') + over;
    drawPrev();
  }
  const body = h('div', { class: 'export-wrap' },
    h('div', {},
      h('label', { class: 'field' }, h('span', {}, 'Format'), seg),
      !support.mp4 && !support.webm ? h('p', { class: 'hint' }, 'Video export needs Chrome or Edge (WebCodecs).') : null,
      h('label', { class: 'field' }, h('span', {}, 'Size'), modeSeg),
      rowScale, rowPreset,
      h('label', { class: 'check' }, pixelC, h('span', {}, 'Pixel art (no smoothing)')),
      rowTrans, rowBg, rowForever, rowLoops,
      h('div', { class: 'field two' }, h('label', {}, 'File name', nameI), h('label', {}, 'Save to folder', folderSel))),
    h('div', {}, prevBox, sum, prog));
  const run = async (target, close) => {
    const { W, H } = dims(); const render = makeRender(W, H); const alpha = canAlpha() && st.transparent;
    prog.classList.remove('hidden'); const bar = prog.firstChild; const onP = (n, t) => { bar.style.width = (n / t * 100).toFixed(1) + '%'; };
    try {
      let blob;
      if (st.format === 'gif') {
        let s2 = seq; if (!st.gifForever) for (let i = 1; i < st.loops; i++) s2 = s2.concat(seq);
        blob = await encodeGIF(s2, { W, H, render, transparent: alpha, repeat: st.gifForever ? 0 : null }, onP);
      } else blob = await encodeVideo(seq, { W, H, render, format: st.format, loops: st.loops, alpha, fps: avgFps }, onP);
      const fname = `${sanitize(nameI.value || 'animation')}.${st.format}`;
      if (target === 'save') { await opSave([{ folder: folderSel.value, name: fname, blob }], `Export ${fname}`); toast(`Saved ${folderSel.value}/${fname} (${fmtBytes(blob.size)})`, 'ok'); }
      else await downloadBlob(fname, blob);
      close(true);
    } catch (e) { console.error(e); toast('Export failed: ' + (e.message || e), 'err', 6000); prog.classList.add('hidden'); }
  };
  sync(); anim = requestAnimationFrame(tick);
  await modal({
    title: 'Export animation', wide: true, body,
    actions: [],
    onOpen: (b, close) => {
      const foot = h('div', { class: 'modal-foot' },
        h('button', { class: 'btn', onclick: () => close(null) }, 'Cancel'),
        h('button', { class: 'btn', onclick: () => run('save', close) }, 'Save to project'),
        h('button', { class: 'btn primary', onclick: () => run('download', close) }, 'Export & download'));
      b.parentElement.append(foot);
    }
  });
  alive = false; cancelAnimationFrame(anim);
}

/* ================= crop editor (manual trim) ================= */
async function cropEditor(src, box, autoBox) {
  const W = src.width, H = src.height;
  let b = { ...box }; let z = 1;
  const view = h('div', { class: 'crop-view checker' });
  const base = cloneCanvas(src); base.className = 'pix';
  const ov = h('canvas', { class: 'overlay' });
  const wrap = h('div', { class: 'stagewrap' }, base, ov); view.append(wrap);
  const inp = {}; const mk = k => { inp[k] = h('input', { type: 'number', value: b[k], oninput: e => { b[k] = Math.round(+e.target.value || 0); norm(); draw(false); } }); return h('label', { class: 'field' }, h('span', {}, k.toUpperCase()), inp[k]); };
  const zoomSel = h('select', { class: 'sm', onchange: e => setZoom(e.target.value) }, ['fit', '0.5', '1', '2', '4', '8'].map(v => h('option', { value: v }, v === 'fit' ? 'Fit' : v + '×')));
  const info = h('p', { class: 'mono hint' });
  const side = h('div', { class: 'crop-side' },
    h('p', {}, 'Drag inside the box to move it, drag the handles to resize, or drag anywhere else to draw a new area.'),
    h('div', { class: 'grid2' }, mk('x'), mk('y'), mk('w'), mk('h')), info,
    h('div', { class: 'row', style: { marginBottom: '8px' } }, h('span', { class: 'muted' }, 'Zoom'), zoomSel),
    h('div', { class: 'stack' },
      h('button', { class: 'btn sm', onclick: () => { b = { ...(autoBox || { x: 0, y: 0, w: W, h: H }) }; draw(true); } }, 'Reset to auto crop'),
      h('button', { class: 'btn sm', onclick: () => { b = { x: 0, y: 0, w: W, h: H }; draw(true); } }, 'Whole image')));
  function norm() {
    if (b.w < 0) { b.x += b.w; b.w = -b.w; } if (b.h < 0) { b.y += b.h; b.h = -b.h; }
    b.x = clamp(b.x, 0, W - 1); b.y = clamp(b.y, 0, H - 1); b.w = clamp(b.w, 1, W - b.x); b.h = clamp(b.h, 1, H - b.y);
  }
  function setZoom(v) {
    if (v === 'fit') { const vw = (view.clientWidth || 700) - 30, vh = (view.clientHeight || 500) - 30; z = Math.min(vw / W, vh / H); if (z >= 1) z = Math.min(16, Math.floor(z)); }
    else z = +v;
    base.style.width = W * z + 'px'; base.style.height = H * z + 'px';
    ov.width = Math.round(W * z); ov.height = Math.round(H * z); ov.style.width = ov.width + 'px'; ov.style.height = ov.height + 'px';
    draw(false);
  }
  function draw(updInputs = true) {
    const x = ov.getContext('2d'); x.clearRect(0, 0, ov.width, ov.height);
    x.fillStyle = 'rgba(0,0,0,.55)'; x.fillRect(0, 0, ov.width, ov.height);
    x.clearRect(b.x * z, b.y * z, b.w * z, b.h * z);
    x.strokeStyle = '#8be36b'; x.lineWidth = 1.5; x.setLineDash([]); x.strokeRect(b.x * z + .5, b.y * z + .5, b.w * z - 1, b.h * z - 1);
    x.fillStyle = '#8be36b';
    for (const [hx, hy] of handles()) x.fillRect(hx - 4, hy - 4, 8, 8);
    if (updInputs) for (const k of ['x', 'y', 'w', 'h']) inp[k].value = b[k];
    info.textContent = `${b.w}×${b.h} px of ${W}×${H} (${(b.w * b.h / (W * H) * 100).toFixed(0)}% of the area)`;
  }
  function handles() {
    const l = b.x * z, t = b.y * z, r = (b.x + b.w) * z, bt = (b.y + b.h) * z, cx = (l + r) / 2, cy = (t + bt) / 2;
    return [[l, t, 'nw'], [cx, t, 'n'], [r, t, 'ne'], [r, cy, 'e'], [r, bt, 'se'], [cx, bt, 's'], [l, bt, 'sw'], [l, cy, 'w']];
  }
  let drag = null;
  const pt = e => { const r = ov.getBoundingClientRect(); return { sx: e.clientX - r.left, sy: e.clientY - r.top, x: Math.round((e.clientX - r.left) / z), y: Math.round((e.clientY - r.top) / z) }; };
  ov.style.pointerEvents = 'auto'; ov.style.cursor = 'crosshair';
  ov.addEventListener('pointerdown', e => {
    const p = pt(e); ov.setPointerCapture(e.pointerId);
    const hd = handles().find(([hx, hy]) => Math.abs(hx - p.sx) <= 7 && Math.abs(hy - p.sy) <= 7);
    if (hd) drag = { type: hd[2], start: { ...b } };
    else if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) drag = { type: 'move', start: { ...b }, p0: p };
    else { drag = { type: 'new', p0: p }; b = { x: p.x, y: p.y, w: 1, h: 1 }; }
  });
  ov.addEventListener('pointermove', e => {
    const p = pt(e);
    if (!drag) {
      const hd = handles().find(([hx, hy]) => Math.abs(hx - p.sx) <= 7 && Math.abs(hy - p.sy) <= 7);
      const cur = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize' };
      ov.style.cursor = hd ? cur[hd[2]] : (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) ? 'move' : 'crosshair';
      return;
    }
    const s = drag.start; const px = clamp(p.x, 0, W), py = clamp(p.y, 0, H);
    if (drag.type === 'move') { b.x = clamp(s.x + p.x - drag.p0.x, 0, W - s.w); b.y = clamp(s.y + p.y - drag.p0.y, 0, H - s.h); }
    else if (drag.type === 'new') { b = { x: Math.min(drag.p0.x, px), y: Math.min(drag.p0.y, py), w: Math.max(1, Math.abs(px - drag.p0.x)), h: Math.max(1, Math.abs(py - drag.p0.y)) }; }
    else {
      let l = s.x, t = s.y, r = s.x + s.w, bt = s.y + s.h;
      if (drag.type.includes('w')) l = Math.min(px, r - 1); if (drag.type.includes('e')) r = Math.max(px, l + 1);
      if (drag.type.includes('n')) t = Math.min(py, bt - 1); if (drag.type.includes('s')) bt = Math.max(py, t + 1);
      b = { x: l, y: t, w: r - l, h: bt - t };
    }
    norm(); draw(true);
  });
  ov.addEventListener('pointerup', () => { drag = null; });
  const r = await modal({
    title: 'Edit crop area', wide: true, body: h('div', { class: 'crop-wrap' }, view, side),
    actions: [{ label: 'Cancel', value: null }, { label: 'Use auto crop', value: 'auto' }, { label: 'Apply to all images', value: () => ({ box: { ...b }, all: true }) }, { label: 'Apply', primary: true, value: () => ({ box: { ...b }, all: false }) }],
    onOpen: () => { setTimeout(() => setZoom('fit'), 30); }
  });
  return r;
}

/* ================= dropdown menu ================= */
function openMenu(anchor, items) {
  closeMenu();
  const m = h('div', { class: 'menu' });
  for (const it of items) {
    if (it === '-') m.append(h('div', { class: 'ms' }));
    else if (it.header) m.append(h('div', { class: 'mh' }, it.header));
    else m.append(h('button', { class: 'mi ' + (it.cls || ''), disabled: !!it.disabled, onclick: () => { closeMenu(); it.onClick && it.onClick(); } }, it.icon ? h('span', {}, it.icon) : null, it.label, it.key ? h('span', { class: 'k' }, it.key) : null));
  }
  document.body.append(m);
  const r = anchor.getBoundingClientRect(); const mw = m.offsetWidth, mh = m.offsetHeight;
  let left = r.right - mw; if (left < 8) left = r.left; let top = r.bottom + 4; if (top + mh > innerHeight - 8) top = Math.max(8, r.top - mh - 4);
  m.style.left = left + 'px'; m.style.top = top + 'px';
  openMenu._el = m;
  setTimeout(() => { document.addEventListener('mousedown', openMenu._off = e => { if (!m.contains(e.target)) closeMenu(); }); document.addEventListener('keydown', openMenu._key = e => { if (e.key === 'Escape') closeMenu(); }); }, 0);
}
function closeMenu() {
  if (openMenu._el) { openMenu._el.remove(); openMenu._el = null; }
  if (openMenu._off) document.removeEventListener('mousedown', openMenu._off);
  if (openMenu._key) document.removeEventListener('keydown', openMenu._key);
}

/* ================= history / undo ================= */
const History = {
  list: [], idx: 0, busy: false,
  push(label, undo, redo, opts = {}) {
    this.list.splice(this.idx);
    this.list.push({ label, undo, redo, time: Date.now(), lib: opts.lib !== false });
    if (this.list.length > 100) this.list.shift();
    this.idx = this.list.length; this.render();
  },
  async undo(silent) {
    if (this.idx <= 0 || this.busy) return false;
    const e = this.list[this.idx - 1]; this.busy = true;
    try { await e.undo(); this.idx--; if (!silent) toast('Undone: ' + e.label); }
    catch (err) { console.error(err); toast('Could not undo: ' + err.message, 'err'); this.busy = false; this.render(); return false; }
    this.busy = false; this.render(); if (e.lib && !silent) await refreshFolders(App.folder); return true;
  },
  async redo(silent) {
    if (this.idx >= this.list.length || this.busy) return false;
    const e = this.list[this.idx]; this.busy = true;
    try { await e.redo(); this.idx++; if (!silent) toast('Redone: ' + e.label); }
    catch (err) { console.error(err); toast('Could not redo: ' + err.message, 'err'); this.busy = false; this.render(); return false; }
    this.busy = false; this.render(); if (e.lib && !silent) await refreshFolders(App.folder); return true;
  },
  async goTo(target) {
    let lib = false;
    while (this.idx > target) { lib = lib || this.list[this.idx - 1].lib; if (!(await this.undo(true))) break; }
    while (this.idx < target) { lib = lib || this.list[this.idx].lib; if (!(await this.redo(true))) break; }
    if (lib) await refreshFolders(App.folder);
    toast('History restored');
  },
  render() {
    const u = $('#undoBtn'), r = $('#redoBtn'); if (!u) return;
    u.disabled = this.idx <= 0; r.disabled = this.idx >= this.list.length;
    u.title = this.idx > 0 ? `Undo: ${this.list[this.idx - 1].label} (Ctrl+Z)` : 'Nothing to undo';
    r.title = this.idx < this.list.length ? `Redo: ${this.list[this.idx].label} (Ctrl+Shift+Z)` : 'Nothing to redo';
  },
  menu(anchor) {
    const fmtT = t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const items = [{ header: 'History (click to go back to a step)' }];
    if (!this.list.length) items.push({ label: 'No actions yet', disabled: true });
    items.push({ label: 'Start of session', cls: this.idx === 0 ? 'cur' : '', key: '', onClick: () => this.goTo(0) });
    this.list.forEach((e, i) => items.push({ label: (i + 1 === this.idx ? '● ' : '') + e.label, cls: i + 1 === this.idx ? 'cur' : i + 1 > this.idx ? 'future' : '', key: fmtT(e.time), onClick: () => this.goTo(i + 1) }));
    openMenu(anchor, items);
  },
};
