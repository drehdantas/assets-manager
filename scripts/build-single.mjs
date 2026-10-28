// Builds a single, self-contained HTML file (dist/assets-manager.html) that works
// offline by double-clicking it — no server needed.  Usage:  node scripts/build-single.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(join(root, p), 'utf8');
let html = read('index.html');

// inline local stylesheets
html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (m, href) =>
  /^https?:/.test(href) ? m : `<style>\n${read(href)}\n</style>`);
// inline local scripts
html = html.replace(/<script src="([^"]+)"><\/script>/g, (m, src) =>
  /^https?:/.test(src) ? m : `<script>\n${read(src).replace(/<\/script/gi, '<\\/script')}\n</script>`);
// drop PWA-only tags (they need a web server)
html = html.replace(/<link rel="manifest"[^>]*>\n?/, '')
  .replace(/<link rel="(icon|apple-touch-icon)"[^>]*>\n?/g, '')
  .replace(/<script>\s*\/\/ Installable app[\s\S]*?<\/script>\n?/, '');
// favicon as data URI
const svg = read('icons/icon.svg');
html = html.replace('</title>', `</title>\n<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(svg)}">`);

mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist', 'assets-manager.html'), html);
console.log(`dist/assets-manager.html — ${(html.length / 1024).toFixed(0)} KB`);
