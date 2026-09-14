/**
 * Exports the official mark into design/brand/logo/ in every format we need.
 *
 *   node design/brand/export.mjs
 *
 * Everything here is generated from mark.mjs. Never hand-edit an asset in
 * logo/ — change the mark and re-run.
 *
 * PNGs are rasterised through the Chromium that ships with the app's Playwright
 * install, so what lands on disk is exactly what a browser draws.
 */

import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '../../apps/mobile/node_modules/playwright-core/index.mjs';
import { mark, svg, PALETTE } from './mark.mjs';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'logo');
rmSync(OUT, { recursive: true, force: true });
for (const d of ['svg', 'png', 'app-icon', 'favicon']) mkdirSync(join(OUT, d), { recursive: true });

const T = PALETTE.terminal, P = PALETTE.paper;

// ------------------------------------------------------------------- vectors
// The masters. `currentColor` makes the mono file inherit whatever colour the
// surrounding text has, which is what you want inside a README or a doc.

const VECTORS = {
  'mark-terminal.svg': svg(T.ink, T.acc, { title: 'TradeAgent' }),
  'mark-paper.svg': svg(P.ink, P.acc, { title: 'TradeAgent' }),
  'mark-mono.svg': svg('currentColor', 'currentColor', { title: 'TradeAgent' }),
  'mark-black.svg': svg('#000000', '#000000', { title: 'TradeAgent' }),
  'mark-white.svg': svg('#FFFFFF', '#FFFFFF', { title: 'TradeAgent' }),
  'mark-on-accent-terminal.svg': svg(T.onAcc, T.onAcc, { title: 'TradeAgent' }),
  'mark-on-accent-paper.svg': svg(P.onAcc, P.onAcc, { title: 'TradeAgent' }),
};
for (const [name, body] of Object.entries(VECTORS)) writeFileSync(join(OUT, 'svg', name), body);

// ------------------------------------------------------------------- raster

const page = (inner, w, h, bg = 'transparent') => `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:${bg}}
#b{width:${w}px;height:${h}px;display:flex;align-items:center;justify-content:center;background:${bg}}</style>
<div id="b">${inner}</div>`;

const box = (ink, acc, size) =>
  `<svg viewBox="0 0 64 64" width="${size}" height="${size}" style="display:block">${mark(ink, acc)}</svg>`;

/** The app icon: the mark on its brand ground, padded like a real icon. */
const iconPage = (bg, ink, acc, size) =>
  page(`<div style="width:${size}px;height:${size}px;background:${bg};display:flex;align-items:center;justify-content:center">
          ${box(ink, acc, Math.round(size * 0.68))}</div>`, size, size, 'transparent');

const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 1 });

async function shoot(html, w, h, file, transparent) {
  const p = await ctx.newPage();
  await p.setViewportSize({ width: w, height: h });
  await p.setContent(html, { waitUntil: 'load' });
  await p.screenshot({ path: file, omitBackground: transparent, clip: { x: 0, y: 0, width: w, height: h } });
  await p.close();
}

const SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
const written = [];

// transparent marks, both skins plus the two mono versions
for (const [label, ink, acc] of [
  ['terminal', T.ink, T.acc], ['paper', P.ink, P.acc],
  ['black', '#000000', '#000000'], ['white', '#FFFFFF', '#FFFFFF'],
]) {
  for (const s of SIZES) {
    const f = join(OUT, 'png', `mark-${label}-${s}.png`);
    await shoot(page(box(ink, acc, s), s, s), s, s, f, true);
    written.push(f);
  }
}

// app icons: opaque, on the brand ground, at the sizes the stores ask for
const ICON = [
  ['ios-180', 180], ['android-192', 192], ['android-512', 512],
  ['store-1024', 1024], ['maskable-512', 512],
];
for (const [skin, pal] of [['terminal', T], ['paper', P]]) {
  for (const [name, s] of ICON) {
    const onBrand = name === 'maskable-512';
    const f = join(OUT, 'app-icon', `app-icon-${skin}-${name}.png`);
    await shoot(
      onBrand ? iconPage(pal.acc, pal.onAcc, pal.onAcc, s) : iconPage(pal.bg, pal.ink, pal.acc, s),
      s, s, f, false);
    written.push(f);
  }
}

