/**
 * The promo artwork.
 *
 * Every scene is drawn from the theme's colours and from real bars, so the
 * chain the app ships on gives it its character and the charts in it are the
 * same charts the app draws later.
 */

import { View } from 'react-native';
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';

import { Candles, Stage } from '@/ui/lesson-art';
import { BARS, scale, sma } from '@/ui/series';
import { face, useTheme, type Theme } from '@/theme';

const W = 320;
const H = 200;

function Frame({ children, viewBox = `0 0 ${W} ${H}` }: { children: React.ReactNode; height?: number; viewBox?: string; fit?: boolean }) {
  const theme = useTheme();
  // Shown at the drawing's own proportions, never stretched to a height:
  // a circle in the drawing is a circle on the screen.
  const [, , vw, vh] = viewBox.split(' ').map(Number);
  return (
    <View
      style={{
        width: '100%',
        aspectRatio: (vw || W) / (vh || H),
        borderRadius: theme.radius.rXl,
        backgroundColor: theme.color.cardBg,
        borderWidth: theme.color.cardLine === 'transparent' ? 0 : theme.size.bw,
        borderColor: theme.color.cardLine,
        overflow: 'hidden',
      }}
    >
      <Svg width="100%" height="100%" viewBox={viewBox} preserveAspectRatio="xMidYMid meet">
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

/** A tiny label in the chart's own voice. */
function Note({ x, y, children, theme, anchor = 'start', colour, weight = 500 }: { x: number; y: number; children: string; theme: Theme; anchor?: 'start' | 'middle' | 'end'; colour?: string; weight?: 500 | 600 | 700 }) {
  return (
    <SvgText x={x} y={y} fontSize={10} fontFamily={face(theme, 'display', weight)} textAnchor={anchor} fill={colour ?? theme.color.muted}>
      {children}
    </SvgText>
  );
}

/** The scope from the mark: a small ring with four ticks and a dot. */
function Scope({ x, y, r, theme }: { x: number; y: number; r: number; theme: Theme }) {
  const t = r * 0.42;
  return (
    <G>
      <Circle cx={x} cy={y} r={r * 2} fill={theme.color.accent} opacity={0.1} />
      <Circle cx={x} cy={y} r={r} fill={theme.color.paper} stroke={theme.color.accent} strokeWidth={2.2} />
      <Path d={`M${x} ${y - r - t}v${t}M${x + r + t} ${y}h${-t}M${x} ${y + r + t}v${-t}M${x - r - t} ${y}h${t}`} stroke={theme.color.accent} strokeWidth={2} strokeLinecap="round" />
      <Circle cx={x} cy={y} r={r * 0.34} fill={theme.color.accent} />
    </G>
  );
}

/**
 * Everyone trades the market; the one reading it leaves it behind. The
 * market's own line runs on, gently; from the scope on the last bar the
 * accent line breaks away above it.
 */
export function CrowdScene() {
  const theme = useTheme();
  const bars = BARS.slice(0, 34);
  const TOP = 40;
  const HEIGHT = 130;
  const y = scale(bars, TOP, HEIGHT);
  const step = 200 / bars.length;
  const x = (i: number) => 10 + step * (i + 0.5);
  const mid = sma(bars, 7);
  const from = 3;
  const market = mid.slice(from).map((v, i) => `${x(i + from).toFixed(1)} ${y(v).toFixed(1)}`).join(' L ');
  const lastI = bars.length - 1;
  const sx = x(lastI);
  const sy = Math.min(y(mid[lastI]), TOP + HEIGHT - 30);
  const marketEndY = Math.min(sy + 6, TOP + HEIGHT);
  return (
    <Stage testID="scene-crowd">
      <Grid theme={theme} top={TOP} height={HEIGHT} />
      <Candles bars={bars} left={10} top={TOP} width={200} height={HEIGHT} faded theme={theme} />
      <Path d={`M ${market}`} fill="none" stroke={theme.color.dim} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <Path d={`M${sx} ${sy} C 250 ${sy}, 280 ${marketEndY - 8}, 306 ${marketEndY - 10}`} fill="none" stroke={theme.color.dim} strokeWidth={2} strokeLinecap="round" strokeDasharray="4 4" />
      <Note x={302} y={marketEndY + 6} theme={theme} anchor="end" colour={theme.color.dim} weight={600}>the market</Note>
      <Path d={`M${sx} ${sy} C ${sx + 30} ${sy}, 236 42, 292 30`} fill="none" stroke={theme.color.accent} strokeWidth={3.2} strokeLinecap="round" />
      <Path d="M281 26l11 4-6 10" fill="none" stroke={theme.color.accent} strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" />
      <Note x={274} y={20} theme={theme} anchor="end" colour={theme.color.accent} weight={700}>you</Note>
      <Scope x={sx} y={sy} r={8} theme={theme} />
    </Stage>
  );
}

/**
 * The copilot's instruments on the price: the scope on the bar in play,
 * and from it the three things it has already worked out — the side the
 * signal names, the floor under the trade, the target above it.
 */
export function CopilotScene() {
  const theme = useTheme();
  const bars = BARS.slice(8);
  const TOP = 26;
  const HEIGHT = 148;
  const y = scale(bars, TOP, HEIGHT);
  const step = 300 / bars.length;
  const x = (i: number) => 10 + step * (i + 0.5);
  const at = 24;
  const sx = x(at);
  const sy = Math.min(Math.max(y(bars[at].c), TOP + 44), TOP + HEIGHT - 44);
  const targetY = sy - 40;
  const stopY = sy + 40;
  return (
    <Stage testID="scene-copilot">
      <Grid theme={theme} top={TOP} height={HEIGHT} />
      <Rect x={sx} y={targetY} width={310 - sx} height={sy - targetY} fill="url(#stage-up)" />
      <Rect x={sx} y={sy} width={310 - sx} height={stopY - sy} fill="url(#stage-down)" />
      <Candles bars={bars} top={TOP} height={HEIGHT} theme={theme} opacity={0.85} />
      <Line x1={sx} y1={targetY} x2={310} y2={targetY} stroke={theme.color.up} strokeWidth={1.5} strokeDasharray="4 4" />
      <Line x1={sx} y1={stopY} x2={310} y2={stopY} stroke={theme.color.down} strokeWidth={1.5} strokeDasharray="4 4" />
      <Line x1={sx} y1={sy} x2={310} y2={sy} stroke={theme.color.accent} strokeWidth={1.2} strokeDasharray="2 3" />
      <Note x={306} y={targetY - 5} theme={theme} anchor="end" colour={theme.color.up} weight={700}>target +50%</Note>
      <Note x={306} y={stopY + 13} theme={theme} anchor="end" colour={theme.color.down} weight={700}>stop −25%</Note>
      {/* The signal, on a leader from the scope, over the bars already gone. */}
      <Line x1={sx - 14} y1={sy - 10} x2={sx - 36} y2={sy - 34} stroke={theme.color.accent} strokeWidth={1.4} />
      <Rect x={sx - 134} y={sy - 46} width={98} height={24} rx={12} fill={theme.color.accent} />
      <Circle cx={sx - 121} cy={sy - 34} r={3.5} fill={theme.color.onAccent} />
      <SvgText x={sx - 80} y={sy - 30} fontSize={11} fontFamily={face(theme, 'display', 700)} textAnchor="middle" fill={theme.color.onAccent} letterSpacing={0.6}>
        SIGNAL · UP
      </SvgText>
      <Scope x={sx} y={sy} r={12} theme={theme} />
      <Note x={16} y={TOP + HEIGHT + 16} theme={theme} colour={theme.color.muted}>a plan on every trade, before the tap</Note>
    </Stage>
  );
}

/**
 * A week you did not break: five trades that went to plan and one that
 * did not, and on the chart the taps that made them — up where you called
 * up, down where you called down — over a floor that held.
 */
export function DisciplineScene() {
  const theme = useTheme();
  const bars = BARS.slice(6);
  const TOP = 50;
  const HEIGHT = 118;
  const y = scale(bars, TOP, HEIGHT);
  const step = 300 / bars.length;
  const x = (i: number) => 10 + step * (i + 0.5);
  const week: { ok: boolean }[] = [{ ok: true }, { ok: true }, { ok: false }, { ok: true }, { ok: true }, { ok: true }];
  const taps: { i: number; up: boolean }[] = [
    { i: 3, up: true },
    { i: 11, up: false },
    { i: 17, up: true },
    { i: 25, up: false },
    { i: 31, up: true },
    { i: 37, up: true },
  ];
  const floorY = TOP + HEIGHT + 10;
  return (
    <Stage testID="scene-discipline">
      {week.map((t, i) => {
        const cx = 24 + i * 24;
        const colour = t.ok ? theme.color.up : theme.color.down;
        return (
          <G key={i}>
            <Circle cx={cx} cy={22} r={8} fill={colour} opacity={t.ok ? 1 : 0.9} />
            {t.ok ? (
              <Path d={`M${cx - 3.4} 22l2.6 2.6 4.6-5.2`} fill="none" stroke={theme.color.onUp} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            ) : (
              <Path d={`M${cx - 2.8} 19.2l5.6 5.6M${cx + 2.8} 19.2l-5.6 5.6`} stroke={theme.color.onDown} strokeWidth={2} strokeLinecap="round" />
            )}
          </G>
        );
      })}
      <Note x={172} y={26} theme={theme} colour={theme.color.muted}>this week · 5 of 6 to plan</Note>
      <Grid theme={theme} top={TOP} height={HEIGHT} rows={3} />
      <Candles bars={bars} top={TOP} height={HEIGHT} theme={theme} opacity={0.85} />
      {taps.map((t) => {
        const cx = x(t.i);
        const cy = t.up ? y(bars[t.i].l) + 14 : y(bars[t.i].h) - 14;
        const colour = t.up ? theme.color.up : theme.color.down;
        return (
          <G key={t.i}>
            <Circle cx={cx} cy={cy} r={9} fill={colour} opacity={0.18} />
            <Circle cx={cx} cy={cy} r={6} fill={colour} />
            <Path
              d={t.up ? `M${cx - 3} ${cy + 1.8}L${cx} ${cy - 2.2}L${cx + 3} ${cy + 1.8}Z` : `M${cx - 3} ${cy - 1.8}L${cx} ${cy + 2.2}L${cx + 3} ${cy - 1.8}Z`}
              fill={theme.color.onUp}
            />
          </G>
        );
      })}
      <Line x1={10} y1={floorY} x2={310} y2={floorY} stroke={theme.color.down} strokeWidth={1.5} strokeDasharray="6 5" />
      <Note x={16} y={floorY + 13} theme={theme} colour={theme.color.down} weight={600}>stop · the floor you set, every time</Note>
    </Stage>
  );
}

/**
 * The invite, drawn: you, your friend, the link between you and what comes
 * back along it. The share is written on the arrow because it is the whole
 * offer — a referral screen that makes you read for it is a referral screen
 * nobody shares.
 */
export function ReferralScene({ sharePct }: { sharePct: number }) {
  const theme = useTheme();
  return (
    <Frame height={150} viewBox="16 40 292 116" fit>
      <Rect x={26} y={52} width={92} height={76} rx={16} fill={theme.color.accent} />
      <Circle cx={72} cy={80} r={13} fill={theme.color.onAccent} />
      <Rect x={52} y={100} width={40} height={7} rx={3.5} fill={theme.color.onAccent} opacity={0.8} />
      <SvgText x={72} y={142} fontSize={12} textAnchor="middle" fontFamily={face(theme, 'num', 400)} fill={theme.color.muted}>you</SvgText>

      <Rect x={202} y={52} width={92} height={76} rx={16} fill={theme.color.soft} stroke={theme.color.hair} strokeWidth={2} />
      <Circle cx={248} cy={80} r={13} fill={theme.color.dim} opacity={0.55} />
      <Rect x={228} y={100} width={40} height={7} rx={3.5} fill={theme.color.dim} opacity={0.4} />
      <SvgText x={248} y={142} fontSize={12} textAnchor="middle" fontFamily={face(theme, 'num', 400)} fill={theme.color.muted}>your friend</SvgText>

      <Path d="M124 74h64" fill="none" stroke={theme.color.ink} strokeWidth={2.5} strokeLinecap="round" />
      <Path d="M182 68l8 6-8 6" fill="none" stroke={theme.color.ink} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
      <SvgText x={156} y={62} fontSize={11} textAnchor="middle" fontFamily={face(theme, 'num', 400)} fill={theme.color.muted}>your link</SvgText>

      <Path d="M188 104h-64" fill="none" stroke={theme.color.up} strokeWidth={3} strokeLinecap="round" />
      <Path d="M130 98l-8 6 8 6" fill="none" stroke={theme.color.up} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
      {/* A size down from the prototype's: our figure face is wider than
          the monospace it was drawn against, and at 12 the label touched
          the card behind it. */}
      <SvgText x={156} y={124} fontSize={11} textAnchor="middle" fontFamily={face(theme, 'num', 700)} fill={theme.color.up}>
        {`${sharePct}% of fees`}
      </SvgText>
    </Frame>
  );
}

/**
 * Your own strategy, as the prototype draws it: words in a field, and out
 * of them a row of rules, tested against real bars underneath. The field
 * and the rules are shapes, not text — the screen under it says the words.
 */
export function OwnScene() {
  const theme = useTheme();
  const bars = BARS.slice(6, 40);
  return (
    <Frame height={180} viewBox="0 0 320 180">
      <Rect x={20} y={20} width={280} height={40} rx={10} fill={theme.color.soft} />
      <Rect x={34} y={34} width={160} height={6} rx={3} fill={theme.color.dim} opacity={0.5} />
      <Rect x={34} y={46} width={98} height={6} rx={3} fill={theme.color.dim} opacity={0.3} />
      <Rect x={202} y={32} width={2.5} height={18} fill={theme.color.accent} />
      <Path d="M160 64v10" stroke={theme.color.dim} strokeWidth={2.5} strokeLinecap="round" strokeDasharray="4 4" />
      {[0, 1, 2].map((i) => (
        <G key={i}>
          <Rect x={24 + i * 94} y={80} width={82} height={26} rx={8} fill={theme.color.accent} opacity={0.92 - i * 0.24} />
          <Rect x={38 + i * 94} y={90} width={48 - i * 8} height={6} rx={3} fill={theme.color.onAccent} opacity={0.85} />
        </G>
      ))}
      <Candles bars={bars} left={10} top={118} width={300} height={56} faded theme={theme} />
    </Frame>
  );
}
