/**
 * A slider, drawn rather than borrowed.
 *
 * React Native has none, and the community one is a native module — a whole
 * dependency for a track, a fill and a grip. This is a view that measures
 * itself and follows a finger, which works the same on a phone and in the web
 * build.
 *
 * The exchange shape the design asks for: a thin track, a filled left half, a
 * square-ish grip. The browser default reads as a form control, not an
 * instrument.
 */

import { useCallback, useRef, useState } from 'react';
import { View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';

import { useTheme } from '@/theme';

export type SliderProps = {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  testID?: string;
};

const yes = () => true;
const no = () => false;

export function Slider({ value, min, max, step = 1, onChange, testID }: SliderProps) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  const widthRef = useRef(0);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    widthRef.current = e.nativeEvent.layout.width;
    setWidth(e.nativeEvent.layout.width);
  }, []);

  // The grip is 18 wide, so the track the finger addresses is that much
  // shorter — otherwise the ends are unreachable.
  const GRIP = 18;
  const span = Math.max(1, max - min);
  const usable = Math.max(1, width - GRIP);
  const ratio = Math.min(1, Math.max(0, (value - min) / span));

  const emit = useCallback(
    (x: number) => {
      const w = Math.max(1, widthRef.current - GRIP);
      const raw = min + (Math.min(w, Math.max(0, x - GRIP / 2)) / w) * span;
      const snapped = Math.round(raw / step) * step;
      onChange(Math.min(max, Math.max(min, snapped)));
    },
    [min, max, span, step, onChange],
  );

  // The responder props are read from this render, so the handler that runs is
  // always the current one — no ref, and nothing to keep in sync.
  const follow = useCallback((e: GestureResponderEvent) => emit(e.nativeEvent.locationX), [emit]);

  return (
    <View
      testID={testID}
      accessibilityRole="adjustable"
      accessibilityValue={{ min, max, now: value }}
      onLayout={onLayout}
      style={{ height: 28, justifyContent: 'center' }}
      onStartShouldSetResponder={yes}
      onMoveShouldSetResponder={yes}
      onResponderTerminationRequest={no}
      onResponderGrant={follow}
      onResponderMove={follow}
    >
      <View style={{ height: 4, borderRadius: 999, backgroundColor: theme.color.hair, overflow: 'hidden' }}>
        <View style={{ height: 4, width: `${ratio * 100}%`, backgroundColor: theme.color.accent }} />
      </View>
      <View
        style={{
          position: 'absolute',
          left: ratio * usable,
          width: GRIP,
          height: GRIP,
          borderRadius: theme.radius.rSm,
          backgroundColor: theme.color.accent,
          borderWidth: 2,
          borderColor: theme.color.paper,
        }}
      />
    </View>
  );
}
