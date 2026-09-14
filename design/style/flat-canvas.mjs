/**
 * Lays out the flat canvas. The artboards themselves are snapshots taken from
 * the clickable prototype, so nothing here describes a screen — this only
 * places them and writes the key.
 *
 * The snapshot drops the phone's id, so the `#phone` rule stops applying: the
 * wrapper the snapshotter writes must carry the surface and the text colour
 * itself, or every artboard falls back to the gray theme's ink on white.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const OUT = 'design/style/flat';
const PROTO = readFileSync('design/path/tradeagent-proto.html', 'utf8');

const tokens = (sel) => Object.fromEntries(
  [...new RegExp(`${sel} \\{([\\s\\S]*?)\\n  \\}`).exec(PROTO)[1]
    .matchAll(/(--[a-zA-Z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));

const THEMES = [
  { key: 'Terminal', label: 'Terminal', ref: 'Hyperliquid', t: tokens('html\\[data-theme="terminal"\\]'),
    pitch: 'Near-black with one mint accent and monospaced numbers. The accent and the fill are the same colour, so the primary button IS the brand — a single loud thing per screen.',
    cost: 'Unforgiving to a beginner. Mint doubles as "up", so a neutral highlight can read as profit.' },
  { key: 'Paper', label: 'Paper', ref: 'Monad', t: tokens('html\\[data-theme="paper"\\]'),
    pitch: 'Off-white with Monad purple. The fill is near-black and the accent is purple, so buttons stay calm and the brand shows up only where something is live: the signal, the prize, a selected chip.',
    cost: 'Worse at 2am and under a bar light. Purple carries no market meaning, so up and down need their own green and red.' },
];

const SCREENS = ['Lobby', 'Strategy', 'Position', 'Result', 'Settings',
                 'Lesson', 'Leaderboard', 'History', 'Risk', 'Account'];

const W = 390, H = 844, COL = W + 80, ROW = H + 130, TOP = 720;
const artboards = [{ file: 'Main.dc.html', x: 0, y: 0, w: 640, h: 600, title: 'Two directions' }];

THEMES.forEach((th, r) => SCREENS.forEach((name, c) => {
  artboards.push({ file: `${th.key}${name}.dc.html`, x: c * COL, y: TOP + r * ROW,
                   w: W, h: H, title: `${th.label} · ${name}` });
}));

const swatch = (t) => ['--ground', '--paper', '--accent', '--fill', '--up', '--down']
  .map((k) => `<div title="${k}" style="width:22px;height:22px;border-radius:6px;background:${t[k]};border:1px solid rgba(0,0,0,0.14)"></div>`).join('');

const card = (th) => `
    <div style="display:flex;flex-direction:column;gap:9px;padding:16px;border-radius:14px;border:1px solid #E3DFDA;background:#FFFFFF">
      <div style="display:flex;align-items:baseline;gap:8px">
        <div style="font-size:19px;font-weight:700;color:#0E100F">${th.label}</div>
        <div style="font-size:12px;color:#8A857F">after ${th.ref} · ${th.t['--font-display'].split(',')[0].replace(/'/g, '')}</div>
        <div style="margin-left:auto;display:flex;gap:5px">${swatch(th.t)}</div>
      </div>
      <div style="font-size:13px;line-height:1.5;color:#3F3B37">${th.pitch}</div>
      <div style="font-size:12px;line-height:1.45;color:#8A857F"><span style="color:#DC5546;font-weight:600">Costs:</span> ${th.cost}</div>
    </div>`;

writeFileSync(join(OUT, 'Main.dc.html'), `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap">
  <style>
    body { margin: 0; font-family: 'Space Grotesk', system-ui, sans-serif; }
    a { color: #836EF9; } a:hover { color: #0E100F; }
  </style>
</helmet>
<div style="width:640px;height:600px;box-sizing:border-box;background:#FBFAF9;color:#0E100F;padding:26px;display:flex;flex-direction:column;gap:13px;overflow:hidden">
  <div style="display:flex;flex-direction:column;gap:5px">
    <div style="font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#8A857F">Stage 2 · the two chosen directions</div>
    <div style="font-size:25px;font-weight:700;letter-spacing:-0.01em">Ten screens, two skins</div>
    <div style="font-size:13px;line-height:1.5;color:#5C5752">Every artboard below is a snapshot of the clickable prototype with the theme switched — same markup, same copy, same numbers. Top row Terminal, bottom row Paper; left to right follows the path: lobby, strategy, position, result, settings, lesson, leaderboard, history, risk, account.</div>
  </div>
  ${THEMES.map(card).join('')}
  <div style="margin-top:auto;font-size:12px;line-height:1.45;color:#8A857F">Both rows are driven by one token block in <code>design/path/tradeagent-proto.html</code>. A colour changed there changes both the clickable prototype and this canvas — there is no second copy to keep in sync.</div>
</div>
</x-dc>
</body>
</html>
`);

writeFileSync(join(OUT, 'canvas.json'), JSON.stringify({
  artboards,
  annotations: [{
    id: 'how-to-read', x: 700, y: 60, w: 330,
    text: 'Compare down a column, not across a row: the same screen in both skins, one above the other.\n\nWhat to look for: does the eye land on the number that matters, is the accent doing one job or three, and does a dense screen (history, leaderboard) still breathe.',
  }],
  launch: { view: 'canvas' },
}, null, 2) + '\n');

console.log(`${artboards.length} artboards placed`);
