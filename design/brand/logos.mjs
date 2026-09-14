/**
 * Three logo candidates for TradeAgent — a bull that is also agent 007 — each
 * shown in both chosen skins.
 *
 *   node design/brand/logos.mjs
 *
 * Colours and faces are read out of the prototype's token blocks, so a logo
 * board can never drift from the app it belongs to.
 *
 * Every mark is drawn on one 64x64 grid with a single stroke weight, so the
 * three are comparable and each survives being shrunk to a 16px favicon.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = dirname(fileURLToPath(import.meta.url));
mkdirSync(OUT, { recursive: true });

const PROTO = readFileSync(join(OUT, '..', 'path', 'tradeagent-proto.html'), 'utf8');

const readTokens = (selector) => Object.fromEntries(
  [...new RegExp(`${selector} \\{([\\s\\S]*?)\\n  \\}`).exec(PROTO)[1]
    .matchAll(/(--[a-zA-Z0-9-]+):\s*([^;]+);/g)].map(([, k, v]) => [k, v.trim()]));

const resolve = (t) => {
  const out = { ...t };
  for (let pass = 0; pass < 4; pass++) {
    for (const k of Object.keys(out)) {
      out[k] = out[k].replace(/var\((--[a-zA-Z0-9-]+)\)/g, (m, ref) => out[ref] ?? m);
    }
  }
  return out;
};

const SKINS = [
  {
    key: 'Terminal', label: 'Terminal', ref: 'Hyperliquid',
    t: resolve(readTokens('html\\[data-theme="terminal"\\]')),
    fonts: 'https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600;700&display=swap',
  },
  {
    key: 'Paper', label: 'Paper', ref: 'Monad',
    t: resolve(readTokens('html\\[data-theme="paper"\\]')),
    fonts: 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap',
  },
];

// ---------------------------------------------------------------- the marks
//
// `ink` is the structural colour, `acc` the one accent. Each mark spends the
// accent on exactly one idea, so it still reads when the accent is dropped.

const bull = (ink, acc) => `
  <path d="M3.5 48C2.5 43.5 4 39 7.5 36C11 33 15 32 19 32.5
           C22.5 30 24.5 22.5 28 17.5C31 13.5 36 12.5 40 14.5
           C45 17 50 20 53.5 23C56.5 25.6 58 28.6 58 32.5
           C58 37 57 41 55 44.5C49.5 48.5 42 50 34 50
           C28 50 23.5 49 20 47.6C16 46 11.5 50.4 8 50
           C5.6 49.8 4 49.2 3.5 48Z" fill="${ink}"/>
  <path d="M14 48.5 21 49.5 18.5 58 11.5 58Z" fill="${ink}"/>
  <path d="M23.5 49.4 28 49.8 27 58 22.5 58Z" fill="${ink}"/>
  <path d="M44.5 49.5 50 48.8 53 58 47 58Z" fill="${ink}"/>
  <path d="M52 47.5 56.5 46 60 56 55 57.4Z" fill="${ink}"/>
  <path d="M18 30.8C13 29 7 27 3 22.5C5 27 9 31.5 15.5 35Z" fill="${ink}"/>
  <path d="M21.5 28.5C20.5 23.5 22 18.5 26 15.5C24.5 20.5 24.2 25 25.2 27.5Z" fill="${ink}"/>
  <path d="M57.5 28C61.5 26 63 20.5 61 16.5C64 21.3 63.3 28 59.3 31.3Z" fill="${ink}"/>
  <path d="M5 42.5 18.5 35.5l2.4 4.6c-4.3 3.9-8.1 5.6-10.8 4.3-2.2 1.6-4.3.7-4.9-1.5Z" fill="${acc}"/>`;

const MARKS = {
  /* Head down, hump up, horns forward, tail flicked: the Charging Bull's pose
     as one silhouette, with the shades as the only cut-out. */
  Charging: ({ ink, acc }) => bull(ink, acc),

  /* Head-on. The horns are separate pointed crescents sweeping out and up —
     rounded lumps on top of a head read as ears, not horns. */
  Shades: ({ ink, acc }) => `
    <path d="M18.4 24.6C13 23 8 19.6 5.4 13.4c5.6 3 10.2 6 14.2 8Z" fill="${ink}"/>
    <path d="M45.6 24.6c5.4-1.6 10.4-5 13-11.2-5.6 3-10.2 6-14.2 8Z" fill="${ink}"/>
    <path d="M18 26c0-5 3.5-8 8-8.5h12c4.5.5 8 3.5 8 8.5v6c0 9-5.5 15.5-14 18-8.5-2.5-14-9-14-18Z" fill="${ink}"/>
    <path d="M20.5 29 43.5 27.4l.5 5.1c-4 4-8 5-10.4 2.3-1-1-2.2-1-3.2 0-2.4 2.7-6.4 1.7-10.4-2.3Z" fill="${acc}"/>
    <path d="M29.6 41.6h4.8v2.6h-4.8Z" fill="${ink}" opacity="0.001"/>
    <path d="M32 51.2 24.5 56v-7.4L32 51.4l7.5-2.8V56Z" fill="${acc}"/>`,

  /* The same bull inside the gun barrel every spy title opens with — which is
     also a scope. A circle is a finished app icon on day one. */
  InBarrel: ({ ink, acc }) => `
    <circle cx="32" cy="32" r="26.5" fill="none" stroke="${acc}" stroke-width="3"/>
    <path d="M32 5.5v4.4M58.5 32h-4.4M32 58.5v-4.4M5.5 32h4.4"
          fill="none" stroke="${acc}" stroke-width="2.1" stroke-linecap="round"/>
    <g transform="translate(11.5 10.5) scale(0.64)">${MARKS.Shades({ ink, acc })}</g>`,
};

