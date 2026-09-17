/**
 * The worked examples a lesson is built on.
 *
 * Each names the moment it is talking about and the moment it is not — the
 * turn against the middle of a move, a real cross against lines that merely
 * run close. A reader learns by looking, so nothing here is a question and
 * nothing gates the Next button.
 *
 * Every picture is drawn on the same 320 × 200 stage and shown at the
 * stage's own proportions: the frame keeps the aspect ratio rather than
 * stretching to a height, so a circle is a circle on every phone.
 */

import { View } from 'react-native';
import Svg, { Circle, Defs, G, Line, LinearGradient, Path, RadialGradient, Rect, Stop, Text as SvgText } from 'react-native-svg';

import { BARS, SWING_BARS, TREND_BARS, lastCross, rsi, scale, sma, type Bar } from '@/ui/series';
import { face, useTheme, type Theme } from '@/theme';

const W = 320;
const H = 200;

/** The stage: the card's ground, a faint glow of the brand in one corner, and the picture at its own proportions. */
export function Stage({ children, testID }: { children: React.ReactNode; testID?: string }) {
  const theme = useTheme();
  return (
    <View
      testID={testID}
      style={{
        width: '100%',
        aspectRatio: W / H,
        borderRadius: theme.radius.rXl,
        backgroundColor: theme.color.cardBg,
        borderWidth: theme.color.cardLine === 'transparent' ? 0 : theme.size.bw,
        borderColor: theme.color.cardLine,
        overflow: 'hidden',
      }}
    >
      <Svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
        <Defs>
          <RadialGradient id="stage-glow" cx="82%" cy="18%" r="60%">
            <Stop offset="0" stopColor={theme.color.accent} stopOpacity={0.16} />
            <Stop offset="1" stopColor={theme.color.accent} stopOpacity={0} />
          </RadialGradient>
          <LinearGradient id="stage-future" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={theme.color.accent} stopOpacity={0.14} />
            <Stop offset="1" stopColor={theme.color.accent} stopOpacity={0.02} />
          </LinearGradient>
          <LinearGradient id="stage-up" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={theme.color.up} stopOpacity={0.22} />
            <Stop offset="1" stopColor={theme.color.up} stopOpacity={0.02} />
          </LinearGradient>
          <LinearGradient id="stage-down" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={theme.color.down} stopOpacity={0.02} />
            <Stop offset="1" stopColor={theme.color.down} stopOpacity={0.22} />
          </LinearGradient>
          <LinearGradient id="stage-band" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={theme.color.accent} stopOpacity={0.04} />
            <Stop offset="0.5" stopColor={theme.color.accent} stopOpacity={0.2} />
            <Stop offset="1" stopColor={theme.color.accent} stopOpacity={0.04} />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={W} height={H} fill="url(#stage-glow)" />
        {children}
      </Svg>
    </View>
  );
}

function Grid({ theme, top, height, rows = 4 }: { theme: Theme; top: number; height: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows - 1 }, (_, k) => {
        const y = top + (height / rows) * (k + 1);
        return <Line key={k} x1={10} y1={y} x2={310} y2={y} stroke={theme.color.chartGrid} strokeWidth={1} />;
      })}
    </>
  );
}

/** Wicks and rounded bodies, coloured by which way the bar went. */
export function Candles({
  bars, left = 10, top, width = 300, height, faded, theme, opacity = 1,
}: { bars: Bar[]; left?: number; top: number; width?: number; height: number; faded?: boolean; theme: Theme; opacity?: number }) {
  const y = scale(bars, top, height);
  const step = width / bars.length;
  const bw = Math.max(2.4, step * 0.58);
  return (
    <G opacity={faded ? 0.42 * opacity : opacity}>
      {bars.map((bar, i) => {
        const x = left + step * (i + 0.5);
        const colour = bar.c >= bar.o ? theme.color.chartUp : theme.color.chartDown;
        const t = y(Math.max(bar.o, bar.c));
        const b = y(Math.min(bar.o, bar.c));
        return (
          <G key={i}>
            <Line x1={x} y1={y(bar.h)} x2={x} y2={y(bar.l)} stroke={colour} strokeWidth={1.3} />
            <Rect x={x - bw / 2} y={t} width={bw} height={Math.max(1.6, b - t)} rx={1} fill={colour} />
          </G>
        );
      })}
    </G>
  );
}

