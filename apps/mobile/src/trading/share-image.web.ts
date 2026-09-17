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
    await Promise.all([document.fonts.load(`700 60px ${num(700)}`), document.fonts.load(`700 44px ${display(700)}`), document.fonts.load(`600 44px ${display(600)}`), document.fonts.load(`400 32px ${display(400)}`)]);
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

  // The mark and the name, first: the card is the app's before it is the
  // trade's, and a stranger's chat is where the name is read.
  const MARK = 104;
  drawMark(g, PAD, PAD, MARK, c.onFill, c.accent);
  g.fillStyle = c.onFill;
  g.font = `700 76px ${display(700)}`;
  g.textBaseline = 'top';
  g.fillText(APP_NAME, PAD + MARK + 28, PAD + 6);
  // Kicker under the name, and the state at the right.
  g.fillStyle = c.onAccentDim;
  g.font = `600 30px ${display(600)}`;
  g.fillText((STRATEGY_NAMES[t.strategy] ?? t.strategy).toUpperCase(), PAD + MARK + 28, PAD + 6 + 82);
  g.textAlign = 'right';
  g.fillText(t.kind === 'live' ? 'LIVE' : 'CLOSED', SIZE - PAD, PAD + 6 + 82);
  g.textAlign = 'left';

  const TOP = PAD + MARK + 60;

  // What it is.
  g.fillStyle = c.onFill;
  g.font = `600 48px ${display(600)}`;
  g.fillText(`${side} on ${t.symbol} · ${t.notional.toFixed(0)} AUSD at ${t.leverage}x`, PAD, TOP);

  // The number. Won: the up colour would vanish on the fill in Paper (both
  // are strong), so the number stays in the panel's own ink and the state
  // says the rest.
  g.font = `700 220px ${num(700)}`;
  g.fillStyle = c.onFill;
  g.fillText(money(t.pnl), PAD - 8, TOP + 90);

  g.fillStyle = c.onAccentDim;
  g.font = `400 36px ${display(400)}`;
  const line =
    t.kind === 'live'
      ? `AUSD so far${t.closesIn ? ` · closes in ${t.closesIn} · follow live` : ''}`
      : `AUSD · ${t.symbol} ${t.movePct !== undefined ? `${t.movePct >= 0 ? 'up' : 'down'} ${Math.abs(t.movePct).toFixed(2)}%` : ''}${t.reason ? ` · ${t.reason}` : ''}`;
  g.fillText(line, PAD, TOP + 360);
  if (t.rank) g.fillText(`#${t.rank.place} of ${t.rank.of} this week`, PAD, TOP + 412);
  else g.fillText(won ? 'Called it.' : lost ? 'Next one.' : 'Flat.', PAD, TOP + 412);

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

/**
 * The Tap Trader mark, as ui/mark.tsx draws it, at `size` px with its top
 * left at (x, y): the barrel in the accent, the bull in the panel's ink.
 */
function drawMark(g: CanvasRenderingContext2D, x: number, y: number, size: number, ink: string, accent: string) {
  g.save();
  g.translate(x, y);
  g.scale(size / 64, size / 64);
  g.strokeStyle = accent;
  g.lineCap = 'round';
  g.lineWidth = 3;
  g.beginPath();
  g.arc(32, 32, 26.5, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = 2.1;
  g.stroke(new Path2D('M32 5.5v4.4M58.5 32h-4.4M32 58.5v-4.4M5.5 32h4.4'));
  g.translate(11.5, 10.5);
  g.scale(0.64, 0.64);
  g.fillStyle = ink;
  g.fill(new Path2D('M18.4 24.6C13 23 8 19.6 5.4 13.4c5.6 3 10.2 6 14.2 8Z'));
  g.fill(new Path2D('M45.6 24.6c5.4-1.6 10.4-5 13-11.2-5.6 3-10.2 6-14.2 8Z'));
  g.fill(new Path2D('M18 26c0-5 3.5-8 8-8.5h12c4.5.5 8 3.5 8 8.5v6c0 9-5.5 15.5-14 18-8.5-2.5-14-9-14-18Z'));
  g.fillStyle = accent;
  g.fill(new Path2D('M20.5 29 43.5 27.4l.5 5.1c-4 4-8 5-10.4 2.3-1-1-2.2-1-3.2 0-2.4 2.7-6.4 1.7-10.4-2.3Z'));
  g.fill(new Path2D('M32 51.2 24.5 56v-7.4L32 51.4l7.5-2.8V56Z'));
  g.restore();
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