const MARK_COPY = {
  Charging: {
    name: 'Charging',
    idea: 'The Wall Street bull itself: head down, hump up, horns forward, tail flicked, wearing the shades. The most literal reading of the brief and the only one that carries the pose everyone already knows.',
    cost: 'A full body in profile is a scene, not a mark. It turns to mush below 24px, and in a flat silhouette the head keeps reading as a boar — I could not get it past that in five passes. Use it on a poster, not in a tab.',
  },
  Shades: {
    name: 'Shades',
    idea: 'Head-on, filling the frame: horns as pointed crescents, wraparound shades, bow tie. A portrait rather than a scene, so the eye gets one silhouette instead of five parts.',
    cost: 'Loses the charge — it stands still. Bull heads are common in trading brands, so the shades and the tie are doing all the work of telling it apart.',
  },
  InBarrel: {
    name: 'InBarrel',
    idea: 'The same portrait inside the gun barrel every spy title has opened with since 1962 — which is also a scope. The circle holds the mark together, so it survives being shrunk further than the other two, and it is a finished app icon on day one.',
    cost: 'A ring is the most common shape in crypto branding. It also fixes the mark inside a circle: on a wide header the lockup gets a lot of empty air on both sides.',
  },
};

// ------------------------------------------------------------- the wordmark

const wordmark = (t, size, ink, acc) => `
  <div style="display:flex;align-items:center;gap:${Math.round(size * 0.42)}px">
    <svg viewBox="0 0 64 64" width="${size}" height="${size}" style="display:block;flex-shrink:0">MARK</svg>
    <div style="display:flex;flex-direction:column;gap:${Math.round(size * 0.06)}px">
      <div style="font-family:${t['--font-display']};font-size:${Math.round(size * 0.46)}px;font-weight:700;letter-spacing:-0.02em;line-height:1;color:${ink}">TradeAgent</div>
      <div style="font-family:${t['--font-num']};font-size:${Math.round(size * 0.2)}px;font-weight:700;letter-spacing:.22em;line-height:1;color:${acc}">007</div>
    </div>
  </div>`;

// ---------------------------------------------------------------- artboards