/** A small filled up or down arrow, the sign the keys use. */
function Arrow({ x, y, up, colour, size = 5 }: { x: number; y: number; up: boolean; colour: string; size?: number }) {
  const d = up ? `M${x - size} ${y + size * 0.6}L${x} ${y - size * 0.7}L${x + size} ${y + size * 0.6}Z` : `M${x - size} ${y - size * 0.6}L${x} ${y + size * 0.7}L${x + size} ${y - size * 0.6}Z`;
  return <Path d={d} fill={colour} />;
}

/** A tick or a cross in a ring, with its label beside it, never on top of it. */
function Mark({
  x, y, ok, label, at, theme,
}: { x: number; y: number; ok: boolean; label: string; at: 'below' | 'above' | 'left' | 'right'; theme: Theme }) {
  const colour = ok ? theme.color.up : theme.color.down;
  const pos =
    at === 'below' ? { x, y: y + 27, anchor: 'middle' as const }
    : at === 'above' ? { x, y: y - 18, anchor: 'middle' as const }
    : at === 'left' ? { x: x - 17, y: y + 4, anchor: 'end' as const }
    : { x: x + 17, y: y + 4, anchor: 'start' as const };
  return (
    <G>
      <Circle cx={x} cy={y} r={15} fill={colour} opacity={0.16} />
      <Circle cx={x} cy={y} r={10} fill={ok ? colour : theme.color.paper} stroke={colour} strokeWidth={2.2} />
      {ok ? (
        <Path d={`M${x - 4.2} ${y}l3.2 3.2 5.8-6.4`} fill="none" stroke={theme.color.onUp} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <Path d={`M${x - 3.6} ${y - 3.6}l7.2 7.2M${x + 3.6} ${y - 3.6}l-7.2 7.2`} stroke={colour} strokeWidth={2.4} strokeLinecap="round" />
      )}
      <SvgText x={pos.x} y={pos.y} fontSize={10} fontFamily={face(theme, 'display', 600)} textAnchor={pos.anchor} fill={colour}>
        {label}
      </SvgText>
    </G>
  );
}

