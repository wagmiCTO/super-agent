/**
 * The sign each strategy is known by.
 *
 * A lobby of three cards that differ only in their words reads as a list;
 * a mark each makes them places. Drawn from the theme's accent on the theme's
 * soft ground, so a skin changes them with everything else.
 */

import { View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { useTheme } from '@/theme';

export type GlyphId = 'direction' | 'ma-cross' | 'rsi';

export function StrategyTile({ id, size = 56 }: { id: GlyphId; size?: number }) {
  const theme = useTheme();
  const inner = Math.round(size * 0.64);
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
      <Glyph id={id} size={inner} colour={theme.color.accent} />
    </View>
  );
}

function Glyph({ id, size, colour }: { id: GlyphId; size: number; colour: string }) {
  const stroke = { stroke: colour, strokeWidth: 2.2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  if (id === 'ma-cross') {
    return (
      <Svg width={size} height={size} viewBox="0 0 40 40">
        <Path d="M7 28c5-1 7-13 13-13s8 12 13 11" {...stroke} />
        <Path d="M7 15c6 2 9 11 13 11s8-9 13-8" {...stroke} opacity={0.35} />
        <Circle cx="20" cy="21" r="3.2" fill={colour} />
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
  return (
    <Svg width={size} height={size} viewBox="0 0 40 40">
      <Path d="M8 20h24" {...stroke} />
      <Path d="M24 12l8 8-8 8" {...stroke} />
      <Path d="M16 12l-8 8 8 8" {...stroke} opacity={0.35} />
    </Svg>
  );
}
