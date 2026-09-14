/**
 * The worked examples a lesson is built on.
 *
 * Each names the moment it is talking about and the moment it is not — the
 * turn against the middle of a move, a real cross against lines that merely
 * run close. A reader learns by looking, so nothing here is a question and
 * nothing gates the Next button.
 */

import { View } from 'react-native';
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';

import { BARS, COLD_BARS, lastCross, rsi, scale, sma, type Bar } from '@/ui/series';
import { useTheme, type Theme } from '@/theme';

const W = 320;
const H = 200;

function Frame({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View
      style={{
        height: 200,
        borderRadius: theme.radius.rXl,
        backgroundColor: theme.color.cardBg,
        borderWidth: theme.color.cardLine === 'transparent' ? 0 : theme.size.bw,
        borderColor: theme.color.cardLine,
        overflow: 'hidden',
      }}
    >
      <Svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        {children}
      </Svg>
    </View>
  );
}

function Grid({ theme, top, height }: { theme: Theme; top: number; height: number }) {
  return (
    <>
      {[1, 2, 3].map((k) => (
        <Line key={k} x1={10} y1={top + (height / 4) * k} x2={310} y2={top + (height / 4) * k} stroke={theme.color.chartGrid} strokeWidth={1} />
      ))}
    </>
  );
}

function Candles({ bars, top, height, faded, theme }: { bars: Bar[]; top: number; height: number; faded?: boolean; theme: Theme }) {
  const y = scale(bars, top, height);
  const step = 300 / bars.length;
  const bw = Math.max(2.2, step * 0.56);
  return (
    <>
      {bars.map((bar, i) => {
        const x = 10 + step * (i + 0.5);
        const colour = bar.c >= bar.o ? theme.color.chartUp : theme.color.chartDown;
        const t = y(Math.max(bar.o, bar.c));
        const b = y(Math.min(bar.o, bar.c));
        return (
          <G key={i} opacity={faded ? 0.5 : 1}>
            <Line x1={x} y1={y(bar.h)} x2={x} y2={y(bar.l)} stroke={colour} strokeWidth={1.5} />
            <Rect x={x - bw / 2} y={t} width={bw} height={Math.max(1.5, b - t)} fill={colour} />
          </G>
        );
      })}
    </>
  );
}

/** A tick or a cross with its label beside it, never on top of it. */
function Mark({
  x, y, ok, label, at, theme,
}: { x: number; y: number; ok: boolean; label: string; at: 'below' | 'above' | 'left' | 'right'; theme: Theme }) {
  const colour = ok ? theme.color.up : theme.color.down;
  const pos =
    at === 'below' ? { x, y: y + 27, anchor: 'middle' as const }
    : at === 'above' ? { x, y: y - 19, anchor: 'middle' as const }
    : at === 'left' ? { x: x - 16, y: y + 4, anchor: 'end' as const }
    : { x: x + 16, y: y + 4, anchor: 'start' as const };
  return (
    <G>
      <Circle cx={x} cy={y} r={11} fill={ok ? colour : theme.color.paper} stroke={colour} strokeWidth={2.5} />
      {ok ? (
        <Path d={`M${x - 4.5} ${y}l3.5 3.5 6.5-7`} fill="none" stroke={theme.color.onUp} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <Path d={`M${x - 4} ${y - 4}l8 8M${x + 4} ${y - 4}l-8 8`} stroke={colour} strokeWidth={2.6} strokeLinecap="round" />
      )}
      <SvgText x={pos.x} y={pos.y} fontSize={10} textAnchor={pos.anchor} fill={colour}>
        {label}
      </SvgText>
    </G>
  );
}