const shell = (skin, body, w, h) => {
  const t = skin.t;
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <link rel="stylesheet" href="${skin.fonts}">
  <style>
    body { margin: 0; font-family: ${t['--font-display']}; }
    a { color: ${t['--accent']}; } a:hover { color: ${t['--ink']}; }
    .cap { font-size: 10px; font-weight: 600; letter-spacing: ${t['--track']}; text-transform: uppercase; color: ${t['--muted']}; }
  </style>
</helmet>
<div style="width:${w}px;height:${h}px;box-sizing:border-box;background:${t['--ground']};color:${t['--ink']};display:flex;flex-direction:column;overflow:hidden">
${body}
</div>
</x-dc>
</body>
</html>
`;
};

const W = 520, H = 700;

function board(skin, markKey) {
  const t = skin.t;
  const ink = t['--ink'], acc = t['--accent'];
  const draw = (o) => MARKS[markKey](o);

  const svg = (size, opts = {}) =>
    `<svg viewBox="0 0 64 64" width="${size}" height="${size}" style="display:block">${draw({ ink: opts.ink ?? ink, acc: opts.acc ?? acc, w: opts.w ?? 3 })}</svg>`;

  const sizeRow = [48, 32, 24, 16].map((px) => `
    <div style="display:flex;flex-direction:column;align-items:center;gap:${t['--s2']}">
      ${svg(px, { w: px <= 20 ? 3.6 : px <= 32 ? 3.2 : 3 })}
      <div class="cap">${px}</div>
    </div>`).join('');

  // the app icon: the mark on the brand fill, in the theme's own corner radius
  const appIcon = (bg, markInk, markAcc, radius) => `
    <div style="width:84px;height:84px;border-radius:${radius};background:${bg};display:flex;align-items:center;justify-content:center;box-shadow:${t['--elev'] === 'none' ? '0 6px 18px rgba(0,0,0,0.35)' : t['--elev']}">
      ${svg(50, { ink: markInk, acc: markAcc, w: 3.1 })}
    </div>`;

  return shell(skin, `
  <div style="padding:${t['--s6']} ${t['--s6']} ${t['--s5']};display:flex;flex-direction:column;gap:${t['--s1']}">
    <div class="cap">${MARK_COPY[markKey].name} · ${skin.label} · after ${skin.ref}</div>
    <div style="font-size:${t['--t-xl']};font-weight:${t['--h1-weight']};letter-spacing:${t['--h1-track']}">TradeAgent</div>
  </div>

  <div style="flex:1;display:flex;align-items:center;justify-content:center;background:${t['--paper']};border-top:${t['--bw']} solid ${t['--hair']};border-bottom:${t['--bw']} solid ${t['--hair']}">
    ${svg(190, { w: 3 })}
  </div>

  <div style="padding:${t['--s5']} ${t['--s6']};display:flex;flex-direction:column;gap:${t['--s5']}">

    <div style="display:flex;flex-direction:column;gap:${t['--s3']}">
      <div class="cap">Lockup</div>
      ${wordmark(t, 44, ink, acc).replace('MARK', draw({ ink, acc, w: 3 }))}
    </div>

    <div style="display:flex;flex-direction:column;gap:${t['--s3']}">
      <div class="cap">Down to a favicon</div>
      <div style="display:flex;align-items:flex-end;gap:${t['--s6']}">${sizeRow}</div>
    </div>

    <div style="display:flex;flex-direction:column;gap:${t['--s3']}">
      <div class="cap">App icon · on brand, on dark, on light</div>
      <div style="display:flex;gap:${t['--s4']}">
        ${appIcon(t['--accent'], t['--onAccent'], t['--onAccent'], t['--r-xl'])}
        ${appIcon(t['--ground'], t['--ink'], t['--accent'], t['--r-xl'])}
        ${appIcon('#FFFFFF', '#0E100F', t['--accent'], t['--r-xl'])}
      </div>
    </div>

    <div style="display:flex;flex-direction:column;gap:${t['--s3']}">
      <div class="cap">In the app header</div>
      <div style="display:flex;align-items:center;gap:${t['--s3']};padding:${t['--s3']} ${t['--s4']};border-radius:${t['--r-lg']};background:${t['--paper']};border:${t['--bw']} solid ${t['--hair']}">
        ${svg(28, { w: 3.3 })}
        <div style="font-size:${t['--t-xs']};font-weight:600;letter-spacing:${t['--track']};text-transform:uppercase;padding:${t['--s1']} ${t['--s2']};border-radius:${t['--r-sm']};border:${t['--bw']} solid ${t['--line']};color:${t['--text2']}">Testnet</div>
        <div style="margin-left:auto;font-family:${t['--font-num']};font-size:${t['--t-sm']};color:${t['--dim']}">10 001 AUSD</div>
      </div>
    </div>

  </div>`, W, H);
}

// ------------------------------------------------------------------ the key

function key() {
  const cell = (markKey) => {
    const k = MARK_COPY[markKey];
    const [term, paper] = SKINS;
    return `
    <div style="display:flex;flex-direction:column;gap:10px;padding:16px;border-radius:14px;border:1px solid #E3DFDA;background:#FFFFFF">
      <div style="display:flex;align-items:center;gap:14px">
        <div style="width:64px;height:64px;border-radius:12px;background:${term.t['--ground']};display:flex;align-items:center;justify-content:center;flex-shrink:0">
          <svg viewBox="0 0 64 64" width="44" height="44">${MARKS[markKey]({ ink: term.t['--ink'], acc: term.t['--accent'], w: 3 })}</svg>
        </div>
        <div style="width:64px;height:64px;border-radius:12px;background:${paper.t['--ground']};display:flex;align-items:center;justify-content:center;flex-shrink:0">
          <svg viewBox="0 0 64 64" width="44" height="44">${MARKS[markKey]({ ink: paper.t['--ink'], acc: paper.t['--accent'], w: 3 })}</svg>
        </div>
        <div style="display:flex;flex-direction:column;gap:2px">
          <div style="font-size:19px;font-weight:700;color:#0E100F">${k.name}</div>
          <div style="font-size:12px;color:#8A857F">Terminal · Paper</div>
        </div>
      </div>
      <div style="font-size:13px;line-height:1.5;color:#3F3B37">${k.idea}</div>
      <div style="font-size:12px;line-height:1.45;color:#8A857F"><span style="color:#DC5546;font-weight:600">Costs:</span> ${k.cost}</div>
    </div>`;
  };

  return `<!doctype html>
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
<div style="width:660px;height:700px;box-sizing:border-box;background:#FBFAF9;color:#0E100F;padding:26px;display:flex;flex-direction:column;gap:13px;overflow:hidden">
  <div style="display:flex;flex-direction:column;gap:5px">
    <div style="font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#8A857F">Brand · pick one</div>
    <div style="font-size:25px;font-weight:700;letter-spacing:-0.01em">A bull who is also agent 007</div>
    <div style="font-size:13px;line-height:1.5;color:#5C5752">Three marks, one 64px grid, one stroke weight. Each spends the accent on a single idea, so it still reads in one colour. To the right of each row: the same mark in both skins, then how it behaves shrunk, on an app icon and in the app header.</div>
  </div>
  ${Object.keys(MARK_COPY).map(cell).join('')}
  <div style="margin-top:auto;font-size:12px;line-height:1.45;color:#8A857F">Colours and faces are read out of the prototype's token blocks — change a theme there and these boards follow.</div>
</div>
</x-dc>
</body>
</html>
`;
}

// ------------------------------------------------------------------- emit

writeFileSync(join(OUT, 'Main.dc.html'), key());
const artboards = [{ file: 'Main.dc.html', x: 0, y: 0, w: 660, h: 700, title: 'Three marks' }];

const COL = W + 80, ROW = H + 130, TOP = 820;
Object.keys(MARK_COPY).forEach((markKey, c) => {
  SKINS.forEach((skin, r) => {
    const file = `${markKey}${skin.key}.dc.html`;
    writeFileSync(join(OUT, file), board(skin, markKey));
    artboards.push({
      file, x: c * COL, y: TOP + r * ROW, w: W, h: H,
      title: `${MARK_COPY[markKey].name} · ${skin.label}`,
    });
  });
});

writeFileSync(join(OUT, 'canvas.json'), JSON.stringify({
  artboards,
  annotations: [{
    id: 'how-to-judge', x: 740, y: 60, w: 320,
    text: 'Judge at 16px first, not at 190px. A mark that only works large is a picture, not a logo.\n\nThen cover the accent colour with a thumb: if the mark falls apart in one colour, it will fail on a sticker, a stamp and a monochrome sponsor wall.',
  }],
  launch: { view: 'canvas' },
}, null, 2) + '\n');

console.log(`${artboards.length} artboards written`);
