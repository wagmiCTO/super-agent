/**
 * The Tap Trader mark and the risk dial.
 *
 * Both are drawn from `design/brand/mark.mjs` and the prototype, in SVG rather
 * than as images, so they take the theme's colours instead of shipping one
 * bitmap per skin.
 */

import { APP_NAME } from '@/config';
import Svg, { Circle, G, Path } from 'react-native-svg';

import { useTheme } from '@/theme';

/** A bull in shades inside a gun barrel, which is also a scope. */
export function Mark({ size = 28, ink, accent }: { size?: number; ink?: string; accent?: string }) {
  const theme = useTheme();
  const c = ink ?? theme.color.ink;
  const a = accent ?? theme.color.accent;
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" accessibilityLabel={APP_NAME}>
      <Circle cx="32" cy="32" r="26.5" fill="none" stroke={a} strokeWidth="3" />
      <Path d="M32 5.5v4.4M58.5 32h-4.4M32 58.5v-4.4M5.5 32h4.4" fill="none" stroke={a} strokeWidth="2.1" strokeLinecap="round" />
      <G transform="translate(11.5 10.5) scale(0.64)">
        <Path d="M18.4 24.6C13 23 8 19.6 5.4 13.4c5.6 3 10.2 6 14.2 8Z" fill={c} />
        <Path d="M45.6 24.6c5.4-1.6 10.4-5 13-11.2-5.6 3-10.2 6-14.2 8Z" fill={c} />
        <Path d="M18 26c0-5 3.5-8 8-8.5h12c4.5.5 8 3.5 8 8.5v6c0 9-5.5 15.5-14 18-8.5-2.5-14-9-14-18Z" fill={c} />
        <Path d="M20.5 29 43.5 27.4l.5 5.1c-4 4-8 5-10.4 2.3-1-1-2.2-1-3.2 0-2.4 2.7-6.4 1.7-10.4-2.3Z" fill={a} />
        <Path d="M32 51.2 24.5 56v-7.4L32 51.4l7.5-2.8V56Z" fill={a} />
      </G>
    </Svg>
  );
}

/** Half a circle of radius 8 — the arc the dial fills. */
const ARC_LENGTH = 25.13;

/**
 * How much of today can still go wrong, as one gauge.
 *
 * Its three colours are its own, never `up`/`down`: a hot day happens on
 * winning positions too, and a quiet one must not read as a profitable one.
 */
export function RiskDial({ percent, size = 26 }: { percent: number; size?: number }) {
  const theme = useTheme();
  const p = Math.max(0, Math.min(100, percent));
  const colour = p < 34 ? theme.color.riskCalm : p < 67 ? theme.color.riskWarm : theme.color.riskHot;
  // A colourless gauge says nothing, so a sliver always shows.
  const shown = Math.max(8, p);
  const angle = Math.PI * (1 - shown / 100);
  const ex = 12 + 8 * Math.cos(angle);
  const ey = 18 - 8 * Math.sin(angle);

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityLabel={`Risk ${Math.round(p)} percent`}>
      {/* A half gauge fills only the top of its box; nudge it up so the drawing
          is optically centred on the row it sits in. */}
      <G transform="translate(0 -2)">
        <Path d="M4 18a8 8 0 0 1 16 0" fill="none" stroke={theme.color.hair} strokeWidth="3.2" strokeLinecap="round" />
        <Path
          d="M4 18a8 8 0 0 1 16 0"
          fill="none"
          stroke={colour}
          strokeWidth="3.2"
          strokeLinecap="round"
          strokeDasharray={ARC_LENGTH}
          strokeDashoffset={ARC_LENGTH * (1 - shown / 100)}
        />
        <Circle cx={ex} cy={ey} r="2.8" fill={colour} stroke={theme.color.paper} strokeWidth="1.4" />
      </G>
    </Svg>
  );
}
