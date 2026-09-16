/**
 * The share card, drawn: the design's dark panel with the trade on it and
 * the invite link at the foot, as a PNG the share sheet can carry.
 *
 * Drawn on a canvas rather than captured from the screen: the card is not
 * on the screen, and a picture taken of one would carry the phone's width,
 * its theme and whatever was behind it. Square, so every chat shows it
 * whole.
 */
import { APP_NAME, STRATEGY_NAMES } from '@/config';
import type { ShareTrade } from '@/trading/share';
import { money } from '@/ui/text';
import type { Theme } from '@/theme';
import { face } from '@/theme';

const SIZE = 1080;
const PAD = 84;

export async function renderShareCard(t: ShareTrade, link: string, theme: Theme): Promise<File | null> {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const g = canvas.getContext('2d');
  if (!g) return null;

  const display = (weight: 400 | 500 | 600 | 700) => `"${face(theme, 'display', weight)}"`;
  const num = (weight: 400 | 700) => `"${face(theme, 'num', weight)}"`;
  // The faces are loaded for the page; the canvas only sees them once they are.
  try {
    await Promise.all([document.fonts.load(`700 60px ${num(700)}`), document.fonts.load(`600 44px ${display(600)}`), document.fonts.load(`400 32px ${display(400)}`)]);
  } catch {
    // system fonts then
  }

  const c = theme.color;
  const side = t.side === 'long' ? 'Up' : 'Down';
  const won = t.pnl > 0.005;
  const lost = t.pnl < -0.005;

  // The panel.
  g.fillStyle = c.fill;
  roundRect(g, 0, 0, SIZE, SIZE, 0);
  g.fill();

  // Kicker, and the state at the right.
  g.fillStyle = c.onAccentDim;
  g.font = `600 30px ${display(600)}`;
  g.textBaseline = 'top';
  g.fillText(`${APP_NAME.toUpperCase()} · ${(STRATEGY_NAMES[t.strategy] ?? t.strategy).toUpperCase()}`, PAD, PAD);
  g.textAlign = 'right';
  g.fillText(t.kind === 'live' ? 'LIVE' : 'CLOSED', SIZE - PAD, PAD);
  g.textAlign = 'left';

  // What it is.
  g.fillStyle = c.onFill;
  g.font = `600 48px ${display(600)}`;
  g.fillText(`${side} on ${t.symbol} · ${t.notional.toFixed(0)} AUSD at ${t.leverage}x`, PAD, PAD + 110);

  // The number. Won: the up colour would vanish on the fill in Paper (both
  // are strong), so the number stays in the panel's own ink and the state
  // says the rest.
  g.font = `700 240px ${num(700)}`;
  g.fillStyle = c.onFill;
  g.fillText(money(t.pnl), PAD - 8, PAD + 250);

  g.fillStyle = c.onAccentDim;
  g.font = `400 36px ${display(400)}`;
  const line =
    t.kind === 'live'
      ? `AUSD so far${t.closesIn ? ` · closes in ${t.closesIn} · follow live` : ''}`
      : `AUSD · ${t.symbol} ${t.movePct !== undefined ? `${t.movePct >= 0 ? 'up' : 'down'} ${Math.abs(t.movePct).toFixed(2)}%` : ''}${t.reason ? ` · ${t.reason}` : ''}`;
  g.fillText(line, PAD, PAD + 540);
  if (t.rank) g.fillText(`#${t.rank.place} of ${t.rank.of} this week`, PAD, PAD + 592);
  else g.fillText(won ? 'Called it.' : lost ? 'Next one.' : 'Flat.', PAD, PAD + 592);

  // The foot: the invite, on its own rule.
  g.strokeStyle = c.onAccentDim;
  g.globalAlpha = 0.5;
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(PAD, SIZE - PAD - 150);
  g.lineTo(SIZE - PAD, SIZE - PAD - 150);
  g.stroke();
  g.globalAlpha = 1;
  g.fillStyle = c.onFill;
  g.font = `600 40px ${display(600)}`;
  g.fillText('Trade with me', PAD, SIZE - PAD - 110);
  g.fillStyle = c.onAccentDim;
  g.font = `400 40px ${num(400)}`;
  g.fillText(link.replace(/^https?:\/\//, ''), PAD, SIZE - PAD - 54);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) return null;
  return new File([blob], `${APP_NAME.toLowerCase().replace(/\s+/g, '-')}-${t.symbol.toLowerCase()}-${side.toLowerCase()}.png`, { type: 'image/png' });
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