/** Fifteen minutes from now it is higher or lower, and you call which. */
export function DirectionIdea() {
  const theme = useTheme();
  const past = BARS.slice(0, 30);
  const y = scale(past, 26, 148);
  const step = 180 / past.length;
  const lastX = 10 + step * (past.length - 0.5);
  const lastY = y(past[past.length - 1].c);
  return (
    <Frame>
      <Grid theme={theme} top={26} height={148} />
      <Candles bars={past} top={26} height={148} theme={theme} />
      <Rect x={192} y={26} width={118} height={148} fill={theme.color.accent} opacity={0.07} />
      <Line x1={192} y1={20} x2={192} y2={180} stroke={theme.color.accent} strokeWidth={2} strokeDasharray="5 5" />
      <SvgText x={198} y={34} fontSize={11} fill={theme.color.accent}>next 15 min</SvgText>
      <Path d={`M${lastX} ${lastY}L250 ${lastY - 44}L302 ${lastY - 64}`} fill="none" stroke={theme.color.up} strokeWidth={3} strokeLinecap="round" strokeDasharray="6 6" />
      <Path d={`M${lastX} ${lastY}L250 ${lastY + 40}L302 ${lastY + 58}`} fill="none" stroke={theme.color.down} strokeWidth={3} strokeLinecap="round" strokeDasharray="6 6" />
      <Circle cx={302} cy={lastY - 64} r={8} fill={theme.color.up} />
      <Circle cx={302} cy={lastY + 58} r={8} fill={theme.color.down} />
      <Circle cx={lastX} cy={lastY} r={5} fill={theme.color.ink} />
    </Frame>
  );
}

/** The level the price keeps turning on — and the middle of a move, which is not it. */
export function DirectionShown() {
  const theme = useTheme();
  const bars = BARS;
  const y = scale(bars, 22, 150);
  const step = 300 / bars.length;
  const x = (i: number) => 10 + step * (i + 0.5);
  const hi = Math.max(...bars.map((b) => b.h));
  const lo = Math.min(...bars.map((b) => b.l));
  const level = lo + (hi - lo) * 0.3;
  const touches = bars.map((b, i) => (Math.abs(b.l - level) < (hi - lo) * 0.05 ? i : -1)).filter((i) => i >= 0);
  const turn = touches.length ? touches[touches.length - 1] : 12;
  let mid = Math.min(bars.length - 4, turn + 16);
  if (mid - turn < 10) mid = Math.max(4, turn - 16);
  return (
    <Frame>
      <Grid theme={theme} top={22} height={150} />
      <Candles bars={bars} top={22} height={150} theme={theme} />
      <Line x1={10} y1={y(level)} x2={310} y2={y(level)} stroke={theme.color.accent} strokeWidth={2} strokeDasharray="6 6" />
      <SvgText x={306} y={y(level) + 16} fontSize={10} textAnchor="end" fill={theme.color.accent}>
        the line it keeps turning on
      </SvgText>
      <Mark x={x(turn)} y={y(level)} ok label="the turn" at="below" theme={theme} />
      <Mark x={x(mid)} y={y(bars[mid].h) - 20} ok={false} label="mid-move" at="above" theme={theme} />
    </Frame>
  );
}

/** Two averages, and the bar where the fast one actually crossed the slow one. */
export function CrossArt({ shown }: { shown?: boolean }) {
  const theme = useTheme();
  const bars = BARS;
  const y = scale(bars, 22, 150);
  const step = 300 / bars.length;
  const x = (i: number) => 10 + step * (i + 0.5);
  const fast = sma(bars, 5);
  const slow = sma(bars, 13);
  const real = lastCross(fast, slow);
  const points = (values: number[]) => values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');

  // The counter-example is the closest near-miss well away from the real one,
  // or the two marks land on top of each other.
  let near = 16;
  let best = Infinity;
  for (let i = 15; i < bars.length - 2; i++) {
    if (Math.abs(i - real) < 12) continue;
    const gap = Math.abs(fast[i] - slow[i]);
    if (gap < best) {
      best = gap;
      near = i;
    }
  }

  return (
    <Frame>
      <Grid theme={theme} top={22} height={150} />
      <Candles bars={bars} top={22} height={150} faded theme={theme} />
      <Path d={`M${points(slow).replace(/ /g, ' L')}`} fill="none" stroke={theme.color.dim} strokeWidth={2.5} />
      <Path d={`M${points(fast).replace(/ /g, ' L')}`} fill="none" stroke={theme.color.accent} strokeWidth={3.2} />
      <Circle cx={x(real)} cy={y(slow[real])} r={12} fill="none" stroke={theme.color.accent} strokeWidth={3} />
      <Circle cx={x(real)} cy={y(slow[real])} r={4.5} fill={theme.color.accent} />
      {shown ? (
        <>
          <Mark x={x(real)} y={y(slow[real])} ok label="a real cross" at={real > bars.length * 0.6 ? 'left' : 'right'} theme={theme} />
          <Mark x={x(near)} y={y(slow[near])} ok={false} label="lines just close" at={near > bars.length * 0.5 ? 'above' : 'below'} theme={theme} />
        </>
      ) : (
        <>
          <Line x1={x(real)} y1={y(slow[real]) - 12} x2={x(real)} y2={34} stroke={theme.color.accent} strokeWidth={2} />
          <Rect x={Math.min(270, Math.max(50, x(real))) - 31} y={11} width={62} height={22} rx={7} fill={theme.color.accent} />
          <SvgText x={Math.min(270, Math.max(50, x(real)))} y={26} fontSize={11} fontWeight="700" textAnchor="middle" fill={theme.color.onAccent}>
            CROSS
          </SvgText>
        </>
      )}
    </Frame>
  );
}

