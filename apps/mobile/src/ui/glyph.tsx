/**
 * The sign each strategy is known by.
 *
 * A lobby of three cards that differ only in their words reads as a list;
 * a mark each makes them places. Each is the strategy's own moment, drawn
 * small: the fork in the road for Direction, two lines crossing over the
 * bars for MA Cross, the line swinging between its two zones for RSI.
 * Drawn from the theme's accent on the theme's soft ground, so a skin
 * changes them with everything else.
 */

import { View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { useTheme } from '@/theme';

export type GlyphId = 'direction' | 'ma-cross' | 'rsi';

export function StrategyTile({ id, size = 56 }: { id: GlyphId; size?: number }) {
  const theme = useTheme();
  const inner = Math.round(size * 0.68);
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: theme.radius.rLg,
        backgroundColor: theme.color.soft,
        borderWidth: theme.size.bw,
        borderColor: theme.color.hair,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Glyph id={id} size={inner} colour={theme.color.accent} dim={theme.color.dim} up={theme.color.chartUp} down={theme.color.chartDown} />
    </View>
  );
}

function Glyph({ id, size, colour, dim, up, down }: { id: GlyphId; size: number; colour: string; dim: string; up: string; down: string }) {
  const stroke = { stroke: colour, strokeWidth: 2.4, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  if (id === 'ma-cross') {
    // The bars behind, faint; the two averages crossing over them; the cross.
    const bars: [number, number, number, boolean][] = [
      [8, 20, 9, false],
      [13, 16, 10, true],
      [18, 19, 8, false],
      [23, 13, 11, true],
      [28, 10, 9, true],
      [33, 12, 8, false],
    ];
    return (
      <Svg width={size} height={size} viewBox="0 0 40 40">
        {bars.map(([x, y, h, isUp]) => (
          <Rect key={x} x={x - 1.6} y={y} width={3.2} height={h} rx={0.8} fill={isUp ? up : down} opacity={0.38} />
        ))}
        <Path d="M5 12C13 12 15 28 20 28S28 30 35 30" stroke={dim} strokeWidth={2.2} strokeLinecap="round" fill="none" />
        <Path d="M5 30C13 30 15 13 20 13S28 9 35 9" {...stroke} />
        <Circle cx="20" cy="20.5" r="4" fill={colour} />
        <Circle cx="20" cy="20.5" r="1.6" fill="#FFFFFF" />
      </Svg>
    );
  }
  if (id === 'rsi') {
    return (
      <Svg width={size} height={size} viewBox="0 0 40 40">
        <Path d="M6 13h28" {...stroke} strokeDasharray="3 3" opacity={0.4} />
        <Path d="M6 27h28" {...stroke} strokeDasharray="3 3" opacity={0.4} />
        <Path d="M7 20c3 8 6 9 8 5s3-13 6-13 4 12 6 14 4-3 6-6" {...stroke} />
      </Svg>
    );
  }
  // Direction: the market so far, and from now on the two ways it can go.
  return (
    <Svg width={size} height={size} viewBox="0 0 40 40">
      <Path d="M5 20h11" stroke={dim} strokeWidth={2.4} strokeLinecap="round" fill="none" />
      <Path d="M16 20L33 9" {...stroke} />
      <Path d="M26.5 8.5L33 9l-.5 6.5" {...stroke} />
      <Path d="M16 20L33 31" {...stroke} />
      <Path d="M26.5 31.5L33 31l-.5-6.5" {...stroke} />
      <Circle cx="16" cy="20" r="3" fill={colour} />
    </Svg>
  );
}
