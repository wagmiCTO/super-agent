/**
 * The sign each strategy is known by.
 *
 * A lobby of cards that differ only in their words reads as a list; a
 * mark each makes them places. Each is the strategy's own moment, drawn
 * small: the fork in the road for Direction, two lines crossing over the
 * bars for MA Cross, the line swinging between its two zones for RSI, a
 * bar closing out over the channel for Turtles, and the opening range
 * with the first close outside it for Open Range.
 * Drawn from the theme's accent on the theme's soft ground, so a skin
 * changes them with everything else.
 */

import { View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { useTheme } from '@/theme';

export type GlyphId = 'direction' | 'ma-cross' | 'rsi' | 'donchian' | 'orb';

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
  if (id === 'donchian') {
    // The channel over the bars — top and bottom lines — and the last bar
    // closing out above it, its close ringed.
    const bars: [number, number, number, boolean][] = [
      [7, 17, 8, false],
      [12, 15, 9, true],
      [17, 18, 7, false],
      [22, 16, 8, true],
      [27, 15, 9, false],
    ];
    return (
      <Svg width={size} height={size} viewBox="0 0 40 40">
        <Path d="M4 14h26" stroke={dim} strokeWidth={2} strokeLinecap="round" fill="none" />
        <Path d="M4 27h26" stroke={dim} strokeWidth={2} strokeLinecap="round" fill="none" />
        {bars.map(([x, y, h, isUp]) => (
          <Rect key={x} x={x - 1.6} y={y} width={3.2} height={h} rx={0.8} fill={isUp ? up : down} opacity={0.5} />
        ))}
        <Rect x={31.4} y={9} width={3.2} height={12} rx={0.8} fill={up} />
        <Path d="M33 6v3M33 21v3" stroke={up} strokeWidth={1.6} strokeLinecap="round" />
        <Circle cx="33" cy="9" r="4.5" {...stroke} />
      </Svg>
    );
  }
  if (id === 'orb') {
    // The session open as a rule, the range as a box over its first bars,
    // and the first bar to close out above it.
    return (
      <Svg width={size} height={size} viewBox="0 0 40 40">
        <Path d="M7 5v30" stroke={dim} strokeWidth={1.8} strokeLinecap="round" strokeDasharray="2.5 2.5" fill="none" />
        <Rect x={8} y={15} width={13} height={10} rx={1.5} fill={colour} opacity={0.16} />
        <Path d="M8 15h26M8 25h26" {...stroke} strokeWidth={2} />
        <Rect x={10.4} y={17} width={2.6} height={6} rx={0.7} fill={down} opacity={0.6} />
        <Rect x={14.4} y={16} width={2.6} height={7} rx={0.7} fill={up} opacity={0.6} />
        <Rect x={18.4} y={18} width={2.6} height={5} rx={0.7} fill={down} opacity={0.6} />
        <Rect x={24.4} y={14} width={2.6} height={9} rx={0.7} fill={up} opacity={0.6} />
        <Rect x={29.4} y={8} width={3} height={9} rx={0.8} fill={up} />
        <Path d="M30.9 6v2M30.9 17v3" stroke={up} strokeWidth={1.6} strokeLinecap="round" />
        <Circle cx="30.9" cy="8" r="4.2" {...stroke} />
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