/** Price on top, the crowd thermometer underneath, on a stretch that ends oversold. */
export function RsiArt() {
  const theme = useTheme();
  const bars = COLD_BARS;
  const values = rsi(bars);
  const step = 300 / bars.length;
  const x = (i: number) => 10 + step * (i + 0.5);
  const ry = (v: number) => 192 - (v / 100) * 60;
  const from = 14; // before this the indicator has no window behind it
  const line = values
    .slice(from)
    .map((v, i) => `${x(i + from).toFixed(1)},${ry(v).toFixed(1)}`)
    .join(' L');
  const last = Math.round(values[values.length - 1]);

  return (
    <Frame>
      <Grid theme={theme} top={16} height={96} />
      <Candles bars={bars} top={16} height={96} faded theme={theme} />
      <Rect x={10} y={126} width={300} height={70} fill={theme.color.soft} />
      <Rect x={10} y={ry(100)} width={300} height={ry(70) - ry(100)} fill={theme.color.down} opacity={0.16} />
      <Rect x={10} y={ry(30)} width={300} height={ry(0) - ry(30)} fill={theme.color.up} opacity={0.2} />
      <Path d={`M${line}`} fill="none" stroke={theme.color.ink} strokeWidth={2.5} />
      <SvgText x={16} y={ry(70) - 4} fontSize={10} fill={theme.color.down}>70 overbought</SvgText>
      <SvgText x={16} y={ry(30) + 13} fontSize={10} fill={theme.color.up}>30 oversold</SvgText>
      <Circle cx={x(values.length - 1)} cy={ry(values[values.length - 1])} r={5} fill={theme.color.accent} />
      <Rect x={241} y={127} width={62} height={22} rx={7} fill={theme.color.accent} />
      <SvgText x={272} y={142} fontSize={11} fontWeight="700" textAnchor="middle" fill={theme.color.onAccent}>
        {`RSI ${last}`}
      </SvgText>
    </Frame>
  );
}

/** You tap; the rest happens without you. */
export function RunArt() {
  const theme = useTheme();
  const bars = BARS.slice(20);
  return (
    <Frame>
      <Grid theme={theme} top={20} height={96} />
      <Candles bars={bars} top={20} height={96} faded theme={theme} />
      <Line x1={40} y1={150} x2={280} y2={150} stroke={theme.color.hair} strokeWidth={3} />
      <Line x1={40} y1={150} x2={160} y2={150} stroke={theme.color.accent} strokeWidth={3} />
      {([[40, 'tap'], [160, 'filled'], [280, 'closed']] as const).map(([cx, label], i) => (
        <G key={label}>
          <Circle
            cx={cx}
            cy={150}
            r={i === 1 ? 12 : 10}
            fill={i < 2 ? theme.color.accent : theme.color.soft}
            stroke={i === 2 ? theme.color.hair : 'none'}
            strokeWidth={3}
          />
          {i < 2 ? (
            <Path d={`M${cx - 4.5} 150l3.5 3.5 6.5-7`} fill="none" stroke={theme.color.onAccent} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
          ) : null}
          <SvgText x={cx} y={178} fontSize={11} textAnchor="middle" fill={theme.color.muted}>{label}</SvgText>
        </G>
      ))}
      <SvgText x={160} y={134} fontSize={11} textAnchor="middle" fill={theme.color.muted}>watched every second</SvgText>
    </Frame>
  );
}

/** The last step: you know when to tap, what happens, and what it can cost. */
export function ReadyArt() {
  const theme = useTheme();
  return (
    <View
      style={{
        height: 200,
        borderRadius: theme.radius.rXl,
        backgroundColor: theme.color.soft,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <View style={{ width: 96, height: 96, borderRadius: 48, backgroundColor: theme.color.fill, alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={44} height={44} viewBox="0 0 24 24">
          <Path d="M5 12l5 5L20 7" fill="none" stroke={theme.color.onFill} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      </View>
    </View>
  );
}
