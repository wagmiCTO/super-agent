// Builds the «Функционал» page: the lobby as a hub and one scheme per flow,
// the same for testnet and mainnet. Every function the app has today is on
// these screens; nothing is cut. Run: node features.mjs
import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Write beside this file, not into whatever directory node was started from.
const OUT = dirname(fileURLToPath(import.meta.url));
import { INK, MUTED, BODY, LINE, SOFT, HAIR, PH, btn, badge, h1, p, small, card, row, term, page, header, MONAD, S, strip, branchStrip, doc } from './screens.mjs';

const NET = 'mainnet'; // no badge: these screens are identical on both networks
const toast = (text, kind = 'error') => `<div style="padding: 12px 14px; border-radius: 12px; background: ${kind === 'error' ? '#FEE2E2' : SOFT}; font-size: 14px; line-height: 1.4; color: ${INK};">${text}</div>`;
const chip = (label, on = false) => `<div style="padding: 8px 12px; border-radius: 10px; font-size: 13px; font-weight: 600; ${on ? `background: ${INK}; color: #FFFFFF;` : `border: 1px solid ${LINE}; color: ${BODY};`}">${label}</div>`;
const chips = (labels, on) => `<div style="display: flex; gap: 6px; flex-wrap: wrap;">${labels.map((l) => chip(l, l === on)).join('')}</div>`;
const icon = (d, c = INK) => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const SHARE = (c = INK) => icon('<path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"></path><path d="M12 15V3"></path><path d="M8 7l4-4 4 4"></path>', c);
const CANDLES = icon('<path d="M7 4v3"></path><rect x="5" y="7" width="4" height="8" rx="1"></rect><path d="M7 15v5"></path><path d="M17 3v5"></path><rect x="15" y="8" width="4" height="6" rx="1"></rect><path d="M17 14v6"></path>', BODY);
const shareButton = (label = 'Share') => `<div style="height: 52px; border-radius: 12px; border: 1px solid ${INK}; display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 17px; font-weight: 600;">${SHARE()}${label}</div>`;
const toggle = (on) => `<div style="width: 44px; height: 26px; border-radius: 13px; background: ${on ? INK : HAIR}; position: relative; flex-shrink: 0;"><div style="position: absolute; top: 3px; ${on ? 'right: 3px;' : 'left: 3px;'} width: 20px; height: 20px; border-radius: 10px; background: #FFFFFF;"></div></div>`;

// ---- the strategy screen: chart, two buttons, the settings chip; everything else below ----
const bigChart = (name, { height = 360, signal = 'none' } = {}) => {
  const lit = signal === 'lit' || signal === 'lit-down';
  const overlay = `<div style="position: absolute; top: 12px; left: 14px; display: flex; flex-direction: column; gap: 2px;"><div style="font-size: 26px; font-weight: 700; letter-spacing: -0.01em; line-height: 1;">61 250</div><div style="font-size: 12px; color: ${MUTED};">BTC · +0.3% today</div></div><div style="position: absolute; top: 10px; right: 10px; display: flex; align-items: center; gap: 6px;"><div style="display: flex; gap: 2px; padding: 3px; border-radius: 8px; background: rgba(255,255,255,0.85); border: 1px solid ${LINE};">${['1m', '5m', '15m', '30m', '1h'].map((tf) => `<div style="padding: 3px 5px; border-radius: 5px; font-size: 10px; font-weight: 600; ${tf === '1m' ? `background: ${INK}; color: #FFFFFF;` : `color: ${BODY};`}">${tf}</div>`).join('')}</div><div style="width: 30px; height: 30px; border-radius: 8px; background: rgba(255,255,255,0.85); border: 1px solid ${LINE}; display: flex; align-items: center; justify-content: center;">${CANDLES}</div></div>`;
  const legend = name === 'MA Cross' ? `<div style="position: absolute; bottom: 10px; left: 14px; font-size: 11px; color: ${MUTED};">MA 9 · MA 21 ${lit ? '· cross 4 min ago' : '· trend up'}</div>` : '';
  const cross = name === 'MA Cross' && lit ? `<div style="position: absolute; left: 68%; top: ${signal === 'lit' ? '58%' : '34%'}; width: 22px; height: 22px; border-radius: 11px; background: ${INK}; border: 4px solid #FFFFFF; box-shadow: 0 0 0 2px ${INK};"></div><div style="position: absolute; left: 68%; top: ${signal === 'lit' ? '30%' : '62%'}; transform: translateX(-40%); font-size: 11px; font-weight: 700; padding: 3px 7px; border-radius: 6px; background: ${INK}; color: #FFFFFF;">CROSS</div>` : '';
  const priceH = name === 'RSI Bounce' ? height - 96 : height;
  const v0 = signal === 'lit-down' ? 79 : signal === 'lit' ? 27 : 52;
  const scale = name === 'RSI Bounce' ? `<div style="position: absolute; left: 14px; top: 62px; bottom: 14px; width: 40px; display: flex; flex-direction: column; align-items: center; gap: 4px;"><div style="font-size: 10px; color: ${MUTED};">70</div><div style="flex: 1; width: 14px; border-radius: 7px; background: rgba(255,255,255,0.85); border: 1px solid ${LINE}; position: relative; overflow: hidden;"><div style="position: absolute; top: 0; left: 0; right: 0; height: 30%; background: #D4D4D8;"></div><div style="position: absolute; bottom: 0; left: 0; right: 0; height: 30%; background: #D4D4D8;"></div><div style="position: absolute; left: 0; right: 0; bottom: ${v0}%; height: 4px; background: ${INK};"></div></div><div style="font-size: 10px; color: ${MUTED};">30</div><div style="font-size: 13px; font-weight: 700;">${v0}</div></div>` : '';
  const price = `<div style="height: ${priceH}px; border-radius: ${name === 'RSI Bounce' ? '16px 16px 0 0' : '16px'}; position: relative; ${PH} ${lit ? `box-shadow: inset 0 0 0 3px ${INK};` : ''}">${overlay}${legend}${cross}${scale}</div>`;
  if (name !== 'RSI Bounce') return price;
  const v = signal === 'lit-down' ? 79 : signal === 'lit' ? 27 : 52;
  const rsi = `<div style="height: 96px; border-radius: 0 0 16px 16px; position: relative; background: ${SOFT}; border: 1px solid ${HAIR}; border-top: 0; box-sizing: border-box; overflow: hidden; ${lit ? `box-shadow: inset 0 0 0 3px ${INK};` : ''}">
    <div style="position: absolute; left: 0; right: 0; top: 0; height: 30%; background: rgba(24,24,27,0.06);"></div><div style="position: absolute; left: 0; right: 0; bottom: 0; height: 30%; background: rgba(24,24,27,0.06);"></div>
    <div style="position: absolute; left: 12px; top: 6px; font-size: 11px; font-weight: 600; letter-spacing: 0.04em; color: ${MUTED};">RSI 14 · 1m</div><div style="position: absolute; right: 12px; top: 22%; font-size: 10px; color: ${MUTED};">70</div><div style="position: absolute; right: 12px; bottom: 22%; font-size: 10px; color: ${MUTED};">30</div>
    <svg width="100%" height="100%" viewBox="0 0 360 96" preserveAspectRatio="none" style="position: absolute; inset: 0;"><polyline fill="none" stroke="${INK}" stroke-width="2" points="${signal === 'lit' ? '0,40 30,44 60,38 90,50 120,46 150,58 180,55 210,66 240,70 270,74 300,78 330,72 360,70' : signal === 'lit-down' ? '0,60 30,52 60,56 90,44 120,40 150,34 180,36 210,28 240,24 270,20 300,18 330,24 360,26' : '0,50 30,44 60,54 90,48 120,58 150,50 180,42 210,48 240,54 270,46 300,50 330,44 360,46'}"></polyline></svg>
    <div style="position: absolute; right: 8px; top: ${100 - v}%; transform: translateY(-50%); font-size: 12px; font-weight: 700; padding: 2px 6px; border-radius: 6px; background: ${INK}; color: #FFFFFF;">${v}</div>
  </div>`;
  return `<div style="display: flex; flex-direction: column;">${price}${rsi}</div>`;
};
const says = (name, signal) => {
  if (name === 'Direction') return `<div style="font-size: 16px; font-weight: 700; text-align: center;">Where does Bitcoin go in the next 15 minutes?</div>`;
  if (signal === 'warming') return `<div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 14px; border-radius: 12px; border: 1px dashed ${LINE}; font-size: 14px;"><div style="color: ${BODY};">Warming up the signal</div><div style="color: ${MUTED};">a minute or two</div></div>`;
  if (signal === 'waiting') return `<div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 14px; border-radius: 12px; border: 1px dashed ${LINE}; font-size: 14px;"><div style="color: ${BODY};"><b>No signal now</b> · ${name === 'MA Cross' ? 'waiting for the next cross' : 'waiting for a zone'}</div><div style="color: ${MUTED};">last 11:20 · Up</div></div>`;
  const side = signal === 'lit-down' ? 'DOWN' : 'UP';
  const why = name === 'MA Cross' ? (side === 'UP' ? 'cross up' : 'cross down') : (side === 'UP' ? 'RSI 27 · oversold' : 'RSI 79 · overbought');
  return `<div style="display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-radius: 12px; background: ${INK}; color: #FFFFFF;"><div style="width: 10px; height: 10px; border-radius: 5px; background: #FFFFFF; box-shadow: 0 0 0 4px rgba(255,255,255,0.25); flex-shrink: 0;"></div><div style="flex: 1; display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap;"><div style="font-size: 17px; font-weight: 700; letter-spacing: 0.02em;">SIGNAL · ${side}</div><div style="font-size: 12px; color: #D4D4D8;">${why}</div></div><div style="text-align: right;"><div style="font-size: 18px; font-weight: 700; line-height: 1;">4:12</div><div style="font-size: 10px; color: #A1A1AA;">window</div></div></div>`;
};
const buttons = (recommend = null, blocked = false) => {
  const one = (label, sub, filled, h = 76) => `<div style="flex: 1; height: ${h}px; border-radius: 16px; ${filled ? `background: ${INK}; color: #FFFFFF;` : `border: 2px solid ${INK};`} display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; box-sizing: border-box;"><div style="font-size: ${h > 70 ? 22 : 18}px; font-weight: 700;">${label}</div><div style="font-size: 12px; ${filled ? 'color: #D4D4D8;' : `color: ${MUTED};`}">${sub}</div></div>`;
  let html;
  if (recommend === 'up') html = `<div style="display: flex; flex-direction: column; gap: 8px;">${one('Up', 'take the signal', true, 76)}${one('Down', 'against the signal', false, 46)}</div>`;
  else if (recommend === 'down') html = `<div style="display: flex; flex-direction: column; gap: 8px;">${one('Down', 'take the signal', true, 76)}${one('Up', 'against the signal', false, 46)}</div>`;
  else html = `<div style="display: flex; gap: 12px;">${one('Up', 'it rises', false)}${one('Down', 'it falls', false)}</div>`;
  return blocked ? `<div style="opacity: 0.4;">${html}</div>` : html;
};
const settingsChip = (opts = {}) => `<div style="display: flex; flex-direction: column; gap: 6px;"><div style="display: flex; align-items: center; gap: 6px; padding: 12px 14px; border-radius: 12px; background: ${SOFT}; font-size: 14px; color: ${BODY};"><div>${opts.size ?? '750'} AUSD</div><div style="color: #A1A1AA;">·</div>${term(opts.lev ?? '15x')}<div style="color: #A1A1AA;">·</div>${term(opts.stop ?? 'stop off')}<div style="color: #A1A1AA;">·</div>${term(opts.tp ?? 'TP off')}<div style="margin-left: auto; color: ${MUTED};">›</div></div>${small(`This tap risks at most ${opts.risk ?? '50'} AUSD, all you put in.`)}</div>`;
const ANALYSIS = { headline: 'Whales bought the dip this morning; retail is still selling.', flows: 'buys $4.2M · sells $2.9M', lean: 'buyers ahead', who: 'Buying: Wintermute $1.1M, 0x9a…f2 $640K · Selling: Jump $780K', strategies: 'A trend day: crosses paid 3 of 4 so far, RSI zones came once. MA Cross fits today better than RSI.' };
const analysisCard = (open = false) => open
  ? card(`<div style="display: flex; justify-content: space-between; font-size: 12px; font-weight: 600; letter-spacing: 0.04em; color: ${MUTED};"><div>ANALYSIS · NANSEN</div><div>as of 12:40</div></div><div style="font-size: 15px; line-height: 1.4; font-weight: 600;">${ANALYSIS.headline}</div><div style="display: flex; justify-content: space-between; font-size: 13px; color: ${MUTED};"><div>${ANALYSIS.flows}</div><div style="font-weight: 600; color: ${INK};">${ANALYSIS.lean}</div></div>${small(ANALYSIS.who)}<div style="padding-top: 8px; border-top: 1px solid ${HAIR}; font-size: 14px; line-height: 1.4; color: ${BODY};"><b>Strategies today.</b> ${ANALYSIS.strategies}</div>${small('Tap to fold')}`)
  : `<div style="display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-radius: 12px; border: 1px solid ${LINE}; background: #FAFAFA;"><div style="display: flex; flex-direction: column; gap: 3px; flex: 1;"><div style="font-size: 11px; font-weight: 600; letter-spacing: 0.04em; color: ${MUTED};">ANALYSIS · NANSEN · 12:40</div><div style="font-size: 14px; line-height: 1.35;"><b>${ANALYSIS.lean}</b> · whales bought the dip · a trend day, crosses are paying</div></div><div style="color: ${MUTED};">›</div></div>`;