// favicons: on the brand ground, so they hold on a light and a dark tab strip
const FAV = [16, 32, 48, 64];
const favBuffers = {};
for (const [skin, pal] of [['terminal', T], ['paper', P]]) {
  for (const s of FAV) {
    const f = join(OUT, 'favicon', `favicon-${skin}-${s}.png`);
    await shoot(iconPage(pal.bg, pal.ink, pal.acc, s), s, s, f, false);
    written.push(f);
    (favBuffers[skin] ??= {})[s] = f;
  }
}

await browser.close();

// ---------------------------------------------------------------- .ico
// An .ico is a tiny directory of images; since Vista each entry may simply be
// a PNG, so the files we just rendered go in verbatim.

const { readFileSync } = await import('node:fs');
for (const [skin, bySize] of Object.entries(favBuffers)) {
  const entries = [16, 32, 48].map((s) => ({ s, buf: readFileSync(bySize[s]) }));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);            // reserved
  header.writeUInt16LE(1, 2);            // type: icon
  header.writeUInt16LE(entries.length, 4);
  let offset = 6 + entries.length * 16;
  const dir = [];
  for (const e of entries) {
    const d = Buffer.alloc(16);
    d.writeUInt8(e.s === 256 ? 0 : e.s, 0);
    d.writeUInt8(e.s === 256 ? 0 : e.s, 1);
    d.writeUInt8(0, 2);                  // palette
    d.writeUInt8(0, 3);                  // reserved
    d.writeUInt16LE(1, 4);               // colour planes
    d.writeUInt16LE(32, 6);              // bits per pixel
    d.writeUInt32LE(e.buf.length, 8);
    d.writeUInt32LE(offset, 12);
    offset += e.buf.length;
    dir.push(d);
  }
  const f = join(OUT, 'favicon', `favicon-${skin}.ico`);
  writeFileSync(f, Buffer.concat([header, ...dir, ...entries.map((e) => e.buf)]));
  written.push(f);
}

// ------------------------------------------------------------------ README

writeFileSync(join(OUT, 'README.md'), `# TradeAgent mark

Generated — do not edit anything in this folder by hand. Change
\`design/brand/mark.mjs\` and run \`node design/brand/export.mjs\`.

The mark is a bull in shades inside a gun barrel, which is also a scope.

## Which file to use

| Need | File |
|---|---|
| Anywhere vector is possible | \`svg/mark-terminal.svg\` or \`svg/mark-paper.svg\` |
| Inside text, inheriting its colour | \`svg/mark-mono.svg\` |
| Print, stamp, sticker, sponsor wall | \`svg/mark-black.svg\` / \`svg/mark-white.svg\` |
| On a filled brand button or badge | \`svg/mark-on-accent-*.svg\` |
| iOS app icon | \`app-icon/app-icon-<skin>-ios-180.png\` |
| Android | \`app-icon/app-icon-<skin>-android-192.png\`, \`-512\`, \`-maskable-512\` |
| Store listing | \`app-icon/app-icon-<skin>-store-1024.png\` |
| Browser tab | \`favicon/favicon-<skin>.ico\` plus the PNGs beside it |
| Raster at a known size | \`png/mark-<skin|black|white>-<size>.png\` |

\`<skin>\` is \`terminal\` (dark, mint) or \`paper\` (off-white, purple) — whichever
theme the app ships in. See \`design/path/tradeagent-proto.html\` for both.

## Rules

- Never redraw the mark to fit a space: scale it.
- Keep clear space of at least half the mark's width on every side.
- Below 24px use a favicon or app-icon file, not a scaled-down large one.
- The accent may be dropped (the one-colour files), the structure may not.
`);

console.log(`${written.length} raster files + ${Object.keys(VECTORS).length} vectors + README`);
