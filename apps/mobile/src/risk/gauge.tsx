/**
 * The two gauges of the risk screen, drawn from the prototype: the day as
 * one arc with a needle, and a strategy's share of the budget as a ring.
 */

import Svg, { Circle, G, Path, Text as SvgText } from 'react-native-svg';

import { face, useTheme } from '@/theme';

/** Length of the arc from (20,130) to (240,130) with radius 110. */
const ARC = 345;

/** The day, calm to hot: the arc fills and the needle turns with the percent. */
export function RiskGauge({ percent }: { percent: number }) {
  const theme = useTheme();
  const p = Math.max(0, Math.min(100, percent));
  const angle = -80 + p * 1.6;
  return (
    <Svg width={250} height={132} viewBox="0 0 260 140" accessibilityLabel={`Risk ${Math.round(p)} percent`}>
      <Path d="M20 130 A110 110 0 0 1 240 130" fill="none" stroke={theme.color.hair} strokeWidth={18} strokeLinecap="round" />
      <Path
        d="M20 130 A110 110 0 0 1 240 130"
        fill="none"
        stroke={theme.color.accent}
        strokeWidth={18}
        strokeLinecap="round"
        strokeDasharray={`${ARC}`}
        strokeDashoffset={Math.round(ARC - (ARC * p) / 100)}
      />
      <G rotation={angle} origin="130, 130">
        <Path d="M130 130 L130 44" stroke={theme.color.ink} strokeWidth={4} strokeLinecap="round" />
      </G>
      <Circle cx={130} cy={130} r={9} fill={theme.color.ink} />
    </Svg>
  );
}

/** Half a circle of radius 26 doubled: the ring's circumference. */
const RING = 163;

/** A strategy's share of the day's budget, as a ring with the number inside. */
export function StrategyRing({ percent, size = 58 }: { percent: number; size?: number }) {
  const theme = useTheme();
  const p = Math.max(0, Math.min(100, percent));
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" accessibilityLabel={`${Math.round(p)} percent of the budget`}>
      <Circle cx={32} cy={32} r={26} fill="none" stroke={theme.color.hair} strokeWidth={8} />
      <Circle
        cx={32}
        cy={32}
        r={26}
        fill="none"
        stroke={theme.color.accent}
        strokeWidth={8}
        strokeLinecap="round"
        strokeDasharray={`${RING}`}
        strokeDashoffset={Math.round(RING - (RING * p) / 100)}
        rotation={-90}
        origin="32, 32"
      />
      <SvgText x={32} y={37} textAnchor="middle" fontSize={15} fontFamily={face(theme, 'num', 700)} fill={theme.color.ink}>
        {`${Math.round(p)}%`}
      </SvgText>
    </Svg>
  );
}
