/**
 * Where the screen's content starts and stops: under the phone's status bar
 * and above its home indicator, or under and above nothing at all in a
 * browser window that has its own chrome. The design's screens sit 52 points
 * down because a phone has a status bar there; a web page in a tab does not,
 * and starting that far down there is a blank band.
 */
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** The top inset plus the breathing room the design keeps under it. */
export function useTop(room = 12): number {
  const insets = useSafeAreaInsets();
  return Math.round(insets.top) + room;
}

/**
 * Where the last thing on a screen ends: the design's own margin, or the
 * home indicator's band when that is deeper. A button that stops at the
 * design's 28 points sits under the indicator on a phone that has one.
 */
export function useBottom(room = 0): number {
  const insets = useSafeAreaInsets();
  return Math.max(Math.round(insets.bottom), room);
}