const contextLine = analysisCard;
const historyCard = (tab = 'Positions') => card(
  `<div style="display: flex; justify-content: space-between; align-items: center;">${chips(['Positions', 'Orders'], tab)}<div style="font-size: 13px; color: ${MUTED};">All history ›</div></div>` +
  (tab === 'Positions'
    ? [['Up · 0.008 @ 61 250 → 61 396', '12:10 – 12:25 · by timer', '+1.04'], ['Down · 0.008 @ 61 480 → 61 510', '09:02 – 09:06 · closed', '−0.42'], ['Up · 0.008 @ 60 900 → 60 720', 'yesterday 19:40 · stop', '−25.00']]
    : [['Close Up · timer · 0.008 @ 61 396', '12:25 · fee 0.09', 'filled'], ['Open Up · 0.008 @ 61 250', '12:10 · fee 0.08', 'filled'], ['Close Down · 0.008 @ 61 510', '09:06 · fee 0.09', 'filled']])
    .map(([a, b, c]) => `<div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-top: 1px solid ${HAIR};"><div style="display: flex; flex-direction: column; gap: 2px;"><div style="font-size: 14px;">${a}</div>${small(b)}</div><div style="font-size: 14px; font-weight: 600;">${c}</div></div>`).join(''));
const stateLine = (state) =>
  state === 'cooldown' ? toast('Wait 42 s before the next tap. A pause between trades is part of the plan.', 'info')
  : state === 'limit' ? toast("Today's loss budget is used up. The next tap opens tomorrow at 00:00.", 'info')
  : state === 'refused' ? toast("Not this time: this tap would go past today's loss budget (25 AUSD). Try a smaller amount.")
  : state === 'rejected' ? toast('The exchange refused: the price moved. Nothing opened. Tap again.')
  : state === 'filled' ? toast('Filled 0.008 @ 61 250, fee 0.08', 'info')
  : state === 'timer' ? toast('Closed by timer @ 61 396, +1.04 while you were away', 'info')
  : state === 'paused' ? toast('This strategy is paused by the platform. Your positions were closed. Back when the kill switch lifts.', 'info')
  : '';
const analysisPopup = (name) => `<div style="position: absolute; inset: 0; background: rgba(24,24,27,0.35); display: flex; align-items: flex-end;"><div style="width: 100%; border-radius: 20px 20px 0 0; background: #FFFFFF; padding: 20px 20px 28px; box-sizing: border-box; display: flex; flex-direction: column; gap: 12px;"><div style="width: 36px; height: 4px; border-radius: 2px; background: ${LINE}; align-self: center;"></div><div style="font-size: 12px; font-weight: 600; letter-spacing: 0.04em; color: ${MUTED};">TODAY ON BITCOIN · NANSEN · 12:40</div><div style="font-size: 20px; font-weight: 700; line-height: 1.2; text-wrap: balance;">${ANALYSIS.headline}</div><div style="display: flex; justify-content: space-between; font-size: 13px; color: ${MUTED};"><div>${ANALYSIS.flows}</div><div style="font-weight: 600; color: ${INK};">${ANALYSIS.lean}</div></div><div style="font-size: 14px; line-height: 1.4; color: ${BODY};"><b>Strategies today.</b> ${ANALYSIS.strategies}</div>${small('Shown once a day when you open a strategy. It informs the tap; it never makes it.')}${btn('Got it')}</div></div>`;
const strategyHeader = (name) => `<div style="display: flex; align-items: center; gap: 10px;"><div style="font-size: 14px; color: ${MUTED};">‹ Lobby</div><div style="font-size: 15px; font-weight: 600;">${name}</div>${badge(NET)}<div style="margin-left: auto; display: flex; gap: 10px; align-items: center;"><div style="font-size: 13px; color: ${MUTED};">101 AUSD</div><div style="width: 28px; height: 28px; border-radius: 14px; border: 1px solid ${LINE}; display: flex; align-items: center; justify-content: center; font-size: 14px; color: #52525B;">?</div></div></div>`;

/** What a tap can win and lose, from the settings: the line pinned under every settings screen. */
const possible = (o) => { const put = o.size / o.lev; const loss = o.stopOn ? put * o.stop / 100 : put; const win = o.tpOn ? `+${(put * o.tp / 100).toFixed(2)} · at +${o.tp}%` : `+${(o.size / 100).toFixed(2)} per 1% of Bitcoin · no cap`;
  return `<div style="display: flex; gap: 8px;"><div style="flex: 1; padding: 12px 14px; border-radius: 12px; background: ${SOFT}; display: flex; flex-direction: column; gap: 2px;"><div style="font-size: 11px; font-weight: 600; letter-spacing: 0.04em; color: ${MUTED};">POSSIBLE WIN</div><div style="font-size: 16px; font-weight: 700;">${win}</div></div><div style="flex: 1; padding: 12px 14px; border-radius: 12px; background: ${SOFT}; display: flex; flex-direction: column; gap: 2px;"><div style="font-size: 11px; font-weight: 600; letter-spacing: 0.04em; color: ${MUTED};">POSSIBLE LOSS</div><div style="font-size: 16px; font-weight: 700;">−${loss.toFixed(2)} at most</div></div></div>`; };
const sliderRow = (label, val, pct, note = '') => `<div style="display: flex; flex-direction: column; gap: 6px;"><div style="display: flex; justify-content: space-between; align-items: baseline; font-size: 13px;"><div style="color: ${MUTED};">${label}</div><b style="font-size: 15px;">${val}</b></div><div style="height: 6px; border-radius: 3px; background: ${HAIR}; position: relative;"><div style="position: absolute; left: 0; width: ${pct}%; height: 6px; border-radius: 3px; background: ${INK};"></div><div style="position: absolute; left: calc(${pct}% - 12px); top: -9px; width: 24px; height: 24px; border-radius: 12px; background: ${INK}; border: 3px solid #FFFFFF;"></div></div>${note ? small(note) : ''}</div>`;
const pctRow = (title, on, chipsList, picked, custom, note) => `<div style="display: flex; flex-direction: column; gap: 8px; padding: 10px 14px; border-radius: 12px; background: ${SOFT};"><div style="display: flex; align-items: center; justify-content: space-between;"><div style="display: flex; align-items: baseline; gap: 8px;"><div style="font-size: 15px; font-weight: 600;">${title}</div>${small(on ? note : 'off')}</div>${toggle(on)}</div>${on ? `<div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">${chips(chipsList, picked)}<div style="display: flex; align-items: center; gap: 4px; padding: 6px 10px; border-radius: 10px; border: 1px dashed ${LINE}; font-size: 13px; color: ${MUTED};">any <b style="color: ${INK};">${custom}</b>%</div></div>` : ''}</div>`;
/** The standard position, set once: size up to balance × leverage, leverage, a stop and a take profit in percent. */
const positionForm = (o = { size: 750, lev: 15, stopOn: false, stop: 50, tpOn: false, tp: 50, balance: 101 }) => `<div style="display: flex; flex-direction: column; gap: 12px;">
  <div style="display: flex; flex-direction: column; gap: 6px;"><div style="display: flex; justify-content: space-between; font-size: 13px;"><div style="color: ${MUTED};">Position size</div><div style="color: ${MUTED};">max ${Math.floor(o.balance * o.lev).toLocaleString('en-US').replace(/,/g, ' ')}</div></div><div style="display: flex; align-items: baseline; gap: 8px; padding: 10px 14px; border-radius: 12px; border: 1px solid ${LINE};"><div style="font-size: 30px; font-weight: 700; letter-spacing: -0.01em;">${o.size}</div><div style="font-size: 13px; color: ${MUTED};">AUSD · ${(o.size / o.lev).toFixed(0)} of yours at ${o.lev}x</div></div><div style="height: 6px; border-radius: 3px; background: ${HAIR}; position: relative;"><div style="position: absolute; left: 0; width: ${Math.round(o.size / (o.balance * o.lev) * 100)}%; height: 6px; border-radius: 3px; background: ${INK};"></div><div style="position: absolute; left: calc(${Math.round(o.size / (o.balance * o.lev) * 100)}% - 12px); top: -9px; width: 24px; height: 24px; border-radius: 12px; background: ${INK}; border: 3px solid #FFFFFF;"></div></div></div>
  ${sliderRow(`Leverage · up to 15x`, `${o.lev}x`, Math.round(o.lev / 15 * 100))}
  ${pctRow('Stop', o.stopOn, ['−10%', '−25%', '−50%', '−75%'], `−${o.stop}%`, o.stop, `−${o.stop}% · ${(o.size / o.lev * o.stop / 100).toFixed(2)} AUSD`)}
  ${pctRow('Take profit', o.tpOn, ['+25%', '+50%', '+100%', '+200%'], `+${o.tp}%`, o.tp, `+${o.tp}% · ${(o.size / o.lev * o.tp / 100).toFixed(2)} AUSD`)}
</div>`;

