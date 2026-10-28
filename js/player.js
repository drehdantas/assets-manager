/* ================= animation player ================= */
class Player {
  constructor(view) {
    this.view = view; this.canvas = h('canvas', { class: 'pix' });
    view.innerHTML = ''; view.append(this.canvas);
    this.frames = []; this.i = 0; this.playing = false; this.loop = true; this.ping = false; this.dir = 1;
    this.fps = 12; this.useDur = false; this.speed = 1; this.zoom = 'fit'; this.last = 0; this.listeners = [];
    this._raf = this._raf.bind(this); requestAnimationFrame(this._raf);
    try { new ResizeObserver(() => this.layout()).observe(view); } catch (e) { }
  }
  emit() { for (const f of this.listeners) f(this); }
  setFrames(fr, { keepIndex = false } = {}) {
    this.frames = fr || []; if (!keepIndex || this.i >= this.frames.length) this.i = 0;
    this.dir = 1; this.layout(); this.emit();
  }
  get size() { let w = 1, hh = 1; for (const f of this.frames) { w = Math.max(w, f.c.width); hh = Math.max(hh, f.c.height); } return { w, h: hh }; }
  layout() {
    const { w, h: hh } = this.size; let z;
    if (this.zoom === 'fit') {
      const vw = Math.max(40, this.view.clientWidth - 24), vh = Math.max(40, this.view.clientHeight - 24);
      z = Math.min(vw / w, vh / hh); if (z >= 1) z = Math.min(Math.floor(z), 16); z = Math.max(z, 0.05);
    } else z = +this.zoom;
    if (this.canvas.width !== w || this.canvas.height !== hh) { this.canvas.width = w; this.canvas.height = hh; }
    this.canvas.style.width = Math.round(w * z) + 'px'; this.canvas.style.height = Math.round(hh * z) + 'px';
    this.draw();
  }
  draw() {
    const x = this.canvas.getContext('2d'); x.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const f = this.frames[this.i]; if (!f) return;
    const { w, h: hh } = this.size; x.imageSmoothingEnabled = false;
    x.drawImage(f.c, Math.floor((w - f.c.width) / 2), Math.floor((hh - f.c.height) / 2));
  }
  _raf(t) {
    if (this.playing && this.frames.length > 1) {
      const f = this.frames[this.i];
      const d = (this.useDur && f.dur ? f.dur : 1000 / this.fps) / this.speed;
      if (t - this.last >= d) { this.last = (t - this.last > d * 3) ? t : this.last + d; this.advance(); }
    }
    requestAnimationFrame(this._raf);
  }
  advance() {
    const L = this.frames.length; if (L < 2) return;
    let n = this.i + this.dir;
    if (n >= L || n < 0) {
      if (this.ping) { this.dir = -this.dir; n = this.i + this.dir; if (this.dir === 1 && !this.loop) { this.pause(); return; } }
      else if (this.loop) n = n >= L ? 0 : L - 1;
      else { this.pause(); return; }
    }
    this.i = clamp(n, 0, L - 1); this.draw(); this.emit();
  }
  play() { if (!this.frames.length) return; if (!this.loop && !this.ping && this.i >= this.frames.length - 1) this.i = 0; this.playing = true; this.last = performance.now(); this.emit(); }
  pause() { this.playing = false; this.emit(); }
  toggle() { this.playing ? this.pause() : this.play(); }
  step(d) { const L = this.frames.length; if (!L) return; this.pause(); this.i = (this.i + d + L) % L; this.draw(); this.emit(); }
  seek(i) { if (!this.frames.length) return; this.i = clamp(i, 0, this.frames.length - 1); this.draw(); this.emit(); }
}
function buildPlayerUI(el, p, opt = {}) {
  el.innerHTML = '';
  const playBtn = h('button', { class: 'btn icon primary', title: 'Play / Pause (space)', onclick: () => p.toggle() }, '▶');
  const scrub = h('input', { type: 'range', min: 0, max: 0, value: 0, class: 'scrub', oninput: e => p.seek(+e.target.value) });
  const counter = h('span', { class: 'mono muted', style: { minWidth: '54px', textAlign: 'right' } }, '0/0');
  const fps = h('input', { type: 'number', min: 1, max: 120, value: p.fps, class: 'input sm num', oninput: e => { p.fps = clamp(+e.target.value || 12, 1, 120); opt.onFps && opt.onFps(p.fps); } });
  const zoom = h('select', { class: 'sm', onchange: e => { p.zoom = e.target.value; p.layout(); } },
    ['fit', '1', '2', '3', '4', '6', '8'].map(z => h('option', { value: z }, z === 'fit' ? 'Fit' : z + '×')));
  const bg = h('select', { class: 'sm', title: 'Background', onchange: e => { if (e.target.value === 'checker') delete p.view.dataset.bg; else p.view.dataset.bg = e.target.value; } },
    [['checker', 'Checker'], ['black', 'Black'], ['white', 'White'], ['gray', 'Gray'], ['green', 'Green'], ['magenta', 'Magenta']].map(([v, l]) => h('option', { value: v }, l)));
  const dur = h('input', { type: 'checkbox', checked: p.useDur, onchange: e => { p.useDur = e.target.checked; fps.disabled = p.useDur; } });
  const durLbl = h('label', { class: 'check sm', title: 'Use each GIF frame duration' }, dur, 'GIF timing');
  if (!opt.dur) durLbl.classList.add('hidden');
  el.append(
    h('div', { class: 'row' },
      h('button', { class: 'btn icon', title: 'First frame', onclick: () => p.seek(0) }, '⏮'),
      h('button', { class: 'btn icon', title: 'Previous (←)', onclick: () => p.step(-1) }, '◀'),
      playBtn,
      h('button', { class: 'btn icon', title: 'Next (→)', onclick: () => p.step(1) }, '▶|'),
      scrub, counter),
    h('div', { class: 'row' },
      h('label', { class: 'check sm' }, h('input', { type: 'checkbox', checked: p.loop, onchange: e => p.loop = e.target.checked }), 'Loop'),
      h('label', { class: 'check sm' }, h('input', { type: 'checkbox', checked: p.ping, onchange: e => { p.ping = e.target.checked; p.dir = 1; } }), 'Ping-pong'),
      h('label', { class: 'check sm' }, 'FPS', fps), durLbl,
      h('div', { class: 'spacer' }), zoom, bg));
  p.listeners.push(() => {
    playBtn.textContent = p.playing ? '❚❚' : '▶';
    scrub.max = Math.max(0, p.frames.length - 1); scrub.value = p.i;
    counter.textContent = `${p.frames.length ? p.i + 1 : 0}/${p.frames.length}`;
  });
  p.emit();
  return {
    fps, dur, durLbl,
    setDurAvailable(v) { durLbl.classList.toggle('hidden', !v); if (!v) { dur.checked = false; p.useDur = false; fps.disabled = false; } },
    setFps(v) { p.fps = v; fps.value = v; }
  };
}
