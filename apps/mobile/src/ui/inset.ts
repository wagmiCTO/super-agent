/**
 * Where the screen's content starts: under the phone's status bar, or under
 * nothing at all in a browser window that has its own chrome. The design's
 * screens sit 52 points down because a phone has a status bar there; a web
 * page in a tab does not, and starting that far down there is a blank band.
 */
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** The top inset plus the breathing room the design keeps under it. */
export function useTop(room = 12): number {
  const insets = useSafeAreaInsets();
  return Math.round(insets.top) + room;
}