/** A tiny label in the chart's own voice. */
function Note({ x, y, children, theme, anchor = 'start', colour, weight = 500 }: { x: number; y: number; children: string; theme: Theme; anchor?: 'start' | 'middle' | 'end'; colour?: string; weight?: 500 | 600 | 700 }) {
  return (
    <SvgText x={x} y={y} fontSize={10} fontFamily={face(theme, 'display', weight)} textAnchor={anchor} fill={colour ?? theme.color.muted}>
      {children}
    </SvgText>
  );
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Fifteen minutes from now it is higher or lower, and you call which. */
export function DirectionIdea() {
  const theme = useTheme();
  const past = BARS.slice(0, 30);
  const TOP = 32;
  const HEIGHT = 136;
  const y = scale(past, TOP, HEIGHT);
  const step = 186 / past.length;
  const nowX = 10 + step * past.length;
  const lastY = clamp(y(past[past.length - 1].c), 64, 136);
  const upY = clamp(lastY - 54, 30, 100);
  const downY = clamp(lastY + 54, 100, 176);
  return (
    <Stage testID="art-direction-idea">
      <Grid theme={theme} top={TOP} height={HEIGHT} />
      <Rect x={nowX} y={14} width={310 - nowX} height={172} rx={12} fill="url(#stage-future)" />
      <Candles bars={past} left={10} width={186} top={TOP} height={HEIGHT} theme={theme} />
      <Line x1={nowX} y1={14} x2={nowX} y2={186} stroke={theme.color.accent} strokeWidth={1.5} strokeDasharray="3 4" />
      <Note x={nowX + 8} y={26} theme={theme} colour={theme.color.accent} weight={600}>next 15 min</Note>
      <Path d={`M${nowX} ${lastY} C ${nowX + 34} ${lastY}, ${nowX + 40} ${upY}, 292 ${upY}`} fill="none" stroke={theme.color.up} strokeWidth={3} strokeLinecap="round" strokeDasharray="1 7" />
      <Path d={`M${nowX} ${lastY} C ${nowX + 34} ${lastY}, ${nowX + 40} ${downY}, 292 ${downY}`} fill="none" stroke={theme.color.down} strokeWidth={3} strokeLinecap="round" strokeDasharray="1 7" />
      <Circle cx={292} cy={upY} r={16} fill={theme.color.up} opacity={0.18} />
      <Circle cx={292} cy={upY} r={11} fill={theme.color.up} />
      <Arrow x={292} y={upY} up colour={theme.color.onUp} />
      <Circle cx={292} cy={downY} r={16} fill={theme.color.down} opacity={0.18} />
      <Circle cx={292} cy={downY} r={11} fill={theme.color.down} />
      <Arrow x={292} y={downY} up={false} colour={theme.color.onDown} />
      <Circle cx={nowX} cy={lastY} r={9} fill={theme.color.accent} opacity={0.22} />
      <Circle cx={nowX} cy={lastY} r={5} fill={theme.color.ink} stroke={theme.color.paper} strokeWidth={2} />
      <Note x={nowX - 6} y={lastY + 4} theme={theme} anchor="end" colour={theme.color.ink} weight={600}>now</Note>
    </Stage>
  );
}

/** The level the price keeps turning on — and the middle of a move, which is not it. */
export function DirectionShown() {
  const theme = useTheme();
  const bars = BARS;
  const TOP = 22;
  const HEIGHT = 150;
  const y = scale(bars, TOP, HEIGHT);
  const step = 300 / bars.length;
  const x = (i: number) => 10 + step * (i + 0.5);
  const lo = Math.min(...bars.map((b) => b.l));
  const hi = Math.max(...bars.map((b) => b.h));
  const level = lo + (hi - lo) * 0.3;
  const ly = y(level);
  const touches: number[] = [];
  bars.forEach((b, i) => {
    if (Math.abs(b.l - level) < (hi - lo) * 0.05) touches.push(i);
  });
  const turn = touches.length ? touches[touches.length - 1] : 12;
  let mid = Math.min(bars.length - 4, turn + 16);
  if (mid - turn < 10) mid = Math.max(4, turn - 16);
  return (
    <Stage testID="art-direction-shown">
      <Grid theme={theme} top={TOP} height={HEIGHT} />
      <Rect x={10} y={ly - 5} width={300} height={10} rx={5} fill={theme.color.accent} opacity={0.12} />
      <Candles bars={bars} top={TOP} height={HEIGHT} theme={theme} />
      <Line x1={10} y1={ly} x2={310} y2={ly} stroke={theme.color.accent} strokeWidth={2} strokeDasharray="6 5" />
      <Note x={306} y={clamp(ly + 16, 30, 190)} theme={theme} anchor="end" colour={theme.color.accent} weight={600}>the line it keeps turning on</Note>
      {touches.slice(0, -1).map((i) => (
        <Circle key={i} cx={x(i)} cy={ly} r={3} fill={theme.color.accent} />
      ))}
      <Mark x={x(turn)} y={clamp(ly + 20, 40, 168)} ok label="the turn" at="below" theme={theme} />
      <Mark x={x(mid)} y={clamp(y(bars[mid].h) - 22, 30, 150)} ok={false} label="mid-move" at="above" theme={theme} />
    </Stage>
  );
}

/**
 * Two averages on a slide that turns: the fast one crosses the slow one
 * just after the bottom, and that moment is ringed. Shown, it also names
 * the moment that is not one: two lines running close without crossing.
 */
export function CrossArt({ shown }: { shown?: boolean }) {
  const theme = useTheme();
  const bars = TREND_BARS;
  const TOP = 22;
  const HEIGHT = 156;
  const fast = sma(bars, 5);
  const slow = sma(bars, 13);
  const y = scale(bars, TOP, HEIGHT);
  const step = 300 / bars.length;
  const x = (i: number) => 10 + step * (i + 0.5);
  const from = 4;
  const line = (v: number[]) => v.slice(from).map((p, i) => `${x(i + from).toFixed(1)} ${y(p).toFixed(1)}`).join(' L ');
  const real = Math.max(from + 1, lastCross(fast, slow, from));
  // The near miss: the smallest gap between the lines away from any cross.
  let near = from + 2;
  let best = Infinity;
  for (let i = from + 2; i < bars.length - 2; i++) {
    if (Math.abs(i - real) < 10) continue;
    let crosses = false;
    for (let k = Math.max(1, i - 3); k <= Math.min(bars.length - 1, i + 3); k++) {
      if ((fast[k] - slow[k]) * (fast[k - 1] - slow[k - 1]) < 0) crosses = true;
    }
    if (crosses) continue;
    const gap = Math.abs(fast[i] - slow[i]);
    if (gap < best) {
      best = gap;
      near = i;
    }
  }
  const cx = x(real);
  const cy = y((fast[real] + slow[real]) / 2);
  const pillX = clamp(cx, 58, 262);
  return (
    <Stage testID={shown ? 'art-cross-shown' : 'art-cross-idea'}>
      <Grid theme={theme} top={TOP} height={HEIGHT} />
      <Candles bars={bars} top={TOP} height={HEIGHT} faded theme={theme} />
      <Path d={`M ${line(slow)}`} fill="none" stroke={theme.color.dim} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
      <Path d={`M ${line(fast)}`} fill="none" stroke={theme.color.accent} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
      <Note x={x(bars.length - 7)} y={clamp(y(fast[bars.length - 7]) - 14, 30, 190)} theme={theme} anchor="middle" colour={theme.color.accent} weight={600}>fast</Note>
      <Note x={x(bars.length - 7)} y={clamp(y(slow[bars.length - 7]) + 20, 30, 190)} theme={theme} anchor="middle" colour={theme.color.dim} weight={600}>slow</Note>
      {shown ? (
        <>
          <Circle cx={cx} cy={cy} r={16} fill={theme.color.accent} opacity={0.16} />
          <Circle cx={cx} cy={cy} r={4.5} fill={theme.color.accent} stroke={theme.color.paper} strokeWidth={1.5} />
          <Mark x={cx} y={cy} ok label="a real cross" at={real > bars.length * 0.6 ? 'left' : 'right'} theme={theme} />
          <Mark x={x(near)} y={y((fast[near] + slow[near]) / 2)} ok={false} label="lines just close" at={y(slow[near]) > 100 ? 'above' : 'below'} theme={theme} />
        </>
      ) : (
        <>
          <Circle cx={cx} cy={cy} r={20} fill={theme.color.accent} opacity={0.14} />
          <Circle cx={cx} cy={cy} r={11} fill="none" stroke={theme.color.accent} strokeWidth={2.5} />
          <Circle cx={cx} cy={cy} r={4.5} fill={theme.color.accent} />
          <Line x1={cx} y1={cy - 11} x2={cx} y2={40} stroke={theme.color.accent} strokeWidth={1.5} strokeDasharray="2 3" />
          <Rect x={pillX - 34} y={16} width={68} height={22} rx={11} fill={theme.color.accent} />
          <SvgText x={pillX} y={31} fontSize={11} fontFamily={face(theme, 'display', 700)} textAnchor="middle" fill={theme.color.onAccent} letterSpacing={0.6}>
            CROSS
          </SvgText>
        </>
      )}
    </Stage>
  );
}

/** Price on top, the crowd thermometer underneath, on swings that end in a slide into oversold. */
export function RsiArt() {
  const theme = useTheme();
  const all = SWING_BARS;
  const values = rsi(all);
  const from = all.length - 46;
  const bars = all.slice(from);
  const step = 300 / bars.length;
  const x = (i: number) => 10 + step * (i + 0.5);
  const PANE_TOP = 120;
  const PANE_H = 72;
  const ry = (v: number) => PANE_TOP + PANE_H - (v / 100) * PANE_H;
  const line = bars.map((_, i) => `${x(i).toFixed(1)} ${ry(values[i + from]).toFixed(1)}`).join(' L ');
  const last = values[values.length - 1];
  const endX = x(bars.length - 1);
  const endY = ry(last);
  return (
    <Stage testID="art-rsi">
      <Grid theme={theme} top={14} height={92} rows={3} />
      <Candles bars={bars} top={14} height={92} theme={theme} opacity={0.8} />
      <Rect x={10} y={PANE_TOP} width={300} height={PANE_H} rx={10} fill={theme.color.soft} />
      <Rect x={10} y={ry(100)} width={300} height={ry(70) - ry(100)} rx={10} fill="url(#stage-down)" />
      <Rect x={10} y={ry(30)} width={300} height={ry(0) - ry(30)} rx={10} fill="url(#stage-up)" />
      <Line x1={10} y1={ry(70)} x2={310} y2={ry(70)} stroke={theme.color.down} strokeWidth={1} strokeDasharray="3 3" opacity={0.6} />
      <Line x1={10} y1={ry(30)} x2={310} y2={ry(30)} stroke={theme.color.up} strokeWidth={1} strokeDasharray="3 3" opacity={0.6} />
      <Path d={`M ${line}`} fill="none" stroke={theme.color.ink} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
      <Note x={304} y={ry(70) - 4} theme={theme} anchor="end" colour={theme.color.down} weight={600}>70 · overbought</Note>
      <Note x={16} y={ry(30) + 12} theme={theme} colour={theme.color.up} weight={600}>30 · oversold</Note>
      <Circle cx={endX} cy={endY} r={11} fill={theme.color.accent} opacity={0.2} />
      <Circle cx={endX} cy={endY} r={4.5} fill={theme.color.accent} stroke={theme.color.paper} strokeWidth={1.5} />
      <Note x={endX - 10} y={clamp(endY - 9, PANE_TOP + 10, PANE_TOP + PANE_H - 4)} theme={theme} anchor="end" colour={theme.color.ink} weight={700}>{`RSI ${Math.round(last)}`}</Note>
    </Stage>
  );
}

/**
 * What a tap sets in motion. Direction: the tap on the chart, the trade
 * from there to the timer, the floor under it. A signal strategy: the
 * window the screen lights for a few bars, and the two keys that stay yours.
 */
export function RunArt({ kind }: { kind: 'direction' | 'signal' }) {
  const theme = useTheme();
  if (kind === 'signal') return <SignalRun />;
  const bars = BARS.slice(14);
  const TOP = 24;
  const HEIGHT = 118;
  const y = scale(bars, TOP, HEIGHT);
  const step = 300 / bars.length;
  const x = (i: number) => 10 + step * (i + 0.5);
  const entry = 9;
  const exit = bars.length - 1;
  const ey = y(bars[entry].c);
  const xy = y(bars[exit].c);
  const won = bars[exit].c >= bars[entry].c;
  const stopY = clamp(ey + 30, TOP + 10, TOP + HEIGHT + 20);
  return (
    <Stage testID="art-run-direction">
      <Grid theme={theme} top={TOP} height={HEIGHT} />
      <Rect x={x(entry)} y={Math.min(ey, xy)} width={x(exit) - x(entry)} height={Math.max(2, Math.abs(xy - ey))} fill={won ? theme.color.up : theme.color.down} opacity={0.12} />
      <Candles bars={bars} top={TOP} height={HEIGHT} theme={theme} opacity={0.9} />
      <Line x1={x(entry)} y1={ey} x2={310} y2={ey} stroke={theme.color.accent} strokeWidth={1.5} strokeDasharray="4 4" />
      <Line x1={x(entry)} y1={stopY} x2={310} y2={stopY} stroke={theme.color.down} strokeWidth={1.5} strokeDasharray="4 4" />
      <Note x={306} y={stopY + 12} theme={theme} anchor="end" colour={theme.color.down} weight={600}>stop · the floor you set</Note>
      <Circle cx={x(entry)} cy={ey} r={20} fill="none" stroke={theme.color.accent} strokeWidth={1.2} opacity={0.35} />
      <Circle cx={x(entry)} cy={ey} r={13} fill="none" stroke={theme.color.accent} strokeWidth={1.6} opacity={0.6} />
      <Circle cx={x(entry)} cy={ey} r={6} fill={theme.color.accent} stroke={theme.color.paper} strokeWidth={2} />
      <Note x={x(entry)} y={ey - 24} theme={theme} anchor="middle" colour={theme.color.accent} weight={700}>you tap</Note>
      <Circle cx={x(exit)} cy={xy} r={11} fill={theme.color.paper} stroke={theme.color.ink} strokeWidth={2} />
      <Path d={`M${x(exit)} ${xy - 6}V${xy}L${x(exit) + 4} ${xy + 3}`} fill="none" stroke={theme.color.ink} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <Note x={x(exit) - 16} y={xy + 4} theme={theme} anchor="end" colour={theme.color.ink} weight={600}>closed by the timer</Note>
      {/* The watch under the chart: every second between the tap and the close. */}
      <Rect x={10} y={160} width={300} height={26} rx={13} fill={theme.color.soft} />
      <Rect x={10} y={160} width={300} height={26} rx={13} fill="url(#stage-band)" />
      {Array.from({ length: 29 }, (_, i) => (
        <Rect key={i} x={20 + i * 10} y={170} width={2} height={6} rx={1} fill={theme.color.accent} opacity={0.25 + (i % 5 === 0 ? 0.5 : 0)} />
      ))}
      <Note x={22} y={156} theme={theme} colour={theme.color.muted}>watched every second</Note>
      <Note x={302} y={156} theme={theme} anchor="end" colour={theme.color.muted}>15:00 → 00:00</Note>
    </Stage>
  );
}

function SignalRun() {
  const theme = useTheme();
  const bars = TREND_BARS;
  const TOP = 20;
  const HEIGHT = 108;
  const fast = sma(bars, 5);
  const slow = sma(bars, 13);
  const y = scale(bars, TOP, HEIGHT);
  const step = 300 / bars.length;
  const x = (i: number) => 10 + step * (i + 0.5);
  const from = 4;
  const line = (v: number[]) => v.slice(from).map((p, i) => `${x(i + from).toFixed(1)} ${y(p).toFixed(1)}`).join(' L ');
  const real = Math.max(from + 1, lastCross(fast, slow, from));
  const bandX = x(real) - step / 2;
  const bandW = step * 3;
  const pillX = clamp(x(real) + step, 70, 250);
  return (
    <Stage testID="art-run-signal">
      <Grid theme={theme} top={TOP} height={HEIGHT} rows={3} />
      <Rect x={bandX} y={12} width={bandW} height={HEIGHT + 20} rx={6} fill="url(#stage-band)" />
      <Candles bars={bars} top={TOP} height={HEIGHT} faded theme={theme} />
      <Path d={`M ${line(slow)}`} fill="none" stroke={theme.color.dim} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <Path d={`M ${line(fast)}`} fill="none" stroke={theme.color.accent} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
      <Circle cx={x(real)} cy={y((fast[real] + slow[real]) / 2)} r={5} fill={theme.color.accent} stroke={theme.color.paper} strokeWidth={1.5} />
      <Rect x={pillX - 46} y={4} width={92} height={22} rx={11} fill={theme.color.accent} />
      <Circle cx={pillX - 34} cy={15} r={3.5} fill={theme.color.onAccent} />
      <SvgText x={pillX + 4} y={19} fontSize={11} fontFamily={face(theme, 'display', 700)} textAnchor="middle" fill={theme.color.onAccent} letterSpacing={0.6}>
        SIGNAL · UP
      </SvgText>
      <Note x={bandX + bandW + 6} y={40} theme={theme} colour={theme.color.accent} weight={600}>a few bars</Note>
      {/* The keys, as the screen has them: the named side filled, the other still yours. */}
      <Rect x={14} y={144} width={140} height={44} rx={14} fill={theme.color.up} />
      <SvgText x={84} y={164} fontSize={14} fontFamily={face(theme, 'display', 700)} textAnchor="middle" fill={theme.color.onUp}>Up</SvgText>
      <SvgText x={84} y={178} fontSize={9} fontFamily={face(theme, 'display', 500)} textAnchor="middle" fill={theme.color.onUp} opacity={0.8}>take the signal</SvgText>
      <Rect x={166} y={144} width={140} height={44} rx={14} fill="none" stroke={theme.color.down} strokeWidth={1.8} />
      <SvgText x={236} y={164} fontSize={14} fontFamily={face(theme, 'display', 700)} textAnchor="middle" fill={theme.color.down}>Down</SvgText>
      <SvgText x={236} y={178} fontSize={9} fontFamily={face(theme, 'display', 500)} textAnchor="middle" fill={theme.color.down} opacity={0.8}>still yours</SvgText>
    </Stage>
  );
}

/**
 * The last step: the market as the two crowds it is. Bulls push the price
 * up from the left, bears push it down from the right, and the contest is
 * the bar where they meet — which is the bar you are about to trade.
 */
export function ReadyArt() {
  const theme = useTheme();
  const BASE = 150;
  const bulls = Array.from({ length: 9 }, (_, i) => ({ x: 24 + i * 15, h: 18 + i * 9 + (i % 2) * 6 }));
  const bears = Array.from({ length: 9 }, (_, i) => ({ x: 296 - i * 15, h: 18 + i * 9 + ((i + 1) % 2) * 6 }));
  return (
    <Stage testID="art-ready">
      <Rect x={160 - 22} y={20} width={44} height={168} rx={22} fill="url(#stage-band)" />
      <Line x1={10} y1={BASE} x2={310} y2={BASE} stroke={theme.color.line} strokeWidth={1.2} />
      {bulls.map((b, i) => (
        <G key={`b${i}`}>
          <Line x1={b.x} y1={BASE - b.h - 12} x2={b.x} y2={BASE + 4} stroke={theme.color.up} strokeWidth={1.4} opacity={0.7} />
          <Rect x={b.x - 4} y={BASE - b.h} width={8} height={b.h} rx={1.5} fill={theme.color.up} opacity={0.55 + i * 0.05} />
        </G>
      ))}
      {bears.map((b, i) => (
        <G key={`r${i}`}>
          <Line x1={b.x} y1={BASE - b.h - 12} x2={b.x} y2={BASE + 4} stroke={theme.color.down} strokeWidth={1.4} opacity={0.7} />
          <Rect x={b.x - 4} y={BASE - b.h} width={8} height={b.h} rx={1.5} fill={theme.color.down} opacity={0.55 + i * 0.05} />
        </G>
      ))}
      {/* The front line: the two tallest bars lean into each other. */}
      <Circle cx={160} cy={BASE - 104} r={13} fill={theme.color.accent} opacity={0.22} />
      <Circle cx={160} cy={BASE - 104} r={6} fill={theme.color.accent} stroke={theme.color.paper} strokeWidth={2} />
      <Note x={160} y={BASE - 122} theme={theme} anchor="middle" colour={theme.color.accent} weight={700}>your bar</Note>
      <Arrow x={46} y={BASE + 20} up colour={theme.color.up} size={5} />
      <SvgText x={56} y={BASE + 24} fontSize={11} fontFamily={face(theme, 'display', 700)} fill={theme.color.up} letterSpacing={0.6}>BULLS</SvgText>
      <SvgText x={264} y={BASE + 24} fontSize={11} fontFamily={face(theme, 'display', 700)} textAnchor="end" fill={theme.color.down} letterSpacing={0.6}>BEARS</SvgText>
      <Arrow x={274} y={BASE + 20} up={false} colour={theme.color.down} size={5} />
      <Note x={160} y={BASE + 40} theme={theme} anchor="middle" colour={theme.color.muted}>every bar is the two crowds pushing · you pick a side</Note>
    </Stage>
  );
}
