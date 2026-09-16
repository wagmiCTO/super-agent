/**
 * The two gauges of the risk screen, drawn from the prototype: the day as
 * one arc with a needle, and a strategy's share of the budget as a ring.
 *
 * Both take a percent or null, and null means the answer has not come back
 * yet: the instrument sits at zero with a loader where its number goes, and
 * grows into the reading when it arrives. Nothing here jumps to a number — a
 * value that appears out of nowhere is a value nobody watched move.
 */

import Svg, { Circle, G, Path, Text as SvgText } from 'react-native-svg';

import { useGrow } from '@/ui/anim';
import { face, useTheme } from '@/theme';

/** Length of the arc from (20,130) to (240,130) with radius 110. */
const ARC = 345;

/** Below this the stroke is not drawn at all: a round cap at zero is a dot. */
const NOTHING = 0.6;

/** The day, calm to hot: the arc fills and the needle turns with the percent. */
export function RiskGauge({ percent }: { percent: number | null }) {
  const theme = useTheme();
  const target = percent === null ? null : Math.max(0, Math.min(100, percent));
  const p = useGrow(target);
  const angle = -80 + p * 1.6;
  return (
    <Svg width={260} height={156} viewBox="0 0 260 156" accessibilityLabel={target === null ? 'Reading your risk' : `Risk ${Math.round(p)} percent`}>
      {/* The two words sit under the ends of the arc, part of the drawing,
          rather than at the screen's edges where they drifted away from it. */}
      <SvgText x={20} y={152} fontSize={12} textAnchor="middle" fontFamily={face(theme, 'display', 500)} fill={theme.color.muted}>calm</SvgText>
      <SvgText x={240} y={152} fontSize={12} textAnchor="middle" fontFamily={face(theme, 'display', 500)} fill={theme.color.muted}>hot</SvgText>
      <Path d="M20 130 A110 110 0 0 1 240 130" fill="none" stroke={theme.color.hair} strokeWidth={18} strokeLinecap="round" />
      {p > NOTHING ? (
        <Path
          d="M20 130 A110 110 0 0 1 240 130"
          fill="none"
          stroke={theme.color.accent}
          strokeWidth={18}
          strokeLinecap="round"
          strokeDasharray={`${ARC}`}
          strokeDashoffset={Math.round(ARC - (ARC * p) / 100)}
        />
      ) : null}
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
export function StrategyRing({ percent, size = 58, delay = 0 }: { percent: number | null; size?: number; delay?: number }) {
  const theme = useTheme();
  const target = percent === null ? null : Math.max(0, Math.min(100, percent));
  // The three rings do not arrive as one: a stagger reads as three
  // instruments rather than one drawing repeated.
  const p = useGrow(target, { settle: 800 + delay });
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" accessibilityLabel={target === null ? 'Reading' : `${Math.round(p)} percent of the budget`}>
      <Circle cx={32} cy={32} r={26} fill="none" stroke={theme.color.hair} strokeWidth={8} />
      {p > NOTHING ? (
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
      ) : null}
      {target === null ? (
        // Three dots where the number goes: a ring with 0% written in it
        // says the strategy is quiet, which is not what we know yet.
        [24, 32, 40].map((x) => <Circle key={x} cx={x} cy={32} r={2} fill={theme.color.dim} />)
      ) : (
        <SvgText x={32} y={37} textAnchor="middle" fontSize={15} fontFamily={face(theme, 'num', 700)} fill={theme.color.ink}>
          {`${Math.round(p)}%`}
        </SvgText>
      )}
    </Svg>
  );
}
