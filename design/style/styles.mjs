/**
 * Builds the style exploration: the three critical-path screens, one artboard
 * each, in four visual directions.
 *
 *   node design/style/styles.mjs
 *
 * The content of every screen is identical and lifted from the approved gray
 * prototype (`design/path/tradeagent-proto.html`), so the only thing that
 * differs between the rows is the design language. That is the whole point:
 * pick a direction, not a layout.
 *
 * Directions borrow the *vocabulary* of four products — palette, density, type
 * scale, corner radius, how up and down are coloured — and apply it to our
 * screens. None of them reproduces anyone else's screen.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = dirname(fileURLToPath(import.meta.url));
mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------- directions

const DIRECTIONS = [
  {
    key: 'Terminal',
    label: 'Terminal',
    ref: 'Hyperliquid',
    fonts: 'https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600;700&display=swap',
    font: "'Archivo', system-ui, sans-serif",
    num: "'JetBrains Mono', ui-monospace, monospace",
    bg: '#0A1513', surf: '#0F1F1C', surf2: '#142A26', line: '#1D3A34',
    text: '#E4F3F0', dim: '#8CAFA9', mute: '#5B7D77',
    accent: '#50D2C1', onAccent: '#05201C',
    up: '#50D2C1', down: '#F0728A',
    r: 8, rs: 6, rBtn: 8, pad: 18, gap: 12,
    h1: 22, h1w: 600, tight: true,
    caps: 'letter-spacing:.08em;text-transform:uppercase;font-size:10px;font-weight:600',
  },
  {
    key: 'Desk',
    label: 'Desk',
    ref: 'Bybit',
    fonts: 'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap',
    font: "'IBM Plex Sans', system-ui, sans-serif",
    num: "'IBM Plex Mono', ui-monospace, monospace",
    bg: '#16181C', surf: '#1D2026', surf2: '#24282F', line: '#2E333B',
    text: '#FFFFFF', dim: '#A2A8B4', mute: '#6F747F',
    accent: '#F7A600', onAccent: '#16181C',
    up: '#20B26C', down: '#EF454A',
    r: 6, rs: 4, rBtn: 6, pad: 16, gap: 10,
    h1: 20, h1w: 600, tight: true,
    caps: 'letter-spacing:.06em;text-transform:uppercase;font-size:10px;font-weight:600',
  },
  {
    key: 'Calm',
    label: 'Calm',
    ref: 'Robinhood',
    fonts: 'https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,700&display=swap',
    font: "'DM Sans', system-ui, sans-serif",
    num: "'DM Sans', system-ui, sans-serif",
    bg: '#000000', surf: '#101114', surf2: '#191B1F', line: '#24262B',
    text: '#FFFFFF', dim: '#9CA0A8', mute: '#6B6F77',
    accent: '#00C805', onAccent: '#001A01',
    up: '#00C805', down: '#FF5000',
    r: 22, rs: 14, rBtn: 28, pad: 22, gap: 18,
    h1: 30, h1w: 700, tight: false,
    caps: 'letter-spacing:.04em;text-transform:uppercase;font-size:11px;font-weight:700',
  },
  {
    key: 'Paper',
    label: 'Paper',
    ref: 'Monad',
    fonts: 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap',
    font: "'Space Grotesk', system-ui, sans-serif",
    num: "'Space Mono', ui-monospace, monospace",
    bg: '#FBFAF9', surf: '#FFFFFF', surf2: '#F2F0ED', line: '#E3DFDA',
    text: '#0E100F', dim: '#5C5752', mute: '#8A857F',
    accent: '#836EF9', onAccent: '#FFFFFF',
    up: '#1C9A6B', down: '#DC5546',
    r: 16, rs: 10, rBtn: 14, pad: 20, gap: 14,
    h1: 26, h1w: 700, tight: false,
    caps: 'letter-spacing:.06em;text-transform:uppercase;font-size:10px;font-weight:600',
  },
];

// ---------------------------------------------------------------- the series
// One price walk, shared by every artboard, so the chart is never the variable.

const SERIES = Array.from({ length: 64 }, (_, i) =>
  61120 + Math.sin(i / 7) * 95 + Math.sin(i / 2.3) * 28 + i * 2.6);
const ENTRY = SERIES[38];
const LAST = SERIES[SERIES.length - 1];

function chart(T, w, h, { entry = false, area = true } = {}) {
  const lo = Math.min(...SERIES) - 40, hi = Math.max(...SERIES) + 40;
  const x = (i) => (i / (SERIES.length - 1)) * w;
  const y = (v) => h - ((v - lo) / (hi - lo)) * (h - 28) - 14;
  const pts = SERIES.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const fill = area
    ? `<polygon points="0,${h} ${pts} ${w},${h}" fill="${T.accent}" opacity="0.10"></polygon>`
    : '';
  const grid = Array.from({ length: 3 }, (_, k) =>
    `<line x1="0" y1="${((h / 4) * (k + 1)).toFixed(0)}" x2="${w}" y2="${((h / 4) * (k + 1)).toFixed(0)}" stroke="${T.line}" stroke-width="1"></line>`).join('');
  const line = entry
    ? `<line x1="0" y1="${y(ENTRY).toFixed(1)}" x2="${w}" y2="${y(ENTRY).toFixed(1)}" stroke="${T.dim}" stroke-width="1" stroke-dasharray="5 5"></line>`
    : '';
  return `<svg width="100%" height="100%" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="position:absolute;inset:0">${grid}${fill}${line}<polyline points="${pts}" fill="none" stroke="${T.accent}" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"></polyline></svg>`;
}

// ---------------------------------------------------------------- fragments

const ICON = {
  back: (c) => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"></path></svg>`,
  chev: (c) => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"></path></svg>`,
  caret: (c) => `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"></path></svg>`,
  up: (c) => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"></path><path d="M6 11l6-6 6 6"></path></svg>`,
  down: (c) => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"></path><path d="M6 13l6 6 6-6"></path></svg>`,
  share: (c) => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"></path><path d="M12 15V3"></path><path d="M8 7l4-4 4 4"></path></svg>`,
  help: (c) => `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.2 9a3 3 0 1 1 4 2.8c-.8.3-1.2 1-1.2 1.8v.4"></path><path d="M12 18h.01"></path></svg>`,
};

// The official mark. Generated from design/brand/mark.mjs — do not edit the
// paths here; change the mark and re-run that file's consumers.
const LOGO = (size, ink, acc = ink) =>
  `<svg viewBox="0 0 64 64" width="${size}" height="${size}" style="display:block;flex-shrink:0" aria-label="TradeAgent"><circle cx="32" cy="32" r="26.5" fill="none" stroke="${acc}" stroke-width="3"/> <path d="M32 5.5v4.4M58.5 32h-4.4M32 58.5v-4.4M5.5 32h4.4" fill="none" stroke="${acc}" stroke-width="2.1" stroke-linecap="round"/> <g transform="translate(11.5 10.5) scale(0.64)"><path d="M18.4 24.6C13 23 8 19.6 5.4 13.4c5.6 3 10.2 6 14.2 8Z" fill="${ink}"/> <path d="M45.6 24.6c5.4-1.6 10.4-5 13-11.2-5.6 3-10.2 6-14.2 8Z" fill="${ink}"/> <path d="M18 26c0-5 3.5-8 8-8.5h12c4.5.5 8 3.5 8 8.5v6c0 9-5.5 15.5-14 18-8.5-2.5-14-9-14-18Z" fill="${ink}"/> <path d="M20.5 29 43.5 27.4l.5 5.1c-4 4-8 5-10.4 2.3-1-1-2.2-1-3.2 0-2.4 2.7-6.4 1.7-10.4-2.3Z" fill="${acc}"/> <path d="M32 51.2 24.5 56v-7.4L32 51.4l7.5-2.8V56Z" fill="${acc}"/></g></svg>`;

const mark = (T, size = 26) => LOGO(size, T.text, T.accent);

const badge = (T, text = 'TESTNET') =>
  `<div style="display:flex;align-items:center;gap:5px;padding:4px 8px;border-radius:${T.rs}px;border:1px solid ${T.line};background:${T.surf};color:${T.dim};${T.caps}">${text}${ICON.caret(T.mute)}</div>`;

const shell = (T, inner) => `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <link rel="stylesheet" href="${T.fonts}">
  <style>
    body { margin: 0; font-family: ${T.font}; }
    a { color: ${T.accent}; }
    a:hover { color: ${T.text}; }
    .n { font-family: ${T.num}; font-variant-numeric: tabular-nums; }
  </style>
</helmet>
<div style="width:390px;height:844px;box-sizing:border-box;background:${T.bg};color:${T.text};font-family:${T.font};display:flex;flex-direction:column;overflow:hidden;-webkit-font-smoothing:antialiased">
${inner}
</div>
</x-dc>
</body>
</html>
`;

// ---------------------------------------------------------------- screen one

function lobby(T) {
  const card = (name, sub, line, lead) => `
    <div style="display:flex;flex-direction:column;gap:9px;padding:${T.tight ? 12 : 14}px;border-radius:${T.r}px;background:${lead ? T.surf2 : T.surf};border:1px solid ${lead ? T.accent : T.line}">
      <div style="display:flex;align-items:center;gap:11px">
        <div style="width:${T.tight ? 40 : 44}px;height:${T.tight ? 40 : 44}px;border-radius:${T.rs}px;background:${T.surf2};border:1px solid ${T.line};flex-shrink:0"></div>
        <div style="display:flex;flex-direction:column;gap:2px;min-width:0">
          <div style="font-size:16px;font-weight:600">${name}</div>
          <div class="n" style="font-size:11px;color:${T.mute}">${sub}</div>
        </div>
        ${lead ? `<div style="margin-left:auto;padding:4px 8px;border-radius:${T.rs}px;background:${T.accent};color:${T.onAccent};${T.caps}">Start here</div>` : ''}
      </div>
      <div style="font-size:13px;line-height:1.4;color:${T.dim}">${line}</div>
    </div>`;

  const foot = (t) => `<div style="font-size:12px;color:${T.mute}">${t}</div>`;

  return shell(T, `
  <div style="flex:1;display:flex;flex-direction:column;gap:${T.gap}px;padding:52px ${T.pad}px 22px">

    <div style="display:flex;align-items:center;gap:9px">
      ${mark(T)}
      ${badge(T)}
      <div class="n" style="margin-left:auto;font-size:13px;color:${T.dim}">10 001 AUSD</div>
    </div>

    <div style="display:flex;flex-direction:column;gap:5px">
      <div style="font-size:${T.h1}px;font-weight:${T.h1w};letter-spacing:-0.01em">Choose a strategy</div>
      <div class="n" style="font-size:12px;color:${T.mute}">Direction <span style="color:${T.up}">+12.3</span> · MA Cross <span style="color:${T.up}">+2.1</span> · RSI <span style="color:${T.down}">−0.4</span> this week</div>
    </div>

    <div style="display:flex;flex-direction:column;gap:${T.tight ? 8 : 10}px">
      ${card('Direction', 'Pool 3.1 AUSD · 12 players · you #7', 'You call up or down. We close it in 15 minutes.', true)}
      ${card('MA Cross', 'Pool 0.3 AUSD · 4 players', 'Lights up when the trend turns. One tap.', false)}
      ${card('RSI Bounce', 'No pool yet · 2 players', 'Waits for the crowd to overdo it. One tap.', false)}
    </div>

    <div style="display:flex;align-items:center;gap:8px;padding:13px ${T.tight ? 12 : 14}px;border-radius:${T.r}px;border:1px dashed ${T.line}">
      <div style="font-size:14px;color:${T.dim}">Build your own strategy</div>
      <div style="margin-left:auto;font-size:11px;color:${T.mute};${T.caps}">Coming soon</div>
    </div>

    <div style="margin-top:auto;display:flex;align-items:center;justify-content:space-between;padding-top:14px;border-top:1px solid ${T.line}">
      <div style="display:flex;gap:14px">${foot('Leaderboard')}${foot('Invite')}</div>
      <div style="display:flex;gap:14px">${foot('History')}${foot('Risk')}${foot('Account')}</div>
    </div>

  </div>`);
}

// ---------------------------------------------------------------- screen two

function strategy(T) {
  const tf = ['1m', '5m', '15m', '30m', '1h'].map((t, i) => `<div style="padding:3px 6px;border-radius:${T.rs}px;font-size:10px;font-weight:600;${i === 0 ? `background:${T.accent};color:${T.onAccent}` : `color:${T.dim}`}">${t}</div>`).join('');

  const button = (dir) => {
    const isUp = dir === 'up';
    const col = isUp ? T.up : T.down;
    const label = isUp ? 'Up' : 'Down';
    const sub = isUp ? 'it rises' : 'it falls';
    return `<div style="flex:1;height:76px;border-radius:${T.rBtn}px;background:${col};color:${T.bg};display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px">
      <div style="display:flex;align-items:center;gap:6px">${isUp ? ICON.up(T.bg) : ICON.down(T.bg)}<div style="font-size:21px;font-weight:700;letter-spacing:-0.01em">${label}</div></div>
      <div style="font-size:11px;opacity:0.72">${sub}</div>
    </div>`;
  };

  return shell(T, `
  <div style="flex:1;display:flex;flex-direction:column;gap:${T.tight ? 10 : 12}px;padding:52px ${T.pad}px 18px;min-height:0">

    <div style="display:flex;align-items:center;gap:8px">
      ${ICON.back(T.dim)}
      <div style="font-size:15px;font-weight:600">Direction</div>
      ${badge(T)}
      <div class="n" style="margin-left:auto;font-size:12px;color:${T.dim}">10 001 AUSD</div>
      <div style="width:26px;height:26px;border-radius:13px;border:1px solid ${T.line};display:flex;align-items:center;justify-content:center">${ICON.help(T.dim)}</div>
    </div>

    <div style="flex:1;min-height:250px;position:relative;border-radius:${T.r}px;background:${T.surf};overflow:hidden">
      ${chart(T, 354, 330)}
      <div style="position:absolute;top:12px;left:14px">
        <div class="n" style="font-size:27px;font-weight:700;letter-spacing:-0.02em;line-height:1">${Math.round(LAST).toLocaleString('en-US').replace(/,/g, ' ')}</div>
        <div class="n" style="font-size:11px;color:${T.up};margin-top:3px">BTC · +0.41% today</div>
      </div>
      <div style="position:absolute;top:11px;right:11px;display:flex;gap:2px;padding:3px;border-radius:${T.rs}px;background:${T.surf2};border:1px solid ${T.line}">${tf}</div>
    </div>

    <div style="text-align:center;font-size:15px;font-weight:600">Where does Bitcoin go in the next 15 minutes?</div>

    <div style="display:flex;gap:11px">${button('up')}${button('down')}</div>

    <div style="display:flex;flex-direction:column;gap:6px">
      <div style="display:flex;align-items:center;gap:8px;padding:12px 14px;border-radius:${T.r}px;background:${T.surf};border:1px solid ${T.line}">
        <div class="n" style="font-size:13px;color:${T.text}">750 AUSD · 15x</div>
        <div style="font-size:13px;color:${T.mute}">stop off · TP off</div>
        <div style="margin-left:auto">${ICON.chev(T.mute)}</div>
      </div>
      <div style="font-size:12px;color:${T.mute};line-height:1.35">This tap risks at most <span class="n" style="color:${T.text}">50 AUSD</span>, all you put in.</div>
    </div>

    <div style="display:flex;align-items:center;gap:10px;padding:11px 14px;border-radius:${T.r}px;border:1px solid ${T.line}">
      <div style="display:flex;flex-direction:column;gap:2px;min-width:0">
        <div style="color:${T.mute};${T.caps}">Analysis · Nansen · 14:20</div>
        <div style="font-size:12px;color:${T.dim};white-space:nowrap;overflow:hidden;text-overflow:ellipsis"><span style="color:${T.text};font-weight:600">buyers ahead</span> · whales bought the dip</div>
      </div>
      <div style="margin-left:auto">${ICON.chev(T.mute)}</div>
    </div>

  </div>`);
}

// -------------------------------------------------------------- screen three

function position(T) {
  const pnl = '+1.04';
  return shell(T, `
  <div style="flex:1;display:flex;flex-direction:column;gap:${T.tight ? 10 : 13}px;padding:52px ${T.pad}px 20px;min-height:0">

    <div style="display:flex;align-items:center;gap:8px">
      ${ICON.back(T.dim)}
      <div style="font-size:15px;font-weight:600">Direction · BTC</div>
      ${badge(T)}
      <div style="margin-left:auto;display:flex;align-items:center;gap:6px;padding:5px 10px;border-radius:${T.rs}px;border:1px solid ${T.line};font-size:12px;color:${T.dim}">${ICON.share(T.dim)}Share</div>
    </div>

    <div style="flex:1;min-height:200px;position:relative;border-radius:${T.r}px;background:${T.surf};overflow:hidden">
      ${chart(T, 354, 260, { entry: true })}
      <div style="position:absolute;top:11px;left:13px" class="n">
        <div style="font-size:22px;font-weight:700;letter-spacing:-0.02em;line-height:1">${Math.round(LAST).toLocaleString('en-US').replace(/,/g, ' ')}</div>
        <div style="font-size:10px;color:${T.mute};margin-top:3px">in at ${Math.round(ENTRY).toLocaleString('en-US').replace(/,/g, ' ')}</div>
      </div>
    </div>

    <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:12px;padding:${T.tight ? 14 : 17}px;border-radius:${T.r}px;background:${T.surf}">
      <div style="display:flex;flex-direction:column;gap:3px;min-width:0">
        <div class="n" style="font-size:11px;color:${T.mute}">Up · 750 AUSD × 15x</div>
        <div style="font-size:14px;color:${T.dim}">You are up</div>
        <div class="n" style="font-size:42px;font-weight:700;letter-spacing:-0.03em;line-height:1.05;color:${T.up}">${pnl}</div>
        <div class="n" style="font-size:11px;color:${T.mute}">AUSD · BTC up 0.09% · fees 0.26</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:5px;align-items:flex-end;flex-shrink:0">
        <div style="font-size:11px;color:${T.mute}">Closes in</div>
        <div class="n" style="font-size:25px;font-weight:700;line-height:1">12:31</div>
        <div style="width:84px;height:5px;border-radius:3px;background:${T.surf2};overflow:hidden"><div style="height:5px;width:17%;background:${T.accent}"></div></div>
      </div>
    </div>

    <div style="font-size:12px;line-height:1.4;color:${T.mute}">No stop: the time limit is the exit. Liquidation is <span class="n" style="color:${T.text}">6.7%</span> away.</div>

    <div style="margin-top:auto;height:52px;border-radius:${T.rBtn}px;border:1px solid ${T.accent};color:${T.accent};display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:600">Close now</div>

  </div>`);
}

// ------------------------------------------------------------------- the key

function key() {
  const row = (T) => `
    <div style="display:flex;flex-direction:column;gap:8px;padding:16px;border-radius:14px;border:1px solid #E3DFDA;background:#FFFFFF">
      <div style="display:flex;align-items:baseline;gap:8px">
        <div style="font-size:18px;font-weight:700;color:#0E100F">${T.label}</div>
        <div style="font-size:12px;color:#8A857F">after ${T.ref}</div>
        <div style="margin-left:auto;display:flex;gap:4px">
          ${[T.bg, T.surf, T.accent, T.up, T.down].map((c) => `<div style="width:18px;height:18px;border-radius:5px;background:${c};border:1px solid rgba(0,0,0,0.12)"></div>`).join('')}
        </div>
      </div>
      <div style="font-size:13px;line-height:1.45;color:#3F3B37">${T.pitch}</div>
      <div style="font-size:12px;line-height:1.4;color:#8A857F"><span style="color:#DC5546;font-weight:600">Costs:</span> ${T.cost}</div>
    </div>`;

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
<div style="width:620px;height:660px;box-sizing:border-box;background:#FBFAF9;color:#0E100F;padding:26px;display:flex;flex-direction:column;gap:12px;overflow:hidden">
  <div style="display:flex;flex-direction:column;gap:5px">
    <div style="font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#8A857F">Stage 2 · pick one</div>
    <div style="font-size:25px;font-weight:700;letter-spacing:-0.01em">Four directions, three screens each</div>
    <div style="font-size:13px;line-height:1.45;color:#5C5752">Same copy, same layout, same price series in every row — only the design language changes. Each row is lobby, strategy, position, left to right.</div>
  </div>
  ${DIRECTIONS.map(row).join('')}
</div>
</x-dc>
</body>
</html>
`;
}

DIRECTIONS[0].pitch = 'Near-black with one mint accent, dense rows, monospaced numbers. Reads as an instrument: the number is the product and nothing competes with it.';
DIRECTIONS[0].cost = 'Unforgiving to a beginner. Looks like something you need a licence to operate — the opposite of what onboarding promises.';
DIRECTIONS[1].pitch = 'Exchange grammar: charcoal, gold accent, green and red up-down, tight radii, badges everywhere. Instantly legible to anyone who has used an exchange.';
DIRECTIONS[1].cost = 'Familiar to the 5% who already trade, invisible to everyone else. Gold plus green plus red is three accents fighting for the same eye.';
DIRECTIONS[2].pitch = 'Black, one green, enormous type and space. One thing per screen, a hand-sized button. The direction that fits "three minutes to your first trade".';
DIRECTIONS[2].cost = 'Space costs rows: the strategy list and the trade detail get tight. Green as both accent and "up" makes the neutral state read as profit.';
DIRECTIONS[3].pitch = 'Off-white paper with Monad purple, geometric type, generous corners. The only light direction and the only one that says which chain this is without a logo.';
DIRECTIONS[3].cost = 'Light screens are worse at 2am and worse under a bar light. Purple carries no market meaning, so up and down need their own colours anyway.';

// ------------------------------------------------------------------- emit

const SCREENS = [
  ['Lobby', lobby],
  ['Strategy', strategy],
  ['Position', position],
];

const artboards = [];
const W = 390, H = 844, COL = W + 80, ROW = H + 130;
const TOP = 760;

writeFileSync(join(OUT, 'Main.dc.html'), key());
artboards.push({ file: 'Main.dc.html', x: 0, y: 0, w: 620, h: 660, title: 'The four directions' });

DIRECTIONS.forEach((T, r) => {
  SCREENS.forEach(([name, fn], c) => {
    const file = `${T.key}${name}.dc.html`;
    writeFileSync(join(OUT, file), fn(T));
    artboards.push({
      file, x: c * COL, y: TOP + r * ROW, w: W, h: H,
      title: `${T.label} · ${name}`,
    });
  });
});

const canvas = {
  artboards,
  annotations: DIRECTIONS.map((T, r) => ({
    id: `dir-${T.key.toLowerCase()}`,
    x: 3 * COL + 40,
    y: TOP + r * ROW + 40,
    w: 300,
    text: `${T.label} — after ${T.ref}\n\n${T.pitch}\n\nCosts: ${T.cost}`,
  })).concat([{
    id: 'how-to-read',
    x: 700,
    y: 60,
    w: 320,
    text: 'Every row carries identical copy and identical numbers. If one row reads better, that is the design language, not the content.\n\nPick one row. The chosen one becomes the token set in constants/theme.ts; the other three go to a second page or get deleted.',
  }]),
  launch: { view: 'canvas' },
};

writeFileSync(join(OUT, 'canvas.json'), JSON.stringify(canvas, null, 2) + '\n');

console.log(`wrote ${artboards.length} artboards + canvas.json into ${OUT}`);
