/**
 * Asking to be told when a position closes — the web's answer: nothing.
 *
 * The platform owns the exit, so it is the only thing that can say a trade
 * is over while the app is shut. On a phone that is a push; in a browser tab
 * there is nobody to push to, and a permission prompt for a notification
 * that never comes is worse than silence.
 *
 * The native file beside this one does the real work.
 */

/** Registers this device for close notifications. Silent on failure. */
export async function registerForPush(): Promise<void> {}

/** Starts routing a tapped notification to the trade it names. Returns a stop. */
export function followNotifications(): () => void {
  return () => {};
}
