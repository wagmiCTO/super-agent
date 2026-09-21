/**
 * Holding the screen's own back-swipe off while a control owns the finger.
 *
 * The stack pops on a sideways drag, and a drag is exactly what a slider
 * asks for: moving the grip in the danger zone half-popped the screen under
 * it, which read as the whole page flickering, and often left the risk
 * screen for the one behind it. The gesture is native — it does not go
 * through the responder system, so nothing the control does can claim it —
 * so the control says instead when not to offer it at all.
 *
 * Held from the moment the finger lands, which is before the native
 * recogniser has decided anything, and let go on release. The back swipe
 * itself stays: it is only off while a grip is being moved.
 */
import { useNavigation } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';

type Gestured = { setOptions: (options: { gestureEnabled?: boolean }) => void };

export function useBackGestureHold(): (held: boolean) => void {
  const navigation = useNavigation() as unknown as Gestured;
  const held = useRef(false);

  const hold = useCallback(
    (next: boolean) => {
      if (held.current === next) return;
      held.current = next;
      try {
        navigation.setOptions({ gestureEnabled: !next });
      } catch {
        // A screen outside a stack — the web build's own history, say — has
        // no gesture to hold, and nothing to restore either.
      }
    },
    [navigation],
  );

  // A finger lifted outside the control, or a screen left mid-drag, must not
  // leave the way back switched off.
  useEffect(
    () => () => {
      if (!held.current) return;
      held.current = false;
      try {
        navigation.setOptions({ gestureEnabled: true });
      } catch {
        // as above
      }
    },
    [navigation],
  );

  return hold;
}
