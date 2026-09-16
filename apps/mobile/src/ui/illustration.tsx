/**
 * The promo artwork.
 *
 * Every scene is drawn from the theme's colours and from real bars, so the
 * chain the app ships on gives it its character and the charts in it are the
 * same charts the app draws later.
 */

import { View } from 'react-native';
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';

import { BARS, scale, type Bar } from '@/ui/series';
import { face, useTheme, type Theme } from '@/theme';

const W = 320;
const H = 200;

function Frame({ children, height = 250, viewBox, fit }: { children: React.ReactNode; height?: number; viewBox?: string; fit?: boolean }) {
  const theme = useTheme();
  return (
    <View
      style={{
        height,
        borderRadius: theme.radius.rXl,
        backgroundColor: theme.color.cardBg,
        borderWidth: theme.color.cardLine === 'transparent' ? 0 : theme.size.bw,
        borderColor: theme.color.cardLine,
        overflow: 'hidden',
      }}
    >
      <Svg width="100%" height="100%" viewBox={viewBox ?? `0 0 ${W} ${H}`} preserveAspectRatio={fit ? 'xMidYMid meet' : 'none'}>
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

/** Wicks and bodies, coloured by which way the bar went. */
function Candles({
  bars, left, top, width, height, faded, theme,
}: { bars: Bar[]; left: number; top: number; width: number; height: number; faded?: boolean; theme: Theme }) {
  const y = scale(bars, top, height);
  const step = width / bars.length;
  const bodyWidth = Math.max(2.2, step * 0.56);
  return (
    <>
      {bars.map((bar, i) => {
        const x = left + step * (i + 0.5);
        const colour = bar.c >= bar.o ? theme.color.chartUp : theme.color.chartDown;
        const bodyTop = y(Math.max(bar.o, bar.c));
        const bodyBottom = y(Math.min(bar.o, bar.c));
        return (
          <G key={i} opacity={faded ? 0.5 : 1}>
            <Line x1={x} y1={y(bar.h)} x2={x} y2={y(bar.l)} stroke={colour} strokeWidth={1.5} />
            <Rect
              x={x - bodyWidth / 2}
              y={bodyTop}
              width={bodyWidth}
              height={Math.max(1.5, bodyBottom - bodyTop)}
              fill={colour}
            />
          </G>
        );
      })}
    </>
  );
}

function Tag({ x, y, label, theme, width = 58 }: { x: number; y: number; label: string; theme: Theme; width?: number }) {
  return (
    <G>
      <Rect x={x - width / 2} y={y - 11} width={width} height={22} rx={7} fill={theme.color.accent} />
      <SvgText x={x} y={y + 4} fontSize={11} fontWeight="700" textAnchor="middle" fill={theme.color.onAccent}>
        {label}
      </SvgText>
    </G>
  );
}

/** A market of people guessing, and one of them actually reading it. */
export function CrowdScene() {
  const theme = useTheme();
  const dots: React.ReactNode[] = [];
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 12; col++) {
      if (row === 1 && col === 5) continue;
      dots.push(<Circle key={`${row}-${col}`} cx={26 + col * 24} cy={44 + row * 34} r={4} fill={theme.color.dim} opacity={0.18} />);
    }
  }
  return (
    <Frame>
      <Grid theme={theme} top={30} height={150} />
      {dots}
      <Candles bars={BARS} left={10} top={30} width={300} height={150} faded theme={theme} />
      <Circle cx={146} cy={78} r={20} fill="none" stroke={theme.color.accent} strokeWidth={2.5} />
      <Path d="M146 53v7M171 78h-7M146 103v-7M121 78h7" stroke={theme.color.accent} strokeWidth={2.5} strokeLinecap="round" />
      <Circle cx={146} cy={78} r={7} fill={theme.color.accent} />
      <Tag x={146} y={22} label="YOU" theme={theme} width={44} />
    </Frame>
  );
}

/** Three strategies on the bench; one of them is calling you right now. */
export function CopilotScene() {
  const theme = useTheme();
  return (
    <Frame>
      {[0, 1, 2].map((i) => {
        const y = 30 + i * 48;
        const lit = i === 1;
        const on = lit ? theme.color.onAccent : theme.color.dim;
        return (
          <G key={i}>
            <Rect x={24} y={y} width={272} height={38} rx={9} fill={lit ? theme.color.accent : theme.color.soft} />
            <Circle cx={46} cy={y + 19} r={9} fill={on} opacity={lit ? 1 : 0.5} />
            <Rect x={64} y={y + 12} width={lit ? 92 : 70 + i * 14} height={6} rx={3} fill={on} opacity={lit ? 0.9 : 0.45} />
            <Rect x={64} y={y + 22} width={lit ? 58 : 42} height={4} rx={2} fill={on} opacity={lit ? 0.55 : 0.28} />
            {lit ? (
              <>
                <Rect x={214} y={y + 9} width={56} height={18} rx={9} fill={theme.color.onAccent} />
                <Circle cx={226} cy={y + 18} r={3.5} fill={theme.color.accent} />
                <Rect x={234} y={y + 15} width={28} height={6} rx={3} fill={theme.color.accent} opacity={0.75} />
              </>
            ) : null}
          </G>
        );
      })}
      <Path d="M160 176v-8" stroke={theme.color.accent} strokeWidth={3} strokeLinecap="round" />
      <Tag x={160} y={188} label="SIGNAL · UP" theme={theme} width={96} />
    </Frame>
  );
}

/** A week you did not break, and a floor under every trade. */
export function DisciplineScene() {
  const theme = useTheme();
  const bars = BARS.slice(10);
  return (
    <Frame>
      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <G key={i}>
          <Rect x={24 + i * 39} y={22} width={30} height={30} rx={9} fill={i < 5 ? theme.color.accent : theme.color.soft} />
          {i < 5 ? (
            <Path
              d={`M${32 + i * 39} 37l5 5 9-10`}
              fill="none"
              stroke={theme.color.onAccent}
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : null}
        </G>
      ))}
      <Grid theme={theme} top={74} height={92} />
      <Candles bars={bars} left={10} top={74} width={300} height={92} theme={theme} />
      <Line x1={10} y1={172} x2={310} y2={172} stroke={theme.color.down} strokeWidth={2.5} strokeDasharray="7 6" />
      <Rect x={10} y={172} width={300} height={20} fill={theme.color.down} opacity={0.1} />
      <SvgText x={16} y={186} fontSize={11} fill={theme.color.down}>
        stop · the floor you set
      </SvgText>
    </Frame>
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
      <SvgText x={156} y={124} fontSize={12} textAnchor="middle" fontFamily={face(theme, 'num', 700)} fill={theme.color.up}>
        {`${sharePct}% of fees`}
      </SvgText>
    </Frame>
  );
}