const F = {
  /** The strategy screen, whole, as it scrolls: the tall phone shows it entire. */
  strategyFull: ({ name = 'Direction', signal = 'none', state = 'ok', tab = 'Positions', context = false } = {}) => {
    const blocked = state === 'cooldown' || state === 'limit' || state === 'paused';
    const rec = signal === 'lit' ? 'up' : signal === 'lit-down' ? 'down' : null;
    return `<div style="flex: 1; display: flex; flex-direction: column; padding: 60px 20px 28px; box-sizing: border-box; gap: 14px;">
      ${strategyHeader(name)}
      ${bigChart(name, { signal, height: (rec ? 400 : name === 'Direction' ? 460 : 440) - (state !== 'ok' ? 56 : 0) })}
      ${says(name, signal)}
      ${stateLine(state)}
      <div style="padding: 12px 14px 14px; margin-left: -20px; margin-right: -20px; border-top: 1px solid ${HAIR}; border-bottom: 1px solid ${HAIR}; background: #FFFFFF; display: flex; flex-direction: column; gap: 10px;"><div style="font-size: 11px; font-weight: 600; letter-spacing: 0.04em; color: ${MUTED}; text-align: center;">PINNED TO THE BOTTOM · STAYS WHILE SCROLLING</div>${buttons(rec, blocked)}${settingsChip()}</div>
      <div style="display: flex; align-items: center; gap: 10px; color: ${MUTED}; font-size: 11px; font-weight: 600; letter-spacing: 0.04em;"><div style="flex: 1; border-top: 1px dashed ${LINE};"></div><div>BELOW THE FOLD</div><div style="flex: 1; border-top: 1px dashed ${LINE};"></div></div>
      ${analysisCard(context)}
      ${historyCard(tab)}
    </div>`;
  },

  /** Above the fold only: what a phone shows without scrolling. */
  strategy: ({ name = 'Direction', signal = 'none', state = 'ok' } = {}) => {
    const blocked = state === 'cooldown' || state === 'limit' || state === 'paused';
    const rec = signal === 'lit' ? 'up' : signal === 'lit-down' ? 'down' : null;
    // the chart takes every pixel the buttons do not: the fold shows only the top of the history
    const height = (rec ? 400 : name === 'Direction' ? 460 : 440) - (state !== 'ok' ? 56 : 0);
    return `<div style="flex: 1; display: flex; flex-direction: column; padding: 60px 20px 0; box-sizing: border-box; gap: 14px; overflow: hidden;">
      ${strategyHeader(name)}
      ${bigChart(name, { signal, height })}
      ${says(name, signal)}
      ${stateLine(state)}
      <div style="padding-top: 12px; border-top: 1px solid ${HAIR}; display: flex; flex-direction: column; gap: 10px;">${buttons(rec, blocked)}${settingsChip()}</div>
      <div style="opacity: 0.6;">${analysisCard(false)}</div>
    </div>`;
  },

  strategyWithPopup: (opts = {}) => `<div style="flex: 1; position: relative; display: flex; flex-direction: column;">${F.strategy(opts)}${analysisPopup(opts.name ?? 'Direction')}</div>`,

  positionSettings: (o) => `<div style="flex: 1; display: flex; flex-direction: column; padding: 60px 20px 28px; box-sizing: border-box; gap: 16px;">
     <div style="display: flex; align-items: center; gap: 10px;"><div style="font-size: 14px; color: ${MUTED};">‹ Back</div><div style="font-size: 15px; font-weight: 600;">Position settings</div><div style="margin-left: auto; font-size: 13px; color: ${MUTED};">applies to every tap</div></div>
     ${positionForm(o)}
     <div style="margin-top: auto; padding-top: 10px; border-top: 1px solid ${HAIR}; display: flex; flex-direction: column; gap: 10px; position: sticky; bottom: 0; background: #FFFFFF;">${possible(o ?? { size: 750, lev: 15, stopOn: false, stop: 50, tpOn: false, tp: 50 })}${btn('Done')}</div>
   </div>`,

  position: (opts = {}) => `<div style="flex: 1; display: flex; flex-direction: column; padding: 60px 20px 28px; box-sizing: border-box; gap: 14px;">
     <div style="display: flex; align-items: center; gap: 10px;"><div style="font-size: 15px; font-weight: 600;">Direction · BTC</div>${badge(NET)}<div style="margin-left: auto; display: flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 16px; border: 1px solid ${LINE}; font-size: 13px; font-weight: 600;">${SHARE()}Share</div></div>
     <div style="height: 400px; border-radius: 16px; position: relative; ${PH}"><div style="position: absolute; top: 12px; left: 14px;"><div style="font-size: 26px; font-weight: 700; letter-spacing: -0.01em; line-height: 1;">61 421</div><div style="font-size: 12px; color: ${MUTED};">BTC · since you tapped +0.28%</div></div><div style="position: absolute; left: 0; right: 0; top: 54%; border-top: 2px dashed ${INK};"></div><div style="position: absolute; right: 10px; top: 54%; transform: translateY(-50%); font-size: 11px; font-weight: 600; padding: 2px 6px; border-radius: 6px; background: ${INK}; color: #FFFFFF;">IN 61 250</div><div style="position: absolute; left: 0; right: 0; top: 86%; border-top: 1px dashed #A1A1AA;"></div><div style="position: absolute; right: 10px; top: 86%; transform: translateY(-50%); font-size: 11px; padding: 2px 6px; border-radius: 6px; border: 1px solid ${LINE}; background: #FFFFFF; color: ${BODY};">STOP −25</div></div>
     ${opts.banner ? `<div style="padding: 12px 14px; border-radius: 12px; background: ${SOFT}; font-size: 14px; font-weight: 600;">${opts.banner}</div>` : ''}
     <div style="display: flex; align-items: flex-end; justify-content: space-between; padding: 16px; border-radius: 16px; background: ${SOFT};"><div style="display: flex; flex-direction: column; gap: 4px;">${small('Up · 50 AUSD × 15x · in at 61 250')}<div style="font-size: 15px; color: ${BODY};">${opts.words ?? 'You are up'}</div><div style="font-size: 44px; font-weight: 700; letter-spacing: -0.02em; line-height: 1;">${opts.pnl ?? '+1.86'}</div>${small('AUSD · fees 0.26')}</div><div style="text-align: right; display: flex; flex-direction: column; gap: 4px;">${small('Closes in')}<div style="font-size: 28px; font-weight: 700; letter-spacing: -0.01em; line-height: 1;">${opts.left ?? '11:42'}</div><div style="width: 90px; height: 6px; border-radius: 3px; background: ${HAIR}; overflow: hidden; margin-left: auto;"><div style="height: 6px; width: ${opts.pct ?? '22%'}; background: ${INK};"></div></div></div></div>
     ${small('Stops by itself at −25 AUSD (3.3% against you). Liquidation is far: 6.7% away.')}
     <div style="margin-top: auto;">${btn('Close now', 'outline')}</div>
   </div>`,

  shareSheet: (kind = 'live') => `<div style="flex: 1; position: relative;">${kind === 'live' ? F.position() : S.result(NET)}
     <div style="position: absolute; inset: 0; background: rgba(24,24,27,0.35); display: flex; align-items: flex-end;"><div style="width: 100%; border-radius: 20px 20px 0 0; background: #FFFFFF; padding: 20px 20px 28px; box-sizing: border-box; display: flex; flex-direction: column; gap: 14px;">
       <div style="width: 36px; height: 4px; border-radius: 2px; background: ${LINE}; align-self: center;"></div>
       <div style="font-size: 18px; font-weight: 700;">${kind === 'live' ? 'Share this trade' : 'Share the result'}</div>
       <div style="border-radius: 16px; background: ${INK}; color: #FFFFFF; padding: 18px; display: flex; flex-direction: column; gap: 6px;"><div style="display: flex; justify-content: space-between; font-size: 12px; color: #A1A1AA;"><div>TRADEAGENT · DIRECTION</div><div>${kind === 'live' ? 'LIVE' : 'CLOSED'}</div></div><div style="font-size: 14px;">Up on Bitcoin · 50 AUSD × 15x</div><div style="font-size: 40px; font-weight: 700; letter-spacing: -0.02em;">${kind === 'live' ? '+1.86' : '+1.04'}</div><div style="font-size: 12px; color: #A1A1AA;">${kind === 'live' ? 'closes in 11:42 · follow live' : '15 min · by timer · #7 this week'}</div><div style="font-size: 12px; color: #A1A1AA;">tradeagent.app/t/8f2k</div></div>
       ${small(kind === 'live' ? 'The link shows the trade live until it closes, then the result.' : 'The link opens the result and your place on the board.')}
       <div style="display: flex; gap: 8px;">${['X', 'Telegram', 'Copy link', 'Save image'].map((l) => `<div style="flex: 1; height: 44px; border-radius: 10px; border: 1px solid ${LINE}; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 600;">${l}</div>`).join('')}</div>
     </div></div></div>`,

  tradeDetail: () => page(
    `<div style="display: flex; align-items: center; gap: 10px;"><div style="font-size: 14px; color: ${MUTED};">‹ History</div><div style="font-size: 15px; font-weight: 600;">Trade</div><div style="margin-left: auto; display: flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 16px; border: 1px solid ${LINE}; font-size: 13px; font-weight: 600;">${SHARE()}Share</div></div>
     <div style="display: flex; align-items: flex-end; justify-content: space-between;"><div><div style="font-size: 13px; font-weight: 600; letter-spacing: 0.04em; color: ${MUTED};">DIRECTION · UP · BY TIMER</div><div style="font-size: 44px; font-weight: 700; letter-spacing: -0.02em; line-height: 1; margin-top: 6px;">+1.04</div>${small('AUSD · today 12:10 – 12:25 · 15 min')}</div><div style="text-align: right;"><div style="font-size: 22px; font-weight: 700;">+2.1%</div>${small('of the 50 you put in')}</div></div>
     <div style="height: 130px; border-radius: 14px; ${PH}"></div>
     ${card(row('Bitcoin moved', '+0.24% · 61 250 → 61 396') + row('Size', '50 AUSD × 15x = 750') + row('Stop · take profit', '−25 · off') + row('Worst moment', '−3.10 at 12:14') + row('Best moment', '+2.40 at 12:22') + row('Fees', '0.13 + 0.13'))}
     ${small('Order ids 8f2k-1, 8f2k-2 · filled at the exchange')}`,
    '', '60px 24px 32px'),

  positionDetail: () => `<div style="flex: 1; position: relative; display: flex; flex-direction: column;">${F.position()}<div style="position: absolute; inset: 0; background: rgba(24,24,27,0.35); display: flex; align-items: flex-end;"><div style="width: 100%; border-radius: 20px 20px 0 0; background: #FFFFFF; padding: 20px 20px 28px; box-sizing: border-box; display: flex; flex-direction: column; gap: 12px;"><div style="width: 36px; height: 4px; border-radius: 2px; background: ${LINE}; align-self: center;"></div><div style="display: flex; align-items: flex-end; justify-content: space-between;"><div><div style="font-size: 12px; font-weight: 600; letter-spacing: 0.04em; color: ${MUTED};">OPEN · DIRECTION · UP</div><div style="font-size: 36px; font-weight: 700; letter-spacing: -0.02em; line-height: 1; margin-top: 4px;">+1.86</div></div><div style="text-align: right;"><div style="font-size: 20px; font-weight: 700;">+3.7%</div>${small('of the 50')}</div></div>${card(row('Bitcoin', '61 250 → 61 421 · +0.28%') + row('Size', '50 AUSD × 15x = 750 · 0.012 BTC') + row('Stop', '−25 at 61 045 · 3.3% away') + row('Take profit', 'off') + row('Liquidation', '60 840 · 6.7% away') + row('Worst so far', '−0.90 at 12:12') + row('Fees so far', '0.26') + row('Closes', 'in 11:42 · at 12:25'))}<div style="display: flex; gap: 8px;">${btn('Close now', 'outline')}</div></div></div></div>`,

  orderDetail: () => page(
    `<div style="display: flex; align-items: center; gap: 10px;"><div style="font-size: 14px; color: ${MUTED};">‹ History</div><div style="font-size: 15px; font-weight: 600;">Order</div><div style="margin-left: auto; font-size: 12px; color: ${MUTED};">8f2k-1 · filled</div></div>
     <div style="height: 260px; border-radius: 16px; position: relative; ${PH}"><div style="position: absolute; top: 12px; left: 14px;"><div style="font-size: 22px; font-weight: 700; line-height: 1;">Open Up</div><div style="font-size: 12px; color: ${MUTED};">0.012 BTC @ 61 250 · 12:10:04</div></div>
       <div style="position: absolute; left: 0; right: 0; top: 56%; border-top: 2px dashed ${INK};"></div><div style="position: absolute; right: 10px; top: 56%; transform: translateY(-50%); font-size: 11px; font-weight: 600; padding: 2px 6px; border-radius: 6px; background: ${INK}; color: #FFFFFF;">FILL 61 250</div>
       <div style="position: absolute; left: 0; right: 0; top: 84%; border-top: 1px dashed #A1A1AA;"></div><div style="position: absolute; right: 10px; top: 84%; transform: translateY(-50%); font-size: 11px; padding: 2px 6px; border-radius: 6px; border: 1px solid ${LINE}; background: #FFFFFF; color: ${BODY};">STOP 61 045</div>
       <div style="position: absolute; left: 0; right: 0; top: 22%; border-top: 1px dashed #A1A1AA;"></div><div style="position: absolute; right: 10px; top: 22%; transform: translateY(-50%); font-size: 11px; padding: 2px 6px; border-radius: 6px; border: 1px solid ${LINE}; background: #FFFFFF; color: ${BODY};">TP 61 660</div>
       <div style="position: absolute; left: 0; right: 0; top: 40%; border-top: 1px dashed ${INK};"></div><div style="position: absolute; left: 10px; top: 40%; transform: translateY(-50%); font-size: 11px; font-weight: 600; padding: 2px 6px; border-radius: 6px; background: #FFFFFF; border: 1px solid ${INK};">EXIT 61 396 · 12:25</div></div>
     ${card(row('Side · size', 'Up · 0.012 BTC · 750 AUSD at 15x') + row('Price', '61 250 · market') + row('Fee', '0.13 AUSD') + row('Stop · take profit', '61 045 (−25) · 61 660 (+50)') + row('Filled', 'today 12:10:04 · order 8f2k-1') + row('Trade', 'closed 12:25 by timer · +1.04 ›'))}
     ${small('The exchange’s record of this fill. The trade it belongs to has both fills.')}`,
    '', '60px 24px 32px'),

  history: (filter = 'All') => `<div style="flex: 1; display: flex; flex-direction: column; padding: 60px 20px 28px; box-sizing: border-box; gap: 14px;">
     <div style="display: flex; align-items: center; gap: 10px;"><div style="font-size: 14px; color: ${MUTED};">‹ Lobby</div><div style="font-size: 15px; font-weight: 600;">History</div><div style="margin-left: auto;">${chips(['Positions', 'Orders'], 'Positions')}</div></div>
     ${chips(['All', 'Direction', 'MA Cross', 'RSI'], filter)}
     ${card(row('This week', '5 trades · +4.14 AUSD · 3 won') + row('All time', '12 trades · +6.02 AUSD · fees 2.10'))}
     ${[['Today', [['Direction · Up @ 61 250 → 61 396', '12:10 – 12:25 · by timer', '+1.04'], ['MA Cross · Down @ 61 480 → 61 510', '09:02 – 09:06 · closed', '−0.42']]], ['Yesterday', [['Direction · Up @ 60 900 → 60 720', '19:40 · stop', '−25.00'], ['RSI Bounce · Up @ 60 400 → 60 610', '14:12 – 14:27 · by timer', '+1.66']]]]
       .map(([day, rows]) => `<div style="display: flex; flex-direction: column;">${small(day)}${rows.map(([a, b, c]) => `<div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid ${HAIR};"><div style="display: flex; flex-direction: column; gap: 2px;"><div style="font-size: 14px;">${a}</div>${small(b)}</div><div style="display: flex; align-items: center; gap: 8px;"><div style="font-size: 14px; font-weight: 600;">${c}</div><div style="color: ${MUTED};">›</div></div></div>`).join('')}</div>`).join('')}
     ${small('Every row opens the trade with its orders and a share card.')}
   </div>`,

  /** One screen for the board and the prizes: tabs per strategy, the claim banner on top. */
  leaderboard: ({ tab = 'Direction', claimable = true, period = 'week' } = {}) => `<div style="flex: 1; display: flex; flex-direction: column; padding: 60px 20px 28px; box-sizing: border-box; gap: 14px;">
     <div style="display: flex; align-items: center; gap: 10px;"><div style="font-size: 14px; color: ${MUTED};">‹ Lobby</div><div style="font-size: 15px; font-weight: 600;">Leaderboard</div><div style="margin-left: auto; display: flex; gap: 4px;">${chip('This week', period === 'week')}${chip('All time', period === 'all')}</div></div>
     ${claimable ? `<div style="display: flex; align-items: center; justify-content: space-between; padding: 14px; border-radius: 12px; background: ${INK}; color: #FFFFFF; font-size: 15px; font-weight: 600;"><div>Your prize · 1.20 AUSD</div><div style="padding: 8px 14px; border-radius: 8px; background: #FFFFFF; color: ${INK}; font-size: 14px;">Claim</div></div>` : ''}
     ${chips(['Direction', 'MA Cross', 'RSI', 'All'], tab)}
     <div style="display: flex; justify-content: space-between; align-items: baseline;"><div style="font-size: 14px; color: ${BODY};">${period === 'week' ? `Pool <b>${tab === 'All' ? '3.4 AUSD · 3 pools' : '3.1 AUSD'}</b> · ${tab === 'All' ? 14 : 12} players · ends Sunday` : `<b>${tab === 'All' ? '41 players' : '31 players'}</b> since launch`}</div><div style="font-size: 13px; color: ${MUTED};">by volume</div></div>
     ${(period === 'week' ? [['1', '0x7c…19e2', '4 200', '1.55'], ['2', '0x3f…a1c4', '2 950', '0.93'], ['3', '0xb2…77d0', '1 800', '0.62'], ['4', '0x11…c0aa', '1 500', ''], ['…', '', '', ''], ['7', 'you', '750', '']] : [['1', '0x7c…19e2', '61 400', ''], ['2', '0xb2…77d0', '38 200', ''], ['3', '0x3f…a1c4', '35 900', ''], ['…', '', '', ''], ['12', 'you', '9 000', '']]).map(([r, w, v, pz]) => `<div style="display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid ${HAIR}; font-size: 14px; ${w === 'you' ? 'font-weight: 700;' : ''}"><div style="display: flex; gap: 12px;"><div style="width: 20px; color: ${MUTED};">${r}</div><div>${w}</div></div><div style="display: flex; gap: 16px;"><div>${v ? v + ' AUSD' : ''}</div><div style="width: 56px; text-align: right; color: ${pz ? INK : MUTED};">${pz ? '+' + pz : ''}</div></div></div>`).join('')}
     ${small(period === 'week' ? 'Top 3 by volume in each strategy share its pool · paid on-chain Sunday · claim here' : 'Volume traded since launch. Prizes are weekly: switch to This week.')}
   </div>`,

  claimSheet: (state = 'ask') => `<div style="flex: 1; position: relative;">${F.leaderboard()}
     <div style="position: absolute; inset: 0; background: rgba(24,24,27,0.35); display: flex; align-items: flex-end;"><div style="width: 100%; border-radius: 20px 20px 0 0; background: #FFFFFF; padding: 20px 20px 28px; box-sizing: border-box; display: flex; flex-direction: column; gap: 12px;"><div style="width: 36px; height: 4px; border-radius: 2px; background: ${LINE}; align-self: center;"></div><div style="font-size: 20px; font-weight: 700;">Your prize for week 36</div>${row('Direction · #2 of 12', '1.20 AUSD')}${small('Paid by the prize contract on Monad. One tap, lands in your wallet.')}${state === 'ask' ? btn('Claim 1.20 AUSD') : btn('Claiming…', 'disabled')}</div></div></div>`,

  claimed: () => page(
    `<div style="font-size: 13px; font-weight: 600; letter-spacing: 0.04em; color: ${MUTED};">CLAIMED</div>
     <div style="display: flex; flex-direction: column; gap: 8px;"><div style="font-size: 32px; line-height: 1.1; font-weight: 700;">+1.20 AUSD</div><div style="font-size: 15px; color: #52525B;">In your wallet. Week 36 · Direction · #2 of 12.</div></div>
     ${card(row('This week so far', '#7 · 750 AUSD traded') + row('Pool', '3.1 AUSD') + row('Ends', 'Sunday 00:00'))}
     ${p('Two more taps this week and the top three is within reach.')}`,
    btn('Back to the board') + btn('Share it', 'link')),

  /** Risk as a board: a gauge, not a table. Says how hot it is, never whether to trade. */
  riskBoard: (state = 'view', level = 'warm') => {
    const L = { calm: { angle: -70, word: 'Calm', sub: 'Nothing open. Full budget for the day.', pct: 0 }, warm: { angle: -20, word: 'Warm', sub: 'One trade open. 25 of today\'s 25 still in play.', pct: 22 }, hot: { angle: 50, word: 'Hot', sub: 'Two trades open, budget half spent. Stops are set.', pct: 68 } }[level];
    const gauge = `<div style="position: relative; height: 150px; display: flex; align-items: flex-end; justify-content: center;">
      <svg width="260" height="140" viewBox="0 0 260 140"><path d="M20 130 A110 110 0 0 1 240 130" fill="none" stroke="${HAIR}" stroke-width="18" stroke-linecap="round"></path><path d="M20 130 A110 110 0 0 1 240 130" fill="none" stroke="${INK}" stroke-width="18" stroke-linecap="round" stroke-dasharray="345" stroke-dashoffset="${Math.round(345 - 345 * L.pct / 100)}"></path><g transform="rotate(${L.angle} 130 130)"><path d="M130 130 L130 40" stroke="${INK}" stroke-width="4" stroke-linecap="round"></path></g><circle cx="130" cy="130" r="9" fill="${INK}"></circle></svg>
      <div style="position: absolute; bottom: 0; left: 0; font-size: 11px; color: ${MUTED};">calm</div><div style="position: absolute; bottom: 0; right: 0; font-size: 11px; color: ${MUTED};">hot</div>
    </div>`;
    const dial = (name, pct, label) => `<div style="flex: 1; display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 12px 8px; border-radius: 14px; background: ${SOFT};"><svg width="64" height="64" viewBox="0 0 64 64"><circle cx="32" cy="32" r="26" fill="none" stroke="${HAIR}" stroke-width="8"></circle><circle cx="32" cy="32" r="26" fill="none" stroke="${INK}" stroke-width="8" stroke-linecap="round" stroke-dasharray="163" stroke-dashoffset="${Math.round(163 - 163 * pct / 100)}" transform="rotate(-90 32 32)"></circle><text x="32" y="37" text-anchor="middle" font-size="14" font-weight="700" fill="${INK}" font-family="system-ui">${pct}%</text></svg><div style="font-size: 13px; font-weight: 600;">${name}</div><div style="font-size: 11px; color: ${MUTED}; text-align: center;">${label}</div></div>`;
    const day = `<div style="display: flex; flex-direction: column; gap: 6px;"><div style="display: flex; justify-content: space-between; font-size: 13px;"><div style="color: ${BODY};">Today, hour by hour</div><div style="color: ${MUTED};">how much was in play</div></div><div style="display: flex; align-items: flex-end; gap: 3px; height: 44px;">${[0, 0, 0, 0, 0, 0, 0, 0, 10, 30, 30, 0, 45, 45, 45, 20, 0, 0, 0, 0, 0, 0, 0, 0].map((h, i) => `<div style="flex: 1; height: ${Math.max(3, h)}%; border-radius: 2px; background: ${i === 14 ? INK : h ? '#A1A1AA' : HAIR};"></div>`).join('')}</div><div style="display: flex; justify-content: space-between; font-size: 11px; color: ${MUTED};"><div>00</div><div>06</div><div>12</div><div>18</div><div>24</div></div></div>`;
    return `<div style="flex: 1; display: flex; flex-direction: column; padding: 60px 20px 28px; box-sizing: border-box; gap: 16px;">
     <div style="display: flex; align-items: center; gap: 10px;"><div style="font-size: 14px; color: ${MUTED};">‹ Lobby</div><div style="font-size: 15px; font-weight: 600;">Risk</div>${badge(NET)}</div>
     ${gauge}
     <div style="text-align: center; display: flex; flex-direction: column; gap: 4px;"><div style="font-size: 28px; font-weight: 700; letter-spacing: -0.01em;">${L.word}</div><div style="font-size: 14px; color: ${BODY};">${L.sub}</div></div>
     <div style="display: flex; gap: 8px;">${dial('Direction', level === 'calm' ? 0 : 40, level === 'calm' ? 'nothing open' : '1 open · 25 at stake')}${dial('MA Cross', level === 'hot' ? 60 : 0, level === 'hot' ? '1 open · budget half' : 'quiet')}${dial('RSI', 0, 'quiet')}</div>
     ${day}
     <div style="margin-top: auto; display: flex; flex-direction: column; gap: 10px;">${state === 'view' ? btn('Close everything', 'outline') : state === 'confirm' ? `<div style="height: 52px; border-radius: 12px; background: #DC2626; color: #FFFFFF; display: flex; align-items: center; justify-content: center; font-size: 17px; font-weight: 600;">Tap again to close everything · 3</div>` : btn('Closing…', 'disabled')}<div style="font-size: 13px; color: ${MUTED}; text-align: center;">Numbers ›</div></div>
   </div>`;
  },

  riskDetails: () => `<div style="flex: 1; display: flex; flex-direction: column; padding: 60px 20px 28px; box-sizing: border-box; gap: 14px;">
     <div style="display: flex; align-items: center; gap: 10px;"><div style="font-size: 14px; color: ${MUTED};">‹ Risk</div><div style="font-size: 15px; font-weight: 600;">Numbers</div></div>
     ${['Direction', 'MA Cross'].map((n, i) => card(`<div style="display: flex; justify-content: space-between; font-size: 14px; font-weight: 600;"><div>${n}</div><div style="font-weight: 400; color: ${MUTED};">${i === 0 ? '1 open' : '0 open'}</div></div>
       ${row("Today's loss budget", i === 0 ? '25 left of 25' : '13 left of 25')}${row('Exposure', i === 0 ? '750 of 1 000' : '0 of 1 000')}${i === 1 ? row('Cooldown', 'next entry in 42 s') : ''}
       ${row('Today', i === 0 ? '+1.04 · 1' : '−0.42 · 1')}${row('This week', i === 0 ? '+3.72 · 3' : '+0.42 · 2')}${row('All time', i === 0 ? '+5.10 · 8' : '+0.92 · 4')}
       ${small(i === 0 ? 'best +2.10 · worst −25.00 · max drawdown 25.00 · 2 wins in a row · closed by timer 6, stop 1, manual 1' : 'best +1.20 · worst −0.42 · max drawdown 0.42 · closed by timer 3, manual 1')}`)).join('')}
     ${card(`${small('RSI Bounce')}${small('not enabled · enables on your first tap there')}`)}
     ${card(`<div style="font-size: 12px; font-weight: 600; letter-spacing: 0.04em; color: ${MUTED};">MARKET · BTC</div><div style="font-size: 14px;">A minute moves 12.4 bps; a round trip costs 3.45 bps. Edge 3.6×.</div>${small('Below the 5× the strategies were sized for: fees eat a bigger share of each move.')}`)}
     ${small('Limits: up to 50 per position · 15x · daily loss 25 · cooldown 30 s. Checked by the platform before any order reaches the exchange; stops are judged on the exchange’s own mark.')}
   </div>`,

  allClosed: () => page(
    `<div style="font-size: 13px; font-weight: 600; letter-spacing: 0.04em; color: ${MUTED};">EVERYTHING CLOSED</div>
     <div style="display: flex; flex-direction: column; gap: 8px;"><div style="font-size: 32px; line-height: 1.1; font-weight: 700;">You lost</div><div style="font-size: 56px; font-weight: 700; letter-spacing: -0.02em; line-height: 1;">−3.40</div><div style="font-size: 15px; color: #52525B;">AUSD · 2 positions closed at market · fees 0.34</div></div>
     ${card(row('Direction · BTC', '−1.20') + row('MA Cross · BTC', '−2.20') + row('Nothing open now', '0 AUSD at risk'))}
     ${p('The kill switch does not judge. Nothing is open, the daily budget is intact for tomorrow.')}`,
    btn('Back to lobby')),

  account: ({ net = NET } = {}) => `<div style="flex: 1; display: flex; flex-direction: column; padding: 60px 20px 28px; box-sizing: border-box; gap: 14px;">
     <div style="display: flex; align-items: center; gap: 10px;"><div style="font-size: 14px; color: ${MUTED};">‹ Lobby</div><div style="font-size: 15px; font-weight: 600;">Account</div>${badge(net)}</div>
     ${card(`${small('Your wallet · passkey on this phone')}<div style="font-size: 14px; font-weight: 600; word-break: break-all;">0x3f9a…e6b2 <span style="font-weight: 400; color: ${MUTED};">copy</span></div>${row('Balance', net === 'testnet' ? '10 001 AUSD' : '101 AUSD')}${row('In open trades', '50 AUSD')}<div style="display: flex; gap: 8px;"><div style="flex: 1; height: 44px; border-radius: 10px; background: ${INK}; color: #FFFFFF; display: flex; align-items: center; justify-content: center; font-size: 15px; font-weight: 600;">${net === 'testnet' ? 'Add funds · demo' : 'Add funds'}</div><div style="flex: 1; height: 44px; border-radius: 10px; border: 1px solid ${INK}; display: flex; align-items: center; justify-content: center; font-size: 15px; font-weight: 600;">Withdraw</div></div>`)}
     ${card(`${small('Network')}<div style="display: flex; gap: 8px;"><div style="flex: 1; height: 40px; border-radius: 10px; ${net === 'testnet' ? `background: ${INK}; color: #FFFFFF;` : `border: 1px solid ${LINE}; color: ${BODY};`} display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 600;">Practice</div><div style="flex: 1; height: 40px; border-radius: 10px; ${net === 'mainnet' ? `background: ${INK}; color: #FFFFFF;` : `border: 1px solid ${LINE}; color: ${BODY};`} display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 600;">Real money</div></div>${small(net === 'testnet' ? 'Practice money, Monad testnet. Switching to real money asks for confirmation.' : 'Your own money, Monad mainnet. Each network has its own account and balance.')}`)}
     <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; border-radius: 12px; border: 1px solid ${LINE}; font-size: 14px;"><div style="display: flex; flex-direction: column; gap: 2px;"><div style="font-weight: 600;">Invite friends</div>${small('20% of their fees to you · 3 invited · 0.84 AUSD earned')}</div><div style="color: ${MUTED};">›</div></div>
     ${small('Exchange account #48211 · open')}
     <div style="margin-top: auto; display: flex; flex-direction: column; gap: 10px; align-items: center; font-size: 14px; color: ${MUTED};"><div>Sign out</div><div style="font-size: 12px;">Passkey stays on this device. Sign in again with Face ID.</div></div>
   </div>`,

  /** The referral program, as simple as it gets: a link, a share, a share of the fees. */
  invite: ({ friends = true } = {}) => `<div style="flex: 1; display: flex; flex-direction: column; padding: 60px 20px 28px; box-sizing: border-box; gap: 14px;">
     <div style="display: flex; align-items: center; gap: 10px;"><div style="font-size: 14px; color: ${MUTED};">‹ Account</div><div style="font-size: 15px; font-weight: 600;">Invite friends</div></div>
     <div style="height: 150px; border-radius: 16px; ${PH}"></div>
     <div style="font-size: 26px; line-height: 1.15; font-weight: 700; letter-spacing: -0.01em;">Trade together, earn together</div>
     <div style="font-size: 15px; line-height: 1.45; color: ${BODY};">You get <b>20% of the fees</b> we earn on every trade your friends make, for a year. They get <b>their first week of fees back</b>. Paid to your wallet every Sunday, with the prizes.</div>
     ${card(`${small('Your link')}<div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;"><div style="font-size: 15px; font-weight: 600;">tradeagent.app/i/roman7</div><div style="padding: 8px 12px; border-radius: 8px; border: 1px solid ${LINE}; font-size: 13px; font-weight: 600;">Copy</div></div>`)}
     ${btn('Share the link')}
     ${friends ? `<div style="display: flex; gap: 8px;">${[['3', 'invited'], ['21 000', 'AUSD traded'], ['0.84', 'AUSD earned']].map(([v, l]) => `<div style="flex: 1; padding: 10px 12px; border-radius: 12px; border: 1px solid ${HAIR}; display: flex; flex-direction: column; gap: 2px;"><div style="font-size: 18px; font-weight: 700;">${v}</div><div style="font-size: 11px; color: ${MUTED};">${l}</div></div>`).join('')}</div>
     <div style="display: flex; flex-direction: column;"><div style="display: flex; justify-content: space-between; padding: 6px 0; font-size: 11px; font-weight: 600; letter-spacing: 0.04em; color: ${MUTED};"><div>FRIEND</div><div style="display: flex; gap: 16px;"><div style="width: 84px; text-align: right;">VOLUME</div><div style="width: 56px; text-align: right;">EARNED</div></div></div>${[['0x9a…f2c1', 'trading · 14 trades', '15 500', '+0.62'], ['0x41…08de', 'trading · 5 trades', '5 500', '+0.22'], ['0xc7…3b90', 'joined, no trade yet', '0', '']].map(([w, st_, vol, v]) => `<div style="display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid ${HAIR}; font-size: 14px;"><div style="display: flex; flex-direction: column; gap: 2px;"><div>${w}</div>${small(st_)}</div><div style="display: flex; gap: 16px;"><div style="width: 84px; text-align: right;">${vol} AUSD</div><div style="width: 56px; text-align: right; font-weight: 600;">${v}</div></div></div>`).join('')}</div>` : `${card(`<div style="font-size: 15px; font-weight: 600;">Nobody yet</div>${small('Your first friend shows up here after they open the link.')}`)}`}
   </div>`,

  inviteShare: () => `<div style="flex: 1; position: relative; display: flex; flex-direction: column;">${F.invite()}<div style="position: absolute; inset: 0; background: rgba(24,24,27,0.35); display: flex; align-items: flex-end;"><div style="width: 100%; border-radius: 20px 20px 0 0; background: #FFFFFF; padding: 20px 20px 28px; box-sizing: border-box; display: flex; flex-direction: column; gap: 14px;"><div style="width: 36px; height: 4px; border-radius: 2px; background: ${LINE}; align-self: center;"></div><div style="font-size: 18px; font-weight: 700;">Share your link</div><div style="border-radius: 16px; background: ${INK}; color: #FFFFFF; padding: 18px; display: flex; flex-direction: column; gap: 6px;"><div style="font-size: 12px; color: #A1A1AA;">TRADEAGENT · INVITE</div><div style="font-size: 20px; font-weight: 700; line-height: 1.2;">Trade Bitcoin in 15-minute rounds. Practice money first, real money when you want.</div><div style="font-size: 12px; color: #A1A1AA;">Your first week of fees is on me · tradeagent.app/i/roman7</div></div><div style="display: flex; gap: 8px;">${['X', 'Telegram', 'WhatsApp', 'Copy link'].map((l) => `<div style="flex: 1; height: 44px; border-radius: 10px; border: 1px solid ${LINE}; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 600;">${l}</div>`).join('')}</div></div></div></div>`,

  invitedStart: () => page(
    `<div style="display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-radius: 12px; background: ${SOFT};"><div style="width: 32px; height: 32px; border-radius: 16px; background: ${INK};"></div><div style="display: flex; flex-direction: column; gap: 2px;"><div style="font-size: 14px; font-weight: 600;">Roman invited you</div>${small('Your first week of fees is on him.')}</div></div>
     ${h1('How do you want to start?')}
     <div style="display: flex; flex-direction: column; gap: 8px; padding: 18px 16px; border-radius: 16px; border: 2px solid ${INK}; background: #FAFAFA;"><div style="display: flex; align-items: center; gap: 10px;"><div style="font-size: 19px; font-weight: 700;">Practice</div><div style="margin-left: auto; display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600; letter-spacing: 0.04em; padding: 4px 8px; border-radius: 6px; border: 1px solid ${LINE}; color: #52525B;">${MONAD('#52525B')}MONAD TESTNET</div></div><div style="font-size: 15px; line-height: 1.4; color: ${BODY};">Practice money from the exchange. Real prices, real strategies, nothing to lose.</div></div>
     <div style="display: flex; flex-direction: column; gap: 8px; padding: 18px 16px; border-radius: 16px; border: 1px solid ${LINE}; background: #FAFAFA;"><div style="display: flex; align-items: center; gap: 10px;"><div style="font-size: 19px; font-weight: 700;">Real money</div><div style="margin-left: auto; display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600; letter-spacing: 0.04em; padding: 4px 8px; border-radius: 6px; background: ${INK}; color: #FFFFFF;">${MONAD('#FFFFFF')}MONAD MAINNET</div></div><div style="font-size: 15px; line-height: 1.4; color: ${BODY};">Your own money on a real exchange. You deposit it, every win and loss is real, and you can withdraw any time.</div></div>`,
    `<div style="font-size: 13px; color: ${MUTED}; text-align: center;">You can switch any time in Account.</div>`),

  withdraw: (state = 'pick', dest = 'chain') => page(
    `${h1('Withdraw')}${p('To your own wallet on Monad, or to another chain over the same bridge the deposit used.')}
     ${state === 'pick' ? `<div style="display: flex; flex-direction: column; gap: 8px;">${small('Amount')}<div style="display: flex; align-items: center; gap: 8px;"><div style="flex: 1; padding: 12px 14px; border-radius: 10px; border: 1px solid ${LINE}; font-size: 20px; font-weight: 600;">50</div><div style="font-size: 14px; color: ${MUTED};">of 101 AUSD · <b style="color: ${INK};">All</b></div></div>${small('Minimum 10 AUSD. Open trades stay open.')}</div>
       <div style="display: flex; flex-direction: column; gap: 8px;">${small('To')}${chips(['Monad wallet', 'Another chain'], dest === 'chain' ? 'Another chain' : 'Monad wallet')}${dest === 'chain' ? `${chips(['Base', 'Arbitrum', 'Ethereum'], 'Base')}${chips(['USDC', 'USDT', 'AUSD'], 'USDC')}` : chips(['AUSD'], 'AUSD')}<div style="padding: 12px 14px; border-radius: 10px; border: 1px solid ${LINE}; font-size: 14px; color: ${MUTED};">${dest === 'chain' ? 'Your address on Base' : 'Address on Monad'}</div></div>
       ${card(row('You send', '50 AUSD') + row('Fee', dest === 'chain' ? '1 AUSD + bridge 0.20' : '1 AUSD') + row('You get', dest === 'chain' ? '≈ 48.80 USDC on Base' : '49 AUSD'))}`
      : state === 'wait' ? card(`${small('Sending 50 AUSD → 48.80 USDC on Base')}<div style="display: flex; align-items: center; gap: 10px; font-size: 14px; color: #52525B;"><div style="width: 10px; height: 10px; border-radius: 5px; border: 2px solid #A1A1AA;"></div><div>Leaving the exchange, then the bridge. Usually under five minutes.</div></div>`)
      : card(`${small('Sent')}<div style="font-size: 28px; font-weight: 700;">48.80 USDC</div>${small('On Base, in your address. Balance here: 51 AUSD.')}`)}`,
    state === 'pick' ? btn('Withdraw 50 AUSD') : state === 'wait' ? btn('Sending…', 'disabled') : btn('Done')),

  lesson: (name, i) => {
    const L = {
      Direction: [
        ['idea', 'Fifteen minutes. One call.', 'Bitcoin is at 61 250. In fifteen minutes it will be higher or lower. You say which. That is the whole game.'],
        ['quiz', 'Spot it', 'The price just bounced off a line it bounced off twice today. Where would you tap?'],
        ['run', 'We take it from here', 'You tap. Within a second the trade is open at the exchange with your 50 AUSD. The system watches it every second while you do anything else.'],
        ['setup', 'Your standard position', 'Every tap opens this position. Set it once, change it any time.'],
        ['ready', 'Ready', 'You know when to tap, what happens, and what it can cost. Your first tap is on practice money.'],
      ],
      'MA Cross': [
        ['idea', 'Two lines. One moment.', 'A fast line follows the price closely, a slow line lags. When the fast one crosses above the slow one, the trend has just turned up.'],
        ['quiz', 'Spot the cross', 'Three moments on the chart. Only one is a real cross. Tap it.'],
        ['run', 'The signal names a side', 'For a few minutes after a cross the screen shows the signal: Up or Down. Both buttons stay yours; the next cross comes in a few hours.'],
        ['setup', 'Your standard position', 'Same position for every strategy. Amount, leverage, the stop, a take profit if you want one, and the time limit.'],
        ['ready', 'Ready', 'You can read a cross and you know a window lasts minutes. Your first signal is a few hours away at most.'],
      ],
      'RSI Bounce': [
        ['idea', 'The crowd overdoes it', 'A thermometer from 0 to 100 shows how hard everyone has been buying or selling. Under 30, sellers overdid it and the price tends to bounce up.'],
        ['quiz', 'Cold or hot?', 'The thermometer reads 27. Up or down?'],
        ['run', 'Rare and sharp', 'Zones come once or twice a day. The screen shows the signal for a few minutes; both buttons stay yours.'],
        ['setup', 'Your standard position', 'Same position for every strategy. Set it once, change it any time.'],
        ['ready', 'Ready', 'You can read the thermometer and you know to wait. The first zone may take hours; that is the strategy.'],
      ],
    }[name][i];
    const [kind, title, body] = L;
    const art =
      kind === 'quiz' ? `<div style="height: 200px; border-radius: 16px; position: relative; ${PH}">${[28, 55, 80].map((x, k) => `<div style="position: absolute; left: ${x}%; top: ${[58, 30, 64][k]}%; width: 40px; height: 40px; border-radius: 20px; border: 2px solid ${INK}; background: #FFFFFF; display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 700;">${k + 1}</div>`).join('')}</div>`
      : kind === 'setup' ? `<div style="padding: 14px; border-radius: 16px; background: #FAFAFA; border: 1px solid ${HAIR};">${positionForm()}</div>`
      : kind === 'ready' ? `<div style="height: 200px; border-radius: 16px; display: flex; align-items: center; justify-content: center; background: ${SOFT};"><div style="width: 96px; height: 96px; border-radius: 48px; background: ${INK}; display: flex; align-items: center; justify-content: center;"><svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"></path></svg></div></div>`
      : `<div style="height: 200px; border-radius: 16px; ${PH}"></div>`;
    const bottom = kind === 'quiz' ? btn('Tap the chart', 'disabled') : kind === 'ready' ? btn('Make your first tap') + btn('Read it again', 'link') : kind === 'setup' ? possible({ size: 750, lev: 15, stopOn: false, stop: 50, tpOn: false, tp: 50 }) + btn('Save and continue') : btn('Next');
    return page(
      `<div style="display: flex; align-items: center; justify-content: space-between;"><div style="font-size: 13px; font-weight: 600; letter-spacing: 0.04em; color: ${MUTED};">${name.toUpperCase()} · ${i + 1} OF 5</div><div style="font-size: 14px; color: ${MUTED};">Skip</div></div>
       ${kind === 'setup' ? '' : art}
       <div style="display: flex; gap: 6px;">${[0, 1, 2, 3, 4].map((k) => `<div style="width: 20px; height: 4px; border-radius: 2px; background: ${k <= i ? INK : HAIR};"></div>`).join('')}</div>
       <div style="font-size: ${kind === 'setup' ? 22 : 26}px; line-height: 1.15; font-weight: 700;">${title}</div>
       <div style="font-size: ${kind === 'setup' ? 14 : 17}px; line-height: 1.45; color: ${BODY};">${body}</div>${kind === 'setup' ? art : ''}`,
      kind === 'setup' ? `<div style="position: sticky; bottom: 0; background: #FFFFFF; padding-top: 10px; border-top: 1px solid ${HAIR}; display: flex; flex-direction: column; gap: 10px;">${bottom}</div>` : bottom, kind === 'setup' ? '60px 24px 0' : '60px 24px 32px');
  },

  loading: () => `<div style="flex: 1; display: flex; flex-direction: column; padding: 60px 20px 24px; box-sizing: border-box; gap: 14px;">
     <div style="display: flex; align-items: center; gap: 10px;"><div style="width: 28px; height: 28px; border-radius: 8px; background: ${INK};"></div><div style="margin-left: auto; width: 70px; height: 14px; border-radius: 7px; background: ${HAIR};"></div></div>
     <div style="width: 180px; height: 22px; border-radius: 8px; background: ${HAIR};"></div>
     ${[0, 1, 2].map(() => `<div style="height: 120px; border-radius: 14px; background: ${SOFT};"></div>`).join('')}
     ${small('Loading strategies…')}
   </div>`,
  emptyHistory: () => page(`${header('History', NET)}<div style="height: 120px; border-radius: 14px; ${PH}"></div>${card(`<div style="font-size: 16px; font-weight: 700;">No trades yet</div>${small('Your first tap lands here: the price you got, what it cost, what it made, and a card to share.')}`)}`, '', '60px 24px 32px'),
  noPRF: () => page(
    `${header('TradeAgent', NET)}${h1('Use your phone for this one')}${p('This browser cannot create a passkey that unlocks a wallet. On desktop Chrome, save the passkey to Google Password Manager or use iCloud Keychain / 1Password. Easiest: open TradeAgent on your phone.')}
     <div style="width: 140px; height: 140px; border-radius: 16px; align-self: center; ${PH}"></div>${small('QR to the app on your phone')}`,
    btn('Try again here', 'outline'), '60px 24px 32px'),
  cancelled: () => page(
    `${header('TradeAgent', NET)}${h1('No passkey, no account')}${p('The passkey dialog was closed. Nothing was created. The passkey is the account: without it there is nothing to sign in to.')}`,
    btn('Create account') + btn('Why a passkey?', 'link'), '60px 24px 32px'),
  locked: () => page(
    `${header('TradeAgent', NET)}${h1('Sign in to trade')}${p('This platform trades only for signed-in wallets. Unlock with your passkey to see your balance and strategies.')}`,
    btn('Sign in with passkey'), '60px 24px 32px'),

  ownStub: (state = 'ask') => page(
    `<div style="display: flex; align-items: center; gap: 10px;"><div style="font-size: 14px; color: ${MUTED};">‹ Lobby</div><div style="font-size: 15px; font-weight: 600;">Your strategy</div><div style="margin-left: auto; font-size: 11px; font-weight: 600; letter-spacing: 0.04em; padding: 4px 8px; border-radius: 6px; border: 1px solid ${LINE}; color: #52525B;">COMING SOON</div></div>
     <div style="height: 180px; border-radius: 16px; ${PH}"></div>
     ${h1('Build your own strategy')}
     ${p('Describe it in words. The system turns it into rules, tests it on real prices, and runs it inside your limits. Others can follow it; you climb their boards.')}
     ${state === 'ask' ? `<div style="padding: 14px; border-radius: 12px; border: 1px solid ${LINE}; font-size: 15px; color: ${MUTED}; min-height: 80px;">Buy Bitcoin when it drops 2% in an hour, sell after 30 minutes or at −1%…</div>` : card(`<div style="font-size: 16px; font-weight: 700;">You are on the list</div>${small('We ping you when it opens. Your draft is saved.')}`)}`,
    state === 'ask' ? btn('Notify me when it opens') : btn('Back to lobby'), '60px 24px 32px'),
};

