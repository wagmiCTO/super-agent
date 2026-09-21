/**
 * Being told when a position closes.
 *
 * A position ends on the platform's own timer or its watch on the mark, and
 * it ends whether the phone is awake or not. Until the platform could say so,
 * the one moment worth coming back for — the result — was only ever found by
 * opening the app and looking.
 *
 * The token comes from Expo's push service, which holds the Apple and Google
 * credentials; the platform sends to it. Registration is idempotent and runs
 * on every unlock, because the token is reissued from time to time and a
 * wallet that has moved to a new phone must stop the old one buzzing.
 *
 * Every failure here is silent. Notifications are a courtesy: a trader who
 * refuses the prompt, or a build with no push credentials, must still be able
 * to trade, and an error about a notification in the middle of signing in
 * would be about us rather than about them.
 */
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { Platform } from 'react-native';

import { api } from '@/api/client';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    // The app being open is not a reason to stay quiet: a position can close
    // while its own screen is being read.
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function registerForPush(): Promise<void> {
  try {
    // A simulator has no push service behind it and asking there only
    // produces an error in the log.
    if (!Device.isDevice) return;

    const settings = await Notifications.getPermissionsAsync();
    const granted =
      settings.granted || settings.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL
        ? settings
        : await Notifications.requestPermissionsAsync();
    if (!granted.granted && granted.ios?.status !== Notifications.IosAuthorizationStatus.PROVISIONAL) return;

    if (Platform.OS === 'android') {
      // Android shows nothing at all without a channel to show it in.
      await Notifications.setNotificationChannelAsync('closed', {
        name: 'Closed positions',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 120, 80, 120],
      });
    }

    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ?? (Constants as { easConfig?: { projectId?: string } }).easConfig?.projectId;
    if (!projectId) return;

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    if (!token) return;
    await api.registerDevice(token, Platform.OS === 'ios' ? 'ios' : 'android');
  } catch {
    // Silent on purpose: see the note at the top.
  }
}

export function followNotifications(): () => void {
  // A notification the trader tapped names the market it is about; the
  // strategy screen for it is where the result is read.
  const open = (data: Record<string, unknown> | undefined) => {
    const strategy = typeof data?.strategy === 'string' ? data.strategy : '';
    const route = strategy === 'ma-cross' ? '/ma-cross' : strategy === 'rsi' ? '/rsi' : '/direction';
    router.push(route);
  };

  const tapped = Notifications.addNotificationResponseReceivedListener((r) => {
    open(r.notification.request.content.data as Record<string, unknown> | undefined);
  });

  // A notification tapped while the app was not running arrives as the
  // response that launched it, not as an event.
  void Notifications.getLastNotificationResponseAsync().then((r) => {
    if (r) open(r.notification.request.content.data as Record<string, unknown> | undefined);
  });

  return () => tapped.remove();
}
