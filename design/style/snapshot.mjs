/**
 * Snapshots the clickable prototype into the artboards of the two-skin canvas.
 *
 *   node design/style/snapshot.mjs
 *
 * The flat canvas is not a second drawing of the app — it is the app, caught
 * screen by screen with the theme switched. Running this is the only way those
 * two can ever disagree, so never hand-edit anything in `flat/`.
 *
 * Uses the Chromium that ships with the mobile app's Playwright install, so
 * what lands on disk is what a browser draws.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '../../apps/mobile/node_modules/playwright-core/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'flat');
const PROTO = join(HERE, '..', 'path', 'tradeagent-proto.html');
mkdirSync(OUT, { recursive: true });

/** The screens the canvas shows, in the order the path visits them. */
const SCREENS = [
  ['Lobby', 'lobby', 'st.prize = 1.2;'],
  ['Strategy', 'strategy', "st.strategy = 'ma'; Object.assign(st.signals.ma, { phase: 'lit', side: 'up', left: 7 });"],
  ['Position', 'position', "st.positions = [POS]; st.strategy = 'direction';"],
  ['Result', 'result', "st.result = { pnl: -1.82, fees: 0.26, move: -0.41, dur: '15 min', reason: 'stop', strategy: 'direction' };"],
  ['Settings', 'settings', ''],
  ['Lesson', 'lesson', "st.lesson = { name: 'direction', step: 3, answer: null };"],
  ['Leaderboard', 'leaderboard', "st.prize = 1.2; st.board = 'direction';"],
  ['History', 'history', "st.historyFilter = 'all';"],
  ['Risk', 'risk', 'st.positions = [POS]; st.budgetSpent = 8;'],
  ['Account', 'account', ''],
];

const POS = `{ strategy: 'direction', side: 'up', entry: 61100, amount: 50, lev: 15,
  stopOn: true, stop: 50, tpOn: false, tp: 50, total: 900, left: 751,
  opened: Date.now() - 149e3, worst: -2.1, best: 1.9 }`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1240, height: 980 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('file://' + PROTO);
await page.waitForTimeout(700);

const files = await page.evaluate(({ screens, pos }) => {
  for (let i = 1; i < 9999; i++) clearInterval(i);     // freeze the clock
  const css = document.querySelector('style').textContent.replace(/html\[data-theme=/g, '[data-theme=');
  const fonts = document.querySelector('link[href*="fonts.googleapis"]').outerHTML;
  const out = {};

  for (const theme of ['terminal', 'paper']) {
    for (const [name, screen, mutate] of screens) {
      st = fresh();
      st.mode = 'app';
      st.firstVisit = false;
      document.documentElement.dataset.theme = theme;
      if (mutate) new Function('st', 'POS', mutate.replace(/POS/g, '(' + pos + ')'))(st);
      st.screen = screen;
      st.stack = ['lobby'];
      render();

      // The chart is a <canvas>; freeze its pixels so the artboard is static
      // HTML with nothing left to run.
      const phone = document.getElementById('phone').cloneNode(true);
      const live = document.getElementById('chart');
      if (live) {
        const img = document.createElement('img');
        img.src = live.toDataURL('image/png');
        img.setAttribute('style', live.getAttribute('style'));
        phone.querySelector('#chart').replaceWith(img);
      }
      phone.removeAttribute('id');

      out[theme[0].toUpperCase() + theme.slice(1) + name + '.dc.html'] = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"><\/script>
</head>
<body>
<x-dc>
<helmet>
  ${fonts}
  <style>
    body { margin: 0; }
${css}
    /* The snapshot drops the phone's id, so the #phone rule stops applying:
       the frame has to carry the surface and the text colour itself, or every
       artboard falls back to the gray theme's ink on white. */
    .frame { width: 390px; height: 844px; background: var(--paper); color: var(--ink);
             font-family: var(--font-display); -webkit-font-smoothing: antialiased; }
    .frame > div { border-radius: 0 !important; border: 0 !important; box-shadow: none !important;
                   width: 100% !important; height: 100% !important; }
  <\/style>
<\/helmet>
<div class="frame" data-theme="${theme}">${phone.outerHTML}<\/div>
<\/x-dc>
<\/body>
<\/html>
`;
    }
  }
  return out;
}, { screens: SCREENS, pos: POS });

for (const [name, body] of Object.entries(files)) writeFileSync(join(OUT, name), body);
await browser.close();

if (errors.length) {
  console.error('the prototype threw while rendering:\n  ' + errors.join('\n  '));
  process.exit(1);
}
console.log(`${Object.keys(files).length} artboards snapshotted into ${OUT}`);