// ---- rows ----
const lobby = (opts) => S.lobby(NET, true, opts);
const TALL = 1700;
const rows = {
  FlowStrategy: doc('1 · Strategy', 'One skeleton for all three: chart, two buttons, the settings chip. Everything else is below the fold. MA Cross and RSI only add a signal line and their chart.',
    strip([
      { title: 'Lobby', inner: lobby(), note: 'No «Your week» card: the week line under the title, pool and your place on every card, footer: Leaderboard · History · Risk · Account. The network badge in the header is a dropdown.' },
      { title: 'Direction · whole screen', via: 'Direction', inner: F.strategyFull(), note: 'The chart takes every pixel the buttons do not; only the top edge of the analysis peeks under the chip. Under the fold: the analysis card, then the past positions. Up / Down and the chip stay pinned while scrolling.', h: TALL },
      { title: 'Position', via: 'Up', inner: F.position(), note: 'The chart on top, big, with the entry and the stop drawn on it; the number and the countdown in one card under it.' },
      { title: 'Result', via: '15 min, or Close now', inner: S.result(NET, { week: '5 trades · +4.14 AUSD' }), note: '' },
    ]) + branchStrip('Direction · states', [
      { title: 'Position settings', inner: F.positionSettings(), note: 'Opens from the chip. Position size as any number up to balance × leverage, leverage from the market max down, stop and take profit off by default, one row each; on: preset chips or any percent. Possible win and loss and the button pinned at the bottom.' },
      { title: 'Settings · stop off, take profit +100%', inner: F.positionSettings({ size: 1200, lev: 15, stopOn: false, stop: 50, tpOn: true, tp: 100, balance: 101 }), note: 'Every combination is the user\'s: the loss card says the whole 80 is at stake, the win card says +80 at +100%.' },
      { title: 'Analysis unfolded', inner: F.strategyFull({ context: true }), note: 'Analysis first under the buttons, then the past positions. Open: the headline, the flows, who is buying, and a line on how the strategies do today.', h: TALL },
      { title: 'Analysis popup · once a day', inner: F.strategyWithPopup(), note: 'On the first entry of the day into any strategy from the lobby. Not again when switching strategies.' },
      { title: 'Just filled', inner: F.strategy({ state: 'filled' }), note: 'Notice line after the tap, then the position card takes over.' },
      { title: 'Closed while away', inner: F.strategy({ state: 'timer' }), note: 'Says what happened since the last visit.' },
      { title: 'Cooldown', inner: F.strategy({ state: 'cooldown' }), note: 'Buttons dimmed, seconds shown.' },
      { title: 'Daily limit spent', inner: F.strategy({ state: 'limit' }), note: 'Buttons dimmed, says when it opens.' },
      { title: 'Policy refused', inner: F.strategy({ state: 'refused' }), note: 'The rule that fired, in words, and what to do.' },
      { title: 'Exchange rejected', inner: F.strategy({ state: 'rejected' }), note: 'Nothing opened. One line, retry.' },
      { title: 'Paused by the platform', inner: F.strategy({ state: 'paused' }), note: 'Kill switch on the platform side.' },
      { title: 'Orders tab', inner: F.strategyFull({ tab: 'Orders' }), note: 'Below the fold: every round trip is two fills, each with its fee.', h: TALL },
    ]) + branchStrip('MA Cross · states', [
      { title: 'Whole screen · waiting', inner: F.strategyFull({ name: 'MA Cross', signal: 'waiting' }), note: 'Quiet: a dashed «No signal now» line, two equal outlined buttons. The strategy does not advise against, it has nothing to say.', h: TALL },
      { title: 'Warming up', inner: F.strategy({ name: 'MA Cross', signal: 'warming' }), note: 'First minutes after the platform starts.' },
      { title: 'Signal · Up', inner: F.strategy({ name: 'MA Cross', signal: 'lit' }), note: 'The whole screen changes, the chart keeps its height: a frame and the cross marker on it, a one-row dark SIGNAL banner with the window, Up becomes the big filled button, Down stays as a smaller one. No «recommend» anywhere.' },
      { title: 'Signal · Down', inner: F.strategy({ name: 'MA Cross', signal: 'lit-down' }), note: 'Mirror: Down big and filled, Up small.' },
      { title: 'Signal, but cooldown', inner: F.strategy({ name: 'MA Cross', signal: 'lit', state: 'cooldown' }), note: 'Same states as Direction apply: limit, refused, rejected, paused.' },
    ]) + branchStrip('RSI Bounce · states', [
      { title: 'Whole screen · waiting', inner: F.strategyFull({ name: 'RSI Bounce', signal: 'waiting' }), note: 'RSI twice on purpose: the vertical scale on the left of the price, and the indicator panel under it with the line and the 30 / 70 zones. Quiet while the line is between the zones.', h: TALL },
      { title: 'In the zone · Up', inner: F.strategy({ name: 'RSI Bounce', signal: 'lit' }), note: 'The line dips under 30, the panel gets the frame, the SIGNAL banner says UP with the value, Up is the big button.' },
      { title: 'In the zone · Down', inner: F.strategy({ name: 'RSI Bounce', signal: 'lit-down' }), note: 'The line over 70: mirror.' },
      { title: 'In the zone, but limit spent', inner: F.strategy({ name: 'RSI Bounce', signal: 'lit', state: 'limit' }), note: '' },
    ])),
  FlowPosition: doc('2 · Position, result, sharing', 'The open position, every way it ends, and the share card at both moments.',
    strip([
      { title: 'Position', inner: F.position(), note: 'Chart first with entry and stop lines, then the live number and the countdown side by side. Tap the number card for the details.' },
      { title: 'Position details', inner: F.positionDetail(), note: 'PnL in AUSD and in % of what you put in, price move, size in AUSD and BTC, stop and liquidation with distances, worst moment so far, fees, when it closes.' },
      { title: 'Share · live', via: 'Share', inner: F.shareSheet('live'), note: 'Card with the live number; the link follows the trade until it closes.' },
      { title: 'Result', via: 'closes', inner: S.result(NET, { week: '5 trades · +4.14 AUSD' }), note: 'Share as a link under the primary action.' },
      { title: 'Share · result', via: 'Share', inner: F.shareSheet('final'), note: 'Card with the result and the place on the board.' },
    ]) + branchStrip('How it ends', [
      { title: 'Stop is close', inner: F.position({ banner: 'Stop is 1.2 AUSD away', words: 'You are down', pnl: '−23.80', left: '06:10', pct: '59%' }), note: 'Banner under 10% of the way to the stop.' },
      { title: 'Time is up', inner: S.result(NET), note: 'Closed by the horizon.' },
      { title: 'Stopped', inner: S.result(NET, { kicker: 'STOPPED', title: 'You lost', pnl: '−25.00', move: 'down 3.4%', dur: '9 min', week: '5 trades · −20.86 AUSD', tomorrow: 'The stop did its job: that was the most this tap could lose.' }), note: 'The reason first.' },
      { title: 'Take profit hit', inner: S.result(NET, { kicker: 'TAKE PROFIT', pnl: '+25.00', move: 'up 3.4%', dur: '6 min', tomorrow: 'Locked the win before the time ran out.' }), note: 'When take profit is on.' },
      { title: 'You closed it', inner: S.result(NET, { kicker: 'YOU CLOSED IT', pnl: '+0.62', move: 'up 0.16%', dur: '4 min' }), note: '' },
      { title: 'Closed with everything', inner: S.result(NET, { kicker: 'CLOSED WITH EVERYTHING', title: 'You lost', pnl: '−1.20', move: 'down 0.2%', dur: '7 min', tomorrow: 'Closed by the kill switch on the Risk screen.', again: false }), note: 'Comes from the Risk flow.' },
    ])),
  FlowAccount: doc('5 · Account', 'Wallet, balances, network switch, deposit and withdraw, sign out. Nothing technical.',
    strip([
      { title: 'Lobby', inner: lobby(), note: '' },
      { title: 'Account', via: 'Account', inner: F.account(), note: 'Address with copy, balance and what is in open trades, Add funds / Withdraw, network, one line with the exchange account number.' },
      { title: 'Withdraw · another chain', via: 'Withdraw', inner: F.withdraw('pick', 'chain'), note: 'Base / Arbitrum / Ethereum, USDC / USDT / AUSD. Fee 1 AUSD plus the bridge, shown before the tap.' },
      { title: 'Sending', via: 'Withdraw 50', inner: F.withdraw('wait'), note: 'Exchange → wallet → bridge, one progress line.' },
      { title: 'Sent', via: '~5 min', inner: F.withdraw('done'), note: '' },
    ]) + branchStrip('Other paths', [
      { title: 'Withdraw · Monad wallet', inner: F.withdraw('pick', 'monad'), note: 'AUSD to any address on Monad. Fee 1 AUSD, no bridge.' },
      { title: 'Account · practice', inner: F.account({ net: 'testnet' }), note: 'Deposit is a demo here; badge everywhere.' },
      { title: 'Network menu', inner: S.lobby(NET, true, { menu: true }), note: 'The badge in the lobby header is a dropdown: Practice / Real money, switches at once, no consent screen. The same switch sits in Account.' },
      { title: 'Add funds · from Monad', inner: S.moneyPick({ from: 'monad' }), note: 'Already on Monad: send AUSD to the address, no bridge, lands in a minute.' },
      { title: 'Add funds · from another chain', inner: S.moneyPick(), note: 'Base / Arbitrum / Ethereum over Aurora Intents, as in onboarding.' },
    ])),
  FlowRisk: doc('3 · Risk', 'A board, not a table: a gauge from calm to hot, a dial per strategy, the day hour by hour, the kill switch that asks twice. It never says whether to trade. The numbers sit under «Numbers».',
    strip([
      { title: 'Lobby', inner: lobby(), note: '' },
      { title: 'Risk · warm', via: 'Risk', inner: F.riskBoard('view', 'warm'), note: 'Needle on the gauge, one word, one sentence. Dials: how much of each strategy\'s budget is in play. The strip: when money was at stake today.' },
      { title: 'Confirm', via: 'Close everything', inner: F.riskBoard('confirm', 'warm'), note: 'Second tap within 3 s, or it resets.' },
      { title: 'Everything closed', via: 'tap again', inner: F.allClosed(), note: 'One result for all positions.' },
    ]) + branchStrip('Levels and numbers', [
      { title: 'Calm', inner: F.riskBoard('view', 'calm'), note: 'Nothing open.' },
      { title: 'Hot', inner: F.riskBoard('view', 'hot'), note: 'Two open, budget half spent. Still no advice.' },
      { title: 'Numbers', inner: F.riskDetails(), note: 'Per strategy: budget, exposure, cooldown, results, best / worst / drawdown / streak / closed-by; the market line; the limits. For those who ask.', h: 1400 },
    ])),
  FlowLeaderboard: doc('4 · Leaderboard and prizes', 'One screen: tabs Direction / MA Cross / RSI / All, a This week / All time switch, the board by volume traded, the prize column for the top 3, the claim banner on top.',
    strip([
      { title: 'Lobby with a prize', inner: lobby({ banner: 'Prize of the week: 1.20 AUSD' }), note: 'Banner in the lobby only when a prize waits; it leads here.' },
      { title: 'Leaderboard', via: 'Leaderboard', inner: F.leaderboard(), note: 'Claim on top, tabs, the period switch in the header, pool and players, rows by volume with the prize column, your row, one line of rules.' },
      { title: 'Claim', via: 'Claim', inner: F.claimSheet('ask'), note: 'Where it comes from, one tap.' },
      { title: 'Claiming', via: 'Claim 1.20', inner: F.claimSheet('sending'), note: 'The wallet\'s own transaction; gas from the drop.' },
      { title: 'Claimed', via: '~10 s', inner: F.claimed(), note: 'Back to the board; Share as a link.' },
    ]) + branchStrip('Variants', [
      { title: 'MA Cross tab · nothing to claim', inner: F.leaderboard({ tab: 'MA Cross', claimable: false }), note: '' },
      { title: 'All strategies', inner: F.leaderboard({ tab: 'All', claimable: false }), note: 'Volume across the three; the pools stay per strategy.' },
      { title: 'All time', inner: F.leaderboard({ tab: 'Direction', claimable: false, period: 'all' }), note: 'Since launch, no prize column.' },
    ])),
  FlowHistory: doc('9 · History', 'All trades across strategies, each opening into its orders and a share card.',
    strip([
      { title: 'Lobby', inner: lobby(), note: '' },
      { title: 'History', via: 'History', inner: F.history(), note: 'Positions / Orders, filter by strategy, week and all-time totals, rows by day.' },
      { title: 'Trade', via: 'row', inner: F.tradeDetail(), note: 'PnL in AUSD and in %, duration, the move with both prices, size, stop and take profit, worst and best moment inside the trade, fees, order ids. Share as a pill.' },
      { title: 'Order', via: 'Orders tab · row', inner: F.orderDetail(), note: 'One fill on its own page: the chart with the fill, the stop and take profit levels and the exit; side, size, price, fee, time, the trade it belongs to.' },
      { title: 'Share', via: 'Share', inner: F.shareSheet('final'), note: 'Same card as from the result.' },
    ]) + branchStrip('Filters and empty', [
      { title: 'Direction only', inner: F.history('Direction'), note: '' },
      { title: 'No trades yet', inner: F.emptyHistory(), note: 'Says what will appear.' },
    ])),
  FlowReferral: doc('10 · Invite friends', 'One link, one share, one rule: 20% of the fees on the friends\' trades for a year, the friend gets the first week of fees back. Paid on Sunday with the prizes.',
    strip([
      { title: 'Account', inner: F.account(), note: 'The «Invite friends» row carries the stats. The lobby footer has the same link.' },
      { title: 'Invite friends', via: 'Invite friends', inner: F.invite(), note: 'The rule in one sentence, the link with Copy, one button, the counters, the friends with their volume and what they earned you.' },
      { title: 'Share', via: 'Share the link', inner: F.inviteShare(), note: 'A card with the pitch and the link; X, Telegram, WhatsApp, Copy.' },
      { title: 'The friend opens the link', via: 'friend taps', inner: F.invitedStart(), note: 'Normal onboarding with one banner on the network screen: who invited, what they get. Nothing else changes.' },
    ]) + branchStrip('Before the first friend', [
      { title: 'Nobody yet', inner: F.invite({ friends: false }), note: '' },
    ])),
  FlowErrors: doc('7 · Errors and empty states', 'What the app says when something is missing or broken.',
    strip([
      { title: 'Loading', inner: F.loading(), note: 'Skeleton, no spinner.' },
      { title: 'Offline', via: 'no answer', inner: S.offline(NET), note: 'Time of the last data; stops are at the exchange.' },
      { title: 'Signed out', via: '', inner: F.locked(), note: 'The platform serves signed-in wallets only.' },
      { title: 'Passkey unsupported', via: '', inner: F.noPRF(), note: 'Desktop Chrome without PRF: honest, points to the phone.' },
      { title: 'Passkey cancelled', via: '', inner: F.cancelled(), note: 'Nothing created, one way forward.' },
    ])),
  FlowLessons: doc('6 · Lessons', 'Five steps per strategy: the idea, a quiz on the chart, what we do, a risk slider, a ready badge. Shown once before the first tap, then behind «?». Texts to be simplified in a later pass.',
    ['Direction', 'MA Cross', 'RSI Bounce'].map((n) => branchStrip(n, [0, 1, 2, 3, 4].map((i) => ({ title: `${n} · ${i + 1}`, inner: F.lesson(n, i), note: ['One idea, one picture.', 'Tap the right moment on the chart. A wrong tap explains why.', 'What happens after the tap.', 'The standard position, set once: size up to balance × leverage, leverage, stop and take profit in percent with any value. Possible win and loss pinned at the bottom and recomputed live.', 'Badge, then the first tap.'][i] })))).join('')),
  FlowOwn: doc('8 · Your strategy (stub)', 'The intro promises «then your own to build». Until it exists: a waiting list, so the promise is not a lie.',
    strip([
      { title: 'Lobby', inner: lobby(), note: 'Dashed row under the strategies: «Build your own strategy · coming soon».' },
      { title: 'Your strategy', via: 'coming soon', inner: F.ownStub('ask'), note: 'What it will be, a draft field, one button.' },
      { title: 'On the list', via: 'Notify me', inner: F.ownStub('done'), note: 'Draft saved on the platform.' },
    ])),
};
for (const [name, html] of Object.entries(rows)) writeFileSync(join(OUT, `${name}.dc.html`), html);
if (existsSync('FlowPrizes.dc.html')) unlinkSync('FlowPrizes.dc.html');
console.log('wrote', Object.keys(rows).join(', '));
